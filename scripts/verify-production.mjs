import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.FOCUS_DRIVE_URL || 'http://127.0.0.1:4174';
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => requests.push(r.url()));
try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine === 'PlayCanvas / WebGL2', null, { timeout: 60_000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  const cache = await page.evaluate(async () => {
    const name = (await caches.keys()).find(x => x.startsWith('focus-drive-'));
    return { name, files: name ? (await (await caches.open(name)).keys()).map(x => new URL(x.url).pathname) : [] };
  });
  if (cache.files.length < 15) throw new Error(`Incomplete offline cache: ${cache.files.length}`);
  const required = ['/assets/cars/concept/CarConcept.glb', '/fidelity-manifest.json', '/manifest.webmanifest', '/sw.js' in cache ? null : null].filter(Boolean);
  for (const path of required) if (!cache.files.includes(path)) throw new Error(`Missing cached resource: ${path}`);
  const diagnosticsAbsent = await page.evaluate(() => typeof window.__FOCUS_DRIVE_TEST__ === 'undefined');
  if (!diagnosticsAbsent) throw new Error('Development diagnostic API leaked into production');
  await page.screenshot({ path: new URL('production-hub.png', output).pathname, fullPage: true });
  const result = { sampledAt: new Date().toISOString(), url: base, productionDiagnosticsAbsent: diagnosticsAbsent, serviceWorkerControlled: true, cache, pageErrors: errors, externalRequests: [...new Set(requests.filter(url => !url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:')))] };
  await writeFile(new URL('production-verification.json', output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} finally { await browser.close(); }
