import type { BattleUnit, Position } from '../types/battle';
import { baseFootprintDistance, footprintBoundingRadius, modelBaseFootprintForUnit, modelBaseRadiusForUnit, type ModelBaseFootprint } from './baseSizes';

export const COHERENCY_RANGE = 2;
export const COHERENCY_MAX_PAIR_RANGE = 9;
export const COHERENCY_VERTICAL_RANGE = 5;
export type CoherencyEdition = '10e' | '11e';

export type CoherencyModel = {
  unit: BattleUnit;
  model: Position;
  modelIndex: number;
};

export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function verticalDistance(a: Position, b: Position): number {
  return Math.abs((a.z ?? 0) - (b.z ?? 0));
}

export function modelBaseEdgeDistance3d(
  aModel: Position,
  aFootprint: ModelBaseFootprint,
  bModel: Position,
  bFootprint: ModelBaseFootprint,
): number {
  return Math.hypot(baseFootprintDistance(aModel, aFootprint, bModel, bFootprint), verticalDistance(aModel, bModel));
}

export function modelBaseEdgeHorizontalDistance(
  aUnit: BattleUnit,
  aModelIndex: number,
  bUnit: BattleUnit,
  bModelIndex: number,
): number {
  return baseFootprintDistance(
    aUnit.modelPositions[aModelIndex],
    modelBaseFootprintForUnit(aUnit, aModelIndex),
    bUnit.modelPositions[bModelIndex],
    modelBaseFootprintForUnit(bUnit, bModelIndex),
  );
}

export function unitsInEngagementRange(unit: BattleUnit, others: BattleUnit[], range: number): boolean {
  return others.some(other => unit.modelPositions.some((unitModel, unitModelIndex) => {
    const unitFootprint = modelBaseFootprintForUnit(unit, unitModelIndex);
    const unitRadius = footprintBoundingRadius(unitFootprint);
    return other.modelPositions.some((otherModel, otherModelIndex) => {
      if (verticalDistance(unitModel, otherModel) > COHERENCY_VERTICAL_RANGE) return false;
      const otherFootprint = modelBaseFootprintForUnit(other, otherModelIndex);
      const maximumCentreDistance = range + unitRadius + footprintBoundingRadius(otherFootprint);
      const dx = unitModel.x - otherModel.x;
      const dy = unitModel.y - otherModel.y;
      // Exact oval/rectangle distance is comparatively expensive. If their
      // containing circles cannot reach engagement range, it cannot change
      // the outcome and we can reject the pair without polygon work.
      if (dx * dx + dy * dy > maximumCentreDistance * maximumCentreDistance) return false;
      return baseFootprintDistance(unitModel, unitFootprint, otherModel, otherFootprint) <= range;
    });
  }));
}

export function coherencyDistanceForRadii(aRadius: number, bRadius: number): number {
  return aRadius + bRadius + COHERENCY_RANGE;
}

export function maximumCoherencyDistanceForRadii(aRadius: number, bRadius: number): number {
  return aRadius + bRadius + COHERENCY_MAX_PAIR_RANGE;
}

export function positionsAreWithinCoherency(
  a: Position,
  aRadius: number,
  b: Position,
  bRadius: number,
): boolean {
  return distance(a, b) <= coherencyDistanceForRadii(aRadius, bRadius)
    && verticalDistance(a, b) <= COHERENCY_VERTICAL_RANGE;
}

export function requiredCoherencyNeighbors(totalModels: number): number {
  if (totalModels <= 1) return 0;
  return totalModels >= 6 ? 2 : 1;
}

export function coherentDistance(a: CoherencyModel, b: CoherencyModel): number {
  return coherencyDistanceForRadii(
    modelBaseRadiusForUnit(a.unit, a.modelIndex),
    modelBaseRadiusForUnit(b.unit, b.modelIndex),
  );
}

export function modelsAreCoherent(a: CoherencyModel, b: CoherencyModel): boolean {
  return distance(a.model, b.model) <= coherentDistance(a, b)
    && verticalDistance(a.model, b.model) <= COHERENCY_VERTICAL_RANGE;
}

export function coherencyNeighborCount(models: CoherencyModel[], modelIndex: number): number {
  let neighbors = 0;
  for (let otherIndex = 0; otherIndex < models.length; otherIndex++) {
    if (otherIndex === modelIndex) continue;
    if (modelsAreCoherent(models[modelIndex], models[otherIndex])) neighbors++;
  }
  return neighbors;
}

function coherentComponents(models: CoherencyModel[]): number[][] {
  const components: number[][] = [];
  const visited = new Set<number>();

  for (let startIndex = 0; startIndex < models.length; startIndex++) {
    if (visited.has(startIndex)) continue;
    const component: number[] = [];
    const queue = [startIndex];
    visited.add(startIndex);

    while (queue.length) {
      const currentIndex = queue.shift()!;
      component.push(currentIndex);
      models.forEach((candidate, candidateIndex) => {
        if (visited.has(candidateIndex)) return;
        if (!modelsAreCoherent(models[currentIndex], candidate)) return;
        visited.add(candidateIndex);
        queue.push(candidateIndex);
      });
    }

    components.push(component);
  }

  return components;
}

export function modelIndicesWithCoherencyIssues(models: CoherencyModel[], edition: CoherencyEdition = '10e'): Set<number> {
  const issues = new Set<number>();
  if (models.length <= 1) return issues;

  const requiredNeighbors = requiredCoherencyNeighbors(models.length);
  models.forEach((_, modelIndex) => {
    if (coherencyNeighborCount(models, modelIndex) < requiredNeighbors) issues.add(modelIndex);
  });

  if (edition === '11e') {
    models.forEach((model, modelIndex) => {
      models.forEach((other, otherIndex) => {
        if (modelIndex === otherIndex || issues.has(modelIndex)) return;
        if (distance(model.model, other.model) > maximumCoherencyDistanceForRadii(
          modelBaseRadiusForUnit(model.unit, model.modelIndex),
          modelBaseRadiusForUnit(other.unit, other.modelIndex),
        ) || verticalDistance(model.model, other.model) > COHERENCY_VERTICAL_RANGE) {
          issues.add(modelIndex);
        }
      });
    });
  }

  const components = coherentComponents(models);
  if (components.length > 1) {
    const largestComponent = components.reduce((best, component) =>
      component.length > best.length ? component : best,
    );
    const keep = new Set(largestComponent);
    components.flat().forEach(modelIndex => {
      if (!keep.has(modelIndex)) issues.add(modelIndex);
    });
  }

  return issues;
}

export function modelListIsCoherent(models: CoherencyModel[], edition: CoherencyEdition = '10e'): boolean {
  return modelIndicesWithCoherencyIssues(models, edition).size === 0;
}
