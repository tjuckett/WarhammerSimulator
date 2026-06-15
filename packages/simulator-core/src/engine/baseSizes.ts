import type { ModelBase, UnitProfile } from '../types/army';
import type { BattleUnit } from '../types/battle';

const MM_PER_INCH = 25.4;

export type ModelBaseFootprint =
  | { shape: 'circle'; radius: number }
  | { shape: 'oval'; halfWidth: number; halfLength: number; rotationDeg?: number }
  | { shape: 'square'; halfSize: number; rotationDeg?: number }
  | { shape: 'rectangle'; halfWidth: number; halfLength: number; rotationDeg?: number };

function repeatedBase(base: ModelBase, count: number): ModelBase[] {
  return Array.from({ length: count }, () => ({ ...base }));
}

export function roundBase(diameterMm: number, count: number, label?: string): ModelBase[] {
  return repeatedBase({ shape: 'round', diameterMm, label }, count);
}

export function ovalBase(widthMm: number, lengthMm: number, count: number, label?: string): ModelBase[] {
  return repeatedBase({ shape: 'oval', widthMm, lengthMm, label }, count);
}

export function hullBase(
  widthMm: number,
  lengthMm: number,
  count: number,
  label?: string,
  footprint?: 'square' | 'rectangle' | 'circle',
): ModelBase[] {
  return repeatedBase({ shape: 'hull', widthMm, lengthMm, label, footprint }, count);
}

export function baseRadiusInches(base: ModelBase): number {
  const footprint = baseFootprintInches(base);
  if (footprint.shape === 'square') return footprint.halfSize;
  if (footprint.shape === 'rectangle' || footprint.shape === 'oval') return Math.max(footprint.halfWidth, footprint.halfLength);
  return footprint.radius;
}

export function baseFootprintInches(base: ModelBase, rotationDeg = 0): ModelBaseFootprint {
  if (base.shape === 'hull') {
    const width = base.widthMm > 0 ? base.widthMm / MM_PER_INCH : 1.8;
    const length = base.lengthMm > 0 ? base.lengthMm / MM_PER_INCH : width;
    if (base.footprint === 'circle') return { shape: 'circle', radius: Math.max(width, length) / 2 };
    if (base.footprint === 'rectangle') return { shape: 'rectangle', halfWidth: width / 2, halfLength: length / 2, rotationDeg };
    return { shape: 'square', halfSize: Math.max(width, length) / 2, rotationDeg };
  }
  if (base.shape === 'round') return { shape: 'circle', radius: (base.diameterMm / MM_PER_INCH) / 2 };
  if (base.shape === 'other') return { shape: 'circle', radius: 0.9 };
  if (base.shape === 'oval') {
    const width = base.widthMm > 0 ? base.widthMm / MM_PER_INCH : 1.8;
    const length = base.lengthMm > 0 ? base.lengthMm / MM_PER_INCH : width;
    return { shape: 'oval', halfWidth: width / 2, halfLength: length / 2, rotationDeg };
  }
  return { shape: 'circle', radius: 0.9 };
}

export function modelBaseRadiusInches(profile: UnitProfile, modelIndex = 0): number {
  const base = profile.modelBases?.[modelIndex] ?? profile.modelBases?.[0];
  if (base) return baseRadiusInches(base);
  return fallbackBaseRadiusInches(profile);
}

export function modelBaseFootprintInches(profile: UnitProfile, modelIndex = 0, rotationDeg = 0): ModelBaseFootprint {
  const base = profile.modelBases?.[modelIndex] ?? profile.modelBases?.[0];
  if (base) return baseFootprintInches(base, rotationDeg);
  return { shape: 'circle', radius: fallbackBaseRadiusInches(profile) };
}

export function pointInBaseFootprint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  footprint: ModelBaseFootprint,
): boolean {
  if (footprint.shape === 'square') {
    const local = rotatePoint(point, center, -(footprint.rotationDeg ?? 0));
    return Math.abs(local.x - center.x) <= footprint.halfSize
      && Math.abs(local.y - center.y) <= footprint.halfSize;
  }
  if (footprint.shape === 'rectangle') {
    const local = rotatePoint(point, center, -(footprint.rotationDeg ?? 0));
    return Math.abs(local.x - center.x) <= footprint.halfLength
      && Math.abs(local.y - center.y) <= footprint.halfWidth;
  }
  if (footprint.shape === 'oval') {
    const local = rotatePoint(point, center, -(footprint.rotationDeg ?? 0));
    const dx = (local.x - center.x) / footprint.halfLength;
    const dy = (local.y - center.y) / footprint.halfWidth;
    return dx * dx + dy * dy <= 1;
  }
  return Math.hypot(point.x - center.x, point.y - center.y) <= footprint.radius;
}

