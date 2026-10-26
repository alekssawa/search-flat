import Database from 'better-sqlite3';
import { config } from './config.js';
import { FlatAd } from './types.js';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = new Database(config.dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('cache_size = -2000'); // Ограничение кэша SQLite в 2 Мб RAM
    dbInstance.pragma('temp_store = MEMORY');
    dbInstance.pragma('mmap_size = 0'); // Минимизация виртуальной памяти на слабых VPS

    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS seen_ads (
        id TEXT PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_seen_ads_id ON seen_ads(id);

      CREATE TABLE IF NOT EXISTS sent_messages (
        ad_id TEXT PRIMARY KEY,
        message_ids TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ads_cache (
        id TEXT PRIMARY KEY,
        title TEXT,
        price TEXT,
        url TEXT,
        images TEXT,
        description TEXT,
        author TEXT,
        agency TEXT,
        rooms TEXT,
        area TEXT,
        floor TEXT,
        address TEXT,
        date TEXT,
        pets TEXT,
        amenities TEXT,
        is_translated INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ads_cache_created ON ads_cache(created_at DESC);
      CREATE TABLE IF NOT EXISTS active_chat_views (
        chat_id INTEGER,
        view_type TEXT,
        message_id INTEGER,
        PRIMARY KEY (chat_id, view_type)
      );
    `);

    // Мягкая миграция: добавляем is_deleted, если таблицы уже были созданы ранее
    try {
      dbInstance.exec('ALTER TABLE ads_cache ADD COLUMN is_deleted INTEGER DEFAULT 0;');
    } catch {}

    try {
      dbInstance.exec('CREATE INDEX IF NOT EXISTS idx_ads_cache_deleted ON ads_cache(is_deleted);');
    } catch {}
  }
  return dbInstance;
}

export function isAdSeen(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('SELECT 1 FROM seen_ads WHERE id = ?');
  return !!stmt.get(id);
}

export function markAdAsSeen(id: string): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO seen_ads (id) VALUES (?)');
  stmt.run(id);
}

export function markManyAdsAsSeen(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO seen_ads (id) VALUES (?)');
  const insertMany = db.transaction((idList: string[]) => {
    for (const id of idList) {
      stmt.run(id);
    }
  });
  insertMany(ids);
}

export function getAllSeenAdIds(): string[] {
  const db = getDb();
  const stmt = db.prepare('SELECT id FROM seen_ads ORDER BY created_at ASC');
  const rows = stmt.all() as { id: string }[];
  return rows.map((r) => r.id);
}

let saveAdStmt: Database.Statement | null = null;

function getSaveAdStmt(): Database.Statement {
  if (!saveAdStmt) {
    const db = getDb();
    saveAdStmt = db.prepare(`
      INSERT INTO ads_cache (
        id, title, price, url, images, description, author, agency,
        rooms, area, floor, address, date, pets, amenities, is_translated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        price = excluded.price,
        url = excluded.url,
        images = excluded.images,
        description = CASE
          WHEN excluded.is_translated = 1 THEN excluded.description
          WHEN ads_cache.is_translated = 1 THEN ads_cache.description
          ELSE excluded.description
        END,
        author = excluded.author,
        agency = excluded.agency,
        rooms = excluded.rooms,
        area = excluded.area,
        floor = excluded.floor,
        address = excluded.address,
        date = excluded.date,
        pets = excluded.pets,
        amenities = excluded.amenities,
        is_translated = CASE
          WHEN excluded.is_translated = 1 THEN 1
          WHEN ads_cache.is_translated = 1 THEN 1
          ELSE 0
        END
    `);
  }
  return saveAdStmt;
}

export function isAdDeleted(id: string): boolean {
  const db = getDb();
  const stmt = db.prepare('SELECT 1 FROM ads_cache WHERE id = ? AND is_deleted = 1');
  return !!stmt.get(id);
}

export function markAdAsDeleted(id: string): void {
  const db = getDb();
  markAdAsSeen(id);
  const result = db.prepare('UPDATE ads_cache SET is_deleted = 1 WHERE id = ?').run(id);
  if (result.changes === 0) {
    db.prepare(`
      INSERT INTO ads_cache (id, title, url, price, is_deleted)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET is_deleted = 1
    `).run(id, `Объявление ${id}`, `https://999.md/ru/${id}`, 'Цена не указана');
  }
}

export function restoreAdFromTrash(id: string): void {
  const db = getDb();
  db.prepare('UPDATE ads_cache SET is_deleted = 0 WHERE id = ?').run(id);
}

export function removeSeenAd(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM seen_ads WHERE id = ?').run(id);
  db.prepare('DELETE FROM ads_cache WHERE id = ?').run(id);
}

export function getSeenCount(): number {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM seen_ads');
  const row = stmt.get() as { count: number };
  return row ? row.count : 0;
}

export function getTrashCount(): number {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM ads_cache WHERE is_deleted = 1');
  const row = stmt.get() as { count: number };
  return row ? row.count : 0;
}

export function getActiveAdsCount(): number {
  const db = getDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM ads_cache WHERE is_deleted = 0');
  const row = stmt.get() as { count: number };
  return row ? row.count : 0;
}

// Кэш объявлений для /browse и /list (защищен от сброса корзины is_deleted)
export function saveAdToCache(ad: FlatAd): void {
  const stmt = getSaveAdStmt();
  stmt.run(
    ad.id,
    ad.title,
    ad.price,
    ad.url,
    JSON.stringify(ad.images || []),
    ad.description || null,
    ad.author || null,
    ad.agency || null,
    ad.rooms || null,
    ad.area || null,
    ad.floor || null,
    ad.address || null,
    ad.date || null,
    ad.pets || null,
    ad.amenities ? JSON.stringify(ad.amenities) : null,
    ad.isTranslated ? 1 : 0
  );
}

export function saveManyAdsToCache(ads: FlatAd[]): void {
  if (ads.length === 0) return;
  const db = getDb();
  const stmt = getSaveAdStmt();
  const insert = db.transaction((items: FlatAd[]) => {
    for (const ad of items) {
      stmt.run(
        ad.id,
        ad.title,
        ad.price,
        ad.url,
        JSON.stringify(ad.images || []),
        ad.description || null,
        ad.author || null,
        ad.agency || null,
        ad.rooms || null,
        ad.area || null,
        ad.floor || null,
        ad.address || null,
        ad.date || null,
        ad.pets || null,
        ad.amenities ? JSON.stringify(ad.amenities) : null,
        ad.isTranslated ? 1 : 0
      );
    }
  });
  insert(ads);
}

export function getCachedAdByIndex(index: number): { ad: FlatAd; total: number; index: number } | null {
  const db = getDb();
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM ads_cache WHERE is_deleted = 0').get() as { count: number };
  const total = totalRow ? totalRow.count : 0;
  if (total === 0) return null;

  let safeIndex = index % total;
  if (safeIndex < 0) safeIndex += total;

  const stmt = db.prepare('SELECT * FROM ads_cache WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 1 OFFSET ?');
  const row = stmt.get(safeIndex) as any;
  if (!row) return null;

  const ad: FlatAd = {
    id: row.id,
    title: row.title,
    price: row.price,
    url: row.url,
    images: row.images ? JSON.parse(row.images) : [],
    description: row.description || undefined,
    author: row.author || undefined,
    agency: row.agency || undefined,
    rooms: row.rooms || undefined,
    area: row.area || undefined,
    floor: row.floor || undefined,
    address: row.address || undefined,
    date: row.date || undefined,
    pets: row.pets || undefined,
    amenities: row.amenities ? JSON.parse(row.amenities) : undefined,
    isTranslated: row.is_translated === 1,
  };

  return { ad, total, index: safeIndex };
}

export function getDeletedAdByIndex(index: number): { ad: FlatAd; total: number; index: number } | null {
  const db = getDb();
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM ads_cache WHERE is_deleted = 1').get() as { count: number };
  const total = totalRow ? totalRow.count : 0;
  if (total === 0) return null;

  let safeIndex = index % total;
  if (safeIndex < 0) safeIndex += total;

  const stmt = db.prepare('SELECT * FROM ads_cache WHERE is_deleted = 1 ORDER BY created_at DESC LIMIT 1 OFFSET ?');
  const row = stmt.get(safeIndex) as any;
  if (!row) return null;

  const ad: FlatAd = {
    id: row.id,
    title: row.title,
    price: row.price,
    url: row.url,
    images: row.images ? JSON.parse(row.images) : [],
    description: row.description || undefined,
    author: row.author || undefined,
    agency: row.agency || undefined,
    rooms: row.rooms || undefined,
    area: row.area || undefined,
    floor: row.floor || undefined,
    address: row.address || undefined,
    date: row.date || undefined,
    pets: row.pets || undefined,
    amenities: row.amenities ? JSON.parse(row.amenities) : undefined,
    isTranslated: row.is_translated === 1,
  };

  return { ad, total, index: safeIndex };
}

export function getCachedAdsPage(page: number, pageSize: number = 10): {
  ads: FlatAd[];
  total: number;
  page: number;
  totalPages: number;
} {
  const db = getDb();
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM ads_cache WHERE is_deleted = 0').get() as { count: number };
  const total = totalRow ? totalRow.count : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  let safePage = page;
  if (safePage < 1) safePage = 1;
  if (safePage > totalPages) safePage = totalPages;

  const offset = (safePage - 1) * pageSize;
  const stmt = db.prepare('SELECT * FROM ads_cache WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?');
  const rows = stmt.all(pageSize, offset) as any[];

  const ads: FlatAd[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    price: row.price,
    url: row.url,
    images: row.images ? JSON.parse(row.images) : [],
    description: row.description || undefined,
    author: row.author || undefined,
    agency: row.agency || undefined,
    rooms: row.rooms || undefined,
    area: row.area || undefined,
    floor: row.floor || undefined,
    address: row.address || undefined,
    date: row.date || undefined,
    pets: row.pets || undefined,
    amenities: row.amenities ? JSON.parse(row.amenities) : undefined,
    isTranslated: row.is_translated === 1,
  }));

  return { ads, total, page: safePage, totalPages };
}

// Активные меню (Карусель / Список) в чате для удаления дубликатов
export function getActiveView(chatId: number, viewType: string): number | null {
  const db = getDb();
  const stmt = db.prepare('SELECT message_id FROM active_chat_views WHERE chat_id = ? AND view_type = ?');
  const row = stmt.get(chatId, viewType) as { message_id: number } | undefined;
  return row ? row.message_id : null;
}

export function setActiveView(chatId: number, viewType: string, messageId: number): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO active_chat_views (chat_id, view_type, message_id) VALUES (?, ?, ?)'
  );
  stmt.run(chatId, viewType, messageId);
}

export function clearActiveView(chatId: number, viewType: string): void {
  const db = getDb();
  db.prepare('DELETE FROM active_chat_views WHERE chat_id = ? AND view_type = ?').run(chatId, viewType);
}

// Управление сообщениями в чате для кнопки "Удалить"
export function saveSentMessageIds(adId: string, messageIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO sent_messages (ad_id, message_ids) VALUES (?, ?)'
  );
  stmt.run(adId, JSON.stringify(messageIds));
}

export function getSentMessageIds(adId: string): number[] | null {
  const db = getDb();
  const stmt = db.prepare('SELECT message_ids FROM sent_messages WHERE ad_id = ?');
  const row = stmt.get(adId) as { message_ids: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.message_ids);
  } catch {
    return null;
  }
}

export function deleteSentMessageRecord(adId: string): void {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM sent_messages WHERE ad_id = ?');
  stmt.run(adId);
}

export function closeDb(): void {
  saveAdStmt = null;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
