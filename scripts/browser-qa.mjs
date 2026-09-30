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
  await page.setViewportSize({width, height:900});
  for (const route of visualRoutes) {
    await page.goto(origin + route);
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    zoomResults.push({width,route,textScale:'200%',overflow});
    if (overflow) {
      errors.push(`200% text overflow: ${width} ${route}`);
      console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,text:el.textContent.slice(0,55)})).slice(0,8)));
    }
    const name = route === '/' ? 'home' : route.split('/')[1];
    await page.screenshot({path:`qa/screenshots/zoom-${name}-${width}.png`,fullPage:true});
  }
}
await page.setViewportSize({width:390,height:844});
await page.goto(origin + '/');
await page.locator('.mobile-menu summary').click();
if (!await page.locator('.mobile-menu').evaluate(el=>el.open)) errors.push('Mobile menu failed to open');
await page.screenshot({path:'qa/screenshots/mobile-menu.png'});
await page.keyboard.press('Escape');
if (await page.locator('.mobile-menu').evaluate(el=>el.open)) errors.push('Escape did not close mobile menu');
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
// Mock responses exercise the real compiled client handler. No personal data leaves localhost.
await page.goto(origin + '/contacts/?service=Тест');
let mode = 'success',
  calls = 0;
await page.route('**/mock-leads', async (route) => {
  calls++;
  await route.fulfill({
    status: mode === 'success' ? 200 : 500,
    contentType: 'application/json',
    body: JSON.stringify(mode === 'success' ? { ok: true } : { ok: false }),
  });
});
await page.evaluate(() => {
  const f = document.querySelector('form');
  f.dataset.endpoint = location.origin + '/mock-leads';
  f.querySelector('button').disabled = false;
});
async function fill() {
  for (const [name, value] of Object.entries({
    name: 'QA Test',
    contact: '@qa_test',
    email: 'qa@example.invalid',
    product: 'QA товар',
  }))
    await page.locator(`[name=${name}]`).fill(value);
}
await fill();
await page.locator('button[type=submit]').click();
if (calls !== 0) errors.push('Submitted without consent');
await page.locator('[name=consent]').check();
await page.locator('button[type=submit]').click();
await page.getByRole('status').filter({ hasText: 'Заявка принята' }).waitFor();
if ((await page.locator('[name=name]').inputValue()) !== '')
  errors.push('Success did not reset form');
mode = 'error';
await fill();
await page.locator('[name=consent]').check();
await page.locator('button[type=submit]').click();
await page.getByRole('status').filter({ hasText: 'Не удалось подтвердить' }).waitFor();
if ((await page.locator('[name=name]').inputValue()) !== 'QA Test') errors.push('Error lost input');
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
      form: { defaultDisabled: true, consentRequired: true, successAndErrorMocked: true },
      errors,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ pages: results.length, formCalls: calls, errors }, null, 2));
if (errors.length) process.exitCode = 1;
