import type { UnitProfile } from '../types/army';
import type { Position, Terrain } from '../types/battle';
import { unitMaxBaseRadiusInches } from './baseSizes';
import { DEPLOYMENT_ZONE_SETS } from '../data/deploymentZones';
import type { DeploymentZoneSet, DeploymentZoneShape } from '../data/deploymentZoneTypes';
import {
  axisAlignedBoxIntersectsTerrain,
  circleFullyInTerrain,
  lineIntersectsTerrain,
  pointInTerrain,
  terrainCenter,
} from './terrainGeometry';

export type DeploymentStrategy = 'balanced' | 'refused-flank' | 'objective-push';

export const DEPLOYMENT_STRATEGIES: { id: DeploymentStrategy; name: string }[] = [
  { id: 'balanced',       name: 'Balanced' },
  { id: 'refused-flank',  name: 'Refused Flank' },
  { id: 'objective-push', name: 'Objective Push' },
];

export const BOARD_W = 60;
export const BOARD_H = 44;
export const DEPLOY_DEPTH = 12;
const DEPLOYMENT_PAD = 0.5;

// ─── Zone geometry ────────────────────────────────────────────────────────────

export interface DeploymentZone {
  deployment: string;
  side: 0 | 1;
  name: string;
  role: 'defender' | 'attacker';
  axis: DeploymentZoneSet['axis'];
  shapes: DeploymentZoneShape[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function fallbackZoneSet(): DeploymentZoneSet {
  return {
    id: 'default',
    deployment: 'Default',
    description: 'Default left/right deployment zones',
    axis: 'x',
    sides: [
      { name: 'Left Deployment Zone', role: 'defender', shapes: [{ type: 'rect', x1: 0, y1: 0, x2: DEPLOY_DEPTH, y2: BOARD_H }] },
      { name: 'Right Deployment Zone', role: 'attacker', shapes: [{ type: 'rect', x1: BOARD_W - DEPLOY_DEPTH, y1: 0, x2: BOARD_W, y2: BOARD_H }] },
    ],
  };
}

function boundsForShapes(shapes: DeploymentZoneShape[]) {
  const points = shapes.flatMap(shape => {
    if (shape.type === 'triangle') return shape.points;
    return [
      { x: shape.x1, y: shape.y1 },
      { x: shape.x2, y: shape.y2 },
    ];
  });
  return {
    x0: Math.min(...points.map(p => p.x)) + DEPLOYMENT_PAD,
    x1: Math.max(...points.map(p => p.x)) - DEPLOYMENT_PAD,
    y0: Math.min(...points.map(p => p.y)) + DEPLOYMENT_PAD,
    y1: Math.max(...points.map(p => p.y)) - DEPLOYMENT_PAD,
  };
}

export function zoneFor(side: 0 | 1, deployment = 'Default'): DeploymentZone {
  const set = DEPLOYMENT_ZONE_SETS.find(zoneSet => zoneSet.deployment === deployment) ?? fallbackZoneSet();
  const zoneSide = set.sides[side];
  return {
    deployment: set.deployment,
    side,
    name: zoneSide.name,
    role: zoneSide.role,
    axis: set.axis,
    shapes: zoneSide.shapes,
    ...boundsForShapes(zoneSide.shapes),
  };
}

function pointInTriangle(p: Position, [a, b, c]: [Position, Position, Position]): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function pointInDeploymentShape(p: Position, shape: DeploymentZoneShape): boolean {
  if (shape.type === 'triangle') return pointInTriangle(p, shape.points);
  const inRect = p.x >= shape.x1 && p.x <= shape.x2 && p.y >= shape.y1 && p.y <= shape.y2;
  if (!inRect) return false;
  if (shape.type === 'rect') return true;
  return Math.hypot(p.x - shape.cutoutCenter.x, p.y - shape.cutoutCenter.y) >= shape.cutoutRadius;
}

function distanceToSegment(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function distanceToRect(p: Position, shape: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = Math.max(shape.x1 - p.x, 0, p.x - shape.x2);
  const dy = Math.max(shape.y1 - p.y, 0, p.y - shape.y2);
  return Math.hypot(dx, dy);
}

function rectCorners(shape: Extract<DeploymentZoneShape, { type: 'rect' | 'rectWithCircleCut' }>): Position[] {
  return [
    { x: shape.x1, y: shape.y1 },
    { x: shape.x2, y: shape.y1 },
    { x: shape.x2, y: shape.y2 },
    { x: shape.x1, y: shape.y2 },
  ];
}

function distanceToTriangle(p: Position, shape: Extract<DeploymentZoneShape, { type: 'triangle' }>): number {
  if (pointInTriangle(p, shape.points)) return 0;
  return shape.points.reduce((best, point, index) =>
    Math.min(best, distanceToSegment(p, point, shape.points[(index + 1) % shape.points.length])),
  Infinity);
}

function pointInRect(p: Position, shape: Extract<DeploymentZoneShape, { type: 'rectWithCircleCut' }>): boolean {
  return p.x >= shape.x1 && p.x <= shape.x2 && p.y >= shape.y1 && p.y <= shape.y2;
}

function distanceToRectWithCircleCut(
  p: Position,
  shape: Extract<DeploymentZoneShape, { type: 'rectWithCircleCut' }>,
): number {
  if (pointInDeploymentShape(p, shape)) return 0;

  const candidates: number[] = [];
  const corners = rectCorners(shape);
  const edges = corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]] as const);
  for (const [a, b] of edges) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq <= 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projected = { x: a.x + dx * t, y: a.y + dy * t };
    if (pointInDeploymentShape(projected, shape)) candidates.push(Math.hypot(p.x - projected.x, p.y - projected.y));
  }

  for (const corner of corners) {
    if (pointInDeploymentShape(corner, shape)) candidates.push(Math.hypot(p.x - corner.x, p.y - corner.y));
  }

  const angle = Math.atan2(p.y - shape.cutoutCenter.y, p.x - shape.cutoutCenter.x);
  const arcPoint = {
    x: shape.cutoutCenter.x + Math.cos(angle) * shape.cutoutRadius,
    y: shape.cutoutCenter.y + Math.sin(angle) * shape.cutoutRadius,
  };
  if (pointInRect(arcPoint, shape)) candidates.push(Math.hypot(p.x - arcPoint.x, p.y - arcPoint.y));

  return candidates.length ? Math.min(...candidates) : distanceToRect(p, shape);
}

