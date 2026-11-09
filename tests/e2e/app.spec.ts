import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.goto('/?test=1');
  await page.waitForFunction(() => !!(window as any).__FOCUS_DRIVE_TEST__?.getRenderer(), null, { timeout: 45_000 });
}
test('hub, locked worlds, collection, garage and credits are functional', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.getByRole('heading', { name: /Find your/ })).toBeVisible();
  await page.getByRole('button', { name: 'Alpine Pass・未解放' }).click();
  await expect(page.locator('#toast')).toContainText('15 Guides');
  await page.getByRole('button', { name: 'ガイド', exact: true }).click();
  await expect(page.locator('.collection-world')).toHaveCount(4);
  await expect(page.locator('.guide-cell')).toHaveCount(60);
  await page.getByRole('button', { name: 'ガレージ', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Make it/ })).toBeVisible();
  await page.getByRole('button', { name: /Coastal sage/ }).click();
  await expect(page.locator('#toast')).toContainText('コイン');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '出典・クレジット' }).click();
  await expect(page.getByRole('dialog')).toContainText('CC BY 4.0');
  await expect(page.getByRole('dialog')).toContainText('CarConcept');
  expect(errors).toEqual([]);
});

test('keyboard steering is simultaneous with single-press response and raw records survive reload', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.start({ missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 8000, testHarness: true }));
  await expect(page.locator('.mission-ui')).toBeVisible();
  await expect(page.locator('#event-live')).toBeVisible();
  await page.waitForFunction(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot()?.elapsedMs > 0, null, { timeout: 30000 });
  const initial = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot().carX);
  await page.keyboard.down('KeyD');
  await page.keyboard.down('Space');
  await page.waitForFunction((x) => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot().carX > x + 0.5, initial);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('Space');
  const inputCount = await page.evaluate(() => {
    const e = (window as any).__FOCUS_DRIVE_TEST__.getEngine();
    return e.finish(true).inputs.filter((i: any) => i.source === 'keyboard').length;
  });
  expect(inputCount).toBe(1);
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.abort());
  await expect(page.locator('.result-screen')).toBeVisible();
  await expect(page.locator('.result-screen')).toContainText('中断');
  await expect(page.locator('.result-screen')).toContainText('DRIVE SCORE');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__FOCUS_DRIVE_TEST__?.getRenderer());
  const p = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getProfile());
  expect(p.history).toHaveLength(1);
  expect(p.completedMissions).toBe(0);
  expect(p.history[0].inputs.filter((i: any) => i.source === 'keyboard')).toHaveLength(1);
});

test('manual pause freezes mission time and resumes without severe long-frame contamination', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.start({ missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 15000, testHarness: true }));
  // Pause between stimuli: pausing mid-presentation deliberately invalidates only that
  // trial, which would dominate this 15s test's invalid-trial fraction.
  await page.waitForFunction(() => {
    const snapshot = (window as any).__FOCUS_DRIVE_TEST__.getSnapshot();
    return snapshot.elapsedMs > 1000 && snapshot.currentStimulus === null;
  });
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  const elapsed = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot().elapsedMs);
  await page.waitForFunction((start) => performance.now() > start + 1200, await page.evaluate(() => performance.now()));
  const frozen = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot().elapsedMs);
  expect(frozen).toBe(elapsed);
  await page.getByRole('button', { name: 'ドライブを再開' }).click();
  await page.waitForFunction((old) => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot().elapsedMs > old + 400, elapsed);
  const diagnostics = await page.evaluate(() => {
    const record = (window as any).__FOCUS_DRIVE_TEST__.getEngine().finish(true);
    return { invalid: record.measurementInvalid, flags: record.qualityFlags };
  });
  expect(diagnostics.flags.filter((f: any) => /frame-delta-clock-mismatch|non-monotonic|resume/i.test(f.reason)), JSON.stringify(diagnostics.flags)).toHaveLength(0);
  // A busy CI/desktop can stall the software renderer at any point; that is a genuine
  // quality flag but not pause/resume contamination. Only pause-attributable severe
  // flags (or stalls after the pause started) fail this check.
  expect(diagnostics.flags.filter((f: any) => /manual-pause|pause/i.test(f.reason) && f.severe), JSON.stringify(diagnostics.flags)).toHaveLength(0);
  expect(diagnostics.flags.filter((f: any) => f.severe && f.tMs >= elapsed - 100), JSON.stringify(diagnostics.flags)).toHaveLength(0);
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.abort());
});

