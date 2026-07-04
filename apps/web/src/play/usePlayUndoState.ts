import { useRef, useState } from 'react';
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
  const [playUndoStack, setPlayUndoStack] = useState<PlayUndoEntry[]>([]);
  const playUndoStackRef = useRef<PlayUndoEntry[]>([]);
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

  function pushPlayUndoEntry(entry: PlayUndoEntry) {
    const nextStack = [...playUndoStackRef.current, entry].slice(-100);
    playUndoStackRef.current = nextStack;
    setPlayUndoStack(nextStack);
  }

  function popPlayUndoEntry(): PlayUndoEntry | null {
    const entry = playUndoStackRef.current[playUndoStackRef.current.length - 1] ?? null;
    if (!entry) return null;
    const nextStack = playUndoStackRef.current.slice(0, -1);
    playUndoStackRef.current = nextStack;
    setPlayUndoStack(nextStack);
    return entry;
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
    playUndoStackRef.current = [];
    setPlayUndoStack([]);
    clearPendingPlayModelMove();
    clearPendingPlayRotation();
  }

  return {
    state: {
      playUndoStack,
    },
    refs: {
      playUndoStackRef,
      pendingPlayModelMoveUndoRef,
      pendingPlayModelMoveActionRef,
      pendingPlayRotationUndoRef,
      pendingPlayRotationActionRef,
      playRotationUndoTimerRef,
    },
    actions: {
      pushPlayUndoEntry,
      popPlayUndoEntry,
      clearPlayUndo,
      clearPendingPlayModelMove,
      clearPendingPlayRotation,
      clearPlayRotationUndoTimer,
    },
  };
}
