import materialsData from '../data/materials.json';
import customersData from '../data/customers.json';
import progressionData from '../data/progression.json';
import eventsData from '../data/events.json';
import type { Material } from '../engine/types';
import { compound, determineOutcome, MATERIALS_BY_ID } from '../engine/compound';
import { isSymptomSatisfied, SYMPTOMS_BY_ID } from '../engine/symptoms';
import { applyCompoundToTable, createTable, resetTablesForNewDay } from '../engine/table';
import type { CustomerInstance, GameState, TableSlot } from './types';

const MATERIALS = materialsData.materials as Material[];
const CUSTOMERS_BY_ID = Object.fromEntries(customersData.customers.map((c) => [c.id, c]));
const DAY_CURVE = progressionData.dayCurve;
const METER = progressionData.playerSymptom;
const TABLE_COUNT = progressionData.tableCount;

/**
 * 客の支払い品は文書上ナラティブな物品名で書かれており、素材IDに直結していない。
 * 試作範囲の客について、支払い品を対応する素材IDへ機械的に対応させた
 * （decisions.md D10参照。範囲外の客は本実装時に追記する）。
 */
const CUSTOMER_PAYMENT_MATERIAL: Record<string, string> = {
  C02: 'M06', // ハウ: 崖苔の束
  C03: 'M13', // ネル: 燼葉
  C04: 'M09', // トビ: 羽灰
  C09: 'M05', // オルガ: 霧雫
};

function dayConfig(day: number) {
  return DAY_CURVE[Math.min(day - 1, DAY_CURVE.length - 1)];
}

/** 供給層に応じた初期在庫を作る（decisions.md D05: 在庫は通しで管理するため、初回のみ使用）。 */
function buildInitialInventory(): Record<string, number> {
  const inventory: Record<string, number> = {};
  for (const m of MATERIALS) {
    switch (m.supplyTier) {
      case '常時在庫':
        inventory[m.id] = 8;
        break;
      case '配給':
        inventory[m.id] = 4;
        break;
      case '交易入荷':
        inventory[m.id] = 1;
        break;
      case '密輸':
        inventory[m.id] = 0;
        break;
      default:
        inventory[m.id] = 2;
    }
  }
  return inventory;
}

function applySupplyEvent(inventory: Record<string, number>, eventId: string | null): void {
  if (!eventId) return;
  const event = eventsData.events.find((e) => e.id === eventId);
  if (!event) return;
  const effect = event.mechanicalEffect as Record<string, unknown>;
  switch (effect.type) {
    case 'blockSupply': {
      for (const m of MATERIALS) {
        if (m.originGroup === effect.originGroup) inventory[m.id] = 0;
      }
      break;
    }
    case 'boostSupply': {
      const mult = Number(effect.multiplier ?? 1);
      for (const m of MATERIALS) {
        if (effect.materialId && m.id !== effect.materialId) continue;
        if (effect.originGroup && m.originGroup !== effect.originGroup) continue;
        inventory[m.id] = Math.round((inventory[m.id] ?? 0) * mult) + 1;
      }
      break;
    }
    case 'reduceSupply': {
      const mult = Number(effect.multiplier ?? 1);
      const id = String(effect.materialId);
      inventory[id] = Math.floor((inventory[id] ?? 0) * mult);
      break;
    }
    case 'makeAvailable': {
      const id = String(effect.materialId);
      inventory[id] = Math.max(inventory[id] ?? 0, 2);
      break;
    }
    default:
      break;
  }
}

function pickSupplyEvent(chance: number): string | null {
  if (Math.random() > chance) return null;
  const idx = Math.floor(Math.random() * eventsData.events.length);
  return eventsData.events[idx].id;
}

function buildSpawnSchedule(customerPool: string[], count: number, durationMs: number) {
  const schedule: { atMs: number; customerId: string }[] = [];
  for (let i = 0; i < count; i++) {
    const customerId = customerPool[Math.floor(Math.random() * customerPool.length)];
    const atMs = Math.floor((durationMs / (count + 1)) * (i + 1));
    schedule.push({ atMs, customerId });
  }
  schedule.sort((a, b) => a.atMs - b.atMs);
  return schedule;
}

export function startDay(day: number, previousInventory: Record<string, number> | null): GameState {
  const config = dayConfig(day);
  const inventory = previousInventory ? { ...previousInventory } : buildInitialInventory();
  const supplyEventId = pickSupplyEvent(config.supplyEventChance);
  applySupplyEvent(inventory, supplyEventId);

  const tables: TableSlot[] = Array.from({ length: TABLE_COUNT }, (_, i) => ({
    id: `T${i + 1}`,
    table: createTable(`T${i + 1}`),
    queue: [],
    customer: null,
  }));

  const dayDurationMs = 3 * 60 * 1000; // 仕様: 1日あたり3〜5分で終わる（下限を採用）

  return {
    day,
    tobacco: config.tobaccoRation,
    inventory,
    tables,
    waitingQueue: [],
    spawnSchedule: buildSpawnSchedule(config.customerPool, config.customersPerDay, dayDurationMs),
    elapsedMs: 0,
    dayDurationMs,
    advisorId: config.advisorId,
    supplyEventId,
    playerMeter: 0,
    smokingUntilMs: 0,
    criticalUntilMs: 0,
    finished: false,
    servedCount: 0,
    collapsedCount: 0,
    tablesRuinedCount: 0,
    substitutionCount: 0,
    cigarettesGivenToCustomers: 0,
    log: [],
    muted: false,
    volume: 0.6,
  };
}

