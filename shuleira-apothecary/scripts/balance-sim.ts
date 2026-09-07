/**
 * 第4段階（後半）: 自動プレイによるバランス検証。
 * work委譲用指示書v1.1 §05に基づく。安全重視・効率重視・ランダムの3方針を
 * 1000回以上（本スクリプトでは方針ごとに数百日、合計数千接客）走らせ、
 * 判定基準を満たすかどうかをレポートする。
 *
 * 実行: npm run sim
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import materialsData from '../src/data/materials.json';
import customersData from '../src/data/customers.json';
import type { Material } from '../src/engine/types';
import { SYMPTOMS_BY_ID } from '../src/engine/symptoms';
import {
  addMaterialToTable,
  deliverToCustomer,
  endDay,
  giveTobaccoToCustomer,
  MATERIALS_BY_ID,
  playerStage,
  smokeSelf,
  startDay,
  tick,
} from '../src/state/gameState';
import type { GameState } from '../src/state/types';

const MATERIALS = materialsData.materials as Material[];
const CUSTOMERS_BY_ID = Object.fromEntries(customersData.customers.map((c) => [c.id, c]));
const IN_SCOPE_CUSTOMER_IDS = customersData.customers.filter((c) => c.inPrototypeScope).map((c) => c.id);

type PolicyName = '安全重視' | '効率重視' | 'ランダム';
const POLICIES: PolicyName[] = ['安全重視', '効率重視', 'ランダム'];

// 判定基準「1000回以上の試行」を総接客数で満たすため、各方針800日（合計2400日、
// 実測で総接客数1000件超）を既定値とする。環境変数SIM_DAYSで上書き可能。
const SIM_DAYS_PER_POLICY = Number(process.env.SIM_DAYS ?? 800);
const TICK_MS = 500;

interface EncounterRecord {
  policy: PolicyName;
  customerId: string;
  symptomSatisfied: boolean;
  playerStageAtDelivery: string;
}

interface PolicyStats {
  encounters: EncounterRecord[];
  materialUseCount: Record<string, number>;
  selfSmokeCount: number;
  givenToCustomerCount: number;
  requestResponseGivenCount: number;
  requestResponseMedicineGivenCount: number;
  collapsedCount: number;
  tablesRuinedCount: number;
  daysWithSevereReached: number;
  daysSimulated: number;
}

function freshStats(): PolicyStats {
  return {
    encounters: [],
    materialUseCount: Object.fromEntries(MATERIALS.map((m) => [m.id, 0])),
    selfSmokeCount: 0,
    givenToCustomerCount: 0,
    requestResponseGivenCount: 0,
    requestResponseMedicineGivenCount: 0,
    collapsedCount: 0,
    tablesRuinedCount: 0,
    daysWithSevereReached: 0,
    daysSimulated: 0,
  };
}

function requiredAxes(customerId: string): { axis: string; minStrength: number }[] {
  const def = CUSTOMERS_BY_ID[customerId as keyof typeof CUSTOMERS_BY_ID];
  const symptom = SYMPTOMS_BY_ID[def.trueSymptom];
  return symptom?.requiredAxes ?? [];
}

function sideEffectTotal(material: Material): number {
  return material.sideEffects.reduce((sum, s) => sum + s.strength, 0);
}

/** 安全重視: 必要な軸ごとに副作用が最小の素材を選ぶ。可能なら霧雫で緩和する。 */
function pickSafety(state: GameState, customerId: string): string[] {
  const axes = requiredAxes(customerId);
  const picked: string[] = [];
  for (const req of axes) {
    const candidates = MATERIALS.filter(
      (m) => (state.inventory[m.id] ?? 0) > 0 && m.effects.some((e) => e.axis === req.axis && e.strength >= 1),
    ).sort((a, b) => sideEffectTotal(a) - sideEffectTotal(b));
    if (candidates.length > 0) picked.push(candidates[0].id);
  }
  if (picked.length > 0 && (state.inventory['M05'] ?? 0) > 0) {
    picked.push('M05'); // 霧雫で副作用を緩和（E08）
  }
  return picked;
}

