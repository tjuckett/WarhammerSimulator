// Manual attack resolution and its progressively narrowed simulator facade context.
// @ts-nocheck
import { type BattleState, type BattleUnit, type CombatRerollSelection, type LogEntry, type PendingFightOnDeath, type Position, type ShootingWeaponResult, type Side } from '../types/battle';
import type { UnitProfile, WeaponProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import type {
  CombatAttackResolutionOptions,
  CombatHitCalculation,
  CombatHitModifier,
  CombatHitPreview,
  CombatHitPreviewGroup,
} from './combatTypes';
import type { FightPhaseContext } from './phases/fightPhaseRules';
import { modelWoundsForUnit } from './baseSizes';

export type CombatAttackContext = Record<string, any>;

export function applyFeelNoPain(unit: BattleUnit, damage: number, state: BattleState, context: Record<string, any>): { damage: number; logs: LogEntry[]; target?: number; rolls?: number[]; ignored?: number } {
  const target = context.attachedUnitComponents(state, unit)
    .flatMap((component: BattleUnit) => context.feelNoPainTargets(component)
      .filter((rule: any) => component.id === unit.id || rule.sharesWithAttachedUnit)
      .map((rule: any) => rule.target))
    .filter((value: number | null): value is number => value !== null)
    .sort((a: number, b: number) => a - b)[0] ?? null;
  if (!target || damage <= 0) return { damage, logs: [] };
  const rolls = context.forcedFeelNoPainRolls?.length
    ? [...context.forcedFeelNoPainRolls]
    : context.rollMultiple(damage);
  const outcome = context.resolveFeelNoPainOutcome(damage, target, rolls);
  return {
    damage: outcome.damage,
    target,
    rolls,
    ignored: outcome.ignored,
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
    if (unit.woundsOnLeadModel <= 0) unit.woundsOnLeadModel = modelWoundsForUnit(unit, 0);
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
  const beforeUnit = clone(pendingUnit);
  const beforeLogLength = state.log.length;
  const beforeEventLength = state.events?.length ?? 0;
  const beforePendingDeadlyDemiseLength = state.pendingDeadlyDemises?.length ?? 0;
  const beforePendingFightOnDeathLength = state.pendingFightOnDeath?.length ?? 0;
  const beforeMissionEvents = state.missionEvents ? clone(state.missionEvents) : undefined;
  const next = clone(state);
  const unit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit?.pendingDamageAllocations?.length || !unit.modelPositions[modelIndex]) return state;
  const damage = unit.pendingDamageAllocations.shift();
  if (!unit.pendingDamageAllocations.length) unit.pendingDamageAllocations = undefined;
  const feelNoPain = applyFeelNoPain(unit, damage.damage, next, context);
  let feelNoPainGroupIndex: number | undefined;
  let feelNoPainWeaponResult: ShootingWeaponResult | undefined;
  const recordFeelNoPainResult = () => {
    if (feelNoPain.target === undefined || !feelNoPain.rolls?.length) return;
    const weaponResults = next.lastShootingResolution?.weapons.filter(result =>
      !damage.source || result.weaponName === damage.source,
    ) ?? [];
    // Prefer the current component after a bodyguard/Leader transfer. If the
    // merged UI result remapped the weapon index, the weapon name still gives
    // us the original typed combat result to append the FNP group to.
    const weaponResult = weaponResults.find(result => result.targetUnitId === unit.id)
      ?? weaponResults.find(result => damage.combatResult?.weaponIndex === result.weaponIndex)
      ?? weaponResults[0];
    if (!weaponResult) return;
    feelNoPainWeaponResult = weaponResult;
    weaponResult.groups.push({
      kind: 'feel-no-pain',
      rolls: [...feelNoPain.rolls],
      target: feelNoPain.target,
      successes: feelNoPain.ignored ?? 0,
    });
    feelNoPainGroupIndex = weaponResult.groups.length - 1;
  };
  const captureFeelNoPainReview = () => {
    if (feelNoPain.target === undefined || !feelNoPain.rolls?.length) return;
    const pendingCombat = next.pendingCombatResolution;
    next.pendingFeelNoPainReroll = {
      kind: pendingCombat?.kind ?? (next.phase === 'fight' ? 'fight' : 'shooting'),
      attackerUnitId: pendingCombat?.attackerUnitId ?? damage.sourceUnitId ?? '',
      weaponIndex: damage.combatResult?.weaponIndex ?? feelNoPainWeaponResult?.weaponIndex ?? -1,
      weaponName: feelNoPainWeaponResult?.weaponName ?? damage.source,
      targetUnitId: unit.id,
      resultTargetUnitId: feelNoPainWeaponResult?.targetUnitId,
      groupIndex: feelNoPainGroupIndex ?? -1,
      modelIndex,
      target: feelNoPain.target,
      rolls: [...feelNoPain.rolls],
      ignored: feelNoPain.ignored ?? 0,
      beforeUnit,
      logLength: beforeLogLength,
      eventLength: beforeEventLength,
      pendingDeadlyDemiseLength: beforePendingDeadlyDemiseLength,
      pendingFightOnDeathLength: beforePendingFightOnDeathLength,
      missionEvents: beforeMissionEvents,
    };
  };
  const appliedDamage = feelNoPain.damage;
  if (appliedDamage <= 0) {
    recordFeelNoPainResult();
    recordBattleEvent(next, { type: BATTLE_EVENT_TYPE.DamageApplied, side: state.activeArmy, source: damage.sourceUnitId, data: {
      targetUnitId: unit.id, damage: 0, killedModels: 0, remainingModels: unit.remainingModels,
      woundsOnCurrentModel: unit.woundsOnLeadModel, noCarryOver: damage.noCarryOver ?? false, source: damage.source ?? 'attack',
      feelNoPainTarget: feelNoPain.target, feelNoPainRolls: feelNoPain.rolls, feelNoPainIgnored: feelNoPain.ignored,
    }});
    next.log = [...next.log, ...feelNoPain.logs, log(next, state.activeArmy, unit.profile.name,
      `${unit.profile.name} allocates ${damage.damage} damage to model ${modelIndex + 1}; no damage gets through.`, 'damage')];
    captureFeelNoPainReview();
    return next;
  }
  recordFeelNoPainResult();
  const currentWounds = unit.woundedModelIndex === modelIndex
    ? unit.woundsOnLeadModel
    : modelWoundsForUnit(unit, modelIndex);
  const allocationOutcome = resolveDamageOutcome({ damage: appliedDamage, modelCount: 1, woundsOnCurrentModel: currentWounds,
    woundsPerModel: modelWoundsForUnit(unit, modelIndex), noCarryOver: true });
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
    unit.woundsOnLeadModel = unit.remainingModels > 0 ? modelWoundsForUnit(unit, 0) : 0;
    if (unit.remainingModels <= 0 || unit.modelPositions.length <= 0) {
      // A bodyguard and its attached Leaders are one rules unit for normal
      // attacks. Keep ordinary packets moving to a surviving component when
      // their current component is destroyed. Precision/Epic Challenge
      // packets deliberately allocated to that model do not spill over.
      const remainingAllocations = unit.pendingDamageAllocations ?? [];
      markUnitDestroyed(unit);
      unit.remainingModels = 0;
      unit.modelPositions = [];
      unit.modelRotations = [];
      unit.pendingDamageAllocations = undefined;
      const attachedUnitId = unit.attachedToUnitId ?? unit.id;
      const transferableAllocations = remainingAllocations.filter(allocation => allocation.targetModelIndex === undefined);
      const survivingComponent = transferableAllocations.length
        ? next.units.find((candidate: BattleUnit) => candidate.id !== unit.id
          && candidate.side === unit.side
          && (candidate.id === attachedUnitId || candidate.attachedToUnitId === attachedUnitId)
          && !candidate.destroyed
          && !candidate.embarkedInUnitId
          && candidate.remainingModels > 0)
        : undefined;
      if (survivingComponent) {
        survivingComponent.pendingDamageAllocations = [
          ...transferableAllocations.map(allocation => ({ ...allocation, targetUnitId: survivingComponent.id })),
          ...(survivingComponent.pendingDamageAllocations ?? []),
        ];
      }
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
    feelNoPainTarget: feelNoPain.target, feelNoPainRolls: feelNoPain.rolls, feelNoPainIgnored: feelNoPain.ignored,
  }});
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...resolvePendingDeadlyDemisesInPlace(next)];
  captureFeelNoPainReview();
  return next;
}

