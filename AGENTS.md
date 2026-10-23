# AGENTS.md

## Project Overview

**JOCK NUTRITION** — статический интернет-магазин БАДов на vanilla JS + Supabase. Деплоится на GitHub Pages.

## Commands

- Install: `npm install`
- Start: `npm start`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`

## Architecture

- `index.html`, `styles.css`, `app.js` — публичная витрина
- `admin/` — админ-панель (отдельный HTML/CSS/JS)
- `sw.js` — Service Worker (кеширование, обновление)
- `manifest.json` — PWA манифест
- `package.json` — только `xlsx` для импорта/экспорта
- `supabase/functions/` — Edge Functions (create-order, admin-api)

## Code Style

- Vanilla JS, ES2020+, модулей нет (браузерный `<script>`)
- CSS: CSS Grid + Flexbox, `clamp()` для адаптивности, CSS-переменные для тем
- Нет сборки, нет транспиляции, всё статические файлы
- Mobile-first, iOS-стиль на мобильных (44pt touch targets)
- Системные шрифты: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif
- Цвета: iOS-стиль (#007AFF акцент, #F2F2F7 светлый фон, #000/#1C1C1E тёмный)

## Key Patterns

- **Корзина**: localStorage 'jock-cart', только `{id, quantity}`
- **Избранное**: localStorage 'jock-favorites`, массив UUID
- **Настройки**: из admin-api/settings, кэш в `window.__storeSettings`
- **Цены**: защита на сервере, все расчёты в Edge Function create-order
- **Время заказа**: checkOrderTime() проверяет час в часовом поясе timezone
- **Сканер штрих-кодов**: BarcodeDetector API + Web Worker (scanner-worker.js)
- **Связанные товары**: product_related (явные) или по категории/бренду

## Boundaries

**Always do:**
- Сохранять пути относительными (`./`) для GitHub Pages
- Соблюдать mobile-first и iOS-стиль (44pt touch targets)
- Использовать `escapeHtml()` для всего вывода из БД
- Использовать `clamp()` для адаптивных шрифтов
- Кэшировать API ответы (apiCache в app.js)

**Never do:**
- Не коммитить секреты/keys
- Не изменять RLS-политики без явного запроса
- Не добавлять cookie/логирование посетителей
- Не ломать относительные пути в манифесте и HTML
- Не использовать модули/транспиляцию

## Supabase

- URL: https://hpphfeojjejculvdundj.supabase.co
- anon key: sb_publishable_1EGpjPEw9gU2W5OKL-gFIQ_x4Gvger1
- Edge Functions: create-order, admin-api
- Storage bucket: product-images (public, до 5MB)
- RLS: публичный SELECT для таблиц, service_role для записи

## Version Info

- Service Worker: jock-nutrition-v51-2026-09-11
- Query params: styles.css?v=48, app.js?v=48
- Deploy marker: 2026-09-02-v2