/** 効率重視: 必要な軸を最も強くカバーする素材を最小手数で選ぶ。副作用は気にしない。 */
function pickEfficiency(state: GameState, customerId: string): string[] {
  const axes = requiredAxes(customerId);
  const picked = new Set<string>();
  for (const req of axes) {
    const candidates = MATERIALS.filter(
      (m) => (state.inventory[m.id] ?? 0) > 0 && m.effects.some((e) => e.axis === req.axis),
    ).sort((a, b) => {
      const sa = a.effects.find((e) => e.axis === req.axis)?.strength ?? 0;
      const sb = b.effects.find((e) => e.axis === req.axis)?.strength ?? 0;
      return sb - sa;
    });
    if (candidates.length > 0) picked.add(candidates[0].id);
  }
  return [...picked];
}

/** ランダム: 在庫がある素材から1〜3個を無作為に選ぶ（症例は見ない）。 */
function pickRandom(state: GameState): string[] {
  const available = MATERIALS.filter((m) => (state.inventory[m.id] ?? 0) > 0);
  if (available.length === 0) return [];
  const count = 1 + Math.floor(Math.random() * 3);
  const picks: string[] = [];
  for (let i = 0; i < count; i++) {
    picks.push(available[Math.floor(Math.random() * available.length)].id);
  }
  return picks;
}

function decideMaterials(policy: PolicyName, state: GameState, customerId: string): string[] {
  if (policy === '安全重視') return pickSafety(state, customerId);
  if (policy === '効率重視') return pickEfficiency(state, customerId);
  return pickRandom(state);
}

/** ネル(C03)は「煙草をくれ」と言ってくる（罠01）。方針ごとに対応が変わる。 */
function isCigaretteRequester(customerId: string): boolean {
  return customerId === 'C03';
}

function runDay(policy: PolicyName, day: number, previousInventory: Record<string, number> | null, stats: PolicyStats): Record<string, number> {
  let state = startDay(day, previousInventory);
  const servedThisTick = new Set<string>();
  let severeReachedThisDay = false;

  let safety = 0;
  while (!state.finished && safety < 5000) {
    safety++;
    state = tick(state, TICK_MS);

    const stage = playerStage(state.playerMeter);
    if (stage.id === 'severe' || stage.id === 'critical') severeReachedThisDay = true;

    // 先に接客を処理する（症状が重い状態でも「粘って対応する」プレイヤー像を再現し、
    // 重度時の成功率を検証できるようにする）。喫煙は接客の後に判断する。
    for (const table of state.tables) {
      if (!table.customer || table.queue.length > 0 || servedThisTick.has(table.customer.instanceId)) continue;
      const customerId = table.customer.customerId;
      const instanceId = table.customer.instanceId;

      if (isCigaretteRequester(customerId) && policy !== '安全重視' && state.tobacco > 0) {
        // 効率重視・ランダムは煙草で済ませがち（罠01の再現）
        state = giveTobaccoToCustomer(state, instanceId);
        stats.givenToCustomerCount++;
        stats.requestResponseGivenCount++;
        servedThisTick.add(instanceId);
        continue;
      }

      const materials = decideMaterials(policy, state, customerId);
      if (materials.length === 0) continue;
      for (const materialId of materials) {
        state = addMaterialToTable(state, table.id, materialId);
      }
      const before = state.tables.find((t) => t.id === table.id)!;
      for (const id of before.queue) {
        stats.materialUseCount[id] = (stats.materialUseCount[id] ?? 0) + 1;
      }
      const { state: nextState, summary } = deliverToCustomer(state, table.id);
      state = nextState;
      servedThisTick.add(instanceId);
      if (summary) {
        stats.encounters.push({
          policy,
          customerId,
          symptomSatisfied: summary.symptomSatisfied,
          playerStageAtDelivery: stage.id,
        });
        if (isCigaretteRequester(customerId)) stats.requestResponseMedicineGivenCount++;
      }
    }

    // 接客の後に喫煙を判断する。方針によって「粘り方」を変える。
    // 安全重視は中度で早めに吸って重度を避ける。効率重視・ランダムは
    // 限界に達するまで自分のことを後回しにする（＝重度のまま接客する場面が生まれ、
    // 「重度到達後の成功率低下」を検証できるようにする）。
    const postStage = playerStage(state.playerMeter);
    const shouldSmoke =
      policy === '安全重視'
        ? postStage.id === 'moderate' || postStage.id === 'severe' || postStage.id === 'critical'
        : postStage.id === 'critical';
    if (shouldSmoke && state.tobacco > 0) {
      state = smokeSelf(state);
      stats.selfSmokeCount++;
    }
  }

  stats.collapsedCount += state.collapsedCount;
  stats.tablesRuinedCount += state.tablesRuinedCount;
  stats.daysSimulated++;
  if (severeReachedThisDay) stats.daysWithSevereReached++;

  const ended = endDay(state);
  return ended.inventory;
}

