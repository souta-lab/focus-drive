# プレイフィードバック対応（2026-10-19）

実際に遊んだ感想への対応記録です。数値はこの環境（AMD RX 6400 / Chrome / WebGL2）での実測で、人間の体感評価ではありません。

## 指摘と対応

| 指摘 | 対応 | 確認 |
|---|---|---|
| ガイドが「気持ち悪い精子みたい」 | 浮遊カプセル＋球＋斜めテザーを廃止。路面の発光リング（半径0.9m）＋四方向目盛り＋細い光柱に変更 | [feedback-guide-clear.png](verification/feedback-guide-clear.png) |
| 柵の外を走れる | OTC/Arcadeで横位置を道路中心から3.4mにクランプ（Classicは研究互換のため対象外）。外側に出ようとすると減速＋`GUARDRAIL`表示＋効果音＋ビネット | 実ブラウザで最大横位置3.4000m、`WALL`フィードバックを確認 |
| コースが単調 | 100m距離標、120mバナー、360mゲート看板、500mチェッカー帯、640m風車、180m路面セクター、12m縁石を追加。中心線・評価幅・イベント距離は不変 | [course-landmark.png](verification/course-landmark.png) |
| 音やエフェクトがない | WebAudio合成のエンジン／風／タイヤ音＋HIT・MISS・Gate・Power Zone・Impact・Guideの効果音。画面フラッシュ・加速ライン・揺れ。音は既定ON、設定でOFF | AudioContext `running`、`fx-power`/`fx-wall`クラスを実ブラウザで確認 |
| 最初からGo/No-Goと操縦を同時に | 初回から180秒の二重課題（Baseline）。研究用の60秒×3分割Baselineはエンジン構成として残存 | E2E「mission brief starts the dual task immediately」 |
| 集中できる、これはいい | 既存の自動前進・二重課題・ガイド・Drive Scoreを維持 | — |

## 副次的に直したもの

- **オフライン再読込の不具合**：Viteが`Vary: Origin`を付けるため、Service Workerの`caches.match(event.request)`がサブリソースに一致せず、サーバー停止後にJS/CSSが`ERR_FAILED`になっていた。`{ ignoreVary: true }`で修正し、**サーバープロセスを完全に停止した状態**で再読込・ガレージ・ミッション中断まで確認。
- **性能**：新しい景観メッシュの初回生成で50ms超のフレーム落ちが6回出たため、再生成間隔と縁石密度を削減。180秒実測が**平均60.0FPS・品質フラグ0・GOOD**に戻った。
- **演出の抑制**：`prefers-reduced-motion`と設定「演出を控えめに」で画面アニメーションを停止。

## 検証

| 項目 | 結果 |
|---|---|
| ユニットテスト | **85/85 PASS** |
| 本番ビルド | PASS（strict tsc + Vite + SW） |
| ブラウザE2E | **8/8 PASS** |
| 180秒ベンチ | 平均**60.0FPS**、フレームp95 16.7ms、品質フラグ0、GOOD、イベント53/53、Drive Score 100 |
| 音・ガイド・ガードレール | `docs/verification/feedback-verification.json`、ページエラー0 |
| 完全オフライン | サーバー停止後の再読込＋ガレージ＋ミッション開始〜中断 PASS |

## 残る限界

- 音は合成音で、実車録音・音楽・3D空間音響ではない。
- コースは同じ中心線関数の無限道路のままで、トンネル・分岐・高低差は未実装。
- ガイド・音・エフェクトの「気持ちよさ」は人間のプレイテストで未評価。
- 初回二重課題はゲームの導入判断であり、研究の分割Baselineプロトコルとは異なる。
- スマホ実機・Firefox・Safari、実ピクセル発光時刻の較正は未検証。
