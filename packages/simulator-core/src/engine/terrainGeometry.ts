import type { Position, Terrain, TerrainFeature } from '../types/battle';

type RectShape = Pick<Terrain | TerrainFeature, 'x' | 'y' | 'width' | 'height' | 'rotationDeg'>;

export function terrainCenter(t: RectShape): Position {
  return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
}

function rotatePoint(p: Position, origin: Position, deg: number): Position {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

export function rotatePointAround(point: Position, origin: Position, degrees: number): Position {
  return rotatePoint(point, origin, degrees);
}

export function moveFeature(feature: TerrainFeature, dx: number, dy: number): TerrainFeature {
  return { ...feature, x: feature.x + dx, y: feature.y + dy };
}

export function rotateFeatureAround(feature: TerrainFeature, origin: Position, degrees: number): TerrainFeature {
  const nextCenter = rotatePointAround(terrainCenter(feature), origin, degrees);
  return {
    ...feature,
    x: nextCenter.x - feature.width / 2,
    y: nextCenter.y - feature.height / 2,
    rotationDeg: (feature.rotationDeg ?? 0) + degrees,
  };
}

export function terrainCorners(t: RectShape): Position[] {
  const c = terrainCenter(t);
  const corners = [
    { x: t.x, y: t.y },
    { x: t.x + t.width, y: t.y },
    { x: t.x + t.width, y: t.y + t.height },
    { x: t.x, y: t.y + t.height },
  ];
  return corners.map(p => rotatePoint(p, c, t.rotationDeg ?? 0));
}

export function pointInTerrain(p: Position, t: RectShape): boolean {
  const c = terrainCenter(t);
  const local = rotatePoint(p, c, -(t.rotationDeg ?? 0));
  return local.x >= t.x && local.x <= t.x + t.width
    && local.y >= t.y && local.y <= t.y + t.height;
}

export function circleFullyInTerrain(p: Position, radius: number, t: RectShape): boolean {
  const c = terrainCenter(t);
  const local = rotatePoint(p, c, -(t.rotationDeg ?? 0));
  return local.x - radius >= t.x
    && local.x + radius <= t.x + t.width
    && local.y - radius >= t.y
    && local.y + radius <= t.y + t.height;
}

function ccw(a: Position, b: Position, c: Position): boolean {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

export function lineIntersectsTerrain(from: Position, to: Position, t: RectShape): boolean {
  if (pointInTerrain(from, t) || pointInTerrain(to, t)) return true;
  const corners = terrainCorners(t);
  return corners.some((corner, i) =>
    segmentsIntersect(from, to, corner, corners[(i + 1) % corners.length]),
  );
}

export function axisAlignedBoxIntersectsTerrain(
  x: number,
  y: number,
  hw: number,
  hh: number,
  t: RectShape,
): boolean {
  const boxCorners = [
    { x: x - hw, y: y - hh },
    { x: x + hw, y: y - hh },
    { x: x + hw, y: y + hh },
    { x: x - hw, y: y + hh },
  ];
  if (boxCorners.some(p => pointInTerrain(p, t))) return true;

  const terrainPoly = terrainCorners(t);
  if (terrainPoly.some(p => p.x >= x - hw && p.x <= x + hw && p.y >= y - hh && p.y <= y + hh)) {
    return true;
  }

  const boxEdges = boxCorners.map((corner, i) => [corner, boxCorners[(i + 1) % boxCorners.length]] as const);
  const terrainEdges = terrainPoly.map((corner, i) => [corner, terrainPoly[(i + 1) % terrainPoly.length]] as const);
  return boxEdges.some(([a, b]) => terrainEdges.some(([c, d]) => segmentsIntersect(a, b, c, d)));
}
