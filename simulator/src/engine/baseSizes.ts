import type { ModelBase, UnitProfile } from '../types/army';
import type { BattleUnit } from '../types/battle';

const MM_PER_INCH = 25.4;

export type ModelBaseFootprint =
  | { shape: 'circle'; radius: number }
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
  if (footprint.shape === 'rectangle') return Math.max(footprint.halfWidth, footprint.halfLength);
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
  const longestDimension = Math.max(base.widthMm, base.lengthMm);
  if (longestDimension <= 0) return { shape: 'circle', radius: 0.9 };
  return { shape: 'circle', radius: (longestDimension / MM_PER_INCH) / 2 };
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
