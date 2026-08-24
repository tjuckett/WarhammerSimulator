// Manual attack resolution and its progressively narrowed simulator facade context.
// @ts-nocheck
import type { BattleState, BattleUnit, LogEntry, PendingFightOnDeath, Position, Side } from '../types/battle';
import type { WeaponProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import type { CombatAttackResolutionOptions } from './combatTypes';

export type CombatAttackContext = Record<string, any>;

export function resolveHazardousTests(
  unit: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  state: BattleState,
  context: Record<string, any>,
  testCount = context.aliveWeaponModelCount(unit, weaponIndex),
): LogEntry[] {
  if (!context.weaponHasKeyword(weapon, 'Hazardous') || unit.destroyed || testCount <= 0) return [];
  const rolls = context.rollMultiple(testCount);
  const failures = rolls.filter((roll: number) => roll === 1).length;
  const logs = [context.log(state, unit.side, unit.profile.name,
    `     Hazardous tests for ${weapon.name}: [${rolls.join(', ')}] -> ${failures} failure(s)`, 'roll')];
  for (let i = 0; i < failures && !unit.destroyed; i++) {
    logs.push(...context.applyDamage(unit, context.unitHasKeyword(unit, 'Character') || context.unitCanUseBigGunsNeverTire(unit)
      ? 3 : unit.woundsOnLeadModel, state, unit.side));
  }
  return logs;
}

export interface AutomatedChargeContext {
  enemies(state: BattleState, side: Side): BattleUnit[];
  unitCanChargeTarget(unit: BattleUnit, target: BattleUnit): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  isAircraft(unit: BattleUnit): boolean;
  distance(from: Position, to: Position): number;
  formationExtent(points: Position[], center: Position, direction: Position): number;
  d6(): number;
  hasKeyword(unit: BattleUnit, keyword: string): boolean;
  takesToSkies(state: BattleState, unit: BattleUnit): boolean;
  takeToSkiesDistanceCost(unit: BattleUnit): number;
  findReachablePosition(unit: BattleUnit, target: Position, maximumDistance: number, terrain: BattleState['terrain'], stopGap: number, takesToSkies: boolean): Position;
  avoidModelOverlap(unit: BattleUnit, desired: Position, state: BattleState): Position;
  translateFormation(unit: BattleUnit, dx: number, dy: number): void;
  resolveInternalModelOverlaps(unit: BattleUnit): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'charge'): LogEntry;
}

export function runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: AutomatedChargeContext): LogEntry[] {
  if (unit.performingAction) return [];
  if (unit.destroyed || unit.embarkedInUnitId || context.unitSurgedThisPhase(state, unit) || context.isAircraft(unit)
    || unit.inCombat || unit.fellBack || unit.arrivedFromReinforcements || unit.emergencyDisembarkedThisTurn
    || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced' || (unit.firedWeaponIndices?.length ?? 0) > 0) return [];
  const foes = context.enemies(state, unit.side).filter(
    target => context.unitCanChargeTarget(unit, target) && context.distance(unit.position, target.position) <= rules.chargeRange(),
  );
  if (!foes.length) return [];

  const target = foes.reduce((nearest, candidate) =>
    context.distance(unit.position, candidate.position) < context.distance(unit.position, nearest.position) ? candidate : nearest);
  const distance = context.distance(unit.position, target.position);
  const engagementRange = rules.engagementRange();
  const direction = {
    x: distance > 0 ? (target.position.x - unit.position.x) / distance : 1,
    y: distance > 0 ? (target.position.y - unit.position.y) / distance : 0,
  };
  const stopGap = engagementRange
    + context.formationExtent(unit.modelPositions, unit.position, direction)
    + context.formationExtent(target.modelPositions, target.position, { x: -direction.x, y: -direction.y })
    + 0.05;
  const needed = Math.max(0, distance - stopGap);
  const firstDie = context.d6();
  const secondDie = context.d6();
  const roll = firstDie + secondDie;
  if (rules.metadata.edition === '11e' && context.hasKeyword(unit, 'fly')) unit.takingToSkies = true;
  const maximumDistance = Math.max(0, roll - context.takeToSkiesDistanceCost(unit));
  const logs: LogEntry[] = [context.log(state, unit.side, unit.profile.name,
    `⚔️  ${unit.profile.name} charges ${target.profile.name}! (${needed.toFixed(1)}" needed, rolled ${firstDie}+${secondDie}=${roll})`, 'charge')];

  if (maximumDistance >= needed) {
    const reachablePosition = context.findReachablePosition(
      unit, target.position, maximumDistance, state.terrain, stopGap,
      context.takesToSkies(state, unit),
    );
    const newPosition = context.avoidModelOverlap(unit, reachablePosition, state);
    if (context.distance(unit.position, newPosition) + 0.01 < needed) {
      unit.takingToSkies = undefined;
      logs.push(context.log(state, unit.side, unit.profile.name, '  ❌ Charge path blocked by terrain', 'charge'));
      return logs;
    }
    context.translateFormation(unit, newPosition.x - unit.position.x, newPosition.y - unit.position.y);
    context.resolveInternalModelOverlaps(unit);
    unit.charged = true;
    unit.lastMovePhase = state.phase;
    unit.lastMoveTurn = state.turn;
    unit.takingToSkies = undefined;
    unit.inCombat = true;
    target.inCombat = true;
    logs.push(context.log(state, unit.side, unit.profile.name,
      `  ✅ Charge successful! ${unit.profile.name} is now in melee`, 'charge'));
  } else {
    unit.takingToSkies = undefined;
    logs.push(context.log(state, unit.side, unit.profile.name,
      `  ❌ Charge failed (needed ${Math.ceil(needed)}, rolled ${roll})`, 'charge'));
  }
  return logs;
}

/** Dependencies for player-selected casualty and damage allocation. */
export type ManualDamageAllocationContext = Record<string, any>;

export function removePlayCasualtyModels(
  state: BattleState, unitId: string, side: Side, modelIndices: number[], context: ManualDamageAllocationContext,
): BattleState {
  const { clone, queueDeadlyDemiseForModels, recordDestroyedModelMissionEvents, spliceModelIndices, queueFightOnDeathWindow,
    markUnitDestroyed, recordDestroyedUnitMissionEvent, emergencyDisembarkDestroyedTransport, centroid, log, resolvePendingDeadlyDemisesInPlace } = context;
  const pendingUnit = state.units.find((unit: BattleUnit) => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const pendingCasualties = pendingUnit?.pendingCasualties ?? 0;
  if (state.phase !== 'shooting' || !pendingUnit || pendingCasualties <= 0) return state;
  const next = clone(state);
  const unit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  const uniqueIndices = Array.from(new Set(modelIndices))
    .filter(modelIndex => unit.modelPositions[modelIndex])
    .sort((left, right) => right - left)
    .slice(0, pendingCasualties);
  if (!uniqueIndices.length) return state;
  const destroyedModelPositions = uniqueIndices.map(modelIndex => ({ ...unit.modelPositions[modelIndex] }));
  const destroyedModelRosterIndexes = uniqueIndices.map(modelIndex => unit.modelRosterIndexes?.[modelIndex] ?? modelIndex);
  queueDeadlyDemiseForModels(next, unit, uniqueIndices, state.activeArmy);
  recordDestroyedModelMissionEvents(next, unit, uniqueIndices, state.activeArmy);
  spliceModelIndices(unit, uniqueIndices);
  queueFightOnDeathWindow(next, unit, state.activeArmy, destroyedModelPositions, destroyedModelRosterIndexes);
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
    recordDestroyedUnitMissionEvent(next, unit, state.activeArmy);
    next.log = [...next.log, ...emergencyDisembarkDestroyedTransport(next, unit, state.activeArmy)];
  } else {
    unit.position = centroid(unit.modelPositions);
    if (unit.woundsOnLeadModel <= 0) unit.woundsOnLeadModel = unit.profile.wounds;
  }
  next.log = [...next.log, log(next, state.activeArmy, unit.profile.name,
    `${unit.profile.name} removes ${uniqueIndices.length} selected casualty model${uniqueIndices.length === 1 ? '' : 's'}.`,
    unit.destroyed ? 'death' : 'damage')];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export function assignPlayWoundedModel(
  state: BattleState, unitId: string, side: Side, modelIndex: number, context: ManualDamageAllocationContext,
): BattleState {
  const { clone, log } = context;
  const pendingUnit = state.units.find((unit: BattleUnit) => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const pending = pendingUnit?.pendingWoundAssignment;
  if (!['shooting', 'fight'].includes(state.phase) || !pendingUnit || !pending || (pendingUnit.pendingCasualties ?? 0) > 0) return state;
  const next = clone(state);
  const unit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !unit.modelPositions[modelIndex] || !unit.pendingWoundAssignment) return state;
  unit.woundedModelIndex = modelIndex;
  unit.woundsOnLeadModel = unit.pendingWoundAssignment.woundsOnModel;
  unit.pendingWoundAssignment = undefined;
  next.log = [...next.log, log(next, state.activeArmy, unit.profile.name,
    `${unit.profile.name} marks model ${modelIndex + 1} as wounded (${unit.woundsOnLeadModel}W remaining).`, 'damage')];
  return next;
}

export function allocatePlayDamageToModel(
  state: BattleState, unitId: string, side: Side, modelIndex: number, context: ManualDamageAllocationContext,
): BattleState {
  const { clone, applyFeelNoPain, recordBattleEvent, BATTLE_EVENT_TYPE, log, resolveDamageOutcome, queueDeadlyDemiseForModels,
    recordDestroyedModelMissionEvents, spliceModelIndices, markUnitDestroyed, recordDestroyedUnitMissionEvent,
    emergencyDisembarkDestroyedTransport, centroid, resolvePendingDeadlyDemisesInPlace } = context;
  const pendingUnit = state.units.find((unit: BattleUnit) => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const allocation = pendingUnit?.pendingDamageAllocations?.[0];
  if (!['shooting', 'fight'].includes(state.phase) || !pendingUnit || !allocation || !pendingUnit.modelPositions[modelIndex]) return state;
  if (allocation.targetModelIndex !== undefined && allocation.targetModelIndex !== modelIndex) return state;
  if (pendingUnit.woundedModelIndex !== undefined && pendingUnit.woundedModelIndex !== modelIndex) return state;
  const next = clone(state);
  const unit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit?.pendingDamageAllocations?.length || !unit.modelPositions[modelIndex]) return state;
  const damage = unit.pendingDamageAllocations.shift();
  if (!unit.pendingDamageAllocations.length) unit.pendingDamageAllocations = undefined;
  const feelNoPain = applyFeelNoPain(unit, damage.damage, next);
  const appliedDamage = feelNoPain.damage;
  if (appliedDamage <= 0) {
    recordBattleEvent(next, { type: BATTLE_EVENT_TYPE.DamageApplied, side: state.activeArmy, source: damage.sourceUnitId, data: {
      targetUnitId: unit.id, damage: 0, killedModels: 0, remainingModels: unit.remainingModels,
      woundsOnCurrentModel: unit.woundsOnLeadModel, noCarryOver: damage.noCarryOver ?? false, source: damage.source ?? 'attack',
    }});
    next.log = [...next.log, ...feelNoPain.logs, log(next, state.activeArmy, unit.profile.name,
      `${unit.profile.name} allocates ${damage.damage} damage to model ${modelIndex + 1}; no damage gets through.`, 'damage')];
    return next;
  }
  const currentWounds = unit.woundedModelIndex === modelIndex ? unit.woundsOnLeadModel : unit.profile.wounds;
  const allocationOutcome = resolveDamageOutcome({ damage: appliedDamage, modelCount: 1, woundsOnCurrentModel: currentWounds,
    woundsPerModel: unit.profile.wounds, noCarryOver: true });
  if (allocationOutcome.killedModels > 0) {
    const carryOverDamage = damage.noCarryOver ? 0 : appliedDamage - currentWounds;
    const destroyedBySide = next.units.find((candidate: BattleUnit) => candidate.id === damage.sourceUnitId)?.side ?? state.activeArmy;
    queueDeadlyDemiseForModels(next, unit, [modelIndex], destroyedBySide);
    recordDestroyedModelMissionEvents(next, unit, [modelIndex], destroyedBySide, {
      destroyedByUnitId: damage.sourceUnitId, sourceTags: damage.sourceTags,
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
      recordDestroyedUnitMissionEvent(next, unit, destroyedBySide, {
        destroyedByUnitId: damage.sourceUnitId, destroyingUnitObjectiveIndexesWithinRange: damage.sourceObjectiveIndexesWithinRange,
        sourceTags: damage.sourceTags,
      });
      next.log = [...next.log, ...emergencyDisembarkDestroyedTransport(next, unit, destroyedBySide)];
    } else {
      unit.position = centroid(unit.modelPositions);
      if (carryOverDamage > 0) unit.pendingDamageAllocations = [{ ...damage, damage: carryOverDamage }, ...(unit.pendingDamageAllocations ?? [])];
    }
  } else {
    unit.woundedModelIndex = modelIndex;
    unit.woundsOnLeadModel = allocationOutcome.woundsOnCurrentModel;
  }
  next.log = [...next.log, ...feelNoPain.logs, log(next, state.activeArmy, unit.profile.name,
    allocationOutcome.killedModels > 0
      ? `${unit.profile.name} allocates ${appliedDamage} damage to model ${modelIndex + 1}; model destroyed.`
      : `${unit.profile.name} allocates ${appliedDamage} damage to model ${modelIndex + 1} (${unit.woundsOnLeadModel}W remaining).`,
    allocationOutcome.killedModels > 0 ? 'death' : 'damage')];
  recordBattleEvent(next, { type: BATTLE_EVENT_TYPE.DamageApplied, side: state.activeArmy, source: damage.sourceUnitId, data: {
    targetUnitId: unit.id, damage: appliedDamage, killedModels: allocationOutcome.killedModels, remainingModels: unit.remainingModels,
    woundsOnCurrentModel: unit.woundsOnLeadModel, noCarryOver: damage.noCarryOver ?? false, source: damage.source ?? 'attack',
  }});
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export type PlayShootingWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
};

export type PlayShootingAttackAllocation = {
  weaponIndex: number;
  targetUnitId: string;
  modelCount?: number;
};

export interface ManualShootingSelectionContext {
  attachedUnitId(unit: BattleUnit): string;
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  eligibleShootingWeapons(unit: BattleUnit, state: BattleState, rules: RulesEdition, allowActivated?: boolean): WeaponProfile[];
  enemies(state: BattleState, side: Side): BattleUnit[];
  shootingWeaponCanTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, rules: RulesEdition): boolean;
  unitCanBeSelectedToShootWithoutAttacks(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
}

export function fixedWeaponAttackCount(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, context: ManualShootingSelectionContext): number | null {
  const attacks = Number(String(weapon.attacks).trim());
  if (!Number.isInteger(attacks) || attacks < 0) return null;
  return attacks * context.aliveWeaponModelCount(unit, weaponIndex);
}

export function playShootingWeaponAttackCount(unit: BattleUnit, weaponIndex: number, context: ManualShootingSelectionContext): number | null {
  const weapon = unit.profile.weapons[weaponIndex];
  return weapon ? fixedWeaponAttackCount(unit, weapon, weaponIndex, context) : null;
}

export function playShootingWeaponModelCount(unit: BattleUnit, weaponIndex: number, context: ManualShootingSelectionContext): number {
  return context.aliveWeaponModelCount(unit, weaponIndex);
}

export function playShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ManualShootingSelectionContext,
): PlayShootingWeaponOption[] {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return [];
  if (state.activeAttachedShootingUnitId && context.attachedUnitId(unit) !== state.activeAttachedShootingUnitId) return [];
  const lockedTargetId = state.activeAttachedShootingUnitId === context.attachedUnitId(unit)
    ? state.attachedShootingTargetUnitId
    : undefined;
  const options = context.eligibleShootingWeapons(unit, state, rules)
    .map(weapon => {
      const weaponIndex = unit.profile.weapons.indexOf(weapon);
      return {
        weaponIndex,
        name: weapon.name,
        targetIds: context.enemies(state, side)
          .filter(target => context.shootingWeaponCanTarget(state, unit, target, weapon, rules))
          .filter(target => !lockedTargetId || target.id === lockedTargetId)
          .map(target => target.id),
      };
    })
    .filter(option => option.weaponIndex >= 0);
  if (options.length === 0 && context.unitCanBeSelectedToShootWithoutAttacks(unit, state, rules)) {
    return [{ weaponIndex: -1, name: 'No ranged weapons', targetIds: [] }];
  }
  return options;
}

export interface ManualShootingResolutionContext extends ManualShootingSelectionContext {
  clone(state: BattleState): BattleState;
  aliveWeaponModelIndexes(unit: BattleUnit, weaponIndex: number): number[];
  participatingWeaponModelIndexes(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number[];
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean; modelIndexes?: number[] }): LogEntry[];
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  updateAttachedShootingActivation(state: BattleState, unit: BattleUnit, rules: RulesEdition): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot'): LogEntry;
}

export interface AttachedShootingContext extends ManualShootingSelectionContext {
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  attachedUnitIsFormed(state: BattleState, unit: BattleUnit): boolean;
}

export function updateAttachedShootingActivation(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  context: AttachedShootingContext,
  targetUnitId?: string,
): void {
  if (rules.metadata.edition !== '11e' || !context.attachedUnitIsFormed(state, unit)) return;
  state.activeAttachedShootingUnitId = context.attachedUnitId(unit);
  state.attachedShootingTargetUnitId ??= targetUnitId;
  const remaining = context.attachedUnitComponents(state, unit).filter(component =>
    !component.activated
    && (context.eligibleShootingWeapons(component, state, rules).length > 0
      || context.unitCanBeSelectedToShootWithoutAttacks(component, state, rules)),
  );
  if (remaining.length) return;
  for (const component of context.attachedUnitComponents(state, unit)) component.activated = true;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
}

export interface PlayShootingExecutionContext extends ManualShootingSelectionContext {
  clone(state: BattleState): BattleState;
  clearFiringDeckWeapons(unit: BattleUnit): void;
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean }): LogEntry[];
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  updateAttachedShootingActivation(state: BattleState, unit: BattleUnit, rules: RulesEdition, targetUnitId?: string): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot' | 'info'): LogEntry;
}

