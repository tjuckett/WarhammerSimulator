import { PHASE_STEP, type BattleState, type BattleUnit, type LogEntry, type PhaseStepAction, type Side } from '../../types/battle';
import type { WeaponProfile } from '../../types/army';
import type { RulesEdition } from '../rulesEngine';
import type {
  AutomatedShootingContext,
  AutomatedShootingPhaseContext,
  AttachedShootingContext,
  ManualShootingResolutionContext,
  ManualShootingSelectionContext,
  OverwatchContext,
  PlayShootingExecutionContext,
  PlayShootingAttackAllocation,
  PlayShootingWeaponOption,
  ShootingLockContext,
} from '../manualCombat';
import { closePendingCombatAction, pendingCombatActionFor } from '../combatActionWindows';
import {
  canResolveShootingUnit,
  canSelectShootingUnit,
} from './shootingPhaseRules';
import {
  completePhaseStepAction,
  phaseStepActionLedgerFor,
  setPhaseStepActionStatus,
  setPhaseStepActions,
} from '../phaseStepActions';

function shootingActionId(side: Side, unitId: string): string {
  return `shoot:${side}:${unitId}`;
}

function normalShootingStep(state: BattleState, side: Side): boolean {
  return state.phase === 'shooting'
    && state.phaseStep === PHASE_STEP.ShootingUnits
    && state.activeArmy === side;
}

function shootingActionFor(state: BattleState, side: Side, unitId: string): PhaseStepAction | null {
  return phaseStepActionLedgerFor(state)?.actions.find(action =>
    action.id === shootingActionId(side, unitId)) ?? null;
}

function shootingTargetUnitIds(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  context: ManualShootingSelectionContext,
): string[] {
  const targetIds = new Set<string>();
  const weapons = context.eligibleShootingWeapons(unit, state, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option => option.weaponIndex >= 0 && context.aliveWeaponModelCount(unit, option.weaponIndex) > 0);
  for (const { weapon } of weapons) {
    for (const target of context.enemies(state, unit.side)) {
      if (context.shootingWeaponCanTarget(state, unit, target, weapon, rules)) targetIds.add(target.id);
    }
  }
  return [...targetIds];
}

/**
 * Publishes the current side's optional Shooting opportunities. Detailed
 * weapon allocation and LOS remain owned by shootingPhaseRules/manualCombat;
 * this ledger only exposes the typed unit-level opportunity to controllers,
 * AI, UI, undo, replay, and save/load.
 */
export function refreshPlayShootingActions(
  state: BattleState,
  rules: RulesEdition,
  context: ManualShootingSelectionContext,
): void {
  if (!normalShootingStep(state, state.activeArmy)) return;
  const side = state.activeArmy;
  const unitIds = state.units
    .filter(unit => unit.side === side
      && !unit.destroyed
      && !unit.embarkedInUnitId
      && !unit.inStrategicReserves
      && canSelectShootingUnit(state, unit.id, side))
    .map(unit => unit.id);
  const existing = phaseStepActionLedgerFor(state)?.actions ?? [];
  const incomingIds = new Set(unitIds.map(unitId => shootingActionId(side, unitId)));
  const incoming = unitIds.map(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId);
    const existingAction = shootingActionFor(state, side, unitId);
    const targetUnitIds = unit ? shootingTargetUnitIds(state, unit, rules, context) : [];
    return {
      id: shootingActionId(side, unitId),
      phase: state.phase,
      step: PHASE_STEP.ShootingUnits,
      kind: 'shoot' as const,
      side,
      unitId,
      targetUnitIds,
      requiredToAdvance: false,
      status: existingAction && !['available', 'in-progress'].includes(existingAction.status)
        ? existingAction.status
        : existingAction?.status === 'in-progress'
          ? 'in-progress' as const
          : 'available' as const,
      label: `${unit?.profile.name ?? unitId}: Shoot`,
      description: targetUnitIds.length
        ? 'Optional Shooting action during the Shooting phase.'
        : 'Optional Shooting selection; no valid ranged target is currently available.',
    } satisfies PhaseStepAction;
  });
  const retained = existing
    .filter(action => !incomingIds.has(action.id))
    .map(action => action.kind === 'shoot'
      && action.side === side
      && ['available', 'in-progress'].includes(action.status)
      ? { ...action, status: 'superseded' as const }
      : action);
  setPhaseStepActions(state, PHASE_STEP.ShootingUnits, [...retained, ...incoming]);
}