export function baseFootprintsOverlap(
  aCenter: { x: number; y: number },
  aFootprint: ModelBaseFootprint,
  bCenter: { x: number; y: number },
  bFootprint: ModelBaseFootprint,
  tolerance = 0,
): boolean {
  if (aFootprint.shape === 'circle' && bFootprint.shape === 'circle') {
    const dx = Math.abs(aCenter.x - bCenter.x);
    const dy = Math.abs(aCenter.y - bCenter.y);
    return Math.hypot(dx, dy) < aFootprint.radius + bFootprint.radius - tolerance;
  }

  if (aFootprint.shape === 'oval' || bFootprint.shape === 'oval') {
    return baseFootprintDistance(aCenter, aFootprint, bCenter, bFootprint) <= Math.max(0, -tolerance);
  }

  const aRect = rectHalfExtents(aFootprint);
  const bRect = rectHalfExtents(bFootprint);

  if (aRect && bRect) {
    return rotatedRectsOverlap(
      rectFromFootprint(aCenter, aFootprint),
      rectFromFootprint(bCenter, bFootprint),
      tolerance,
    );
  }

  if (aRect && bFootprint.shape === 'circle') {
    return rotatedRectCircleOverlap(rectFromFootprint(aCenter, aFootprint), bCenter, bFootprint.radius, tolerance);
  }
  if (bRect && aFootprint.shape === 'circle') {
    return rotatedRectCircleOverlap(rectFromFootprint(bCenter, bFootprint), aCenter, aFootprint.radius, tolerance);
  }
  return false;
}

export function baseFootprintDistance(
  aCenter: { x: number; y: number },
  aFootprint: ModelBaseFootprint,
  bCenter: { x: number; y: number },
  bFootprint: ModelBaseFootprint,
): number {
  if (aFootprint.shape === 'circle' && bFootprint.shape === 'circle') {
    return Math.max(0, Math.hypot(aCenter.x - bCenter.x, aCenter.y - bCenter.y) - aFootprint.radius - bFootprint.radius);
  }

  const aPoints = footprintBoundaryPoints(aCenter, aFootprint);
  const bPoints = footprintBoundaryPoints(bCenter, bFootprint);
  if (footprintBoundariesTouch(aPoints, aFootprint, aCenter, bPoints, bFootprint, bCenter)) return 0;

  let closest = Infinity;
  for (let ai = 0; ai < aPoints.length; ai++) {
    const a0 = aPoints[ai];
    const a1 = aPoints[(ai + 1) % aPoints.length];
    for (let bi = 0; bi < bPoints.length; bi++) {
      const b0 = bPoints[bi];
      const b1 = bPoints[(bi + 1) % bPoints.length];
      closest = Math.min(
        closest,
        distancePointToSegment(a0, b0, b1),
        distancePointToSegment(a1, b0, b1),
        distancePointToSegment(b0, a0, a1),
        distancePointToSegment(b1, a0, a1),
      );
    }
  }
  return closest;
}

export function baseFootprintMaxPointDistance(
  startCenter: { x: number; y: number },
  startFootprint: ModelBaseFootprint,
  endCenter: { x: number; y: number },
  endFootprint: ModelBaseFootprint,
): number {
  if (startFootprint.shape === 'circle' && endFootprint.shape === 'circle') {
    return Math.hypot(endCenter.x - startCenter.x, endCenter.y - startCenter.y);
  }

  const startPoints = footprintBoundaryPoints(startCenter, startFootprint);
  const endPoints = footprintBoundaryPoints(endCenter, endFootprint);
  const count = Math.min(startPoints.length, endPoints.length);
  let maxDistance = Math.hypot(endCenter.x - startCenter.x, endCenter.y - startCenter.y);
  for (let i = 0; i < count; i++) {
    maxDistance = Math.max(maxDistance, Math.hypot(endPoints[i].x - startPoints[i].x, endPoints[i].y - startPoints[i].y));
  }
  return maxDistance;
}

