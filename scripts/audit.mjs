import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
const root = path.resolve('dist');
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name),
      ),
    )
  ).flat();
}
const files = await walk(root),
  html = files.filter((f) => f.endsWith('.html'));
const errors = [],
  rows = [],
  titles = new Set(),
  descriptions = new Set();
const check = (condition, message) => {
  if (!condition) errors.push(message);
};
const pages = new Map();
for (const file of html) {
  const $ = load(await readFile(file, 'utf8'));
  const canonical = $('link[rel=canonical]').attr('href');
  if (canonical) pages.set(new URL(canonical).pathname, { $, file });
}
for (const file of html) {
  const $ = load(await readFile(file, 'utf8')),
    name = path.relative(root, file),
    title = $('title').text(),
    desc = $('meta[name=description]').attr('content');
  check($('h1').length === 1, `${name}: требуется один H1`);
  check(!!title && !titles.has(title), `${name}: title отсутствует/не уникален`);
  check(!!desc && !descriptions.has(desc), `${name}: description отсутствует/не уникален`);
  titles.add(title);
  descriptions.add(desc);
  for (const selector of [
    'link[rel=canonical]',
    'meta[property="og:title"]',
    'meta[property="og:description"]',
    'meta[property="og:url"]',
    'meta[name="twitter:title"]',
    'meta[name="twitter:description"]',
  ])
    check($(selector).length === 1, `${name}: ${selector}`);
  const canonical = $('link[rel=canonical]').attr('href');
  const graph = JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  check(
    graph.some((x) => x['@type'] === 'Person'),
    `${name}: Person отсутствует`,
  );
  check(
    !graph.some((x) => ['Review', 'AggregateRating'].includes(x['@type'])),
    `${name}: отзывы в schema`,
  );
  const faq = graph.find((x) => x['@type'] === 'FAQPage');
  if (faq) {
    check(
      faq.mainEntity.length === $('.faq details').length,
      `${name}: FAQ schema не соответствует контенту`,
    );
    for (const q of faq.mainEntity) {
      check(
        $('.faq').text().includes(q.name) && $('.faq').text().includes(q.acceptedAnswer.text),
        `${name}: невидимый FAQ`,
      );
    }
  }
  for (const el of $('img').toArray()) check($(el).attr('alt') !== undefined, `${name}: нет alt`);
  for (const el of $('input[type=checkbox]').toArray())
    check($(el).attr('checked') === undefined, `${name}: заранее отмеченный checkbox`);
  for (const el of $('a[href]').toArray()) {
    const href = $(el).attr('href');
    if (/^(mailto:|tel:)/.test(href)) continue;
    const target = new URL(href, canonical);
    if (target.origin !== new URL(canonical).origin) continue;
    const dest = pages.get(target.pathname);
    check(!!dest, `${name}: несуществующая ссылка ${href}`);
    if (dest && target.hash)
      check(
        dest
          .$('[id]')
          .toArray()
          .some((e) => dest.$(e).attr('id') === decodeURIComponent(target.hash.slice(1))),
        `${name}: несуществующий якорь ${href}`,
      );
  }
  rows.push({
    page: name,
    title,
    description: desc,
    h1: $('h1').text(),
    canonical,
    faq: faq?.mainEntity.length || 0,
  });
}
const xml = load(await readFile(path.join(root, 'sitemap.xml'), 'utf8'), { xmlMode: true });
const sitemap = xml('loc')
  .toArray()
  .map((e) => xml(e).text());
check(sitemap.length === html.length - 1, 'sitemap: количество страниц');
for (const loc of sitemap) check(pages.has(new URL(loc).pathname), `sitemap: отсутствует ${loc}`);
check(!sitemap.some((x) => /404/.test(x)), 'sitemap содержит страницу 404');
const robots = await readFile(path.join(root, 'robots.txt'), 'utf8');
check(robots.includes('Sitemap: ') && robots.includes('/sitemap.xml'), 'robots: нет sitemap');
await mkdir('qa', { recursive: true });
await writeFile(
  'qa/seo-report.json',
  JSON.stringify({ pages: rows, sitemap, robots, errors }, null, 2),
);
const js = await Promise.all(
  files
    .filter((f) => f.endsWith('.js'))
    .map(async (f) => ({ file: path.relative(root, f), bytes: (await stat(f)).size })),
);
console.log(
  JSON.stringify(
    { htmlPages: html.length, sitemapUrls: sitemap.length, javascript: js, errors },
    null,
    2,
  ),
);
if (errors.length) process.exitCode = 1;
