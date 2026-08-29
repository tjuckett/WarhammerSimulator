// Manual attack resolution and its progressively narrowed simulator facade context.
// @ts-nocheck
import { type BattleState, type BattleUnit, type LogEntry, type PendingFightOnDeath, type Position, type ShootingWeaponResult, type Side } from '../types/battle';
import type { UnitProfile, WeaponProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import type {
  CombatAttackResolutionOptions,
  CombatHitCalculation,
  CombatHitModifier,
  CombatHitPreview,
  CombatHitPreviewGroup,
} from './combatTypes';
import { moveModelTowardPoint } from './interactiveMovement';

export type CombatAttackContext = Record<string, any>;

export function applyFeelNoPain(unit: BattleUnit, damage: number, state: BattleState, context: Record<string, any>): { damage: number; logs: LogEntry[] } {
  const target = context.attachedUnitComponents(state, unit)
    .flatMap((component: BattleUnit) => context.feelNoPainTargets(component)
      .filter((rule: any) => component.id === unit.id || rule.sharesWithAttachedUnit)
      .map((rule: any) => rule.target))
    .filter((value: number | null): value is number => value !== null)
    .sort((a: number, b: number) => a - b)[0] ?? null;
  if (!target || damage <= 0) return { damage, logs: [] };
  const rolls = context.rollMultiple(damage);
  const outcome = context.resolveFeelNoPainOutcome(damage, target, rolls);
  return {
    damage: outcome.damage,
    logs: [context.log(state, unit.side, unit.profile.name,
      `     Feel No Pain (${target}+): [${rolls.join(', ')}] -> ${outcome.ignored} ignored, ${outcome.damage} damage remains`, 'roll')],
  };
}

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
  /** Number of models carrying this weapon that can contribute to at least one listed target. */
  modelCount?: number;
  /** Eligible model count for each target, used by the UI and AI allocation layer. */
  targetModelCounts?: Record<string, number>;
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
  participatingWeaponModelIndexes?(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number[];
}

export type ShootingSelectionRulesContext = Record<string, any>;

export function unitCanUseBigGunsNeverTire(unit: BattleUnit, context: ShootingSelectionRulesContext): boolean {
  return context.unitHasKeyword(unit, 'Vehicle') || context.unitHasKeyword(unit, 'Monster');
}

export function weaponIsCloseQuarters(weapon: WeaponProfile, context: ShootingSelectionRulesContext): boolean {
  return context.weaponHasKeyword(weapon, 'Close-Quarters');
}

export interface ShootingResolutionContext extends ShootingSelectionRulesContext {
  targetHasTerrainCoverFrom(state: BattleState, unit: BattleUnit, target: BattleUnit): boolean;
  targetHasTerrainCoverFromModel(state: BattleState, unit: BattleUnit, modelIndex: number, target: BattleUnit): boolean;
  targetIsScreenedBySmoke(state: BattleState, unit: BattleUnit, target: BattleUnit): boolean;
  hasAnyModelLOSConsideringHidden(state: BattleState, unit: BattleUnit, target: BattleUnit): boolean;
  targetVisibleToFriendlyUnit(state: BattleState, target: BattleUnit, side: Side): boolean;
  attachedUnitHasRule(state: BattleState, unit: BattleUnit, rule: string): boolean;
  attachedUnitIsFormed(state: BattleState, unit: BattleUnit): boolean;
  leadingAttackModifiers(state: BattleState, unit: BattleUnit, weapon: WeaponProfile): { hit: number; wound: number; strength: number; attacks: number };
  unitHasRule(profile: UnitProfile, rule: string): boolean;
  targetWithinFriendlyEngagement(state: BattleState, target: BattleUnit, side: Side, rules: RulesEdition): boolean;
  unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: string): boolean;
  markRangedAttackMade(unit: BattleUnit): void;
  markOneShotWeaponSpent(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number): void;
  participatingWeaponModelIndexes(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number[];
  participatingWeaponModelCount(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number;
  resolveCombatAttacks(attacker: BattleUnit, defender: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, state: BattleState, hasCover: boolean, hitModifier: number, hitModifierNote: string, options: object): LogEntry[];
  resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState, testCount: number): LogEntry[];
  log(state: BattleState, side: Side, source: string, message: string, kind: string): LogEntry;
}

interface ShootingCoverRules {
  alwaysHasCover: boolean;
  usesIndirectFirePenalty: boolean;
  usesIndirectFireCover: boolean;
  usesSmokescreen: boolean;
}

interface CombatHitCalculationOptions {
  hasCover: boolean;
  snapShooting?: boolean;
  plunging?: boolean;
  additionalHitModifier?: number;
  additionalHitModifierNote?: string;
}

function shootingCoverRules(
  state: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
  context: ShootingResolutionContext,
): ShootingCoverRules {
  const usesIndirectFirePenalty = context.weaponHasKeyword(weapon, 'Indirect Fire')
    && rules.metadata.edition !== '11e'
    && !context.hasAnyModelLOSConsideringHidden(state, attacker, defender);
  const usesIndirectFireCover = context.weaponHasKeyword(weapon, 'Indirect Fire')
    && (rules.metadata.edition === '11e' || usesIndirectFirePenalty);
  const usesSmokescreen = context.unitHasActiveStratagem(state, defender, 'smokescreen', 'shooting')
    || context.targetIsScreenedBySmoke(state, attacker, defender);
  return {
    alwaysHasCover: usesIndirectFireCover || usesSmokescreen,
    usesIndirectFirePenalty,
    usesIndirectFireCover,
    usesSmokescreen,
  };
}

function formatHitModifierForLog(modifier: CombatHitModifier): string {
  if (modifier.requiredRollModifier > 0) return `${modifier.label} -${modifier.requiredRollModifier} to Hit`;
  if (modifier.requiredRollModifier < 0) return `${modifier.label} +${Math.abs(modifier.requiredRollModifier)} to Hit`;
  return modifier.label;
}

/**
 * Calculates the required hit roll without rolling dice. This is deliberately
 * shared by the pre-roll query and the authoritative attack resolver so the
 * UI cannot drift from the rules engine.
 */
function calculateCombatHit(
  state: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
  options: CombatHitCalculationOptions,
  context: ShootingResolutionContext,
): CombatHitCalculation {
  const modifiers: CombatHitModifier[] = [];
  const addModifier = (label: string, requiredRollModifier: number) => {
    if (requiredRollModifier !== 0) modifiers.push({ label, requiredRollModifier });
  };
  const hasCover = options.hasCover;
  const snapShooting = options.snapShooting ?? false;
  const shootingRules = !weapon.isMelee ? shootingCoverRules(state, attacker, defender, weapon, rules, context) : null;
  const isIndirectFire = !weapon.isMelee && context.weaponHasKeyword(weapon, 'Indirect Fire');
  const indirectHitTarget = isIndirectFire && rules.metadata.edition === '11e'
    ? attacker.movementAction === 'remainedStationary' && context.targetVisibleToFriendlyUnit(state, defender, attacker.side)
      ? 4
      : 7
    : undefined;
  const autoHits = context.weaponHasKeyword(weapon, 'Torrent');

  let specialRule: string | undefined;
  if (autoHits) {
    specialRule = 'Torrent: auto-hits';
  } else if (snapShooting) {
    specialRule = 'Snap Shooting: unmodified 6s only';
  } else if (indirectHitTarget !== undefined) {
    specialRule = indirectHitTarget === 4
      ? 'Indirect Fire: unmodified 4+ while stationary and visible to a friendly unit'
      : 'Indirect Fire: only unmodified 6s hit';
  } else {
    if (shootingRules) {
      const foes = context.enemies(state, attacker.side);
      const engaged = context.inEngagement(attacker, foes, rules.engagementRange());
      const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(attacker, context);
      const closeQuartersTarget = rules.metadata.edition === '11e'
        && weaponIsCloseQuarters(weapon, context)
        && context.inEngagement(attacker, [defender], rules.engagementRange());
      const targetIsEngagedMonsterOrVehicle = context.targetWithinFriendlyEngagement(state, defender, attacker.side, rules)
        && unitCanUseBigGunsNeverTire(defender, context);
      if (bigGunsNeverTire && !closeQuartersTarget && !context.weaponIsSidearm(weapon)) {
        addModifier('Big Guns Never Tire', 1);
      }
      if (targetIsEngagedMonsterOrVehicle && !closeQuartersTarget) {
        addModifier('Engaged Monster/Vehicle', 1);
      }
      if (context.weaponHasKeyword(weapon, 'Heavy') && attacker.movementAction === 'remainedStationary') {
        addModifier('Heavy', -1);
      }
      if (shootingRules.usesIndirectFirePenalty) {
        addModifier('Indirect Fire', 1);
      }
      if (context.attachedUnitHasRule(state, defender, 'Stealth')) {
        addModifier('Stealth', 1);
      }
      if (rules.metadata.edition === '11e' && hasCover && !context.weaponHasKeyword(weapon, 'Ignores Cover')) {
        addModifier('Benefit of Cover', 1);
      }
    }

    const damagedProfile = attacker.profile.damagedProfile;
    const damagedHitModifier = damagedProfile
      && attacker.remainingModels === 1
      && attacker.woundsOnLeadModel <= damagedProfile.maxRemainingWounds
      ? damagedProfile.hitRollModifier ?? 0
      : 0;
    addModifier('Damaged profile', damagedHitModifier);

    const leadingModifiers = rules.metadata.edition === '11e'
      ? context.leadingAttackModifiers(state, attacker, weapon)
      : { hit: 0, wound: 0, strength: 0, attacks: 0 };
    addModifier('Leading unit', leadingModifiers.hit);

    const prophetActive = rules.metadata.edition === '11e'
      && state.activeArmyAbilities?.[attacker.side]?.includes('waaagh') === true
      && context.attachedUnitIsFormed(state, attacker)
      && context.attachedUnitHasRule(state, attacker, 'Prophet of Da Great Waaagh!');
    if (prophetActive) addModifier('Prophet of Da Great Waaagh!', -1);
    if (options.plunging && !weapon.isMelee) addModifier('Plunging Fire', -1);
  }

  const requiredRollModifier = modifiers.reduce((total, modifier) => total + modifier.requiredRollModifier, 0)
    + (options.additionalHitModifier ?? 0);
  if (options.additionalHitModifier) {
    modifiers.push({
      label: options.additionalHitModifierNote || 'Additional modifier',
      requiredRollModifier: options.additionalHitModifier,
    });
  }
  const requiredHit = autoHits
    ? null
    : snapShooting
      ? 6
      : indirectHitTarget !== undefined
        ? indirectHitTarget
        : Math.min(6, Math.max(2, weapon.skill + requiredRollModifier));
  const coverSaveModifier = hasCover && !context.weaponHasKeyword(weapon, 'Ignores Cover')
    ? rules.metadata.edition === '11e' ? 0 : rules.coverSaveBonus(defender)
    : 0;
  const hitProbability = autoHits
    ? 1
    : requiredHit === null
      ? 0
      : requiredHit > 6
        ? 1 / 6
        : Math.max(0, (7 - requiredHit) / 6);
  return {
    baseSkill: weapon.skill,
    requiredRollModifier,
    requiredHit,
    modifiers,
    hasCover,
    coverSaveModifier,
    autoHits,
    hitProbability,
    specialRule,
  };
}

/** Return the authoritative pre-roll hit/cover breakdown for one declaration. */
export function previewCombatHit(
  state: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  options: { modelIndexes?: number[]; snapShooting?: boolean } = {},
  context: ShootingResolutionContext,
): CombatHitPreview {
  const modelIndexes = [...new Set(options.modelIndexes
    ?? context.participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, state.terrain, state))]
    .filter(modelIndex => !!attacker.modelPositions[modelIndex]);
  const coverRules = !weapon.isMelee ? shootingCoverRules(state, attacker, defender, weapon, rules, context) : null;
  const groupMap = new Map<string, { modelIndexes: number[]; hasCover: boolean; plunging: boolean }>();
  for (const modelIndex of modelIndexes) {
    const position = attacker.modelPositions[modelIndex];
    const visible = !weapon.isMelee && !options.snapShooting && !!position
      ? context.hasAnyModelLOS(position, context.modelBaseRadius(attacker, modelIndex), defender, state.terrain, state.ruleset?.edition)
      : false;
    const plunging = !weapon.isMelee && !options.snapShooting && visible
      && context.attackingModelHasPlungingFire(state, attacker, modelIndex, defender, visible);
    const hasCover = !weapon.isMelee && !!coverRules
      && (coverRules.alwaysHasCover || context.targetHasTerrainCoverFromModel(state, attacker, modelIndex, defender));
    const key = `${hasCover ? 'cover' : 'open'}:${plunging ? 'plunging' : 'normal'}`;
    const group = groupMap.get(key) ?? { modelIndexes: [], hasCover, plunging };
    group.modelIndexes.push(modelIndex);
    groupMap.set(key, group);
  }
  const groups: CombatHitPreviewGroup[] = [...groupMap.values()].map(group => ({
    ...calculateCombatHit(state, attacker, defender, weapon, rules, {
      hasCover: group.hasCover,
      snapShooting: options.snapShooting,
      plunging: group.plunging,
    }, context),
    modelIndexes: group.modelIndexes,
    plunging: group.plunging,
  }));
  const coveredModelCount = groups.reduce((total, group) => total + (group.hasCover ? group.modelIndexes.length : 0), 0);
  const coverStatus = coveredModelCount === 0
    ? 'none'
    : coveredModelCount === modelIndexes.length
      ? 'all'
      : 'mixed';
  const hitTokens = groups.map(group => group.autoHits ? 'auto' : String(group.requiredHit));
  const hitTargetVaries = new Set(hitTokens).size > 1;
  const commonHitTarget = !hitTargetVaries && groups.length > 0 && !groups[0].autoHits
    ? groups[0].requiredHit ?? undefined
    : undefined;
  const commonCoverSaveModifier = groups.length > 0 && groups.every(group => group.coverSaveModifier === groups[0].coverSaveModifier)
    ? groups[0].coverSaveModifier
    : null;
  const weightedHitProbability = modelIndexes.length > 0
    ? groups.reduce((total, group) => total + group.hitProbability * group.modelIndexes.length, 0) / modelIndexes.length
    : 0;
  return {
    weaponIndex,
    weaponName: weapon.name,
    targetUnitId: defender.id,
    targetUnitName: defender.profile.name,
    modelIndexes,
    coverStatus,
    groups,
    commonHitTarget,
    hitTargetVaries,
    autoHits: groups.length > 0 && groups.every(group => group.autoHits),
    commonCoverSaveModifier,
    hitProbability: weightedHitProbability,
  };
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

export function targetIsScreenedBySmoke(state: BattleState, attacker: BattleUnit, target: BattleUnit, context: ShootingSelectionRulesContext): boolean {
  const smokeUnits = state.units.filter(unit =>
    unit.side === target.side
    && unit.id !== target.id
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && context.unitHasActiveStratagem(state, unit, 'smokescreen', 'shooting'),
  );
  return attacker.modelPositions.some(from => target.modelPositions.some(to =>
    smokeUnits.some(smokeUnit => smokeUnit.modelPositions.some((smokeModel, modelIndex) =>
      linePassesThroughModel(from, to, smokeModel, context.modelBaseRadius(smokeUnit, modelIndex))))));
}

export function createCombatWeaponResult(unit: BattleUnit, target: BattleUnit, weapon: { name: string }, weaponIndex: number): ShootingWeaponResult {
  return {
    weaponIndex,
    weaponName: weapon.name,
    targetUnitId: target.id,
    targetUnitName: target.profile.name,
    attackCount: 0,
    hits: 0,
    wounds: 0,
    unsavedWounds: 0,
    groups: [],
  };
}

export function finalizeCombatWeaponResult(result: ShootingWeaponResult): ShootingWeaponResult {
  result.hits = result.groups.filter(group => group.kind === 'hit').reduce((total, group) => total + (group.successes ?? 0), 0);
  result.wounds = result.groups.filter(group => group.kind === 'wound').reduce((total, group) => total + (group.successes ?? 0), 0);
  result.unsavedWounds = result.groups.filter(group => group.kind === 'save')
    .reduce((total, group) => total + (group.noSave ? (group.successes ?? 0) : (group.rolls.length - (group.successes ?? 0))), 0);
  return result;
}

export function appendCombatWeaponResult(state: BattleState, unit: BattleUnit, result: ShootingWeaponResult) {
  state.lastShootingResolution = {
    shooterUnitId: unit.id,
    shooterSide: unit.side,
    weapons: [...(state.lastShootingResolution?.shooterUnitId === unit.id ? state.lastShootingResolution.weapons : []), finalizeCombatWeaponResult(result)],
  };
}

export function resolveShootingWeaponIntoTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  options: { deferCasualties?: boolean; snapShooting?: boolean; attackCountOverride?: number; modelIndexes?: number[] } = {},
  context: ShootingResolutionContext,
): LogEntry[] {
  const coverRules = shootingCoverRules(state, unit, target, weapon, rules, context);
  const snapShooting = options.snapShooting ?? false;
  const result: ShootingWeaponResult = {
    weaponIndex, weaponName: weapon.name, targetUnitId: target.id, targetUnitName: target.profile.name,
    attackCount: 0, hits: 0, wounds: 0, unsavedWounds: 0, groups: [],
  };
  const participatingModelIndexes = options.modelIndexes
    ?? context.participatingWeaponModelIndexes(unit, target, weapon, weaponIndex, state.terrain, state);
  if (!weapon.isMelee) {
    result.hitPreview = previewCombatHit(
      state,
      unit,
      target,
      weapon,
      weaponIndex,
      rules,
      { modelIndexes: participatingModelIndexes, snapShooting },
      context,
    );
  }
  const modelCoverGroups = new Map<boolean, number[]>();
  for (const modelIndex of participatingModelIndexes) {
    const hasCover = coverRules.alwaysHasCover || context.targetHasTerrainCoverFromModel(state, unit, modelIndex, target);
    modelCoverGroups.set(hasCover, [...(modelCoverGroups.get(hasCover) ?? []), modelIndex]);
  }
  const logs = [...modelCoverGroups.entries()].flatMap(([hasCover, modelIndexes]) => {
    return context.resolveCombatAttacks(unit, target, weapon, weaponIndex, rules, state, hasCover,
      0, '',
      { ...options, modelIndexes, result });
  });
  result.hits = result.groups.filter(group => group.kind === 'hit').reduce((total, group) => total + (group.successes ?? 0), 0);
  result.wounds = result.groups.filter(group => group.kind === 'wound').reduce((total, group) => total + (group.successes ?? 0), 0);
  result.unsavedWounds = result.groups.filter(group => group.kind === 'save')
    .reduce((total, group) => total + (group.noSave ? (group.successes ?? 0) : (group.rolls.length - (group.successes ?? 0))), 0);
  state.lastShootingResolution = {
    shooterUnitId: unit.id,
    shooterSide: unit.side,
    weapons: [...(state.lastShootingResolution?.shooterUnitId === unit.id ? state.lastShootingResolution.weapons : []), result],
  };
  if (logs.length > 0) {
    context.markRangedAttackMade(unit);
    context.markOneShotWeaponSpent(unit, weapon, weaponIndex);
  }
  logs.push(...context.resolveHazardousTests(unit, weapon, weaponIndex, state,
    options.modelIndexes?.length ?? context.participatingWeaponModelCount(unit, target, weapon, weaponIndex, state.terrain, state)));
  return logs;
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

export interface PlayShootingExecutionContext extends ManualShootingSelectionContext {
  clone(state: BattleState): BattleState;
  clearFiringDeckWeapons(unit: BattleUnit): void;
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean }): LogEntry[];
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  updateAttachedShootingActivation(state: BattleState, unit: BattleUnit, rules: RulesEdition, targetUnitId?: string): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot' | 'info'): LogEntry;
}

