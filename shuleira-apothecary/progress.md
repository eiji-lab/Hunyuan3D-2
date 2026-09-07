# 進捗記録（progress.md）

再開時は必ず: 1) work_brief を読み直す → 2) このファイル → 3) decisions.md → 4) 続きから再開。

## 現在の段階
第2段階（調合ロジックエンジン）＋第4段階前半（単体テスト）: 完了 → UI着手前

## 完了した項目
- 第2段階: src/engine/{types.ts, compound.ts, symptoms.ts, table.ts}
  - 投入順の重み付け、同一素材3つ以上の頭打ち、濁茸の全薬効増幅、例外14種の判定と適用、
    症例充足判定、致死判定、E04即時破壊、台の腐食蓄積・翌朝リセットを実装
  - 数値の解釈根拠は decisions.md D09 に集約
- 第4段階前半: tests/engine.test.ts（31件）全てパス（`npx vitest run`）
  - 231通りの2素材組み合わせ全数検証、例外14種個別の効果検証、投入順、頭打ち、
    致死判定、E04即時破壊、症例充足判定を網羅
- npm install 済み（package-lock.json はこのフォルダ配下、Hunyuan3D-2本体には影響しない）
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
1. 第3段階（UI）に着手する前に .gitignore を追加（node_modules除外）
2. src/state/storage.ts（localStorage薄いラッパー）を作る
3. UI実装: 客サムネイル列/台3つ/素材棚タブ/台詞切り替え/煙草残量/症状演出/開始・締め画面
4. UI完成後、第4段階後半（自動プレイ・バランス検証スクリプト）に着手
5. 最後に report.md 作成
