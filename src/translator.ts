export function isRomanianText(text: string): boolean {
  const cyrillicMatches = (text.match(/[а-яёА-ЯЁ]/g) || []).length;
  const latinMatches = (text.match(/[a-zA-ZăâîșțĂÂÎȘȚ]/g) || []).length;
  // Если латиницы заметно больше и кириллицы почти нет — текст на румынском
  return latinMatches > 15 && cyrillicMatches < 5;
}

export async function translateRoToRu(text: string): Promise<string> {
  if (!text || !isRomanianText(text)) {
    return text;
  }

  try {
    // Берем первые 500-600 символов под размер подписи Telegram
    const chunk = text.slice(0, 500);
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=ro|ru`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return text;
    }

    const data = (await res.json()) as any;
    const translated = data?.responseData?.translatedText;

    if (translated && typeof translated === 'string' && translated.trim().length > 0) {
      // MyMemory иногда может вернуть HTML сущности вроде &quot; или &#39;
      return decodeHtmlEntities(translated);
    }
  } catch (err) {
    console.warn('[Translator] Ошибка перевода описания, оставляем оригинал:', err);
  }

  return text;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
