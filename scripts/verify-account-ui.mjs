import { chromium } from '@playwright/test';
/**
 * Checks the account panel against the deployed Worker. It creates one throwaway account per run,
 * so it is kept out of the standard E2E suite (which runs against the static dev server).
 */
const base = process.env.DEPLOYED_URL || 'https://focus-drive.kitan3409-73e.workers.dev';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox','--use-angle=gl-egl','--enable-gpu','--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const email = `ui-${Date.now()}@example.com`;
const steps = {};
try {
await page.goto(base);
await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine === 'PlayCanvas / WebGL2', null, { timeout: 60_000 });
await page.getByRole('button', { name: '設定', exact: true }).click();
steps.panelVisible = await page.locator('#account-panel').isVisible();
steps.startsSignedOut = (await page.locator('#account-panel').innerText()).includes('アカウント無しでも全機能');
await page.fill('#account-email', email);
await page.fill('#account-password', 'short');
await page.getByRole('button', { name: '新規登録', exact: true }).click();
steps.rejectsShortPassword = (await page.locator('.account-error').innerText().catch(() => '')).includes('8文字以上');
await page.fill('#account-password', 'correct horse battery');
await page.getByRole('button', { name: '新規登録', exact: true }).click();
try {
  await page.waitForFunction(() => document.getElementById('account-panel')?.textContent?.includes('サインイン中'), null, { timeout: 30_000 });
  steps.signedIn = true;
} catch (error) {
  steps.signedIn = false;
  steps.panelText = (await page.locator('#account-panel').innerText().catch(() => 'MISSING')).slice(0, 300);
  const direct = await page.evaluate(async (mail) => {
    const salt = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`focus-drive:v1:${mail}`));
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('correct horse battery'), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 600000, hash: 'SHA-256' }, k, 256);
    const key = btoa(String.fromCharCode(...new Uint8Array(bits))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, key }) });
    return { status: response.status, body: (await response.text()).slice(0, 200), keyLength: key.length };
  }, `direct-${Date.now()}@example.com`);
  steps.directApi = direct;
  await page.screenshot({ path: 'docs/verification/account-failure.png' });
}
await page.screenshot({ path: 'docs/verification/account-signed-in.png' });
steps.panelAfterSignIn = (await page.locator('#account-panel').innerText().catch(() => 'MISSING')).slice(0, 200);
steps.buttons = await page.locator('#account-panel button').allInnerTexts();
await page.getByRole('button', { name: 'クラウドへ保存', exact: true }).click();
await page.waitForSelector('.account-notice', { timeout: 30_000 });
steps.backupNotice = (await page.locator('.account-notice').innerText()).slice(0, 60);
// A reload must keep the session (HttpOnly cookie) and restore the signed-in view.
await page.reload();
await page.waitForFunction(() => document.querySelector('#world')?.dataset.engine === 'PlayCanvas / WebGL2', null, { timeout: 60_000 });
const me = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).json());
steps.sessionSurvivesReload = me?.user?.email === email;
await page.getByRole('button', { name: '設定', exact: true }).click();
steps.panelBeforeSignOut = (await page.locator('#account-panel').innerText().catch(() => 'MISSING')).slice(0, 200);
steps.buttonsBeforeSignOut = await page.locator('#account-panel button').allInnerTexts();
const meAfter = await page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).json());
steps.meAfterReload = meAfter?.user?.email ?? null;
await page.getByRole('button', { name: 'サインアウト', exact: true }).click();
await page.waitForFunction(() => document.getElementById('account-panel')?.textContent?.includes('アカウント無しでも全機能'), null, { timeout: 30_000 });
steps.signedOut = true;
console.log(JSON.stringify({ email, steps, errors }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ email, failed: String(error).slice(0, 120), steps, errors }, null, 2));
}
await browser.close();
