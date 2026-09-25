// Fight-phase state transitions, movement actions, and melee resolution.
// Shared attack resolution remains in manualCombat; this module owns when and
// how Fight can call it.
// @ts-nocheck
import { PHASE_STEP, type BattleState, type BattleUnit, type FightMovementIntent, type LogEntry, type PendingCombatContinuation, type PhaseStepAction, type Position, type Side } from '../../types/battle';
import type { UnitProfile, WeaponProfile } from '../../types/army';
import type { RulesEdition } from '../rulesEngine';
import { COHERENCY_VERTICAL_RANGE } from '../coherency';
import { clearModelMovementWaypoints, moveModelTowardPoint } from '../interactiveMovement';
import {
  BASE_CONTACT_EPSILON,
  closestModelDistanceToTargets,
  modelPositionChanged,
  MOVEMENT_RULE_EPSILON,
} from '../modelMovementRules';
import * as manualCombat from '../manualCombat';
import { closePendingCombatAction, pendingCombatActionFor } from '../combatActionWindows';
import {
  clearPhaseStepActions,
  completePhaseStepAction,
  phaseStepActionLedgerFor,
  setPhaseStepActionStatus,
  setPhaseStepActions,
} from '../phaseStepActions';
import {
  fightPhaseStep,
  isFightConsolidationStep,
  isFightPileInStep,
  isFightResolutionStep,
  isFightUnitsStep,
  playFightActivationUnitIds,
  playFightFirstUnitIds,
  playFightConsolidationOptions,
  playFightPileInTargetOptions,
  attachedGroupRepresentatives,
  playFightSideCanPass,
  playOverrunFightUnitIds,
  playUnitCanConsolidate,
  playUnitCanPileIn,
  sideCanSelectFightUnit,
  unitChargedThisTurn,
  type FightMovementRulesContext,
  type FightPhaseContext,
} from './fightPhaseRules';

export type PlayFightWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
  /** UI metadata for a Leader/bodyguard unit resolved as one Fight selection. */
  sourceUnitId?: string;
  sourceWeaponIndex?: number;
  weapon?: WeaponProfile;
  modelCount?: number;
  targetModelCounts?: Record<string, number>;
  /** Eligible attacking model indexes for each target, used for board highlighting. */
  targetModelIndexes?: Record<string, number[]>;
};

export type PlayMeleeAttackAllocation = {
  weaponIndex: number;
  targetUnitId: string;
  /** Number of models using this weapon against the target. */
  modelCount?: number;
};

export type PlayMeleeAttackSplit = {
  targetUnitId: string;
  attacks: number;
};

export type PlayFightMovementValidationFailure =
  | 'no-pending-movement'
  | 'missing-start-position'
  | 'locked-model-moved'
  | 'model-not-closer'
  | 'unit-not-engaged'
  | 'initial-engagement-lost'
  | 'consolidation-requirement';

export type PlayFightMovementValidation = {
  valid: boolean;
  failure?: PlayFightMovementValidationFailure;
  modelIds?: string[];
};

export interface FightPhaseActionContext extends FightMovementRulesContext {
  clone(state: BattleState): BattleState;
  distance(a: Position, b: Position): number;
  centroid(positions: Position[]): Position;
  modelBaseRadius(unit: BattleUnit, modelIndex?: number): number;
  modelBaseEdgeHorizontalDistance(
    unit: BattleUnit,
    modelIndex: number,
    target: BattleUnit,
    targetModelIndex: number,
  ): number;
  hasNoBaseOverlap(state: BattleState, unit: BattleUnit, modelIndices: Set<number>): boolean;
  hasNoWallOverlap(state: BattleState, unit: BattleUnit, modelIndices: Set<number>): boolean;
  log(state: BattleState, side: Side, source: string, message: string, kind: string): LogEntry;
  moveRange: number;
  modelWeaponLoadout(profile: UnitProfile, modelIndex: number): number[];
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  chooseOneProfilePerGroup<T extends { weapon: WeaponProfile }>(weapons: T[]): T[];
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  aliveWeaponCopyCount?(unit: BattleUnit, weaponIndex: number): number;
  aliveWeaponModelIndexes(unit: BattleUnit, weaponIndex: number): number[];
  participatingWeaponModelIndexes(
    unit: BattleUnit,
    target: BattleUnit,
    weapon: WeaponProfile,
    weaponIndex: number,
    terrain: BattleState['terrain'],
    state: BattleState,
  ): number[];
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  resolveCombatAttacks(...args: any[]): LogEntry[];
  resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState): LogEntry[];
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
}

export interface AutomatedFightContext extends FightPhaseActionContext {
  selectOverrunFight(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  pileIn(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  consolidate(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
}

/** Captures the engagement snapshot required by the Fight step. */
export function startFightStepInPlace(state: BattleState, rules: RulesEdition, context: FightPhaseContext): void {
  state.fightStepStarted = true;
  state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = undefined;
  state.fightPassedSides = undefined;
  state.activeAttachedFightUnitId = undefined;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
  state.engagedUnitIdsAtFightStepStart = state.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
        && context.inEngagement(unit, [enemy], rules.engagementRange())))
    .map(unit => unit.id);
  state.fightEligibleUnitIds = state.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && context.unitEligibleToFight(unit, state, rules))
    .map(unit => unit.id);
}

function pileInActionId(side: Side, unitId: string): string {
  return `pile-in:${side}:${unitId}`;
}

function fightActionId(side: Side, unitId: string): string {
  return `fight:${side}:${unitId}`;
}

function fightActionFor(state: BattleState, side: Side, unitId: string): PhaseStepAction | null {
  return phaseStepActionLedgerFor(state)?.actions.find(action =>
    action.id === fightActionId(side, unitId)) ?? null;
}

function pileInActionUnitIds(state: BattleState, side: Side): string[] {
  return (phaseStepActionLedgerFor(state)?.actions ?? [])
    .filter(action => action.kind === 'pile-in'
      && action.side === side
      && action.status === 'available'
      && !!action.unitId)
    .map(action => action.unitId!);
}

function pileInActionFor(state: BattleState, side: Side, unitId: string): PhaseStepAction | null {
  return phaseStepActionLedgerFor(state)?.actions.find(action =>
    action.id === pileInActionId(side, unitId)) ?? null;
}

/**
 * Publishes the current side's optional Pile In opportunities. Fight rules
 * remain authoritative for the eligibility calculation; this ledger is the
 * typed state exposed to UI, controllers, and AI.
 */
export function refreshPlayFightPileInActions(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): void {
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state)) return;
  const side = state.fightPileInSide ?? state.activeArmy;
  // Every candidate asks for the same enemy list and repeatedly resolves the
  // same attached-unit components while checking engagement and 5" reach.
  // Cache those read-only lookups for this refresh. The cache is deliberately
  // local because action refreshes can mutate the ledger and callers may mutate
  // a cloned BattleState after this function returns.
  const enemiesBySide = new Map<Side, BattleUnit[]>();
  const componentsByUnitId = new Map<string, BattleUnit[]>();
  const cachedContext: FightPhaseActionContext = {
    ...context,
    enemies: (queryState, querySide) => {
      if (queryState !== state) return context.enemies(queryState, querySide);
      const cached = enemiesBySide.get(querySide);
      if (cached) return cached;
      const enemies = context.enemies(queryState, querySide);
      enemiesBySide.set(querySide, enemies);
      return enemies;
    },
    attachedComponents: (queryState, unit) => {
      if (queryState !== state) return context.attachedComponents(queryState, unit);
      const cached = componentsByUnitId.get(unit.id);
      if (cached) return cached;
      const components = context.attachedComponents(queryState, unit);
      componentsByUnitId.set(unit.id, components);
      return components;
    },
  };
  // Compute each unit's target list once. `playFightPileInUnitIds` delegates
  // to the same target query, so calling it first and then querying targets
  // again for every action doubled the geometry work whenever the step was
  // entered or refreshed.
  const eligible = attachedGroupRepresentatives(state, state.units
    .filter(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId)
    .filter(unit => playUnitCanPileIn(state, unit.id, side, rules, cachedContext)), cachedContext)
    .map(unit => ({
      unitId: unit.id,
      targetUnitIds: playFightPileInTargetOptions(state, unit.id, side, rules, cachedContext),
    }))
    .filter(entry => entry.targetUnitIds.length > 0);
  const unitIds = eligible.map(entry => entry.unitId);
  const targetUnitIdsByUnitId = new Map(eligible.map(entry => [entry.unitId, entry.targetUnitIds] as const));
  const existing = phaseStepActionLedgerFor(state)?.actions ?? [];
  const incomingIds = new Set(unitIds.map(unitId => pileInActionId(side, unitId)));
  const incoming = unitIds.map(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId);
    const groupLabel = unit
      ? context.attachedComponents(state, unit).map(component => component.profile.name).join(' + ')
      : unitId;
    const existingAction = pileInActionFor(state, side, unitId);
    return {
      id: pileInActionId(side, unitId),
      phase: state.phase,
      step: PHASE_STEP.FightPileIn,
      kind: 'pile-in' as const,
      side,
      unitId,
      targetUnitIds: targetUnitIdsByUnitId.get(unitId) ?? [],
      requiredToAdvance: false,
      // Refreshes happen only outside an open movement window. A stale
      // in-progress action from an older save must become selectable again;
      // the pending movement record is the authority while a move is open.
      status: existingAction && existingAction.status !== 'available' && existingAction.status !== 'in-progress'
        ? existingAction.status
        : 'available' as const,
      label: `${groupLabel}: Pile In`,
      description: 'Optional Pile In move during the Fight phase.',
    } satisfies PhaseStepAction;
  });
  const retained = existing
    .filter(action => !incomingIds.has(action.id))
    .map(action => action.kind === 'pile-in'
      && action.side === side
      && ['available', 'in-progress'].includes(action.status)
      ? { ...action, status: 'superseded' as const }
      : action);
  setPhaseStepActions(state, PHASE_STEP.FightPileIn, [...retained, ...incoming]);
}

/**
 * Publishes the current Fight selections after the Fight priority rules have
 * chosen the side and priority class that may act next. The ledger is an
 * observation of that result; it never replaces the Fight rules that decide
 * whether a unit is eligible or which side may select it.
 */