function distanceToDeploymentShape(p: Position, shape: DeploymentZoneShape): number {
  if (shape.type === 'triangle') return distanceToTriangle(p, shape);
  if (shape.type === 'rectWithCircleCut') return distanceToRectWithCircleCut(p, shape);
  if (pointInDeploymentShape(p, shape)) return 0;
  return distanceToRect(p, shape);
}

export function distanceToDeploymentZone(p: Position, zone: DeploymentZone): number {
  return Math.min(...zone.shapes.map(shape => distanceToDeploymentShape(p, shape)));
}

export function pointInDeploymentZone(p: Position, zone: DeploymentZone, pad = 0): boolean {
  const paddedPoint = [
    { x: p.x - pad, y: p.y - pad },
    { x: p.x + pad, y: p.y - pad },
    { x: p.x + pad, y: p.y + pad },
    { x: p.x - pad, y: p.y + pad },
    p,
  ];
  return paddedPoint.every(point => zone.shapes.some(shape => pointInDeploymentShape(point, shape)));
}

export function formationInDeploymentZone(x: number, y: number, hw: number, hh: number, zone: DeploymentZone): boolean {
  return [
    { x, y },
    { x: x - hw, y: y - hh },
    { x: x + hw, y: y - hh },
    { x: x + hw, y: y + hh },
    { x: x - hw, y: y + hh },
  ].every(point => pointInDeploymentZone(point, zone));
}

// Half-extents of the formation bounding box, plus a spacing buffer
export function fp(count: number, baseRadius = 0.5): { hw: number; hh: number } {
  const spacing = baseRadius * 2 + 0.15;
  const edgePad = baseRadius + 0.15;
  if (count === 1) return { hw: edgePad, hh: edgePad };
  const cols = Math.min(5, count);
  const rows = Math.ceil(count / cols);
  return {
    hw: ((cols - 1) / 2) * spacing + edgePad,
    hh: ((rows - 1) / 2) * spacing + edgePad,
  };
}

// ─── Unit role classification ─────────────────────────────────────────────────

// Parse average value from an attacks expression like "D6", "2D3+1", "4"
export function avgAttacks(s: string): number {
  const m = s.match(/^(\d+)?[Dd](\d+)([+-]\d+)?$/);
  if (m) {
    const mult = parseInt(m[1] || '1');
    const die  = parseInt(m[2]);
    const plus = parseInt(m[3] || '0');
    return mult * (die + 1) / 2 + plus;
  }
  return parseFloat(s) || 2;
}

