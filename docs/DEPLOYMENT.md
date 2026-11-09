# Cloudflare Workers へのデプロイ

FOCUS DRIVE は静的アセット＋任意アカウントAPIのWorkerとして配信します。アカウントを使わないプレイヤーの通信はゼロで、`/api/*` は設定パネルからサインインした時だけ呼ばれます（詳細は [ACCOUNTS.md](ACCOUNTS.md)）。

- 本番URL: **https://focus-drive.kitan3409-73e.workers.dev**
- アカウント: `（個人メールアドレスのため省略）`

## デプロイ

```bash
pnpm run deploy:workers
```

これは次の3つを順に実行します。

1. `pnpm build` — strict tsc、忠実度Manifest/再構成プロファイルの公開、credits生成とGLBハッシュ検証、Viteビルド、**Service Worker生成**
2. `node scripts/build-workers-output.mjs` — `dist/` を静的アセットとして、`worker/index.js` をWorkerバンドルとして Build Output Specification（`.cloudflare/output/v0/`）に書き出す
3. `cf deploy --prebuilt` — 仕様ツリーをそのままアップロード

バインディングは `ASSETS`（静的アセット）と `DB`（D1, id `7b1c9678-c1fb-4646-bd2b-c9f1755352fe`）。別のD1を使う場合は `FOCUS_DRIVE_D1_ID` で上書きします。

`pnpm deploy` は pnpm 組み込みコマンドと衝突するため、スクリプト名は `deploy:workers` です。

## なぜ `cf deploy` 単体ではないのか

`cf deploy` は Vite プロジェクトを検出すると自動設定を行い、`@cloudflare/vite-plugin` を `vite.config.ts` に注入して独自の `vite build` を実行します。このプロジェクトでは次の問題がありました。

- 自動設定は import 文だけを追加し、`plugins` 配列へ登録しないため Build Output Specification が生成されず、デプロイが失敗する（`vite.config.ts` が `defineConfig` ではなく `defineVitestConfig` を使っているため）。
- 独自の `vite build` は `dist/` を空にするため、**`scripts/build-sw.mjs` が生成した `dist/sw.js` が消える**。実際に一度これが起こり、`/sw.js` が index.html を返してオフライン機能が壊れた。

そのため、既存のビルド工程（PWA/オフラインキャッシュ含む）をそのまま使い、その出力から仕様ツリーを生成して `--prebuilt` でデプロイする方式にしています。`scripts/build-workers-output.mjs` は `dist/sw.js` が無い場合にエラーを出し、同じ事故を防ぎます。

## 設定

- `cloudflare.config.ts` — Worker 名 `focus-drive`、`compatibilityDate`、`observability`、SPA 用の `assets.notFoundHandling: "single-page-application"`
- `scripts/build-workers-output.mjs` — `writeAssets` / `writeWorkerConfig`（bundle 無し = assets-only）/ `writeRootConfig` を `@cloudflare/build-output-utils` から呼び出し
- `.gitignore` — `.cloudflare/output` と wrangler 関連を除外

`wrangler` 関連のビルドスクリプト（`workerd`）は `pnpm-workspace.yaml` の `allowBuilds` で許可しています。

## デプロイ後の確認

```bash
pnpm run verify:deployed      # 実ブラウザで本番URLを起動確認
pnpm run verify:account       # アカウントUI（登録・保存・リロード・サインアウト）
```

2026-10-19 の実測（新バージョン `88f904ca`）:

| 項目 | 結果 |
|---|---|
| PlayCanvas / WebGL2 起動 | PASS |
| 本番ビルドに開発用診断APIが無いこと | PASS（`__FOCUS_DRIVE_TEST__` なし） |
| ハブ表示 | PASS |
| 二重課題ミッション開始〜HUD更新〜中断 | PASS（`DUAL TASK`、NAV/EVENT/TARGET が更新） |
| 車両 | `focus-f01-procedural` |
| Service Worker | 登録済み・制御中・17エントリをプリキャッシュ |
| ページエラー / コンソールエラー / 失敗リクエスト | 0 / 0 / 0 |

静的配信の確認:

- `/`、`/sw.js`（`text/javascript`）、`/manifest.webmanifest`、`/fidelity-manifest.json`、`/assets/credits.json` は 200
- 未定義パスは SPA フォールバックで 200 `text/html`
- GLB は `model/gltf-binary` で配信（約11.8MB、Cloudflare の1ファイル上限内）

生データは [deployed-verification.json](verification/deployed-verification.json)、画面は [deployed-hub.png](verification/deployed-hub.png) / [deployed-mission.png](verification/deployed-mission.png) / [deployed-result.png](verification/deployed-result.png)。

## 既知の制約

- アセットは Cloudflare の Workers 静的アセットとして配信され、`cache-control: public, max-age=0, must-revalidate` が付きます。ハッシュ付きファイル名なので実害は小さいですが、長期キャッシュの明示設定は未実施です。
- カスタムドメインは未設定で、`workers.dev` のURLのみです。
- サーバー側処理は任意アカウント（`/api/auth/*`, `/api/profile`）のみです。スコア検証・ランキングはありません。アカウントを使わなければゲームデータはすべて端末内です。
- D1は無料枠のCPU制限（約10ms/リクエスト）があるため、パスワードKDFはブラウザ側で実行しています（[ACCOUNTS.md](ACCOUNTS.md) 参照）。
- 一度アップロード済みのアセットはコンテンツハッシュ単位で再利用されます。古いバージョンのハッシュ資産は残ります。