export function refreshPlayFightActions(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): void {
  if (!isFightUnitsStep(state)) return;

  const unitIds = [...new Set((([0, 1] as Side[]).flatMap(side =>
    playFightActivationUnitIds(state, side, rules, context))))];
  const existing = phaseStepActionLedgerFor(state)?.actions ?? [];
  const incomingIds = new Set(unitIds.map(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId);
    return unit ? fightActionId(unit.side, unitId) : '';
  }));
  const incoming = unitIds.flatMap(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId
      && !candidate.destroyed && !candidate.embarkedInUnitId);
    if (!unit) return [];
    const options = playFightWeaponOptions(state, unitId, unit.side, rules, context);
    const targetUnitIds = [...new Set(options.flatMap(option => option.targetIds))];
    const existingAction = fightActionFor(state, unit.side, unitId);
    return [{
      id: fightActionId(unit.side, unitId),
      phase: state.phase,
      step: PHASE_STEP.FightUnits,
      kind: 'fight' as const,
      side: unit.side,
      unitId,
      targetUnitIds,
      requiredToAdvance: false,
      status: existingAction && !['available', 'in-progress'].includes(existingAction.status)
        ? existingAction.status
        : existingAction?.status === 'in-progress'
          ? 'in-progress' as const
          : 'available' as const,
      label: `${unit.profile.name}: Fight`,
      description: targetUnitIds.length
        ? 'Optional Fight selection during the Fight phase.'
        : 'Optional Fight selection; the unit has no eligible melee target or melee weapon.',
    } satisfies PhaseStepAction];
  });
  const retained = existing
    .filter(action => !incomingIds.has(action.id))
    .map(action => action.kind === 'fight'
      && ['available', 'in-progress'].includes(action.status)
      ? { ...action, status: 'superseded' as const }
      : action);
  setPhaseStepActions(state, PHASE_STEP.FightUnits, [...retained, ...incoming]);
}

function refreshPlayFightConsolidationFightActions(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): void {
  if (!isFightConsolidationStep(state) || !state.consolidationStepStarted) return;

  const unitIds = [...new Set((([0, 1] as Side[]).flatMap(side =>
    playFightActivationUnitIds(state, side, rules, context))))];
  const existing = phaseStepActionLedgerFor(state)?.actions ?? [];
  const incomingIds = new Set(unitIds.map(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId);
    return unit ? fightActionId(unit.side, unitId) : '';
  }));
  const incoming = unitIds.flatMap(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId
      && !candidate.destroyed && !candidate.embarkedInUnitId);
    if (!unit) return [];
    const options = playFightWeaponOptions(state, unitId, unit.side, rules, context);
    const targetUnitIds = [...new Set(options.flatMap(option => option.targetIds))];
    const existingAction = fightActionFor(state, unit.side, unitId);
    return [{
      id: fightActionId(unit.side, unitId),
      phase: state.phase,
      step: PHASE_STEP.FightConsolidate,
      kind: 'fight' as const,
      side: unit.side,
      unitId,
      targetUnitIds,
      requiredToAdvance: false,
      status: existingAction && !['available', 'in-progress'].includes(existingAction.status)
        ? existingAction.status
        : existingAction?.status === 'in-progress'
          ? 'in-progress' as const
          : 'available' as const,
      label: `${unit.profile.name}: Fight reaction`,
      description: 'Optional Fight opportunity created during Consolidation.',
    } satisfies PhaseStepAction];
  });
  const retained = existing
    .filter(action => !incomingIds.has(action.id))
    .map(action => action.kind === 'fight'
      && ['available', 'in-progress'].includes(action.status)
      ? { ...action, status: 'superseded' as const }
      : action);
  setPhaseStepActions(state, PHASE_STEP.FightConsolidate, [...retained, ...incoming]);
}

function completePlayFightActionAndRefresh(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): void {
  if (isFightUnitsStep(state)) {
    completePhaseStepAction(state, fightActionId(unit.side, unit.id));
    refreshPlayFightActions(state, rules, context);
  } else if (isFightConsolidationStep(state)) {
    completePhaseStepAction(state, fightActionId(unit.side, unit.id));
    refreshPlayFightConsolidationActions(state, rules, context);
  }
}

function skipOptionalMovementActions(state: BattleState, kind: 'pile-in' | 'consolidate', side: Side): void {
  for (const action of phaseStepActionLedgerFor(state)?.actions ?? []) {
    if (action.kind === kind && action.side === side && ['available', 'in-progress'].includes(action.status)) {
      completePhaseStepAction(state, action.id, 'skipped');
    }
  }
}

export function finishAttachedFightComponent(state: BattleState, unit: BattleUnit, rules: RulesEdition, context: FightPhaseContext): void {
  if (rules.metadata.edition !== '11e') return;
  const components = context.attachedComponents(state, unit);
  // Leaders and bodyguards are one selected unit. A component can still be
  // Fight-eligible because the attached unit charged or was engaged at the
  // start of the step even when none of its own models can strike. Complete
  // such a component with the combined activation instead of leaving an
  // impossible 0/0 follow-up action in the phase ledger.
  if (context.componentHasFightAttacks) {
    for (const component of components) {
      if (!component.activated
        && context.unitEligibleToFight(component, state, rules)
        && !context.componentHasFightAttacks(state, component, rules)) {
        component.activated = true;
      }
    }
  }
  const remaining = components
    .filter(component => !component.activated && context.unitEligibleToFight(component, state, rules));
  if (remaining.length) {
    state.activeAttachedFightUnitId = context.attachedUnitId(unit);
    return;
  }
  state.activeAttachedFightUnitId = undefined;
  const forcedUnit = state.units.find(candidate => candidate.id === state.forcedFightUnitId);
  if (forcedUnit && context.attachedUnitId(forcedUnit) === context.attachedUnitId(unit)) state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = unit.side;
  state.fightPassedSides = undefined;
  if (state.consolidationStepStarted && state.consolidationPendingFightUnitIds?.includes(unit.id)) {
    state.consolidationPendingFightUnitIds = state.consolidationPendingFightUnitIds.filter(unitId => unitId !== unit.id);
  }
}

/** Enters the Pile In step and publishes its initial current-side actions. */
export function startPlayFightPileInStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight'
    || fightPhaseStep(state) !== PHASE_STEP.FightStart || state.pendingFightMovement) return state;
  const next = context.clone(state);
  next.phaseStep = PHASE_STEP.FightPileIn;
  next.fightStepStarted = false;
  next.fightPileInSide = next.activeArmy;
  refreshPlayFightPileInActions(next, rules, context);
  return next;
}

/** Starts the interactive Fight step after both sides have completed ordinary pile-ins. */
export function startPlayFightStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state) || state.fightStepStarted || state.pendingFightMovement) return state;
  const next = context.clone(state);
  next.units.forEach(unit => { unit.activated = false; });
  next.fightPileInSide = undefined;
  startFightStepInPlace(next, rules, context);
  next.phaseStep = PHASE_STEP.FightUnits;
  clearPhaseStepActions(next);
  refreshPlayFightActions(next, rules, context);
  next.log = [...next.log, context.log(next, next.activeArmy, next.armies[next.activeArmy].name,
    'Fight step begins; engagement eligibility is recorded.', 'phase')];
  return next;
}

export function playFightPileInUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseActionContext): string[] {
  const pileInSide = state.fightPileInSide ?? state.activeArmy;
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state) || pileInSide !== side) return [];
  const candidates = state.units
    .filter(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId)
    .filter(unit => playUnitCanPileIn(state, unit.id, side, rules, context));
  return attachedGroupRepresentatives(state, candidates, context).map(unit => unit.id);
}

/** Resolves one ordinary pile-in side boundary or enters Fight after both sides. */
export function advancePlayFightPileInStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state) || state.pendingFightMovement) return state;
  const currentSide = state.fightPileInSide ?? state.activeArmy;
  const currentLedger = phaseStepActionLedgerFor(state);
  const currentUnitIds = currentLedger
    ? currentLedger.actions
      .filter(action => action.kind === 'pile-in'
        && action.side === currentSide
        && (action.status === 'available' || action.status === 'in-progress')
        && !!action.unitId)
      .map(action => action.unitId!)
    : playFightPileInUnitIds(state, currentSide, rules, context);
  const next = context.clone(state);
  if (currentUnitIds.length > 0) {
    // Pile In is optional. Advancing the side boundary means the player has
    // declined every remaining eligible Pile In opportunity for this side.
    refreshPlayFightPileInActions(next, rules, context);
    skipOptionalMovementActions(next, 'pile-in', currentSide);
  }
  if (currentSide === state.activeArmy) {
    next.fightPileInSide = (currentSide === 0 ? 1 : 0) as Side;
    refreshPlayFightPileInActions(next, rules, context);
    return next;
  }
  return startPlayFightStep(next, rules, context);
}

export function playFightStepNeedsStart(state: BattleState, rules: RulesEdition): boolean {
  return rules.metadata.edition === '11e'
    && isFightPileInStep(state)
    && state.fightStepStarted === false
    && state.fightPileInSide === undefined;
}

export function playConsolidationPendingFightUnitIds(state: BattleState, side: Side, rules: RulesEdition): string[] {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state)) return [];
  return (state.consolidationPendingFightUnitIds ?? []).filter(unitId =>
    state.units.some(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.activated));
}

export function playFightPhaseHasPendingActivations(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): boolean {
  if (rules.metadata.edition !== '11e' || !isFightResolutionStep(state)) return false;
  return state.consolidationStepStarted
    ? playConsolidationPendingFightUnitIds(state, 0, rules).length > 0
      || playConsolidationPendingFightUnitIds(state, 1, rules).length > 0
    : playFightActivationUnitIds(state, 0, rules, context).length > 0
      || playFightActivationUnitIds(state, 1, rules, context).length > 0;
}

/** Records an 11e Fight pass and hands the selection opportunity to the opponent. */
export function passPlayFight(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  // A staged hit/wound/save result is still an active combat decision.  Do
  // not let the optional Fight pass boundary consume it and enter
  // Consolidation before the defender has acknowledged the remaining rolls.
  if (state.pendingCombatResolution || !playFightSideCanPass(state, side, rules, context)) return state;
  const next = context.clone(state);
  next.fightPassedSides = [...new Set([...(next.fightPassedSides ?? []), side])];
  next.lastFightSelectionSide = side;
  for (const action of phaseStepActionLedgerFor(next)?.actions ?? []) {
    if (action.kind === 'fight' && action.side === side
      && ['available', 'in-progress'].includes(action.status)) {
      completePhaseStepAction(next, action.id, 'skipped');
    }
  }
  next.log = [...next.log, context.log(next, side, next.armies[side].name,
    `${next.armies[side].name} passes its Fight selection opportunity.`, 'fight')];
  if (!playFightPhaseHasPendingActivations(next, rules, context)) {
    return startPlayConsolidationStep(next, rules, context);
  }
  refreshPlayFightActions(next, rules, context);
  return next;
}

