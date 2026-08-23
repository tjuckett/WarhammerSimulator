import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { resolveAdvancePlayUnitAction, resolveCompletePlayUnitMovementAction, resolveFallBackPlayUnitAction } from './playMovementActions';
import { normalizePlaySelectionForState, primaryPlaySelectionPart } from './playSelectionHelpers';
import type { PlayModelSelection } from '../components/Battlefield';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };

export function createPlayMovementActionHandlers({
  battleStateRef,
  playModelSelection,
  playUndoEntry,
  pushPlayUndo,
  commitPendingPlayModelMove,
  setPlayModelSelection,
  commitBattleState,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitPendingPlayModelMove: () => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  commitBattleState: (state: BattleState) => void;
}) {
  function advanceSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveAdvancePlayUnitAction(prev, selection, rulesEditionForRuleset(prev.ruleset));
    if (!result) return;
    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  function fallBackSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveFallBackPlayUnitAction(prev, selection, rulesEditionForRuleset(prev.ruleset));
    if (!result) return;
    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  function completeSelectedPlayUnitMovement() {
    commitPendingPlayModelMove();
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveCompletePlayUnitMovementAction(prev, selection);
    if (!result) return;
    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  return { advanceSelectedPlayUnit, fallBackSelectedPlayUnit, completeSelectedPlayUnitMovement };
}
