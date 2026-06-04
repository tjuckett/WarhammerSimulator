import type { PracticeScenario } from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioRepository } from '@warhammer-simulator/core/practice/scenarioRepository';
import {
  localPracticeScenarioRepository,
  type PracticeScenarioSummary,
} from '@warhammer-simulator/core/practice/scenarioStorage';

export type PracticeStorageHealth = {
  status: 'ok' | 'unavailable';
  storage: 'database' | 'local';
  message: string;
  detail?: string;
};

let apiDisabled = false;

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    throw new Error(body?.detail ?? body?.error ?? `Practice API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function withLocalFallback<T>(apiCall: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (apiDisabled) return fallback();
  try {
    return await apiCall();
  } catch {
    apiDisabled = true;
    return fallback();
  }
}

export async function practiceStorageHealth(): Promise<PracticeStorageHealth> {
  try {
    const health = await apiRequest<PracticeStorageHealth>('/api/practice/health');
    apiDisabled = health.storage !== 'database';
    return health;
  } catch (error) {
    apiDisabled = true;
    return {
      status: 'unavailable',
      storage: 'local',
      message: 'Postgres is unavailable. Practice saves are using browser storage.',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export const apiPracticeScenarioRepository: PracticeScenarioRepository = {
  listSummaries() {
    return withLocalFallback(
      () => apiRequest<PracticeScenarioSummary[]>('/api/practice/scenarios'),
      () => localPracticeScenarioRepository.listSummaries(),
    );
  },

  loadScenario(id: string) {
    return withLocalFallback(
      () => apiRequest<PracticeScenario | null>(`/api/practice/scenarios/${encodeURIComponent(id)}`),
      () => localPracticeScenarioRepository.loadScenario(id),
    );
  },

  saveScenario(scenario: PracticeScenario) {
    return withLocalFallback(
      () => apiRequest<PracticeScenarioSummary[]>('/api/practice/scenarios', {
        method: 'POST',
        body: JSON.stringify({ scenario }),
      }),
      () => localPracticeScenarioRepository.saveScenario(scenario),
    );
  },

  deleteScenarios(ids: string[]) {
    return withLocalFallback(
      () => apiRequest<PracticeScenarioSummary[]>('/api/practice/scenarios', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
      }),
      () => localPracticeScenarioRepository.deleteScenarios(ids),
    );
  },
};
