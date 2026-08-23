import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { chargePlayUnitTargets, completePlayChargeMovement } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { normalizePlaySelectionForState, primaryPlaySelectionPart } from './playSelectionHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };

export function createPlayChargeActions({
  battleStateRef,
  playModelSelection,
  selectedChargeTargetIds,
  activeRulesForBattle,
  playUndoEntry,
  pushPlayUndo,
  commitBattleState,
  setTargetErrorMsg,
  setSelectedChargeTargetIds,
  setPlayModelSelection,
  setInspectedSelection,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  selectedChargeTargetIds: string[];
  activeRulesForBattle: RulesEdition;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitBattleState: (state: BattleState) => void;
  setTargetErrorMsg: (message: string | null) => void;
  setSelectedChargeTargetIds: (targetIds: string[]) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: { kind: 'battle'; side: 0 | 1; unitId: string } | null) => void;
}) {
  function resolveSelectedPlayCharge() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'charge' || !selection || !selectedChargeTargetIds.length) return;
    const next = chargePlayUnitTargets(prev, selection.unitId, selection.side, selectedChargeTargetIds, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ChargeUnitTarget,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: selectedChargeTargetIds[0],
      targetUnitIds: selectedChargeTargetIds,
    });
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function completeSelectedPlayChargeMovement() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'charge' || !selection) return;
    const next = completePlayChargeMovement(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) {
      setTargetErrorMsg('Move every model into Engagement Range of each declared charge target before completing the charge.');
      return;
    }
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.CompleteChargeMovement,
      unitId: selection.unitId,
      side: selection.side,
    });
    setSelectedChargeTargetIds([]);
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  return { resolveSelectedPlayCharge, completeSelectedPlayChargeMovement };
}
