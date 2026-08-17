import { MOVEMENT_STEP, type BattleSetup, type BattleState, type BattleUnit, type LogEntry, type MovementStep, type Phase, type Position, type Side, type Terrain, type TerrainFeature } from '../types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile, type WeaponProfile } from '../types/army';
import { rules40K10th, rulesEditionForRuleset, rulesetMetadataForState, weaponHasKeyword, weaponKeywordValue, type RulesEdition } from './rulesEngine';
import { rollExpression, rollMultiple, countSuccesses, d6 } from './dice';
import { deployArmy, distanceToDeploymentZone, fp, pointInDeploymentZone, zoneFor, unitRole, type DeploymentStrategy, type DeploymentZoneSource } from './deployment';
import { selectUnitToDrop, reactivePosition, deployModelFormation } from './deploymentBrain';
import { DEFAULT_OBJECTIVES } from './missions';
import { boardFormatForId, boardFormatForState } from '../data/boardFormats';
import { advanceAllowance, normalMoveAllowance } from './movement';
import { objectiveControlRadius } from './objectiveGeometry';
import { objectiveIndexesWithinRange, primaryMissionScoringLogs, scorePrimaryMission, scorePrimaryMissionsAtEndOfBattle, scorePrimaryMissionsAtEndOfTurn, terrainAreaIdsContainingUnit, unsupportedPrimaryMissionScoringLogs, updateObjectiveControl } from './missionScoring';
import { battleRound, logWithBattleRound, maxBattleRounds, setBattleRound } from './battleRound';
import {
  completeMissionEventsForCurrentTurn,
  recordCompletedMissionAction,
  recordDestroyedModelMissionEvents,
  recordDestroyedUnitMissionEvent,
  recordUnitLeftBattlefieldMissionEvent,
  startMissionEventsForNewTurn,
} from './missionEvents';
import { gainCommandPhaseCommandPoints } from './commandPoints';
import { runAutomaticUnitAbilities } from './unitAbilities';
import { objectiveControlValue, resolveDesperateEscapeTests } from './battleshock';
import { circleFullyInTerrain, findUnblockedLOSRay, hasLOSEdgeToEdge, lineIntersectsTerrain, linePassesThroughTerrain, pointInTerrain, terrainCorners } from './terrainGeometry';
import { COHERENCY_VERTICAL_RANGE, distance as dist, modelIndicesWithCoherencyIssues, modelListIsCoherent, verticalDistance, type CoherencyModel } from './coherency';
import { secondaryMissionStateFor } from './secondaryMissions';
import { objectiveRoleForIndex, terrainTerritoryRelation, terrainWithinMissionTerritory } from './missionGeometry';
import { scoreSecondaryMissionsAtEndOfTurn, secondaryMissionScoringLogs } from './secondaryMissionScoring';
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
  attachedUnitComponents,
  attachedUnitHasRule,
  attachedUnitId,
  attachedUnitIsFormed,
  attachedUnitKeywordSet,
  attachedUnitLiveBodyguard,
  attachedUnitRemainingModels,
  attachedUnitTargetRepresentative,
  attachedUnitToughness,
} from './attachedUnits';
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
import { attackingModelHasPlungingFire } from './otherRules';

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

const ELEVENTH_SPECIAL_SETUP_ENEMY_BUFFER = 8;
const FIGHT_PHASE_MOVE_RANGE = 3;

function setupDeploymentZoneSource(setup?: BattleSetup): DeploymentZoneSource {
  return setup?.deploymentZones ?? setup?.deployment ?? 'Default';
}

function modelIsOutsideEnemyDeploymentZoneBuffer(unit: UnitProfile, side: Side, position: Position, modelIndex = 0, deployment: DeploymentZoneSource = 'Default', board = boardFormatForId()): boolean {
  if (!canDeployOutsideDeploymentZone(unit)) return true;
  const enemyZone = zoneFor((1 - side) as Side, deployment, board);
  return distanceToDeploymentZone(position, enemyZone) > ELEVENTH_SPECIAL_SETUP_ENEMY_BUFFER + modelBaseRadiusInches(unit, modelIndex);
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
  if (!feature.blocksMovement) return false;
  if (unitHasRule(unit.profile, 'Super-heavy Walker') && feature.featureHeight === 'low') return false;
  if (hasKeyword(unit, 'infantry') && parent.type === 'ruin') return false;
  if (hasKeyword(unit, 'infantry') && feature.featureHeight === 'low') return false;
  return true;
}

function terrainMatBlocksMovementForUnit(t: Terrain, unit: BattleUnit): boolean {
  if (unit.superHeavyMobile && t.type === 'ruin') return false;
  if (hasKeyword(unit, 'titanic')) return true;
  if (t.type === 'ruin' && hasAnyKeyword(unit, ['vehicle', 'monster'])) return true;
  return t.type === 'impassable';
}

function takeToSkiesDistanceCost(unit: BattleUnit): number {
  return unit.takingToSkies && !unitHasRule(unit.profile, 'Hover') ? 2 : 0;
}

function profileDropHasInfiltrators(state: BattleState, side: Side, profile: UnitProfile): boolean {
  if (state.ruleset.edition !== '11e') return canDeployOutsideDeploymentZone(profile);
  return attachedUnitProfilesFor(state.armies[side].army, profile).every(candidate => unitHasRule(candidate, 'Infiltrators'));
}

function infiltratorModelsAreOutsideEnemyUnits(
  state: BattleState,
  side: Side,
  profile: UnitProfile,
  modelPositions: Position[],
  modelIndexes = modelPositions.map((_, index) => index),
): boolean {
  return modelPositions.every((position, modelIndex) => enemies(state, side).every(enemy =>
    enemy.modelPositions.every((enemyPosition, enemyModelIndex) => baseFootprintDistance(
      position,
      modelBaseFootprintInches(profile, modelIndexes[modelIndex] ?? modelIndex),
      enemyPosition,
      modelFootprint(enemy, enemyModelIndex),
    ) > ELEVENTH_SPECIAL_SETUP_ENEMY_BUFFER),
  ));
}

function unitTakesToSkiesForState(state: BattleState, unit: BattleUnit): boolean {
  return hasKeyword(unit, 'fly')
    && (state.ruleset.edition !== '11e' || unit.takingToSkies === true);
}

function unitMovedThisPhase(state: BattleState, unit: BattleUnit): boolean {
  return unit.lastMovePhase === state.phase && unit.lastMoveTurn === state.turn;
}

function unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean {
  return unit.surgeMovePhase === state.phase && unit.surgeMoveTurn === state.turn;
}

