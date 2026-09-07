import symptomsData from '../data/symptoms.json';
import type { CompoundResult, EffectAxis } from './types';

export interface RequiredAxis {
  axis: EffectAxis;
  minStrength: number;
  note?: string;
}

export interface Symptom {
  id: string;
  name: string;
  severityTier: '軽症' | '中等症' | '重症';
  requiredAxes: RequiredAxis[];
  curable?: boolean;
  inPrototypeScope: boolean;
}

export const SYMPTOMS = symptomsData.symptoms as unknown as Symptom[];
export const SYMPTOMS_BY_ID: Record<string, Symptom> = Object.fromEntries(
  SYMPTOMS.map((s) => [s.id, s]),
);

/**
 * 症例の必要薬効を満たしているかを判定する。
 * 「完璧な正解を出すゲームではない」ため、必要軸を満たせば充足とみなす
 * （過剰投与や余計な副作用は別途、悪化・倒壊判定の側で評価する）。
 */
export function isSymptomSatisfied(result: CompoundResult, symptom: Symptom): boolean {
  if (symptom.requiredAxes.length === 0) return false;
  return symptom.requiredAxes.every(
    (req) => (result.effects[req.axis] ?? 0) >= req.minStrength,
  );
}
