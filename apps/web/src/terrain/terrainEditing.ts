import type { Position, Terrain, TerrainFeature } from '@warhammer-simulator/core/types/battle';
import { moveFeature, rotateFeatureAround, terrainCenter, terrainCorners } from '@warhammer-simulator/core/engine/terrainGeometry';
import type { TerrainEditSelection } from '../components/Battlefield';

export type AlignVertexLock = {
  selection: TerrainEditSelection;
  vertexIndex: number;
  target: Position;
};

export function sameSelection(a: TerrainEditSelection, b: TerrainEditSelection): boolean {
  return a.kind === b.kind
    && a.terrainIndex === b.terrainIndex
    && (a.kind === 'terrain' || b.kind === 'terrain' || a.featureIndex === b.featureIndex);
}

export function cleanNumber(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function cross(a: Position, b: Position, c: Position): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function convexHull(points: Position[]): Position[] {
  const sorted = [...points]
    .map(point => ({ x: cleanNumber(point.x), y: cleanNumber(point.y) }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, list) => index === 0 || point.x !== list[index - 1].x || point.y !== list[index - 1].y);
  if (sorted.length <= 3) return sorted;

  const lower: Position[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  const upper: Position[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function itemSnapStep(selection: TerrainEditSelection, item: Pick<Terrain | TerrainFeature, 'width' | 'height'>): number {
  return selection.kind === 'feature'
    ? Math.min(1, item.width, item.height)
    : 1;
}

export function snappedPoint(point: Position, step: number, snap: boolean): Position {
  if (!snap) return point;
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
  };
}

export function snapItemVertexToGrid<T extends Terrain | TerrainFeature>(item: T, vertexIndex = 0): T {
  const corners = terrainCorners(item);
  const corner = corners[vertexIndex] ?? corners[0];
  if (!corner) return item;
  return {
    ...item,
    x: cleanNumber(item.x + Math.round(corner.x) - corner.x),
    y: cleanNumber(item.y + Math.round(corner.y) - corner.y),
  };
}

export function translateItem<T extends Terrain | TerrainFeature>(item: T, vertexIndex: number, target: Position): T {
  const corner = terrainCorners(item)[vertexIndex];
  return { ...item, x: item.x + target.x - corner.x, y: item.y + target.y - corner.y };
}

export function rotateItemToSecondVertex<T extends Terrain | TerrainFeature>(
  item: T,
  lock: AlignVertexLock,
  secondVertexIndex: number,
  secondTarget: Position,
): T {
  const corners = terrainCorners(item);
  const lockedCorner = corners[lock.vertexIndex];
  const secondCorner = corners[secondVertexIndex];
  const currentAngle = Math.atan2(secondCorner.y - lockedCorner.y, secondCorner.x - lockedCorner.x);
  const targetAngle = Math.atan2(secondTarget.y - lock.target.y, secondTarget.x - lock.target.x);
  const rotationDeg = (item.rotationDeg ?? 0) + ((targetAngle - currentAngle) * 180) / Math.PI;
  const rotated = { ...item, rotationDeg };
  const rotatedLockedCorner = terrainCorners(rotated)[lock.vertexIndex];
  return {
    ...rotated,
    x: rotated.x + lock.target.x - rotatedLockedCorner.x,
    y: rotated.y + lock.target.y - rotatedLockedCorner.y,
  };
}

export function translateTerrainWithFeatures(terrain: Terrain, vertexIndex: number, target: Position): Terrain {
  const nextTerrain = translateItem(terrain, vertexIndex, target);
  const dx = nextTerrain.x - terrain.x;
  const dy = nextTerrain.y - terrain.y;
  return {
    ...nextTerrain,
    features: terrain.features.map(feature => moveFeature(feature, dx, dy)),
  };
}

export function rotateTerrainToSecondVertex(
  terrain: Terrain,
  lock: AlignVertexLock,
  secondVertexIndex: number,
  secondTarget: Position,
): Terrain {
  const corners = terrainCorners(terrain);
  const lockedCorner = corners[lock.vertexIndex];
  const secondCorner = corners[secondVertexIndex];
  const currentAngle = Math.atan2(secondCorner.y - lockedCorner.y, secondCorner.x - lockedCorner.x);
  const targetAngle = Math.atan2(secondTarget.y - lock.target.y, secondTarget.x - lock.target.x);
  const rotationDelta = ((targetAngle - currentAngle) * 180) / Math.PI;
  const rotationOrigin = terrainCenter(terrain);
  const rotatedTerrain = { ...terrain, rotationDeg: (terrain.rotationDeg ?? 0) + rotationDelta };
  const rotatedLockedCorner = terrainCorners(rotatedTerrain)[lock.vertexIndex];
  const dx = lock.target.x - rotatedLockedCorner.x;
  const dy = lock.target.y - rotatedLockedCorner.y;

  return {
    ...rotatedTerrain,
    x: rotatedTerrain.x + dx,
    y: rotatedTerrain.y + dy,
    features: terrain.features
      .map(feature => rotateFeatureAround(feature, rotationOrigin, rotationDelta))
      .map(feature => moveFeature(feature, dx, dy)),
  };
}