export function shootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string | undefined,
  weaponIndex: number | 'all',
  rules: RulesEdition,
  context: PlayShootingExecutionContext,
): BattleState {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return state;
  const s = context.clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return state;
  if (s.activeAttachedShootingUnitId && context.attachedUnitId(unit) !== s.activeAttachedShootingUnitId) return state;
  if (s.attachedShootingTargetUnitId && targetUnitId !== s.attachedShootingTargetUnitId) return state;

  if (weaponIndex === -1 || (weaponIndex === 'all' && !context.eligibleShootingWeapons(unit, s, rules).length)) {
    if (!context.unitCanBeSelectedToShootWithoutAttacks(unit, s, rules) || context.eligibleShootingWeapons(unit, s, rules).length > 0) return state;
    unit.activated = true;
    context.updateAttachedShootingActivation(s, unit, rules);
    s.log = [...s.log, context.log(s, side, unit.profile.name, `${unit.profile.name} is selected to shoot but has no ranged weapons, so it makes no attacks.`, 'shoot')];
    return s;
  }

  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!target) return state;
  const eligibleWeapons = context.eligibleShootingWeapons(unit, s, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option => option.weaponIndex >= 0 && context.aliveWeaponModelCount(unit, option.weaponIndex) > 0);
  const selectedWeapons = weaponIndex === 'all'
    ? context.shootingWeaponSelectionForAll(eligibleWeapons)
    : eligibleWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedWeapons.length) return state;

  const logs: LogEntry[] = [context.log(s, side, unit.profile.name, `🔫 ${unit.profile.name} shoots ${target.profile.name}:`, 'shoot')];
  const firedWeaponIndices: number[] = [];
  for (const option of selectedWeapons) {
    if (!context.shootingWeaponCanTarget(s, unit, target, option.weapon, rules)) {
      logs.push(context.log(s, side, unit.profile.name, `  ${option.weapon.name}: ${target.profile.name} is not a valid target`, 'info'));
      continue;
    }
    const attackLogs = context.resolveShootingWeaponIntoTarget(s, unit, target, option.weapon, option.weaponIndex, rules, { deferCasualties: true });
    logs.push(...attackLogs);
    if (attackLogs.length > 0) firedWeaponIndices.push(option.weaponIndex);
    if (unit.destroyed || target.destroyed) break;
  }
  if (firedWeaponIndices.length === 0) return state;
  if (weaponIndex === 'all' && firedWeaponIndices.length === selectedWeapons.length) unit.activated = true;
  else {
    unit.firedWeaponIndices = [...new Set([...(unit.firedWeaponIndices ?? []), ...firedWeaponIndices])];
    const remainingEligibleWeapons = context.eligibleShootingWeapons(unit, s, rules);
    const hasRemainingTargets = remainingEligibleWeapons.some(weapon =>
      context.enemies(s, side).some(candidate => context.shootingWeaponCanTarget(s, unit, candidate, weapon, rules)),
    );
    if (remainingEligibleWeapons.length === 0 || !hasRemainingTargets) unit.activated = true;
  }
  context.updateAttachedShootingActivation(s, unit, rules, target.id);
  s.log = [...s.log, ...logs];
  if (unit.activated && s.pendingDeadlyDemises?.length) s.log = [...s.log, ...context.resolvePendingDeadlyDemisesInPlace(s)];
  if (unit.activated) context.clearFiringDeckWeapons(unit);
  return s;
}

export interface OverwatchContext extends ManualShootingSelectionContext {
  clone(state: BattleState): BattleState;
  unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: string): boolean;
  snapShootingWeaponCanTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, rules: RulesEdition): boolean;
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean; snapShooting?: boolean }): LogEntry[];
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot'): LogEntry;
}

export function playSnapShootingWeaponOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: OverwatchContext): PlayShootingWeaponOption[] {
  if (state.phase !== 'movement' || state.movementStep !== 'reinforcements' || state.activeArmy === side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || (unit.activated && rules.metadata.edition !== '11e') || !context.unitHasActiveStratagem(state, unit, 'fire-overwatch', 'movement')) return [];
  return context.eligibleShootingWeapons(unit, state, rules, rules.metadata.edition === '11e')
    .map(weapon => ({ weaponIndex: unit.profile.weapons.indexOf(weapon), name: weapon.name, targetIds: context.enemies(state, side)
      .filter(target => context.snapShootingWeaponCanTarget(state, unit, target, weapon, rules)).map(target => target.id) }))
    .filter(option => option.weaponIndex >= 0);
}

