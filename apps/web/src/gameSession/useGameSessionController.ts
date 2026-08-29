import { useRef, useState, type MutableRefObject } from 'react';
import type { PracticeTimeline as GameSessionTimeline, TimelineStateResult } from '@warhammer-simulator/core/practice/timeline';
import { currentTimelineState, truncateTimelineAtCursor } from '@warhammer-simulator/core/practice/timeline';
import { scenarioFromTimeline, type PracticeCheckpointKind as GameSessionCheckpointKind } from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioSummary as GameSessionScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import {
  CHECKPOINT_KIND_SAVED_LABELS,
  checkpointLabelForState,
  nextCheckpointSequence,
} from './checkpointHelpers';
import { gameSessionRepository } from './gameSessionRepository';
import type { PendingCheckpointDelete, PendingCheckpointLoad } from './useGameSessionSelection';

type LoadOptions = {
  branchOnNextSave?: boolean;
  statusPrefix?: string;
};

type SaveMode = 'current' | 'overwrite-rewound' | 'new-game';

type SaveOptions = {
  overwriteCheckpointId?: string;
};

type UseGameSessionControllerParams = {
  gameSessionTimelineRef: MutableRefObject<GameSessionTimeline | null>;
  checkpointBranchIdRef: MutableRefObject<string>;
  activeCheckpointIdRef: MutableRefObject<string | null>;
  activeGameIdRef: MutableRefObject<string | null>;
  savedScenarios: GameSessionScenarioSummary[];
  setSavedScenarios: (scenarios: GameSessionScenarioSummary[]) => void;
  refreshSavedScenarios: () => Promise<void>;
  pendingCheckpointLoad: PendingCheckpointLoad | null;
  setPendingCheckpointLoad: (pendingLoad: PendingCheckpointLoad | null) => void;
  pendingCheckpointDelete: PendingCheckpointDelete | null;
  setPendingCheckpointDelete: (pendingDelete: PendingCheckpointDelete | null) => void;
  setPendingCheckpointAutosave: (pendingAutosave: PendingCheckpointAutosave | null) => void;
  setActiveCheckpointId: (checkpointId: string | null) => void;
  setActiveGameId: (gameId: string | null) => void;
  restoreTimelineResult: (result: TimelineStateResult) => void;
  createBranchId: () => string;
};

