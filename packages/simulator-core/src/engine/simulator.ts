import type { BattleSetup, BattleState, BattleUnit, LogEntry, MovementStep, Phase, Position, Side, Terrain, TerrainFeature } from '../types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile, type WeaponProfile } from '../types/army';
import { rules40K10th, rulesetMetadataForState, weaponHasKeyword, weaponKeywordValue, type RulesEdition } from './rulesEngine';
import { rollExpression, rollMultiple, countSuccesses, d6 } from './dice';
import { deployArmy, distanceToDeploymentZone, fp, pointInDeploymentZone, zoneFor, unitRole, type DeploymentStrategy, type DeploymentZoneSource } from './deployment';
import { selectUnitToDrop, reactivePosition, deployModelFormation } from './deploymentBrain';
import { DEFAULT_OBJECTIVES } from './missions';
import { boardFormatForId, boardFormatForState } from '../data/boardFormats';
import { advanceAllowance, normalMoveAllowance } from './movement';
import { objectiveControlRadius } from './objectiveGeometry';
import { formatPrimaryScoringResult, objectiveIndexesWithinRange, scorePrimaryMission } from './missionScoring';
import { battleRound, logWithBattleRound, maxBattleRounds, setBattleRound } from './battleRound';
import {
  completeMissionEventsForCurrentTurn,
  recordCompletedMissionAction,
  recordDestroyedUnitMissionEvent,
  startMissionEventsForNewTurn,
} from './missionEvents';
import { gainCommandPhaseCommandPoints } from './commandPoints';
import { objectiveControlValue, resolveDesperateEscapeTests } from './battleshock';
import { circleFullyInTerrain, findUnblockedLOSRay, hasLOSEdgeToEdge, lineIntersectsTerrain, linePassesThroughTerrain, pointInTerrain, terrainCorners } from './terrainGeometry';
import { COHERENCY_VERTICAL_RANGE, distance as dist, modelIndicesWithCoherencyIssues, modelListIsCoherent, verticalDistance, type CoherencyModel } from './coherency';
import {
  attachedFollowersFor,
  attachedLeadersFor,
  attachedUnitProfilesFor,
  canDeployOutsideDeploymentZone,
  deployableDrops,
  isAttachedLeaderDrop,
  unitHasRule,
  unitMatchesAttachmentTarget,
  unitRosterId,
} from './armyUnits';
import {
  baseFootprintDistance,
  baseFootprintMaxPointDistance,
  baseFootprintIntersectsRect,
  baseFootprintWithinRect,
  baseFootprintsOverlap,
  battleUnitMaxBaseRadiusInches,
  modelBaseFootprintInches,
  modelBaseRadiusInches,
} from './baseSizes';

// ─── ID generators ────────────────────────────────────────────────────────────

let _logId = 0;
let _unitId = 0;

function nextLog(state?: BattleState): string {
  const usedIds = new Set(state?.log.map(entry => entry.id) ?? []);
  let id = String(++_logId);
  while (usedIds.has(id)) id = String(++_logId);
  return id;
}

// ─── Log factory ─────────────────────────────────────────────────────────────

function log(
  state: BattleState,
  side: Side,
  unitName: string,
  message: string,
  type: LogEntry['type'],
): LogEntry {
  return logWithBattleRound({ id: nextLog(state), turn: battleRound(state), phase: state.phase, side, unitName, message, type });
}

function phaseLog(state: BattleState, side: Side, armyName: string, label: string): LogEntry {
  return log(state, side, armyName, label, 'phase');
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function moveToward(from: Position, to: Position, maxInches: number, stopGap = 1.05): Position {
  const d = dist(from, to);
  const target = Math.max(0, d - stopGap);
  const step = Math.min(maxInches, target);
  if (step < 0.01) return from;
  const t = step / d;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

function hasKeyword(unit: BattleUnit, keyword: string): boolean {
  return unit.profile.keywords.some(k => k.toLowerCase() === keyword.toLowerCase());
}

function hasAnyKeyword(unit: BattleUnit, keywords: string[]): boolean {
  const set = keywords.map(k => k.toLowerCase());
  return unit.profile.keywords.some(k => set.includes(k.toLowerCase()));
}

function isAircraft(unit: BattleUnit): boolean {
  return hasKeyword(unit, 'aircraft');
}

function isFortification(unit: BattleUnit): boolean {
  return hasKeyword(unit, 'fortification');
}

const INFILTRATORS_ENEMY_DEPLOYMENT_ZONE_BUFFER = 9;
const FIGHT_PHASE_MOVE_RANGE = 3;

function setupDeploymentZoneSource(setup?: BattleSetup): DeploymentZoneSource {
  return setup?.deploymentZones ?? setup?.deployment ?? 'Default';
}

function modelIsOutsideEnemyDeploymentZoneBuffer(unit: UnitProfile, side: Side, position: Position, modelIndex = 0, deployment: DeploymentZoneSource = 'Default', board = boardFormatForId()): boolean {
  if (!canDeployOutsideDeploymentZone(unit)) return true;
  const enemyZone = zoneFor((1 - side) as Side, deployment, board);
  return distanceToDeploymentZone(position, enemyZone) >= INFILTRATORS_ENEMY_DEPLOYMENT_ZONE_BUFFER + modelBaseRadiusInches(unit, modelIndex);
}

function modelBaseRadius(unit: BattleUnit, modelIndex = 0): number {
  return modelBaseRadiusInches(unit.profile, modelIndex);
}

function modelRotation(unit: BattleUnit, modelIndex = 0): number {
  return unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0;
}

function modelFootprint(unit: BattleUnit, modelIndex = 0, rotationDeg = modelRotation(unit, modelIndex)) {
  return modelBaseFootprintInches(unit.profile, modelIndex, rotationDeg);
}

function maxModelBaseRadius(unit: BattleUnit): number {
  return battleUnitMaxBaseRadiusInches(unit);
}

function modelRadiiForProfile(profile: UnitProfile): number[] {
  return Array.from({ length: profile.baseModelCount }, (_, modelIndex) => modelBaseRadiusInches(profile, modelIndex));
}

// Returns the per-model spacing (diameter + gap) used for grid formations.
function gridModelSpacing(radii: number[]): number {
  return Math.max(...radii.map(r => r * 2), 1) + 0.08;
}

function playGridFormation(profile: UnitProfile, anchor: Position, side: Side): Position[] {
  const count = profile.baseModelCount;
  if (count <= 1) return [anchor];

  const spacing = gridModelSpacing(modelRadiiForProfile(profile));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const forward = side === 0 ? 1 : -1;
  const startY = anchor.y - ((rows - 1) * spacing) / 2;

  return Array.from({ length: count }, (_, modelIndex) => ({
    x: anchor.x + forward * (modelIndex % columns) * spacing,
    y: startY + Math.floor(modelIndex / columns) * spacing,
  }));
}

function playGridFormationByRows(profile: UnitProfile, center: Position, side: Side, rows: number, modelIndices?: number[]): Position[] {
  const indices = modelIndices?.length ? modelIndices : Array.from({ length: profile.baseModelCount }, (_, i) => i);
  const count = indices.length;
  if (count <= 1) return [center];

  const rowCount = Math.max(1, Math.min(rows, count));
  const columns = Math.ceil(count / rowCount);
  const spacing = gridModelSpacing(indices.map(i => modelBaseRadiusInches(profile, i)));
  const forward = side === 0 ? 1 : -1;
  const startX = center.x - forward * ((columns - 1) * spacing) / 2;
  const startY = center.y - ((rowCount - 1) * spacing) / 2;

  return Array.from({ length: count }, (_, modelIndex) => ({
    x: startX + forward * Math.floor(modelIndex / rowCount) * spacing,
    y: startY + (modelIndex % rowCount) * spacing,
  }));
}

function clampModelToBoard(point: Position, radius: number, zone?: ReturnType<typeof zoneFor>, board = boardFormatForId()): Position {
  const minX = zone ? zone.x0 + radius : radius;
  const maxX = zone ? zone.x1 - radius : board.width - radius;
  return {
    x: Math.min(maxX, Math.max(minX, point.x)),
    y: Math.min(board.height - radius, Math.max(radius, point.y)),
  };
}

function formationHasInternalOverlap(unit: BattleUnit): boolean {
  for (let i = 0; i < unit.modelPositions.length; i++) {
    for (let j = i + 1; j < unit.modelPositions.length; j++) {
      const minDistance = modelBaseRadius(unit, i) + modelBaseRadius(unit, j);
      if (dist(unit.modelPositions[i], unit.modelPositions[j]) < minDistance) return true;
    }
  }
  return false;
}

function resolveInternalModelOverlaps(unit: BattleUnit, zone?: ReturnType<typeof zoneFor>, board = boardFormatForId()): void {
  const positions = unit.modelPositions.map(p => ({ ...p }));

  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const radiusI = modelBaseRadius(unit, i);
        const radiusJ = modelBaseRadius(unit, j);
        const minDistance = radiusI + radiusJ + 0.02;
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const d = Math.hypot(dx, dy);
        if (d >= minDistance) continue;

        const angle = d > 0.001 ? Math.atan2(dy, dx) : ((i + j) % 8) * (Math.PI / 4);
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const push = (minDistance - Math.max(d, 0.001)) / 2;

        positions[i] = clampModelToBoard({ x: positions[i].x - ux * push, y: positions[i].y - uy * push }, radiusI, zone, board);
        positions[j] = clampModelToBoard({ x: positions[j].x + ux * push, y: positions[j].y + uy * push }, radiusJ, zone, board);
        changed = true;
      }
    }
    if (!changed) break;
  }

  unit.modelPositions = positions;
  unit.position = centroid(positions);
}

function formationOverlapsUnits(unit: BattleUnit, newCenter: Position, state: BattleState): boolean {
  const dx = newCenter.x - unit.position.x;
  const dy = newCenter.y - unit.position.y;
  for (const other of state.units) {
    if (other.id === unit.id || other.destroyed) continue;
    for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
      const model = unit.modelPositions[modelIndex];
      const shifted = { x: model.x + dx, y: model.y + dy };
      for (let otherModelIndex = 0; otherModelIndex < other.modelPositions.length; otherModelIndex++) {
        const otherModel = other.modelPositions[otherModelIndex];
        const minDistance = modelBaseRadius(unit, modelIndex) + modelBaseRadius(other, otherModelIndex);
        if (dist(shifted, otherModel) < minDistance) return true;
      }
    }
  }
  return false;
}

function avoidModelOverlap(unit: BattleUnit, desired: Position, state: BattleState): Position {
  if (!formationOverlapsUnits(unit, desired, state)) return desired;

  let best = unit.position;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const t = (lo + hi) / 2;
    const candidate = {
      x: unit.position.x + (desired.x - unit.position.x) * t,
      y: unit.position.y + (desired.y - unit.position.y) * t,
    };
    if (formationOverlapsUnits(unit, candidate, state)) {
      hi = t;
    } else {
      best = candidate;
      lo = t;
    }
  }

  return best;
}

function formationWithinBounds(unit: BattleUnit, center: Position, zone?: ReturnType<typeof zoneFor>, board = boardFormatForId()): boolean {
  const dx = center.x - unit.position.x;
  const dy = center.y - unit.position.y;
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const model = unit.modelPositions[modelIndex];
    const r = modelBaseRadius(unit, modelIndex);
    const x = model.x + dx;
    const y = model.y + dy;
    if (x < r || x > board.width - r || y < r || y > board.height - r) return false;
    if (zone && !pointInDeploymentZone({ x, y }, zone, r)) return false;
  }
  return true;
}

function avoidDeploymentOverlap(unit: BattleUnit, state: BattleState, zone: ReturnType<typeof zoneFor>): void {
  const board = boardFormatForState(state);
  if (
    !formationHasInternalOverlap(unit)
    && !formationOverlapsUnits(unit, unit.position, state)
    && formationWithinBounds(unit, unit.position, zone, board)
  ) return;

  for (let radius = 0.5; radius <= 14; radius += 0.5) {
    for (let ai = 0; ai < 24; ai++) {
      const angle = (ai / 24) * Math.PI * 2;
      const candidate = {
        x: unit.position.x + Math.cos(angle) * radius,
        y: unit.position.y + Math.sin(angle) * radius,
      };
      if (!formationWithinBounds(unit, candidate, zone, board)) continue;
      if (formationOverlapsUnits(unit, candidate, state)) continue;
      translateFormation(unit, candidate.x - unit.position.x, candidate.y - unit.position.y);
      return;
    }
  }
}

function featureBlocksMovementForUnit(feature: TerrainFeature, parent: Terrain, unit: BattleUnit): boolean {
  if (!feature.blocksMovement || hasKeyword(unit, 'fly')) return false;
  if (hasKeyword(unit, 'infantry') && parent.type === 'ruin') return false;
  if (hasKeyword(unit, 'infantry') && feature.featureHeight === 'low') return false;
  return true;
}

function terrainMatBlocksMovementForUnit(t: Terrain, unit: BattleUnit): boolean {
  if (hasKeyword(unit, 'fly')) return false;
  if (hasKeyword(unit, 'titanic')) return true;
  if (t.type === 'ruin' && hasAnyKeyword(unit, ['vehicle', 'monster'])) return true;
  return t.type === 'impassable';
}

function lineBlockedByMovement(from: Position, to: Position, terrain: Terrain[], unit: BattleUnit): boolean {
  for (const t of terrain) {
    if (terrainMatBlocksMovementForUnit(t, unit) && lineIntersectsTerrain(from, to, t)) return true;
    if (t.features.some(feature => featureBlocksMovementForUnit(feature, t, unit) && lineIntersectsTerrain(from, to, feature))) {
      return true;
    }
  }
  return false;
}

function terrainBlockerCorners(terrain: Terrain[], unit: BattleUnit): Position[] {
  const corners: Position[] = [];
  for (const t of terrain) {
    if (terrainMatBlocksMovementForUnit(t, unit)) corners.push(...terrainCorners(t));
    for (const feature of t.features) {
      if (featureBlocksMovementForUnit(feature, t, unit)) corners.push(...terrainCorners(feature));
    }
  }
  return corners;
}

function findReachablePosition(
  unit: BattleUnit,
  to: Position,
  maxInches: number,
  terrain: Terrain[],
  stopGap = 1.05,
): Position {
  const direct = moveToward(unit.position, to, maxInches, stopGap);
  if (!lineBlockedByMovement(unit.position, direct, terrain, unit)) return direct;

  const dToTarget = dist(unit.position, to);
  const corners = terrainBlockerCorners(terrain, unit);
  let best = unit.position;
  let bestScore = dist(unit.position, to);

  for (const corner of corners) {
    const away = dist(corner, unit.position);
    if (away < 0.01) continue;
    const pad = 1.25;
    const waypoint = {
      x: corner.x + ((corner.x - unit.position.x) / away) * pad,
      y: corner.y + ((corner.y - unit.position.y) / away) * pad,
    };
    const firstLeg = dist(unit.position, waypoint);
    if (firstLeg > maxInches || lineBlockedByMovement(unit.position, waypoint, terrain, unit)) continue;
    const remaining = maxInches - firstLeg;
    const secondLeg = moveToward(waypoint, to, remaining, stopGap);
    if (lineBlockedByMovement(waypoint, secondLeg, terrain, unit)) continue;
    const score = dist(secondLeg, to);
    if (score < bestScore) {
      best = secondLeg;
      bestScore = score;
    }
  }

  if (best !== unit.position) return best;

  const steps = Math.max(4, Math.ceil(dToTarget / 0.5));
  let lastClear = unit.position;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const candidate = {
      x: unit.position.x + (direct.x - unit.position.x) * t,
      y: unit.position.y + (direct.y - unit.position.y) * t,
    };
    if (lineBlockedByMovement(unit.position, candidate, terrain, unit)) break;
    lastClear = candidate;
  }
  return lastClear;
}

// Returns centroid of an array of positions
function centroid(positions: Position[]): Position {
  if (!positions.length) return { x: 0, y: 0 };
  return {
    x: positions.reduce((s, p) => s + p.x, 0) / positions.length,
    y: positions.reduce((s, p) => s + p.y, 0) / positions.length,
    z: positions.reduce((s, p) => s + (p.z ?? 0), 0) / positions.length,
  };
}

// How far the furthest model extends from the centroid along a given unit vector
function formationExtent(positions: Position[], ctr: Position, dir: { x: number; y: number }): number {
  return positions.reduce((maxE, p) => {
    const dot = (p.x - ctr.x) * dir.x + (p.y - ctr.y) * dir.y;
    return Math.max(maxE, dot);
  }, 0);
}

// Translate all model positions by (dx, dy) and return the new centroid
function translateFormation(unit: { position: Position; modelPositions: Position[] }, dx: number, dy: number): void {
  unit.modelPositions = unit.modelPositions.map(mp => ({ ...mp, x: mp.x + dx, y: mp.y + dy }));
  unit.position = { ...unit.position, x: unit.position.x + dx, y: unit.position.y + dy };
}

// After model loss, trim positions array and refresh centroid
function trimFormation(unit: { position: Position; modelPositions: Position[]; modelRotations?: number[]; remainingModels: number }): void {
  if (unit.modelPositions.length > unit.remainingModels) {
    unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
    unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
  }
  if (unit.modelPositions.length > 0) {
    unit.position = centroid(unit.modelPositions);
  }
}

function trimUnitModelState(unit: BattleUnit): void {
  trimFormation(unit);
  unit.movementAllowanceRemainingByModel = unit.movementAllowanceRemainingByModel?.slice(0, unit.remainingModels);
  unit.movementAllowanceTotalByModel = unit.movementAllowanceTotalByModel?.slice(0, unit.remainingModels);
  unit.movementStartPositionsByModel = unit.movementStartPositionsByModel?.slice(0, unit.remainingModels);
  unit.movementStartRotationsByModel = unit.movementStartRotationsByModel?.slice(0, unit.remainingModels);
  if (unit.woundedModelIndex !== undefined && unit.woundedModelIndex >= unit.remainingModels) {
    unit.woundedModelIndex = undefined;
    unit.woundsOnLeadModel = unit.remainingModels > 0 ? unit.profile.wounds : 0;
  }
}

// Removes specific model indices (sorted descending) from all per-model arrays on a unit.
function spliceModelIndices(unit: BattleUnit, sortedDescIndices: number[]): void {
  for (const i of sortedDescIndices) {
    if (unit.woundedModelIndex !== undefined) {
      if (unit.woundedModelIndex === i) {
        unit.woundedModelIndex = undefined;
        unit.woundsOnLeadModel = unit.profile.wounds;
      } else if (unit.woundedModelIndex > i) {
        unit.woundedModelIndex -= 1;
      }
    }
    unit.modelPositions.splice(i, 1);
    unit.modelRotations?.splice(i, 1);
    unit.movementAllowanceRemainingByModel?.splice(i, 1);
    unit.movementAllowanceTotalByModel?.splice(i, 1);
    unit.movementStartPositionsByModel?.splice(i, 1);
    unit.movementStartRotationsByModel?.splice(i, 1);
  }
}

function modelWeaponLoadout(profile: UnitProfile, modelIndex: number): number[] {
  const configured = profile.modelWeaponLoadouts?.[modelIndex];
  if (configured?.length) {
    return configured.filter(weaponIndex => weaponIndex >= 0 && weaponIndex < profile.weapons.length);
  }
  return profile.weapons.map((_, weaponIndex) => weaponIndex);
}

// Counts models in the unit that carry weaponIndex and optionally have LOS to the defender.
// Pass defender + terrain to restrict to models with edge-to-edge LOS (ranged, non-Indirect Fire weapons).
function aliveWeaponModelCount(
  unit: BattleUnit,
  weaponIndex: number,
  defender?: BattleUnit,
  terrain?: Terrain[],
): number {
  let count = 0;
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    if (!modelWeaponLoadout(unit.profile, modelIndex).some(i => i === weaponIndex)) continue;
    if (defender && terrain) {
      const fromCenter = unit.modelPositions[modelIndex];
      if (!fromCenter) continue;
      const fromRadius = modelBaseRadius(unit, modelIndex);
      const canSee = defender.modelPositions.some((toCenter, ti) =>
        hasLOSEdgeToEdge(fromCenter, fromRadius, toCenter, modelBaseRadius(defender, ti), terrain),
      );
      if (!canSee) continue;
    }
    count++;
  }
  return count;
}

function weaponIsSidearm(weapon: WeaponProfile): boolean {
  return weaponHasKeyword(weapon, 'Pistol') || weaponHasKeyword(weapon, 'Sidearm');
}

function weaponProfileGroup(weapon: WeaponProfile): string | null {
  const group = weapon.profileGroup?.trim();
  return group ? group.toLowerCase() : null;
}

function chooseOneProfilePerGroup<T extends { weapon: WeaponProfile }>(weapons: T[]): T[] {
  const usedGroups = new Set<string>();
  return weapons.filter(option => {
    const group = weaponProfileGroup(option.weapon);
    if (!group) return true;
    if (usedGroups.has(group)) return false;
    usedGroups.add(group);
    return true;
  });
}


// True if the shooter model (at fromCenter with fromRadius) has edge-to-edge LOS
// to at least one model in the target unit.
function hasAnyModelLOS(
  fromCenter: Position, fromRadius: number,
  target: BattleUnit,
  terrain: Terrain[],
): boolean {
  return target.modelPositions.some((toCenter, i) =>
    hasLOSEdgeToEdge(fromCenter, fromRadius, toCenter, modelBaseRadius(target, i), terrain),
  );
}

function participatingWeaponModelCount(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  terrain: Terrain[],
): number {
  const needsLOS = !weapon.isMelee && !weaponHasKeyword(weapon, 'Indirect Fire');
  return needsLOS
    ? aliveWeaponModelCount(attacker, weaponIndex, defender, terrain)
    : aliveWeaponModelCount(attacker, weaponIndex);
}

function terrainIsWoods(t: Terrain): boolean {
  return t.type === 'area' && /woods?|forest/i.test(t.name);
}

function terrainIsCraterOrRubble(t: Terrain): boolean {
  return t.type === 'area' && /crater|rubble/i.test(t.name);
}

function modelWhollyWithinTerrain(unit: BattleUnit, modelIndex: number, terrain: Terrain): boolean {
  const model = unit.modelPositions[modelIndex];
  if (!model) return false;
  return circleFullyInTerrain(model, modelBaseRadius(unit, modelIndex), terrain);
}

function modelHasCoverFromTerrainFootprint(unit: BattleUnit, modelIndex: number, terrain: Terrain): boolean {
  if (!terrain.providesCover || !modelWhollyWithinTerrain(unit, modelIndex, terrain)) return false;
  if (terrain.type === 'ruin' || terrainIsWoods(terrain)) return true;
  if (terrainIsCraterOrRubble(terrain)) return unitHasKeyword(unit, 'Infantry');
  return terrain.type === 'area';
}

