import type { ImportedArmy } from '@warhammer-simulator/core/types/army';
import { isImportedArmy } from '@warhammer-simulator/core/engine/armyUnits';

const LOCAL_KEYS = ['warhammer-saved-army-1', 'warhammer-saved-army-2'] as const;

export type ArmyStorage = 'database' | 'local';

export type ArmyRepositoryResult = {
  army: ImportedArmy;
  storage: ArmyStorage;
};

let apiDisabled = false;

function localLoad(slot: 0 | 1): ImportedArmy | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LOCAL_KEYS[slot]) ?? 'null');
    return isImportedArmy(value) ? value : null;
  } catch {
    return null;
  }
}

function localSave(slot: 0 | 1, army: ImportedArmy): ArmyRepositoryResult {
  localStorage.setItem(LOCAL_KEYS[slot], JSON.stringify(army));
  return { army, storage: 'local' };
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`Army API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export const armyRepository = {
  async load(slot: 0 | 1): Promise<ArmyRepositoryResult | null> {
    if (!apiDisabled) {
      try {
        const army = await apiRequest<ImportedArmy | null>(`/api/armies?slot=${slot}`, { method: 'GET' });
        if (army) return { army, storage: 'database' };
        const localArmy = localLoad(slot);
        return localArmy ? { army: localArmy, storage: 'local' } : null;
      } catch {
        apiDisabled = true;
      }
    }
    const army = localLoad(slot);
    return army ? { army, storage: 'local' } : null;
  },

  async save(slot: 0 | 1, army: ImportedArmy): Promise<ArmyRepositoryResult> {
    if (!apiDisabled) {
      try {
        const saved = await apiRequest<ImportedArmy>('/api/armies', {
          method: 'PUT',
          body: JSON.stringify({ slot, army }),
        });
        return { army: saved, storage: 'database' };
      } catch {
        apiDisabled = true;
      }
    }
    return localSave(slot, army);
  },
};
