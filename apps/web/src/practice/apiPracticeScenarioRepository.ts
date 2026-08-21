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

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let body: { error?: string; detail?: string } | null = null;
    try {
      body = responseText ? JSON.parse(responseText) as { error?: string; detail?: string } : null;
    } catch {
      // Keep the HTTP status as the useful error when the server returned HTML
      // or another non-JSON error page.
    }
    throw new Error(
      body?.detail
      ?? body?.error
      ?? (responseText.trim() || undefined)
      ?? `Practice API request failed: ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

async function compressedJsonBody(value: unknown): Promise<{ body: BodyInit; compressed: boolean }> {
  const json = JSON.stringify(value);
  if (typeof CompressionStream === 'undefined') return { body: json, compressed: false };
  const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return { body: await new Response(compressed).blob(), compressed: true };
}

async function withLocalFallback<T>(apiCall: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await apiCall();
  } catch (apiError) {
    // A database can become available after the initial health check (for
    // example while the local Postgres container is starting). Do not cache a
    // transient API failure and permanently route later saves to localStorage.
    try {
      return await fallback();
    } catch (fallbackError) {
      const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Database request failed: ${apiMessage}. Browser storage fallback also failed: ${fallbackMessage}`);
    }
  }
}

export async function practiceStorageHealth(): Promise<PracticeStorageHealth> {
  try {
    const health = await apiRequest<PracticeStorageHealth>('/api/practice/health');
    return health;
  } catch (error) {
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
      async () => {
        const requestBody = await compressedJsonBody({ scenario });
        return apiRequest<PracticeScenarioSummary[]>('/api/practice/scenarios', {
          method: 'POST',
          body: requestBody.body,
          headers: requestBody.compressed ? { 'content-encoding': 'gzip' } : undefined,
        });
      },
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
