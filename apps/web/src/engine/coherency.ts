import type { BattleUnit, Position } from '@warhammer-simulator/core/types/battle';
import { modelBaseRadiusInches } from './baseSizes';

export const COHERENCY_RANGE = 2;

export type CoherencyModel = {
  unit: BattleUnit;
  model: Position;
  modelIndex: number;
};

export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function coherencyDistanceForRadii(aRadius: number, bRadius: number): number {
  return aRadius + bRadius + COHERENCY_RANGE;
}

export function positionsAreWithinCoherency(
  a: Position,
  aRadius: number,
  b: Position,
  bRadius: number,
): boolean {
  return distance(a, b) <= coherencyDistanceForRadii(aRadius, bRadius);
}

export function requiredCoherencyNeighbors(totalModels: number): number {
  if (totalModels <= 1) return 0;
  return totalModels >= 6 ? 2 : 1;
}

export function coherentDistance(a: CoherencyModel, b: CoherencyModel): number {
  return coherencyDistanceForRadii(
    modelBaseRadiusInches(a.unit.profile, a.modelIndex),
    modelBaseRadiusInches(b.unit.profile, b.modelIndex),
  );
}

export function modelsAreCoherent(a: CoherencyModel, b: CoherencyModel): boolean {
  return distance(a.model, b.model) <= coherentDistance(a, b);
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

export function modelIndicesWithCoherencyIssues(models: CoherencyModel[]): Set<number> {
  const issues = new Set<number>();
  if (models.length <= 1) return issues;

  const requiredNeighbors = requiredCoherencyNeighbors(models.length);
  models.forEach((_, modelIndex) => {
    if (coherencyNeighborCount(models, modelIndex) < requiredNeighbors) issues.add(modelIndex);
  });

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

export function modelListIsCoherent(models: CoherencyModel[]): boolean {
  return modelIndicesWithCoherencyIssues(models).size === 0;
}
