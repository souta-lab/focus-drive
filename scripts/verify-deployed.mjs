import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

/** Real-browser acceptance for the deployed Workers URL (production build: no test API). */
const base = process.env.DEPLOYED_URL || 'https://focus-drive.kitan3409-73e.workers.dev';
const output = new URL('../docs/verification/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=gl-egl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const pageErrors = []; const failedRequests = []; const consoleErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
page.on('requestfailed', request => failedRequests.push(`${request.url()} ${request.failure()?.errorText}`));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const result = { url: base, sampledAt: new Date().toISOString() };
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine === 'PlayCanvas / WebGL2', null, { timeout: 60_000 });
  result.rendererBooted = true;
  result.hasDevDiagnostics = await page.evaluate(() => typeof window.__FOCUS_DRIVE_TEST__ !== 'undefined');
  result.webgl2 = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  await page.getByRole('heading', { name: /Find your/ }).waitFor({ timeout: 20_000 });
  result.hubRendered = true;
  await page.screenshot({ path: new URL('deployed-hub.png', output).pathname, fullPage: true });

  // Start a real mission through the UI and confirm the dual task runs.
  await page.getByRole('button', { name: 'ドライブをはじめる', exact: true }).click();
  await page.getByRole('button', { name: '準備できた', exact: true }).click();
  await page.locator('#countdown').waitFor({ state: 'detached', timeout: 60_000 });
  result.warmupCompleted = true;
  result.missionStage = (await page.locator('#mission-stage').innerText()).trim();
  await page.waitForTimeout(6000);
  result.missionTime = (await page.locator('#mission-time').innerText()).trim();
  result.hud = {
    nav: (await page.locator('#nav-live').innerText()).trim(),
    event: (await page.locator('#event-live').innerText()).trim(),
    target: (await page.locator('#target-live').innerText()).trim(),
    levels: (await page.locator('#levels-live').innerText()).trim(),
  };
  result.vehicle = await page.evaluate(() => document.querySelector('#world')?.dataset.vehicle ?? null);
  await page.screenshot({ path: new URL('deployed-mission.png', output).pathname });
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('button', { name: '中断して記録する', exact: true }).click();
  await page.locator('.result-screen').waitFor({ timeout: 20_000 });
  result.missionAbortFlow = true;
  await page.screenshot({ path: new URL('deployed-result.png', output).pathname });

  // Service worker must be registered and precaching on the production origin.
  result.serviceWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const name = (await caches.keys()).find(key => key.startsWith('focus-drive-'));
    const keys = name ? (await (await caches.open(name)).keys()).length : 0;
    return { registered: !!registration, controller: !!navigator.serviceWorker.controller, cacheName: name ?? null, cachedEntries: keys };
  });
} catch (error) {
  result.failure = String(error);
  try { await page.screenshot({ path: new URL('deployed-failure.png', output).pathname }); } catch {}
}
result.pageErrors = pageErrors;
result.consoleErrors = consoleErrors;
result.failedRequests = failedRequests;
await writeFile(new URL('deployed-verification.json', output), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (result.failure || pageErrors.length) process.exitCode = 1;
