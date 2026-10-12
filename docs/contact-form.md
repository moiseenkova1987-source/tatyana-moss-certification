# Предварительное обращение: форма выключена

Форма сайта предназначена только для предварительного вопроса. Она не является заказом услуги, не означает заключение договора; оплаты через сайт нет. Оператор — Татьяна Моисеенкова, контакт tatyana.moiseenk@mail.ru. Предпринимательский статус не заявляется.

## Текущее состояние

PUBLIC_CONTACT_FORM_ENABLED=false, legal.ready=false, PUBLIC_SITE_LIVE=false. Workflow сохраняет PUBLIC_SITE_LIVE=false и читает PUBLIC_CONTACT_FORM_ENABLED из Repository Variables с безопасным значением false по умолчанию. legal.ready=false дополнительно блокирует активацию. При выключенной форме в HTML пустые data-endpoint/data-sitekey, кнопка disabled; клиент не загружает SmartCaptcha и не обращается к API. Сайт использует https://tm-cert.ru и base /, noindex/nofollow.

Четыре обязательных поля: name (100), contact (100, минимум 3), productName (200), message (1500). E-mail и ссылка на товар удалены из интерфейса и payload нового клиента. Согласие — отдельный unchecked required checkbox, ссылка /consent/. Политика доступна отдельно по /privacy/. Прямые контакты Telegram, MAX, телефон и e-mail сохранены.

## Условия будущего запуска

До реальной отправки нужно выбрать российскую инфраструктуру и обеспечить первичную запись и хранение обращений в базах данных на территории РФ. Затем указать поставщика и фактический процесс в Политике/согласии, подготовить и проверить российский backend. Только после этого возможно отдельно согласовать активацию формы. Изменение одного флага не заменяет эти условия.

Текущий Cloudflare Worker не используется для production-сбора данных этой формы. Его исходники сохранены для разработки; эта публикация сайта не развёртывает Worker и не меняет его secrets или настройки. PUBLIC_CONTACT_API_URL и PUBLIC_SMARTCAPTCHA_CLIENT_KEY сами по себе не включают отправку. Не включайте форму с существующим Worker endpoint.

## Текущий frontend/backend контракт

Подготовленная интеграция использует Yandex Cloud Function из PUBLIC_CONTACT_API_URL. POST application/json содержит ровно name, contact, productName, message, consent (true), website (пустой honeypot), captchaToken. Ожидается HTTP 200 с {"ok":true,"requestId":"..."}; ошибки показываются без внутренних данных.

src/scripts/contact-form.ts загружает официальный https://smartcaptcha.cloud.yandex.ru/captcha.js через расширенный onload-метод, только если форма разрешена. PUBLIC_SMARTCAPTCHA_CLIENT_KEY — публичный клиентский ключ. Серверный ключ хранится исключительно в Yandex Lockbox, frontend его не использует. Токен берётся через smartCaptcha.getResponse; истечение токена, сетевые и критические ошибки блокируют отправку. При критической ошибке требуется перезагрузка страницы.

GitHub Actions передаёт PUBLIC_SMARTCAPTCHA_CLIENT_KEY и PUBLIC_CONTACT_FORM_ENABLED из Repository Variables; не устанавливайте флаг true до отдельного согласования запуска. Текущая форма остаётся выключенной. Backend yandex-function и внешние настройки этим изменением не затрагиваются.

## Код разработки

worker/src/index.js — изолированный прототип. Он принимает JSON, проверяет Origin, типы, размеры, согласие, honeypot и Turnstile; доставка Telegram вынесена в отдельную функцию. Для совместимости старые необязательные email/productUrl допускаются и валидируются при заполнении; новый клиент их не передаёт. Вопрос обязателен. Этот код не предоставляет российское первичное хранение и не является готовым production backend для текущей формы.

Secrets прототипа: TURNSTILE_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID — только bindings, без значений в репозитории. Локальные .dev.vars.* и .wrangler исключены из Git. Тесты используют фиктивные данные и имитации внешних API. Никакой реальной отправки во время проверки нет.

## Проверки

pnpm check; pnpm build; pnpm audit:site; pnpm test:worker. Browser QA проверяет выключенное состояние, отсутствие запросов, обязательные поля и согласие, имитацию отправки, мобильные экраны и текст 200%. До будущего запуска отдельно проверить российский backend и соответствие фактического процесса правовым страницам.