export function snapShootPlayUnitWeapon(state: BattleState, unitId: string, side: Side, targetUnitId: string, weaponIndex: number | 'all', rules: RulesEdition, context: OverwatchContext): BattleState {
  if (state.phase !== 'movement' || state.movementStep !== 'reinforcements' || state.activeArmy === side) return state;
  const s = context.clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target || !context.unitHasActiveStratagem(s, unit, 'fire-overwatch', 'movement')) return state;
  const eligibleWeapons = context.eligibleShootingWeapons(unit, s, rules, rules.metadata.edition === '11e')
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option => option.weaponIndex >= 0 && context.aliveWeaponModelCount(unit, option.weaponIndex) > 0 && context.snapShootingWeaponCanTarget(s, unit, target, option.weapon, rules));
  const selectedWeapons = weaponIndex === 'all' ? context.shootingWeaponSelectionForAll(eligibleWeapons) : eligibleWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedWeapons.length) return state;
  const logs: LogEntry[] = [context.log(s, side, unit.profile.name, `${unit.profile.name} snap shoots ${target.profile.name}:`, 'shoot')];
  for (const option of selectedWeapons) {
    logs.push(...context.resolveShootingWeaponIntoTarget(s, unit, target, option.weapon, option.weaponIndex, rules, { deferCasualties: true, snapShooting: true }));
    if (unit.destroyed || target.destroyed) break;
  }
  if (logs.length <= 1) return state;
  unit.activated = true;
  unit.actionStartedThisTurn = true;
  s.log = [...s.log, ...logs];
  return s;
}

export interface AutomatedShootingContext extends ManualShootingSelectionContext {
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options?: object): LogEntry[];
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot' | 'info'): LogEntry;
}

export function runShooting(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: AutomatedShootingContext): LogEntry[] {
  const rangedWeapons = context.shootingWeaponSelectionForAll(context.eligibleShootingWeapons(unit, state, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) })).filter(option => option.weaponIndex >= 0));
  if (!rangedWeapons.length) return [];
  const logs: LogEntry[] = [context.log(state, unit.side, unit.profile.name, `🔫 ${unit.profile.name} shoots:`, 'shoot')];
  for (const { weapon, weaponIndex } of rangedWeapons) {
    if (context.aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    const validTargets = context.enemies(state, unit.side).filter(target => context.shootingWeaponCanTarget(state, unit, target, weapon, rules));
    if (!validTargets.length) {
      logs.push(context.log(state, unit.side, unit.profile.name, `  ${weapon.name}: no valid targets in range/LOS`, 'info'));
      continue;
    }
    logs.push(...context.resolveShootingWeaponIntoTarget(state, unit, context.nearest(unit, validTargets)!, weapon, weaponIndex, rules));
    if (unit.destroyed) break;
  }
  return logs;
}

export interface ShootingLockContext {
  clone(state: BattleState): BattleState;
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
}

export function lockPlayUnitShooting(state: BattleState, unitId: string, side: Side, context: ShootingLockContext): BattleState {
  if (state.phase !== 'shooting') return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed);
  if (!existing || existing.activated) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of context.attachedUnitComponents(next, unit)) component.activated = true;
  next.activeAttachedShootingUnitId = undefined;
  next.attachedShootingTargetUnitId = undefined;
  return next;
}

export interface AutomatedShootingPhaseContext extends AutomatedShootingContext {
  activeUnits(state: BattleState, side: Side): BattleUnit[];
  attachedUnitId(unit: BattleUnit): string;
  attachedUnitIsFormed(state: BattleState, unit: BattleUnit): boolean;
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  autoSelectFiringDeckInPlace(state: BattleState, unit: BattleUnit): void;
  clearFiringDeckWeapons(unit: BattleUnit): void;
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
}

export function runShootingPhaseUnits(state: BattleState, side: Side, rules: RulesEdition, context: AutomatedShootingPhaseContext): LogEntry[] {
  if (rules.metadata.edition !== '11e') return context.activeUnits(state, side).flatMap(unit => runShooting(unit, state, rules, context));
  const logs: LogEntry[] = [];
  const handled = new Set<string>();
  for (const selected of context.activeUnits(state, side)) {
    const groupId = context.attachedUnitId(selected);
    if (handled.has(groupId)) continue;
    handled.add(groupId);
    context.autoSelectFiringDeckInPlace(state, selected);
    if (!context.attachedUnitIsFormed(state, selected)) {
      logs.push(...runShooting(selected, state, rules, context), ...context.resolvePendingDeadlyDemisesInPlace(state));
      context.clearFiringDeckWeapons(selected);
      continue;
    }
    const components = context.attachedUnitComponents(state, selected);
    const declarations: Array<{ componentId: string; targetId: string; weapon: WeaponProfile; weaponIndex: number }> = [];
    for (const component of components) {
      const weapons = context.shootingWeaponSelectionForAll(context.eligibleShootingWeapons(component, state, rules).map(weapon => ({ weapon, weaponIndex: component.profile.weapons.indexOf(weapon) })).filter(option => option.weaponIndex >= 0));
      if (weapons.length) logs.push(context.log(state, component.side, component.profile.name, `${component.profile.name} shoots:`, 'shoot'));
      for (const option of weapons) {
        const target = context.nearest(component, context.enemies(state, side).filter(candidate => context.shootingWeaponCanTarget(state, component, candidate, option.weapon, rules)));
        if (target) declarations.push({ componentId: component.id, targetId: target.id, ...option });
        else logs.push(context.log(state, component.side, component.profile.name, `  ${option.weapon.name}: no valid targets in range/LOS`, 'info'));
      }
    }
    for (const declaration of declarations) {
      const component = state.units.find(unit => unit.id === declaration.componentId && !unit.destroyed);
      const target = state.units.find(unit => unit.id === declaration.targetId && !unit.destroyed);
      if (component && target) logs.push(...context.resolveShootingWeaponIntoTarget(state, component, target, declaration.weapon, declaration.weaponIndex, rules));
    }
    for (const component of components) component.activated = true;
    logs.push(...context.resolvePendingDeadlyDemisesInPlace(state));
    components.forEach(context.clearFiringDeckWeapons);
  }
  return logs;
}

/** Resolve a unit's complete shooting declaration only after every weapon target is locked. */
export function shootPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayShootingAttackAllocation[],
  rules: RulesEdition,
  context: ManualShootingResolutionContext,
): BattleState {
  if (state.phase !== 'shooting' || state.activeArmy !== side || !allocations.length) return state;
  const s = context.clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return state;
  if (s.activeAttachedShootingUnitId && context.attachedUnitId(unit) !== s.activeAttachedShootingUnitId) return state;

  const eligibleWeapons = context.eligibleShootingWeapons(unit, s, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option => option.weaponIndex >= 0 && context.aliveWeaponModelCount(unit, option.weaponIndex) > 0);
  const selectableWeapons = context.shootingWeaponSelectionForAll(eligibleWeapons);
  const selectableIndexes = new Set(selectableWeapons.map(option => option.weaponIndex));
  const allocationByWeapon = new Map<number, PlayShootingAttackAllocation[]>();
  for (const allocation of allocations) {
    if (!selectableIndexes.has(allocation.weaponIndex)) return state;
    if (!s.units.some(candidate => candidate.id === allocation.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId)) return state;
    const weaponAllocations = allocationByWeapon.get(allocation.weaponIndex) ?? [];
    weaponAllocations.push(allocation);
    allocationByWeapon.set(allocation.weaponIndex, weaponAllocations);
  }
  if (allocationByWeapon.size !== selectableIndexes.size) return state;

  for (const selected of selectableWeapons) {
    const weaponAllocations = allocationByWeapon.get(selected.weaponIndex) ?? [];
    const availableModelIndexes = context.aliveWeaponModelIndexes(unit, selected.weaponIndex);
    const assignedModelIndexes = new Set<number>();
    if (weaponAllocations.length > 1) {
      const declaredModels = weaponAllocations.reduce((total, allocation) => total + (allocation.modelCount ?? 0), 0);
      if (declaredModels !== availableModelIndexes.length) return state;
    }
    const allocationCandidates = weaponAllocations.map(allocation => {
      const target = s.units.find(candidate => candidate.id === allocation.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, s.terrain, s);
      return { allocation, eligibleModelIndexes };
    }).sort((a, b) => a.eligibleModelIndexes.length - b.eligibleModelIndexes.length);
    for (const { allocation, eligibleModelIndexes } of allocationCandidates) {
      if (allocation.modelCount !== undefined && (!Number.isInteger(allocation.modelCount) || allocation.modelCount < 1)) return state;
      if (s.attachedShootingTargetUnitId && allocation.targetUnitId !== s.attachedShootingTargetUnitId) return state;
      const target = s.units.find(candidate => candidate.id === allocation.targetUnitId && !candidate.destroyed)!;
      if (!context.shootingWeaponCanTarget(s, unit, target, selected.weapon, rules)) return state;
      const remainingModelIndexes = eligibleModelIndexes.filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = allocation.modelCount ?? remainingModelIndexes.length;
      if (modelCount > remainingModelIndexes.length) return state;
      remainingModelIndexes.slice(0, modelCount).forEach(modelIndex => assignedModelIndexes.add(modelIndex));
    }
  }

  const logs: LogEntry[] = [context.log(s, side, unit.profile.name, `🔫 ${unit.profile.name} locks all ranged targets before rolling:`, 'shoot')];
  for (const selected of selectableWeapons) {
    const weaponAllocations = allocationByWeapon.get(selected.weaponIndex)!;
    const assignedModelIndexes = new Set<number>();
    const orderedWeaponAllocations = [...weaponAllocations].sort((a, b) => {
      const targetA = s.units.find(candidate => candidate.id === a.targetUnitId && !candidate.destroyed)!;
      const targetB = s.units.find(candidate => candidate.id === b.targetUnitId && !candidate.destroyed)!;
      return context.participatingWeaponModelIndexes(unit, targetA, selected.weapon, selected.weaponIndex, s.terrain, s).length
        - context.participatingWeaponModelIndexes(unit, targetB, selected.weapon, selected.weaponIndex, s.terrain, s).length;
    });
    for (const allocation of orderedWeaponAllocations) {
      const target = s.units.find(candidate => candidate.id === allocation.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, s.terrain, s)
        .filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = allocation.modelCount ?? eligibleModelIndexes.length;
      const modelIndexes = eligibleModelIndexes.slice(0, modelCount);
      modelIndexes.forEach(modelIndex => assignedModelIndexes.add(modelIndex));
      logs.push(...context.resolveShootingWeaponIntoTarget(s, unit, target, selected.weapon, selected.weaponIndex, rules, {
        deferCasualties: true,
        modelIndexes,
      }));
    }
  }
  unit.firedWeaponIndices = [...new Set([...(unit.firedWeaponIndices ?? []), ...selectableWeapons.map(option => option.weaponIndex)])];
  unit.activated = true;
  context.updateAttachedShootingActivation(s, unit, rules);
  s.log = [...s.log, ...logs];
  return s;
}

export function unitCanChargeTarget(unit: BattleUnit, target: BattleUnit, hasKeyword: (unit: BattleUnit, keyword: string) => boolean): boolean {
  if (hasKeyword(unit, 'aircraft')) return false;
  return !hasKeyword(target, 'aircraft') || hasKeyword(unit, 'fly');
}

export function unitCanFightTarget(unit: BattleUnit, target: BattleUnit, hasKeyword: (unit: BattleUnit, keyword: string) => boolean): boolean {
  if (hasKeyword(unit, 'aircraft')) return hasKeyword(target, 'fly');
  return !hasKeyword(target, 'aircraft') || hasKeyword(unit, 'fly');
}

export interface FightEligibilityContext {
  enemies(state: BattleState, side: Side): BattleUnit[];
  canFightTarget(unit: BattleUnit, target: BattleUnit): boolean;
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
}

export function unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightEligibilityContext): boolean {
  return !unit.destroyed && !unit.embarkedInUnitId && !unit.activated
    && context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
}

export function unitWasEngagedAtFightStepStart(state: BattleState, unit: BattleUnit): boolean {
  return state.engagedUnitIdsAtFightStepStart?.includes(unit.id) ?? false;
}

