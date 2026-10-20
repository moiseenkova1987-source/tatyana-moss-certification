import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const base = process.env.QA_URL || 'http://127.0.0.1:4360';
const paths = [
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
];
const legal = ['/privacy/', '/personal-data-consent/'];
const old = { '/consent/': '/personal-data-consent/', '/privacy-policy/': '/privacy/' };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const forbidden = [];
await context.route('**/*', async (route) => {
  const request = route.request();
  if (
    request.method() === 'POST' ||
    /smartcaptcha|functions\.yandexcloud|workers\.dev/.test(request.url())
  ) {
    forbidden.push(request.url());
    await route.abort();
  } else await route.continue();
});
try {
  const sitemap = await (await context.request.get(base + '/sitemap.xml')).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(urls.sort(), paths.map((p) => 'https://tm-cert.ru' + p).sort());
  const robots = await (await context.request.get(base + '/robots.txt')).text();
  assert.match(robots, /^Allow: \/$/m);
  assert(!robots.includes('Disallow: /'));
  for (const path of [...paths, ...legal, ...Object.keys(old), '/404.html']) {
    const r = await context.request.get(base + path, { maxRetries: 3 });
    assert.equal(r.status(), 200);
    const html = await r.text();
    const expected = paths.includes(path)
      ? 'index, follow'
      : legal.includes(path)
        ? 'noindex, follow'
        : 'noindex, nofollow';
    assert(html.includes(`name="robots" content="${expected}"`), path + ' robots');
    const canonical = 'https://tm-cert.ru' + (old[path] || (path === '/404.html' ? '/404/' : path));
    assert(html.includes(`rel="canonical" href="${canonical}"`), path + ' canonical');
    assert(!/<form\b|data-endpoint|data-sitekey/.test(html), path + ' form data');
    assert(
      !/"@type":"(?:Organization|LocalBusiness|ProfessionalService|Review|AggregateRating)"/.test(
        html,
      ),
      path + ' schema',
    );
    assert(!/localhost|github\.io|tatyana-moss-certification\//.test(html), path + ' old URL');
    if (old[path]) assert(html.includes('0;url=' + old[path]));
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        path + ' overflow',
      );
      assert.equal(await page.locator('form').count(), 0);
      await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        path + ' 200% overflow',
      );
    }
  }
  await page.goto(base + '/contacts/', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.direct-contact-actions a').count(), 4);
  assert.equal(forbidden.length, 0, JSON.stringify(forbidden));
  console.log(
    JSON.stringify({
      base,
      sitemap: urls.length,
      pages: 16,
      browserChecks: 22,
      zoomChecks: 22,
      noForm: true,
      captchaApiPosts: 0,
      errors: [],
    }),
  );
} finally {
  await browser.close();
}
