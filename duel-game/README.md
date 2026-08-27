# BRAIN BURST — Duel Prototype

Three.js製、アクセル・ワールドをモデルとした1v1デュエルゲームのプロトタイプ。

## 起動方法

ES modules を使っているため、`index.html` を `file://` で直接開くとブラウザの
CORS制限に阻まれます（three.jsを含む一般的なThree.jsプロジェクト共通の制約）。
このディレクトリを何らかの静的HTTPサーバーで配信してください。例：

```bash
cd duel-game
python3 -m http.server 8934
# ブラウザで http://localhost:8934/index.html を開く
```

または `npx serve` / VS CodeのLive Server拡張など、任意の静的サーバーで構いません。
ビルドステップは不要です。

## 操作

- `WASD` 移動 / `Space` ジャンプ / クリックでカメラ操作（マウスルック）
- 機体固有のキーは画面下部・選択画面で確認可能（機体ごとに異なる）
- `?turbo=N`（N=1〜8）をURLに付けると、シミュレーション時間を加速できます（検証用。見た目や数値は変わらず、実時間に対する進行速度のみ変化）

## 実装済みアバター（3体）

| アバター | 系統 | 特徴 |
|---|---|---|
| CELADON ANVIL | 超重量級近接 | ANCHOR FEETで踏ん張り、被弾でIMPACT RESERVEを溜めてPILE HAMMERに上乗せ |
| JADE GLASS | 重量級防御 | GLASS SHIELDで正面軽減、大ダメージはDELAYED FRACTUREで遅延・亀裂進行 |
| OLIVE WEDGE | 地形干渉 | SURFACE COAT/REVERSEで地形に高粘着(GRIP)/低摩擦(SLIP)を塗布・反転。COAT MISSILEは弾数制限あり。SATURATION FIREは必殺技ゲージ消費 |

キャラクター選択画面で操作機体を選ぶと、残り2体からランダムに対戦相手(AI)が決まります。

## 開発メモ

- `shoot.js`: Playwrightによる自動スクリーンショット検証スクリプト（`screenshots/`に出力）
- `js/vendor/CREDITS.md`: 同梱している外部アセット（three.js本体・GLTFLoader・アバターの土台モデル）のライセンス表記
- `js/engine/audio.js`: 音声/SE再生フック。現状マニフェストは空でファイル未同梱のため常に無音スキップ。にじボイス等で音声を用意したらここにエントリを追加するだけで再生される