function terrainFootprintObscures(from: Position, to: Position, terrain: Terrain): boolean {
  if (!terrain.providesCover) return false;
  if (terrain.type === 'ruin' || terrainIsWoods(terrain)) return linePassesThroughTerrain(from, to, terrain);
  if (terrain.type === 'impassable') return lineIntersectsTerrain(from, to, terrain);
  return false;
}

function modelHasTerrainCoverFrom(from: Position, target: BattleUnit, modelIndex: number, terrain: Terrain[]): boolean {
  const modelPos = target.modelPositions[modelIndex];
  if (!modelPos) return false;
  return terrain.some(t =>
    modelHasCoverFromTerrainFootprint(target, modelIndex, t)
    || terrainFootprintObscures(from, modelPos, t)
    || t.features.some(f => linePassesThroughTerrain(from, modelPos, f)),
  );
}

function targetHasTerrainCoverFrom(shooterPositions: Position[], target: BattleUnit, terrain: Terrain[]): boolean {
  return target.modelPositions.some((_, modelIndex) =>
    shooterPositions.some(from => modelHasTerrainCoverFrom(from, target, modelIndex, terrain)),
  );
}

function unitIsTransportProfile(profile: UnitProfile): boolean {
  return Math.max(0, Math.floor(profile.transportCapacity ?? 0)) > 0
    || profile.keywords.some(keyword => keyword.toLowerCase() === 'transport')
    || profile.factionKeywords.some(keyword => keyword.toLowerCase() === 'transport');
}

function transportCapacity(unit: BattleUnit): number {
  return Math.max(0, Math.floor(unit.profile.transportCapacity ?? 0));
}

function embarkedUnitsForTransport(state: BattleState, transportUnitId: string): BattleUnit[] {
  return state.units.filter(unit => !unit.destroyed && unit.embarkedInUnitId === transportUnitId);
}

function transportUsedCapacity(state: BattleState, transportUnitId: string): number {
  return embarkedUnitsForTransport(state, transportUnitId)
    .reduce((total, unit) => total + unit.remainingModels, 0);
}

export function transportCapacityRemaining(state: BattleState, transportUnitId: string): number {
  const transport = state.units.find(unit => unit.id === transportUnitId && !unit.destroyed);
  if (!transport) return 0;
  return Math.max(0, transportCapacity(transport) - transportUsedCapacity(state, transportUnitId));
}

export function playTransportPassengers(state: BattleState, transportUnitId: string): BattleUnit[] {
  return embarkedUnitsForTransport(state, transportUnitId);
}

function everyModelWithinRange(unit: BattleUnit, target: BattleUnit, range: number): boolean {
  return unit.modelPositions.every(model =>
    target.modelPositions.some(targetModel => dist(model, targetModel) <= range),
  );
}

function nearestFriendlyTransportInRange(state: BattleState, unit: BattleUnit, range: number): BattleUnit | null {
  const candidates = state.units.filter(candidate =>
    candidate.side === unit.side
    && candidate.id !== unit.id
    && !candidate.destroyed
    && !candidate.embarkedInUnitId
    && unitIsTransportProfile(candidate.profile)
    && transportCapacityRemaining(state, candidate.id) >= unit.remainingModels
    && everyModelWithinRange(unit, candidate, range)
  );
  return nearest(unit, candidates);
}

// ─── Unit queries ─────────────────────────────────────────────────────────────

function enemies(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(u => u.side !== side && !u.destroyed && !u.embarkedInUnitId && !u.inStrategicReserves);
}

function nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null {
  if (!targets.length) return null;
  return targets.reduce((best, t) =>
    dist(unit.position, t.position) < dist(unit.position, best.position) ? t : best,
  );
}

function modelBaseEdgeDistance3d(
  aModel: Position,
  aFootprint: ReturnType<typeof modelFootprint>,
  bModel: Position,
  bFootprint: ReturnType<typeof modelFootprint>,
): number {
  const horizontal = baseFootprintDistance(aModel, aFootprint, bModel, bFootprint);
  const vertical = verticalDistance(aModel, bModel);
  return Math.hypot(horizontal, vertical);
}

function modelBaseEdgeHorizontalDistance(
  aUnit: BattleUnit,
  aModelIndex: number,
  bUnit: BattleUnit,
  bModelIndex: number,
): number {
  return baseFootprintDistance(
    aUnit.modelPositions[aModelIndex],
    modelFootprint(aUnit, aModelIndex),
    bUnit.modelPositions[bModelIndex],
    modelFootprint(bUnit, bModelIndex),
  );
}

function modelsWithinEngagementRange(
  aModel: Position,
  aFootprint: ReturnType<typeof modelFootprint>,
  bModel: Position,
  bFootprint: ReturnType<typeof modelFootprint>,
  horizontalRange: number,
): boolean {
  return baseFootprintDistance(aModel, aFootprint, bModel, bFootprint) <= horizontalRange
    && verticalDistance(aModel, bModel) <= COHERENCY_VERTICAL_RANGE;
}

function inEngagement(unit: BattleUnit, others: BattleUnit[], range: number): boolean {
  return others.some(o =>
    unit.modelPositions.some((mp, mi) =>
      o.modelPositions.some((op, oi) =>
        modelsWithinEngagementRange(mp, modelFootprint(unit, mi), op, modelFootprint(o, oi), range),
      ),
    ),
  );
}

function engagedEnemies(state: BattleState, unit: BattleUnit, rules: RulesEdition): BattleUnit[] {
  const eng = rules.engagementRange();
  return enemies(state, unit.side).filter(enemy => inEngagement(unit, [enemy], eng));
}

function nonAircraftEngagedEnemies(state: BattleState, unit: BattleUnit, rules: RulesEdition): BattleUnit[] {
  return engagedEnemies(state, unit, rules).filter(enemy => !isAircraft(enemy));
}

function targetWithinFriendlyEngagement(state: BattleState, target: BattleUnit, side: Side, rules: RulesEdition): boolean {
  const eng = rules.engagementRange();
  return inEngagement(target, activeUnits(state, side), eng);
}

function unitCanChargeTarget(unit: BattleUnit, target: BattleUnit): boolean {
  if (isAircraft(unit)) return false;
  if (isAircraft(target) && !hasKeyword(unit, 'fly')) return false;
  return true;
}

function unitCanFightTarget(unit: BattleUnit, target: BattleUnit): boolean {
  if (isAircraft(unit)) return hasKeyword(target, 'fly');
  if (isAircraft(target)) return hasKeyword(unit, 'fly');
  return true;
}

function attachedBodyguardAlive(state: BattleState, unit: BattleUnit): boolean {
  if (!unit.attachedToUnitId) return false;
  return state.units.some(candidate =>
    candidate.id === unit.attachedToUnitId
    && candidate.side === unit.side
    && !candidate.destroyed
    && candidate.remainingModels > 0,
  );
}

function attachedUnitGroup(state: BattleState, unit: BattleUnit): BattleUnit[] {
  const bodyguardId = unit.attachedToUnitId ?? unit.id;
  const bodyguard = state.units.find(candidate =>
    candidate.id === bodyguardId
    && candidate.side === unit.side
    && !candidate.destroyed
    && candidate.remainingModels > 0,
  );
  if (!bodyguard) return [unit];

  return state.units.filter(candidate =>
    candidate.side === unit.side
    && !candidate.destroyed
    && candidate.remainingModels > 0
    && (candidate.id === bodyguard.id || candidate.attachedToUnitId === bodyguard.id),
  );
}

function attachedUnitKeywordSet(state: BattleState, unit: BattleUnit): Set<string> {
  const keywords = new Set<string>();
  for (const groupUnit of attachedUnitGroup(state, unit)) {
    for (const keyword of [...groupUnit.profile.keywords, ...groupUnit.profile.factionKeywords]) {
      keywords.add(keyword.toLowerCase());
    }
  }
  return keywords;
}

// ─── Combat resolution ────────────────────────────────────────────────────────

function defensiveToughness(unit: BattleUnit): number {
  return Math.max(
    unit.profile.toughness,
    ...(unit.profile.modelProfiles?.map(profile => profile.toughness) ?? []),
  );
}

function antiKeywordThreshold(weapon: WeaponProfile, defender: BattleUnit, state: BattleState): number | null {
  for (const keyword of weapon.keywords) {
    const match = keyword.match(/^anti[-\s]+(.+?)\s+([2-6])\+$/i);
    if (!match) continue;
    const targetKeyword = match[1].trim().toLowerCase();
    if (attachedUnitKeywordSet(state, defender).has(targetKeyword)) return Number.parseInt(match[2], 10);
  }
  return null;
}

function processWoundsAgainstDefender(
  rolls: number[],
  woundTarget: number,
  weapon: WeaponProfile,
  defender: BattleUnit,
  rules: RulesEdition,
  state: BattleState,
): { wounds: number; rolls: number[]; mortalsFromCrits: number; devastatingWounds: number; logNote: string } {
  const antiThreshold = antiKeywordThreshold(weapon, defender, state);
  if (antiThreshold === null) return rules.processWounds(rolls, woundTarget, weapon);

  let wounds = 0;
  let devastatingWounds = 0;
  const notes: string[] = [];
  const hasDevastatingWounds = weaponHasKeyword(weapon, 'Devastating Wounds');

  for (const roll of rolls) {
    if (roll === 1) continue;
    const critical = roll === 6 || roll >= antiThreshold;
    if (critical) {
      if (hasDevastatingWounds) devastatingWounds++;
      else wounds++;
    } else if (roll >= woundTarget) {
      wounds++;
    }
  }

  notes.push(`Anti ${antiThreshold}+ critical wounds`);
  if (hasDevastatingWounds && devastatingWounds > 0) notes.push('critical wound->no save (Devastating Wounds)');

  return { wounds, rolls, mortalsFromCrits: 0, devastatingWounds, logNote: notes.join('; ') };
}

function resolveAttacks(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  state: BattleState,
  hasCover: boolean,
  hitModifier = 0,
  hitModifierNote = '',
  options: { deferCasualties?: boolean; snapShooting?: boolean; attackCountOverride?: number } = {},
): LogEntry[] {
  const logs: LogEntry[] = [];
  const rangeDistance = weapon.isMelee
    ? dist(attacker.position, defender.position)
    : battleUnitsBaseEdgeDistance(attacker, defender);

  const weaponModelCount = participatingWeaponModelCount(attacker, defender, weapon, weaponIndex, state.terrain);
  if (weaponModelCount <= 0) return logs;
  const isVariableAttacks = !/^\d+$/i.test(String(weapon.attacks).trim());
  const perModelRolls: number[] = [];
  for (let i = 0; i < weaponModelCount; i++) {
    perModelRolls.push(rollExpression(weapon.attacks).total);
  }
  let numAttacks = options.attackCountOverride ?? perModelRolls.reduce((a, b) => a + b, 0);
  if (options.attackCountOverride === undefined) {
    numAttacks = rules.modifyAttackCount(numAttacks, attacker, weapon, rangeDistance, defender.remainingModels);
  }

  if (numAttacks <= 0) return logs;

  logs.push(log(state, attacker.side, attacker.profile.name,
    `  ${weapon.isMelee ? '⚔️' : '🔫'} ${weapon.name} — ${weaponModelCount} model(s) × ${weapon.attacks} = ${numAttacks} attacks vs ${defender.profile.name}`,
    weapon.isMelee ? 'fight' : 'shoot',
  ));
  logs.push(log(state, attacker.side, attacker.profile.name,
    `[combat-stats] skill=${weapon.skill} s=${weapon.strength} ap=${weapon.ap} d=${weapon.damage} t=${defensiveToughness(defender)}${hasCover ? ' cover=1' : ''}`,
    'info',
  ));
  if (options.attackCountOverride !== undefined) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Split melee attacks: ${options.attackCountOverride} attack(s) declared against ${defender.profile.name}`,
      'info',
    ));
  }
  if (isVariableAttacks) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Attack rolls (${weapon.attacks}): [${perModelRolls.join(', ')}] = ${numAttacks} attacks`,
      'roll',
    ));
  }

  // ── Hit rolls ──────────────────────────────────────────────────────────────
  const isTorrent = weaponHasKeyword(weapon, 'Torrent');
  if (options.snapShooting && !isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name, '     Snap Shooting: unmodified 6s to hit; hit rolls cannot be re-rolled', 'info'));
  } else if (hitModifierNote && !isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name, `     ${hitModifierNote}`, 'info'));
  }
  let hitResult = { hits: numAttacks, rolls: [] as number[], mortalsFromCrits: 0, logNote: 'Torrent - auto-hits' };
  let lethalAutoWounds = 0;
  if (isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Torrent: ${numAttacks} auto-hit(s)`,
      'roll',
    ));
  } else {
  const hitRolls = rollMultiple(numAttacks);
  const hitTarget = options.snapShooting ? 6 : Math.min(6, Math.max(2, weapon.skill + hitModifier));
  hitResult = rules.processHits(hitRolls, hitTarget, weapon);
  lethalAutoWounds = weaponHasKeyword(weapon, 'Lethal Hits')
    ? hitRolls.filter(roll => roll === 6).length
    : 0;
  weapon = { ...weapon, skill: hitTarget };
  const noteHit = hitResult.logNote ? ` [${hitResult.logNote}]` : '';
  logs.push(log(state, attacker.side, attacker.profile.name,
    `     Hit rolls (${weapon.skill}+): [${hitRolls.join(', ')}] → ${hitResult.hits} hits${noteHit}`,
    'roll',
  ));

  }

  // Mortal wounds from critical hits (e.g. Deadly Demise)
  let totalMortals = hitResult.mortalsFromCrits;
  let devastatingWounds = 0;

  if (hitResult.hits === 0 && totalMortals === 0) return logs;

  // ── Wound rolls ───────────────────────────────────────────────────────────
  const targetToughness = defensiveToughness(defender);
  const wt = rules.woundTarget(weapon.strength, targetToughness);
  let woundCount = 0;
  if (lethalAutoWounds > 0) {
    woundCount += lethalAutoWounds;
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Lethal Hits: ${lethalAutoWounds} critical hit(s) auto-wound`,
      'roll',
    ));
  }
  const woundRollCount = Math.max(0, hitResult.hits - lethalAutoWounds);

  if (woundRollCount > 0) {
    const woundRolls = rollMultiple(woundRollCount);
    const woundResult = processWoundsAgainstDefender(woundRolls, wt, weapon, defender, rules, state);
    const noteWound = woundResult.logNote ? ` [${woundResult.logNote}]` : '';
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Wound rolls (S${weapon.strength} vs T${targetToughness}, ${wt}+): [${woundRolls.join(', ')}] → ${woundResult.wounds} wounds${noteWound}`,
      'roll',
    ));
    woundCount += woundResult.wounds;
    totalMortals += woundResult.mortalsFromCrits;
    devastatingWounds += woundResult.devastatingWounds;
    const failedWounds = woundRollCount - woundResult.wounds - woundResult.mortalsFromCrits - woundResult.devastatingWounds;
    if (failedWounds > 0 && weaponHasKeyword(weapon, 'Twin-linked')) {
      const rerollWounds = rollMultiple(failedWounds);
      const rerollResult = processWoundsAgainstDefender(rerollWounds, wt, weapon, defender, rules, state);
      const noteReroll = rerollResult.logNote ? ` [${rerollResult.logNote}]` : '';
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Twin-linked wound rerolls (${wt}+): [${rerollWounds.join(', ')}] -> ${rerollResult.wounds} wounds${noteReroll}`,
        'roll',
      ));
      woundCount += rerollResult.wounds;
      totalMortals += rerollResult.mortalsFromCrits;
      devastatingWounds += rerollResult.devastatingWounds;
    }
  }

  // ── Save rolls ────────────────────────────────────────────────────────────
  let unsaved = 0;
  if (woundCount > 0) {
    const coverBonus = hasCover && !weaponHasKeyword(weapon, 'Ignores Cover')
      ? rules.coverSaveBonus(defender)
      : 0;
    const rawSave = rules.saveTarget(defender.profile.save, weapon.ap, defender.profile.invulnSave);
    const effectiveSave = rawSave - coverBonus;
    const coverNote = coverBonus > 0 ? `, cover +${coverBonus}` : '';

    if (effectiveSave > 6) {
      logs.push(log(state, defender.side, defender.profile.name,
        `     No save possible (${defender.profile.save}+ vs AP${weapon.ap})`,
        'roll',
      ));
      unsaved = woundCount;
    } else {
      const saveRolls = rollMultiple(woundCount);
      const saved = countSuccesses(saveRolls, effectiveSave);
      unsaved = woundCount - saved;
      logs.push(log(state, defender.side, defender.profile.name,
        `     Save rolls (${effectiveSave}+${coverNote}): [${saveRolls.join(', ')}] → ${saved} saved, ${unsaved} failed`,
        'roll',
      ));
    }
  }

  // ── Damage application ────────────────────────────────────────────────────
  const meltaBonus = weaponHasKeyword(weapon, 'Melta') && rangeDistance <= weapon.range / 2
      ? weaponKeywordValue(weapon, 'Melta')
      : 0;
  if (unsaved > 0 || devastatingWounds > 0) {
    if (meltaBonus > 0) {
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Melta: +${meltaBonus} damage within half range`,
        'damage',
      ));
    }
  }
  if (unsaved > 0) {
    const isVariableDamage = !/^\d+$/i.test(String(weapon.damage).trim());
    for (let i = 0; i < unsaved; i++) {
      const effectiveRemaining = defender.remainingModels - (defender.pendingCasualties ?? 0);
      if (effectiveRemaining <= 0 || defender.destroyed) break;
      const dmgResult = rollExpression(weapon.damage);
      if (isVariableDamage) {
        logs.push(log(state, attacker.side, attacker.profile.name,
          `     Damage roll (${weapon.damage}): [${dmgResult.rolls.join(', ')}] = ${dmgResult.total}`,
          'roll',
        ));
      }
      logs.push(...applyDamage(defender, dmgResult.total + meltaBonus, state, attacker.side, {
        ...options,
        noCarryOver: true,
        source: weapon.name,
        sourceUnitId: attacker.id,
        sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
      }));
    }
  }

  if (devastatingWounds > 0) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Devastating Wounds: ${devastatingWounds} wound(s) bypass saves`,
      'damage',
    ));
    const isVariableDamage = !/^\d+$/i.test(String(weapon.damage).trim());
    for (let i = 0; i < devastatingWounds; i++) {
      const effectiveRemaining = defender.remainingModels - (defender.pendingCasualties ?? 0);
      if (effectiveRemaining <= 0 || defender.destroyed) break;
      const dmgResult = rollExpression(weapon.damage);
      if (isVariableDamage) {
        logs.push(log(state, attacker.side, attacker.profile.name,
          `     Damage roll (${weapon.damage}): [${dmgResult.rolls.join(', ')}] = ${dmgResult.total}`,
          'roll',
        ));
      }
      logs.push(...applyDamage(defender, dmgResult.total + meltaBonus, state, attacker.side, {
        ...options,
        noCarryOver: true,
        source: weapon.name,
        sourceUnitId: attacker.id,
        sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
      }));
    }
  }

  // ── Mortal wounds ─────────────────────────────────────────────────────────
  if (totalMortals > 0) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     +${totalMortals} mortal wound(s)`,
      'damage',
    ));
    logs.push(...applyDamage(defender, totalMortals, state, attacker.side, {
      ...options,
      source: 'mortal wounds',
      sourceUnitId: attacker.id,
      sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
    }));
  }

  return logs;
}

export function applyDamage(
  unit: BattleUnit,
  totalDamage: number,
  state: BattleState,
  attackerSide: Side,
  options: {
    deferCasualties?: boolean;
    noCarryOver?: boolean;
    source?: string;
    sourceUnitId?: string;
    sourceObjectiveIndexesWithinRange?: number[];
  } = {},
): LogEntry[] {
  const logs: LogEntry[] = [];
  if (options.deferCasualties) {
    unit.pendingDamageAllocations = [
      ...(unit.pendingDamageAllocations ?? []),
      {
        damage: totalDamage,
        noCarryOver: options.noCarryOver,
        source: options.source,
        ...(options.sourceUnitId ? { sourceUnitId: options.sourceUnitId } : {}),
        ...(options.sourceObjectiveIndexesWithinRange
          ? { sourceObjectiveIndexesWithinRange: options.sourceObjectiveIndexesWithinRange }
          : {}),
      },
    ];
    logs.push(log(state, attackerSide, unit.profile.name,
      `  ${unit.profile.name}: allocate ${totalDamage} damage${options.source ? ` from ${options.source}` : ''}`,
      'damage',
    ));
    return logs;
  }

  const feelNoPain = applyFeelNoPain(unit, totalDamage, state);
  logs.push(...feelNoPain.logs);
  totalDamage = feelNoPain.damage;

  let remaining = totalDamage;
  let killed = 0;
  let simulatedModels = unit.remainingModels - (unit.pendingCasualties ?? 0);
  let simulatedLeadWounds = unit.woundedModelIndex !== undefined
    ? unit.woundsOnLeadModel
    : unit.pendingWoundAssignment?.woundsOnModel ?? unit.profile.wounds;

  if (options.noCarryOver) {
    // Each unsaved wound's damage is capped at the current lead model's remaining wounds;
    // excess is discarded rather than spilling to the next model.
    if (simulatedModels > 0) {
      if (remaining >= simulatedLeadWounds) {
        killed++;
        simulatedModels--;
        simulatedLeadWounds = unit.profile.wounds;
      } else {
        simulatedLeadWounds -= remaining;
      }
    }
  } else {
    // Mortal wounds carry over: drain the lead model, then continue onto the next.
    while (remaining > 0 && simulatedModels > 0) {
      if (remaining >= simulatedLeadWounds) {
        remaining -= simulatedLeadWounds;
        simulatedModels--;
        killed++;
        simulatedLeadWounds = unit.profile.wounds;
      } else {
        simulatedLeadWounds -= remaining;
        remaining = 0;
      }
    }
  }

  if (options.deferCasualties) {
    if (killed > 0) unit.pendingCasualties = (unit.pendingCasualties ?? 0) + killed;
    if (simulatedModels <= 0) {
      unit.woundedModelIndex = undefined;
      unit.pendingWoundAssignment = undefined;
      unit.woundsOnLeadModel = 0;
    } else if (simulatedLeadWounds < unit.profile.wounds) {
      if (unit.woundedModelIndex !== undefined) {
        unit.woundsOnLeadModel = simulatedLeadWounds;
        unit.pendingWoundAssignment = undefined;
      } else {
        unit.pendingWoundAssignment = { woundsOnModel: simulatedLeadWounds };
        unit.woundsOnLeadModel = unit.profile.wounds;
      }
    } else if (unit.woundedModelIndex === undefined) {
      unit.pendingWoundAssignment = undefined;
      unit.woundsOnLeadModel = unit.profile.wounds;
    }
  } else {
    unit.remainingModels = simulatedModels;
    unit.woundsOnLeadModel = simulatedModels > 0 ? simulatedLeadWounds : 0;
    unit.woundedModelIndex = unit.woundsOnLeadModel > 0 && unit.woundsOnLeadModel < unit.profile.wounds ? 0 : undefined;
    unit.pendingWoundAssignment = undefined;
    if (killed > 0) trimUnitModelState(unit);
  }

  const effectiveRemaining = options.deferCasualties
    ? unit.remainingModels - (unit.pendingCasualties ?? 0)
    : unit.remainingModels;
  if (killed > 0 && effectiveRemaining <= 0 && !options.deferCasualties) {
    unit.destroyed = true;
    recordDestroyedUnitMissionEvent(state, unit, attackerSide, {
      destroyedByUnitId: options.sourceUnitId,
      destroyingUnitObjectiveIndexesWithinRange: options.sourceObjectiveIndexesWithinRange,
    });
    logs.push(log(state, attackerSide, unit.profile.name,
      `  💀 ${unit.profile.name} DESTROYED`,
      'death',
    ));
    logs.push(...emergencyDisembarkDestroyedTransport(state, unit, attackerSide));
  } else if (killed > 0) {
    logs.push(log(state, attackerSide, unit.profile.name,
      options.deferCasualties
        ? `  ⚠️  ${unit.profile.name}: ${killed} model(s) slain - select ${unit.pendingCasualties} casualty model${unit.pendingCasualties === 1 ? '' : 's'} to remove`
        : `  ⚠️  ${unit.profile.name}: ${killed} model(s) slain (${unit.remainingModels}/${unit.profile.baseModelCount} remain)`,
      'damage',
    ));
  } else if (totalDamage > 0) {
    logs.push(log(state, attackerSide, unit.profile.name,
      `  🩸 ${unit.profile.name}: ${totalDamage} damage absorbed (${unit.woundsOnLeadModel}W left on lead model)`,
      'damage',
    ));
  }

  return logs;
}

// ─── Phase simulators ─────────────────────────────────────────────────────────

function destroyPassengerModels(unit: BattleUnit, destroyedModels: number): void {
  if (destroyedModels <= 0) return;
  unit.remainingModels = Math.max(0, unit.remainingModels - destroyedModels);
  unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
  unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
  unit.movementAllowanceRemainingByModel = unit.movementAllowanceRemainingByModel?.slice(0, unit.remainingModels);
  unit.movementAllowanceTotalByModel = unit.movementAllowanceTotalByModel?.slice(0, unit.remainingModels);
  unit.movementStartPositionsByModel = unit.movementStartPositionsByModel?.slice(0, unit.remainingModels);
  if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
    unit.destroyed = true;
    unit.remainingModels = 0;
    unit.modelPositions = [];
    unit.modelRotations = [];
    unit.movementAllowanceRemaining = 0;
    unit.movementAllowanceRemainingByModel = [];
    unit.movementAllowanceTotalByModel = [];
    unit.movementStartPositionsByModel = [];
    unit.movementStartRotationsByModel = [];
  } else {
    unit.position = centroid(unit.modelPositions);
    unit.woundsOnLeadModel = Math.min(unit.woundsOnLeadModel, unit.profile.wounds);
  }
}

function emergencyDisembarkDestroyedTransport(
  state: BattleState,
  transport: BattleUnit,
  attackerSide: Side,
): LogEntry[] {
  if (!unitIsTransportProfile(transport.profile)) return [];
  const logs: LogEntry[] = [];
  const side = transport.side;
  const existingPassengers = embarkedUnitsForTransport(state, transport.id);
  const existingPassengerProfileIds = new Set(existingPassengers.map(unit => unitRosterId(unit.profile)));
  const stagedPassengerProfiles = state.armies[side].army.units.filter(profile =>
    unitAssignedToTransport(profile, transport)
    && !existingPassengerProfileIds.has(unitRosterId(profile))
    && !state.units.some(unit => unit.side === side && !unit.destroyed && unitRosterId(unit.profile) === unitRosterId(profile))
  );
  const passengers: BattleUnit[] = [
    ...existingPassengers,
    ...stagedPassengerProfiles.map(profile => makeBattleUnit(profile, side, [{ ...transport.position }])),
  ];

  for (const passenger of passengers) {
    const existingPassenger = state.units.find(unit => unit.id === passenger.id);
    const unit = existingPassenger ?? passenger;
    const positions = disembarkPositions(state, transport, unit.profile);
    if (!positions) {
      unit.embarkedInUnitId = undefined;
      unit.destroyed = true;
      unit.remainingModels = 0;
      unit.modelPositions = [];
      if (!existingPassenger) state.units.push(unit);
      recordDestroyedUnitMissionEvent(state, unit, attackerSide);
      logs.push(log(state, attackerSide, unit.profile.name,
        `${unit.profile.name} cannot disembark from the destroyed ${transport.profile.name} and is destroyed.`,
        'death',
      ));
      continue;
    }

    unit.embarkedInUnitId = undefined;
    unit.modelPositions = positions;
    unit.modelRotations = positions.map(() => side === 0 ? 0 : 180);
    unit.remainingModels = Math.min(unit.remainingModels || unit.profile.baseModelCount, positions.length);
    unit.position = centroid(unit.modelPositions);
    unit.movementAction = 'normalMove';
    unit.movementAllowanceRemaining = 0;
    unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
    unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
    unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
    unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
    unit.movementComplete = true;
    unit.battleshocked = true;
    unit.emergencyDisembarkedThisTurn = true;
    unit.inCombat = false;
    if (!existingPassenger) state.units.push(unit);

    const rolls = unit.modelPositions.map(() => d6());
    const destroyedModels = rolls.filter(roll => roll === 1).length;
    const wasDestroyed = unit.destroyed;
    destroyPassengerModels(unit, destroyedModels);
    if (!wasDestroyed && unit.destroyed) recordDestroyedUnitMissionEvent(state, unit, attackerSide);
    logs.push(log(state, attackerSide, unit.profile.name,
      `${unit.profile.name} emergency disembarks from ${transport.profile.name}; rolls ${rolls.join(', ')}${destroyedModels ? `; ${destroyedModels} model${destroyedModels === 1 ? '' : 's'} destroyed` : '; no models destroyed'}.`,
      destroyedModels && unit.destroyed ? 'death' : 'roll',
    ));
  }

  return logs;
}

function runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side);
  if (inEngagement(unit, foes, eng)) {
    unit.inCombat = true;
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds (already in melee)`,
      'move',
    )];
  }

  const target = nearest(unit, foes);
  if (!target) return [];

  const ranged = unit.profile.weapons.filter(w => !w.isMelee && w.range > 0);
  const maxRange = ranged.length ? Math.max(...ranged.map(w => w.range)) : 0;
  const d = dist(unit.position, target.position);

  if (d <= maxRange && d > eng) {
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds position (${d.toFixed(1)}" from ${target.profile.name}, in range)`,
      'move',
    )];
  }

  // Formation-aware stop gap: front models stop at exactly engagementRange from target's back models
  const dirX = d > 0 ? (target.position.x - unit.position.x) / d : 1;
  const dirY = d > 0 ? (target.position.y - unit.position.y) / d : 0;
  const myExtent   = formationExtent(unit.modelPositions,   unit.position,   { x: dirX,  y: dirY  });
  const tgtExtent  = formationExtent(target.modelPositions, target.position, { x: -dirX, y: -dirY });
  const stopGap = eng + myExtent + tgtExtent + 0.05;

  const reachablePos = findReachablePosition(unit, target.position, unit.profile.move, state.terrain, stopGap);
  const newPos = avoidModelOverlap(unit, reachablePos, state);
  const moved = dist(unit.position, newPos);
  if (moved < 0.01) return [log(state, unit.side, unit.profile.name,
    `  📍 ${unit.profile.name} holds (already in engagement range)`,
    'move',
  )];

  translateFormation(unit, newPos.x - unit.position.x, newPos.y - unit.position.y);
  cancelUnitAction(state, unit, 'it made a move');

  resolveInternalModelOverlaps(unit);
  unit.position = centroid(unit.modelPositions);

  return [log(state, unit.side, unit.profile.name,
    `  🚶 ${unit.profile.name} moves ${moved.toFixed(1)}" toward ${target.profile.name} (${dist(unit.position, target.position).toFixed(1)}" away)`,
    'move',
  )];
}