/** Opens the typed unit-level Shooting inventory at the step boundary. */
export function startPlayShootingStep(
  state: BattleState,
  rules: RulesEdition,
  context: ManualShootingSelectionContext,
): void {
  refreshPlayShootingActions(state, rules, context);
}

function reconcilePlayShootingAction(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  rules: RulesEdition,
  context: ManualShootingSelectionContext,
): void {
  if (!normalShootingStep(state, side)) return;
  const actionId = shootingActionId(side, unit.id);
  if (unit.activated) completePhaseStepAction(state, actionId);
  refreshPlayShootingActions(state, rules, context);
  if (!unit.activated) setPhaseStepActionStatus(state, actionId, 'in-progress');
}

/** Keeps attached units on the same target until every component has resolved. */
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

/** Resolves one selected ranged declaration during the interactive Shooting step. */
export function shootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string | undefined,
  weaponIndex: number | 'all',
  rules: RulesEdition,
  context: PlayShootingExecutionContext,
): BattleState {
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  if (pending?.snapShooting || !canResolveShootingUnit(state, unitId, side)) return state;
  const s = context.clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return state;
  if (s.activeAttachedShootingUnitId && context.attachedUnitId(unit) !== s.activeAttachedShootingUnitId) return state;
  if (s.attachedShootingTargetUnitId && targetUnitId !== s.attachedShootingTargetUnitId) return state;

  if (weaponIndex === -1 || (weaponIndex === 'all' && !context.eligibleShootingWeapons(unit, s, rules, pending?.allowActivated === true).length)) {
    if (!context.unitCanBeSelectedToShootWithoutAttacks(unit, s, rules)
      || context.eligibleShootingWeapons(unit, s, rules, pending?.allowActivated === true).length > 0) return state;
    unit.activated = true;
    context.updateAttachedShootingActivation(s, unit, rules);
    if (pending) closePendingCombatAction(s, pending.id);
    s.log = [...s.log, context.log(s, side, unit.profile.name, `${unit.profile.name} is selected to shoot but has no ranged weapons, so it makes no attacks.`, 'shoot')];
    if (!pending) reconcilePlayShootingAction(s, unit, side, rules, context);
    return s;
  }

  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!target) return state;
  const eligibleWeapons = context.eligibleShootingWeapons(unit, s, rules, pending?.allowActivated === true)
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
    const remainingEligibleWeapons = context.eligibleShootingWeapons(unit, s, rules, pending?.allowActivated === true);
    const hasRemainingTargets = remainingEligibleWeapons.some(weapon =>
      context.enemies(s, side).some(candidate => context.shootingWeaponCanTarget(s, unit, candidate, weapon, rules)),
    );
    if (remainingEligibleWeapons.length === 0 || !hasRemainingTargets) unit.activated = true;
  }
  context.updateAttachedShootingActivation(s, unit, rules, target.id);
  s.log = [...s.log, ...logs];
  if (unit.activated && s.pendingDeadlyDemises?.length) s.log = [...s.log, ...context.resolvePendingDeadlyDemisesInPlace(s)];
  if (unit.activated) context.clearFiringDeckWeapons(unit);
  if (pending && unit.activated) closePendingCombatAction(s, pending.id);
  if (!pending) reconcilePlayShootingAction(s, unit, side, rules, context);
  return s;
}

