# JOCK NUTRITION

Статический интернет-магазин БАДов на vanilla JS + Supabase. Деплоится на GitHub Pages.

## Описание

Интерактивная онлайн-витрина (цифровой информационный каталог) биологически активных добавок. Позволяет просматривать каталог, формировать список выбранного и отправлять спецификацию в WhatsApp.

## Архитектура

- **Фронтенд**: `index.html`, `styles.css`, `app.js` — публичная витрина
- **Админка**: `admin/index.html`, `admin/styles.css`, `admin/app.js` — панель управления
- **Бэкенд**: Supabase (PostgreSQL + Edge Functions + Storage)
- **PWA**: Service Worker, манифест, иконки

## Технологии

- Vanilla JS, ES2020+
- CSS Grid + Flexbox, clamp(), CSS-переменные
- Mobile-first, iOS-стиль на мобильных
- Supabase (REST API, Edge Functions, Auth, Storage)
- Нет сборки, нет транспиляции

## Команды

- `npm start` — открывает index.html
- `npm run lint` — проверка кода
- `npm run typecheck` — проверка типов

## Ключевые паттерны

- **Корзина**: localStorage 'jock-cart', только `{id, quantity}`
- **Избранное**: localStorage 'jock-favorites`, массив UUID
- **Настройки**: из admin-api/settings, кэш в `window.__storeSettings`
- **Цены**: защита на сервере, все расчёты в Edge Function create-order
- **Время заказа**: checkOrderTime() проверяет час в часовом поясе timezone
- **Сканер штрих-кодов**: BarcodeDetector API + Web Worker (scanner-worker.js)

## Безопасность

- `escapeHtml()` для всего вывода из БД
- Нет cookie/логирования посетителей
- service_role ключ только в Edge Functions
- Анонимный ключ Supabase только в клиентском коде

## Версии

- Service Worker: jock-nutrition-v52-2026-10-23
- Query params: styles.css?v=49, app.js?v=49
- Deploy marker: 2026-10-23-v1

## Юридические требования

- [ ] Заполнить реквизиты ИП в privacy.html (ИИН, ОГРНИП, ФИО, адрес, банк)
- [ ] Все БАДы должны быть зарегистрированы в реестре ЕАЭС
- [ ] Отсутствуют иностранные аналитики (Google Analytics и др.)
- [ ] Нет медицинских формулировок в описаниях товаров
- [ ] Политика конфиденальности соответствует 152-ФЗ