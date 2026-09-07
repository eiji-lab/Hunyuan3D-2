import { describe, expect, it } from 'vitest';
import materialsData from '../src/data/materials.json';
import combosData from '../src/data/combos.json';
import { compound, detectCombos, determineOutcome, MATERIALS_BY_ID } from '../src/engine/compound';
import { isSymptomSatisfied, SYMPTOMS_BY_ID } from '../src/engine/symptoms';
import { applyCompoundToTable, createTable, resetTablesForNewDay } from '../src/engine/table';

const ALL_MATERIAL_IDS = materialsData.materials.map((m) => m.id);
const ACTIVE_TWO_MATERIAL_COMBOS = combosData.combos.filter(
  (c) => c.status === 'active' && c.matchRule === 'exact-set' && c.materials.length === 2,
);

function allPairs(ids: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push([ids[i], ids[j]]);
    }
  }
  return pairs;
}

describe('全素材2個組み合わせ（231通り）の例外判定', () => {
  const pairs = allPairs(ALL_MATERIAL_IDS);

  it('22素材から重複なしの2個組み合わせは231通りである', () => {
    expect(pairs.length).toBe(231);
  });

  it('各exact-set例外は、対応するペアでのみ発火する', () => {
    for (const combo of ACTIVE_TWO_MATERIAL_COMBOS) {
      const [a, b] = combo.materials;
      const forward = detectCombos([a, b]).map((c) => c.id);
      const backward = detectCombos([b, a]).map((c) => c.id);
      expect(forward).toContain(combo.id);
      expect(backward).toContain(combo.id);
    }
  });

  it('意図しないペアでは例外が発火しない（M05霧雫を含むペアを除く）', () => {
    const knownPairKeys = new Set(
      ACTIVE_TWO_MATERIAL_COMBOS.map((c) => [...c.materials].sort().join('+')),
    );
    let uncheckedCount = 0;
    for (const [a, b] of pairs) {
      if (a === 'M05' || b === 'M05') continue; // E08は別途検証
      const key = [a, b].sort().join('+');
      const triggered = detectCombos([a, b]);
      if (knownPairKeys.has(key)) {
        expect(triggered.length).toBeGreaterThan(0);
      } else {
        expect(triggered).toEqual([]);
      }
      uncheckedCount++;
    }
    // 231通り中、M05を含む21通りを除いた210通りを検証したことを確認
    expect(uncheckedCount).toBe(210);
  });

  it('霧雫（M05）はどの相手とでもE08（緩和）を発火する', () => {
    for (const other of ALL_MATERIAL_IDS) {
      if (other === 'M05') continue;
      const triggered = detectCombos(['M05', other]).map((c) => c.id);
      expect(triggered).toContain('E08');
    }
  });
});

