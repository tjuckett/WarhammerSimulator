import type { BattleState, BattleUnit, LogEntry, Position, Side, Terrain, TerrainFeature } from '../types/battle';
import type { ImportedArmy, UnitProfile, WeaponProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import { rollExpression, rollMultiple, countSuccesses, d6 } from './dice';
import { deployArmy, distanceToDeploymentZone, fp, pointInDeploymentZone, zoneFor, unitRole, type DeploymentStrategy } from './deployment';
import { selectUnitToDrop, reactivePosition, deployModelFormation } from './deploymentBrain';
import { DEFAULT_OBJECTIVES } from './missions';
import { OBJECTIVE_CONTROL_RADIUS } from './objectiveGeometry';
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

function nextLog(): string { return String(++_logId); }

// ─── Log factory ─────────────────────────────────────────────────────────────

function log(
  state: BattleState,
  side: Side,
  unitName: string,
  message: string,
  type: LogEntry['type'],
): LogEntry {
  return { id: nextLog(), turn: state.turn, phase: state.phase, side, unitName, message, type };
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

function manualGridFormation(profile: UnitProfile, anchor: Position, side: Side): Position[] {
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

function manualGridFormationByRows(profile: UnitProfile, center: Position, side: Side, rows: number, modelIndices?: number[]): Position[] {
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

// ─── Unit queries ─────────────────────────────────────────────────────────────

function enemies(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(u => u.side !== side && !u.destroyed);
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

function runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  if (unit.destroyed) return [];
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
  if (unit.destroyed) return [];
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
  if (unit.destroyed || unit.inCombat) return [];
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
  if (unit.destroyed) return [];
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

function runBattleshock(state: BattleState): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const unit of state.units) {
    if (unit.destroyed) continue;
    if (unit.remainingModels < Math.ceil(unit.profile.baseModelCount / 2)) {
      const roll = d6();
      const needed = unit.profile.leadership;
      const passed = roll >= needed;
      unit.battleshocked = !passed;
      logs.push(log(state, unit.side, unit.profile.name,
        `😰 ${unit.profile.name} below half strength — Battle-shock (${needed}+): rolled ${roll} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
        'info',
      ));
    } else {
      unit.battleshocked = false;
    }
  }
  return logs;
}

// ─── Objective scoring ────────────────────────────────────────────────────────

function scoreObjectives(s: BattleState, side: Side): LogEntry[] {
  const armyName = s.armies[side].name;
  const parts: string[] = [];

  for (let i = 0; i < s.objectives.length; i++) {
    const obj = s.objectives[i];
    let oc0 = 0, oc1 = 0;

    for (const unit of s.units) {
      if (unit.destroyed || unit.battleshocked) continue;
      const inRange = unit.modelPositions.some((model, modelIndex) => (
        dist(model, obj) <= OBJECTIVE_CONTROL_RADIUS + modelBaseRadius(unit, modelIndex)
      ));
      if (inRange) {
        if (unit.side === 0) oc0 += unit.profile.oc;
        else oc1 += unit.profile.oc;
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
    objectiveOwners: [null, null, null, null, null],
    scores: [0, 0],
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
): BattleState {
  _logId = 0;
  _unitId = 0;

  const objectives: Position[] = clone(objectivesOverride ?? DEFAULT_OBJECTIVES);

  const state: BattleState = {
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
    objectiveOwners: [null, null, null, null, null],
    scores: [0, 0],
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

export function placeManualUnit(state: BattleState, side: Side, unitIndex: number, position: Position): BattleState {
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

  const modelPositions = manualGridFormation(profile, position, side);
  const unit = makeBattleUnit(profile, side, modelPositions);

  s.units.push(unit);
  s.unplacedUnits[side] = [...unplaced.slice(0, unitIndex), ...unplaced.slice(unitIndex + 1)];
  const attachedLeaders = attachedFollowersFor(s.armies[side].army, profile);
  attachedLeaders.forEach((leader, leaderIndex) => {
    const anchor = leaderAnchor(unit, leader, leaderIndex, side, s.setup?.deployment);
    const leaderPositions = manualGridFormation(leader, anchor, side);
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

function coherencyListLabel(units: BattleUnit[]): string {
  return Array.from(new Set(units.map(unit => unit.profile.name))).join(' + ');
}

function coherencyModelLists(state: BattleState): Array<{ label: string; models: CoherencyModel[] }> {
  const deployedUnits = state.units.filter(unit => !unit.destroyed);
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

export function battleUnitIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (state.phase !== 'deployment') return new Set();
  const unitIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    if (modelListIsCoherent(list.models)) continue;
    list.models.forEach(model => unitIds.add(model.unit.id));
  }
  return unitIds;
}

export function battleModelIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (state.phase !== 'deployment') return new Set();
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

function modelMoveHasNoBaseOverlap(s: BattleState, unit: BattleUnit, modelIndex: number): boolean {
  const model = unit.modelPositions[modelIndex];
  const footprint = modelFootprint(unit, modelIndex);
  return s.units.every(otherUnit => {
    if (otherUnit.destroyed) return true;
    return otherUnit.modelPositions.every((otherModel, otherModelIndex) => {
      if (otherUnit.id === unit.id && otherModelIndex === modelIndex) return true;
      const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
      return !baseFootprintsOverlap(model, footprint, otherModel, otherFootprint);
    });
  });
}

export function moveManualModel(state: BattleState, unitId: string, modelIndex: number, position: Position): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;

  const unit = s.units.find(u => u.id === unitId && !u.destroyed);
  if (!unit || !unit.modelPositions[modelIndex]) return s;

  const radius = modelBaseRadius(unit, modelIndex);
  const zone = zoneFor(unit.side, s.setup?.deployment);
  if (!canDeployOutsideDeploymentZone(unit.profile) && !pointInDeploymentZone(position, zone, radius)) return s;
  if (!modelIsOutsideEnemyDeploymentZoneBuffer(unit.profile, unit.side, position, modelIndex, s.setup?.deployment)) return s;

  unit.modelPositions[modelIndex] = position;
  unit.position = centroid(unit.modelPositions);

  if (!modelMoveHasNoBaseOverlap(s, unit, modelIndex)) return state;

  return s;
}

function applyManualModelTranslation(
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

function manualMoveHasNoBaseOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  for (const modelIndex of movingIndices) {
    const model = movingUnit.modelPositions[modelIndex];
    const footprint = modelFootprint(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (otherUnit.id === movingUnit.id && movingIndices.has(otherModelIndex)) continue;
        const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
        if (baseFootprintsOverlap(model, footprint, otherUnit.modelPositions[otherModelIndex], otherFootprint)) return false;
      }
    }
  }
  return true;
}

function manualMoveHasNoWallOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
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

function manualMoveHasNoCollision(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  return manualMoveHasNoBaseOverlap(state, movingUnit, movingIndices)
    && manualMoveHasNoWallOverlap(state, movingUnit, movingIndices);
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

function collisionAdjustedManualMove(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  const movingIndices = new Set(modelIndices);
  const candidate = clone(state);
  const candidateUnit = candidate.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!candidateUnit) return { dx, dy };

  applyManualModelTranslation(candidateUnit, modelIndices, dx, dy);
  if (manualMoveHasNoCollision(candidate, candidateUnit, movingIndices)) return { dx, dy };

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const test = clone(state);
    const testUnit = test.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
    if (!testUnit) break;
    applyManualModelTranslation(testUnit, modelIndices, dx * mid, dy * mid);
    if (manualMoveHasNoCollision(test, testUnit, movingIndices)) lo = mid;
    else hi = mid;
  }

  return { dx: dx * lo, dy: dy * lo };
}

export function moveManualModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dx: number,
  dy: number,
  collide = false,
): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!unit) return s;

  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return s;

  const move = collide ? collisionAdjustedManualMove(state, unitId, side, uniqueIndices, dx, dy) : { dx, dy };
  applyManualModelTranslation(unit, uniqueIndices, move.dx, move.dy);
  return s;
}

export function undeployManualUnit(state: BattleState, unitId: string, side: Side): BattleState {
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

export function reorganizeManualUnitGrid(state: BattleState, unitId: string, side: Side, rows: number): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!unit) return s;

  const center = centroid(unit.modelPositions);
  unit.modelPositions = manualGridFormationByRows(unit.profile, center, side, rows);
  unit.position = centroid(unit.modelPositions);
  return s;
}

export function reorganizeManualModelsGrid(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  rows: number,
): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;

  const unit = s.units.find(u => u.id === unitId && u.side === side && !u.destroyed);
  if (!unit) return s;

  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return s;

  const center = centroid(uniqueIndices.map(modelIndex => unit.modelPositions[modelIndex]));
  const gridPositions = manualGridFormationByRows(unit.profile, center, side, rows, uniqueIndices);
  uniqueIndices.forEach((modelIndex, index) => {
    unit.modelPositions[modelIndex] = gridPositions[index];
  });
  unit.position = centroid(unit.modelPositions);
  return s;
}

export function rotateManualModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  degrees: number,
): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;

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

export function manualDeploymentIssues(state: BattleState): string[] {
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

export function beginManualBattle(state: BattleState): BattleState {
  const s = clone(state);
  if (s.phase !== 'deployment') return s;
  const issues = manualDeploymentIssues(s);
  if (issues.length) {
    s.log = [...s.log, log(s, 0, '', `Deployment is not legal: ${issues.join(' ')}`, 'info')];
    return s;
  }
  s.phase = 'setup';
  s.log = [...s.log, log(s, 0, '', 'DEPLOYMENT COMPLETE - BATTLE BEGINS', 'phase')];
  return s;
}

export function simulatePlayerTurn(state: BattleState, rules: RulesEdition): BattleState {
  const s = clone(state);
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  const myUnits = () => s.units.filter(u => u.side === side && !u.destroyed);
  const newLogs: LogEntry[] = [];

  // Reset per-turn flags
  myUnits().forEach(u => { u.activated = false; u.charged = false; u.inCombat = false; });

  // Command
  s.phase = 'command';
  newLogs.push(phaseLog(s, side, armyName,
    `\n═══ TURN ${s.turn} — ${armyName.toUpperCase()} — ${rules.name.toUpperCase()} ═══`));

  // Movement
  s.phase = 'movement';
  newLogs.push(phaseLog(s, side, armyName, `\n─── Movement Phase ───`));
  myUnits().forEach(u => newLogs.push(...runMovement(u, s, rules)));

  checkWinner(s);
  if (s.winner !== null) { s.log = [...s.log, ...newLogs]; return s; }

  // Shooting
  s.phase = 'shooting';
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

  // Battle-shock
  s.phase = 'battle-shock';
  const bsLogs = runBattleshock(s);
  if (bsLogs.length) {
    newLogs.push(phaseLog(s, side, armyName, `\n─── Battle-shock Phase ───`));
    newLogs.push(...bsLogs);
  }

  // Objective scoring (after battle-shock so shocked units have OC 0)
  newLogs.push(...scoreObjectives(s, side));

  s.log = [...s.log, ...newLogs];
  return s;
}

export function advanceTurn(state: BattleState): BattleState {
  const s = clone(state);
  if (s.winner !== null) return s;

  if (s.activeArmy === 0) {
    s.activeArmy = 1;
  } else {
    s.turn++;
    s.activeArmy = 0;
    if (s.turn > s.maxTurns) {
      if (s.scores[0] > s.scores[1]) s.winner = 0;
      else if (s.scores[1] > s.scores[0]) s.winner = 1;
      else s.winner = 'draw';
      s.phase = 'end';
    }
  }

  return s;
}
