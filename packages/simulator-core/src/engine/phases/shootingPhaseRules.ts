import { PHASE_STEP, type BattleState, type BattleUnit, type Side } from '../../types/battle';
import type { RulesEdition } from '../rulesEngine';
import type { WeaponProfile } from '../../types/army';
import { unitCanUseBigGunsNeverTire, weaponIsCloseQuarters } from '../manualCombat';
import type { ManualShootingSelectionContext, PlayShootingWeaponOption, ShootingSelectionRulesContext } from '../manualCombat';
import { pendingCombatActionFor, shootingActionWindowOpen } from '../combatActionWindows';

export type ShootingPhaseRulesContext = ManualShootingSelectionContext & ShootingSelectionRulesContext & {
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  unitHasKeyword(unit: BattleUnit, keyword: string): boolean;
};

/** A unit can enter the normal Shooting step before its shooting type is chosen. */
export function canSelectShootingUnit(state: BattleState, unitId: string, side: Side): boolean {
  if (state.phase !== 'shooting' || state.phaseStep !== PHASE_STEP.ShootingUnits || state.activeArmy !== side) return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  return !!unit
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.activated
    && (!unit.performingAction || unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'titanic'));
}

/**
 * Normal shooting remains step-gated, while an event-backed window can
 * explicitly authorize a non-snap shooting action outside that step.
 */
export function canResolveShootingUnit(state: BattleState, unitId: string, side: Side): boolean {
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  if (pending?.snapShooting || !shootingActionWindowOpen(state, unitId, side)) return false;
  if (!pending && canSelectShootingUnit(state, unitId, side)) return true;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  return !!unit
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && (pending?.allowActivated === true || !unit.activated)
    && (!unit.performingAction || unit.profile.keywords.some(keyword => keyword.toLowerCase() === 'titanic'));
}

function unitCanShootWhilePerformingAction(unit: BattleUnit, context: ShootingPhaseRulesContext): boolean {
  return context.unitHasKeyword(unit, 'Titanic');
}

/** Returns the ranged profiles this unit may still use in the Shooting step. */
export function eligibleShootingWeapons(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
  allowActivated = false,
): WeaponProfile[] {
  if (unit.destroyed || unit.embarkedInUnitId || (!allowActivated && unit.activated) || state.firingDeckLockedUnitIds?.includes(unit.id)) return [];
  if (unit.performingAction && !unitCanShootWhilePerformingAction(unit, context)) return [];
  if (unit.fellBack || unit.movementAction === 'fellBack') return [];
  const firedSet = new Set(unit.firedWeaponIndices ?? []);
  const oneShotSpentSet = new Set(unit.oneShotSpentWeaponIndices ?? []);
  const firedProfileGroups = new Set(
    unit.profile.weapons
      .filter((_weapon: WeaponProfile, weaponIndex: number) => firedSet.has(weaponIndex))
      .map((weapon: WeaponProfile) => context.weaponProfileGroup(weapon))
      .filter((group: string | null): group is string => !!group),
  );
  const firedSidearm = unit.profile.weapons.some((weapon: WeaponProfile, weaponIndex: number) =>
    firedSet.has(weaponIndex) && context.weaponIsSidearm(weapon));
  const firedNonSidearm = unit.profile.weapons.some((weapon: WeaponProfile, weaponIndex: number) =>
    firedSet.has(weaponIndex) && !weapon.isMelee && weapon.range > 0 && !context.weaponIsSidearm(weapon));
  const foes = context.enemies(state, unit.side);
  const engaged = context.inEngagement(unit, foes, rules.engagementRange());
  const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(unit, context);
  const advanced = unit.movementAction === 'advanced';
  const closeQuartersShooting = canMakeCloseQuartersShooting(state, unit.id, unit.side, rules, context);
  const nonMonsterVehicle = rules.metadata.edition === '11e' && !unitCanUseBigGunsNeverTire(unit, context);
  return unit.profile.weapons.filter((weapon: WeaponProfile, weaponIndex: number) =>
    !weapon.isMelee
    && weapon.range > 0
    && !firedSet.has(weaponIndex)
    && !(context.weaponHasKeyword(weapon, 'One Shot') && oneShotSpentSet.has(weaponIndex))
    && !firedProfileGroups.has(context.weaponProfileGroup(weapon) ?? '')
    && (!advanced || context.weaponHasKeyword(weapon, 'Assault'))
    && (!engaged
      || bigGunsNeverTire
      || (closeQuartersShooting && weaponIsCloseQuarters(weapon, context))
      || (!nonMonsterVehicle && context.weaponIsSidearm(weapon))),
  ).filter((weapon: WeaponProfile) =>
    (!firedSidearm || context.weaponIsSidearm(weapon))
    && (!firedNonSidearm || !context.weaponIsSidearm(weapon)),
  );
}