/** Rewinds and reapplies the latest non-lethal FNP allocation with one new die. */
export function rerollPlayFeelNoPainAllocation(
  state: BattleState,
  selection: CombatRerollSelection,
  originalRoll: number,
  reroll: number,
  context: ManualDamageAllocationContext,
): BattleState {
  const review = state.pendingFeelNoPainReroll;
  if (!review
    || selection.groupKind !== 'feel-no-pain'
    || review.kind !== selection.kind
    || review.attackerUnitId !== selection.attackerUnitId
    || review.targetUnitId !== selection.targetUnitId
    || review.groupIndex !== selection.groupIndex
    || review.modelIndex < 0) return state;
  const weaponResult = state.lastShootingResolution?.weapons.find(result =>
    result.groups[selection.groupIndex]?.kind === 'feel-no-pain'
      && (!review.weaponName || result.weaponName === review.weaponName)
      && (result.weaponIndex === selection.weaponIndex
        || result.targetUnitId === selection.targetUnitId
        || result.targetUnitId === review.resultTargetUnitId),
  );
  const group = weaponResult?.groups[selection.groupIndex];
  const currentUnit = state.units.find(unit => unit.id === review.targetUnitId && unit.side === review.beforeUnit.side);
  // A lethal allocation can trigger transport, Fight-on-Death, and attached
  // unit transitions. Keep those outcomes immutable rather than attempting a
  // partial rollback; non-lethal packets are the safe reroll boundary.
  if (!weaponResult || !group || group.kind !== 'feel-no-pain'
    || group.rolls[selection.rollIndex] !== originalRoll
    || !currentUnit
    || currentUnit.destroyed
    || currentUnit.remainingModels !== review.beforeUnit.remainingModels) return state;

  const next = context.clone(state);
  next.log = next.log.slice(0, review.logLength);
  if (next.events) next.events = next.events.slice(0, review.eventLength);
  if (next.pendingDeadlyDemises) next.pendingDeadlyDemises = next.pendingDeadlyDemises.slice(0, review.pendingDeadlyDemiseLength);
  if (next.pendingFightOnDeath) next.pendingFightOnDeath = next.pendingFightOnDeath.slice(0, review.pendingFightOnDeathLength);
  next.missionEvents = review.missionEvents ? context.clone(review.missionEvents) : undefined;
  const unitIndex = next.units.findIndex(unit => unit.id === review.targetUnitId && unit.side === review.beforeUnit.side);
  if (unitIndex < 0) return state;
  next.units[unitIndex] = context.clone(review.beforeUnit);
  const nextWeaponResult = next.lastShootingResolution?.weapons.find(result =>
    result.groups[selection.groupIndex]?.kind === 'feel-no-pain'
      && (!review.weaponName || result.weaponName === review.weaponName)
      && (result.weaponIndex === selection.weaponIndex
        || result.targetUnitId === selection.targetUnitId
        || result.targetUnitId === review.resultTargetUnitId),
  );
  if (!nextWeaponResult || !nextWeaponResult.groups[selection.groupIndex]) return state;
  const replacementRolls = [...nextWeaponResult.groups[selection.groupIndex].rolls];
  replacementRolls[selection.rollIndex] = reroll;
  nextWeaponResult.groups.splice(selection.groupIndex, 1);
  next.pendingFeelNoPainReroll = undefined;

  const reapplied = allocatePlayDamageToModel(next, review.targetUnitId, review.beforeUnit.side, review.modelIndex, {
    ...context,
    forcedFeelNoPainRolls: replacementRolls,
  });
  const reappliedWeaponResult = reapplied.lastShootingResolution?.weapons.find(result =>
    (!review.weaponName || result.weaponName === review.weaponName)
      && (result.weaponIndex === selection.weaponIndex
        || result.targetUnitId === selection.targetUnitId
        || result.targetUnitId === review.resultTargetUnitId),
  );
  const reappliedGroup = reappliedWeaponResult?.groups
    .slice()
    .reverse()
    .find(candidate => candidate.kind === 'feel-no-pain');
  if (reappliedGroup) reappliedGroup.rerolledRollIndices = [selection.rollIndex];
  reapplied.pendingCommandReroll = undefined;
  const rerollSide = state.pendingCommandReroll?.side ?? state.activeArmy;
  reapplied.log = [...reapplied.log, {
    id: `command-reroll-${reapplied.log.length + 1}`,
    battleRound: reapplied.battleRound ?? 1,
    turn: reapplied.turn,
    phase: reapplied.phase,
    side: rerollSide,
    unitName: reapplied.armies?.[rerollSide]?.name ?? `Player ${rerollSide + 1}`,
    message: `Command Re-roll feel-no-pain roll: [${originalRoll}] -> [${reroll}].`,
    type: 'roll',
  }];
  return reapplied;
}