function unitHasKeyword(unit: BattleUnit, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return unit.profile.keywords.some(candidate => candidate.toLowerCase() === needle);
}

function unitHasDatasheetRule(unit: BattleUnit, ruleName: string): boolean {
  return unitHasRule(unit.profile, ruleName);
}

function datasheetRuleText(unit: BattleUnit): string[] {
  return [
    ...unit.profile.keywords,
    ...unit.profile.factionKeywords,
    ...(unit.profile.abilities ?? []).flatMap(rule => [rule.name, rule.description]),
    ...(unit.profile.rules ?? []).flatMap(rule => [rule.name, rule.description]),
  ].filter(Boolean);
}

function feelNoPainTarget(unit: BattleUnit): number | null {
  for (const text of datasheetRuleText(unit)) {
    const match = text.match(/feel\s+no\s+pain(?:\s*\(?\s*)?([2-6])\+/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function applyFeelNoPain(
  unit: BattleUnit,
  damage: number,
  state: BattleState,
): { damage: number; logs: LogEntry[] } {
  const target = feelNoPainTarget(unit);
  if (!target || damage <= 0) return { damage, logs: [] };

  const rolls = rollMultiple(damage);
  const ignored = countSuccesses(rolls, target);
  const remaining = Math.max(0, damage - ignored);
  return {
    damage: remaining,
    logs: [log(state, unit.side, unit.profile.name,
      `     Feel No Pain (${target}+): [${rolls.join(', ')}] -> ${ignored} ignored, ${remaining} damage remains`,
      'roll',
    )],
  };
}

function unitCanUseBigGunsNeverTire(unit: BattleUnit): boolean {
  return unitHasKeyword(unit, 'Vehicle') || unitHasKeyword(unit, 'Monster');
}

function resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState, testCount = aliveWeaponModelCount(unit, weaponIndex)): LogEntry[] {
  if (!weaponHasKeyword(weapon, 'Hazardous') || unit.destroyed) return [];
  if (testCount <= 0) return [];

  const rolls = rollMultiple(testCount);
  const failures = rolls.filter(roll => roll === 1).length;
  const logs = [
    log(state, unit.side, unit.profile.name,
      `     Hazardous tests for ${weapon.name}: [${rolls.join(', ')}] -> ${failures} failure(s)`,
      'roll',
    ),
  ];

  for (let i = 0; i < failures && !unit.destroyed; i++) {
    if (unitHasKeyword(unit, 'Character') || unitCanUseBigGunsNeverTire(unit)) {
      logs.push(...applyDamage(unit, 3, state, unit.side));
    } else {
      logs.push(...applyDamage(unit, unit.woundsOnLeadModel, state, unit.side));
    }
  }

  return logs;
}

function cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void {
  if (!unit.performingAction) return;
  const actionName = unit.performingAction.name;
  unit.performingAction = undefined;
  state.log = [...state.log, log(
    state,
    unit.side,
    unit.profile.name,
    `${unit.profile.name} does not complete ${actionName}: ${reason}.`,
    'info',
  )];
}

function unitIsEligibleToStartAction(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves) return false;
  if (isAircraft(unit) || isFortification(unit)) return false;
  if (unit.battleshocked) return false;
  if (unit.profile.oc <= 0) return false;
  if (unit.actionStartedThisTurn || unit.performingAction) return false;
  if (unit.movementAction === 'advanced' || unit.movementAction === 'fellBack' || unit.fellBack) return false;
  if (!unitCanUseBigGunsNeverTire(unit) && inEngagement(unit, enemies(state, unit.side), rules.engagementRange())) return false;
  return true;
}

export function playUnitCanStartAction(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): boolean {
  if (state.activeArmy !== side || state.phase === 'deployment' || state.phase === 'setup' || state.phase === 'end') return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  return !!unit && unitIsEligibleToStartAction(unit, state, rules);
}

function missionObjectiveActionOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  missionName: string,
  actionId: string,
  excludeFriendlyHome = true,
): number[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || selectedMissionName !== missionName) return [];
  if (!playUnitCanStartAction(state, unitId, side, rules)) return [];

  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const markedObjectives = new Set((state.missionState?.operationMarkers ?? [])
    .filter(marker => marker.side === side && marker.sourceActionId === actionId)
    .map(marker => marker.objectiveIndex));
  const homeRole = side === 0 ? 'home-0' : 'home-1';

  return objectiveIndexesWithinRange(state, unit, rules).filter(objectiveIndex => {
    if (markedObjectives.has(objectiveIndex)) return false;
    const objective = state.objectives[objectiveIndex];
    if (!objective) return false;
    return !excludeFriendlyHome
      || !state.terrain.some(terrain => terrain.objectiveRole === homeRole && pointInTerrain(objective, terrain));
  });
}

export function extractIntelligenceObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Gather Intel', 'extract-intelligence');
}

export function triangulateObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Triangulation', 'triangulate');
}

export function consecrateObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Consecrate', 'consecrate', false);
}

export function startPlayUnitAction(
  state: BattleState,
  unitId: string,
  side: Side,
  actionId = 'generic-action',
  actionName = 'Action',
  rules: RulesEdition = rules40K10th,
  targetObjectiveIndex?: number,
): BattleState {
  if (!playUnitCanStartAction(state, unitId, side, rules)) return state;
  if (actionId === 'extract-intelligence'
    && (targetObjectiveIndex === undefined
      || !extractIntelligenceObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'triangulate'
    && (targetObjectiveIndex === undefined
      || !triangulateObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'consecrate'
    && (targetObjectiveIndex === undefined
      || !consecrateObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  const next = clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  unit.performingAction = {
    id: actionId,
    name: actionName,
    startedPhase: next.phase,
    completesAt: 'end-of-turn',
    ...(targetObjectiveIndex !== undefined ? { targetObjectiveIndex } : {}),
  };
  unit.actionStartedThisTurn = true;
  next.log = [...next.log, log(next, side, unit.profile.name, `${unit.profile.name} starts ${actionName}.`, 'info')];
  return next;
}

export function completeEndOfTurnActions(state: BattleState, side: Side): void {
  for (const unit of state.units) {
    if (unit.side !== side || unit.destroyed || !unit.performingAction) continue;
    const action = unit.performingAction;
    const actionName = action.name;
    recordCompletedMissionAction(state, unit, action);
    unit.performingAction = undefined;
    state.log = [...state.log, log(state, side, unit.profile.name, `${unit.profile.name} completes ${actionName}.`, 'info')];
  }
}

function eligibleShootingWeapons(unit: BattleUnit, state: BattleState, rules: RulesEdition): WeaponProfile[] {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated) return [];
  if (unit.performingAction && !unitCanUseBigGunsNeverTire(unit)) return [];
  if (unit.fellBack || unit.movementAction === 'fellBack') return [];
  const firedSet = new Set(unit.firedWeaponIndices ?? []);
  const oneShotSpentSet = new Set(unit.oneShotSpentWeaponIndices ?? []);
  const firedProfileGroups = new Set(
    unit.profile.weapons
      .filter((_weapon, weaponIndex) => firedSet.has(weaponIndex))
      .map(weaponProfileGroup)
      .filter((group): group is string => !!group),
  );
  const firedSidearm = unit.profile.weapons.some((weapon, weaponIndex) =>
    firedSet.has(weaponIndex) && weaponIsSidearm(weapon),
  );
  const firedNonSidearm = unit.profile.weapons.some((weapon, weaponIndex) =>
    firedSet.has(weaponIndex) && !weapon.isMelee && weapon.range > 0 && !weaponIsSidearm(weapon),
  );
  const foes = enemies(state, unit.side);
  const engaged = inEngagement(unit, foes, rules.engagementRange());
  const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(unit);
  const advanced = unit.movementAction === 'advanced';
  return unit.profile.weapons.filter((w, idx) =>
    !w.isMelee
    && w.range > 0
    && !firedSet.has(idx)
    && !(weaponHasKeyword(w, 'One Shot') && oneShotSpentSet.has(idx))
    && !firedProfileGroups.has(weaponProfileGroup(w) ?? '')
    && (!advanced || weaponHasKeyword(w, 'Assault'))
    && (!engaged || weaponIsSidearm(w) || bigGunsNeverTire),
  ).filter(w =>
    (!firedSidearm || weaponIsSidearm(w))
    && (!firedNonSidearm || !weaponIsSidearm(w))
  );
}

function shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  const nonSidearms = weapons.filter(option => !weaponIsSidearm(option.weapon));
  return chooseOneProfilePerGroup(nonSidearms.length ? nonSidearms : weapons);
}

function unitCanBeSelectedToShootWithoutAttacks(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || unit.activated) return false;
  if (unit.performingAction && !unitCanUseBigGunsNeverTire(unit)) return false;
  if (unit.fellBack || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return false;
  const engaged = inEngagement(unit, enemies(state, unit.side), rules.engagementRange());
  return !engaged || unitCanUseBigGunsNeverTire(unit);
}

function shootingWeaponCanTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
): boolean {
  if (target.destroyed || target.embarkedInUnitId || target.side === unit.side) return false;
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side);
  const engaged = inEngagement(unit, foes, eng);
  const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(unit);
  const targetPool = engaged && !bigGunsNeverTire ? engagedEnemies(state, unit, rules) : foes;
  if (!targetPool.some(candidate => candidate.id === target.id && candidate.side === target.side)) return false;

  const targetEngagedWithFriendly = targetWithinFriendlyEngagement(state, target, unit.side, rules);
  const targetEngagedWithShooter = inEngagement(unit, [target], eng);
  if (unitHasDatasheetRule(target, 'Lone Operative') && battleUnitsBaseEdgeDistance(unit, target) > 12) return false;
  if (attachedBodyguardAlive(state, target) && !weaponHasKeyword(weapon, 'Precision')) return false;
  if (weaponHasKeyword(weapon, 'Blast') && targetEngagedWithFriendly) return false;
  if (
    targetEngagedWithFriendly
    && !(weaponIsSidearm(weapon) && targetEngagedWithShooter)
    && !(bigGunsNeverTire && targetEngagedWithShooter)
    && !unitCanUseBigGunsNeverTire(target)
  ) return false;
  const targetVisible = unit.modelPositions.some((from, i) => hasAnyModelLOS(from, modelBaseRadius(unit, i), target, state.terrain));
  return battleUnitsWithinBaseEdgeRange(unit, target, weapon.range)
    && (targetVisible || weaponHasKeyword(weapon, 'Indirect Fire'));
}

function unitHasVisibleModelToTarget(state: BattleState, unit: BattleUnit, target: BattleUnit): boolean {
  return unit.modelPositions.some((from, i) => hasAnyModelLOS(from, modelBaseRadius(unit, i), target, state.terrain));
}

function snapShootingWeaponCanTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
): boolean {
  return battleUnitsBaseEdgeDistance(unit, target) <= 24
    && unitHasVisibleModelToTarget(state, unit, target)
    && shootingWeaponCanTarget(state, unit, target, weapon, rules);
}

function activeStratagemTargets(state: BattleState, stratagemId: string, phase: Phase): Set<string> {
  const round = battleRound(state);
  return new Set(
    (state.stratagemUses ?? [])
      .filter(use =>
        use.stratagemId === stratagemId
        && use.phase === phase
        && (use.battleRound ?? round) === round
        && use.targetUnitId
      )
      .map(use => use.targetUnitId!),
  );
}

function unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: Phase): boolean {
  return activeStratagemTargets(state, stratagemId, phase).has(unit.id);
}

export function battleUnitsBaseEdgeDistance(a: BattleUnit, b: BattleUnit): number {
  let closest = Infinity;
  for (let ai = 0; ai < a.modelPositions.length; ai++) {
    const aModel = a.modelPositions[ai];
    const aFootprint = modelFootprint(a, ai);
    for (let bi = 0; bi < b.modelPositions.length; bi++) {
      const bModel = b.modelPositions[bi];
      const bFootprint = modelFootprint(b, bi);
      closest = Math.min(closest, modelBaseEdgeDistance3d(aModel, aFootprint, bModel, bFootprint));
    }
  }
  return closest;
}

export function battleUnitsWithinBaseEdgeRange(a: BattleUnit, b: BattleUnit, range: number): boolean {
  return battleUnitsBaseEdgeDistance(a, b) <= range;
}

function shootingWeaponModifiers(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
): { cover: boolean; hitModifier: number; hitModifierNotes: string } {
  const foes = enemies(state, unit.side);
  const bigGunsNeverTire = inEngagement(unit, foes, rules.engagementRange()) && unitCanUseBigGunsNeverTire(unit);
  const usesIndirectFirePenalty = weaponHasKeyword(weapon, 'Indirect Fire')
    && !unit.modelPositions.some((from, i) => hasAnyModelLOS(from, modelBaseRadius(unit, i), target, state.terrain));
  const usesSmokescreen = unitHasActiveStratagem(state, target, 'smokescreen', 'shooting');
  const cover = targetHasTerrainCoverFrom(unit.modelPositions, target, state.terrain) || usesIndirectFirePenalty || usesSmokescreen;
  const usesBigGunsPenalty = (bigGunsNeverTire || targetWithinFriendlyEngagement(state, target, unit.side, rules))
    && !weaponIsSidearm(weapon);
  const usesHeavyBonus = weaponHasKeyword(weapon, 'Heavy') && unit.movementAction === 'remainedStationary';
  const usesStealth = unitHasDatasheetRule(target, 'Stealth');
  const hitModifier = (usesBigGunsPenalty ? 1 : 0) + (usesHeavyBonus ? -1 : 0) + (usesIndirectFirePenalty ? 1 : 0) + (usesSmokescreen ? 1 : 0) + (usesStealth ? 1 : 0);
  const hitModifierNotes = [
    usesBigGunsPenalty ? 'Big Guns Never Tire -1 to Hit' : '',
    usesHeavyBonus ? 'Heavy +1 to Hit' : '',
    usesIndirectFirePenalty ? 'Indirect Fire -1 to Hit; target has Benefit of Cover' : '',
    usesSmokescreen ? 'Smokescreen -1 to Hit; target has Benefit of Cover' : '',
    usesStealth ? 'Stealth -1 to Hit' : '',
  ].filter(Boolean).join('; ');
  return { cover, hitModifier, hitModifierNotes };
}

function markOneShotWeaponSpent(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number): void {
  if (!weaponHasKeyword(weapon, 'One Shot')) return;
  unit.oneShotSpentWeaponIndices = [...new Set([...(unit.oneShotSpentWeaponIndices ?? []), weaponIndex])];
}

function resolveShootingWeaponIntoTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  options: { deferCasualties?: boolean; snapShooting?: boolean } = {},
): LogEntry[] {
  const modifiers = shootingWeaponModifiers(state, unit, target, weapon, rules);
  const snapShooting = options.snapShooting ?? false;
  const logs = resolveAttacks(
    unit,
    target,
    weapon,
    weaponIndex,
    rules,
    state,
    modifiers.cover,
    snapShooting ? 0 : modifiers.hitModifier,
    snapShooting ? '' : modifiers.hitModifierNotes,
    options,
  );
  if (logs.length > 0) markOneShotWeaponSpent(unit, weapon, weaponIndex);
  logs.push(...resolveHazardousTests(
    unit,
    weapon,
    weaponIndex,
    state,
    participatingWeaponModelCount(unit, target, weapon, weaponIndex, state.terrain),
  ));
  return logs;
}

function runShooting(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  const rangedWeapons = shootingWeaponSelectionForAll(
    eligibleShootingWeapons(unit, state, rules)
      .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
      .filter(option => option.weaponIndex >= 0),
  );
  if (!rangedWeapons.length) return [];

  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name, `🔫 ${unit.profile.name} shoots:`, 'shoot'),
  ];

  for (const { weapon, weaponIndex } of rangedWeapons) {
    if (aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    const validTargets = enemies(state, unit.side).filter(e => shootingWeaponCanTarget(state, unit, e, weapon, rules));
    if (!validTargets.length) {
      logs.push(log(state, unit.side, unit.profile.name,
        `  ${weapon.name}: no valid targets in range/LOS`,
        'info',
      ));
      continue;
    }
    const target = nearest(unit, validTargets)!;
    logs.push(...resolveShootingWeaponIntoTarget(state, unit, target, weapon, weaponIndex, rules));
    if (unit.destroyed) break;
  }

  return logs;
}

export type PlayShootingWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
};

export function playShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): PlayShootingWeaponOption[] {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return [];
  const options = eligibleShootingWeapons(unit, state, rules)
    .map(weapon => {
      const weaponIndex = unit.profile.weapons.indexOf(weapon);
      return {
        weaponIndex,
        name: weapon.name,
        targetIds: enemies(state, side)
          .filter(target => shootingWeaponCanTarget(state, unit, target, weapon, rules))
          .map(target => target.id),
      };
    })
    .filter(option => option.weaponIndex >= 0);
  if (options.length === 0 && unitCanBeSelectedToShootWithoutAttacks(unit, state, rules)) {
    return [{ weaponIndex: -1, name: 'No ranged weapons', targetIds: [] }];
  }
  return options;
}

export function playSnapShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): PlayShootingWeaponOption[] {
  if (state.phase !== 'movement' || state.activeArmy === side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return [];
  return eligibleShootingWeapons(unit, state, rules)
    .map(weapon => {
      const weaponIndex = unit.profile.weapons.indexOf(weapon);
      return {
        weaponIndex,
        name: weapon.name,
        targetIds: enemies(state, side)
          .filter(target => snapShootingWeaponCanTarget(state, unit, target, weapon, rules))
          .map(target => target.id),
      };
    })
    .filter(option => option.weaponIndex >= 0);
}

export function shootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string | undefined,
  weaponIndex: number | 'all',
  rules: RulesEdition = rules40K10th,
): BattleState {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return state;

  if (weaponIndex === -1 || (weaponIndex === 'all' && !eligibleShootingWeapons(unit, s, rules).length)) {
    if (!unitCanBeSelectedToShootWithoutAttacks(unit, s, rules) || eligibleShootingWeapons(unit, s, rules).length > 0) return state;
    unit.activated = true;
    s.log = [...s.log, log(s, side, unit.profile.name, `${unit.profile.name} is selected to shoot but has no ranged weapons, so it makes no attacks.`, 'shoot')];
    return s;
  }

  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!target) return state;

  const eligibleWeapons = eligibleShootingWeapons(unit, s, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option => option.weaponIndex >= 0 && aliveWeaponModelCount(unit, option.weaponIndex) > 0);
  const selectedWeapons = weaponIndex === 'all'
    ? shootingWeaponSelectionForAll(eligibleWeapons)
    : eligibleWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedWeapons.length) return state;

  const logs: LogEntry[] = [
    log(s, side, unit.profile.name, `🔫 ${unit.profile.name} shoots ${target.profile.name}:`, 'shoot'),
  ];
  const firedWeaponIndices: number[] = [];
  for (const option of selectedWeapons) {
    if (!shootingWeaponCanTarget(s, unit, target, option.weapon, rules)) {
      logs.push(log(s, side, unit.profile.name, `  ${option.weapon.name}: ${target.profile.name} is not a valid target`, 'info'));
      continue;
    }
    const attackLogs = resolveShootingWeaponIntoTarget(s, unit, target, option.weapon, option.weaponIndex, rules, { deferCasualties: true });
    logs.push(...attackLogs);
    if (attackLogs.length > 0) firedWeaponIndices.push(option.weaponIndex);
    if (unit.destroyed || target.destroyed) break;
  }

  if (firedWeaponIndices.length === 0) return state;
  if (weaponIndex === 'all' && firedWeaponIndices.length === selectedWeapons.length) {
    unit.activated = true;
  } else {
    unit.firedWeaponIndices = [...new Set([...(unit.firedWeaponIndices ?? []), ...firedWeaponIndices])];
    const remainingEligibleWeapons = eligibleShootingWeapons(unit, s, rules);
    const hasRemainingTargets = remainingEligibleWeapons.some(weapon =>
      enemies(s, side).some(candidate => shootingWeaponCanTarget(s, unit, candidate, weapon, rules)),
    );
    if (remainingEligibleWeapons.length === 0 || !hasRemainingTargets) {
      unit.activated = true;
    }
  }
  s.log = [...s.log, ...logs];
  return s;
}

export function snapShootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition = rules40K10th,
): BattleState {
  if (state.phase !== 'movement' || state.activeArmy === side) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target || unit.activated) return state;

  const eligibleWeapons = eligibleShootingWeapons(unit, s, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option =>
      option.weaponIndex >= 0
      && aliveWeaponModelCount(unit, option.weaponIndex) > 0
      && snapShootingWeaponCanTarget(s, unit, target, option.weapon, rules)
    );
  const selectedWeapons = weaponIndex === 'all'
    ? shootingWeaponSelectionForAll(eligibleWeapons)
    : eligibleWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedWeapons.length) return state;

  const logs: LogEntry[] = [
    log(s, side, unit.profile.name, `${unit.profile.name} snap shoots ${target.profile.name}:`, 'shoot'),
  ];
  for (const option of selectedWeapons) {
    logs.push(...resolveShootingWeaponIntoTarget(s, unit, target, option.weapon, option.weaponIndex, rules, {
      deferCasualties: true,
      snapShooting: true,
    }));
    if (unit.destroyed || target.destroyed) break;
  }

  if (logs.length <= 1) return state;
  unit.activated = true;
  unit.actionStartedThisTurn = true;
  s.log = [...s.log, ...logs];
  return s;
}

export interface LOSRay {
  from: Position;
  to: Position;
  fromUnitId: string;
  toUnitId: string;
  fromModelIndex: number;
  toModelIndex: number;
  blocked: boolean;
}

export function shootingLOSRays(
  shooter: BattleUnit,
  target: BattleUnit,
  terrain: Terrain[],
): LOSRay[] {
  const fromModels = shooter.modelPositions;
  const toModels = target.modelPositions;
  return fromModels.flatMap((fromCenter, fromIdx) => {
    const fromRadius = modelBaseRadius(shooter, fromIdx);
    return toModels.map((toCenter, toIdx) => {
      const toRadius = modelBaseRadius(target, toIdx);
      const ray = findUnblockedLOSRay(fromCenter, fromRadius, toCenter, toRadius, terrain);
      // Unblocked: draw the actual edge-to-edge ray that has clear sight.
      // Blocked: fall back to center-to-center so the red dashed line shows the obstructed path.
      return ray
        ? {
          from: ray.from,
          to: ray.to,
          fromUnitId: shooter.id,
          toUnitId: target.id,
          fromModelIndex: fromIdx,
          toModelIndex: toIdx,
          blocked: false,
        }
        : {
          from: fromCenter,
          to: toCenter,
          fromUnitId: shooter.id,
          toUnitId: target.id,
          fromModelIndex: fromIdx,
          toModelIndex: toIdx,
          blocked: true,
        };
    });
  });
}

export function targetHasCoverFrom(
  shooterPositions: Position | Position[],
  target: BattleUnit,
  terrain: Terrain[],
): boolean {
  const positions = Array.isArray(shooterPositions) ? shooterPositions : [shooterPositions];
  return targetHasTerrainCoverFrom(positions, target, terrain);
}

export function lockPlayUnitShooting(state: BattleState, unitId: string, side: Side): BattleState {
  if (state.phase !== 'shooting') return state;
  const existing = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!existing || existing.activated) return state;
  const s = clone(state);
  s.units.find(u => u.id === unitId && u.side === side)!.activated = true;
  return s;
}

function runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.performingAction) return [];
  if (unit.destroyed || unit.embarkedInUnitId || isAircraft(unit) || unit.inCombat || unit.fellBack || unit.arrivedFromReinforcements || unit.emergencyDisembarkedThisTurn || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return [];
  const foes = enemies(state, unit.side).filter(
    e => unitCanChargeTarget(unit, e) && dist(unit.position, e.position) <= rules.chargeRange(),
  );
  if (!foes.length) return [];

  const target = nearest(unit, foes)!;
  const d = dist(unit.position, target.position);
  const eng = rules.engagementRange();

  // Formation-aware stop gap (same as movement)
  const dirX = d > 0 ? (target.position.x - unit.position.x) / d : 1;
  const dirY = d > 0 ? (target.position.y - unit.position.y) / d : 0;
  const myExtent  = formationExtent(unit.modelPositions,   unit.position,   { x: dirX,  y: dirY  });
  const tgtExtent = formationExtent(target.modelPositions, target.position, { x: -dirX, y: -dirY });
  const stopGap   = eng + myExtent + tgtExtent + 0.05;

  const needed = Math.max(0, d - stopGap);
  const r1 = d6(), r2 = d6();
  const roll = r1 + r2;

  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name,
      `⚔️  ${unit.profile.name} charges ${target.profile.name}! (${needed.toFixed(1)}" needed, rolled ${r1}+${r2}=${roll})`,
      'charge',
    ),
  ];

  if (roll >= needed) {
    const reachablePos = findReachablePosition(unit, target.position, roll, state.terrain, stopGap);
    const newPos = avoidModelOverlap(unit, reachablePos, state);
    if (dist(unit.position, newPos) + 0.01 < needed) {
      logs.push(log(state, unit.side, unit.profile.name,
        `  ❌ Charge path blocked by terrain`,
        'charge',
      ));
      return logs;
    }
    translateFormation(unit, newPos.x - unit.position.x, newPos.y - unit.position.y);
    resolveInternalModelOverlaps(unit);
    unit.charged = true;
    unit.inCombat = true;
    target.inCombat = true;
    logs.push(log(state, unit.side, unit.profile.name,
      `  ✅ Charge successful! ${unit.profile.name} is now in melee`,
      'charge',
    ));
  } else {
    logs.push(log(state, unit.side, unit.profile.name,
      `  ❌ Charge failed (needed ${Math.ceil(needed)}, rolled ${roll})`,
      'charge',
    ));
  }

  return logs;
}

export type PlayChargeTargetOption = {
  targetId: string;
  needed: number;
};

function chargeNeededDistance(unit: BattleUnit, target: BattleUnit, rules: RulesEdition): number {
  return Math.max(0, battleUnitsBaseEdgeDistance(unit, target) - rules.engagementRange());
}

function unitCanDeclareCharge(unit: BattleUnit): boolean {
  return !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.performingAction
    && !unit.activated
    && !isAircraft(unit)
    && !unit.inCombat
    && !unit.fellBack
    && !unit.arrivedFromReinforcements
    && !unit.emergencyDisembarkedThisTurn
    && unit.movementAction !== 'fellBack'
    && unit.movementAction !== 'advanced';
}

function sideCanDeclareCharge(state: BattleState, side: Side, unit: BattleUnit): boolean {
  return state.activeArmy === side || (state.activeArmy !== side && unit.heroicInterventionThisPhase === true);
}

export function playChargeTargetOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): PlayChargeTargetOption[] {
  if (state.phase !== 'charge') return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !sideCanDeclareCharge(state, side, unit) || !unitCanDeclareCharge(unit)) return [];
  return enemies(state, side)
    .filter(target => unitCanChargeTarget(unit, target))
    .map(target => ({ targetId: target.id, needed: chargeNeededDistance(unit, target, rules) }))
    .filter(option => option.needed <= rules.chargeRange());
}

export function chargePlayUnitTarget(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  rules: RulesEdition = rules40K10th,
): BattleState {
  if (state.phase !== 'charge') return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = state.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target || !sideCanDeclareCharge(state, side, unit) || !unitCanDeclareCharge(unit) || !unitCanChargeTarget(unit, target)) return state;
  const needed = chargeNeededDistance(unit, target, rules);
  if (needed > rules.chargeRange()) return state;

  const s = clone(state);
  const chargingUnit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const chargeTarget = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!chargingUnit || !chargeTarget) return state;

  const r1 = d6();
  const r2 = d6();
  const roll = r1 + r2;
  const logs: LogEntry[] = [
    log(s, side, chargingUnit.profile.name,
      `${chargingUnit.profile.name} declares a charge against ${chargeTarget.profile.name} (${needed.toFixed(1)}" needed, rolled ${r1}+${r2}=${roll}).`,
      'charge',
    ),
  ];

  if (roll + 0.001 < needed) {
    chargingUnit.activated = true;
    chargingUnit.heroicInterventionThisPhase = undefined;
    logs.push(log(s, side, chargingUnit.profile.name, `${chargingUnit.profile.name} fails the charge.`, 'charge'));
    s.log = [...s.log, ...logs];
    return s;
  }

  const d = dist(chargingUnit.position, chargeTarget.position);
  const dirX = d > 0 ? (chargeTarget.position.x - chargingUnit.position.x) / d : 1;
  const dirY = d > 0 ? (chargeTarget.position.y - chargingUnit.position.y) / d : 0;
  const myExtent = formationExtent(chargingUnit.modelPositions, chargingUnit.position, { x: dirX, y: dirY });
  const tgtExtent = formationExtent(chargeTarget.modelPositions, chargeTarget.position, { x: -dirX, y: -dirY });
  const stopGap = rules.engagementRange() + myExtent + tgtExtent + 0.05;
  const reachablePos = findReachablePosition(chargingUnit, chargeTarget.position, roll, s.terrain, stopGap);
  const newPos = avoidModelOverlap(chargingUnit, reachablePos, s);
  translateFormation(chargingUnit, newPos.x - chargingUnit.position.x, newPos.y - chargingUnit.position.y);
  resolveInternalModelOverlaps(chargingUnit);
  chargingUnit.position = centroid(chargingUnit.modelPositions);

  if (!inEngagement(chargingUnit, [chargeTarget], rules.engagementRange())) {
    logs.push(log(s, side, chargingUnit.profile.name, `${chargingUnit.profile.name} cannot reach engagement range.`, 'charge'));
    s.log = [...s.log, ...logs];
    return s;
  }

  chargingUnit.activated = true;
  chargingUnit.charged = true;
  chargingUnit.heroicInterventionThisPhase = undefined;
  chargingUnit.inCombat = true;
  chargeTarget.inCombat = true;
  logs.push(log(s, side, chargingUnit.profile.name, `${chargingUnit.profile.name} makes a successful${state.activeArmy !== side ? ' Heroic Intervention' : ''} charge.`, 'charge'));
  s.log = [...s.log, ...logs];
  return s;
}

export type PlayFightWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
};

export type PlayMeleeAttackSplit = {
  targetUnitId: string;
  attacks: number;
};

function unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  return !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.activated
    && enemies(state, unit.side).some(enemy => unitCanFightTarget(unit, enemy) && inEngagement(unit, [enemy], rules.engagementRange()));
}

function unitHasCounteroffensive(state: BattleState, unit: BattleUnit): boolean {
  return unitHasActiveStratagem(state, unit, 'counteroffensive', 'fight');
}

function unitHasFightsFirst(state: BattleState, unit: BattleUnit): boolean {
  return unit.charged || unitHasCounteroffensive(state, unit) || unitHasDatasheetRule(unit, 'Fights First');
}

function sideCanSelectFightUnit(state: BattleState, side: Side): boolean {
  return state.phase === 'fight'
    && (state.activeArmy === side || activeUnits(state, side).some(unit => unitHasCounteroffensive(state, unit)));
}

export function playFightActivationUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rules40K10th,
): string[] {
  if (!sideCanSelectFightUnit(state, side)) return [];
  const eligible = activeUnits(state, side).filter(unit => unitCanFight(unit, state, rules));
  if (state.activeArmy !== side) {
    return eligible.filter(unit => unitHasCounteroffensive(state, unit)).map(unit => unit.id);
  }
  const counteroffensive = eligible.filter(unit => unitHasCounteroffensive(state, unit));
  if (counteroffensive.length) return counteroffensive.map(unit => unit.id);
  const fightsFirst = eligible.filter(unit => unitHasFightsFirst(state, unit));
  return (fightsFirst.length ? fightsFirst : eligible).map(unit => unit.id);
}

function closestEnemyModelFor(
  unit: BattleUnit,
  modelIndex: number,
  state: BattleState,
): { unit: BattleUnit; modelIndex: number; distance: number } | null {
  let closest: { unit: BattleUnit; modelIndex: number; distance: number } | null = null;
  for (const enemy of enemies(state, unit.side)) {
    for (let enemyModelIndex = 0; enemyModelIndex < enemy.modelPositions.length; enemyModelIndex++) {
      const distance = modelBaseEdgeHorizontalDistance(unit, modelIndex, enemy, enemyModelIndex);
      if (!closest || distance < closest.distance) closest = { unit: enemy, modelIndex: enemyModelIndex, distance };
    }
  }
  return closest;
}

function nearestObjectiveToModel(model: Position, state: BattleState): Position | null {
  if (!state.objectives.length) return null;
  return state.objectives.reduce((best, objective) =>
    dist(model, objective) < dist(model, best) ? objective : best,
  );
}

function moveModelTowardPoint(unit: BattleUnit, modelIndex: number, point: Position, maxDistance: number, stopGap = 0): boolean {
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
  unit.position = centroid(unit.modelPositions);
  return true;
}

function moveModelTowardEnemy(unit: BattleUnit, modelIndex: number, state: BattleState): boolean {
  const closest = closestEnemyModelFor(unit, modelIndex, state);
  if (!closest) return false;
  const targetModel = closest.unit.modelPositions[closest.modelIndex];
  const myRadius = modelBaseRadius(unit, modelIndex);
  const targetRadius = modelBaseRadius(closest.unit, closest.modelIndex);
  return moveModelTowardPoint(unit, modelIndex, targetModel, FIGHT_PHASE_MOVE_RANGE, myRadius + targetRadius + 0.02);
}

