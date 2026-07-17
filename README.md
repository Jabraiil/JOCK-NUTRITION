# JACK NUTRITION - Интернет-магазин БАДов

Статический сайт на GitHub Pages с Supabase backend.

## Структура проекта

```
├── index.html          # Главная страница витрины
├── styles.css          # Стили витрины
├── app.js              # Логика витрины
├── admin/              # Админ-панель
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── supabase/           # Supabase конфигурация
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── functions/
│       ├── create-order/
│       │   └── index.ts
│       └── admin-api/
│           └── index.ts
├── DEPLOYMENT.md       # Инструкция по деплою
├── PROJECT_CONTEXT.md  # Технический документ проекта
└── README.md
```

## Быстрый старт

### 1. Настройка Supabase

1. Создайте проект на [supabase.com](https://supabase.com)
2. В разделе SQL Editor выполните миграцию: `supabase/migrations/001_initial_schema.sql`
3. В разделе Storage создайте bucket `product-images` (public)
4. Создайте первого админа в таблице `admin_users`

### 2. Настройка Edge Functions

1. Установите Supabase CLI: `npm install -g supabase`
2. Инициализируйте проект: `supabase init`
3. Создайте функции:
   - `create-order` из `supabase/functions/create-order/index.ts`
   - `admin-api` из `supabase/functions/admin-api/index.ts`
4. Разверните: `supabase functions deploy create-order` и `supabase functions deploy admin-api`

### 3. Настройка фронтенда

Отредактируйте `frontend/app.js`, заменив:
- `CONFIG.supabaseUrl` на URL вашего проекта
- `CONFIG.supabaseAnonKey` на anon key из настроек проекта
- `CONFIG.orderFunctionUrl` на URL функции create-order

### 4. Настройка админки

Отредактируйте `admin/app.js`, заменив:
- `CONFIG.supabaseUrl` на URL вашего проекта
- `CONFIG.supabaseAnonKey` на anon key из настроек проекта
- `CONFIG.adminApiUrl` на URL функции admin-api

### 5. Деплой на GitHub Pages

1. Создайте репозиторий на GitHub
2. Загрузите файлы (frontend в корень, admin в папку admin)
3. В настройках репозитория включите GitHub Pages из ветки main
4. Сайт будет доступен по адресу: `username.github.io/repo-name/`

## Функционал

### Публичная часть
- Каталог товаров с фильтрами и поиском
- Сканирование штрих-кодов
- Корзина с localStorage
- Оформление заказа через WhatsApp
- Тёмная/светлая тема
- Адаптивная вёрстка (2 колонки на мобильных)

### Админ-панель (/admin)
- Управление товарами (CRUD)
- Управление категориями и брендами
- Импорт/экспорт Excel
- Статистика продаж
- Настройки магазина
- Резервное копирование
- Мониторинг Edge Function

## Безопасность

- Нет логирования посетителей
- Нет кук для идентификации
- Все цены проверяются на сервере
- Аналитика только обезличенные данные
