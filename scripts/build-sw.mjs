import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../dist/', import.meta.url);
async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = await Promise.all(entries.map(async e => {
    const path = `${prefix}${e.name}`;
    if (e.isDirectory()) return walk(new URL(`${e.name}/`, dir), `${path}/`);
    return e.name === 'sw.js' || e.name.endsWith('.map') ? [] : [path];
  }));
  return results.flat();
}
const files = (await walk(root)).sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(new URL(file, root)));
const version = `focus-drive-${hash.digest('hex').slice(0, 12)}`;
const precache = ['/', ...files.filter(x => x !== 'index.html').map(x => `/${x}`)];
const source = `const VERSION = ${JSON.stringify(version)};\nconst FILES = ${JSON.stringify(precache)};\nself.addEventListener('install', event => { event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES))); });\nself.addEventListener('activate', event => { event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('focus-drive-') && key !== VERSION).map(key => caches.delete(key)))), self.clients.claim()])); });\nself.addEventListener('fetch', event => {\n  const target = new URL(event.request.url);
  // Never cache the account API: a cached /api/auth/me would keep a signed-out player signed in.
  if (event.request.method !== 'GET' || target.origin !== self.location.origin || target.pathname.startsWith('/api/')) return;\n  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/', { ignoreVary: true }))); return; }\n  event.respondWith(caches.match(event.request, { ignoreVary: true }).then(cached => cached || fetch(event.request).then(response => { if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(cache => cache.put(event.request, copy)); } return response; })));\n});\n`;
await writeFile(new URL('sw.js', root), source);
console.log(`Generated offline cache ${version} with ${precache.length} local resources.`);
