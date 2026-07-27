import type { BattleState, BattleUnit, Side } from '../types/battle';
import { battleRound } from './battleRound';
import { objectiveIndexesWithinRange, terrainAreaIdsContainingUnit, updateObjectiveControl } from './missionScoring';
import type { RulesEdition } from './rulesEngine';

export function startMissionEventsForNewTurn(state: BattleState, rules: RulesEdition): void {
  const objectives = updateObjectiveControl(state, rules);
  state.missionEvents = {
    ...(state.missionEvents ?? {}),
    destroyedUnitsThisTurn: [],
    completedActionsThisTurn: [],
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
          terrainAreaIds: terrainAreaIdsContainingUnit(state, unit),
        })),
    },
  };
}

export function recordCompletedMissionAction(
  state: BattleState,
  unit: BattleUnit,
  action: NonNullable<BattleUnit['performingAction']>,
): void {
  state.missionEvents = state.missionEvents ?? {};
  state.missionEvents.completedActionsThisTurn = [
    ...(state.missionEvents.completedActionsThisTurn ?? []),
    {
      actionId: action.id,
      actionName: action.name,
      side: unit.side,
      unitId: unit.id,
      unitName: unit.profile.name,
      ...(action.targetObjectiveIndex !== undefined
        ? { targetObjectiveIndex: action.targetObjectiveIndex }
        : {}),
      ...(action.targetTerrainId !== undefined
        ? { targetTerrainId: action.targetTerrainId }
        : {}),
      ...(action.targetOperationMarkerId !== undefined
        ? { targetOperationMarkerId: action.targetOperationMarkerId }
        : {}),
      battleRound: battleRound(state),
      turn: state.turn,
    },
  ];

  if (!['extract-intelligence', 'triangulate', 'consecrate', 'maintain-control', 'decoy', 'sabotage'].includes(action.id) || action.targetObjectiveIndex === undefined) return;
  const position = state.objectives[action.targetObjectiveIndex];
  if (!position) return;

  state.missionState = state.missionState ?? {};
  const markers = state.missionState.operationMarkers ?? [];
  if (markers.some(marker =>
    marker.side === unit.side
    && marker.sourceActionId === action.id
    && marker.objectiveIndex === action.targetObjectiveIndex
  )) return;

  state.missionState.operationMarkers = [
    ...markers,
    {
      id: `operation-marker-${unit.side}-${action.id}-${action.targetObjectiveIndex}`,
      side: unit.side,
      sourceActionId: action.id,
      placedByUnitId: unit.id,
      objectiveIndex: action.targetObjectiveIndex,
      position: { ...position },
      battleRound: battleRound(state),
      turn: state.turn,
    },
  ];
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
