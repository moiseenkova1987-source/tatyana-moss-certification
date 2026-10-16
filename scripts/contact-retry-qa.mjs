import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const origin = process.env.QA_URL || 'http://127.0.0.1:4322';
const records = new Map(),
  ids = [];
let release;
try {
  await page.clock.install();
  await page.route('https://smartcaptcha.cloud.yandex.ru/**', (r) =>
    r.fulfill({
      contentType: 'application/javascript',
      body: `window.smartCaptcha={render(el,opts){setTimeout(()=>opts.callback('mock-token'),0);return 0},subscribe(){return ()=>{}},getResponse(){return 'mock-token'},reset(){}};window.tmCertSmartCaptchaLoaded();`,
    }),
  );
  await page.route('**/?qa=retry', async (r) => {
    const response = await r.fetch();
    const html = (await response.text())
      .replace(/data-endpoint(?:="")?(?=\s)/, 'data-endpoint="https://api.example.invalid/"')
      .replace(/data-sitekey(?:="")?(?=\s)/, 'data-sitekey="test-key"');
    await r.fulfill({ response, body: html });
  });
  await page.route('https://api.example.invalid/', async (r) => {
    const payload = r.request().postDataJSON();
    ids.push(payload.requestId);
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/);
    if (ids.length === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (!records.has(payload.requestId)) records.set(payload.requestId, payload);
    await r
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, requestId: payload.requestId }),
      })
      .catch(() => {});
  });
  const fill = async () => {
    await page.goto(origin + '/?qa=retry');
    for (const [name, value] of Object.entries({
      name: 'QA Retry',
      contact: '@qa_retry',
      productName: 'QA товар',
      message: 'QA вопрос',
    }))
      await page.locator(`[name=${name}]`).fill(value);
    await page.locator('[name=consent]').check();
  };
  await fill();
  await page.locator('[type=submit]').click();
  while (!release) await new Promise((r) => setTimeout(r, 10));
  await page.clock.fastForward(25000);
  assert.equal(await page.locator('[type=submit]').isDisabled(), true);
  assert.match(await page.locator('.form-status').innerText(), /Отправляем/);
  await page.clock.fastForward(40001);
  await page.getByRole('status').filter({ hasText: 'Не удалось подтвердить получение' }).waitFor();
  release();
  while (!records.size) await new Promise((r) => setTimeout(r, 10));
  await fill();
  await page.locator('[type=submit]').click();
  await page.getByRole('status').filter({ hasText: 'Вопрос отправлен' }).waitFor();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(records.size, 1);
  const storage = await page.evaluate(() => JSON.stringify(sessionStorage));
  assert.ok(!storage.includes('QA Retry') && !storage.includes('@qa_retry'));
  // A different question represents a new logical request.
  await fill();
  await page.locator('[name=message]').fill('Другой QA вопрос');
  await page.locator('[type=submit]').click();
  await page.getByRole('status').filter({ hasText: 'Вопрос отправлен' }).waitFor();
  assert.notEqual(ids[1], ids[2]);
  assert.equal(records.size, 2);
  // Storage failures must not send a request without a persisted identity.
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await fill();
  await page.locator('[name=message]').fill('Storage blocked');
  await page.locator('[type=submit]').click();
  await page.getByRole('status').filter({ hasText: 'Не удалось подтвердить получение' }).waitFor();
  assert.equal(ids.length, 3);
  console.log(
    'PASS: >20s pending; 65s uncertain result; late commit + reload retry has one ID/record; changed payload new ID; storage failure blocks POST. External APIs mocked.',
  );
} finally {
  await browser.close();
}
