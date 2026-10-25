import { fetchApartments } from '../src/api.js';
import { sendAdToTelegram } from '../src/bot.js';

async function testTelegram() {
  console.log('🔄 Загрузка объявлений с 999.md...');
  const ads = await fetchApartments(5);
  if (ads.length === 0) {
    console.log('⚠️ Объявлений не найдено.');
    return;
  }

  // Выбираем объявление с описанием и автором
  const adWithDesc = ads.find((a) => a.description && a.description.length > 50) || ads[0];

  console.log(`📤 Отправка в Telegram объявления ID: ${adWithDesc.id}`);
  console.log(`   Автор: ${adWithDesc.author} (${adWithDesc.agency || 'без агентства'})`);
  console.log(`   Удобства: ${adWithDesc.amenities?.join(', ') || 'не указаны'}`);
  console.log(`   Животные: ${adWithDesc.pets || 'не указано'}`);
  console.log(`   Длина описания: ${adWithDesc.description?.length || 0} симв.`);

  const success = await sendAdToTelegram(adWithDesc);

  if (success) {
    console.log('🎉 Квартира с обновленным форматированием успешно отправлена в ваш Telegram!');
  } else {
    console.log('❌ Не удалось отправить в Telegram.');
  }
}

testTelegram();
