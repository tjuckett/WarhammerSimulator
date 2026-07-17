import type { BattleState, BattleUnit, Side } from '../types/battle';
import { battleRound } from './battleRound';
import { objectiveIndexesWithinRange, updateObjectiveControl } from './missionScoring';
import type { RulesEdition } from './rulesEngine';

export function startMissionEventsForNewTurn(state: BattleState, rules: RulesEdition): void {
  const objectives = updateObjectiveControl(state, rules);
  state.missionEvents = {
    ...(state.missionEvents ?? {}),
    destroyedUnitsThisTurn: [],
    startOfTurn: {
      activeSide: state.activeArmy,
      battleRound: battleRound(state),
      turn: state.turn,
      objectiveOwners: objectives?.map(objective => objective.owner) ?? [...state.objectiveOwners],
      units: state.units
        .filter(unit => !unit.destroyed && !unit.embarkedInUnitId && !unit.inStrategicReserves && unit.modelPositions.length > 0)
        .map(unit => ({
          unitId: unit.id,
          side: unit.side,
          unitName: unit.profile.name,
          remainingModels: unit.remainingModels,
          modelPositions: unit.modelPositions.map(position => ({ ...position })),
          objectiveIndexesWithinRange: objectiveIndexesWithinRange(state, unit, rules),
        })),
    },
  };
}

export function completeMissionEventsForCurrentTurn(state: BattleState): void {
  const destroyedUnitCounts: [number, number] = [0, 0];
  for (const event of state.missionEvents?.destroyedUnitsThisTurn ?? []) {
    destroyedUnitCounts[event.side] += 1;
  }

  state.missionEvents = {
    ...(state.missionEvents ?? {}),
    lastCompletedTurn: {
      activeSide: state.activeArmy,
      battleRound: battleRound(state),
      turn: state.turn,
      destroyedUnitCounts,
    },
  };
}

export function recordDestroyedUnitMissionEvent(
  state: BattleState,
  unit: BattleUnit,
  destroyedBySide: Side,
  options: {
    destroyedByUnitId?: string;
    destroyingUnitObjectiveIndexesWithinRange?: number[];
  } = {},
): void {
  state.missionEvents = state.missionEvents ?? {};
  const destroyedUnitsThisTurn = state.missionEvents.destroyedUnitsThisTurn ?? [];
  if (destroyedUnitsThisTurn.some(event => event.unitId === unit.id)) {
    state.missionEvents.destroyedUnitsThisTurn = destroyedUnitsThisTurn;
    return;
  }

  state.missionEvents.destroyedUnitsThisTurn = [
    ...destroyedUnitsThisTurn,
    {
      unitId: unit.id,
      side: unit.side,
      unitName: unit.profile.name,
      destroyedBySide,
      ...(options.destroyedByUnitId ? { destroyedByUnitId: options.destroyedByUnitId } : {}),
      ...(options.destroyingUnitObjectiveIndexesWithinRange
        ? { destroyingUnitObjectiveIndexesWithinRange: [...options.destroyingUnitObjectiveIndexesWithinRange] }
        : {}),
      battleRound: battleRound(state),
      turn: state.turn,
      phase: state.phase,
    },
  ];
}
