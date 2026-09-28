import type { APIRoute } from 'astro';
import { services } from '../data/services';
import { articles } from '../data/articles';
import { site, url } from '../data/site';
export const GET: APIRoute = ({ site: origin }) => {
  const paths = [
    '/',
    '/services/',
    '/about/',
    '/contacts/',
    '/privacy-policy/',
    '/personal-data-consent/',
    ...services.map((s) => `/${s.slug}/`),
    ...(site.features.marking ? ['/chestny-znak/'] : []),
    ...(site.features.blog
      ? [
          '/blog/',
          ...articles.filter((a) => !a.draft && a.sections.length).map((a) => `/blog/${a.slug}/`),
        ]
      : []),
  ];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${new URL(url(p), origin).href}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};
