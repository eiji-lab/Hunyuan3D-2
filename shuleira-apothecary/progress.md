# 進捗記録（progress.md）

再開時は必ず: 1) work_brief を読み直す → 2) このファイル → 3) decisions.md → 4) 続きから再開。

## 現在の段階
第1段階（データ層）: 作業中

## 完了した項目
- プロジェクト土台（package.json / tsconfig.json / vite.config.ts）作成
- decisions.md 初版（配置場所・技術スタック・スキーマ設計・保留事項D01〜D06, P01〜P07）

## 作業中の項目
- src/data/*.json の作成（第1段階）
  - [ ] materials.json（素材22種）
  - [ ] combos.json（例外14種、E03は予約のみ）
  - [ ] symptoms.json（症例12種）
  - [ ] customers.json（客10種）
  - [ ] dialogue.json（台詞：客10種＋助言役2名分＋幻聴書き換え規則）
  - [ ] advisors.json（助言役4名、うち2名は試作範囲外フラグ）
  - [ ] events.json（供給イベント6種）
  - [ ] progression.json（難易度カーブ、試作は1〜7日想定）

## 次にやること
1. materials.json から着手し、22種を仕様書の説明文そのまま転記する
2. combos.json で14例外＋E03予約枠を作る
3. symptoms.json, customers.json と進める
