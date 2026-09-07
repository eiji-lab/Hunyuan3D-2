# 進捗記録（progress.md）

再開時は必ず: 1) work_brief を読み直す → 2) このファイル → 3) decisions.md → 4) 続きから再開。

## 現在の段階
第1段階（データ層）: 完了 → 第2段階（調合ロジックエンジン）に着手

## 完了した項目
- プロジェクト土台（package.json / tsconfig.json / vite.config.ts）作成
- decisions.md（配置場所・技術スタック・スキーマ設計・D01〜D08, P01〜P07）
- src/data/*.json 全8ファイル（materials, combos, symptoms, customers, dialogue,
  advisors, events, progression）。いずれも node -e で JSON構文確認済み。
  - materials 22件 / combos 14件(E03予約込み) / symptoms 12件 / customers 10件
  - dialogue: customers 10件 + advisors 2件（シュレイラ/ラプラス）
  - advisors 5件（シュレイラ/ルヴィーネ/ラプラス/新人ちゃん/誰もいない日）
  - events 6件 / progression: 7日分のdayCurve

## 作業中の項目
- 第2段階：調合ロジックエンジン（src/engine/）
  - [ ] 型定義（src/engine/types.ts）
  - [ ] 薬効・副作用の加算、投入順の重み付け、同一素材3つ以上の頭打ち
  - [ ] 例外14種の判定
  - [ ] 症例充足判定・致死判定
  - [ ] 副作用蓄積の再来時持ち越し

## 次にやること
1. src/engine/types.ts で調合結果・素材・症例などの型を定義
2. src/engine/compound.ts で調合ロジックを実装
3. 実装後すぐ tests/engine.test.ts で第4段階前半の検証を書く（UIより先）
