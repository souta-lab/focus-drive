import { rm, mkdir, writeFile as writeTextFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BUILD_OUTPUT_ROOT, BUILD_OUTPUT_VERSION, getWorkerAssetsDir, getWorkerBundleDir, writeAssets, writeRootConfig, writeWorkerConfig } from '@cloudflare/build-output-utils';

/**
 * FOCUS DRIVE is a fully static SPA: no Worker script, no bindings, no server logic.
 * This writes the Cloudflare Build Output Specification for the existing `dist/` tree
 * so `cf deploy --prebuilt` uploads the real build (including the generated service
 * worker) without re-running a different, plugin-driven Vite build.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

if (!existsSync(dist) || !existsSync(`${dist}index.html`)) {
  throw new Error('dist/index.html is missing. Run `pnpm build` before generating the Workers output.');
}
// A plain `vite build` empties dist and drops the generated service worker, which would
// silently serve index.html in its place. Require the full `pnpm build` output instead.
if (!existsSync(`${dist}sw.js`)) {
  throw new Error('dist/sw.js is missing. Run the full `pnpm build` (it runs scripts/build-sw.mjs), not a bare `vite build`.');
}

const outputRoot = `${root}/${BUILD_OUTPUT_ROOT}/${BUILD_OUTPUT_VERSION}`;
await rm(outputRoot, { recursive: true, force: true });

// Static assets only: worker.config.json is written without a bundle manifest.
await writeAssets({ root, sourceDirectory: dist });
// Worker script: the account API, copied verbatim into the bundle directory.
const bundleDir = getWorkerBundleDir(root);
await mkdir(bundleDir, { recursive: true });
await cp(new URL('../worker/index.js', import.meta.url), `${bundleDir}/index.js`);
await writeTextFile(`${bundleDir}/package.json`, JSON.stringify({ type: 'module' }) + '\n');
await writeWorkerConfig({
  root,
  config: {
    name: 'focus-drive',
    compatibilityDate: '2026-10-06',
    observability: { enabled: true },
    entrypoint: './worker/index.js',
    env: {
      ASSETS: { type: 'assets' },
      DB: { type: 'd1', id: process.env.FOCUS_DRIVE_D1_ID ?? '7b1c9678-c1fb-4646-bd2b-c9f1755352fe' },
    },
    assets: { notFoundHandling: 'single-page-application' },
  },
  // A partial manifest must not list its own main module.
  manifest: { type: 'partial', mainModule: 'index.js', modules: {} },
});
await writeRootConfig(root, undefined, { isPreview: false, mode: 'production' });

const { readdir } = await import('node:fs/promises');
const assets = await readdir(getWorkerAssetsDir(root));
console.log(`Workers build output written to ${BUILD_OUTPUT_ROOT}/${BUILD_OUTPUT_VERSION} with ${assets.length} top-level assets.`);
