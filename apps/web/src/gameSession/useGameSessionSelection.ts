import { useRef, useState } from 'react';

export type PendingCheckpointLoad = {
  scenarioId: string;
  scenarioName: string;
};

export type PendingCheckpointDelete = {
  scenarioId: string;
  scenarioName: string;
  deleteIds: string[];
};

export function useGameSessionSelection() {
  const [activeCheckpointId, setActiveCheckpointIdState] = useState<string | null>(null);
  const [activeGameId, setActiveGameIdState] = useState<string | null>(null);
  const [selectedSaveGameId, setSelectedSaveGameId] = useState<string | null>(null);
  const [pendingCheckpointLoad, setPendingCheckpointLoad] = useState<PendingCheckpointLoad | null>(null);
  const [pendingCheckpointDelete, setPendingCheckpointDelete] = useState<PendingCheckpointDelete | null>(null);

  const activeCheckpointIdRef = useRef<string | null>(null);
  const activeGameIdRef = useRef<string | null>(null);

  function setActiveCheckpointId(checkpointId: string | null) {
    activeCheckpointIdRef.current = checkpointId;
    setActiveCheckpointIdState(checkpointId);
  }

  function setActiveGameId(gameId: string | null) {
    activeGameIdRef.current = gameId;
    setActiveGameIdState(gameId);
    setSelectedSaveGameId(gameId);
  }

  return {
    active: {
      activeCheckpointId,
      activeGameId,
    },
    saveSelection: {
      selectedSaveGameId,
      setSelectedSaveGameId,
    },
    pending: {
      pendingCheckpointLoad,
      setPendingCheckpointLoad,
      pendingCheckpointDelete,
      setPendingCheckpointDelete,
    },
    refs: {
      activeCheckpointIdRef,
      activeGameIdRef,
    },
    actions: {
      setActiveCheckpointId,
      setActiveGameId,
    },
  };
}
