import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const origin = process.env.QA_URL || 'http://127.0.0.1:4322';
const routes = [
  '/',
  '/services/',
  '/proverka-tovara/',
  '/deklaraciya-sootvetstviya/',
  '/sertifikaciya-produkcii/',
  '/otkaznoe-pismo/',
  '/vvoz-obrazcov/',
  '/import-iz-kitaya/',
  '/marketplaces/',
  '/about/',
  '/contacts/',
  '/privacy-policy/',
  '/personal-data-consent/',
];
const results = [],
  errors = [];
const visualRoutes = ['/', '/services/', '/about/', '/contacts/', '/proverka-tovara/'];
const zoomResults = [];
await mkdir('qa/screenshots', { recursive: true });
for (const width of [360, 390, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (request) => {
    if (request.url().startsWith('https://challenges.cloudflare.com/'))
      errors.push('Disabled form loaded Turnstile');
    if (request.method() === 'POST') errors.push('Disabled page submitted data');
  });
  for (const route of routes) {
    const response = await page.goto(origin + route);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (response.status() !== 200 || overflow)
      errors.push(`${width} ${route}: HTTP ${response.status()}, overflow=${overflow}`);
    results.push({ width, route, status: response.status(), overflow });
    if ([390, 1440].includes(width) && visualRoutes.includes(route)) {
      const name = route === '/' ? 'home' : route.split('/')[1];
      await page.screenshot({ path: `qa/screenshots/final-${name}-${width}.png`, fullPage: true });
      await page.screenshot({ path: `qa/screenshots/final-${name}-${width}-viewport.png` });
    }
  }
  await page.goto(origin + '/');
  await page.screenshot({ path: `qa/screenshots/home-${width}.png`, fullPage: true });
  await page.screenshot({ path: `qa/screenshots/viewport-${width}.png` });
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const width of [390, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  for (const route of visualRoutes) {
    await page.goto(origin + route);
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    zoomResults.push({ width, route, textScale: '200%', overflow });
    if (overflow) {
      errors.push(`200% text overflow: ${width} ${route}`);
      console.log(
        await page.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
            .map((el) => ({
              tag: el.tagName,
              class: el.className,
              width: el.getBoundingClientRect().width,
              text: el.textContent.slice(0, 55),
            }))
            .slice(0, 8),
        ),
      );
    }
    const name = route === '/' ? 'home' : route.split('/')[1];
    await page.screenshot({ path: `qa/screenshots/zoom-${name}-${width}.png`, fullPage: true });
  }
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(origin + '/');
await page.locator('.mobile-menu summary').click();
if (!(await page.locator('.mobile-menu').evaluate((el) => el.open)))
  errors.push('Mobile menu failed to open');
await page.screenshot({ path: 'qa/screenshots/mobile-menu.png' });
await page.keyboard.press('Escape');
if (await page.locator('.mobile-menu').evaluate((el) => el.open))
  errors.push('Escape did not close mobile menu');
await page.goto(origin + '/contacts/');
if (!(await page.locator('button[type=submit]').isDisabled()))
  errors.push('Default form is not disabled');
if (await page.locator('input[name=consent]').isChecked()) errors.push('Prechecked consent');
await page.keyboard.press('Tab');
if (!(await page.locator('.skip-link').evaluate((el) => el === document.activeElement)))
  errors.push('Skip link inaccessible');
await page.goto(origin + '/proverka-tovara/');
await page.locator('.faq summary').first().click();
if (
  !(await page
    .locator('.faq details')
    .first()
    .evaluate((el) => el.open))
)
  errors.push('FAQ does not open');
// Exercise the production client using local HTML and mocked Turnstile/API only.
let mode = 'success',
  calls = 0;
await page.route('https://challenges.cloudflare.com/**', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `window.turnstile={render(el,opts){const frame=document.createElement('iframe');frame.title='Проверка защиты (имитация QA)';frame.width=150;frame.height=140;frame.style.border='0';el.append(frame);window.qaTurnstileOptions=opts;window.qaToken='mock-token';setTimeout(()=>opts.callback(),0);return 'mock-widget'},getResponse(){return window.qaToken},reset(){window.qaToken='mock-token';setTimeout(()=>window.qaTurnstileOptions.callback(),100)}};`,
  }),
);
await page.route('**/contacts/?qa=enabled', async (route) => {
  const response = await route.fetch();
  let html = await response.text();
  html = html
    .replace(/data-endpoint(?:="")?(?=\s)/, 'data-endpoint="https://worker.example.invalid/lead"')
    .replace(/data-sitekey(?:="")?(?=\s)/, 'data-sitekey="test-public-key"');
  await route.fulfill({ response, body: html });
});
await page.route('https://worker.example.invalid/lead', async (route) => {
  calls++;
  const payload = route.request().postDataJSON();
  if (payload.consent !== true || payload.turnstileToken !== 'mock-token' || !payload.productName)
    errors.push('Wrong frontend protocol');
  await new Promise((resolve) => setTimeout(resolve, 250));
  await route.fulfill({
    status: mode === 'success' ? 200 : 502,
    contentType: 'application/json',
    body: JSON.stringify({ ok: mode === 'success' }),
  });
});
await page.goto(origin + '/contacts/?qa=enabled');
await page.waitForFunction(() => window.qaTurnstileOptions);
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
  errors.push('Active form mobile overflow');
