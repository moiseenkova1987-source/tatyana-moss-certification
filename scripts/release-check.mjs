import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const source = readFileSync('src/data/site.ts', 'utf8');
const failures = [];
const origin = process.env.PUBLIC_SITE_URL;
if (!origin || !origin.startsWith('https://') || new URL(origin).hostname === 'example.com')
  failures.push('Задайте реальный PUBLIC_SITE_URL с HTTPS.');
if (process.env.PUBLIC_SITE_LIVE !== 'true')
  failures.push('Для публичной индексируемой версии установите PUBLIC_SITE_LIVE=true.');
if (!source.includes("name: 'Татьяна Моисеенкова'")) console.log('Проверьте имя эксперта в site.ts.');
if (process.env.PUBLIC_FORM_ENDPOINT && !/ready:\s*true/.test(source))
  failures.push('Для включения endpoint завершите правовые настройки legal.ready.');
if (process.env.PUBLIC_FORM_ENDPOINT && !process.env.PUBLIC_FORM_ENDPOINT.startsWith('https://'))
  failures.push('Endpoint должен использовать HTTPS.');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  'Базовые настройки публикации заполнены. Проверка не заменяет проверку правовых текстов и backend.',
);
