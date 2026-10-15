'use strict';

const { isIP } = require('node:net');
const MAX_BYTES = 16 * 1024;
const ERROR = 'Не удалось отправить обращение. Попробуйте ещё раз.';
const LIMITS = {
  name: [1, 100],
  contact: [3, 100],
  productName: [1, 200],
  message: [1, 1500],
  website: [0, 0],
  captchaToken: [1, 8192],
};
const KEYS = new Set([...Object.keys(LIMITS), 'consent', 'requestId']);

function header(event, name) {
  const values = Object.entries(event.headers || {})
    .filter(([key]) => key.toLowerCase() === name)
    .map(([, value]) => value);
  const multiple = Object.entries(event.multiValueHeaders || {}).filter(
    ([key]) => key.toLowerCase() === name,
  );
  for (const [, list] of multiple) {
    if (!Array.isArray(list) || list.length !== 1) return null;
    values.push(list[0]);
  }
  return values.length && values.every((value) => typeof value === 'string' && value === values[0])
    ? values[0]
    : null;
}

function allowedOrigin(env) {
  try {
    const url = new URL(env.ALLOWED_ORIGIN);
    return url.protocol === 'https:' && url.origin === env.ALLOWED_ORIGIN ? url.origin : null;
  } catch {
    return null;
  }
}

function reply(statusCode, origin, value = { ok: false, error: ERROR }) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (statusCode === 405) headers.Allow = 'OPTIONS, POST';
  if (statusCode === 204) {
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return {
    statusCode,
    headers,
    isBase64Encoded: false,
    body: statusCode === 204 ? '' : JSON.stringify(value),
  };
}

function parseBody(event) {
  if (typeof event.body !== 'string') throw new SyntaxError();
  let bytes;
  if (event.isBase64Encoded === true) {
    if (event.body.length > Math.ceil(MAX_BYTES / 3) * 4) throw new RangeError();
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body))
      throw new SyntaxError();
    bytes = Buffer.from(event.body, 'base64');
  } else {
    if (event.isBase64Encoded !== undefined && event.isBase64Encoded !== false)
      throw new SyntaxError();
    if (Buffer.byteLength(event.body, 'utf8') > MAX_BYTES) throw new RangeError();
    bytes = Buffer.from(event.body, 'utf8');
  }
  if (bytes.length > MAX_BYTES) throw new RangeError();
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function validate(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !KEYS.has(key)) ||
    input.consent !== true ||
    typeof input.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.requestId)
  )
    return null;
  const data = { requestId: input.requestId };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (typeof input[key] !== 'string') return null;
    const value = input[key].trim();
    if (
      value.length < min ||
      value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    )
      return null;
    data[key] = value;
  }
  return data;
}

async function verifyCaptcha(data, event, env, fetcher) {
  const params = new URLSearchParams({
    secret: env.SMARTCAPTCHA_SERVER_KEY,
    token: data.captchaToken,
  });
  // Only the trusted HTTP router field. Never trust user-supplied forwarding headers.
  const ip = event.requestContext?.identity?.sourceIp;
  if (typeof ip === 'string' && isIP(ip)) params.set('ip', ip);
  const response = await fetcher('https://smartcaptcha.cloud.yandex.ru/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (response.status !== 200) return false;
  const result = await response.json();
  if (!result || result.status !== 'ok') return false;
  // Empty/null host is also rejected when present (blocked cloud / ambiguous validation).
  return !Object.hasOwn(result, 'host') || result.host === 'tm-cert.ru';
}

function createHandler({
  env = process.env,
  fetcher = globalThis.fetch,
  insert,
  now = () => new Date(),
} = {}) {
  let store;
  return async function handler(event) {
    let cors = null;
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return reply(400, null);
      const allowed = allowedOrigin(env);
      const origin = header(event, 'origin');
      if (allowed && origin === allowed) cors = allowed;
      if (!['POST', 'OPTIONS'].includes(event.httpMethod)) return reply(405, cors);
      if (!allowed) return reply(503, null);
      if (!cors) return reply(403, null);
      if (event.httpMethod === 'OPTIONS') {
        const requested = (header(event, 'access-control-request-headers') || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (
          header(event, 'access-control-request-method') !== 'POST' ||
          requested.some((s) => s !== 'content-type')
        )
          return reply(403, cors);
        return reply(204, cors);
      }
      if (
        !/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(
          header(event, 'content-type') || '',
        )
      )
        return reply(415, cors);
      let input;
      try {
        input = parseBody(event);
      } catch (error) {
        return reply(error instanceof RangeError ? 413 : 400, cors);
      }
      const data = validate(input);
      if (!data) return reply(400, cors);
      if (
        !env.SMARTCAPTCHA_SERVER_KEY ||
        !env.ENDPOINT?.startsWith('grpcs://') ||
        !env.DATABASE?.startsWith('/') ||
        !env.CONSENT_VERSION?.trim()
      )
        return reply(503, cors);
      let verified;
      try {
        verified = await verifyCaptcha(data, event, env, fetcher);
      } catch {
        return reply(502, cors);
      }
      if (!verified) return reply(400, cors);
      const record = {
        id: data.requestId,
        created_at: now(),
        name: data.name,
        contact: data.contact,
        product_name: data.productName,
        message: data.message,
        consent: true,
        consent_version: env.CONSENT_VERSION.trim(),
        status: 'new',
      };
      // Lazy initialization: invalid requests never touch YDB or metadata credentials.
      if (!insert && !store) store = require('./ydb').createYdbStore({ env });
      const accepted = await (insert || store.insert)(record);
      if (accepted === false) return reply(409, cors);
      return reply(200, cors, { ok: true, requestId: record.id });
    } catch {
      // Never serialize/log errors: SDK exceptions may contain query parameters or tokens.
      return reply(503, cors);
    }
  };
}

module.exports = { handler: createHandler(), createHandler };
