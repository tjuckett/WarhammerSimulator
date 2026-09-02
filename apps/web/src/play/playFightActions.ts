import { PHASE_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
import { beginPlayFightMovement, completePlayFightMovement, passPlayFight, playFightMovementValidation } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { normalizePlaySelectionForState, primaryPlaySelectionPart } from './playSelectionHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };

export function createPlayFightActions({
  battleStateRef,
  playModelSelection,
  selectedFightMovementTargetIds,
  selectedFightConsolidationMode,
  selectedFightObjectiveIndex,
  activeRulesForBattle,
  playUndoEntry,
  pushPlayUndo,
  commitBattleState,
  setPlayModelSelection,
  setInspectedSelection,
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  selectedFightMovementTargetIds: string[];
  selectedFightConsolidationMode: 'ongoing' | 'engaging' | 'objective' | null;
  selectedFightObjectiveIndex: number | null;
  activeRulesForBattle: RulesEdition;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitBattleState: (state: BattleState) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: PlayModelSelection | null) => void;
  setTargetErrorMsg: (message: string | null) => void;
}) {
  function beginSelectedPlayFightMovement(kind: 'pileIn' | 'consolidate') {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    const selectedUnit = prev.units.find(unit => unit.id === selection.unitId && unit.side === selection.side);
    const fightStep = phaseStepFor(prev);
    const movementStepAllowed = kind === 'consolidate'
      ? fightStep === PHASE_STEP.FightConsolidate
      : fightStep === PHASE_STEP.FightPileIn
        || (fightStep === PHASE_STEP.FightUnits && selectedUnit?.overrunFightSelected === true);
    if (!movementStepAllowed) return;
    const intent = kind === 'pileIn'
      ? { targetUnitIds: selectedFightMovementTargetIds }
      : {
          consolidationMode: selectedFightConsolidationMode ?? undefined,
          objectiveIndex: selectedFightObjectiveIndex ?? undefined,
          targetUnitIds: selectedFightMovementTargetIds,
        };
    const next = beginPlayFightMovement(prev, selection.unitId, selection.side, kind, activeRulesForBattle, intent);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.BeginFightMovement,
      unitId: selection.unitId,
      side: selection.side,
      kind,
      targetUnitIds: intent.targetUnitIds,
      consolidationMode: intent.consolidationMode,
      objectiveIndex: intent.objectiveIndex,
    });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function completeSelectedPlayFightMovement() {
    const prev = battleStateRef.current;
    const pendingMovement = prev?.pendingFightMovement;
    if (!prev || prev.phase !== 'fight' || !pendingMovement) return;
    // The pending Fight movement owns the unit being completed. The canvas
    // selection may be cleared or point at another unit while the popup is
    // open, but that must not redirect completion to the current selection.
    const pendingUnit = prev.units.find(unit => unit.id === pendingMovement.unitId && unit.side === pendingMovement.side);
    if (!pendingUnit) return;
    const fightStep = phaseStepFor(prev);
    const movementStepAllowed = pendingMovement.kind === 'consolidate'
      ? fightStep === PHASE_STEP.FightConsolidate
      : fightStep === PHASE_STEP.FightPileIn
        || (fightStep === PHASE_STEP.FightUnits
          && pendingUnit.overrunFightSelected === true);
    if (!movementStepAllowed) return;
    const next = completePlayFightMovement(prev, pendingMovement.unitId, pendingMovement.side, activeRulesForBattle);
    if (next === prev) {
      const validation = playFightMovementValidation(prev, activeRulesForBattle);
      if (pendingMovement.kind === 'pileIn') {
        setTargetErrorMsg(validation.failure === 'model-not-closer'
          ? 'Pile In cannot be completed: move the highlighted models closer to their closest Pile In target.'
          : validation.failure === 'unit-not-engaged'
            ? 'Pile In cannot be completed: at least one model in the unit must end in Engagement Range.'
            : validation.failure === 'initial-engagement-lost'
              ? 'Pile In cannot be completed: a model that started engaged must remain engaged with that enemy unit.'
              : validation.failure === 'locked-model-moved'
                ? 'Pile In cannot be completed: a model in base contact cannot be moved.'
                : 'Pile In cannot be completed: check the highlighted movement requirement. You do not have to use all 3".' );
      } else {
        setTargetErrorMsg('Consolidation cannot be completed: finish the selected consolidation requirement. You do not have to use all 3".');
      }
      return;
    }
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.CompleteFightMovement,
      unitId: pendingMovement.unitId,
      side: pendingMovement.side,
    });
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function passSelectedPlayFight(side: 0 | 1) {
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight') return;
    const next = passPlayFight(prev, side, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.PassFight, side });
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  return {
    pileInSelectedPlayUnit: () => beginSelectedPlayFightMovement('pileIn'),
    consolidateSelectedPlayUnit: () => beginSelectedPlayFightMovement('consolidate'),
    completeSelectedPlayFightMovement,
    passSelectedPlayFight,
  };
}