describe('例外14種それぞれの意図した効果', () => {
  it('E01 逆転: 鎮静が0になり覚醒へ転化し、客が興奮する', () => {
    const r = compound(['M01', 'M03']);
    expect(r.effects['鎮静'] ?? 0).toBe(0);
    expect(r.effects['覚醒'] ?? 0).toBeGreaterThan(0);
    expect(r.flags.customerAgitated).toBe(true);
  });

  it('E02 純化: 依存が大幅に抑えられる', () => {
    const r = compound(['M02', 'M12']);
    expect(r.sideEffects['依存'] ?? 0).toBeLessThanOrEqual(1);
    expect(r.flags.purified).toBe(true);
  });

  it('E03（予約枠）は現行構成では発火しない', () => {
    const reserved = combosData.combos.find((c) => c.id === 'E03');
    expect(reserved?.status).toBe('reserved');
  });

  it('E04 致死・器具破壊: 薬が完成せず、台が即座に使用不可になる', () => {
    const r = compound(['M03', 'M04']);
    expect(r.formsNoPotion).toBe(true);
    expect(r.destroysTableImmediately).toBe(true);
    expect(Object.keys(r.effects).length).toBe(0);

    const table = createTable('T1');
    const next = applyCompoundToTable(table, r);
    expect(next.scorched).toBe(true);
  });

  it('E05 無効化: 解熱と発熱が両方消え、安全な失敗になる', () => {
    const r = compound(['M19', 'M16']);
    expect(r.effects['解熱'] ?? 0).toBe(0);
    expect(r.sideEffects['発熱'] ?? 0).toBe(0);
    expect(r.flags.neutralized).toBe(true);
    expect(determineOutcome(r)).toBe('survive');
  });

  it('E06 暴走・浮遊: 浮遊が大きく跳ね上がる（笑える事故、致死ではない）', () => {
    const r = compound(['M08', 'M02']);
    expect(r.effects['浮遊'] ?? 0).toBeGreaterThan(5);
    expect(r.flags.customerFloatsUncontrollably).toBe(true);
    expect(determineOutcome(r)).toBe('survive');
  });

  it('E07 後遺症: 鈍麻が単純加算より増幅され、気づきにくい失敗になる', () => {
    const withoutCombo = compound(['M15']).sideEffects['鈍麻'] ?? 0;
    const r = compound(['M18', 'M15']);
    expect(r.flags.hiddenAftereffect).toBe(true);
    // M15を2番目に投入した場合の単純加算(1.7)の2倍(3.4)まで増幅される
    expect(r.sideEffects['鈍麻']).toBeCloseTo(3.4, 5);
    expect(r.sideEffects['鈍麻']!).toBeGreaterThan(withoutCombo);
  });

  it('E08 緩和: 同時投入した素材の副作用のみ半減する', () => {
    const withDilution = compound(['M05', 'M13']);
    // M13単体の依存(+2, 位置0の重み1.0)=2 に対し、E08発火で半分程度に抑えられる
    expect(withDilution.sideEffects['依存'] ?? 0).toBeLessThan(1.2);
    expect(withDilution.flags.mitigated).toBe(true);
  });

  it('E09 被覆: 毒性がほぼ無傷まで下がり、重度の幻覚に対する解になる', () => {
    const r = compound(['M17', 'M03']);
    expect(r.sideEffects['毒性'] ?? 0).toBeLessThanOrEqual(1);
    expect(r.flags.coated).toBe(true);
    expect(r.flags.resolvesSymptom).toBe('S11');
  });

  it('E10 根治・激痛: 依存を根治するが、その日は倒れる', () => {
    const r = compound(['M07', 'M13']);
    expect(r.flags.curesAddiction).toBe(true);
    expect(r.flags.customerCollapsesThatDay).toBe(true);
    expect(determineOutcome(r)).toBe('collapse');
  });

  it('E11 極端例: 症状は消えるが樹木化が始まる', () => {
    const r = compound(['M21', 'M01']);
    expect(r.flags.beginsTreeification).toBe(true);
  });

  it('E12 最良: 副作用ゼロで複数薬効が揃う', () => {
    const r = compound(['M12', 'M14', 'M05']);
    expect(Object.keys(r.sideEffects).length).toBe(0);
    expect(r.flags.ideal).toBe(true);
    expect(r.effects['鎮静'] ?? 0).toBeGreaterThan(0);
    expect(r.effects['解熱'] ?? 0).toBeGreaterThan(0);
  });

  it('E13 過剰増幅・致死: 呼吸が止まり致死判定になる', () => {
    const r = compound(['M11', 'M03']);
    expect(r.flags.causesRespiratoryArrest).toBe(true);
    expect(r.flags.lethalRisk).toBe(true);
    expect(determineOutcome(r)).toBe('collapse');
  });

  it('E14 解毒剤: 毒性・腐食が抑えられ、E10より穏やかに依存が抜ける', () => {
    const r = compound(['M22', 'M17']);
    expect(r.sideEffects['毒性'] ?? 0).toBe(0);
    expect(r.sideEffects['腐食'] ?? 0).toBe(0);
    expect(r.flags.curesAddictionMild).toBe(true);
    expect(r.flags.customerCollapsesThatDay).toBeUndefined();
  });
});

