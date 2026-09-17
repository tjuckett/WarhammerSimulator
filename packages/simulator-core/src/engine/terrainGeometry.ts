import type { BattleState, BattleUnit, Position, Terrain, TerrainFeature } from '../types/battle';

type RectShape = Pick<Terrain | TerrainFeature, 'x' | 'y' | 'width' | 'height' | 'rotationDeg'> & {
  polygonPoints?: Position[];
};

type TerrainRayQuery = {
  obscuringTerrain11e: Terrain[];
  ruins: Terrain[];
};

// Terrain geometry is immutable for the lifetime of a battle state. Corner
// generation is used by every sampled LOS/cover ray, so cache it per shape
// object instead of repeating the rotation and polygon translation work for
// each ray.
const terrainCornersCache = new WeakMap<object, Position[]>();

// LOS checks visit many model pairs against the same immutable battlefield
// terrain. Cache the terrain-only classification; endpoint intersection tests
// remain per ray and therefore retain their exact result.
const terrainRayQueryCache = new WeakMap<Terrain[], TerrainRayQuery>();

function terrainRayQuery(terrain: Terrain[]): TerrainRayQuery {
  const cached = terrainRayQueryCache.get(terrain);
  if (cached) return cached;
  const obscuringTerrain11e: Terrain[] = [];
  const ruins: Terrain[] = [];
  for (const item of terrain) {
    if (item.type === 'ruin') ruins.push(item);
    if (item.features.some(feature => {
      const category = effectiveTerrainFeatureCategory(item, feature);
      return category === 'light' || category === 'dense';
    })) obscuringTerrain11e.push(item);
  }
  const query = { obscuringTerrain11e, ruins };
  terrainRayQueryCache.set(terrain, query);
  return query;
}

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
  const cached = terrainCornersCache.get(t);
  if (cached) return cached;
  const c = terrainCenter(t);
  const corners = t.polygonPoints?.length ? t.polygonPoints.map(point => ({
    x: t.x + point.x,
    y: t.y + point.y,
  })) : [
    { x: t.x, y: t.y },
    { x: t.x + t.width, y: t.y },
    { x: t.x + t.width, y: t.y + t.height },
    { x: t.x, y: t.y + t.height },
  ];
  const rotatedCorners = corners.map(p => rotatePoint(p, c, t.rotationDeg ?? 0));
  terrainCornersCache.set(t, rotatedCorners);
  return rotatedCorners;
}

export function pointInTerrain(p: Position, t: RectShape): boolean {
  if (t.polygonPoints?.length) {
    const corners = terrainCorners(t);
    return corners.some((corner, i) => pointOnSegment(p, corner, corners[(i + 1) % corners.length]))
      || pointInPolygon(p, corners);
  }
  const c = terrainCenter(t);
  const local = rotatePoint(p, c, -(t.rotationDeg ?? 0));
  return local.x >= t.x && local.x <= t.x + t.width
    && local.y >= t.y && local.y <= t.y + t.height;
}

export function circleFullyInTerrain(p: Position, radius: number, t: RectShape): boolean {
  if (t.polygonPoints?.length) {
    return [
      p,
      { x: p.x - radius, y: p.y },
      { x: p.x + radius, y: p.y },
      { x: p.x, y: p.y - radius },
      { x: p.x, y: p.y + radius },
    ].every(point => pointInTerrain(point, t));
  }
  const c = terrainCenter(t);
  const local = rotatePoint(p, c, -(t.rotationDeg ?? 0));
  return local.x - radius >= t.x
    && local.x + radius <= t.x + t.width
    && local.y - radius >= t.y
    && local.y + radius <= t.y + t.height;
}

function distanceSquaredToSegment(p: Position, a: Position, b: Position): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const projection = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const closest = { x: a.x + projection * dx, y: a.y + projection * dy };
  return (p.x - closest.x) ** 2 + (p.y - closest.y) ** 2;
}

/** True when any part of a model's circular footprint overlaps the terrain. */
export function circleIntersectsTerrain(p: Position, radius: number, t: RectShape): boolean {
  if (pointInTerrain(p, t)) return true;
  const corners = terrainCorners(t);
  if (corners.some(corner => (corner.x - p.x) ** 2 + (corner.y - p.y) ** 2 <= radius * radius)) return true;
  return corners.some((corner, index) =>
    distanceSquaredToSegment(p, corner, corners[(index + 1) % corners.length]) <= radius * radius,
  );
}

