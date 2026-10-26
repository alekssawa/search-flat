import { FlatAd, GraphQLSearchAdsResponse, RawAdvert } from './types.js';

const GRAPHQL_ENDPOINT = 'https://999.md/graphql';

const SEARCH_QUERY = `
query SearchAds($input: Ads_SearchInput!, $locale: Common_Locale) {
  searchAds(input: $input) {
    count
    ads {
      id
      title
      posted(
        input: {format: "2006-01-02 15:04:05", timezone: "Europe/Chisinau"}
      )
      postedDate: posted(
        input: {format: "2 Jan. 2006, 15:04", locale: $locale, timezone: "Europe/Chisinau", getDiff: false}
      )
      reseted(
        input: {format: "2 Jan. 2006, 15:04", locale: $locale, timezone: "Europe/Chisinau", getDiff: false}
      )
      estateRooms: feature(id: 241) { id value }
      estateArea: feature(id: 244) { id value }
      estateFloor: feature(id: 248) { id value }
      totalFloors: feature(id: 249) { id value }
      price: feature(id: 2) { id value }
      images: feature(id: 14) { id value }
      body: feature(id: 13) { id value }
      author: feature(id: 795) { id value }
      agency: feature(id: 2563) { id value }
      pets: feature(id: 1382) { id value }
      city: feature(id: 8) { id value }
      district: feature(id: 9) { id value }
      street: feature(id: 10) { id value }
      condition: feature(id: 253) { id value }
      balcony: feature(id: 250) { id value }
      f_188: feature(id: 188) { id value }
      f_214: feature(id: 214) { id value }
      f_154: feature(id: 154) { id value }
      f_182: feature(id: 182) { id value }
    }
  }
}
`;

export function buildSearchPayload(limit: number = 78, skip: number = 0) {
  return {
    operationName: 'SearchAds',
    query: SEARCH_QUERY,
    variables: {
      locale: 'ru_RU',
      input: {
        source: 'AD_SOURCE_DESKTOP_REDESIGN',
        sort: 'SORT_ADS_DATE_DESC',
        pagination: { limit, skip },
        subCategoryId: 1404,
        filters: [
          { filterId: 16, features: [{ featureId: 1, optionIds: [912] }] }, // Долгосрочная аренда
          { filterId: 30, features: [{ featureId: 241, optionIds: [893, 894] }] }, // 1 и 2 комнаты
          { filterId: 32, features: [{ featureId: 7, optionIds: [12900] }] }, // Кишинёв
          {
            filterId: 9441,
            features: [
              {
                featureId: 2,
                range: { min: '200', max: '450' },
                unit: 'UNIT_EUR'
              }
            ]
          }
        ]
      }
    }
  };
}

function extractFeatureText(feature?: any): string | undefined {
  if (!feature || feature.value === undefined || feature.value === null) return undefined;
  const val = feature.value;

  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof val === 'number') {
    return String(val);
  }
  if (typeof val === 'object') {
    // Для мультиязычных полей сначала ищем русский перевод
    if (typeof val.ru === 'string' && val.ru.trim()) {
      return val.ru.trim();
    }
    if (typeof val.translated === 'string' && val.translated.trim()) {
      return val.translated.trim();
    }
    if (typeof val.ro === 'string' && val.ro.trim()) {
      return val.ro.trim();
    }
    if (val.value !== undefined && val.value !== null) {
      return String(val.value).trim();
    }
  }
  return undefined;
}

function extractPrice(feature?: any): string {
  if (!feature || feature.value === undefined || feature.value === null) {
    return 'Цена не указана';
  }
  const val = feature.value;
  if (typeof val === 'object' && val.value !== undefined) {
    const symbol = val.unit === 'UNIT_EUR' ? '€' : val.unit === 'UNIT_USD' ? '$' : (val.unit || '€');
    return `${val.value} ${symbol}`;
  }
  if (typeof val === 'number' || typeof val === 'string') {
    return `${val} €`;
  }
  return 'Цена не указана';
}

function extractArea(feature?: any): string | undefined {
  if (!feature || feature.value === undefined || feature.value === null) return undefined;
  const val = feature.value;
  if (typeof val === 'object' && val.value !== undefined) {
    return `${val.value} м²`;
  }
  if (typeof val === 'number' || typeof val === 'string') {
    return `${val} м²`;
  }
  return undefined;
}

