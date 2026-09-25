import type { ImportedArmy } from '@warhammer-simulator/core/types/army';
import { isImportedArmy } from '@warhammer-simulator/core/engine/armyUnits';

const LOCAL_KEY = 'warhammer-saved-armies';
const LEGACY_LOCAL_KEYS = ['warhammer-saved-army-1', 'warhammer-saved-army-2'] as const;

export type ArmyStorage = 'database' | 'local';

export type SavedArmyRecord = {
  id: string;
  army: ImportedArmy;
  storage: ArmyStorage;
  updatedAt?: string;
};

type StoredArmyPayload = {
  id: string;
  name: string;
  faction: string;
  units: ImportedArmy['units'];
  metadata?: Pick<ImportedArmy, 'battleSizeId' | 'forceDisposition' | 'detachmentId' | 'detachmentIds' | 'sourceEdition' | 'catalog' | 'sourceMetadata' | 'generation'>;
  updatedAt?: string;
};

type LocalArmyRecord = {
  id: string;
  army: ImportedArmy;
  updatedAt?: string;
};

let apiDisabled = false;

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `army-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function recordFromPayload(payload: StoredArmyPayload, storage: ArmyStorage): SavedArmyRecord {
  return {
    id: payload.id,
    army: { name: payload.name, faction: payload.faction, units: payload.units, ...payload.metadata },
    storage,
    updatedAt: payload.updatedAt,
  };
}

function readLocalRecords(): LocalArmyRecord[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as unknown;
    if (Array.isArray(saved)) {
      return saved.filter((entry): entry is LocalArmyRecord =>
        !!entry
        && typeof entry === 'object'
        && typeof (entry as LocalArmyRecord).id === 'string'
        && isImportedArmy((entry as LocalArmyRecord).army),
      );
    }

    // Preserve the two pre-library browser saves the first time the new
    // library is opened. They remain untouched so this migration is safe.
    return LEGACY_LOCAL_KEYS.flatMap((key, index) => {
      try {
        const army: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        return isImportedArmy(army) ? [{ id: `legacy-army-${index + 1}`, army }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function writeLocalRecords(records: LocalArmyRecord[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
}

function localRecordToSavedArmy(record: LocalArmyRecord): SavedArmyRecord {
  return { ...record, storage: 'local' };
}

function localSave(army: ImportedArmy, id?: string): SavedArmyRecord {
  const records = readLocalRecords();
  const record: LocalArmyRecord = {
    id: id ?? newId(),
    army,
    updatedAt: new Date().toISOString(),
  };
  const next = records.some(candidate => candidate.id === record.id)
    ? records.map(candidate => candidate.id === record.id ? record : candidate)
    : [record, ...records];
  writeLocalRecords(next);
  return localRecordToSavedArmy(record);
}

function localLoad(id: string): SavedArmyRecord | null {
  return readLocalRecords().map(localRecordToSavedArmy).find(record => record.id === id) ?? null;
}

function localDelete(id: string): void {
  writeLocalRecords(readLocalRecords().filter(record => record.id !== id));
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`Army API request failed: ${response.status}`);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const armyRepository = {
  async list(): Promise<SavedArmyRecord[]> {
    const localRecords = readLocalRecords().map(localRecordToSavedArmy);
    if (!apiDisabled) {
      try {
        const saved = await apiRequest<StoredArmyPayload[]>('/api/armies', { method: 'GET' });
        const databaseRecords = saved.map(record => recordFromPayload(record, 'database'));
        const databaseIds = new Set(databaseRecords.map(record => record.id));
        return [...databaseRecords, ...localRecords.filter(record => !databaseIds.has(record.id))];
      } catch {
        apiDisabled = true;
      }
    }
    return localRecords;
  },

  async load(id: string): Promise<SavedArmyRecord | null> {
    if (!apiDisabled) {
      try {
        const saved = await apiRequest<StoredArmyPayload | null>(`/api/armies?id=${encodeURIComponent(id)}`, { method: 'GET' });
        if (saved) return recordFromPayload(saved, 'database');
      } catch {
        apiDisabled = true;
      }
    }
    return localLoad(id);
  },

  async save(army: ImportedArmy, id?: string): Promise<SavedArmyRecord> {
    if (!apiDisabled) {
      try {
        const saved = await apiRequest<StoredArmyPayload>('/api/armies', {
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(id ? { id, army } : { army }),
        });
        return recordFromPayload(saved, 'database');
      } catch {
        apiDisabled = true;
      }
    }
    return localSave(army, id);
  },

  async delete(id: string): Promise<void> {
    if (!apiDisabled) {
      try {
        await apiRequest<void>(`/api/armies?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch {
        apiDisabled = true;
      }
    }
    localDelete(id);
  },
};
