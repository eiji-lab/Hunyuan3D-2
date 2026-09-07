# 進捗記録（progress.md）

再開時は必ず: 1) work_brief を読み直す → 2) このファイル → 3) decisions.md → 4) 続きから再開。

## 現在の段階
第3段階（UI）: 完了（動作確認済み） → 第4段階後半（自動プレイ・バランス検証）に着手

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

## 完了した項目（続き）
- 第3段階: src/state/{storage.ts, types.ts, gameState.ts}, src/ui/dialogue.ts,
  src/main.ts, src/styles.css, index.html
  - 客サムネイル列＋タップで詳細表示（外見情報を日本語ラベルで表示）
  - 台3つ、タップのみで素材投入→調合→渡す
  - 素材棚を分類タブ（植物由来/獣由来/鉱物由来/分泌由来/加工品/水）で切り替え
  - 台詞の切り替え表示（症状段階で間隔可変）、幻聴による書き換え（中度以上）
  - 煙草の残量表示、自分で吸う／客に渡すボタン
  - プレイヤー症状の視覚効果をCSSクラスで実装（揺れ→文字の乱れ→表示食い違い→暴走）
  - 1日の開始画面（助言役・配給・供給イベント）と締め画面（シュレイラの一言、日次統計）
  - 音量スライダー・ミュートボタン実装済み
  - localStorage保存（薄いラッパー経由）、次の日へ引き継ぎ（在庫は通しで管理）
- Playwright（playwright-core、Chromium）で実機動作確認:
  日開始→客来店(トビ/オルガ)→素材追加→調合→渡す→在庫加算→症状に応じたCSS
  クラス切り替え(mild/moderate/severe/critical)→日終了オーバーレイ、を実地確認。
  コンソールエラーなし。UI表示バグ2件（appearance英語キー表示、音量ラベル折返し）
  発見しその場で修正済み。

## 次にやること
1. 第4段階後半: scripts/balance-sim.ts で安全重視/効率重視/ランダムAIによる
   1000回以上の自動プレイを実装し、症例別成功率・素材使用率などをレポート出力
2. 判定基準（未使用素材ゼロ、煙草消費の偏りなし、重度後の成功率低下）を確認し、
   満たさなければ progression.json 等の数値を調整
3. 最後に report.md を作成
