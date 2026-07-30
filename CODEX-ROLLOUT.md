# Codex 併走ロールアウト — 1楽器を EL-SYSTEMA Live 対応にする

各楽器リポで **下のプロンプトをそのまま貼る**。`<REPO_PATH>` と `<INSTRUMENT_ID>` と
`<CORE_CONCEPT>` の3か所だけ差し替える。1リポにつき1 Codex ラン（並列可）。

## コピペ用プロンプト
```
あなたは既存の EL-SYSTEMA web 楽器を1つ、統合演奏卓「EL-SYSTEMA Live」から演奏できるように拡張します。
この楽器の音源・既存UIは絶対に変えないこと。作業はこの1リポの中だけ。

対象リポ: <REPO_PATH>
楽器ID:   <INSTRUMENT_ID>          （短い kebab、例 "hado-beat"）
コア思想: <CORE_CONCEPT>            （この楽器の本質。ノブ3つの抽出根拠。無ければリポのREADME/コードから要約）

■ 背景（EL-SYSTEMA field プロトコル。既に複数楽器で稼働中）
楽器は WebSocket 中継 ws://localhost:8787 で共有の「場(field)」に参加する。
3つのクラシック script が window グローバルを生やす（登録するまで無害・無接続）:
  shared/el-systema-shapes.js / el-systema-transport.js / el-systema-control.js
このリポに無ければ参照リポからコピー:
  el-systema-geometry-osc/geometry-instruments/shared/*.js
アプリ本体より前に classic <script src> で読み込む。

■ 実装（この4つだけ）
1) 音声グラフとマスター gain が出来た後で、?field のときだけ登録する:
   const FIELD_ON = /[?&#]field/.test(location.href);
   if (FIELD_ON && window.registerElSystemaInstrument) {
     window.registerElSystemaInstrument({
       id: "<INSTRUMENT_ID>",
       audioContext: <あなたの AudioContext>,
       outputNode:   <あなたの master GainNode>,   // level 観測に足すだけ・経路は変えない
       sharedAnalyser: <既存 analyser があれば渡す／無ければ省略>,
       onPlay:   () => <再生/resume>,
       onStop:   () => <停止>,
       onSetParam: (name, value) => elsysMacro(name, value),
       onLoadPreset: (preset)    => <保存音色オブジェクトで鳴らす>,
       onSnapshot:   ()          => <現在の音色を JSON 可能な object で返す>,
     });
   }

2) elsysMacro(name, value)  … value は 0..1。次の4名を実装:
   "macro.a" / "macro.b" / "macro.c" … この楽器のコア思想を3軸に抽出したマクロ。
       各マクロは内部の複数パラメータへ分割/統合して写像（0..1 → 各レンジ）。
       <CORE_CONCEPT> と実コードを読んで、本質を捉える3軸を選ぶこと。
   "volume" … 最終出力 gain 0..1。

3) onSnapshot() は onLoadPreset() で完全復元できる object を返す（＝各楽器UIで作った音色）。
   既存の save/preset コードがあれば再利用。

■ 参照実装（このパターンを真似る）
   el-systema-geometry-osc/geometry-instruments/master.html 内の "EL-SYSTEMA LIVE bridge" を検索。
   そのマクロ: A=明度/微分, B=空間/回転, C=粒子/共鳴。

■ 検証（console/pageerror 0 で全て通ること）
   a. 中継起動:  node el-systema-live/server/relay.mjs
   b. 卓を開く:  http://localhost:8787/hub.html
   c. この楽器を ?field=1 付きで http 配信で開く → 卓にチャンネルが自動出現しメーターが動く。
   d. 卓の A/B/C ノブでこの楽器が変化・VOL で音量・＋で snapshot 保存/recall が効く。
   自動化するなら playwright(channel:chrome) の2ページ構成（scratchpad/geo_test.mjs を参考）。
   通ったら commit、（Pages 配信リポなら）push して反映まで。

制約: 触るのはこのリポだけ／既存の音とUIを壊さない／field は必ず ?field ゲートの内側。
```

## 楽器別 <INSTRUMENT_ID> と macro 抽出の初期案（Codex は実コードで確認・調整）
| INSTRUMENT_ID | 楽器 | A | B | C |
|---|---|---|---|---|
| mycorrhiza-beat | 菌根ビート | 発火密度/rate | 菌糸=音色(明度/減衰) | 拡がり/空間 |
| hado-beat | 波動拍 | 場のエネルギー/密度 | 拍の分割/複雑度 | 空間/残響 |
| hado-dust | 波動塵(Jelinek粒子) | 粒子密度 | 粒径/音色 | 散乱/空間 |
| hado-hen | 波動変(変拍子) | 加算拍子の複雑度 | クリック硬さ/低域 | ポリメーター量 |
| hado-ori | 波動織(コード/リフ) | 和声密度/層 | 音階/旋法 | 律動密度 |
| hado-field | 波動場(ドローン) | 場の励起 | 幾何/音色 | 空間/HRTF |
| tsuki-sound | 月楽器(植物細胞) | 細胞活性/密度 | モード/音色 | 空間 |
| saya-sound | 紗綾形(格子×カノン) | カノン密度 | 格子/音色 | 空間 |
| kagome | 籠目(waveguide弦) | 撥弦密度 | 弦の減衰/明度 | 共鳴/空間 |
| cellnoise | CellNoise | 細胞ノイズ密度 | 帯域/音色 | 空間 |
| planarian-drone | プラナリア | ドローン層/密度 | filter/音色 | 移動/空間 |
| bass | Bass(mossreservoir) | 低域駆動/密度 | 倍音/音色 | 空間 |
| particle-noise | Bloom粒子ノイズ | 粒子密度 | 音色 | 拡散 |
| geo-generator | Bloom幾何生成 | 幾何複雑度 | 音色 | 空間 |
| stone-beats | Stonebeats(acid) | 密度 | filter(acid)/音色 | 空間 |
| ocean | Ocean(acid) | うねり密度 | filter/音色 | 空間 |

※ 既に field 登録済み（macro 追加のみ）: cellnoise, kagome, mycorrhiza。
