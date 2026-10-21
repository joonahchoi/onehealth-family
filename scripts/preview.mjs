// public/ 파일로 더블클릭 미리보기용 단일 index.html을 만듭니다. (배포에는 쓰이지 않아요)
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pub = path => resolve(root, 'public', path.replace(/^\//, ''));
const types = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const cache = new Map();
async function dataUri(path) {
  if (!cache.has(path)) cache.set(path, `data:${types[extname(path)]};base64,${(await readFile(pub(path))).toString('base64')}`);
  return cache.get(path);
}
async function inlineAssets(text) {
  const found = [...new Set(text.match(/\/(?:assets|icons|fonts)\/[\w.-]+\.(?:webp|png|svg|woff2|jpg)|\/favicon\.svg/g) || [])];
  for (const path of found) text = text.split(path).join(await dataUri(path));
  return text;
}

let html = await readFile(pub('index.html'), 'utf8');
const css = await inlineAssets(await readFile(pub('style.css'), 'utf8'));
const js = await inlineAssets(await readFile(pub('app.js'), 'utf8'));
let animals = [];
try {
  const files = (await readdir(pub('assets/animals'))).filter(name => name.endsWith('.webp')).sort();
  animals = await Promise.all(files.map(name => dataUri(`/assets/animals/${name}`)));
} catch {}

html = html
  .replace(/\s*<link rel="(?:manifest|preload)"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="/app.js" defer></script>', '')
  .replace('</body>', () => `${animals.length ? `<script>window.ONE_HEALTH_ANIMALS=${JSON.stringify(animals)};</script>\n` : ''}<script>\n${js}\n</script>\n</body>`);
html = await inlineAssets(html);
await writeFile(resolve(root, 'index.html'), html);
console.log(`Preview index.html ready (${(html.length / 1048576).toFixed(1)}MB, animals ${animals.length}).`);
