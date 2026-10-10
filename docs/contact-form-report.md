# Локальный отчёт — 10 октября 2026

Подготовка завершена. Commit, push, deploy Worker/сайта, изменения DNS/Pages и production env **не выполнялись**. Реальных секретов нет, реальная доставка Telegram не запускалась. Форма остаётся выключенной. Проект готов к отдельно разрешённой тестовой публикации Worker после создания тестового виджета/бота и настройки secrets.

## Файлы

Изменены:

- `.env.example` — новые публичные параметры, flag false.
- `.github/workflows/deploy.yml` — API URL/site key из Variables, включение явно false.
- `.gitignore` — исключение локальных secrets и состояния Wrangler.
- `README.md` — ссылка на инструкцию нового backend вместо прежнего протокола.
- `package.json` — команда `test:worker`, без новых зависимостей.
- `scripts/release-check.mjs` — проверки новых параметров формы.
- `scripts/browser-qa.mjs` — сценарии нового протокола и имитация Turnstile/API.
- `src/components/Form.astro` — flag, honeypot, место под виджет, вынос клиентской логики, сохранение прямых контактов при любом состоянии.
- `qa/browser-report.json` — результаты дополненных проверок.

Созданы:

- `src/scripts/contact-form.ts` — загрузка Turnstile только при готовой включённой форме, валидация, loading/success/error, блокировка повторного submit, сброс widget и focus результата.
- `worker/src/index.js` — Worker, ограничения тела/JSON, CORS, server-side verification и отдельная функция доставки Telegram.
- `worker/wrangler.jsonc` — отдельный Worker, production/development, observability выключена; без DNS routes.
- `worker/.dev.vars.example` — пустые образцы secret bindings, без реальных значений.
- `worker/test/contact.test.mjs` — 23 backend-теста без сетевых запросов.
- `docs/contact-form.md` — настройка, контракт API, ограничения, ручное включение/отключение.
- `docs/contact-form-report.md` — этот отчёт.

Скриншоты в `qa/screenshots/` не отслеживаются Git. Стили, контакты, изображения, сервисные тексты, страницы и SEO-конфигурация не менялись. Старый `PUBLIC_FORM_ENDPOINT` заменён новым `PUBLIC_CONTACT_API_URL`; старое значение больше не может активировать форму.

## Ключевые изменения (сокращённый diff)

```diff
-PUBLIC_FORM_ENDPOINT=
+PUBLIC_CONTACT_FORM_ENABLED=false
+PUBLIC_CONTACT_API_URL=
+PUBLIC_TURNSTILE_SITE_KEY=
```

```diff
-enabled = HTTPS endpoint && legal.ready && operator && email
+enabled = flag === 'true' && HTTPS API URL && site key && legal.ready && operator && email
-product / comment / consent: 'accepted' / subject / requestId
+productName / message / consent: true / website / turnstileToken
```

Обязательные поля сохранены; лимиты ссылки/комментария согласованы с backend (1000/1500 символов), чтобы уведомление помещалось в лимит Telegram. Серверный HTML всегда содержит disabled button: JavaScript включает её только после получения token. Нативная GET-отправка предотвращена, включая ошибку загрузки виджета; данные не уходят в URL. При false Turnstile даже не загружается.

## Архитектура и конфигурация

Astro/GitHub Pages → Worker JSON endpoint → ограничение Origin/Content-Type/размера/полей → Turnstile Siteverify (success, hostname, action=contact) → `deliverNotification` → Telegram `sendMessage` → `{ok:true}` только после подтверждения Telegram. HTML/Markdown parse_mode не используется, ссылки не получают предпросмотр. Заявки не пишутся в БД, GitHub, localStorage или console. CORS только для `https://tm-cert.ru` и `https://www.tm-cert.ru`; localhost допускается только отдельным development env.

Публичные параметры: `PUBLIC_CONTACT_FORM_ENABLED=false`, `PUBLIC_CONTACT_API_URL` (пока пусто), `PUBLIC_TURNSTILE_SITE_KEY` (пока пусто). Backend secrets: `TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Значения secrets отсутствуют в исходниках и сборке, `.dev.vars.*` исключены из Git. В тестах используются очевидные фиктивные значения.

Вручную, **после отдельного разрешения**: создать отдельный Worker/тестовый Telegram-бот/Turnstile Managed widget, внести secrets в Cloudflare, получить Worker URL/site key, проверить доставку синтетической заявки; подготовить фактические правовые тексты/реквизиты перед реальными пользователями; затем отдельно согласовать активацию feature flag и публикацию frontend. Полная последовательность в `contact-form.md`. DNS и custom domain для этого менять не нужно.

## Проверки

| Проверка | Результат |
|---|---|
| pnpm check | 36 файлов; 0 errors/warnings/hints |
| pnpm build | успешно, 14 HTML-страниц |
| pnpm audit:site | 14 HTML, 13 sitemap URL, 0 ошибок |
| pnpm test:worker | 23/23 успешны; внешние API имитированы |
| Browser QA production build (Edge) | 52 проверки страниц, 10 проверок текста 200%, 0 ошибок |
| Активная форма с имитациями | пустая форма/email/URL/согласие/token, успех/ошибка, reset/сохранение текста/focus/двойной submit, mobile/200% — успешно |
| Выключенная форма | disabled, consent unchecked, нет загрузки Turnstile/POST-запросов |
| Dist проверка | все 14 страниц: canonical tm-cert.ru, noindex/nofollow, форма выключена, нет старого base path и backend secrets |
| robots.txt | Disallow: /; Sitemap: https://tm-cert.ru/sitemap.xml |
| git diff --check | без ошибок |

Server-side сценарии honeypot/отсутствие token/отказ Turnstile/отказ Telegram, строгие типы/лишние ключи/размер/origin/method/content type также проверены тестами. Два прежних предупреждения Rollup о комментариях Zod остаются; сборку не блокируют. Lint-команды в проекте нет. Первоначальная ошибка QA-подстановки пустых HTML-атрибутов исправлена; последний прогон полностью успешен.

`PUBLIC_SITE_URL=https://tm-cert.ru`, `PUBLIC_BASE_PATH=/`, `PUBLIC_SITE_LIVE=false` сохранены. Индексация не включалась. Canonical, sitemap, JSON-LD, существующие метаданные и URL не изменялись.

## Оставшиеся ограничения

- Настоящий Worker runtime, widget и Telegram delivery требуют отдельного тестового deployment: текущие проверки локальные, без реальных ключей/аккаунта.
- Cloudflare и Telegram — внешние обработчики: до реального сбора данных надо оценить правовую допустимость и актуализировать согласие/политику. `legal.ready` по-прежнему false.
- Нет постоянной очереди/хранилища/идемпотентного учёта: при сетевом сбое после доставки возможен дубль при ручном повторе. Успех означает приём сообщения Bot API, не прочтение экспертом.
- CORS не заменяет защиту от ботов; Turnstile обязателен. При росте нагрузки потребуется дополнительное ограничение частоты запросов.
- Служебные метаданные провайдеров и хранение Telegram-сообщений регулируются настройками их платформ, даже при отсутствии логов в нашем коде.

На этом работа остановлена до отдельного разрешения на commit/push/deploy/активацию.