export type UnitRole = 'assault' | 'ranged' | 'mixed';

export function unitRole(u: UnitProfile): UnitRole {
  const meleeScore = u.weapons
    .filter(w => w.isMelee)
    .reduce((s, w) => s + avgAttacks(w.attacks) * w.strength * (1 + Math.abs(w.ap) * 0.25), 0);

  const rangedScore = u.weapons
    .filter(w => !w.isMelee && w.range > 0)
    .reduce((s, w) => s + avgAttacks(w.attacks) * w.strength * (1 + Math.abs(w.ap) * 0.25) * Math.min(1, w.range / 24), 0);

  if (meleeScore === 0 && rangedScore === 0) return 'mixed';
  if (meleeScore > rangedScore * 1.2) return 'assault';
  if (rangedScore > meleeScore * 1.2) return 'ranged';
  return 'mixed';
}

// How far forward in the deployment zone a unit should stand (0 = back edge, 1 = front edge)
export function depthFraction(role: UnitRole, move: number): number {
  const spd = Math.max(0, move - 5) * 0.04; // faster units have tactical flexibility
  switch (role) {
    case 'assault': return Math.min(0.90, 0.70 + spd);         // push to front
    case 'ranged':  return Math.min(0.50, 0.20 + spd);         // stay back; faster ones creep forward
    default:        return Math.min(0.65, 0.45 + spd * 0.5);  // mixed: middle
  }
}

// ─── Overlap / terrain helpers ────────────────────────────────────────────────

export function bbOverlaps(
  ax: number, ay: number, ahw: number, ahh: number,
  bx: number, by: number, bhw: number, bhh: number,
  gap = 0.8,
): boolean {
  return Math.abs(ax - bx) < ahw + bhw + gap && Math.abs(ay - by) < ahh + bhh + gap;
}

export function clearOfTerrain(x: number, y: number, hw: number, hh: number, terrain: Terrain[]): boolean {
  return !terrain.some(t => axisAlignedBoxIntersectsTerrain(x, y, hw, hh, t));
}

// Returns true if any cover-providing terrain feature intersects the line from → to
export function losBlocked(from: Position, to: Position, terrain: Terrain[]): boolean {
  for (const t of terrain) {
    if (!t.providesCover) continue;
    if (t.features.some(feature => feature.blocksLOS && lineIntersectsTerrain(from, to, feature))) {
      return true;
    }
  }
  return false;
}

function opponentDeploymentSamples(side: 0 | 1, deployment = 'Default'): Position[] {
  const zone = zoneFor(side === 0 ? 1 : 0, deployment);
  const samples: Position[] = [];
  for (let x = zone.x0; x <= zone.x1 + 0.01; x += Math.max(3, (zone.x1 - zone.x0) / 3)) {
    for (let y = zone.y0; y <= zone.y1 + 0.01; y += Math.max(3, (zone.y1 - zone.y0) / 4)) {
      const point = { x: Math.min(zone.x1, x), y: Math.min(zone.y1, y) };
      if (pointInDeploymentZone(point, zone, 0.25)) samples.push(point);
    }
  }
  return samples.length ? samples : [{ x: (zone.x0 + zone.x1) / 2, y: (zone.y0 + zone.y1) / 2 }];
}

export function screenedFromOpponentDeployment(
  x: number,
  y: number,
  side: 0 | 1,
  terrain: Terrain[],
  deployment = 'Default',
): boolean {
  const to = { x, y };
  return opponentDeploymentSamples(side, deployment).every(from => losBlocked(from, to, terrain));
}

// Returns true if (x,y) lies inside a cover-providing terrain mat
export function inTerrainCover(x: number, y: number, terrain: Terrain[]): boolean {
  return terrain.some(t => t.providesCover && pointInTerrain({ x, y }, t));
}

export function modelFullyInTerrainCover(x: number, y: number, radius: number, terrain: Terrain[]): boolean {
  return terrain.some(t => t.providesCover && circleFullyInTerrain({ x, y }, radius, t));
}

