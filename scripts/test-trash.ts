import fs from 'fs';

// Temporary test database
const TEST_DB = 'test-flats.db';
process.env.DB_PATH = TEST_DB;

for (const ext of ['', '-wal', '-shm']) {
  try {
    if (fs.existsSync(TEST_DB + ext)) fs.unlinkSync(TEST_DB + ext);
  } catch {}
}

const {
  saveAdToCache,
  saveManyAdsToCache,
  markAdAsDeleted,
  restoreAdFromTrash,
  isAdDeleted,
  getTrashCount,
  getActiveAdsCount,
  getCachedAdByIndex,
  getDeletedAdByIndex,
  getCachedAdsPage,
  closeDb,
} = await import('../src/db.js');
import { FlatAd } from '../src/types.js';

function cleanup() {
  closeDb();
  for (const ext of ['', '-wal', '-shm']) {
    try {
      if (fs.existsSync(TEST_DB + ext)) fs.unlinkSync(TEST_DB + ext);
    } catch {}
  }
}

async function runTests() {
  console.log('🧪 Запуск тестов защиты корзины (/trash)...\n');
  cleanup();

  const adA: FlatAd = {
    id: 'ad_100',
    title: 'Квартира 100',
    price: '300 €',
    url: 'https://999.md/ru/100',
    images: ['https://example.com/1.jpg'],
    description: 'Desc 100',
    isTranslated: false,
  };

  const adB: FlatAd = {
    id: 'ad_200',
    title: 'Квартира 200',
    price: '350 €',
    url: 'https://999.md/ru/200',
    images: ['https://example.com/2.jpg'],
    description: 'Desc 200',
    isTranslated: false,
  };

  // 1. Добавляем adA и adB
  saveManyAdsToCache([adA, adB]);
  if (getActiveAdsCount() !== 2 || getTrashCount() !== 0) {
    throw new Error(`Ожидалось 2 активных и 0 в корзине, получено: активных=${getActiveAdsCount()}, корзина=${getTrashCount()}`);
  }
  console.log('✅ Шаг 1: Добавлены 2 квартиры в активную базу.');

  // 2. Пользователь удаляет adA в корзину
  markAdAsDeleted('ad_100');
  if (getActiveAdsCount() !== 1 || getTrashCount() !== 1) {
    throw new Error(`Ожидалось 1 активная и 1 в корзине, получено: активных=${getActiveAdsCount()}, корзина=${getTrashCount()}`);
  }
  if (!isAdDeleted('ad_100')) {
    throw new Error('ad_100 должна быть помечена как удаленная');
  }
  if (getDeletedAdByIndex(0)?.ad.id !== 'ad_100') {
    throw new Error('В корзине на индексе 0 должна быть ad_100');
  }
  if (getCachedAdByIndex(0)?.ad.id !== 'ad_200') {
    throw new Error('В активной карусели на индексе 0 должна быть ad_200');
  }
  console.log('✅ Шаг 2: Квартира ad_100 успешно удалена в корзину.');

  // 3. Симуляция добавления новых квартир и обновления старых с 999.md
  // На 999.md приходят: adA (с обновленной ценой), adB, и совершенно новая adC
  const adA_updated: FlatAd = {
    ...adA,
    price: '280 € (скидка)',
  };
  const adC: FlatAd = {
    id: 'ad_300',
    title: 'Новая Квартира 300',
    price: '400 €',
    url: 'https://999.md/ru/300',
    images: [],
  };

  console.log('🔄 Шаг 3: Поступает новая проверка с сайта (adA_updated, adB, adC)...');
  saveManyAdsToCache([adA_updated, adB, adC]);

  // Проверяем: adA ОБЯЗАНА остаться в корзине!
  if (getTrashCount() !== 1) {
    throw new Error(`КРИТИЧЕСКИЙ БАГ: Корзина очистилась! Ожидалось 1, стало ${getTrashCount()}`);
  }
  if (getActiveAdsCount() !== 2) {
    throw new Error(`Ожидалось 2 активных (adB и adC), получено: ${getActiveAdsCount()}`);
  }
  if (!isAdDeleted('ad_100')) {
    throw new Error('ad_100 перестала быть удаленной после добавления новых квартир!');
  }

  // Проверяем, что в списке активных квартир НЕТ ad_100
  const activeList = getCachedAdsPage(1, 10);
  const activeIds = activeList.ads.map((a) => a.id);
  if (activeIds.includes('ad_100')) {
    throw new Error(`КРИТИЧЕСКИЙ БАГ: Удаленная квартира ad_100 появилась в обычном списке! Список: ${activeIds.join(', ')}`);
  }
  if (!activeIds.includes('ad_200') || !activeIds.includes('ad_300')) {
    throw new Error(`В активном списке должны быть ad_200 и ad_300! Список: ${activeIds.join(', ')}`);
  }

  // Проверяем, что данные ad_100 обновились (цена 280), но она осталась в корзине
  const trashAd = getDeletedAdByIndex(0);
  if (trashAd?.ad.price !== '280 € (скидка)') {
    throw new Error(`Данные ad_100 должны были обновиться в кэше, но цена: ${trashAd?.ad.price}`);
  }
  console.log('✅ Шаг 3: Корзина НЕ очистилась, ad_100 осталась в корзине, новые квартиры ad_300 добавились в базу!');

  // 4. Проверяем автоперевод ad_100 в корзине
  adA.isTranslated = true;
  adA.description = 'Переведенное описание';
  saveAdToCache(adA);

  if (getTrashCount() !== 1 || !isAdDeleted('ad_100')) {
    throw new Error('saveAdToCache сбросил корзину при автопереводе!');
  }
  const translatedTrashAd = getDeletedAdByIndex(0);
  if (translatedTrashAd?.ad.description !== 'Переведенное описание') {
    throw new Error('Описание перевода не сохранилось');
  }
  console.log('✅ Шаг 4: Перевод описания в корзине не сбрасывает статус удаления.');

  // 5. Проверяем явное восстановление из корзины
  restoreAdFromTrash('ad_100');
  if (getTrashCount() !== 0) {
    throw new Error(`После восстановления корзина должна быть пуста, но там ${getTrashCount()}`);
  }
  if (getActiveAdsCount() !== 3) {
    throw new Error(`После восстановления должно быть 3 активных, но там ${getActiveAdsCount()}`);
  }
  if (isAdDeleted('ad_100')) {
    throw new Error('ad_100 все еще помечена как удаленная после restore');
  }
  console.log('✅ Шаг 5: Восстановление из корзины работает корректно.');

  // 6. Проверяем удаление квартиры, которой еще не было в кэше
  markAdAsDeleted('ad_999');
  if (!isAdDeleted('ad_999') || getTrashCount() !== 1) {
    throw new Error('Удаление ad_999 не создало запись в корзине!');
  }
  const ad999 = getDeletedAdByIndex(0);
  if (ad999?.ad.id !== 'ad_999') {
    throw new Error(`В корзине должна быть ad_999, получено: ${ad999?.ad.id}`);
  }
  console.log('✅ Шаг 6: Удаление квартиры ad_999 (которой не было в кэше) корректно создало запись в корзине.');

  // 7. Проверяем сортировку карусели по дате создания на сайте (postedAt)
  const sortOld: FlatAd = {
    id: 'sort_old',
    title: 'Старая квартира (2024)',
    price: '250 €',
    url: 'https://999.md/ru/sort_old',
    images: [],
    postedAt: '2024-05-10 10:00:00',
    postedDate: '10 мая 2024, 10:00',
  };
  const sortNew: FlatAd = {
    id: 'sort_new',
    title: 'Свежая квартира (сегодня)',
    price: '400 €',
    url: 'https://999.md/ru/sort_new',
    images: [],
    postedAt: '2026-10-26 10:00:00',
    postedDate: '26 окт. 2026, 10:00',
  };
  const sortMid: FlatAd = {
    id: 'sort_mid',
    title: 'Средняя квартира (вчера)',
    price: '350 €',
    url: 'https://999.md/ru/sort_mid',
    images: [],
    postedAt: '2026-10-25 15:00:00',
    postedDate: '25 окт. 2026, 15:00',
  };

  // Сохраняем в намеренно хаотичном порядке
  saveManyAdsToCache([sortOld, sortNew, sortMid]);

  const firstInCarousel = getCachedAdByIndex(0);
  if (firstInCarousel?.ad.id !== 'sort_new') {
    throw new Error(`Первой в карусели должна быть самая свежая квартира sort_new, получено: ${firstInCarousel?.ad.id}`);
  }
  const secondInCarousel = getCachedAdByIndex(1);
  if (secondInCarousel?.ad.id !== 'sort_mid') {
    throw new Error(`Второй в карусели должна быть sort_mid, получено: ${secondInCarousel?.ad.id}`);
  }

  const pageAds = getCachedAdsPage(1, 3);
  if (pageAds.ads[0].id !== 'sort_new' || pageAds.ads[1].id !== 'sort_mid') {
    throw new Error(`Список должен сортироваться от самых свежих к старым. Получено: ${pageAds.ads.map(a => a.id).join(', ')}`);
  }
  console.log('✅ Шаг 7: Карусель и список корректно сортируются по дате создания (postedAt) — самые свежие первыми.');

  console.log('\n🎉 ВСЕ ТЕСТЫ УСПЕШНО ПРОЙДЕНЫ!');
  cleanup();
}

runTests().catch((err) => {
  console.error('\n❌ ТЕСТ ПРОВАЛЕН:', err);
  cleanup();
  process.exit(1);
});
