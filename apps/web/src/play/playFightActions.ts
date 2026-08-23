import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { consolidatePlayUnit, pileInPlayUnit } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { normalizePlaySelectionForState, primaryPlaySelectionPart } from './playSelectionHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };

export function createPlayFightActions({
  battleStateRef,
  playModelSelection,
  activeRulesForBattle,
  playUndoEntry,
  pushPlayUndo,
  commitBattleState,
  setPlayModelSelection,
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  activeRulesForBattle: RulesEdition;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitBattleState: (state: BattleState) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setTargetErrorMsg: (message: string | null) => void;
}) {
  function pileInSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    const next = pileInPlayUnit(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.PileInUnit, unitId: selection.unitId, side: selection.side });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function consolidateSelectedPlayUnit() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    const next = consolidatePlayUnit(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.ConsolidateUnit, unitId: selection.unitId, side: selection.side });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  return { pileInSelectedPlayUnit, consolidateSelectedPlayUnit };
}