await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
  errors.push('Active form 200% overflow');
await page.evaluate(() => (document.documentElement.style.fontSize = ''));
async function fill() {
  for (const [name, value] of Object.entries({
    name: 'QA Test',
    contact: '@qa_test',
    email: 'qa@example.invalid',
    productName: 'QA товар',
  }))
    await page.locator(`[name=${name}]`).fill(value);
}
await page.locator('button[type=submit]').click();
if (calls) errors.push('Empty form submitted');
await fill();
await page.locator('[name=email]').fill('invalid');
await page.locator('button[type=submit]').click();
if (calls) errors.push('Invalid email submitted');
await page.locator('[name=email]').fill('qa@example.invalid');
await page.locator('button[type=submit]').click();
if (calls) errors.push('Submitted without consent');
await page.locator('[name=consent]').check();
await page.locator('[name=productUrl]').fill('ftp://example.invalid');
await page.locator('button[type=submit]').click();
if (calls) errors.push('Invalid URL submitted');
await page.locator('[name=productUrl]').fill('');
await page.evaluate(() => (window.qaToken = ''));
await page.locator('button[type=submit]').click();
await page.getByRole('status').filter({ hasText: 'Пройдите проверку' }).waitFor();
if (calls) errors.push('Submitted without token');
await page.evaluate(() => (window.qaToken = 'mock-token'));
await page.locator('button[type=submit]').click();
await page.evaluate(() => {
  document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
});
await page.getByRole('status').filter({ hasText: 'Заявка отправлена' }).waitFor();
if (calls !== 1) errors.push('Double submission not prevented');
if ((await page.locator('[name=name]').inputValue()) !== '')
  errors.push('Success did not reset form');
await page.waitForTimeout(150);
mode = 'error';
await fill();
await page.locator('[name=consent]').check();
await page.locator('button[type=submit]').click();
await page.getByRole('status').filter({ hasText: 'Не удалось отправить заявку' }).waitFor();
if ((await page.locator('[name=name]').inputValue()) !== 'QA Test') errors.push('Error lost input');
if (!(await page.getByRole('status').evaluate((el) => el === document.activeElement)))
  errors.push('Result not focused');
await page.screenshot({ path: 'qa/screenshots/contact-form-active-mock-390.png', fullPage: true });
const nojs = await browser.newPage({
  javaScriptEnabled: false,
  viewport: { width: 390, height: 844 },
});
await nojs.goto(origin + '/');
if ((await nojs.locator('h1').count()) !== 1) errors.push('H1 missing without JS');
await nojs.locator('.faq summary').first().click();
if (
  !(await nojs.locator('.faq details').first().getAttribute('open')) &&
  (await nojs.locator('.faq details[open]').count()) !== 1
)
  errors.push('No-JS FAQ failed');
await browser.close();
await writeFile(
  'qa/browser-report.json',
  JSON.stringify(
    {
      results,
      zoomResults,
      form: {
        defaultDisabled: true,
        noDisabledExternalRequests: true,
        consentRequired: true,
        emptyAndEmailAndUrlValidated: true,
        tokenRequired: true,
        doubleClickBlocked: true,
        resultFocused: true,
        mobileAnd200Percent: true,
        successAndErrorMocked: true,
      },
      errors,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ pages: results.length, formCalls: calls, errors }, null, 2));
if (errors.length) process.exitCode = 1;