function ccw(a: Position, b: Position, c: Position): boolean {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(p: Position, a: Position, b: Position): boolean {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > 0.0001) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  if (dot < 0) return false;
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lenSq;
}

function pointInPolygon(p: Position, polygon: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = ((a.y > p.y) !== (b.y > p.y))
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function rectVerticalHeight(t: RectShape): number | null {
  if (!('featureHeight' in t)) return null;
  switch ((t as TerrainFeature).featureHeight) {
    case 'low': return 2;
    case 'mid': return 5;
    case 'tall': return 10;
    default: return null;
  }
}

function sightLineClearsRect(from: Position, to: Position, t: RectShape): boolean {
  const blockerHeight = rectVerticalHeight(t);
  if (blockerHeight === null) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) return Math.min(from.z ?? 0, to.z ?? 0) > blockerHeight;
  const center = terrainCenter(t);
  const along = Math.max(0, Math.min(1, ((center.x - from.x) * dx + (center.y - from.y) * dy) / lenSq));
  const lineZ = (from.z ?? 0) + ((to.z ?? 0) - (from.z ?? 0)) * along;
  return lineZ > blockerHeight;
}

export function lineIntersectsTerrain(from: Position, to: Position, t: RectShape): boolean {
  if (sightLineClearsRect(from, to, t)) return false;
  if (pointInTerrain(from, t) || pointInTerrain(to, t)) return true;
  const corners = terrainCorners(t);
  return corners.some((corner, i) =>
    segmentsIntersect(from, to, corner, corners[(i + 1) % corners.length]),
  );
}

// Returns true if the line passes THROUGH the terrain boundary (crosses an edge), but does NOT
// count it as blocked when either endpoint is inside the terrain — models already inside can see out/in.
export function linePassesThroughTerrain(from: Position, to: Position, t: RectShape): boolean {
  if (sightLineClearsRect(from, to, t)) return false;
  if (pointInTerrain(from, t) || pointInTerrain(to, t)) return false;
  const corners = terrainCorners(t);
  return corners.some((corner, i) =>
    segmentsIntersect(from, to, corner, corners[(i + 1) % corners.length]),
  );
}

// ── Line-of-sight ─────────────────────────────────────────────────────────────
// Single source-of-truth for all LOS checks across simulator and deployment.

// Returns true if the line from→to has clear LOS through all terrain.
//
// Rules:
//   • Obstacle/impassable terrain is a solid object — any ray that touches or crosses
//     the mat (including when an endpoint is on the boundary) is blocked.
//   • Ruin/area terrain mats do NOT block by themselves; models inside can see out
//     through gaps in features.
//   • Any feature with blocksLOS:true blocks regardless of terrain type.
export function hasLOS(
  from: Position,
  to: Position,
  terrain: Terrain[],
  obscuringTerrain: Terrain[] = [],
): boolean {
  for (const t of terrain) {
    if (t.type === 'impassable' && lineIntersectsTerrain(from, to, t)) return false;
    if (t.type === 'ruin' && linePassesThroughTerrain(from, to, t)) return false;
    if (t.features.some(f => f.blocksLOS && lineIntersectsTerrain(from, to, f))) return false;
  }
  if (obscuringTerrain.some(t => linePassesThroughTerrain(from, to, t))) return false;
  return true;
}

interface ModelRaySamplePoints {
  fromPoints: Position[];
  toPoints: Position[];
}

function modelRaySamplePoints(
  fromCenter: Position,
  fromRadius: number,
  toCenter: Position,
  toRadius: number,
): ModelRaySamplePoints {
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return { fromPoints: [fromCenter], toPoints: [toCenter] };

  const dir = { x: dx / d, y: dy / d };
  const perp = { x: -dir.y, y: dir.x };
  return {
    fromPoints: [
      fromCenter,
      { x: fromCenter.x + perp.x * fromRadius, y: fromCenter.y + perp.y * fromRadius, z: fromCenter.z },
      { x: fromCenter.x - perp.x * fromRadius, y: fromCenter.y - perp.y * fromRadius, z: fromCenter.z },
      { x: fromCenter.x + dir.x * fromRadius, y: fromCenter.y + dir.y * fromRadius, z: fromCenter.z },
    ],
    toPoints: [
      toCenter,
      { x: toCenter.x + perp.x * toRadius, y: toCenter.y + perp.y * toRadius, z: toCenter.z },
      { x: toCenter.x - perp.x * toRadius, y: toCenter.y - perp.y * toRadius, z: toCenter.z },
      { x: toCenter.x - dir.x * toRadius, y: toCenter.y - dir.y * toRadius, z: toCenter.z },
      { x: toCenter.x + dir.x * toRadius, y: toCenter.y + dir.y * toRadius, z: toCenter.z },
    ],
  };
}

