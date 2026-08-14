import { boardFormatForState } from '../data/boardFormats';
import { DEPLOYMENT_ZONE_SETS } from '../data/deploymentZones';
import type { BattleState, BattleUnit, Position, Side, Terrain } from '../types/battle';
import {
  baseFootprintDistance,
  baseFootprintWithinRect,
  footprintBoundaryPoints,
  modelBaseFootprintInches,
} from './baseSizes';
import { pointInDeploymentZone, zoneFor, type DeploymentZone } from './deployment';
import { pointInTerrain } from './terrainGeometry';

export type BattlefieldEdge = 'top' | 'right' | 'bottom' | 'left';
export type TableQuarter = 0 | 1 | 2 | 3;
export type TerritoryRelation = 'friendly' | 'enemy' | 'no-mans-land' | 'unclassified';

function modelFootprint(unit: BattleUnit, modelIndex: number) {
  return modelBaseFootprintInches(
    unit.profile,
    modelIndex,
    unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0,
  );
}

function modelTestPoints(unit: BattleUnit, modelIndex: number): Position[] {
  const position = unit.modelPositions[modelIndex];
  if (!position) return [];
  return [position, ...footprintBoundaryPoints(position, modelFootprint(unit, modelIndex))];
}

export function missionDeploymentZone(state: BattleState, side: Side): DeploymentZone | undefined {
  const source = state.setup?.deploymentZones
    ?? DEPLOYMENT_ZONE_SETS.find(set => set.deployment === state.setup?.deployment);
  return source ? zoneFor(side, source, boardFormatForState(state)) : undefined;
}

export function unitWhollyWithinRegion(
  unit: BattleUnit,
  pointIsInside: (point: Position) => boolean,
): boolean {
  return unit.modelPositions.length > 0
    && unit.modelPositions.every((_position, modelIndex) =>
      modelTestPoints(unit, modelIndex).every(pointIsInside)
    );
}

export function unitWhollyWithinDeploymentZone(
  state: BattleState,
  unit: BattleUnit,
  zoneSide: Side,
): boolean | undefined {
  const zone = missionDeploymentZone(state, zoneSide);
  return zone ? unitWhollyWithinRegion(unit, point => pointInDeploymentZone(point, zone)) : undefined;
}

export function unitWithinDeploymentZone(
  state: BattleState,
  unit: BattleUnit,
  zoneSide: Side,
): boolean | undefined {
  const zone = missionDeploymentZone(state, zoneSide);
  return zone
    ? unit.modelPositions.some((_position, modelIndex) =>
        modelTestPoints(unit, modelIndex).some(point => pointInDeploymentZone(point, zone))
      )
    : undefined;
}

export function unitWhollyWithinNoMansLand(
  state: BattleState,
  unit: BattleUnit,
): boolean | undefined {
  const firstZone = missionDeploymentZone(state, 0);
  const secondZone = missionDeploymentZone(state, 1);
  if (!firstZone || !secondZone) return undefined;
  const board = boardFormatForState(state);
  return unitWhollyWithinRegion(unit, point =>
    point.x >= 0
    && point.x <= board.width
    && point.y >= 0
    && point.y <= board.height
    && !pointInDeploymentZone(point, firstZone)
    && !pointInDeploymentZone(point, secondZone)
  );
}

export function battlefieldCentre(state: BattleState): Position {
  const board = boardFormatForState(state);
  return { x: board.width / 2, y: board.height / 2 };
}

export function unitWithinBattlefieldCentre(
  state: BattleState,
  unit: BattleUnit,
  range: number,
): boolean {
  const centre = battlefieldCentre(state);
  const pointFootprint = { shape: 'circle' as const, radius: 0 };
  return unit.modelPositions.some((position, modelIndex) =>
    baseFootprintDistance(position, modelFootprint(unit, modelIndex), centre, pointFootprint) <= range
  );
}

export function unitTableQuarter(state: BattleState, unit: BattleUnit): TableQuarter | undefined {
  if (!unit.modelPositions.length) return undefined;
  const board = boardFormatForState(state);
  const halfWidth = board.width / 2;
  const halfHeight = board.height / 2;
  const quarters = [
    { x: 0, y: 0, width: halfWidth, height: halfHeight },
    { x: halfWidth, y: 0, width: halfWidth, height: halfHeight },
    { x: 0, y: halfHeight, width: halfWidth, height: halfHeight },
    { x: halfWidth, y: halfHeight, width: halfWidth, height: halfHeight },
  ];
  const quarter = quarters.findIndex(rect =>
    unit.modelPositions.every((position, modelIndex) =>
      baseFootprintWithinRect(position, modelFootprint(unit, modelIndex), rect)
    )
  );
  return quarter < 0 ? undefined : quarter as TableQuarter;
}

