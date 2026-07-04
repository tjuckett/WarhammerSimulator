import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import {
  advancePlayUnit,
  completePlayUnitMovement,
  disembarkPlayUnit,
  embarkPlayUnit,
  fallBackPlayUnit,
  playUnitCanAdvance,
  playUnitCanEmbark,
  playUnitCanFallBack,
} from '@warhammer-simulator/core/engine/simulator';
import { unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';

export type PlayUnitSelection = {
  unitId: string;
  side: 0 | 1;
};

export type PlayDisembarkOption = {
  passengerUnitId?: string;
  armyUnitIndex?: number;
};

type MovementUnitAction = Extract<
  GameAction,
  | { type: typeof GAME_ACTION_TYPE.AdvanceUnit }
  | { type: typeof GAME_ACTION_TYPE.FallBackUnit }
  | { type: typeof GAME_ACTION_TYPE.CompleteUnitMovement }
  | { type: typeof GAME_ACTION_TYPE.EmbarkUnit }
>;

type DisembarkAction = Extract<GameAction, { type: typeof GAME_ACTION_TYPE.DisembarkUnit }>;

export function resolveAdvancePlayUnitAction(
  state: BattleState,
  selection: PlayUnitSelection,
  rules: RulesEdition,
): { next: BattleState; action: MovementUnitAction } | null {
  if (!playUnitCanAdvance(state, selection.unitId, selection.side, rules)) return null;
  const next = advancePlayUnit(state, selection.unitId, selection.side, rules);
  if (next === state) return null;
  return {
    next,
    action: {
      type: GAME_ACTION_TYPE.AdvanceUnit,
      unitId: selection.unitId,
      side: selection.side,
    },
  };
}

export function resolveFallBackPlayUnitAction(
  state: BattleState,
  selection: PlayUnitSelection,
  rules: RulesEdition,
): { next: BattleState; action: MovementUnitAction } | null {
  if (!playUnitCanFallBack(state, selection.unitId, selection.side, rules)) return null;
  const next = fallBackPlayUnit(state, selection.unitId, selection.side, rules);
  if (next === state) return null;
  return {
    next,
    action: {
      type: GAME_ACTION_TYPE.FallBackUnit,
      unitId: selection.unitId,
      side: selection.side,
    },
  };
}

export function resolveCompletePlayUnitMovementAction(
  state: BattleState,
  selection: PlayUnitSelection,
): { next: BattleState; action: MovementUnitAction } | null {
  const next = completePlayUnitMovement(state, selection.unitId, selection.side);
  if (next === state) return null;
  return {
    next,
    action: {
      type: GAME_ACTION_TYPE.CompleteUnitMovement,
      unitId: selection.unitId,
      side: selection.side,
    },
  };
}

export function resolveEmbarkPlayUnitAction(
  state: BattleState,
  selection: PlayUnitSelection,
): { next: BattleState; action: MovementUnitAction } | null {
  if (!playUnitCanEmbark(state, selection.unitId, selection.side)) return null;
  const next = embarkPlayUnit(state, selection.unitId, selection.side);
  if (next === state) return null;
  return {
    next,
    action: {
      type: GAME_ACTION_TYPE.EmbarkUnit,
      unitId: selection.unitId,
      side: selection.side,
    },
  };
}

export function resolveDisembarkPlayUnitAction(
  state: BattleState,
  selection: PlayUnitSelection,
  option: PlayDisembarkOption,
): { next: BattleState; action: DisembarkAction; disembarkedUnitId?: string } | null {
  const next = disembarkPlayUnit(state, selection.side, selection.unitId, option.passengerUnitId, option.armyUnitIndex);
  if (next === state) return null;

  const disembarkedUnit = option.passengerUnitId
    ? next.units.find(unit => unit.id === option.passengerUnitId && !unit.destroyed && !unit.embarkedInUnitId)
    : next.units.find(unit =>
      unit.side === selection.side
      && !unit.destroyed
      && !unit.embarkedInUnitId
      && typeof option.armyUnitIndex === 'number'
      && unitRosterId(unit.profile) === unitRosterId(next.armies[selection.side].army.units[option.armyUnitIndex]),
    );

  return {
    next,
    disembarkedUnitId: disembarkedUnit?.id,
    action: {
      type: GAME_ACTION_TYPE.DisembarkUnit,
      side: selection.side,
      transportUnitId: selection.unitId,
      passengerUnitId: option.passengerUnitId,
      armyUnitIndex: option.armyUnitIndex,
    },
  };
}
