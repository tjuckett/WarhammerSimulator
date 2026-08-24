import type { BattleUnit, Position } from '../types/battle';

export interface InteractiveMovementStateContext {
  modelRotation(unit: BattleUnit, modelIndex?: number): number;
  modelFootprint(unit: BattleUnit, modelIndex?: number, rotationDeg?: number): unknown;
  movementAllowanceForPlayMove(unit: BattleUnit): number;
  hasKeyword(unit: BattleUnit, keyword: string): boolean;
  verticalDistance(a: Position, b: Position): number;
  baseFootprintMaxPointDistance(
    from: Position,
    fromFootprint: unknown,
    to: Position,
    toFootprint: unknown,
  ): number;
}

export function ensureModelMovementStartPositions(unit: BattleUnit): Position[] {
  if (!unit.movementStartPositionsByModel || unit.movementStartPositionsByModel.length !== unit.modelPositions.length) {
    unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  }
  return unit.movementStartPositionsByModel;
}

export function ensureModelMovementStartRotations(unit: BattleUnit, context: InteractiveMovementStateContext): number[] {
  if (!unit.movementStartRotationsByModel || unit.movementStartRotationsByModel.length !== unit.modelPositions.length) {
    unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => context.modelRotation(unit, modelIndex));
  }
  return unit.movementStartRotationsByModel;
}

export function ensureModelMovementPaths(unit: BattleUnit): Position[][] {
  if (!unit.movementPathByModel || unit.movementPathByModel.length !== unit.modelPositions.length) {
    unit.movementPathByModel = unit.modelPositions.map(position => [{ ...position }]);
  }
  return unit.movementPathByModel;
}

export function appendModelMovementWaypoints(unit: BattleUnit, modelIndices: number[]): void {
  const paths = ensureModelMovementPaths(unit);
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    if (!position) continue;
    const path = paths[modelIndex] ?? (paths[modelIndex] = []);
    const previous = path[path.length - 1];
    if (!previous || Math.hypot(position.x - previous.x, position.y - previous.y) > 0.0001 || Math.abs((position.z ?? 0) - (previous.z ?? 0)) > 0.0001) {
      const beforePrevious = path[path.length - 2];
      if (beforePrevious) {
        const segmentX = previous.x - beforePrevious.x;
        const segmentY = previous.y - beforePrevious.y;
        const positionX = position.x - beforePrevious.x;
        const positionY = position.y - beforePrevious.y;
        const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
        const projection = segmentLengthSquared > 0.000001
          ? (positionX * segmentX + positionY * segmentY) / segmentLengthSquared
          : -1;
        const cross = Math.abs(positionX * segmentY - positionY * segmentX);
        const verticalOnSegment = Math.abs((position.z ?? 0) - (beforePrevious.z ?? 0)) <= 0.0001
          && Math.abs((previous.z ?? 0) - (beforePrevious.z ?? 0)) <= 0.0001;
        if (projection >= -0.0001 && projection <= 1.0001 && cross <= 0.0001 && verticalOnSegment) {
          path[path.length - 1] = { ...position };
          continue;
        }
      }
      path.push({ ...position });
    }
  }
}

export function ensureModelMovementAllowanceTotals(unit: BattleUnit, context: InteractiveMovementStateContext): number[] {
  const allowance = context.movementAllowanceForPlayMove(unit);
  if (!unit.movementAllowanceTotalByModel || unit.movementAllowanceTotalByModel.length !== unit.modelPositions.length) {
    unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => allowance);
  }
  return unit.movementAllowanceTotalByModel;
}

export function modelMovementDistanceFromStart(unit: BattleUnit, modelIndex: number, context: InteractiveMovementStateContext): number {
  const position = unit.modelPositions[modelIndex];
  const path = unit.movementPathByModel?.[modelIndex];
  if (path && path.length > 1) {
    let distance = 0;
    for (let index = 1; index < path.length; index++) {
      distance += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y)
        + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : context.verticalDistance(path[index - 1], path[index]));
    }
    const last = path[path.length - 1];
    if (Math.hypot(position.x - last.x, position.y - last.y) > 0.0001 || Math.abs((position.z ?? 0) - (last.z ?? 0)) > 0.0001) {
      distance += Math.hypot(position.x - last.x, position.y - last.y)
        + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : context.verticalDistance(last, position));
    }
    return distance;
  }
  const start = unit.movementStartPositionsByModel?.[modelIndex] ?? position;
  const startRotation = unit.movementStartRotationsByModel?.[modelIndex] ?? context.modelRotation(unit, modelIndex);
  const currentRotation = context.modelRotation(unit, modelIndex);
  const horizontal = context.baseFootprintMaxPointDistance(
    start,
    context.modelFootprint(unit, modelIndex, startRotation),
    position,
    context.modelFootprint(unit, modelIndex, currentRotation),
  );
  return horizontal + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : context.verticalDistance(start, position));
}

export function refreshModelMovementAllowances(unit: BattleUnit, context: InteractiveMovementStateContext): number[] {
  ensureModelMovementStartPositions(unit);
  ensureModelMovementStartRotations(unit, context);
  const totals = ensureModelMovementAllowanceTotals(unit, context);
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map((_, modelIndex) =>
    Math.max(0, (totals[modelIndex] ?? 0) - modelMovementDistanceFromStart(unit, modelIndex, context)),
  );
  unit.movementAllowanceRemaining = unit.movementAllowanceRemainingByModel.length
    ? Math.max(...unit.movementAllowanceRemainingByModel)
    : 0;
  return unit.movementAllowanceRemainingByModel;
}

export function updateModelMovementAllowances(unit: BattleUnit, context: InteractiveMovementStateContext): void {
  refreshModelMovementAllowances(unit, context);
}
