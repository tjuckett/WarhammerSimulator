import type { BattleState, BattleUnit, Position, Terrain, TerrainFeature } from '../types/battle';

export interface MovementPathingContext {
  distance(from: Position, to: Position): number;
  verticalDistance(from: Position, to: Position): number;
  modelBaseRadius(unit: BattleUnit, modelIndex: number): number;
  takesToSkies(state: BattleState, unit: BattleUnit): boolean;
  isAircraft(unit: BattleUnit): boolean;
  unitHasRule(unit: BattleUnit, rule: string): boolean;
  unitHasKeyword(unit: BattleUnit, keyword: string): boolean;
  terrainBlocksMovement(terrain: Terrain, unit: BattleUnit): boolean;
  featureBlocksMovement(feature: TerrainFeature, terrain: Terrain, unit: BattleUnit): boolean;
  pointInTerrain(point: Position, terrain: Terrain | TerrainFeature): boolean;
  linePassesThroughTerrain(from: Position, to: Position, terrain: Terrain | TerrainFeature): boolean;
  terrainCorners(terrain: Terrain | TerrainFeature): Position[];
}

function moveToward(from: Position, to: Position, maxInches: number, distance: (a: Position, b: Position) => number, stopGap = 1.05): Position {
  const total = distance(from, to);
  const target = Math.max(0, total - stopGap);
  const step = Math.min(maxInches, target);
  if (step < 0.01) return from;
  const ratio = step / total;
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

export function findReachablePosition(
  unit: BattleUnit,
  to: Position,
  maxInches: number,
  terrain: Terrain[],
  context: MovementPathingContext,
  stopGap = 1.05,
  ignoreTerrain = false,
): Position {
  const direct = moveToward(unit.position, to, maxInches, context.distance, stopGap);
  const blocked = (from: Position, target: Position): boolean => {
    const crosses = (shape: Terrain | TerrainFeature) => {
      if (context.pointInTerrain(from, shape)) return false;
      if (context.pointInTerrain(target, shape)) return true;
      return context.linePassesThroughTerrain(from, target, shape);
    };
    return terrain.some(mat =>
      (context.terrainBlocksMovement(mat, unit) && crosses(mat))
      || mat.features.some(feature => context.featureBlocksMovement(feature, mat, unit) && crosses(feature)));
  };
  if (ignoreTerrain || !blocked(unit.position, direct)) return direct;
  const targetDistance = context.distance(unit.position, to);
  const corners = terrain.flatMap(mat => [
    ...(context.terrainBlocksMovement(mat, unit) ? context.terrainCorners(mat) : []),
    ...mat.features.flatMap(feature => context.featureBlocksMovement(feature, mat, unit) ? context.terrainCorners(feature) : []),
  ]);
  let best = unit.position;
  let bestScore = targetDistance;
  for (const corner of corners) {
    const away = context.distance(corner, unit.position);
    if (away < 0.01) continue;
    const waypoint = { x: corner.x + ((corner.x - unit.position.x) / away) * 1.25, y: corner.y + ((corner.y - unit.position.y) / away) * 1.25 };
    const firstLeg = context.distance(unit.position, waypoint);
    if (firstLeg > maxInches || blocked(unit.position, waypoint)) continue;
    const secondLeg = moveToward(waypoint, to, maxInches - firstLeg, context.distance, stopGap);
    if (blocked(waypoint, secondLeg)) continue;
    const score = context.distance(secondLeg, to);
    if (score < bestScore) { best = secondLeg; bestScore = score; }
  }
  if (best !== unit.position) return best;
  const steps = Math.max(4, Math.ceil(targetDistance / 0.5));
  let lastClear = unit.position;
  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    const candidate = { x: unit.position.x + (direct.x - unit.position.x) * ratio, y: unit.position.y + (direct.y - unit.position.y) * ratio };
    if (blocked(unit.position, candidate)) break;
    lastClear = candidate;
  }
  return lastClear;
}

export function distancePointToSegment(point: Position, from: Position, to: Position, context: MovementPathingContext): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) return context.distance(point, from);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq));
  return context.distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

export function pointSegmentProjectionT(point: Position, from: Position, to: Position): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) return 0;
  return Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq));
}

export function crossesEnemyModels(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  context: MovementPathingContext,
  includeFriendly = false,
): boolean {
  if (context.takesToSkies(state, movingUnit)) return false;
  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    const movingRadius = context.modelBaseRadius(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId) continue;
      if (otherUnit.id === movingUnit.id || (!includeFriendly && otherUnit.side === movingUnit.side)) continue;
      if (context.unitHasRule(movingUnit, 'Super-heavy Walker') && !context.unitHasKeyword(otherUnit, 'titanic')) continue;
      if (otherUnit.side !== movingUnit.side && context.isAircraft(otherUnit)) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (context.verticalDistance(from, otherUnit.modelPositions[otherModelIndex]) > 0.5) continue;
        const clearance = movingRadius + context.modelBaseRadius(otherUnit, otherModelIndex);
        if (distancePointToSegment(otherUnit.modelPositions[otherModelIndex], from, to, context) < clearance) return true;
      }
    }
  }
  return false;
}

export function enemyCrossingModelIndices(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  context: MovementPathingContext,
): number[] {
  const crossing: number[] = [];
  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    const movingRadius = context.modelBaseRadius(movingUnit, modelIndex);
    const crossesEnemy = state.units.some(otherUnit => {
      if (otherUnit.destroyed || otherUnit.side === movingUnit.side || context.isAircraft(otherUnit)) return false;
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
        if (context.verticalDistance(from, otherModel) > 0.5) return false;
        const clearance = movingRadius + context.modelBaseRadius(otherUnit, otherModelIndex);
        if (context.distance(otherModel, from) < clearance && context.distance(otherModel, to) < clearance) return false;
        if (pointSegmentProjectionT(otherModel, from, to) <= 0.05) return false;
        return distancePointToSegment(otherModel, from, to, context) < clearance;
      });
    });
    if (crossesEnemy) crossing.push(modelIndex);
  }
  return crossing;
}

export function crossesBlockingTerrain(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  context: MovementPathingContext,
): boolean {
  if (context.takesToSkies(state, movingUnit)) return false;
  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    for (const terrain of state.terrain) {
      if (context.terrainBlocksMovement(terrain, movingUnit)
        && !context.pointInTerrain(from, terrain)
        && (context.pointInTerrain(to, terrain) || context.linePassesThroughTerrain(from, to, terrain))) return true;
      for (const feature of terrain.features) {
        if (context.featureBlocksMovement(feature, terrain, movingUnit)
          && !context.pointInTerrain(from, feature)
          && (context.pointInTerrain(to, feature) || context.linePassesThroughTerrain(from, to, feature))) return true;
      }
    }
  }
  return false;
}

export function hasNoPathCollision(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  context: MovementPathingContext,
  options: { ignoreEnemyModelPath?: boolean } = {},
): boolean {
  return (options.ignoreEnemyModelPath || !crossesEnemyModels(state, movingUnit, movingIndices, dx, dy, context, true))
    && !crossesBlockingTerrain(state, movingUnit, movingIndices, dx, dy, context);
}