export function startPlayConsolidationStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightUnitsStep(state) || state.consolidationStepStarted
    || state.pendingFightMovement || playFightPhaseHasPendingActivations(state, rules, context)) return state;
  const next = context.clone(state);
  next.consolidationStepStarted = true;
  next.consolidationSide = next.activeArmy;
  const engagedAtFightStart = new Set(next.engagedUnitIdsAtFightStepStart ?? []);
  const fightEligible = new Set(next.fightEligibleUnitIds ?? []);
  next.consolidationEligibleUnitIds = next.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && (fightEligible.has(unit.id)
        || unitChargedThisTurn(next, unit)
        || engagedAtFightStart.has(unit.id)))
    .map(unit => unit.id);
  next.consolidationPendingFightUnitIds = [];
  next.phaseStep = PHASE_STEP.FightConsolidate;
  refreshPlayFightConsolidationActions(next, rules, context);
  next.log = [...next.log, context.log(next, next.activeArmy, next.armies[next.activeArmy].name,
    'Consolidation step begins; no further units may be selected to fight.', 'phase')];
  return next;
}

export function playConsolidationUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseActionContext): string[] {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state)
    || !state.consolidationStepStarted || state.consolidationSide !== side) return [];
  const eligible = new Set(state.consolidationEligibleUnitIds ?? []);
  const candidates = state.units
    .filter(unit => eligible.has(unit.id) && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId && !unit.consolidated)
    .filter(unit => playUnitCanConsolidate(state, unit.id, side, rules, context));
  return attachedGroupRepresentatives(state, candidates, context).map(unit => unit.id);
}

function consolidationActionId(side: Side, unitId: string): string {
  return `consolidate:${side}:${unitId}`;
}

function consolidationActionUnitIds(state: BattleState, side: Side): string[] {
  return [...new Set((phaseStepActionLedgerFor(state)?.actions ?? [])
    .filter(action => action.kind === 'consolidate'
      && action.side === side
      && action.status === 'available'
      && !!action.unitId)
    .map(action => action.unitId!))];
}

function consolidationActionFor(state: BattleState, side: Side, unitId: string): PhaseStepAction | null {
  return phaseStepActionLedgerFor(state)?.actions.find(action =>
    action.id === consolidationActionId(side, unitId)) ?? null;
}

/**
 * Publishes the current side's optional Consolidation opportunities. The
 * Fight rules still decide the legal mode and targets; this inventory is the
 * typed opportunity exposed to UI, controllers, AI, undo, and replay.
 */
export function refreshPlayFightConsolidationActions(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): void {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state)
    || !state.consolidationStepStarted) return;
  const side = state.consolidationSide ?? state.activeArmy;
  const unitIds = playConsolidationUnitIds(state, side, rules, context);
  const existing = phaseStepActionLedgerFor(state)?.actions ?? [];
  const incomingIds = new Set(unitIds.map(unitId => consolidationActionId(side, unitId)));
  const incoming = unitIds.map(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId);
    const groupLabel = unit
      ? context.attachedComponents(state, unit).map(component => component.profile.name).join(' + ')
      : unitId;
    const existingAction = consolidationActionFor(state, side, unitId);
    const options = playFightConsolidationOptions(state, unitId, side, rules, context);
    const modes = [...new Set(options.map(option => option.mode))];
    const targetUnitIds = [...new Set(options.flatMap(option => option.targetUnitIds))];
    const modeDescription = modes.map(mode => {
      const objective = options.find(option => option.mode === 'objective');
      return mode === 'objective' && objective
        ? `objective ${objective.objectiveIndex + 1}`
        : mode;
    }).join(', ');
    return {
      id: consolidationActionId(side, unitId),
      phase: state.phase,
      step: PHASE_STEP.FightConsolidate,
      kind: 'consolidate' as const,
      side,
      unitId,
      targetUnitIds,
      requiredToAdvance: false,
      // The pending movement record is authoritative while a move is open.
      // A refresh after undo/load must make an old optional action selectable.
      status: existingAction && existingAction.status !== 'available' && existingAction.status !== 'in-progress'
        ? existingAction.status
        : 'available' as const,
      label: `${groupLabel}: Consolidate`,
      description: modeDescription
        ? `Optional Consolidation (${modeDescription}) during the Fight phase.`
        : 'Optional Consolidation move during the Fight phase.',
    } satisfies PhaseStepAction;
  });
  const retained = existing
    .filter(action => !incomingIds.has(action.id))
    .map(action => action.kind === 'consolidate'
      && action.side === side
      && ['available', 'in-progress'].includes(action.status)
      ? { ...action, status: 'superseded' as const }
      : action);
  setPhaseStepActions(state, PHASE_STEP.FightConsolidate, [...retained, ...incoming]);
  refreshPlayFightConsolidationFightActions(state, rules, context);
}

export function advancePlayConsolidationStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state)
    || !state.consolidationStepStarted || state.pendingFightMovement
    || playFightPhaseHasPendingActivations(state, rules, context)) return state;
  const side = state.consolidationSide ?? state.activeArmy;
  const currentUnitIds = playConsolidationUnitIds(state, side, rules, context);
  const next = context.clone(state);
  if (currentUnitIds.length > 0) {
    refreshPlayFightConsolidationActions(next, rules, context);
    // Consolidation is optional. Advancing the side boundary declines all
    // remaining eligible Consolidation opportunities for this side.
    skipOptionalMovementActions(next, 'consolidate', side);
  }
  if (side === state.activeArmy) {
    next.consolidationSide = (side === 0 ? 1 : 0) as Side;
    refreshPlayFightConsolidationActions(next, rules, context);
    return next;
  }
  next.phaseStep = PHASE_STEP.FightEnd;
  clearPhaseStepActions(next);
  return next;
}

/**
 * Advances the explicit Fight substep without allowing the generic phase
 * coordinator to know about pile-in, activation, or consolidation rules.
 * `null` means this state is not an 11th-edition Fight phase; returning the
 * unchanged state means the phase is waiting for a player choice.
 */
export function advanceFightPhaseStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState | null {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight' || state.pendingFightMovement
    || fightPhaseStep(state) === PHASE_STEP.FightEnd) return null;
  const step = fightPhaseStep(state);
  if (step === PHASE_STEP.FightStart) {
    return startPlayFightPileInStep(state, rules, context);
  }
  if (step === PHASE_STEP.FightPileIn) return advancePlayFightPileInStep(state, rules, context);
  if (step === PHASE_STEP.FightUnits) {
    if (playFightPhaseHasPendingActivations(state, rules, context)) return state;
    return startPlayConsolidationStep(state, rules, context);
  }
  if (step === PHASE_STEP.FightConsolidate) {
    return advancePlayConsolidationStep(state, rules, context);
  }
  return null;
}

function closestEnemyModelFor(
  unit: BattleUnit,
  modelIndex: number,
  state: BattleState,
  context: FightPhaseActionContext,
  selectedTargets = context.enemies(state, unit.side),
) {
  const closest = closestModelPairUsingDistance(
    unit,
    modelIndex,
    selectedTargets,
    context.modelBaseEdgeHorizontalDistance,
  );
  return closest
    ? { unit: closest.target, modelIndex: closest.targetModelIndex, distance: closest.distance }
    : null;
}

function closestModelPairUsingDistance(
  source: BattleUnit,
  sourceModelIndex: number,
  targets: BattleUnit[],
  modelBaseEdgeDistance: (
    source: BattleUnit,
    sourceModelIndex: number,
    target: BattleUnit,
    targetModelIndex: number,
  ) => number,
) {
  let closest: { target: BattleUnit; targetModelIndex: number; distance: number } | null = null;
  for (const target of targets) {
    for (let targetModelIndex = 0; targetModelIndex < target.modelPositions.length; targetModelIndex++) {
      const distance = modelBaseEdgeDistance(source, sourceModelIndex, target, targetModelIndex);
      if (!closest || distance < closest.distance) {
        closest = { target, targetModelIndex, distance };
      }
    }
  }
  return closest;
}

export function nearestObjectiveToModel(model: Position, state: BattleState, context: FightPhaseActionContext): Position | null {
  if (!state.objectives.length) return null;
  return state.objectives.reduce((best, objective) =>
    context.distance(model, objective) < context.distance(model, best) ? objective : best);
}

export function moveModelTowardEnemy(
  unit: BattleUnit,
  modelIndex: number,
  state: BattleState,
  maxDistance: number,
  context: FightPhaseActionContext,
  selectedTargets?: BattleUnit[],
): boolean {
  const closest = closestEnemyModelFor(unit, modelIndex, state, context, selectedTargets);
  if (!closest) return false;
  const targetModel = closest.unit.modelPositions[closest.modelIndex];
  return moveModelTowardPoint(unit, modelIndex, targetModel, maxDistance, context.centroid,
    context.modelBaseRadius(unit, modelIndex) + context.modelBaseRadius(closest.unit, closest.modelIndex) + 0.02);
}

