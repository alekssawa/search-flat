import { fetchApartments } from '../src/api.js';

async function run() {
  console.log('🔄 Отправка тестового запроса к 999.md GraphQL...');
  try {
    const startTime = Date.now();
    const apartments = await fetchApartments(10);
    const elapsed = Date.now() - startTime;

    console.log(`✅ Успешно получено объявлений: ${apartments.length} (время: ${elapsed}мс)\n`);

    if (apartments.length === 0) {
      console.log('⚠️ По заданным фильтрам объявлений не найдено.');
      return;
    }

    console.log('--- ПРИМЕР ПЕРВЫХ 3-х НАЙДЕННЫХ КВАРТИР ---');
    apartments.slice(0, 3).forEach((ad, i) => {
      console.log(`\n[#${i + 1}] ID: ${ad.id}`);
      console.log(`   Заголовок : ${ad.title}`);
      console.log(`   Цена      : ${ad.price}`);
      console.log(`   Комнаты   : ${ad.rooms || 'не указано'}`);
      console.log(`   Площадь   : ${ad.area || 'не указано'}`);
      console.log(`   Этаж      : ${ad.floor || 'не указано'}`);
      console.log(`   Адрес     : ${ad.address || 'не указано'}`);
      console.log(`   Создано   : ${ad.postedDate || 'не указано'} (${ad.postedAt || 'нет ISO'})`);
      console.log(`   Обновлено : ${ad.date || 'не указано'}`);
      console.log(`   Фотографий: ${ad.images.length}`);
      if (ad.images.length > 0) {
        console.log(`   Первое фото: ${ad.images[0]}`);
      }
      console.log(`   Ссылка    : ${ad.url}`);
      if (ad.description) {
        const shortDesc = ad.description.replace(/\s+/g, ' ').slice(0, 120);
        console.log(`   Описание  : "${shortDesc}..."`);
      }
    });

    console.log('\n-------------------------------------------');
    console.log('🎉 Парсер GraphQL работает идеально!');
  } catch (err) {
    console.error('❌ Ошибка при выполнении тестового запроса:', err);
  }
}

run();
