import materialsData from '../data/materials.json';
import combosData from '../data/combos.json';
import type {
  AxisTotals,
  Combo,
  CompoundInput,
  CompoundResult,
  EffectAxis,
  Material,
  SideEffectAxis,
} from './types';

const MATERIALS = materialsData.materials as Material[];
export const MATERIALS_BY_ID: Record<string, Material> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
);

const ACTIVE_COMBOS = (combosData.combos as Combo[]).filter((c) => c.status === 'active');

/**
 * 投入順による薬効の重み。先に入れたものほど強く出る。
 * decisions.md D09: 「先＝強化・後＝抑制」を線形の位置依存係数として実装した暫定式。
 */
function effectOrderMultiplier(position: number, total: number): number {
  const fromEnd = total - 1 - position;
  return 1 + 0.15 * fromEnd;
}

/**
 * 投入順による副作用の重み。後に入れたものほど抑えられる。
 */
function sideEffectOrderMultiplier(position: number): number {
  return Math.max(0.25, 1 - 0.15 * position);
}

interface OccurrenceInfo {
  materialId: string;
  position: number;
  occurrenceIndex: number; // 同一素材の中で何番目の投入か（0始まり）
}

function buildOccurrences(input: CompoundInput): OccurrenceInfo[] {
  const seenCount: Record<string, number> = {};
  return input.map((materialId, position) => {
    const occurrenceIndex = seenCount[materialId] ?? 0;
    seenCount[materialId] = occurrenceIndex + 1;
    return { materialId, position, occurrenceIndex };
  });
}

function aggregateBase(input: CompoundInput): {
  effects: AxisTotals<EffectAxis>;
  sideEffects: AxisTotals<SideEffectAxis>;
} {
  const occurrences = buildOccurrences(input);
  const total = input.length;
  const effects: AxisTotals<EffectAxis> = {};
  const sideEffects: AxisTotals<SideEffectAxis> = {};

  const amplifierCount = input.filter(
    (id) => MATERIALS_BY_ID[id]?.amplifiesAllEffectsBy,
  ).length;
  const amplifyBy = amplifierCount > 0
    ? Math.max(
      ...input
        .map((id) => MATERIALS_BY_ID[id]?.amplifiesAllEffectsBy ?? 0),
    )
    : 0;

  for (const occ of occurrences) {
    const material = MATERIALS_BY_ID[occ.materialId];
    if (!material) continue;

    // 同一素材3つ以上で薬効は頭打ち（3投入目以降は効果分の追加なし）
    const effectStacksAllowed = occ.occurrenceIndex < 2;
    const effectMultiplier = effectOrderMultiplier(occ.position, total);
    const sideMultiplier = sideEffectOrderMultiplier(occ.position);

    if (effectStacksAllowed) {
      for (const e of material.effects) {
        const boosted = e.strength + (amplifyBy > 0 ? amplifyBy : 0);
        effects[e.axis] = (effects[e.axis] ?? 0) + boosted * effectMultiplier;
      }
    }

    // 副作用は頭打ちにならず、常に加算され続ける
    for (const s of material.sideEffects) {
      sideEffects[s.axis] = (sideEffects[s.axis] ?? 0) + s.strength * sideMultiplier;
    }
  }

  return { effects, sideEffects };
}

function distinctIds(input: CompoundInput): Set<string> {
  return new Set(input);
}

export function detectCombos(input: CompoundInput): Combo[] {
  const ids = distinctIds(input);
  const matched: Combo[] = [];

  for (const combo of ACTIVE_COMBOS) {
    if (combo.matchRule === 'exact-set') {
      if (combo.materials.every((m) => ids.has(m))) {
        matched.push(combo);
      }
    } else if (combo.matchRule === 'diluent-plus-any') {
      // combo.materials は ["M05", "*"] の形。M05以外に最低1種入っていれば発火。
      const diluentId = combo.materials.find((m) => m !== '*');
      if (diluentId && ids.has(diluentId) && ids.size >= 2) {
        matched.push(combo);
      }
    }
  }

  return matched;
}

/**
 * 例外組み合わせ14種の機械的効果の解釈（decisions.md D09参照）。
 * 文書は現象の文章表現のみのため、数値・フラグへの変換はここで確定させた。
 */