export function parseRawAdvert(raw: RawAdvert): FlatAd {
  const idStr = String(raw.id);

  let imageList: string[] = [];
  if (Array.isArray(raw.images?.value)) {
    imageList = raw.images.value
      .filter((img): img is string => typeof img === 'string' && img.length > 0)
      .map((img) => {
        if (img.startsWith('http')) return img;
        const cleanName = img.split('?')[0];
        return `https://i.simpalsmedia.com/999.md/BoardImages/900x900/${cleanName}`;
      });
  }

  const city = extractFeatureText(raw.city);
  const district = extractFeatureText(raw.district);
  const street = extractFeatureText(raw.street);
  const addressParts = [city, district, street].filter(Boolean);

  const rooms = extractFeatureText(raw.estateRooms);
  const area = extractArea(raw.estateArea);
  const floorRaw = extractFeatureText(raw.estateFloor);
  const totalFloorsRaw = extractFeatureText(raw.totalFloors);
  let floor: string | undefined;
  if (floorRaw && totalFloorsRaw) {
    floor = `${floorRaw} из ${totalFloorsRaw}`;
  } else if (floorRaw) {
    floor = `${floorRaw} этаж`;
  }
  const description = extractFeatureText(raw.body);
  const price = extractPrice(raw.price);

  // Автор и агентство
  const authorType = extractFeatureText(raw.author);
  let agencyName: string | undefined;
  if (raw.agency?.value && typeof raw.agency.value === 'object') {
    agencyName = raw.agency.value.brand || raw.agency.value.title;
  }

  const pets = extractFeatureText(raw.pets);

  // Удобства (Дополнительно)
  const amenities: string[] = [];
  if (raw.f_188?.value === true) amenities.push('Меблированная');
  if (raw.f_214?.value === true) amenities.push('С бытовой техникой');
  if (raw.f_154?.value === true) amenities.push('Автономное отопление');
  if (raw.f_182?.value === true) amenities.push('Кондиционер');
  const cond = extractFeatureText(raw.condition);
  if (cond) amenities.push(cond);

  return {
    id: idStr,
    title: raw.title || 'Квартира на 999.md',
    price,
    url: `https://999.md/ru/${idStr}`,
    images: imageList,
    description,
    author: authorType,
    agency: agencyName,
    rooms,
    area,
    floor,
    address: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    date: raw.reseted,
    postedAt: raw.posted,
    postedDate: raw.postedDate,
    pets,
    amenities: amenities.length > 0 ? amenities : undefined,
  };
}

export async function fetchApartments(limit: number = 78, skip: number = 0): Promise<FlatAd[]> {
  const result = await fetchApartmentsWithCount(limit, skip);
  return result.ads;
}

export async function fetchApartmentsWithCount(
  limit: number = 78,
  skip: number = 0
): Promise<{ ads: FlatAd[]; totalCount: number }> {
  const payload = buildSearchPayload(limit, skip);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': '*/*',
    'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'lang': 'ru',
    'origin': 'https://999.md',
    'referer': 'https://999.md/ru/list/real-estate/apartments-and-rooms?o_16_1=912&o_30_241=893,894&o_32_7=12900&from_9441_2=200&to_9441_2=450&unit_9441_2=eur',
    'source': 'desktop_redesign',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  };

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`999.md GraphQL error: HTTP ${response.status} - ${errorText.slice(0, 300)}`);
  }

  const json = (await response.json()) as GraphQLSearchAdsResponse;

  if (json.errors && json.errors.length > 0) {
    const errorMessages = json.errors.map((e) => e.message).join('; ');
    throw new Error(`GraphQL response returned errors: ${errorMessages}`);
  }

  const rawAds = json.data?.searchAds?.ads || [];
  const totalCount = json.data?.searchAds?.count || rawAds.length;

  return {
    ads: rawAds.map(parseRawAdvert),
    totalCount,
  };
}

export async function fetchAllApartments(
  onProgress?: (loaded: number, total: number) => Promise<void> | void
): Promise<FlatAd[]> {
  const pageSize = 78;
  let skip = 0;
  const allAds: FlatAd[] = [];

  // Первая страница
  const firstPage = await fetchApartmentsWithCount(pageSize, 0);
  const totalCount = firstPage.totalCount;
  allAds.push(...firstPage.ads);
  skip += pageSize;

  if (onProgress) await onProgress(allAds.length, totalCount);

  // Остальные страницы
  while (skip < totalCount) {
    await new Promise((r) => setTimeout(r, 200));
    const page = await fetchApartmentsWithCount(pageSize, skip);
    if (page.ads.length === 0) break;
    allAds.push(...page.ads);
    skip += pageSize;
    if (onProgress) await onProgress(Math.min(allAds.length, totalCount), totalCount);
  }

  return allAds;
}

const CHECK_AD_QUERY = `
query AdState($input: AdvertInput!) {
  advert(input: $input) {
    id
    state
    isExpired
  }
}
`;

export type AdvertStateResult = 'PUBLIC' | 'HIDDEN' | 'EXPIRED' | 'DELETED';

export async function checkAdvertState(adId: string): Promise<AdvertStateResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'accept': '*/*',
    'lang': 'ru',
    'origin': 'https://999.md',
    'referer': `https://999.md/ru/${adId}`,
    'source': 'desktop_redesign',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  };

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operationName: 'AdState',
        query: CHECK_AD_QUERY,
        variables: { input: { id: adId } },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return 'DELETED';
    }

    const json = (await response.json()) as any;
    const advert = json?.data?.advert;

    if (!advert || advert.id === null) {
      return 'DELETED';
    }

    if (advert.isExpired === true) {
      return 'EXPIRED';
    }

    if (advert.state === 'AD_STATE_HIDDEN') {
      return 'HIDDEN';
    }

    if (advert.state === 'AD_STATE_PUBLIC') {
      return 'PUBLIC';
    }

    return 'DELETED';
  } catch (err) {
    console.error(`Ошибка проверки статуса объявления ${adId}:`, err);
    // В случае сетевой ошибки не удаляем по ошибке
    return 'PUBLIC';
  }
}