function lineBlockedByMovement(from: Position, to: Position, terrain: Terrain[], unit: BattleUnit): boolean {
  const crossesBlockingShape = (shape: Terrain | TerrainFeature): boolean => {
    if (pointInTerrain(from, shape)) return false;
    if (pointInTerrain(to, shape)) return true;
    return linePassesThroughTerrain(from, to, shape);
  };
  for (const t of terrain) {
    if (terrainMatBlocksMovementForUnit(t, unit) && crossesBlockingShape(t)) return true;
    if (t.features.some(feature => featureBlocksMovementForUnit(feature, t, unit) && crossesBlockingShape(feature))) {
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

export function findReachablePosition(
  unit: BattleUnit,
  to: Position,
  maxInches: number,
  terrain: Terrain[],
  stopGap = 1.05,
  ignoreTerrain = false,
): Position {
  const direct = moveToward(unit.position, to, maxInches, stopGap);
  if (ignoreTerrain || !lineBlockedByMovement(unit.position, direct, terrain, unit)) return direct;

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
function trimFormation(unit: { position: Position; modelPositions: Position[]; modelRosterIndexes?: number[]; modelRotations?: number[]; remainingModels: number }): void {
  if (unit.modelPositions.length > unit.remainingModels) {
    unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
    unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
    unit.modelRosterIndexes = unit.modelRosterIndexes?.slice(0, unit.remainingModels);
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
    unit.modelRosterIndexes?.splice(i, 1);
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
  return aliveWeaponModelIndexes(unit, weaponIndex, defender, terrain).length;
}

function rememberDestroyedPositions(unit: BattleUnit): void {
  if (unit.lastDestroyedPosition || unit.lastDestroyedModelPositions) return;
  unit.lastDestroyedPosition = { ...unit.position };
  unit.lastDestroyedModelPositions = unit.modelPositions.map(position => ({ ...position }));
}

function markUnitDestroyed(unit: BattleUnit): void {
  rememberDestroyedPositions(unit);
  unit.destroyed = true;
}

function aliveWeaponModelIndexes(
  unit: BattleUnit,
  weaponIndex: number,
  defender?: BattleUnit,
  terrain?: Terrain[],
): number[] {
  const indexes: number[] = [];
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterModelIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    if (!modelWeaponLoadout(unit.profile, rosterModelIndex).some(i => i === weaponIndex)) continue;
    if (defender && terrain) {
      const fromCenter = unit.modelPositions[modelIndex];
      if (!fromCenter) continue;
      const fromRadius = modelBaseRadius(unit, modelIndex);
      const canSee = defender.modelPositions.some((toCenter, ti) =>
        hasLOSEdgeToEdge(fromCenter, fromRadius, toCenter, modelBaseRadius(defender, ti), terrain),
      );
      if (!canSee) continue;
    }
    indexes.push(modelIndex);
  }
  return indexes;
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

function participatingWeaponModelIndexes(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  terrain: Terrain[],
): number[] {
  const needsLOS = !weapon.isMelee && !weaponHasKeyword(weapon, 'Indirect Fire');
  return needsLOS
    ? aliveWeaponModelIndexes(attacker, weaponIndex, defender, terrain)
    : aliveWeaponModelIndexes(attacker, weaponIndex);
}

function linePassesThroughModel(from: Position, to: Position, model: Position, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) return false;
  const projection = ((model.x - from.x) * dx + (model.y - from.y) * dy) / lengthSquared;
  if (projection <= 0.02 || projection >= 0.98) return false;
  const closestX = from.x + projection * dx;
  const closestY = from.y + projection * dy;
  return Math.hypot(model.x - closestX, model.y - closestY) <= radius;
}

function targetIsScreenedBySmoke(state: BattleState, attacker: BattleUnit, target: BattleUnit): boolean {
  const smokeUnits = state.units.filter(unit =>
    unit.side === target.side
    && unit.id !== target.id
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && unitHasActiveStratagem(state, unit, 'smokescreen', 'shooting'),
  );
  return attacker.modelPositions.some(from =>
    target.modelPositions.some(to =>
      smokeUnits.some(smokeUnit => smokeUnit.modelPositions.some((smokeModel, smokeModelIndex) =>
        linePassesThroughModel(
          from,
          to,
          smokeModel,
          modelBaseRadius(smokeUnit, smokeModelIndex),
        )
      ))
    )
  );
}

function meleeWeaponSelection(
  unit: BattleUnit,
  options: Array<{ weapon: WeaponProfile; weaponIndex: number }>,
  requested: number | 'all',
): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  const selected = new Set<number>();
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const carried = new Set(modelWeaponLoadout(unit.profile, rosterIndex));
    const modelOptions = options.filter(option => carried.has(option.weaponIndex));
    const extra = chooseOneProfilePerGroup(modelOptions.filter(option => weaponHasKeyword(option.weapon, 'Extra Attacks')));
    extra.forEach(option => selected.add(option.weaponIndex));
    const normal = chooseOneProfilePerGroup(modelOptions.filter(option => !weaponHasKeyword(option.weapon, 'Extra Attacks')));
    const requestedNormal = typeof requested === 'number'
      ? normal.find(option => option.weaponIndex === requested)
      : undefined;
    const chosenNormal = requestedNormal ?? normal[0];
    if (chosenNormal) selected.add(chosenNormal.weaponIndex);
  }
  return options.filter(option => selected.has(option.weaponIndex));
}

function participatingWeaponModelCount(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  terrain: Terrain[],
): number {
  return participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, terrain).length;
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

export type SimulationMovementTarget =
  | { kind: 'enemy'; unit: BattleUnit }
  | { kind: 'objective'; index: number; position: Position };

/** Choose between the nearest enemy and a strategically valuable objective. */
export function chooseSimulationMovementTarget(
  state: BattleState,
  unit: BattleUnit,
): SimulationMovementTarget | null {
  const enemy = nearest(unit, enemies(state, unit.side));
  const enemyDistance = enemy ? dist(unit.position, enemy.position) : Number.POSITIVE_INFINITY;
  const objective = state.objectives
    .map((position, index) => {
      const owner = state.objectiveOwners[index] ?? null;
      const priority = owner === unit.side ? 0.45 : owner === null ? 1.5 : 2.25;
      const controlWeight = 1 + Math.max(0, unit.profile.oc) / 2;
      return {
        index,
        position,
        cost: dist(unit.position, position) / (priority * controlWeight),
      };
    })
    .sort((left, right) => left.cost - right.cost)[0];

  if (!objective || !enemy) {
    return objective
      ? { kind: 'objective', index: objective.index, position: objective.position }
      : enemy
        ? { kind: 'enemy', unit: enemy }
        : null;
  }
  return objective.cost < enemyDistance
    ? { kind: 'objective', index: objective.index, position: objective.position }
    : { kind: 'enemy', unit: enemy };
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

function attackingModelToAttachedUnitDistance(
  state: BattleState,
  attacker: BattleUnit,
  attackerModelIndex: number,
  defender: BattleUnit,
): number {
  const attackerPosition = attacker.modelPositions[attackerModelIndex];
  if (!attackerPosition) return Number.POSITIVE_INFINITY;
  return Math.min(...attachedUnitComponents(state, defender).flatMap(component =>
    component.modelPositions.map((position, modelIndex) => modelBaseEdgeDistance3d(
      attackerPosition,
      modelFootprint(attacker, attackerModelIndex),
      position,
      modelFootprint(component, modelIndex),
    )),
  ));
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

// ─── Combat resolution ────────────────────────────────────────────────────────

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
  options: { deferCasualties?: boolean; snapShooting?: boolean; attackCountOverride?: number; selectedTargetCount?: number } = {},
): LogEntry[] {
  const logs: LogEntry[] = [];
  const damagedProfile = attacker.profile.damagedProfile;
  const damagedHitModifier = damagedProfile
    && attacker.remainingModels === 1
    && attacker.woundsOnLeadModel <= damagedProfile.maxRemainingWounds
    ? damagedProfile.hitRollModifier ?? 0
    : 0;
  hitModifier += damagedHitModifier;
  if (damagedHitModifier) {
    hitModifierNote = [hitModifierNote, `Damaged ${damagedHitModifier > 0 ? '-' : '+'}${Math.abs(damagedHitModifier)} to Hit`]
      .filter(Boolean)
      .join('; ');
  }
  const rangeDistance = weapon.isMelee
    ? dist(attacker.position, defender.position)
    : battleUnitToAttachedUnitDistance(state, attacker, defender);
  const epicChallengeModelIndex = weapon.isMelee
    ? activeEpicChallengeModelIndex(state, defender)
    : undefined;
  const damageOptions = epicChallengeModelIndex === undefined
    ? options
    : { ...options, targetModelIndex: epicChallengeModelIndex };

  const participatingModelIndexes = participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, state.terrain);
  const weaponModelCount = participatingModelIndexes.length;
  if (weaponModelCount <= 0) return logs;
  const isVariableAttacks = !/^\d+$/i.test(String(weapon.attacks).trim());
  const perModelRolls: number[] = [];
  for (let i = 0; i < weaponModelCount; i++) {
    perModelRolls.push(rollExpression(weapon.attacks).total);
  }
  let perModelAttackCounts = [...perModelRolls];
  let numAttacks = options.attackCountOverride ?? perModelAttackCounts.reduce((a, b) => a + b, 0);
  if (options.attackCountOverride === undefined) {
    if (rules.metadata.edition === '11e' && !weapon.isMelee) {
      perModelAttackCounts = perModelAttackCounts.map((attacks, index) => rules.modifyAttackCount(
        attacks,
        { ...attacker, remainingModels: 1 },
        weapon,
        attackingModelToAttachedUnitDistance(state, attacker, participatingModelIndexes[index], defender),
        attachedUnitRemainingModels(state, defender),
      ));
      numAttacks = perModelAttackCounts.reduce((total, attacks) => total + attacks, 0);
    } else {
      numAttacks = rules.modifyAttackCount(numAttacks, attacker, weapon, rangeDistance, attachedUnitRemainingModels(state, defender));
    }
    if (
      rules.metadata.edition === '11e'
      && weapon.isMelee
      && (options.selectedTargetCount ?? 1) === 1
      && weaponHasKeyword(weapon, 'Cleave')
    ) {
      numAttacks += weaponKeywordValue(weapon, 'Cleave')
        * Math.floor(attachedUnitRemainingModels(state, defender) / 5)
        * weaponModelCount;
    }
  }

  if (numAttacks <= 0) return logs;

  logs.push(log(state, attacker.side, attacker.profile.name,
    `  ${weapon.isMelee ? '⚔️' : '🔫'} ${weapon.name} — ${weaponModelCount} model(s) × ${weapon.attacks} = ${numAttacks} attacks vs ${defender.profile.name}`,
    weapon.isMelee ? 'fight' : 'shoot',
  ));
  logs.push(log(state, attacker.side, attacker.profile.name,
    `[combat-stats] skill=${weapon.skill} s=${weapon.strength} ap=${weapon.ap} d=${weapon.damage} t=${attachedUnitToughness(state, defender)}${hasCover ? ' cover=1' : ''}`,
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
    const plungingAttackCount = options.snapShooting || weapon.isMelee
      ? 0
      : participatingModelIndexes.reduce((total, modelIndex, index) => {
        const position = attacker.modelPositions[modelIndex];
        const visible = position
          ? hasAnyModelLOS(position, modelBaseRadius(attacker, modelIndex), defender, state.terrain)
          : false;
        return total + (attackingModelHasPlungingFire(state, attacker, modelIndex, defender, visible)
          ? perModelAttackCounts[index]
          : 0);
      }, 0);
    const hitRolls = rollMultiple(numAttacks);
    const plungingRolls = hitRolls.slice(0, plungingAttackCount);
    const normalRolls = hitRolls.slice(plungingAttackCount);
    const normalTarget = options.snapShooting ? 6 : Math.min(6, Math.max(2, weapon.skill + hitModifier));
    const plungingTarget = Math.min(6, Math.max(2, weapon.skill - 1 + hitModifier));
    const hitPools = [
      ...(plungingRolls.length ? [{ rolls: plungingRolls, target: plungingTarget, plunging: true }] : []),
      ...(normalRolls.length ? [{ rolls: normalRolls, target: normalTarget, plunging: false }] : []),
    ];
    const results = hitPools.map(pool => ({ ...pool, result: rules.processHits(pool.rolls, pool.target, weapon) }));
    hitResult = {
      hits: results.reduce((total, pool) => total + pool.result.hits, 0),
      rolls: hitRolls,
      mortalsFromCrits: results.reduce((total, pool) => total + pool.result.mortalsFromCrits, 0),
      logNote: results.map(pool => pool.result.logNote).filter(Boolean).join('; '),
    };
    lethalAutoWounds = weaponHasKeyword(weapon, 'Lethal Hits')
      ? hitRolls.filter(roll => roll === 6).length
      : 0;
    for (const pool of results) {
      const noteHit = pool.result.logNote ? ` [${pool.result.logNote}]` : '';
      const plungingNote = pool.plunging ? '; Plunging Fire improves BS by 1' : '';
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Hit rolls (${pool.target}+${plungingNote}): [${pool.rolls.join(', ')}] → ${pool.result.hits} hits${noteHit}`,
        'roll',
      ));
    }

  }

  // Mortal wounds from critical hits (e.g. Deadly Demise)
  let totalMortals = hitResult.mortalsFromCrits;
  let devastatingWounds = 0;

  if (hitResult.hits === 0 && totalMortals === 0) return logs;

  // ── Wound rolls ───────────────────────────────────────────────────────────
  const targetToughness = attachedUnitToughness(state, defender);
  const lanceApplies = rules.metadata.edition === '11e'
    && weapon.isMelee
    && weaponHasKeyword(weapon, 'Lance')
    && attachedUnitComponents(state, attacker).some(component => component.charged);
  const wt = Math.max(2, rules.woundTarget(weapon.strength, targetToughness) - (lanceApplies ? 1 : 0));
  let woundCount = 0;
  if (lanceApplies) {
    logs.push(log(state, attacker.side, attacker.profile.name, '     Lance: +1 to wound rolls after a charge move', 'info'));
  }
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
        ...damageOptions,
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
        ...damageOptions,
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
      ...damageOptions,
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
    targetModelIndex?: number;
    sourceObjectiveIndexesWithinRange?: number[];
    sourceTags?: Array<'psychic'>;
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
        ...(options.targetModelIndex !== undefined ? { targetModelIndex: options.targetModelIndex } : {}),
        ...(options.sourceObjectiveIndexesWithinRange
          ? { sourceObjectiveIndexesWithinRange: options.sourceObjectiveIndexesWithinRange }
          : {}),
        ...(options.sourceTags?.length ? { sourceTags: [...options.sourceTags] } : {}),
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
    if (killed > 0) {
      queueDeadlyDemiseForModels(
        state,
        unit,
        Array.from({ length: killed }, (_, index) => simulatedModels + index),
        attackerSide,
      );
      recordDestroyedModelMissionEvents(
        state,
        unit,
        Array.from({ length: killed }, (_, index) => simulatedModels + index),
        attackerSide,
        { destroyedByUnitId: options.sourceUnitId, sourceTags: options.sourceTags },
      );
    }
    unit.remainingModels = simulatedModels;
    unit.woundsOnLeadModel = simulatedModels > 0 ? simulatedLeadWounds : 0;
    unit.woundedModelIndex = unit.woundsOnLeadModel > 0 && unit.woundsOnLeadModel < unit.profile.wounds ? 0 : undefined;
    unit.pendingWoundAssignment = undefined;
    if (killed > 0 && simulatedModels <= 0) rememberDestroyedPositions(unit);
    if (killed > 0) trimUnitModelState(unit);
  }

  const effectiveRemaining = options.deferCasualties
    ? unit.remainingModels - (unit.pendingCasualties ?? 0)
    : unit.remainingModels;
  if (killed > 0 && effectiveRemaining <= 0 && !options.deferCasualties) {
    markUnitDestroyed(unit);
    recordDestroyedUnitMissionEvent(state, unit, attackerSide, {
      destroyedByUnitId: options.sourceUnitId,
      destroyingUnitObjectiveIndexesWithinRange: options.sourceObjectiveIndexesWithinRange,
      sourceTags: options.sourceTags,
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

function deadlyDemiseExpression(unit: BattleUnit): string | null {
  for (const rule of [...unit.profile.abilities, ...(unit.profile.rules ?? [])]) {
    const match = `${rule.name} ${rule.description}`.match(/Deadly\s+Demise\s+((?:\d+)?D\d+(?:[+-]\d+)?|\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function queueDeadlyDemiseForModels(
  state: BattleState,
  unit: BattleUnit,
  modelIndices: number[],
  destroyedBySide: Side,
): void {
  const mortalWounds = deadlyDemiseExpression(unit);
  if (!mortalWounds) return;
  const queued = state.pendingDeadlyDemises ?? [];
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    if (!position) continue;
    queued.push({
      id: `deadly-demise:${unit.id}:${unit.modelRosterIndexes?.[modelIndex] ?? modelIndex}:${queued.length}`,
      sourceUnitId: unit.id,
      sourceUnitName: unit.profile.name,
      sourceSide: unit.side,
      destroyedBySide,
      position: { ...position },
      footprint: { ...modelFootprint(unit, modelIndex) },
      mortalWounds,
    });
  }
  state.pendingDeadlyDemises = queued;
}

function unitWithinDeadlyDemiseRange(
  state: BattleState,
  unit: BattleUnit,
  pending: NonNullable<BattleState['pendingDeadlyDemises']>[number],
): boolean {
  return attachedUnitComponents(state, unit).some(component => component.modelPositions.some((position, modelIndex) => {
    const horizontal = baseFootprintDistance(pending.position, pending.footprint, position, modelFootprint(component, modelIndex));
    return Math.hypot(horizontal, (pending.position.z ?? 0) - (position.z ?? 0)) <= 6;
  }));
}

function resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[] {
  const logs: LogEntry[] = [];
  while (state.pendingDeadlyDemises?.length) {
    const pending = state.pendingDeadlyDemises.shift()!;
    const triggerRoll = d6();
    logs.push(log(state, pending.sourceSide, pending.sourceUnitName,
      `${pending.sourceUnitName} Deadly Demise roll: ${triggerRoll}${triggerRoll === 6 ? ' - deadly demise!' : ' - no effect'}.`,
      'roll',
    ));
    if (triggerRoll !== 6) continue;
    const handled = new Set<string>();
    const targets = state.units.filter(unit => {
      if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || !unit.modelPositions.length) return false;
      const id = attachedUnitId(unit);
      if (handled.has(id)) return false;
      handled.add(id);
      return unitWithinDeadlyDemiseRange(state, unit, pending);
    });
    for (const target of targets) {
      const damage = rollExpression(pending.mortalWounds).total;
      logs.push(log(state, pending.sourceSide, pending.sourceUnitName,
        `${target.profile.name} suffers ${damage} mortal wound${damage === 1 ? '' : 's'} from Deadly Demise.`,
        'damage',
      ));
      logs.push(...applyDamage(target, damage, state, pending.destroyedBySide, {
        source: `Deadly Demise (${pending.sourceUnitName})`,
        sourceUnitId: pending.sourceUnitId,
      }));
    }
  }
  state.pendingDeadlyDemises = undefined;
  return logs;
}

export function resolvePendingDeadlyDemises(state: BattleState): BattleState {
  if (!state.pendingDeadlyDemises?.length) return state;
  const s = clone(state);
  s.log = [...s.log, ...resolvePendingDeadlyDemisesInPlace(s)];
  return s;
}

// ─── Phase simulators ─────────────────────────────────────────────────────────

function destroyPassengerModels(unit: BattleUnit, destroyedModels: number): void {
  if (destroyedModels <= 0) return;
  unit.remainingModels = Math.max(0, unit.remainingModels - destroyedModels);
  unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
  unit.modelRosterIndexes = unit.modelRosterIndexes?.slice(0, unit.remainingModels);
  unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
  unit.movementAllowanceRemainingByModel = unit.movementAllowanceRemainingByModel?.slice(0, unit.remainingModels);
  unit.movementAllowanceTotalByModel = unit.movementAllowanceTotalByModel?.slice(0, unit.remainingModels);
  unit.movementStartPositionsByModel = unit.movementStartPositionsByModel?.slice(0, unit.remainingModels);
  if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
    markUnitDestroyed(unit);
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
      recordDestroyedModelMissionEvents(
        state,
        unit,
        Array.from({ length: unit.remainingModels }, (_, modelIndex) => modelIndex),
        attackerSide,
      );
      unit.embarkedInUnitId = undefined;
      markUnitDestroyed(unit);
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
    recordDestroyedModelMissionEvents(
      state,
      unit,
      Array.from({ length: destroyedModels }, (_, index) => unit.remainingModels - destroyedModels + index),
      attackerSide,
    );
    destroyPassengerModels(unit, destroyedModels);
    if (!wasDestroyed && unit.destroyed) recordDestroyedUnitMissionEvent(state, unit, attackerSide);
    logs.push(log(state, attackerSide, unit.profile.name,
      `${unit.profile.name} emergency disembarks from ${transport.profile.name}; rolls ${rolls.join(', ')}${destroyedModels ? `; ${destroyedModels} model${destroyedModels === 1 ? '' : 's'} destroyed` : '; no models destroyed'}.`,
      destroyedModels && unit.destroyed ? 'death' : 'roll',
    ));
  }

  return logs;
}

function resolveCombatDisembarkHazards(state: BattleState, unit: BattleUnit): LogEntry[] {
  if (unit.destroyed || !unit.modelPositions.length) return [];
  const rolls = unit.modelPositions.map(() => d6());
  const failedModelIndices = rolls
    .map((roll, modelIndex) => roll === 1 ? modelIndex : -1)
    .filter(modelIndex => modelIndex >= 0);
  if (failedModelIndices.length === 0) {
    return [log(state, unit.side, unit.profile.name,
      `${unit.profile.name} makes Combat Disembark hazard rolls: ${rolls.join(', ')}; no models destroyed.`, 'roll')];
  }
  if (failedModelIndices.length >= unit.modelPositions.length) {
    unit.lastDestroyedPosition = { ...unit.position };
    unit.lastDestroyedModelPositions = unit.modelPositions.map(position => ({ ...position }));
  }
  recordDestroyedModelMissionEvents(state, unit, failedModelIndices, unit.side);
  for (const modelIndex of [...failedModelIndices].sort((a, b) => b - a)) {
    unit.modelPositions.splice(modelIndex, 1);
    unit.modelRosterIndexes?.splice(modelIndex, 1);
    unit.modelRotations?.splice(modelIndex, 1);
    unit.movementAllowanceRemainingByModel?.splice(modelIndex, 1);
    unit.movementAllowanceTotalByModel?.splice(modelIndex, 1);
    unit.movementStartPositionsByModel?.splice(modelIndex, 1);
    unit.movementStartRotationsByModel?.splice(modelIndex, 1);
  }
  unit.remainingModels = Math.min(unit.remainingModels, unit.modelPositions.length);
  unit.destroyed = unit.remainingModels <= 0;
  return [log(state, unit.side, unit.profile.name,
    `${unit.profile.name} makes Combat Disembark hazard rolls: ${rolls.join(', ')}; ${failedModelIndices.length} model${failedModelIndices.length === 1 ? '' : 's'} destroyed.`,
    unit.destroyed ? 'death' : 'roll')];
}

function runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId || unitSurgedThisPhase(state, unit)) return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side);
  if (inEngagement(unit, foes, eng)) {
    unit.inCombat = true;
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds (already in melee)`,
      'move',
    )];
  }

  const movementTarget = chooseSimulationMovementTarget(state, unit);
  if (!movementTarget) return [];
  const isEnemyTarget = movementTarget.kind === 'enemy';
  const target = isEnemyTarget
    ? movementTarget.unit
    : ({ profile: { name: `objective ${movementTarget.index + 1}` }, position: movementTarget.position } as unknown as BattleUnit);
  const targetPosition = target.position;

  const ranged = unit.profile.weapons.filter(w => !w.isMelee && w.range > 0);
  const maxRange = ranged.length ? Math.max(...ranged.map(w => w.range)) : 0;
  const d = dist(unit.position, targetPosition);

  if (isEnemyTarget && d <= maxRange && d > eng) {
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds position (${d.toFixed(1)}" from ${target.profile.name}, in range)`,
      'move',
    )];
  }

  // Formation-aware stop gap: front models stop at exactly engagementRange from target's back models
  const dirX = d > 0 ? (targetPosition.x - unit.position.x) / d : 1;
  const dirY = d > 0 ? (targetPosition.y - unit.position.y) / d : 0;
  const myExtent   = formationExtent(unit.modelPositions,   unit.position,   { x: dirX,  y: dirY  });
  const tgtExtent  = isEnemyTarget
    ? formationExtent(target.modelPositions, target.position, { x: -dirX, y: -dirY })
    : 0;
  const stopGap = eng + myExtent + tgtExtent + 0.05;

  if (rules.metadata.edition === '11e' && hasKeyword(unit, 'fly')) unit.takingToSkies = true;
  const maximumDistance = Math.max(0, unit.profile.move - takeToSkiesDistanceCost(unit));
  const reachablePos = findReachablePosition(
    unit, targetPosition, maximumDistance, state.terrain, isEnemyTarget ? stopGap : 0,
    unitTakesToSkiesForState(state, unit),
  );
  const newPos = avoidModelOverlap(unit, reachablePos, state);
  const moved = dist(unit.position, newPos);
  if (moved < 0.01) {
    unit.takingToSkies = undefined;
    return [log(state, unit.side, unit.profile.name,
      `  📍 ${unit.profile.name} holds (already in engagement range)`,
      'move',
    )];
  }

  translateFormation(unit, newPos.x - unit.position.x, newPos.y - unit.position.y);
  cancelUnitAction(state, unit, 'it made a move');

  resolveInternalModelOverlaps(unit);
  unit.position = centroid(unit.modelPositions);
  unit.lastMovePhase = state.phase;
  unit.lastMoveTurn = state.turn;
  unit.takingToSkies = undefined;

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

function feelNoPainTargets(unit: BattleUnit): Array<{ target: number; sharesWithAttachedUnit: boolean }> {
  return datasheetRuleText(unit).flatMap(text => {
    const match = text.match(/feel\s+no\s+pain(?:\s*\(?\s*)?([2-6])\+/i);
    if (!match) return [];
    const unitScoped = /\b(this unit|that unit|models? in (?:this|that|the bearer'?s) unit)\b/i.test(text);
    return [{ target: Number(match[1]), sharesWithAttachedUnit: unitScoped }];
  });
}

function applyFeelNoPain(
  unit: BattleUnit,
  damage: number,
  state: BattleState,
): { damage: number; logs: LogEntry[] } {
  const target = attachedUnitComponents(state, unit)
    .flatMap(component => feelNoPainTargets(component)
      .filter(rule => component.id === unit.id || rule.sharesWithAttachedUnit)
      .map(rule => rule.target))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0] ?? null;
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
  const components = attachedUnitComponents(state, unit);
  const action = components.map(component => component.performingAction).find(Boolean);
  if (!action) return;
  const actionName = action.name;
  for (const component of components) component.performingAction = undefined;
  state.log = [...state.log, log(
    state,
    unit.side,
    unit.profile.name,
    `${unit.profile.name} does not complete ${actionName}: ${reason}.`,
    'info',
  )];
}

function attachedObjectiveIndexesWithinRange(state: BattleState, unit: BattleUnit, rules: RulesEdition): number[] {
  return [...new Set(attachedUnitComponents(state, unit)
    .flatMap(component => objectiveIndexesWithinRange(state, component, rules)))];
}

function attachedTerrainAreaIdsContainingUnit(state: BattleState, unit: BattleUnit): string[] {
  const components = attachedUnitComponents(state, unit);
  if (!components.length) return [];
  return terrainAreaIdsContainingUnit(state, components[0]).filter(terrainId =>
    components.every(component => terrainAreaIdsContainingUnit(state, component).includes(terrainId)),
  );
}

function unitIsEligibleToStartAction(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  ignoreActionStartedThisTurn = false,
): boolean {
  const components = attachedUnitComponents(state, unit);
  if (!components.length || components.some(component => component.embarkedInUnitId || component.inStrategicReserves)) return false;
  if (components.some(component => isAircraft(component) || isFortification(component))) return false;
  if (components.some(component => component.battleshocked)) return false;
  if (components.reduce((total, component) => total + component.profile.oc, 0) <= 0) return false;
  if (components.some(component => (!ignoreActionStartedThisTurn && component.actionStartedThisTurn) || component.performingAction)) return false;
  if (rules.metadata.edition === '11e' && state.phase === 'shooting'
    && components.some(component => component.activated || (component.firedWeaponIndices?.length ?? 0) > 0)) return false;
  if (components.some(component => component.movementAction === 'advanced' || component.movementAction === 'fellBack' || component.fellBack)) return false;
  const canActWhileEngaged = attachedUnitKeywordSet(state, unit).has('vehicle') || attachedUnitKeywordSet(state, unit).has('monster');
  if (!canActWhileEngaged && components.some(component => inEngagement(component, enemies(state, unit.side), rules.engagementRange()))) return false;
  return true;
}

export function playUnitCanStartAction(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
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
  objectiveFilter: 'any' | 'non-home' | 'central' = 'non-home',
): number[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || selectedMissionName !== missionName) return [];
  if (!playUnitCanStartAction(state, unitId, side, rules)) return [];

  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const markedObjectives = new Set([
    ...(state.missionState?.operationMarkers ?? [])
      .filter(marker => marker.side === side && marker.sourceActionId === actionId)
      .flatMap(marker => marker.objectiveIndex === undefined ? [] : [marker.objectiveIndex]),
    ...state.units
      .filter(candidate => candidate.side === side && candidate.performingAction?.id === actionId)
      .flatMap(candidate => candidate.performingAction?.targetObjectiveIndex === undefined
        ? []
        : [candidate.performingAction.targetObjectiveIndex]),
  ]);
  const homeRole = side === 0 ? 'home-0' : 'home-1';
  const opponentHomeRole = side === 0 ? 'home-1' : 'home-0';

  return attachedObjectiveIndexesWithinRange(state, unit, rules).filter(objectiveIndex => {
    if (markedObjectives.has(objectiveIndex)) return false;
    const objective = state.objectives[objectiveIndex];
    if (!objective) return false;
    const objectiveRole = objectiveRoleForIndex(state, objectiveIndex);
    if (objectiveFilter === 'any') return true;
    if (objectiveFilter === 'central') {
      return objectiveRole === 'central';
    }
    return objectiveRole !== undefined && objectiveRole !== homeRole;
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
  resolvingEndOfTurn = false,
): number[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e'
    || selectedMissionName !== 'Consecrate'
    || state.activeArmy !== side
    || state.phase !== 'fight') return [];
  const unresolvedFightMove = activeUnits(state, side).some(candidate =>
    playUnitCanPileIn(state, candidate.id, side, rules)
    || playUnitCanConsolidate(state, candidate.id, side)
  );
  if (!resolvingEndOfTurn
    && (playFightActivationUnitIds(state, side, rules).length > 0 || unresolvedFightMove)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (!unit) return [];
  const becameConsecrationUnit = (state.missionEvents?.destroyedUnitsThisTurn ?? []).some(event =>
    event.destroyedBySide === side && event.side !== side && event.destroyedByUnitId === unitId
  );
  if (!becameConsecrationUnit) return [];
  const alreadyUsed = (state.missionState?.operationMarkers ?? []).some(marker =>
    marker.side === side
    && marker.sourceActionId === 'consecrate'
    && marker.placedByUnitId === unitId
    && marker.battleRound === battleRound(state)
    && marker.turn === state.turn
  );
  if (alreadyUsed) return [];
  const markedObjectives = new Set((state.missionState?.operationMarkers ?? [])
    .filter(marker => marker.side === side && marker.sourceActionId === 'consecrate')
    .flatMap(marker => marker.objectiveIndex === undefined ? [] : [marker.objectiveIndex]));
  const ownHomeRole = side === 0 ? 'home-0' : 'home-1';
  return attachedObjectiveIndexesWithinRange(state, unit, rules).filter(objectiveIndex =>
    !markedObjectives.has(objectiveIndex)
    && objectiveRoleForIndex(state, objectiveIndex) !== undefined
    && objectiveRoleForIndex(state, objectiveIndex) !== ownHomeRole
  );
}

export function consecrateObjective(
  state: BattleState,
  unitId: string,
  side: Side,
  objectiveIndex: number,
  rules: RulesEdition,
  resolvingEndOfTurn = false,
): BattleState {
  if (!consecrateObjectiveOptions(state, unitId, side, rules, resolvingEndOfTurn).includes(objectiveIndex)) return state;
  const next = clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId)!;
  const position = next.objectives[objectiveIndex];
  next.missionState ??= {};
  next.missionState.operationMarkers = [
    ...(next.missionState.operationMarkers ?? []),
    {
      id: `operation-marker-${side}-consecrate-${objectiveIndex}`,
      side,
      sourceActionId: 'consecrate',
      placedByUnitId: unitId,
      objectiveIndex,
      position: { ...position },
      battleRound: battleRound(next),
      turn: next.turn,
    },
  ];
  next.log = [...next.log, log(
    next,
    side,
    unit.profile.name,
    `${unit.profile.name} consecrates objective ${objectiveIndex + 1}.`,
    'info',
  )];
  return next;
}

export function maintainControlObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Vital Link', 'maintain-control', 'central');
}

export function secureAssetObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Secure Asset', 'secure-asset');
}

export function decoyObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Smoke and Mirrors', 'decoy');
}

export function sabotageObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Sabotage', 'sabotage');
}

