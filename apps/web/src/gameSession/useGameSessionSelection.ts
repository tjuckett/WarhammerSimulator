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

export type PendingCheckpointAutosave = {
  gameName: string;
  cursor: number;
  savedCursor: number;
  /** The exact checkpoint that was current when the rewind was detected. */
  checkpointId: string;
};

export function useGameSessionSelection() {
  const [activeCheckpointId, setActiveCheckpointIdState] = useState<string | null>(null);
  const [activeGameId, setActiveGameIdState] = useState<string | null>(null);
  const [pendingCheckpointLoad, setPendingCheckpointLoad] = useState<PendingCheckpointLoad | null>(null);
  const [pendingCheckpointDelete, setPendingCheckpointDelete] = useState<PendingCheckpointDelete | null>(null);
  const [pendingCheckpointAutosave, setPendingCheckpointAutosave] = useState<PendingCheckpointAutosave | null>(null);

  const activeCheckpointIdRef = useRef<string | null>(null);
  const activeGameIdRef = useRef<string | null>(null);

  function setActiveCheckpointId(checkpointId: string | null) {
    activeCheckpointIdRef.current = checkpointId;
    setActiveCheckpointIdState(checkpointId);
  }

  function setActiveGameId(gameId: string | null) {
    activeGameIdRef.current = gameId;
    setActiveGameIdState(gameId);
  }

  return {
    active: {
      activeCheckpointId,
      activeGameId,
    },
    pending: {
      pendingCheckpointLoad,
      setPendingCheckpointLoad,
      pendingCheckpointDelete,
      setPendingCheckpointDelete,
      pendingCheckpointAutosave,
      setPendingCheckpointAutosave,
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
