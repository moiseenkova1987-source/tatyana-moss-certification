// Development reference only. Do not use for production personal-data collection.
// The public form stays disabled until a Russian backend is selected and reviewed.
// No request bodies, identifiers or upstream errors are logged or persisted.
const MAX_BYTES = 16384;
const ERROR = 'Не удалось отправить заявку. Попробуйте ещё раз или свяжитесь со мной напрямую.';
const keys = new Set([
  'name',
  'contact',
  'email',
  'productName',
  'productUrl',
  'message',
  'consent',
  'website',
  'turnstileToken',
]);
const limits = {
  name: 100,
  contact: 100,
  email: 254,
  productName: 200,
  productUrl: 1000,
  message: 1500,
  website: 200,
  turnstileToken: 2048,
};

function origins(env) {
  const production = ['https://tm-cert.ru', 'https://www.tm-cert.ru'];
  return env.ENVIRONMENT === 'development'
    ? [
        ...production,
        'http://localhost:4321',
        'http://127.0.0.1:4321',
        'http://localhost:4322',
        'http://127.0.0.1:4322',
      ]
    : production;
}

function reply(status, origin, body = { ok: false, error: ERROR }) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (status === 204) {
    headers['Access-Control-Allow-Methods'] = 'POST';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  if (status === 405) headers.Allow = 'POST, OPTIONS';
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new RangeError();
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new RangeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function validate(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.has(key))
  )
    return null;
  const data = {};
  for (const [key, max] of Object.entries(limits)) {
    if (input[key] !== undefined && typeof input[key] !== 'string') return null;
    const value = (input[key] ?? '').trim();
    if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
      return null;
    data[key] = value;
  }
  if (
    input.consent !== true ||
    data.website ||
    !data.name ||
    data.contact.length < 3 ||
    !data.productName ||
    !data.message ||
    !data.turnstileToken
  )
    return null;
  // Legacy optional fields remain accepted for development clients only.
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(data.email)) return null;
  if (data.productUrl) {
    try {
      const link = new URL(data.productUrl);
      if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password)
        return null;
    } catch {
      return null;
    }
  }
  return data;
}

async function timedJson(fetcher, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error('Upstream unavailable');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function deliverNotification(data, origin, env, fetcher = fetch) {
  // Plain text: no HTML/Markdown parse mode, so user content cannot create markup.
  const text = [
    'Новая заявка с tm-cert.ru',
    '',
    `Имя: ${data.name}`,
    `Телефон / Telegram: ${data.contact}`,
    `E-mail: ${data.email || '—'}`,
    `Товар: ${data.productName}`,
    `Ссылка: ${data.productUrl || '—'}`,
    `Комментарий: ${data.message || '—'}`,
    '',
    `Источник: ${origin}`,
    `Дата/время (UTC): ${new Date().toISOString()}`,
    'Согласие: принято, версия 1.0',
  ].join('\n');
  const result = await timedJson(
    fetcher,
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        link_preview_options: { is_disabled: true },
      }),
    },
  );
  if (result.ok !== true) throw new Error('Delivery failed');
}

export async function handleRequest(request, env, fetcher = fetch) {
  const origin = request.headers.get('Origin');
  if (!origins(env).includes(origin)) return reply(403, null);
  if (request.method === 'OPTIONS') {
    const requested = (request.headers.get('Access-Control-Request-Headers') || '')
      .toLowerCase()
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (
      request.headers.get('Access-Control-Request-Method') !== 'POST' ||
      requested.some((v) => v !== 'content-type')
    )
      return reply(403, origin);
    return reply(204, origin);
  }
  if (request.method !== 'POST') return reply(405, origin);
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '')
  )
    return reply(415, origin);
  let input;
  try {
    input = await readBody(request);
  } catch (error) {
    return reply(error instanceof RangeError ? 413 : 400, origin);
  }
  const data = validate(input);
  if (!data) return reply(400, origin);
  if (!env.TURNSTILE_SECRET_KEY || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID)
    return reply(503, origin);
  try {
    const verification = await timedJson(
      fetcher,
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: data.turnstileToken }),
      },
    );
    // Match the hostname to the actual allowed origin, and bind tokens to this form action.
    if (
      verification.success !== true ||
      verification.action !== 'contact' ||
      verification.hostname !== new URL(origin).hostname
    )
      return reply(400, origin);
    await deliverNotification(data, origin, env, fetcher);
    return reply(200, origin, { ok: true });
  } catch {
    return reply(502, origin);
  }
}

export default { fetch: (request, env) => handleRequest(request, env) };
