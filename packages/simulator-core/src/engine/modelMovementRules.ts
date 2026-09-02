import type { BattleUnit, Position } from '../types/battle';

export const MOVEMENT_RULE_EPSILON = 0.01;
// Pointer-driven collision endpoints can land a fraction of an inch short of
// the mathematical contact point. Keep this tolerance local to the
// base-contact interaction; it must not widen movement or Engagement Range.
export const BASE_CONTACT_EPSILON = 0.05;

export type ModelBaseEdgeDistance = (
  source: BattleUnit,
  sourceModelIndex: number,
  target: BattleUnit,
  targetModelIndex: number,
) => number;

export type ClosestModelPair = {
  target: BattleUnit;
  targetModelIndex: number;
  distance: number;
};

/** Returns a view of a unit with one model evaluated at a proposed position. */
export function unitWithModelAtPosition(
  unit: BattleUnit,
  modelIndex: number,
  position: Position,
): BattleUnit {
  return {
    ...unit,
    modelPositions: unit.modelPositions.map((current, index) => index === modelIndex ? position : current),
  };
}

export function modelDistanceAtPosition(
  unit: BattleUnit,
  modelIndex: number,
  position: Position,
  target: BattleUnit,
  targetModelIndex: number,
  modelBaseEdgeDistance: ModelBaseEdgeDistance,
): number {
  return modelBaseEdgeDistance(
    unitWithModelAtPosition(unit, modelIndex, position),
    modelIndex,
    target,
    targetModelIndex,
  );
}

/** Finds the closest model in any target unit using the supplied distance metric. */
export function closestModelPairToTargets(
  source: BattleUnit,
  sourceModelIndex: number,
  targets: BattleUnit[],
  modelBaseEdgeDistance: ModelBaseEdgeDistance,
): ClosestModelPair | null {
  let closest: ClosestModelPair | null = null;
  for (const target of targets) {
    for (let targetModelIndex = 0; targetModelIndex < target.modelPositions.length; targetModelIndex++) {
      const distance = modelBaseEdgeDistance(source, sourceModelIndex, target, targetModelIndex);
      if (!closest || distance < closest.distance) {
        closest = { target, targetModelIndex, distance };
      }
    }
  }
  return closest;
}

/** Finds the closest pair of models between two units using one distance metric. */
export function closestModelDistanceBetweenUnits(
  source: BattleUnit,
  target: BattleUnit,
  modelBaseEdgeDistance: ModelBaseEdgeDistance,
): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let sourceModelIndex = 0; sourceModelIndex < source.modelPositions.length; sourceModelIndex++) {
    const pair = closestModelPairToTargets(source, sourceModelIndex, [target], modelBaseEdgeDistance);
    if (pair) closest = Math.min(closest, pair.distance);
  }
  return closest;
}

export function closestModelDistanceToTargets(
  unit: BattleUnit,
  modelIndex: number,
  position: Position,
  targets: BattleUnit[],
  modelBaseEdgeDistance: ModelBaseEdgeDistance,
): number {
  return closestModelPairToTargets(
    unitWithModelAtPosition(unit, modelIndex, position),
    modelIndex,
    targets,
    modelBaseEdgeDistance,
  )?.distance ?? Number.POSITIVE_INFINITY;
}

export function modelPositionChanged(start: Position | undefined, current: Position | undefined): boolean {
  if (!start || !current) return false;
  return Math.hypot(
    current.x - start.x,
    current.y - start.y,
    (current.z ?? 0) - (start.z ?? 0),
  ) > MOVEMENT_RULE_EPSILON;
}

/** Whether a model could reach a distance using its movement allowance still available. */
export function canReachModelDistance(
  currentDistance: number,
  remainingAllowance: number,
  requiredDistance: number,
): boolean {
  return currentDistance <= requiredDistance + MOVEMENT_RULE_EPSILON
    || currentDistance - Math.max(0, remainingAllowance) <= requiredDistance + MOVEMENT_RULE_EPSILON;
}
