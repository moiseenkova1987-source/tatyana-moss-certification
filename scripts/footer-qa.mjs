import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.QA_URL || 'http://127.0.0.1:4361';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const calls = [];
page.on('request', (r) => {
  if (r.method() === 'POST' || /smartcaptcha|functions\.yandexcloud|workers\.dev/.test(r.url()))
    calls.push(r.url());
});
page.on('pageerror', (e) => {
  throw e;
});
const links = [
  'tel:+79185521213',
  'https://t.me/tatimoss',
  'https://max.ru/u/f9LHodD0cOJrNl6avAh4zYB-zAGCOj_V69tBsxc_OzpZVAxGaD9QL6UBscY',
  'mailto:tatyana.moiseenk@mail.ru',
];
await mkdir('qa/screenshots', { recursive: true });
let checks = 0;
try {
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      '/contacts/',
      '/',
      '/services/',
      '/practice/',
      '/practice/kak-opredelit-kod-tn-ved/',
    ]) {
      assert.equal((await page.goto(base + route)).status(), 200);
      assert.deepEqual(
        await page
          .locator('.footer-contact-card')
          .evaluateAll((a) => a.map((x) => x.getAttribute('href'))),
        links,
      );
      for (const card of await page.locator('.footer-contact-card').all()) {
        const box = await card.boundingBox();
        assert(box.width >= 44 && box.height >= 44);
        await card.focus();
        assert(
          await card.evaluate(
            (el) => document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none',
          ),
        );
      }
      await page.locator('.footer-contact-card').first().focus();
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute('href')),
        links[1],
      );
      assert.equal(await page.locator('form').count(), 0);
      for (const zoom of [100, 200]) {
        await page.evaluate(
          (value) => (document.documentElement.style.fontSize = value + '%'),
          zoom,
        );
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          route + ' overflow ' + width + ' ' + zoom,
        );
        await page
          .locator('footer')
          .screenshot({
            path:
              'qa/screenshots/footer-' +
              (route === '/' ? 'home' : route.split('/').filter(Boolean).join('-')) +
              '-' +
              width +
              '-' +
              zoom +
              '.png',
          });
        checks++;
      }
    }
  }
  assert.deepEqual(calls, []);
  console.log(
    JSON.stringify({
      base,
      footerChecks: checks,
      contactLinks: 4,
      keyboard: true,
      captchaApiPosts: calls.length,
      errors: [],
    }),
  );
} finally {
  await browser.close();
}