export function playerStage(meter: number): (typeof METER.stages)[number] {
  return (
    METER.stages.find((s: { min: number; max: number }) => meter >= s.min && meter <= s.max) ??
    METER.stages[0]
  );
}

function assignWaitingCustomers(state: GameState): void {
  while (state.waitingQueue.length > 0) {
    const emptyTable = state.tables.find((t) => !t.table.scorched && !t.customer);
    if (!emptyTable) break;
    const customer = state.waitingQueue.shift()!;
    emptyTable.customer = customer;
  }
}

/** 時間経過を反映する（症状進行・客の来店・待機台詞の切り替え判定は描画側で行う）。 */
export function tick(state: GameState, deltaMs: number): GameState {
  if (state.finished) return state;

  const advisorMultiplier = state.advisorId === 'laplace' ? METER.laplacePresentMultiplier : 1;
  const isSmoking = state.smokingUntilMs > state.elapsedMs;
  const isCritical = state.criticalUntilMs > state.elapsedMs;

  let playerMeter = state.playerMeter;
  if (!isSmoking && !isCritical) {
    playerMeter = Math.min(
      METER.meterMax,
      playerMeter + METER.progressPerSecond * advisorMultiplier * (deltaMs / 1000),
    );
  }

  const elapsedMs = state.elapsedMs + deltaMs;

  // 限界段階に初めて達した瞬間、暴走時間を設定する
  let criticalUntilMs = state.criticalUntilMs;
  const stage = playerStage(playerMeter);
  if (stage.id === 'critical' && criticalUntilMs <= state.elapsedMs) {
    criticalUntilMs = elapsedMs + METER.criticalDurationSeconds * 1000;
  }

  const nextState: GameState = { ...state, playerMeter, elapsedMs, criticalUntilMs };

  // 客の来店
  while (nextState.spawnSchedule.length > 0 && nextState.spawnSchedule[0].atMs <= elapsedMs) {
    const spawn = nextState.spawnSchedule.shift()!;
    const customer: CustomerInstance = {
      instanceId: `${spawn.customerId}-${elapsedMs}-${Math.random().toString(36).slice(2, 7)}`,
      customerId: spawn.customerId,
      arrivedAtMs: elapsedMs,
      lineIndex: 0,
      lastSwitchAtMs: elapsedMs,
      waitStage: 0,
    };
    nextState.waitingQueue.push(customer);
  }
  assignWaitingCustomers(nextState);

  if (
    nextState.spawnSchedule.length === 0 &&
    nextState.waitingQueue.length === 0 &&
    nextState.tables.every((t) => !t.customer) &&
    elapsedMs >= nextState.dayDurationMs
  ) {
    nextState.finished = true;
  }

  return nextState;
}

/**
 * 素材を台に追加する。プレイヤーの症状段階に応じたミス発生率を適用する
 * （企画仕様§04「手元が狂う表現は精度低下にする」）。
 */
export function addMaterialToTable(state: GameState, tableId: string, materialId: string): GameState {
  const table = state.tables.find((t) => t.id === tableId);
  if (!table || table.table.scorched) return state;
  if ((state.inventory[materialId] ?? 0) <= 0) return state;
  if (state.criticalUntilMs > state.elapsedMs) return state; // 限界段階は操作不能

  const stage = playerStage(state.playerMeter);
  const mistakeRate = (METER.mistakeRateByStage as Record<string, number>)[stage.id] ?? 0;
  const mistaken = Math.random() < mistakeRate;

  let actualMaterialId = materialId;
  let substitutionUsed = false;
  if (mistaken && stage.id !== 'healthy') {
    const otherIds = MATERIALS.filter((m) => (state.inventory[m.id] ?? 0) > 0).map((m) => m.id);
    if (otherIds.length > 0) {
      actualMaterialId = otherIds[Math.floor(Math.random() * otherIds.length)];
      substitutionUsed = true;
    }
  }

  const inventory = { ...state.inventory };
  inventory[actualMaterialId] = Math.max(0, (inventory[actualMaterialId] ?? 0) - 1);

  const tables = state.tables.map((t) =>
    t.id === tableId ? { ...t, queue: [...t.queue, actualMaterialId] } : t,
  );

  return {
    ...state,
    inventory,
    tables,
    substitutionCount: state.substitutionCount + (substitutionUsed ? 1 : 0),
  };
}

export function clearTableQueue(state: GameState, tableId: string): GameState {
  const table = state.tables.find((t) => t.id === tableId);
  if (!table) return state;
  const inventory = { ...state.inventory };
  for (const id of table.queue) {
    inventory[id] = (inventory[id] ?? 0) + 1;
  }
  const tables = state.tables.map((t) => (t.id === tableId ? { ...t, queue: [] } : t));
  return { ...state, inventory, tables };
}

