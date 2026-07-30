# EL-SYSTEMA Live — 統合演奏卓

今まで作った EL-SYSTEMA web 楽器群を **1枚の卓**からライブ演奏・ミキシングする階層。
音色の詳細は各楽器の既存 UI で作り、卓は **ノブ3つ(macro.a/b/c)＋ボリューム＋ミュート/ソロ＋
プリセット/シーン呼び出し** を MIDI（Novation Launch Control XL 系）で操作する。

各楽器は既存の `el-systema-field` プロトコル（`ws://localhost:8787` 中継 ＋ `registerElSystemaInstrument`）で
繋がり、卓は「場のもう1クライアント」として全楽器を制御・監視する。音は各楽器の自タブで鳴る（コントロール卓型）。

## 起動（1コマンド・依存ゼロ）
```
node server/relay.mjs          # :8787 で hub を配信＋WS中継
```
- 卓を開く: **http://localhost:8787/hub.html**
- 各楽器（deployed でも local でも）をブラウザで開くと、既定の `ws://localhost:8787` に繋がり
  卓に自動で並ぶ（kehai 自動発見）。https 配信ページからでも `ws://localhost` は Chrome で許可される。

## 使い方
- **ノブ A/B/C** = 各楽器のコア思想を3軸に抽出した macro（0..1）。ドラッグ/ホイール/MIDIエンコーダ。
- **VOL フェーダー** = チャンネル音量。**MUTE/SOLO**。**master** = 全 volume スケール。
- **＋**（プリセット） = 現在の音色を snapshot 保存 → ドロップダウンで recall（loadPreset）。
- **SCENE ● capture** = 全楽器の {音色＋macro＋volume} を1シーンに保存 → recall で一括呼び出し。
- **⬇/⬆ json** = 卓の全設定（割当・プリセット庫・シーン）を保存/読込。
- **BANK** = 8ch/バンク。楽器が9つ以上なら複数バンクに分かれる。

## MIDI（既存「XL3」規約 = Launch Control XL）
- Fader **CC5–12** → 各chの volume
- Enc 上/中/下 **CC13–20 / 21–28 / 29–36** → macro.a / b / c（Relative）
- Note **40–47** mute・**48–55** solo・**56/57** バンク±・**60/61/62** play/stop/capture
- 実機は Novation Components で Custom Mode を上表の CC/Note に（エンコーダは Relative）。

## 楽器側に必要なこと（macro 対応）
各楽器の `onSetParam(name,value)` に **`macro.a` / `macro.b` / `macro.c` / `volume`** を実装するだけ。
`macro.*` はその楽器のコア思想を抽出・分割・統合して内部複数パラメータへ 0..1 で写像。
音色保存は既存 `onSnapshot()` / `onLoadPreset(preset)` を利用。
参照実装: `el-systema-geometry-osc/geometry-instruments/master.html`（single-file）, `mycorrhiza-beat`（Vite）。

## 祭文（Liturgy）— 場が生き物になる反応層
footer **「祭文 ▸」** でドロワーを開く。JSON で書いて **検証 → 奉じる**。
- **応答** … ある楽器の kehai 信号（`<id>.<presence|low|high>`）が閾値を「持続」秒跨いだら、
  別楽器へ command を撃つ（`一度` / `冷却` つき）。**楽器同士が互いを聴いて自動応答**する。
- **祭次** … 秒指定タイムライン（テンポ無し・`揺` ジッタ・`loop` 可）。
- 発火は卓の macro/vol 状態を経由するので **卓のノブが実際に動く**（場が卓を弾く）。雛形2種同梱。
- スキーマ検証は `shared/el-systema-shapes.js` の `explainLiturgy`（日本語エラー）。

## 場（field）の可視化
channel strip の背後に、全楽器を黄金角スパイラルで配置し kehai で呼吸させる一枚の絵。
presence→明るさ/脈動、low↔high→色相、silence→減衰、mute→沈む、solo→際立つ。
祭文が発火すると source→target に**反応の弧**が走る。

## シーン間モーフ
SCENE 行の **morph** … 現在の状態から選択シーンへ、macro/vol を指定秒で時間補間（preset は着地時に適用）。
即時の **recall** と併用。

## 構成
- `server/relay.mjs` — 依存ゼロの http 静的配信＋WS中継（同一 :8787）。
- `hub.html` / `hub.js` — 統合卓（field クライアント・ミキサー・MIDI・プリセット/シーン庫・シーンモーフ）。
- `hub-field.js` — 場の可視化キャンバス。
- `hub-liturgy.js` — 祭文（応答／祭次）エンジン。
- `shared/` — 各楽器と共有の `el-systema-{shapes,transport,control}.js`（プロトコル）。

> hub は **relay（node）を要するローカル制御卓**。GitHub Pages 等の静的配信単体では中継が無いため動かない。
> 楽器群は各リポで Pages 配信し、hub は手元で `node server/relay.mjs` を立てて操る構成。