export interface OverwatchContext extends ManualShootingSelectionContext {
  clone(state: BattleState): BattleState;
  unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: string): boolean;
  snapShootingWeaponCanTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, rules: RulesEdition): boolean;
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean; snapShooting?: boolean }): LogEntry[];
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot'): LogEntry;
}

export interface AutomatedShootingContext extends ManualShootingSelectionContext {
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options?: object): LogEntry[];
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot' | 'info'): LogEntry;
}

export interface ShootingLockContext {
  clone(state: BattleState): BattleState;
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
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

/** `charged` is retained until that army's next Command phase; scope it to the current turn. */
export function unitChargedThisTurn(state: BattleState, unit: BattleUnit): boolean {
  if (!unit.charged) return false;
  if (unit.chargedTurn !== undefined) return unit.chargedTurn === state.turn;
  // Older states do not have chargedTurn. Fight-step pile-in and
  // consolidation update lastMovePhase, but they must not erase the charge
  // priority that was earned earlier in the turn.
  return unit.lastMovePhase === undefined
    || ((unit.lastMovePhase === 'charge' || unit.lastMovePhase === 'fight')
      && (unit.lastMoveTurn === undefined || unit.lastMoveTurn === state.turn));
}

export function unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightEligibilityContext): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated) return false;
  if (rules.metadata.edition !== '11e') return unitCanFight(unit, state, rules, context);
  if (state.fightStepStarted === false) return false;
  return unitChargedThisTurn(state, unit) || unitWasEngagedAtFightStepStart(state, unit)
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

