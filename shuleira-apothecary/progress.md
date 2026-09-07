# 進捗記録（progress.md）

再開時は必ず: 1) work_brief を読み直す → 2) このファイル → 3) decisions.md → 4) 続きから再開。

## 現在の段階
第1〜5段階すべて完了。work委譲用指示書v1.1に基づく試作実装は一区切り。

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

## 完了した項目（続き）
- 第4段階後半: scripts/balance-sim.ts（安全重視/効率重視/ランダムの3方針、
  各800日・総接客数9,884件）を実装し `npm run sim` で実行可能にした。
  結果は scripts/balance-report.md に出力。
  - 検証中に重大な実装バグを発見・修正: 「在庫は通しで管理する」(D05)を
    「初日以降一切補充しない」と実装していたため、22素材中18種が序盤で
    枯渇したまま二度と補充されなかった。常時在庫・配給の日次補充ロジックを
    追加（decisions.md D12）し、再検証で解消を確認。
  - progression.json の playerSymptom.progressPerSecond を0.4→0.6に調整
    （重度到達がほぼ必ず1日の終わり際になり検証不能だったため）。
  - 判定基準3項目（未使用素材ゼロ／煙草消費が自分と客に分散／重度到達後の
    成功率低下）を全て満たすことを確認済み。
- `npx tsc --noEmit` / `npx vitest run`（31件）/ `npx vite build` いずれも成功。

- リセット機能（指示書§04必須項目「セーブ／リセット」の未実装分）を追加。
  設定バーに「リセット」ボタン、確認ダイアログ後にlocalStorageを消して1日目から
  再開する。Playwrightで動作確認済み。設定バーのレイアウトも2行に整理。

- report.md 作成完了（できているもの／判断待ちのもの(優先度順)／壊れているもの・
  未完のもの／バランスレポートの4節）。

## 次にやること
特になし。帰還後、report.md §0（配置場所）とdecisions.mdの保留事項を確認してもらう。