export function unitCanBeSelectedToShootWithoutAttacks(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || unit.activated) return false;
  if (unit.performingAction && !unitCanShootWhilePerformingAction(unit, context)) return false;
  if (unit.fellBack || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return false;
  const engaged = context.inEngagement(unit, context.enemies(state, unit.side), rules.engagementRange());
  if (!engaged || unitCanUseBigGunsNeverTire(unit, context)) return true;
  if (rules.metadata.edition === '11e') return unit.profile.weapons.some((weapon: WeaponProfile) => weaponIsCloseQuarters(weapon, context));
  return unit.profile.weapons.some((weapon: WeaponProfile) => context.weaponIsSidearm(weapon));
}

export function shootingWeaponCanTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  if (target.destroyed || target.embarkedInUnitId || target.side === unit.side) return false;
  const engagementRange = rules.engagementRange();
  const foes = context.enemies(state, unit.side);
  const engaged = context.inEngagement(unit, foes, engagementRange);
  const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(unit, context);
  const closeQuarters = weaponIsCloseQuarters(weapon, context);
  const targetPool = engaged && !bigGunsNeverTire ? context.engagedEnemies(state, unit, rules) : foes;
  if (!targetPool.some((candidate: BattleUnit) => candidate.id === target.id && candidate.side === target.side)) return false;

  const representative = context.attachedUnitTargetRepresentative(state, target);
  const epicChallengeModelIndex = weapon.isMelee ? context.activeEpicChallengeModelIndex(state, target) : undefined;
  const epicChallengeVisible = epicChallengeModelIndex !== undefined
    && target.modelPositions[epicChallengeModelIndex] !== undefined
    && unit.modelPositions.some((from, modelIndex) => context.hasLOSEdgeToEdge(
      from,
      context.modelBaseRadius(unit, modelIndex),
      target.modelPositions[epicChallengeModelIndex],
      context.modelBaseRadius(target, epicChallengeModelIndex),
      state.terrain,
      state.ruleset?.edition,
    ));
  const precisionCharacter = (context.weaponHasKeyword(weapon, 'Precision') || epicChallengeModelIndex !== undefined)
    && context.unitHasKeyword(target, 'Character')
    && (epicChallengeModelIndex === undefined
      ? unit.modelPositions.some((from, modelIndex) => context.hasAnyModelLOS(from, context.modelBaseRadius(unit, modelIndex), target, state.terrain, state.ruleset?.edition))
      : epicChallengeVisible);
  if (representative?.id !== target.id && !precisionCharacter) return false;
  if (engaged && !bigGunsNeverTire && rules.metadata.edition === '11e' && !closeQuarters) return false;

  const targetEngagedWithFriendly = context.targetWithinFriendlyEngagement(state, target, unit.side, rules);
  const targetEngagedWithShooter = context.inEngagement(unit, [target], engagementRange);
  if (context.unitHasDatasheetRule(target, 'Lone Operative') && context.battleUnitsBaseEdgeDistance(unit, target) > 12) return false;
  if (context.weaponHasKeyword(weapon, 'Blast') && targetEngagedWithFriendly) return false;
  if (
    targetEngagedWithFriendly
    && !(context.weaponIsSidearm(weapon) && targetEngagedWithShooter)
    && !(rules.metadata.edition === '11e' && closeQuarters && targetEngagedWithShooter)
    && !(bigGunsNeverTire && targetEngagedWithShooter)
    && !unitCanUseBigGunsNeverTire(target, context)
  ) return false;
  const targetVisible = precisionCharacter || context.battleUnitHasLosToAttachedUnit(state, unit, target);
  const targetHidden = !targetVisible && context.attachedUnitComponents(state, target).some((component: BattleUnit) =>
    context.hasAnyHiddenModelPair(state, unit, component));
  return context.battleUnitToAttachedUnitDistance(state, unit, target) <= weapon.range
    && (targetVisible || (context.weaponHasKeyword(weapon, 'Indirect Fire') && !targetHidden));
}

/** Normal shooting is available only to an unengaged unit that did not advance. */
export function canMakeNormalShooting(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  const unit = shootingUnitFor(state, unitId, side);
  return !!unit
    && canSelectShootingUnit(state, unitId, side)
    && unit.movementAction !== 'advanced'
    && !context.inEngagement(unit, context.enemies(state, side), rules.engagementRange());
}

