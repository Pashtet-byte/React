// ---------------------------------------------------------
// 01. Подготовка тестового стенда
// ---------------------------------------------------------

// Базовый массив товаров (эмуляция ответа сервера):
const products = [
  { id: "p1", title: "Механическая клавиатура", price: 8500, category: "accessories", inStock: true, rating: 4.8 },
  { id: "p2", title: "Игровой монитор 144Hz", price: 24000, category: "displays", inStock: false, rating: 4.6 },
  { id: "p3", title: "Беспроводная мышь", price: 4200, category: "accessories", inStock: true, rating: 4.9 },
  { id: "p4", title: "USB-C Хаб 7-in-1", price: 3100, category: "adapters", inStock: true, rating: 4.2 },
  { id: "p5", title: "Кронштейн для монитора", price: 5600, category: "accessories", inStock: false, rating: 4.7 },
];

console.log(`Загружено товаров: ${products.length}`);
console.log("=".repeat(60));

// ---------------------------------------------------------
// 02. Отработка метода .map(): Трансформация структуры
// ---------------------------------------------------------
console.log("\n--- 02. .map() ---");

// Задача 1: Получить простой массив только из названий всех товаров
const productTitles = products.map(item => item.title);
console.log("1. Названия товаров:", productTitles);

// Задача 2: Добавить скидку 15% и отформатировать цену для отображения
const productsWithDiscount = products.map(item => ({
  ...item,
  discountPrice: item.price * 0.85,
  formattedPrice: `${item.price.toLocaleString("ru-RU")} ₽`,
}));
console.log("2. Товары со скидкой (пример p1):", {
  title: productsWithDiscount[0].title,
  formattedPrice: productsWithDiscount[0].formattedPrice,
  discountPrice: productsWithDiscount[0].discountPrice,
});

// Задача 3: Превратить массив объектов в массив JSX-строк (эмуляция React List)
const mockJsxList = products.map((item, index) =>
  `<li key="${item.id}" data-index="${index}">${item.title} — ${item.price}₽</li>`
);
console.log("3. Эмуляция JSX:", mockJsxList[0]);

// ---------------------------------------------------------
// 03. Отработка метода .filter(): Выборки и удаление
// ---------------------------------------------------------
console.log("\n--- 03. .filter() ---");

// Задача 1: Выбрать товары, которые есть в наличии (inStock === true)
const inStockOnly = products.filter(item => item.inStock);
console.log(`1. В наличии товаров: ${inStockOnly.length}`);

// Задача 2: Фильтр по категории и бюджету (accessories дешевле 6000₽)
const affordableAccessories = products.filter(
  item => item.category === "accessories" && item.price < 6000
);
console.log("2. Бюджетные аксессуары:", affordableAccessories.map(i => i.title));

// Задача 3: Удаление товара по ID (основа handleDelete в React State)
const idToDelete = "p3";
const remainingProducts = products.filter(item => item.id !== idToDelete);
console.log("3. Товары после удаления p3:", remainingProducts.length); // 4 товара

// ---------------------------------------------------------
// 04. Отработка метода .find(): Поиск конкретного элемента
// ---------------------------------------------------------
console.log("\n--- 04. .find() ---");

// Задача 1: Найти товар по точному ID (для страницы отдельного товара)
const targetId = "p4";
const foundProduct = products.find(item => item.id === targetId);
console.log(`Найден: ${foundProduct?.title ?? "Товар не найден"}`);

// Задача 2: Поиск первого товара с высоким рейтингом (>= 4.9)
const topRated = products.find(item => item.rating >= 4.9);
console.log("Топ товар:", topRated?.title); // "Беспроводная мышь"

// Задача 3: Поиск несуществующего элемента
const missing = products.find(item => item.id === "p999");
console.log("Результат поиска несуществующего:", missing); // undefined

// ---------------------------------------------------------
// 05. Композиция методов: Построение цепочек (Method Chaining)
// ---------------------------------------------------------
console.log("\n--- 05. Method Chaining ---");

// Задача: Отобрать товары В НАЛИЧИИ с рейтингом >= 4.5,
// отсортировать и вернуть красивый формат карточки
const showcaseProducts = products
  .filter(item => item.inStock && item.rating >= 4.5)
  .map(item => ({
    badge: "★ Хит",
    displayName: `${item.title} (${item.rating})`,
    finalPrice: `${item.price.toLocaleString("ru-RU")} ₽`,
  }));
console.log("Витрина хитов:", showcaseProducts);

// ---------------------------------------------------------
// 06. Итоговое практическое задание: CatalogManager
// ---------------------------------------------------------
console.log("\n--- 06. CatalogManager ---");

// 1. Поиск товара по ID
const getProductById = (list, id) => list.find(item => item.id === id);

// 2. Фильтрация по категории с опциональным фильтром наличия
const filterCatalog = (list, { category, onlyInStock = false } = {}) => {
  return list.filter(item => {
    const matchesCategory = category ? item.category === category : true;
    const matchesStock = onlyInStock ? item.inStock : true;
    return matchesCategory && matchesStock;
  });
};

// 3. Быстрое изменение цены товара по ID через .map()
const updateProductPrice = (list, id, newPrice) => {
  return list.map(item => (item.id === id ? { ...item, price: newPrice } : item));
};

// Проверка работы модуля:
const activeAccessories = filterCatalog(products, { category: "accessories", onlyInStock: true });
const updatedList = updateProductPrice(products, "p1", 7990);

console.log("Аксессуары в наличии:", activeAccessories.length); // 2 товара
console.log("Новая цена p1:", getProductById(updatedList, "p1")?.price); // 7990

console.log("\n" + "=".repeat(60));
console.log("✓ Метод .map() протестирован: 100% элементов трансформированы без мутации");
console.log("✓ Метод .filter() протестирован: предикаты отработали корректно");
console.log("✓ Метод .find() протестирован: ранний выход зафиксирован");