export type PlayShootingWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
  /** UI metadata used when an attached leader and bodyguard share one declaration. */
  sourceUnitId?: string;
  sourceWeaponIndex?: number;
  weapon?: WeaponProfile;
  /** Number of models carrying this weapon that can contribute to at least one listed target. */
  modelCount?: number;
  /** Eligible model count for each target, used by the UI and AI allocation layer. */
  targetModelCounts?: Record<string, number>;
  /** Eligible model indexes for each target, reused by the pre-roll UI preview. */
  targetModelIndexes?: Record<string, number[]>;
};

export type PlayShootingAttackAllocation = {
  weaponIndex: number;
  targetUnitId: string;
  modelCount?: number;
};

export interface ManualShootingSelectionContext {
  attachedUnitId(unit: BattleUnit): string;
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  /** Number of physical copies of a weapon carried by eligible models. */
  aliveWeaponCopyCount?(unit: BattleUnit, weaponIndex: number): number;
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  eligibleShootingWeapons(unit: BattleUnit, state: BattleState, rules: RulesEdition, allowActivated?: boolean): WeaponProfile[];
  enemies(state: BattleState, side: Side): BattleUnit[];
  shootingWeaponCanTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, rules: RulesEdition): boolean;
  /** Optional optimized unit-level target query used when a shooting step opens. */
  shootingTargetUnitIds?(state: BattleState, unit: BattleUnit, rules: RulesEdition): string[];
  unitCanBeSelectedToShootWithoutAttacks(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  participatingWeaponModelIndexes?(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number[];
}

export type ShootingSelectionRulesContext = Record<string, any>;

export function unitCanUseBigGunsNeverTire(unit: BattleUnit, context: ShootingSelectionRulesContext): boolean {
  return context.unitHasKeyword(unit, 'Vehicle') || context.unitHasKeyword(unit, 'Monster');
}

export function weaponIsCloseQuarters(weapon: WeaponProfile, context: ShootingSelectionRulesContext): boolean {
  // 11th explicitly defines [Pistol] as identical to [Close-Quarters].
  // Keep that equivalence at the engine boundary so every shooting query and
  // resolver follows the same rule, regardless of which spelling a datasheet
  // still uses.
  return context.weaponHasKeyword(weapon, 'Close-Quarters')
    || context.weaponHasKeyword(weapon, 'Pistol')
    || context.weaponHasKeyword(weapon, 'Sidearm');
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
  coverRules?: ShootingCoverRules;
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
  const targetComponents = context.attachedUnitComponents(state, defender);
  const usesStealthCover = rules.metadata.edition === '11e'
    && targetComponents.length > 0
    && targetComponents.every(component => context.unitHasRule(component.profile, 'Stealth'));
  return {
    alwaysHasCover: usesIndirectFireCover || usesSmokescreen || usesStealthCover,
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
  const shootingRules = !weapon.isMelee
    ? options.coverRules ?? shootingCoverRules(state, attacker, defender, weapon, rules, context)
    : null;
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
      // An attached Leader/bodyguard group is one unit for Engagement Range.
      // Resolve each component's weapons independently, but do not let that
      // split suppress Big Guns Never Tire's hit penalty in the preview or
      // the actual dice resolution.
      const engaged = context.attachedUnitComponents(state, attacker).some(component =>
        context.inEngagement(component, foes, rules.engagementRange()));
      const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(attacker, context);
      const closeQuartersTarget = rules.metadata.edition === '11e'
        && weaponIsCloseQuarters(weapon, context)
        && context.attachedUnitComponents(state, attacker).some(component =>
          context.inEngagement(component, [defender], rules.engagementRange()));
      const targetIsEngagedMonsterOrVehicle = context.targetWithinFriendlyEngagement(state, defender, attacker.side, rules)
        && unitCanUseBigGunsNeverTire(defender, context);
      if (bigGunsNeverTire && !closeQuartersTarget && !context.weaponIsSidearm(weapon)) {
        addModifier(rules.metadata.edition === '11e' ? 'Close Quarters Shooting' : 'Big Guns Never Tire', 1);
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
      if (rules.metadata.edition !== '11e' && context.attachedUnitHasRule(state, defender, 'Stealth')) {
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
  options: { modelIndexes?: number[]; visibleModelIndexes?: number[]; snapShooting?: boolean } = {},
  context: ShootingResolutionContext,
): CombatHitPreview {
  const modelIndexes = [...new Set(options.modelIndexes
    ?? context.participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, state.terrain, state))]
    .filter(modelIndex => !!attacker.modelPositions[modelIndex]);
  const coverRules = !weapon.isMelee ? shootingCoverRules(state, attacker, defender, weapon, rules, context) : null;
  const knownVisibleModelIndexes = options.visibleModelIndexes ? new Set(options.visibleModelIndexes) : null;
  const groupMap = new Map<string, { modelIndexes: number[]; hasCover: boolean; plunging: boolean }>();
  for (const modelIndex of modelIndexes) {
    const position = attacker.modelPositions[modelIndex];
    const visible = !weapon.isMelee && !options.snapShooting && !!position
      ? knownVisibleModelIndexes
        ? knownVisibleModelIndexes.has(modelIndex)
        : context.hasAnyModelLOS(position, context.modelBaseRadius(attacker, modelIndex), defender, state.terrain, state.ruleset?.edition)
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
      coverRules,
      snapShooting: options.snapShooting,
      plunging: group.plunging,
    }, context),
    modelIndexes: group.modelIndexes,
    plunging: group.plunging,
  }));
  // Exact model participation can be deliberately deferred by an interactive
  // declaration. A preview still needs to report the rules-owned hit target
  // (for example Close Quarters Shooting's -1) rather than becoming blank.
  // This zero-model group is presentation-only; it never contributes attacks
  // or changes the allocation/resolution legality checks.
  if (groups.length === 0) {
    groups.push({
      ...calculateCombatHit(state, attacker, defender, weapon, rules, {
        hasCover: !!coverRules?.alwaysHasCover,
        coverRules,
        snapShooting: options.snapShooting,
        plunging: false,
      }, context),
      modelIndexes: [],
      plunging: false,
    });
  }
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
  options: { deferCasualties?: boolean; snapShooting?: boolean; attackCountOverride?: number; modelIndexes?: number[]; interactiveStage?: boolean } = {},
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
      { ...options, modelIndexes, result, interactiveStage: options.interactiveStage && modelCoverGroups.size === 1 });
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
  return attacks * (context.aliveWeaponCopyCount?.(unit, weaponIndex) ?? context.aliveWeaponModelCount(unit, weaponIndex));
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
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  aliveWeaponModelIndexes(unit: BattleUnit, weaponIndex: number): number[];
  participatingWeaponModelIndexes(unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, terrain: BattleState['terrain'], state: BattleState): number[];
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean; modelIndexes?: number[]; interactiveStage?: boolean }): LogEntry[];
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
  attachedUnitComponents?(state: BattleState, unit: BattleUnit): BattleUnit[];
  clearFiringDeckWeapons(unit: BattleUnit): void;
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean; interactiveStage?: boolean }): LogEntry[];
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  updateAttachedShootingActivation(state: BattleState, unit: BattleUnit, rules: RulesEdition, targetUnitId?: string): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'shoot' | 'info'): LogEntry;
}

