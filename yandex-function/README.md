# tm-cert-contact-yandex

Отдельный backend предварительных обращений: HTTP → SmartCaptcha → YDB Serverless, таблица `requests`. Runtime **Node.js 22**, entry point **index.handler** (CommonJS). Ничего не развёрнуто; frontend и выключающие его настройки не изменяются этим пакетом.

## Конфигурация версии функции

| Переменная | Источник / смысл |
|---|---|
| ENDPOINT | TLS endpoint YDB, начинается с `grpcs://` |
| DATABASE | Путь базы YDB, начинается с `/` |
| ALLOWED_ORIGIN | Точно `https://tm-cert.ru`, без завершающего `/` |
| CONSENT_VERSION | Фактический идентификатор редакции согласия, непустой |
| SMARTCAPTCHA_SERVER_KEY | Secret binding из Yandex Lockbox; не вводить в исходники, ZIP или обычный env-файл |

Привязанный service account должен иметь `ydb.editor` к базе и возможность получать выбранную версию секрета Lockbox. Таблица уже должна существовать с согласованной схемой. Функция не создаёт/изменяет таблицы или инфраструктуру. Нужны сетевой доступ к YDB, SmartCaptcha и локальному metadata service. Для будущей версии функции рекомендуется timeout 60 секунд (таймауты кода: CAPTCHA 5 с, metadata 3 с, готовность драйвера 10 с, операция YDB 5 с, ожидание вставки 12 с).

Авторизация YDB: `metadata.js` получает временный IAM-токен по фиксированному адресу metadata service привязанного service account. Он кешируется только в памяти, обновляется до истечения срока и не реже чем раз в 5 минут; параллельные запросы используют одно обновление. `ydb-sdk.TokenAuthService` превращает этот динамически полученный токен в gRPC metadata. Статических токенов/ключей нет; из HTTP-события и переменных окружения IAM-токен не читается. Дополнительный облачный SDK для этого не требуется.

## HTTP-контракт

Только OPTIONS и POST; прочие методы — 405. Origin сверяется буквально с `ALLOWED_ORIGIN`, wildcard и cookies не используются. OPTIONS разрешает POST и Content-Type. POST принимает `application/json` (включая charset=utf-8), до **16 KiB декодированных UTF-8 байтов**. Поддерживается стандартное HTTP-событие Yandex Cloud Functions, включая base64 body. Не используйте режим raw-интеграции, в котором отсутствуют поля HTTP-события.

Плоский JSON: requestId — обязательный UUID v4 в нижнем регистре; `name` 1–100, `contact` 3–100, `productName` 1–200, `message` 1–1500 символов после trim; `consent` строго true; `website` строка, пустая после trim; `captchaToken` непустая строка до 8192 символов. Все поля обязательны, лишние поля и вложенные значения запрещены. IP берётся только из `requestContext.identity.sourceIp`, если это валидный IP. Пользовательские forwarding-заголовки игнорируются.

SmartCaptcha проверяется только server-side, form-urlencoded POST к официальному validate endpoint. Требуются HTTP 200 и `status=ok`. Если `host` присутствует, принимается только `tm-cert.ru`; пустой, null или иной host отклоняется. Если поле host отсутствует, используется указанное в задаче условие `status=ok`. Любая сетевая ошибка, таймаут, неверный JSON или HTTP-код не 200 запрещает запись. Код намеренно не использует fail-open рекомендации примеров.

После CAPTCHA используется requestId клиента и создаётся UTC Date. Все девять полей записываются параметризованным YQL в `requests`, `created_at` передаётся как Timestamp, `consent` как Bool, остальные как Utf8. В одной SerializableReadWrite-транзакции проверяется конфликт данных по requestId и выполняется условная вставка только отсутствующего ID. Повтор того же обращения не изменяет первоначальные created_at, status и consent_version. Тот же ID с другими name/contact/productName/message/consent возвращает 409. Проверка и вставка атомарны; схема таблицы не меняется. Успех возвращается только после завершения транзакции (`AUTO_TX`, commitTx).

Успех: HTTP 200 `{"ok":true,"requestId":"..."}`. Ошибки 400/403/405/413/415/502/503 содержат только общее сообщение без requestId, внутренних ошибок, SQL, токенов или CAPTCHA-ответа. Стек не сериализуется. Код приложения ничего не логирует, logger SDK отключён. CAPTCHA, IP и honeypot не сохраняются в YDB. Telegram не подключён.

## Схема существующей таблицы

`id Utf8 PRIMARY KEY`, `created_at Timestamp`, `name Utf8`, `contact Utf8`, `product_name Utf8`, `message Utf8`, `consent Bool`, `consent_version Utf8`, `status Utf8`.

## Локальная проверка и ZIP

Из этой директории с Node.js 22:

```sh
npm install
npm test
npm audit --omit=dev
```

Тесты мокают HTTP, metadata и YDB, не используют облачные secrets и не создают реальные обращения. Проверяются также реальные типы/параметры установленного SDK. Зависимость `ydb-sdk` зафиксирована на **5.11.1**; полный набор фиксирует package-lock.json.

В PowerShell: `./package.ps1`. Скрипт собирает только `index.js`, `ydb.js`, `metadata.js`, `package.json`, `package-lock.json`. Они находятся непосредственно в корне `tm-cert-contact-yandex.zip`. Тесты, README, node_modules, `.env`, Git-файлы и локальные артефакты в ZIP не входят. Yandex Cloud установит зависимости из package.json/package-lock.json при создании версии функции.

Перед будущей публикацией потребуется отдельно проверить конфигурацию аккаунта/Lockbox, наличие таблицы и доступы. Локальные mock-тесты не подтверждают доступность конкретной облачной базы. Форма сайта остаётся выключенной; этот пакет не подключает SmartCaptcha к frontend. Не включать без отдельного разрешения и согласования фактических условий обработки данных.

При потере ответа после commit клиент показывает неопределённый результат. Повтор с новой CAPTCHA и прежним requestId возвращает успех без новой записи. Frontend сохраняет UUID и SHA-256 отпечаток полей в sessionStorage до отправки (без исходных полей), переиспользует ID после reload в той же вкладке; изменённые поля получают новый ID. После закрытия вкладки/очистки storage новый ID считается новым обращением. Это защита повторной попытки, а не глобальная дедупликация независимых обращений. При недоступном storage отправка блокируется. Содержимое событий/тела нельзя включать в внешние access/debug-логи. Ротация и хранение секретов остаются в Lockbox.

Официальные источники: [HTTP-событие](https://yandex.cloud/en/docs/functions/concepts/function-invoke), [metadata service в Functions](https://yandex.cloud/en/docs/functions/operations/function-sa), [SmartCaptcha](https://yandex.cloud/ru/docs/smartcaptcha/concepts/validation), [установка зависимостей из ZIP](https://yandex.cloud/ru/docs/functions/lang/nodejs/dependencies), [ydb-sdk](https://www.npmjs.com/package/ydb-sdk).

## Перед включением формы

Эту версию backend нужно отдельно развернуть и проверить в Yandex Cloud до включения frontend: старый handler не принимает requestId. Публикация GitHub Pages не развёртывает Function. PUBLIC_CONTACT_FORM_ENABLED=false, PUBLIC_SITE_LIVE=false и legal.ready=false сохраняются. Клиент ждёт 65 секунд (дольше рекомендованного timeout функции 60 секунд); от дублей защищает транзакция, а не таймер. Реальная проверка YQL и конкурентных повторов в YDB требуется перед включением, локальные тесты используют mock.