export function unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightEligibilityContext): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated) return false;
  if (rules.metadata.edition !== '11e') return unitCanFight(unit, state, rules, context);
  if (state.fightStepStarted === false) return false;
  return unit.charged || unitWasEngagedAtFightStepStart(state, unit)
    || context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
}

export interface FightMovementContext {
  enemies(state: BattleState, side: Side): BattleUnit[];
  modelBaseEdgeHorizontalDistance(unit: BattleUnit, modelIndex: number, target: BattleUnit, targetModelIndex: number): number;
  modelBaseRadius(unit: BattleUnit, modelIndex: number): number;
  centroid(positions: Position[]): Position;
  distance(a: Position, b: Position): number;
}

function closestEnemyModelFor(unit: BattleUnit, modelIndex: number, state: BattleState, context: FightMovementContext) {
  let closest: { unit: BattleUnit; modelIndex: number; distance: number } | null = null;
  for (const enemy of context.enemies(state, unit.side)) {
    for (let enemyModelIndex = 0; enemyModelIndex < enemy.modelPositions.length; enemyModelIndex++) {
      const distance = context.modelBaseEdgeHorizontalDistance(unit, modelIndex, enemy, enemyModelIndex);
      if (!closest || distance < closest.distance) closest = { unit: enemy, modelIndex: enemyModelIndex, distance };
    }
  }
  return closest;
}

export function nearestObjectiveToModel(model: Position, state: BattleState, context: FightMovementContext): Position | null {
  if (!state.objectives.length) return null;
  return state.objectives.reduce((best, objective) => context.distance(model, objective) < context.distance(model, best) ? objective : best);
}

export function moveModelTowardPoint(unit: BattleUnit, modelIndex: number, point: Position, maxDistance: number, context: FightMovementContext, stopGap = 0): boolean {
  const model = unit.modelPositions[modelIndex];
  if (!model) return false;
  const dx = point.x - model.x;
  const dy = point.y - model.y;
  const distance = Math.hypot(dx, dy);
  const moveDistance = Math.min(maxDistance, Math.max(0, distance - stopGap));
  if (distance < 0.001 || moveDistance < 0.001) return false;
  unit.modelPositions[modelIndex] = { ...model, x: model.x + (dx / distance) * moveDistance, y: model.y + (dy / distance) * moveDistance };
  unit.position = context.centroid(unit.modelPositions);
  return true;
}

export function moveModelTowardEnemy(unit: BattleUnit, modelIndex: number, state: BattleState, maxDistance: number, context: FightMovementContext): boolean {
  const closest = closestEnemyModelFor(unit, modelIndex, state, context);
  if (!closest) return false;
  const targetModel = closest.unit.modelPositions[closest.modelIndex];
  return moveModelTowardPoint(unit, modelIndex, targetModel, maxDistance, context,
    context.modelBaseRadius(unit, modelIndex) + context.modelBaseRadius(closest.unit, closest.modelIndex) + 0.02);
}

export interface FightMovementWorkflowContext extends FightMovementContext {
  clone(state: BattleState): BattleState;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  canConsolidate(state: BattleState, unitId: string, side: Side, rules: RulesEdition): boolean;
  hasNoBaseOverlap(state: BattleState, unit: BattleUnit, modelIndices: Set<number>): boolean;
  hasNoWallOverlap(state: BattleState, unit: BattleUnit, modelIndices: Set<number>): boolean;
  log(state: BattleState, side: Side, subject: string, message: string, kind: string): LogEntry;
  moveRange: number;
}

export function applyFightPhaseMove(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightMovementWorkflowContext,
): BattleState {
  if (state.phase !== 'fight' || (state.activeArmy !== side && rules.metadata.edition !== '11e')) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || context.attachedComponents(state, existing).some(component => context.unitSurgedThisPhase(state, component))) return state;
  const isOverrunPileIn = kind === 'pileIn' && rules.metadata.edition === '11e' && state.fightStepStarted && existing.overrunFightSelected;
  if (kind === 'pileIn' && (isOverrunPileIn ? existing.overrunPiledIn : existing.piledIn)) return state;
  if (kind === 'consolidate' && existing.consolidated) return state;
  if (kind === 'pileIn' && isOverrunPileIn && !context.unitEligibleToFight(existing, state, rules)) return state;
  if (kind === 'pileIn' && !isOverrunPileIn && rules.metadata.edition === '11e' && state.fightStepStarted) return state;
  if (kind === 'pileIn' && !isOverrunPileIn && !context.unitCanFight(existing, state, rules)
    && !(existing.charged && context.enemies(state, side).length > 0)) return state;
  if (kind === 'consolidate' && !context.canConsolidate(state, unitId, side, rules)) return state;

  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  let movedModels = 0;
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const before = unit.modelPositions[modelIndex];
    const movedTowardEnemy = moveModelTowardEnemy(unit, modelIndex, next, context.moveRange, context);
    const movedTowardObjective = !movedTowardEnemy && kind === 'consolidate'
      ? (() => {
          const objective = nearestObjectiveToModel(unit.modelPositions[modelIndex], next, context);
          return objective ? moveModelTowardPoint(unit, modelIndex, objective, context.moveRange, context) : false;
        })()
      : false;
    if (!movedTowardEnemy && !movedTowardObjective) continue;
    const movingIndices = new Set([modelIndex]);
    if (!context.hasNoBaseOverlap(next, unit, movingIndices) || !context.hasNoWallOverlap(next, unit, movingIndices)) {
      unit.modelPositions[modelIndex] = before;
      unit.position = context.centroid(unit.modelPositions);
      continue;
    }
    movedModels++;
  }
  if (kind === 'pileIn' && !context.inEngagement(unit, context.enemies(next, side), rules.engagementRange())) return state;
  if (kind === 'pileIn' && isOverrunPileIn) unit.overrunPiledIn = true;
  else if (kind === 'pileIn') unit.piledIn = true;
  else unit.consolidated = true;
  unit.lastMovePhase = next.phase;
  unit.lastMoveTurn = next.turn;
  unit.inCombat = context.inEngagement(unit, context.enemies(next, side), rules.engagementRange());
  next.log = [...next.log, context.log(next, side, unit.profile.name,
    `${unit.profile.name} ${isOverrunPileIn ? 'makes its Overrun pile-in' : kind === 'pileIn' ? 'piles in' : 'consolidates'}${movedModels ? ` with ${movedModels} model${movedModels === 1 ? '' : 's'}` : ''}.`, 'move')];
  return next;
}

export type MeleeAttackAllocation = { weaponIndex: number; targetUnitId: string; attackCount?: number };

export interface ManualFightResolutionContext extends FightPhaseContext {
  clone(state: BattleState): BattleState;
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  selectMeleeWeapons(unit: BattleUnit, options: Array<{ weapon: WeaponProfile; weaponIndex: number }>, requested: number | 'all'): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  chooseOneProfilePerGroup(options: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  fixedWeaponAttackCount(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number): number | null;
  resolveCombatAttacks(...args: any[]): LogEntry[];
  resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState): LogEntry[];
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
  finishAttachedFightComponent(state: BattleState, unit: BattleUnit, rules: RulesEdition): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: string): LogEntry;
}

export function fightPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: MeleeAttackAllocation[],
  rules: RulesEdition,
  context: ManualFightResolutionContext,
): BattleState {
  if (!sideCanSelectFightUnit(state, side, rules, context) || !allocations.length) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !context.unitCanFight(unit, state, rules) || !playFightActivationUnitIds(state, side, rules, context).includes(unit.id)) return state;
  const meleeWeapons = unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex })).filter(option => option.weapon.isMelee);
  const selectableWeapons = rules.metadata.edition === '11e'
    ? context.selectMeleeWeapons(unit, meleeWeapons, 'all')
    : context.chooseOneProfilePerGroup(meleeWeapons);
  const selectableIndexes = new Set(selectableWeapons.map(option => option.weaponIndex));
  const grouped = new Map<number, MeleeAttackAllocation[]>();
  for (const allocation of allocations) {
    if (!selectableIndexes.has(allocation.weaponIndex)) return state;
    const target = state.units.find(candidate => candidate.id === allocation.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
    if (!target || !context.canFightTarget(unit, target) || !context.inEngagement(unit, [target], rules.engagementRange())) return state;
    grouped.set(allocation.weaponIndex, [...(grouped.get(allocation.weaponIndex) ?? []), allocation]);
  }
  if (grouped.size !== selectableIndexes.size) return state;
  for (const selected of selectableWeapons) {
    const entries = grouped.get(selected.weaponIndex) ?? [];
    const fixedAttacks = context.fixedWeaponAttackCount(unit, selected.weapon, selected.weaponIndex);
    if (fixedAttacks === null && entries.length !== 1) return state;
    if (entries.length > 1 && entries.reduce((total, entry) => total + (entry.attackCount ?? 0), 0) !== fixedAttacks) return state;
    if (entries.some(entry => entry.attackCount !== undefined && (!Number.isInteger(entry.attackCount) || entry.attackCount < 1))) return state;
  }
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit) return state;
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} locks all melee targets before rolling:`, 'fight')];
  for (const selected of selectableWeapons) {
    const entries = grouped.get(selected.weaponIndex)!;
    for (const entry of entries) {
      const target = next.units.find(candidate => candidate.id === entry.targetUnitId && !candidate.destroyed)!;
      logs.push(...context.resolveCombatAttacks(fightingUnit, target, selected.weapon, selected.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        ...(entries.length > 1 && entry.attackCount !== undefined ? { attackCountOverride: entry.attackCount } : {}),
        selectedTargetCount: entries.length,
      }));
    }
  }
  if (!logs.length) return state;
  fightingUnit.activated = true;
  context.finishAttachedFightComponent(next, fightingUnit, rules);
  next.log = [...next.log, ...logs];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export type MeleeAttackSplit = { targetUnitId: string; attacks: number };

export function fightPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition,
  context: ManualFightResolutionContext & {
    resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState): LogEntry[];
  },
  targetSplits?: MeleeAttackSplit[],
): BattleState {
  if (!sideCanSelectFightUnit(state, side, rules, context)) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = state.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const splitTargetIds = targetSplits?.map(split => split.targetUnitId) ?? [];
  const splitTargets = splitTargetIds.map(splitTargetId => state.units.find(candidate => candidate.id === splitTargetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId));
  if (!unit || !target || !context.unitCanFight(unit, state, rules) || !playFightActivationUnitIds(state, side, rules, context).includes(unit.id)) return state;
  if (!context.canFightTarget(unit, target) || !context.inEngagement(unit, [target], rules.engagementRange())) return state;
  if (targetSplits?.length && splitTargets.some(splitTarget => !splitTarget || !context.canFightTarget(unit, splitTarget) || !context.inEngagement(unit, [splitTarget], rules.engagementRange()))) return state;
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const fightTarget = next.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit || !fightTarget) return state;
  if (weaponIndex === -1 || (weaponIndex === 'all' && !fightingUnit.profile.weapons.some(weapon => weapon.isMelee))) {
    if (fightingUnit.profile.weapons.some(weapon => weapon.isMelee)) return state;
    fightingUnit.activated = true;
    context.finishAttachedFightComponent(next, fightingUnit, rules);
    next.log = [...next.log, context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} is selected to fight ${fightTarget.profile.name} but has no melee weapons, so it makes no attacks.`, 'fight')];
    return next;
  }
  const meleeWeapons = fightingUnit.profile.weapons.map((weapon, index) => ({ weapon, weaponIndex: index })).filter(option => option.weapon.isMelee);
  const selectedMeleeWeapons = rules.metadata.edition === '11e'
    ? context.selectMeleeWeapons(fightingUnit, meleeWeapons, weaponIndex)
    : weaponIndex === 'all' ? context.chooseOneProfilePerGroup(meleeWeapons) : meleeWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedMeleeWeapons.length || (targetSplits?.length && (weaponIndex === 'all' || selectedMeleeWeapons.length !== 1))) return state;
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, fightingUnit.overrunFightSelected
    ? `${fightingUnit.profile.name} makes an Overrun Fight against ${fightTarget.profile.name}:`
    : `${fightingUnit.profile.name} fights ${fightTarget.profile.name}:`, 'fight')];
  let madeAttacks = false;
  if (targetSplits?.length) {
    const option = selectedMeleeWeapons[0];
    const maxTargets = Number.parseInt(String(option.weapon.attacks), 10);
    const maxAttacks = maxTargets * context.aliveWeaponModelCount(fightingUnit, option.weaponIndex);
    const declaredAttacks = targetSplits.reduce((total, split) => total + split.attacks, 0);
    if (!Number.isFinite(maxTargets) || targetSplits.some(split => split.attacks < 1 || !Number.isInteger(split.attacks))
      || new Set(targetSplits.map(split => split.targetUnitId)).size !== targetSplits.length || declaredAttacks !== maxAttacks) return state;
    for (const split of targetSplits) {
      const splitTarget = next.units.find(candidate => candidate.id === split.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
      if (!splitTarget || !context.canFightTarget(fightingUnit, splitTarget) || !context.inEngagement(fightingUnit, [splitTarget], rules.engagementRange())) continue;
      const attackLogs = context.resolveCombatAttacks(fightingUnit, splitTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', { deferCasualties: true, attackCountOverride: split.attacks, selectedTargetCount: targetSplits.length });
      logs.push(...attackLogs); madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed) break;
    }
    if (madeAttacks) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
  } else {
    for (const option of selectedMeleeWeapons) {
      const attackLogs = context.resolveCombatAttacks(fightingUnit, fightTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', { deferCasualties: true });
      logs.push(...attackLogs);
      if (attackLogs.length > 0) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
      madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed || fightTarget.destroyed) break;
    }
  }
  if (!madeAttacks) return state;
  fightingUnit.activated = true;
  context.finishAttachedFightComponent(next, fightingUnit, rules);
  next.log = [...next.log, ...logs];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export interface FightOnDeathContext extends FightPhaseContext {
  clone(state: BattleState): BattleState;
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  resolveCombatAttacks(...args: any[]): LogEntry[];
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
  log(state: BattleState, side: Side, source: string, message: string, kind: string): LogEntry;
}

function currentFightOnDeathWindow(state: BattleState, side: Side): PendingFightOnDeath | undefined {
  return state.pendingFightOnDeath?.[0]?.side === side ? state.pendingFightOnDeath[0] : undefined;
}

export function fightOnDeathTargetIds(state: BattleState, side: Side, rules: RulesEdition, context: FightOnDeathContext): string[] {
  const pending = currentFightOnDeathWindow(state, side);
  if (!pending || !['shooting', 'fight'].includes(state.phase)) return [];
  return state.units.filter(target => target.side !== side && !target.destroyed && !target.embarkedInUnitId
    && context.canFightTarget(pending.unit, target)
    && context.inEngagement(pending.unit, [target], rules.engagementRange())).map(target => target.id);
}

export function fightOnDeathWeaponOptions(
  state: BattleState,
  side: Side,
  targetUnitId: string,
  rules: RulesEdition,
  context: FightOnDeathContext,
): Array<{ weaponIndex: number; name: string }> {
  const pending = currentFightOnDeathWindow(state, side);
  if (!pending || !fightOnDeathTargetIds(state, side, rules, context).includes(targetUnitId)) return [];
  return pending.unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee && context.aliveWeaponModelCount(pending.unit, option.weaponIndex) > 0)
    .map(option => ({ weaponIndex: option.weaponIndex, name: option.weapon.name }));
}

