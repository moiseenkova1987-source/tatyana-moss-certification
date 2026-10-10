# Форма заявки: подготовка и отдельное включение

Схема: Astro на GitHub Pages → JSON POST к Worker → валидация → Turnstile Siteverify → Telegram Bot API. Backend находится в `worker/`, обработчик доставки вынесен в `deliverNotification`: здесь можно позднее добавить email. Заявки не сохраняются в базе, GitHub или браузерном хранилище. Успех означает подтверждение Telegram API, а не прочтение сообщения владельцем.

**Сейчас ничего не включено и не опубликовано.** `.env.example` и GitHub workflow оставляют `PUBLIC_CONTACT_FORM_ENABLED=false`. Пока false, нет запросов к Worker и загрузки Turnstile. Настройки сайта: `https://tm-cert.ru`, base `/`, `PUBLIC_SITE_LIVE=false`; noindex/nofollow сохраняются независимо от формы. DNS и Pages менять не нужно.

## Пошаговая настройка после отдельного разрешения

1. В Cloudflare создайте отдельный Worker `tm-cert-contact` (Workers & Pages). Для CLI из `worker/` используйте `pnpm dlx wrangler@4 login`; проверьте выбранный аккаунт. Конфигурация `wrangler.jsonc` не содержит маршрутов домена: Worker будет доступен по собственному `workers.dev` URL, сайт остаётся на GitHub Pages. `pnpm dlx wrangler@4 deploy` публикует **только Worker**; сейчас эту команду не выполнять.
2. Создайте Telegram-бота через официальный BotFather и приватный чат с ним. Отправьте боту `/start`. Получите chat ID для этого приватного чата, проверив ответ Bot API в своём защищённом окружении. Не публикуйте токен в командах, скриншотах, issue или документации.
3. В Worker → Settings → Variables and Secrets добавьте **secrets** `TURNSTILE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Альтернатива из `worker/`: `pnpm dlx wrangler@4 secret put ИМЯ` — значение вводится в приглашении, не в аргументе команды. Здесь нужны настоящие значения, которых в проекте нет.
4. В Cloudflare Turnstile создайте Managed widget, разрешите `tm-cert.ru` и `www.tm-cert.ru`. Site key публичный, secret key только для Worker. Frontend использует action `contact`; Worker проверяет success, action и hostname, совпадающий с Origin. Настройка widget должна сохранить эту связку.
5. Полученный HTTPS Worker URL внесите в `PUBLIC_CONTACT_API_URL`; site key — в `PUBLIC_TURNSTILE_SITE_KEY`. Для GitHub сборки это одноимённые repository Variables, **не secrets backend**. Переменная `PUBLIC_CONTACT_FORM_ENABLED` в workflow пока явно false: позднее включение потребует отдельно согласованной замены на true и пересборки. В локальной `.env` можно тестировать независимо от workflow.
6. До реальных заявок заполните `site.legal.operator/address/inn/retention`, актуализируйте политику и согласие под фактическую передачу через Cloudflare и Telegram. Только после этой проверки меняется `legal.ready=true`. Этот дополнительный предохранитель сохранён. Выбор иностранных обработчиков и условия передачи/хранения персональных данных требуют отдельной правовой оценки; текущие тексты нельзя считать уже согласованными для этой схемы.
7. Проведите тестовую публикацию отдельного development Worker/виджета и тестового бота, затем тест реальной доставки только с синтетическими данными. Проверьте invalid email, URL, отсутствие согласия, honeypot, пустой/просроченный token, отказ Turnstile, отказ Telegram, таймаут, повторный клик и мобильный экран. Production allowlist — только два HTTPS origin выше; localhost разрешён **только** при `ENVIRONMENT=development`.
8. После успешного теста и отдельного разрешения задайте `PUBLIC_CONTACT_FORM_ENABLED=true` для нужной сборки. Нужны также HTTPS API URL, site key, правовая готовность и контактный email. Затем пересоберите сайт; это не требует и не разрешает включать индексацию.
9. Для отключения верните flag false и пересоберите/опубликуйте сайт. Удалять Worker не требуется. Уже закешированная/открытая версия страницы может действовать до обновления; для немедленного прекращения приёма отключите Worker отдельно в Cloudflare.

## Локальная разработка

Скопируйте `worker/.dev.vars.example` в **неотслеживаемый** `worker/.dev.vars.development`, внесите только тестовые значения. Из `worker/` запустите `pnpm dlx wrangler@4 dev --env development`. Он обращается к настоящим внешним API: используйте тестовый бот. Production конфигурация не принимает localhost. Локальный frontend требует development HTTPS endpoint (или отдельную локальную HTTPS-прокси); HTTPS-предохранитель фронтенда намеренно не отключается. `pnpm test:worker` и browser QA используют имитации и вообще не требуют секретов.

## API и ограничения

POST `application/json` (допустим `charset=utf-8`), максимум 16 KiB, без cookies. Разрешён только плоский объект:

| Поле | Ограничение |
|---|---|
| name | обязательное, 100 символов |
| contact | обязательное, 3–100 |
| email | обязательное, формат email, 254 |
| productName | обязательное, 200 |
| productUrl | необязательно, http(s), без логина/пароля, 1000 |
| message | необязательно, 1500 |
| consent | строго boolean true |
| website | honeypot, пустое, максимум 200 |
| turnstileToken | обязательное, максимум 2048 |

Все строки trim. Дополнительные поля, массивы, объекты вместо строк отклоняются. `OPTIONS` используется только для CORS preflight POST/Content-Type. Ответ успеха: HTTP 200 `{"ok":true}` после успешного sendMessage. Ошибки: 400/403/405/413/415/502/503 с общим сообщением; никаких секретов, upstream descriptions или stack traces. Уведомления — plain text без parse_mode, предпросмотр ссылок выключен. Таймаут каждого внешнего API 8 секунд, frontend 20 секунд. Нет автоматических повторов.

Токены Turnstile одноразовые и действуют 5 минут; frontend сбрасывает widget после каждого запроса. Кнопка блокирует повторный клик. При неоднозначном сетевом сбое повторная ручная отправка может дать дубль: постоянной очереди/идемпотентного хранилища здесь нет. CORS сам по себе не защищает от клиента с поддельным Origin; защиту дополняет Turnstile, при росте нагрузки потребуется отдельное ограничение частоты запросов. В коде нет логирования заявок; observability выключена в конфигурации. Служебные метаданные платформы и сообщения в Telegram регулируются настройками провайдеров.

Проверки: `pnpm check`, `pnpm build`, `pnpm audit:site`, `pnpm test:worker`. Browser QA запускается по README; он перехватывает только локальные запросы и имитирует Turnstile/Worker. Реальные секреты нельзя передавать в PUBLIC_*: они попадут в статическую сборку.

Официальные источники: [Turnstile Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [виджет](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/), [секреты Worker](https://developers.cloudflare.com/workers/configuration/secrets/), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage).
