import { PHASE_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { beginPlayFightMovement, completePlayFightMovement } from '@warhammer-simulator/core/engine/simulator';
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
  setInspectedSelection,
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
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
    const movementStepAllowed = kind === 'consolidate'
      ? prev.phaseStep === PHASE_STEP.FightConsolidate
      : prev.phaseStep === PHASE_STEP.FightPileIn
        || (prev.phaseStep === PHASE_STEP.FightUnits && selectedUnit?.overrunFightSelected === true);
    if (!movementStepAllowed) return;
    const next = beginPlayFightMovement(prev, selection.unitId, selection.side, kind, activeRulesForBattle);
    if (next === prev) return;
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.BeginFightMovement, unitId: selection.unitId, side: selection.side, kind });
    setPlayModelSelection(normalizePlaySelectionForState(next, playModelSelection));
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  function completeSelectedPlayFightMovement() {
    const prev = battleStateRef.current;
    const selection = primaryPlaySelectionPart(playModelSelection)
      ?? (prev?.pendingFightMovement
        ? { unitId: prev.pendingFightMovement.unitId, side: prev.pendingFightMovement.side, modelIndices: [] }
        : null);
    if (!prev || prev.phase !== 'fight' || !selection || !prev.pendingFightMovement) return;
    const movementStepAllowed = prev.pendingFightMovement.kind === 'consolidate'
      ? prev.phaseStep === PHASE_STEP.FightConsolidate
      : prev.phaseStep === PHASE_STEP.FightPileIn
        || (prev.phaseStep === PHASE_STEP.FightUnits
          && prev.units.find(unit => unit.id === selection.unitId && unit.side === selection.side)?.overrunFightSelected === true);
    if (!movementStepAllowed) return;
    const next = completePlayFightMovement(prev, selection.unitId, selection.side, activeRulesForBattle);
    if (next === prev) {
      setTargetErrorMsg('Finish the 3\" move in Engagement Range before completing this fight move.');
      return;
    }
    pushPlayUndo(playUndoEntry(prev), next, { type: GAME_ACTION_TYPE.CompleteFightMovement, unitId: selection.unitId, side: selection.side });
    setPlayModelSelection(null);
    setInspectedSelection(null);
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  return {
    pileInSelectedPlayUnit: () => beginSelectedPlayFightMovement('pileIn'),
    consolidateSelectedPlayUnit: () => beginSelectedPlayFightMovement('consolidate'),
    completeSelectedPlayFightMovement,
  };
}