function hasActiveSecondaryMission(state: BattleState, side: Side, missionName: string): boolean {
  return secondaryMissionStateFor(state, side)?.activeCards.some(card => card.missionName === missionName) ?? false;
}

function completedOrInProgressObjectiveTargets(state: BattleState, side: Side, actionId: string): Set<number> {
  return new Set([
    ...(state.missionEvents?.completedActionsThisTurn ?? [])
      .filter(event => event.side === side && event.actionId === actionId)
      .flatMap(event => event.targetObjectiveIndex === undefined ? [] : [event.targetObjectiveIndex]),
    ...state.units
      .filter(unit => unit.side === side && unit.performingAction?.id === actionId)
      .flatMap(unit => unit.performingAction?.targetObjectiveIndex === undefined
        ? []
        : [unit.performingAction.targetObjectiveIndex]),
  ]);
}

export function cleanseObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  if (rules.metadata.edition !== '11e'
    || !hasActiveSecondaryMission(state, side, 'Cleanse')
    || !playUnitCanStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const usedObjectives = completedOrInProgressObjectiveTargets(state, side, 'cleanse');
  return attachedObjectiveIndexesWithinRange(state, unit, rules).filter(index => !usedObjectives.has(index));
}

function terrainIsExplicitlyOutsideTerritory(state: BattleState, side: Side, terrainId: string): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  return !!terrain && ['enemy', 'no-mans-land'].includes(terrainTerritoryRelation(terrain, side));
}

function completedOrInProgressTerrainTargets(state: BattleState, side: Side, actionId: string): Set<string> {
  return new Set([
    ...(state.missionEvents?.completedActionsThisTurn ?? [])
      .filter(event => event.side === side && event.actionId === actionId)
      .flatMap(event => event.targetTerrainId === undefined ? [] : [event.targetTerrainId]),
    ...state.units
      .filter(unit => unit.side === side && unit.performingAction?.id === actionId)
      .flatMap(unit => unit.performingAction?.targetTerrainId === undefined
        ? []
        : [unit.performingAction.targetTerrainId]),
  ]);
}

export function plunderTerrainOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  if (rules.metadata.edition !== '11e'
    || !hasActiveSecondaryMission(state, side, 'Plunder')
    || !playUnitCanStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const usedTerrain = completedOrInProgressTerrainTargets(state, side, 'plunder');
  return attachedTerrainAreaIdsContainingUnit(state, unit).filter(terrainId =>
    !usedTerrain.has(terrainId) && terrainIsExplicitlyOutsideTerritory(state, side, terrainId)
  );
}

export interface SensorSweepOption {
  objectiveIndex: number;
  operationMarkerId: string;
}

function objectiveIsCentral(state: BattleState, objectiveIndex: number): boolean {
  if (!state.objectives[objectiveIndex]) return false;
  const role = objectiveRoleForIndex(state, objectiveIndex);
  return role === 'central';
}

export function sensorSweepOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): SensorSweepOption[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e'
    || (selectedMissionName !== 'Extract Relic' && selectedMissionName !== 'Locate and Deny')
    || state.phase !== 'shooting'
    || !playUnitCanStartAction(state, unitId, side, rules)) {
    return [];
  }
  const markers = state.missionState?.operationMarkers ?? [];
  if (markers.length <= 1) return [];
  if ((state.missionEvents?.completedActionsThisTurn ?? []).some(event =>
    event.side === side && event.actionId === 'sensor-sweep'
  )) return [];
  if (state.units.some(unit => unit.side === side && unit.performingAction?.id === 'sensor-sweep')) return [];

  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const centralObjectiveIndexes = attachedObjectiveIndexesWithinRange(state, unit, rules)
    .filter(objectiveIndex => objectiveIsCentral(state, objectiveIndex));
  return centralObjectiveIndexes.flatMap(objectiveIndex =>
    markers.map(marker => ({ objectiveIndex, operationMarkerId: marker.id })),
  );
}

export function surveilTargetOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e'
    || selectedMissionName !== 'Surveil the Foe'
    || state.phase !== 'shooting'
    || state.activeArmy !== side) {
    return [];
  }
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit || !unitIsEligibleToStartAction(unit, state, rules, true)) return [];
  const alreadySurveilledUnitIds = new Set(
    (state.missionEvents?.completedActionsThisTurn ?? [])
      .filter(event => event.side === side && event.actionId === 'surveil')
      .flatMap(event => event.targetUnitId ? [event.targetUnitId] : []),
  );
  return state.units
    .filter(target =>
      target.side !== side
      && !target.destroyed
      && !target.embarkedInUnitId
      && !target.inStrategicReserves
      && !alreadySurveilledUnitIds.has(target.id)
      && battleUnitsWithinBaseEdgeRange(unit, target, 18)
      && unit.modelPositions.some((model, modelIndex) =>
        hasAnyModelLOS(model, modelBaseRadius(unit, modelIndex), target, state.terrain)
      )
    )
    .map(target => target.id);
}

function removeOpponentOperationMarkersAfterMove(
  state: BattleState,
  unit: BattleUnit,
): void {
  const selectedMissionName = state.setup?.primaryMissions?.[unit.side] ?? state.setup?.primaryMission;
  if (state.ruleset?.edition !== '11e' || selectedMissionName !== 'Surveil the Foe') return;
  const objectiveIndexes = new Set(attachedObjectiveIndexesWithinRange(state, unit, rulesEditionForRuleset(state.ruleset)));
  if (!objectiveIndexes.size) return;
  const markers = state.missionState?.operationMarkers ?? [];
  const removed = markers.filter(marker =>
    marker.side !== unit.side
    && marker.objectiveIndex !== undefined
    && objectiveIndexes.has(marker.objectiveIndex)
  );
  if (!removed.length) return;
  state.missionState!.operationMarkers = markers.filter(marker => !removed.includes(marker));
  state.log = [...state.log, log(
    state,
    unit.side,
    unit.profile.name,
    `${unit.profile.name} removes ${removed.length} enemy operation marker${removed.length === 1 ? '' : 's'} after ending a move within objective range.`,
    'info',
  )];
}

function vanguardOperationTerrainIsValid(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  terrainId: string,
): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  if (!terrain || terrainWithinMissionTerritory(state, terrain, (1 - side) as Side) !== true) return false;
  if (!attachedTerrainAreaIdsContainingUnit(state, unit).includes(terrainId)) return false;
  return !state.units.some(candidate =>
    candidate.side !== side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId
    && !candidate.inStrategicReserves
    && terrainAreaIdsContainingUnit(state, candidate).includes(terrainId),
  );
}

export function vanguardOperationTerrainOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || selectedMissionName !== 'Vanguard Operation') return [];
  if (!playUnitCanStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  return state.terrain
    .filter(terrain => vanguardOperationTerrainIsValid(state, unit, side, terrain.id))
    .map(terrain => terrain.id);
}

function boobyTrapTerrainIsValid(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  terrainId: string,
): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  if (!terrain || !attachedTerrainAreaIdsContainingUnit(state, unit).includes(terrainId)) return false;

  const homeRole = side === 0 ? 'home-0' : 'home-1';
  const objectiveIndexes = attachedObjectiveIndexesWithinRange(state, unit, rulesEditionForRuleset(state.ruleset));
  const isEligibleObjectiveTerrain = objectiveIndexes.some(objectiveIndex => {
    const objective = state.objectives[objectiveIndex];
    return objective
      && pointInTerrain(objective, terrain)
      && terrain.objectiveRole !== homeRole;
  });
  const deployment = setupDeploymentZoneSource(state.setup);
  const zone = zoneFor(side, deployment, boardFormatForState(state));
  const isOutsideDeploymentZone = !pointInDeploymentZone(
    { x: terrain.x + terrain.width / 2, y: terrain.y + terrain.height / 2 },
    zone,
  );
  return isEligibleObjectiveTerrain || isOutsideDeploymentZone;
}

export function boobyTrapTerrainOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e'
    || selectedMissionName !== 'Death Trap'
    || state.phase !== 'shooting'
    || !playUnitCanStartAction(state, unitId, side, rules)) {
    return [];
  }
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const alreadyTrappedTerrainIds = new Set([
    ...(state.missionState?.operationMarkers ?? [])
      .filter(marker => marker.side === side && marker.sourceActionId === 'booby-trap')
      .flatMap(marker => marker.terrainId ? [marker.terrainId] : []),
    ...(state.missionEvents?.completedActionsThisTurn ?? [])
      .filter(event => event.side === side && event.actionId === 'booby-trap')
      .flatMap(event => event.targetTerrainId ? [event.targetTerrainId] : []),
  ]);
  return state.terrain
    .filter(terrain =>
      !alreadyTrappedTerrainIds.has(terrain.id)
      && boobyTrapTerrainIsValid(state, unit, side, terrain.id)
    )
    .map(terrain => terrain.id);
}

export function punishmentCondemnedUnitOptions(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
): string[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e'
    || selectedMissionName !== 'Punishment'
    || state.phase !== 'command'
    || state.activeArmy !== side) {
    return [];
  }
  const enemiesOnBattlefield = state.units.filter(unit =>
    unit.side !== side
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.inStrategicReserves
    && unit.modelPositions.length > 0
  );
  const previousTurnDestroyingUnitIds = new Set(state.missionEvents?.lastCompletedTurn?.destroyingUnitIds ?? []);
  const eligible = enemiesOnBattlefield.filter(unit =>
    attachedObjectiveIndexesWithinRange(state, unit, rules).length > 0
    || previousTurnDestroyingUnitIds.has(unit.id)
  );
  return (eligible.length ? eligible : enemiesOnBattlefield).map(unit => unit.id);
}

export function togglePunishmentCondemnedUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): BattleState {
  const options = punishmentCondemnedUnitOptions(state, side, rules);
  if (!options.includes(unitId)) return state;
  const current = state.missionState?.condemnedUnitIds?.[side] ?? [];
  const alreadySelected = current.includes(unitId);
  if (!alreadySelected && current.length >= 3) return state;

  const next = clone(state);
  next.missionState = next.missionState ?? {};
  const selections: [string[], string[]] = next.missionState.condemnedUnitIds ?? [[], []];
  selections[side] = alreadySelected
    ? selections[side].filter(id => id !== unitId)
    : [...selections[side], unitId];
  next.missionState.condemnedUnitIds = selections;
  const unit = next.units.find(candidate => candidate.id === unitId)!;
  next.log = [...next.log, log(
    next,
    side,
    next.armies[side].name,
    `${unit.profile.name} is ${alreadySelected ? 'no longer condemned' : 'condemned'} by ${next.armies[side].name}.`,
    'info',
  )];
  return next;
}

function autoSelectPunishmentCondemnedUnits(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
): void {
  const unitIds = punishmentCondemnedUnitOptions(state, side, rules).slice(0, 3);
  if (!unitIds.length) return;
  state.missionState = state.missionState ?? {};
  const selections: [string[], string[]] = state.missionState.condemnedUnitIds ?? [[], []];
  selections[side] = unitIds;
  state.missionState.condemnedUnitIds = selections;
  state.log = [...state.log, log(
    state,
    side,
    state.armies[side].name,
    `${state.armies[side].name} condemns ${unitIds.map(unitId =>
      state.units.find(unit => unit.id === unitId)?.profile.name ?? unitId
    ).join(', ')}.`,
    'info',
  )];
}

