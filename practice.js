console.log('✅ Node.js готов к выполнению React-паттернов!\n');

/* =========================================================
   02. Стрелочные функции и неявный возврат объектов
   ========================================================= */
console.log('=== 02. Стрелочные функции и неявный возврат ===');

// 1. Стрелочная функция с неявным возвратом форматированной строки:
const formatCurrency = (amount, currency = 'RUB') =>
  `${amount.toLocaleString('ru-RU')} ${currency}`;

// 2. Неявный возврат объекта (круглые скобки обязательны!):
const createProduct = (id, title, price) => ({
  id,
  title,
  price,
  formattedPrice: formatCurrency(price),
  inStock: true,
});

console.log(formatCurrency(150000)); // "150 000 RUB"
console.log(createProduct(101, 'MacBook Air M3', 125000));

/* =========================================================
   03. Деструктуризация объектов и массивов
   ========================================================= */
console.log('\n=== 03. Деструктуризация объектов и массивов ===');

// Входной объект (аналог props компонента)
const incomingProps = {
  id: 'btn-42',
  label: 'Оформить заказ',
  variant: 'success',
  config: { timeout: 3000 },
};

// Извлекаем поля: variant с дефолтом, timeout из вложенного объекта
function renderButtonProps({
  label,
  variant = 'primary',
  config: { timeout },
}) {
  console.log(`Кнопка: "${label}" | Стиль: ${variant} | Таймаут: ${timeout}мс`);
}

renderButtonProps(incomingProps);

// Деструктуризация массива (эмуляция хука useState):
function mockUseState(initialValue) {
  let val = initialValue;
  const setter = (newVal) => {
    val = newVal;
  };
  return [val, setter];
}

const [currentCount, setCount] = mockUseState(10);
console.log('Начальный счётчик:', currentCount); // 10

/* =========================================================
   04. Spread и Rest: Иммутабельное обновление объектов
   ========================================================= */
console.log('\n=== 04. Spread и Rest: иммутабельность объектов ===');

const initialUser = {
  id: 1,
  name: 'Алексей',
  role: 'Junior Developer',
};

// 1. Создаём нового пользователя с обновлённой должностью через Spread:
const promotedUser = {
  ...initialUser,
  role: 'Middle React Developer',
  updatedAt: Date.now(),
};

// 2. Проверяем ссылочную идентичность (как это делает React Object.is):
console.log('Ссылки равны?', initialUser === promotedUser); // false (React увидит обновление!)
console.log('Исходный объект остался цел:', initialUser.role); // "Junior Developer"

// 3. Сбор остаточных пропсов (Rest):
const { id, role, ...displayData } = promotedUser;
console.log('Остаточные свойства (Rest):', displayData); // { name: 'Алексей', updatedAt: ... }

/* =========================================================
   05. Иммутабельные операции с массивами (.map, .filter, .reduce)
   ========================================================= */
console.log('\n=== 05. CRUD корзины товаров ===');

const initialCart = [
  { id: 1, name: 'Клавиатура', price: 4000, quantity: 1 },
  { id: 2, name: 'Мышь', price: 2500, quantity: 2 },
  { id: 3, name: 'Коврик', price: 1000, quantity: 1 },
];

// А. ДОБАВЛЕНИЕ (Add item) → Spread в новый массив:
const newItem = { id: 4, name: 'Наушники', price: 6000, quantity: 1 };
const cartAfterAdd = [...initialCart, newItem];

// Б. УДАЛЕНИЕ (Delete item) → .filter() по ID:
const removeId = 2; // Удаляем мышь
const cartAfterDelete = cartAfterAdd.filter((item) => item.id !== removeId);

// В. ИЗМЕНЕНИЕ (Update item) → .map() с проверкой ID:
const targetId = 1; // Увеличиваем количество клавиатур до 2
const cartAfterUpdate = cartAfterDelete.map((item) =>
  item.id === targetId ? { ...item, quantity: item.quantity + 1 } : item
);

// Г. ПОДСЧЁТ ИТОГА (Compute total) → .reduce():
const totalPrice = cartAfterUpdate.reduce(
  (acc, item) => acc + item.price * item.quantity,
  0
);

console.log('Итоговая корзина:', cartAfterUpdate);
console.log(`Общая сумма: ${totalPrice} руб.`);

console.log('\n=== Бонус: безопасные операторы ?. и ?? ===');

const partialUser = { profile: { nickname: null } };

// Optional chaining — безопасный доступ к глубоко вложенным полям
const city = partialUser?.profile?.address?.city;
console.log('Город (несуществующий путь):', city); // undefined, без ошибки

// Nullish coalescing — подстановка значения по умолчанию только для null/undefined
const displayName = partialUser.profile.nickname ?? 'Гость';
console.log('Отображаемое имя:', displayName); // "Гость"
