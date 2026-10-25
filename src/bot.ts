import { Bot, InlineKeyboard, InputMediaBuilder } from 'grammy';
import { config } from './config.js';
import { FlatAd } from './types.js';
import {
  buildMediaGroup,
  buildAdCaption,
  buildBrowseKeyboard,
  buildTrashKeyboard,
  buildListPage,
} from './formatter.js';
import {
  getSeenCount,
  saveSentMessageIds,
  getSentMessageIds,
  deleteSentMessageRecord,
  getCachedAdByIndex,
  getDeletedAdByIndex,
  getCachedAdsPage,
  getActiveView,
  setActiveView,
  clearActiveView,
  removeSeenAd,
  markAdAsDeleted,
  restoreAdFromTrash,
  saveManyAdsToCache,
  saveAdToCache,
  markManyAdsAsSeen,
} from './db.js';
import { isRomanianText, translateRoToRu } from './translator.js';
import { fetchAllApartments } from './api.js';

let botInstance: Bot | null = null;
let triggerCheckHandler: (() => Promise<{ totalChecked: number; newFound: number }>) | null = null;
let triggerCleanupHandler: (
  (onProgress?: (checked: number, total: number, removed: number) => Promise<void> | void) => Promise<{ total: number; removed: number }>
) | null = null;

export async function ensureAdTranslated(ad: FlatAd): Promise<FlatAd> {
  if (ad.description && !ad.isTranslated && isRomanianText(ad.description)) {
    const translated = await translateRoToRu(ad.description);
    if (translated && translated !== ad.description) {
      ad.description = translated;
      ad.isTranslated = true;
      // Сохраняем переведенное описание обратно в кэш базы данных
      try {
        saveAdToCache(ad);
      } catch {}
    }
  }
  return ad;
}

export function registerTriggerHandlers(
  onCheck: () => Promise<{ totalChecked: number; newFound: number }>,
  onCleanup: (onProgress?: (checked: number, total: number, removed: number) => Promise<void> | void) => Promise<{ total: number; removed: number }>
) {
  triggerCheckHandler = onCheck;
  triggerCleanupHandler = onCleanup;
}

async function scheduleAutoDelete(ctx: any, chatId: number, messageId: number, delayMs: number = 60000, viewType?: string) {
  setTimeout(async () => {
    try {
      await ctx.api.deleteMessage(chatId, messageId);
      if (viewType) {
        clearActiveView(chatId, viewType);
      }
    } catch {}
  }, delayMs);
}

async function runSingleViewCommand(
  ctx: any,
  viewType: string,
  sendAction: () => Promise<any>,
  autoDeleteAfterMs?: number
): Promise<any> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // 1. Удаляем старое сообщение этой команды в данном чате
  const oldMsgId = getActiveView(chatId, viewType);
  if (oldMsgId) {
    try {
      await ctx.api.deleteMessage(chatId, oldMsgId);
    } catch {}
    clearActiveView(chatId, viewType);
  }

  // 2. Удаляем команду самого пользователя для чистоты переписки
  try {
    await ctx.deleteMessage();
  } catch {}

  // 3. Отправляем новое сообщение и сохраняем его ID
  try {
    const sent = await sendAction();
    if (sent && sent.message_id) {
      setActiveView(chatId, viewType, sent.message_id);

      if (autoDeleteAfterMs) {
        scheduleAutoDelete(ctx, chatId, sent.message_id, autoDeleteAfterMs, viewType);
      }
    }
    return sent;
  } catch (err) {
    console.error(`Ошибка при выполнении команды ${viewType}:`, err);
  }
}

