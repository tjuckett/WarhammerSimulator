import { useRef, useState, type MutableRefObject } from 'react';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import { clone } from '@warhammer-simulator/core/engine/clone';
import type { PracticeTimeline as GameSessionTimeline, TimelineStateResult } from '@warhammer-simulator/core/practice/timeline';
import { currentTimelineState, truncateTimelineAtCursor } from '@warhammer-simulator/core/practice/timeline';
import {
  currentScenarioState,
  scenarioFromTimeline,
  timelineForScenario,
  type PracticeCheckpointKind as GameSessionCheckpointKind,
} from '@warhammer-simulator/core/practice/scenarios';
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
  battleStateRef: MutableRefObject<BattleState | null>;
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
  battleStateRef,
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
  // Autosaves can be triggered several times before the database request for
  // the first one completes (the initial deployment save is the common case).
  // Serialize the writes so an older snapshot cannot finish after a newer
  // snapshot and become the save selected by the load dialog.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  async function saveCheckpointNow(
    kind: GameSessionCheckpointKind,
    mode: SaveMode = 'current',
    options: SaveOptions = {},
  ) {
    // Autosaves include a complete timeline snapshot. Let the just-completed
    // phase render before doing that work so persistence cannot make the
    // phase button appear to hang on a long-running game.
    if (kind === 'auto-phase') await new Promise<void>(resolve => setTimeout(resolve, 0));
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
      const state = battleStateRef.current ?? currentTimelineState(timeline);
      const label = checkpointLabelForState(state, kind);
      const isNewGame = mode === 'new-game';
      const gameId = isNewGame ? createBranchId() : activeGameIdRef.current ?? timeline.metadata.id;
      const branchId = isNewGame ? createBranchId() : checkpointBranchIdRef.current;
      const checkpointId = options.overwriteCheckpointId ?? activeCheckpointIdRef.current;
      const scenario = {
        ...scenarioFromTimeline(timeline, {
          id: mode === 'new-game' ? undefined : checkpointId ?? undefined,
          name: label,
          gameId,
          branchId,
          parentCheckpointId: undefined,
          checkpointKind: kind,
          checkpointLabel: label,
          sequence: await nextCheckpointSequence(gameSessionRepository, gameId),
          timelineCursor: timeline.cursor,
        }),
        // The React battle state is authoritative at save time. The timeline
        // is updated alongside it, but autosaves can begin in the same event
        // turn as a phase transition and briefly expose the previous cursor.
        initialState: clone(state),
      };
      const summaries = await gameSessionRepository.saveScenario(scenario);
      // Saving is asynchronous. A player can advance one or more steps while
      // this request is in flight, so never restore the snapshot used by the
      // save unless it is still the live timeline *and* battle state. Without
      // this guard an older autosave could visibly jump the board back to the
      // beginning of a phase after the player had already progressed.
      if (timelineWasRebased
        && gameSessionTimelineRef.current === sourceTimeline
        && battleStateRef.current === state) {
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

  function saveCheckpoint(
    kind: GameSessionCheckpointKind,
    mode: SaveMode = 'current',
    options: SaveOptions = {},
  ) {
    const queuedSave = saveQueueRef.current.then(
      () => saveCheckpointNow(kind, mode, options),
      () => saveCheckpointNow(kind, mode, options),
    );
    // Keep the queue alive after a failed save while preserving the rejection
    // for the caller that initiated that save.
    saveQueueRef.current = queuedSave.then(() => undefined, () => undefined);
    return queuedSave;
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
    // A scenario load is asynchronous. If the player has resumed interacting
    // with the table before it completes, that request is stale: restoring
    // its saved interaction state would overwrite a live selection (notably
    // a defender being kept open for pending damage allocation).
    const stateAtLoadRequest = battleStateRef.current;
    const timelineAtLoadRequest = gameSessionTimelineRef.current;
    try {
      // Do not let a save that was already in flight finish after the load and
      // re-assert its older checkpoint metadata/state. This also makes a load
      // requested immediately after a phase transition deterministic.
      await saveQueueRef.current;
      const scenario = await gameSessionRepository.loadScenario(scenarioId);
      if (!scenario) {
        void refreshSavedScenarios();
        setPendingCheckpointLoad(null);
        setSaveStatus('Load failed: the saved game no longer exists.');
        return;
      }

      if (battleStateRef.current !== stateAtLoadRequest
        || gameSessionTimelineRef.current !== timelineAtLoadRequest) {
        setPendingCheckpointLoad(null);
        setSaveStatus('Ignored a stale saved-game load because the table changed while it was loading.');
        return;
      }

      restoreTimelineResult({
        timeline: timelineForScenario(scenario),
        state: currentScenarioState(scenario),
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
    } catch (error) {
      setPendingCheckpointLoad(null);
      setSaveStatus(`Load failed: ${error instanceof Error ? error.message : 'unknown storage error'}`);
    }
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
