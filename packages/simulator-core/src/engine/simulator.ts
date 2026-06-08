import type { BattleState, BattleUnit, LogEntry, MovementStep, Phase, Position, Side, Terrain, TerrainFeature } from '../types/battle';
import type { ImportedArmy, UnitProfile, WeaponProfile } from '../types/army';
import { rules40K10th, rulesetMetadataForState, type RulesEdition } from './rulesEngine';
import { rollExpression, rollMultiple, countSuccesses, d6 } from './dice';
import { deployArmy, distanceToDeploymentZone, fp, pointInDeploymentZone, zoneFor, unitRole, type DeploymentStrategy } from './deployment';
import { selectUnitToDrop, reactivePosition, deployModelFormation } from './deploymentBrain';
import { DEFAULT_OBJECTIVES } from './missions';
import { advanceAllowance, normalMoveAllowance } from './movement';
import { objectiveControlRadius } from './objectiveGeometry';
import { battleRound, logWithBattleRound, maxBattleRounds, setBattleRound } from './battleRound';
import { gainCommandPhaseCommandPoints } from './commandPoints';
import { objectiveControlValue, resolveDesperateEscapeTests } from './battleshock';
import { circleFullyInTerrain, lineIntersectsTerrain, terrainCorners } from './terrainGeometry';
import { distance as dist, modelIndicesWithCoherencyIssues, modelListIsCoherent, type CoherencyModel } from './coherency';
import {
  attachedFollowersFor,
  attachedLeadersFor,
  attachedUnitProfilesFor,
  canDeployOutsideDeploymentZone,
  deployableDrops,
  isAttachedLeaderDrop,
  unitMatchesAttachmentTarget,
  unitRosterId,
} from './armyUnits';
import {
  baseFootprintIntersectsRect,
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

const INFILTRATORS_ENEMY_DEPLOYMENT_ZONE_BUFFER = 9;

function modelIsOutsideEnemyDeploymentZoneBuffer(unit: UnitProfile, side: Side, position: Position, modelIndex = 0, deployment?: string): boolean {
  if (!canDeployOutsideDeploymentZone(unit)) return true;
  const enemyZone = zoneFor((1 - side) as Side, deployment);
  return distanceToDeploymentZone(position, enemyZone) >= INFILTRATORS_ENEMY_DEPLOYMENT_ZONE_BUFFER + modelBaseRadiusInches(unit, modelIndex);
}

function modelBaseRadius(unit: BattleUnit, modelIndex = 0): number {
  return modelBaseRadiusInches(unit.profile, modelIndex);
}

function modelRotation(unit: BattleUnit, modelIndex = 0): number {
  return unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0;
}

function modelFootprint(unit: BattleUnit, modelIndex = 0) {
  return modelBaseFootprintInches(unit.profile, modelIndex, modelRotation(unit, modelIndex));
}

function maxModelBaseRadius(unit: BattleUnit): number {
  return battleUnitMaxBaseRadiusInches(unit);
}

function modelRadiiForProfile(profile: UnitProfile): number[] {
  return Array.from({ length: profile.baseModelCount }, (_, modelIndex) => modelBaseRadiusInches(profile, modelIndex));
}

function playGridFormation(profile: UnitProfile, anchor: Position, side: Side): Position[] {
  const count = profile.baseModelCount;
  if (count <= 1) return [anchor];

  const radii = modelRadiiForProfile(profile);
  const maxDiameter = Math.max(...radii.map(radius => radius * 2), 1);
  const gap = 0.08;
  const spacing = maxDiameter + gap;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const forward = side === 0 ? 1 : -1;
  const startY = anchor.y - ((rows - 1) * spacing) / 2;

  return Array.from({ length: count }, (_, modelIndex) => {
    const row = Math.floor(modelIndex / columns);
    const col = modelIndex % columns;
    return {
      x: anchor.x + forward * col * spacing,
      y: startY + row * spacing,
    };
  });
}

function playGridFormationByRows(profile: UnitProfile, center: Position, side: Side, rows: number, modelIndices?: number[]): Position[] {
  const indices = modelIndices?.length ? modelIndices : Array.from({ length: profile.baseModelCount }, (_, modelIndex) => modelIndex);
  const count = indices.length;
  if (count <= 1) return [center];

  const rowCount = Math.max(1, Math.min(rows, count));
  const columns = Math.ceil(count / rowCount);
  const radii = indices.map(modelIndex => modelBaseRadiusInches(profile, modelIndex));
  const maxDiameter = Math.max(...radii.map(radius => radius * 2), 1);
  const gap = 0.08;
  const spacing = maxDiameter + gap;
  const forward = side === 0 ? 1 : -1;
  const startX = center.x - forward * ((columns - 1) * spacing) / 2;
  const startY = center.y - ((rowCount - 1) * spacing) / 2;

  return Array.from({ length: count }, (_, modelIndex) => {
    const row = modelIndex % rowCount;
    const col = Math.floor(modelIndex / rowCount);
    return {
      x: startX + forward * col * spacing,
      y: startY + row * spacing,
    };
  });
}

function clampModelToBoard(point: Position, radius: number, zone?: ReturnType<typeof zoneFor>): Position {
  const minX = zone ? zone.x0 + radius : radius;
  const maxX = zone ? zone.x1 - radius : 60 - radius;
  return {
    x: Math.min(maxX, Math.max(minX, point.x)),
    y: Math.min(44 - radius, Math.max(radius, point.y)),
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

function resolveInternalModelOverlaps(unit: BattleUnit, zone?: ReturnType<typeof zoneFor>): void {
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

        positions[i] = clampModelToBoard({ x: positions[i].x - ux * push, y: positions[i].y - uy * push }, radiusI, zone);
        positions[j] = clampModelToBoard({ x: positions[j].x + ux * push, y: positions[j].y + uy * push }, radiusJ, zone);
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

function formationWithinBounds(unit: BattleUnit, center: Position, zone?: ReturnType<typeof zoneFor>): boolean {
  const dx = center.x - unit.position.x;
  const dy = center.y - unit.position.y;
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const model = unit.modelPositions[modelIndex];
    const r = modelBaseRadius(unit, modelIndex);
    const x = model.x + dx;
    const y = model.y + dy;
    if (x < r || x > 60 - r || y < r || y > 44 - r) return false;
    if (zone && !pointInDeploymentZone({ x, y }, zone, r)) return false;
  }
  return true;
}

function avoidDeploymentOverlap(unit: BattleUnit, state: BattleState, zone: ReturnType<typeof zoneFor>): void {
  if (
    !formationHasInternalOverlap(unit)
    && !formationOverlapsUnits(unit, unit.position, state)
    && formationWithinBounds(unit, unit.position, zone)
  ) return;

  for (let radius = 0.5; radius <= 14; radius += 0.5) {
    for (let ai = 0; ai < 24; ai++) {
      const angle = (ai / 24) * Math.PI * 2;
      const candidate = {
        x: unit.position.x + Math.cos(angle) * radius,
        y: unit.position.y + Math.sin(angle) * radius,
      };
      if (!formationWithinBounds(unit, candidate, zone)) continue;
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
  unit.modelPositions = unit.modelPositions.map(mp => ({ x: mp.x + dx, y: mp.y + dy }));
  unit.position = { x: unit.position.x + dx, y: unit.position.y + dy };
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

function modelWeaponLoadout(profile: UnitProfile, modelIndex: number): number[] {
  const configured = profile.modelWeaponLoadouts?.[modelIndex];
  if (configured?.length) {
    return configured.filter(weaponIndex => weaponIndex >= 0 && weaponIndex < profile.weapons.length);
  }
  return profile.weapons.map((_, weaponIndex) => weaponIndex);
}

function aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number {
  let count = 0;
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    count += modelWeaponLoadout(unit.profile, modelIndex).filter(index => index === weaponIndex).length;
  }
  return count;
}

// Rough LOS check: returns false if any cover-providing terrain intersects the line
function hasLOS(from: Position, to: Position, terrain: Terrain[]): boolean {
  for (const t of terrain) {
    if (!t.providesCover) continue;
    if (t.features.some(feature => feature.blocksLOS && lineIntersectsTerrain(from, to, feature))) {
      return false;
    }
  }
  return true;
}

function unitFullyInCover(unit: BattleUnit, terrain: Terrain[]): boolean {
  const radius = maxModelBaseRadius(unit);
  return unit.modelPositions.every(model =>
    terrain.some(t => t.providesCover && circleFullyInTerrain(model, radius, t)),
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
  return state.units.filter(u => u.side !== side && !u.destroyed && !u.embarkedInUnitId);
}

function nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null {
  if (!targets.length) return null;
  return targets.reduce((best, t) =>
    dist(unit.position, t.position) < dist(unit.position, best.position) ? t : best,
  );
}

function inEngagement(unit: BattleUnit, others: BattleUnit[], range: number): boolean {
  return others.some(o =>
    unit.modelPositions.some(mp =>
      o.modelPositions.some(op => dist(mp, op) <= range),
    ),
  );
}

function engagedEnemies(state: BattleState, unit: BattleUnit, rules: RulesEdition): BattleUnit[] {
  const eng = rules.engagementRange();
  return enemies(state, unit.side).filter(enemy => inEngagement(unit, [enemy], eng));
}

// ─── Combat resolution ────────────────────────────────────────────────────────

function resolveAttacks(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  state: BattleState,
  hasCover: boolean,
): LogEntry[] {
  const logs: LogEntry[] = [];
  const d = dist(attacker.position, defender.position);

  // Base attacks per model × remaining models
  const weaponModelCount = aliveWeaponModelCount(attacker, weaponIndex);
  if (weaponModelCount <= 0) return logs;
  const basePerModel = rollExpression(weapon.attacks).total;
  let numAttacks = basePerModel * weaponModelCount;
  numAttacks = rules.modifyAttackCount(numAttacks, attacker, weapon, d, defender.remainingModels);

  if (numAttacks <= 0) return logs;

  logs.push(log(state, attacker.side, attacker.profile.name,
    `  ${weapon.isMelee ? '⚔️' : '🔫'} ${weapon.name} — ${weaponModelCount} model(s) × ${weapon.attacks} = ${numAttacks} attacks vs ${defender.profile.name}`,
    weapon.isMelee ? 'fight' : 'shoot',
  ));

  // ── Hit rolls ──────────────────────────────────────────────────────────────
  const hitRolls = rollMultiple(numAttacks);
  const hitResult = rules.processHits(hitRolls, weapon.skill, weapon);
  const noteHit = hitResult.logNote ? ` [${hitResult.logNote}]` : '';
  logs.push(log(state, attacker.side, attacker.profile.name,
    `     Hit rolls (${weapon.skill}+): [${hitRolls.join(', ')}] → ${hitResult.hits} hits${noteHit}`,
    'roll',
  ));

  // Mortal wounds from critical hits (e.g. Deadly Demise)
  let totalMortals = hitResult.mortalsFromCrits;

  if (hitResult.hits === 0 && totalMortals === 0) return logs;

  // ── Wound rolls ───────────────────────────────────────────────────────────
  const wt = rules.woundTarget(weapon.strength, defender.profile.toughness);
  let woundCount = 0;

  if (hitResult.hits > 0) {
    const woundRolls = rollMultiple(hitResult.hits);
    const woundResult = rules.processWounds(woundRolls, wt, weapon);
    const noteWound = woundResult.logNote ? ` [${woundResult.logNote}]` : '';
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Wound rolls (S${weapon.strength} vs T${defender.profile.toughness}, ${wt}+): [${woundRolls.join(', ')}] → ${woundResult.wounds} wounds${noteWound}`,
      'roll',
    ));
    woundCount = woundResult.wounds;
    totalMortals += woundResult.mortalsFromCrits;
  }

  // ── Save rolls ────────────────────────────────────────────────────────────
  let unsaved = 0;
  if (woundCount > 0) {
    const coverBonus = hasCover ? rules.coverSaveBonus(defender, weapon) : 0;
    const rawSave = rules.saveTarget(defender.profile.save, weapon.ap, defender.profile.invulnSave);
    const effectiveSave = rawSave - coverBonus;
    const coverNote = coverBonus > 0 ? ` (cover +${coverBonus})` : '';

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
  if (unsaved > 0) {
    let totalDmg = 0;
    for (let i = 0; i < unsaved; i++) totalDmg += rollExpression(weapon.damage).total;
    logs.push(...applyDamage(defender, totalDmg, state, attacker.side));
  }

  // ── Mortal wounds ─────────────────────────────────────────────────────────
  if (totalMortals > 0) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     +${totalMortals} mortal wound(s)`,
      'damage',
    ));
    logs.push(...applyDamage(defender, totalMortals, state, attacker.side));
  }

  return logs;
}

function applyDamage(
  unit: BattleUnit,
  totalDamage: number,
  state: BattleState,
  attackerSide: Side,
): LogEntry[] {
  const logs: LogEntry[] = [];
  let remaining = totalDamage;
  let killed = 0;

  while (remaining > 0 && unit.remainingModels > 0) {
    if (remaining >= unit.woundsOnLeadModel) {
      remaining -= unit.woundsOnLeadModel;
      unit.remainingModels--;
      killed++;
      unit.woundsOnLeadModel = unit.profile.wounds;
    } else {
      unit.woundsOnLeadModel -= remaining;
      remaining = 0;
    }
  }

  if (killed > 0) trimFormation(unit);

  if (killed > 0 && unit.remainingModels === 0) {
    unit.destroyed = true;
    logs.push(log(state, attackerSide, unit.profile.name,
      `  💀 ${unit.profile.name} DESTROYED`,
      'death',
    ));
    logs.push(...emergencyDisembarkDestroyedTransport(state, unit, attackerSide));
  } else if (killed > 0) {
    logs.push(log(state, attackerSide, unit.profile.name,
      `  ⚠️  ${unit.profile.name}: ${killed} model(s) slain (${unit.remainingModels}/${unit.profile.baseModelCount} remain)`,
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
  if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
    unit.destroyed = true;
    unit.remainingModels = 0;
    unit.modelPositions = [];
    unit.modelRotations = [];
    unit.movementAllowanceRemaining = 0;
    unit.movementAllowanceRemainingByModel = [];
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
    unit.movementComplete = true;
    unit.battleshocked = true;
    unit.emergencyDisembarkedThisTurn = true;
    unit.inCombat = false;
    if (!existingPassenger) state.units.push(unit);

    const rolls = unit.modelPositions.map(() => d6());
    const destroyedModels = rolls.filter(roll => roll === 1).length;
    destroyPassengerModels(unit, destroyedModels);
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

  resolveInternalModelOverlaps(unit);
  unit.position = centroid(unit.modelPositions);

  return [log(state, unit.side, unit.profile.name,
    `  🚶 ${unit.profile.name} moves ${moved.toFixed(1)}" toward ${target.profile.name} (${dist(unit.position, target.position).toFixed(1)}" away)`,
    'move',
  )];
}

function runShooting(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  if (unit.fellBack || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side);
  if (inEngagement(unit, foes, eng)) return [];

  const rangedWeapons = unit.profile.weapons.filter(w => !w.isMelee && w.range > 0);
  if (!rangedWeapons.length) return [];

  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name, `🔫 ${unit.profile.name} shoots:`, 'shoot'),
  ];

  for (const weapon of rangedWeapons) {
    const weaponIndex = unit.profile.weapons.indexOf(weapon);
    if (aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    const validTargets = foes.filter(e => {
      return dist(unit.position, e.position) <= weapon.range &&
        hasLOS(unit.position, e.position, state.terrain);
    });
    if (!validTargets.length) {
      logs.push(log(state, unit.side, unit.profile.name,
        `  ${weapon.name}: no valid targets in range/LOS`,
        'info',
      ));
      continue;
    }
    const target = nearest(unit, validTargets)!;
    const cover = unitFullyInCover(target, state.terrain);
    logs.push(...resolveAttacks(unit, target, weapon, weaponIndex, rules, state, cover));
  }

  return logs;
}

function runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inCombat || unit.fellBack || unit.arrivedFromReinforcements || unit.emergencyDisembarkedThisTurn || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return [];
  const foes = enemies(state, unit.side).filter(
    e => dist(unit.position, e.position) <= rules.chargeRange(),
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

function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const eng = rules.engagementRange();
  const foes = enemies(state, unit.side).filter(e => dist(unit.position, e.position) <= eng);
  if (!foes.length) return [];

  const meleeWeapons = unit.profile.weapons.filter(w => w.isMelee);
  if (!meleeWeapons.length) return [];

  const target = nearest(unit, foes)!;
  const logs: LogEntry[] = [
    log(state, unit.side, unit.profile.name, `🗡️  ${unit.profile.name} fights ${target.profile.name}:`, 'fight'),
  ];

  for (const weapon of meleeWeapons) {
    const weaponIndex = unit.profile.weapons.indexOf(weapon);
    if (aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    logs.push(...resolveAttacks(unit, target, weapon, weaponIndex, rules, state, false));
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

function runBattleshock(state: BattleState, side: Side): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const unit of state.units) {
    if (unit.destroyed || unit.side !== side) continue;
    if (isBelowHalfStrength(unit)) {
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
  return state.units.filter(u => u.side === side && !u.destroyed && !u.embarkedInUnitId);
}

export function markRemainingStationaryUnits(state: BattleState, side: Side = state.activeArmy): void {
  for (const unit of activeUnits(state, side)) {
    if (!unit.movementAction && !unit.fellBack) {
      unit.movementAction = 'remainedStationary';
      unit.movementAllowanceRemaining = 0;
      unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
      unit.movementComplete = true;
    }
  }
}

function startCommandPhase(s: BattleState, rules: RulesEdition): LogEntry[] {
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  activeUnits(s, side).forEach(u => {
    u.activated = false;
    u.charged = false;
    u.movementAction = undefined;
    u.movementAllowanceRemaining = undefined;
    u.movementAllowanceRemainingByModel = undefined;
    u.movementComplete = undefined;
    u.arrivedFromReinforcements = undefined;
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
    fellBack: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
}

function leaderAnchor(bodyguard: BattleUnit, leader: UnitProfile, leaderIndex: number, side: Side, deployment?: string): Position {
  const forward = side === 0 ? -1 : 1;
  const zone = zoneFor(side, deployment);
  const radius = modelBaseRadiusInches(leader);
  const offsetX = forward * (battleUnitMaxBaseRadiusInches(bodyguard) + radius + 0.4);
  const offsetY = (leaderIndex - 0.5) * 1.2;
  return clampModelToBoard({
    x: bodyguard.position.x + offsetX,
    y: bodyguard.position.y + offsetY,
  }, radius, zone);
}

function removeUnitFromUnplaced(s: BattleState, side: Side, profile: UnitProfile): void {
  const key = unitRosterId(profile);
  s.unplacedUnits[side] = s.unplacedUnits[side].filter(unit => unitRosterId(unit) !== key);
}

function unitIsStagedReinforcement(unit: UnitProfile): boolean {
  return unit.deployment?.mode === 'deepStrike' || unit.deployment?.mode === 'strategicReserve';
}

function reinforcementPlacementIsOutsideEnemyRange(state: BattleState, side: Side, modelPositions: Position[], minRange = 9): boolean {
  const foes = enemies(state, side);
  return modelPositions.every(model =>
    foes.every(enemy =>
      enemy.modelPositions.every(enemyModel => dist(model, enemyModel) > minRange),
    ),
  );
}

const TRANSPORT_ACCESS_RANGE = 3;

function unitAssignedToTransport(profile: UnitProfile, transport: BattleUnit): boolean {
  return profile.deployment?.mode === 'transport'
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

  const objectives: Position[] = clone(objectivesOverride ?? DEFAULT_OBJECTIVES);

  const deployment = setup?.deployment;
  const army1Deployable = deployableDrops(army1);
  const army2Deployable = deployableDrops(army2);
  const positions1 = deployArmy(army1Deployable, 0, strategy1, terrain, objectives, deployment);
  const positions2 = deployArmy(army2Deployable, 1, strategy2, terrain, objectives, deployment);

  const units: BattleUnit[] = [];
  const allPlacedModels: Position[] = []; // grows as each unit is placed; prevents cross-unit overlap
  const allPlacedModelRadii: number[] = [];

  const place = (army: ImportedArmy, side: Side, positions: Position[], terrain: Terrain[]) => {
    deployableDrops(army).forEach((profile, i) => {
      const startPos = positions[i];
      const modelPositions = deployModelFormation(
        startPos, profile.baseModelCount, unitRole(profile), side as 0 | 1,
        terrain, zoneFor(side as 0 | 1, deployment), allPlacedModels,
        modelRadiiForProfile(profile),
        allPlacedModelRadii,
      );
      const unit = makeBattleUnit(profile, side, modelPositions);
      unit.position = startPos;
      resolveInternalModelOverlaps(unit, zoneFor(side as 0 | 1, deployment));
      avoidDeploymentOverlap(unit, { units } as BattleState, zoneFor(side as 0 | 1, deployment));
      resolveInternalModelOverlaps(unit, zoneFor(side as 0 | 1, deployment));
      allPlacedModels.push(...unit.modelPositions);
      allPlacedModelRadii.push(...unit.modelPositions.map((_, modelIndex) => modelBaseRadius(unit, modelIndex)));
      units.push(unit);

      attachedFollowersFor(army, profile).forEach((leader, leaderIndex) => {
        const anchor = leaderAnchor(unit, leader, leaderIndex, side, deployment);
        const leaderPositions = deployModelFormation(
          anchor, leader.baseModelCount, unitRole(leader), side as 0 | 1,
          terrain, zoneFor(side as 0 | 1, deployment), allPlacedModels,
          modelRadiiForProfile(leader),
          allPlacedModelRadii,
        );
        const leaderUnit = makeBattleUnit(leader, side, leaderPositions, unit.id, unit.tabletopUnitId);
        resolveInternalModelOverlaps(leaderUnit, zoneFor(side as 0 | 1, deployment));
        avoidDeploymentOverlap(leaderUnit, { units } as BattleState, zoneFor(side as 0 | 1, deployment));
        resolveInternalModelOverlaps(leaderUnit, zoneFor(side as 0 | 1, deployment));
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
    armies: [
      { name: army1.name, faction: army1.faction, color: color1, army: army1 },
      { name: army2.name, faction: army2.faction, color: color2, army: army2 },
    ],
    objectives,
    objectiveControl: rules.objectiveControl,
    objectiveOwners: objectives.map(() => null),
    scores: [0, 0],
    commandPoints: [0, 0],
    unplacedUnits: [[], []],
    deployStrategies: [strategy1, strategy2],
    setup,
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
    armies: [
      { name: army1.name, faction: army1.faction, color: color1, army: army1 },
      { name: army2.name, faction: army2.faction, color: color2, army: army2 },
    ],
    objectives,
    objectiveControl: rules.objectiveControl,
    objectiveOwners: objectives.map(() => null),
    scores: [0, 0],
    commandPoints: [0, 0],
    unplacedUnits: [deployableDrops(army1), deployableDrops(army2)],
    deployStrategies: [strategy1, strategy2],
    setup,
  };

  state.log = [log(state, 0, '', '═══ DEPLOYMENT PHASE ═══', 'phase')];
  return state;
}

export function placeNextUnit(state: BattleState): BattleState {
  const s = clone(state);

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
  const modelPos = deployModelFormation(
    pos, profile.baseModelCount, unitRole(profile), side, s.terrain, zoneFor(side, s.setup?.deployment), allDeployedModels,
    modelRadiiForProfile(profile),
    allDeployedModelRadii,
  );

  const unit = makeBattleUnit(profile, side, modelPos);
  unit.position = pos;

  resolveInternalModelOverlaps(unit, zoneFor(side, s.setup?.deployment));
  avoidDeploymentOverlap(unit, s, zoneFor(side, s.setup?.deployment));
  resolveInternalModelOverlaps(unit, zoneFor(side, s.setup?.deployment));
  s.units.push(unit);
  s.unplacedUnits[side] = [...unplaced.slice(0, unitIdx), ...unplaced.slice(unitIdx + 1)];
  const attachedLeaders = attachedFollowersFor(s.armies[side].army, profile);
  attachedLeaders.forEach((leader, leaderIndex) => {
    const anchor = leaderAnchor(unit, leader, leaderIndex, side, s.setup?.deployment);
    const deployedModels = s.units.flatMap(u => u.modelPositions);
    const deployedRadii = s.units.flatMap(u => u.modelPositions.map((_, modelIndex) => modelBaseRadius(u, modelIndex)));
    const leaderModelPos = deployModelFormation(
      anchor, leader.baseModelCount, unitRole(leader), side, s.terrain, zoneFor(side, s.setup?.deployment), deployedModels,
      modelRadiiForProfile(leader),
      deployedRadii,
    );
    const leaderUnit = makeBattleUnit(leader, side, leaderModelPos, unit.id, unit.tabletopUnitId);
    resolveInternalModelOverlaps(leaderUnit, zoneFor(side, s.setup?.deployment));
    avoidDeploymentOverlap(leaderUnit, s, zoneFor(side, s.setup?.deployment));
    resolveInternalModelOverlaps(leaderUnit, zoneFor(side, s.setup?.deployment));
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

  const unplaced = s.unplacedUnits[side];
  const profile = unplaced[unitIndex];
  if (!profile) return s;

  const zone = zoneFor(side, s.setup?.deployment);
  if (!canDeployOutsideDeploymentZone(profile) && !pointInDeploymentZone(position, zone, modelBaseRadiusInches(profile))) {
    s.log = [...s.log, log(s, side, profile.name,
      `${profile.name} must be placed wholly inside ${zone.name}.`,
      'info',
    )];
    return s;
  }
  if (!modelIsOutsideEnemyDeploymentZoneBuffer(profile, side, position, 0, s.setup?.deployment)) {
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
    const anchor = leaderAnchor(unit, leader, leaderIndex, side, s.setup?.deployment);
    const leaderPositions = playGridFormation(leader, anchor, side);
    const leaderUnit = makeBattleUnit(leader, side, leaderPositions, unit.id, unit.tabletopUnitId);
    resolveInternalModelOverlaps(leaderUnit, zoneFor(side, s.setup?.deployment));
    avoidDeploymentOverlap(leaderUnit, s, zoneFor(side, s.setup?.deployment));
    resolveInternalModelOverlaps(leaderUnit, zoneFor(side, s.setup?.deployment));
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
  const unit = makeBattleUnit(profile, side, modelPositions);
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
  unit.movementComplete = true;
  unit.arrivedFromReinforcements = true;
  resolveInternalModelOverlaps(unit);
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
  unit.embarkedInUnitId = transport.id;
  unit.position = { ...transport.position };
  unit.modelPositions = transport.modelPositions.map(position => ({ ...position })).slice(0, Math.max(1, unit.remainingModels));
  while (unit.modelPositions.length < unit.remainingModels) unit.modelPositions.push({ ...transport.position });
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
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
  return battleCoherencyIssues(state, state.activeArmy);
}

function modelMoveHasNoBaseOverlap(s: BattleState, unit: BattleUnit, modelIndex: number): boolean {
  const model = unit.modelPositions[modelIndex];
  const footprint = modelFootprint(unit, modelIndex);
  return s.units.every(otherUnit => {
    if (otherUnit.destroyed || otherUnit.embarkedInUnitId) return true;
    return otherUnit.modelPositions.every((otherModel, otherModelIndex) => {
      if (otherUnit.id === unit.id && otherModelIndex === modelIndex) return true;
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
    const radius = modelBaseRadius(unit, modelIndex);
    const zone = zoneFor(unit.side, s.setup?.deployment);
    if (!canDeployOutsideDeploymentZone(unit.profile) && !pointInDeploymentZone(position, zone, radius)) return s;
    if (!modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, position, modelIndex, s.setup?.deployment)) return s;
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
): void {
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    unit.modelPositions[modelIndex] = {
      x: Math.max(0, Math.min(60, position.x + dx)),
      y: Math.max(0, Math.min(44, position.y + dy)),
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
        if (baseFootprintIntersectsRect(model, footprint, feature)) return false;
      }
    }
  }
  return true;
}

function playMoveHasNoEndCollision(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
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

function playMovePathCrossesEnemyModels(
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
    const movingRadius = modelBaseRadius(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed || otherUnit.side === movingUnit.side) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
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
      return otherUnit.modelPositions.some((otherModel, otherModelIndex) => {
        const clearance = movingRadius + modelBaseRadius(otherUnit, otherModelIndex);
        if (dist(otherModel, from) < clearance) return false;
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
    if (lineBlockedByMovement(from, to, state.terrain, movingUnit)) return true;
  }
  return false;
}

function playMoveHasNoPathCollision(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  dx: number,
  dy: number,
  ignoreEnemyModelPath = false,
): boolean {
  return (ignoreEnemyModelPath || !playMovePathCrossesEnemyModels(state, movingUnit, movingIndices, dx, dy))
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
  applyPlayModelTranslation(testUnit, modelIndices, dx, dy);
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
        const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
        if (baseFootprintsOverlap(model, footprint, otherUnit.modelPositions[otherModelIndex], otherFootprint, 0.001)) return true;
      }
    }
  }
  return false;
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

  applyPlayModelTranslation(candidateUnit, modelIndices, dx, dy);
  if (
    playMoveHasNoEndCollision(candidate, candidateUnit, movingIndices)
    && playMoveHasNoPathCollision(state, state.units.find(u => u.id === unitId && u.side === side && !u.destroyed)!, movingIndices, dx, dy, !!options.ignoreEnemyModelPath)
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
    applyPlayModelTranslation(testUnit, modelIndices, dx * mid, dy * mid);
    if (
      playMoveHasNoEndCollision(test, testUnit, movingIndices)
      && playMoveHasNoPathCollision(state, movingUnit, movingIndices, dx * mid, dy * mid, !!options.ignoreEnemyModelPath)
    ) lo = mid;
    else hi = mid;
  }

  return { dx: dx * lo, dy: dy * lo };
}

function movementAllowanceForPlayMove(unit: BattleUnit): number {
  if (unit.movementAction === 'advanced') {
    return unit.movementAllowanceRemaining ?? normalMoveAllowance(unit);
  }
  return normalMoveAllowance(unit);
}

function ensureModelMovementAllowances(unit: BattleUnit): number[] {
  const allowance = movementAllowanceForPlayMove(unit);
  if (!unit.movementAllowanceRemainingByModel || unit.movementAllowanceRemainingByModel.length !== unit.modelPositions.length) {
    unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => allowance);
  }
  return unit.movementAllowanceRemainingByModel;
}

function selectedMovementAllowance(unit: BattleUnit, modelIndices: number[]): number {
  const allowances = ensureModelMovementAllowances(unit);
  return Math.min(...modelIndices.map(modelIndex => allowances[modelIndex] ?? 0));
}

function consumeModelMovementAllowance(unit: BattleUnit, modelIndices: number[], moved: number): void {
  const allowances = ensureModelMovementAllowances(unit);
  for (const modelIndex of modelIndices) {
    allowances[modelIndex] = Math.max(0, (allowances[modelIndex] ?? 0) - moved);
  }
  unit.movementAllowanceRemaining = Math.max(...allowances);
  if (unit.movementAllowanceRemaining <= 0.001) unit.movementComplete = true;
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

  const remaining = selectedMovementAllowance(unit, modelIndices);
  if (remaining <= 0) return { dx: 0, dy: 0 };
  if (distance <= remaining) return { dx, dy };

  const scale = remaining / distance;
  return { dx: dx * scale, dy: dy * scale };
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
    if (engagedEnemies(state, existingUnit, rules40K10th).length > 0) return state;
  }

  const s = clone(state);
  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId)!;
  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return state;

  const budgetMove = s.phase === 'movement' ? budgetAdjustedPlayMove(unit, uniqueIndices, dx, dy) : { dx, dy };
  if (Math.hypot(budgetMove.dx, budgetMove.dy) < 0.001) return state;
  if (
    s.phase === 'movement'
    && translatedPlayMoveEndsInEngagement(s, unit, uniqueIndices, budgetMove.dx, budgetMove.dy)
  ) return state;

  const move = collide || s.phase === 'movement'
    ? collisionAdjustedPlayMove(s, unitId, side, uniqueIndices, budgetMove.dx, budgetMove.dy)
    : budgetMove;
  if (Math.hypot(move.dx, move.dy) < 0.001) return state;

  applyPlayModelTranslation(unit, uniqueIndices, move.dx, move.dy);
  if (s.phase === 'movement' && inEngagement(unit, enemies(s, side), rules40K10th.engagementRange())) return state;

  if (s.phase === 'movement') {
    lockOtherMovedPlayUnits(s, unit);
    const moved = Math.hypot(move.dx, move.dy);
    unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
    consumeModelMovementAllowance(unit, uniqueIndices, moved);
  }
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

  for (const modelIndex of uniqueIndices) {
    unit.modelPositions.splice(modelIndex, 1);
    unit.modelRotations?.splice(modelIndex, 1);
    unit.movementAllowanceRemainingByModel?.splice(modelIndex, 1);
  }

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

export function playUnitCanFallBack(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rules40K10th,
): boolean {
  if (state.phase !== 'movement' || movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(u => u.id === unitId && u.side === side && !u.destroyed && !u.embarkedInUnitId);
  return !!unit && !unit.movementComplete && !unit.movementAction && engagedEnemies(state, unit, rules).length > 0;
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
    || unit.movementComplete
    || unit.fellBack
    || !!unit.movementAction
    || typeof unit.movementAllowanceRemaining === 'number'
    || !!unit.movementAllowanceRemainingByModel
  ) return false;
  return engagedEnemies(state, unit, rules).length === 0;
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

  const advance = advanceAllowance(unit, rules);
  unit.movementAction = 'advanced';
  unit.movementAllowanceRemaining = advance.total;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => advance.total);
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

  applyPlayModelTranslation(unit, modelIndices, move.dx, move.dy);
  if (inEngagement(unit, enemies(s, side), rules.engagementRange())) return state;

  unit.inCombat = false;
  unit.movementAction = 'fellBack';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
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

    const zone = zoneFor(unit.side, state.setup?.deployment);
    if (canDeployOutsideDeploymentZone(unit.profile)) {
      const tooCloseToEnemyZone = unit.modelPositions.some((model, modelIndex) =>
        !modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, model, modelIndex, state.setup?.deployment),
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
    s.phase = 'movement';
    s.movementStep = 'moveUnits';
    newLogs.push(phaseLog(s, side, armyName, `\n--- Movement Phase ---`));
    activeUnits(s, side).forEach(u => newLogs.push(...runMovement(u, s, rules)));
  } else if (s.phase === 'movement') {
    if (movementStep(s) === 'moveUnits') {
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
    newLogs.push(...scoreObjectives(s, side, rules));
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
  myUnits().forEach(u => { u.activated = false; u.charged = false; u.movementAction = undefined; u.movementAllowanceRemaining = undefined; u.movementAllowanceRemainingByModel = undefined; u.movementComplete = undefined; u.arrivedFromReinforcements = undefined; if (u.emergencyDisembarkedThisTurn) u.battleshocked = false; u.emergencyDisembarkedThisTurn = undefined; u.fellBack = false; u.inCombat = false; });

  // Command
  s.phase = 'command';
  s.movementStep = undefined;
  const nextCommandPoints = gainCommandPhaseCommandPoints(s);
  newLogs.push(phaseLog(s, side, armyName,
    `\n═══ BATTLE ROUND ${battleRound(s)} — ${armyName.toUpperCase()} — ${rules.name.toUpperCase()} ═══`));
  newLogs.push(log(s, side, armyName, `Both players gain 1CP (${nextCommandPoints[0]}CP / ${nextCommandPoints[1]}CP).`, 'info'));
  newLogs.push(...runBattleshock(s, side));

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
  newLogs.push(...scoreObjectives(s, side, rules));

  s.log = [...s.log, ...newLogs];
  return s;
}

export function advanceTurn(state: BattleState): BattleState {
  const s = clone(state);
  if (s.winner !== null) return s;

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