export function getBot(): Bot {
  if (!botInstance) {
    botInstance = new Bot(config.botToken);

    // Удаление квартиры из чата
    botInstance.callbackQuery(/^del:(.+)$/, async (ctx) => {
      const adId = ctx.match[1];
      const chatId = ctx.chat?.id;

      if (!chatId) {
        await ctx.answerCallbackQuery({ text: 'Ошибка: чат не найден' });
        return;
      }

      // Помечаем как удаленную (переносим в корзину для /trash)
      markAdAsDeleted(adId);

      const messageIds = getSentMessageIds(adId);

      if (messageIds && messageIds.length > 0) {
        try {
          await ctx.api.deleteMessages(chatId, messageIds);
        } catch {
          for (const msgId of messageIds) {
            try {
              await ctx.api.deleteMessage(chatId, msgId);
            } catch {}
          }
        }
        deleteSentMessageRecord(adId);
      } else {
        try {
          await ctx.deleteMessage();
        } catch {}
      }

      await ctx.answerCallbackQuery({ text: '🗑 Квартира удалена из чата' });
    });

    // Навигация карусели (/browse)
    botInstance.callbackQuery(/^br_nav:(\d+)$/, async (ctx) => {
      const targetIndex = Number(ctx.match[1]);
      const data = getCachedAdByIndex(targetIndex);
      if (!data) {
        await ctx.answerCallbackQuery({ text: 'Квартир в базе нет' });
        return;
      }

      await ensureAdTranslated(data.ad);
      const { ad, total, index } = data;
      const caption = buildAdCaption(ad, 950);
      const keyboard = buildBrowseKeyboard(index, total, ad);
      const photoUrl = ad.images[0] || 'https://999.md/static/redesign/logo999.svg';

      try {
        await ctx.editMessageMedia(
          InputMediaBuilder.photo(photoUrl, { caption, parse_mode: 'HTML' }),
          { reply_markup: keyboard }
        );
      } catch {
        try {
          await ctx.editMessageCaption({ caption, parse_mode: 'HTML', reply_markup: keyboard });
        } catch {}
      }
      await ctx.answerCallbackQuery();
    });

    // Удаление из базы прямо из карусели (перемещение в корзину)
    botInstance.callbackQuery(/^br_del:([^:]+):(\d+)$/, async (ctx) => {
      const adId = ctx.match[1];
      const currentIndex = Number(ctx.match[2]);

      markAdAsDeleted(adId);
      await ctx.answerCallbackQuery({ text: '🗑 Квартира перемещена в корзину (/trash)' });

      const data = getCachedAdByIndex(currentIndex);
      if (!data) {
        if (ctx.chat) clearActiveView(ctx.chat.id, 'browse');
        try {
          await ctx.deleteMessage();
        } catch {}
        return;
      }

      await ensureAdTranslated(data.ad);
      const { ad, total, index } = data;
      const caption = buildAdCaption(ad, 950);
      const keyboard = buildBrowseKeyboard(index, total, ad);
      const photoUrl = ad.images[0] || 'https://999.md/static/redesign/logo999.svg';

      try {
        await ctx.editMessageMedia(
          InputMediaBuilder.photo(photoUrl, { caption, parse_mode: 'HTML' }),
          { reply_markup: keyboard }
        );
      } catch {
        try {
          await ctx.editMessageCaption({ caption, parse_mode: 'HTML', reply_markup: keyboard });
        } catch {}
      }
    });

    botInstance.callbackQuery('br_close', async (ctx) => {
      if (ctx.chat) clearActiveView(ctx.chat.id, 'browse');
      try {
        await ctx.deleteMessage();
      } catch {}
      await ctx.answerCallbackQuery();
    });

    // Пагинация списка (/list)
    botInstance.callbackQuery(/^lst_page:(\d+)$/, async (ctx) => {
      const targetPage = Number(ctx.match[1]);
      const data = getCachedAdsPage(targetPage, 10);
      const { text, keyboard } = buildListPage(data.ads, data.page, data.totalPages, data.total);

      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    botInstance.callbackQuery('lst_close', async (ctx) => {
      if (ctx.chat) clearActiveView(ctx.chat.id, 'list');
      try {
        await ctx.deleteMessage();
      } catch {}
      await ctx.answerCallbackQuery();
    });

    // Навигация корзины удаленных (/trash)
    botInstance.callbackQuery(/^tr_nav:(\d+)$/, async (ctx) => {
      const targetIndex = Number(ctx.match[1]);
      const data = getDeletedAdByIndex(targetIndex);
      if (!data) {
        await ctx.answerCallbackQuery({ text: 'В корзине пусто' });
        return;
      }

      await ensureAdTranslated(data.ad);
      const { ad, total, index } = data;
      const caption = `🗑 <b>[КОРЗИНА УДАЛЕННЫХ]</b>\n\n` + buildAdCaption(ad, 900);
      const keyboard = buildTrashKeyboard(index, total, ad);
      const photoUrl = ad.images[0] || 'https://999.md/static/redesign/logo999.svg';

      try {
        await ctx.editMessageMedia(
          InputMediaBuilder.photo(photoUrl, { caption, parse_mode: 'HTML' }),
          { reply_markup: keyboard }
        );
      } catch {
        try {
          await ctx.editMessageCaption({ caption, parse_mode: 'HTML', reply_markup: keyboard });
        } catch {}
      }
      await ctx.answerCallbackQuery();
    });

    // Восстановление из корзины в активную базу
    botInstance.callbackQuery(/^tr_restore:([^:]+):(\d+)$/, async (ctx) => {
      const adId = ctx.match[1];
      const currentIndex = Number(ctx.match[2]);

      restoreAdFromTrash(adId);
      await ctx.answerCallbackQuery({ text: '♻️ Квартира восстановлена в активную базу!' });

      const data = getDeletedAdByIndex(currentIndex);
      if (!data) {
        if (ctx.chat) clearActiveView(ctx.chat.id, 'trash');
        try {
          await ctx.deleteMessage();
        } catch {}
        return;
      }

      await ensureAdTranslated(data.ad);
      const { ad, total, index } = data;
      const caption = `🗑 <b>[КОРЗИНА УДАЛЕННЫХ]</b>\n\n` + buildAdCaption(ad, 900);
      const keyboard = buildTrashKeyboard(index, total, ad);
      const photoUrl = ad.images[0] || 'https://999.md/static/redesign/logo999.svg';

      try {
        await ctx.editMessageMedia(
          InputMediaBuilder.photo(photoUrl, { caption, parse_mode: 'HTML' }),
          { reply_markup: keyboard }
        );
      } catch {
        try {
          await ctx.editMessageCaption({ caption, parse_mode: 'HTML', reply_markup: keyboard });
        } catch {}
      }
    });

    botInstance.callbackQuery('tr_close', async (ctx) => {
      if (ctx.chat) clearActiveView(ctx.chat.id, 'trash');
      try {
        await ctx.deleteMessage();
      } catch {}
      await ctx.answerCallbackQuery();
    });

    botInstance.callbackQuery(['br_noop', 'lst_noop', 'tr_noop'], async (ctx) => {
      await ctx.answerCallbackQuery();
    });

    // Команда /browse — Интерактивная карусель
    botInstance.command('browse', async (ctx) => {
      const chatId = ctx.chat.id;

      // Удаляем предыдущую карусель в этом чате, чтобы не плодить дубликаты
      const oldMsgId = getActiveView(chatId, 'browse');
      if (oldMsgId) {
        try {
          await ctx.api.deleteMessage(chatId, oldMsgId);
        } catch {}
        clearActiveView(chatId, 'browse');
      }

      // Удаляем команду пользователя для чистоты чата
      try {
        await ctx.deleteMessage();
      } catch {}

      const data = getCachedAdByIndex(0);
      if (!data) {
        await ctx.reply('📭 В базе пока нет сохраненных квартир для просмотра.');
        return;
      }

      await ensureAdTranslated(data.ad);
      const { ad, total, index } = data;
      const caption = buildAdCaption(ad, 950);
      const keyboard = buildBrowseKeyboard(index, total, ad);
      const photoUrl = ad.images[0] || 'https://999.md/static/redesign/logo999.svg';

      try {
        const sent = await ctx.replyWithPhoto(photoUrl, {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        setActiveView(chatId, 'browse', sent.message_id);
      } catch {
        const sent = await ctx.reply(caption, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        setActiveView(chatId, 'browse', sent.message_id);
      }
    });

    // Команда /trash — Просмотр и восстановление удаленных квартир
    botInstance.command(['trash', 'deleted'], async (ctx) => {
      const chatId = ctx.chat.id;

      // Удаляем предыдущую корзину в чате
      const oldMsgId = getActiveView(chatId, 'trash');
      if (oldMsgId) {
        try {
          await ctx.api.deleteMessage(chatId, oldMsgId);
        } catch {}
        clearActiveView(chatId, 'trash');
      }

      // Удаляем команду пользователя
      try {
        await ctx.deleteMessage();
      } catch {}

      const data = getDeletedAdByIndex(0);
      if (!data) {
        await ctx.reply('🗑 <b>Корзина пуста.</b>\n\nЗдесь будут появляться квартиры, которые вы удалили из чата или карусели, чтобы вы могли их восстановить.', { parse_mode: 'HTML' });
        return;
      }

      await ensureAdTranslated(data.ad);
      const { ad, total, index } = data;
      const caption = `🗑 <b>[КОРЗИНА УДАЛЕННЫХ]</b>\n\n` + buildAdCaption(ad, 900);
      const keyboard = buildTrashKeyboard(index, total, ad);
      const photoUrl = ad.images[0] || 'https://999.md/static/redesign/logo999.svg';

      try {
        const sent = await ctx.replyWithPhoto(photoUrl, {
          caption,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        setActiveView(chatId, 'trash', sent.message_id);
      } catch {
        const sent = await ctx.reply(caption, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        setActiveView(chatId, 'trash', sent.message_id);
      }
    });
    botInstance.command('list', async (ctx) => {
      const chatId = ctx.chat.id;

      // Удаляем предыдущий список, если был
      const oldMsgId = getActiveView(chatId, 'list');
      if (oldMsgId) {
        try {
          await ctx.api.deleteMessage(chatId, oldMsgId);
        } catch {}
        clearActiveView(chatId, 'list');
      }

      // Удаляем команду пользователя
      try {
        await ctx.deleteMessage();
      } catch {}

      const data = getCachedAdsPage(1, 10);
      const { text, keyboard } = buildListPage(data.ads, data.page, data.totalPages, data.total);

      const sent = await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
      setActiveView(chatId, 'list', sent.message_id);
    });

    botInstance.command(['start', 'id'], async (ctx) => {
      await runSingleViewCommand(ctx, 'start', async () => {
        const chatId = ctx.chat.id;
        const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';

        if (isGroup) {
          return await ctx.reply(
            `👥 <b>Группа для поиска квартир подключена!</b>\n\n` +
            `🆔 <b>ID этой группы:</b> <code>${chatId}</code>\n\n` +
            `Скопируйте это число в файл <code>.env</code>:\n` +
            `<code>TARGET_CHAT_ID=${chatId}</code>\n\n` +
            `💡 <i>Убедитесь, что бот назначен администратором группы с правом «Удаление сообщений».</i>`,
            { parse_mode: 'HTML' }
          );
        } else {
          return await ctx.reply(
            `👋 <b>Привет! Я бот для мониторинга квартир на 999.md</b>\n\n` +
            `🆔 Твой Chat ID: <code>${chatId}</code>\n` +
            `⏱ Интервал проверки: <b>${config.pollIntervalMinutes} минут</b>\n\n` +
            `Команды меню:\n` +
            `• /browse — интерактивная карусель сохраненных квартир\n` +
            `• /list — компактный список всех квартир со ссылками\n` +
            `• /sync — загрузить все ~700 квартир в базу\n` +
            `• /trash — корзина удаленных (восстановление)\n` +
            `• /check — проверить свежие квартиры на сайте\n` +
            `• /status — статистика базы и мониторинга\n` +
            `• /cleanup — удалить неактивные квартиры из базы`,
            { parse_mode: 'HTML' }
          );
        }
      }, 60000);
    });

    botInstance.command('status', async (ctx) => {
      await runSingleViewCommand(ctx, 'status', async () => {
        const seenCount = getSeenCount();
        return await ctx.reply(
          `📊 <b>Статус мониторинга:</b>\n\n` +
          `• Квартир сохранено в базе: <b>${seenCount}</b>\n` +
          `• Интервал автопроверки: <b>${config.pollIntervalMinutes} мин.</b>\n` +
          `• Фильтры: <b>1-2 комнаты, 200 - 450 EUR, Кишинёв мун.</b>\n` +
          `• Бот работает штатно.`,
          { parse_mode: 'HTML' }
        );
      }, 60000);
    });

    // Команда /sync — Загрузить абсолютно все квартиры с 999.md в базу
    botInstance.command('sync', async (ctx) => {
      await runSingleViewCommand(ctx, 'sync', async () => {
        const msg = await ctx.reply('⏳ Начинаю полную синхронизацию базы с 999.md (загрузка всех страниц)...');
        try {
          let lastReport = 0;
          const allAds = await fetchAllApartments(async (loaded, total) => {
            if (loaded - lastReport >= 150 || loaded >= total) {
              lastReport = loaded;
              try {
                await ctx.api.editMessageText(
                  ctx.chat.id,
                  msg.message_id,
                  `⏳ Загрузка квартир с 999.md: <b>${loaded}</b> из <b>${total}</b>...`,
                  { parse_mode: 'HTML' }
                );
              } catch {}
            }
          });

          // Сохраняем все квартиры в базу и кэш
          saveManyAdsToCache(allAds);
          markManyAdsAsSeen(allAds.map((a) => a.id));

          await ctx.api.editMessageText(
            ctx.chat.id,
            msg.message_id,
            `✅ <b>Полная синхронизация завершена!</b>\n\n` +
            `• Загружено в базу: <b>${allAds.length}</b> квартир\n` +
            `• Фильтр: 1-2 комнаты, 200 - 450 EUR, Кишинёв мун.\n\n` +
            `Теперь вы можете полистать всю базу через <b>/browse</b> (все ${allAds.length} шт.) или посмотреть списком <b>/list</b>!`,
            { parse_mode: 'HTML' }
          );
        } catch (err) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            msg.message_id,
            `❌ Ошибка синхронизации: ${(err as Error).message}`,
            { parse_mode: 'HTML' }
          );
        }

        // Автоматически удаляем отчет о синхронизации через 60 секунд
        scheduleAutoDelete(ctx, ctx.chat.id, msg.message_id, 60000, 'sync');
        return msg;
      });
    });

    botInstance.command('check', async (ctx) => {
      await runSingleViewCommand(ctx, 'check', async () => {
        const msg = await ctx.reply('🔎 Запускаю внеочередную проверку новых квартир...');
        if (triggerCheckHandler) {
          try {
            const stats = await triggerCheckHandler();
            if (stats.newFound === 0) {
              await ctx.api.editMessageText(
                ctx.chat.id,
                msg.message_id,
                `👌 <b>Новых объявлений не найдено.</b>\n\nВсе актуальные квартиры уже в базе. Следующая автопроверка через <b>${config.pollIntervalMinutes} мин.</b>`,
                { parse_mode: 'HTML' }
              );
            } else {
              await ctx.api.editMessageText(
                ctx.chat.id,
                msg.message_id,
                `🎉 <b>Найдено новых квартир: ${stats.newFound}</b> (отправлены выше).`,
                { parse_mode: 'HTML' }
              );
            }
          } catch (err) {
            await ctx.api.editMessageText(
              ctx.chat.id,
              msg.message_id,
              `❌ Ошибка при проверке: ${(err as Error).message}`,
              { parse_mode: 'HTML' }
            );
          }
        }
        // Автоматически удаляем статус проверки через 60 секунд
        scheduleAutoDelete(ctx, ctx.chat.id, msg.message_id, 60000, 'check');
        return msg;
      });
    });

    botInstance.command('cleanup', async (ctx) => {
      await runSingleViewCommand(ctx, 'cleanup', async () => {
        const msg = await ctx.reply('⏳ Начинаю проверку базы на актуальность...');
        if (triggerCleanupHandler) {
          try {
            let lastReportTime = 0;
            const stats = await triggerCleanupHandler(async (checked, total, removed) => {
              const now = Date.now();
              if (now - lastReportTime >= 1500 || checked >= total) {
                lastReportTime = now;
                try {
                  await ctx.api.editMessageText(
                    ctx.chat.id,
                    msg.message_id,
                    `🧹 <b>Проверка базы на актуальность...</b>\n\n` +
                    `⏳ Проверено: <b>${checked}</b> из <b>${total}</b>\n` +
                    `🗑 Найдено неактуальных: <b>${removed}</b>`,
                    { parse_mode: 'HTML' }
                  );
                } catch {}
              }
            });
            if (stats.removed === 0) {
              await ctx.api.editMessageText(
                ctx.chat.id,
                msg.message_id,
                `👌 <b>Все объявления в базе актуальны!</b>\n\n` +
                `• Проверено в базе: <b>${stats.total}</b> квартир\n` +
                `• Удаленных или скрытых: <b>0</b>\n` +
                `• База в актуальном состоянии.`,
                { parse_mode: 'HTML' }
              );
            } else {
              await ctx.api.editMessageText(
                ctx.chat.id,
                msg.message_id,
                `🧹 <b>Очистка базы завершена!</b>\n\n` +
                `• Проверено в базе: <b>${stats.total}</b> квартир\n` +
                `• Удалено неактуальных/скрытых: <b>${stats.removed}</b>\n` +
                `• Осталось активных: <b>${getSeenCount()}</b>`,
                { parse_mode: 'HTML' }
              );
            }
          } catch (err) {
            await ctx.api.editMessageText(
              ctx.chat.id,
              msg.message_id,
              `❌ Ошибка при очистке: ${(err as Error).message}`,
              { parse_mode: 'HTML' }
            );
          }
        }
        // Автоматически удаляем статус очистки через 60 секунд
        scheduleAutoDelete(ctx, ctx.chat.id, msg.message_id, 60000, 'cleanup');
        return msg;
      });
    });
  }
  return botInstance;
}

export async function setupBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: 'browse', description: '🖼 Интерактивная карусель квартир' },
      { command: 'list', description: '📋 Компактный список со ссылками' },
      { command: 'sync', description: '🔄 Загрузить все ~700 квартир в базу' },
      { command: 'trash', description: '🗑 Корзина удаленных (восстановление)' },
      { command: 'check', description: '🔎 Проверить новые квартиры' },
      { command: 'status', description: '📊 Статус и статистика базы' },
      { command: 'cleanup', description: '🧹 Очистить неактивные из базы' },
      { command: 'start', description: '👋 Информация и команды' },
    ]);
  } catch (err) {
    console.error('Не удалось установить команды меню бота:', err);
  }
}

export async function sendAdToTelegram(ad: FlatAd): Promise<boolean> {
  // Автоперевод с румынского, если текст на румынском
  await ensureAdTranslated(ad);

  const bot = getBot();
  const chatId = config.targetChatId;
  const content = buildMediaGroup(ad, 10);

  const deleteKeyboard = new InlineKeyboard().text('🗑 Удалить из чата', `del:${ad.id}`);

  try {
    if (content.type === 'group') {
      try {
        const sentGroup = await bot.api.sendMediaGroup(chatId, content.media);
        const groupMsgIds = sentGroup.map((m) => m.message_id);

        const ctrlMsg = await bot.api.sendMessage(chatId, `📍 <b>${ad.title}</b>`, {
          parse_mode: 'HTML',
          reply_markup: deleteKeyboard,
        });

        saveSentMessageIds(ad.id, [...groupMsgIds, ctrlMsg.message_id]);
      } catch (mediaGroupError) {
        console.warn(`[Telegram] Не удалось отправить альбом для ${ad.id}, пробуем одно фото:`, mediaGroupError);
        if (ad.images[0]) {
          const sent = await bot.api.sendPhoto(chatId, ad.images[0], {
            caption: content.media[0]?.caption || buildAdCaption(ad),
            parse_mode: 'HTML',
            reply_markup: deleteKeyboard,
          });
          saveSentMessageIds(ad.id, [sent.message_id]);
        } else {
          const sent = await bot.api.sendMessage(chatId, buildAdCaption(ad), {
            parse_mode: 'HTML',
            reply_markup: deleteKeyboard,
          });
          saveSentMessageIds(ad.id, [sent.message_id]);
        }
      }
    } else if (content.type === 'photo') {
      try {
        const sent = await bot.api.sendPhoto(chatId, content.photoUrl, {
          caption: content.caption,
          parse_mode: 'HTML',
          reply_markup: deleteKeyboard,
        });
        saveSentMessageIds(ad.id, [sent.message_id]);
      } catch (photoError) {
        console.warn(`[Telegram] Не удалось отправить фото для ${ad.id}, отправляем текстом:`, photoError);
        const sent = await bot.api.sendMessage(chatId, content.caption, {
          parse_mode: 'HTML',
          reply_markup: deleteKeyboard,
        });
        saveSentMessageIds(ad.id, [sent.message_id]);
      }
    } else {
      const sent = await bot.api.sendMessage(chatId, content.caption, {
        parse_mode: 'HTML',
        reply_markup: deleteKeyboard,
      });
      saveSentMessageIds(ad.id, [sent.message_id]);
    }
    return true;
  } catch (err) {
    console.error(`[Telegram] Критическая ошибка отправки объявления ${ad.id}:`, err);
    return false;
  }
}
