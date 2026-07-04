import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import {
  appendResolvedTimelineAction,
  createPracticeTimeline as createGameSessionTimeline,
  redoTimeline,
  seekTimeline,
  undoTimeline,
  type PracticeTimeline as GameSessionTimeline,
  type TimelineStateResult,
} from '@warhammer-simulator/core/practice/timeline';

type UseGameSessionTimelineParams = {
  createBranchId: () => string;
  checkpointBranchIdRef: MutableRefObject<string>;
  setActiveCheckpointId: (checkpointId: string | null) => void;
  setActiveGameId: (gameId: string | null) => void;
  setPendingCheckpointLoad: (pendingLoad: null) => void;
  restoreTimelineResult: (result: TimelineStateResult) => void;
};

export function useGameSessionTimeline({
  createBranchId,
  checkpointBranchIdRef,
  setActiveCheckpointId,
  setActiveGameId,
  setPendingCheckpointLoad,
  restoreTimelineResult,
}: UseGameSessionTimelineParams) {
  const [timeline, setTimeline] = useState<GameSessionTimeline | null>(null);
  const timelineRef = useRef<GameSessionTimeline | null>(null);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  function setCurrentTimeline(nextTimeline: GameSessionTimeline | null) {
    timelineRef.current = nextTimeline;
    setTimeline(nextTimeline);
  }

  function resetTimeline() {
    setCurrentTimeline(null);
    setActiveCheckpointId(null);
    setActiveGameId(null);
    checkpointBranchIdRef.current = createBranchId();
    setPendingCheckpointLoad(null);
  }

  function startTimeline(initialState: BattleState) {
    checkpointBranchIdRef.current = createBranchId();
    setActiveCheckpointId(null);
    const nextTimeline = createGameSessionTimeline(initialState, {
      title: initialState.setup
        ? `${initialState.setup.missionCode}: ${initialState.setup.primaryMissions?.join(' vs ') ?? initialState.setup.primaryMission}`
        : 'Game session',
    });
    setActiveGameId(nextTimeline.metadata.id);
    setCurrentTimeline(nextTimeline);
  }

  function recordAction(stateBefore: BattleState, stateAfter: BattleState, action: GameAction) {
    const currentTimeline = timelineRef.current ?? createGameSessionTimeline(stateBefore);
    const nextTimeline = appendResolvedTimelineAction(currentTimeline, action, { stateBefore, stateAfter });
    setCurrentTimeline(nextTimeline);
  }

  function undoTimelineCursor() {
    const currentTimeline = timelineRef.current;
    if (!currentTimeline) return;
    const result = undoTimeline(currentTimeline);
    setCurrentTimeline(result.timeline);
  }

  function restoreResultTimeline(result: TimelineStateResult) {
    setCurrentTimeline(result.timeline);
  }

  function undoTimelineAction() {
    const currentTimeline = timelineRef.current;
    if (!currentTimeline) return;
    restoreTimelineResult(undoTimeline(currentTimeline));
  }

  function redoTimelineAction() {
    const currentTimeline = timelineRef.current;
    if (!currentTimeline) return;
    restoreTimelineResult(redoTimeline(currentTimeline));
  }

  function seekTimelineAction(cursor: number) {
    const currentTimeline = timelineRef.current;
    if (!currentTimeline) return;
    restoreTimelineResult(seekTimeline(currentTimeline, cursor));
  }

  return {
    state: {
      timeline,
    },
    refs: {
      timelineRef,
    },
    actions: {
      setCurrentTimeline,
      resetTimeline,
      startTimeline,
      recordAction,
      undoTimelineCursor,
      restoreResultTimeline,
      undoTimelineAction,
      redoTimelineAction,
      seekTimelineAction,
    },
  };
}
