import { useRef } from 'react';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import type { PlayDeploySelection } from './usePlayUiState';

export type PlayUndoEntry = {
  battleState: BattleState;
  playDeploySelection: PlayDeploySelection | null;
  playModelSelection: PlayModelSelection | null;
};

export type PendingPlayTimelineAction = {
  undoEntry: PlayUndoEntry;
  action: GameAction;
  stateAfter: BattleState;
};

export function usePlayUndoState() {
  // Drag and rotation gestures stay local until they become one committed timeline action.
  // Persistent undo/redo history belongs exclusively to the core practice timeline.
  const pendingPlayModelMoveUndoRef = useRef<PlayUndoEntry | null>(null);
  const pendingPlayModelMoveActionRef = useRef<PendingPlayTimelineAction | null>(null);
  const pendingPlayRotationUndoRef = useRef<PlayUndoEntry | null>(null);
  const pendingPlayRotationActionRef = useRef<PendingPlayTimelineAction | null>(null);
  const playRotationUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPlayRotationUndoTimer() {
    if (playRotationUndoTimerRef.current) {
      clearTimeout(playRotationUndoTimerRef.current);
      playRotationUndoTimerRef.current = null;
    }
  }

  function clearPendingPlayModelMove() {
    pendingPlayModelMoveUndoRef.current = null;
    pendingPlayModelMoveActionRef.current = null;
  }

  function clearPendingPlayRotation() {
    clearPlayRotationUndoTimer();
    pendingPlayRotationUndoRef.current = null;
    pendingPlayRotationActionRef.current = null;
  }

  function clearPlayUndo() {
    clearPendingPlayModelMove();
    clearPendingPlayRotation();
  }

  return {
    refs: {
      pendingPlayModelMoveUndoRef,
      pendingPlayModelMoveActionRef,
      pendingPlayRotationUndoRef,
      pendingPlayRotationActionRef,
      playRotationUndoTimerRef,
    },
    actions: {
      clearPlayUndo,
      clearPendingPlayModelMove,
      clearPendingPlayRotation,
      clearPlayRotationUndoTimer,
    },
  };
}