/** Assault shooting is available to an unengaged unit that advanced and has an Assault weapon. */
export function canMakeAssaultShooting(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  const unit = shootingUnitFor(state, unitId, side);
  return !!unit
    && canSelectShootingUnit(state, unitId, side)
    && unit.movementAction === 'advanced'
    && !context.inEngagement(unit, context.enemies(state, side), rules.engagementRange())
    && context.eligibleShootingWeapons(unit, state, rules)
      .some(weapon => context.weaponHasKeyword(weapon, 'Assault'));
}

/** Close-quarters shooting is available to an engaged unit that did not advance. */
export function canMakeCloseQuartersShooting(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  const unit = shootingUnitFor(state, unitId, side);
  if (rules.metadata.edition !== '11e'
    || !unit
    || !canSelectShootingUnit(state, unitId, side)
    || unit.movementAction === 'advanced') return false;
  if (!context.inEngagement(unit, context.enemies(state, side), rules.engagementRange())) return false;
  return context.unitHasKeyword(unit, 'Monster')
    || context.unitHasKeyword(unit, 'Vehicle')
    || unit.profile.weapons.some(weapon => context.weaponHasKeyword(weapon, 'Close-Quarters'));
}

/**
 * Indirect shooting is available only to an unengaged, non-advancing unit
 * with an Indirect Fire weapon. The shooting selection remains per weapon:
 * the unit's other weapons may still choose their normal visible targets.
 */
export function canMakeIndirectShooting(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  const unit = shootingUnitFor(state, unitId, side);
  return rules.metadata.edition === '11e'
    && !!unit
    && canSelectShootingUnit(state, unitId, side)
    && unit.movementAction !== 'advanced'
    && !context.inEngagement(unit, context.enemies(state, side), rules.engagementRange())
    && context.eligibleShootingWeapons(unit, state, rules)
      .some(weapon => context.weaponHasKeyword(weapon, 'Indirect Fire'));
}

/** Phase-owned selection rules for the normal Shooting step. */
export function playShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): PlayShootingWeaponOption[] {
  if (!canResolveShootingUnit(state, unitId, side)) return [];
  const unit = state.units.find(candidate =>
    candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId,
  );
  if (!unit) return [];
  const pending = pendingCombatActionFor(state, 'shooting', unitId, side);
  if (state.activeAttachedShootingUnitId && context.attachedUnitId(unit) !== state.activeAttachedShootingUnitId) return [];
  const lockedTargetId = state.activeAttachedShootingUnitId === context.attachedUnitId(unit)
    ? state.attachedShootingTargetUnitId
    : undefined;
  const options = context.eligibleShootingWeapons(unit, state, rules, pending?.allowActivated === true)
    .map((weapon: WeaponProfile) => {
      const weaponIndex = unit.profile.weapons.indexOf(weapon);
      const targetModelCounts = Object.fromEntries(context.enemies(state, side).flatMap(target => {
        if (!context.shootingWeaponCanTarget(state, unit, target, weapon, rules)) return [];
        const modelCount = context.participatingWeaponModelIndexes
          ? context.participatingWeaponModelIndexes(unit, target, weapon, weaponIndex, state.terrain, state).length
          : context.aliveWeaponModelCount(unit, weaponIndex);
        return modelCount > 0 ? [[target.id, modelCount]] : [];
      }));
      const targetIds = Object.keys(targetModelCounts).filter(targetId => !lockedTargetId || targetId === lockedTargetId);
      return {
        weaponIndex,
        name: weapon.name,
        targetIds,
        modelCount: new Set(targetIds.flatMap(targetId => {
          const target = context.enemies(state, side).find(candidate => candidate.id === targetId);
          return target && context.participatingWeaponModelIndexes
            ? context.participatingWeaponModelIndexes(unit, target, weapon, weaponIndex, state.terrain, state)
            : [];
        })).size,
        targetModelCounts: targetModelCounts as Record<string, number>,
      };
    })
    .filter(option => option.weaponIndex >= 0);
  if (options.length === 0 && context.unitCanBeSelectedToShootWithoutAttacks(unit, state, rules)) {
    return [{ weaponIndex: -1, name: 'No ranged weapons', targetIds: [] }];
  }
  return options;
}

/** Keeps the phase module's unit lookup explicit for future legal-action use. */
export function shootingUnitFor(state: BattleState, unitId: string, side: Side): BattleUnit | null {
  return state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId) ?? null;
}