export interface OverwatchContext extends ManualShootingSelectionContext {
  clone(state: BattleState): BattleState;
  unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: string): boolean;
  snapShootingWeaponCanTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, rules: RulesEdition): boolean;
  shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }>;
  resolveShootingWeaponIntoTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, weapon: WeaponProfile, weaponIndex: number, rules: RulesEdition, options: { deferCasualties?: boolean; snapShooting?: boolean; interactiveStage?: boolean }): LogEntry[];
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
  // This existing ability currently has a combat-phase-only timing contract.
  // Other abilities/Stratagems must use PendingCombatAction instead of
  // broadening this legacy rule implicitly.
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
  const { dist, battleUnitToAttachedUnitDistance, activeEpicChallengeModelIndex, participatingWeaponModelIndexes, modelWeaponCopyCount, unitHasRule, attachedUnitIsFormed, attachedUnitHasRule, attachedUnitComponents, leadingAttackModifiers, leadingRerolls, leadingWeaponKeywords, unitGrantedWeaponKeywords, auraAbilitiesInRange, attachedUnitRemainingModels, attackingModelToAttachedUnitDistance, weaponHasKeyword, weaponKeywordValue, log, attachedUnitToughness, rollExpression, hasAnyModelLOS, modelBaseRadius, attackingModelHasPlungingFire, targetVisibleToFriendlyUnit, rollMultiple, d6, processWoundsAgainstDefender, attachedInvulnerableSave, rangedSaveModifier, resolveSaveOutcome, applyDamage, objectiveIndexesWithinRange, recordBattleEvent, BATTLE_EVENT_TYPE } = context;
  const logs: LogEntry[] = [];
  const continuation = options.continuation;
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
  // A resolved Fight result is displayed after the declaration preview has
  // been cleared. Capture the same engine-owned hit calculation on the
  // result so that post-roll UI reads the resolved declaration, not stale UI
  // selection state. Shooting creates this before delegating here; this also
  // covers direct Fight resolution calls.
  if (options.result && !options.result.hitPreview) {
    options.result.hitPreview = previewCombatHit(
      state,
      attacker,
      defender,
      weapon,
      weaponIndex,
      rules,
      { modelIndexes: participatingModelIndexes, snapShooting: options.snapShooting },
      context,
    );
  }
  const attackModelIndexes = participatingModelIndexes.flatMap(modelIndex => {
    const rosterModelIndex = attacker.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const copyCount = modelWeaponCopyCount?.(attacker.profile, rosterModelIndex, weaponIndex) ?? 1;
    return Array.from({ length: Math.max(0, copyCount) }, () => modelIndex);
  });
  const weaponModelCount = attackModelIndexes.length;
  if (weaponModelCount <= 0) return logs;
  if (options.result && !continuation) options.result.modelCount = (options.result.modelCount ?? 0) + participatingModelIndexes.length;
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
  if (!continuation) {
    for (let i = 0; i < weaponModelCount; i++) {
      perModelRolls.push(rollExpression(weapon.attacks).total + waaaghMeleeBonus + (weapon.isMelee ? leadingModifiers.attacks : 0));
    }
  }
  let perModelAttackCounts = [...perModelRolls];
  let numAttacks = continuation?.attackCount ?? options.attackCountOverride ?? perModelAttackCounts.reduce((a, b) => a + b, 0);
  if (!continuation && options.attackCountOverride === undefined) {
    if (rules.metadata.edition === '11e' && !weapon.isMelee) {
      perModelAttackCounts = perModelAttackCounts.map((attacks, index) => rules.modifyAttackCount(
        attacks,
        { ...attacker, remainingModels: 1 },
        weapon,
        attackingModelToAttachedUnitDistance(state, attacker, attackModelIndexes[index], defender),
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
    `  ${weapon.isMelee ? '\u2694\uFE0F' : '\uD83D\uDD2B'} ${weapon.name} \u2014 ${weaponModelCount} model(s) \u00D7 ${weapon.attacks} = ${numAttacks} attacks vs ${defender.profile.name}`,
    weapon.isMelee ? 'fight' : 'shoot',
  ));
  if (options.result && !continuation) options.result.attackCount = (options.result.attackCount ?? 0) + numAttacks;
  const effectiveStrength = weapon.strength + waaaghMeleeBonus + (weapon.isMelee ? leadingModifiers.strength : 0);
  if (!continuation) logs.push(log(state, attacker.side, attacker.profile.name,
    `[combat-stats] skill=${weapon.skill} s=${effectiveStrength} ap=${weapon.ap} d=${weapon.damage} t=${attachedUnitToughness(state, defender)}${hasCover ? ' cover=1' : ''}`,
    'info',
  ));
  if (!continuation && options.attackCountOverride !== undefined) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Split ${weapon.isMelee ? 'melee' : 'ranged'} attacks: ${options.attackCountOverride} attack(s) declared against ${defender.profile.name}`,
      'info',
    ));
  }
  if (isVariableAttacks && !continuation) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Attack rolls (${weapon.attacks}): [${perModelRolls.join(', ')}] = ${numAttacks} attacks`,
      'roll',
    ));
  }

  // â”€â”€ Hit rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let hitResult = continuation
    ? { hits: continuation.hits, rolls: [] as number[], mortalsFromCrits: continuation.totalMortals, logNote: 'resumed' }
    : { hits: numAttacks, rolls: [] as number[], mortalsFromCrits: 0, logNote: 'Torrent - auto-hits' };
  let lethalAutoWounds = continuation?.lethalAutoWounds ?? 0;
  if (!continuation) {
  const isTorrent = weaponHasKeyword(weapon, 'Torrent');
  if (options.snapShooting && !isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name, '     Snap Shooting: unmodified 6s to hit; hit rolls cannot be re-rolled', 'info'));
  } else if (!isTorrent) {
    const hitModifierSummary = normalHitCalculation.modifiers.map(formatHitModifierForLog).join('; ');
    if (hitModifierSummary) logs.push(log(state, attacker.side, attacker.profile.name, `     ${hitModifierSummary}`, 'info'));
  }
  if (isTorrent) {
    logs.push(log(state, attacker.side, attacker.profile.name,
      `     Torrent: ${numAttacks} auto-hit(s)`,
      'roll',
    ));
    // Keep auto-hits in the typed result as a hit-stage group.  Without this
    // group the interactive cursor has no visible hit stage and can be
    // cleared before the deferred wound/save continuation is acknowledged.
    options.result?.groups.push({ kind: 'hit', rolls: [], successes: numAttacks, autoSuccesses: numAttacks });
  } else {
    const plungingAttackCount = options.snapShooting || weapon.isMelee
      ? 0
      : attackModelIndexes.reduce((total, modelIndex, index) => {
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
      options.result?.groups.push({ kind: 'hit', rolls: [...pool.rolls], target: pool.target, successes: pool.result.hits, bonusHits: pool.result.bonusHits });
      const noteHit = pool.result.logNote ? ` [${pool.result.logNote}]` : '';
      const plungingNote = pool.plunging ? '; Plunging Fire improves BS by 1' : '';
      logs.push(log(state, attacker.side, attacker.profile.name,
        `     Hit rolls (${pool.target}+${plungingNote}): [${pool.rolls.join(', ')}] \u2192 ${pool.result.hits} hits${noteHit}`,
        'roll',
      ));
    }

  }

  }

  // Mortal wounds from critical hits (e.g. Deadly Demise)
  let totalMortals = continuation?.totalMortals ?? hitResult.mortalsFromCrits;
  let devastatingWounds = continuation?.devastatingWounds ?? 0;

  // Interactive play can acknowledge the hit pool before the wound/save
  // stages are resolved. Keep the continuation inputs typed on BattleState.
  if (options.interactiveStage && !options.resumeFrom && options.result) {
    const hitRolls = options.result.groups
      .filter(group => group.kind === 'hit')
      .flatMap(group => group.rolls);
    state.pendingCombatResolution = {
      kind: weapon.isMelee ? 'fight' : 'shooting',
      attackerUnitId: attacker.id,
      attackerSide: attacker.side,
      targetUnitId: defender.id,
      weaponIndex,
      stage: 'hits',
      rolls: hitRolls,
      target: options.result.groups.find(group => group.kind === 'hit')?.target,
      rollIds: hitRolls.map((_roll, index) => `${weapon.isMelee ? 'fight' : 'shooting'}:${attacker.id}:hits:${index}`),
      continuation: {
        hasCover,
        hitModifier,
        hitModifierNote,
        attackCount: numAttacks,
        hits: hitResult.hits,
        lethalAutoWounds,
        totalMortals,
        devastatingWounds,
        weaponKeywords: [...bannerWeapon.keywords],
        modelIndexes: [...participatingModelIndexes],
        selectedTargetCount: options.selectedTargetCount,
        snapShooting: options.snapShooting,
        deferCasualties: options.deferCasualties,
      },
    };
    return logs;
  }

  if (hitResult.hits === 0 && totalMortals === 0) return logs;

  // â”€â”€ Wound rolls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const targetToughness = attachedUnitToughness(state, defender);
  const lanceApplies = rules.metadata.edition === '11e'
    && weapon.isMelee
    && weaponHasKeyword(weapon, 'Lance')
    && attachedUnitComponents(state, attacker).some(component => component.charged);
  const prophetWoundBonus = prophetActive ? 1 : 0;
  const wt = Math.max(2, rules.woundTarget(effectiveStrength, targetToughness) - (lanceApplies ? 1 : 0) - prophetWoundBonus - leadingModifiers.wound);
  let woundCount = continuation?.wounds ?? 0;
  if (!continuation || options.resumeFrom === 'wounds') {
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
      `     Wound rolls (S${effectiveStrength} vs T${targetToughness}, ${wt}+): [${woundRolls.join(', ')}] \u2192 ${woundResult.wounds} wounds${noteWound}`,
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
  }

  if (options.resumeFrom === 'wounds') {
    const pending = state.pendingCombatResolution;
    if (pending?.continuation && options.result) {
      const woundRolls = options.result.groups.filter(group => group.kind === 'wound').flatMap(group => group.rolls);
      pending.stage = 'wounds';
      pending.rolls = woundRolls;
      pending.target = wt;
      pending.rollIds = woundRolls.map((_roll, index) => `${pending.kind}:${pending.attackerUnitId}:wounds:${index}`);
      pending.continuation.wounds = woundCount;
      pending.continuation.totalMortals = totalMortals;
      pending.continuation.devastatingWounds = devastatingWounds;
    }
    return logs;
  }

  let unsaved = continuation?.unsaved ?? 0;
  if (woundCount > 0 && (!continuation || options.resumeFrom === 'saves')) {
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
        `     Save rolls (${effectiveSave}+${coverNote}): [${saveRolls.join(', ')}] \u2192 ${saved} saved, ${unsaved} failed`,
        'roll',
      ));
    }
  }

  // â”€â”€ Damage application â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (options.resumeFrom === 'saves') {
    const pending = state.pendingCombatResolution;
    if (pending?.continuation && options.result) {
      const saveRolls = options.result.groups.filter(group => group.kind === 'save').flatMap(group => group.rolls);
      pending.stage = 'saves';
      pending.rolls = saveRolls;
      pending.target = options.result.groups.find(group => group.kind === 'save')?.target;
      pending.rollIds = saveRolls.map((_roll, index) => `${pending.kind}:${pending.attackerUnitId}:saves:${index}`);
      pending.continuation.unsaved = unsaved;
      pending.continuation.wounds = woundCount;
      pending.continuation.totalMortals = totalMortals;
      pending.continuation.devastatingWounds = devastatingWounds;
    }
    return logs;
  }

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
      const groupIndex = options.result?.groups.length;
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
        ...(groupIndex !== undefined ? { combatResult: { weaponIndex, groupIndex } } : {}),
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
      const groupIndex = options.result?.groups.length;
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
        ...(groupIndex !== undefined ? { combatResult: { weaponIndex, groupIndex } } : {}),
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
