import { InputMediaBuilder, InlineKeyboard } from 'grammy';
import { FlatAd } from './types.js';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildAdCaption(ad: FlatAd, maxCaptionLength: number = 1000): string {
  const parts: string[] = [];

  parts.push(`🏢 <b>${escapeHtml(ad.title)}</b>\n`);
  parts.push(`💰 <b>Цена:</b> ${escapeHtml(ad.price)}`);

  // Автор / Агентство
  if (ad.author) {
    if (ad.author.toLowerCase().includes('агентство')) {
      const agencyText = ad.agency ? ` (${ad.agency})` : '';
      parts.push(`🏢 <b>Автор:</b> Агентство${escapeHtml(agencyText)}`);
    } else if (ad.author.toLowerCase().includes('частное')) {
      parts.push(`👤 <b>Автор:</b> Частное лицо`);
    } else {
      parts.push(`👤 <b>Автор:</b> ${escapeHtml(ad.author)}`);
    }
  }

  if (ad.rooms) {
    parts.push(`🚪 <b>Комнаты:</b> ${escapeHtml(ad.rooms)}`);
  }
  if (ad.area) {
    parts.push(`📐 <b>Площадь:</b> ${escapeHtml(ad.area)}`);
  }
  if (ad.floor) {
    parts.push(`🏢 <b>Этаж:</b> ${escapeHtml(ad.floor)}`);
  }
  if (ad.address) {
    parts.push(`📍 <b>Адрес:</b> ${escapeHtml(ad.address)}`);
  }
  if (ad.amenities && ad.amenities.length > 0) {
    parts.push(`✨ <b>Удобства:</b> ${escapeHtml(ad.amenities.join(', '))}`);
  }
  if (ad.pets) {
    parts.push(`🐾 <b>Животные:</b> ${escapeHtml(ad.pets)}`);
  }
  if (ad.postedDate && ad.date && ad.postedDate !== ad.date) {
    parts.push(`📅 <b>Создано:</b> ${escapeHtml(ad.postedDate)}`);
    parts.push(`🕒 <b>Обновлено:</b> ${escapeHtml(ad.date)}`);
  } else if (ad.postedDate) {
    parts.push(`📅 <b>Создано:</b> ${escapeHtml(ad.postedDate)}`);
  } else if (ad.date) {
    parts.push(`🕒 <b>Обновлено:</b> ${escapeHtml(ad.date)}`);
  }

  parts.push(`\n🔗 <a href="${ad.url}">Открыть объявление на 999.md</a>`);

  const metadataText = parts.join('\n');

  // Если описания нет — возвращаем метаданные
  if (!ad.description) {
    return metadataText;
  }

  // Очищаем описание от лишних пробелов, сохраняя абзацы
  const cleanDesc = ad.description
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleanDesc) {
    return metadataText;
  }

  // Считаем доступное место под описание с запасом до лимита Telegram (1024 символов)
  const headerText = ad.isTranslated
    ? `\n\n📝 <b>Описание (перевод с румынского):</b>\n<i>`
    : `\n\n📝 <b>Описание:</b>\n<i>`;
  const footer = `</i>`;
  const reservedLen = metadataText.length + headerText.length + footer.length + 5;
  const availableForDesc = Math.max(100, maxCaptionLength - reservedLen);

  let formattedDesc = cleanDesc;
  if (cleanDesc.length > availableForDesc) {
    formattedDesc = cleanDesc.slice(0, availableForDesc).trim() + '...';
  }

  return `${metadataText}${headerText}${escapeHtml(formattedDesc)}${footer}`;
}

export function buildMediaGroup(ad: FlatAd, maxPhotos: number = 10) {
  const photos = ad.images.slice(0, maxPhotos);
  const caption = buildAdCaption(ad, 1000);

  if (photos.length === 0) {
    return { type: 'text' as const, caption };
  }

  if (photos.length === 1) {
    return { type: 'photo' as const, photoUrl: photos[0], caption };
  }

  const media = photos.map((url, idx) =>
    idx === 0
      ? InputMediaBuilder.photo(url, { caption, parse_mode: 'HTML' })
      : InputMediaBuilder.photo(url)
  );

  return { type: 'group' as const, media };
}

export function buildBrowseKeyboard(currentIndex: number, total: number, ad: FlatAd): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const prevIdx = (currentIndex - 1 + total) % total;
  const nextIdx = (currentIndex + 1) % total;

  // Навигация
  keyboard
    .text('⬅️ Назад', `br_nav:${prevIdx}`)
    .text(`(${currentIndex + 1} из ${total})`, `br_noop`)
    .text('Вперёд ➡️', `br_nav:${nextIdx}`)
    .row();

  // Действия
  keyboard
    .text('🗑 Удалить из базы', `br_del:${ad.id}:${currentIndex}`)
    .url('🔗 На 999.md', ad.url)
    .row();

  // Закрыть
  keyboard.text('❌ Закрыть карусель', 'br_close');

  return keyboard;
}

export function buildTrashKeyboard(currentIndex: number, total: number, ad: FlatAd): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  const prevIdx = (currentIndex - 1 + total) % total;
  const nextIdx = (currentIndex + 1) % total;

  // Навигация
  keyboard
    .text('⬅️ Назад', `tr_nav:${prevIdx}`)
    .text(`(${currentIndex + 1} из ${total})`, `tr_noop`)
    .text('Вперёд ➡️', `tr_nav:${nextIdx}`)
    .row();

  // Восстановление
  keyboard
    .text('♻️ Восстановить в базу', `tr_restore:${ad.id}:${currentIndex}`)
    .url('🔗 На 999.md', ad.url)
    .row();

  // Закрыть
  keyboard.text('❌ Закрыть корзину', 'tr_close');

  return keyboard;
}

export function buildListPage(
  ads: FlatAd[],
  page: number,
  totalPages: number,
  total: number
): { text: string; keyboard: InlineKeyboard } {
  const lines: string[] = [];
  lines.push(`📋 <b>База квартир на 999.md</b> (стр. <b>${page}</b> из <b>${totalPages}</b>, всего: ${total})\n`);

  if (ads.length === 0) {
    lines.push('<i>В базе пока нет сохраненных квартир.</i>');
  } else {
    ads.forEach((ad, i) => {
      const num = (page - 1) * 10 + i + 1;
      const title = escapeHtml(ad.title);
      const price = escapeHtml(ad.price);
      const address = ad.address ? ` | 📍 ${escapeHtml(ad.address)}` : '';
      const author = ad.author ? ` | 👤 ${escapeHtml(ad.author)}` : '';

      lines.push(`<b>${num}.</b> <a href="${ad.url}"><b>${title}</b></a>`);
      lines.push(`   💰 <b>${price}</b>${address}${author}\n`);
    });
  }

  const keyboard = new InlineKeyboard();
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  if (totalPages > 1) {
    keyboard
      .text('⬅️ Назад', `lst_page:${prevPage}`)
      .text(`(Стр. ${page}/${totalPages})`, 'lst_noop')
      .text('Вперёд ➡️', `lst_page:${nextPage}`)
      .row();
  }

  keyboard.text('❌ Закрыть список', 'lst_close');

  return { text: lines.join('\n'), keyboard };
}