function applyFightPhaseMove(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
): BattleState {
  if (state.phase !== 'fight' || state.activeArmy !== side) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing) return state;
  if (kind === 'pileIn' && existing.piledIn) return state;
  if (kind === 'consolidate' && existing.consolidated) return state;
  if (kind === 'pileIn' && !unitCanFight(existing, state, rules) && !(existing.charged && enemies(state, side).length > 0)) return state;
  if (kind === 'consolidate' && !existing.activated) return state;

  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;

  let movedModels = 0;
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const before = unit.modelPositions[modelIndex];
    const movedTowardEnemy = moveModelTowardEnemy(unit, modelIndex, s);
    const movedTowardObjective = !movedTowardEnemy && kind === 'consolidate'
      ? (() => {
          const objective = nearestObjectiveToModel(unit.modelPositions[modelIndex], s);
          return objective ? moveModelTowardPoint(unit, modelIndex, objective, FIGHT_PHASE_MOVE_RANGE) : false;
        })()
      : false;
    if (!movedTowardEnemy && !movedTowardObjective) continue;
    const movingIndices = new Set([modelIndex]);
    if (!playMoveHasNoBaseOverlap(s, unit, movingIndices) || !playMoveHasNoWallOverlap(s, unit, movingIndices)) {
      unit.modelPositions[modelIndex] = before;
      unit.position = centroid(unit.modelPositions);
      continue;
    }
    movedModels++;
  }

  if (kind === 'pileIn') unit.piledIn = true;
  else unit.consolidated = true;
  unit.inCombat = inEngagement(unit, enemies(s, side), rules.engagementRange());

  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${unit.profile.name} ${kind === 'pileIn' ? 'piles in' : 'consolidates'}${movedModels ? ` with ${movedModels} model${movedModels === 1 ? '' : 's'}` : ''}.`,
    'move',
  )];
  return s;
}

export function playUnitCanPileIn(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit
    && state.phase === 'fight'
    && state.activeArmy === side
    && !unit.piledIn
    && (unitCanFight(unit, state, rules) || (unit.charged && enemies(state, side).length > 0));
}

export function playUnitCanConsolidate(
  state: BattleState,
  unitId: string,
  side: Side,
): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit && state.phase === 'fight' && state.activeArmy === side && unit.activated && !unit.consolidated;
}

export function pileInPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): BattleState {
  return applyFightPhaseMove(state, unitId, side, 'pileIn', rules);
}

export function consolidatePlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): BattleState {
  return applyFightPhaseMove(state, unitId, side, 'consolidate', rules);
}

export function playFightWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): PlayFightWeaponOption[] {
  if (!sideCanSelectFightUnit(state, side)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !unitCanFight(unit, state, rules)) return [];
  if (!playFightActivationUnitIds(state, side, rules).includes(unit.id)) return [];
  const targetIds = enemies(state, side)
    .filter(target => unitCanFightTarget(unit, target) && inEngagement(unit, [target], rules.engagementRange()))
    .map(target => target.id);
  const options = unit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee)
    .map(option => ({ weaponIndex: option.weaponIndex, name: option.weapon.name, targetIds }));
  if (options.length === 0) return [{ weaponIndex: -1, name: 'No melee weapons', targetIds }];
  return options;
}

export function fightPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition = rules40K10th,
  targetSplits?: PlayMeleeAttackSplit[],
): BattleState {
  if (!sideCanSelectFightUnit(state, side)) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = state.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const splitTargetIds = targetSplits?.map(split => split.targetUnitId) ?? [];
  const splitTargets = splitTargetIds.map(splitTargetId =>
    state.units.find(candidate => candidate.id === splitTargetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId),
  );
  if (!unit || !target || !unitCanFight(unit, state, rules)) return state;
  if (!playFightActivationUnitIds(state, side, rules).includes(unit.id)) return state;
  if (!unitCanFightTarget(unit, target) || !inEngagement(unit, [target], rules.engagementRange())) return state;
  if (targetSplits?.length && splitTargets.some(splitTarget =>
    !splitTarget || !unitCanFightTarget(unit, splitTarget) || !inEngagement(unit, [splitTarget], rules.engagementRange()),
  )) return state;

  const s = clone(state);
  const fightingUnit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const fightTarget = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit || !fightTarget) return state;
  if (weaponIndex === -1 || (weaponIndex === 'all' && !fightingUnit.profile.weapons.some(weapon => weapon.isMelee))) {
    if (fightingUnit.profile.weapons.some(weapon => weapon.isMelee)) return state;
    fightingUnit.activated = true;
    s.log = [...s.log, log(s, side, fightingUnit.profile.name, `${fightingUnit.profile.name} is selected to fight ${fightTarget.profile.name} but has no melee weapons, so it makes no attacks.`, 'fight')];
    return s;
  }
  const meleeWeapons = fightingUnit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee && (weaponIndex === 'all' || option.weaponIndex === weaponIndex));
  const selectedMeleeWeapons = weaponIndex === 'all'
    ? chooseOneProfilePerGroup(meleeWeapons)
    : meleeWeapons;
  if (!selectedMeleeWeapons.length) return state;
  if (targetSplits?.length && (weaponIndex === 'all' || selectedMeleeWeapons.length !== 1)) return state;

  const logs: LogEntry[] = [
    log(s, side, fightingUnit.profile.name, `${fightingUnit.profile.name} fights ${fightTarget.profile.name}:`, 'fight'),
  ];
  let madeAttacks = false;
  if (targetSplits?.length) {
    const option = selectedMeleeWeapons[0];
    const maxTargets = Number.parseInt(String(option.weapon.attacks), 10);
    const maxAttacks = maxTargets * aliveWeaponModelCount(fightingUnit, option.weaponIndex);
    const declaredAttacks = targetSplits.reduce((total, split) => total + split.attacks, 0);
    if (
      targetSplits.some(split => split.attacks < 1 || !Number.isInteger(split.attacks))
      || (Number.isFinite(maxTargets) && targetSplits.length > maxTargets)
      || (Number.isFinite(maxAttacks) && declaredAttacks > maxAttacks)
    ) return state;

    for (const split of targetSplits) {
      const splitTarget = s.units.find(candidate => candidate.id === split.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
      if (!splitTarget || !unitCanFightTarget(fightingUnit, splitTarget) || !inEngagement(fightingUnit, [splitTarget], rules.engagementRange())) {
        logs.push(log(s, side, fightingUnit.profile.name, `  ${option.weapon.name}: declared target is no longer valid`, 'info'));
        continue;
      }
      const attackLogs = resolveAttacks(fightingUnit, splitTarget, option.weapon, option.weaponIndex, rules, s, false, 0, '', {
        deferCasualties: true,
        attackCountOverride: split.attacks,
      });
      logs.push(...attackLogs);
      madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed) break;
    }
    if (madeAttacks) logs.push(...resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, s));
  } else {
    for (const option of selectedMeleeWeapons) {
      const attackLogs = resolveAttacks(fightingUnit, fightTarget, option.weapon, option.weaponIndex, rules, s, false, 0, '', { deferCasualties: true });
      logs.push(...attackLogs);
      if (attackLogs.length > 0) logs.push(...resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, s));
      madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed || fightTarget.destroyed) break;
    }
  }
  if (!madeAttacks) return state;
  fightingUnit.activated = true;
  s.log = [...s.log, ...logs];
  return s;
}

function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side).filter(e => unitCanFightTarget(unit, e) && inEngagement(unit, [e], eng));
  if (!foes.length) return [];

  const meleeWeapons = chooseOneProfilePerGroup(
    unit.profile.weapons
      .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
      .filter(option => option.weapon.isMelee),
  );
  if (!meleeWeapons.length) return [];

  const target = nearest(unit, foes)!;
  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name, `🗡️  ${unit.profile.name} fights ${target.profile.name}:`, 'fight'),
  ];

  for (const { weapon, weaponIndex } of meleeWeapons) {
    if (aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    logs.push(...resolveAttacks(unit, target, weapon, weaponIndex, rules, state, false));
    logs.push(...resolveHazardousTests(unit, weapon, weaponIndex, state));
  }

  return logs;
}

function bestLeadership(unit: BattleUnit): number {
  return Math.min(
    unit.profile.leadership,
    ...(unit.profile.modelProfiles?.map(profile => profile.leadership) ?? []),
  );
}

function isBelowHalfStrength(unit: BattleUnit): boolean {
  if (unit.profile.baseModelCount === 1) {
    return unit.woundsOnLeadModel < unit.profile.wounds / 2;
  }

  return unit.remainingModels < unit.profile.baseModelCount / 2;
}

function unitHasInsaneBraveryForCurrentBattleshock(state: BattleState, unit: BattleUnit): boolean {
  const currentRound = battleRound(state);
  return (state.stratagemUses ?? []).some(use =>
    use.stratagemId === 'insane-bravery'
    && use.targetUnitId === unit.id
    && use.phase === 'command'
    && use.battleRound === currentRound
  );
}

function runBattleshock(state: BattleState, side: Side): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const unit of state.units) {
    if (unit.destroyed || unit.side !== side) continue;
    if (isBelowHalfStrength(unit)) {
      if (unitHasInsaneBraveryForCurrentBattleshock(state, unit)) {
        unit.battleshocked = false;
        logs.push(log(state, unit.side, unit.profile.name,
          `${unit.profile.name} automatically passes its Battle-shock test with Insane Bravery.`,
          'info',
        ));
        continue;
      }
      const rolls = [d6(), d6()];
      const roll = rolls[0] + rolls[1];
      const needed = bestLeadership(unit);
      const passed = roll >= needed;
      unit.battleshocked = !passed;
      logs.push(log(state, unit.side, unit.profile.name,
        `😰 ${unit.profile.name} below half strength — Battle-shock (${needed}+): rolled ${rolls[0]}+${rolls[1]}=${roll} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
        'info',
      ));
    } else {
      unit.battleshocked = false;
    }
  }
  return logs;
}

// ─── Objective scoring ────────────────────────────────────────────────────────

function scoreObjectives(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const armyName = s.armies[side].name;
  const parts: string[] = [];
  const objectiveControl = s.objectiveControl ?? rules.objectiveControl;
  const controlRadius = objectiveControlRadius(objectiveControl);

  if (controlRadius === null) {
    return [log(s, side, armyName,
      `Objective scoring unavailable for ${objectiveControl.label}; implement this ruleset case-by-case.`,
      'info',
    )];
  }

  for (let i = 0; i < s.objectives.length; i++) {
    const obj = s.objectives[i];
    let oc0 = 0, oc1 = 0;

    for (const unit of s.units) {
      if (unit.destroyed || unit.embarkedInUnitId) continue;
      const inRange = unit.modelPositions.some((model, modelIndex) => (
        dist(model, obj) <= controlRadius + modelBaseRadius(unit, modelIndex)
      ));
      if (inRange) {
        if (unit.side === 0) oc0 += objectiveControlValue(unit);
        else oc1 += objectiveControlValue(unit);
      }
    }

    let owner: Side | null = null;
    if (oc0 > oc1) owner = 0;
    else if (oc1 > oc0) owner = 1;
    s.objectiveOwners[i] = owner;

    if (owner === side) {
      s.scores[side]++;
      parts.push(`Obj${i + 1} +1VP`);
    } else if (owner !== null) {
      parts.push(`Obj${i + 1} enemy`);
    } else {
      parts.push(`Obj${i + 1} contested`);
    }
  }

  const scoreStr = parts.join(', ') || 'no objectives scored';
  return [log(s, side, armyName,
    `\n─── Objectives: ${scoreStr} → ${s.scores[0]}VP / ${s.scores[1]}VP ───`,
    'info',
  )];
}

// ─── Victory check ────────────────────────────────────────────────────────────

function scorePrimaryMissionLogs(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const result = scorePrimaryMission(s, side, rules);
  return [log(s, side, s.armies[side].name,
    `\n--- ${formatPrimaryScoringResult(result)} ---`,
    'info',
  )];
}

function checkWinner(state: BattleState): void {
  const a0 = state.units.some(u => u.side === 0 && !u.destroyed);
  const a1 = state.units.some(u => u.side === 1 && !u.destroyed);
  if (!a0 && !a1) { state.winner = 'draw'; state.phase = 'end'; }
  else if (!a0)   { state.winner = 1;      state.phase = 'end'; }
  else if (!a1)   { state.winner = 0;      state.phase = 'end'; }
}

// ─── Deep copy ────────────────────────────────────────────────────────────────

const TURN_PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];
const PLAY_MODEL_EDIT_PHASES: Phase[] = ['deployment', 'movement'];

export function movementStep(state: BattleState): MovementStep {
  return state.phase === 'movement' ? state.movementStep ?? 'moveUnits' : 'moveUnits';
}

function activeUnits(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(u => u.side === side && !u.destroyed && !u.embarkedInUnitId && !u.inStrategicReserves);
}

export function markRemainingStationaryUnits(state: BattleState, side: Side = state.activeArmy): void {
  for (const unit of activeUnits(state, side)) {
    if (isAircraft(unit)) continue;
    if (!unit.movementAction && !unit.fellBack) {
      unit.movementAction = 'remainedStationary';
      unit.movementAllowanceRemaining = 0;
      unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
      unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
      unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
      unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
      unit.movementComplete = true;
    }
  }
}

function startCommandPhase(s: BattleState, rules: RulesEdition): LogEntry[] {
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  startMissionEventsForNewTurn(s, rules);
  s.units.filter(u => u.side === side && !u.destroyed).forEach(u => { u.actionStartedThisTurn = undefined; });
  activeUnits(s, side).forEach(u => {
    u.activated = false;
    u.charged = false;
    u.piledIn = undefined;
    u.consolidated = undefined;
    u.firedWeaponIndices = undefined;
    u.movementAction = undefined;
    u.movementAllowanceRemaining = undefined;
    u.movementAllowanceRemainingByModel = undefined;
    u.movementAllowanceTotalByModel = undefined;
    u.movementStartPositionsByModel = undefined;
    u.movementStartRotationsByModel = undefined;
    u.movementComplete = undefined;
    u.arrivedFromReinforcements = undefined;
    u.rapidIngressThisPhase = undefined;
    u.heroicInterventionThisPhase = undefined;
    u.emergencyDisembarkedThisTurn = undefined;
    u.fellBack = false;
    u.inCombat = false;
  });
  s.phase = 'command';
  s.movementStep = undefined;
  const nextCommandPoints = gainCommandPhaseCommandPoints(s);
  const logs = [
    phaseLog(s, side, armyName, `\n=== BATTLE ROUND ${battleRound(s)} - ${armyName.toUpperCase()} - ${rules.name.toUpperCase()} ===`),
    phaseLog(s, side, armyName, `\n--- Command Phase ---`),
    log(s, side, armyName, `Both players gain 1CP (${nextCommandPoints[0]}CP / ${nextCommandPoints[1]}CP).`, 'info'),
  ];
  logs.push(...runBattleshock(s, side));
  return logs;
}

function advanceTurnInPlace(s: BattleState): void {
  if (s.winner !== null) return;
  completeMissionEventsForCurrentTurn(s);

  if (s.activeArmy === 0) {
    s.activeArmy = 1;
  } else {
    setBattleRound(s, battleRound(s) + 1);
    s.activeArmy = 0;
    if (battleRound(s) > maxBattleRounds(s)) {
      if (s.scores[0] > s.scores[1]) s.winner = 0;
      else if (s.scores[1] > s.scores[0]) s.winner = 1;
      else s.winner = 'draw';
      s.phase = 'end';
      s.movementStep = undefined;
      return;
    }
  }

  s.phase = 'setup';
  s.movementStep = undefined;
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function makeBattleUnit(
  profile: UnitProfile,
  side: Side,
  modelPositions: Position[],
  attachedToUnitId?: string,
  tabletopUnitId?: string,
): BattleUnit {
  const id = `${side}_${_unitId++}`;
  return {
    id,
    attachedToUnitId,
    tabletopUnitId: tabletopUnitId ?? id,
    side,
    profile,
    remainingModels: profile.baseModelCount,
    woundsOnLeadModel: profile.wounds,
    position: centroid(modelPositions),
    modelPositions,
    modelRotations: modelPositions.map(() => side === 0 ? 0 : 180),
    facingDeg: side === 0 ? 0 : 180,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementAllowanceTotalByModel: undefined,
    movementStartPositionsByModel: undefined,
    movementStartRotationsByModel: undefined,
    fellBack: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
}

function leaderAnchor(bodyguard: BattleUnit, leader: UnitProfile, leaderIndex: number, side: Side, deployment: DeploymentZoneSource = 'Default', board = boardFormatForId()): Position {
  const forward = side === 0 ? -1 : 1;
  const zone = zoneFor(side, deployment, board);
  const radius = modelBaseRadiusInches(leader);
  const offsetX = forward * (battleUnitMaxBaseRadiusInches(bodyguard) + radius + 0.4);
  const offsetY = (leaderIndex - 0.5) * 1.2;
  return clampModelToBoard({
    x: bodyguard.position.x + offsetX,
    y: bodyguard.position.y + offsetY,
  }, radius, zone, board);
}

function removeUnitFromUnplaced(s: BattleState, side: Side, profile: UnitProfile): void {
  const key = unitRosterId(profile);
  s.unplacedUnits[side] = s.unplacedUnits[side].filter(unit => unitRosterId(unit) !== key);
}

function unitIsStagedReinforcement(unit: UnitProfile): boolean {
  return unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike
    || unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve;
}

function reinforcementPlacementIsOutsideEnemyRange(state: BattleState, side: Side, modelPositions: Position[], minRange = 9): boolean {
  const foes = enemies(state, side);
  return modelPositions.every(model =>
    foes.every(enemy =>
      enemy.modelPositions.every(enemyModel => dist(model, enemyModel) > minRange),
    ),
  );
}

const STRATEGIC_RESERVES_EDGE_RANGE = 6;

function reinforcementPlacementIsWithinStrategicReserveEdge(unit: BattleUnit, state: BattleState): boolean {
  const board = boardFormatForState(state);
  const edgeBands = [
    { x: 0, y: 0, width: STRATEGIC_RESERVES_EDGE_RANGE, height: board.height },
    { x: board.width - STRATEGIC_RESERVES_EDGE_RANGE, y: 0, width: STRATEGIC_RESERVES_EDGE_RANGE, height: board.height },
    { x: 0, y: 0, width: board.width, height: STRATEGIC_RESERVES_EDGE_RANGE },
    { x: 0, y: board.height - STRATEGIC_RESERVES_EDGE_RANGE, width: board.width, height: STRATEGIC_RESERVES_EDGE_RANGE },
  ];
  return edgeBands.some(rect =>
    unit.modelPositions.every((model, modelIndex) =>
      baseFootprintWithinRect(model, modelFootprint(unit, modelIndex), rect),
    ),
  );
}

function markUnitArrivedFromReinforcements(unit: BattleUnit): void {
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  unit.movementComplete = true;
  unit.arrivedFromReinforcements = true;
  unit.inCombat = false;
  unit.fellBack = false;
}

const TRANSPORT_ACCESS_RANGE = 3;

function unitAssignedToTransport(profile: UnitProfile, transport: BattleUnit): boolean {
  return profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport
    && (
      profile.deployment.transportUnitId === unitRosterId(transport.profile)
      || (!profile.deployment.transportUnitId && profile.deployment.transportName === transport.profile.name)
    );
}

function disembarkPositions(state: BattleState, transport: BattleUnit, profile: UnitProfile): Position[] | null {
  const side = transport.side;
  const forward = side === 0 ? 1 : -1;
  const offsets: Position[] = [
    { x: forward * (TRANSPORT_ACCESS_RANGE + 0.5), y: 0 },
    { x: -forward * (TRANSPORT_ACCESS_RANGE + 0.5), y: 0 },
    { x: 0, y: TRANSPORT_ACCESS_RANGE + 0.5 },
    { x: 0, y: -(TRANSPORT_ACCESS_RANGE + 0.5) },
  ];
  const enemiesInState = enemies(state, side);

  for (const offset of offsets) {
    const positions = playGridFormation(profile, {
      x: transport.position.x + offset.x,
      y: transport.position.y + offset.y,
    }, side);
    const candidateUnit = makeBattleUnit(profile, side, positions);
    if (inEngagement(candidateUnit, enemiesInState, rules40K10th.engagementRange())) continue;
    if (!playMoveHasNoBaseOverlap(state, candidateUnit, new Set(candidateUnit.modelPositions.map((_, index) => index)))) continue;
    if (!playMoveHasNoWallOverlap(state, candidateUnit, new Set(candidateUnit.modelPositions.map((_, index) => index)))) continue;
    return positions;
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export { type DeploymentStrategy };

export function createBattleState(
  army1: ImportedArmy,
  color1: string,
  army2: ImportedArmy,
  color2: string,
  terrain: Terrain[],
  strategy1: DeploymentStrategy = 'balanced',
  strategy2: DeploymentStrategy = 'balanced',
  setup?: BattleState['setup'],
  objectivesOverride?: Position[],
  rules: RulesEdition = rules40K10th,
): BattleState {
  _logId = 0;
  _unitId = 0;

  const board = boardFormatForId(setup?.boardFormat);
  const objectives: Position[] = clone(objectivesOverride ?? DEFAULT_OBJECTIVES);

  const deployment = setupDeploymentZoneSource(setup);
  const army1Deployable = deployableDrops(army1);
  const army2Deployable = deployableDrops(army2);
  const positions1 = deployArmy(army1Deployable, 0, strategy1, terrain, objectives, deployment, board);
  const positions2 = deployArmy(army2Deployable, 1, strategy2, terrain, objectives, deployment, board);

  const units: BattleUnit[] = [];
  const allPlacedModels: Position[] = []; // grows as each unit is placed; prevents cross-unit overlap
  const allPlacedModelRadii: number[] = [];

  const place = (army: ImportedArmy, side: Side, positions: Position[], terrain: Terrain[]) => {
    deployableDrops(army).forEach((profile, i) => {
      const startPos = positions[i];
      const modelPositions = deployModelFormation(
        startPos, profile.baseModelCount, unitRole(profile), side as 0 | 1,
        terrain, zoneFor(side as 0 | 1, deployment, board), allPlacedModels,
        modelRadiiForProfile(profile),
        allPlacedModelRadii,
      );
      const unit = makeBattleUnit(profile, side, modelPositions);
      unit.position = startPos;
      resolveInternalModelOverlaps(unit, zoneFor(side as 0 | 1, deployment, board), board);
      avoidDeploymentOverlap(unit, { units, board } as BattleState, zoneFor(side as 0 | 1, deployment, board));
      resolveInternalModelOverlaps(unit, zoneFor(side as 0 | 1, deployment, board), board);
      allPlacedModels.push(...unit.modelPositions);
      allPlacedModelRadii.push(...unit.modelPositions.map((_, modelIndex) => modelBaseRadius(unit, modelIndex)));
      units.push(unit);

      attachedFollowersFor(army, profile).forEach((leader, leaderIndex) => {
        const anchor = leaderAnchor(unit, leader, leaderIndex, side, deployment, board);
        const leaderPositions = deployModelFormation(
          anchor, leader.baseModelCount, unitRole(leader), side as 0 | 1,
          terrain, zoneFor(side as 0 | 1, deployment, board), allPlacedModels,
          modelRadiiForProfile(leader),
          allPlacedModelRadii,
        );
        const leaderUnit = makeBattleUnit(leader, side, leaderPositions, unit.id, unit.tabletopUnitId);
        resolveInternalModelOverlaps(leaderUnit, zoneFor(side as 0 | 1, deployment, board), board);
        avoidDeploymentOverlap(leaderUnit, { units, board } as BattleState, zoneFor(side as 0 | 1, deployment, board));
        resolveInternalModelOverlaps(leaderUnit, zoneFor(side as 0 | 1, deployment, board), board);
        allPlacedModels.push(...leaderUnit.modelPositions);
        allPlacedModelRadii.push(...leaderUnit.modelPositions.map((_, modelIndex) => modelBaseRadius(leaderUnit, modelIndex)));
        units.push(leaderUnit);
      });
    });
  };

  place(army1, 0, positions1, terrain);
  place(army2, 1, positions2, terrain);

  return {
    ruleset: rulesetMetadataForState(rules),
    battleRound: 1,
    maxBattleRounds: 5,
    turn: 1,
    maxTurns: 5,
    activeArmy: 0,
    phase: 'setup',
    winner: null,
    log: [],
    units,
    terrain,
    board,
    armies: [
      { name: army1.name, faction: army1.faction, color: color1, army: army1 },
      { name: army2.name, faction: army2.faction, color: color2, army: army2 },
    ],
    objectives,
    objectiveControl: rules.objectiveControl,
    objectiveOwners: objectives.map(() => null),
    scores: [0, 0],
    commandPoints: [0, 0],
    stratagemUses: [],
    abilityUses: [],
    unplacedUnits: [[], []],
    deployStrategies: [strategy1, strategy2],
    setup: setup ? { ...setup, boardFormat: board.id } : setup,
  };
}

export function createDeploymentState(
  army1: ImportedArmy,
  color1: string,
  army2: ImportedArmy,
  color2: string,
  terrain: Terrain[],
  strategy1: DeploymentStrategy = 'balanced',
  strategy2: DeploymentStrategy = 'balanced',
  setup?: BattleState['setup'],
  objectivesOverride?: Position[],
  rules: RulesEdition = rules40K10th,
): BattleState {
  _logId = 0;
  _unitId = 0;

  const board = boardFormatForId(setup?.boardFormat);
  const objectives: Position[] = clone(objectivesOverride ?? DEFAULT_OBJECTIVES);

  const state: BattleState = {
    ruleset: rulesetMetadataForState(rules),
    battleRound: 1,
    maxBattleRounds: 5,
    turn: 1,
    maxTurns: 5,
    activeArmy: 0,
    phase: 'deployment',
    winner: null,
    log: [],
    units: [],
    terrain,
    board,
    armies: [
      { name: army1.name, faction: army1.faction, color: color1, army: army1 },
      { name: army2.name, faction: army2.faction, color: color2, army: army2 },
    ],
    objectives,
    objectiveControl: rules.objectiveControl,
    objectiveOwners: objectives.map(() => null),
    scores: [0, 0],
    commandPoints: [0, 0],
    stratagemUses: [],
    abilityUses: [],
    unplacedUnits: [deployableDrops(army1), deployableDrops(army2)],
    deployStrategies: [strategy1, strategy2],
    setup: setup ? { ...setup, boardFormat: board.id } : setup,
  };

  state.log = [log(state, 0, '', '═══ DEPLOYMENT PHASE ═══', 'phase')];
  return state;
}

export function placeNextUnit(state: BattleState): BattleState {
  const s = clone(state);
  const board = boardFormatForState(s);

  // Determine which side places next; if current side is done, switch
  let side = s.activeArmy as 0 | 1;
  if (!s.unplacedUnits[side].length) {
    side = (1 - side) as 0 | 1;
  }

  const unplaced: UnitProfile[] = s.unplacedUnits[side];
  if (!unplaced.length) {
    s.phase = 'setup';
    return s;
  }

  const totalUnits = deployableDrops(s.armies[side].army).length;
  const dropsCompleted = totalUnits - unplaced.length;

  const unitIdx = selectUnitToDrop(unplaced, dropsCompleted, totalUnits);
  const profile = unplaced[unitIdx];

  const placedThisSide = s.units
    .filter(u => u.side === side)
    .map(u => {
      const { hw, hh } = fp(u.profile.baseModelCount, maxModelBaseRadius(u));
      return { x: u.position.x, y: u.position.y, hw, hh };
    });

  const pos = reactivePosition(profile, side, s, s.terrain, placedThisSide);
  const allDeployedModels = s.units.flatMap(u => u.modelPositions);
  const allDeployedModelRadii = s.units.flatMap(u => u.modelPositions.map((_, modelIndex) => modelBaseRadius(u, modelIndex)));
  const deployment = setupDeploymentZoneSource(s.setup);
  const zone = zoneFor(side, deployment, board);
  const modelPos = deployModelFormation(
    pos, profile.baseModelCount, unitRole(profile), side, s.terrain, zone, allDeployedModels,
    modelRadiiForProfile(profile),
    allDeployedModelRadii,
  );

  const unit = makeBattleUnit(profile, side, modelPos);
  unit.position = pos;

  resolveInternalModelOverlaps(unit, zone, board);
  avoidDeploymentOverlap(unit, s, zone);
  resolveInternalModelOverlaps(unit, zone, board);
  s.units.push(unit);
  s.unplacedUnits[side] = [...unplaced.slice(0, unitIdx), ...unplaced.slice(unitIdx + 1)];
  const attachedLeaders = attachedFollowersFor(s.armies[side].army, profile);
  attachedLeaders.forEach((leader, leaderIndex) => {
    const anchor = leaderAnchor(unit, leader, leaderIndex, side, deployment, board);
    const deployedModels = s.units.flatMap(u => u.modelPositions);
    const deployedRadii = s.units.flatMap(u => u.modelPositions.map((_, modelIndex) => modelBaseRadius(u, modelIndex)));
    const leaderModelPos = deployModelFormation(
      anchor, leader.baseModelCount, unitRole(leader), side, s.terrain, zone, deployedModels,
      modelRadiiForProfile(leader),
      deployedRadii,
    );
    const leaderUnit = makeBattleUnit(leader, side, leaderModelPos, unit.id, unit.tabletopUnitId);
    resolveInternalModelOverlaps(leaderUnit, zone, board);
    avoidDeploymentOverlap(leaderUnit, s, zone);
    resolveInternalModelOverlaps(leaderUnit, zone, board);
    s.units.push(leaderUnit);
    removeUnitFromUnplaced(s, side, leader);
  });
  s.log = [...s.log, log(s, side, profile.name,
    `⬇️ ${s.armies[side].name} deploys ${profile.name} at (${pos.x.toFixed(1)}", ${pos.y.toFixed(1)}")`,
    'info',
  )];

  if (!s.unplacedUnits[0].length && !s.unplacedUnits[1].length) {
    s.phase = 'setup';
    s.log = [...s.log, log(s, 0, '', '═══ DEPLOYMENT COMPLETE — BATTLE BEGINS ═══', 'phase')];
    return s;
  }

  const otherSide = (1 - side) as 0 | 1;
  s.activeArmy = s.unplacedUnits[otherSide].length ? otherSide : side;
  return s;
}

export function placePlayUnit(state: BattleState, side: Side, unitIndex: number, position: Position): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;
  const board = boardFormatForState(s);

  const unplaced = s.unplacedUnits[side];
  const profile = unplaced[unitIndex];
  if (!profile) return s;

  const deployment = setupDeploymentZoneSource(s.setup);
  const zone = zoneFor(side, deployment, board);
  if (!canDeployOutsideDeploymentZone(profile) && !pointInDeploymentZone(position, zone, modelBaseRadiusInches(profile))) {
    s.log = [...s.log, log(s, side, profile.name,
      `${profile.name} must be placed wholly inside ${zone.name}.`,
      'info',
    )];
    return s;
  }
  if (!modelIsOutsideEnemyDeploymentZoneBuffer(profile, side, position, 0, deployment, board)) {
    s.log = [...s.log, log(s, side, profile.name,
      `${profile.name} must be more than 9" from the enemy deployment zone.`,
      'info',
    )];
    return s;
  }

  const modelPositions = playGridFormation(profile, position, side);
  const unit = makeBattleUnit(profile, side, modelPositions);

  s.units.push(unit);
  s.unplacedUnits[side] = [...unplaced.slice(0, unitIndex), ...unplaced.slice(unitIndex + 1)];
  const attachedLeaders = attachedFollowersFor(s.armies[side].army, profile);
  attachedLeaders.forEach((leader, leaderIndex) => {
    const anchor = leaderAnchor(unit, leader, leaderIndex, side, deployment, board);
    const leaderPositions = playGridFormation(leader, anchor, side);
    const leaderUnit = makeBattleUnit(leader, side, leaderPositions, unit.id, unit.tabletopUnitId);
    resolveInternalModelOverlaps(leaderUnit, zone, board);
    avoidDeploymentOverlap(leaderUnit, s, zone);
    resolveInternalModelOverlaps(leaderUnit, zone, board);
    s.units.push(leaderUnit);
    removeUnitFromUnplaced(s, side, leader);
  });
  s.log = [...s.log, log(s, side, profile.name,
    `${s.armies[side].name} deploys ${profile.name} at (${unit.position.x.toFixed(1)}", ${unit.position.y.toFixed(1)}").`,
    'info',
  )];

  s.activeArmy = s.unplacedUnits[side].length ? side : (1 - side) as Side;
  return s;
}

export function placePlayReinforcement(state: BattleState, side: Side, armyUnitIndex: number, position: Position): BattleState {
  if (state.phase !== 'movement' || movementStep(state) !== 'reinforcements' || state.activeArmy !== side) return state;
  const profile = state.armies[side].army.units[armyUnitIndex];
  if (!profile || !unitIsStagedReinforcement(profile)) return state;

  const profileKey = unitRosterId(profile);
  if (state.units.some(unit => unit.side === side && !unit.destroyed && unitRosterId(unit.profile) === profileKey)) return state;

  const modelPositions = playGridFormation(profile, position, side);
  if (!reinforcementPlacementIsOutsideEnemyRange(state, side, modelPositions)) return state;

  const s = clone(state);
  const board = boardFormatForState(s);
  const unit = makeBattleUnit(profile, side, modelPositions);
  markUnitArrivedFromReinforcements(unit);
  resolveInternalModelOverlaps(unit, undefined, board);
  s.units.push(unit);

  const movingIndices = new Set(unit.modelPositions.map((_, modelIndex) => modelIndex));
  if (!playMoveHasNoBaseOverlap(s, unit, movingIndices) || !playMoveHasNoWallOverlap(s, unit, movingIndices)) return state;

  s.log = [...s.log, log(
    s,
    side,
    profile.name,
    `${s.armies[side].name} sets up ${profile.name} as Reinforcements more than 9" from enemy models.`,
    'move',
  )];
  return s;
}

export function placePlayStrategicReserveUnit(state: BattleState, side: Side, unitId: string, position: Position): BattleState {
  if (state.phase !== 'movement' || movementStep(state) !== 'reinforcements') return state;
  const existing = state.units.find(unit =>
    unit.id === unitId
    && unit.side === side
    && !unit.destroyed
    && unit.inStrategicReserves
    && (
      (state.activeArmy === side && isAircraft(unit))
      || (state.activeArmy !== side && unit.rapidIngressThisPhase)
    )
  );
  if (!existing) return state;

  const s = clone(state);
  const board = boardFormatForState(s);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed)!;
  unit.modelPositions = playGridFormation(unit.profile, position, side).slice(0, unit.remainingModels);
  unit.modelRotations = unit.modelPositions.map(() => side === 0 ? 0 : 180);
  unit.facingDeg = side === 0 ? 0 : 180;
  unit.position = centroid(unit.modelPositions);
  unit.inStrategicReserves = false;
  unit.rapidIngressThisPhase = undefined;
  markUnitArrivedFromReinforcements(unit);
  resolveInternalModelOverlaps(unit, undefined, board);

  const movingIndices = new Set(unit.modelPositions.map((_, modelIndex) => modelIndex));
  if (
    !reinforcementPlacementIsOutsideEnemyRange(s, side, unit.modelPositions)
    || !reinforcementPlacementIsWithinStrategicReserveEdge(unit, s)
    || !playMoveHasNoBaseOverlap(s, unit, movingIndices)
    || !playMoveHasNoWallOverlap(s, unit, movingIndices)
  ) return state;

  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${s.armies[side].name} returns ${unit.profile.name} from Strategic Reserves more than 9" from enemy models${state.activeArmy !== side ? ' using Rapid Ingress' : ''}.`,
    'move',
  )];
  return s;
}