export function fightOnDeathUnitWeapon(
  state: BattleState,
  side: Side,
  targetUnitId: string,
  weaponIndex: number,
  rules: RulesEdition,
  context: FightOnDeathContext,
): BattleState {
  const pending = currentFightOnDeathWindow(state, side);
  const target = state.units.find(unit => unit.id === targetUnitId && unit.side !== side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!pending || !target || !fightOnDeathWeaponOptions(state, side, targetUnitId, rules, context).some(option => option.weaponIndex === weaponIndex)) return state;
  const next = context.clone(state);
  const selected = next.pendingFightOnDeath?.shift();
  const fightTarget = next.units.find(unit => unit.id === targetUnitId && unit.side !== side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!selected || !fightTarget) return state;
  const fighter = selected.unit;
  next.units = next.units.filter(unit => unit.id !== fighter.id);
  next.units.push(fighter);
  const weapon = fighter.profile.weapons[weaponIndex];
  const logs = [context.log(next, side, fighter.profile.name, `${fighter.profile.name} makes a Fight On Death attack against ${fightTarget.profile.name}:`, 'fight')];
  logs.push(...context.resolveCombatAttacks(fighter, fightTarget, weapon, weaponIndex, rules, next, false, 0, '', { deferCasualties: true }));
  next.units = next.units.filter(unit => unit !== fighter);
  next.log = [...next.log, ...logs, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export function declineFightOnDeath(state: BattleState, side: Side, context: FightOnDeathContext): BattleState {
  const pending = currentFightOnDeathWindow(state, side);
  if (!pending) return state;
  const next = context.clone(state);
  next.pendingFightOnDeath?.shift();
  next.log = [...next.log, context.log(next, side, pending.unit.profile.name, `${pending.unit.profile.name} declines its Fight On Death attack.`, 'fight')];
  return next;
}

export function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: ManualFightResolutionContext): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const foes = context.enemies(state, unit.side).filter(enemy => context.canFightTarget(unit, enemy)
    && context.inEngagement(unit, [enemy], rules.engagementRange()));
  if (!foes.length) return [];
  unit.activated = true;
  context.finishAttachedFightComponent(state, unit, rules);
  const meleeOptions = unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex })).filter(option => option.weapon.isMelee);
  const meleeWeapons = rules.metadata.edition === '11e' ? context.selectMeleeWeapons(unit, meleeOptions, 'all') : context.chooseOneProfilePerGroup(meleeOptions);
  if (!meleeWeapons.length) return [context.log(state, unit.side, unit.profile.name, `${unit.profile.name} is selected to fight but has no melee weapons.`, 'fight')];
  const target = context.nearest(unit, foes);
  if (!target) return [];
  const logs: LogEntry[] = [context.log(state, unit.side, unit.profile.name, `${unit.profile.name} fights ${target.profile.name}:`, 'fight')];
  for (const { weapon, weaponIndex } of meleeWeapons) {
    if (context.aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    logs.push(...context.resolveCombatAttacks(unit, target, weapon, weaponIndex, rules, state, false));
    logs.push(...context.resolveHazardousTests(unit, weapon, weaponIndex, state));
  }
  logs.push(...context.resolvePendingDeadlyDemisesInPlace(state));
  return logs;
}

export interface CombatWoundContext {
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  attachedUnitKeywordSet(state: BattleState, unit: BattleUnit): Set<string>;
}

export function antiKeywordThreshold(
  weapon: WeaponProfile,
  defender: BattleUnit,
  state: BattleState,
  context: CombatWoundContext,
): number | null {
  for (const keyword of weapon.keywords) {
    const match = keyword.match(/^anti[-\s]+(.+?)\s+([2-6])\+$/i);
    if (!match) continue;
    const targetKeyword = match[1].trim().toLowerCase();
    if (context.attachedUnitKeywordSet(state, defender).has(targetKeyword)) return Number.parseInt(match[2], 10);
  }
  return null;
}

export function processWoundsAgainstDefender(
  rolls: number[],
  woundTarget: number,
  weapon: WeaponProfile,
  defender: BattleUnit,
  rules: RulesEdition,
  state: BattleState,
  context: CombatWoundContext,
): { wounds: number; rolls: number[]; mortalsFromCrits: number; devastatingWounds: number; logNote: string } {
  const antiThreshold = antiKeywordThreshold(weapon, defender, state, context);
  if (antiThreshold === null) return rules.processWounds(rolls, woundTarget, weapon);

  let wounds = 0;
  let devastatingWounds = 0;
  const hasDevastatingWounds = context.weaponHasKeyword(weapon, 'Devastating Wounds');
  for (const roll of rolls) {
    if (roll === 1) continue;
    const critical = roll === 6 || roll >= antiThreshold;
    if (critical) {
      if (hasDevastatingWounds) devastatingWounds++;
      else wounds++;
    } else if (roll >= woundTarget) wounds++;
  }
  const notes = [`Anti ${antiThreshold}+ critical wounds`];
  if (hasDevastatingWounds && devastatingWounds > 0) notes.push('critical wound->no save (Devastating Wounds)');
  return { wounds, rolls, mortalsFromCrits: 0, devastatingWounds, logNote: notes.join('; ') };
}

export interface ChargeRulesContext {
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  enemies(state: BattleState, side: Side): BattleUnit[];
  isAircraft(unit: BattleUnit): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  canChargeTarget(unit: BattleUnit, target: BattleUnit): boolean;
  baseEdgeDistance(a: BattleUnit, b: BattleUnit): number;
}

export type ManualChargeRollContext = Record<string, any>;

export function playChargeRoll(
  state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: ManualChargeRollContext,
): BattleState {
  const { attachedUnitComponents, unitSurgedThisPhase, sideCanDeclareCharge, unitCanDeclareCharge, d6, clone, hasKeyword,
    takeToSkiesDistanceCost, recordBattleEvent, BATTLE_EVENT_TYPE, log, playChargeTargetOptions } = context;
  if (state.phase !== 'charge' || state.pendingChargeRoll) return state;
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || attachedUnitComponents(state, unit).some((component: BattleUnit) => unitSurgedThisPhase(state, component))
    || !sideCanDeclareCharge(state, side, unit) || !unitCanDeclareCharge(state, unit)) return state;
  const r1 = d6();
  const r2 = d6();
  const rawRoll = r1 + r2;
  const roll = state.activeArmy !== side && unit.heroicInterventionMode === 'into-the-fray' ? Math.min(6, rawRoll) : rawRoll;
  const next = clone(state);
  const rolledUnit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (rules.metadata.edition === '11e' && hasKeyword(rolledUnit, 'fly')) rolledUnit.takingToSkies = true;
  const maximumDistance = Math.max(0, roll - takeToSkiesDistanceCost(rolledUnit));
  next.lastChargeRoll = { unitId, side, dice: [r1, r2], rawTotal: rawRoll, total: roll, maximumDistance, status: 'pending-target' };
  next.pendingChargeRoll = { unitId, side, maximumDistance };
  recordBattleEvent(next, { type: BATTLE_EVENT_TYPE.DiceRolled, side, source: unitId, data: { rollKind: 'charge', dice: [r1, r2], rawTotal: rawRoll, total: roll, maximumDistance } });
  next.log = [...next.log, log(next, side, unit.profile.name,
    `${unit.profile.name} rolls a charge: ${r1}+${r2}=${roll}${roll !== rawRoll ? ` (capped from ${rawRoll})` : ''}.`, 'charge')];
  if (!playChargeTargetOptions(next, unitId, side, rules).length) {
    for (const component of attachedUnitComponents(next, rolledUnit)) {
      component.activated = true;
      component.takingToSkies = undefined;
    }
    next.pendingChargeRoll = undefined;
    next.lastChargeRoll = { ...next.lastChargeRoll, status: 'failed', failureReason: 'no-reachable-targets' };
    next.log = [...next.log, log(next, side, unit.profile.name, `${unit.profile.name} has no reachable charge targets and cannot charge.`, 'charge')];
  }
  return next;
}

