import {
  BATTLE_PHASE,
  MOVEMENT_STEP,
  type BattleState,
  type Position,
} from '@warhammer-simulator/core/types/battle';
import {
  movementStep,
  placePlayReinforcement,
  placePlayStrategicReserveUnit,
  placePlayUnit,
} from '@warhammer-simulator/core/engine/simulator';
import { UNIT_DEPLOYMENT_MODE } from '@warhammer-simulator/core/types/army';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import { PLAY_DEPLOY_SELECTION_KIND, type PlayDeploySelection } from './usePlayUiState';

type PlayPlacementAction = Extract<
  GameAction,
  | { type: typeof GAME_ACTION_TYPE.PlaceUnit }
  | { type: typeof GAME_ACTION_TYPE.PlaceReinforcement }
  | { type: typeof GAME_ACTION_TYPE.PlaceStrategicReserveUnit }
>;

export function canSelectPlayReinforcementUnit(
  state: BattleState | null | undefined,
  side: 0 | 1,
  armyUnitIndex: number,
): boolean {
  if (
    !state
    || state.phase !== BATTLE_PHASE.Movement
    || movementStep(state) !== MOVEMENT_STEP.Reinforcements
    || state.activeArmy !== side
  ) return false;

  const mode = state.armies[side].army.units[armyUnitIndex]?.deployment?.mode;
  return mode === UNIT_DEPLOYMENT_MODE.DeepStrike || mode === UNIT_DEPLOYMENT_MODE.StrategicReserve;
}

export function canSelectPlayStrategicReserveUnit(
  state: BattleState | null | undefined,
  side: 0 | 1,
  unitId: string,
): boolean {
  const unit = state?.units.find(candidate =>
    candidate.id === unitId
    && candidate.side === side
    && !candidate.destroyed
    && candidate.inStrategicReserves,
  );
  return !!(
    state
    && unit
    && state.phase === BATTLE_PHASE.Movement
    && movementStep(state) === MOVEMENT_STEP.Reinforcements
    && (state.activeArmy === side || unit.rapidIngressThisPhase)
  );
}

export function resolvePlayPlacement(
  state: BattleState,
  selection: PlayDeploySelection,
  position: Position,
): { next: BattleState; placed: boolean; action: PlayPlacementAction } {
  if (selection.kind === PLAY_DEPLOY_SELECTION_KIND.Deployment) {
    const next = placePlayUnit(state, selection.side, selection.unitIndex, position);
    return {
      next,
      placed: next.unplacedUnits[selection.side].length < state.unplacedUnits[selection.side].length,
      action: {
        type: GAME_ACTION_TYPE.PlaceUnit,
        side: selection.side,
        unitIndex: selection.unitIndex,
        position,
      },
    };
  }

  if (selection.kind === PLAY_DEPLOY_SELECTION_KIND.Reinforcement) {
    const next = placePlayReinforcement(state, selection.side, selection.armyUnitIndex, position);
    return {
      next,
      placed: next.units.length > state.units.length,
      action: {
        type: GAME_ACTION_TYPE.PlaceReinforcement,
        side: selection.side,
        armyUnitIndex: selection.armyUnitIndex,
        position,
      },
    };
  }

  const next = placePlayStrategicReserveUnit(state, selection.side, selection.unitId, position);
  return {
    next,
    placed: !next.units.find(unit => unit.id === selection.unitId && unit.side === selection.side)?.inStrategicReserves,
    action: {
      type: GAME_ACTION_TYPE.PlaceStrategicReserveUnit,
      side: selection.side,
      unitId: selection.unitId,
      position,
    },
  };
}