export function modelScreenedByTerrainFeature(
  x: number,
  y: number,
  side: 0 | 1,
  terrain: Terrain[],
  deployment = 'Default',
): boolean {
  const to = { x, y };
  return opponentDeploymentSamples(side, deployment).every(from =>
    terrain.some(t =>
      t.providesCover
      && circleFullyInTerrain(to, 0.48, t)
      && t.features.some(feature => feature.blocksLOS && lineIntersectsTerrain(from, to, feature)),
    ),
  );
}

export function modelBehindTerrainWall(
  x: number,
  y: number,
  side: 0 | 1,
  terrain: Terrain[],
  deployment = 'Default',
): boolean {
  const model = { x, y };
  return terrain.some(t => {
    if (!t.providesCover || !circleFullyInTerrain(model, 0.48, t)) return false;
    return t.features.some(feature => {
      if (!feature.blocksLOS) return false;
      const center = terrainCenter(feature);
      const wallBetweenEnemyAndModel = side === 0 ? center.x > x : center.x < x;
      if (!wallBetweenEnemyAndModel) return false;

      const horizontalReach = feature.height <= feature.width && Math.abs(y - center.y) <= Math.max(1.25, feature.height / 2 + 1);
      const verticalReach = feature.height > feature.width && y >= feature.y - 1 && y <= feature.y + feature.height + 1;
      return horizontalReach || verticalReach || modelScreenedByTerrainFeature(x, y, side, terrain, deployment);
    });
  });
}