export function completePlayChargeMovement(
  state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: ManualChargeRollContext,
): BattleState {
  const { enemies, attachedUnitComponents, inEngagement, clone, log } = context;
  const pending = state.pendingChargeMovement;
  if (state.phase !== 'charge' || !pending || pending.unitId !== unitId || pending.side !== side) return state;
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const targets = pending.targetUnitIds.map((targetId: string) => state.units.find((candidate: BattleUnit) =>
    candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId)).filter(Boolean);
  if (!unit || targets.length !== pending.targetUnitIds.length || !targets.length
    || targets.some((target: BattleUnit) => !inEngagement(unit, [target], rules.engagementRange()))) return state;
  const declaredTargetIds = new Set(targets.flatMap((target: BattleUnit) => attachedUnitComponents(state, target).map((component: BattleUnit) => component.id)));
  if (enemies(state, side).some((enemy: BattleUnit) => !declaredTargetIds.has(enemy.id) && inEngagement(unit, [enemy], rules.engagementRange()))) return state;
  const next = clone(state);
  const movedUnit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  for (const component of attachedUnitComponents(next, movedUnit)) {
    component.activated = true; component.charged = state.activeArmy === side; component.inCombat = true; component.movementComplete = true;
    component.lastMovePhase = next.phase; component.lastMoveTurn = next.turn; component.movementAllowanceRemaining = 0;
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => 0);
    component.heroicInterventionThisPhase = undefined; component.heroicInterventionMode = undefined;
  }
  for (const target of targets) target.inCombat = true;
  next.pendingChargeMovement = undefined;
  next.log = [...next.log, log(next, side, movedUnit.profile.name,
    `${movedUnit.profile.name} completes its charge against ${targets.map((target: BattleUnit) => target.profile.name).join(', ')}.`, 'charge')];
  return next;
}

export type ChargeTargetOption = { targetId: string; needed: number };

export function chargeNeededDistance(unit: BattleUnit, target: BattleUnit, rules: RulesEdition, context: ChargeRulesContext): number {
  return Math.max(0, context.baseEdgeDistance(unit, target) - rules.engagementRange());
}

export function unitCanDeclareCharge(state: BattleState, unit: BattleUnit, context: ChargeRulesContext): boolean {
  return !unit.destroyed && !unit.embarkedInUnitId && !unit.performingAction && !context.isAircraft(unit)
    && !unit.inCombat && !unit.fellBack && !unit.arrivedFromReinforcements
    && !unit.emergencyDisembarkedThisTurn && !unit.combatDisembarkedThisTurn && !unit.rapidDisembarkedThisTurn
    && unit.movementAction !== 'fellBack'
    && (unit.movementAction !== 'advanced' || state.activeArmyAbilities?.[unit.side]?.includes('waaagh') === true);
}

export function sideCanDeclareCharge(state: BattleState, side: Side, unit: BattleUnit): boolean {
  return state.activeArmy === side || (state.activeArmy !== side && unit.heroicInterventionThisPhase === true);
}

export function playChargeEligibilityReason(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: ChargeRulesContext): string | null {
  if (state.phase !== 'charge') return 'The battle is not in the Charge phase.';
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return 'Select a living unit that is on the battlefield.';
  if (!sideCanDeclareCharge(state, side, unit)) return 'This army cannot declare a charge right now.';
  if (context.attachedComponents(state, unit).some(component => context.unitSurgedThisPhase(state, component))) return 'This unit already surged this phase.';
  if (context.isAircraft(unit)) return 'Aircraft cannot declare charges.';
  if (unit.inCombat) return 'This unit is already in combat.';
  if (unit.fellBack || unit.movementAction === 'fellBack') return 'A unit that fell back cannot charge this phase.';
  if (unit.arrivedFromReinforcements) return 'A unit arriving from Reinforcements cannot charge this phase.';
  if (unit.emergencyDisembarkedThisTurn || unit.combatDisembarkedThisTurn || unit.rapidDisembarkedThisTurn) return 'This unit cannot charge after disembarking this turn.';
  if (unit.performingAction) return 'This unit is performing an action.';
  if (unit.movementAction === 'advanced' && state.activeArmyAbilities?.[side]?.includes('waaagh') !== true) return 'A unit that advanced cannot charge this phase.';
  const candidates = context.enemies(state, side).filter(target => context.canChargeTarget(unit, target));
  if (!candidates.length) return 'There are no eligible enemy units to charge.';
  const needed = candidates.map(target => chargeNeededDistance(unit, target, rules, context));
  if (!needed.some(distance => distance <= rules.chargeRange())) {
    return `The nearest eligible charge requires ${Math.min(...needed).toFixed(1)} inches; the pre-roll charge range is ${rules.chargeRange()} inches.`;
  }
  return null;
}

export function playChargeTargetOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: ChargeRulesContext): ChargeTargetOption[] {
  if (state.phase !== 'charge') return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || context.attachedComponents(state, unit).some(component => context.unitSurgedThisPhase(state, component))
    || !sideCanDeclareCharge(state, side, unit) || !unitCanDeclareCharge(state, unit, context)) return [];
  const pendingRoll = state.pendingChargeRoll?.unitId === unitId && state.pendingChargeRoll.side === side ? state.pendingChargeRoll : undefined;
  return context.enemies(state, side)
    .filter(target => context.canChargeTarget(unit, target)
      && (state.activeArmy === side || (unit.heroicInterventionMode === 'leap-to-defend'
        ? target.charged : unit.heroicInterventionMode === 'into-the-fray' ? context.baseEdgeDistance(unit, target) <= 6 : false)))
    .map(target => ({ targetId: target.id, needed: chargeNeededDistance(unit, target, rules, context) }))
    .filter(option => option.needed <= (pendingRoll?.maximumDistance ?? rules.chargeRange()));
}

export type ManualChargeDeclarationContext = ManualChargeRollContext & {
  chargeRules: ChargeRulesContext;
  findReachablePosition: (...args: any[]) => Position;
  avoidModelOverlap: (...args: any[]) => Position;
  resolveInternalModelOverlaps: (...args: any[]) => void;
  translateFormation: (...args: any[]) => void;
  formationExtent: (...args: any[]) => number;
  centroid: (...args: any[]) => Position;
  modelRotation: (...args: any[]) => number;
  unitTakesToSkiesForState: (...args: any[]) => boolean;
  distance: (...args: any[]) => number;
};

export function chargePlayUnitTargets(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitIds: string[],
  rules: RulesEdition,
  context: ManualChargeDeclarationContext,
): BattleState {
  const { attachedUnitComponents, unitSurgedThisPhase, clone, d6, takeToSkiesDistanceCost, log,
    enemies, inEngagement, findReachablePosition, avoidModelOverlap, resolveInternalModelOverlaps,
    translateFormation, formationExtent, centroid, modelRotation, unitTakesToSkiesForState,
    distance, unitCanChargeTarget, chargeRules } = context;
  if (state.phase !== 'charge') return state;
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const uniqueTargetIds = [...new Set(targetUnitIds)];
  const targets = uniqueTargetIds.map(targetId => state.units.find((candidate: BattleUnit) => candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
    .filter((target): target is BattleUnit => !!target);
  const target = targets[0];
  if (!unit || attachedUnitComponents(state, unit).some((component: BattleUnit) => unitSurgedThisPhase(state, component))
    || !target || targets.length !== uniqueTargetIds.length || uniqueTargetIds.length === 0
    || !sideCanDeclareCharge(state, side, unit) || !unitCanDeclareCharge(state, unit, chargeRules)
    || targets.some(candidate => !unitCanChargeTarget(unit, candidate))
    || (state.activeArmy !== side && (unit.heroicInterventionMode === 'leap-to-defend'
      ? targets.some(candidate => !candidate.charged)
      : unit.heroicInterventionMode === 'into-the-fray' ? targets.some(candidate => chargeRules.baseEdgeDistance(unit, candidate) > 6) : true))) return state;
  const needed = Math.max(...targets.map(candidate => chargeNeededDistance(unit, candidate, rules, chargeRules)));
  const pendingRoll = state.pendingChargeRoll?.unitId === unitId && state.pendingChargeRoll.side === side ? state.pendingChargeRoll : undefined;
  if (needed > (pendingRoll?.maximumDistance ?? rules.chargeRange())) return state;

  const next = clone(state);
  const chargingUnit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const chargeTargets = uniqueTargetIds.map(targetId => next.units.find((candidate: BattleUnit) => candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
    .filter((candidate): candidate is BattleUnit => !!candidate);
  const chargeTarget = chargeTargets[0];
  if (!chargingUnit || !chargeTarget || chargeTargets.length !== uniqueTargetIds.length) return state;
  const r1 = pendingRoll ? undefined : d6();
  const r2 = pendingRoll ? undefined : d6();
  const rawRoll = pendingRoll ? undefined : r1! + r2!;
  const roll = pendingRoll ? undefined : (state.activeArmy !== side && chargingUnit.heroicInterventionMode === 'into-the-fray' ? Math.min(6, rawRoll!) : rawRoll!);
  const maximumDistance = pendingRoll?.maximumDistance ?? Math.max(0, roll! - takeToSkiesDistanceCost(chargingUnit));
  const heroicIntervention = state.activeArmy !== side;
  const logs: LogEntry[] = [log(next, side, chargingUnit.profile.name,
    pendingRoll ? `${chargingUnit.profile.name} declares a charge against ${chargeTargets.map(candidate => candidate.profile.name).join(', ')} (${needed.toFixed(1)}" maximum needed; charge roll already passed).`
      : `${chargingUnit.profile.name} declares a charge against ${chargeTargets.map(candidate => candidate.profile.name).join(', ')} (${needed.toFixed(1)}" maximum needed, rolled ${r1}+${r2}=${roll}${roll !== rawRoll ? ` (capped from ${rawRoll})` : ''}).`, 'charge')];

  if (pendingRoll) {
    for (const component of attachedUnitComponents(next, chargingUnit)) {
      component.movementAction = 'normalMove'; component.movementAllowanceRemaining = maximumDistance;
      component.movementAllowanceRemainingByModel = component.modelPositions.map(() => maximumDistance);
      component.movementAllowanceTotalByModel = component.modelPositions.map(() => maximumDistance);
      component.movementStartPositionsByModel = component.modelPositions.map((position: Position) => ({ ...position }));
      component.movementStartRotationsByModel = component.modelPositions.map((_: Position, modelIndex: number) => modelRotation(component, modelIndex));
      component.movementPathByModel = component.modelPositions.map((position: Position) => [{ ...position }]);
      component.movementComplete = false;
    }
    next.pendingChargeMovement = { unitId, side, targetUnitIds: uniqueTargetIds, maximumDistance };
    next.pendingChargeRoll = undefined;
    if (next.lastChargeRoll?.unitId === unitId && next.lastChargeRoll.side === side) next.lastChargeRoll = { ...next.lastChargeRoll, status: 'resolved' };
    next.log = [...next.log, ...logs, log(next, side, chargingUnit.profile.name, `${chargingUnit.profile.name} must now make its charge move (${maximumDistance.toFixed(1)}" maximum).`, 'charge')];
    return next;
  }
  if (maximumDistance + 0.001 < needed) {
    for (const component of attachedUnitComponents(next, chargingUnit)) {
      component.activated = true; component.heroicInterventionThisPhase = undefined; component.heroicInterventionMode = undefined; component.takingToSkies = undefined;
    }
    logs.push(log(next, side, chargingUnit.profile.name, `${chargingUnit.profile.name} fails the charge.`, 'charge'));
    next.log = [...next.log, ...logs]; next.pendingChargeRoll = undefined;
    if (next.lastChargeRoll?.unitId === unitId && next.lastChargeRoll.side === side) next.lastChargeRoll = { ...next.lastChargeRoll, status: 'failed', failureReason: 'cannot-reach-engagement' };
    return next;
  }

  const d = distance(chargingUnit.position, chargeTarget.position);
  const dirX = d > 0 ? (chargeTarget.position.x - chargingUnit.position.x) / d : 1;
  const dirY = d > 0 ? (chargeTarget.position.y - chargingUnit.position.y) / d : 0;
  const myExtent = formationExtent(chargingUnit.modelPositions, chargingUnit.position, { x: dirX, y: dirY });
  const tgtExtent = formationExtent(chargeTarget.modelPositions, chargeTarget.position, { x: -dirX, y: -dirY });
  const stopGap = rules.engagementRange() + myExtent + tgtExtent + 0.05;
  const reachablePos = findReachablePosition(chargingUnit, chargeTarget.position, maximumDistance, next.terrain, stopGap, unitTakesToSkiesForState(next, chargingUnit));
  const newPos = avoidModelOverlap(chargingUnit, reachablePos, next);
  translateFormation(chargingUnit, newPos.x - chargingUnit.position.x, newPos.y - chargingUnit.position.y);
  resolveInternalModelOverlaps(chargingUnit); chargingUnit.position = centroid(chargingUnit.modelPositions);

  const failCharge = (reason: string, failureReason?: string): BattleState => {
    const failed = clone(state);
    const failedUnit = failed.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side)!;
    for (const component of attachedUnitComponents(failed, failedUnit)) {
      component.activated = true; component.heroicInterventionThisPhase = undefined; component.heroicInterventionMode = undefined; component.takingToSkies = undefined;
    }
    logs.push(log(failed, side, failedUnit.profile.name, reason, 'charge'));
    failed.log = [...failed.log, ...logs]; failed.pendingChargeRoll = undefined;
    if (failureReason && failed.lastChargeRoll?.unitId === unitId && failed.lastChargeRoll.side === side) {
      failed.lastChargeRoll = { ...failed.lastChargeRoll, status: 'failed', failureReason };
    }
    return failed;
  };
  if (chargeTargets.some(candidate => !inEngagement(chargingUnit, [candidate], rules.engagementRange()))) return failCharge(`${chargingUnit.profile.name} cannot reach engagement range.`, 'undeclared-enemy');
  const declaredTargetComponentIds = new Set(chargeTargets.flatMap(candidate => attachedUnitComponents(next, candidate).map((component: BattleUnit) => component.id)));
  if (enemies(next, side).some((enemy: BattleUnit) => !declaredTargetComponentIds.has(enemy.id) && inEngagement(chargingUnit, [enemy], rules.engagementRange()))) {
    return failCharge(`${chargingUnit.profile.name} cannot complete the charge while engaging an undeclared enemy unit.`);
  }
  for (const component of attachedUnitComponents(next, chargingUnit)) {
    component.activated = true; component.charged = !heroicIntervention; component.heroicInterventionThisPhase = undefined;
    component.heroicInterventionMode = undefined; component.inCombat = true; component.lastMovePhase = next.phase; component.lastMoveTurn = next.turn; component.takingToSkies = undefined;
  }
  for (const chargeTargetUnit of chargeTargets) chargeTargetUnit.inCombat = true;
  logs.push(log(next, side, chargingUnit.profile.name, `${chargingUnit.profile.name} makes a successful${state.activeArmy !== side ? ' Heroic Intervention' : ''} charge.`, 'charge'));
  next.log = [...next.log, ...logs]; next.pendingChargeRoll = undefined;
  if (next.lastChargeRoll?.unitId === unitId && next.lastChargeRoll.side === side) next.lastChargeRoll = { ...next.lastChargeRoll, status: 'resolved' };
  return next;
}

export interface FightPhaseContext {
  activeUnits(state: BattleState, side: Side): BattleUnit[];
  enemies(state: BattleState, side: Side): BattleUnit[];
  canFightTarget(unit: BattleUnit, target: BattleUnit): boolean;
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
  unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  unitWasEngagedAtFightStepStart(state: BattleState, unit: BattleUnit): boolean;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  attachedUnitId(unit: BattleUnit): string;
  attachedUnitHasRule(state: BattleState, unit: BattleUnit, rule: string): boolean;
  unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: string): boolean;
}

export function startFightStepInPlace(state: BattleState, rules: RulesEdition, context: FightPhaseContext): void {
  state.fightStepStarted = true;
  state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = undefined;
  state.activeAttachedFightUnitId = undefined;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
  state.engagedUnitIdsAtFightStepStart = state.units.filter(unit => !unit.destroyed && !unit.embarkedInUnitId
    && context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()))).map(unit => unit.id);
}

