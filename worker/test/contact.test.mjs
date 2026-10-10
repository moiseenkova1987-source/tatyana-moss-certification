import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
const env = {
  TURNSTILE_SECRET_KEY: 'TEST_SECRET',
  TELEGRAM_BOT_TOKEN: 'TEST_TOKEN',
  TELEGRAM_CHAT_ID: 'TEST_CHAT',
};
const good = {
  name: ' QA Test ',
  contact: '@qa_test',
  email: 'qa@example.invalid',
  productName: 'QA товар',
  productUrl: '',
  message: '<b>plain text</b>',
  consent: true,
  website: '',
  turnstileToken: 'test-token',
};
test('preliminary question does not require email or product URL', async () => {
  const { email, productUrl, ...question } = good;
  const { fetcher, calls } = upstream();
  const response = await handleRequest(request(question), env, fetcher);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
});
function request(body = good, options = {}) {
  return new Request('https://worker.example.invalid/', {
    method: 'POST',
    headers: {
      Origin: 'https://tm-cert.ru',
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function upstream({
  verification = { success: true, hostname: 'tm-cert.ru', action: 'contact' },
  delivery = { ok: true },
  fail = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (fail) throw new Error('TEST_SECRET TEST_TOKEN stack should never escape');
    return Response.json(url.includes('siteverify') ? verification : delivery);
  };
  return { fetcher, calls };
}
for (const [name, patch] of Object.entries({
  'empty required field': { name: ' ' },
  'empty question': { message: ' ' },
  'invalid email': { email: 'broken' },
  'missing consent': { consent: false },
  'string consent': { consent: 'true' },
  'invalid URL': { productUrl: 'javascript:alert(1)' },
  'credentials URL': { productUrl: 'https://user:pass@example.invalid' },
  honeypot: { website: 'bot' },
  'no token': { turnstileToken: '' },
  'oversized string': { message: 'x'.repeat(1501) },
  'nested object': { contact: { phone: '123' } },
  'extra key': { extra: 'value' },
}))
  test(name, async () => {
    const { fetcher, calls } = upstream();
    assert.equal((await handleRequest(request({ ...good, ...patch }), env, fetcher)).status, 400);
    assert.equal(calls.length, 0);
  });
test('invalid JSON and root types', async () => {
  for (const body of ['{', 'null', '[]', 'true'])
    assert.equal((await handleRequest(request(body), env)).status, 400);
});
test('payload is bounded without Content-Length', async () => {
  assert.equal((await handleRequest(request('x'.repeat(16385)), env)).status, 413);
});
test('rejects wrong content type', async () => {
  assert.equal(
    (await handleRequest(request(good, { headers: { 'Content-Type': 'text/plain' } }), env)).status,
    415,
  );
});
test('production rejects other and missing origins; exact CORS', async () => {
  for (const Origin of [
    'https://evil.example',
    'http://localhost:4322',
    'https://tm-cert.ru.evil.example',
    'null',
  ]) {
    const response = await handleRequest(request(good, { headers: { Origin } }), env);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const noOrigin = request();
  noOrigin.headers.delete('Origin');
  assert.equal((await handleRequest(noOrigin, env)).status, 403);
});
test('only POST and constrained OPTIONS', async () => {
  const headers = { Origin: 'https://tm-cert.ru' };
  assert.equal(
    (await handleRequest(new Request('https://worker.example.invalid', { headers }), env)).status,
    405,
  );
  const preflight = await handleRequest(
    new Request('https://worker.example.invalid', {
      method: 'OPTIONS',
      headers: {
        ...headers,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }),
    env,
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://tm-cert.ru');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal(
    (
      await handleRequest(
        new Request('https://worker.example.invalid', {
          method: 'OPTIONS',
          headers: { ...headers, 'Access-Control-Request-Method': 'DELETE' },
        }),
        env,
      )
    ).status,
    403,
  );
});
test('missing secrets fails closed', async () =>
  assert.equal((await handleRequest(request(), {})).status, 503));
for (const verification of [
  { success: false },
  { success: true, hostname: 'evil.example', action: 'contact' },
  { success: true, hostname: 'tm-cert.ru', action: 'other' },
])
  test('rejects invalid Turnstile result ' + JSON.stringify(verification), async () => {
    const { fetcher, calls } = upstream({ verification });
    assert.equal((await handleRequest(request(), env, fetcher)).status, 400);
    assert.equal(calls.length, 1);
  });
test('success only after Telegram confirmation; plain text; trim; no secret response', async () => {
  const { fetcher, calls } = upstream();
  const response = await handleRequest(request(), env, fetcher);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.secret, 'TEST_SECRET');
  assert.match(calls[1].body.text, /Имя: QA Test\n/);
  assert.match(calls[1].body.text, /<b>plain text<\/b>/);
  assert.equal(calls[1].body.parse_mode, undefined);
  assert.ok(calls[1].body.text.length <= 4096);
});
test('www and separate local development', async () => {
  for (const [origin, environment] of [
    ['https://www.tm-cert.ru', 'production'],
    ['http://127.0.0.1:4322', 'development'],
  ]) {
    const { fetcher } = upstream({
      verification: { success: true, hostname: new URL(origin).hostname, action: 'contact' },
    });
    assert.equal(
      (
        await handleRequest(
          request(good, { headers: { Origin: origin } }),
          { ...env, ENVIRONMENT: environment },
          fetcher,
        )
      ).status,
      200,
    );
  }
});
test('Telegram API error and network error expose no internals', async () => {
  for (const configuration of [
    { delivery: { ok: false, description: 'TEST_TOKEN' } },
    { fail: true },
  ]) {
    const { fetcher } = upstream(configuration);
    const response = await handleRequest(request(), env, fetcher);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.doesNotMatch(body, /TEST_|stack|description/);
  }
});
