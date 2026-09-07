export type EffectAxis =
  | '鎮静'
  | '覚醒'
  | '鎮痛'
  | '解毒'
  | '遮断'
  | '保持'
  | '解熱'
  | '浮遊';

export type SideEffectAxis = '依存' | '毒性' | '鈍麻' | '混濁' | '発熱' | '腐食';

export interface MaterialAxisValue<A extends string> {
  axis: A;
  strength: number;
}

export interface Material {
  id: string;
  number: number;
  name: string;
  reading: string;
  category: string;
  origin: string;
  originGroup: string;
  supplyTier: string;
  isDiluent?: boolean;
  effects: MaterialAxisValue<EffectAxis>[];
  sideEffects: MaterialAxisValue<SideEffectAxis>[];
  amplifiesAllEffectsBy: number | null;
  description: string;
}

export type ComboSeverity =
  | 'beneficial'
  | 'neutral_failure'
  | 'accident_recoverable'
  | 'accident_hidden'
  | 'accident_severe'
  | 'cure_severe'
  | 'lethal_risk'
  | null;

export interface Combo {
  id: string;
  label: string;
  status: 'active' | 'reserved';
  materials: string[];
  matchRule: 'exact-set' | 'diluent-plus-any';
  mechanicalEffect: string | null;
  narrativeEffect: string | null;
  designNote: string;
  severity: ComboSeverity;
  destroysTableImmediately?: boolean;
  ignoresTableDamageThreshold?: boolean;
  formsNoPotion?: boolean;
  delayedConsequence?: string;
  resolvesSymptom?: string;
  curesAddiction?: boolean;
  customerCollapsesThatDay?: boolean;
  milderThan?: string;
}

/** 調合に投入した素材の並び（先頭が最初に入れたもの） */
export type CompoundInput = string[];

export type AxisTotals<A extends string> = Partial<Record<A, number>>;

export type EncounterOutcome = 'survive' | 'worsen' | 'collapse';

export interface CompoundResult {
  /** 例外判定を経た最終的な薬効合計（軸ごと） */
  effects: AxisTotals<EffectAxis>;
  /** 例外判定を経た最終的な副作用合計（軸ごと） */
  sideEffects: AxisTotals<SideEffectAxis>;
  /** 発火した例外組み合わせのID */
  triggeredCombos: string[];
  /** 薬自体が完成しない（E04など） */
  formsNoPotion: boolean;
  /** 台を即座に使用不可にする（E04） */
  destroysTableImmediately: boolean;
  /** この調合で台に蓄積する腐食ダメージ */
  corrosionAdded: number;
  /** 演出・判定用の付加フラグ */
  flags: Record<string, boolean | string>;
}
