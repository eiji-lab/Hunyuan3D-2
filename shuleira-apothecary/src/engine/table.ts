import progressionData from '../data/progression.json';
import type { CompoundResult } from './types';

const CORROSION_THRESHOLD = progressionData.tableDamage.corrosionThreshold;

export interface TableState {
  id: string;
  corrosion: number;
  scorched: boolean;
}

export function createTable(id: string): TableState {
  return { id, corrosion: 0, scorched: false };
}

/** 調合結果を1台に適用し、腐食蓄積・即時破壊を反映した新しい状態を返す。 */
export function applyCompoundToTable(table: TableState, result: CompoundResult): TableState {
  if (table.scorched) return table;

  if (result.destroysTableImmediately) {
    return { ...table, scorched: true };
  }

  const corrosion = table.corrosion + result.corrosionAdded;
  const scorched = corrosion >= CORROSION_THRESHOLD;
  return { ...table, corrosion, scorched };
}

/** 翌朝、全ての台の焦げと腐食蓄積をリセットする。 */
export function resetTablesForNewDay(tables: TableState[]): TableState[] {
  return tables.map((t) => ({ ...t, corrosion: 0, scorched: false }));
}