/** Applies an automated, straight-line Pile In or Consolidation move. */
export function applyFightPhaseMove(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  if (state.phase !== 'fight' || (state.activeArmy !== side && rules.metadata.edition !== '11e')) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  const movementUnit = existing ? attachedGroupRepresentatives(state, [existing], context)[0] ?? existing : undefined;
  if (!movementUnit || context.attachedComponents(state, movementUnit).some(component => context.unitSurgedThisPhase(state, component))) return state;
  const isOverrunPileIn = kind === 'pileIn' && rules.metadata.edition === '11e'
    && isFightUnitsStep(state) && movementUnit.overrunFightSelected;
  const intent = normalizeFightMovementIntent(state, movementUnit, side, kind, rules, context);
  if (!intent) return state;
  const pending = createFightMovementCheckpoint(state, movementUnit, side, kind, intent, rules, context);
  const selectedTargets = liveFightTargetUnits(state, side, intent.targetUnitIds ?? [], context);

  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === movementUnit.id && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  let movedModels = 0;
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    if (pending.lockedModelIds?.includes(`${unit.id}:${modelIndex}`)) continue;
    const before = unit.modelPositions[modelIndex];
    const movedTowardEnemy = selectedTargets.length > 0
      && moveModelTowardEnemy(unit, modelIndex, next, context.moveRange, context, selectedTargets);
    const movedTowardObjective = !movedTowardEnemy && kind === 'consolidate' && intent.consolidationMode === 'objective'
      ? (() => {
          const objective = intent.objectiveIndex === undefined ? null : next.objectives[intent.objectiveIndex] ?? null;
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
  if (!validateFightMovement(next, pending, unit, rules, context).valid) return state;
  commitFightMovement(next, unit, pending, rules, context);
  if (kind === 'pileIn' && rules.metadata.edition === '11e' && isFightPileInStep(next)) {
    completePhaseStepAction(next, pileInActionId(side, movementUnit.id));
    refreshPlayFightPileInActions(next, rules, context);
  }
  if (kind === 'consolidate' && rules.metadata.edition === '11e' && isFightConsolidationStep(next)) {
    completePhaseStepAction(next, consolidationActionId(side, movementUnit.id));
    refreshPlayFightConsolidationActions(next, rules, context);
  }
  next.log = [...next.log, context.log(next, side, unit.profile.name,
    `${unit.profile.name} ${isOverrunPileIn ? 'makes its Overrun pile-in' : kind === 'pileIn' ? 'piles in' : 'consolidates'}${movedModels ? ` with ${movedModels} model${movedModels === 1 ? '' : 's'}` : ''}.`, 'move')];
  return next;
}

export function selectMeleeWeapons(
  unit: BattleUnit,
  options: Array<{ weapon: WeaponProfile; weaponIndex: number }>,
  requested: number | 'all' | ReadonlySet<number>,
  context: Pick<FightPhaseActionContext, 'modelWeaponLoadout' | 'weaponHasKeyword' | 'chooseOneProfilePerGroup'>,
): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  return options.filter(option => selectedMeleeWeaponModelIndexes(unit, options, requested, context).has(option.weaponIndex));
}

/**
 * Returns the number of models that may still be assigned to one target for
 * a provisional 11th-edition Fight declaration. This is the same per-model
 * normal-weapon selection used by resolution, exposed so a UI never has to
 * guess whether two profiles compete for the same model.
 */
export function playFightWeaponAllocationCap(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayMeleeAttackAllocation[],
  weaponIndex: number,
  targetUnitId: string,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): number {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const targetId = canonicalFightTargetId(state, side, targetUnitId, context);
  const target = state.units.find(candidate => candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target || !context.canFightTarget(unit, target)) return 0;
  const meleeWeapons = unit.profile.weapons
    .map((weapon, index) => ({ weapon, weaponIndex: index }))
    .filter(option => option.weapon.isMelee);
  const requested = new Set(allocations.map(allocation => allocation.weaponIndex));
  const selected = selectedMeleeWeaponModelIndexes(unit, meleeWeapons, requested, context);
  const weapon = meleeWeapons.find(option => option.weaponIndex === weaponIndex);
  if (!weapon) return 0;
  const available = (selected.get(weaponIndex) ?? new Set<number>());
  const eligible = context.participatingWeaponModelIndexes(unit, target, weapon.weapon, weaponIndex, state.terrain, state)
    .filter(modelIndex => available.has(modelIndex));
  const assignedElsewhere = allocations
    .filter(allocation => allocation.weaponIndex === weaponIndex && allocation.targetUnitId !== targetUnitId)
    .reduce((total, allocation) => total + (allocation.modelCount ?? 0), 0);
  return Math.max(0, eligible.length - assignedElsewhere);
}

// A model may use one normal melee weapon, plus every Extra Attacks weapon it
// carries.  Keep that ownership explicit so resolving a mixed-loadout unit
// cannot accidentally give the same model attacks from two normal weapons.
function selectedMeleeWeaponModelIndexes(
  unit: BattleUnit,
  options: Array<{ weapon: WeaponProfile; weaponIndex: number }>,
  requested: number | 'all' | ReadonlySet<number>,
  context: Pick<FightPhaseActionContext, 'modelWeaponLoadout' | 'weaponHasKeyword' | 'chooseOneProfilePerGroup'>,
): Map<number, Set<number>> {
  const selected = new Map<number, Set<number>>();
  const add = (weaponIndex: number, modelIndex: number) => {
    const models = selected.get(weaponIndex) ?? new Set<number>();
    models.add(modelIndex);
    selected.set(weaponIndex, models);
  };
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const carried = new Set(context.modelWeaponLoadout(unit.profile, rosterIndex));
    const modelOptions = options.filter(option => carried.has(option.weaponIndex));
    context.chooseOneProfilePerGroup(modelOptions.filter(option => context.weaponHasKeyword(option.weapon, 'Extra Attacks')))
      .forEach(option => add(option.weaponIndex, modelIndex));
    const normalOptions = modelOptions.filter(option => !context.weaponHasKeyword(option.weapon, 'Extra Attacks'));
    const normal = context.chooseOneProfilePerGroup(normalOptions);
    const requestedNormal = typeof requested === 'number'
      ? normalOptions.find(option => option.weaponIndex === requested)
      : requested instanceof Set
        ? normalOptions.find(option => requested.has(option.weaponIndex))
        : undefined;
    const chosenNormal = requestedNormal ?? normal[0];
    if (chosenNormal) add(chosenNormal.weaponIndex, modelIndex);
  }
  return selected;
}

