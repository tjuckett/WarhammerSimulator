import { useState, type MutableRefObject } from 'react';
import type { PracticeTimeline as GameSessionTimeline, TimelineStateResult } from '@warhammer-simulator/core/practice/timeline';
import { currentTimelineState } from '@warhammer-simulator/core/practice/timeline';
import { scenarioFromTimeline, type PracticeCheckpointKind as GameSessionCheckpointKind } from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioSummary as GameSessionScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import {
  CHECKPOINT_KIND_SAVED_LABELS,
  checkpointDescendantIds,
  checkpointLabelForState,
  nextCheckpointSequence,
} from './checkpointHelpers';
import { gameSessionRepository } from './gameSessionRepository';
import type { PendingCheckpointDelete, PendingCheckpointLoad } from './useGameSessionSelection';

type LoadOptions = {
  branchOnNextSave?: boolean;
  statusPrefix?: string;
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
  setActiveCheckpointId,
  setActiveGameId,
  restoreTimelineResult,
  createBranchId,
}: UseGameSessionControllerParams) {
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  async function saveCheckpoint(kind: GameSessionCheckpointKind) {
    const timeline = gameSessionTimelineRef.current;
    try {
      if (!timeline) {
        setSaveStatus('Save failed: no active game session is available. Start a battle first.');
        return null;
      }
      const state = currentTimelineState(timeline);
      const label = checkpointLabelForState(state, kind);
      const gameId = activeGameIdRef.current ?? timeline.metadata.id;
      const scenario = scenarioFromTimeline(timeline, {
        name: label,
        gameId,
        branchId: checkpointBranchIdRef.current,
        parentCheckpointId: activeCheckpointIdRef.current ?? undefined,
        checkpointKind: kind,
        checkpointLabel: label,
        sequence: await nextCheckpointSequence(gameSessionRepository, gameId),
        timelineCursor: timeline.cursor,
      });
      const summaries = await gameSessionRepository.saveScenario(scenario);
      setSavedScenarios(summaries);
      setActiveCheckpointId(scenario.metadata.id);
      setSaveStatus(`${CHECKPOINT_KIND_SAVED_LABELS[kind]} ${scenario.metadata.name}.`);
      return scenario;
    } catch (error) {
      setSaveStatus(`Save failed: ${error instanceof Error ? error.message : 'unknown storage error'}`);
      return null;
    }
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
    setPendingCheckpointDelete({
      scenarioId,
      scenarioName: scenario.name,
      deleteIds: checkpointDescendantIds(savedScenarios, scenarioId),
    });
  }

  async function confirmDeleteSavedScenario() {
    if (!pendingCheckpointDelete) return;
    const deleteIds = pendingCheckpointDelete.deleteIds;
    setSavedScenarios(await gameSessionRepository.deleteScenarios(deleteIds));
    if (activeCheckpointIdRef.current && deleteIds.includes(activeCheckpointIdRef.current)) {
      setActiveCheckpointId(null);
    }
    setPendingCheckpointDelete(null);
    setSaveStatus(`Deleted ${deleteIds.length} checkpoint${deleteIds.length === 1 ? '' : 's'}.`);
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
    },
    actions: {
      saveCheckpoint,
      saveActiveScenarioAndClose,
      requestLoadSavedScenario,
      saveCurrentAndLoadPendingCheckpoint,
      loadPendingCheckpointWithoutSaving,
      requestDeleteSavedScenario,
      confirmDeleteSavedScenario,
    },
  };
}
