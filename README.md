<div align="center">

# 🏎️ FOCUS DRIVE

### Find your flow.

自動前進するオープンホイールのF1マシンを操りながら、指定されたTargetだけに反応する——
**運転 × 注意の二重課題** を鍛える、ローカルファーストのブラウザゲーム。

![PlayCanvas](https://img.shields.io/badge/PlayCanvas-FF6B35?logo=playcanvas&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript_strict-3178C6?logo=typescript&logoColor=fff)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=fff)
![PWA](https://img.shields.io/badge/PWA-offline_ready-5A0FC8?logo=pwa&logoColor=fff)
[![Live](https://img.shields.io/badge/🎮_Play-focus--drive.kitan3409--73e.workers.dev-111111)](https://focus-drive.kitan3409-73e.workers.dev)

🎮 **[今すぐ遊ぶ → focus-drive.kitan3409-73e.workers.dev](https://focus-drive.kitan3409-73e.workers.dev)**

</div>

> ℹ️ [設計書](docs/DESIGN.md)を基にした、動作する垂直スライス＋進行システムの実装です。EndeavorOTCの公式製品ではありません。非公開アルゴリズム・未確認のWorldルール・商用Focus Scoreとの同一性は主張しません。

## ✨ 特徴

- 🏁 **二重課題トレーニング** — 運転（Road）とTarget反応（Sign）の2軸を同時処理。成績に応じて両軸の難易度が独立に適応する
- ⚡ **イベントが走りに効く** — Power Zone通過で+24%加速、Gate +10%、Obstacle回避 +8%／接触は-34%減速＋衝撃。**Drive Score = 道路内55% + イベント45%**
- 📊 **研究互換の指標を分離保持** — navigation.accuracy やClassic staircaseは道路のみで計算し、ゲーム用スコアと混ぜない
- 📴 **ローカルファーストPWA** — アカウント・APIキー不要。保存はIndexedDB、Service Workerでオフラインでも全行程が動く
- 🎲 **再現可能な検証** — ユニットテスト109件＋実ブラウザE2E・ベンチマーク。実測 180秒ミッション平均60 FPS（RX 6400 / WebGL2 / Chrome）

---

## 🚀 起動

**デプロイ済み（すぐ遊べる）**: https://focus-drive.kitan3409-73e.workers.dev

ローカルで動かす場合:

```bash
cd /home/s0u7a/projects/focus-drive
pnpm install
pnpm dev
```

ブラウザで **http://localhost:4173** を開きます。WebGL2が必要です。サーバーへのデータ保存・アカウント・APIキーは不要です。

Cloudflare Workers への再デプロイは `pnpm run deploy:workers`（詳細と既知の制約は[DEPLOYMENT.md](docs/DEPLOYMENT.md)）。

```bash
pnpm test          # 決定論・判定・適応・指標・進行のユニットテスト（109件）
pnpm build         # strict TypeScript + Credits/Manifest + Vite + オフラインキャッシュ
pnpm preview       # ビルド済み静的アプリを確認（4173が使用中なら --port を変更）
pnpm test:e2e      # 起動中の4173アプリをChromeで検証（8件）
pnpm bench         # 180秒の実ブラウザ走行ベンチマーク（要devサーバー）
pnpm verify:events # Power Zone加速とObstacle衝撃を実ブラウザで確認（要devサーバー）
pnpm verify:difficulty # 実時間180秒の適応プレイ（上昇→下降→再上昇）を記録（要devサーバー）
pnpm verify:production  # 本番ビルドのSW・キャッシュ・診断API除去を確認
pnpm verify:offline     # サーバー停止後のオフライン再読込・ミッションを実機検証
pnpm run deploy:workers # Cloudflare Workers へ本番デプロイ（ビルド込み）
pnpm verify:deployed    # デプロイ済みURLを実ブラウザで起動確認
pnpm verify:audio       # エンジン音のレイヤー読込とRPM追従を検証
pnpm verify:account     # 本番のアカウントUIを実ブラウザで検証
```

**この環境での実測（AMD Radeon RX 6400 / WebGL2 / Chrome）**：

- 180秒ミッション：平均60.0 FPS、フレームp95 16.8ms / p99 16.8ms、品質フラグ0
- 72試行：表示時間400.0–416.7ms（平均404.6ms）、提示遅延p95 16.2ms
- Navigation 100%、EVENT 53/53、Drive Score 100、Guide 11捕獲、独立適応が両軸で動作
- 実時間180秒の適応プレイ：Road 45→99→56→65、Sign 35→54→37→39（熟練→無操作→再開）。双方向の難易度変化を確認
- オフライン再読込＋ガレージ＋ミッション開始〜中断まで全行程を実機確認
- Cloudflare Workers 本番配信：起動・二重課題・SWプリキャッシュ17件・ページエラー0を実ブラウザで確認

生データ・スクリーンショットは[検証結果](docs/verification/)と[検証プロトコル](docs/QA_PROTOCOL.md)を参照。ソフトウェアGPUではこの数値を達成しません。

E2Eはこの環境の `/usr/bin/google-chrome` を使用します。他の環境では[Playwright設定](playwright.config.ts)の `executablePath` を変更するか、Playwright標準ブラウザをインストールしてください。

## 🎚 難易度（2026-10-18 改善）

**OTC High Fidelity の通常プレイでは「高負荷チャレンジ」が既定でON**。設定からOFFにできます。チャレンジは公開論文の再現とは別枠の、ゲームとしての追加負荷です。Classicの固定速度・道路判定・イベント非生成を維持。物理的なガードレール境界はOTC/Arcadeに適用（評価幅より外側）。Classicは研究互換のため対象外。

- 好成績時、Road/Targetの難易度をより速く上げる。失敗が続けば下げる。
- 高レベル時の走行評価幅を縮小、Power Zone/Gate/Obstacleを高密度化。
- 高速域でも道路の最大曲率を追えるようHigh Challengeで操舵権限を補正。
- 初回のBaselineから180秒の二重課題。研究用の分割Baselineは別設定で維持。
- ホームの「いきなり高負荷で遊ぶ」で、Road45・Sign35以上の二重課題を即開始できます。**練習扱いでコイン・実績・進行・有効ミッション数には入りません**。
- Classicは固定速度と道路のみの判定を維持し、アーケード用のイベント・加速・衝撃を生成しません。
- 中断・無効・Classic較正・Arcade・順序外の記録では、コインと実績を付与しません（生ログとプレイ時間は保存）。
- 各実プレイ開始時にランダムシードを新規生成。中断→リトライでも道路や標識の系列が固定されず、再現用のシードはログに保存。
- Guideの直近走行精度を増分集計し、全走行履歴の繰り返し走査を廃止。

### イベントが走りに効く（2026-10-18 追加）

- **Power Zone通過で+24%の加速**、Gateで+10%、Obstacle回避で+8%。**Obstacle接触は-34%の減速と横方向の衝撃**。ペースは滑らかに戻ります。
- HUDに `EVENT` 成功率を併記。**Drive Score = 55% 道路内 + 45% イベント**を表示・コイン・結果画面に使用。
- 研究比較用の `navigation.accuracy`（道路内の有効時間割合）、Classic staircase、標準OTCの適応証拠は**道路のみ**（High Challengeはイベント成功率も加味）で計算し、Drive Scoreとは別に保持します。
- 8イベント連続成功の実績 `CLEAN LINE` を追加。

ゲームフィール改善の記録は [docs/GAME_FEEL_2026-10-19.md](docs/GAME_FEEL_2026-10-19.md)、走行体験の詳細は [docs/DRIVING_EXPERIENCE.md](docs/DRIVING_EXPERIENCE.md)、今回のプレイ指摘への対応は [docs/PLAYTEST_FEEDBACK_2026-10-19.md](docs/PLAYTEST_FEEDBACK_2026-10-19.md)、イベントとDrive Scoreは [docs/EVENT_MECHANICS.md](docs/EVENT_MECHANICS.md)。コード・UI・残課題を含むレビューは [docs/REVIEW_2026-10-18.md](docs/REVIEW_2026-10-18.md)。

## 🕹 操作

| 入力 | 運転 | Target反応 |
|---|---|---|
| キーボード | A / D または ← / → | Space / J |
| ゲームパッド | 左スティック | A / X / 右肩 |
| タッチ | 下部の左右操舵ボタン | 操舵・メニュー以外、画面の左右どこでも |
| 傾き対応端末 | 設定で許可後、左右に傾ける | 画面の左右どこでも |

- アクセル・ブレーキは不要。Power Zoneを通り、Gateをくぐり、Obstacleを避けます。
- 指定Target以外には反応しません。標識そのものをクリックする必要はありません。
- Escapeまたは左上のボタンで一時停止。停止中・メニュー・ガレージはMission Minutesに含みません。
- タブの非表示、1秒以上の描画停止、GPUコンテキスト消失は品質フラグを付け、能力推定・進行を保護します。

## 🔧 実装済み

- **PlayCanvas / WebGL2 / TypeScript strict / Vite**。4テーマの決定論的カーブ道路、海・崖・山・木・橋・夜景・雲上道路。
- 既定車はオリジナル手続き型の**Focus F-01**（オープンホイール、前後ウイング、ハロ）。購入車としてCC BY 4.0の精密GLB **CarConcept**（DGG / Eric Chadwick）も同梱。車両はスキンであり、認知課題の物理特性は共通。
- **OTC High Fidelity**が既定。NavigationとTargetingを独立して1秒周期／有効試行ごとに観測し、信頼度・クールダウン付きで適応。
- **NeuroRacer Classic**は別のラン終端staircase。180秒、400ms表示、2 / 2.5 / 3秒間隔、72試行、24/48または36/36、Road200 / Sign54段階。
- 表示時間と反応期限を分離。押下開始のみを判定し、HIT / MISS / FALSE_ALARM / CORRECT_REJECTION / PREMATURE / INVALIDを個別記録。
- **エンジン音は実録サンプル**（CC BY 4.0、4レイヤー）。回転数に応じてクロスフェードと再生速度を変えるため、ATのシフトアップで音程が落ちる。風切り・タイヤ音は合成。[詳細](docs/ENGINE_AUDIO.md)
- **ATギア付きスピードメーター**（8速・タコメーターアーク・レッドライン）と、175/265km/h超の速度演出。
- **ナイトドライブ**：既定ON。どのワールドでも夜の照明・空になる（昼夜の描画コストはこの環境ではほぼ同等）。
- **ステアリング補助**：既定は「中央へ戻る」＝操舵を離すと姿勢が整うが、カーブは自分で曲がる（設計書 §3.4 準拠）。設定で「道路に自動追従」「補助なし」も選択可。Classicは常に補助なし。
- **コース形状**：蛇行振幅を±7.2m→±4.0mへ。評価幅との比率を是正し、常時の微修正を解消。
- **ミッションの長さ**：OTC/Arcadeで3分・10分・30分から選択。Classicは180秒固定。
- **刺激テンポのゲーム調整**（高負荷チャレンジ時のみ）：提示間隔1400–2600msのランダム化、表示時間をSignレベルに応じて520→300msへ短縮。Classicの400ms・2/2.5/3秒は不変。
- **ガイド条件の緩和**：最初のアプローチ12→7秒、ロック3.5→2.6秒、必要道路内88→80%、必要イベント75→55%。止まっている理由をHUDに表示。
- **イベントのゲーム的帰結**：Power Zone加速、Gate加速、Obstacle接触で減速＋衝撃。`DRIVE SCORE` と `EVENT` 成功率をHUD・結果・コインに反映。
- **道路の実境界**：OTC/Arcadeではガードレール外へ出られない（中心から3.4mでクランプ、`GUARDRAIL`表示）。Classicは研究互換のため対象外。
- **音とエフェクト**：速度連動のエンジン／風／タイヤ音、HIT・MISS・Gate・Power Zone・Impact・Guideの合成効果音、画面フラッシュと加速ライン。音は既定ON、設定でOFF。
- **コースの景観変化**：100m距離標、120mバナー、360mゲート看板、500mチェッカー帯、風車、路面セクター、縁石。
- **ガイドの視認性**：浮遊カプセルを廃止し、路面の発光リング＋細い光柱に変更。
- **初回から180秒の二重課題（Baseline）→ Training最低5回 → Challenge**。独立したWorld状態機械。研究用の分割Baselineはエンジン構成として残存。
- Guideの接近→自動ロック→数秒維持→捕獲／喪失。**両方の課題に有効な成功証拠が必要**。次のGuideほど維持時間が増加。
- **Worldごと15 Guidesで次Worldを解放**。全World解放でExpert。コイン・目標達成・カラー／車両解放・Collection。
- ミッション実プレイのみの**10 Mission Minutes**、**15 Missions周期のFocusDrive Index**。
- 半試行補正d′、有効HIT反応時間、時間重み付きNavigation、isotonic Navigation80閾値、条件一致したmultitask cost、World/Mission条件補正・robust scaling・ベクトルノルム合成。
- rAFフレーム間隔の全生ログ、平均FPS・フレーム時間p95/p99・長い描画停止回数。手動pauseはフレームに混ぜず、実際の描画停止は隠しません。
- IndexedDB保存。JSONバックアップ・復元確認、試行CSV、生ログJSON。フォントも同梱。
- **任意アカウント（Cloudflare D1）**：サインインしなければ通信ゼロ。サインイン時のみ、本人操作でプロフィールをクラウドに保存・復元できる。[詳細](docs/ACCOUNTS.md)
- 本番ビルドでPWAのmanifestとService Workerを生成。初回オンライン読み込みで同一originの全静的リソースをキャッシュ。`Vary`ヘッダーがあってもオフラインでサブリソースを返せるよう`ignoreVary`で照合。

## ⚠️ 実装上の区別・未検証の範囲

- **SSMEの非公開内部式は再現できたと主張しません。** OTCの継続適応係数、Guideの秒数、Road速度表、Sign窓テーブルの端点間補間、W3/W4ルールは、動作する推定プロファイルです。
- **Drive Score・イベントのペース効果・高負荷チャレンジはゲーム用の追加要素**です。公開研究の指標・Classic規則とは分離しており、認知能力の評価には使えません。
- S2000の公開ページはCC BY 4.0でしたが、ダウンロードAPIがHTTP401を返したため、取得可能なCC BY車両を採用。S2000とは表示しません。
- 取り込んだGLBは1品質。専用のBlender／meshopt／KTX2によるLODパイプラインとWebGPU切替は未実装です。
- 設定の単独課題較正は180秒のClassicランです。研究のTarget120秒×9／Road60秒×12、短縮較正45秒＋複数ランを自動進行する完全なプロトコルUIは未実装です。
- 累積データがない際のNavigation80は信頼度LOWになり、条件が不十分なmultitask costはN/Aです。Indexの係数・参照分布は推定で、医療的解釈はありません。
- 傾きAPI・実ゲームパッド・Firefox／Safari／モバイル実機での入力・描画精度は別途検証が必要です。ブラウザ時刻は実ピクセルの発光時刻を保証しません。
- 音はWebAudio合成で、実車録音・音楽・3D空間音響ではありません。コースは同一中心線の無限道路で、トンネル・分岐・高低差は未実装です。
- 初回二重課題はゲームの導入判断であり、研究の分割Baselineプロトコルとは異なります。単独課題の較正は設定から利用できます。
- Arcadeは自由走行です。タイムアタック、フォトモード、オンライン同期、クラウド保存は未実装です。

確定値・推定値は[忠実度Manifest](src/config/fidelity-manifest.json)と[再構成プロファイル](src/config/reconstruction-profile.json)、実アセットの出典・改変・ハッシュは[アセットManifest](asset-manifest.json)と[自動生成Credits](CREDITS.md)で確認できます。

## 🗂 構成

- [コア](src/core/index.ts)：DOM非依存の固定step、課題判定、適応、進行、指標。
- [レンダラ](src/render/index.ts)：PlayCanvas、車両・環境・道路。認知判定には関与しません。
- [アプリ](src/main.ts)：rAF提示の明示ACK、入力、画面フロー、保存の接続。
- [保存](src/persistence/store.ts)：IndexedDB・ローカル設定・本人操作のexport/import。
- [ユニットテスト](tests/unit/)と[ブラウザテスト](tests/e2e/app.spec.ts)。

開発環境でのみ `/?test=1` を付けると診断用APIが公開されます。短縮testHarnessランは生ログだけを保持し、コイン・Mission Minutes・進行には使いません。診断用APIは本番ビルドから除去します。

## 📜 アセットとライセンス

[Credits](CREDITS.md)を参照。PlayCanvasはMIT、同梱フォントはSIL Open Font Licenseです。元著作者・Khronos・Akiliによる本アプリの推奨・承認を示すものではありません。
