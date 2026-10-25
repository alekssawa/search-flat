# 999.md Telegram Apartment Monitor Bot 🏢

Легковесный Telegram-бот для мониторинга аренды квартир в Кишинёве на `999.md`. Оптимизирован для работы на слабых VPS (512 Мб RAM + WireGuard).

## 🚀 Стек
- **TypeScript & Node.js 22** (работает и на Bun)
- **grammY** (фреймворк для Telegram Bot API)
- **SQLite (better-sqlite3)** в режиме WAL (хранение ID отправленных объявлений)
- Прямой **GraphQL API 999.md** (без тяжелого браузера / Playwright)

---

## ⚙️ Настройки в `.env`

Пример `.env`:
```env
BOT_TOKEN=your_telegram_bot_token
TARGET_CHAT_ID=-100xxxxxxxxxx # ID вашей группы или чата
POLL_INTERVAL_MINUTES=15
INITIAL_SKIP_EXISTING=true
```

- `POLL_INTERVAL_MINUTES`: интервал опроса (каждые 15 минут).
- `INITIAL_SKIP_EXISTING`: при первом запуске запоминает текущие квартиры в базу, чтобы не спамить в чат старыми объявлениями. Новые будут приходить по мере публикации.

---

## 📱 Меню команд в Telegram

В левом нижнем углу чата с ботом доступна кнопка **Меню**:
- `/browse` — 🖼 Интерактивная карусель (листать сохраненные квартиры с фото и кнопками в одном сообщении).
- `/list` — 📋 Компактный список-дайджест всех квартир со ссылками и пагинацией.
- `/sync` — 🔄 Загрузить абсолютно все ~700 квартир с 999.md в базу (без спама в чат).
- `/trash` — 🗑 Корзина: просмотр и восстановление случайно удаленных квартир.
- `/check` — 🔎 Принудительно запустить проверку новых объявлений прямо сейчас.
- `/status` — 📊 Актуальная статистика базы и интервал опроса.
- `/cleanup` — 🧹 Проверить базу и удалить неактуальные/скрытые объявления (`AD_STATE_HIDDEN`).
- `/start` / `/id` — 👋 Справка и получение ID группы для настройки.

---

## 🛠 Локальные команды

```bash
# Тест парсинга GraphQL в консоли
npm run test:fetch

# Запуск в режиме разработки с автоперезагрузкой
npm run dev

# Сборка TypeScript
npm run build

# Запуск с ограничением по памяти
npm start
```

---

## 📦 Перенос и запуск на VPS (512 Мб RAM)

### 1. Настройка Swap на VPS (обязательно для защиты WireGuard):
```bash
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 2. Установка Node.js на VPS:
```bash
curl -fsSL https://nodejs.org/dist/v22.13.1/node-v22.13.1-linux-x64.tar.gz | tar -xz -C /usr/local --strip-components=1
ln -sf /usr/local/bin/node /usr/bin/node
ln -sf /usr/local/bin/npm /usr/bin/npm
```

### 3. Копирование проекта на VPS (выполнять на вашем компьютере):
```bash
# Перенос без необходимости ставить rsync на сервер:
tar -czf - --exclude='node_modules' --exclude='.git' . | ssh root@YOUR_VPS_IP "mkdir -p /root/search-flat && tar -xzf - -C /root/search-flat"
```

На сервере:
```bash
cd /root/search-flat
npm install --omit=dev
npm run build
```

### 4. Настройка автозапуска через systemd:
```bash
cp /root/search-flat/flatbot.service /etc/systemd/system/flatbot.service
systemctl daemon-reload
systemctl enable --now flatbot
```

### 5. Полезные команды на VPS:
```bash
# Просмотр логов в реальном времени
journalctl -u flatbot -f

# Статус службы
systemctl status flatbot

# Перезапуск (после обновления кода)
systemctl restart flatbot
```