export function baseFootprintWithinRect(
  center: { x: number; y: number },
  footprint: ModelBaseFootprint,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  if (footprint.shape === 'circle') {
    return center.x - footprint.radius >= rect.x
      && center.x + footprint.radius <= rect.x + rect.width
      && center.y - footprint.radius >= rect.y
      && center.y + footprint.radius <= rect.y + rect.height;
  }
  return footprintBoundaryPoints(center, footprint).every(point =>
    point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height,
  );
}

export function baseFootprintIntersectsRect(
  center: { x: number; y: number },
  footprint: ModelBaseFootprint,
  rect: { x: number; y: number; width: number; height: number; rotationDeg?: number },
  tolerance = 0,
): boolean {
  const rectCenter = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
  const radians = -((rect.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = center.x - rectCenter.x;
  const dy = center.y - rectCenter.y;
  const localCenter = {
    x: rectCenter.x + dx * cos - dy * sin,
    y: rectCenter.y + dx * sin + dy * cos,
  };

  if (footprint.shape === 'circle') {
    const nearestX = Math.max(rect.x, Math.min(rect.x + rect.width, localCenter.x));
    const nearestY = Math.max(rect.y, Math.min(rect.y + rect.height, localCenter.y));
    return Math.hypot(localCenter.x - nearestX, localCenter.y - nearestY) < footprint.radius - tolerance;
  }
  if (footprint.shape === 'oval') {
    return baseFootprintDistance(
      center,
      footprint,
      rectCenter,
      { shape: 'rectangle', halfLength: rect.width / 2, halfWidth: rect.height / 2, rotationDeg: rect.rotationDeg ?? 0 },
    ) <= Math.max(0, -tolerance);
  }

  return rotatedRectsOverlap(
    rectFromFootprint(center, footprint),
    { center: rectCenter, halfLength: rect.width / 2, halfWidth: rect.height / 2, rotationDeg: rect.rotationDeg ?? 0 },
    tolerance,
  );
}

function rectHalfExtents(footprint: ModelBaseFootprint): { halfWidth: number; halfLength: number } | null {
  if (footprint.shape === 'square') return { halfWidth: footprint.halfSize, halfLength: footprint.halfSize };
  if (footprint.shape === 'rectangle') return footprint;
  return null;
}

type OrientedRect = {
  center: { x: number; y: number };
  halfWidth: number;
  halfLength: number;
  rotationDeg: number;
};

function rectFromFootprint(center: { x: number; y: number }, footprint: ModelBaseFootprint): OrientedRect {
  const extents = rectHalfExtents(footprint);
  return {
    center,
    halfWidth: extents?.halfWidth ?? 0,
    halfLength: extents?.halfLength ?? 0,
    rotationDeg: footprint.shape === 'circle' ? 0 : footprint.rotationDeg ?? 0,
  };
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

function rectAxes(rect: OrientedRect) {
  const radians = (rect.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ];
}

function rectCorners(rect: OrientedRect) {
  const axes = rectAxes(rect);
  return [
    { x: rect.center.x - axes[0].x * rect.halfLength - axes[1].x * rect.halfWidth, y: rect.center.y - axes[0].y * rect.halfLength - axes[1].y * rect.halfWidth },
    { x: rect.center.x + axes[0].x * rect.halfLength - axes[1].x * rect.halfWidth, y: rect.center.y + axes[0].y * rect.halfLength - axes[1].y * rect.halfWidth },
    { x: rect.center.x + axes[0].x * rect.halfLength + axes[1].x * rect.halfWidth, y: rect.center.y + axes[0].y * rect.halfLength + axes[1].y * rect.halfWidth },
    { x: rect.center.x - axes[0].x * rect.halfLength + axes[1].x * rect.halfWidth, y: rect.center.y - axes[0].y * rect.halfLength + axes[1].y * rect.halfWidth },
  ];
}

function project(points: Array<{ x: number; y: number }>, axis: { x: number; y: number }) {
  const values = points.map(point => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function rotatedRectsOverlap(a: OrientedRect, b: OrientedRect, tolerance = 0) {
  const aCorners = rectCorners(a);
  const bCorners = rectCorners(b);
  for (const axis of [...rectAxes(a), ...rectAxes(b)]) {
    const ap = project(aCorners, axis);
    const bp = project(bCorners, axis);
    if (ap.max <= bp.min + tolerance || bp.max <= ap.min + tolerance) return false;
  }
  return true;
}

function rotatedRectCircleOverlap(rect: OrientedRect, circleCenter: { x: number; y: number }, radius: number, tolerance = 0) {
  const local = rotatePoint(circleCenter, rect.center, -rect.rotationDeg);
  const nearestX = Math.max(rect.center.x - rect.halfLength, Math.min(rect.center.x + rect.halfLength, local.x));
  const nearestY = Math.max(rect.center.y - rect.halfWidth, Math.min(rect.center.y + rect.halfWidth, local.y));
  return Math.hypot(local.x - nearestX, local.y - nearestY) < radius - tolerance;
}

function footprintBoundaryPoints(
  center: { x: number; y: number },
  footprint: ModelBaseFootprint,
): Array<{ x: number; y: number }> {
  if (footprint.shape === 'square' || footprint.shape === 'rectangle') {
    return rectCorners(rectFromFootprint(center, footprint));
  }

  const pointCount = 72;
  const rotation = ((footprint.shape === 'oval' ? footprint.rotationDeg ?? 0 : 0) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rx = footprint.shape === 'oval' ? footprint.halfLength : footprint.radius;
  const ry = footprint.shape === 'oval' ? footprint.halfWidth : footprint.radius;
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = (index / pointCount) * Math.PI * 2;
    const localX = Math.cos(angle) * rx;
    const localY = Math.sin(angle) * ry;
    return {
      x: center.x + localX * cos - localY * sin,
      y: center.y + localX * sin + localY * cos,
    };
  });
}

function footprintBoundariesTouch(
  aPoints: Array<{ x: number; y: number }>,
  aFootprint: ModelBaseFootprint,
  aCenter: { x: number; y: number },
  bPoints: Array<{ x: number; y: number }>,
  bFootprint: ModelBaseFootprint,
  bCenter: { x: number; y: number },
): boolean {
  for (let ai = 0; ai < aPoints.length; ai++) {
    const a0 = aPoints[ai];
    const a1 = aPoints[(ai + 1) % aPoints.length];
    for (let bi = 0; bi < bPoints.length; bi++) {
      const b0 = bPoints[bi];
      const b1 = bPoints[(bi + 1) % bPoints.length];
      if (segmentsIntersect(a0, a1, b0, b1)) return true;
    }
  }
  return pointInBaseFootprint(aPoints[0], bCenter, bFootprint)
    || pointInBaseFootprint(bPoints[0], aCenter, aFootprint);
}

function distancePointToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0.000001) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const ab = orientation(a, b, c) * orientation(a, b, d);
  const cd = orientation(c, d, a) * orientation(c, d, b);
  return ab <= 0 && cd <= 0
    && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + 0.000001
    && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + 0.000001;
}

function orientation(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 0.000001) return 0;
  return value > 0 ? 1 : -1;
}

export function unitMaxBaseRadiusInches(profile: UnitProfile): number {
  if (profile.modelBases?.length) {
    return Math.max(...profile.modelBases.map(baseRadiusInches));
  }
  return fallbackBaseRadiusInches(profile);
}

export function battleUnitMaxBaseRadiusInches(unit: BattleUnit): number {
  return unitMaxBaseRadiusInches(unit.profile);
}

export function baseLabel(base: ModelBase): string {
  if (base.label) return base.label;
  if (base.shape === 'other') return base.label;
  if (base.shape === 'round') return `${base.diameterMm}mm round`;
  if (base.shape === 'hull' && base.footprint) return `${base.widthMm}x${base.lengthMm}mm hull ${base.footprint}`;
  return `${base.widthMm}x${base.lengthMm}mm ${base.shape}`;
}

export function unitBaseSummary(profile: UnitProfile): string {
  if (!profile.modelBases?.length) return 'base unknown';
  const counts = new Map<string, number>();
  for (const base of profile.modelBases) {
    const label = baseLabel(base);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => count === 1 ? label : `${count}x ${label}`).join(', ');
}

function fallbackBaseRadiusInches(profile: UnitProfile): number {
  const keywords = profile.keywords.map(k => k.toLowerCase());
  if (keywords.includes('titanic')) return 1.5;
  if (keywords.some(k => k === 'vehicle' || k === 'monster')) return 0.9;
  return 0.48;
}
