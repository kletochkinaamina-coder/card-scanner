# Сканер карт

Веб-приложение: камера телефона -> OCR (Tesseract.js, в браузере) -> номер карты, ИИН, срок действия -> таблицы по годам срока действия -> выгрузка Excel/CSV.

Данные никуда не отправляются, хранятся в localStorage браузера.

## Запуск локально

```bash
npm install
npm run dev
```

Камера работает только по HTTPS или на localhost.

## Деплой на Vercel

1. Залить папку `card-scanner` в GitHub-репозиторий.
2. На vercel.com -> Add New Project -> выбрать репозиторий.
3. Framework: Next.js (определится автоматически). Нажать Deploy.

Или через CLI:

```bash
npx vercel --prod
```
