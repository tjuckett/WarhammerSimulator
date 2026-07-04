import { useState, type MutableRefObject } from 'react';
import type { PracticeTimeline, TimelineStateResult } from '@warhammer-simulator/core/practice/timeline';
import { currentTimelineState } from '@warhammer-simulator/core/practice/timeline';
import { scenarioFromTimeline, type PracticeCheckpointKind } from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
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
  practiceTimelineRef: MutableRefObject<PracticeTimeline | null>;
  checkpointBranchIdRef: MutableRefObject<string>;
  activeCheckpointIdRef: MutableRefObject<string | null>;
  activeGameIdRef: MutableRefObject<string | null>;
  savedScenarios: PracticeScenarioSummary[];
  setSavedScenarios: (scenarios: PracticeScenarioSummary[]) => void;
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
  practiceTimelineRef,
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

  async function saveCheckpoint(kind: PracticeCheckpointKind) {
    const timeline = practiceTimelineRef.current;
    if (!timeline) return null;
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

    let summaries: PracticeScenarioSummary[];
    try {
      summaries = await gameSessionRepository.saveScenario(scenario);
    } catch {
      setSaveStatus('Save failed: browser storage is full. Delete older checkpoints or export a backup.');
      return null;
    }

    setSavedScenarios(summaries);
    setActiveCheckpointId(scenario.metadata.id);
    setSaveStatus(`${CHECKPOINT_KIND_SAVED_LABELS[kind]} ${scenario.metadata.name}.`);
    return scenario;
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
    if (!practiceTimelineRef.current) {
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