export function startPlayUnitAction(
  state: BattleState,
  unitId: string,
  side: Side,
  actionId = 'generic-action',
  actionName = 'Action',
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
  targetObjectiveIndex?: number,
  targetTerrainId?: string,
  targetOperationMarkerId?: string,
  targetUnitId?: string,
): BattleState {
  if (actionId !== 'surveil' && !playUnitCanStartAction(state, unitId, side, rules)) return state;
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
  if (actionId === 'consecrate') {
    return state;
  }
  if (actionId === 'maintain-control'
    && (targetObjectiveIndex === undefined
      || !maintainControlObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'secure-asset'
    && (targetObjectiveIndex === undefined
      || !secureAssetObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'decoy'
    && (targetObjectiveIndex === undefined
      || !decoyObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'sabotage'
    && (targetObjectiveIndex === undefined
      || !sabotageObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'cleanse'
    && (targetObjectiveIndex === undefined
      || !cleanseObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) {
    return state;
  }
  if (actionId === 'plunder'
    && (targetTerrainId === undefined
      || !plunderTerrainOptions(state, unitId, side, rules).includes(targetTerrainId))) {
    return state;
  }
  if (actionId === 'vanguard-operation'
    && (targetTerrainId === undefined
      || !vanguardOperationTerrainOptions(state, unitId, side, rules).includes(targetTerrainId))) {
    return state;
  }
  if (actionId === 'booby-trap'
    && (targetTerrainId === undefined
      || !boobyTrapTerrainOptions(state, unitId, side, rules).includes(targetTerrainId))) {
    return state;
  }
  if (actionId === 'sensor-sweep'
    && !sensorSweepOptions(state, unitId, side, rules).some(option =>
      option.objectiveIndex === targetObjectiveIndex
      && option.operationMarkerId === targetOperationMarkerId
    )) {
    return state;
  }
  if (actionId === 'surveil'
    && (targetUnitId === undefined
      || !surveilTargetOptions(state, unitId, side, rules).includes(targetUnitId))) {
    return state;
  }
  const next = clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  if (actionId === 'surveil' || actionId === 'booby-trap') {
    const action = {
      id: actionId,
      name: actionName,
      startedPhase: next.phase,
      completesAt: 'end-of-turn' as const,
      ...(targetUnitId !== undefined ? { targetUnitId } : {}),
      ...(targetTerrainId !== undefined ? { targetTerrainId } : {}),
    };
    recordCompletedMissionAction(next, unit, action, attachedObjectiveIndexesWithinRange(next, unit, rules));
    const target = targetUnitId === undefined
      ? undefined
      : next.units.find(candidate => candidate.id === targetUnitId);
    const targetTerrain = targetTerrainId === undefined
      ? undefined
      : next.terrain.find(terrain => terrain.id === targetTerrainId);
    next.log = [...next.log, log(
      next,
      side,
      unit.profile.name,
      actionId === 'surveil'
        ? `${unit.profile.name} surveils ${target!.profile.name}.`
        : `${unit.profile.name} traps ${targetTerrain!.name}.`,
      'info',
    )];
    if (actionId === 'booby-trap') {
      for (const component of attachedUnitComponents(next, unit)) component.actionStartedThisTurn = true;
    }
    return next;
  }
  const performingAction = {
    id: actionId,
    name: actionName,
    startedPhase: next.phase,
    completesAt: 'end-of-turn' as const,
    ...(targetObjectiveIndex !== undefined ? { targetObjectiveIndex } : {}),
    ...(targetTerrainId !== undefined ? { targetTerrainId } : {}),
    ...(targetOperationMarkerId !== undefined ? { targetOperationMarkerId } : {}),
    ...(targetUnitId !== undefined ? { targetUnitId } : {}),
  };
  for (const component of attachedUnitComponents(next, unit)) {
    component.performingAction = { ...performingAction };
    component.actionStartedThisTurn = true;
  }
  next.log = [...next.log, log(next, side, unit.profile.name, `${unit.profile.name} starts ${actionName}.`, 'info')];
  return next;
}

export function completeEndOfTurnActions(state: BattleState, side: Side): void {
  const handled = new Set<string>();
  for (const unit of state.units) {
    if (unit.side !== side || unit.destroyed || !unit.performingAction) continue;
    const groupId = attachedUnitId(unit);
    if (handled.has(groupId)) continue;
    handled.add(groupId);
    const action = unit.performingAction;
    const actionName = action.name;
    if (action.id === 'vanguard-operation'
      && (action.targetTerrainId === undefined
        || !vanguardOperationTerrainIsValid(state, unit, side, action.targetTerrainId))) {
      cancelUnitAction(state, unit, 'the target terrain area is no longer eligible');
      continue;
    }
    if (action.id === 'cleanse'
      && (action.targetObjectiveIndex === undefined
        || !hasActiveSecondaryMission(state, side, 'Cleanse')
        || !attachedObjectiveIndexesWithinRange(state, unit, rulesEditionForRuleset(state.ruleset)).includes(action.targetObjectiveIndex))) {
      cancelUnitAction(state, unit, 'the selected objective is no longer eligible');
      continue;
    }
    if (action.id === 'plunder'
      && (action.targetTerrainId === undefined
        || !hasActiveSecondaryMission(state, side, 'Plunder')
        || !attachedTerrainAreaIdsContainingUnit(state, unit).includes(action.targetTerrainId)
        || !terrainIsExplicitlyOutsideTerritory(state, side, action.targetTerrainId))) {
      cancelUnitAction(state, unit, 'the selected terrain area is no longer eligible');
      continue;
    }
    if (action.id === 'sensor-sweep') {
      const markerIndex = state.missionState?.operationMarkers?.findIndex(marker =>
        marker.id === action.targetOperationMarkerId
      ) ?? -1;
      const controlsTargetObjective = action.targetObjectiveIndex !== undefined
        && attachedObjectiveIndexesWithinRange(state, unit, rulesEditionForRuleset(state.ruleset)).includes(action.targetObjectiveIndex)
        && objectiveIsCentral(state, action.targetObjectiveIndex)
        && updateObjectiveControl(state, rulesEditionForRuleset(state.ruleset))?.some(objective =>
          objective.objectiveIndex === action.targetObjectiveIndex && objective.owner === side
        );
      if (markerIndex < 0 || !controlsTargetObjective) {
        cancelUnitAction(state, unit, markerIndex < 0
          ? 'the selected operation marker is no longer on the battlefield'
          : 'the unit does not control the selected central objective');
        continue;
      }
      state.missionState!.operationMarkers = state.missionState!.operationMarkers!.filter(
        marker => marker.id !== action.targetOperationMarkerId,
      );
    }
    recordCompletedMissionAction(state, unit, action, attachedObjectiveIndexesWithinRange(state, unit, rulesEditionForRuleset(state.ruleset)));
    for (const component of attachedUnitComponents(state, unit)) component.performingAction = undefined;
    state.log = [...state.log, log(state, side, unit.profile.name, `${unit.profile.name} completes ${actionName}.`, 'info')];
  }
}

function eligibleShootingWeapons(unit: BattleUnit, state: BattleState, rules: RulesEdition): WeaponProfile[] {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated || state.firingDeckLockedUnitIds?.includes(unit.id)) return [];
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

  const representative = attachedUnitTargetRepresentative(state, target);
  const epicChallengeModelIndex = weapon.isMelee ? activeEpicChallengeModelIndex(state, target) : undefined;
  const epicChallengeVisible = epicChallengeModelIndex !== undefined
    && target.modelPositions[epicChallengeModelIndex] !== undefined
    && unit.modelPositions.some((from, modelIndex) => hasLOSEdgeToEdge(
      from,
      modelBaseRadius(unit, modelIndex),
      target.modelPositions[epicChallengeModelIndex],
      modelBaseRadius(target, epicChallengeModelIndex),
      state.terrain,
    ));
  const precisionCharacter = (weaponHasKeyword(weapon, 'Precision') || epicChallengeModelIndex !== undefined)
    && unitHasKeyword(target, 'Character')
    && (epicChallengeModelIndex === undefined
      ? unit.modelPositions.some((from, modelIndex) => hasAnyModelLOS(from, modelBaseRadius(unit, modelIndex), target, state.terrain))
      : epicChallengeVisible);
  if (representative?.id !== target.id && !precisionCharacter) return false;

  const targetEngagedWithFriendly = targetWithinFriendlyEngagement(state, target, unit.side, rules);
  const targetEngagedWithShooter = inEngagement(unit, [target], eng);
  if (unitHasDatasheetRule(target, 'Lone Operative') && battleUnitsBaseEdgeDistance(unit, target) > 12) return false;
  if (weaponHasKeyword(weapon, 'Blast') && targetEngagedWithFriendly) return false;
  if (
    targetEngagedWithFriendly
    && !(weaponIsSidearm(weapon) && targetEngagedWithShooter)
    && !(bigGunsNeverTire && targetEngagedWithShooter)
    && !unitCanUseBigGunsNeverTire(target)
  ) return false;
  const targetVisible = precisionCharacter
    || battleUnitHasLosToAttachedUnit(state, unit, target);
  return battleUnitToAttachedUnitDistance(state, unit, target) <= weapon.range
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

function activeEpicChallengeModelIndex(state: BattleState, target: BattleUnit): number | undefined {
  const round = battleRound(state);
  return (state.stratagemUses ?? [])
    .find(use => use.stratagemId === 'epic-challenge'
      && use.phase === 'fight'
      && (use.battleRound ?? round) === round
      && use.targetUnitId === target.id)
    ?.targetModelIndex;
}

function battleUnitToAttachedUnitDistance(state: BattleState, source: BattleUnit, target: BattleUnit): number {
  return Math.min(...attachedUnitComponents(state, target).map(component => battleUnitsBaseEdgeDistance(source, component)));
}

function battleUnitHasLosToAttachedUnit(state: BattleState, source: BattleUnit, target: BattleUnit): boolean {
  return attachedUnitComponents(state, target).some(component =>
    source.modelPositions.some((from, modelIndex) =>
      hasAnyModelLOS(from, modelBaseRadius(source, modelIndex), component, state.terrain),
    ),
  );
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
  const usesSmokescreen = unitHasActiveStratagem(state, target, 'smokescreen', 'shooting')
    || targetIsScreenedBySmoke(state, unit, target);
  const cover = targetHasTerrainCoverFrom(unit.modelPositions, target, state.terrain) || usesIndirectFirePenalty || usesSmokescreen;
  const usesBigGunsPenalty = (bigGunsNeverTire || targetWithinFriendlyEngagement(state, target, unit.side, rules))
    && !weaponIsSidearm(weapon);
  const usesHeavyBonus = weaponHasKeyword(weapon, 'Heavy') && unit.movementAction === 'remainedStationary';
  const usesStealth = attachedUnitHasRule(state, target, 'Stealth');
  const hitModifier = (usesBigGunsPenalty ? 1 : 0) + (usesHeavyBonus ? -1 : 0) + (usesIndirectFirePenalty ? 1 : 0) + (usesStealth ? 1 : 0);
  const hitModifierNotes = [
    usesBigGunsPenalty ? 'Big Guns Never Tire -1 to Hit' : '',
    usesHeavyBonus ? 'Heavy +1 to Hit' : '',
    usesIndirectFirePenalty ? 'Indirect Fire -1 to Hit; target has Benefit of Cover' : '',
    usesSmokescreen ? 'Smokescreen: target has Benefit of Cover' : '',
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
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayShootingWeaponOption[] {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return [];
  if (state.activeAttachedShootingUnitId && attachedUnitId(unit) !== state.activeAttachedShootingUnitId) return [];
  const lockedTargetId = state.activeAttachedShootingUnitId === attachedUnitId(unit)
    ? state.attachedShootingTargetUnitId
    : undefined;
  const options = eligibleShootingWeapons(unit, state, rules)
    .map(weapon => {
      const weaponIndex = unit.profile.weapons.indexOf(weapon);
      return {
        weaponIndex,
        name: weapon.name,
        targetIds: enemies(state, side)
          .filter(target => shootingWeaponCanTarget(state, unit, target, weapon, rules))
          .filter(target => !lockedTargetId || target.id === lockedTargetId)
          .map(target => target.id),
      };
    })
    .filter(option => option.weaponIndex >= 0);
  if (options.length === 0 && unitCanBeSelectedToShootWithoutAttacks(unit, state, rules)) {
    return [{ weaponIndex: -1, name: 'No ranged weapons', targetIds: [] }];
  }
  return options;
}

function runShootingPhaseUnits(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  if (rules.metadata.edition !== '11e') {
    return activeUnits(state, side).flatMap(unit => runShooting(unit, state, rules));
  }
  const logs: LogEntry[] = [];
  const handled = new Set<string>();
  for (const selected of activeUnits(state, side)) {
    const groupId = attachedUnitId(selected);
    if (handled.has(groupId)) continue;
    handled.add(groupId);
    autoSelectFiringDeckInPlace(state, selected);
    if (!attachedUnitIsFormed(state, selected)) {
      logs.push(...runShooting(selected, state, rules));
      logs.push(...resolvePendingDeadlyDemisesInPlace(state));
      clearFiringDeckWeapons(selected);
      continue;
    }
    const components = attachedUnitComponents(state, selected);
    const declarations: Array<{ componentId: string; targetId: string; weapon: WeaponProfile; weaponIndex: number }> = [];
    for (const component of components) {
      const weapons = shootingWeaponSelectionForAll(eligibleShootingWeapons(component, state, rules)
        .map(weapon => ({ weapon, weaponIndex: component.profile.weapons.indexOf(weapon) }))
        .filter(option => option.weaponIndex >= 0));
      if (weapons.length) {
        logs.push(log(state, component.side, component.profile.name, `${component.profile.name} shoots:`, 'shoot'));
      }
      for (const option of weapons) {
        const targets = enemies(state, side).filter(target =>
          shootingWeaponCanTarget(state, component, target, option.weapon, rules),
        );
        const target = nearest(component, targets);
        if (target) {
          declarations.push({ componentId: component.id, targetId: target.id, ...option });
        } else {
          logs.push(log(state, component.side, component.profile.name,
            `  ${option.weapon.name}: no valid targets in range/LOS`, 'info'));
        }
      }
    }
    for (const declaration of declarations) {
      const component = state.units.find(unit => unit.id === declaration.componentId && !unit.destroyed);
      const target = state.units.find(unit => unit.id === declaration.targetId && !unit.destroyed);
      if (!component || !target) continue;
      logs.push(...resolveShootingWeaponIntoTarget(
        state, component, target, declaration.weapon, declaration.weaponIndex, rules,
      ));
    }
    for (const component of components) component.activated = true;
    logs.push(...resolvePendingDeadlyDemisesInPlace(state));
    components.forEach(clearFiringDeckWeapons);
  }
  return logs;
}

function updateAttachedShootingActivation(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  targetUnitId?: string,
): void {
  if (rules.metadata.edition !== '11e' || !attachedUnitIsFormed(state, unit)) return;
  state.activeAttachedShootingUnitId = attachedUnitId(unit);
  state.attachedShootingTargetUnitId ??= targetUnitId;
  const remaining = attachedUnitComponents(state, unit).filter(component =>
    !component.activated
    && (eligibleShootingWeapons(component, state, rules).length > 0
      || unitCanBeSelectedToShootWithoutAttacks(component, state, rules)),
  );
  if (remaining.length) return;
  for (const component of attachedUnitComponents(state, unit)) component.activated = true;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
}

export function playSnapShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayShootingWeaponOption[] {
  if (state.phase !== 'movement' || state.movementStep !== 'reinforcements' || state.activeArmy === side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated || !unitHasActiveStratagem(state, unit, 'fire-overwatch', 'movement')) return [];
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
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return state;
  if (s.activeAttachedShootingUnitId && attachedUnitId(unit) !== s.activeAttachedShootingUnitId) return state;
  if (s.attachedShootingTargetUnitId && targetUnitId !== s.attachedShootingTargetUnitId) return state;

  if (weaponIndex === -1 || (weaponIndex === 'all' && !eligibleShootingWeapons(unit, s, rules).length)) {
    if (!unitCanBeSelectedToShootWithoutAttacks(unit, s, rules) || eligibleShootingWeapons(unit, s, rules).length > 0) return state;
    unit.activated = true;
    updateAttachedShootingActivation(s, unit, rules);
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
  updateAttachedShootingActivation(s, unit, rules, target.id);
  s.log = [...s.log, ...logs];
  if (unit.activated && s.pendingDeadlyDemises?.length) s.log = [...s.log, ...resolvePendingDeadlyDemisesInPlace(s)];
  if (unit.activated) clearFiringDeckWeapons(unit);
  return s;
}

export function snapShootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (state.phase !== 'movement' || state.movementStep !== 'reinforcements' || state.activeArmy === side) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target || unit.activated || !unitHasActiveStratagem(s, unit, 'fire-overwatch', 'movement')) return state;

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
  const unit = s.units.find(u => u.id === unitId && u.side === side)!;
  for (const component of attachedUnitComponents(s, unit)) component.activated = true;
  s.activeAttachedShootingUnitId = undefined;
  s.attachedShootingTargetUnitId = undefined;
  return s;
}

function runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.performingAction) return [];
  if (unit.destroyed || unit.embarkedInUnitId || unitSurgedThisPhase(state, unit) || isAircraft(unit) || unit.inCombat || unit.fellBack || unit.arrivedFromReinforcements || unit.emergencyDisembarkedThisTurn || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return [];
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
  if (rules.metadata.edition === '11e' && hasKeyword(unit, 'fly')) unit.takingToSkies = true;
  const maximumDistance = Math.max(0, roll - takeToSkiesDistanceCost(unit));

  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name,
      `⚔️  ${unit.profile.name} charges ${target.profile.name}! (${needed.toFixed(1)}" needed, rolled ${r1}+${r2}=${roll})`,
      'charge',
    ),
  ];

  if (maximumDistance >= needed) {
    const reachablePos = findReachablePosition(
      unit, target.position, maximumDistance, state.terrain, stopGap,
      unitTakesToSkiesForState(state, unit),
    );
    const newPos = avoidModelOverlap(unit, reachablePos, state);
    if (dist(unit.position, newPos) + 0.01 < needed) {
      unit.takingToSkies = undefined;
      logs.push(log(state, unit.side, unit.profile.name,
        `  ❌ Charge path blocked by terrain`,
        'charge',
      ));
      return logs;
    }
    translateFormation(unit, newPos.x - unit.position.x, newPos.y - unit.position.y);
    resolveInternalModelOverlaps(unit);
    unit.charged = true;
    unit.lastMovePhase = state.phase;
    unit.lastMoveTurn = state.turn;
    unit.takingToSkies = undefined;
    unit.inCombat = true;
    target.inCombat = true;
    logs.push(log(state, unit.side, unit.profile.name,
      `  ✅ Charge successful! ${unit.profile.name} is now in melee`,
      'charge',
    ));
  } else {
    unit.takingToSkies = undefined;
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
    && !unit.combatDisembarkedThisTurn
    && !unit.rapidDisembarkedThisTurn
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
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayChargeTargetOption[] {
  if (state.phase !== 'charge') return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit
    || attachedUnitComponents(state, unit).some(component => component.activated)
    || attachedUnitComponents(state, unit).some(component => unitSurgedThisPhase(state, component))
    || !sideCanDeclareCharge(state, side, unit)
    || !unitCanDeclareCharge(unit)) return [];
  return enemies(state, side)
    .filter(target => unitCanChargeTarget(unit, target)
      && (state.activeArmy === side
        || (unit.heroicInterventionMode === 'leap-to-defend'
          ? target.charged
          : unit.heroicInterventionMode === 'into-the-fray'
            ? battleUnitsBaseEdgeDistance(unit, target) <= 6
            : false)))
    .map(target => ({ targetId: target.id, needed: chargeNeededDistance(unit, target, rules) }))
    .filter(option => option.needed <= rules.chargeRange());
}

export function chargePlayUnitTarget(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (state.phase !== 'charge') return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = state.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit
    || attachedUnitComponents(state, unit).some(component => component.activated)
    || attachedUnitComponents(state, unit).some(component => unitSurgedThisPhase(state, component))
    || !target
    || !sideCanDeclareCharge(state, side, unit)
    || !unitCanDeclareCharge(unit)
    || !unitCanChargeTarget(unit, target)
    || (state.activeArmy !== side
      && (unit.heroicInterventionMode === 'leap-to-defend'
        ? !target.charged
        : unit.heroicInterventionMode === 'into-the-fray'
          ? battleUnitsBaseEdgeDistance(unit, target) > 6
          : true))) return state;
  const needed = chargeNeededDistance(unit, target, rules);
  if (needed > rules.chargeRange()) return state;

  const s = clone(state);
  const chargingUnit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const chargeTarget = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!chargingUnit || !chargeTarget) return state;

  const r1 = d6();
  const r2 = d6();
  const rawRoll = r1 + r2;
  const heroicIntervention = state.activeArmy !== side;
  const roll = heroicIntervention && chargingUnit.heroicInterventionMode === 'into-the-fray'
    ? Math.min(6, rawRoll)
    : rawRoll;
  const maximumDistance = Math.max(0, roll - takeToSkiesDistanceCost(chargingUnit));
  const logs: LogEntry[] = [
    log(s, side, chargingUnit.profile.name,
      `${chargingUnit.profile.name} declares a charge against ${chargeTarget.profile.name} (${needed.toFixed(1)}" needed, rolled ${r1}+${r2}=${roll}${roll !== rawRoll ? ` (capped from ${rawRoll})` : ''}).`,
      'charge',
    ),
  ];

  if (maximumDistance + 0.001 < needed) {
    for (const component of attachedUnitComponents(s, chargingUnit)) {
      component.activated = true;
      component.heroicInterventionThisPhase = undefined;
      component.heroicInterventionMode = undefined;
      component.takingToSkies = undefined;
    }
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
  const reachablePos = findReachablePosition(
    chargingUnit,
    chargeTarget.position,
    maximumDistance,
    s.terrain,
    stopGap,
    unitTakesToSkiesForState(s, chargingUnit),
  );
  const newPos = avoidModelOverlap(chargingUnit, reachablePos, s);
  translateFormation(chargingUnit, newPos.x - chargingUnit.position.x, newPos.y - chargingUnit.position.y);
  resolveInternalModelOverlaps(chargingUnit);
  chargingUnit.position = centroid(chargingUnit.modelPositions);

  if (!inEngagement(chargingUnit, [chargeTarget], rules.engagementRange())) {
    const failed = clone(state);
    const failedUnit = failed.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
    for (const component of attachedUnitComponents(failed, failedUnit)) {
      component.activated = true;
      component.heroicInterventionThisPhase = undefined;
      component.heroicInterventionMode = undefined;
      component.takingToSkies = undefined;
    }
    logs.push(log(failed, side, failedUnit.profile.name, `${failedUnit.profile.name} cannot reach engagement range.`, 'charge'));
    failed.log = [...failed.log, ...logs];
    return failed;
  }

  for (const component of attachedUnitComponents(s, chargingUnit)) {
    component.activated = true;
    component.charged = !heroicIntervention;
    component.heroicInterventionThisPhase = undefined;
    component.heroicInterventionMode = undefined;
    component.inCombat = true;
    component.lastMovePhase = s.phase;
    component.lastMoveTurn = s.turn;
    component.takingToSkies = undefined;
  }
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

export function playMeleeFixedAttackCount(
  state: BattleState,
  unitId: string,
  side: Side,
  weaponIndex: number,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): number | null {
  const option = playFightWeaponOptions(state, unitId, side, rules)
    .find(candidate => candidate.weaponIndex === weaponIndex);
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  const attacks = unit?.profile.weapons[weaponIndex]?.attacks;
  if (!option || !unit || !/^\d+$/.test(String(attacks).trim())) return null;
  return Number(attacks) * aliveWeaponModelCount(unit, weaponIndex);
}

function unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  return !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.activated
    && enemies(state, unit.side).some(enemy => unitCanFightTarget(unit, enemy) && inEngagement(unit, [enemy], rules.engagementRange()));
}

function unitWasEngagedAtFightStepStart(state: BattleState, unit: BattleUnit): boolean {
  return state.engagedUnitIdsAtFightStepStart?.includes(unit.id) ?? false;
}

function unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated) return false;
  if (rules.metadata.edition !== '11e') return unitCanFight(unit, state, rules);
  if (state.fightStepStarted === false) return false;
  return unit.charged
    || unitWasEngagedAtFightStepStart(state, unit)
    || enemies(state, unit.side).some(enemy => unitCanFightTarget(unit, enemy) && inEngagement(unit, [enemy], rules.engagementRange()));
}

function startFightStepInPlace(s: BattleState, rules: RulesEdition): void {
  s.fightStepStarted = true;
  s.forcedFightUnitId = undefined;
  s.lastFightSelectionSide = undefined;
  s.activeAttachedFightUnitId = undefined;
  s.activeAttachedShootingUnitId = undefined;
  s.attachedShootingTargetUnitId = undefined;
  s.engagedUnitIdsAtFightStepStart = s.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && enemies(s, unit.side).some(enemy => unitCanFightTarget(unit, enemy) && inEngagement(unit, [enemy], rules.engagementRange())))
    .map(unit => unit.id);
  s.log = [...s.log, log(s, s.activeArmy, s.armies[s.activeArmy].name, 'Fight step begins; engagement eligibility is recorded.', 'phase')];
}