// Returns the first unblocked edge-to-edge ray between two bounding-circle models, or null if all blocked.
// Samples perpendicular tangents + near edge on the shooter against center/tangents/near/far on the target.
// Works for circular, square, and oval bases — callers pass the bounding radius.
export function findUnblockedLOSRay(
  fromCenter: Position, fromRadius: number,
  toCenter: Position, toRadius: number,
  terrain: Terrain[],
  edition?: '10e' | '11e',
): { from: Position; to: Position } | null {
  const { fromPoints, toPoints } = modelRaySamplePoints(fromCenter, fromRadius, toCenter, toRadius);
  const terrainQuery = terrainRayQuery(terrain);

  const obscuringTerrain = edition === '11e'
    ? terrainQuery.obscuringTerrain11e
      .filter(t => !circleIntersectsTerrain(fromCenter, fromRadius, t) && !circleIntersectsTerrain(toCenter, toRadius, t))
    : [];
  const endpointIntersectsRuin = terrainQuery.ruins.some(ruin =>
    circleIntersectsTerrain(fromCenter, fromRadius, ruin) || circleIntersectsTerrain(toCenter, toRadius, ruin));
  const rayTerrain = endpointIntersectsRuin
    ? terrain.map(t =>
      t.type === 'ruin'
        && (circleIntersectsTerrain(fromCenter, fromRadius, t) || circleIntersectsTerrain(toCenter, toRadius, t))
        ? { ...t, type: 'area' as const }
        : t,
    )
    : terrain;
  for (const fp of fromPoints) {
    for (const tp of toPoints) {
      if (hasLOS(fp, tp, rayTerrain, obscuringTerrain)) return { from: fp, to: tp };
    }
  }
  return null;
}

// True if any edge-to-edge ray between the two bounding circles is unblocked.
export function hasLOSEdgeToEdge(
  fromCenter: Position, fromRadius: number,
  toCenter: Position, toRadius: number,
  terrain: Terrain[],
  edition?: '10e' | '11e',
): boolean {
  return findUnblockedLOSRay(fromCenter, fromRadius, toCenter, toRadius, terrain, edition) !== null;
}

export interface TerrainCoverContext {
  modelRadius(unit: BattleUnit, modelIndex: number): number;
  hasKeyword(unit: BattleUnit, keyword: string): boolean;
}

function terrainIsWoods(terrain: Terrain): boolean {
  return terrain.type === 'area' && /woods?|forest/i.test(terrain.name);
}

function terrainIsCraterOrRubble(terrain: Terrain): boolean {
  return terrain.type === 'area' && /crater|rubble/i.test(terrain.name);
}

function modelHasCoverFromTerrainFootprint(
  unit: BattleUnit,
  modelIndex: number,
  terrain: Terrain,
  context: TerrainCoverContext,
): boolean {
  const model = unit.modelPositions[modelIndex];
  const canBenefitFromTerrain = ['Infantry', 'Beasts', 'Swarm'].some(keyword => context.hasKeyword(unit, keyword));
  if (!canBenefitFromTerrain
    || !terrain.providesCover
    || !model
    || !circleFullyInTerrain(model, context.modelRadius(unit, modelIndex), terrain)) return false;
  if (terrain.type === 'ruin' || terrainIsWoods(terrain)) return true;
  if (terrainIsCraterOrRubble(terrain)) return true;
  return terrain.type === 'area';
}

function linePassesThroughTerrainFromModel(
  from: Position,
  fromRadius: number,
  to: Position,
  toRadius: number,
  terrain: RectShape,
): boolean {
  if (fromRadius > 0 && circleIntersectsTerrain(from, fromRadius, terrain)) return false;
  if (toRadius > 0 && circleIntersectsTerrain(to, toRadius, terrain)) return false;
  return linePassesThroughTerrain(from, to, terrain);
}