export function fightPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayMeleeAttackAllocation[],
  rules: RulesEdition,
  context: FightPhaseActionContext,
  options: { interactiveStage?: boolean } = {},
): BattleState {
  const reject = (_reason: string, _details: Record<string, unknown> = {}) => state;
  const pending = pendingCombatActionFor(state, 'fight', unitId, side);
  if (!allocations.length) return reject('no allocations');
  if (!pending && !sideCanSelectFightUnit(state, side, rules, context)) return reject('side cannot select fighter', { unitId, side });
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !context.unitCanFight(unit, state, rules)
    || (!pending && !playFightActivationUnitIds(state, side, rules, context).includes(unit.id))) return reject('fighter is not eligible', { unitId, side });
  const meleeWeapons = unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex })).filter(option => option.weapon.isMelee);
  const requestedWeaponIndexes = new Set(allocations.map(allocation => allocation.weaponIndex));
  const selectedModelIndexes = rules.metadata.edition === '11e'
    ? selectedMeleeWeaponModelIndexes(unit, meleeWeapons, requestedWeaponIndexes, context)
    : new Map<number, Set<number>>();
  const selectableWeapons = (rules.metadata.edition === '11e'
    ? selectMeleeWeapons(unit, meleeWeapons, requestedWeaponIndexes, context)
    : context.chooseOneProfilePerGroup(meleeWeapons))
    // A profile carried only by models outside Engagement Range is not part
    // of this Fight declaration. Requiring an allocation for it makes the
    // core reject the same legal weapon list shown by the popup.
    .filter(option => state.units.some(target =>
      target.side !== side
      && !target.destroyed
      && !target.embarkedInUnitId
      && context.canFightTarget(unit, target)
      && context.participatingWeaponModelIndexes(unit, target, option.weapon, option.weaponIndex, state.terrain, state)
        .some(modelIndex => selectedModelIndexes.get(option.weaponIndex)?.has(modelIndex) ?? true),
    ));
  const selectableIndexes = new Set(selectableWeapons.map(option => option.weaponIndex));
  const grouped = new Map<number, PlayMeleeAttackAllocation[]>();
  for (const allocation of allocations) {
    if (!selectableIndexes.has(allocation.weaponIndex)) return reject('weapon is not selectable', { allocation, selectableIndexes: [...selectableIndexes] });
    const targetUnitId = canonicalFightTargetId(state, side, allocation.targetUnitId, context);
    const target = state.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
    if (!target || !context.canFightTarget(unit, target) || !unitEngagedWithTargets(state, unit, [target], rules.engagementRange(), context)) return reject('target is not a legal Fight target', { allocation });
    grouped.set(allocation.weaponIndex, [...(grouped.get(allocation.weaponIndex) ?? []), { ...allocation, targetUnitId }]);
  }
  if (grouped.size !== selectableIndexes.size) return reject('a selected weapon has no allocation', { allocatedWeaponIndexes: [...grouped.keys()], selectableIndexes: [...selectableIndexes] });
  for (const selected of selectableWeapons) {
    const entries = grouped.get(selected.weaponIndex) ?? [];
    const selectedModelIndexesForWeapon = rules.metadata.edition === '11e'
      ? [...(selectedModelIndexes.get(selected.weaponIndex) ?? [])]
      : context.aliveWeaponModelIndexes(unit, selected.weaponIndex);
    // A model can only contribute this weapon if it is itself in Engagement
    // Range of at least one legal target. The popup already receives this
    // exact per-target model set; using every carrier here made a legal split
    // (five engaged models) fail because two out-of-range carriers existed.
    const availableModelIndexes = selectedModelIndexesForWeapon.filter(modelIndex =>
      state.units.some(target =>
        target.side !== side
        && !target.destroyed
        && !target.embarkedInUnitId
        && context.canFightTarget(unit, target)
        && context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, state.terrain, state)
          .includes(modelIndex)),
    );
    const assignedModelIndexes = new Set<number>();
    if (entries.length > 1 && entries.reduce((total, entry) => total + (entry.modelCount ?? 0), 0) !== availableModelIndexes.length) return reject('split does not allocate every eligible model', { weaponIndex: selected.weaponIndex, entries, availableModelIndexes });
    const allocationCandidates = entries.map(entry => {
      const target = state.units.find(candidate => candidate.id === entry.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, state.terrain, state)
        .filter(modelIndex => availableModelIndexes.includes(modelIndex));
      return { entry, eligibleModelIndexes };
    }).sort((a, b) => a.eligibleModelIndexes.length - b.eligibleModelIndexes.length);
    for (const { entry, eligibleModelIndexes } of allocationCandidates) {
      if (entry.modelCount !== undefined && (!Number.isInteger(entry.modelCount) || entry.modelCount < 1)) return reject('model count is invalid', { weaponIndex: selected.weaponIndex, entry });
      const remainingModelIndexes = eligibleModelIndexes.filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = entry.modelCount ?? remainingModelIndexes.length;
      if (modelCount > remainingModelIndexes.length) return reject('allocation exceeds eligible models', { weaponIndex: selected.weaponIndex, entry, eligibleModelIndexes, availableModelIndexes });
      remainingModelIndexes.slice(0, modelCount).forEach(modelIndex => assignedModelIndexes.add(modelIndex));
    }
  }
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit) return reject('fighter disappeared while preparing resolution', { unitId, side });
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} locks all melee targets before rolling:`, 'fight')];
  const stagedContinuations: Array<{ targetUnitId: string; weaponIndex: number; continuation: PendingCombatContinuation; stage: 'hits' }> = [];
  if (options.interactiveStage !== false) next.pendingCombatResolution = undefined;
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
        .filter(modelIndex => (rules.metadata.edition !== '11e' || selectedModelIndexes.get(selected.weaponIndex)?.has(modelIndex))
          && !assignedModelIndexes.has(modelIndex));
      const modelCount = entry.modelCount ?? eligibleModelIndexes.length;
      const modelIndexes = eligibleModelIndexes.slice(0, modelCount);
      modelIndexes.forEach(modelIndex => assignedModelIndexes.add(modelIndex));
      const result = manualCombat.createCombatWeaponResult(fightingUnit, target, selected.weapon, selected.weaponIndex);
      logs.push(...context.resolveCombatAttacks(fightingUnit, target, selected.weapon, selected.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        modelIndexes,
        selectedTargetCount: entries.length,
        result,
        interactiveStage: options.interactiveStage !== false,
      }));
      const staged = next.pendingCombatResolution?.continuation;
      if (options.interactiveStage !== false && staged) {
        stagedContinuations.push({
          targetUnitId: target.id,
          weaponIndex: selected.weaponIndex,
          continuation: staged,
          stage: 'hits',
        });
        next.pendingCombatResolution = undefined;
      }
      manualCombat.appendCombatWeaponResult(next, fightingUnit, result);
    }
  }
  if (stagedContinuations.length > 0) {
    const first = stagedContinuations[0];
    const firstResult = next.lastShootingResolution?.weapons.find(result =>
      result.weaponIndex === first.weaponIndex && result.targetUnitId === first.targetUnitId,
    );
    const hitGroups = firstResult?.groups.filter(group => group.kind === 'hit') ?? [];
    const rolls = hitGroups.flatMap(group => group.rolls);
    next.pendingCombatResolution = {
      kind: 'fight',
      attackerUnitId: fightingUnit.id,
      attackerSide: fightingUnit.side,
      targetUnitId: first.targetUnitId,
      weaponIndex: first.weaponIndex,
      stage: 'hits',
      rolls,
      target: hitGroups[0]?.target,
      rollIds: rolls.map((_roll, index) => `fight:${fightingUnit.id}:hits:${index}`),
      continuation: first.continuation,
      continuationQueue: stagedContinuations.slice(1),
    };
  }
  if (!logs.length) return reject('resolution produced no combat log entries', { unitId, allocations });
  fightingUnit.activated = true;
  if (pending) closePendingCombatAction(next, pending.id);
  else {
    finishAttachedFightComponent(next, fightingUnit, rules, context);
    completePlayFightActionAndRefresh(next, fightingUnit, rules, context);
  }
  next.log = [...next.log, ...logs];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export function fightPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition,
  context: FightPhaseActionContext,
  targetSplits?: PlayMeleeAttackSplit[],
): BattleState {
  const pending = pendingCombatActionFor(state, 'fight', unitId, side);
  if (!pending && !sideCanSelectFightUnit(state, side, rules, context)) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const resolvedTargetUnitId = canonicalFightTargetId(state, side, targetUnitId, context);
  const target = state.units.find(candidate => candidate.id === resolvedTargetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const normalizedTargetSplits = targetSplits?.map(split => ({
    ...split,
    targetUnitId: canonicalFightTargetId(state, side, split.targetUnitId, context),
  }));
  const splitTargetIds = normalizedTargetSplits?.map(split => split.targetUnitId) ?? [];
  const splitTargets = splitTargetIds.map(splitTargetId => state.units.find(candidate => candidate.id === splitTargetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId));
  if (!unit || !target || !context.unitCanFight(unit, state, rules)
    || (!pending && !playFightActivationUnitIds(state, side, rules, context).includes(unit.id))) return state;
  if (!context.canFightTarget(unit, target) || !unitEngagedWithTargets(state, unit, [target], rules.engagementRange(), context)) return state;
  if (normalizedTargetSplits?.length && splitTargets.some(splitTarget => !splitTarget || !context.canFightTarget(unit, splitTarget) || !unitEngagedWithTargets(state, unit, [splitTarget], rules.engagementRange(), context))) return state;
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const fightTarget = next.units.find(candidate => candidate.id === resolvedTargetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit || !fightTarget) return state;
  if (weaponIndex === -1 || (weaponIndex === 'all' && !fightingUnit.profile.weapons.some(weapon => weapon.isMelee))) {
    if (fightingUnit.profile.weapons.some(weapon => weapon.isMelee)) return state;
    fightingUnit.activated = true;
    if (pending) closePendingCombatAction(next, pending.id);
    else {
      finishAttachedFightComponent(next, fightingUnit, rules, context);
      completePlayFightActionAndRefresh(next, fightingUnit, rules, context);
    }
    next.log = [...next.log, context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} is selected to fight ${fightTarget.profile.name} but has no melee weapons, so it makes no attacks.`, 'fight')];
    return next;
  }
  const meleeWeapons = fightingUnit.profile.weapons.map((weapon, index) => ({ weapon, weaponIndex: index })).filter(option => option.weapon.isMelee);
  const selectedMeleeWeapons = rules.metadata.edition === '11e'
    ? selectMeleeWeapons(fightingUnit, meleeWeapons, weaponIndex, context)
    : weaponIndex === 'all' ? context.chooseOneProfilePerGroup(meleeWeapons) : meleeWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedMeleeWeapons.length || (normalizedTargetSplits?.length && (weaponIndex === 'all' || selectedMeleeWeapons.length !== 1))) return state;
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, fightingUnit.overrunFightSelected
    ? `${fightingUnit.profile.name} makes an Overrun Fight against ${fightTarget.profile.name}:`
    : `${fightingUnit.profile.name} fights ${fightTarget.profile.name}:`, 'fight')];
  let madeAttacks = false;
  if (normalizedTargetSplits?.length) {
    const option = selectedMeleeWeapons[0];
    const maxTargets = Number.parseInt(String(option.weapon.attacks), 10);
    const maxAttacks = maxTargets * (context.aliveWeaponCopyCount?.(fightingUnit, option.weaponIndex)
      ?? context.aliveWeaponModelCount(fightingUnit, option.weaponIndex));
    const declaredAttacks = normalizedTargetSplits.reduce((total, split) => total + split.attacks, 0);
    if (!Number.isFinite(maxTargets) || normalizedTargetSplits.some(split => split.attacks < 1 || !Number.isInteger(split.attacks))
      || new Set(normalizedTargetSplits.map(split => split.targetUnitId)).size !== normalizedTargetSplits.length || declaredAttacks !== maxAttacks) return state;
    for (const split of normalizedTargetSplits) {
      const splitTarget = next.units.find(candidate => candidate.id === split.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
      if (!splitTarget || !context.canFightTarget(fightingUnit, splitTarget) || !unitEngagedWithTargets(next, fightingUnit, [splitTarget], rules.engagementRange(), context)) continue;
      const result = manualCombat.createCombatWeaponResult(fightingUnit, splitTarget, option.weapon, option.weaponIndex);
      const attackLogs = context.resolveCombatAttacks(fightingUnit, splitTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        attackCountOverride: split.attacks,
        selectedTargetCount: normalizedTargetSplits.length,
        result,
        interactiveStage: false,
      });
      manualCombat.appendCombatWeaponResult(next, fightingUnit, result);
      logs.push(...attackLogs); madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed) break;
    }
    if (madeAttacks) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
  } else {
    for (const option of selectedMeleeWeapons) {
      const result = manualCombat.createCombatWeaponResult(fightingUnit, fightTarget, option.weapon, option.weaponIndex);
      const modelIndexes = context.participatingWeaponModelIndexes(fightingUnit, fightTarget, option.weapon, option.weaponIndex, next.terrain, next);
      const attackLogs = context.resolveCombatAttacks(fightingUnit, fightTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        modelIndexes,
        result,
        interactiveStage: selectedMeleeWeapons.length === 1
          && context.attachedComponents(next, fightingUnit).length <= 1,
      });
      manualCombat.appendCombatWeaponResult(next, fightingUnit, result);
      logs.push(...attackLogs);
      if (attackLogs.length > 0) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
      madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed || fightTarget.destroyed) break;
    }
  }
  if (!madeAttacks) return state;
  fightingUnit.activated = true;
  if (pending) closePendingCombatAction(next, pending.id);
  else {
    finishAttachedFightComponent(next, fightingUnit, rules, context);
    completePlayFightActionAndRefresh(next, fightingUnit, rules, context);
  }
  next.log = [...next.log, ...logs];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export function playFightWeaponOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: FightPhaseActionContext): PlayFightWeaponOption[] {
  const pending = pendingCombatActionFor(state, 'fight', unitId, side);
  if (!pending && !sideCanSelectFightUnit(state, side, rules, context)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !context.unitCanFight(unit, state, rules)) return [];
  if (!pending && !playFightActivationUnitIds(state, side, rules, context).includes(unit.id)) return [];
  const targetUnits = attachedGroupRepresentatives(state, context.enemies(state, side), context)
    .filter(target => context.canFightTarget(unit, target) && unitEngagedWithTargets(state, unit, [target], rules.engagementRange(), context));
  const targetIds = targetUnits.map(target => target.id);
  const options = unit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee)
    // A unit profile keeps every datasheet weapon after casualties. Only show
    // a profile when a surviving model still carries it; otherwise a dead Nob
    // can leave a misleading, unallocatable 0/0 Big Choppa row behind.
    .filter(option => context.aliveWeaponModelIndexes(unit, option.weaponIndex).length > 0)
    .map(option => {
      // Compute participation once per weapon/target pair. The previous code
      // called this geometry-heavy query twice (once for the count and again
      // for the eligible model set), which doubled Fight popup selection time.
      const targetModelCounts: Record<string, number> = {};
      const targetModelIndexes: Record<string, number[]> = {};
      const eligibleModelIndexes = new Set<number>();
      targetUnits.forEach(target => {
        const modelIndexes = context.participatingWeaponModelIndexes(
          unit,
          target,
          option.weapon,
          option.weaponIndex,
          state.terrain,
          state,
        );
        if (modelIndexes.length > 0) {
          targetModelCounts[target.id] = modelIndexes.length;
          targetModelIndexes[target.id] = modelIndexes;
          modelIndexes.forEach(modelIndex => eligibleModelIndexes.add(modelIndex));
        }
      });
      const result: PlayFightWeaponOption = {
        weaponIndex: option.weaponIndex,
        name: option.weapon.name,
        targetIds: Object.keys(targetModelCounts),
      };
      Object.defineProperties(result, {
        modelCount: { value: eligibleModelIndexes.size, enumerable: false },
        targetModelCounts: { value: targetModelCounts, enumerable: false },
        targetModelIndexes: { value: targetModelIndexes, enumerable: false },
      });
      return result;
    });
  if (options.length === 0) return [{ weaponIndex: -1, name: 'No melee weapons', targetIds }];
  return options;
}