export function startPlayFightStep(
  state: BattleState,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight' || state.fightStepStarted) return state;
  const s = clone(state);
  startFightStepInPlace(s, rules);
  return s;
}

export function playFightStepNeedsStart(
  state: BattleState,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  return rules.metadata.edition === '11e' && state.phase === 'fight' && state.fightStepStarted === false;
}

export function playFightPhaseHasPendingActivations(
  state: BattleState,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  return rules.metadata.edition === '11e'
    && (playFightActivationUnitIds(state, 0, rules).length > 0
      || playFightActivationUnitIds(state, 1, rules).length > 0);
}

function unitHasCounteroffensive(state: BattleState, unit: BattleUnit): boolean {
  return unitHasActiveStratagem(state, unit, 'counteroffensive', 'fight');
}

function unitHasFightsFirst(state: BattleState, unit: BattleUnit): boolean {
  return unit.charged || unitHasCounteroffensive(state, unit) || attachedUnitHasRule(state, unit, 'Fights First');
}

function finishAttachedFightComponent(state: BattleState, unit: BattleUnit, rules: RulesEdition): void {
  if (rules.metadata.edition !== '11e') return;
  const remaining = attachedUnitComponents(state, unit)
    .filter(component => !component.activated && unitEligibleToFight(component, state, rules));
  if (remaining.length) {
    state.activeAttachedFightUnitId = attachedUnitId(unit);
    return;
  }
  state.activeAttachedFightUnitId = undefined;
  const forcedUnit = state.units.find(candidate => candidate.id === state.forcedFightUnitId);
  if (forcedUnit && attachedUnitId(forcedUnit) === attachedUnitId(unit)) state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = unit.side;
}

function sideCanSelectFightUnit(state: BattleState, side: Side, rules: RulesEdition): boolean {
  return state.phase === 'fight'
    && (rules.metadata.edition === '11e'
      || state.activeArmy === side
      || activeUnits(state, side).some(unit => unitHasCounteroffensive(state, unit)));
}

export function playFightActivationUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string[] {
  if (!sideCanSelectFightUnit(state, side, rules)) return [];
  const eligible = activeUnits(state, side).filter(unit => unitEligibleToFight(unit, state, rules));
  if (rules.metadata.edition === '11e' && state.activeAttachedFightUnitId) {
    return eligible
      .filter(unit => attachedUnitId(unit) === state.activeAttachedFightUnitId)
      .map(unit => unit.id);
  }
  if (state.forcedFightUnitId) {
    const forced = state.units.find(unit => unit.id === state.forcedFightUnitId);
    if (!forced || forced.side !== side) return [];
    return eligible
      .filter(unit => attachedUnitId(unit) === attachedUnitId(forced))
      .map(unit => unit.id);
  }
  if (rules.metadata.edition !== '11e' && state.activeArmy !== side) {
    return eligible.filter(unit => unitHasCounteroffensive(state, unit)).map(unit => unit.id);
  }
  if (rules.metadata.edition === '11e') {
    const allEligible = state.units.filter(unit => unitEligibleToFight(unit, state, rules));
    const counteroffensive = allEligible.filter(unit => unitHasCounteroffensive(state, unit));
    const priorityEligible = counteroffensive.length
      ? counteroffensive
      : allEligible.some(unit => unitHasFightsFirst(state, unit))
        ? allEligible.filter(unit => unitHasFightsFirst(state, unit))
        : allEligible;
    const preferredSide = state.lastFightSelectionSide === undefined
      ? state.activeArmy
      : (state.lastFightSelectionSide === 0 ? 1 : 0) as Side;
    const selectingSide = priorityEligible.some(unit => unit.side === preferredSide)
      ? preferredSide
      : (preferredSide === 0 ? 1 : 0) as Side;
    return side === selectingSide
      ? priorityEligible.filter(unit => unit.side === side).map(unit => unit.id)
      : [];
  }
  const counteroffensive = eligible.filter(unit => unitHasCounteroffensive(state, unit));
  if (counteroffensive.length) return counteroffensive.map(unit => unit.id);
  const fightsFirst = eligible.filter(unit => unitHasFightsFirst(state, unit));
  return (fightsFirst.length ? fightsFirst : eligible).map(unit => unit.id);
}

export function playOverrunFightUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string[] {
  if (rules.metadata.edition !== '11e' || state.fightStepStarted !== true) return [];
  return playFightActivationUnitIds(state, side, rules).filter(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
    if (!unit || unit.overrunFightSelected) return false;
    const engaged = enemies(state, side).some(enemy => unitCanFightTarget(unit, enemy) && inEngagement(unit, [enemy], rules.engagementRange()));
    return !engaged || (!unitWasEngagedAtFightStepStart(state, unit) && engaged);
  });
}

export function selectPlayOverrunFight(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (!playOverrunFightUnitIds(state, side, rules).includes(unitId)) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  unit.overrunFightSelected = true;
  s.log = [...s.log, log(s, side, unit.profile.name, `${unit.profile.name} is selected to make an Overrun Fight.`, 'fight')];
  return s;
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
  if (state.phase !== 'fight') return state;
  if (state.activeArmy !== side && rules.metadata.edition !== '11e') return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing) return state;
  if (attachedUnitComponents(state, existing).some(component => unitSurgedThisPhase(state, component))) return state;
  const isOverrunPileIn = kind === 'pileIn' && rules.metadata.edition === '11e' && state.fightStepStarted && existing.overrunFightSelected;
  if (kind === 'pileIn' && (isOverrunPileIn ? existing.overrunPiledIn : existing.piledIn)) return state;
  if (kind === 'consolidate' && existing.consolidated) return state;
  if (kind === 'pileIn' && isOverrunPileIn && !unitEligibleToFight(existing, state, rules)) return state;
  if (kind === 'pileIn' && !isOverrunPileIn && rules.metadata.edition === '11e' && state.fightStepStarted) return state;
  if (kind === 'pileIn' && !isOverrunPileIn && !unitCanFight(existing, state, rules) && !(existing.charged && enemies(state, side).length > 0)) return state;
  if (kind === 'consolidate' && !playUnitCanConsolidate(state, unitId, side, rules)) return state;

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

  if (kind === 'pileIn' && !inEngagement(unit, enemies(s, side), rules.engagementRange())) return state;
  if (kind === 'pileIn' && isOverrunPileIn) unit.overrunPiledIn = true;
  else if (kind === 'pileIn') unit.piledIn = true;
  else unit.consolidated = true;
  unit.lastMovePhase = s.phase;
  unit.lastMoveTurn = s.turn;
  unit.inCombat = inEngagement(unit, enemies(s, side), rules.engagementRange());

  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${unit.profile.name} ${isOverrunPileIn ? 'makes its Overrun pile-in' : kind === 'pileIn' ? 'piles in' : 'consolidates'}${movedModels ? ` with ${movedModels} model${movedModels === 1 ? '' : 's'}` : ''}.`,
    'move',
  )];
  return s;
}

export function playUnitCanPileIn(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit
    && state.phase === 'fight'
    && (state.activeArmy === side || rules.metadata.edition === '11e')
    && (rules.metadata.edition === '11e' && state.fightStepStarted
      ? !!unit.overrunFightSelected && !unit.overrunPiledIn && unitEligibleToFight(unit, state, rules)
      : !unit.piledIn && (unitCanFight(unit, state, rules) || (unit.charged && enemies(state, side).length > 0)));
}

export function playUnitCanConsolidate(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit && state.phase === 'fight' && (state.activeArmy === side || rules.metadata.edition === '11e') && unit.activated && !unit.consolidated
    && (rules.metadata.edition !== '11e' || !state.units.some(candidate => unitEligibleToFight(candidate, state, rules)));
}

export function pileInPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return applyFightPhaseMove(state, unitId, side, 'pileIn', rules);
}

export function consolidatePlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return applyFightPhaseMove(state, unitId, side, 'consolidate', rules);
}

export function playFightWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayFightWeaponOption[] {
  if (!sideCanSelectFightUnit(state, side, rules)) return [];
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
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
  targetSplits?: PlayMeleeAttackSplit[],
): BattleState {
  if (!sideCanSelectFightUnit(state, side, rules)) return state;
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
    finishAttachedFightComponent(s, fightingUnit, rules);
    s.log = [...s.log, log(s, side, fightingUnit.profile.name, `${fightingUnit.profile.name} is selected to fight ${fightTarget.profile.name} but has no melee weapons, so it makes no attacks.`, 'fight')];
    return s;
  }
  const meleeWeapons = fightingUnit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee);
  const selectedMeleeWeapons = rules.metadata.edition === '11e'
    ? meleeWeaponSelection(fightingUnit, meleeWeapons, weaponIndex)
    : weaponIndex === 'all'
      ? chooseOneProfilePerGroup(meleeWeapons)
      : meleeWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedMeleeWeapons.length) return state;
  if (targetSplits?.length && (weaponIndex === 'all' || selectedMeleeWeapons.length !== 1)) return state;

  const logs: LogEntry[] = [
    log(s, side, fightingUnit.profile.name, fightingUnit.overrunFightSelected
      ? `${fightingUnit.profile.name} makes an Overrun Fight against ${fightTarget.profile.name}:`
      : `${fightingUnit.profile.name} fights ${fightTarget.profile.name}:`, 'fight'),
  ];
  let madeAttacks = false;
  if (targetSplits?.length) {
    const option = selectedMeleeWeapons[0];
    const maxTargets = Number.parseInt(String(option.weapon.attacks), 10);
    const maxAttacks = maxTargets * aliveWeaponModelCount(fightingUnit, option.weaponIndex);
    const declaredAttacks = targetSplits.reduce((total, split) => total + split.attacks, 0);
    if (
      !Number.isFinite(maxTargets)
      || targetSplits.some(split => split.attacks < 1 || !Number.isInteger(split.attacks))
      || new Set(targetSplits.map(split => split.targetUnitId)).size !== targetSplits.length
      || declaredAttacks !== maxAttacks
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
        selectedTargetCount: targetSplits.length,
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
  finishAttachedFightComponent(s, fightingUnit, rules);
  s.log = [...s.log, ...logs];
  if (s.pendingDeadlyDemises?.length) s.log = [...s.log, ...resolvePendingDeadlyDemisesInPlace(s)];
  return s;
}

function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side).filter(e => unitCanFightTarget(unit, e) && inEngagement(unit, [e], eng));
  if (!foes.length) return [];
  unit.activated = true;
  finishAttachedFightComponent(state, unit, rules);

  const meleeOptions = unit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee);
  const meleeWeapons = rules.metadata.edition === '11e'
    ? meleeWeaponSelection(unit, meleeOptions, 'all')
    : chooseOneProfilePerGroup(meleeOptions);
  if (!meleeWeapons.length) return [log(state, unit.side, unit.profile.name, `${unit.profile.name} is selected to fight but has no melee weapons.`, 'fight')];

  const target = nearest(unit, foes)!;
  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name, `🗡️  ${unit.profile.name} fights ${target.profile.name}:`, 'fight'),
  ];

  for (const { weapon, weaponIndex } of meleeWeapons) {
    if (aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    logs.push(...resolveAttacks(unit, target, weapon, weaponIndex, rules, state, false));
    logs.push(...resolveHazardousTests(unit, weapon, weaponIndex, state));
  }

  logs.push(...resolvePendingDeadlyDemisesInPlace(state));

  return logs;
}

function runAutomaticFightForUnit(state: BattleState, unitId: string, rules: RulesEdition): BattleState {
  let s = state;
  const unit = s.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return s;
  if (playOverrunFightUnitIds(s, unit.side, rules).includes(unit.id)) {
    s = selectPlayOverrunFight(s, unit.id, unit.side, rules);
    const piled = pileInPlayUnit(s, unit.id, unit.side, rules);
    if (piled !== s) s = piled;
  }
  const selected = s.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!selected) return s;
  const fightLogs = runFight(selected, s, rules);
  if (fightLogs.length) s.log = [...s.log, ...fightLogs];
  return s;
}

function runAutomaticEleventhFightPhase(state: BattleState, startingSide: Side, rules: RulesEdition): BattleState {
  let s = state;
  for (const pileSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    for (const unit of activeUnits(s, pileSide)) {
      const piled = pileInPlayUnit(s, unit.id, pileSide, rules);
      if (piled !== s) s = piled;
    }
  }
  startFightStepInPlace(s, rules);

  let nextSide = startingSide;
  while (true) {
    const otherSide = (nextSide === 0 ? 1 : 0) as Side;
    const nextIds = playFightActivationUnitIds(s, nextSide, rules);
    const otherIds = playFightActivationUnitIds(s, otherSide, rules);
    const unitId = nextIds[0] ?? otherIds[0];
    if (!unitId) break;
    const selectedSide = nextIds.length ? nextSide : otherSide;
    s = runAutomaticFightForUnit(s, unitId, rules);
    if (!s.units.find(unit => unit.id === unitId)?.activated) break;
    nextSide = (selectedSide === 0 ? 1 : 0) as Side;
  }

  for (const unit of s.units.filter(candidate => candidate.activated && !candidate.destroyed)) {
    const consolidated = consolidatePlayUnit(s, unit.id, unit.side, rules);
    if (consolidated !== s) s = consolidated;
  }
  return s;
}

function bestLeadership(state: BattleState, unit: BattleUnit): number {
  return Math.min(...attachedUnitComponents(state, unit).flatMap(component => [
    component.profile.leadership,
    ...(component.profile.modelProfiles?.map(profile => profile.leadership) ?? []),
  ]));
}

function isBelowHalfStrength(state: BattleState, unit: BattleUnit): boolean {
  const startingStrength = attachedUnitComponents(state, unit, true)
    .reduce((total, component) => total + component.profile.baseModelCount, 0);
  if (startingStrength === 1) {
    return unit.woundsOnLeadModel < unit.profile.wounds / 2;
  }

  return attachedUnitRemainingModels(state, unit) < startingStrength / 2;
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
    if (attachedUnitTargetRepresentative(state, unit)?.id !== unit.id) continue;
    const components = attachedUnitComponents(state, unit);
    if (isBelowHalfStrength(state, unit)) {
      if (unitHasInsaneBraveryForCurrentBattleshock(state, unit)) {
        for (const component of components) component.battleshocked = false;
        logs.push(log(state, unit.side, unit.profile.name,
          `${unit.profile.name} automatically passes its Battle-shock test with Insane Bravery.`,
          'info',
        ));
        continue;
      }
      const rolls = [d6(), d6()];
      const roll = rolls[0] + rolls[1];
      const needed = bestLeadership(state, unit);
      const passed = roll >= needed;
      for (const component of components) component.battleshocked = !passed;
      logs.push(log(state, unit.side, unit.profile.name,
        `😰 ${unit.profile.name} below half strength — Battle-shock (${needed}+): rolled ${rolls[0]}+${rolls[1]}=${roll} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
        'info',
      ));
    } else {
      for (const component of components) component.battleshocked = false;
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
  const recordCount = s.missionState?.primaryMissionScoringRecords?.length ?? 0;
  const result = scorePrimaryMission(s, side, rules);
  const records = s.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
  return [...primaryMissionScoringLogs(s, records), ...unsupportedPrimaryMissionScoringLogs(s, [result])];
}

function scoreEndOfTurnPrimaryMissionLogs(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const recordCount = s.missionState?.primaryMissionScoringRecords?.length ?? 0;
  const results = scorePrimaryMissionsAtEndOfTurn(s, side, rules);
  const records = s.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
  const logs = primaryMissionScoringLogs(s, records);
  return [...logs, ...unsupportedPrimaryMissionScoringLogs(s, results)];
}

function scoreEndOfBattlePrimaryMissionLogs(s: BattleState, rules: RulesEdition): LogEntry[] {
  const recordCount = s.missionState?.primaryMissionScoringRecords?.length ?? 0;
  const results = scorePrimaryMissionsAtEndOfBattle(s, rules);
  const records = s.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
  const logs = primaryMissionScoringLogs(s, records);
  return [...logs, ...unsupportedPrimaryMissionScoringLogs(s, results)];
}

function scoreEndOfTurnSecondaryMissionLogs(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return secondaryMissionScoringLogs(s, scoreSecondaryMissionsAtEndOfTurn(s, side, rules));
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
const PLAY_MODEL_EDIT_PHASES: Phase[] = ['deployment', 'setup', 'movement'];

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
  s.fightStepStarted = undefined;
  s.engagedUnitIdsAtFightStepStart = undefined;
  s.lastFightSelectionSide = undefined;
  s.activeAttachedFightUnitId = undefined;
  s.firingDeckLockedUnitIds = undefined;
  s.preBattleAbilitiesResolved = true;
  s.units.forEach(clearFiringDeckWeapons);
  s.units.forEach(unit => {
    unit.overrunFightSelected = undefined;
    unit.overrunPiledIn = undefined;
    unit.scoutMoveStarted = undefined;
    unit.scoutMoveAllowance = undefined;
    unit.superHeavyMobile = undefined;
    unit.firingDeckTurn = undefined;
  });
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
    u.combatDisembarkedThisTurn = undefined;
    u.rapidDisembarkedThisTurn = undefined;
    u.fellBack = false;
    u.inCombat = false;
  });
  s.phase = 'command';
  s.movementStep = undefined;
  autoSelectPunishmentCondemnedUnits(s, side, rules);
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
    modelRosterIndexes: Array.from({ length: profile.baseModelCount }, (_, modelIndex) => modelIndex),
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

