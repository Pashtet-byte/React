# Lead Architecture Review: разбор 15 production-кейсов

## Содержание

- [Блок 1. Производительность рендеринга](#блок-1-производительность-рендеринга-и-браузерный-конвейер)
  - [Кейс 01](#кейс-01-layout-thrashing--forced-reflow) · [Кейс 02](#кейс-02-long-tasks-на-массиве-100k-элементов) · [Кейс 03](#кейс-03-неконтролируемая-конкурентность-promiseall)
- [Блок 2. Утечки памяти и GC V8](#блок-2-утечки-памяти-и-сборщик-мусора-v8)
  - [Кейс 04](#кейс-04-map-с-dom-узлами-в-ключах) · [Кейс 05](#кейс-05-забытый-abortsignal) · [Кейс 06](#кейс-06-замыкание-на-тяжёлом-контексте) · [Кейс 07](#кейс-07-зомби-слушатель-event-bus)
- [Блок 3. Асинхронные аварии и стейт](#блок-3-асинхронные-аварии-и-стейт)
  - [Кейс 08](#кейс-08-stale-closure) · [Кейс 09](#кейс-09-silent-failure-и-result-tuple) · [Кейс 10](#кейс-10-promise-memoization) · [Кейс 11](#кейс-11-retry-с-exponential-backoff-и-jitter)
- [Блок 4. Иммутабельность и структуры данных](#блок-4-иммутабельность-нормализация-и-структуры-данных)
  - [Кейс 12](#кейс-12-jsonparsejsonstringify-как-deep-clone) · [Кейс 13](#кейс-13-reactmemo-и-новые-литералы) · [Кейс 14](#кейс-14-дубликаты-при-пагинации) · [Кейс 15](#кейс-15-default-значения-и-null)
- [Итоговая таблица](#итоговая-таблица)

---

## Блок 1. Производительность рендеринга и браузерный конвейер

### Кейс 01. Layout Thrashing / Forced Reflow

**Физика конвейера.** Кадр строится так: `JavaScript → Style → Layout → Paint → Composite`.

- **Style**: браузер вычисляет, какие CSS-правила применены к каждому элементу.
- **Layout**: по стилям рассчитываются размеры и позиции всех боксов. Это самая дорогая фаза, и она зависит от соседей: изменение высоты одной карточки сдвигает остальные.
- **Paint / Composite**: отрисовка пикселей и сборка слоёв.

Обычно браузер ленив. Запись `style.height` только помечает layout как «грязный» (invalidated), а пересчёт откладывается до конца задачи и выполняется один раз перед кадром.

**Что ломает чередование.** `getBoundingClientRect()` обязан вернуть актуальную геометрию. Если layout «грязный», браузер вынужден **синхронно** пересчитать его прямо в этот момент (Forced Synchronous Layout).

```text
итерация 1: read  → layout чистый, дёшево
            write → layout помечен грязным
итерация 2: read  → ПЕРЕСЧЁТ ВСЕГО LAYOUT (forced reflow)
            write → снова грязный
итерация 3: read  → ПЕРЕСЧЁТ ...
```

На 200 карточках получается до 200 полных пересчётов вместо одного. Отсюда 280 мс и падение до 9 fps.

**Решение: Read-Write Batching.** Сначала читаем всё, затем пишем всё. Перед записью layout остаётся чистым, и браузер пересчитывает его один раз.

```javascript
function alignCardHeights(cardsContainer, minHeight = 300) {
  const cards = Array.from(cardsContainer.querySelectorAll(".product-card"));

  // Фаза 1: только чтение (один пересчёт layout максимум)
  const heights = cards.map((card) => card.getBoundingClientRect().height);

  // Фаза 2: только запись (layout инвалидируется, но никто его не читает)
  requestAnimationFrame(() => {
    cards.forEach((card, i) => {
      if (heights[i] < minHeight) card.style.height = `${minHeight}px`;
    });
  });
}
```

Если по смыслу задачи («под самый высокий элемент») нужно выровнять по максимуму:

```javascript
function alignToTallest(cardsContainer) {
  const cards = Array.from(cardsContainer.querySelectorAll(".product-card"));
  const heights = cards.map((c) => c.getBoundingClientRect().height); // read
  const tallest = Math.max(0, ...heights);
  requestAnimationFrame(() => {
    cards.forEach((c) => (c.style.height = `${tallest}px`));          // write
  });
}
```

**Архитектурно правильнее:** вообще не считать высоту в JS. CSS Grid или Flexbox (`align-items: stretch`) выравнивает карточки без единого вызова JS, а `ResizeObserver` даёт размеры без форсированного reflow.

---

### Кейс 02. Long Tasks на массиве 100k элементов

**Почему Long Task блокирует ввод.** JavaScript выполняется в одном главном потоке по модели Event Loop: берётся одна задача (task) из очереди, выполняется **до конца** (run-to-completion), затем браузер может отрисовать кадр или обработать следующее событие. Клик по чекбоксу попадает в очередь как отдельная задача и ждёт, пока текущая завершится. Если `processAnalytics` занимает 1.4 с, обработчик клика и следующая отрисовка откладываются на те же 1.4 с. Порог «Long Task» равен 50 мс. Выше него интерфейс ощущается как зависший, и это напрямую бьёт по INP.

**Дополнительные проблемы кода:**

- цепочка `filter → map → reduce` создаёт два промежуточных массива на сотни тысяч объектов;
- `{...t}` копирует каждый объект, `new Date().toLocaleDateString()` вызывается 100k раз и очень дорог;
- итоговый результат использует только `totalRevenue` и `totalTax`. Поле `normalizedDate` вычисляется впустую.

**Шаг 1: убрать лишнюю работу (один проход, без аллокаций).**

```javascript
function aggregate(rawTransactions, { min }) {
  let totalRevenue = 0;
  let totalTax = 0;
  for (const t of rawTransactions) {
    if (t.amount > min && t.status === "completed") {
      totalRevenue += t.amount;
      totalTax += t.amount * 0.2;
    }
  }
  return { totalRevenue, totalTax };
}
```

**Вариант A: чанки с отдачей управления главному потоку.**

```javascript
const yieldToMain = () =>
  globalThis.scheduler?.yield
    ? scheduler.yield()                       // сохраняет приоритет продолжения
    : new Promise((resolve) => setTimeout(resolve, 0)); // fallback

async function processAnalyticsChunked(rawTransactions, { min }, { budgetMs = 40, signal } = {}) {
  const acc = { totalRevenue: 0, totalTax: 0 };
  let deadline = performance.now() + budgetMs;

  for (let i = 0; i < rawTransactions.length; i++) {
    const t = rawTransactions[i];
    if (t.amount > min && t.status === "completed") {
      acc.totalRevenue += t.amount;
      acc.totalTax += t.amount * 0.2;
    }

    // проверяем время раз в 1000 элементов, чтобы сам замер не стоил дорого
    if (i % 1000 === 0 && performance.now() >= deadline) {
      await yieldToMain();                    // браузер обработает ввод и отрисует кадр
      signal?.throwIfAborted();               // пользователь мог уйти со вкладки
      deadline = performance.now() + budgetMs;
    }
  }
  return acc;
}
```

**Вариант B: Web Worker (главный поток не занят совсем).**

```javascript
// analytics.worker.js
self.onmessage = ({ data: { transactions, min } }) => {
  let totalRevenue = 0, totalTax = 0;
  for (const t of transactions) {
    if (t.amount > min && t.status === "completed") {
      totalRevenue += t.amount;
      totalTax += t.amount * 0.2;
    }
  }
  self.postMessage({ totalRevenue, totalTax });
};
```

```javascript
// main thread
function processAnalyticsInWorker(transactions, filterCriteria) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analytics.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
    worker.onerror = (e) => { reject(e); worker.terminate(); };
    worker.postMessage({ transactions, min: filterCriteria.min });
  });
}
```

> **Уточнение.** `postMessage` копирует данные алгоритмом structured clone, и сама отправка 100k объектов тоже может стоить десятки миллисекунд. Лучше загружать данные внутри воркера (`fetch` доступен в Worker) или передавать числовые колонки в `Float64Array` через transferable-объекты (`postMessage(buf, [buf.buffer])`), тогда копирования нет.

**Что выбрать:** чанки подходят для умеренных объёмов и простого кода, Worker подходит для тяжёлых и повторяющихся расчётов.

---

### Кейс 03. Неконтролируемая конкурентность `Promise.all`

**Диагноз.** `fileList.map(...)` синхронно запускает 150 `fetch`. Браузер ставит их в очередь (в HTTP/1.1 около 6 соединений на хост; при HTTP/2 запросы мультиплексируются в одном соединении, но бэкенд всё равно получает пик). Ошибка у одного запроса мгновенно отклоняет `Promise.all`, а остальные запросы продолжают выполняться без контроля и без результата.

**Решение: пул воркеров с лимитом K.** K «рабочих» берут задачи из общей очереди, и как только один освобождается, он берёт следующую.

```javascript
/**
 * Запускает задачи с ограничением параллелизма.
 * @param {Array<() => Promise<any>>} taskFactories - функции, возвращающие промисы (НЕ сами промисы!)
 * @param {number} limit - максимум одновременных задач
 * @param {{signal?: AbortSignal, onProgress?: (done:number,total:number)=>void}} [opts]
 * @returns {Promise<Array<{status:"fulfilled",value:any}|{status:"rejected",reason:any}>>}
 *          результаты в исходном порядке
 */
async function asyncPool(taskFactories, limit = 4, { signal, onProgress } = {}) {
  if (!Array.isArray(taskFactories)) {
    throw new TypeError("taskFactories must be an array of functions");
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("limit must be a positive integer");
  }

  const results = new Array(taskFactories.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    // JS однопоточный: чтение и инкремент nextIndex между await неделимы
    while (nextIndex < taskFactories.length) {
      signal?.throwIfAborted();
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await taskFactories[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      onProgress?.(++completed, taskFactories.length);
    }
  }

  const workers = Array.from({ length: Math.min(limit, taskFactories.length) }, worker);
  await Promise.all(workers);
  return results;
}
```

**Применение к загрузчику файлов:**

```javascript
async function uploadAllFiles(fileList, { concurrency = 4, signal } = {}) {
  const tasks = Array.from(fileList, (file) => async () => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData, signal });
    if (!res.ok) throw new Error(`Upload failed: ${file.name} (${res.status})`);
    return res.json();
  });

  return asyncPool(tasks, concurrency, { signal });
}
```

**Проверка под нагрузкой:**

```javascript
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let active = 0, peak = 0;

const mockTasks = Array.from({ length: 12 }, (_, i) => async () => {
  peak = Math.max(peak, ++active);
  await sleep(200);
  active--;
  return `Result #${i + 1}`;
});

asyncPool(mockTasks, 3).then((res) => {
  console.log("Пик одновременных задач:", peak);               // 3
  console.log("Порядок сохранён:", res[0].value === "Result #1" && res[11].value === "Result #12");
});
```

**Ключевые моменты:**

- Принимаем **фабрики** `() => Promise`, а не готовые промисы: промис стартует в момент создания, поэтому лимитировать уже созданные промисы бессмысленно.
- Ошибки превращаются в `{status:"rejected"}` (по аналогии с `Promise.allSettled`), и одна упавшая загрузка не убивает остальные.
- Поправка к терминологии: запросы сверх лимита стоят в очереди **сетевого стека браузера**, а не «ОС».

---

## Блок 2. Утечки памяти и сборщик мусора V8

### Кейс 04. `Map` с DOM-узлами в ключах

**Mark-and-Sweep.** V8 определяет «живые» объекты по достижимости:

1. **Mark**: от корней (глобальный объект, стек вызовов, активные замыкания) обходится граф ссылок, и все достижимые объекты помечаются.
2. **Sweep**: память непомеченных объектов освобождается.

Объект живёт, пока существует хотя бы одна **сильная** цепочка ссылок от корня.

**Почему `Map` удерживает узел.** `nodeMetadataCache` лежит в глобальной области, то есть достижим из корня. `Map` хранит **сильные** ссылки на ключи. Удаление узла из DOM (`remove()`) убирает его из дерева документа, но не из `Map`, поэтому узел остаётся достижимым. Вместе с ним удерживается и всё его поддерево (дети, `parentNode`-связи отсоединённого фрагмента). Это и есть _Detached HTMLElement_ в Heap Snapshot.

**Решение: `WeakMap`.** Ключи в нём слабые: если на объект больше нет других ссылок, GC удалит и узел, и запись.

```javascript
const nodeMetadataCache = new WeakMap();

function attachComponentMetadata(domNode, metadata) {
  nodeMetadataCache.set(domNode, { ...metadata, attachedAt: Date.now() });
}

function getComponentMetadata(domNode) {
  return nodeMetadataCache.get(domNode);
}
```

Ограничения `WeakMap`: ключами могут быть только объекты (и незарегистрированные символы), нет `size`, нет итерации и `clear()`. Это следствие того, что содержимое может исчезнуть в любой момент GC. Если нужна итерация по живым записям, используют `Set<WeakRef>` вместе с `FinalizationRegistry` для чистки мёртвых ссылок.

---

### Кейс 05. Забытый `AbortSignal`

**Диагноз.** Флаг `isAlive` останавливает только **цикл**, но не уже запущенный `fetch` и не `setTimeout`. Запрос висит до таймаута, а его `.then`-цепочка удерживает `onStatusUpdate` и всё замкнутое окружение страницы.

**Решение.** Один `AbortController` отменяет и сетевой запрос, и ожидание между опросами.

```javascript
function pollServerStatus(onStatusUpdate, intervalMs = 5000) {
  const controller = new AbortController();
  const { signal } = controller;

  // Прерываемая пауза: при abort таймер снимается сразу
  const sleep = (ms) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const onAbort = () => { clearTimeout(id); resolve(); };
      const id = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  (async function loop() {
    while (!signal.aborted) {
      try {
        const res = await fetch("/api/health", { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!signal.aborted) onStatusUpdate(data); // не вызываем колбэк после отписки
      } catch (err) {
        if (err.name === "AbortError") break;      // штатная отмена
        console.error("Poll error", err);
      }
      await sleep(intervalMs);
    }
  })();

  return function unsubscribe() {
    controller.abort(); // обрывает fetch на транспортном уровне и снимает таймер
  };
}
```

Бонус: на каждый запрос можно добавить таймаут, `AbortSignal.any([signal, AbortSignal.timeout(10_000)])`, чтобы зависший запрос не блокировал цикл (ошибка тогда будет `TimeoutError`, а не `AbortError`).

---

### Кейс 06. Замыкание на тяжёлом контексте

**Как V8 строит `Context`.** Переменные внешней функции, на которые ссылаются внутренние замыкания, выносятся из стека в кучу, в объект `Context`. **Все** замыкания, созданные в одной области видимости, делят один и тот же `Context`. Поэтому, как только какое-то замыкание в этой области захватило тяжёлую переменную, она живёт, пока жив **любой** из этих обработчиков.

> **Уточнение.** В точном коде из задания V8 `hugeDataPayload` **не удерживает**: `handleIconClick` ссылается только на `iconId`, поэтому в `Context` попадает только `iconId`, а параметр остаётся на стеке и освобождается. Реальная утечка появляется, когда (а) в той же области есть второе замыкание, использующее `hugeDataPayload`, (б) используется `eval`/`with`, либо (в) дебаггер просматривает область. Ниже показан именно такой опасный сценарий. Защитный рефакторинг при этом полезен в любом случае.

**Опасный вариант (общий Context):**

```javascript
function setupHandlers(hugeDataPayload) {
  const iconId = hugeDataPayload.meta.iconId;

  const handleIconClick = () => console.log("Clicked icon:", iconId);
  const handleExport = () => download(hugeDataPayload); // захватил payload ⇒ он в общем Context

  return { handleIconClick, handleExport };
  // handleIconClick долгоживущий, но Context делится, поэтому 20 МБ удерживаются и им
}
```

**Безопасный рефакторинг.** Изолируем область видимости: в замыкание передаём только нужные примитивы.

```javascript
// 1. Извлекаем минимум данных в отдельной функции: тяжёлый объект туда не попадает вообще
function createIconClickHandler(iconId) {
  return function handleIconClick() {
    console.log("Clicked icon:", iconId);
  };
}

function setupIconClickHandler(hugeDataPayload) {
  const { iconId } = hugeDataPayload.meta;     // копируем примитив
  return createIconClickHandler(iconId);       // замыкание не видит payload
}
```

Если payload всё же нужен в той же функции для другого обработчика, разделяйте области (отдельные фабрики) или явно обнуляйте ссылку после использования (`let payload = ...; payload = null;`), либо держите тяжёлые данные в `WeakRef`.

---

### Кейс 07. Зомби-слушатель Event Bus

**Почему `bind` не работает для `off`.** `Function.prototype.bind` **каждый раз создаёт новую функцию-обёртку**. Поэтому:

```javascript
this.handleItemAdded.bind(this) === this.handleItemAdded.bind(this); // false
```

`eventBus.off(name, fn)` ищет обработчик сравнением по ссылке (`===`). В `destroy()` передаётся совсем другой объект, ничего не находится, и исходный обработчик остаётся в шине. Шина (долгоживущая) удерживает обработчик, обработчик удерживает `this`, то есть экземпляр `CartComponent`. Отсюда 10 «зомби» и 10 вызовов на одно событие.

**Паттерн 1: сохранить ссылку один раз.**

```javascript
class CartComponent {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.items = [];

    // Одна стабильная ссылка на весь жизненный цикл
    this.onItemAdded = this.handleItemAdded.bind(this);
    // или поле-стрелка: onItemAdded = (item) => this.items.push(item);

    this.eventBus.on("ITEM_ADDED", this.onItemAdded);
  }

  handleItemAdded(item) {
    this.items.push(item);
  }

  destroy() {
    this.eventBus.off("ITEM_ADDED", this.onItemAdded); // та же ссылка
    this.items = [];
  }
}
```

**Паттерн 2: `on()` возвращает функцию отписки.**

```javascript
class EventBus {
  #handlers = new Map();

  on(event, handler) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(handler);
    return () => this.off(event, handler);       // замыкание хранит нужную ссылку
  }

  off(event, handler) {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this.#handlers.get(event)?.forEach((h) => h(payload));
  }
}

class CartComponent {
  #unsubscribers = [];

  constructor(eventBus) {
    this.items = [];
    this.#unsubscribers.push(
      eventBus.on("ITEM_ADDED", (item) => this.items.push(item))
    );
  }

  destroy() {
    this.#unsubscribers.forEach((unsub) => unsub());
    this.#unsubscribers.length = 0;
  }
}
```

Третья возможность для браузерного `EventTarget`: `addEventListener(type, fn, { signal })`, и отписка одним `controller.abort()`.

---

## Блок 3. Асинхронные аварии и стейт

### Кейс 08. Stale Closure

**Уточнение.** Чистый JS-вариант (с `let secondsLeft` и `setInterval`) работает корректно: замыкание захватывает **изменяемую переменную**, и каждый тик видит актуальное значение. Проблема возникает именно в React.

**Механика в React.** Каждый рендер функционального компонента вызывает функцию заново, и в каждом вызове `secondsLeft` это **новая неизменяемая константа** (`const [secondsLeft] = useState(60)`). Колбэк интервала, созданный в эффекте первого рендера, замыкает константу этого рендера, равную `60`. Эффект с `[]` не пересоздаётся, поэтому интервал навсегда видит `60` и каждую секунду вызывает `setSecondsLeft(60 - 1)`. Результат: `59` без изменений.

**Решение 1: функциональный сеттер (предпочтительно).**

```jsx
import { useEffect, useState } from "react";

function OrderCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((prev) => {          // React сам подставит актуальное значение
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <p>{secondsLeft > 0 ? `Осталось: ${secondsLeft} сек` : "Время истекло!"}</p>;
}
```

**Решение 2: `useRef` как «живая» ссылка на последнее значение.**

```jsx
import { useEffect, useRef, useState } from "react";

function OrderCountdownRef() {
  const [secondsLeft, setSecondsLeft] = useState(60);
  const latest = useRef(secondsLeft);

  latest.current = secondsLeft;           // обновляется при каждом рендере

  useEffect(() => {
    const id = setInterval(() => {
      if (latest.current <= 1) {          // читаем из ref, а не из замыкания
        clearInterval(id);
        setSecondsLeft(0);
        return;
      }
      setSecondsLeft(latest.current - 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <p>{secondsLeft > 0 ? `Осталось: ${secondsLeft} сек` : "Время истекло!"}</p>;
}
```

`ref` это один и тот же изменяемый объект между рендерами, поэтому замыкание, созданное один раз, всегда читает свежее `.current`. Третий вариант: добавить `secondsLeft` в зависимости и пересоздавать `setTimeout` на каждый тик (простой, но чаще пересоздаёт таймер).

---

### Кейс 09. Silent Failure и Result Tuple

**Диагноз.** `catch` логирует ошибку и возвращает `undefined`. UI видит «falsy» и ничего не делает: ошибка не отличается от «ничего не произошло», спиннер снимается, сообщения нет.

**Паттерн Result Tuple `[error, data]`.**

```javascript
class PaymentError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "PaymentError";
    this.code = code;
  }
}

// Универсальная обёртка: превращает reject в кортеж
async function to(promise) {
  try {
    return [null, await promise];
  } catch (err) {
    return [err instanceof Error ? err : new Error(String(err)), null];
  }
}

async function processOrderPayment(paymentData) {
  const [tokenErr, token] = await to(generatePaymentToken(paymentData));
  if (tokenErr) {
    return [new PaymentError("TOKEN_FAILED", "Не удалось подготовить платёж", { cause: tokenErr }), null];
  }

  const [chargeErr, result] = await to(chargeCard(token));
  if (chargeErr) {
    return [new PaymentError("CHARGE_FAILED", "Банк отклонил операцию", { cause: chargeErr }), null];
  }

  return [null, result];
}
```

**Вызывающий код вынужден разобрать оба исхода:**

```javascript
async function onCheckoutClick() {
  setLoading(true);
  try {
    const [error, result] = await processOrderPayment(data);

    if (error) {
      logger.error(error);                         // для разработчиков
      showErrorToast(error.message);               // для пользователя
      return;
    }
    showSuccessModal(result);
  } finally {
    setLoading(false);                             // спиннер снимается в любом случае
  }
}
```

> **Уточнение.** В чистом JS кортеж лишь **подталкивает** к проверке: язык не заставит это сделать. Настоящая принудительность появляется в TypeScript с дискриминированным объединением:
>
> ```ts
> type Result<T, E = Error> = readonly [E, null] | readonly [null, T];
> // обращение к data без проверки error не пройдёт сужение типов
> ```

---

### Кейс 10. Promise Memoization

**Реальные дефекты кода:**

1. `while (isFetching)` с `setTimeout(50)` это активное ожидание (polling): лишние таймеры и задержка до 50 мс.
2. Если `fetch` или `json()` бросит исключение, `isFetching` **навсегда остаётся `true`**. Все ожидающие компоненты крутятся в бесконечном цикле. Это и есть тот самый «бесконечный опрос».
3. Ошибка никак не доходит до ожидающих вызовов.

**Уточнение.** Одновременный проскок нескольких запросов в этом коде невозможен: проверка и установка `isFetching` выполняются синхронно в однопоточном JS. Реальные проблемы это пункты 1–3.

**Решение: кэшируем сам Promise (in-flight deduplication).**

```javascript
let userPromise = null;

function getAuthenticatedUser() {
  if (!userPromise) {
    userPromise = fetch("/api/me")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        userPromise = null;   // не кэшируем провал: следующая попытка пойдёт заново
        throw err;            // а ожидающие получат ошибку
      });
  }
  return userPromise;         // все 5 компонентов получают ОДИН промис
}

// При выходе из аккаунта или смене пользователя
function invalidateAuthenticatedUser() {
  userPromise = null;
}
```

Почему это работает: первый вызов создаёт промис и сохраняет его синхронно, до первого `await`, поэтому второй вызов уже видит его. Любое число потребителей делает `await` на один и тот же объект. Нет флагов, нет опроса, нет рассинхронизации состояния. Обобщённая версия:

```javascript
function memoizeAsync(fn) {
  const inFlight = new Map();
  return (key = "default") => {
    if (!inFlight.has(key)) {
      const p = fn(key).catch((err) => { inFlight.delete(key); throw err; });
      inFlight.set(key, p);
    }
    return inFlight.get(key);
  };
}
```

---

### Кейс 11. Retry с Exponential Backoff и Jitter

**Диагноз.** Рекурсивный `catch → повтор` не имеет ни паузы, ни лимита, ни различения типов ошибок: запросы летят непрерывно, пока не отвалится сеть.

> **Уточнение.** Заголовок кейса упоминает Stack Overflow, но `async`-рекурсия через `await` стек не переполняет: каждое продолжение выполняется после микрозадачи. Реальная проблема это бесконечный цикл запросов и растущая цепочка промисов, а также нагрузка на CPU и сервер (эффект «thundering herd»).

**Формула.** Полный jitter: `delay = random(0, min(maxDelay, base * 2^attempt))`. Экспонента разводит повторы во времени, случайность не даёт тысячам клиентов ударить сервер синхронно.

```javascript
class HttpError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    // повторять имеет смысл только временные сбои
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      reject(signal.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithRetry(
  url,
  { maxRetries = 5, baseDelayMs = 500, maxDelayMs = 30_000, signal, fetchOptions } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { ...fetchOptions, signal });
      if (!response.ok) throw new HttpError(response.status);
      return await response.json();
    } catch (err) {
      const isAbort = err.name === "AbortError";
      const nonRetryable = err instanceof HttpError && !err.retryable; // 400, 401, 404...

      if (isAbort || nonRetryable || attempt >= maxRetries) {
        throw attempt >= maxRetries && !isAbort && !nonRetryable
          ? new Error(`Запрос не удался после ${maxRetries + 1} попыток`, { cause: err })
          : err;
      }

      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = Math.random() * cap;            // full jitter
      await sleep(delay, signal);                   // отмена прерывает ожидание
    }
  }
}
```

Что здесь важно: лимит `maxRetries`, потолок задержки `maxDelayMs`, jitter, отсутствие повторов для 4xx (кроме 408/425/429), поддержка отмены через `AbortSignal`. При ответе `429` или `503` можно дополнительно учитывать заголовок `Retry-After`.

---

## Блок 4. Иммутабельность, нормализация и структуры данных

### Кейс 12. `JSON.parse(JSON.stringify())` как deep clone

**Ограничения JSON-сериализации:**

| Значение | Что происходит |
|---|---|
| `Date` | становится строкой (ISO), обратно не восстанавливается |
| `RegExp`, `Map`, `Set`, `Error` | превращаются в `{}` |
| функции, `Symbol`, `undefined` как значение свойства | свойство пропадает (в массивах становится `null`) |
| `NaN`, `Infinity` | становятся `null` |
| `BigInt` | `TypeError` |
| циклические ссылки | `TypeError` |
| прототипы классов | теряются, получается обычный объект |

**`structuredClone()`.** Нативный алгоритм structured clone корректно копирует `Date`, `RegExp`, `Map`, `Set`, `BigInt`, типизированные массивы, `undefined`-значения и циклические ссылки.

```javascript
const state = {
  activeDate: new Date(),
  pattern: /^[a-z]+$/i,
  balance: 1000n,
  history: undefined,
  tags: new Set(["a", "b"]),
};

const cloned = structuredClone(state);
cloned.activeDate instanceof Date;   // true
cloned.pattern instanceof RegExp;    // true
cloned.balance === 1000n;            // true
"history" in cloned;                 // true
```

Что `structuredClone` **не** умеет: функции (бросает `DataCloneError`), DOM-узлы, прототипы и методы классов (экземпляр превращается в простой объект), геттеры и сеттеры (вычисляется значение).

**Когда что применять:**

- `structuredClone`: разовое глубокое копирование **данных** (снимок формы, передача в Worker, undo-буфер), когда в объекте нет функций и экземпляров классов.
- **Структурный Spread (обновление по пути)** в редьюсерах и React-стейте: копируются только узлы вдоль изменяемого пути, остальные ссылки сохраняются.

```javascript
function reducer(state, action) {
  switch (action.type) {
    case "UPDATE_BALANCE":
      return { ...state, balance: action.balance };           // остальные поля сохраняют ссылки
    case "ADD_HISTORY":
      return { ...state, history: [...(state.history ?? []), action.entry] };
    default:
      return state;
  }
}
```

Глубокий клон всего состояния на каждое действие ломает сравнение по ссылке: **каждый** `React.memo`, селектор и `useEffect`-зависимость увидят «новые» данные и перерисуются. Для глубоких деревьев используют Immer (`produce`), он даёт удобную запись с сохранением структурного разделения.

---

### Кейс 13. `React.memo` и новые литералы

**Как работает `shallowEqual`.** `React.memo` сравнивает пропсы предыдущего и нового рендера по ключам, каждое значение через `Object.is` (то есть **по ссылке** для объектов и функций). `{padding:"8px"} !== {padding:"8px"}`, потому что это два разных объекта в куче. Каждый рендер `Table` создаёт новые `style`, `options` и `onDelete` для каждой из 500 строк. По `shallowEqual` пропсы всегда «изменились», и `memo` перерисовывает все строки, платя при этом ещё и за сравнение.

**Решение.** Стабильные ссылки: константы выносятся за компонент, обработчик стабилизируется `useCallback` и получает `id` аргументом.

```jsx
import { memo, useCallback } from "react";

// Константы создаются один раз за жизнь модуля
const ROW_STYLE = Object.freeze({ padding: "8px", borderBottom: "1px solid #eee" });
const ROW_OPTIONS = Object.freeze({ canSelect: true, canEdit: false });

const TableRow = memo(function TableRow({ data, style, options, onDelete }) {
  return (
    <div style={style}>
      {data.name}
      {options.canSelect && <input type="checkbox" />}
      <button onClick={() => onDelete(data.id)}>Удалить</button>
    </div>
  );
});

function Table({ rows, onDeleteRow }) {
  // Одна стабильная функция на все строки; id передаётся внутри строки
  const handleDelete = useCallback((id) => onDeleteRow(id), [onDeleteRow]);

  return (
    <div>
      {rows.map((row) => (
        <TableRow
          key={row.id}
          data={row}
          style={ROW_STYLE}
          options={ROW_OPTIONS}
          onDelete={handleDelete}
        />
      ))}
    </div>
  );
}
```

Условия, чтобы оптимизация сработала целиком:

- родитель должен иметь **стабильный** `onDeleteRow` (в нём тоже `useCallback`);
- изменение строки выполняется иммутабельно, и у остальных `row` ссылка не меняется;
- `key` берётся из `id`, а не из индекса.

React Compiler может автоматически мемоизировать такие литералы, но понимать механику всё равно нужно.

---

### Кейс 14. Дубликаты при пагинации

**Диагноз.** Spread просто склеивает массивы. При пагинации `limit/offset` вставка новой записи сдвигает всё, и последняя запись прошлой страницы приходит снова. Дубликаты `id` дают предупреждение о повторяющихся `key`.

**Решение: слияние с дедупликацией за O(N) через `Set`.**

```javascript
function mergeUniqueById(existing, incoming) {
  const seen = new Set(existing.map((post) => post.id)); // O(N)
  const fresh = [];

  for (const post of incoming) {                          // O(M)
    if (!seen.has(post.id)) {                             // O(1)
      seen.add(post.id);                                  // дедупликация внутри самой страницы тоже
      fresh.push(post);
    }
  }

  // Ничего нового: возвращаем ту же ссылку, и React не будет перерисовывать список
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

function appendNextPage(state, newPostsFromApi) {
  return { ...state, posts: mergeUniqueById(state.posts, newPostsFromApi) };
}
```

Общая сложность O(N + M), без вложенных `find`/`includes` с их O(N·M).

Если при конфликте нужна **более свежая версия** записи (например, обновились лайки), используйте `Map` вместо `Set`: `new Map(existing.map(p => [p.id, p]))`, затем `map.set(p.id, p)` для входящих. Порядок вставки в `Map` сохраняется, и итоговый массив получается из `[...map.values()]`.

Корневое решение на стороне API: cursor-пагинация (`?after=<lastId>`) вместо `offset`, она устойчива к вставкам.

---

### Кейс 15. Default-значения и `null`

**Спецификация ECMAScript.** Значение по умолчанию в деструктуризации и параметрах подставляется **только** когда значение строго `=== undefined` (свойство отсутствует или явно `undefined`). `null`, `0`, `""`, `false`, `NaN` это полноценные значения, и default для них не срабатывает. Поэтому `color: null` остаётся `null` и попадает в шаблон как `"null"`.

То же касается параметра: `function f({a = 1} = {})`. Default `= {}` защищает от `undefined`, но `f(null)` всё равно упадёт.

**Отказоустойчивая нормализация через `??`.** Оператор `??` подставляет правую часть для `null` **и** `undefined`:

```javascript
const BADGE_DEFAULTS = Object.freeze({
  color: "blue",
  text: "Новинка",
  icon: "star",
});

function normalizeBadgeConfig(row) {
  const src = row ?? {};                       // защита от null / undefined на входе
  return {
    color: src.color ?? BADGE_DEFAULTS.color,
    text: src.text ?? BADGE_DEFAULTS.text,
    icon: src.icon ?? BADGE_DEFAULTS.icon,
  };
}

function renderBadgeConfig(row) {
  const { color, text, icon } = normalizeBadgeConfig(row);
  return `<span class="badge ${color}">${icon} ${text}</span>`;
}

renderBadgeConfig({ color: null, text: null, icon: null });
// <span class="badge blue">star Новинка</span>
```

**Универсальный вариант для любых таблиц:**

```javascript
function withDefaults(row, defaults) {
  const src = row ?? {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, src[key] ?? fallback]),
  );
}

const badge = withDefaults(dbRow, BADGE_DEFAULTS);
```

Нюанс выбора оператора: `??` оставляет `""`, `0`, `false` (это валидные значения), а `||` заменяет **любое** falsy-значение. Если пустую строку из БД тоже нужно считать «нет значения», проверяйте явно: `src.text?.trim() || BADGE_DEFAULTS.text`. Лучше всего нормализовать данные один раз на границе (слой доступа к API или БД), чтобы UI получал уже чистые объекты.

> Если значения вставляются в HTML-строку, их нужно экранировать (или использовать `textContent` и шаблоны фреймворка), иначе данные из БД открывают путь для XSS.

---

## Итоговая таблица

| Кейс | Корень проблемы | Ключевое решение |
|---|---|---|
| 01 | чередование read/write геометрии, forced reflow | пакетирование: сначала все чтения, потом все записи; CSS Grid |
| 02 | Long Task блокирует Event Loop, INP 1400 мс | один проход + `scheduler.yield`/чанки или Web Worker |
| 03 | `Promise.all` запускает 150 запросов разом | пул воркеров с лимитом K |
| 04 | `Map` сильно держит DOM-узлы | `WeakMap` |
| 05 | `fetch` и таймер не отменяются флагом | `AbortController` для fetch и паузы |
| 06 | общий `Context` замыканий удерживает тяжёлые данные | передавать в замыкание только примитивы, изолировать scope |
| 07 | `bind` создаёт новую функцию, `off` не находит её | сохранить ссылку / `on()` возвращает unsubscribe |
| 08 | устаревшее замыкание от первого рендера | `setState(prev => …)` или `useRef` |
| 09 | `catch` возвращает `undefined` | Result Tuple `[error, data]` |
| 10 | флаг + polling, ошибка вешает ожидающих | кэшировать in-flight `Promise` |
| 11 | повторы без паузы и лимита | exponential backoff + jitter + `maxRetries` |
| 12 | JSON теряет Date, RegExp, BigInt, функции | `structuredClone` / структурный spread |
| 13 | новые литералы ломают `shallowEqual` | константы вне компонента, `useCallback` |
| 14 | spread не дедуплицирует | `Set` по `id`, O(N) |
| 15 | default срабатывает только на `undefined` | `??` и нормализация на границе |