export function moveModelTowardEnemy(unit: BattleUnit, modelIndex: number, state: BattleState, maxDistance: number, context: FightMovementContext): boolean {
  const closest = closestEnemyModelFor(unit, modelIndex, state, context);
  if (!closest) return false;
  const targetModel = closest.unit.modelPositions[closest.modelIndex];
  return moveModelTowardPoint(unit, modelIndex, targetModel, maxDistance, context.centroid,
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
  const pileInSide = state.fightPileInSide ?? state.activeArmy;
  if (kind === 'pileIn' && rules.metadata.edition === '11e'
    && ((state.fightStepStarted === false && pileInSide !== side)
      || (state.fightStepStarted === true && !isOverrunPileIn))) return state;
  if (kind === 'pileIn' && (isOverrunPileIn ? existing.overrunPiledIn : existing.piledIn)) return state;
  if (kind === 'consolidate' && existing.consolidated) return state;
  if (kind === 'pileIn' && isOverrunPileIn && !context.unitEligibleToFight(existing, state, rules)) return state;
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
          return objective ? moveModelTowardPoint(unit, modelIndex, objective, context.moveRange, context.centroid) : false;
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

export type MeleeAttackAllocation = { weaponIndex: number; targetUnitId: string; modelCount?: number };

export function selectMeleeWeapons(
  unit: BattleUnit,
  options: Array<{ weapon: WeaponProfile; weaponIndex: number }>,
  requested: number | 'all',
  context: { modelWeaponLoadout(profile: UnitProfile, modelIndex: number): number[]; weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean; chooseOneProfilePerGroup<T extends { weapon: WeaponProfile }>(weapons: T[]): T[] },
): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  const selected = new Set<number>();
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const carried = new Set(context.modelWeaponLoadout(unit.profile, rosterIndex));
    const modelOptions = options.filter(option => carried.has(option.weaponIndex));
    context.chooseOneProfilePerGroup(modelOptions.filter(option => context.weaponHasKeyword(option.weapon, 'Extra Attacks')))
      .forEach(option => selected.add(option.weaponIndex));
    const normal = context.chooseOneProfilePerGroup(modelOptions.filter(option => !context.weaponHasKeyword(option.weapon, 'Extra Attacks')));
    const requestedNormal = typeof requested === 'number' ? normal.find(option => option.weaponIndex === requested) : undefined;
    const chosenNormal = requestedNormal ?? normal[0];
    if (chosenNormal) selected.add(chosenNormal.weaponIndex);
  }
  return options.filter(option => selected.has(option.weaponIndex));
}

