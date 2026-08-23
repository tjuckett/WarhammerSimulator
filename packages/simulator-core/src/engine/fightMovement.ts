import type { BattleState, BattleUnit, Position } from '../types/battle';

export interface FightMovementContext {
  enemies(state: BattleState, side: 0 | 1): BattleUnit[];
  modelBaseEdgeHorizontalDistance(unit: BattleUnit, modelIndex: number, target: BattleUnit, targetModelIndex: number): number;
  modelBaseRadius(unit: BattleUnit, modelIndex: number): number;
  centroid(positions: Position[]): Position;
  distance(a: Position, b: Position): number;
}

export function closestEnemyModelFor(
  unit: BattleUnit,
  modelIndex: number,
  state: BattleState,
  context: FightMovementContext,
): { unit: BattleUnit; modelIndex: number; distance: number } | null {
  let closest: { unit: BattleUnit; modelIndex: number; distance: number } | null = null;
  for (const enemy of context.enemies(state, unit.side)) {
    for (let enemyModelIndex = 0; enemyModelIndex < enemy.modelPositions.length; enemyModelIndex++) {
      const distance = context.modelBaseEdgeHorizontalDistance(unit, modelIndex, enemy, enemyModelIndex);
      if (!closest || distance < closest.distance) closest = { unit: enemy, modelIndex: enemyModelIndex, distance };
    }
  }
  return closest;
}

export function nearestObjectiveToModel(model: Position, state: BattleState, context: FightMovementContext): Position | null {
  if (!state.objectives.length) return null;
  return state.objectives.reduce((best, objective) =>
    context.distance(model, objective) < context.distance(model, best) ? objective : best,
  );
}

export function moveModelTowardPoint(
  unit: BattleUnit,
  modelIndex: number,
  point: Position,
  maxDistance: number,
  context: FightMovementContext,
  stopGap = 0,
): boolean {
  const model = unit.modelPositions[modelIndex];
  if (!model) return false;
  const dx = point.x - model.x;
  const dy = point.y - model.y;
  const distance = Math.hypot(dx, dy);
  const moveDistance = Math.min(maxDistance, Math.max(0, distance - stopGap));
  if (distance < 0.001 || moveDistance < 0.001) return false;
  unit.modelPositions[modelIndex] = {
    ...model,
    x: model.x + (dx / distance) * moveDistance,
    y: model.y + (dy / distance) * moveDistance,
  };
  unit.position = context.centroid(unit.modelPositions);
  return true;
}

export function moveModelTowardEnemy(
  unit: BattleUnit,
  modelIndex: number,
  state: BattleState,
  maxDistance: number,
  context: FightMovementContext,
): boolean {
  const closest = closestEnemyModelFor(unit, modelIndex, state, context);
  if (!closest) return false;
  const targetModel = closest.unit.modelPositions[closest.modelIndex];
  const myRadius = context.modelBaseRadius(unit, modelIndex);
  const targetRadius = context.modelBaseRadius(closest.unit, closest.modelIndex);
  return moveModelTowardPoint(unit, modelIndex, targetModel, maxDistance, context, myRadius + targetRadius + 0.02);
}
