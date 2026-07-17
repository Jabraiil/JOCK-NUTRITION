# Инструкция по деплою JACK NUTRITION

## Этап 1: Настройка Supabase

### 1.1 Создание проекта
1. Зарегистрируйтесь на [supabase.com](https://supabase.com)
2. Создайте новый проект
3. Сохраните URL проекта и anon key (найдутся в Settings → API)

### 1.2 Создание таблиц
1. Откройте Supabase Dashboard
2. Перейдите в SQL Editor
3. Скопируйте содержимое файла `supabase/migrations/001_initial_schema.sql`
4. Вставьте в SQL Editor и нажмите Run
5. Должны создаться таблицы: categories, brands, products, product_images, product_links, settings, orders_analytics, order_counter, admin_users

### 1.3 Создание Storage bucket
1. Перейдите в Storage
2. Создайте bucket с именем `product-images`
3. Установите Public bucket = true
4. Настройте ограничения: размер файла до 5MB, типы: image/jpeg, image/png, image/webp

### 1.4 Создание первого админа
1. Перейдите в Table Editor → admin_users
2. Добавьте запись с вашим email
3. Или используйте Supabase Auth для создания пользователя

### 1.5 Включение Auth
1. Перейдите в Authentication → Providers
2. Убедитесь, что Email provider включен

---

## Этап 2: Настройка Edge Functions

### 2.1 Установка Supabase CLI
```bash
npm install -g supabase
```

### 2.2 Инициализация
```bash
cd C:\Users\JABRAIL\OneDrive\Рабочий стол\JACK NUTRITION
supabase init
supabase login
supabase link --project-ref ваш-project-id
```

### 2.3 Развертывание create-order
```bash
supabase functions deploy create-order --no-verify-jwt
```

После деплоя получите URL вида:
`https://ваш-project-id.supabase.co/functions/v1/create-order`

### 2.4 Развертывание admin-api
```bash
supabase functions deploy admin-api --no-verify-jwt
```

После деплоя получите URL вида:
`https://ваш-project-id.supabase.co/functions/v1/admin-api`

---

## Этап 3: Настройка фронтенда

### 3.1 Обновление конфигурации
Откройте `app.js` и обновите:

```javascript
const CONFIG = {
    supabaseUrl: 'https://your-project.supabase.co',
    supabaseAnonKey: 'your-anon-key',
    orderFunctionUrl: 'https://your-project.supabase.co/functions/v1/create-order',
    adminApiUrl: 'https://your-project.supabase.co/functions/v1/admin-api'
}
```

Замените на реальные значения из вашего Supabase проекта.

### 3.2 Локальный тест
Для локального тестирования используйте любой локальный сервер:
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

Откройте `http://localhost:8080` в браузере.

---

## Этап 4: Настройка админ-панели

### 4.1 Обновление конфигурации
Откройте `admin/app.js` и обновите:

```javascript
const CONFIG = {
    supabaseUrl: 'https://your-project.supabase.co',
    supabaseAnonKey: 'your-anon-key',
    adminApiUrl: 'https://your-project.supabase.co/functions/v1/admin-api',
    orderFunctionUrl: 'https://your-project.supabase.co/functions/v1/create-order'
}
```

### 4.2 Создание первого пользователя
1. Зарегистрируйтесь через форму входа
2. Добавьте свой email в таблицу `admin_users` через Supabase Dashboard

### 4.3 Тестирование
```bash
npx serve admin
```

Откройте `http://localhost:8080` и войдите под админом.

---

## Этап 5: Деплой на GitHub Pages

### 5.1 Создание репозитория
1. Создайте новый репозиторий на GitHub (например, `jack-nutrition`)
2. Не добавляйте README, .gitignore или лицензию (мы уже создали свои)

### 5.2 Загрузка файлов
```bash
cd C:\Users\JABRAIL\OneDrive\Рабочий стол\JACK NUTRITION
git init
git add .
git commit -m "Initial commit: JACK NUTRITION store"
git remote add origin https://github.com/username/jack-nutrition.git
git branch -M main
git push -u origin main
```

### 5.3 Включение GitHub Pages
1. Откройте репозиторий на GitHub
2. Settings → Pages
3. Source: Deploy from a branch
4. Branch: main / (root)
5. Сохраните

Сайт будет доступен по адресу:
`https://username.github.io/jack-nutrition/`

Админ-панель:
`https://username.github.io/jack-nutrition/admin/`

---

## Этап 6: Настройка домена (опционально)

Если у вас есть домен:

1. В папке `frontend` создайте файл `CNAME` с содержимым:
   ```
   shop.jack-nutrition.ru
   ```

2. В настройках DNS вашего домена добавьте:
   - A-запись: `185.199.108.153`
   - A-запись: `185.199.109.153`
   - A-запись: `185.199.110.153`
   - A-запись: `185.199.111.153`
   - Или CNAME: `username.github.io`

---

## Этап 7: Финальная проверка

### 7.1 Проверка фронтенда
- [ ] Каталог товаров отображается
- [ ] Фильтры работают
- [ ] Поиск работает
- [ ] Добавление в корзину работает
- [ ] Тёмная тема переключается
- [ ] Модальное окно товара открывается

### 7.2 Проверка админки
- [ ] Вход работает
- [ ] Товары отображаются
- [ ] Добавление товара работает
- [ ] Импорт Excel работает
- [ ] Экспорт работает
- [ ] Статистика отображается

### 7.3 Проверка заказов
- [ ] Заказ создаётся
- [ ] WhatsApp открывается
- [ ] В аналитике появляется запись
- [ ] Номер заказа генерируется

---

## Важные замечания

1. **Не загружайте на GitHub без запроса** - как указано в требованиях
2. **Храните ключи в безопасности** - не коммитьте .env файлы
3. **Регулярно делайте бэкапы** - используйте функцию резервного копирования в админке
4. **Проверяйте Edge Function** - мониторинг показывает статус
5. **WhatsApp номер** - должен быть в международном формате (например, 79991234567)

---

## Поддержка

При возникновении проблем проверьте:
1. Supabase логи (Logs → Edge Functions)
2. Консоль браузера (F12)
3. Настройки CORS в Supabase