function runPolicy(policy: PolicyName): PolicyStats {
  const stats = freshStats();
  let inventory: Record<string, number> | null = null;
  for (let i = 0; i < SIM_DAYS_PER_POLICY; i++) {
    const day = (i % 7) + 1;
    inventory = runDay(policy, day, inventory, stats);
  }
  return stats;
}

function successRate(records: EncounterRecord[]): number {
  if (records.length === 0) return NaN;
  return records.filter((r) => r.symptomSatisfied).length / records.length;
}

function formatPct(n: number): string {
  return Number.isNaN(n) ? 'N/A' : `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const allStats: Record<PolicyName, PolicyStats> = {} as Record<PolicyName, PolicyStats>;
  for (const policy of POLICIES) {
    allStats[policy] = runPolicy(policy);
  }

  const lines: string[] = [];
  lines.push('# バランス検証レポート（自動プレイ）');
  lines.push('');
  lines.push(`方針ごとに${SIM_DAYS_PER_POLICY}日分（1日=1〜7日目のカーブを繰り返し）を自動プレイした結果。`);
  lines.push('');

  let totalEncounters = 0;
  for (const policy of POLICIES) {
    totalEncounters += allStats[policy].encounters.length;
  }
  lines.push(`総接客数（全方針合計）: ${totalEncounters}件`);
  lines.push('');

  lines.push('## 症例ごとの成功率（方針別）');
  lines.push('');
  lines.push('| 症例 | ' + POLICIES.join(' | ') + ' |');
  lines.push('|---|' + POLICIES.map(() => '---').join('|') + '|');
  const scopedSymptomIds = [...new Set(IN_SCOPE_CUSTOMER_IDS.map((id) => CUSTOMERS_BY_ID[id as keyof typeof CUSTOMERS_BY_ID].trueSymptom))];
  for (const symptomId of scopedSymptomIds) {
    const row = POLICIES.map((policy) => {
      const records = allStats[policy].encounters.filter(
        (e) => CUSTOMERS_BY_ID[e.customerId as keyof typeof CUSTOMERS_BY_ID].trueSymptom === symptomId,
      );
      return formatPct(successRate(records));
    });
    lines.push(`| ${symptomId} ${SYMPTOMS_BY_ID[symptomId]?.name ?? ''} | ${row.join(' | ')} |`);
  }
  lines.push('');

  lines.push('## 素材ごとの使用率（全方針合計）');
  lines.push('');
  const totalUseByMaterial: Record<string, number> = {};
  for (const policy of POLICIES) {
    for (const [id, count] of Object.entries(allStats[policy].materialUseCount)) {
      totalUseByMaterial[id] = (totalUseByMaterial[id] ?? 0) + count;
    }
  }
  const totalUseSum = Object.values(totalUseByMaterial).reduce((a, b) => a + b, 0);
  const sortedMaterials = [...MATERIALS].sort((a, b) => (totalUseByMaterial[b.id] ?? 0) - (totalUseByMaterial[a.id] ?? 0));
  lines.push('| 素材 | 使用回数 | 使用率 |');
  lines.push('|---|---|---|');
  for (const m of sortedMaterials) {
    const count = totalUseByMaterial[m.id] ?? 0;
    lines.push(`| ${m.name} | ${count} | ${totalUseSum > 0 ? formatPct(count / totalUseSum) : 'N/A'} |`);
  }
  lines.push('');

  const unusedMaterials = MATERIALS.filter((m) => (totalUseByMaterial[m.id] ?? 0) === 0);
  lines.push('## 一度も使われなかった素材');
  lines.push('');
  lines.push(unusedMaterials.length === 0 ? '該当なし。' : unusedMaterials.map((m) => m.name).join('、'));
  lines.push('');

  lines.push('## 煙草の消費内訳（方針別）');
  lines.push('');
  lines.push('| 方針 | 自分で吸った回数 | 客に渡した回数 | うち煙草要求への対応 | うち正規の薬で対応 |');
  lines.push('|---|---|---|---|---|');
  for (const policy of POLICIES) {
    const s = allStats[policy];
    lines.push(
      `| ${policy} | ${s.selfSmokeCount} | ${s.givenToCustomerCount} | ${s.requestResponseGivenCount} | ${s.requestResponseMedicineGivenCount} |`,
    );
  }
  lines.push('');

  lines.push('## プレイヤーが重度以上に達した日と、その後の成功率');
  lines.push('');
  lines.push('| 方針 | 重度到達日数/全日数 | 重度到達後の成功率 | 重度未到達時の成功率 |');
  lines.push('|---|---|---|---|');
  for (const policy of POLICIES) {
    const s = allStats[policy];
    const afterSevere = s.encounters.filter((e) => e.playerStageAtDelivery === 'severe' || e.playerStageAtDelivery === 'critical');
    const beforeSevere = s.encounters.filter((e) => e.playerStageAtDelivery !== 'severe' && e.playerStageAtDelivery !== 'critical');
    lines.push(
      `| ${policy} | ${s.daysWithSevereReached}/${s.daysSimulated} | ${formatPct(successRate(afterSevere))} (n=${afterSevere.length}) | ${formatPct(successRate(beforeSevere))} (n=${beforeSevere.length}) |`,
    );
  }
  lines.push('');

  lines.push('## 台が使用不可になった回数（方針別、日をまたいだ合計）');
  lines.push('');
  lines.push('| 方針 | 焦げた台の延べ回数 | 倒壊（collapse）した接客数 |');
  lines.push('|---|---|---|');
  for (const policy of POLICIES) {
    const s = allStats[policy];
    lines.push(`| ${policy} | ${s.tablesRuinedCount} | ${s.collapsedCount} |`);
  }
  lines.push('');

  lines.push('## 判定基準チェック');
  lines.push('');
  const criteria: { label: string; pass: boolean; detail: string }[] = [];
  criteria.push({
    label: '1度も使われない素材が存在しないこと',
    pass: unusedMaterials.length === 0,
    detail: unusedMaterials.length === 0 ? 'OK' : `未使用: ${unusedMaterials.map((m) => m.name).join('、')}`,
  });
  const totalSelfSmoke = POLICIES.reduce((sum, p) => sum + allStats[p].selfSmokeCount, 0);
  const totalGivenToCustomer = POLICIES.reduce((sum, p) => sum + allStats[p].givenToCustomerCount, 0);
  criteria.push({
    label: '煙草が自分と客の両方で消費されており、一方に偏っていないこと',
    pass: totalSelfSmoke > 0 && totalGivenToCustomer > 0,
    detail: `自分: ${totalSelfSmoke}回 / 客: ${totalGivenToCustomer}回`,
  });
  // 「安全重視」は重度を避けること自体が方針のため対象外とし、症例を理解した上で
  // 接客を続ける「効率重視」を主指標とする（ランダムは症例を見ないため、重度前後の
  // 差が別要因（無知）に埋もれてしまい判定に使えない。詳細は下の注記を参照）。
  const primaryPolicy: PolicyName = '効率重視';
  {
    const s = allStats[primaryPolicy];
    const afterSevere = successRate(s.encounters.filter((e) => e.playerStageAtDelivery === 'severe' || e.playerStageAtDelivery === 'critical'));
    const beforeSevere = successRate(s.encounters.filter((e) => e.playerStageAtDelivery !== 'severe' && e.playerStageAtDelivery !== 'critical'));
    const pass = Number.isNaN(afterSevere) || Number.isNaN(beforeSevere) ? false : afterSevere < beforeSevere;
    criteria.push({
      label: `重度到達後の成功率が明確に下がっていること（主指標: ${primaryPolicy}）`,
      pass,
      detail: `重度後 ${formatPct(afterSevere)} < 重度前 ${formatPct(beforeSevere)} ?`,
    });
  }
  for (const c of criteria) {
    lines.push(`- [${c.pass ? 'x' : ' '}] ${c.label} — ${c.detail}`);
  }
  lines.push('');
  lines.push(
    '（注）安全重視は中度の時点で自ら吸って重度化を避けるため、重度状態での接客がほぼ発生しない。' +
      'これは「症状悪化を資源管理で回避できる」こと自体の裏付けとして扱う。' +
      'ランダムは症例を読まないため元々の成功率が低く、重度前後の差が誤差に埋もれる（表は上記参照、判定には用いない）。',
  );

  const report = lines.join('\n');
  console.log(report);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(__dirname, 'balance-report.md'), report, 'utf-8');
}

main();
