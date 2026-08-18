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
import { pointInTerrain, terrainCenter, terrainCorners } from './terrainGeometry';

export type BattlefieldEdge = 'top' | 'right' | 'bottom' | 'left';
export type TableQuarter = 0 | 1 | 2 | 3;
export type TerritoryRelation = 'friendly' | 'enemy' | 'both' | 'no-mans-land' | 'unclassified';

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  const cross = (point.y - start.y) * (end.x - start.x)
    - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 0.0001) return false;
  const dot = (point.x - start.x) * (end.x - start.x)
    + (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= lengthSquared;
}

function pointInPolygon(point: Position, polygon: Position[]): boolean {
  if (polygon.length < 3) return false;
  if (polygon.some((start, index) => pointOnSegment(point, start, polygon[(index + 1) % polygon.length]))) {
    return true;
  }
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonsIntersect(first: Position[], second: Position[]): boolean {
  if (first.length < 3 || second.length < 3) return false;
  if (first.some(point => pointInPolygon(point, second))
    || second.some(point => pointInPolygon(point, first))) return true;
  return first.some((start, index) => {
    const end = first[(index + 1) % first.length];
    return second.some((otherStart, otherIndex) =>
      segmentsIntersect(start, end, otherStart, second[(otherIndex + 1) % second.length])
    );
  });
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const cross = (first: Position, second: Position, third: Position) =>
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 0.0001;
  if (Math.abs(abC) <= epsilon && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= epsilon && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= epsilon && pointOnSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= epsilon && pointOnSegment(b, c, d)) return true;
  return ((abC > epsilon) !== (abD > epsilon))
    && ((cdA > epsilon) !== (cdB > epsilon));
}

export function pointWithinMissionTerritory(
  state: BattleState,
  point: Position,
  territorySide: Side,
): boolean | undefined {
  const territory = state.setup?.territoryZones?.sides[territorySide];
  if (!territory) return undefined;
  return territory.polygons.some(polygon => pointInPolygon(point, polygon));
}

export function terrainWithinMissionTerritory(
  state: BattleState,
  terrain: Terrain,
  territorySide: Side,
): boolean | undefined {
  if (!state.setup?.territoryZones) return undefined;
  const terrainPolygon = terrainCorners(terrain);
  return state.setup.territoryZones.sides[territorySide].polygons.some(territoryPolygon =>
    polygonsIntersect(terrainPolygon, territoryPolygon)
  );
}

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
  const friendly = pointWithinMissionTerritory(state, point, side);
  const enemy = pointWithinMissionTerritory(state, point, (1 - side) as Side);
  if (friendly !== undefined && enemy !== undefined) {
    if (friendly && !enemy) return 'friendly';
    if (enemy && !friendly) return 'enemy';
    if (!friendly && !enemy) return 'unclassified';
    return 'both';
  }
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
  return relations.every(relation => relation === expected || relation === 'both');
}

export function unitWhollyWithinMissionTerritory(
  state: BattleState,
  unit: BattleUnit,
  territorySide: Side,
): boolean | undefined {
  if (!state.setup?.territoryZones) return undefined;
  return unitWhollyWithinRegion(unit, point => pointWithinMissionTerritory(state, point, territorySide) === true);
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
  if (relations.some(relation => relation === 'friendly' || relation === 'both')) return true;
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
