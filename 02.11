# Практическая работа: разбор 20 кейсов по JavaScript, SPA и сборке

Разбор 20 production-багов: причина, объяснение механики и исправленный код.

## Содержание

- [Блок 1. SPA и роутинг](#блок-1-spa-и-роутинг)
  - [Кейс 01. Зацикливание истории](#кейс-01-зацикливание-истории-браузера)
  - [Кейс 02. Утечка памяти из-за resize-слушателя](#кейс-02-утечка-памяти-из-за-resize-слушателя)
  - [Кейс 03. Hard reload вместо SPA-перехода](#кейс-03-hard-reload-вместо-spa-перехода)
- [Блок 2. Окружение и бандлинг](#блок-2-окружение-и-бандлинг)
  - [Кейс 04. Неверная классификация зависимостей](#кейс-04-неверная-классификация-зависимостей)
  - [Кейс 05. Недетерминизм из-за npm install](#кейс-05-недетерминизм-из-за-npm-install)
  - [Кейс 06. Node.js-модули в клиентском коде](#кейс-06-nodejs-модули-в-клиентском-коде)
- [Блок 3. Память, ссылки, мутации](#блок-3-память-ссылки-мутации)
  - [Кейс 07](#кейс-07-мутация-через-общую-ссылку) · [Кейс 08](#кейс-08-shallow-copy-и-вложенные-структуры) · [Кейс 09](#кейс-09-замыкание-var-в-цикле) · [Кейс 10](#кейс-10-потеря-this)
- [Блок 4. Методы массивов](#блок-4-методы-массивов)
  - [Кейс 11](#кейс-11-мутирующий-sort) · [Кейс 12](#кейс-12-foreach-вместо-map) · [Кейс 13](#кейс-13-find-и-falsy-значение-0) · [Кейс 14](#кейс-14-reduce-без-initialvalue)
- [Блок 5. Деструктуризация, Rest, computed properties](#блок-5-деструктуризация-rest-computed-properties)
  - [Кейс 15](#кейс-15-динамический-ключ-формы) · [Кейс 16](#кейс-16-деструктуризация-null) · [Кейс 17](#кейс-17-порядок-spread)
- [Блок 6. Асинхронный JS](#блок-6-асинхронный-js)
  - [Кейс 18](#кейс-18-проглоченная-ошибка-в-new-promise) · [Кейс 19](#кейс-19-race-condition-в-автокомплите) · [Кейс 20](#кейс-20-fail-fast-в-promiseall)
- [Итоговая таблица](#итоговая-таблица)

---

## Блок 1. SPA и роутинг

### Кейс 01. Зацикливание истории браузера

**Причина.** `pushState` добавляет новую запись в стек истории, а `replaceState` заменяет текущую запись, не меняя длину стека.

Что происходит в кейсе:

1. Пользователь заходит на `/cart`, стек: `[/cart]`.
2. Код делает `pushState('/login')`, стек: `[/cart, /login]`.
3. Нажатие «Назад» возвращает на `/cart`, роутер снова видит, что пользователь не авторизован, и снова делает push. Получается петля.

**Исправление:**

```js
function checkAuthAndNavigate(isAuthenticated, currentPath) {
  if (!isAuthenticated && currentPath !== "/login") {
    window.history.replaceState({}, "", "/login"); // подменяем запись, а не добавляем
    renderLoginPage();
  }
}
```

Приватный URL больше не остаётся в истории, и «Назад» уходит на предыдущую страницу.

---

### Кейс 02. Утечка памяти из-за resize-слушателя

**Причина.** Анонимная стрелочная функция замыкает `header` и регистрируется на `window`, который живёт всё время жизни вкладки. Каждый `mountHeader()` добавляет новый слушатель, и старые никогда не удаляются. Они удерживают в памяти отсоединённые DOM-узлы старых шапок, а при каждом `resize` выполняются все накопленные обработчики.

**Исправление:**

```js
function mountHeader() {
  const header = document.getElementById("header");

  const onResize = () => {
    header.className = window.innerWidth < 768 ? "header-mobile" : "header-desktop";
  };

  window.addEventListener("resize", onResize);
  onResize(); // начальное состояние

  return function unmountHeader() {
    window.removeEventListener("resize", onResize); // ссылка на ту же функцию
  };
}

const unmount = mountHeader();
// при уходе со страницы:
unmount();
```

`removeEventListener` работает только с той же ссылкой на функцию, поэтому обработчик вынесен в именованную переменную. В React это `return () => window.removeEventListener(...)` внутри `useEffect`.

---

### Кейс 03. Hard reload вместо SPA-перехода

**Причина.** По клику на `<a href>` браузер выполняет действие по умолчанию, то есть полную навигацию на `/cart` с запросом нового документа. Отменить его можно только через `event.preventDefault()`. Кроме того, inline-атрибут `onclick="router.navigate(...)"` исполняется в глобальной области видимости. Параметр `router` функции `ProductCard` там не виден, поэтому возникает `ReferenceError`. Обработчик падает до отмены действия, и браузер всё равно перезагружает страницу.

**Исправление** (делегирование событий, без inline-JS):

```js
function ProductCard({ product }) {
  return `
    <div class="card">
      <h3>${product.title}</h3>
      <a href="/cart" data-link>В корзину</a>
    </div>`;
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link) return;
  // даём браузеру открыть ссылку в новой вкладке при Ctrl/Cmd/Shift/средней кнопке
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault(); // отменяем hard navigation
  router.navigate(link.getAttribute("href"));
});
```

Атрибут `href` сохраняется для SEO, доступности и открытия в новой вкладке.

---

## Блок 2. Окружение и бандлинг

### Кейс 04. Неверная классификация зависимостей

**Ошибка.** `vite` это инструмент сборки, ему место в `devDependencies`. `react` и `react-dom` нужны приложению в рантайме, их место в `dependencies`. То же относится к `date-fns`, который импортируется в код. На CI часто стоит `NODE_ENV=production` или `npm ci --omit=dev`. Тогда `vite` не устанавливается и сборка падает, а при другой конфигурации в образ попадает лишнее.

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "date-fns": "^3.6.0"
  },
  "devDependencies": {
    "vite": "^5.4.0"
  }
}
```

> Для Vite-SPA, где всё бандлится в статику, формально сборка пройдёт и с любой раскладкой, пока установлены все пакеты. Раскладку делают по стандарту: рантайм-код в `dependencies`, инструменты сборки и тестов в `devDependencies`. Для библиотек и SSR-серверов это уже критично.

---

### Кейс 05. Недетерминизм из-за `npm install`

**Причина.** Оператор `^3.6.0` разрешает любые версии `>=3.6.0 <4.0.0`. `npm install` может подтянуть более свежие минорные и патч-версии, если они вышли с момента последнего запуска, и даже перезаписать lock-файл. В пятницу ставилась одна версия, в понедельник вышла новая с регрессией или breaking change, и сборка упала без единого коммита.

**Решение:** использовать на сервере `npm ci`.

```bash
git pull origin main
npm ci          # ставит строго версии из package-lock.json
npm run build
```

`npm ci` удаляет `node_modules`, устанавливает ровно то, что записано в `package-lock.json`, и падает, если lock не совпадает с `package.json`. Lock-файл при этом должен быть закоммичен. Не нужно добавлять `--omit=dev`, если сборка выполняется на том же сервере, ведь `vite` лежит в devDependencies.

---

### Кейс 06. Node.js-модули в клиентском коде

**Фундаментальное различие:**

- **Node.js runtime** имеет доступ к файловой системе, процессам и сети ОС (`fs`, `path`, `child_process`).
- **Browser sandbox** изолирован. У него нет доступа к локальным файлам, а код `Footer.jsx` исполняется у пользователя, где никакого `package.json` проекта нет. Поэтому Vite подменяет `fs` пустой заглушкой.

Чтение файла нужно делать на этапе сборки (в Node) и встраивать результат в бандл как константу.

```js
// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8")
);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
```

```jsx
// src/components/Footer.jsx
export function Footer() {
  return <footer>Версия: {__APP_VERSION__}</footer>;
}
```

Нужно использовать `JSON.stringify`, потому что `define` делает текстовую подстановку. Для TypeScript добавляют `declare const __APP_VERSION__: string;`.

---

## Блок 3. Память, ссылки, мутации

### Кейс 07. Мутация через общую ссылку

**Причина.** Объекты лежат в куче (Heap), а переменные и элементы массивов хранят ссылки на них. `filter` создаёт новый массив, но кладёт в него те же ссылки на объекты. Поэтому `user.loginAttempts = 0` изменяет объект, на который смотрит и исходный `usersList`.

**Чистая функция:**

```js
function resetAttemptsForActiveUsers(usersList) {
  return usersList
    .filter((user) => user.isActive)
    .map((user) => ({ ...user, loginAttempts: 0 })); // новые объекты
}
```

Исходный массив и его объекты остаются нетронутыми.

---

### Кейс 08. Shallow copy и вложенные структуры

**Физика.** Spread (`{...obj}`) и `Object.assign` копируют только свойства верхнего уровня. Значения-объекты копируются как ссылки, поэтому `userCopy.security` и `userProfile.security` указывают на один и тот же объект, и `roles` тоже общий.

**Вариант 1: глубокое клонирование.**

```js
const userCopy = structuredClone(userProfile);
userCopy.security.roles.push("superadmin"); // оригинал не затронут
```

`structuredClone` не копирует функции, а для Date, Map и Set работает корректно.

**Вариант 2: иммутабельное обновление пути.**

```js
const userCopy = {
  ...userProfile,
  security: {
    ...userProfile.security,
    roles: [...userProfile.security.roles, "superadmin"],
  },
};
```

Копируется каждый уровень вдоль изменяемого пути, остальное переиспользуется. Именно так нужно обновлять состояние в React.

---

### Кейс 09. Замыкание `var` в цикле

**Объяснение.** `var` имеет функциональную область видимости, поэтому на весь цикл существует одна переменная `i`. Все колбэки замыкают одну и ту же переменную, а читают её после окончания цикла, когда `i === 6`. `let` создаёт новую привязку на каждую итерацию.

**Способ 1: `let`.**

```js
for (let i = 1; i <= pagesCount; i++) {
  buttons.push(() => console.log(`Переход на страницу: ${i}`));
}
```

**Способ 2: фабрика или IIFE, фиксирующие значение в своём лексическом окружении.**

```js
for (var i = 1; i <= pagesCount; i++) {
  buttons.push(((page) => () => console.log(`Переход на страницу: ${page}`))(i));
}
```

Есть и третий вариант: `Array.from({ length: pagesCount }, (_, k) => () => console.log(k + 1))`.

---

### Кейс 10. Потеря `this`

**Объяснение.** `this` определяется в момент вызова, а не объявления. `addEventListener` получает просто функцию и вызывает её с `this = элемент` (кнопка). У кнопки нет свойства `prefix`, поэтому выводится `undefined`. Вместо `eventName` приходит объект `MouseEvent`.

**Вариант 1: `bind`.**

```js
btn.addEventListener(
  "click",
  analyticsTracker.sendEvent.bind(analyticsTracker, "checkout_click")
);
```

**Вариант 2: стрелочная обёртка** (вызов через точку сохраняется).

```js
btn.addEventListener("click", () => analyticsTracker.sendEvent("checkout_click"));
```

**Вариант 3: привязка внутри самого объекта.**

```js
const analyticsTracker = {
  prefix: "ANALYTICS_EVENT",
  sendEvent: null,
};
analyticsTracker.sendEvent = function (eventName) {
  console.log(`[${this.prefix}]: ${eventName}`);
}.bind(analyticsTracker);
```

То же можно сделать через класс с полем `sendEvent = (name) => {...}`, где `this` захватывается лексически. Тогда метод можно передавать как колбэк без обёрток.

---

## Блок 4. Методы массивов

### Кейс 11. Мутирующий `.sort()`

**Мутируют in-place:** `sort`, `reverse`, `splice`, `push`, `pop`, `shift`, `unshift`, `fill`, `copyWithin`.

**Чистые (возвращают новое):** `map`, `filter`, `slice`, `concat`, `flat`, `flatMap`, `reduce`, `toSorted`, `toReversed`, `toSpliced`, `with`.

```js
function getTopExpensiveProducts(products) {
  return [...products].sort((a, b) => b.price - a.price).slice(0, 3);
  // или: products.toSorted((a, b) => b.price - a.price).slice(0, 3);
}
```

В React мутация пропса или состояния нарушает иммутабельность. Это приводит к «спонтанным» перестановкам в других компонентах и к пропущенным ререндерам.

---

### Кейс 12. `forEach` вместо `map`

```js
const mapIdsToTasks = (ids) => ids.map((id) => ({ taskId: id, isDone: false }));
```

**Почему в React предпочтителен функциональный стиль:**

- `map` это выражение, оно возвращает новое значение и не требует внешней изменяемой переменной.
- Нет побочных эффектов и ручной индексации, меньше ошибок.
- Рендер компонента должен быть чистой функцией от props и state, а `array.map(...)` напрямую возвращает JSX-список.
- Чистые преобразования легче тестировать и предсказуемее для оптимизаций React (мемоизация, сравнение по ссылке).

---

### Кейс 13. `find` и falsy-значение `0`

**Ловушка.** `find` возвращает сам найденный элемент, а им оказался `0`. Условие `!0` равно `true`, поэтому ветка «не найден» срабатывает, хотя элемент найден. Об отсутствии `find` сигнализирует только `undefined`.

```js
const exitCodes = [0, 5, 8, 12];

// Вариант 1: проверка на undefined
const targetCode = exitCodes.find((code) => code === 0);
if (targetCode === undefined) {
  console.log("Код 0 не найден в списке!");
} else {
  console.log("Код успешно найден:", targetCode);
}

// Вариант 2: если нужен только факт наличия
if (exitCodes.some((code) => code === 0)) { /* найден */ }
// или: exitCodes.includes(0)

// Вариант 3: findIndex
if (exitCodes.findIndex((c) => c === 0) !== -1) { /* найден */ }
```

---

### Кейс 14. `reduce` без `initialValue`

**Механика.** Если `initialValue` не передан, аккумулятор берёт первый элемент массива, а итерация начинается со второго. Здесь `acc` это объект `{id: 1, ...}`, и `acc + item.price` превращается в строку `"[object Object]1000"`. На пустом массиве такой вызов вообще бросает `TypeError`.

```js
const totalCost = cartItems.reduce((acc, item) => acc + item.price, 0); // 3000
```

---

## Блок 5. Деструктуризация, Rest, computed properties

### Кейс 15. Динамический ключ формы

**Объяснение.** В литерале `{ fieldName: value }` ключ статический, то есть строка `"fieldName"`. Чтобы использовать значение переменной как ключ, нужны вычисляемые имена свойств (Computed Property Names) в квадратных скобках.

```js
function onFieldChange(fieldName, value) {
  formState = { ...formState, [fieldName]: value };
}
```

---

### Кейс 16. Деструктуризация `null`

**Причина.** Значение по умолчанию подставляется только для `undefined`. Здесь же само `serverData` равно `null`, и деструктурировать `null` нельзя, это `TypeError`. Кроме того, `stats: null` тоже не активирует default.

```js
function renderUserStats(serverData) {
  const stats = serverData?.stats ?? { views: 0, likes: 0 };
  return `Просмотры: ${stats.views}`;
}
```

Если нужна именно деструктуризация: `const { stats } = serverData ?? {};`, а после неё `stats ?? defaults`. Оператор `??` срабатывает для `null` и `undefined`, а `||` ещё и для `0` и `""`.

---

### Кейс 17. Порядок spread

**Правило (Key Overriding).** При дублировании ключей побеждает последний (`{...a, x: 1}`: `x: 1` перезаписывает `a.x`). В коде `type: "text"` стоит после `...props`, поэтому затирает внешний `type: "password"`.

```js
function TextInput({ className, ...props }) {
  return {
    type: "text", // дефолт
    ...props,     // внешние props переопределяют дефолт
    className: ["form-input", className].filter(Boolean).join(" "), // объединяем
  };
}

TextInput({ type: "password", id: "pass", className: "wide" });
// { type: "password", id: "pass", className: "form-input wide" }
```

---

## Блок 6. Асинхронный JS

### Кейс 18. «Проглоченная» ошибка в `new Promise`

**Причина.** Конструктор `new Promise` оборачивает в try/catch только синхронное выполнение executor. Колбэк `script.onload` вызывается позже, из очереди событий браузера, с другим стеком вызовов. Исключение в нём уходит в глобальный `window.onerror` и не попадает в `reject`, поэтому промис остаётся в `pending`.

```js
function loadCustomScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;

    script.onload = () => {
      try {
        const data = JSON.parse("НЕВАЛИДНЫЙ_JSON");
        resolve(data);
      } catch (err) {
        reject(err); // ошибка парсинга уходит в .catch()
      }
    };
    script.onerror = () => reject(new Error(`Не удалось загрузить скрипт: ${src}`));

    document.head.appendChild(script);
  });
}
```

`script.onerror` обрабатывает вторую причину зависания, сетевой сбой загрузки.

---

### Кейс 19. Race condition в автокомплите

**Природа.** Сетевые ответы возвращаются не в порядке отправки запросов (нет гарантии FIFO). Состояние (`currentSearchResult`) записывается тем ответом, который пришёл последним, а не тем, что соответствует последнему вводу. Результат зависит от задержек сети, то есть от «гонки».

```text
t=0     Запрос 1 ("rea")    ──(задержка 1200 мс)──────────────► Ответ 1 (t=1200)  ← приходит ПОЗЖЕ и затирает экран
t=200   Запрос 2 ("react")  ──(задержка 200 мс)──► Ответ 2 (t=400)
```

**Решение с `AbortController`:**

```js
function createSearchService() {
  let activeController = null;

  return async function search(query) {
    activeController?.abort(); // отменяем устаревший запрос
    const controller = new AbortController();
    activeController = controller;

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === "AbortError") return null; // штатная отмена, не ошибка
      throw err;
    } finally {
      if (activeController === controller) activeController = null;
    }
  };
}

const search = createSearchService();

async function onSearchInput(query) {
  const results = await search(query);
  if (results === null) return; // запрос отменён, экран не трогаем
  renderDropdown(results);
}
```

В `finally` сравнение с `controller` нужно, чтобы поздно завершившийся старый запрос не сбросил ссылку на новый.

**React-версия** (cleanup-функция в `useEffect`):

```jsx
import { useState, useEffect } from "react";

function UserSearchDropdown() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function executeSearch() {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/users?search=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Search failed");
        setResults(await res.json());
      } catch (err) {
        if (err.name !== "AbortError") console.error("Ошибка поиска:", err);
      } finally {
        // выключаем индикатор только если запрос не был прерван
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    executeSearch();

    // Cleanup: срабатывает при каждом новом вводе и при размонтировании
    return () => controller.abort();
  }, [query]);

  return (
    <div className="search-container">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск пользователей..."
      />
      {isLoading && <span className="spinner">Загрузка...</span>}
      <ul className="results-list">
        {results.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

Дополнительно рекомендуется debounce (200–300 мс), чтобы запрос не уходил на каждый символ.

---

### Кейс 20. Fail-fast в `Promise.all`

**Поведение.** `Promise.all` отклоняется сразу, как только отклоняется любой из промисов (fail-fast), и остальные результаты теряются. Падение рекламного сервиса поэтому «роняет» и критичные данные.

```js
async function loadFullProfilePage(userId) {
  const [userRes, balanceRes, promoRes] = await Promise.allSettled([
    fetchUserData(userId),
    fetchUserBalance(userId),
    fetchPromoBanner(),
  ]);

  // Критичные данные: без них страница не имеет смысла
  if (userRes.status === "rejected") throw userRes.reason;
  if (balanceRes.status === "rejected") throw balanceRes.reason;

  // Второстепенный виджет: при сбое просто не показываем
  const promo = promoRes.status === "fulfilled" ? promoRes.value : null;
  if (promoRes.status === "rejected") {
    console.warn("Промо-баннер недоступен:", promoRes.reason);
  }

  renderProfile({ user: userRes.value, balance: balanceRes.value, promo });
}
```

`Promise.allSettled` ждёт завершения всех промисов и возвращает массив `{ status, value | reason }`. Решение о том, какие ошибки фатальны, принимается явно в коде. Другой вариант: оставить `Promise.all` и добавить `.catch(() => null)` только к `fetchPromoBanner()`.

---

## Итоговая таблица

| Кейс | Корень проблемы | Ключевое исправление |
|---|---|---|
| 1 | `pushState` засоряет стек | `replaceState` |
| 2 | слушатель не снимается | `removeEventListener` в unmount |
| 3 | не отменено действие ссылки | `preventDefault` |
| 4 | неверные группы зависимостей | runtime в `dependencies`, `vite` в `devDependencies` |
| 5 | `^` + `npm install` | `npm ci` + lock-файл |
| 6 | нет `fs` в браузере | `define` в `vite.config.js` |
| 7–8 | общие ссылки в куче | `map` + spread, `structuredClone` |
| 9 | одна `var` на весь цикл | `let` / фабрика |
| 10 | потеря `this` | `bind` / обёртка / поле-стрелка |
| 11 | мутирующий `sort` | `toSorted` / копия |
| 12 | императив вместо `map` | `ids.map(...)` |
| 13 | falsy `0` | `=== undefined` / `some` |
| 14 | нет `initialValue` | `reduce(..., 0)` |
| 15 | статический ключ | `[fieldName]` |
| 16 | default не работает для `null` | `?.` и `??` |
| 17 | порядок spread | дефолты до `...props` |
| 18 | ошибка в async-колбэке | `try/catch` + `reject`, `onerror` |
| 19 | race condition | `AbortController` |
| 20 | fail-fast | `Promise.allSettled` |
