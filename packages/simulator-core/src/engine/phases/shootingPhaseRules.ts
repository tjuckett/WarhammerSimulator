import { PHASE_STEP, type BattleState, type BattleUnit, type Side } from '../../types/battle';
import type { RulesEdition } from '../rulesEngine';
import type { UnitProfile, WeaponProfile } from '../../types/army';
import { unitCanUseBigGunsNeverTire, weaponIsCloseQuarters } from '../manualCombat';
import type { ManualShootingSelectionContext, PlayShootingWeaponOption, ShootingSelectionRulesContext } from '../manualCombat';
import { pendingCombatActionFor, shootingActionWindowOpen } from '../combatActionWindows';

export type ShootingPhaseRulesContext = ManualShootingSelectionContext & ShootingSelectionRulesContext & {
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  unitHasKeyword(unit: BattleUnit, keyword: string): boolean;
  shootingVisibilityCache?: Map<string, { visible: boolean; hidden: boolean }>;
  shootingModelVisibilityCache?: Map<string, number[]>;
  modelWeaponLoadout?(profile: UnitProfile, modelIndex: number): number[];
  modelBaseEdgeDistance?(source: BattleUnit, sourceModelIndex: number, target: BattleUnit, targetModelIndex: number): number;
  modelIsHiddenFrom?(state: BattleState, source: BattleUnit, sourceModelIndex: number, target: BattleUnit, targetModelIndex: number): boolean;
  targetIsFullyHiddenAtLongRange?(state: BattleState, source: BattleUnit, target: BattleUnit, targetDistance: number): boolean;
  shootingQueryCache?: {
    foes?: BattleUnit[];
    engaged?: boolean;
    engagedEnemies?: BattleUnit[];
    attachedComponents: Map<string, BattleUnit[]>;
    targetEngagement: Map<string, boolean>;
    targetFriendlyEngagement: Map<string, boolean>;
    targetDistances: Map<string, number>;
    targetFullyHidden: Map<string, boolean>;
    unitRangeBounds: Map<string, UnitRangeBounds>;
  };
};

type UnitRangeBounds = {
  x: number;
  y: number;
  radius: number;
};

function createShootingQueryContext(context: ShootingPhaseRulesContext): ShootingPhaseRulesContext {
  const sourceAttachedUnitComponents = context.attachedUnitComponents as (
    state: BattleState,
    unit: BattleUnit,
    includeDestroyed?: boolean,
  ) => BattleUnit[];
  const queryCache = context.shootingQueryCache ?? {
    targetEngagement: new Map<string, boolean>(),
    targetFriendlyEngagement: new Map<string, boolean>(),
    targetDistances: new Map<string, number>(),
    targetFullyHidden: new Map<string, boolean>(),
    unitRangeBounds: new Map<string, UnitRangeBounds>(),
    attachedComponents: new Map<string, BattleUnit[]>(),
  };
  const modelDistanceCache = new Map<string, number>();
  queryCache.attachedComponents ??= new Map<string, BattleUnit[]>();
  queryCache.unitRangeBounds ??= new Map<string, UnitRangeBounds>();
  const queryContext: ShootingPhaseRulesContext = {
    ...context,
    shootingVisibilityCache: context.shootingVisibilityCache
      ?? new Map<string, { visible: boolean; hidden: boolean }>(),
    shootingModelVisibilityCache: context.shootingModelVisibilityCache ?? new Map<string, number[]>(),
    shootingQueryCache: queryCache,
  };
  if (context.modelBaseEdgeDistance) {
    queryContext.modelBaseEdgeDistance = (source, sourceModelIndex, target, targetModelIndex) => {
      const key = `${source.side}:${source.id}:${sourceModelIndex}:${target.side}:${target.id}:${targetModelIndex}`;
      const cached = modelDistanceCache.get(key);
      if (cached !== undefined) return cached;
      const distance = context.modelBaseEdgeDistance!(source, sourceModelIndex, target, targetModelIndex);
      modelDistanceCache.set(key, distance);
      return distance;
    };
  }
  queryContext.attachedUnitComponents = (state: BattleState, unit: BattleUnit, includeDestroyed = false) => {
    const key = `${unit.side}:${context.attachedUnitId(unit)}:${includeDestroyed ? 'all' : 'live'}`;
    const cached = queryCache.attachedComponents.get(key);
    if (cached) return cached;
    const components = sourceAttachedUnitComponents(state, unit, includeDestroyed);
    queryCache.attachedComponents.set(key, components);
    return components;
  };
  queryContext.attachedUnitTargetRepresentative = (state: BattleState, unit: BattleUnit) => {
    const components = queryContext.attachedUnitComponents(state, unit) as BattleUnit[];
    const bodyguardId = components.find(component => component.attachedToUnitId)?.attachedToUnitId;
    return components.find(component => component.id === bodyguardId) ?? components[0];
  };
  return queryContext;
}

