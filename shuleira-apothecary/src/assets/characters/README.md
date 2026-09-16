# キャラクター画像の置き場所

作者から画像を受け取ったら、このフォルダに以下のファイル名で配置する
（拡張子は png/jpg/jpeg/webp のいずれでも自動的に読み込まれる）。
ファイルが無いキャラクターは、代わりに霧の中の人影（自動生成SVG）を表示する。
コード側の対応表は `src/main.ts` の `import.meta.glob('./assets/characters/*...')`。

透過PNG推奨（背景が透明な立ち絵）。人物のみが写っている構図が望ましい。

## 試作範囲（優先）
- mil.png     … ミル・クーゲル
- hau.png     … ハウ・クーゲル
- neru.png    … ネル・クーゲル
- tobi.png    … トビ・クーゲル
- oruga.png   … オルガ・クーゲル
- shuleira.png … シュレイラ・クーゲル（助言役）
- laplace.png  … ラプラス・オーゲル（助言役）

## 試作範囲外（将来用・今は表示されない）
- sayu.png, kai.png, rouen.png, dan.png, namonai.png