describe('投入順の効果', () => {
  it('先に入れた素材ほど薬効が強く出る', () => {
    const first = compound(['M06', 'M09']); // 崖苔(解熱++)を先に
    const last = compound(['M09', 'M06']); // 崖苔を後に
    expect(first.effects['解熱']!).toBeGreaterThan(last.effects['解熱']!);
  });

  it('後に入れた素材ほど副作用が抑えられる', () => {
    const dangerFirst = compound(['M15', 'M09']); // 魔木皮(鈍麻++)を先に
    const dangerLast = compound(['M09', 'M15']); // 魔木皮を後に
    expect(dangerFirst.sideEffects['鈍麻']!).toBeGreaterThan(dangerLast.sideEffects['鈍麻']!);
  });
});

describe('同一素材3つ以上での頭打ち', () => {
  it('薬効は3投入目以降増えず、副作用だけ伸び続ける', () => {
    const r = compound(['M13', 'M13', 'M13']);
    // 効果は occurrence 0,1 のみ加算（位置0:1.3倍, 位置1:1.15倍）= 2.45
    expect(r.effects['鎮静']).toBeCloseTo(2.45, 5);
    // 副作用は3回とも加算（位置重み 1.0 + 0.85 + 0.70 = 2.55）
    expect(r.sideEffects['依存']).toBeCloseTo(5.1, 5);
    expect(r.sideEffects['混濁']).toBeCloseTo(2.55, 5);
  });
});

describe('致死判定', () => {
  it('単体使用では致死にならない', () => {
    const r = compound(['M03']);
    expect(r.flags.lethalRisk).toBeUndefined();
    expect(determineOutcome(r)).toBe('survive');
  });

  it('蝕鱗を大量投入すると毒性蓄積で致死判定になる', () => {
    const r = compound(['M03', 'M03', 'M03']);
    expect(r.flags.lethalRisk).toBe(true);
    expect(determineOutcome(r)).toBe('collapse');
  });

  it('意図しない安全な組み合わせでは致死にならない', () => {
    const r = compound(['M06', 'M09', 'M17']);
    expect(r.flags.lethalRisk).toBeUndefined();
  });
});

describe('E04（蝕鱗＋谷水）による台の即時破壊', () => {
  it('通常の腐食蓄積閾値に関係なく即座に使用不可になる', () => {
    const table = createTable('T1');
    const r = compound(['M03', 'M04']);
    const next = applyCompoundToTable(table, r);
    expect(next.scorched).toBe(true);
    expect(table.scorched).toBe(false); // 元のオブジェクトは変更しない
  });
});

describe('台の腐食蓄積（通常経路）', () => {
  it('腐食の合計が閾値に達すると使用不可になる', () => {
    let table = createTable('T1');
    // M03単体（腐食+1）を3回に分けて使用 → 閾値3で焦げる
    for (let i = 0; i < 3; i++) {
      const r = compound(['M03']);
      table = applyCompoundToTable(table, r);
    }
    expect(table.scorched).toBe(true);
  });

  it('翌朝リセットで焦げと腐食が解消する', () => {
    const scorched = { id: 'T1', corrosion: 5, scorched: true };
    const [reset] = resetTablesForNewDay([scorched]);
    expect(reset.scorched).toBe(false);
    expect(reset.corrosion).toBe(0);
  });
});

describe('症例の充足判定', () => {
  it('S01風邪気味は解熱系の素材で満たされる', () => {
    const r = compound(['M06']);
    expect(isSymptomSatisfied(r, SYMPTOMS_BY_ID.S01)).toBe(true);
  });

  it('無関係な薬効では満たされない', () => {
    const r = compound(['M09']); // 保持のみ
    expect(isSymptomSatisfied(r, SYMPTOMS_BY_ID.S01)).toBe(false);
  });

  it('S05飛ぶと息が上がるは浮遊と解熱の両方が必要', () => {
    const partial = compound(['M08']); // 浮遊のみ
    expect(isSymptomSatisfied(partial, SYMPTOMS_BY_ID.S05)).toBe(false);
    const full = compound(['M08', 'M06']); // 浮遊+解熱
    expect(isSymptomSatisfied(full, SYMPTOMS_BY_ID.S05)).toBe(true);
  });
});

describe('MATERIALS_BY_ID', () => {
  it('22素材すべてが引ける', () => {
    expect(Object.keys(MATERIALS_BY_ID).length).toBe(22);
  });
});