export function unitHasCounteroffensive(state: BattleState, unit: BattleUnit, context: FightPhaseContext): boolean {
  return context.unitHasActiveStratagem(state, unit, 'counteroffensive', 'fight');
}

export function unitHasFightsFirst(state: BattleState, unit: BattleUnit, context: FightPhaseContext): boolean {
  return unit.charged || unitHasCounteroffensive(state, unit, context) || context.attachedUnitHasRule(state, unit, 'Fights First');
}

export function finishAttachedFightComponent(state: BattleState, unit: BattleUnit, rules: RulesEdition, context: FightPhaseContext): void {
  if (rules.metadata.edition !== '11e') return;
  const remaining = context.attachedComponents(state, unit).filter(component => !component.activated && context.unitEligibleToFight(component, state, rules));
  if (remaining.length) { state.activeAttachedFightUnitId = context.attachedUnitId(unit); return; }
  state.activeAttachedFightUnitId = undefined;
  const forcedUnit = state.units.find(candidate => candidate.id === state.forcedFightUnitId);
  if (forcedUnit && context.attachedUnitId(forcedUnit) === context.attachedUnitId(unit)) state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = unit.side;
}

export function sideCanSelectFightUnit(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): boolean {
  return state.phase === 'fight' && (rules.metadata.edition === '11e' || state.activeArmy === side
    || context.activeUnits(state, side).some(unit => unitHasCounteroffensive(state, unit, context)));
}

export function playFightActivationUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): string[] {
  if (!sideCanSelectFightUnit(state, side, rules, context)) return [];
  const eligible = context.activeUnits(state, side).filter(unit => context.unitEligibleToFight(unit, state, rules));
  if (rules.metadata.edition === '11e' && state.activeAttachedFightUnitId) return eligible.filter(unit => context.attachedUnitId(unit) === state.activeAttachedFightUnitId).map(unit => unit.id);
  if (state.forcedFightUnitId) {
    const forced = state.units.find(unit => unit.id === state.forcedFightUnitId);
    if (!forced || forced.side !== side) return [];
    return eligible.filter(unit => context.attachedUnitId(unit) === context.attachedUnitId(forced)).map(unit => unit.id);
  }
  if (rules.metadata.edition !== '11e' && state.activeArmy !== side) return eligible.filter(unit => unitHasCounteroffensive(state, unit, context)).map(unit => unit.id);
  if (rules.metadata.edition === '11e') {
    const allEligible = state.units.filter(unit => context.unitEligibleToFight(unit, state, rules));
    const counteroffensive = allEligible.filter(unit => unitHasCounteroffensive(state, unit, context));
    const priorityEligible = counteroffensive.length ? counteroffensive : allEligible.some(unit => unitHasFightsFirst(state, unit, context))
      ? allEligible.filter(unit => unitHasFightsFirst(state, unit, context)) : allEligible;
    const preferredSide = state.lastFightSelectionSide === undefined ? state.activeArmy : (state.lastFightSelectionSide === 0 ? 1 : 0) as Side;
    const selectingSide = priorityEligible.some(unit => unit.side === preferredSide) ? preferredSide : (preferredSide === 0 ? 1 : 0) as Side;
    return side === selectingSide ? priorityEligible.filter(unit => unit.side === side).map(unit => unit.id) : [];
  }
  const counteroffensive = eligible.filter(unit => unitHasCounteroffensive(state, unit, context));
  if (counteroffensive.length) return counteroffensive.map(unit => unit.id);
  const fightsFirst = eligible.filter(unit => unitHasFightsFirst(state, unit, context));
  return (fightsFirst.length ? fightsFirst : eligible).map(unit => unit.id);
}

export function playFightFirstUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): string[] {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight' || state.fightStepStarted !== true) return [];
  return context.activeUnits(state, side).filter(unit => context.unitEligibleToFight(unit, state, rules) && unitHasFightsFirst(state, unit, context)).map(unit => unit.id);
}

export function playOverrunFightUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): string[] {
  if (rules.metadata.edition !== '11e' || state.fightStepStarted !== true) return [];
  return playFightActivationUnitIds(state, side, rules, context).filter(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
    if (!unit || unit.overrunFightSelected) return false;
    const engaged = context.enemies(state, side).some(enemy => context.canFightTarget(unit, enemy) && context.inEngagement(unit, [enemy], rules.engagementRange()));
    return !engaged || (!context.unitWasEngagedAtFightStepStart(state, unit) && engaged);
  });
}