export function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const foes = context.enemies(state, unit.side).filter(enemy => context.canFightTarget(unit, enemy)
    && context.inEngagement(unit, [enemy], rules.engagementRange()));
  if (!foes.length) return [];
  unit.activated = true;
  finishAttachedFightComponent(state, unit, rules, context);
  const meleeOptions = unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex })).filter(option => option.weapon.isMelee);
  const meleeWeapons = rules.metadata.edition === '11e'
    ? selectMeleeWeapons(unit, meleeOptions, 'all', context)
    : context.chooseOneProfilePerGroup(meleeOptions);
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

export function selectPlayOverrunFight(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  const selected = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  const representative = selected ? attachedGroupRepresentatives(state, [selected], context)[0] : undefined;
  const groupIds = representative ? context.attachedComponents(state, representative).map(component => component.id) : [];
  if (!selected || !groupIds.some(candidateId => playOverrunFightUnitIds(state, side, rules, context).includes(candidateId))) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === representative?.id && candidate.side === side);
  if (!unit) return state;
  const nextComponents = context.attachedComponents(next, unit);
  nextComponents.forEach(component => { component.overrunFightSelected = true; });
  next.fightEligibleUnitIds = [...new Set([...(next.fightEligibleUnitIds ?? []), ...nextComponents.map(component => component.id)])];
  const groupName = nextComponents.map(component => component.profile.name).join(' + ');
  next.log = [...next.log, context.log(next, side, groupName, `${groupName} is selected to make an Overrun Fight.`, 'fight')];
  return next;
}

function liveFightTargetUnits(
  state: BattleState,
  side: Side,
  targetIds: string[],
  context: Pick<FightPhaseContext, 'attachedComponents' | 'attachedUnitId'>,
): BattleUnit[] {
  const requested = [...new Set(targetIds)].map(targetId => state.units.find(candidate =>
    candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId,
  )).filter((target): target is BattleUnit => !!target);
  return attachedGroupRepresentatives(state, requested, context);
}

function canonicalFightTargetId(
  state: BattleState,
  side: Side,
  targetId: string,
  context: Pick<FightPhaseContext, 'attachedComponents' | 'attachedUnitId'>,
): string {
  const target = state.units.find(candidate => candidate.id === targetId
    && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return target ? attachedGroupRepresentatives(state, [target], context)[0]?.id ?? targetId : targetId;
}

function sameIdSet(left: string[], right: string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every(id => b.has(id));
}

function defaultFightMovementIntent(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightPhaseActionContext,
): FightMovementIntent | null {
  if (kind === 'pileIn') {
    const targetUnitIds = playFightPileInTargetOptions(state, unit.id, side, rules, context);
    if (!targetUnitIds.length) return null;
    const engaged = targetUnitIds.filter(targetUnitId => {
      const target = state.units.find(candidate => candidate.id === targetUnitId);
      return !!target && unitEngagedWithTargets(state, unit, [target], rules.engagementRange(), context);
    });
    return { targetUnitIds: engaged.length ? engaged : [targetUnitIds[0]] };
  }
  const options = playFightConsolidationOptions(state, unit.id, side, rules, context);
  const option = options[0];
  if (!option) return null;
  return option.mode === 'objective'
    ? { consolidationMode: option.mode, objectiveIndex: option.objectiveIndex }
    : { consolidationMode: option.mode, targetUnitIds: option.mode === 'ongoing'
      ? option.targetUnitIds
      : option.targetUnitIds.slice(0, 1) };
}

function normalizeFightMovementIntent(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightPhaseActionContext,
  intent?: FightMovementIntent,
): FightMovementIntent | null {
  const requested = intent ?? defaultFightMovementIntent(state, unit, side, kind, rules, context);
  if (!requested) return null;
  const canonicalTargetIds = (ids: string[]) => [...new Set(ids.flatMap(id => {
    const target = state.units.find(candidate => candidate.id === id && candidate.side !== side
      && !candidate.destroyed && !candidate.embarkedInUnitId);
    return target ? [attachedGroupRepresentatives(state, [target], context)[0]?.id ?? id] : [id];
  }))];
  if (kind === 'pileIn') {
    const available = playFightPileInTargetOptions(state, unit.id, side, rules, context);
    const targetUnitIds = canonicalTargetIds(requested.targetUnitIds ?? []);
    if (!targetUnitIds.length || targetUnitIds.some(id => !available.includes(id))) return null;
    const engaged = available.filter(id => {
      const target = state.units.find(candidate => candidate.id === id);
      return !!target && unitEngagedWithTargets(state, unit, [target], rules.engagementRange(), context);
    });
    // An Ongoing Pile In must select every enemy unit currently engaged with
    // the unit. An unengaged unit may select one or more units within 5".
    if (engaged.length && !sameIdSet(targetUnitIds, engaged)) return null;
    return { targetUnitIds };
  }

  const options = playFightConsolidationOptions(state, unit.id, side, rules, context);
  const mode = requested.consolidationMode ?? options[0]?.mode;
  const option = options.find(candidate => candidate.mode === mode);
  if (!option) return null;
  if (option.mode === 'objective') {
    return option.objectiveIndex === requested.objectiveIndex
      ? { consolidationMode: 'objective', objectiveIndex: option.objectiveIndex }
      : null;
  }
  const targetUnitIds = canonicalTargetIds(requested.targetUnitIds ?? []);
  if (!targetUnitIds.length || targetUnitIds.some(id => !option.targetUnitIds.includes(id))) return null;
  // Ongoing Consolidation selects every enemy unit already engaged.
  if (option.mode === 'ongoing' && !sameIdSet(targetUnitIds, option.targetUnitIds)) return null;
  return { consolidationMode: option.mode, targetUnitIds };
}

function initiallyEngagedEnemyUnitIdsByModel(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  targetUnitIds: string[],
  rules: RulesEdition,
  context: FightPhaseActionContext,
): Record<string, string[]> {
  // The target list has already been validated by the phase rules before a
  // movement window opens. Snapshot those selected targets directly instead
  // of re-filtering them through general fight-target rules. This keeps a
  // no-op pile-in tied to the engagement that existed when it began.
  const enemies = liveFightTargetUnits(state, side, targetUnitIds, context);
  const result: Record<string, string[]> = {};
  for (const component of context.attachedComponents(state, unit)) {
    for (let modelIndex = 0; modelIndex < component.modelPositions.length; modelIndex++) {
      const modelPosition = component.modelPositions[modelIndex];
      result[`${component.id}:${modelIndex}`] = enemies
        .filter(enemy => modelPosition && modelEngagedWithTargetsAtPosition(
          component,
          modelIndex,
          modelPosition,
          context.attachedComponents(state, enemy),
          rules.engagementRange(),
          context,
        ))
        .map(enemy => enemy.id);
    }
  }
  return result;
}

type PendingFightMovement = NonNullable<BattleState['pendingFightMovement']>;

/** Creates the single immutable checkpoint used by every Fight movement path. */
function createFightMovementCheckpoint(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  intent: FightMovementIntent,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): PendingFightMovement {
  const targetUnitIds = intent.targetUnitIds ?? [];
  const components = context.attachedComponents(state, unit);
  const movementStartPositionsByModel = Object.fromEntries(
    components.map(component => [
      component.id,
      component.modelPositions.map(position => ({ ...position })),
    ]),
  );
  const lockedModelIds = fightMovementLockedModelIdsAtStart(
    state,
    unit,
    side,
    movementStartPositionsByModel,
    context,
  );

  return {
    unitId: unit.id,
    side,
    kind,
    targetUnitIds,
    movementStartPositionsByModel,
    consolidationMode: intent.consolidationMode,
    objectiveIndex: intent.objectiveIndex,
    initiallyEngagedEnemyUnitIdsByModel: kind === 'pileIn' || intent.consolidationMode === 'ongoing'
      ? initiallyEngagedEnemyUnitIdsByModel(state, unit, side, targetUnitIds, rules, context)
      : undefined,
    overrun: kind === 'pileIn' && isFightUnitsStep(state) && unit.overrunFightSelected === true,
    lockedModelIds,
  };
}

/**
 * Returns models that started in base contact with an enemy model.
 *
 * Base contact is independent of the selected Pile In or Consolidation
 * targets. Keeping this calculation in the Fight engine lets the UI and
 * controller paths use the same lock set, including pending states created
 * before the cached `lockedModelIds` field existed.
 */
function fightMovementLockedModelIdsAtStart(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  movementStartPositionsByModel: Record<string, Position[]> | undefined,
  context: FightPhaseActionContext,
  existingLockedModelIds: string[] = [],
): string[] {
  const enemyComponents = context.enemies(state, side)
    .flatMap(enemy => context.attachedComponents(state, enemy));
  const lockedModelIds = new Set(existingLockedModelIds);
  if (!enemyComponents.length) return [...lockedModelIds];

  for (const component of context.attachedComponents(state, unit)) {
    const starts = movementStartPositionsByModel?.[component.id]
      ?? component.movementStartPositionsByModel;
    if (!starts || starts.length !== component.modelPositions.length) continue;
    for (let modelIndex = 0; modelIndex < component.modelPositions.length; modelIndex++) {
      const start = starts[modelIndex];
      if (!start) continue;
      const sourceAtStart = {
        ...component,
        modelPositions: component.modelPositions.map((position, index) => index === modelIndex ? start : position),
      };
      const closest = closestModelPairUsingDistance(
        sourceAtStart,
        modelIndex,
        enemyComponents,
        context.modelBaseEdgeDistance,
      );
      if (closest && closest.distance <= BASE_CONTACT_EPSILON) {
        lockedModelIds.add(`${component.id}:${modelIndex}`);
      }
    }
  }

  return [...lockedModelIds];
}

/** Returns the core-owned base-contact lock set for the pending Fight move. */
export function playFightMovementLockedModelIds(
  state: BattleState,
  context: FightPhaseActionContext,
): string[] {
  const pending = state.pendingFightMovement;
  if (!pending) return [];
  const unit = state.units.find(candidate => candidate.id === pending.unitId
    && candidate.side === pending.side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId);
  if (!unit) return pending.lockedModelIds ?? [];
  return fightMovementLockedModelIdsAtStart(
    state,
    unit,
    pending.side,
    pending.movementStartPositionsByModel,
    context,
    pending.lockedModelIds ?? [],
  );
}

/** Returns the base-contact lock set for a Fight-movement unit before its
 * interactive checkpoint has been opened. */
export function playFightMovementLockedModelIdsForUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  context: FightPhaseActionContext,
): string[] {
  const unit = state.units.find(candidate => candidate.id === unitId
    && candidate.side === side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId);
  if (!unit) return [];
  const movementStartPositionsByModel = Object.fromEntries(
    context.attachedComponents(state, unit).map(component => [
      component.id,
      component.modelPositions.map(position => ({ ...position })),
    ]),
  );
  return fightMovementLockedModelIdsAtStart(
    state,
    unit,
    side,
    movementStartPositionsByModel,
    context,
  );
}