function reinforcementPlacementIsOutsideEnemyRange(
  state: BattleState,
  side: Side,
  profile: UnitProfile,
  modelPositions: Position[],
  minRange = state.ruleset.edition === '11e' ? 8 : 9,
): boolean {
  const foes = enemies(state, side);
  return modelPositions.every((model, modelIndex) =>
    foes.every(enemy =>
      enemy.modelPositions.every((enemyModel, enemyModelIndex) => baseFootprintDistance(
        model,
        modelBaseFootprintInches(profile, modelIndex),
        enemyModel,
        modelFootprint(enemy, enemyModelIndex),
      ) > minRange),
    ),
  );
}

function profileDropHasDeepStrike(state: BattleState, side: Side, profile: UnitProfile): boolean {
  return attachedUnitProfilesFor(state.armies[side].army, profile).every(candidate =>
    candidate.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike || unitHasRule(candidate, 'Deep Strike'),
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
const COMBAT_DISEMBARK_RANGE = 6;

function unitAssignedToTransport(profile: UnitProfile, transport: BattleUnit): boolean {
  return profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport
    && (
      profile.deployment.transportUnitId === unitRosterId(transport.profile)
      || (!profile.deployment.transportUnitId && profile.deployment.transportName === transport.profile.name)
    );
}

function disembarkPositions(
  state: BattleState,
  transport: BattleUnit,
  profile: UnitProfile,
  combatDisembark = false,
): Position[] | null {
  const side = transport.side;
  const forward = side === 0 ? 1 : -1;
  const accessRange = combatDisembark ? COMBAT_DISEMBARK_RANGE : TRANSPORT_ACCESS_RANGE;
  const offsets: Position[] = [
    { x: forward * (accessRange + 0.5), y: 0 },
    { x: -forward * (accessRange + 0.5), y: 0 },
    { x: 0, y: accessRange + 0.5 },
    { x: 0, y: -(accessRange + 0.5) },
  ];
  const enemiesInState = enemies(state, side);
  const transportEngagedEnemyIds = new Set(
    engagedEnemies(state, transport, rulesEditionForRuleset(state.ruleset)).map(enemy => enemy.id),
  );

  for (const offset of offsets) {
    const positions = playGridFormation(profile, {
      x: transport.position.x + offset.x,
      y: transport.position.y + offset.y,
    }, side);
    const candidateUnit = makeBattleUnit(profile, side, positions);
    const engagedEnemyIds = enemiesInState
      .filter(enemy => inEngagement(candidateUnit, [enemy], rulesEditionForRuleset(state.ruleset).engagementRange()))
      .map(enemy => enemy.id);
    if (!combatDisembark && engagedEnemyIds.length > 0) continue;
    if (combatDisembark && engagedEnemyIds.some(enemyId => !transportEngagedEnemyIds.has(enemyId))) continue;
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
  const canInfiltrate = profileDropHasInfiltrators(s, side, profile);
  if (!canInfiltrate && !pointInDeploymentZone(position, zone, modelBaseRadiusInches(profile))) {
    s.log = [...s.log, log(s, side, profile.name,
      `${profile.name} must be placed wholly inside ${zone.name}.`,
      'info',
    )];
    return s;
  }
  const modelPositions = playGridFormation(profile, position, side);
  if (canInfiltrate && (
    modelPositions.some((model, modelIndex) => !modelIsOutsideEnemyDeploymentZoneBuffer(profile, side, model, modelIndex, deployment, board))
    || !infiltratorModelsAreOutsideEnemyUnits(s, side, profile, modelPositions)
  )) {
    s.log = [...s.log, log(s, side, profile.name,
      `${profile.name} must be more than 8" horizontally from the enemy deployment zone and every enemy unit.`,
      'info',
    )];
    return s;
  }
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
  if (profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike && !profileDropHasDeepStrike(state, side, profile)) return state;

  const profileKey = unitRosterId(profile);
  if (state.units.some(unit => unit.side === side && !unit.destroyed && unitRosterId(unit.profile) === profileKey)) return state;

  const modelPositions = playGridFormation(profile, position, side);
  if (!reinforcementPlacementIsOutsideEnemyRange(state, side, profile, modelPositions)) return state;

  const s = clone(state);
  const board = boardFormatForState(s);
  const unit = makeBattleUnit(profile, side, modelPositions);
  markUnitArrivedFromReinforcements(unit);
  resolveInternalModelOverlaps(unit, undefined, board);
  s.units.push(unit);

  const movingIndices = new Set(unit.modelPositions.map((_, modelIndex) => modelIndex));
  if (
    !playMoveHasNoBaseOverlap(s, unit, movingIndices)
    || !playMoveHasNoWallOverlap(s, unit, movingIndices)
    || (s.ruleset.edition === '11e'
      && profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve
      && !reinforcementPlacementIsWithinStrategicReserveEdge(unit, s))
  ) return state;

  s.log = [...s.log, log(
    s,
    side,
    profile.name,
    `${s.armies[side].name} sets up ${profile.name} as Reinforcements more than ${s.ruleset.edition === '11e' ? 8 : 9}" horizontally from enemy units.`,
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
    !reinforcementPlacementIsOutsideEnemyRange(s, side, unit.profile, unit.modelPositions)
    || !reinforcementPlacementIsWithinStrategicReserveEdge(unit, s)
    || !playMoveHasNoBaseOverlap(s, unit, movingIndices)
    || !playMoveHasNoWallOverlap(s, unit, movingIndices)
  ) return state;

  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${s.armies[side].name} returns ${unit.profile.name} from Strategic Reserves more than ${s.ruleset.edition === '11e' ? 8 : 9}" horizontally from enemy units${state.activeArmy !== side ? ' using Rapid Ingress' : ''}.`,
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
  recordUnitLeftBattlefieldMissionEvent(s, unit.id);
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

export type PlayDisembarkModes = {
  combatDisembark: boolean;
  rapidDisembark: boolean;
};

export function playDisembarkModes(state: BattleState, transportUnitId: string): PlayDisembarkModes {
  const transport = state.units.find(candidate => candidate.id === transportUnitId);
  const rapidDisembark = state.ruleset.edition === '11e'
    && transport?.movementComplete === true
    && transport.movementAction === 'normalMove'
    && (movementStep(state) === 'moveUnits' || transport.arrivedFromReinforcements === true);
  return {
    rapidDisembark,
    combatDisembark: state.ruleset.edition === '11e' && !!transport?.inCombat && !rapidDisembark,
  };
}

export function playUnitCanDisembark(
  state: BattleState,
  side: Side,
  transportUnitId: string,
  passengerUnitId?: string,
  armyUnitIndex?: number,
  combatDisembark?: boolean,
  rapidDisembark?: boolean,
): boolean {
  if (state.phase !== 'movement' || state.activeArmy !== side) return false;
  const currentMovementStep = movementStep(state);
  if (currentMovementStep !== 'moveUnits' && currentMovementStep !== 'reinforcements') return false;
  const transport = state.units.find(candidate => candidate.id === transportUnitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!transport || !unitIsTransportProfile(transport.profile)
    || transport.movementAction === 'advanced'
    || transport.movementAction === 'fellBack') return false;
  const defaultDisembarkModes = playDisembarkModes(state, transportUnitId);
  const useRapidDisembark = rapidDisembark ?? defaultDisembarkModes.rapidDisembark;
  const useCombatDisembark = combatDisembark ?? defaultDisembarkModes.combatDisembark;
  if (useCombatDisembark && state.ruleset.edition !== '11e') return false;
  if (useRapidDisembark && state.ruleset.edition !== '11e') return false;
  const transportCanDisembarkBeforeMovement = !transport.movementAction
    || transport.movementAction === 'remainedStationary';
  if (!useRapidDisembark && !useCombatDisembark && !transportCanDisembarkBeforeMovement) return false;
  if (useRapidDisembark && (transport.movementAction !== 'normalMove' || !transport.movementComplete)) return false;
  if (currentMovementStep === 'reinforcements' && !useRapidDisembark) return false;
  const passenger = passengerUnitId
    ? state.units.find(candidate => candidate.id === passengerUnitId && candidate.side === side && !candidate.destroyed && candidate.embarkedInUnitId === transportUnitId)
    : null;
  const profile = passenger?.profile ?? (typeof armyUnitIndex === 'number' ? state.armies[side].army.units[armyUnitIndex] : undefined);
  if (!profile || (armyUnitIndex !== undefined && !unitAssignedToTransport(profile, transport))) return false;
  if (state.units.some(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId && unitRosterId(unit.profile) === unitRosterId(profile))) return false;
  return !!disembarkPositions(state, transport, profile, useCombatDisembark);
}

export function disembarkPlayUnit(
  state: BattleState,
  side: Side,
  transportUnitId: string,
  passengerUnitId?: string,
  armyUnitIndex?: number,
  combatDisembark?: boolean,
  rapidDisembark?: boolean,
): BattleState {
  if (!playUnitCanDisembark(state, side, transportUnitId, passengerUnitId, armyUnitIndex, combatDisembark, rapidDisembark)) return state;
  const s = clone(state);
  const transport = s.units.find(candidate => candidate.id === transportUnitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
  const existingPassenger = passengerUnitId
    ? s.units.find(candidate => candidate.id === passengerUnitId && candidate.side === side && !candidate.destroyed && candidate.embarkedInUnitId === transportUnitId)
    : null;
  const profile = existingPassenger?.profile ?? (typeof armyUnitIndex === 'number' ? s.armies[side].army.units[armyUnitIndex] : undefined);
  if (!profile) return state;
  const defaultDisembarkModes = playDisembarkModes(s, transportUnitId);
  const useRapidDisembark = rapidDisembark ?? defaultDisembarkModes.rapidDisembark;
  const useCombatDisembark = combatDisembark ?? defaultDisembarkModes.combatDisembark;
  const positions = disembarkPositions(s, transport, profile, useCombatDisembark);
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
  if (useCombatDisembark) {
    unit.combatDisembarkedThisTurn = true;
    unit.battleshocked = true;
  }
  if (useRapidDisembark) {
    unit.rapidDisembarkedThisTurn = true;
    unit.movementAction = 'normalMove';
    unit.movementAllowanceRemaining = 0;
    unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
    unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
    unit.movementComplete = true;
  }
  const hazardLogs = useCombatDisembark ? resolveCombatDisembarkHazards(s, unit) : [];
  if (!existingPassenger) s.units.push(unit);
  s.log = [...s.log, log(
    s,
    side,
    unit.profile.name,
    `${unit.profile.name} disembarks from ${transport.profile.name}.`,
    'move',
  )];
  s.log.push(...hazardLogs);
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

function coherencyEditionForState(state: BattleState): '10e' | '11e' {
  return state.ruleset.edition;
}

export function battleUnitIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (!shouldShowCoherencyIssues(state)) return new Set();
  const unitIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    if (modelListIsCoherent(list.models, coherencyEditionForState(state))) continue;
    list.models.forEach(model => unitIds.add(model.unit.id));
  }
  return unitIds;
}

export function battleModelIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (!shouldShowCoherencyIssues(state)) return new Set();
  const modelIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    const issueIndices = modelIndicesWithCoherencyIssues(list.models, coherencyEditionForState(state));
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
    if (modelListIsCoherent(list.models, coherencyEditionForState(state))) continue;
    issues.push(`${list.label} (${list.models.length} models) is out of coherency.`);
  }
  return issues;
}

export function playPhaseCoherencyIssues(state: BattleState): string[] {
  if (state.pendingSurgeMove) {
    const unitName = state.units.find(unit => unit.id === state.pendingSurgeMove?.unitId)?.profile.name ?? 'Unit';
    return [`Resolve ${unitName}'s triggered Surge Move before leaving the phase.`];
  }
  if (state.phase === 'command') {
    const options = punishmentCondemnedUnitOptions(state, state.activeArmy, rulesEditionForRuleset(state.ruleset));
    const selected = state.missionState?.condemnedUnitIds?.[state.activeArmy] ?? [];
    return options.length > 0 && selected.length === 0
      ? ['Select at least one enemy unit to condemn before leaving the Command phase.']
      : [];
  }
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
    const canInfiltrate = profileDropHasInfiltrators(s, unit.side, unit.profile);
    if (!canInfiltrate && !pointInDeploymentZone(position, zone, radius)) return s;
    if (canInfiltrate && !modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, position, modelIndex, deployment, board)) return s;
    if (canInfiltrate && !infiltratorModelsAreOutsideEnemyUnits(s, unit.side, unit.profile, [position], [modelIndex])) return s;
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
      if (terrainMatBlocksMovementForUnit(terrain, movingUnit)
        && baseFootprintIntersectsRect(model, footprint, terrain)) return false;
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
    && !inEngagement(movingUnit, enemies(state, movingUnit.side), rulesEditionForRuleset(state.ruleset).engagementRange());
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
  if (unitTakesToSkiesForState(state, movingUnit)) return false;

  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    const movingRadius = modelBaseRadius(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId) continue;
      if (otherUnit.id === movingUnit.id || (!includeFriendly && otherUnit.side === movingUnit.side)) continue;
      if (unitHasRule(movingUnit.profile, 'Super-heavy Walker') && !hasKeyword(otherUnit, 'titanic')) continue;
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
  if (unitTakesToSkiesForState(state, movingUnit)) return false;

  for (const modelIndex of movingIndices) {
    const from = movingUnit.modelPositions[modelIndex];
    const to = { x: from.x + dx, y: from.y + dy };
    for (const terrain of state.terrain) {
      if (terrainMatBlocksMovementForUnit(terrain, movingUnit)
        && !pointInTerrain(from, terrain)
        && (pointInTerrain(to, terrain) || linePassesThroughTerrain(from, to, terrain))) return true;
      for (const feature of terrain.features) {
        if (featureBlocksMovementForUnit(feature, terrain, movingUnit)
          && !pointInTerrain(from, feature)
          && (pointInTerrain(to, feature) || linePassesThroughTerrain(from, to, feature))) return true;
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
  return inEngagement(testUnit, enemies(test, testUnit.side), rulesEditionForRuleset(test.ruleset).engagementRange());
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
  recordUnitLeftBattlefieldMissionEvent(state, unit.id);
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
  if (unitTakesToSkiesForState(state, unit)) return false;
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
  if (unitTakesToSkiesForState(state, unit)) return false;
  const starts = unit.movementStartPositionsByModel;
  if (!starts?.length) return false;
  return movedModelDeltasFromStart(unit).some(({ modelIndex }) => {
    const from = starts[modelIndex] ?? unit.modelPositions[modelIndex];
    const to = unit.modelPositions[modelIndex];
    return state.terrain.some(terrain =>
      (terrainMatBlocksMovementForUnit(terrain, unit) && lineIntersectsTerrain(from, to, terrain))
      || terrain.features.some(feature =>
        featureBlocksMovementForUnit(feature, terrain, unit) && lineIntersectsTerrain(from, to, feature),
      ),
    );
  });
}

function monsterVehicleMovedOverFriendlyMonsterVehicle(state: BattleState, unit: BattleUnit): boolean {
  if (!hasAnyKeyword(unit, ['monster', 'vehicle']) || unitTakesToSkiesForState(state, unit)) return false;
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
    && inEngagement(unit, enemies(state, unit.side), rulesEditionForRuleset(state.ruleset).engagementRange())
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
  return Math.max(0, normalMoveAllowance(unit) - takeToSkiesDistanceCost(unit));
}

export function playFiringDeckCapacity(unit: BattleUnit): number {
  for (const rule of [...unit.profile.abilities, ...(unit.profile.rules ?? [])]) {
    const match = `${rule.name} ${rule.description}`.match(/Firing\s+Deck\s+(\d+)/i);
    if (match) return Number.parseInt(match[1], 10);
  }
  return 0;
}

export interface FiringDeckSelection {
  passengerRosterId: string;
  passengerName?: string;
  modelIndex: number;
  weaponIndex: number;
  weaponName?: string;
}

function firingDeckPassengerProfiles(state: BattleState, transport: BattleUnit): UnitProfile[] {
  const staged = state.armies[transport.side].army.units.filter(profile => unitAssignedToTransport(profile, transport));
  const live = embarkedUnitsForTransport(state, transport.id).map(unit => unit.profile);
  const seen = new Set<string>();
  return [...live, ...staged].filter(profile => {
    const id = unitRosterId(profile);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function playFiringDeckOptions(state: BattleState, transportUnitId: string, side: Side): FiringDeckSelection[] {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return [];
  const transport = state.units.find(unit => unit.id === transportUnitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!transport || transport.activated || playFiringDeckCapacity(transport) <= 0 || !unitHasKeyword(transport, 'Transport')) return [];
  return firingDeckPassengerProfiles(state, transport).flatMap(profile =>
    Array.from({ length: profile.baseModelCount }, (_, modelIndex) =>
      modelWeaponLoadout(profile, modelIndex).flatMap(weaponIndex => {
        const weapon = profile.weapons[weaponIndex];
        return weapon && !weapon.isMelee && !weaponHasKeyword(weapon, 'One Shot')
          ? [{ passengerRosterId: unitRosterId(profile), passengerName: profile.name, modelIndex, weaponIndex, weaponName: weapon.name }]
          : [];
      }),
    ).flat(),
  );
}

export function selectPlayFiringDeckWeapons(
  state: BattleState,
  transportUnitId: string,
  side: Side,
  selections: FiringDeckSelection[],
): BattleState {
  const options = playFiringDeckOptions(state, transportUnitId, side);
  const transport = state.units.find(unit => unit.id === transportUnitId && unit.side === side && !unit.destroyed);
  if (!transport || transport.firingDeckTurn === state.turn) return state;
  const capacity = playFiringDeckCapacity(transport);
  const modelKeys = selections.map(selection => `${selection.passengerRosterId}:${selection.modelIndex}`);
  if (
    selections.length > capacity
    || new Set(modelKeys).size !== selections.length
    || selections.some(selection => !options.some(option =>
      option.passengerRosterId === selection.passengerRosterId
      && option.modelIndex === selection.modelIndex
      && option.weaponIndex === selection.weaponIndex
    ))
  ) return state;

  const s = clone(state);
  applyFiringDeckSelectionsInPlace(s, transportUnitId, side, selections);
  return s;
}

function applyFiringDeckSelectionsInPlace(
  state: BattleState,
  transportUnitId: string,
  side: Side,
  selections: FiringDeckSelection[],
): void {
  const selectedTransport = state.units.find(unit => unit.id === transportUnitId && unit.side === side && !unit.destroyed)!;
  const passengerProfiles = firingDeckPassengerProfiles(state, selectedTransport);
  const baseWeaponCount = selectedTransport.profile.weapons.length;
  const existingLoadouts = selectedTransport.modelPositions.map((_, modelIndex) =>
    [...modelWeaponLoadout(selectedTransport.profile, selectedTransport.modelRosterIndexes?.[modelIndex] ?? modelIndex)],
  );
  const grantedIndices: number[] = [];
  for (const selection of selections) {
    const passenger = passengerProfiles.find(profile => unitRosterId(profile) === selection.passengerRosterId)!;
    const sourceWeapon = passenger.weapons[selection.weaponIndex];
    const grantedIndex = selectedTransport.profile.weapons.length;
    selectedTransport.profile.weapons.push({
      ...sourceWeapon,
      name: `${sourceWeapon.name} (Firing Deck: ${passenger.name})`,
      firingDeckSource: {
        passengerRosterId: selection.passengerRosterId,
        passengerName: passenger.name,
        modelIndex: selection.modelIndex,
        weaponIndex: selection.weaponIndex,
      },
    });
    existingLoadouts[0] = [...(existingLoadouts[0] ?? []), grantedIndex];
    grantedIndices.push(grantedIndex);
  }
  selectedTransport.profile.modelWeaponLoadouts = existingLoadouts;
  selectedTransport.firingDeckBaseWeaponCount = baseWeaponCount;
  selectedTransport.firingDeckGrantedWeaponIndices = grantedIndices;
  selectedTransport.firingDeckTurn = state.turn;
  const selectedPassengerIds = new Set(selections.map(selection => selection.passengerRosterId));
  const lockedIds = state.units
    .filter(unit => unit.embarkedInUnitId === selectedTransport.id && selectedPassengerIds.has(unitRosterId(unit.profile)))
    .map(unit => unit.id);
  state.firingDeckLockedUnitIds = [...new Set([...(state.firingDeckLockedUnitIds ?? []), ...lockedIds])];
  state.log = [...state.log, log(state, side, selectedTransport.profile.name,
    selections.length
      ? `${selectedTransport.profile.name} selects ${selections.length} embarked model${selections.length === 1 ? '' : 's'} for Firing Deck.`
      : `${selectedTransport.profile.name} selects no embarked models for Firing Deck.`,
    'shoot',
  )];
}

function autoSelectFiringDeckInPlace(state: BattleState, transport: BattleUnit): void {
  if (transport.firingDeckTurn === state.turn) return;
  const capacity = playFiringDeckCapacity(transport);
  if (capacity <= 0) return;
  const usedModels = new Set<string>();
  const selections = playFiringDeckOptions(state, transport.id, transport.side).filter(option => {
    const key = `${option.passengerRosterId}:${option.modelIndex}`;
    if (usedModels.has(key) || usedModels.size >= capacity) return false;
    usedModels.add(key);
    return true;
  });
  applyFiringDeckSelectionsInPlace(state, transport.id, transport.side, selections);
}

function clearFiringDeckWeapons(unit: BattleUnit): void {
  if (unit.firingDeckBaseWeaponCount === undefined) return;
  unit.profile.weapons = unit.profile.weapons.slice(0, unit.firingDeckBaseWeaponCount);
  unit.profile.modelWeaponLoadouts = unit.profile.modelWeaponLoadouts?.map(loadout =>
    loadout.filter(weaponIndex => weaponIndex < unit.firingDeckBaseWeaponCount!),
  );
  unit.firingDeckBaseWeaponCount = undefined;
  unit.firingDeckGrantedWeaponIndices = undefined;
}

function unitHasStartedCurrentMove(unit: BattleUnit): boolean {
  return !!unit.movementStartPositionsByModel?.some((start, modelIndex) => {
    const current = unit.modelPositions[modelIndex];
    return current && (dist(start, current) > 0.001 || verticalDistance(start, current) > 0.001);
  });
}

export function playUnitCanTakeToSkies(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  if (rules.metadata.edition !== '11e') return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit
    || unit.inStrategicReserves
    || isAircraft(unit)
    || attachedUnitComponents(state, unit).some(component => component.takingToSkies || unitSurgedThisPhase(state, component))) return false;
  if (!attachedUnitKeywordSet(state, unit).has('fly')) return false;
  if (state.phase === 'movement') {
    return state.activeArmy === side
      && movementStep(state) === 'moveUnits'
      && attachedUnitComponents(state, unit).every(component => !component.movementComplete && !unitHasStartedCurrentMove(component));
  }
  return state.phase === 'charge'
    && sideCanDeclareCharge(state, side, unit)
    && unitCanDeclareCharge(unit)
    && attachedUnitComponents(state, unit).every(component => !component.activated && !component.charged);
}

export function declarePlayUnitTakeToSkies(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (!playUnitCanTakeToSkies(state, unitId, side, rules)) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of attachedUnitComponents(s, unit)) {
    component.takingToSkies = true;
    if (component.movementAllowanceTotalByModel?.length) {
      component.movementAllowanceTotalByModel = component.movementAllowanceTotalByModel.map(total => Math.max(0, total - 2));
      updateModelMovementAllowances(component);
    }
  }
  s.log = [...s.log, log(s, side, unit.profile.name, unitHasRule(unit.profile, 'Hover')
    ? `${unit.profile.name} declares Take to the Skies; Hover prevents the -2" maximum-distance cost.`
    : `${unit.profile.name} declares Take to the Skies (-2" maximum distance).`, 'move')];
  return s;
}

function scoutsValue(profile: UnitProfile): number | null {
  const texts = [
    ...(profile.abilities ?? []).flatMap(rule => [rule.name, rule.description]),
    ...(profile.rules ?? []).flatMap(rule => [rule.name, rule.description]),
  ];
  for (const text of texts) {
    const match = text.match(/\bScouts?\s+(\d+)\s*["”]?/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function playScoutMoveAllowance(state: BattleState, unitId: string, side: Side): number | null {
  if (state.ruleset.edition !== '11e' || state.phase !== 'setup' || state.preBattleAbilitiesResolved) return null;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.inStrategicReserves || unit.scoutMoved || unit.scoutMoveStarted) return null;
  const components = attachedUnitComponents(state, unit);
  const values = components.map(component => scoutsValue(component.profile));
  if (values.some(value => value === null)) return null;
  const board = boardFormatForState(state);
  const zone = zoneFor(side, setupDeploymentZoneSource(state.setup), board);
  if (components.some(component => component.modelPositions.some((position, modelIndex) =>
    !pointInDeploymentZone(position, zone, modelBaseRadius(component, modelIndex)),
  ))) return null;
  return Math.min(...values as number[]);
}

export function startPlayScoutMove(state: BattleState, unitId: string, side: Side): BattleState {
  const allowance = playScoutMoveAllowance(state, unitId, side);
  if (allowance === null) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of attachedUnitComponents(s, unit)) {
    component.scoutMoveStarted = true;
    component.scoutMoveAllowance = allowance;
    component.movementStartPositionsByModel = component.modelPositions.map(position => ({ ...position }));
    component.movementStartRotationsByModel = component.modelPositions.map((_, modelIndex) => modelRotation(component, modelIndex));
    component.movementAllowanceTotalByModel = component.modelPositions.map(() => allowance);
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => allowance);
    component.movementAllowanceRemaining = allowance;
  }
  s.log = [...s.log, log(s, side, unit.profile.name, `${unit.profile.name} begins a Scouts ${allowance}" Normal move.`, 'move')];
  return s;
}

export function completePlayScoutMove(state: BattleState, unitId: string, side: Side): BattleState {
  if (state.phase !== 'setup' || state.preBattleAbilitiesResolved) return state;
  const existing = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!existing || !existing.scoutMoveStarted) return state;
  const components = attachedUnitComponents(state, existing);
  const enemyUnits = state.units.filter(candidate => candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId && !candidate.inStrategicReserves);
  const tooClose = components.some(component => component.modelPositions.some((position, modelIndex) =>
    enemyUnits.some(enemy => enemy.modelPositions.some((enemyPosition, enemyModelIndex) =>
      baseFootprintDistance(position, modelFootprint(component, modelIndex), enemyPosition, modelFootprint(enemy, enemyModelIndex)) <= 8,
    )),
  ));
  if (tooClose || components.some(component => {
    const moving = new Set(component.modelPositions.map((_, index) => index));
    return !playMoveHasNoBaseOverlap(state, component, moving) || !playMoveHasNoWallOverlap(state, component, moving);
  })) return state;
  for (const list of coherencyModelLists(state)) {
    if (list.models.some(model => components.some(component => component.id === model.unit.id)) && !modelListIsCoherent(list.models, coherencyEditionForState(state))) return state;
  }
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of attachedUnitComponents(s, unit)) {
    component.scoutMoveStarted = undefined;
    component.scoutMoveAllowance = undefined;
    component.scoutMoved = true;
    component.movementAllowanceRemaining = undefined;
    component.movementAllowanceRemainingByModel = undefined;
    component.movementAllowanceTotalByModel = undefined;
    component.movementStartPositionsByModel = undefined;
    component.movementStartRotationsByModel = undefined;
  }
  s.log = [...s.log, log(s, side, unit.profile.name, `${unit.profile.name} completes its Scouts move.`, 'move')];
  return s;
}

export function playSurgeTargetUnitIds(
  state: BattleState,
  unitId: string,
  side: Side,
): string[] {
  const pending = state.pendingSurgeMove;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!pending || pending.unitId !== unitId || pending.side !== side || !unit) return [];
  const candidates = enemies(state, side).filter(candidate =>
    !candidate.destroyed
    && !candidate.embarkedInUnitId
    && (!isAircraft(candidate) || attachedUnitKeywordSet(state, unit).has('fly'))
  );
  if (!candidates.length) return [];
  const distances = candidates.map(candidate => ({ candidate, distance: battleUnitToAttachedUnitDistance(state, unit, candidate) }));
  const closest = Math.min(...distances.map(entry => entry.distance));
  return distances.filter(entry => entry.distance <= closest + 0.001).map(entry => entry.candidate.id);
}

export function grantPlaySurgeMove(
  state: BattleState,
  unitId: string,
  side: Side,
  maximumDistance: number,
  source: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (rules.metadata.edition !== '11e'
    || state.pendingSurgeMove
    || !Number.isFinite(maximumDistance)
    || maximumDistance <= 0
    || !source.trim()) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  const components = attachedUnitComponents(state, unit);
  if (components.some(component =>
    component.battleshocked
    || unitMovedThisPhase(state, component)
    || unitHasStartedCurrentMove(component)
  )) return state;
  if (components.some(component => inEngagement(component, enemies(state, side), rules.engagementRange()))) return state;
  const s = clone(state);
  s.pendingSurgeMove = { unitId, side, maximumDistance, source: source.trim(), triggeredPhase: state.phase };
  s.log = [...s.log, log(s, side, unit.profile.name,
    `${source.trim()} triggers a Surge Move of up to ${maximumDistance}" for ${unit.profile.name}.`, 'move')];
  return s;
}

export function resolvePlaySurgeMove(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  const pending = state.pendingSurgeMove;
  if (rules.metadata.edition !== '11e'
    || !pending
    || pending.unitId !== unitId
    || pending.side !== side
    || pending.triggeredPhase !== state.phase
    || !playSurgeTargetUnitIds(state, unitId, side).includes(targetUnitId)) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target) return state;

  const components = attachedUnitComponents(s, unit);
  for (const component of components) {
    const distance = dist(component.position, target.position);
    const direction = distance > 0.001
      ? { x: (target.position.x - component.position.x) / distance, y: (target.position.y - component.position.y) / distance }
      : { x: 1, y: 0 };
    const myExtent = formationExtent(component.modelPositions, component.position, direction);
    const targetExtent = formationExtent(target.modelPositions, target.position, { x: -direction.x, y: -direction.y });
    const stopGap = rules.engagementRange() + myExtent + targetExtent + 0.02;
    const reachable = findReachablePosition(component, target.position, pending.maximumDistance, s.terrain, stopGap);
    const candidate = avoidModelOverlap(component, reachable, s);
    translateFormation(component, candidate.x - component.position.x, candidate.y - component.position.y);
    resolveInternalModelOverlaps(component);
    component.position = centroid(component.modelPositions);
  }
  if (components.some(component => unitHasBaseOverlap(s, component) || unitHasWallOverlap(s, component))) return state;
  const otherEnemies = enemies(s, side).filter(enemy => attachedUnitId(enemy) !== attachedUnitId(target));
  if (components.some(component => inEngagement(component, otherEnemies, rules.engagementRange()))) return state;
  if (battleCoherencyIssues(s, side).length) return state;

  for (const component of components) {
    cancelUnitAction(s, component, 'it made a Surge Move');
    component.lastMovePhase = s.phase;
    component.lastMoveTurn = s.turn;
    component.surgeMovePhase = s.phase;
    component.surgeMoveTurn = s.turn;
    component.movementComplete = s.phase === 'movement' ? true : component.movementComplete;
    component.inCombat = inEngagement(component, [target], rules.engagementRange());
  }
  target.inCombat = inEngagement(target, components, rules.engagementRange());
  s.pendingSurgeMove = undefined;
  s.log = [...s.log, log(s, side, unit.profile.name,
    `${unit.profile.name} makes a Surge Move toward ${target.profile.name}.`, 'move')];
  return s;
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
  return horizontal + (unit.takingToSkies && hasKeyword(unit, 'fly') ? 0 : verticalDistance(start, position));
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
      removeOpponentOperationMarkersAfterMove(state, unit);
    }
  }
}

