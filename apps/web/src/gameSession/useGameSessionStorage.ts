import { useCallback, useEffect, useState } from 'react';
import type { PracticeScenarioSummary as GameSessionScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import {
  gameSessionRepository,
  gameSessionStorageHealth,
  type GameSessionStorageHealth,
} from './gameSessionRepository';

export function useGameSessionStorage() {
  const [savedScenarios, setSavedScenarios] = useState<GameSessionScenarioSummary[]>([]);
  const [storageStatus, setStorageStatus] = useState<GameSessionStorageHealth | null>(null);

  const refreshSavedScenarios = useCallback(async () => {
    setSavedScenarios(await gameSessionRepository.listSummaries());
  }, []);

  useEffect(() => {
    async function initializeStorage() {
      const health = await gameSessionStorageHealth();
      setStorageStatus(health);
      await refreshSavedScenarios();
    }

    void initializeStorage();
  }, [refreshSavedScenarios]);

  return {
    savedScenarios,
    setSavedScenarios,
    storageStatus,
    refreshSavedScenarios,
  };
}