function terrainFootprintObscures(from: Position, to: Position, terrain: Terrain, fromRadius = 0, toRadius = 0): boolean {
  // A terrain mat between the attacker and target blocks sight to anything
  // beyond it. The mat containing the attacker is not itself intervening.
  // Obstacle mats without a blocking feature remain non-blocking.
  const isTerrainArea = terrain.type === 'ruin' || terrain.type === 'area';
  if (!terrain.providesCover && !isTerrainArea) return false;
  if (fromRadius > 0 && circleIntersectsTerrain(from, fromRadius, terrain)) return false;
  if (toRadius > 0 && circleIntersectsTerrain(to, toRadius, terrain)) return false;
  if (isTerrainArea || terrainIsWoods(terrain)) {
    return linePassesThroughTerrainFromModel(from, fromRadius, to, toRadius, terrain);
  }
  return terrain.type === 'impassable' && lineIntersectsTerrain(from, to, terrain);
}

function terrainCoverBlocksRay(
  from: Position,
  to: Position,
  terrain: Terrain[],
  fromRadius: number,
  toRadius: number,
): boolean {
  return terrain.some(feature =>
    terrainFootprintObscures(from, to, feature, fromRadius, toRadius)
    || feature.features.some(part => linePassesThroughTerrainFromModel(
      from,
      // Attached wall geometry is evaluated against the actual ray. The
      // parent terrain mat is handled separately above.
      0,
      to,
      toRadius,
      part,
    )),
  );
}

function targetModelHasTerrainCoverBySight(
  shooterPosition: Position,
  shooterRadius: number,
  targetPosition: Position,
  targetRadius: number,
  terrain: Terrain[],
): boolean {
  const { fromPoints, toPoints } = modelRaySamplePoints(
    shooterPosition,
    shooterRadius,
    targetPosition,
    targetRadius,
  );

  // Cover applies when any sampled line from the attacking footprint to the
  // target footprint is blocked. This keeps a wall that intersects the line
  // of sight at the edge of the attacking model relevant; the terrain area
  // containing the attacker is still ignored by terrainFootprintObscures.
  return toPoints.some(to => fromPoints.some(from =>
    terrainCoverBlocksRay(from, to, terrain, shooterRadius, targetRadius),
  ));
}

export function targetHasTerrainCoverFrom(
  shooterPositions: Position[],
  target: BattleUnit,
  terrain: Terrain[],
  context: TerrainCoverContext,
  shooterRadii: number[] = [],
): boolean {
  return target.modelPositions.every((model, modelIndex) => {
    const targetRadius = context.modelRadius(target, modelIndex);
    return shooterPositions.some((from, shooterIndex) => {
      if (terrain.some(feature => modelHasCoverFromTerrainFootprint(target, modelIndex, feature, context))) {
        return true;
      }
      return targetModelHasTerrainCoverBySight(
        from,
        shooterRadii[shooterIndex] ?? 0,
        model,
        targetRadius,
        terrain,
      );
    });
  });
}

export interface TerrainVisibilityContext extends TerrainCoverContext {
  modelBaseEdgeDistance(source: BattleUnit, sourceModelIndex: number, target: BattleUnit, targetModelIndex: number): number;
}

type TerrainFeatureCategory = NonNullable<TerrainFeature['category']>;

// Older saved layouts may not have serialized feature.category. Keep the
// default in one place with terrain.ts so those states still use the terrain
// feature's rules-defined light/dense classification.
function effectiveTerrainFeatureCategory(terrain: Terrain, feature: TerrainFeature): TerrainFeatureCategory {
  const explicitCategory = typeof feature.category === 'string' ? feature.category.trim().toLowerCase() : '';
  if (explicitCategory === 'light' || explicitCategory === 'dense') return explicitCategory;
  return terrain.type === 'ruin' && feature.featureHeight !== 'low' ? 'dense' : 'light';
}

/**
 * Cheap 11th-edition Hidden pre-check. When every model in a unit is within
 * suitable terrain, the only remaining Hidden condition is the shooter's
 * distance. This deliberately does not inspect terrain rays, so callers can
 * use it to reject definitely Hidden units before the expensive LOS scan.
 */
export function unitHasAllModelsEligibleForHidden(
  state: BattleState,
  target: BattleUnit,
  context: Pick<TerrainVisibilityContext, 'modelRadius' | 'hasKeyword'>,
): boolean {
  if (state.ruleset?.edition !== '11e') return false;
  if (!context.hasKeyword(target, 'infantry')
    && !context.hasKeyword(target, 'beasts')
    && !context.hasKeyword(target, 'swarm')) return false;
  if (target.rangedAttacksMadeThisTurn || target.rangedAttacksMadePreviousTurn) return false;
  if (target.modelPositions.length === 0) return false;
  return target.modelPositions.every((targetModel, targetModelIndex) =>
    state.terrain.some(terrain => terrain.features.some(feature => {
      const category = effectiveTerrainFeatureCategory(terrain, feature);
      return (category === 'light' || category === 'dense')
        && circleIntersectsTerrain(targetModel, context.modelRadius(target, targetModelIndex), terrain);
    })),
  );
}