export function playUnitCanEmbark(
  state: BattleState,
  unitId: string,
  side: Side,
  transportUnitId?: string,
): boolean {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (
    !unit
    || unit.embarkedInUnitId
    || unitIsTransportProfile(unit.profile)
    || unit.movementComplete
    || unit.movementAction === 'fellBack'
    || unit.fellBack
  ) return false;
  const transport = transportUnitId
    ? state.units.find(candidate => candidate.id === transportUnitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)
    : nearestFriendlyTransportInRange(state, unit, TRANSPORT_ACCESS_RANGE);
  if (!transport || !unitIsTransportProfile(transport.profile)) return false;
  if (transportCapacityRemaining(state, transport.id) < unit.remainingModels) return false;
  return everyModelWithinRange(unit, transport, TRANSPORT_ACCESS_RANGE);
}

export function embarkPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  transportUnitId?: string,
): BattleState {
  if (!playUnitCanEmbark(state, unitId, side, transportUnitId)) return state;
  const existingUnit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed)!;
  const existingTransport = transportUnitId
    ? state.units.find(candidate => candidate.id === transportUnitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)
    : nearestFriendlyTransportInRange(state, existingUnit, TRANSPORT_ACCESS_RANGE);
  if (!existingTransport) return state;

  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed)!;
  const transport = s.units.find(candidate => candidate.id === existingTransport.id && candidate.side === side && !candidate.destroyed)!;
  cancelUnitAction(s, unit, 'it left the battlefield');
  unit.embarkedInUnitId = transport.id;
  unit.position = { ...transport.position };
  unit.modelPositions = transport.modelPositions.map(position => ({ ...position })).slice(0, Math.max(1, unit.remainingModels));
  while (unit.modelPositions.length < unit.remainingModels) unit.modelPositions.push({ ...transport.position });
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  unit.movementComplete = true;
  unit.inCombat = false;
  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${unit.profile.name} embarks within ${transport.profile.name}.`,
    'move',
  )];
  return s;
}

export function playUnitCanDisembark(
  state: BattleState,
  side: Side,
  transportUnitId: string,
  passengerUnitId?: string,
  armyUnitIndex?: number,
): boolean {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const transport = state.units.find(candidate => candidate.id === transportUnitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!transport || !unitIsTransportProfile(transport.profile) || transport.movementAction || transport.movementComplete) return false;
  const passenger = passengerUnitId
    ? state.units.find(candidate => candidate.id === passengerUnitId && candidate.side === side && !candidate.destroyed && candidate.embarkedInUnitId === transportUnitId)
    : null;
  const profile = passenger?.profile ?? (typeof armyUnitIndex === 'number' ? state.armies[side].army.units[armyUnitIndex] : undefined);
  if (!profile || (armyUnitIndex !== undefined && !unitAssignedToTransport(profile, transport))) return false;
  if (state.units.some(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId && unitRosterId(unit.profile) === unitRosterId(profile))) return false;
  return !!disembarkPositions(state, transport, profile);
}

export function disembarkPlayUnit(
  state: BattleState,
  side: Side,
  transportUnitId: string,
  passengerUnitId?: string,
  armyUnitIndex?: number,
): BattleState {
  if (!playUnitCanDisembark(state, side, transportUnitId, passengerUnitId, armyUnitIndex)) return state;
  const s = clone(state);
  const transport = s.units.find(candidate => candidate.id === transportUnitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
  const existingPassenger = passengerUnitId
    ? s.units.find(candidate => candidate.id === passengerUnitId && candidate.side === side && !candidate.destroyed && candidate.embarkedInUnitId === transportUnitId)
    : null;
  const profile = existingPassenger?.profile ?? (typeof armyUnitIndex === 'number' ? s.armies[side].army.units[armyUnitIndex] : undefined);
  if (!profile) return state;
  const positions = disembarkPositions(s, transport, profile);
  if (!positions) return state;

  const unit = existingPassenger ?? makeBattleUnit(profile, side, positions);
  unit.embarkedInUnitId = undefined;
  unit.modelPositions = positions;
  unit.modelRotations = positions.map(() => side === 0 ? 0 : 180);
  unit.position = centroid(positions);
  unit.remainingModels = Math.min(unit.remainingModels || profile.baseModelCount, positions.length);
  unit.movementAction = undefined;
  unit.movementAllowanceRemaining = normalMoveAllowance(unit);
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => normalMoveAllowance(unit));
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => normalMoveAllowance(unit));
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  unit.movementComplete = false;
  unit.inCombat = false;
  if (!existingPassenger) s.units.push(unit);
  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${unit.profile.name} disembarks from ${transport.profile.name}.`,
    'move',
  )];
  return s;
}

function coherencyListLabel(units: BattleUnit[]): string {
  return Array.from(new Set(units.map(unit => unit.profile.name))).join(' + ');
}

function coherencyModelLists(state: BattleState): Array<{ label: string; models: CoherencyModel[] }> {
  const deployedUnits = state.units.filter(unit => !unit.destroyed && !unit.embarkedInUnitId);
  const handled = new Set<string>();
  const lists: Array<{ label: string; models: CoherencyModel[] }> = [];

  const pushList = (units: BattleUnit[]): void => {
    lists.push({
      label: coherencyListLabel(units),
      models: units.flatMap(unit =>
        unit.modelPositions.map((model, modelIndex) => ({ unit, model, modelIndex })),
      ),
    });
    units.forEach(unit => handled.add(unit.id));
  };

  for (const unit of deployedUnits) {
    if (handled.has(unit.id)) continue;
    const attachedProfileIds = new Set(
      attachedUnitProfilesFor(state.armies[unit.side].army, unit.profile).map(unitRosterId),
    );
    const attachedUnits = deployedUnits.filter(candidate =>
      candidate.side === unit.side && attachedProfileIds.has(unitRosterId(candidate.profile)),
    );
    pushList(attachedUnits);
  }

  return lists;
}

function shouldShowCoherencyIssues(state: BattleState): boolean {
  return state.phase === 'deployment' || state.phase === 'movement';
}

export function battleUnitIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (!shouldShowCoherencyIssues(state)) return new Set();
  const unitIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    if (modelListIsCoherent(list.models)) continue;
    list.models.forEach(model => unitIds.add(model.unit.id));
  }
  return unitIds;
}

export function battleModelIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (!shouldShowCoherencyIssues(state)) return new Set();
  const modelIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    const issueIndices = modelIndicesWithCoherencyIssues(list.models);
    issueIndices.forEach(index => {
      const model = list.models[index];
      if (model) modelIds.add(`${model.unit.id}:${model.modelIndex}`);
    });
  }
  return modelIds;
}

export function battleCoherencyIssues(state: BattleState, side?: Side): string[] {
  const issues: string[] = [];
  for (const list of coherencyModelLists(state)) {
    if (side !== undefined && !list.models.some(model => model.unit.side === side)) continue;
    if (modelListIsCoherent(list.models)) continue;
    issues.push(`${list.label} (${list.models.length} models) is out of coherency.`);
  }
  return issues;
}

export function playPhaseCoherencyIssues(state: BattleState): string[] {
  if (state.phase !== 'movement') return [];
  return [
    ...battleCoherencyIssues(state, state.activeArmy),
    ...playMovementLegalityIssues(state, state.activeArmy),
  ];
}

function modelMoveHasNoBaseOverlap(s: BattleState, unit: BattleUnit, modelIndex: number): boolean {
  const model = unit.modelPositions[modelIndex];
  const footprint = modelFootprint(unit, modelIndex);
  return s.units.every(otherUnit => {
    if (otherUnit.destroyed || otherUnit.embarkedInUnitId) return true;
    return otherUnit.modelPositions.every((otherModel, otherModelIndex) => {
      if (otherUnit.id === unit.id && otherModelIndex === modelIndex) return true;
      if (verticalDistance(model, otherModel) > 0.5) return true;
      const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
      return !baseFootprintsOverlap(model, footprint, otherModel, otherFootprint);
    });
  });
}

export function movePlayModel(state: BattleState, unitId: string, modelIndex: number, position: Position): BattleState {
  const s = clone(state);
  if (!PLAY_MODEL_EDIT_PHASES.includes(s.phase)) return s;
  if (s.phase === 'movement' && movementStep(s) !== 'moveUnits') return s;

  const unit = s.units.find(u => u.id === unitId && !u.destroyed && !u.embarkedInUnitId);
  if (!unit || !unit.modelPositions[modelIndex]) return s;

  if (s.phase === 'deployment') {
    const board = boardFormatForState(s);
    const radius = modelBaseRadius(unit, modelIndex);
    const deployment = setupDeploymentZoneSource(s.setup);
    const zone = zoneFor(unit.side, deployment, board);
    if (!canDeployOutsideDeploymentZone(unit.profile) && !pointInDeploymentZone(position, zone, radius)) return s;
    if (!modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, position, modelIndex, deployment, board)) return s;
  }

  unit.modelPositions[modelIndex] = position;
  unit.position = centroid(unit.modelPositions);

  if (!modelMoveHasNoBaseOverlap(s, unit, modelIndex)) return state;

  return s;
}

function applyPlayModelTranslation(
  unit: BattleUnit,
  modelIndices: number[],
  dx: number,
  dy: number,
  board = boardFormatForId(),
): void {
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    unit.modelPositions[modelIndex] = {
      ...position,
      x: Math.max(0, Math.min(board.width, position.x + dx)),
      y: Math.max(0, Math.min(board.height, position.y + dy)),
    };
  }
  unit.position = centroid(unit.modelPositions);
}

function applyPlayModelVerticalTranslation(
  unit: BattleUnit,
  modelIndices: number[],
  dz: number,
): void {
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    unit.modelPositions[modelIndex] = {
      ...position,
      z: Math.max(0, (position.z ?? 0) + dz),
    };
  }
  unit.position = centroid(unit.modelPositions);
}

function playMoveHasNoBaseOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  for (const modelIndex of movingIndices) {
    const model = movingUnit.modelPositions[modelIndex];
    const footprint = modelFootprint(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (otherUnit.id === movingUnit.id && movingIndices.has(otherModelIndex)) continue;
        if (verticalDistance(model, otherUnit.modelPositions[otherModelIndex]) > 0.5) continue;
        const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
        if (baseFootprintsOverlap(model, footprint, otherUnit.modelPositions[otherModelIndex], otherFootprint)) return false;
      }
    }
  }
  return true;
}

function playMoveHasNoWallOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  for (const modelIndex of movingIndices) {
    const model = movingUnit.modelPositions[modelIndex];
    const footprint = modelFootprint(movingUnit, modelIndex);
    for (const terrain of state.terrain) {
      for (const feature of terrain.features) {
        if (!featureBlocksMovementForUnit(feature, terrain, movingUnit)) continue;
        if (baseFootprintIntersectsRect(model, footprint, feature)) return false;
      }
    }
  }
  return true;
}

function playMoveHasNoEndCollision(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
): boolean {
  return playMoveHasNoBaseOverlap(state, movingUnit, movingIndices)
    && playMoveHasNoWallOverlap(state, movingUnit, movingIndices)
    && !inEngagement(movingUnit, enemies(state, movingUnit.side), rules40K10th.engagementRange());
}

function distancePointToSegment(point: Position, from: Position, to: Position): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) return dist(point, from);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq));
  return dist(point, { x: from.x + dx * t, y: from.y + dy * t });
}

function pointSegmentProjectionT(point: Position, from: Position, to: Position): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.000001) return 0;
  return Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq));
}

function playMovePathCrossesEnemyModels(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  includeFriendly = false,
): boolean {
  if (hasKeyword(movingUnit, 'fly')) return false;

  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    const movingRadius = modelBaseRadius(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId) continue;
      if (otherUnit.id === movingUnit.id || (!includeFriendly && otherUnit.side === movingUnit.side)) continue;
      if (otherUnit.side !== movingUnit.side && isAircraft(otherUnit)) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (verticalDistance(from, otherUnit.modelPositions[otherModelIndex]) > 0.5) continue;
        const clearance = movingRadius + modelBaseRadius(otherUnit, otherModelIndex);
        if (distancePointToSegment(otherUnit.modelPositions[otherModelIndex], from, to) < clearance) return true;
      }
    }
  }
  return false;
}

function playMoveEnemyCrossingModelIndices(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
): number[] {
  const crossingModelIndices: number[] = [];

  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    const movingRadius = modelBaseRadius(movingUnit, modelIndex);
    const crossesEnemy = state.units.some(otherUnit => {
      if (otherUnit.destroyed || otherUnit.side === movingUnit.side) return false;
      if (isAircraft(otherUnit)) return false;
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
      if (verticalDistance(from, otherModel) > 0.5) return false;
      const clearance = movingRadius + modelBaseRadius(otherUnit, otherModelIndex);
      if (dist(otherModel, from) < clearance && dist(otherModel, to) < clearance) return false;
      if (pointSegmentProjectionT(otherModel, from, to) <= 0.05) return false;
      return distancePointToSegment(otherModel, from, to) < clearance;
      });
    });
    if (crossesEnemy) crossingModelIndices.push(modelIndex);
  }

  return crossingModelIndices;
}

function playMovePathCrossesBlockingTerrain(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
): boolean {
  if (hasKeyword(movingUnit, 'fly')) return false;

  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    for (const terrain of state.terrain) {
      for (const feature of terrain.features) {
        if (featureBlocksMovementForUnit(feature, terrain, movingUnit) && lineIntersectsTerrain(from, to, feature)) return true;
      }
    }
  }
  return false;
}