function markPlayMovementGroupComplete(state: BattleState, currentUnit: BattleUnit): void {
  const currentGroupId = playMovementGroupId(currentUnit);
  for (const unit of state.units) {
    if (unit.side === currentUnit.side && !unit.destroyed && playMovementGroupId(unit) === currentGroupId) {
      unit.movementComplete = true;
      unit.lastMovePhase = state.phase;
      unit.lastMoveTurn = state.turn;
      unit.takingToSkies = undefined;
      removeOpponentOperationMarkersAfterMove(state, unit);
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
  if (state.phase === 'setup' && !existingUnit.scoutMoveStarted) return state;
  if (state.phase === 'movement') {
    if (state.activeArmy !== side) return state;
    if (
      existingUnit.movementComplete
      || unitSurgedThisPhase(state, existingUnit)
      || existingUnit.fellBack
      || existingUnit.movementAction === 'fellBack'
      || existingUnit.movementAction === 'remainedStationary'
    ) return state;
    if (!isAircraft(existingUnit) && nonAircraftEngagedEnemies(state, existingUnit, rulesEditionForRuleset(state.ruleset)).length > 0) return state;
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

  const budgetMove = (s.phase === 'movement' || s.phase === 'setup') && !isAircraft(unit)
    ? budgetAdjustedPlayMove(unit, uniqueIndices, dx, dy)
    : { dx, dy };
  if (Math.hypot(budgetMove.dx, budgetMove.dy) < 0.001) return state;
  if (
    (s.phase === 'movement' || s.phase === 'setup')
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
  if ((s.phase === 'movement' || s.phase === 'setup') && inEngagement(unit, enemies(s, side), rulesEditionForRuleset(s.ruleset).engagementRange())) return state;

  if (s.phase === 'movement') {
    lockOtherMovedPlayUnits(s, unit);
    unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
    updateModelMovementAllowances(unit);
  }
  if (s.phase === 'setup') updateModelMovementAllowances(unit);
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
  const scoutMove = state.phase === 'setup';
  if (!scoutMove && (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side)) return state;

  const existingUnit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!existingUnit) return state;
  if (scoutMove && !existingUnit.scoutMoveStarted) return state;
  if (
    existingUnit.inStrategicReserves
    || existingUnit.movementComplete
    || existingUnit.fellBack
    || existingUnit.movementAction === 'fellBack'
    || existingUnit.movementAction === 'remainedStationary'
    || isAircraft(existingUnit)
    || nonAircraftEngagedEnemies(state, existingUnit, rulesEditionForRuleset(state.ruleset)).length > 0
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
  if (inEngagement(unit, enemies(s, side), rulesEditionForRuleset(s.ruleset).engagementRange())) return state;

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

  recordDestroyedModelMissionEvents(s, unit, uniqueIndices, side);
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

  queueDeadlyDemiseForModels(s, unit, uniqueIndices, state.activeArmy);
  recordDestroyedModelMissionEvents(s, unit, uniqueIndices, state.activeArmy);
  spliceModelIndices(unit, uniqueIndices);

  unit.remainingModels = Math.max(0, unit.remainingModels - uniqueIndices.length);
  unit.pendingCasualties = Math.max(0, (unit.pendingCasualties ?? 0) - uniqueIndices.length);
  if (unit.pendingCasualties <= 0) unit.pendingCasualties = undefined;
  if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
    markUnitDestroyed(unit);
    unit.remainingModels = 0;
    unit.woundsOnLeadModel = 0;
    unit.woundedModelIndex = undefined;
    unit.pendingWoundAssignment = undefined;
    unit.modelPositions = [];
    unit.modelRotations = [];
    recordDestroyedUnitMissionEvent(s, unit, state.activeArmy);
    s.log = [...s.log, ...emergencyDisembarkDestroyedTransport(s, unit, state.activeArmy)];
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
  if (s.pendingDeadlyDemises?.length) s.log = [...s.log, ...resolvePendingDeadlyDemisesInPlace(s)];
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
  if (allocation.targetModelIndex !== undefined && allocation.targetModelIndex !== modelIndex) return state;
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
    const destroyedBySide = s.units.find(candidate => candidate.id === damage.sourceUnitId)?.side ?? state.activeArmy;
    queueDeadlyDemiseForModels(s, unit, [modelIndex], destroyedBySide);
    recordDestroyedModelMissionEvents(s, unit, [modelIndex], destroyedBySide, {
      destroyedByUnitId: damage.sourceUnitId,
      sourceTags: damage.sourceTags,
    });
    spliceModelIndices(unit, [modelIndex]);
    unit.remainingModels = Math.max(0, unit.remainingModels - 1);
    unit.woundedModelIndex = undefined;
    unit.woundsOnLeadModel = unit.remainingModels > 0 ? unit.profile.wounds : 0;
    if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
      markUnitDestroyed(unit);
      unit.remainingModels = 0;
      unit.modelPositions = [];
      unit.modelRotations = [];
      unit.pendingDamageAllocations = undefined;
      recordDestroyedUnitMissionEvent(s, unit, destroyedBySide, {
        destroyedByUnitId: damage.sourceUnitId,
        destroyingUnitObjectiveIndexesWithinRange: damage.sourceObjectiveIndexesWithinRange,
        sourceTags: damage.sourceTags,
      });
      s.log = [...s.log, ...emergencyDisembarkDestroyedTransport(s, unit, destroyedBySide)];
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
  if (s.pendingDeadlyDemises?.length) s.log = [...s.log, ...resolvePendingDeadlyDemisesInPlace(s)];
  return s;
}

export function playUnitCanFallBack(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  return !!unit && !unit.inStrategicReserves && !isAircraft(unit) && !unit.movementComplete && !unit.movementAction && nonAircraftEngagedEnemies(state, unit, rules).length > 0;
}

export function playUnitCanAdvance(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
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

export function declarePlaySuperHeavyMobile(state: BattleState, unitId: string, side: Side): BattleState {
  if (state.ruleset.edition !== '11e' || state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || existing.inStrategicReserves || existing.movementComplete || unitHasStartedCurrentMove(existing)
    || attachedUnitComponents(state, existing).some(component => component.superHeavyMobile)
    || !attachedUnitComponents(state, existing).every(component => unitHasRule(component.profile, 'Super-heavy Walker'))) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of attachedUnitComponents(s, unit)) component.superHeavyMobile = true;
  s.log = [...s.log, log(s, side, unit.profile.name, `${unit.profile.name} declares MOBILE for this move.`, 'move')];
  return s;
}

function resolveSuperHeavyMobileInPlace(state: BattleState, unit: BattleUnit): void {
  const components = attachedUnitComponents(state, unit);
  if (!components.some(component => component.superHeavyMobile)) return;
  const roll = d6();
  if (roll === 1) components.forEach(component => { component.battleshocked = true; });
  components.forEach(component => { component.superHeavyMobile = undefined; });
  state.log = [...state.log, log(state, unit.side, unit.profile.name,
    `${unit.profile.name} resolves MOBILE: rolled ${roll}${roll === 1 ? ' and is Battle-shocked.' : '.'}`, roll === 1 ? 'damage' : 'move')];
}

export function advancePlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (!playUnitCanAdvance(state, unitId, side, rules)) return state;

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  if (!unit) return state;
  lockOtherMovedPlayUnits(s, unit);
  cancelUnitAction(s, unit, 'it made an Advance move');

  const advance = advanceAllowance(unit, rules);
  for (const component of attachedUnitComponents(s, unit)) {
    const total = Math.max(0,
      normalMoveAllowance(component)
      + advance.advanceRoll
      + (component.profile.movementOverrides?.advanceModifier ?? 0)
      - takeToSkiesDistanceCost(component));
    component.movementAction = 'advanced';
    component.movementAllowanceRemaining = total;
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => total);
    component.movementAllowanceTotalByModel = component.modelPositions.map(() => total);
    component.movementStartPositionsByModel = component.modelPositions.map(position => ({ ...position }));
    component.movementStartRotationsByModel = component.modelPositions.map((_, modelIndex) => modelRotation(component, modelIndex));
    component.movementComplete = total <= 0.001;
    component.fellBack = false;
  }
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
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
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
  const maximumDistance = Math.max(0, unit.profile.move - takeToSkiesDistanceCost(unit));
  const requestedDx = direction.x * maximumDistance;
  const requestedDy = direction.y * maximumDistance;
  const move = collisionAdjustedPlayMove(s, unitId, side, modelIndices, requestedDx, requestedDy, { ignoreEnemyModelPath: true });
  if (Math.hypot(move.dx, move.dy) < 0.01) return state;
  const wasBattleshocked = unit.battleshocked;
  const desperateEscapeModelIndices = unit.battleshocked
    ? undefined
    : playMoveEnemyCrossingModelIndices(s, unit, new Set(modelIndices), move.dx, move.dy);
  const usesDesperateEscape = wasBattleshocked || (desperateEscapeModelIndices?.length ?? 0) > 0;

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
  for (const component of attachedUnitComponents(s, unit)) {
    component.lastMovePhase = s.phase;
    component.lastMoveTurn = s.turn;
    component.takingToSkies = undefined;
  }
  removeOpponentOperationMarkersAfterMove(s, unit);
  for (const enemy of engaged) {
    enemy.inCombat = inEngagement(enemy, enemies(s, enemy.side), rules.engagementRange());
  }

  const moved = Math.hypot(move.dx, move.dy);
  const destroyedBySide = (side === 0 ? 1 : 0) as Side;
  const desperateEscapeLogs = resolveDesperateEscapeTests(
    s,
    unit,
    (testedUnit, message) => log(s, testedUnit.side, testedUnit.profile.name, message, 'roll'),
    desperateEscapeModelIndices,
    (testedUnit, modelIndices) => recordDestroyedModelMissionEvents(s, testedUnit, modelIndices, destroyedBySide),
  );
  const postMoveBattleshockLogs: LogEntry[] = [];
  if (rules.metadata.edition === '11e' && usesDesperateEscape && !wasBattleshocked && !unit.destroyed) {
    const rolls = [d6(), d6()];
    const roll = rolls[0] + rolls[1];
    const needed = bestLeadership(s, unit);
    const passed = roll >= needed;
    for (const component of attachedUnitComponents(s, unit)) component.battleshocked = !passed;
    postMoveBattleshockLogs.push(log(
      s,
      unit.side,
      unit.profile.name,
      `${unit.profile.name} makes a Desperate Escape Battle-shock roll (${needed}+): rolled ${rolls[0]}+${rolls[1]}=${roll} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
      'info',
    ));
  }
  resolveSuperHeavyMobileInPlace(s, unit);
  if (unit.destroyed) recordDestroyedUnitMissionEvent(s, unit, destroyedBySide);
  const newLogs: LogEntry[] = [
    log(s, side, unit.profile.name, `${unit.profile.name} Falls Back ${moved.toFixed(1)}".`, 'move'),
    ...desperateEscapeLogs,
    ...postMoveBattleshockLogs,
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
  resolveSuperHeavyMobileInPlace(s, unit);
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
    if (!modelListIsCoherent(list.models, coherencyEditionForState(state))) {
      issues.push(`${list.label} (${list.models.length} models) is out of coherency.`);
    }
  }

  for (const unit of state.units) {
    if (unit.destroyed) continue;
    if (unitHasBaseOverlap(state, unit)) issues.push(`${unit.profile.name} has overlapping bases.`);

    const board = boardFormatForState(state);
    const deployment = setupDeploymentZoneSource(state.setup);
    const zone = zoneFor(unit.side, deployment, board);
    if (profileDropHasInfiltrators(state, unit.side, unit.profile)) {
      const tooCloseToEnemyZone = unit.modelPositions.some((model, modelIndex) =>
        !modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, model, modelIndex, deployment, board),
      );
      const tooCloseToEnemyUnit = !infiltratorModelsAreOutsideEnemyUnits(state, unit.side, unit.profile, unit.modelPositions);
      if (tooCloseToEnemyZone || tooCloseToEnemyUnit) issues.push(`${unit.profile.name} is within 8" of the enemy deployment zone or an enemy unit.`);
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
  let s = clone(state);
  if (s.phase !== 'movement' || movementStep(s) === 'reinforcements') {
    updateObjectiveControl(s, rules);
  }
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
    runAutomaticUnitAbilities(s, side, 'end-of-phase', rules);
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
      newLogs.push(...runShootingPhaseUnits(s, side, rules));
    }
  } else if (s.phase === 'shooting') {
    s.movementStep = undefined;
    s.phase = 'charge';
    newLogs.push(phaseLog(s, side, armyName, `\n--- Charge Phase ---`));
    activeUnits(s, side).filter(u => !u.inCombat).forEach(u => newLogs.push(...runCharge(u, s, rules)));
  } else if (s.phase === 'charge') {
    s.phase = 'fight';
    s.fightStepStarted = false;
    s.engagedUnitIdsAtFightStepStart = undefined;
    s.lastFightSelectionSide = undefined;
    s.activeAttachedFightUnitId = undefined;
    s.activeAttachedShootingUnitId = undefined;
    s.attachedShootingTargetUnitId = undefined;
    newLogs.push(phaseLog(s, side, armyName, `\n--- Fight Phase ---`));
    if (rules.metadata.edition === '11e') {
      s = runAutomaticEleventhFightPhase(s, side, rules);
    } else {
      activeUnits(s, side).filter(u => u.charged).forEach(u => newLogs.push(...runFight(u, s, rules)));
      activeUnits(s, side).filter(u => !u.charged && u.inCombat).forEach(u => newLogs.push(...runFight(u, s, rules)));
      s.units.filter(u => u.side !== side && !u.destroyed && u.inCombat)
        .forEach(u => newLogs.push(...runFight(u, s, rules)));
    }
  } else if (s.phase === 'fight') {
    for (const unit of activeUnits(s, side)) {
      const objectiveIndex = consecrateObjectiveOptions(s, unit.id, side, rules, true)[0];
      if (objectiveIndex !== undefined) s = consecrateObjective(s, unit.id, side, objectiveIndex, rules, true);
    }
    completeEndOfTurnActions(s, side);
    newLogs.push(...scoreEndOfTurnSecondaryMissionLogs(s, side, rules));
    newLogs.push(...scoreEndOfTurnPrimaryMissionLogs(s, side, rules));
    advanceTurnInPlace(s);
    if ((s.phase as Phase) === 'end') newLogs.push(...scoreEndOfBattlePrimaryMissionLogs(s, rules));
  }

  checkWinner(s);
  s.log = [...s.log, ...newLogs];
  return s;
}

function resetSimulationUnitActivations(state: BattleState, side: Side): void {
  activeUnits(state, side).forEach(unit => {
    unit.activated = false;
  });
}

function simulationFightUnitId(state: BattleState, rules: RulesEdition): string | undefined {
  const preferredSides: Side[] = rules.metadata.edition === '11e'
    ? [state.activeArmy, state.activeArmy === 0 ? 1 : 0]
    : [state.activeArmy, state.activeArmy === 0 ? 1 : 0];
  for (const side of preferredSides) {
    const id = playFightActivationUnitIds(state, side, rules)[0];
    if (id) return id;
  }
  return undefined;
}

export function simulationNextUnitId(state: BattleState, rules: RulesEdition): string | undefined {
  if (state.winner !== null || state.phase === 'deployment' || state.phase === 'end') return undefined;
  if (state.phase === 'movement' && movementStep(state) === 'reinforcements') return undefined;
  if (state.phase === 'fight') return simulationFightUnitId(state, rules);
  if (!['movement', 'shooting', 'charge'].includes(state.phase)) return undefined;
  return activeUnits(state, state.activeArmy).find(unit => !unit.activated)?.id;
}

function advanceSimulationUnitPhase(state: BattleState, rules: RulesEdition): void {
  const side = state.activeArmy;
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];

  if (state.phase === 'setup') {
    logs.push(...startCommandPhase(state, rules));
  } else if (state.phase === 'command') {
    runAutomaticUnitAbilities(state, side, 'end-of-phase', rules);
    state.phase = 'movement';
    state.movementStep = MOVEMENT_STEP.MoveUnits;
    resetSimulationUnitActivations(state, side);
    logs.push(phaseLog(state, side, armyName, '\n--- Movement Phase ---'));
  } else if (state.phase === 'movement' && movementStep(state) === MOVEMENT_STEP.MoveUnits) {
    markRemainingStationaryUnits(state, side);
    state.movementStep = MOVEMENT_STEP.Reinforcements;
    logs.push(phaseLog(state, side, armyName, '\n--- Reinforcements Step ---'));
  } else if (state.phase === 'movement') {
    state.phase = 'shooting';
    state.movementStep = undefined;
    resetSimulationUnitActivations(state, side);
    logs.push(phaseLog(state, side, armyName, '\n--- Shooting Phase ---'));
  } else if (state.phase === 'shooting') {
    state.phase = 'charge';
    resetSimulationUnitActivations(state, side);
    logs.push(phaseLog(state, side, armyName, '\n--- Charge Phase ---'));
  } else if (state.phase === 'charge') {
    state.phase = 'fight';
    resetSimulationUnitActivations(state, side);
    state.fightStepStarted = false;
    state.engagedUnitIdsAtFightStepStart = undefined;
    state.lastFightSelectionSide = undefined;
    state.activeAttachedFightUnitId = undefined;
    state.activeAttachedShootingUnitId = undefined;
    state.attachedShootingTargetUnitId = undefined;
    logs.push(phaseLog(state, side, armyName, '\n--- Fight Phase ---'));
    if (rules.metadata.edition === '11e') startFightStepInPlace(state, rules);
  } else if (state.phase === 'fight') {
    for (const unit of activeUnits(state, side)) {
      const objectiveIndex = consecrateObjectiveOptions(state, unit.id, side, rules, true)[0];
      if (objectiveIndex !== undefined) {
        const next = consecrateObjective(state, unit.id, side, objectiveIndex, rules, true);
        state.log = next.log;
      }
    }
    completeEndOfTurnActions(state, side);
    logs.push(...scoreEndOfTurnSecondaryMissionLogs(state, side, rules));
    logs.push(...scoreEndOfTurnPrimaryMissionLogs(state, side, rules));
    advanceTurnInPlace(state);
    if ((state.phase as Phase) === 'end') logs.push(...scoreEndOfBattlePrimaryMissionLogs(state, rules));
  }

  state.log = [...state.log, ...logs];
}

export function simulateNextUnit(state: BattleState, rules: RulesEdition): BattleState {
  const s = clone(state);
  if (s.winner !== null || s.phase === 'deployment' || s.phase === 'end') return s;

  const unitId = simulationNextUnitId(s, rules);
  if (unitId) {
    const unit = s.units.find(candidate => candidate.id === unitId);
    if (!unit) return s;
    if (s.phase === 'movement') {
      s.log = [...s.log, ...runMovement(unit, s, rules)];
    } else if (s.phase === 'shooting') {
      s.log = [...s.log, ...runShooting(unit, s, rules)];
    } else if (s.phase === 'charge') {
      s.log = [...s.log, ...runCharge(unit, s, rules)];
    } else if (s.phase === 'fight') {
      if (rules.metadata.edition === '11e') {
        const afterFight = runAutomaticFightForUnit(s, unit.id, rules);
        if (afterFight !== s) return afterFight;
      } else {
        s.log = [...s.log, ...runFight(unit, s, rules)];
      }
    }
    const current = s.units.find(candidate => candidate.id === unitId);
    if (current && !current.activated) current.activated = true;
    checkWinner(s);
    return s;
  }

  advanceSimulationUnitPhase(s, rules);

  checkWinner(s);
  return s;
}

function runSimulatedCommandPhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];
  state.phase = 'command';
  state.movementStep = undefined;
  autoSelectPunishmentCondemnedUnits(state, side, rules);
  const nextCommandPoints = gainCommandPhaseCommandPoints(state);
  logs.push(phaseLog(state, side, armyName,
    `\n═══ BATTLE ROUND ${battleRound(state)} — ${armyName.toUpperCase()} — ${rules.name.toUpperCase()} ═══`));
  logs.push(log(state, side, armyName, `Both players gain 1CP (${nextCommandPoints[0]}CP / ${nextCommandPoints[1]}CP).`, 'info'));
  logs.push(...runBattleshock(state, side));
  logs.push(...scorePrimaryMissionLogs(state, side, rules));
  runAutomaticUnitAbilities(state, side, 'end-of-phase', rules);
  return logs;
}

function runSimulatedMovementPhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];
  state.phase = 'movement';
  state.movementStep = 'moveUnits';
  logs.push(phaseLog(state, side, armyName, `\n─── Movement Phase ───`));
  state.units.filter(unit => unit.side === side && !unit.destroyed)
    .forEach(unit => logs.push(...runMovement(unit, state, rules)));
  markRemainingStationaryUnits(state, side);
  state.movementStep = 'reinforcements';
  updateObjectiveControl(state, rules);
  return logs;
}

function runSimulatedShootingPhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];
  state.phase = 'shooting';
  state.movementStep = undefined;
  logs.push(phaseLog(state, side, armyName, `\n─── Shooting Phase ───`));
  logs.push(...runShootingPhaseUnits(state, side, rules));
  updateObjectiveControl(state, rules);
  return logs;
}

function runSimulatedChargePhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];
  state.phase = 'charge';
  logs.push(phaseLog(state, side, armyName, `\n─── Charge Phase ───`));
  state.units.filter(unit => unit.side === side && !unit.destroyed && !unit.inCombat)
    .forEach(unit => logs.push(...runCharge(unit, state, rules)));
  updateObjectiveControl(state, rules);
  return logs;
}

function runSimulatedFightPhase(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
): { state: BattleState; logs: LogEntry[] } {
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];
  state.phase = 'fight';
  state.fightStepStarted = false;
  state.engagedUnitIdsAtFightStepStart = undefined;
  state.lastFightSelectionSide = undefined;
  state.activeAttachedFightUnitId = undefined;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
  logs.push(phaseLog(state, side, armyName, `\n─── Fight Phase ───`));
  if (rules.metadata.edition === '11e') {
    state = runAutomaticEleventhFightPhase(state, side, rules);
  } else {
    state.units.filter(unit => unit.side === side && !unit.destroyed && unit.charged)
      .forEach(unit => logs.push(...runFight(unit, state, rules)));
    state.units.filter(unit => unit.side === side && !unit.destroyed && !unit.charged && unit.inCombat)
      .forEach(unit => logs.push(...runFight(unit, state, rules)));
    state.units.filter(unit => unit.side !== side && !unit.destroyed && unit.inCombat)
      .forEach(unit => logs.push(...runFight(unit, state, rules)));
  }
  updateObjectiveControl(state, rules);
  return { state, logs };
}

export function simulatePlayerTurn(state: BattleState, rules: RulesEdition): BattleState {
  let s = clone(state);
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  const myUnits = () => s.units.filter(u => u.side === side && !u.destroyed);
  const newLogs: LogEntry[] = [];

  // Reset per-turn flags
  startMissionEventsForNewTurn(s, rules);
  s.fightStepStarted = undefined;
  s.engagedUnitIdsAtFightStepStart = undefined;
  s.lastFightSelectionSide = undefined;
  s.activeAttachedFightUnitId = undefined;
  s.activeAttachedShootingUnitId = undefined;
  s.attachedShootingTargetUnitId = undefined;
  s.firingDeckLockedUnitIds = undefined;
  s.units.forEach(clearFiringDeckWeapons);
  s.units.forEach(u => { u.overrunFightSelected = undefined; u.overrunPiledIn = undefined; });
  myUnits().forEach(u => { u.activated = false; u.charged = false; u.piledIn = undefined; u.consolidated = undefined; u.movementAction = undefined; u.movementAllowanceRemaining = undefined; u.movementAllowanceRemainingByModel = undefined; u.movementAllowanceTotalByModel = undefined; u.movementStartPositionsByModel = undefined; u.movementStartRotationsByModel = undefined; u.movementComplete = undefined; u.arrivedFromReinforcements = undefined; u.rapidIngressThisPhase = undefined; u.heroicInterventionThisPhase = undefined; if (u.emergencyDisembarkedThisTurn) u.battleshocked = false; u.emergencyDisembarkedThisTurn = undefined; u.combatDisembarkedThisTurn = undefined; u.rapidDisembarkedThisTurn = undefined; u.fellBack = false; u.inCombat = false; });

  // Command
  newLogs.push(...runSimulatedCommandPhase(s, side, rules));

  // Movement
  newLogs.push(...runSimulatedMovementPhase(s, side, rules));

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Shooting
  newLogs.push(...runSimulatedShootingPhase(s, side, rules));

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Charge
  newLogs.push(...runSimulatedChargePhase(s, side, rules));

  // Fight — charged first, then others in melee, then defender counterattacks
  const fightResult = runSimulatedFightPhase(s, side, rules);
  s = fightResult.state;
  newLogs.push(...fightResult.logs);

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Objective scoring after the turn's actions; shocked units have OC 0.
  completeEndOfTurnActions(s, side);
  newLogs.push(...scoreEndOfTurnSecondaryMissionLogs(s, side, rules));
  newLogs.push(...scoreEndOfTurnPrimaryMissionLogs(s, side, rules));

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
