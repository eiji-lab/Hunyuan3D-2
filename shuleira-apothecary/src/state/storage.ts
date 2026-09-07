/**
 * localStorageへの読み書きを隔離する薄いモジュール。
 * ゲーム側はこのインターフェース越しにしかストレージへ触れない（差し替え可能にするため）。
 */
export interface SaveStore {
  load<T>(key: string): T | null;
  save<T>(key: string, value: T): void;
  remove(key: string): void;
}

const PREFIX = 'shuleira-apothecary:';

class LocalStorageSaveStore implements SaveStore {
  load<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  save<T>(key: string, value: T): void {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // 保存できない環境（プライベートモード等）では静かに諦める。
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key);
    } catch {
      // no-op
    }
  }
}

export const saveStore: SaveStore = new LocalStorageSaveStore();

export const STORAGE_KEYS = {
  gameState: 'gameState',
  settings: 'settings',
  recipeMemo: 'recipeMemo',
} as const;
