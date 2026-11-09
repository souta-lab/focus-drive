# FOCUS DRIVE — 第三監査 (2026-10-19)

対象: `/home/s0u7a/projects/focus-drive`  
方式: Remote Desktop Commanderで最新版コードを調査、再現可能な問題を直接修正、追加のユニットテストを実装。Gitリポジトリ/PRの作成なし。

## 監査時の最新版
前回からF1風車両・音声エフェクト・ガードレールとの物理衝突・初回から180秒DUAL Baseline・画面FX・E2Eスクリプト改良などが追加されていた。開発サーバーは `http://localhost:4173/`。

## 今回修正した不具合（3件）

### 1. リトライで出題・道路パターン固定
従来は `nextMission(profile)` が `completedMissions` と `worldId` のみに基づいて `seed` を作成するため、同じミッションを中断してリトライする場合や、進捗の変わらない練習では同じ道路・ターゲット系列が出ていた。

**修正**: `src/main.ts` のユーザー操作による開始時のみ `crypto.getRandomValues(new Uint32Array(1))` で新しい32bitシードを発行。`nextMission` の純粋な決定論的設計・テスト用シード注入は維持。シードは `MissionRecord.config.seed` に保存され、同じ条件の再現が可能。

### 2. Guide判定が二乗時間的に重くなる
従来は固定60Hzの `updateGuide()` 内で `this.samples.filter(...)` を実行し、全履歴を毎step走査。ミッション後半ほどCPU仕事量が増大した。

**修正**: `guideNavStartIndex` / `guideNavValidCount` / `guideNavInsideCount` を用いた30秒ウィンドウの増分集計。各サンプルはウィンドウに一度追加、一度除去されるだけ。品質フラグや `DUAL` の判別、境界時刻の条件を保つ。

**回帰テスト**: `tests/unit/third-audit.test.ts` で、段階的Baselineの数千stepについて内部カウンタが独立な全履歴フィルタと一致することを確認。

### 3. Classicへのガードレール物理処理侵入
最新のガードレールは車を路面端で反射・停止させる。一方 Classic は進行中の車位置を制限しない前の物理状態だったため、同じ入力の走行記録に差が生じていた。

**修正**: `src/core/engine.ts` でガードレールのclampと反射をOTC/Arcadeに限定。Classicの固定速度・道路内評価・研究型staircaseを維持。回帰テストでClassicは3.4mを超えて横移動可能、OTCは3.4m以内に収まることを確認。

## ドキュメント整合性
- HOMEのRoute詳細のBaseline説明を現実装の「初回から二重課題」に訂正。
- READMEの60秒単独→60秒単独→60秒DUALという古い説明を更新。
- READMEでHigh Challengeの適応がゲーム用イベント成功率を使う点と、乱数シード、Guide集計最適化を反映。
- 新規ドキュメントと新規回帰テスト追加。

## 検証
- `pnpm test`: **85/85 PASS**（修正後の検証）。
- `pnpm build`: TypeScript strictチェック、アセット検査、ViteビルドとSW生成まで **PASS**。
- `http://localhost:4173/`: HTTP 200。
- 過去の版でのE2E 8/8合格と、今回の最新版の全E2Eは区別する。今回の全E2Eはまだ実施していない。実PCのload averageが13–15、常駐アプリとFirefox/Javaプロセスでメモリ負荷が高いため、ソフトウェアGPUの長時間Playwright実行を控えた。
- 認知効果・EndeavorOTCの非公開SSMEとの同一性を証明するものではない。

## 継続調査すべき論点
1. 高速時に偶発的な1秒超のフレーム欠落がある環境で、実プレイ中の計測が無効になる頻度。
2. 実際のキーマウユーザーが180秒プレイしたときの目標80%付近への収束性。前回のBot 180秒ベンチマークと人間の難易度体感を区別。
3. Firefox / モバイル端末 / WebGLコンテキストロスト・復帰経路の実機検証。
4. 1秒ごとに実施するイベント成功率フィルタなどの追加性能最適化、およびrendererのdraw call計測。
5. 既存の医療研究型Baselineと通常Baselineは異なる: 通常はDUAL 180秒、研究用の未指定 `taskMode` では分割Baseline。README/アプリの導線も揃えた。

## 変更ファイル
- `src/main.ts`
- `src/core/engine.ts`
- `tests/unit/third-audit.test.ts`（新規）
- `README.md`
- `docs/THIRD_AUDIT_2026-10-19.md`（本レポート）

## 追加：残課題2件の実測（2026-10-19）

第三監査で「PC負荷が高いため未実施」とされた2項目を実施した。詳細は [THIRD_AUDIT_FOLLOWUP_2026-10-19.md](THIRD_AUDIT_FOLLOWUP_2026-10-19.md)。

- **難易度の収束性**: 固定skillボット3種 × 180秒（高負荷チャレンジON）。難易度は実力に正しく追従し（最終Road: strong 81 / mid 27 / weak 1）、midでは観測精度0.795±0.006とデッドバンド内に収まる。**ただしレベルは固定点に収束せず、直近60秒でも13段階の振幅で振動**し続ける。strongは評価幅がほぼレベル82で下限1.75mに張り付くため、以降は速度のみが難易度となり天井まで上昇を続ける。
- **実GPUのフレーム時間・ドローコール**: AMD RX 6400 / 1440×1000。**60.0 FPS（p95 16.7ms）、ドローコール平均352（339–368）、CPUサブミット平均2.05ms**、品質GOOD・エラー0。ドローコールは車両・イベントが未マージなことが主因で、削減余地がある。
- 計測のため `DriveRenderer.stats()` を追加。ホストが手動駆動するためPlayCanvasの統計が更新されず、描画後に `app.stats.updateBasic()` を呼んで実GLドローコールを取得している。

## 追加：Cloudflare Workers への本番デプロイ（2026-10-19）

第三監査後に、`cf` コマンドで本番デプロイを実施した。

- 本番URL: **https://focus-drive.kitan3409-73e.workers.dev**（Worker名 `focus-drive`、Version `88f904ca`）
- 方式: 既存の `pnpm build`（SW生成を含む）をそのまま使い、`scripts/build-workers-output.mjs` が Build Output Specification を生成し、`cf deploy --prebuilt` でアップロードする。`pnpm run deploy:workers` に統合。
- 理由: `cf deploy` の自動設定は Vite プロジェクトに `@cloudflare/vite-plugin` を import だけ注入して `plugins` に登録しないため仕様ツリーが生成されない。さらに独自の `vite build` が `dist/` を空にするため、**`dist/sw.js` が消えて `/sw.js` が index.html を返す事故**が実際に発生した。既存ビルド工程を保護するため `--prebuilt` 方式を採用し、`build-workers-output.mjs` に `dist/sw.js` 必須チェックを追加した。
- 検証: 実ブラウザで WebGL2 起動、本番ビルドに開発用診断APIが無いこと、二重課題ミッション開始〜HUD更新〜中断、Service Worker 登録と17件のプリキャッシュ、ページ/コンソールエラー0・失敗リクエスト0を確認。`docs/verification/deployed-verification.json`。
- 詳細と既知の制約: `docs/DEPLOYMENT.md`。
