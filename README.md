# JOCK NUTRITION

Интернет-магазин биологически активных добавок (БАДов). Статический фронтенд на vanilla JS + Supabase backend.

## О проекте

- **Фронтенд**: статические файлы на GitHub Pages (`index.html`, `styles.css`, `app.js`)
- **Бэкенд**: Supabase (PostgreSQL, Edge Functions, Storage)
- **Админка**: отдельный интерфейс в папке `admin/`
- **Заказы**: через WhatsApp с проверкой цен на сервере
- **PWA**: Service Worker + манифест для установки на главный экран

## Как запустить

### Предварительные требования

- Аккаунт GitHub
- Аккаунт Supabase
- Node.js (для установки зависимостей)

### Локальный запуск

```bash
git clone https://github.com/Jabraiil/JOCK-NUTRITION.git
cd JOCK-NUTRITION
npm install
```

Откройте `index.html` в браузере или используйте любой статический сервер:

```bash
npx serve .
```

### Деплой на GitHub Pages

1. Settings → Pages → Source: Deploy from a branch → `main` → `/ (root)`
2. Убедитесь, что файл `.nojekyll` находится в корне репозитория

## Структура проекта

```
├── index.html              # Главная страница витрины
├── styles.css              # Стили (светлая/тёмная тема)
├── app.js                  # Логика фронтенда
├── sw.js                   # Service Worker
├── scanner-worker.js       # Web Worker для сканера штрих-кодов
├── manifest.json           # PWA манифест
├── privacy.html            # Политика конфиденциальности
├── offline.html            # Страница офлайн-режима
├── robots.txt              # Robots exclusion
├── .nojekyll               # Отключает Jekyll на GitHub Pages
├── package.json            # Зависимости (xlsx для импорта/экспорта)
├── .gitignore
├── AGENTS.md               # Инструкции для AI-агентов
├── PROJECT_CONTEXT.md      # Техническая документация проекта
├── README.md
├── admin/
│   ├── index.html          # Админ-панель
│   ├── styles.css          # Стили админки
│   └── app.js              # Логика админки
└── assets/
    └── icons/              # Иконки PWA
```

## Технологии

- **Фронтенд**: Vanilla JS, CSS Grid/Flexbox, no frameworks
- **Бэкенд**: Supabase (PostgreSQL, Edge Functions)
- **PWA**: Service Worker, Web App Manifest
- **Импорт/экспорт**: SheetJS (`xlsx`)

## Скрипты

```bash
npm start      # Информация о запуске
npm run lint   # Проверка стиля (заглушка)
npm run typecheck  # Проверка типов (заглушка)
```

## Лицензия

MIT
