import { config, validateBotConfig } from './config.js';
import { fetchApartmentsWithCount, checkAdvertState } from './api.js';
import {
  isAdSeen,
  markAdAsSeen,
  markManyAdsAsSeen,
  getSeenCount,
  getAllSeenAdIds,
  removeSeenAd,
  saveManyAdsToCache,
  saveAdToCache,
  closeDb,
} from './db.js';
import { getBot, sendAdToTelegram, setupBotCommands, registerTriggerHandlers } from './bot.js';

let isPollingRunning = false;
let isCleanupRunning = false;

export async function checkApartments(): Promise<{ totalChecked: number; newFound: number; massSaved?: number }> {
  if (isPollingRunning) {
    console.log(`[${new Date().toLocaleTimeString()}] Предыдущий цикл проверки еще выполняется, пропускаем.`);
    return { totalChecked: 0, newFound: 0 };
  }

  isPollingRunning = true;
  console.log(`[${new Date().toLocaleTimeString()}] 🔎 Запуск проверки квартир на 999.md...`);

  try {
    const { ads, totalCount } = await fetchApartmentsWithCount(78);
    const seenCount = getSeenCount();

    // Сохраняем квартиры в кэш для карусели (/browse) и списка (/list)
    saveManyAdsToCache(ads);

    // Защита от спам-залпа при самом первом старте
    if (seenCount === 0 && config.initialSkipExisting) {
      console.log(`[Первый запуск] База данных пуста. Найдено ${ads.length} актуальных объявлений (всего на сайте: ${totalCount}).`);
      console.log(`Сохраняем их в базу, чтобы не спамить в чат. Будут приходить только НОВЫЕ публикации.`);
      markManyAdsAsSeen(ads.map((a) => a.id));
      isPollingRunning = false;
      return { totalChecked: ads.length, newFound: 0 };
    }

    // Идем от старых к новым (хронологический порядок)
    const reversedAds = [...ads].reverse();
    const newAds = reversedAds.filter((ad) => !isAdSeen(ad.id));

    // ЗАЩИТА ОТ СПАМА ПРИ СМЕНЕ ФИЛЬТРОВ:
    // Если после изменения фильтра появилось сразу много квартир (> 3),
    // не отправляем квартиры в чат, а тихо сохраняем в базу.
    // Пользователь может полистать их через /browse или /list.
    // Отправляем лишь сервисную плашку, которая сама удаляется через 1 минуту.
    const MAX_ALERTS_PER_CHECK = 3;

    let newAdsCount = 0;

    if (newAds.length > MAX_ALERTS_PER_CHECK) {
      console.log(`[Защита от спама] Обнаружено ${newAds.length} новых квартир (смена фильтра или массовое поступление). Сохраняем в базу без отправки в чат.`);
      
      // Сразу помечаем все новые как просмотренные в БД
      markManyAdsAsSeen(newAds.map((a) => a.id));

      const bot = getBot();
      try {
        const infoMsg = await bot.api.sendMessage(
          config.targetChatId,
          `ℹ️ <b>Обнаружено ${newAds.length} новых объявлений по фильтрам.</b>\n\n` +
          `Все они тихо сохранены в базу данных без спама в чат.\n` +
          `Вы можете посмотреть их через <b>/browse</b> (карусель) или <b>/list</b> (список).`,
          { parse_mode: 'HTML' }
        );

        // Автоматически удаляем сервисное сообщение через 60 секунд
        setTimeout(async () => {
          try {
            await bot.api.deleteMessage(config.targetChatId, infoMsg.message_id);
          } catch {}
        }, 60000);
      } catch (err) {
        console.error('Ошибка отправки сервисного сообщения в чат:', err);
      }

      return { totalChecked: ads.length, newFound: 0, massSaved: newAds.length };
    } else {
      for (const ad of newAds) {
        console.log(`[Новое объявление] ${ad.id}: "${ad.title}" - ${ad.price} (${ad.images.length} фото)`);
        const sent = await sendAdToTelegram(ad);

        if (sent) {
          markAdAsSeen(ad.id);
          newAdsCount++;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }

    if (newAdsCount > 0) {
      console.log(`[${new Date().toLocaleTimeString()}] Успешно отправлено ${newAdsCount} новых объявлений.`);
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] Новых объявлений не найдено.`);
    }

    return { totalChecked: ads.length, newFound: newAdsCount };
  } catch (error) {
    console.error(`[${new Date().toLocaleTimeString()}] Ошибка во время проверки квартир:`, error);
    throw error;
  } finally {
    isPollingRunning = false;
  }
}

export async function runDailyCleanup(
  onProgress?: (checked: number, total: number, removed: number) => Promise<void> | void
): Promise<{ total: number; removed: number }> {
  if (isCleanupRunning) {
    console.log('[Очистка базы] Очистка уже выполняется.');
    return { total: 0, removed: 0 };
  }

  isCleanupRunning = true;
  console.log(`[${new Date().toLocaleTimeString()}] 🧹 Запуск проверки актуальности базы (раз в сутки)...`);

  const ids = getAllSeenAdIds();
  let removedCount = 0;
  let checkedCount = 0;

  try {
    for (const id of ids) {
      checkedCount++;
      const state = await checkAdvertState(id);
      if (state !== 'PUBLIC') {
        console.log(`[Очистка базы] Объявление ${id} неактивно (${state}). Удаляем из базы.`);
        removeSeenAd(id);
        removedCount++;
      }
      if (onProgress) {
        await onProgress(checkedCount, ids.length, removedCount);
      }
      // Небольшая задержка 80мс между запросами, чтобы не нагружать 999.md
      await new Promise((r) => setTimeout(r, 80));
    }
    console.log(`[Очистка базы] Завершена. Всего проверено: ${ids.length}, удалено неактуальных: ${removedCount}`);
  } catch (error) {
    console.error('[Очистка базы] Ошибка во время проверки базы:', error);
  } finally {
    isCleanupRunning = false;
  }

  return { total: ids.length, removed: removedCount };
}

async function main() {
  console.log('🚀 Инициализация бота для мониторинга 999.md...');
  validateBotConfig();

  const bot = getBot();
  await setupBotCommands(bot);

  // Регистрируем хэндлеры для команд /check и /cleanup
  registerTriggerHandlers(checkApartments, runDailyCleanup);

  const pollIntervalMs = config.pollIntervalMinutes * 60 * 1000;
  const cleanupIntervalMs = 24 * 60 * 60 * 1000; // 24 часа

  console.log(`⚙️ Конфигурация:`);
  console.log(`   - Интервал проверки: каждые ${config.pollIntervalMinutes} минут`);
  console.log(`   - Очистка неактивных: раз в 24 часа`);
  console.log(`   - Telegram Chat ID: ${config.targetChatId}`);
  console.log(`   - Объявлений в базе: ${getSeenCount()}`);

  // Запускаем первую проверку новых объявлений
  await checkApartments();

  // Запускаем периодические таймеры
  const pollTimer = setInterval(checkApartments, pollIntervalMs);
  const cleanupTimer = setInterval(runDailyCleanup, cleanupIntervalMs);

  // Запуск слушателя команд бота
  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Бот @${botInfo.username} запущен и ожидает команды!`);
    },
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nПолучен сигнал ${signal}, завершение работы...`);
    clearInterval(pollTimer);
    clearInterval(cleanupTimer);
    await bot.stop();
    closeDb();
    console.log('Бот успешно остановлен.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Фатальная ошибка при запуске приложения:', err);
  process.exit(1);
});