/** Resolves a complete multi-target shooting declaration after validation. */
export function shootPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayShootingAttackAllocation[],
  rules: RulesEdition,
  context: ManualShootingResolutionContext,
): BattleState {
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  if (pending?.snapShooting || !canResolveShootingUnit(state, unitId, side) || !allocations.length) return state;
  const s = context.clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return state;
  if (s.activeAttachedShootingUnitId && context.attachedUnitId(unit) !== s.activeAttachedShootingUnitId) return state;

  const eligibleWeapons = context.eligibleShootingWeapons(unit, s, rules, pending?.allowActivated === true)
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
    const assignedModelIndexes = new Set<number>();
    const allocationCandidates = weaponAllocations.map(allocation => {
      const target = s.units.find(candidate => candidate.id === allocation.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, s.terrain, s);
      return { allocation, eligibleModelIndexes };
    }).sort((a, b) => a.eligibleModelIndexes.length - b.eligibleModelIndexes.length);
    if (weaponAllocations.length > 1) {
      const availableModelIndexes = new Set(allocationCandidates.flatMap(candidate => candidate.eligibleModelIndexes));
      const declaredModels = weaponAllocations.reduce((total, allocation) => total + (allocation.modelCount ?? 0), 0);
      if (declaredModels !== availableModelIndexes.size) return state;
    }
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
  if (pending) closePendingCombatAction(s, pending.id);
  if (!pending) reconcilePlayShootingAction(s, unit, side, rules, context);
  return s;
}

/** Resolves an Overwatch declaration during the Movement reinforcements step. */
export function playSnapShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: OverwatchContext,
): PlayShootingWeaponOption[] {
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  const legacyOverwatch = state.phase === 'movement'
    && state.movementStep === 'reinforcements'
    && state.activeArmy !== side
    && !pending;
  if (pending && !pending.snapShooting) return [];
  if (!pending && !legacyOverwatch) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || (unit.activated && rules.metadata.edition !== '11e' && pending?.allowActivated !== true)
    || (!pending && !context.unitHasActiveStratagem(state, unit, 'fire-overwatch', 'movement'))) return [];
  return context.eligibleShootingWeapons(unit, state, rules, rules.metadata.edition === '11e' || pending?.allowActivated === true)
    .map(weapon => ({ weaponIndex: unit.profile.weapons.indexOf(weapon), name: weapon.name, targetIds: context.enemies(state, side)
      .filter(target => context.snapShootingWeaponCanTarget(state, unit, target, weapon, rules)).map(target => target.id) }))
    .filter(option => option.weaponIndex >= 0);
}

export function snapShootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition,
  context: OverwatchContext,
): BattleState {
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  const legacyOverwatch = state.phase === 'movement'
    && state.movementStep === 'reinforcements'
    && state.activeArmy !== side
    && !pending;
  if (pending && !pending.snapShooting) return state;
  if (!pending && !legacyOverwatch) return state;
  const s = context.clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = s.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target || (!pending && !context.unitHasActiveStratagem(s, unit, 'fire-overwatch', 'movement'))) return state;
  const eligibleWeapons = context.eligibleShootingWeapons(unit, s, rules, rules.metadata.edition === '11e' || pending?.allowActivated === true)
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
  if (pending) closePendingCombatAction(s, pending.id);
  s.log = [...s.log, ...logs];
  return s;
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

export function lockPlayUnitShooting(state: BattleState, unitId: string, side: Side, context: ShootingLockContext): BattleState {
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  if (pending?.snapShooting || (!pending && (state.phase !== 'shooting' || state.phaseStep !== PHASE_STEP.ShootingUnits))) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed);
  if (!existing || existing.activated) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of context.attachedUnitComponents(next, unit)) component.activated = true;
  next.activeAttachedShootingUnitId = undefined;
  next.attachedShootingTargetUnitId = undefined;
  if (pending) closePendingCombatAction(next, pending.id);
  if (!pending && normalShootingStep(next, side)) {
    completePhaseStepAction(next, shootingActionId(side, unitId));
  }
  return next;
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