function playMoveHasNoPathCollision(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  options: { ignoreEnemyModelPath?: boolean } = {},
): boolean {
  return (options.ignoreEnemyModelPath || !playMovePathCrossesEnemyModels(state, movingUnit, movingIndices, dx, dy, true))
    && !playMovePathCrossesBlockingTerrain(state, movingUnit, movingIndices, dx, dy);
}

function translatedPlayMoveEndsInEngagement(
  state: BattleState,
  movingUnit: BattleUnit,
  modelIndices: number[],
  dx: number,
  dy: number,
): boolean {
  const test = clone(state);
  const testUnit = test.units.find(u => u.id === movingUnit.id && u.side === movingUnit.side && !u.destroyed);
  if (!testUnit) return false;
  applyPlayModelTranslation(testUnit, modelIndices, dx, dy, boardFormatForState(state));
  return inEngagement(testUnit, enemies(test, testUnit.side), rules40K10th.engagementRange());
}

function unitHasBaseOverlap(state: BattleState, unit: BattleUnit): boolean {
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const model = unit.modelPositions[modelIndex];
    const footprint = modelFootprint(unit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (otherUnit.id === unit.id && otherModelIndex === modelIndex) continue;
        if (verticalDistance(model, otherUnit.modelPositions[otherModelIndex]) > 0.5) continue;
        const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
        if (baseFootprintsOverlap(model, footprint, otherUnit.modelPositions[otherModelIndex], otherFootprint, 0.001)) return true;
      }
    }
  }
  return false;
}

function unitHasModelOutsideBattlefield(unit: BattleUnit, state: BattleState): boolean {
  const board = boardFormatForState(state);
  return unit.modelPositions.some((model, modelIndex) =>
    !baseFootprintWithinRect(model, modelFootprint(unit, modelIndex), { x: 0, y: 0, width: board.width, height: board.height }),
  );
}

function aircraftForwardVector(unit: BattleUnit, modelIndex = 0): Position {
  const rotation = unit.movementStartRotationsByModel?.[modelIndex] ?? modelRotation(unit, modelIndex);
  const radians = (rotation * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function aircraftMoveIsStraightForward(unit: BattleUnit, modelIndices: number[], dx: number, dy: number): boolean {
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return false;
  return modelIndices.every(modelIndex => {
    const forward = aircraftForwardVector(unit, modelIndex);
    const parallel = dx * forward.x + dy * forward.y;
    const perpendicular = Math.abs(dx * forward.y - dy * forward.x);
    return parallel > 0 && perpendicular <= 0.01;
  });
}

function aircraftMinimumMoveDistance(unit: BattleUnit): number {
  return 20;
}

function aircraftMovedMinimumDistance(unit: BattleUnit): boolean {
  if (!isAircraft(unit) || unit.inStrategicReserves) return true;
  if (unit.movementAction !== 'normalMove') return false;
  return unit.modelPositions.every((_, modelIndex) =>
    modelMovementDistanceFromStart(unit, modelIndex) >= aircraftMinimumMoveDistance(unit) - 0.001,
  );
}

function normalizedAngleDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

function aircraftPivotWithinLimit(unit: BattleUnit, modelIndices: number[]): boolean {
  return modelIndices.every(modelIndex => {
    const start = unit.movementStartRotationsByModel?.[modelIndex] ?? modelRotation(unit, modelIndex);
    return Math.abs(normalizedAngleDelta(modelRotation(unit, modelIndex), start)) <= 90.001;
  });
}

function moveAircraftToStrategicReserves(state: BattleState, unit: BattleUnit): void {
  cancelUnitAction(state, unit, 'it left the battlefield');
  unit.inStrategicReserves = true;
  unit.modelPositions = [];
  unit.modelRotations = [];
  unit.position = { x: 0, y: 0 };
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = [];
  unit.movementAllowanceTotalByModel = [];
  unit.movementStartPositionsByModel = [];
  unit.movementStartRotationsByModel = [];
  unit.movementComplete = true;
  unit.inCombat = false;
  state.log = [...state.log, log(
    state,
    unit.side,
    unit.profile.name,
    `${unit.profile.name} leaves the battlefield and is placed into Strategic Reserves.`,
    'move',
  )];
}

function unitHasWallOverlap(state: BattleState, unit: BattleUnit): boolean {
  return !playMoveHasNoWallOverlap(state, unit, new Set(unit.modelPositions.map((_, modelIndex) => modelIndex)));
}

function movedModelDeltasFromStart(unit: BattleUnit): Array<{ modelIndex: number; dx: number; dy: number }> {
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return [];
  return unit.modelPositions.flatMap((position, modelIndex) => {
    const start = starts[modelIndex];
    if (!start) return [];
    const dx = position.x - start.x;
    const dy = position.y - start.y;
    return Math.hypot(dx, dy) > 0.001 ? [{ modelIndex, dx, dy }] : [];
  });
}

function unitMoveCrossedEnemyModels(state: BattleState, unit: BattleUnit): boolean {
  if (unit.movementAction !== 'normalMove' && unit.movementAction !== 'advanced') return false;
  if (hasKeyword(unit, 'fly')) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    const movingRadius = modelBaseRadius(unit, modelIndex);
    return state.units.some(otherUnit => {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId || otherUnit.side === unit.side) return false;
      if (isAircraft(otherUnit)) return false;
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
        if (verticalDistance(from, otherModel) > 0.5) return false;
        const clearance = movingRadius + modelBaseRadius(otherUnit, otherModelIndex);
        if (dist(otherModel, from) < clearance || dist(otherModel, to) < clearance) return false;
        return distancePointToSegment(otherModel, from, to) < clearance;
      });
    });
  });
}

function unitMoveCrossedBlockingTerrain(state: BattleState, unit: BattleUnit): boolean {
  if (hasKeyword(unit, 'fly')) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    return state.terrain.some(terrain =>
      terrain.features.some(feature =>
        featureBlocksMovementForUnit(feature, terrain, unit) && lineIntersectsTerrain(from, to, feature),
      ),
    );
  });
}

function monsterVehicleMovedOverFriendlyMonsterVehicle(state: BattleState, unit: BattleUnit): boolean {
  if (!hasAnyKeyword(unit, ['monster', 'vehicle']) || hasKeyword(unit, 'fly')) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    const movingRadius = modelBaseRadius(unit, modelIndex);
    return state.units.some(otherUnit => {
      if (
        otherUnit.id === unit.id
        || otherUnit.side !== unit.side
        || otherUnit.destroyed
        || otherUnit.embarkedInUnitId
        || !hasAnyKeyword(otherUnit, ['monster', 'vehicle'])
      ) return false;
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
        if (verticalDistance(from, otherModel) > 0.5) return false;
        const clearance = movingRadius + modelBaseRadius(otherUnit, otherModelIndex);
        if (dist(otherModel, from) < clearance || dist(otherModel, to) < clearance) return false;
        return distancePointToSegment(otherModel, from, to) < clearance;
      });
    });
  });
}

function playMovementUnitLegalityIssues(state: BattleState, unit: BattleUnit): string[] {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves) return [];
  const issues: string[] = [];
  if (isAircraft(unit) && !aircraftMovedMinimumDistance(unit)) {
    issues.push(`${unit.profile.name} is an Aircraft and must make a Normal move of at least 20".`);
  }
  if (unitHasModelOutsideBattlefield(unit, state)) issues.push(`${unit.profile.name} has a model across the battlefield edge.`);
  if (unitHasBaseOverlap(state, unit)) issues.push(`${unit.profile.name} cannot end its move on top of another model.`);
  if (unitHasWallOverlap(state, unit)) issues.push(`${unit.profile.name} cannot end its move inside blocking terrain.`);
  if (
    (unit.movementAction === 'normalMove' || unit.movementAction === 'advanced')
    && inEngagement(unit, enemies(state, unit.side), rules40K10th.engagementRange())
  ) {
    issues.push(`${unit.profile.name} cannot end a Normal or Advance move within Engagement Range.`);
  }
  if (unitMoveCrossedEnemyModels(state, unit)) issues.push(`${unit.profile.name} moved across an enemy model.`);
  if (unitMoveCrossedBlockingTerrain(state, unit)) issues.push(`${unit.profile.name} moved through blocking terrain.`);
  if (monsterVehicleMovedOverFriendlyMonsterVehicle(state, unit)) {
    issues.push(`${unit.profile.name} is a Monster or Vehicle and must move around friendly Monsters and Vehicles.`);
  }
  return issues;
}

function playMovementLegalityIssues(state: BattleState, side: Side): string[] {
  if (state.phase !== 'movement') return [];
  return Array.from(new Set(
    state.units
      .filter(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId)
      .flatMap(unit => playMovementUnitLegalityIssues(state, unit)),
  ));
}

function collisionAdjustedPlayMove(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dx: number,
  dy: number,
  options: { ignoreEnemyModelPath?: boolean } = {},
): { dx: number; dy: number } {
  const movingIndices = new Set(modelIndices);
  const candidate = clone(state);
  const candidateUnit = candidate.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!candidateUnit) return { dx, dy };
  const board = boardFormatForState(state);

  applyPlayModelTranslation(candidateUnit, modelIndices, dx, dy, board);
  if (
    playMoveHasNoEndCollision(candidate, candidateUnit, movingIndices)
    && playMoveHasNoPathCollision(state, state.units.find(u => u.id === unitId && u.side === side && !u.destroyed)!, movingIndices, dx, dy, {
      ignoreEnemyModelPath: !!options.ignoreEnemyModelPath,
    })
  ) return { dx, dy };

  let lo = 0;
  let hi = 1;
  const movingUnit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!movingUnit) return { dx: 0, dy: 0 };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const test = clone(state);
    const testUnit = test.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
    if (!testUnit) break;
    applyPlayModelTranslation(testUnit, modelIndices, dx * mid, dy * mid, board);
    if (
      playMoveHasNoEndCollision(test, testUnit, movingIndices)
      && playMoveHasNoPathCollision(state, movingUnit, movingIndices, dx * mid, dy * mid, {
        ignoreEnemyModelPath: !!options.ignoreEnemyModelPath,
      })
    ) lo = mid;
    else hi = mid;
  }

  return { dx: dx * lo, dy: dy * lo };
}

function movementAllowanceForPlayMove(unit: BattleUnit): number {
  if (unit.movementAllowanceTotalByModel?.length) {
    return Math.max(...unit.movementAllowanceTotalByModel);
  }
  if (unit.movementAction === 'advanced') {
    return unit.movementAllowanceRemaining ?? normalMoveAllowance(unit);
  }
  return normalMoveAllowance(unit);
}

function ensureModelMovementStartPositions(unit: BattleUnit): Position[] {
  if (!unit.movementStartPositionsByModel || unit.movementStartPositionsByModel.length !== unit.modelPositions.length) {
    unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  }
  return unit.movementStartPositionsByModel;
}

function ensureModelMovementStartRotations(unit: BattleUnit): number[] {
  if (!unit.movementStartRotationsByModel || unit.movementStartRotationsByModel.length !== unit.modelPositions.length) {
    unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  }
  return unit.movementStartRotationsByModel;
}

function ensureModelMovementAllowanceTotals(unit: BattleUnit): number[] {
  const allowance = movementAllowanceForPlayMove(unit);
  if (!unit.movementAllowanceTotalByModel || unit.movementAllowanceTotalByModel.length !== unit.modelPositions.length) {
    unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => allowance);
  }
  return unit.movementAllowanceTotalByModel;
}

function modelMovementDistanceFromStart(unit: BattleUnit, modelIndex: number): number {
  const position = unit.modelPositions[modelIndex];
  const start = unit.movementStartPositionsByModel?.[modelIndex] ?? position;
  const startRotation = unit.movementStartRotationsByModel?.[modelIndex] ?? modelRotation(unit, modelIndex);
  const currentRotation = modelRotation(unit, modelIndex);
  const horizontal = baseFootprintMaxPointDistance(
    start,
    modelFootprint(unit, modelIndex, startRotation),
    position,
    modelFootprint(unit, modelIndex, currentRotation),
  );
  return horizontal + verticalDistance(start, position);
}

function refreshModelMovementAllowances(unit: BattleUnit): number[] {
  ensureModelMovementStartPositions(unit);
  ensureModelMovementStartRotations(unit);
  const totals = ensureModelMovementAllowanceTotals(unit);
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map((position, modelIndex) =>
    Math.max(0, (totals[modelIndex] ?? 0) - modelMovementDistanceFromStart(unit, modelIndex)),
  );
  unit.movementAllowanceRemaining = unit.movementAllowanceRemainingByModel.length
    ? Math.max(...unit.movementAllowanceRemainingByModel)
    : 0;
  return unit.movementAllowanceRemainingByModel;
}

function updateModelMovementAllowances(unit: BattleUnit): void {
  refreshModelMovementAllowances(unit);
}

function playMovementGroupId(unit: BattleUnit): string {
  return unit.tabletopUnitId ?? unit.id;
}

function lockOtherMovedPlayUnits(state: BattleState, currentUnit: BattleUnit): void {
  if (state.phase !== 'movement') return;
  const currentGroupId = playMovementGroupId(currentUnit);
  for (const unit of state.units) {
    if (
      unit.side !== currentUnit.side
      || unit.destroyed
      || playMovementGroupId(unit) === currentGroupId
      || unit.movementComplete
    ) continue;
    if (unit.movementAction === 'normalMove' || unit.movementAction === 'advanced') {
      unit.movementComplete = true;
    }
  }
}

function markPlayMovementGroupComplete(state: BattleState, currentUnit: BattleUnit): void {
  const currentGroupId = playMovementGroupId(currentUnit);
  for (const unit of state.units) {
    if (unit.side === currentUnit.side && !unit.destroyed && playMovementGroupId(unit) === currentGroupId) {
      unit.movementComplete = true;
    }
  }
}

function budgetAdjustedPlayMove(unit: BattleUnit, modelIndices: number[], dx: number, dy: number): { dx: number; dy: number } {
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return { dx, dy };

  ensureModelMovementStartPositions(unit);
  ensureModelMovementStartRotations(unit);
  ensureModelMovementAllowanceTotals(unit);
  const moveWithinAllowance = (scale: number) => modelIndices.every(modelIndex => {
    const current = unit.modelPositions[modelIndex];
    const total = unit.movementAllowanceTotalByModel?.[modelIndex] ?? 0;
    const proposed = { x: current.x + dx * scale, y: current.y + dy * scale };
    const start = unit.movementStartPositionsByModel?.[modelIndex] ?? current;
    const startRotation = unit.movementStartRotationsByModel?.[modelIndex] ?? modelRotation(unit, modelIndex);
    return baseFootprintMaxPointDistance(
      start,
      modelFootprint(unit, modelIndex, startRotation),
      proposed,
      modelFootprint(unit, modelIndex),
    ) <= total + 0.000001;
  });

  if (moveWithinAllowance(1)) return { dx, dy };

  const rotationsUnchanged = modelIndices.every(modelIndex =>
    Math.abs((unit.movementStartRotationsByModel?.[modelIndex] ?? modelRotation(unit, modelIndex)) - modelRotation(unit, modelIndex)) < 0.001,
  );
  if (rotationsUnchanged) {
    let scale = 1;
    for (const modelIndex of modelIndices) {
      const current = unit.modelPositions[modelIndex];
      const start = unit.movementStartPositionsByModel?.[modelIndex] ?? current;
      const total = unit.movementAllowanceTotalByModel?.[modelIndex] ?? 0;
      const relX = current.x - start.x;
      const relY = current.y - start.y;
      const a = dx * dx + dy * dy;
      const b = 2 * (relX * dx + relY * dy);
      const c = relX * relX + relY * relY - total * total;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0 || a <= 0.000001) {
        scale = 0;
        continue;
      }
      const limit = (-b + Math.sqrt(discriminant)) / (2 * a);
      scale = Math.min(scale, Math.max(0, limit));
    }
    return { dx: dx * scale, dy: dy * scale };
  }

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (moveWithinAllowance(mid)) lo = mid;
    else hi = mid;
  }

  return { dx: dx * lo, dy: dy * lo };
}

export function movePlayModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dx: number,
  dy: number,
  collide = false,
): BattleState {
  if (!PLAY_MODEL_EDIT_PHASES.includes(state.phase)) return state;
  if (state.phase === 'movement' && movementStep(state) !== 'moveUnits') return state;

  const existingUnit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!existingUnit) return state;
  if (state.phase === 'movement') {
    if (state.activeArmy !== side) return state;
    if (
      existingUnit.movementComplete
      || existingUnit.fellBack
      || existingUnit.movementAction === 'fellBack'
      || existingUnit.movementAction === 'remainedStationary'
    ) return state;
    if (!isAircraft(existingUnit) && nonAircraftEngagedEnemies(state, existingUnit, rules40K10th).length > 0) return state;
  }

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId)!;
  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return state;

  if (s.phase === 'movement' && isAircraft(unit)) {
    ensureModelMovementStartPositions(unit);
    ensureModelMovementStartRotations(unit);
    ensureModelMovementAllowanceTotals(unit);
    if (!aircraftMoveIsStraightForward(unit, uniqueIndices, dx, dy)) return state;
  }

  const budgetMove = s.phase === 'movement' && !isAircraft(unit) ? budgetAdjustedPlayMove(unit, uniqueIndices, dx, dy) : { dx, dy };
  if (Math.hypot(budgetMove.dx, budgetMove.dy) < 0.001) return state;
  if (
    s.phase === 'movement'
    && translatedPlayMoveEndsInEngagement(s, unit, uniqueIndices, budgetMove.dx, budgetMove.dy)
  ) return state;

  const move = collide
    ? collisionAdjustedPlayMove(s, unitId, side, uniqueIndices, budgetMove.dx, budgetMove.dy)
    : budgetMove;
  if (Math.hypot(move.dx, move.dy) < 0.001) return state;

  if (s.phase === 'movement' && isAircraft(unit)) {
    const test = clone(s);
    const testUnit = test.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId)!;
    for (const modelIndex of uniqueIndices) {
      const position = testUnit.modelPositions[modelIndex];
      testUnit.modelPositions[modelIndex] = { x: position.x + move.dx, y: position.y + move.dy };
    }
    testUnit.position = centroid(testUnit.modelPositions);
    if (unitHasModelOutsideBattlefield(testUnit, s)) {
      moveAircraftToStrategicReserves(s, unit);
      return s;
    }
  }

  applyPlayModelTranslation(unit, uniqueIndices, move.dx, move.dy, boardFormatForState(s));
  cancelUnitAction(s, unit, 'it made a move');
  if (s.phase === 'movement' && inEngagement(unit, enemies(s, side), rules40K10th.engagementRange())) return state;

  if (s.phase === 'movement') {
    lockOtherMovedPlayUnits(s, unit);
    unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
    updateModelMovementAllowances(unit);
  }
  return s;
}

export function movePlayModelsVertically(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dz: number,
): BattleState {
  if (Math.abs(dz) < 0.001) return state;
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return state;

  const existingUnit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!existingUnit) return state;
  if (
    existingUnit.inStrategicReserves
    || existingUnit.movementComplete
    || existingUnit.fellBack
    || existingUnit.movementAction === 'fellBack'
    || existingUnit.movementAction === 'remainedStationary'
    || isAircraft(existingUnit)
    || nonAircraftEngagedEnemies(state, existingUnit, rules40K10th).length > 0
  ) return state;

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId)!;
  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return state;

  ensureModelMovementStartPositions(unit);
  ensureModelMovementStartRotations(unit);
  ensureModelMovementAllowanceTotals(unit);

  const before = unit.modelPositions.map(position => ({ ...position }));
  applyPlayModelVerticalTranslation(unit, uniqueIndices, dz);
  if (uniqueIndices.every(modelIndex => Math.abs((unit.modelPositions[modelIndex].z ?? 0) - (before[modelIndex].z ?? 0)) < 0.001)) return state;

  const totals = ensureModelMovementAllowanceTotals(unit);
  if (uniqueIndices.some(modelIndex => modelMovementDistanceFromStart(unit, modelIndex) > (totals[modelIndex] ?? 0) + 0.001)) return state;
  if (inEngagement(unit, enemies(s, side), rules40K10th.engagementRange())) return state;

  lockOtherMovedPlayUnits(s, unit);
  cancelUnitAction(s, unit, 'it made a move');
  unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
  updateModelMovementAllowances(unit);
  return s;
}