export interface ManualFightResolutionContext extends FightPhaseContext {
  clone(state: BattleState): BattleState;
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  aliveWeaponModelIndexes(unit: BattleUnit, weaponIndex: number): number[];
  participatingWeaponModelIndexes(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number[];
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
    const availableModelIndexes = context.aliveWeaponModelIndexes(unit, selected.weaponIndex);
    const assignedModelIndexes = new Set<number>();
    if (entries.length > 1 && entries.reduce((total, entry) => total + (entry.modelCount ?? 0), 0) !== availableModelIndexes.length) return state;
    const allocationCandidates = entries.map(entry => {
      const target = state.units.find(candidate => candidate.id === entry.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, state.terrain, state);
      return { entry, eligibleModelIndexes };
    }).sort((a, b) => a.eligibleModelIndexes.length - b.eligibleModelIndexes.length);
    for (const { entry, eligibleModelIndexes } of allocationCandidates) {
      if (entry.modelCount !== undefined && (!Number.isInteger(entry.modelCount) || entry.modelCount < 1)) return state;
      const remainingModelIndexes = eligibleModelIndexes.filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = entry.modelCount ?? remainingModelIndexes.length;
      if (modelCount > remainingModelIndexes.length) return state;
      remainingModelIndexes.slice(0, modelCount).forEach(modelIndex => assignedModelIndexes.add(modelIndex));
    }
  }
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit) return state;
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} locks all melee targets before rolling:`, 'fight')];
  for (const selected of selectableWeapons) {
    const entries = grouped.get(selected.weaponIndex)!;
    const assignedModelIndexes = new Set<number>();
    const orderedEntries = [...entries].sort((a, b) => {
      const targetA = next.units.find(candidate => candidate.id === a.targetUnitId && !candidate.destroyed)!;
      const targetB = next.units.find(candidate => candidate.id === b.targetUnitId && !candidate.destroyed)!;
      return context.participatingWeaponModelIndexes(fightingUnit, targetA, selected.weapon, selected.weaponIndex, next.terrain, next).length
        - context.participatingWeaponModelIndexes(fightingUnit, targetB, selected.weapon, selected.weaponIndex, next.terrain, next).length;
    });
    for (const entry of orderedEntries) {
      const target = next.units.find(candidate => candidate.id === entry.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(fightingUnit, target, selected.weapon, selected.weaponIndex, next.terrain, next)
        .filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = entry.modelCount ?? eligibleModelIndexes.length;
      const modelIndexes = eligibleModelIndexes.slice(0, modelCount);
      modelIndexes.forEach(modelIndex => assignedModelIndexes.add(modelIndex));
      const result = createCombatWeaponResult(fightingUnit, target, selected.weapon, selected.weaponIndex);
      logs.push(...context.resolveCombatAttacks(fightingUnit, target, selected.weapon, selected.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        modelIndexes,
        selectedTargetCount: entries.length,
        result,
      }));
      appendCombatWeaponResult(next, fightingUnit, result);
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
      const result = createCombatWeaponResult(fightingUnit, splitTarget, option.weapon, option.weaponIndex);
      const attackLogs = context.resolveCombatAttacks(fightingUnit, splitTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', { deferCasualties: true, attackCountOverride: split.attacks, selectedTargetCount: targetSplits.length, result });
      appendCombatWeaponResult(next, fightingUnit, result);
      logs.push(...attackLogs); madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed) break;
    }
    if (madeAttacks) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
  } else {
    for (const option of selectedMeleeWeapons) {
      const result = createCombatWeaponResult(fightingUnit, fightTarget, option.weapon, option.weaponIndex);
      const modelIndexes = context.participatingWeaponModelIndexes(
        fightingUnit,
        fightTarget,
        option.weapon,
        option.weaponIndex,
        next.terrain,
        next,
      );
      const attackLogs = context.resolveCombatAttacks(fightingUnit, fightTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', { deferCasualties: true, modelIndexes, result });
      appendCombatWeaponResult(next, fightingUnit, result);
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
  const result = createCombatWeaponResult(fighter, fightTarget, weapon, weaponIndex);
  logs.push(...context.resolveCombatAttacks(fighter, fightTarget, weapon, weaponIndex, rules, next, false, 0, '', { deferCasualties: true, result }));
  appendCombatWeaponResult(next, fighter, result);
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
  return unitChargedThisTurn(state, unit) || unitHasCounteroffensive(state, unit, context) || context.attachedUnitHasRule(state, unit, 'Fights First');
}

export function finishAttachedFightComponent(state: BattleState, unit: BattleUnit, rules: RulesEdition, context: FightPhaseContext): void {
  if (rules.metadata.edition !== '11e') return;
  const remaining = context.attachedComponents(state, unit).filter(component => !component.activated && context.unitEligibleToFight(component, state, rules));
  if (remaining.length) { state.activeAttachedFightUnitId = context.attachedUnitId(unit); return; }
  state.activeAttachedFightUnitId = undefined;
  const forcedUnit = state.units.find(candidate => candidate.id === state.forcedFightUnitId);
  if (forcedUnit && context.attachedUnitId(forcedUnit) === context.attachedUnitId(unit)) state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = unit.side;
  if (state.consolidationStepStarted && state.consolidationPendingFightUnitIds?.includes(unit.id)) {
    state.consolidationPendingFightUnitIds = state.consolidationPendingFightUnitIds.filter(unitId => unitId !== unit.id);
  }
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

export interface AutomatedFightContext extends FightPhaseContext {
  activeUnits(state: BattleState, side: Side): BattleUnit[];
  selectOverrunFight(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  pileIn(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  consolidate(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
}

export function runAutomaticFightForUnit(state: BattleState, unitId: string, rules: RulesEdition, context: AutomatedFightContext): BattleState {
  let next = state;
  const unit = next.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return next;
  if (playOverrunFightUnitIds(next, unit.side, rules, context).includes(unit.id)) {
    next = context.selectOverrunFight(next, unit.id, unit.side, rules);
    const piled = context.pileIn(next, unit.id, unit.side, rules);
    if (piled !== next) next = piled;
  }
  const selected = next.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!selected) return next;
  const fightLogs = context.runFight(selected, next, rules);
  if (fightLogs.length) next.log = [...next.log, ...fightLogs];
  return next;
}

export function runAutomaticEleventhFightPhase(
  state: BattleState,
  startingSide: Side,
  rules: RulesEdition,
  context: AutomatedFightContext,
): BattleState {
  let next = state;
  for (const pileSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    for (const unit of context.activeUnits(next, pileSide)) {
      const piled = context.pileIn(next, unit.id, pileSide, rules);
      if (piled !== next) next = piled;
    }
  }
  startFightStepInPlace(next, rules, context);

  let nextSide = startingSide;
  while (true) {
    const otherSide = (nextSide === 0 ? 1 : 0) as Side;
    const nextIds = playFightActivationUnitIds(next, nextSide, rules, context);
    const otherIds = playFightActivationUnitIds(next, otherSide, rules, context);
    const unitId = nextIds[0] ?? otherIds[0];
    if (!unitId) break;
    const selectedSide = nextIds.length ? nextSide : otherSide;
    next = runAutomaticFightForUnit(next, unitId, rules, context);
    if (!next.units.find(unit => unit.id === unitId)?.activated) break;
    nextSide = (selectedSide === 0 ? 1 : 0) as Side;
  }

  next.consolidationStepStarted = true;
  next.consolidationSide = startingSide;
  const engagedAtFightStart = new Set(next.engagedUnitIdsAtFightStepStart ?? []);
  next.consolidationEligibleUnitIds = next.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && (unitChargedThisTurn(next, unit) || engagedAtFightStart.has(unit.id)))
    .map(unit => unit.id);
  next.consolidationPendingFightUnitIds = [];
  for (const consolidationSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    next.consolidationSide = consolidationSide;
    for (const unit of next.units.filter(candidate => candidate.side === consolidationSide && candidate.activated && !candidate.destroyed)) {
      const consolidated = context.consolidate(next, unit.id, consolidationSide, rules);
      if (consolidated !== next) next = consolidated;
    }
  }
  return next;
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
  if (options.result) options.result.modelCount = (options.result.modelCount ?? 0) + weaponModelCount;
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
  const indirectFire = rules.metadata.edition === '11e' && weaponHasKeyword(weapon, 'Indirect Fire');
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
  const normalHitCalculation = calculateCombatHit(state, attacker, defender, weapon, rules, {
    hasCover,
    snapShooting: options.snapShooting,
    additionalHitModifier: options.snapShooting ? 0 : hitModifier,
    additionalHitModifierNote: hitModifierNote,
  }, context);
  const plungingHitCalculation = calculateCombatHit(state, attacker, defender, weapon, rules, {
    hasCover,
    snapShooting: options.snapShooting,
    plunging: true,
    additionalHitModifier: options.snapShooting ? 0 : hitModifier,
    additionalHitModifierNote: hitModifierNote,
  }, context);
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
  if (options.result) options.result.attackCount = (options.result.attackCount ?? 0) + numAttacks;
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
  } else if (!isTorrent) {
    const hitModifierSummary = normalHitCalculation.modifiers.map(formatHitModifierForLog).join('; ');
    if (hitModifierSummary) logs.push(log(state, attacker.side, attacker.profile.name, `     ${hitModifierSummary}`, 'info'));
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
    const normalTarget = normalHitCalculation.requiredHit ?? 6;
    const plungingTarget = plungingHitCalculation.requiredHit ?? normalTarget;
    if (normalHitCalculation.specialRule?.startsWith('Indirect Fire')) {
      logs.push(log(state, attacker.side, attacker.profile.name, `     ${normalHitCalculation.specialRule}`, 'info'));
    }
    const hitPools = [
      ...(plungingRolls.length ? [{ rolls: plungingRolls, target: plungingTarget, plunging: true }] : []),
      ...(normalRolls.length ? [{ rolls: normalRolls, target: normalTarget, plunging: false }] : []),
    ];
    const results = hitPools.map(pool => {
      const rolls = leadingRerollRules.hit && !indirectFire
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