export interface DeliverOutcomeSummary {
  outcome: ReturnType<typeof determineOutcome>;
  symptomSatisfied: boolean;
  triggeredCombos: string[];
}

/** 調合して客に渡す。台の腐食蓄積・在庫への支払い反映まで一括で行う。 */
export function deliverToCustomer(
  state: GameState,
  tableId: string,
): { state: GameState; summary: DeliverOutcomeSummary | null } {
  const tableIndex = state.tables.findIndex((t) => t.id === tableId);
  if (tableIndex < 0) return { state, summary: null };
  const slot = state.tables[tableIndex];
  if (!slot.customer || slot.queue.length === 0) return { state, summary: null };

  const result = compound(slot.queue);
  const nextTableState = applyCompoundToTable(slot.table, result);
  const outcome = determineOutcome(result);

  const customerDef = CUSTOMERS_BY_ID[slot.customer.customerId];
  const symptom = customerDef ? SYMPTOMS_BY_ID[customerDef.trueSymptom] : undefined;
  const symptomSatisfied = symptom ? isSymptomSatisfied(result, symptom) : false;

  const inventory = { ...state.inventory };
  if (customerDef?.payment?.addsToInventory) {
    const paymentMaterialId = CUSTOMER_PAYMENT_MATERIAL[slot.customer.customerId];
    if (paymentMaterialId) {
      inventory[paymentMaterialId] = (inventory[paymentMaterialId] ?? 0) + 1;
    }
  }

  const tables = state.tables.map((t, i) =>
    i === tableIndex ? { ...t, table: nextTableState, queue: [], customer: null } : t,
  );

  const log = [
    ...state.log,
    {
      day: state.day,
      customerId: slot.customer.customerId,
      outcome,
      symptomSatisfied,
      usedSubstitution: false,
      triggeredCombos: result.triggeredCombos,
    },
  ];

  const nextState: GameState = {
    ...state,
    inventory,
    tables,
    servedCount: state.servedCount + 1,
    collapsedCount: state.collapsedCount + (outcome === 'collapse' ? 1 : 0),
    tablesRuinedCount: state.tablesRuinedCount + (nextTableState.scorched && !slot.table.scorched ? 1 : 0),
    log,
    lastCompound: result,
  };

  return { state: nextState, summary: { outcome, symptomSatisfied, triggeredCombos: result.triggeredCombos } };
}

export function smokeSelf(state: GameState): GameState {
  if (state.tobacco <= 0) return state;
  return {
    ...state,
    tobacco: state.tobacco - 1,
    playerMeter: Math.max(0, state.playerMeter - METER.smokeReliefAmount),
    smokingUntilMs: state.elapsedMs + METER.smokeDurationSeconds * 1000,
  };
}

export function giveTobaccoToCustomer(state: GameState, instanceId: string): GameState {
  if (state.tobacco <= 0) return state;
  const stillPresent = state.tables.some((t) => t.customer?.instanceId === instanceId);
  if (!stillPresent) return state;
  return { ...state, tobacco: state.tobacco - 1, cigarettesGivenToCustomers: state.cigarettesGivenToCustomers + 1 };
}

const CLOSING_LINES = {
  allSurvived: '今日は誰も倒れなかったね。\n……三番の台、焦げてる。次から順番を考えな。',
  someCollapsed: '一人倒れたか。\n死んでないなら、また来る。次に何を出すか考えときな。',
  heavySubstitution: 'よく回したね。\nそのぶん、来週あたりに戻ってくるよ。覚えときな。',
  playerSevere: '……ああ、いい顔してる。\nあんた、今日どのくらい吸った？　……そう。\n明日は少し早めにおやり。',
  multipleTablesRuined: '派手にやったね。\n直しとくよ。あたしがやるわけじゃないけど。',
  nothingSpecial: '今日はこんなもんだね。\n上がっていいよ。',
  advisorAbsent: null,
} as const;

export function computeClosingLine(state: GameState): string | null {
  if (state.advisorId === 'none') return CLOSING_LINES.advisorAbsent;
  if (state.collapsedCount > 0) return CLOSING_LINES.someCollapsed;
  if (state.tablesRuinedCount >= 2) return CLOSING_LINES.multipleTablesRuined;
  if (playerStage(state.playerMeter).id === 'severe' || playerStage(state.playerMeter).id === 'critical') {
    return CLOSING_LINES.playerSevere;
  }
  if (state.substitutionCount >= 3) return CLOSING_LINES.heavySubstitution;
  if (state.servedCount > 0 && state.collapsedCount === 0) return CLOSING_LINES.allSurvived;
  return CLOSING_LINES.nothingSpecial;
}

export function endDay(state: GameState): GameState {
  const tables = resetTablesForNewDay(state.tables.map((t) => t.table)).map((table, i) => ({
    ...state.tables[i],
    table,
    queue: [],
    customer: null,
  }));
  return { ...state, tables, finished: true, closingLine: computeClosingLine(state) ?? undefined };
}

export { MATERIALS_BY_ID };