/**
 * A conservative circle around every model base in a unit (or attached
 * unit). This is only a broad-phase rejection: candidates that pass still
 * use the exact base-edge distance below.
 */
function unitRangeBounds(
  state: BattleState,
  unit: BattleUnit,
  context: ShootingPhaseRulesContext,
): UnitRangeBounds | null {
  const cache = context.shootingQueryCache?.unitRangeBounds;
  const key = `${unit.side}:${context.attachedUnitId(unit)}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const components = context.attachedUnitComponents(state, unit) as BattleUnit[];
  const positions = components.flatMap(component => component.modelPositions.map((position, modelIndex) => ({
    component,
    position,
    modelIndex,
  })));
  if (!positions.length || !context.modelBaseRadius) return null;
  const minX = Math.min(...positions.map(({ position }) => position.x));
  const maxX = Math.max(...positions.map(({ position }) => position.x));
  const minY = Math.min(...positions.map(({ position }) => position.y));
  const maxY = Math.max(...positions.map(({ position }) => position.y));
  const x = (minX + maxX) / 2;
  const y = (minY + maxY) / 2;
  const radius = Math.max(...positions.map(({ component, position, modelIndex }) =>
    Math.hypot(position.x - x, position.y - y) + Math.SQRT2 * context.modelBaseRadius(component, modelIndex)));
  const bounds = { x, y, radius };
  cache?.set(key, bounds);
  return bounds;
}

function targetMayBeWithinWeaponRange(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weaponRange: number,
  context: ShootingPhaseRulesContext,
): boolean {
  const sourceBounds = unitRangeBounds(state, unit, context);
  const targetBounds = unitRangeBounds(state, target, context);
  if (!sourceBounds || !targetBounds) return true;
  return Math.hypot(sourceBounds.x - targetBounds.x, sourceBounds.y - targetBounds.y)
    <= weaponRange + sourceBounds.radius + targetBounds.radius;
}

// Attached Leaders and bodyguards are one unit for Engagement Range. The
// shooting resolver visits their component profiles separately, so every
// component must consult the combined footprint rather than only its own
// bases.
function attachedUnitEngagedEnemies(
  state: BattleState,
  unit: BattleUnit,
  foes: BattleUnit[],
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): BattleUnit[] {
  const components = context.attachedUnitComponents(state, unit) as BattleUnit[];
  return foes.filter(enemy => components.some(component =>
    context.inEngagement(component, [enemy], rules.engagementRange())));
}

function attachedUnitIsEngaged(
  state: BattleState,
  unit: BattleUnit,
  foes: BattleUnit[],
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): boolean {
  return attachedUnitEngagedEnemies(state, unit, foes, rules, context).length > 0;
}

function visibleModelIndexesForTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  context: ShootingPhaseRulesContext,
): number[] | null {
  if (!context.modelBaseRadius || !context.hasLOSEdgeToEdge || !context.modelIsHiddenFrom) return null;
  const key = `${unit.side}:${unit.id}:${target.side}:${target.id}`;
  const cached = context.shootingModelVisibilityCache?.get(key);
  if (cached) return cached;
  const visible: number[] = [];
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const fromCenter = unit.modelPositions[modelIndex];
    if (!fromCenter) continue;
    const canSee = target.modelPositions.some((toCenter, targetModelIndex) =>
      !context.modelIsHiddenFrom!(state, unit, modelIndex, target, targetModelIndex)
      && context.hasLOSEdgeToEdge!(
        fromCenter,
        context.modelBaseRadius!(unit, modelIndex),
        toCenter,
        context.modelBaseRadius!(target, targetModelIndex),
        state.terrain,
        state.ruleset?.edition,
      ),
    );
    if (canSee) visible.push(modelIndex);
  }
  context.shootingModelVisibilityCache?.set(key, visible);
  return visible;
}

function participatingModelIndexesForTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  context: ShootingPhaseRulesContext,
  carriedModelIndexes?: readonly number[],
): number[] {
  if (!context.modelWeaponLoadout || !context.modelBaseEdgeDistance) {
    return context.participatingWeaponModelIndexes
      ? context.participatingWeaponModelIndexes(unit, target, weapon, weaponIndex, state.terrain, state)
      : [];
  }
  const visible = weapon.isMelee || context.weaponHasKeyword(weapon, 'Indirect Fire')
    ? null
    : visibleModelIndexesForTarget(state, unit, target, context);
  const visibleSet = visible ? new Set(visible) : null;
  const modelIndexes: number[] = [];
  const candidateModelIndexes = carriedModelIndexes
    ?? Array.from({ length: unit.remainingModels }, (_, modelIndex) => modelIndex)
      .filter(modelIndex => {
        const rosterModelIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
        return context.modelWeaponLoadout!(unit.profile, rosterModelIndex).includes(weaponIndex);
      });
  for (const modelIndex of candidateModelIndexes) {
    if (visibleSet && !visibleSet.has(modelIndex)) continue;
    if (target.modelPositions.some((_toCenter, targetModelIndex) =>
      context.modelBaseEdgeDistance!(unit, modelIndex, target, targetModelIndex) <= weapon.range,
    )) modelIndexes.push(modelIndex);
  }
  return modelIndexes;
}

function shootingVisibilityKey(unit: BattleUnit, target: BattleUnit): string {
  return `${unit.side}:${unit.id}:${target.side}:${target.id}`;
}

function shootingTargetVisibility(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  context: ShootingPhaseRulesContext,
): { visible: boolean; hidden: boolean } {
  const key = shootingVisibilityKey(unit, target);
  const cached = context.shootingVisibilityCache?.get(key);
  if (cached) return cached;
  const result = context.battleUnitVisibilityToAttachedUnit
    ? context.battleUnitVisibilityToAttachedUnit(state, unit, target)
    : (() => {
      const visible = context.battleUnitHasLosToAttachedUnit(state, unit, target);
      return {
        visible,
        hidden: !visible && context.attachedUnitComponents(state, target).some((component: BattleUnit) =>
          context.hasAnyHiddenModelPair(state, unit, component)),
      };
    })();
  context.shootingVisibilityCache?.set(key, result);
  return result;
}

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
  options: { deferEngagement?: boolean } = {},
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
  const engaged = !options.deferEngagement && attachedUnitIsEngaged(state, unit, foes, rules, context);
  const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(unit, context);
  const advanced = unit.movementAction === 'advanced';
  const closeQuartersShooting = engaged
    && canMakeCloseQuartersShooting(state, unit.id, unit.side, rules, context);
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
  const foes = context.enemies(state, unit.side);
  const engaged = attachedUnitIsEngaged(state, unit, foes, rules, context);
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
  options: { deferLineOfSight?: boolean } = {},
): boolean {
  if (target.destroyed || target.embarkedInUnitId || target.side === unit.side) return false;
  if (options.deferLineOfSight) {
    // The declaration UI presents a fast, conservative target shortlist.
    // Target-specific engagement, Lone Operative, and Blast restrictions all
    // require model-pair geometry across other units, so they are checked by
    // the exact target validation and resolver instead of on unit selection.
    if (!targetMayBeWithinWeaponRange(state, unit, target, weapon.range, context)) return false;
    const foes = context.enemies(state, unit.side);
    const engaged = attachedUnitIsEngaged(state, unit, foes, rules, context);
    if (engaged && !unitCanUseBigGunsNeverTire(unit, context)
      && rules.metadata.edition === '11e' && !weaponIsCloseQuarters(weapon, context)) return false;
    const representative = context.attachedUnitTargetRepresentative(state, target);
    return representative?.id === target.id
      || (context.weaponHasKeyword(weapon, 'Precision') && context.unitHasKeyword(target, 'Character'));
  }
  const engagementRange = rules.engagementRange();
  const queryCache = context.shootingQueryCache;
  const foes = queryCache?.foes ?? context.enemies(state, unit.side);
  if (queryCache && !queryCache.foes) queryCache.foes = foes;
  const engaged = queryCache?.engaged ?? attachedUnitIsEngaged(state, unit, foes, rules, context);
  if (queryCache) queryCache.engaged = engaged;
  const bigGunsNeverTire = engaged && unitCanUseBigGunsNeverTire(unit, context);
  const closeQuarters = weaponIsCloseQuarters(weapon, context);
  const targetPool = engaged && !bigGunsNeverTire
    ? queryCache?.engagedEnemies ?? attachedUnitEngagedEnemies(state, unit, foes, rules, context)
    : foes;
  if (queryCache && engaged && !bigGunsNeverTire && !queryCache.engagedEnemies) queryCache.engagedEnemies = targetPool;
  if (!targetPool.some((candidate: BattleUnit) => candidate.id === target.id && candidate.side === target.side)) return false;

  // Exact range is kept on the core-action path. Declaration candidates return
  // earlier with a conservative bounds check so selection stays lightweight.
  const targetKey = `${target.side}:${target.id}`;
  const targetDistance = queryCache?.targetDistances.get(targetKey)
    ?? context.battleUnitToAttachedUnitDistance(state, unit, target);
  queryCache?.targetDistances.set(targetKey, targetDistance);
  if (targetDistance > weapon.range) return false;

  const fullyHidden = queryCache?.targetFullyHidden.get(targetKey)
    ?? context.targetIsFullyHiddenAtLongRange?.(state, unit, target, targetDistance)
    ?? false;
  queryCache?.targetFullyHidden.set(targetKey, fullyHidden);
  if (fullyHidden) return false;

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
  const precisionWeapon = context.weaponHasKeyword(weapon, 'Precision') || epicChallengeModelIndex !== undefined;
  const precisionCharacter = precisionWeapon
    && context.unitHasKeyword(target, 'Character')
    && (epicChallengeModelIndex === undefined
      ? unit.modelPositions.some((from, modelIndex) => context.hasAnyModelLOS(from, context.modelBaseRadius(unit, modelIndex), target, state.terrain, state.ruleset?.edition))
      : epicChallengeVisible);
  if (representative?.id !== target.id && !precisionCharacter) return false;
  if (engaged && !bigGunsNeverTire && rules.metadata.edition === '11e' && !closeQuarters) return false;

  const targetEngagedWithFriendly = queryCache?.targetFriendlyEngagement.get(targetKey)
    ?? context.targetWithinFriendlyEngagement(state, target, unit.side, rules);
  queryCache?.targetFriendlyEngagement.set(targetKey, targetEngagedWithFriendly);
  const targetEngagedWithShooter = queryCache?.targetEngagement.get(targetKey)
    ?? attachedUnitEngagedEnemies(state, unit, [target], rules, context).length > 0;
  queryCache?.targetEngagement.set(targetKey, targetEngagedWithShooter);
  if (context.unitHasDatasheetRule(target, 'Lone Operative') && context.battleUnitsBaseEdgeDistance(unit, target) > 12) return false;
  if (context.weaponHasKeyword(weapon, 'Blast') && targetEngagedWithFriendly) return false;
  if (
    targetEngagedWithFriendly
    && !(context.weaponIsSidearm(weapon) && targetEngagedWithShooter)
    && !(rules.metadata.edition === '11e' && closeQuarters && targetEngagedWithShooter)
    && !(bigGunsNeverTire && targetEngagedWithShooter)
    && !unitCanUseBigGunsNeverTire(target, context)
  ) return false;
  const visibility = shootingTargetVisibility(state, unit, target, context);
  const targetVisible = precisionCharacter || visibility.visible;
  const targetHidden = !targetVisible && visibility.hidden;
  return targetVisible || (context.weaponHasKeyword(weapon, 'Indirect Fire') && !targetHidden);
}

/**
 * Returns unit-level shooting targets while sharing the expensive LOS result
 * across every weapon carried by the source unit.
 */
export function shootingTargetUnitIds(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): string[] {
  const queryContext = createShootingQueryContext(context);
  const targetIds = new Set<string>();
  const weapons = queryContext.eligibleShootingWeapons(unit, state, rules)
    .map(weapon => ({ weapon, weaponIndex: unit.profile.weapons.indexOf(weapon) }))
    .filter(option => option.weaponIndex >= 0 && queryContext.aliveWeaponModelCount(unit, option.weaponIndex) > 0);
  const targets = queryContext.enemies(state, unit.side);
  for (const { weapon } of weapons) {
    for (const target of targets) {
      if (shootingWeaponCanTarget(state, unit, target, weapon, rules, queryContext)) targetIds.add(target.id);
    }
  }
  return [...targetIds];
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
    || unit.profile.weapons.some(weapon => weaponIsCloseQuarters(weapon, context));
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
function shootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
  deferLineOfSight: boolean,
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
  const enemies = context.enemies(state, side);
  const queryContext = createShootingQueryContext(context);
  const options = eligibleShootingWeapons(
    unit,
    state,
    rules,
    queryContext,
    pending?.allowActivated === true,
    { deferEngagement: deferLineOfSight },
  )
    .map((weapon: WeaponProfile) => {
      const weaponIndex = unit.profile.weapons.indexOf(weapon);
      // Target declaration only needs unit-level legality. Calculating every
      // individual firing model for every possible target made selecting a
      // multi-target unit block the UI on a large battlefield. Exact model
      // participation is calculated only for a target the player assigns.
      const targetIds = enemies
        .filter(target => shootingWeaponCanTarget(
          state,
          unit,
          target,
          weapon,
          rules,
          queryContext,
          { deferLineOfSight },
        ))
        .map(target => target.id)
        .filter(targetId => !lockedTargetId || targetId === lockedTargetId);
      const modelCount = context.aliveWeaponModelCount(unit, weaponIndex);
      return {
        weaponIndex,
        name: weapon.name,
        targetIds,
        modelCount,
        // This is a declaration-time upper bound. The exact eligible model
        // count is checked once the player assigns a specific target.
        targetModelCounts: Object.fromEntries(targetIds.map(targetId => [targetId, modelCount])),
      };
    })
    // A profile can remain in the unit's weapon list after a wargear choice
    // replaces or removes it.  It is not a shooting declaration when no
    // living model actually carries that profile.
    .filter(option => option.weaponIndex >= 0 && option.modelCount > 0);
  if (options.length === 0 && context.unitCanBeSelectedToShootWithoutAttacks(unit, state, rules)) {
    return [{ weaponIndex: -1, name: 'No ranged weapons', targetIds: [] }];
  }
  return options;
}

/** Exact legal targets, used by core actions and final validation. */
export function playShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): PlayShootingWeaponOption[] {
  return shootingWeaponOptions(state, unitId, side, rules, context, false);
}

/**
 * Cheap declaration candidates for an interactive UI. They intentionally
 * defer terrain ray tests until the player chooses a target.
 */
export function playShootingWeaponDeclarationOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): PlayShootingWeaponOption[] {
  return shootingWeaponOptions(state, unitId, side, rules, context, true);
}

/**
 * Exact per-model participation for one declared target. The query context is
 * shared across all requested weapons, so terrain rays and Hidden checks are
 * evaluated once per shooter/target rather than once per weapon profile.
 */
export function shootingWeaponModelIndexesForTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weaponIndexes: readonly number[],
  rules: RulesEdition,
  context: ShootingPhaseRulesContext,
): Record<number, number[]> {
  const queryContext = createShootingQueryContext(context);
  const result: Record<number, number[]> = {};
  for (const weaponIndex of weaponIndexes) {
    const weapon = unit.profile.weapons[weaponIndex];
    if (!weapon || weapon.isMelee || weapon.range <= 0) continue;
    if (!shootingWeaponCanTarget(state, unit, target, weapon, rules, queryContext)) continue;
    result[weaponIndex] = participatingModelIndexesForTarget(
      state,
      unit,
      target,
      weapon,
      weaponIndex,
      queryContext,
    );
  }
  return result;
}

/** Keeps the phase module's unit lookup explicit for future legal-action use. */
export function shootingUnitFor(state: BattleState, unitId: string, side: Side): BattleUnit | null {
  return state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId) ?? null;
}