export function hasAnyModelLOS(
  fromCenter: Position,
  fromRadius: number,
  target: BattleUnit,
  terrain: Terrain[],
  edition: '10e' | '11e' | undefined,
  modelRadius: (unit: BattleUnit, modelIndex: number) => number,
): boolean {
  return target.modelPositions.some((toCenter, modelIndex) =>
    hasLOSEdgeToEdge(fromCenter, fromRadius, toCenter, modelRadius(target, modelIndex), terrain, edition),
  );
}

export function modelIsHiddenFrom(
  state: BattleState,
  source: BattleUnit,
  sourceModelIndex: number,
  target: BattleUnit,
  targetModelIndex: number,
  context: TerrainVisibilityContext,
): boolean {
  if (state.ruleset?.edition !== '11e') return false;
  if (!context.hasKeyword(target, 'infantry') && !context.hasKeyword(target, 'beasts') && !context.hasKeyword(target, 'swarm')) return false;
  if (target.rangedAttacksMadeThisTurn || target.rangedAttacksMadePreviousTurn) return false;
  const targetModel = target.modelPositions[targetModelIndex];
  const sourceModel = source.modelPositions[sourceModelIndex];
  if (!targetModel || !sourceModel) return false;
  if (!state.terrain.some(terrain => terrain.features.some(feature => {
    const category = effectiveTerrainFeatureCategory(terrain, feature);
    return category === 'light' || category === 'dense';
  })
    && circleIntersectsTerrain(targetModel, context.modelRadius(target, targetModelIndex), terrain))) return false;
  return context.modelBaseEdgeDistance(source, sourceModelIndex, target, targetModelIndex) > 15;
}

export function hasAnyModelLOSConsideringHidden(
  state: BattleState,
  source: BattleUnit,
  target: BattleUnit,
  context: TerrainVisibilityContext,
): boolean {
  return source.modelPositions.some((from, sourceModelIndex) => target.modelPositions.some((to, targetModelIndex) =>
    !modelIsHiddenFrom(state, source, sourceModelIndex, target, targetModelIndex, context)
    && hasLOSEdgeToEdge(from, context.modelRadius(source, sourceModelIndex), to, context.modelRadius(target, targetModelIndex), state.terrain, state.ruleset?.edition),
  ));
}

/**
 * Performs the normal/hidden LOS scan once and returns both results. Hidden
 * shooting queries previously scanned every model pair a second time after
 * the visible scan had failed.
 */
export function modelVisibilityConsideringHidden(
  state: BattleState,
  source: BattleUnit,
  target: BattleUnit,
  context: TerrainVisibilityContext,
): { visible: boolean; hidden: boolean } {
  let hidden = false;
  for (let sourceModelIndex = 0; sourceModelIndex < source.modelPositions.length; sourceModelIndex++) {
    const from = source.modelPositions[sourceModelIndex];
    if (!from) continue;
    for (let targetModelIndex = 0; targetModelIndex < target.modelPositions.length; targetModelIndex++) {
      const to = target.modelPositions[targetModelIndex];
      if (!to) continue;
      if (modelIsHiddenFrom(state, source, sourceModelIndex, target, targetModelIndex, context)) {
        hidden = true;
        continue;
      }
      if (hasLOSEdgeToEdge(
        from,
        context.modelRadius(source, sourceModelIndex),
        to,
        context.modelRadius(target, targetModelIndex),
        state.terrain,
        state.ruleset?.edition,
      )) return { visible: true, hidden: false };
    }
  }
  return { visible: false, hidden };
}

export function hasAnyHiddenModelPair(
  state: BattleState,
  source: BattleUnit,
  target: BattleUnit,
  context: TerrainVisibilityContext,
): boolean {
  return source.modelPositions.some((_from, sourceModelIndex) => target.modelPositions.some((_to, targetModelIndex) =>
    modelIsHiddenFrom(state, source, sourceModelIndex, target, targetModelIndex, context),
  ));
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