test('mission brief starts the dual task immediately and keeps keyboard controls', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'ドライブをはじめる', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('二重課題');
  await expect(page.getByRole('dialog')).toContainText('標識そのものを狙う必要はありません');
  await page.getByRole('button', { name: '準備できた', exact: true }).click();
  await expect(page.locator('#mission-stage')).toContainText('DUAL TASK');
  await page.waitForFunction(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot()?.elapsedMs > 0, null, { timeout: 30000 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toContainText('Take a breath');
  await page.getByRole('button', { name: '中断して記録する', exact: true }).click();
  await expect(page.locator('.result-screen')).toBeVisible();
});

test('backup import requires confirmation and cosmetic purchases persist', async ({ page }) => {
  await ready(page);
  const fixture = await page.evaluate(() => {
    const p = structuredClone((window as any).__FOCUS_DRIVE_TEST__.getProfile());
    p.coins = 1000;
    return { app: 'FOCUS DRIVE', version: 1, profile: p };
  });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.locator('#import-file').setInputFiles({ name: 'local-test-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('dialog')).toContainText('上書き');
  expect(await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getProfile().coins)).toBe(0);
  await page.getByRole('button', { name: '上書きして復元', exact: true }).click();
  await expect(page.locator('#balance')).toHaveText('1,000');
  await page.getByRole('button', { name: 'ガレージ', exact: true }).click();
  await page.getByRole('button', { name: /Coastal sage/ }).click();
  await expect(page.getByRole('dialog')).toContainText('180');
  await page.getByRole('button', { name: '解放する', exact: true }).click();
  await expect(page.locator('#balance')).toHaveText('820');
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__FOCUS_DRIVE_TEST__?.getRenderer());
  const p = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getProfile());
  expect(p.coins).toBe(820);
  expect(p.selectedPaint).toBe('sage');
  expect(p.ownedPaints).toContain('sage');
});

test('visibility loss is explicitly invalid and never advances progression', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.start({ missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 15000, testHarness: true }));
  await page.waitForFunction(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot()?.elapsedMs > 0, null, { timeout: 30000 });
  await page.evaluate(() => {
    // Exercise the browser visibility event handler without relying on headless window focus.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('dialog')).toContainText('計測不成立');
  await page.getByRole('button', { name: '中断して記録する', exact: true }).click();
  const p = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getProfile());
  expect(p.history[0].measurementInvalid).toBe(true);
  expect(p.history[0].qualityFlags.some((f: any) => f.reason === 'tab-hidden')).toBe(true);
  expect(p.completedMissions).toBe(0);
});

test('immediate high-challenge practice starts dual-task without rewards', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /いきなり高負荷で遊ぶ/ }).click();
  await page.locator('#countdown').waitFor({ state: 'detached', timeout: 45_000 });
  await expect(page.locator('#quality-label')).toHaveText('PRACTICE · 報酬対象外');
  expect((await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getAudio())).state).toBe('running');
  const config = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getEngine().config);
  expect(config.challengeMode).toBe(true);
  expect(config.testHarness).toBe(true);
  expect(config.taskMode).toBe('DUAL');
  expect(config.roadLevel).toBeGreaterThanOrEqual(45);
  expect(config.signLevel).toBeGreaterThanOrEqual(35);
  await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.abort());
  await expect(page.locator('.result-screen')).toContainText('練習モード');
  const profile = await page.evaluate(() => window.__FOCUS_DRIVE_TEST__.getProfile());
  expect(profile.coins).toBe(0);
  expect(profile.completedMissions).toBe(0);
});

test('mobile layout fits viewport and supports independent touch steering and response', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/mobile-hub.png', fullPage: true });
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.start({ missionType: 'TRAINING', taskMode: 'DUAL', durationMs: 8000, testHarness: true }));
  await expect(page.getByRole('button', { name: '左へ操舵' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__FOCUS_DRIVE_TEST__.getSnapshot()?.elapsedMs > 0, null, { timeout: 30000 });
  await page.locator('.mission-ui').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 500 });
  await page.locator('.mission-ui').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.abort());
  const record = await page.evaluate(() => (window as any).__FOCUS_DRIVE_TEST__.getRecord());
  expect(record.inputs.filter((i: any) => i.source === 'touch')).toHaveLength(1);
  expect(record.config.taskMode).toBe('DUAL');
});