function applyCombo(
  combo: Combo,
  effects: AxisTotals<EffectAxis>,
  sideEffects: AxisTotals<SideEffectAxis>,
  flags: Record<string, boolean | string>,
): void {
  switch (combo.id) {
    case 'E01': {
      const sedation = effects['鎮静'] ?? 0;
      effects['鎮静'] = 0;
      effects['覚醒'] = (effects['覚醒'] ?? 0) + sedation;
      flags.customerAgitated = true;
      break;
    }
    case 'E02': {
      sideEffects['依存'] = Math.min(sideEffects['依存'] ?? 0, 1);
      flags.purified = true;
      break;
    }
    case 'E05': {
      effects['解熱'] = 0;
      sideEffects['発熱'] = 0;
      flags.neutralized = true;
      break;
    }
    case 'E06': {
      effects['浮遊'] = (effects['浮遊'] ?? 0) + 5;
      flags.customerFloatsUncontrollably = true;
      break;
    }
    case 'E07': {
      sideEffects['鈍麻'] = (sideEffects['鈍麻'] ?? 0) * 2;
      flags.hiddenAftereffect = true;
      break;
    }
    case 'E08': {
      for (const axis of Object.keys(sideEffects) as SideEffectAxis[]) {
        sideEffects[axis] = (sideEffects[axis] ?? 0) * 0.5;
      }
      flags.mitigated = true;
      break;
    }
    case 'E09': {
      sideEffects['毒性'] = Math.min(sideEffects['毒性'] ?? 0, 1);
      flags.coated = true;
      flags.resolvesSymptom = combo.resolvesSymptom ?? '';
      break;
    }
    case 'E10': {
      flags.curesAddiction = true;
      flags.customerCollapsesThatDay = true;
      break;
    }
    case 'E11': {
      flags.beginsTreeification = true;
      flags.symptomFullyResolved = true;
      break;
    }
    case 'E12': {
      for (const axis of Object.keys(sideEffects)) {
        delete (sideEffects as Record<string, number>)[axis];
      }
      flags.ideal = true;
      break;
    }
    case 'E13': {
      effects['遮断'] = (effects['遮断'] ?? 0) + 5;
      sideEffects['毒性'] = (sideEffects['毒性'] ?? 0) + 5;
      flags.causesRespiratoryArrest = true;
      flags.lethalRisk = true;
      break;
    }
    case 'E14': {
      sideEffects['毒性'] = 0;
      sideEffects['腐食'] = 0;
      flags.curesAddictionMild = true;
      break;
    }
    default:
      break;
  }
}

const LETHAL_TOXICITY_THRESHOLD = 6;

export function compound(input: CompoundInput): CompoundResult {
  const triggered = detectCombos(input);
  const flags: Record<string, boolean | string> = {};

  const destructive = triggered.find((c) => c.formsNoPotion || c.destroysTableImmediately);
  const corrosionAdded = input.reduce((sum, id) => {
    const m = MATERIALS_BY_ID[id];
    const corrosion = m?.sideEffects.find((s) => s.axis === '腐食')?.strength ?? 0;
    return sum + corrosion;
  }, 0);

  if (destructive) {
    return {
      effects: {},
      sideEffects: {},
      triggeredCombos: triggered.map((c) => c.id),
      formsNoPotion: true,
      destroysTableImmediately: true,
      corrosionAdded,
      flags: { ...flags, [destructive.id]: true },
    };
  }

  const { effects, sideEffects } = aggregateBase(input);

  for (const combo of triggered) {
    applyCombo(combo, effects, sideEffects, flags);
  }

  const toxicity = sideEffects['毒性'] ?? 0;
  if (toxicity >= LETHAL_TOXICITY_THRESHOLD || flags.lethalRisk) {
    flags.lethalRisk = true;
  }

  return {
    effects,
    sideEffects,
    triggeredCombos: triggered.map((c) => c.id),
    formsNoPotion: false,
    destroysTableImmediately: false,
    corrosionAdded,
    flags,
  };
}

export function determineOutcome(result: CompoundResult): 'survive' | 'worsen' | 'collapse' {
  if (result.formsNoPotion) return 'worsen';
  if (result.flags.customerCollapsesThatDay || result.flags.lethalRisk) return 'collapse';
  return 'survive';
}