function initializeFightMovementComponents(state: BattleState, unit: BattleUnit, context: FightPhaseActionContext): void {
  for (const component of context.attachedComponents(state, unit)) {
    component.movementStartPositionsByModel = component.modelPositions.map(position => ({ ...position }));
    component.movementPathByModel = undefined;
    component.movementAllowanceTotalByModel = component.modelPositions.map(() => 3);
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => 3);
    component.movementAllowanceRemaining = 3;
  }
}

/** Opens the interactive model-movement window for a Pile In or Consolidation. */
export function beginPlayFightMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightPhaseActionContext,
  intent?: FightMovementIntent,
): BattleState {
  if (state.pendingFightMovement) return state;
  const selectedUnit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const unit = selectedUnit ? attachedGroupRepresentatives(state, [selectedUnit], context)[0] ?? selectedUnit : undefined;
  if (!unit) return state;
  const normalizedIntent = normalizeFightMovementIntent(state, unit, side, kind, rules, context, intent);
  if (!normalizedIntent) return state;
  const next = context.clone(state);
  const nextUnit = next.units.find(candidate => candidate.id === unit.id && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!nextUnit) return state;
  initializeFightMovementComponents(next, nextUnit, context);
  if (kind === 'pileIn' && rules.metadata.edition === '11e' && isFightPileInStep(next)) {
    refreshPlayFightPileInActions(next, rules, context);
  }
  if (kind === 'consolidate' && rules.metadata.edition === '11e' && isFightConsolidationStep(next)) {
    refreshPlayFightConsolidationActions(next, rules, context);
  }
  next.pendingFightMovement = createFightMovementCheckpoint(
    state,
    unit,
    side,
    kind,
    normalizedIntent,
    rules,
    context,
  );
  if (kind === 'pileIn' && rules.metadata.edition === '11e' && isFightPileInStep(next)) {
    setPhaseStepActionStatus(next, pileInActionId(side, unit.id), 'in-progress');
  }
  if (kind === 'consolidate' && rules.metadata.edition === '11e' && isFightConsolidationStep(next)) {
    setPhaseStepActionStatus(next, consolidationActionId(side, unit.id), 'in-progress');
  }
  return next;
}

function targetComponents(state: BattleState, targets: BattleUnit[], context: FightPhaseContext): BattleUnit[] {
  return targets.flatMap(target => context.attachedComponents(state, target));
}

function modelEngagedWithTargetAtPosition(
  source: BattleUnit,
  sourceModelIndex: number,
  sourcePosition: Position,
  target: BattleUnit,
  targetModelIndex: number,
  range: number,
  context: FightPhaseActionContext,
): boolean {
  const targetPosition = target.modelPositions[targetModelIndex];
  if (!targetPosition) return false;
  const sourceAtPosition = {
    ...source,
    modelPositions: source.modelPositions.map((position, modelIndex) =>
      modelIndex === sourceModelIndex ? sourcePosition : position),
  };
  return context.modelBaseEdgeHorizontalDistance(
    sourceAtPosition,
    sourceModelIndex,
    target,
    targetModelIndex,
  ) <= range + MOVEMENT_RULE_EPSILON
    && Math.abs((sourcePosition.z ?? 0) - (targetPosition.z ?? 0))
      <= COHERENCY_VERTICAL_RANGE + MOVEMENT_RULE_EPSILON;
}

function modelEngagedWithTargetsAtPosition(
  source: BattleUnit,
  sourceModelIndex: number,
  sourcePosition: Position,
  targets: BattleUnit[],
  range: number,
  context: FightPhaseActionContext,
): boolean {
  return targets.some(target => target.modelPositions.some((_, targetModelIndex) =>
    modelEngagedWithTargetAtPosition(
      source,
      sourceModelIndex,
      sourcePosition,
      target,
      targetModelIndex,
      range,
      context,
    )));
}

function fightMovementStartPositions(
  pending: NonNullable<BattleState['pendingFightMovement']>,
  component: BattleUnit,
): Position[] | undefined {
  return pending.movementStartPositionsByModel?.[component.id]
    ?? component.movementStartPositionsByModel;
}

function unitEngagedWithTargets(
  state: BattleState,
  unit: BattleUnit,
  targets: BattleUnit[],
  range: number,
  context: FightPhaseContext,
): boolean {
  return context.attachedComponents(state, unit).some(component =>
    targets.some(target => context.inEngagement(component, context.attachedComponents(state, target), range)));
}

function fightMovementNotCloserModelIds(
  state: BattleState,
  pending: NonNullable<BattleState['pendingFightMovement']>,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): string[] {
  const targets = liveFightTargetUnits(state, pending.side, pending.targetUnitIds ?? [], context);
  const targetParts = targetComponents(state, targets, context);
  const invalidModelIds: string[] = [];

  for (const component of context.attachedComponents(state, unit)) {
    const starts = fightMovementStartPositions(pending, component);
    if (!starts || starts.length !== component.modelPositions.length) continue;
    for (let modelIndex = 0; modelIndex < component.modelPositions.length; modelIndex++) {
      const start = starts[modelIndex];
      const current = component.modelPositions[modelIndex];
      const modelId = `${component.id}:${modelIndex}`;
      if (!start || !current || pending.lockedModelIds?.includes(modelId) || !modelPositionChanged(start, current)) continue;

      let endedNotCloser = false;
      if (targetParts.length) {
        const startDistance = closestModelDistanceToTargets(
          component, modelIndex, start, targetParts, context.modelBaseEdgeDistance,
        );
        const endDistance = closestModelDistanceToTargets(
          component, modelIndex, current, targetParts, context.modelBaseEdgeDistance,
        );
        endedNotCloser = endDistance >= startDistance - MOVEMENT_RULE_EPSILON;
      } else if (pending.objectiveIndex !== undefined) {
        const objective = state.objectives[pending.objectiveIndex];
        if (objective) endedNotCloser = context.distance(current, objective) >= context.distance(start, objective) - MOVEMENT_RULE_EPSILON;
      }
      if (endedNotCloser) invalidModelIds.push(modelId);
    }
  }

  return invalidModelIds;
}

function pileInStartedEngaged(
  state: BattleState,
  pending: NonNullable<BattleState['pendingFightMovement']>,
  unit: BattleUnit,
  targets: BattleUnit[],
  range: number,
  context: FightPhaseActionContext,
): boolean {
  const snapshotConfirmsEngagement = Object.values(pending.initiallyEngagedEnemyUnitIdsByModel ?? {}).some(enemyIds =>
    enemyIds.length > 0);
  if (snapshotConfirmsEngagement) return true;

  if (!targets.length) return false;

  // Also derive the snapshot from the recorded starting positions. This keeps
  // a pending movement window from becoming unfinishable when it was created
  // by an older save or hot-reloaded state that predates the per-model map.
  const targetParts = targetComponents(state, targets, context);
  return context.attachedComponents(state, unit).some(component => {
    const starts = fightMovementStartPositions(pending, component);
    return !!starts && starts.some((start, modelIndex) => !!start
      && modelEngagedWithTargetsAtPosition(component, modelIndex, start, targetParts, range, context));
  });
}

function initialEngagementLossModelIds(
  state: BattleState,
  pending: NonNullable<BattleState['pendingFightMovement']>,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): string[] {
  const lostModelIds: string[] = [];
  const components = context.attachedComponents(state, unit);

  for (const [key, engagedEnemyIds] of Object.entries(pending.initiallyEngagedEnemyUnitIdsByModel ?? {})) {
    if (!engagedEnemyIds.length) continue;
    const separator = key.lastIndexOf(':');
    const componentId = key.slice(0, separator);
    const modelIndex = Number(key.slice(separator + 1));
    const component = components.find(candidate => candidate.id === componentId);
    const starts = component ? fightMovementStartPositions(pending, component) : undefined;
    const start = starts?.[modelIndex];
    const current = component?.modelPositions[modelIndex];
    if (!component || !Number.isInteger(modelIndex) || !start || !current) continue;

    // A model that did not move cannot have lost engagement during this
    // movement. This also prevents stale snapshots from highlighting an
    // untouched model that was outside Engagement Range from the beginning.
    if (!modelPositionChanged(start, current)) continue;

    const stillEngaged = engagedEnemyIds.every(enemyId => {
      const enemy = state.units.find(candidate => candidate.id === enemyId
        && !candidate.destroyed && !candidate.embarkedInUnitId);
      return !enemy || modelEngagedWithTargetsAtPosition(
        component,
        modelIndex,
        current,
        context.attachedComponents(state, enemy),
        rules.engagementRange(),
        context,
      );
    });
    if (!stillEngaged) lostModelIds.push(key);
  }

  return lostModelIds;
}

/** Returns the moved Fight models that fail the endpoint "end closer" test. */
export function playFightMovementNotCloserModelIds(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): string[] {
  const validation = playFightMovementValidation(state, rules, context);
  return validation.failure === 'model-not-closer' ? validation.modelIds ?? [] : [];
}

