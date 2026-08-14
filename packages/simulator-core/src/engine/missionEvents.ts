import type { BattleState, BattleUnit, DestroyedModelMissionEvent, Side } from '../types/battle';
import type { ModelStatProfile } from '../types/army';
import { battleRound } from './battleRound';
import { objectiveIndexesWithinRange, terrainAreaIdsContainingUnit, updateObjectiveControl } from './missionScoring';
import type { RulesEdition } from './rulesEngine';
import { terrainCenter } from './terrainGeometry';
import {
  attachedUnitComponents,
  attachedUnitId,
  attachedUnitKeywordSet,
  attachedUnitStartingStrength,
} from './attachedUnits';

export function startMissionEventsForNewTurn(state: BattleState, rules: RulesEdition): void {
  const objectives = updateObjectiveControl(state, rules);
  state.missionState = state.missionState ?? {};
  const condemnedUnitIds = state.missionState.condemnedUnitIds ?? [[], []];
  condemnedUnitIds[state.activeArmy] = [];
  state.missionState.condemnedUnitIds = condemnedUnitIds;
  state.missionEvents = {
    ...(state.missionEvents ?? {}),
    destroyedUnitsThisTurn: [],
    destroyedModelsThisTurn: [],
    unitsLeftBattlefieldThisTurn: [],
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
  objectiveIndexesWithinRangeAtCompletion?: number[],
): void {
  const completedAction = {
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
    ...(action.targetUnitId !== undefined
      ? { targetUnitId: action.targetUnitId }
      : {}),
    ...(objectiveIndexesWithinRangeAtCompletion !== undefined
      ? { objectiveIndexesWithinRange: [...objectiveIndexesWithinRangeAtCompletion] }
      : {}),
    battleRound: battleRound(state),
    turn: state.turn,
  };
  state.missionEvents = state.missionEvents ?? {};
  state.missionEvents.completedActionsThisTurn = [
    ...(state.missionEvents.completedActionsThisTurn ?? []),
    completedAction,
  ];

  if (action.id === 'cleanse' || action.id === 'plunder') {
    state.missionState = state.missionState ?? {};
    state.missionState.completedSecondaryActionsDuringBattle = [
      ...(state.missionState.completedSecondaryActionsDuringBattle ?? []),
      completedAction,
    ];
  }

  const objectiveMarkerAction = ['extract-intelligence', 'triangulate', 'consecrate', 'maintain-control', 'decoy', 'sabotage'].includes(action.id)
    && action.targetObjectiveIndex !== undefined;
  const terrainMarkerAction = action.id === 'booby-trap' && action.targetTerrainId !== undefined;
  if (!objectiveMarkerAction && !terrainMarkerAction) return;
  const targetTerrain = action.targetTerrainId === undefined
    ? undefined
    : state.terrain.find(terrain => terrain.id === action.targetTerrainId);
  const position = action.targetObjectiveIndex === undefined
    ? (targetTerrain ? terrainCenter(targetTerrain) : undefined)
    : state.objectives[action.targetObjectiveIndex];
  if (!position) return;

  state.missionState = state.missionState ?? {};
  const markers = state.missionState.operationMarkers ?? [];
  if (markers.some(marker =>
    marker.side === unit.side
    && marker.sourceActionId === action.id
    && (action.targetObjectiveIndex !== undefined
      ? marker.objectiveIndex === action.targetObjectiveIndex
      : marker.terrainId === action.targetTerrainId)
  )) return;

  const targetKey = action.targetObjectiveIndex ?? action.targetTerrainId;
  state.missionState.operationMarkers = [
    ...markers,
    {
      id: `operation-marker-${unit.side}-${action.id}-${targetKey}`,
      side: unit.side,
      sourceActionId: action.id,
      placedByUnitId: unit.id,
      ...(action.targetObjectiveIndex !== undefined ? { objectiveIndex: action.targetObjectiveIndex } : {}),
      ...(action.targetTerrainId !== undefined ? { terrainId: action.targetTerrainId } : {}),
      position: { ...position },
      battleRound: battleRound(state),
      turn: state.turn,
    },
  ];
}

export function completeMissionEventsForCurrentTurn(state: BattleState): void {
  const destroyedUnitCounts: [number, number] = [0, 0];
  const destroyingUnitIds = new Set<string>();
  for (const event of state.missionEvents?.destroyedUnitsThisTurn ?? []) {
    destroyedUnitCounts[event.side] += 1;
    if (event.destroyedByUnitId) destroyingUnitIds.add(event.destroyedByUnitId);
  }

  state.missionEvents = {
    ...(state.missionEvents ?? {}),
    lastCompletedTurn: {
      activeSide: state.activeArmy,
      battleRound: battleRound(state),
      turn: state.turn,
      destroyedUnitCounts,
      ...(destroyingUnitIds.size ? { destroyingUnitIds: [...destroyingUnitIds] } : {}),
    },
  };
}

export function recordUnitLeftBattlefieldMissionEvent(state: BattleState, unitId: string): void {
  state.missionEvents = state.missionEvents ?? {};
  const unitIds = state.missionEvents.unitsLeftBattlefieldThisTurn ?? [];
  if (!unitIds.includes(unitId)) {
    state.missionEvents.unitsLeftBattlefieldThisTurn = [...unitIds, unitId];
  }
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
  state.missionState = state.missionState ?? {};
  const attachmentId = attachedUnitId(unit);
  const components = attachedUnitComponents(state, unit, true);
  if (components.length > 1 && components.some(component => !component.destroyed && component.remainingModels > 0)) return;
  const destroyedUnitsThisTurn = state.missionEvents.destroyedUnitsThisTurn ?? [];
  if (destroyedUnitsThisTurn.some(event => event.unitId === attachmentId)) {
    state.missionEvents.destroyedUnitsThisTurn = destroyedUnitsThisTurn;
    return;
  }

  const event = {
      unitId: attachmentId,
      side: unit.side,
      unitName: components.map(component => component.profile.name).join(' + '),
      startingStrength: attachedUnitStartingStrength(state, unit),
      isCharacter: attachedUnitKeywordSet(state, unit, true).has('character'),
      destroyedBySide,
      ...(options.destroyedByUnitId ? { destroyedByUnitId: options.destroyedByUnitId } : {}),
      ...(options.destroyingUnitObjectiveIndexesWithinRange
        ? { destroyingUnitObjectiveIndexesWithinRange: [...options.destroyingUnitObjectiveIndexesWithinRange] }
        : {}),
      battleRound: battleRound(state),
      turn: state.turn,
      phase: state.phase,
    };
  state.missionEvents.destroyedUnitsThisTurn = [...destroyedUnitsThisTurn, event];
  const destroyedUnitsDuringBattle = state.missionState.destroyedUnitsDuringBattle ?? [];
  if (!destroyedUnitsDuringBattle.some(existing => existing.unitId === attachmentId)) {
    state.missionState.destroyedUnitsDuringBattle = [...destroyedUnitsDuringBattle, event];
  }
  recordUnitLeftBattlefieldMissionEvent(state, attachmentId);
}

function modelProfileAtRosterIndex(unit: BattleUnit, rosterModelIndex: number): ModelStatProfile | null {
  let offset = 0;
  for (const profile of unit.profile.modelProfiles ?? []) {
    if (rosterModelIndex < offset + profile.count) return profile;
    offset += profile.count;
  }
  return null;
}

export function recordDestroyedModelMissionEvents(
  state: BattleState,
  unit: BattleUnit,
  modelIndices: number[],
  destroyedBySide: Side,
  options: { destroyedByUnitId?: string } = {},
): void {
  if (!modelIndices.length) return;
  state.missionEvents = state.missionEvents ?? {};
  state.missionState = state.missionState ?? {};
  const destroyedModelsThisTurn = state.missionEvents.destroyedModelsThisTurn ?? [];
  const destroyedModelsDuringBattle = state.missionState.destroyedModelsDuringBattle ?? [];
  const isCharacter = unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'character');
  const events: DestroyedModelMissionEvent[] = modelIndices.map((modelIndex, eventIndex) => {
    const rosterModelIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const modelProfile = modelProfileAtRosterIndex(unit, rosterModelIndex);
    const sequence = destroyedModelsDuringBattle.filter(event => event.unitId === unit.id).length + eventIndex;
    return {
      id: `${unit.id}:destroyed-model:${sequence}`,
      unitId: unit.id,
      side: unit.side,
      unitName: unit.profile.name,
      modelName: modelProfile?.name ?? unit.profile.name,
      modelIndexAtDestruction: modelIndex,
      rosterModelIndex,
      woundsCharacteristic: modelProfile?.wounds ?? unit.profile.wounds,
      unitStartingStrength: attachedUnitStartingStrength(state, unit),
      isCharacter,
      destroyedBySide,
      ...(options.destroyedByUnitId ? { destroyedByUnitId: options.destroyedByUnitId } : {}),
      battleRound: battleRound(state),
      turn: state.turn,
      phase: state.phase,
    };
  });
  state.missionEvents.destroyedModelsThisTurn = [...destroyedModelsThisTurn, ...events];
  state.missionState.destroyedModelsDuringBattle = [...destroyedModelsDuringBattle, ...events];
}