export function resolveCombatAttacks(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  state: BattleState,
  hasCover: boolean,
  hitModifier = 0,
  hitModifierNote = '',
  options: CombatAttackResolutionOptions = {},
  context: CombatAttackContext,
): LogEntry[] {
  const { dist, battleUnitToAttachedUnitDistance, activeEpicChallengeModelIndex, participatingWeaponModelIndexes, unitHasRule, attachedUnitIsFormed, attachedUnitHasRule, attachedUnitComponents, leadingAttackModifiers, leadingRerolls, leadingWeaponKeywords, unitGrantedWeaponKeywords, auraAbilitiesInRange, attachedUnitRemainingModels, attackingModelToAttachedUnitDistance, weaponHasKeyword, weaponKeywordValue, log, attachedUnitToughness, rollExpression, hasAnyModelLOS, modelBaseRadius, attackingModelHasPlungingFire, targetVisibleToFriendlyUnit, rollMultiple, d6, processWoundsAgainstDefender, attachedInvulnerableSave, rangedSaveModifier, resolveSaveOutcome, applyDamage, objectiveIndexesWithinRange, recordBattleEvent, BATTLE_EVENT_TYPE } = context;
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

  const participatingModelIndexes = options.modelIndexes
    ?? participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, state.terrain, state);
  const weaponModelCount = participatingModelIndexes.length;
  if (weaponModelCount <= 0) return logs;
  const waaaghActive = rules.metadata.edition === '11e'
    && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
    && unitHasRule(attacker.profile, 'Waaagh!');
  const waaaghMeleeBonus = waaaghActive && weapon.isMelee ? 1 : 0;
  const getStuckIn = rules.metadata.edition === '11e'
    && weapon.isMelee
    && attacker.profile.factionKeywords.some(keyword => keyword.toLowerCase().replace(/^faction:\s*/, '') === 'orks')
    && state.armies[attacker.side].army.catalog?.rules?.some(rule => rule.name === 'Get Stuck In') === true;
  const resolutionWeapon = getStuckIn
    ? { ...weapon, keywords: [...weapon.keywords, 'Sustained Hits 1'] }
    : weapon;
  const prophetActive = rules.metadata.edition === '11e'
    && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
    && attachedUnitIsFormed(state, attacker)
    && attachedUnitHasRule(state, attacker, 'Prophet of Da Great Waaagh!');
  const leadingModifiers = rules.metadata.edition === '11e'
    ? leadingAttackModifiers(state, attacker, weapon)
    : { hit: 0, wound: 0, strength: 0, attacks: 0 };
  const leadingRerollRules = rules.metadata.edition === '11e'
    ? leadingRerolls(state, attacker)
    : { hit: false, wound: false };
  const derivedLeadingKeywords = rules.metadata.edition === '11e'
    ? [...leadingWeaponKeywords(state, attacker, weapon), ...unitGrantedWeaponKeywords(state, attacker, weapon)]
    : [];
  const bannerAuraActive = rules.metadata.edition === '11e'
    && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
    && attacker.profile.factionKeywords.some(keyword => keyword.toLowerCase().replace(/^faction:\s*/, '') === 'orks')
    && auraAbilitiesInRange(state, attacker).some(application => application.rule.name.toLowerCase().includes('banner'));
  const leadingWeapon = derivedLeadingKeywords.length
    ? { ...resolutionWeapon, keywords: [...resolutionWeapon.keywords, ...derivedLeadingKeywords] }
    : resolutionWeapon;
  const ghazghkullWeapon = prophetActive
    ? { ...leadingWeapon, keywords: [...leadingWeapon.keywords, 'Critical Hits 5+'] }
    : leadingWeapon;
  const bannerWeapon = bannerAuraActive
    ? { ...ghazghkullWeapon, keywords: [...ghazghkullWeapon.keywords, 'Lethal Hits'] }
    : ghazghkullWeapon;
  hitModifier += leadingModifiers.hit;
  if (prophetActive) hitModifier -= 1;
  const isVariableAttacks = !/^\d+$/i.test(String(weapon.attacks).trim());
  const perModelRolls: number[] = [];
  for (let i = 0; i < weaponModelCount; i++) {
    perModelRolls.push(rollExpression(weapon.attacks).total + waaaghMeleeBonus + (weapon.isMelee ? leadingModifiers.attacks : 0));
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
    `  ${weapon.isMelee ? 'âš”ï¸' : 'ðŸ”«'} ${weapon.name} â€” ${weaponModelCount} model(s) Ã— ${weapon.attacks} = ${numAttacks} attacks vs ${defender.profile.name}`,
    weapon.isMelee ? 'fight' : 'shoot',
  ));
  if (options.result) options.result.attackCount = numAttacks;
  const effectiveStrength = weapon.strength + waaaghMeleeBonus + (weapon.isMelee ? leadingModifiers.strength : 0);
  logs.push(log(state, attacker.side, attacker.profile.name,
    `[combat-stats] skill=${weapon.skill} s=${effectiveStrength} ap=${weapon.ap} d=${weapon.damage} t=${attachedUnitToughness(state, defender)}${hasCover ? ' cover=1' : ''}`,
    'info',
  ));
  if (options.attackCountOverride !== undefined) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Split ${weapon.isMelee ? 'melee' : 'ranged'} attacks: ${options.attackCountOverride} attack(s) declared against ${defender.profile.name}`,
      'info',
    ));
  }
  if (isVariableAttacks) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Attack rolls (${weapon.attacks}): [${perModelRolls.join(', ')}] = ${numAttacks} attacks`,
      'roll',
    ));
  }

  // â”€â”€ Hit rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          ? hasAnyModelLOS(position, modelBaseRadius(attacker, modelIndex), defender, state.terrain, state.ruleset?.edition)
          : false;
        return total + (attackingModelHasPlungingFire(state, attacker, modelIndex, defender, visible)
          ? perModelAttackCounts[index]
          : 0);
      }, 0);
    const hitRolls = rollMultiple(numAttacks);
    const plungingRolls = hitRolls.slice(0, plungingAttackCount);
    const normalRolls = hitRolls.slice(plungingAttackCount);
    const indirectHitTarget = rules.metadata.edition === '11e' && weaponHasKeyword(weapon, 'Indirect Fire')
      ? (attacker.movementAction === 'remainedStationary' && targetVisibleToFriendlyUnit(state, defender, attacker.side) ? 4 : 7)
      : undefined;
    const normalTarget = indirectHitTarget ?? (options.snapShooting ? 6 : Math.min(6, Math.max(2, weapon.skill + hitModifier)));
    const plungingTarget = indirectHitTarget ?? Math.min(6, Math.max(2, weapon.skill - 1 + hitModifier));
    if (indirectHitTarget !== undefined) {
      logs.push(log(state, attacker.side, attacker.profile.name,
        indirectHitTarget === 4
          ? '     Indirect Fire: unmodified 4+ hit while stationary and target is visible to a friendly unit'
          : '     Indirect Fire: only unmodified 6s hit',
        'info',
      ));
    }
    const hitPools = [
      ...(plungingRolls.length ? [{ rolls: plungingRolls, target: plungingTarget, plunging: true }] : []),
      ...(normalRolls.length ? [{ rolls: normalRolls, target: normalTarget, plunging: false }] : []),
    ];
    const results = hitPools.map(pool => {
      const rolls = leadingRerollRules.hit
        ? pool.rolls.map(roll => roll < pool.target ? d6() : roll)
        : pool.rolls;
      return { ...pool, rolls, result: rules.processHits(rolls, pool.target, bannerWeapon) };
    });
    hitResult = {
      hits: results.reduce((total, pool) => total + pool.result.hits, 0),
      rolls: hitRolls,
      mortalsFromCrits: results.reduce((total, pool) => total + pool.result.mortalsFromCrits, 0),
      logNote: results.map(pool => pool.result.logNote).filter(Boolean).join('; '),
    };
    lethalAutoWounds = weaponHasKeyword(bannerWeapon, 'Lethal Hits')
      ? hitRolls.filter(roll => roll === 6).length
      : 0;
    for (const pool of results) {
      options.result?.groups.push({ kind: 'hit', rolls: [...pool.rolls], target: pool.target, successes: pool.result.hits });
      const noteHit = pool.result.logNote ? ` [${pool.result.logNote}]` : '';
      const plungingNote = pool.plunging ? '; Plunging Fire improves BS by 1' : '';
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Hit rolls (${pool.target}+${plungingNote}): [${pool.rolls.join(', ')}] â†’ ${pool.result.hits} hits${noteHit}`,
        'roll',
      ));
    }

  }

  // Mortal wounds from critical hits (e.g. Deadly Demise)
  let totalMortals = hitResult.mortalsFromCrits;
  let devastatingWounds = 0;

  if (hitResult.hits === 0 && totalMortals === 0) return logs;

  // â”€â”€ Wound rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const targetToughness = attachedUnitToughness(state, defender);
  const lanceApplies = rules.metadata.edition === '11e'
    && weapon.isMelee
    && weaponHasKeyword(weapon, 'Lance')
    && attachedUnitComponents(state, attacker).some(component => component.charged);
  const prophetWoundBonus = prophetActive ? 1 : 0;
  const wt = Math.max(2, rules.woundTarget(effectiveStrength, targetToughness) - (lanceApplies ? 1 : 0) - prophetWoundBonus - leadingModifiers.wound);
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
    const initialWoundRolls = rollMultiple(woundRollCount);
    const woundRolls = leadingRerollRules.wound
      ? initialWoundRolls.map(roll => roll < wt ? d6() : roll)
      : initialWoundRolls;
    const woundResult = processWoundsAgainstDefender(woundRolls, wt, weapon, defender, rules, state);
    const noteWound = woundResult.logNote ? ` [${woundResult.logNote}]` : '';
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Wound rolls (S${effectiveStrength} vs T${targetToughness}, ${wt}+): [${woundRolls.join(', ')}] â†’ ${woundResult.wounds} wounds${noteWound}`,
      'roll',
    ));
    options.result?.groups.push({ kind: 'wound', rolls: [...woundRolls], target: wt, successes: woundResult.wounds });
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
      options.result?.groups.push({ kind: 'wound', rolls: [...rerollWounds], target: wt, successes: rerollResult.wounds });
      woundCount += rerollResult.wounds;
      totalMortals += rerollResult.mortalsFromCrits;
      devastatingWounds += rerollResult.devastatingWounds;
    }
  }

  // â”€â”€ Save rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let unsaved = 0;
  if (woundCount > 0) {
    const coverBonus = hasCover && !weaponHasKeyword(weapon, 'Ignores Cover')
      ? rules.metadata.edition === '11e' ? 0 : rules.coverSaveBonus(defender)
      : 0;
    const waaaghInvulnSave = rules.metadata.edition === '11e'
      && state.activeArmyAbilities?.[defender.side]?.includes('waaagh') === true
      && unitHasRule(defender.profile, 'Waaagh!')
      ? 5
      : undefined;
    const derivedInvulnSave = attachedInvulnerableSave(state, defender, weapon);
    const effectiveInvulnSave = waaaghInvulnSave === undefined
      ? Math.min(defender.profile.invulnSave ?? 7, derivedInvulnSave ?? 7) === 7
        ? undefined
        : Math.min(defender.profile.invulnSave ?? 7, derivedInvulnSave ?? 7)
      : Math.min(defender.profile.invulnSave ?? 7, waaaghInvulnSave);
    const saveModifier = rangedSaveModifier(state, defender, weapon);
    const rawSave = rules.saveTarget(defender.profile.save - saveModifier, weapon.ap, effectiveInvulnSave);
    const effectiveSave = rawSave - coverBonus;
    const coverNote = coverBonus > 0 ? `, cover +${coverBonus}` : '';

    if (effectiveSave > 6) {
      logs.push(log(state, defender.side, defender.profile.name,
        `     No save possible (${defender.profile.save}+ vs AP${weapon.ap})`,
        'roll',
      ));
      unsaved = woundCount;
      options.result?.groups.push({ kind: 'save', rolls: [], target: effectiveSave, successes: woundCount, noSave: true });
    } else {
      const saveRolls = rollMultiple(woundCount);
      const outcome = resolveSaveOutcome(woundCount, effectiveSave, saveRolls);
      const saved = outcome.saved;
      unsaved = outcome.unsaved;
      options.result?.groups.push({ kind: 'save', rolls: [...saveRolls], target: effectiveSave, successes: outcome.saved });
      logs.push(log(state, defender.side, defender.profile.name,
        `     Save rolls (${effectiveSave}+${coverNote}): [${saveRolls.join(', ')}] â†’ ${saved} saved, ${unsaved} failed`,
        'roll',
      ));
    }
  }

  // â”€â”€ Damage application â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      const damage = Math.max(1, dmgResult.total + meltaBonus);
      options.result?.groups.push({ kind: 'damage', rolls: [...dmgResult.rolls], successes: damage });
      if (isVariableDamage) {
        logs.push(log(state, attacker.side, attacker.profile.name,
          `     Damage roll (${weapon.damage}): [${dmgResult.rolls.join(', ')}] = ${dmgResult.total}`,
          'roll',
        ));
      }
      logs.push(...applyDamage(defender, damage, state, attacker.side, {
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
      const damage = Math.max(1, dmgResult.total + meltaBonus);
      options.result?.groups.push({ kind: 'damage', rolls: [...dmgResult.rolls], successes: damage });
      if (isVariableDamage) {
        logs.push(log(state, attacker.side, attacker.profile.name,
          `     Damage roll (${weapon.damage}): [${dmgResult.rolls.join(', ')}] = ${dmgResult.total}`,
          'roll',
        ));
      }
      logs.push(...applyDamage(defender, damage, state, attacker.side, {
        ...damageOptions,
        noCarryOver: true,
        source: weapon.name,
        sourceUnitId: attacker.id,
        sourceObjectiveIndexesWithinRange: objectiveIndexesWithinRange(state, attacker, rules),
      }));
    }
  }

  // â”€â”€ Mortal wounds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  recordBattleEvent(state, {
    type: BATTLE_EVENT_TYPE.AttackResolved,
    side: attacker.side,
    source: attacker.id,
    data: {
      weaponIndex,
      weaponName: weapon.name,
      targetUnitId: defender.id,
      attackCount: numAttacks,
      hits: hitResult.hits,
      wounds: woundCount,
      unsavedWounds: unsaved,
      mortalWounds: totalMortals,
      devastatingWounds,
      ...(options.result ? { groups: options.result.groups } : {}),
    },
  });

  return logs;
}
