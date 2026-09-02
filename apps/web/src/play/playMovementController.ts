import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { GameAction } from '@warhammer-simulator/core/practice/actions';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { playMovementUnitLegalityIssues } from '@warhammer-simulator/core/engine/simulator';
import { resolveAdvancePlayUnitAction, resolveCompletePlayUnitMovementAction, resolveFallBackPlayUnitAction, resolveRemainStationaryPlayUnitAction } from './playMovementActions';
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
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitPendingPlayModelMove: () => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  commitBattleState: (state: BattleState) => void;
  setTargetErrorMsg: (message: string | null) => void;
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

  function remainStationarySelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || !selection) return;
    const result = resolveRemainStationaryPlayUnitAction(prev, selection);
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
    if (!result) {
      const unit = prev.units.find(candidate =>
        candidate.id === selection.unitId
        && candidate.side === selection.side
        && !candidate.destroyed
        && !candidate.embarkedInUnitId,
      );
      const issue = unit ? playMovementUnitLegalityIssues(prev, unit)[0] : null;
      setTargetErrorMsg(issue ?? 'This movement cannot be completed. Undo the move and try again.');
      return;
    }
    pushPlayUndo(playUndoEntry(prev), result.next, result.action);
    setTargetErrorMsg(null);
    setPlayModelSelection(normalizePlaySelectionForState(result.next, playModelSelection));
    commitBattleState(result.next);
  }

  return { advanceSelectedPlayUnit, fallBackSelectedPlayUnit, remainStationarySelectedPlayUnit, completeSelectedPlayUnitMovement };
}