type FightMovementBasics =
  | { valid: true; movedAnyModel: boolean }
  | PlayFightMovementValidation;

function validateFightMovementBasics(
  state: BattleState,
  pending: NonNullable<BattleState['pendingFightMovement']>,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): FightMovementBasics {
  let movedAnyModel = false;
  const movedLockedModelIds: string[] = [];

  for (const component of context.attachedComponents(state, unit)) {
    const starts = fightMovementStartPositions(pending, component);
    if (!starts || starts.length !== component.modelPositions.length) {
      return { valid: false, failure: 'missing-start-position' };
    }
    for (let modelIndex = 0; modelIndex < component.modelPositions.length; modelIndex++) {
      const start = starts[modelIndex];
      const current = component.modelPositions[modelIndex];
      if (!start || !current) return { valid: false, failure: 'missing-start-position' };
      const isLocked = pending.lockedModelIds?.includes(`${component.id}:${modelIndex}`) === true;
      if (isLocked) {
        if (modelPositionChanged(start, current)) {
          movedLockedModelIds.push(`${component.id}:${modelIndex}`);
        }
        continue;
      }
      if (!modelPositionChanged(start, current)) continue;
      movedAnyModel = true;
    }
  }

  if (movedLockedModelIds.length) {
    return { valid: false, failure: 'locked-model-moved', modelIds: movedLockedModelIds };
  }

  // A model may route around another model or terrain. The rule compares the
  // distance from its starting position to its endpoint, not the path it took.
  const notCloserModelIds = fightMovementNotCloserModelIds(state, pending, unit, rules, context);
  if (notCloserModelIds.length) {
    return { valid: false, failure: 'model-not-closer', modelIds: notCloserModelIds };
  }

  return { valid: true, movedAnyModel };
}

function validatePileInMovement(
  state: BattleState,
  pending: PendingFightMovement,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
  movedAnyModel: boolean,
): PlayFightMovementValidation {
  const targets = liveFightTargetUnits(state, pending.side, pending.targetUnitIds ?? [], context);
  const range = rules.engagementRange();
  const noOpStartedEngaged = !movedAnyModel
    && (pileInStartedEngaged(state, pending, unit, targets, range, context)
      // A locked model proves that this unit started in base contact with a
      // selected target, even when loading an older pending state.
      || (pending.lockedModelIds?.length ?? 0) > 0);

  // Pile In's endpoint requirement is unit-level: one model in Engagement
  // Range is enough. Models do not all have to be engaged.
  if (!unitEngagedWithTargets(state, unit, context.enemies(state, pending.side), range, context)
    && !noOpStartedEngaged) {
    return { valid: false, failure: 'unit-not-engaged' };
  }
  if (noOpStartedEngaged) return { valid: true };

  const lostEngagementModelIds = initialEngagementLossModelIds(state, pending, unit, rules, context);
  return lostEngagementModelIds.length
    ? { valid: false, failure: 'initial-engagement-lost', modelIds: lostEngagementModelIds }
    : { valid: true };
}

function validateConsolidationMovement(
  state: BattleState,
  pending: PendingFightMovement,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): PlayFightMovementValidation {
  const targets = liveFightTargetUnits(state, pending.side, pending.targetUnitIds ?? [], context);
  const range = rules.engagementRange();
  switch (pending.consolidationMode) {
    case 'ongoing':
      return Object.entries(pending.initiallyEngagedEnemyUnitIdsByModel ?? {}).every(([key, engagedEnemyIds]) => {
        const separator = key.lastIndexOf(':');
        const componentId = key.slice(0, separator);
        const modelIndex = Number(key.slice(separator + 1));
        const component = context.attachedComponents(state, unit).find(candidate => candidate.id === componentId);
        const model = component?.modelPositions[modelIndex];
        return !!component && !!model && engagedEnemyIds.every(enemyId => {
          const enemy = state.units.find(candidate => candidate.id === enemyId && !candidate.destroyed && !candidate.embarkedInUnitId);
          return !enemy || modelEngagedWithTargetsAtPosition(
            component,
            modelIndex,
            model,
            context.attachedComponents(state, enemy),
            range,
            context,
          );
        });
      })
        ? { valid: true }
        : { valid: false, failure: 'consolidation-requirement' };
    case 'engaging':
      return targets.length > 0 && targets.every(target => unitEngagedWithTargets(state, unit, [target], range, context))
        ? { valid: true }
        : { valid: false, failure: 'consolidation-requirement' };
    case 'objective':
      return pending.objectiveIndex !== undefined
        && !unitEngagedWithTargets(state, unit, context.enemies(state, pending.side), range, context)
        && context.objectiveIndexesWithinRange(state, unit, rules).includes(pending.objectiveIndex)
        ? { valid: true }
        : { valid: false, failure: 'consolidation-requirement' };
    default:
      return { valid: false, failure: 'consolidation-requirement' };
  }
}

function validateFightMovement(
  state: BattleState,
  pending: PendingFightMovement,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): PlayFightMovementValidation {
  const basics = validateFightMovementBasics(state, pending, unit, rules, context);
  if (!basics.valid) return basics;
  return pending.kind === 'pileIn'
    ? validatePileInMovement(state, pending, unit, rules, context, basics.movedAnyModel)
    : validateConsolidationMovement(state, pending, unit, rules, context);
}

/** Applies the shared state changes after a Fight movement passes validation. */
function commitFightMovement(
  state: BattleState,
  unit: BattleUnit,
  pending: PendingFightMovement,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): void {
  for (const component of context.attachedComponents(state, unit)) {
    if (pending.kind === 'pileIn') {
      if (pending.overrun) component.overrunPiledIn = true;
      else component.piledIn = true;
    } else {
      component.consolidated = true;
    }
    component.inCombat = context.inEngagement(component, context.enemies(state, pending.side), rules.engagementRange());
    component.lastMovePhase = state.phase;
    component.lastMoveTurn = state.turn;
    component.movementStartPositionsByModel = undefined;
    component.movementStartRotationsByModel = undefined;
    component.movementPathByModel = undefined;
    component.movementAllowanceTotalByModel = undefined;
    component.movementAllowanceRemainingByModel = undefined;
    component.movementAllowanceRemaining = undefined;
    clearModelMovementWaypoints(component);
  }
}

export function playFightMovementValidation(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): PlayFightMovementValidation {
  const pending = state.pendingFightMovement;
  if (!pending) return { valid: false, failure: 'no-pending-movement' };
  const unit = state.units.find(candidate => candidate.id === pending.unitId
    && candidate.side === pending.side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId);
  return unit
    ? validateFightMovement(state, pending, unit, rules, context)
    : { valid: false, failure: 'missing-start-position' };
}

/** Commits the interactive Pile In or Consolidation movement window. */
export function completePlayFightMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  const pending = state.pendingFightMovement;
  if (!pending || pending.unitId !== unitId || pending.side !== side) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  if (!validateFightMovement(state, pending, unit, rules, context).valid) return state;
  const next = context.clone(state);
  const movedUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!movedUnit) return state;
  commitFightMovement(next, movedUnit, pending, rules, context);
  next.pendingFightMovement = undefined;
  if (pending.kind === 'consolidate' && rules.metadata.edition === '11e') {
    const newlyEngaged = context.enemies(next, side)
      .filter(enemy => !enemy.activated && context.inEngagement(movedUnit, [enemy], rules.engagementRange()))
      .map(enemy => enemy.id);
    next.consolidationPendingFightUnitIds = [...new Set([...(next.consolidationPendingFightUnitIds ?? []), ...newlyEngaged])];
    next.fightEligibleUnitIds = [...new Set([...(next.fightEligibleUnitIds ?? []), ...newlyEngaged])];
  }
  if (pending.kind === 'consolidate' && rules.metadata.edition === '11e' && isFightConsolidationStep(next)) {
    completePhaseStepAction(next, consolidationActionId(side, unitId));
    refreshPlayFightConsolidationActions(next, rules, context);
  }
  if (pending.kind === 'pileIn' && rules.metadata.edition === '11e' && isFightPileInStep(next)) {
    completePhaseStepAction(next, pileInActionId(side, unitId));
    // Completing one optional Pile In must not skip the rest of the active
    // army's opportunities. Refresh the typed ledger after the movement so
    // newly invalidated/remaining units are reflected, and only hand the
    // step to the other side once this side has no available moves left.
    refreshPlayFightPileInActions(next, rules, context);
    const currentSide = next.fightPileInSide ?? next.activeArmy;
    const currentLedger = phaseStepActionLedgerFor(next);
    const hasRemainingMoves = currentLedger
      ? currentLedger.actions.some(action =>
        action.kind === 'pile-in'
        && action.side === currentSide
        && (action.status === 'available' || action.status === 'in-progress'),
      )
      : playFightPileInUnitIds(next, currentSide, rules, context).length > 0;
    return hasRemainingMoves ? next : advancePlayFightPileInStep(next, rules, context);
  }
  return next;
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
  next = context.clone(next);
  next.phaseStep = PHASE_STEP.FightPileIn;
  for (const pileSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    next.fightPileInSide = pileSide;
    for (const unit of context.activeUnits(next, pileSide)) {
      const piled = context.pileIn(next, unit.id, pileSide, rules);
      if (piled !== next) next = piled;
    }
  }
  next = context.clone(next);
  startFightStepInPlace(next, rules, context);
  next.phaseStep = PHASE_STEP.FightUnits;
  clearPhaseStepActions(next);

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
  next.phaseStep = PHASE_STEP.FightConsolidate;
  next.consolidationSide = startingSide;
  const engagedAtFightStart = new Set(next.engagedUnitIdsAtFightStepStart ?? []);
  const fightEligible = new Set(next.fightEligibleUnitIds ?? []);
  next.consolidationEligibleUnitIds = next.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && (fightEligible.has(unit.id) || unitChargedThisTurn(next, unit) || engagedAtFightStart.has(unit.id)))
    .map(unit => unit.id);
  next.consolidationPendingFightUnitIds = [];
  for (const consolidationSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    next.consolidationSide = consolidationSide;
    refreshPlayFightConsolidationActions(next, rules, context);
    for (const unit of next.units.filter(candidate => candidate.side === consolidationSide && candidate.activated && !candidate.destroyed)) {
      const consolidated = context.consolidate(next, unit.id, consolidationSide, rules);
      if (consolidated !== next) next = consolidated;
    }
  }
  return next;
}
