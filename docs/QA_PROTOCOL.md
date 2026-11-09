# FOCUS DRIVE — 検証方法

## 論理とブラウザ実測を分離する

1. `pnpm test`：DOM/GPU非依存の固定step・Go/No-Go状態機械・54/200段階・Classic/OTC独立適応・進行・指標・バックアップ検証。
2. `pnpm build`：TypeScript strict、GLBのSHA-256/マジック/サイズ、Credits、設定Manifest、静的ビルドとオフラインキャッシュ生成。
3. 起動中の開発アプリに `pnpm test:e2e`：画面フロー、キー同時入力、押下リピート排除、手動pause、タブ非表示ハンドラ、IndexedDB再読込、復元確認、コスメ購入、タッチUI。
4. `node scripts/browser-benchmark.mjs`：**実際の180秒間**、rAFから描画し、botによる制御・反応を注入して提示タイミング・フレーム時間・Guide・難易度履歴を採取。
5. 本番静的アプリでService Workerのキャッシュ完了後、オフライン再読込を確認。

開発サーバーのHMRや同時ビルドによる公開リソースの変更はページ再読み込みを発生させるため、連続計測中はソース編集・ビルドを止める。複数のソフトウェアGPUブラウザも同時起動しない。

## 公開値の回帰

| 項目 | 検証 |
|---|---|
| Classic180秒 | 設定の強制、短縮指定でも180秒 |
| 刺激400ms | 表示時間と反応期限を別管理、hidden-frame ACKを記録 |
| 2 / 2.5 / 3秒間隔 | seed固定、72試行、24/48または36/36を厳密検証 |
| 77.5〜82.5% | staircaseは無変更、90%で難化、55%で易化 |
| Sign54 / Road200 | 範囲・端点・ステップ数・初期29/20 |
| ClassicとOTC | Classicはラン終端のみ、OTCは別軸の標本数とクールダウン |
| Baseline→Training≥5→Challenge | 状態機械、重複・順序違い・中断・無効ランの拒否 |
| 15 Guides / World | World単位の実捕獲のみ。経過日数・ラン数による解放は禁止 |
| 15 Missions / Index | 正規状態機械を通ったミッションだけ、単独課題・テストを除外 |

## 重要な実装上の検出と対策

初回のソフトウェアGPUで、ミッション開始直後のシェーダーコンパイルに1秒以上かかる場合があった。生ログはこれを正しく `long-frame>=1000ms` としてINVALIDにした。これを能力低下と扱わないよう、**ミッション開始前に3秒以上の描画ウォームアップと連続安定フレーム確認**を入れ、ウォームアップ後に新しい計測エンジンを起動する。ウォームアップはMission Minutesに含まれない。

手動pauseは進行・時間を凍結し、提示中だった試行だけを無効化する。resume時は時間基準を再アンカーし、停止時間をフレーム落ちや刺激提示遅延と誤認しない。タブ非表示・GPU損失・実際の長い描画停止は、手動pauseとは区別して計測無効化する。

## 実機検証の境界

- 自動E2EはChrome headless + ANGLE SwiftShader。実GPUの60FPSを証明しない。
- タッチはブラウザPointerEventの経路検証。実スマホの多点タッチ精度、DeviceOrientation、実ゲームパッド、Firefox/Safariは別途実機確認。
- タブ非表示E2Eはheadlessのフォーカス差を避け、visibilityハンドラへイベントを注入している。バックグラウンドOS挙動は別検証。
- `visibleFrameTimestampMs` はrAFの描画提出時刻。画面上の実発光時刻はphotodiode等で別較正が必要。
- Guide・W3/W4・OTC適応の係数は公開資料の構造を基にした推定。原作プレイ映像との比較較正は未実施。

検証結果とスクリーンショットは実測後に `verification/` へ保存する。testHarnessのランは端末内の生ログにのみ保持し、コイン・Mission Minutes・World・Indexを汚染しない。

## イベント帰結の確認（2026-10-18 追加）

- `pnpm verify:events`：開発サーバー上で制御APIを使い、Power Zone通過時の `paceFactor > 1.1` と「POWER ZONE · SURGE」、Obstacle接触時の `paceFactor < 0.95` と「IMPACT · RECOVER」、HUDの `EVENT` と `DRIVE SCORE` の変化を確認します。スクリーンショットは `docs/verification/events-*.png`。
- 180秒ベンチマーク（`pnpm bench`）で、イベント53/53・Drive Score 100・品質GOOD・平均60FPSを確認済み。
- Drive Scoreはゲーム表示用です。研究比較用の `navigation.accuracy`、Classic staircase、OTC適応の証拠は道路内割合のみで計算し、結果画面と詳細に両方を併記します。

## 計測品質の扱い（2026-10-19 変更）

以前は**1秒以上の描画停止が1回でも起きると、そのミッション全体が INVALID** でした。実機では初回のシェーダコンパイルやGCで数百ms〜1秒の停止が普通に起きるため、「勝手に終了して何も記録されない」体験になっていました。

現在は:

- 長いフレームは**その区間だけを計測から除外**し、`invalidMs` として積算（フラグは severe ではない）
- ミッション全体を無効化するのは、`invalidMs` が **5秒以上かつ実行時間の10%超** に達した場合のみ
- タブ非表示・GPUコンテキスト喪失・時計の逆行など、計測そのものが壊れる事象は従来どおり即INVALID

## 適応難易度の実時間確認（第二監査後）

- `pnpm verify:difficulty`：180秒の実時間プレイを記録します。0–70秒はイベントを狙い全Targetへ反応、70–140秒は無操作、140–180秒で再開します。
- 2026-10-18の実測：Road 45→99→56→65、Sign 35→54→37→39。熟練時は上昇、失敗時は下降、再開後に再上昇。
- 結果は `docs/verification/difficulty-play.json` と `difficulty-*.png`。制御スクリプトによる検証で、人間の「ちょうど良さ」を示すものではありません。
- E2Eの一時停止テストは、刺激表示中に停止した場合の「その試行のみ無効」と、環境由来の1秒超ストールを区別します。後者も計測としてはINVALIDになりますが、一時停止・再開の不具合としては扱いません。

## 走行体験の確認（2026-10-19）

- `pnpm verify:feedback`：実ブラウザで、音のAudioContextが開始後に`running`、Power Zoneで`fx-power`と減速→加速、ガイドが`APPROACH/LOCKABLE`で路面リングを表示、右へ最大操舵しても横位置が中心から3.4mを超えないこと、`WALL`フィードバックと`fx-wall`が出ることを確認。結果は `docs/verification/feedback-verification.json` と `feedback-*.png`。
- コース景観は `docs/verification/course-landmark.png` で確認。
- 音はヘッドレス環境で波形を聴取できないため、**AudioContextの状態・ゲイン・発音コードの経路**までの検証であり、聴感の検証ではない。
- ガードレールはOTC/Arcadeに適用。評価幅（1.75〜3.2m）より外側の3.4mで止まるため、スコア判定そのものは変わらない。Classicは研究互換のため対象外。
- 初回二重課題はゲームの導入変更。研究の分割Baselineは `MissionEngine` に`taskMode`を渡さない構成で利用できる。
