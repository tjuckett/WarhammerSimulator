import { BATTLE_PHASE, MOVEMENT_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';
import { movementStep } from '@warhammer-simulator/core/engine/simulator';

type PlayModelSelectionPart = {
  unitId: string;
  side: 0 | 1;
  modelIndices: number[];
};

type PlayModelSelectionLike = {
  parts: PlayModelSelectionPart[];
};

export function canEditPlayModels(state: BattleState | null | undefined): state is BattleState {
  return !!state && (
    state.phase === BATTLE_PHASE.Deployment
    || (state.phase === BATTLE_PHASE.Setup && state.units.some(unit => unit.scoutMoveStarted))
    || (state.phase === BATTLE_PHASE.Movement && movementStep(state) === MOVEMENT_STEP.MoveUnits)
  );
}

export function canEditMovementModels(state: BattleState | null | undefined): state is BattleState {
  return !!state && state.phase === BATTLE_PHASE.Movement && movementStep(state) === MOVEMENT_STEP.MoveUnits;
}

export function transformPlayModelSelection(
  state: BattleState,
  selection: PlayModelSelectionLike,
  transformPart: (next: BattleState, part: PlayModelSelectionPart) => BattleState,
): BattleState {
  let next = state;
  for (const part of selection.parts) {
    next = transformPart(next, part);
  }
  return next;
}
