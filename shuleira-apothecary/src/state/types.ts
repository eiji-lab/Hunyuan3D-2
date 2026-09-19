import type { TableState } from '../engine/table';
import type { CompoundResult, EncounterOutcome } from '../engine/types';

export interface CustomerInstance {
  instanceId: string;
  customerId: string;
  arrivedAtMs: number;
  lineIndex: number;
  lastSwitchAtMs: number;
  waitStage: number;
}

export interface TableSlot {
  id: string;
  table: TableState;
  queue: string[];
  customer: CustomerInstance | null;
}

export interface DeliveryLogEntry {
  day: number;
  customerId: string;
  outcome: EncounterOutcome;
  symptomSatisfied: boolean;
  usedSubstitution: boolean;
  triggeredCombos: string[];
}

export interface GameState {
  day: number;
  tobacco: number;
  inventory: Record<string, number>;
  tables: TableSlot[];
  waitingQueue: CustomerInstance[];
  spawnSchedule: { atMs: number; customerId: string }[];
  elapsedMs: number;
  dayDurationMs: number;
  advisorId: string;
  supplyEventId: string | null;
  playerMeter: number;
  smokingUntilMs: number;
  criticalUntilMs: number;
  finished: boolean;
  servedCount: number;
  collapsedCount: number;
  tablesRuinedCount: number;
  substitutionCount: number;
  cigarettesGivenToCustomers: number;
  patienceExpiredCount: number;
  dayTargetCustomers: number;
  log: DeliveryLogEntry[];
  lastCompound?: CompoundResult;
  closingLine?: string;
  muted: boolean;
  volume: number;
}