export function removePlayModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
): BattleState {
  const s = clone(state);
  if (s.phase !== 'movement' || movementStep(s) !== 'moveUnits' || s.activeArmy !== side) return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!unit) return s;

  const uniqueIndices = Array.from(new Set(modelIndices))
    .filter(modelIndex => unit.modelPositions[modelIndex])
    .sort((a, b) => b - a);
  if (!uniqueIndices.length) return s;

  spliceModelIndices(unit, uniqueIndices);

  unit.remainingModels = Math.max(0, unit.remainingModels - uniqueIndices.length);
  unit.destroyed = unit.remainingModels <= 0 || unit.modelPositions.length === 0;
  unit.remainingModels = unit.destroyed ? 0 : Math.min(unit.remainingModels, unit.modelPositions.length);
  if (!unit.destroyed) {
    unit.position = centroid(unit.modelPositions);
    if (unit.movementAllowanceRemainingByModel?.length) {
      unit.movementAllowanceRemaining = Math.max(...unit.movementAllowanceRemainingByModel);
    }
  } else {
    unit.movementAllowanceRemaining = 0;
    unit.movementAllowanceRemainingByModel = [];
    unit.movementAllowanceTotalByModel = [];
    unit.movementStartPositionsByModel = [];
    unit.movementStartRotationsByModel = [];
    recordDestroyedUnitMissionEvent(s, unit, side);
  }

  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${s.armies[side].name} removes ${uniqueIndices.length} ${unit.profile.name} model${uniqueIndices.length === 1 ? '' : 's'} to restore coherency.`,
    'info',
  )];
  return s;
}

export function removePlayCasualtyModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
): BattleState {
  const pendingUnit = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const pendingCasualties = pendingUnit?.pendingCasualties ?? 0;
  if (state.phase !== 'shooting' || !pendingUnit || pendingCasualties <= 0) return state;

  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  const uniqueIndices = Array.from(new Set(modelIndices))
    .filter(modelIndex => unit.modelPositions[modelIndex])
    .sort((a, b) => b - a)
    .slice(0, pendingCasualties);
  if (!uniqueIndices.length) return state;

  spliceModelIndices(unit, uniqueIndices);

  unit.remainingModels = Math.max(0, unit.remainingModels - uniqueIndices.length);
  unit.pendingCasualties = Math.max(0, (unit.pendingCasualties ?? 0) - uniqueIndices.length);
  if (unit.pendingCasualties <= 0) unit.pendingCasualties = undefined;
  if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
    unit.destroyed = true;
    unit.remainingModels = 0;
    unit.woundsOnLeadModel = 0;
    unit.woundedModelIndex = undefined;
    unit.pendingWoundAssignment = undefined;
    unit.modelPositions = [];
    unit.modelRotations = [];
    recordDestroyedUnitMissionEvent(s, unit, state.activeArmy);
  } else {
    unit.position = centroid(unit.modelPositions);
    if (unit.woundsOnLeadModel <= 0) unit.woundsOnLeadModel = unit.profile.wounds;
  }

  s.log = [...s.log, log(
    s,
    state.activeArmy,
    unit.profile.name,
    `${unit.profile.name} removes ${uniqueIndices.length} selected casualty model${uniqueIndices.length === 1 ? '' : 's'}.`,
    unit.destroyed ? 'death' : 'damage',
  )];
  return s;
}

export function assignPlayWoundedModel(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndex: number,
): BattleState {
  const pendingUnit = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const pending = pendingUnit?.pendingWoundAssignment;
  if (!['shooting', 'fight'].includes(state.phase) || !pendingUnit || !pending || (pendingUnit.pendingCasualties ?? 0) > 0) return state;

  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !unit.modelPositions[modelIndex] || !unit.pendingWoundAssignment) return state;
  unit.woundedModelIndex = modelIndex;
  unit.woundsOnLeadModel = unit.pendingWoundAssignment.woundsOnModel;
  unit.pendingWoundAssignment = undefined;

  s.log = [...s.log, log(
    s,
    state.activeArmy,
    unit.profile.name,
    `${unit.profile.name} marks model ${modelIndex + 1} as wounded (${unit.woundsOnLeadModel}W remaining).`,
    'damage',
  )];
  return s;
}

export function allocatePlayDamageToModel(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndex: number,
): BattleState {
  const pendingUnit = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const allocation = pendingUnit?.pendingDamageAllocations?.[0];
  if (!['shooting', 'fight'].includes(state.phase) || !pendingUnit || !allocation || !pendingUnit.modelPositions[modelIndex]) return state;
  if (pendingUnit.woundedModelIndex !== undefined && pendingUnit.woundedModelIndex !== modelIndex) return state;

  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit?.pendingDamageAllocations?.length || !unit.modelPositions[modelIndex]) return state;
  const damage = unit.pendingDamageAllocations.shift()!;
  if (!unit.pendingDamageAllocations.length) unit.pendingDamageAllocations = undefined;

  const feelNoPain = applyFeelNoPain(unit, damage.damage, s);
  const appliedDamage = feelNoPain.damage;
  if (appliedDamage <= 0) {
    s.log = [...s.log, ...feelNoPain.logs, log(
      s,
      state.activeArmy,
      unit.profile.name,
      `${unit.profile.name} allocates ${damage.damage} damage to model ${modelIndex + 1}; no damage gets through.`,
      'damage',
    )];
    return s;
  }

  const currentWounds = unit.woundedModelIndex === modelIndex ? unit.woundsOnLeadModel : unit.profile.wounds;
  if (appliedDamage >= currentWounds) {
    const carryOverDamage = damage.noCarryOver ? 0 : appliedDamage - currentWounds;
    spliceModelIndices(unit, [modelIndex]);
    unit.remainingModels = Math.max(0, unit.remainingModels - 1);
    unit.woundedModelIndex = undefined;
    unit.woundsOnLeadModel = unit.remainingModels > 0 ? unit.profile.wounds : 0;
    if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
      unit.destroyed = true;
      unit.remainingModels = 0;
      unit.modelPositions = [];
      unit.modelRotations = [];
      unit.pendingDamageAllocations = undefined;
      recordDestroyedUnitMissionEvent(s, unit, state.activeArmy, {
        destroyedByUnitId: damage.sourceUnitId,
        destroyingUnitObjectiveIndexesWithinRange: damage.sourceObjectiveIndexesWithinRange,
      });
    } else {
      unit.position = centroid(unit.modelPositions);
      if (carryOverDamage > 0) {
        unit.pendingDamageAllocations = [
          { ...damage, damage: carryOverDamage },
          ...(unit.pendingDamageAllocations ?? []),
        ];
      }
    }
  } else {
    unit.woundedModelIndex = modelIndex;
    unit.woundsOnLeadModel = currentWounds - appliedDamage;
  }

  s.log = [...s.log, ...feelNoPain.logs, log(
    s,
    state.activeArmy,
    unit.profile.name,
    appliedDamage >= currentWounds
      ? `${unit.profile.name} allocates ${appliedDamage} damage to model ${modelIndex + 1}; model destroyed.`
      : `${unit.profile.name} allocates ${appliedDamage} damage to model ${modelIndex + 1} (${unit.woundsOnLeadModel}W remaining).`,
    appliedDamage >= currentWounds ? 'death' : 'damage',
  )];
  return s;
}

export function playUnitCanFallBack(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): boolean {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  return !!unit && !unit.inStrategicReserves && !isAircraft(unit) && !unit.movementComplete && !unit.movementAction && nonAircraftEngagedEnemies(state, unit, rules).length > 0;
}

export function playUnitCanAdvance(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): boolean {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (
    !unit
    || unit.inStrategicReserves
    || isAircraft(unit)
    || unit.movementComplete
    || unit.fellBack
    || !!unit.movementAction
    || typeof unit.movementAllowanceRemaining === 'number'
    || !!unit.movementAllowanceRemainingByModel
    || !!unit.movementAllowanceTotalByModel
    || !!unit.movementStartPositionsByModel
    || !!unit.movementStartRotationsByModel
  ) return false;
  return nonAircraftEngagedEnemies(state, unit, rules).length === 0;
}

export function advancePlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): BattleState {
  if (!playUnitCanAdvance(state, unitId, side, rules)) return state;

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!unit) return state;
  lockOtherMovedPlayUnits(s, unit);
  cancelUnitAction(s, unit, 'it made an Advance move');

  const advance = advanceAllowance(unit, rules);
  unit.movementAction = 'advanced';
  unit.movementAllowanceRemaining = advance.total;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => advance.total);
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => advance.total);
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  unit.movementComplete = advance.total <= 0.001;
  unit.fellBack = false;
  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${unit.profile.name} Advances: ${advance.advanceRoll === 6 && unit.profile.movementOverrides?.advanceRoll === 'auto6' ? 'auto 6' : `rolled ${advance.advanceRoll}`}; movement allowance is ${advance.total.toFixed(0)}".`,
    'move',
  )];
  return s;
}

export function fallBackPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): BattleState {
  if (!playUnitCanFallBack(state, unitId, side, rules)) return state;

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!unit) return state;
  lockOtherMovedPlayUnits(s, unit);

  const engaged = engagedEnemies(s, unit, rules);
  const closest = nearest(unit, engaged);
  if (!closest) return state;

  const distanceToClosest = dist(unit.position, closest.position);
  const direction = distanceToClosest > 0.001
    ? {
        x: (unit.position.x - closest.position.x) / distanceToClosest,
        y: (unit.position.y - closest.position.y) / distanceToClosest,
      }
    : { x: side === 0 ? -1 : 1, y: 0 };
  const modelIndices = unit.modelPositions.map((_, modelIndex) => modelIndex);
  const requestedDx = direction.x * unit.profile.move;
  const requestedDy = direction.y * unit.profile.move;
  const move = collisionAdjustedPlayMove(s, unitId, side, modelIndices, requestedDx, requestedDy, { ignoreEnemyModelPath: true });
  if (Math.hypot(move.dx, move.dy) < 0.01) return state;
  const desperateEscapeModelIndices = unit.battleshocked
    ? undefined
    : playMoveEnemyCrossingModelIndices(s, unit, new Set(modelIndices), move.dx, move.dy);

  applyPlayModelTranslation(unit, modelIndices, move.dx, move.dy, boardFormatForState(s));
  cancelUnitAction(s, unit, 'it made a Fall Back move');
  if (inEngagement(unit, enemies(s, side), rules.engagementRange())) return state;

  unit.inCombat = false;
  unit.movementAction = 'fellBack';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  unit.movementComplete = true;
  unit.fellBack = true;
  for (const enemy of engaged) {
    enemy.inCombat = inEngagement(enemy, enemies(s, enemy.side), rules.engagementRange());
  }

  const moved = Math.hypot(move.dx, move.dy);
  const newLogs: LogEntry[] = [
    log(s, side, unit.profile.name, `${unit.profile.name} Falls Back ${moved.toFixed(1)}".`, 'move'),
    ...resolveDesperateEscapeTests(
      s,
      unit,
      (testedUnit, message) => log(s, testedUnit.side, testedUnit.profile.name, message, 'roll'),
      desperateEscapeModelIndices,
    ),
  ];
  if (!unit.destroyed) unit.position = centroid(unit.modelPositions);
  s.log = [...s.log, ...newLogs];
  return s;
}

export function completePlayUnitMovement(
  state: BattleState,
  unitId: string,
  side: Side,
): BattleState {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return state;

  const existingUnit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (
    !existingUnit
    || existingUnit.movementComplete
    || (existingUnit.movementAction !== 'normalMove' && existingUnit.movementAction !== 'advanced')
  ) return state;
  if (playMovementUnitLegalityIssues(state, existingUnit).length > 0) return state;

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId)!;
  markPlayMovementGroupComplete(s, unit);
  return s;
}

export function undeployPlayUnit(state: BattleState, unitId: string, side: Side): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;

  const unitIndex = s.units.findIndex(unit => unit.id === unitId && unit.side === side && !unit.destroyed);
  if (unitIndex < 0) return s;

  const selectedUnit = s.units[unitIndex];
  const army = s.armies[side].army;
  const bodyguard = selectedUnit.profile.leaderAttachment
    ? army.units.find(unit => unitMatchesAttachmentTarget(selectedUnit.profile, unit)) ?? selectedUnit.profile
    : selectedUnit.profile;
  const attachedLeaders = attachedLeadersFor(army, bodyguard);
  const removeKeys = new Set([unitRosterId(bodyguard), ...attachedLeaders.map(unitRosterId)]);
  s.units = s.units.filter(unit => unit.side !== side || !removeKeys.has(unitRosterId(unit.profile)));
  if (!isAttachedLeaderDrop(army, bodyguard)) {
    s.unplacedUnits[side] = [
      bodyguard,
      ...s.unplacedUnits[side].filter(unit => !removeKeys.has(unitRosterId(unit))),
    ];
  }
  s.activeArmy = side;
  s.log = [...s.log, log(s, side, bodyguard.name,
    `${s.armies[side].name} returns ${bodyguard.name}${attachedLeaders.length ? ` with ${attachedLeaders.map(leader => leader.name).join(', ')}` : ''} to deployment.`,
    'info',
  )];
  return s;
}

export function reorganizePlayUnitGrid(state: BattleState, unitId: string, side: Side, rows: number): BattleState {
  const s = clone(state);
  if (!PLAY_MODEL_EDIT_PHASES.includes(s.phase)) return s;
  if (s.phase === 'movement' && movementStep(s) !== 'moveUnits') return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!unit) return s;

  const center = centroid(unit.modelPositions);
  unit.modelPositions = playGridFormationByRows(unit.profile, center, side, rows);
  unit.position = centroid(unit.modelPositions);
  return s;
}

export function reorganizePlayModelsGrid(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  rows: number,
): BattleState {
  const s = clone(state);
  if (!PLAY_MODEL_EDIT_PHASES.includes(s.phase)) return s;
  if (s.phase === 'movement' && movementStep(s) !== 'moveUnits') return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!unit) return s;

  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return s;

  const center = centroid(uniqueIndices.map(modelIndex => unit.modelPositions[modelIndex]));
  const gridPositions = playGridFormationByRows(unit.profile, center, side, rows, uniqueIndices);
  uniqueIndices.forEach((modelIndex, index) => {
    unit.modelPositions[modelIndex] = gridPositions[index];
  });
  unit.position = centroid(unit.modelPositions);
  return s;
}

export function rotatePlayModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  degrees: number,
): BattleState {
  const s = clone(state);
  if (!PLAY_MODEL_EDIT_PHASES.includes(s.phase)) return s;
  if (s.phase === 'movement' && movementStep(s) !== 'moveUnits') return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!unit) return s;

  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (uniqueIndices.length < 1) return s;
  if (s.phase === 'movement') {
    if (s.activeArmy !== side || unit.movementComplete || unit.movementAction === 'remainedStationary') return state;
    ensureModelMovementStartPositions(unit);
    ensureModelMovementStartRotations(unit);
    ensureModelMovementAllowanceTotals(unit);
  }

  const center = centroid(uniqueIndices.map(modelIndex => unit.modelPositions[modelIndex]));
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotations = unit.modelRotations ?? unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
  for (const modelIndex of uniqueIndices) {
    const model = unit.modelPositions[modelIndex];
    const dx = model.x - center.x;
    const dy = model.y - center.y;
    unit.modelPositions[modelIndex] = {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
    rotations[modelIndex] = ((rotations[modelIndex] ?? unit.facingDeg ?? 0) + degrees) % 360;
  }
  unit.modelRotations = rotations;
  if (uniqueIndices.length === unit.modelPositions.length) unit.facingDeg = ((unit.facingDeg ?? 0) + degrees) % 360;
  unit.position = centroid(unit.modelPositions);
  if (s.phase === 'movement' && isAircraft(unit)) {
    if (!aircraftPivotWithinLimit(unit, uniqueIndices)) return state;
    return s;
  }
  if (s.phase === 'movement') {
    const totals = ensureModelMovementAllowanceTotals(unit);
    const overBudget = uniqueIndices.some(modelIndex => modelMovementDistanceFromStart(unit, modelIndex) > (totals[modelIndex] ?? 0) + 0.001);
    if (overBudget) return state;
    lockOtherMovedPlayUnits(s, unit);
    unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
    updateModelMovementAllowances(unit);
  }
  return s;
}

export function playDeploymentIssues(state: BattleState): string[] {
  if (state.phase !== 'deployment') return [];

  const issues: string[] = [];
  const unplacedCount = state.unplacedUnits[0].length + state.unplacedUnits[1].length;
  if (unplacedCount > 0) issues.push(`${unplacedCount} unit${unplacedCount === 1 ? '' : 's'} still undeployed.`);

  for (const list of coherencyModelLists(state)) {
    if (!modelListIsCoherent(list.models)) {
      issues.push(`${list.label} (${list.models.length} models) is out of coherency.`);
    }
  }

  for (const unit of state.units) {
    if (unit.destroyed) continue;
    if (unitHasBaseOverlap(state, unit)) issues.push(`${unit.profile.name} has overlapping bases.`);

    const board = boardFormatForState(state);
    const deployment = setupDeploymentZoneSource(state.setup);
    const zone = zoneFor(unit.side, deployment, board);
    if (canDeployOutsideDeploymentZone(unit.profile)) {
      const tooCloseToEnemyZone = unit.modelPositions.some((model, modelIndex) =>
        !modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, model, modelIndex, deployment, board),
      );
      if (tooCloseToEnemyZone) issues.push(`${unit.profile.name} is within 9" of the enemy deployment zone.`);
    } else {
      const outsideZone = unit.modelPositions.some((model, modelIndex) =>
        !pointInDeploymentZone(model, zone, modelBaseRadius(unit, modelIndex)),
      );
      if (outsideZone) issues.push(`${unit.profile.name} is not wholly inside ${zone.name}.`);
    }

    const inWall = unit.modelPositions.some((model, modelIndex) => {
      const footprint = modelFootprint(unit, modelIndex);
      return state.terrain.some(terrain =>
        terrain.features.some(feature => baseFootprintIntersectsRect(model, footprint, feature)),
      );
    });
    if (inWall) issues.push(`${unit.profile.name} has a model in a wall.`);
  }

  return Array.from(new Set(issues));
}

export function beginPlayBattle(state: BattleState): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;
  const issues = playDeploymentIssues(s);
  if (issues.length) {
    s.log = [...s.log, log(s, 0, '', `Deployment is not legal: ${issues.join(' ')}`, 'info')];
    return s;
  }
  s.phase = 'setup';
  s.log = [...s.log, log(s, 0, '', 'DEPLOYMENT COMPLETE - BATTLE BEGINS', 'phase')];
  return s;
}

export function simulateNextPhase(state: BattleState, rules: RulesEdition): BattleState {
  const s = clone(state);
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  const newLogs: LogEntry[] = [];

  if (s.winner !== null || s.phase === 'deployment' || s.phase === 'end') return s;

  if (s.phase === 'setup') {
    newLogs.push(...startCommandPhase(s, rules));
    s.log = [...s.log, ...newLogs];
    return s;
  }

  if (!TURN_PHASES.includes(s.phase)) {
    s.phase = 'setup';
    s.log = [...s.log, ...newLogs];
    return s;
  }

  if (s.phase === 'command') {
    newLogs.push(...scorePrimaryMissionLogs(s, side, rules));
    s.phase = 'movement';
    s.movementStep = 'moveUnits';
    newLogs.push(phaseLog(s, side, armyName, `\n--- Movement Phase ---`));
    activeUnits(s, side).forEach(u => newLogs.push(...runMovement(u, s, rules)));
  } else if (s.phase === 'movement') {
    if (movementStep(s) === 'moveUnits') {
      const movementIssues = playMovementLegalityIssues(s, side);
      if (movementIssues.length) {
        s.log = [...s.log, log(s, side, armyName, `Movement is not legal: ${movementIssues.join(' ')}`, 'info')];
        return s;
      }
      markRemainingStationaryUnits(s, side);
      s.movementStep = 'reinforcements';
      newLogs.push(phaseLog(s, side, armyName, `\n--- Reinforcements Step ---`));
    } else {
      s.movementStep = undefined;
      s.phase = 'shooting';
      newLogs.push(phaseLog(s, side, armyName, `\n--- Shooting Phase ---`));
      activeUnits(s, side).forEach(u => newLogs.push(...runShooting(u, s, rules)));
    }
  } else if (s.phase === 'shooting') {
    s.movementStep = undefined;
    s.phase = 'charge';
    newLogs.push(phaseLog(s, side, armyName, `\n--- Charge Phase ---`));
    activeUnits(s, side).filter(u => !u.inCombat).forEach(u => newLogs.push(...runCharge(u, s, rules)));
  } else if (s.phase === 'charge') {
    s.phase = 'fight';
    newLogs.push(phaseLog(s, side, armyName, `\n--- Fight Phase ---`));
    activeUnits(s, side).filter(u => u.charged).forEach(u => newLogs.push(...runFight(u, s, rules)));
    activeUnits(s, side).filter(u => !u.charged && u.inCombat).forEach(u => newLogs.push(...runFight(u, s, rules)));
    s.units.filter(u => u.side !== side && !u.destroyed && u.inCombat)
      .forEach(u => newLogs.push(...runFight(u, s, rules)));
  } else if (s.phase === 'fight') {
    completeEndOfTurnActions(s, side);
    newLogs.push(...scorePrimaryMissionLogs(s, side, rules));
    advanceTurnInPlace(s);
  }

  checkWinner(s);
  s.log = [...s.log, ...newLogs];
  return s;
}

export function simulatePlayerTurn(state: BattleState, rules: RulesEdition): BattleState {
  const s = clone(state);
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  const myUnits = () => s.units.filter(u => u.side === side && !u.destroyed);
  const newLogs: LogEntry[] = [];

  // Reset per-turn flags
  startMissionEventsForNewTurn(s, rules);
  myUnits().forEach(u => { u.activated = false; u.charged = false; u.piledIn = undefined; u.consolidated = undefined; u.movementAction = undefined; u.movementAllowanceRemaining = undefined; u.movementAllowanceRemainingByModel = undefined; u.movementAllowanceTotalByModel = undefined; u.movementStartPositionsByModel = undefined; u.movementStartRotationsByModel = undefined; u.movementComplete = undefined; u.arrivedFromReinforcements = undefined; u.rapidIngressThisPhase = undefined; u.heroicInterventionThisPhase = undefined; if (u.emergencyDisembarkedThisTurn) u.battleshocked = false; u.emergencyDisembarkedThisTurn = undefined; u.fellBack = false; u.inCombat = false; });

  // Command
  s.phase = 'command';
  s.movementStep = undefined;
  const nextCommandPoints = gainCommandPhaseCommandPoints(s);
  newLogs.push(phaseLog(s, side, armyName,
    `\n═══ BATTLE ROUND ${battleRound(s)} — ${armyName.toUpperCase()} — ${rules.name.toUpperCase()} ═══`));
  newLogs.push(log(s, side, armyName, `Both players gain 1CP (${nextCommandPoints[0]}CP / ${nextCommandPoints[1]}CP).`, 'info'));
  newLogs.push(...runBattleshock(s, side));
  newLogs.push(...scorePrimaryMissionLogs(s, side, rules));

  // Movement
  s.phase = 'movement';
  s.movementStep = 'moveUnits';
  newLogs.push(phaseLog(s, side, armyName, `\n─── Movement Phase ───`));
  myUnits().forEach(u => newLogs.push(...runMovement(u, s, rules)));
  markRemainingStationaryUnits(s, side);
  s.movementStep = 'reinforcements';

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Shooting
  s.phase = 'shooting';
  s.movementStep = undefined;
  newLogs.push(phaseLog(s, side, armyName, `\n─── Shooting Phase ───`));
  myUnits().forEach(u => newLogs.push(...runShooting(u, s, rules)));

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Charge
  s.phase = 'charge';
  newLogs.push(phaseLog(s, side, armyName, `\n─── Charge Phase ───`));
  myUnits().filter(u => !u.inCombat).forEach(u => newLogs.push(...runCharge(u, s, rules)));

  // Fight — charged first, then others in melee, then defender counterattacks
  s.phase = 'fight';
  newLogs.push(phaseLog(s, side, armyName, `\n─── Fight Phase ───`));
  myUnits().filter(u => u.charged).forEach(u => newLogs.push(...runFight(u, s, rules)));
  myUnits().filter(u => !u.charged && u.inCombat).forEach(u => newLogs.push(...runFight(u, s, rules)));
  s.units.filter(u => u.side !== side && !u.destroyed && u.inCombat)
    .forEach(u => newLogs.push(...runFight(u, s, rules)));

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Objective scoring after the turn's actions; shocked units have OC 0.
  newLogs.push(...scorePrimaryMissionLogs(s, side, rules));

  s.log = [...s.log, ...newLogs];
  return s;
}

export function advanceTurn(state: BattleState): BattleState {
  const s = clone(state);
  if (s.winner !== null) return s;
  completeMissionEventsForCurrentTurn(s);

  if (s.activeArmy === 0) {
    s.activeArmy = 1;
  } else {
    setBattleRound(s, battleRound(s) + 1);
    s.activeArmy = 0;
    if (battleRound(s) > maxBattleRounds(s)) {
      if (s.scores[0] > s.scores[1]) s.winner = 0;
      else if (s.scores[1] > s.scores[0]) s.winner = 1;
      else s.winner = 'draw';
      s.phase = 'end';
    }
  }

  return s;
}
