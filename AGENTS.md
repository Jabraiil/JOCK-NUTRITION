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

## Code Style

- Vanilla JS, ES2020+, модулей нет (браузерный `<script>`)
- CSS: CSS Grid + Flexbox, `clamp()` для адаптивности, CSS-переменные для тем
- Нет сборки, нет транспиляции, всё статические файлы

## Boundaries

**Always do:**
- Сохранять пути относительными (`./`) для GitHub Pages
- Соблюдать mobile-first и iOS-стиль (44pt touch targets)
- Использовать `escapeHtml()` для всего вывода из БД

**Never do:**
- Не коммитить секреты/ключи
- Не изменять RLS-политики без явного запроса
- Не добавлять cookie/логирование посетителей
- Не ломать относительные пути в манифесте и HTML