export function useGameSessionController({
  gameSessionTimelineRef,
  checkpointBranchIdRef,
  activeCheckpointIdRef,
  activeGameIdRef,
  savedScenarios,
  setSavedScenarios,
  refreshSavedScenarios,
  pendingCheckpointLoad,
  setPendingCheckpointLoad,
  pendingCheckpointDelete,
  setPendingCheckpointDelete,
  setPendingCheckpointAutosave,
  setActiveCheckpointId,
  setActiveGameId,
  restoreTimelineResult,
  createBranchId,
}: UseGameSessionControllerParams) {
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [saveInProgress, setSaveInProgress] = useState(false);
  const pendingCheckpointIdRef = useRef<string | null>(null);

  async function saveCheckpoint(
    kind: GameSessionCheckpointKind,
    mode: SaveMode = 'current',
    options: SaveOptions = {},
  ) {
    const sourceTimeline = gameSessionTimelineRef.current;
    setSaveInProgress(true);
    try {
      if (!sourceTimeline) {
        setSaveStatus('Save failed: no active game session is available. Start a battle first.');
        return null;
      }
      const timeline = mode === 'current' && sourceTimeline.metadata.rewoundFromCursor === undefined
        ? sourceTimeline
        : truncateTimelineAtCursor(sourceTimeline);
      const timelineWasRebased = timeline !== sourceTimeline;
      const state = currentTimelineState(timeline);
      const label = checkpointLabelForState(state, kind);
      const isNewGame = mode === 'new-game';
      const gameId = isNewGame ? createBranchId() : activeGameIdRef.current ?? timeline.metadata.id;
      const branchId = isNewGame ? createBranchId() : checkpointBranchIdRef.current;
      const checkpointId = options.overwriteCheckpointId ?? activeCheckpointIdRef.current;
      const scenario = scenarioFromTimeline(timeline, {
        id: mode === 'new-game' ? undefined : checkpointId ?? undefined,
        name: label,
        gameId,
        branchId,
        parentCheckpointId: undefined,
        checkpointKind: kind,
        checkpointLabel: label,
        sequence: await nextCheckpointSequence(gameSessionRepository, gameId),
        timelineCursor: timeline.cursor,
      });
      const summaries = await gameSessionRepository.saveScenario(scenario);
      if (timelineWasRebased) {
        restoreTimelineResult({
          timeline,
          state: currentTimelineState(timeline),
        });
      }
      setSavedScenarios(summaries);
      setActiveCheckpointId(scenario.metadata.id);
      setActiveGameId(gameId);
      checkpointBranchIdRef.current = branchId;
      setPendingCheckpointAutosave(null);
      setSaveStatus(`${CHECKPOINT_KIND_SAVED_LABELS[kind]} ${scenario.metadata.name}.`);
      return scenario;
    } catch (error) {
      setSaveStatus(`Save failed: ${error instanceof Error ? error.message : 'unknown storage error'}`);
      return null;
    } finally {
      setSaveInProgress(false);
    }
  }

  async function saveAutoPhaseCheckpoint() {
    const timeline = gameSessionTimelineRef.current;
    if (!timeline) return null;
    const activeCheckpoint = activeCheckpointIdRef.current
      ? savedScenarios.find(scenario => scenario.id === activeCheckpointIdRef.current)
      : null;
    const savedCursor = activeCheckpoint?.cursor ?? 0;
    const rewindIsBehindSavedCursor = timeline.metadata.rewoundFromCursor !== undefined
      && timeline.metadata.rewoundFromCursor < savedCursor;
    if (activeCheckpoint && (
      timeline.cursor < savedCursor
      || rewindIsBehindSavedCursor
    )) {
      setPendingCheckpointAutosave({
        gameName: activeCheckpoint.name,
        cursor: timeline.cursor,
        savedCursor,
        checkpointId: activeCheckpoint.id,
      });
      pendingCheckpointIdRef.current = activeCheckpoint.id;
      return null;
    }
    return saveCheckpoint('auto-phase', 'current');
  }

  async function overwriteRewoundAutosave() {
    const savedCheckpointId = pendingCheckpointIdRef.current;
    const saved = await saveCheckpoint('auto-phase', 'overwrite-rewound', {
      overwriteCheckpointId: savedCheckpointId ?? undefined,
    });
    if (saved) pendingCheckpointIdRef.current = null;
    return saved;
  }

  async function saveRewoundAutosaveAsNewGame() {
    const saved = await saveCheckpoint('auto-phase', 'new-game');
    if (saved) pendingCheckpointIdRef.current = null;
    return saved;
  }

  async function saveActiveScenarioAndClose() {
    const saved = await saveCheckpoint('play');
    if (saved) setSaveModalOpen(false);
  }

  async function loadSavedScenario(scenarioId: string, options: LoadOptions = {}) {
    const scenario = await gameSessionRepository.loadScenario(scenarioId);
    if (!scenario) {
      void refreshSavedScenarios();
      setPendingCheckpointLoad(null);
      return;
    }

    restoreTimelineResult({
      timeline: scenario.timeline,
      state: currentTimelineState(scenario.timeline),
    });
    setActiveCheckpointId(scenario.metadata.id);
    setActiveGameId(scenario.metadata.gameId ?? scenario.timeline.metadata.id);
    checkpointBranchIdRef.current = options.branchOnNextSave
      ? createBranchId()
      : scenario.metadata.branchId ?? createBranchId();
    setPendingCheckpointLoad(null);
    setSaveStatus(
      `${options.statusPrefix ?? ''}Loaded ${scenario.metadata.name}.${options.branchOnNextSave ? ' Future checkpoints will branch from here.' : ''}`,
    );
  }

  function requestLoadSavedScenario(scenarioId: string) {
    if (!gameSessionTimelineRef.current) {
      setLoadModalOpen(false);
      void loadSavedScenario(scenarioId, { branchOnNextSave: true });
      return;
    }
    const scenarioName = savedScenarios.find(scenario => scenario.id === scenarioId)?.name ?? 'saved checkpoint';
    setLoadModalOpen(false);
    setPendingCheckpointLoad({ scenarioId, scenarioName });
  }

  async function saveCurrentAndLoadPendingCheckpoint() {
    if (!pendingCheckpointLoad) return;
    const nextLoad = pendingCheckpointLoad;
    const saved = await saveCheckpoint('play');
    if (!saved) return;
    await loadSavedScenario(nextLoad.scenarioId, {
      branchOnNextSave: true,
      statusPrefix: 'Saved current progress, then ',
    });
  }

  function loadPendingCheckpointWithoutSaving() {
    if (!pendingCheckpointLoad) return;
    void loadSavedScenario(pendingCheckpointLoad.scenarioId, { branchOnNextSave: true });
  }

  function requestDeleteSavedScenario(scenarioId: string) {
    const scenario = savedScenarios.find(candidate => candidate.id === scenarioId);
    if (!scenario) {
      void refreshSavedScenarios();
      return;
    }
    setLoadModalOpen(false);
    const gameId = scenario.gameId ?? scenario.id;
    const gameScenarioIds = savedScenarios
      .filter(candidate => (candidate.gameId ?? candidate.id) === gameId)
      .map(candidate => candidate.id);
    setPendingCheckpointDelete({
      scenarioId,
      scenarioName: scenario.name,
      deleteIds: gameScenarioIds.length ? gameScenarioIds : [scenarioId],
    });
  }

  async function confirmDeleteSavedScenario() {
    if (!pendingCheckpointDelete) return;
    const deleteIds = pendingCheckpointDelete.deleteIds;
    setSavedScenarios(await gameSessionRepository.deleteScenarios(deleteIds));
    if (activeCheckpointIdRef.current && deleteIds.includes(activeCheckpointIdRef.current)) {
      setActiveCheckpointId(null);
      setActiveGameId(null);
    }
    setPendingCheckpointDelete(null);
    setLoadModalOpen(true);
    setSaveStatus(`Deleted saved game${deleteIds.length > 1 ? ' and its older records' : ''}.`);
  }

  return {
    modals: {
      saveModalOpen,
      setSaveModalOpen,
      loadModalOpen,
      setLoadModalOpen,
    },
    status: {
      saveStatus,
      saveInProgress,
    },
    actions: {
      saveCheckpoint,
      saveActiveScenarioAndClose,
      requestLoadSavedScenario,
      saveCurrentAndLoadPendingCheckpoint,
      loadPendingCheckpointWithoutSaving,
      requestDeleteSavedScenario,
      confirmDeleteSavedScenario,
      saveAutoPhaseCheckpoint,
      overwriteRewoundAutosave,
      saveRewoundAutosaveAsNewGame,
      cancelAutoPhaseSave: () => {
        pendingCheckpointIdRef.current = null;
        setPendingCheckpointAutosave(null);
      },
    },
  };
}
