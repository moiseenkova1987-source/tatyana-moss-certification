'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../index');
const env = {
  ENDPOINT: 'grpcs://example.invalid:2135',
  DATABASE: '/test/database',
  ALLOWED_ORIGIN: 'https://tm-cert.ru',
  CONSENT_VERSION: 'test-v1',
  SMARTCAPTCHA_SERVER_KEY: 'TEST_ONLY_NOT_A_SECRET',
};
const good = {
  requestId: '11111111-1111-4111-8111-111111111111',
  name: ' QA ',
  contact: ' @qa_test ',
  productName: ' Товар ',
  message: ' Вопрос ',
  consent: true,
  website: '',
  captchaToken: 'mock-captcha',
};
function event(body = good, headers = {}, extra = {}) {
  return {
    httpMethod: 'POST',
    headers: { Origin: env.ALLOWED_ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
    ...extra,
  };
}
function setup(options = {}) {
  const fetchCalls = [],
    records = [];
  const handler = createHandler({
    env: options.env || env,
    fetcher: async (url, init) => {
      fetchCalls.push({ url, init });
      if (options.networkError) throw new Error('secret stack upstream details');
      return (
        options.response || Response.json(options.captcha || { status: 'ok', host: 'tm-cert.ru' })
      );
    },
    insert: async (record) => {
      if (options.insertError) throw new Error('YDB private details');
      records.push(record);
    },
    now: () => new Date('2026-10-11T00:00:00Z'),
  });
  return { handler, fetchCalls, records };
}
async function rejected(request, status, options = {}) {
  const s = setup(options);
  const result = await s.handler(request);
  assert.equal(result.statusCode, status);
  assert.deepEqual(JSON.parse(result.body), {
    ok: false,
    error: 'Не удалось отправить обращение. Попробуйте ещё раз.',
  });
  assert.equal(s.records.length, 0);
  return s;
}
test('OPTIONS preflight, exact CORS, no APIs', async () => {
  const s = setup();
  const result = await s.handler(
    event(
      '',
      { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
      { httpMethod: 'OPTIONS' },
    ),
  );
  assert.equal(result.statusCode, 204);
  assert.equal(result.body, '');
  assert.equal(result.headers['Access-Control-Allow-Origin'], env.ALLOWED_ORIGIN);
  assert.equal(result.headers['Access-Control-Allow-Headers'], 'Content-Type');
  assert.equal(result.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  assert.equal(s.fetchCalls.length, 0);
});
for (const origin of [
  'https://evil.invalid',
  'https://www.tm-cert.ru',
  'https://tm-cert.ru.evil.invalid',
  'null',
])
  test('wrong Origin: ' + origin, async () => {
    const s = setup();
    const r = await s.handler(event(good, { Origin: origin }));
    assert.equal(r.statusCode, 403);
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined);
    assert.equal(s.fetchCalls.length, 0);
  });
test('missing or duplicate Origin denied', async () => {
  const e = event();
  delete e.headers.Origin;
  await rejected(e, 403);
  await rejected(event(good, { origin: 'https://evil.invalid' }), 403);
  await rejected(
    event(
      good,
      {},
      { multiValueHeaders: { Origin: ['https://tm-cert.ru', 'https://evil.invalid'] } },
    ),
    403,
  );
});
for (const method of ['GET', 'PUT', 'DELETE', 'HEAD'])
  test(method + ' -> 405', async () => {
    const s = await rejected(event('', {}, { httpMethod: method }), 405);
    assert.equal(s.fetchCalls.length, 0);
  });
test('invalid preflight denied', async () => {
  await rejected(
    event('', { 'Access-Control-Request-Method': 'GET' }, { httpMethod: 'OPTIONS' }),
    403,
  );
  await rejected(
    event(
      '',
      {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization',
      },
      { httpMethod: 'OPTIONS' },
    ),
    403,
  );
});
test('wrong content type', async () => {
  const s = await rejected(event(good, { 'Content-Type': 'text/plain' }), 415);
  assert.equal(s.fetchCalls.length, 0);
});
test('16 KiB bound on UTF-8 bytes and base64-decoded body', async () => {
  for (const e of [
    event('x'.repeat(16385)),
    event('я'.repeat(8193)),
    event('', {}, { body: Buffer.alloc(16385).toString('base64'), isBase64Encoded: true }),
  ]) {
    const s = await rejected(e, 413);
    assert.equal(s.fetchCalls.length, 0);
  }
});
for (const [label, patch] of Object.entries({
  name: { name: ' ' },
  contact: { contact: 'aa' },
  product: { productName: '' },
  message: { message: ' ' },
  honeypot: { website: 'bot' },
  consent: { consent: false },
  'string consent': { consent: 'true' },
  'missing captcha': { captchaToken: undefined },
  'nested object': { name: { value: 'QA' } },
  array: { message: [] },
  extra: { debug: {} },
  'long name': { name: 'x'.repeat(101) },
  'long contact': { contact: 'x'.repeat(101) },
  'long product': { productName: 'x'.repeat(201) },
  'long message': { message: 'x'.repeat(1501) },
  'long token': { captchaToken: 'x'.repeat(8193) },
}))
  test('validation: ' + label, async () => {
    const s = await rejected(event({ ...good, ...patch }), 400);
    assert.equal(s.fetchCalls.length, 0);
  });
test('malformed JSON, primitive, array, object event body and base64 rejected', async () => {
  for (const body of ['{', 'null', '[]', 'true']) await rejected(event(body), 400);
  await rejected(event('', {}, { body: good }), 400);
  await rejected(event('???', {}, { isBase64Encoded: true }), 400);
});
test('missing configuration fails closed before APIs', async () => {
  for (const key of Object.keys(env)) {
    const missing = { ...env };
    delete missing[key];
    const s = await rejected(event(), 503, { env: missing });
    assert.equal(s.fetchCalls.length, 0);
  }
});
for (const captcha of [
  { status: 'failed' },
  { status: 'ok', host: 'evil.invalid' },
  { status: 'ok', host: '' },
  { status: 'ok', host: null },
  { status: 'ok', host: 'tm-cert.ru:8080' },
  {},
])
  test('SmartCaptcha rejects ' + JSON.stringify(captcha), async () => {
    await rejected(event(), 400, { captcha });
  });
test('SmartCaptcha HTTP errors fail closed even with ok JSON', async () => {
  for (const status of [201, 400, 500])
    await rejected(event(), 400, { response: Response.json({ status: 'ok' }, { status }) });
});
test('SmartCaptcha network and invalid JSON errors do not insert', async () => {
  await rejected(event(), 502, { networkError: true });
  await rejected(event(), 502, { response: new Response('invalid json') });
});
test('SmartCaptcha missing host allowed per API contract', async () => {
  const s = setup({ captcha: { status: 'ok' } });
  assert.equal((await s.handler(event())).statusCode, 200);
});
test('YDB insert failure returns generic error without requestId', async () => {
  const s = await rejected(event(), 503, { insertError: true });
  assert.equal(s.fetchCalls.length, 1);
});
test('successful CAPTCHA then committed record; form encoding, trusted IP, UTC, UUID', async () => {
  const s = setup();
  const result = await s.handler(
    event(
      good,
      { 'X-Forwarded-For': '203.0.113.10' },
      { requestContext: { identity: { sourceIp: '192.0.2.10' } } },
    ),
  );
  assert.equal(result.statusCode, 200);
  const body = JSON.parse(result.body);
  assert.match(
    body.requestId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(body, { ok: true, requestId: s.records[0].id });
  assert.deepEqual(s.records[0], {
    id: body.requestId,
    created_at: new Date('2026-10-11T00:00:00Z'),
    name: 'QA',
    contact: '@qa_test',
    product_name: 'Товар',
    message: 'Вопрос',
    consent: true,
    consent_version: 'test-v1',
    status: 'new',
  });
  const { url, init } = s.fetchCalls[0];
  assert.equal(url, 'https://smartcaptcha.cloud.yandex.ru/validate');
  assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const params = new URLSearchParams(init.body);
  assert.equal(params.get('ip'), '192.0.2.10');
  assert.equal(params.get('token'), good.captchaToken);
  assert.equal(params.get('secret'), env.SMARTCAPTCHA_SERVER_KEY);
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
});
test('forwarded IP ignored; valid base64 accepted', async () => {
  const s = setup();
  const r = await s.handler(
    event(
      '',
      { 'X-Forwarded-For': '192.0.2.12' },
      { body: Buffer.from(JSON.stringify(good)).toString('base64'), isBase64Encoded: true },
    ),
  );
  assert.equal(r.statusCode, 200);
  assert.equal(new URLSearchParams(s.fetchCalls[0].init.body).has('ip'), false);
});
test('no success before YDB resolves', async () => {
  let resolveInsert;
  let finished = false;
  const handler = createHandler({
    env,
    fetcher: async () => Response.json({ status: 'ok' }),
    insert: () =>
      new Promise((resolve) => {
        resolveInsert = resolve;
      }),
  });
  const pending = handler(event()).then((r) => {
    finished = true;
    return r;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  resolveInsert();
  assert.equal((await pending).statusCode, 200);
});

for (const requestId of [undefined, '', 'bad', 123, {}, '11111111-1111-1111-1111-111111111111']) {
  test('invalid requestId rejected: ' + JSON.stringify(requestId), async () => {
    await rejected(event({ ...good, requestId }), 400);
  });
}

test('commit followed by lost response: fresh handler retries with the same ID', async () => {
  const rows = new Map();
  let loseResponse = true;
  const insert = async (row) => {
    if (!rows.has(row.id)) rows.set(row.id, row);
    if (loseResponse) {
      loseResponse = false;
      throw new Error('response lost after commit');
    }
    return true;
  };
  const makeHandler = () =>
    createHandler({ env, insert, fetcher: async () => Response.json({ status: 'ok' }) });
  assert.equal((await makeHandler()(event())).statusCode, 503);
  const first = rows.get(good.requestId);
  const retry = await makeHandler()(event({ ...good, captchaToken: 'fresh-token' }));
  assert.equal(retry.statusCode, 200);
  assert.equal(JSON.parse(retry.body).requestId, good.requestId);
  assert.equal(rows.size, 1);
  assert.strictEqual(rows.get(good.requestId), first);
});

test('idempotency conflict is generic HTTP 409, never a false success', async () => {
  const handler = createHandler({
    env,
    insert: async () => false,
    fetcher: async () => Response.json({ status: 'ok' }),
  });
  const result = await handler(event());
  assert.equal(result.statusCode, 409);
  assert.deepEqual(JSON.parse(result.body), {
    ok: false,
    error: 'Не удалось отправить обращение. Попробуйте ещё раз.',
  });
});
