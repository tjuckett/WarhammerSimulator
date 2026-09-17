import { PHASE_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { chargePlayUnitTargets, completePlayChargeMovement, playChargeMovementValidation } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { normalizePlaySelectionForState, primaryPlaySelectionPart } from './playSelectionHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';
import { measurePerformanceTrace } from '../performance/performanceTrace';

type StateRef = { current: BattleState | null };

function chargeMovementErrorMessage(reason: ReturnType<typeof playChargeMovementValidation>): string {
  if (reason.valid) return '';
  switch (reason.reason) {
    case 'target-not-engaged':
      return 'Charge cannot be completed: the unit must end engaged with every declared target.';
    case 'undeclared-enemy':
      return 'Charge cannot be completed: the unit would be engaged with an undeclared enemy unit.';
    case 'invalid-movement':
      return reason.issues?.[0] ?? 'Charge cannot be completed because the movement is invalid.';
    default:
      return 'Charge cannot be completed because the charge movement is not valid.';
  }
}

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
    if (!prev || prev.phase !== 'charge' || prev.phaseStep !== PHASE_STEP.ChargeUnits
      || !selection || !selectedChargeTargetIds.length) return;
    const next = measurePerformanceTrace(
      'charge-target-resolution',
      () => chargePlayUnitTargets(prev, selection.unitId, selection.side, selectedChargeTargetIds, activeRulesForBattle),
      { unitId: selection.unitId, side: selection.side, targetCount: selectedChargeTargetIds.length },
    );
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
    if (!prev || prev.phase !== 'charge' || prev.phaseStep !== PHASE_STEP.ChargeUnits || !selection) return;
    const next = completePlayChargeMovement(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) {
      setTargetErrorMsg(chargeMovementErrorMessage(
        playChargeMovementValidation(prev, selection.unitId, selection.side, activeRulesForBattle),
      ));
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