export function battlefieldEdgesWithinRange(
  state: BattleState,
  unit: BattleUnit,
  range: number,
): BattlefieldEdge[] {
  const board = boardFormatForState(state);
  const edges = new Set<BattlefieldEdge>();
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    for (const point of modelTestPoints(unit, modelIndex)) {
      if (point.y <= range) edges.add('top');
      if (board.width - point.x <= range) edges.add('right');
      if (board.height - point.y <= range) edges.add('bottom');
      if (point.x <= range) edges.add('left');
    }
  }
  return ['top', 'right', 'bottom', 'left'].filter(edge => edges.has(edge as BattlefieldEdge)) as BattlefieldEdge[];
}

export function battlefieldEdgesAreOpposite(a: BattlefieldEdge, b: BattlefieldEdge): boolean {
  return (a === 'top' && b === 'bottom')
    || (a === 'bottom' && b === 'top')
    || (a === 'left' && b === 'right')
    || (a === 'right' && b === 'left');
}

export function terrainTerritoryRelation(terrain: Terrain, side: Side): TerritoryRelation {
  if (terrain.objectiveRole === `home-${side}` || terrain.objectiveRole === `expansion-${side}`) return 'friendly';
  if (terrain.objectiveRole === `home-${1 - side}` || terrain.objectiveRole === `expansion-${1 - side}`) return 'enemy';
  if (terrain.objectiveRole === 'no-mans-land' || terrain.objectiveRole === 'central') return 'no-mans-land';
  return 'unclassified';
}

export function territoryRelationForPoint(
  state: BattleState,
  point: Position,
  side: Side,
): TerritoryRelation {
  const terrain = state.terrain
    .filter(candidate => pointInTerrain(point, candidate))
    .sort((a, b) => (a.width * a.height) - (b.width * b.height))
    .find(candidate => terrainTerritoryRelation(candidate, side) !== 'unclassified');
  return terrain ? terrainTerritoryRelation(terrain, side) : 'unclassified';
}

function unitWhollyWithinTerritoryRelation(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  expected: TerritoryRelation,
): boolean | undefined {
  if (!unit.modelPositions.length) return false;
  const relations = unit.modelPositions.flatMap((_position, modelIndex) =>
    modelTestPoints(unit, modelIndex).map(point => territoryRelationForPoint(state, point, side))
  );
  if (relations.some(relation => relation === 'unclassified')) return undefined;
  return relations.every(relation => relation === expected);
}

export function unitWhollyWithinFriendlyTerritory(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
): boolean | undefined {
  return unitWhollyWithinTerritoryRelation(state, unit, side, 'friendly');
}

export function unitWithinFriendlyTerritory(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
): boolean | undefined {
  if (!unit.modelPositions.length) return false;
  const relations = unit.modelPositions.flatMap((_position, modelIndex) =>
    modelTestPoints(unit, modelIndex).map(point => territoryRelationForPoint(state, point, side))
  );
  if (relations.some(relation => relation === 'friendly')) return true;
  return relations.some(relation => relation === 'unclassified') ? undefined : false;
}

export function unitWhollyWithinEnemyTerritory(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
): boolean | undefined {
  return unitWhollyWithinTerritoryRelation(state, unit, side, 'enemy');
}

export function objectiveRoleForIndex(
  state: BattleState,
  objectiveIndex: number,
): Terrain['objectiveRole'] | undefined {
  const objective = state.objectives[objectiveIndex];
  if (!objective) return undefined;
  return state.terrain
    .filter(terrain => pointInTerrain(objective, terrain))
    .sort((a, b) => (a.width * a.height) - (b.width * b.height))[0]
    ?.objectiveRole;
}

export function expansionObjectiveIndexes(state: BattleState, side?: Side): number[] {
  return state.objectives.flatMap((_objective, objectiveIndex) => {
    const role = objectiveRoleForIndex(state, objectiveIndex);
    if (role === 'expansion-0' && (side === undefined || side === 0)) return [objectiveIndex];
    if (role === 'expansion-1' && (side === undefined || side === 1)) return [objectiveIndex];
    return [];
  });
}

export function unitWhollyWithinTerrainArea(
  state: BattleState,
  unit: BattleUnit,
  terrainId: string,
): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  return !!terrain && unitWhollyWithinRegion(unit, point => pointInTerrain(point, terrain));
}