// Spiral outward from the desired position to find a valid spot
function findSpot(
  desiredX: number, desiredY: number,
  hw: number, hh: number,
  zone: DeploymentZone,
  terrain: Terrain[],
  placed: Array<{ x: number; y: number; hw: number; hh: number }>,
): Position {
  const xMin = zone.x0 + hw;
  const xMax = zone.x1 - hw;
  const yMin = hh + 0.5;
  const yMax = BOARD_H - hh - 0.5;
  const cx = Math.max(xMin, Math.min(xMax, desiredX));
  const cy = Math.max(yMin, Math.min(yMax, desiredY));

  // Only solid terrain blocks unit placement — ruins and area terrain are traversable
  const solidTerrain = terrain.filter(t => t.type === 'obstacle' || t.type === 'impassable');

  for (const d of [0, 2.5, 5, 7.5, 10, 12.5, 15, 20]) {
    const cands = d === 0 ? [{ x: cx, y: cy }] : [
      { x: cx,           y: cy + d        },
      { x: cx,           y: cy - d        },
      { x: cx + d,       y: cy            },
      { x: cx - d,       y: cy            },
      { x: cx + d * 0.7, y: cy + d * 0.7 },
      { x: cx - d * 0.7, y: cy + d * 0.7 },
      { x: cx + d * 0.7, y: cy - d * 0.7 },
      { x: cx - d * 0.7, y: cy - d * 0.7 },
    ];
    for (const c of cands) {
      const px = Math.max(xMin, Math.min(xMax, c.x));
      const py = Math.max(yMin, Math.min(yMax, c.y));
      if (!formationInDeploymentZone(px, py, hw, hh, zone)) continue;
      if (!clearOfTerrain(px, py, hw, hh, solidTerrain)) continue;
      if (placed.some(p => bbOverlaps(px, py, hw, hh, p.x, p.y, p.hw, p.hh))) continue;
      return { x: px, y: py };
    }
  }
  return { x: cx, y: cy }; // fallback
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function deployArmy(
  units: UnitProfile[],
  side: 0 | 1,
  strategy: DeploymentStrategy,
  terrain: Terrain[],
  objectives: Position[],
  deployment = 'Default',
): Position[] {
  const zone    = zoneFor(side, deployment);
  const zoneW   = zone.x1 - zone.x0;
  const zoneH   = zone.y1 - zone.y0;
  const frontX  = (side === 0) ? zone.x1 : zone.x0; // edge closest to enemy

  // Tag each unit with role, ideal x depth, and OC power
  const tagged = units.map((u, i) => {
    const role   = unitRole(u);
    const depth  = depthFraction(role, u.move);
    const idealX = zone.axis === 'y'
      ? zone.x0 + zoneW / 2
      : side === 0
        ? zone.x0 + depth * zoneW
        : zone.x1 - depth * zoneW;
    const idealY = zone.axis === 'y'
      ? side === 0
        ? zone.y0 + depth * zoneH
        : zone.y1 - depth * zoneH
      : undefined;
    return {
      u, i, role,
      idealX,
      idealY,
      oc:    u.oc * u.baseModelCount,         // total objective control
      speed: u.move + (role === 'assault' ? 2 : 0), // assault units "count as" faster for assignment
    };
  });

  // ── Strategy-specific y assignment ─────────────────────────────────────────

  const assignedY: number[] = new Array(units.length);
  const jitter = () => (Math.random() - 0.5) * 2.5;

  if (strategy === 'balanced') {
    // Assign units to objectives, center-outward, by OC power.
    // Most important objective (center) goes to the highest-OC unit.
    const objYs = [...objectives].map(o => o.y).sort((a, b) => a - b);
    // Reorder: center-most first, alternating outward
    const centerFirst = [...objYs].sort((a, b) =>
      Math.abs(a - BOARD_H / 2) - Math.abs(b - BOARD_H / 2),
    );
    const sortedByOC = [...tagged].sort((a, b) => b.oc - a.oc);
    for (let si = 0; si < sortedByOC.length; si++) {
      assignedY[sortedByOC[si].i] = sortedByOC[si].idealY ?? centerFirst[si % centerFirst.length] + jitter();
    }

  } else if (strategy === 'refused-flank') {
    // All units in one half of the board.
    // Fast assault units at the OUTER edge (they engage first and sweep outward).
    // Slow ranged units at the INNER edge (fire support from inside the mass).
    const useTop = Math.random() < 0.5;
    const outerY = useTop ? 1.5 : BOARD_H - 1.5;
    const innerY = useTop ? BOARD_H / 2 - 2 : BOARD_H / 2 + 2;

    const outerScore = (t: typeof tagged[0]) =>
      t.speed * (t.role === 'assault' ? 2.0 : t.role === 'mixed' ? 0.8 : 0.3);

    const sortedByOuter = [...tagged].sort((a, b) => outerScore(b) - outerScore(a));
    const n = sortedByOuter.length;
    for (let si = 0; si < n; si++) {
      const t = n > 1 ? si / (n - 1) : 0.5;
      assignedY[sortedByOuter[si].i] = sortedByOuter[si].idealY ?? outerY + (innerY - outerY) * t + jitter();
    }

  } else {
    // Objective push: each unit is assigned to a specific near-side objective
    // based on move speed. Fastest units target the most central/far objective;
    // slowest lock onto the nearest ones.
    const nearObjs = objectives
      .filter(o => side === 0 ? o.x <= BOARD_W / 2 : o.x >= BOARD_W / 2)
      .sort((a, b) => {
        // Priority: farthest-x objective first (hardest to reach = most reward)
        const distA = side === 0 ? a.x : BOARD_W - a.x;
        const distB = side === 0 ? b.x : BOARD_W - b.x;
        return distB - distA;
      });
    if (!nearObjs.length) nearObjs.push({ x: BOARD_W / 2, y: BOARD_H / 2 });

    const sortedBySpeed = [...tagged].sort((a, b) => b.speed - a.speed);
    for (let si = 0; si < sortedBySpeed.length; si++) {
      assignedY[sortedBySpeed[si].i] = sortedBySpeed[si].idealY ?? nearObjs[si % nearObjs.length].y + jitter();
    }

    // Also shift everyone's idealX toward the front (urgency of push)
    for (const t of tagged) {
      t.idealX = t.idealX + (frontX - t.idealX) * 0.40;
    }
  }

  // ── Place units in sorted order (largest footprint first for better packing) ─

  const order = [...tagged].sort(
    (a, b) => fp(b.u.baseModelCount, unitMaxBaseRadiusInches(b.u)).hw * fp(b.u.baseModelCount, unitMaxBaseRadiusInches(b.u)).hh
            - fp(a.u.baseModelCount, unitMaxBaseRadiusInches(a.u)).hw * fp(a.u.baseModelCount, unitMaxBaseRadiusInches(a.u)).hh,
  );

  const placed: Array<{ x: number; y: number; hw: number; hh: number }> = [];
  const result: Position[] = new Array(units.length);

  for (const t of order) {
    const { hw, hh } = fp(t.u.baseModelCount, unitMaxBaseRadiusInches(t.u));
    const pos = findSpot(t.idealX, assignedY[t.i], hw, hh, zone, terrain, placed);
    placed.push({ x: pos.x, y: pos.y, hw, hh });
    result[t.i] = pos;
  }

  return result;
}
