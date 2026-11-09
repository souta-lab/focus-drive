import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const port = Number(process.env.OFFLINE_PORT || 4175);
const base = `http://127.0.0.1:${port}`;
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
// Run its own preview child so the "network down" moment is a real connection failure.
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: new URL('..', import.meta.url), stdio: 'pipe', detached: true });
const ready = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('preview did not start')), 30_000);
  server.stdout.on('data', chunk => { if (String(chunk).includes(`:${port}`)) { clearTimeout(timer); resolve(); } });
  server.on('exit', () => { clearTimeout(timer); reject(new Error('preview exited early')); });
});
void ready;
const headed = process.env.HEADED !== '0'; // real SW subresource path; headless drops them under offline emulation
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: !headed, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1440,1000'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = []; const consoleMessages = []; const failed = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => consoleMessages.push(`${m.type()}: ${m.text()}`));
page.on('requestfailed', r => failed.push(`${r.url()} ${r.failure()?.errorText}`));
try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine === 'PlayCanvas / WebGL2', null, { timeout: 60_000 });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await page.getByRole('heading', { name: /Find your/ }).waitFor();
  // The 12 MB vehicle makes precache slower than first paint; require the full cache
  // before simulating an unreachable server, like a real user who leaves the page open.
  await page.waitForFunction(async () => {
    const name = (await caches.keys()).find(x => x.startsWith('focus-drive-'));
    if (!name) return false;
    const keys = await (await caches.open(name)).keys();
    return keys.length >= 15 && keys.some(r => r.url.endsWith('.glb')) && keys.some(r => /\/assets\/index-[^/]+\.js$/.test(r.url));
  }, null, { timeout: 60_000, polling: 1000 });
  // Kill the whole process group, then prove the port is actually unreachable.
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGKILL'); }
  for (let i = 0; i < 60; i++) {
    try { await fetch(base, { signal: AbortSignal.timeout(500) }); } catch { break; }
    await new Promise(r => setTimeout(r, 250));
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine === 'PlayCanvas / WebGL2' && !!document.querySelector('h1'), null, { timeout: 60_000 });
  } catch (error) {
    const diag = await page.evaluate(async () => {
      const name = (await caches.keys()).find(x => x.startsWith('focus-drive-'));
      const js = name ? (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname).find(p => /index-.*\.js$/.test(p)) : null;
      const registrations = (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.state ?? null, waiting: r.waiting?.state ?? null, installing: r.installing?.state ?? null }));
      return { controlled: !!navigator.serviceWorker.controller, registrations, cacheMatch: js ? !!(await caches.match(js)) : null, js, engine: document.querySelector('#world')?.dataset.engine ?? null, fallback: document.querySelector('.render-fallback')?.textContent ?? null, appChildren: document.getElementById('app')?.childElementCount ?? -1, h1: document.querySelector('h1')?.textContent ?? null, cache: name ? (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname) : [] };
    });
    console.error(JSON.stringify({ diag, errors, consoleMessages, failed }, null, 2));
    throw error;
  }
  await page.getByRole('button', { name: 'ガレージ', exact: true }).click();
  await page.getByRole('heading', { name: /Make it/ }).waitFor();
  await page.getByRole('button', { name: 'ドライブ', exact: true }).click();
  await page.getByRole('button', { name: 'ドライブをはじめる', exact: true }).click();
  await page.getByRole('button', { name: '準備できた', exact: true }).click();
  await page.locator('#countdown').waitFor({ state: 'detached', timeout: 45_000 });
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('button', { name: '中断して記録する', exact: true }).click();
  await page.locator('.result-screen').waitFor({ timeout: 20_000 });
  const result = { sampledAt: new Date().toISOString(), scenario: 'vite preview process killed after first load; reload + garage + mission warmup + pause + abort while unreachable', offlineReload: true, offlineNavigation: true, offlineMissionFlow: true, pageErrors: errors };
  await writeFile(new URL('offline-verification.json', output), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(errors.join('; '));
} finally { try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); } await browser.close(); }
