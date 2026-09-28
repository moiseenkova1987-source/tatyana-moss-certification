import type { APIRoute } from 'astro';
import { live, url } from '../data/site';
export const GET: APIRoute = ({ site }) =>
  new Response(
    `User-agent: *\n${live ? 'Allow: /' : 'Disallow: /'}\n\nSitemap: ${new URL(url('/sitemap.xml'), site).href}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
