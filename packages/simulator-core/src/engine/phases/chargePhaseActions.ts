import { BATTLE_EVENT_TYPE, recordBattleEvent } from '../battleEvents';
import { PHASE_STEP, type BattleState, type BattleUnit, type LogEntry, type PhaseStepAction, type Position, type Side } from '../../types/battle';
import type { RulesEdition } from '../rulesEngine';
import {
  canSelectChargeUnit,
  chargeNeededDistance,
  playChargeEligibilityReason,
  playChargeTargetOptions,
  sideCanDeclareCharge,
  unitCanDeclareCharge,
  type ChargePhaseRulesContext,
} from './chargePhaseRules';
import {
  completePhaseStepAction,
  phaseStepActionLedgerFor,
  setPhaseStepActionStatus,
  setPhaseStepActions,
} from '../phaseStepActions';
import { attachedUnitComponents, attachedUnitId } from '../attachedUnits';
import { clearModelMovementWaypoints } from '../interactiveMovement';

function chargeActionId(side: Side, unitId: string): string {
  return `charge:${side}:${unitId}`;
}

function chargeActionUnitId(state: BattleState, unitId: string): string {
  const selected = state.units.find(unit => unit.id === unitId && !unit.destroyed);
  if (!selected) return unitId;
  const components = attachedUnitComponents(state, selected);
  return components.find(component => !component.attachedToUnitId)?.id
    ?? components[0]?.id
    ?? unitId;
}

function normalChargeStep(state: BattleState, side: Side): boolean {
  return state.phase === 'charge'
    && state.phaseStep === PHASE_STEP.ChargeUnits
    && state.activeArmy === side;
}

function chargeActionFor(state: BattleState, side: Side, unitId: string): PhaseStepAction | null {
  return phaseStepActionLedgerFor(state)?.actions.find(action =>
    action.id === chargeActionId(side, unitId)) ?? null;
}

/**
 * Publishes the active player's optional Charge declarations. Target choice,
 * charge rolls, and charge movement remain owned by the Charge rules/actions;
 * this ledger is only the typed unit-level opportunity for UI, AI, undo,
 * replay, and save/load.
 */
export function refreshPlayChargeActions(
  state: BattleState,
  rules: RulesEdition,
  context: ChargePhaseRulesContext,
  resolveTargets = true,
): void {
  if (!normalChargeStep(state, state.activeArmy)) return;
  const side = state.activeArmy;
  const candidates = state.units
    .filter(unit => unit.side === side
      && !unit.destroyed
      && !unit.embarkedInUnitId
      && !unit.inStrategicReserves
      && canSelectChargeUnit(state, unit.id, side));
  const representativeByGroup = new Map<string, BattleUnit>();
  for (const candidate of candidates) {
    const groupKey = attachedUnitId(candidate);
    const existing = representativeByGroup.get(groupKey);
    if (!existing || (existing.attachedToUnitId && !candidate.attachedToUnitId)) {
      representativeByGroup.set(groupKey, candidate);
    }
  }
  const unitIds = [...representativeByGroup.values()]
    .filter(unit => {
      // The lazy inventory mirrors Shooting: phase entry only publishes
      // unactivated groups. The selected group gets the authoritative
      // engagement/eligibility check when its target query runs.
      return !resolveTargets
        || (unitCanDeclareCharge(state, unit, context)
          && playChargeEligibilityReason(state, unit.id, side, rules, context) === null);
    })
    .map(unit => unit.id);
  const existing = phaseStepActionLedgerFor(state)?.actions ?? [];
  const incomingIds = new Set(unitIds.map(unitId => chargeActionId(side, unitId)));
  const incoming = unitIds.map(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId);
    const groupLabel = unit
      ? attachedUnitComponents(state, unit).map(component => component.profile.name).join(' + ')
      : unitId;
    const existingAction = chargeActionFor(state, side, unitId);
    const pendingRoll = !!state.pendingChargeRoll
      && state.pendingChargeRoll.side === side
      && chargeActionUnitId(state, state.pendingChargeRoll.unitId) === unitId;
    const pendingMovement = !!state.pendingChargeMovement
      && state.pendingChargeMovement.side === side
      && chargeActionUnitId(state, state.pendingChargeMovement.unitId) === unitId;
    const targetUnitIds = pendingMovement
      ? [...state.pendingChargeMovement!.targetUnitIds]
      : resolveTargets
        ? playChargeTargetOptions(state, unitId, side, rules, context).map(option => option.targetId)
        : context.enemies(state, side)
          .filter(target => !target.destroyed && !target.embarkedInUnitId)
          .map(target => target.id);
    const targetIdsComputed = pendingMovement || resolveTargets;
    return {
      id: chargeActionId(side, unitId),
      phase: state.phase,
      step: PHASE_STEP.ChargeUnits,
      kind: 'charge' as const,
      side,
      unitId,
      targetUnitIds,
      targetIdsComputed,
      requiredToAdvance: false,
      status: pendingRoll || pendingMovement
        ? 'in-progress' as const
        : existingAction && !['available', 'in-progress'].includes(existingAction.status)
          ? existingAction.status
          : existingAction?.status === 'in-progress'
            ? 'in-progress' as const
            : 'available' as const,
      label: `${groupLabel}: Charge`,
      description: targetUnitIds.length
        ? targetIdsComputed
          ? 'Optional Charge declaration during the Charge phase.'
          : 'Optional Charge declaration; detailed target checks are performed when selected.'
        : targetIdsComputed
          ? 'Optional Charge declaration; no valid target is currently reachable.'
          : 'Optional Charge declaration; detailed target checks are performed when selected.',
    } satisfies PhaseStepAction;
  });
  const retained = existing
    .filter(action => !incomingIds.has(action.id))
    .map(action => action.kind === 'charge'
      && action.side === side
      && ['available', 'in-progress'].includes(action.status)
      ? { ...action, status: 'superseded' as const }
      : action);
  setPhaseStepActions(state, PHASE_STEP.ChargeUnits, [...retained, ...incoming]);
}

/** Opens the typed unit-level Charge inventory at the step boundary. */
export function startPlayChargeStep(
  state: BattleState,
  rules: RulesEdition,
  context: ChargePhaseRulesContext,
): void {
  // Opening the step only needs the list of units that may declare a charge.
  // Reachability is resolved when a unit is selected, avoiding a full board
  // geometry pass during a phase transition.
  refreshPlayChargeActions(state, rules, context, false);
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
  findReachablePosition(
    unit: BattleUnit,
    target: Position,
    maximumDistance: number,
    terrain: BattleState['terrain'],
    stopGap: number,
    takesToSkies: boolean,
  ): Position;
  avoidModelOverlap(unit: BattleUnit, desired: Position, state: BattleState): Position;
  translateFormation(unit: BattleUnit, dx: number, dy: number): void;
  resolveInternalModelOverlaps(unit: BattleUnit): void;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'charge'): LogEntry;
}

/** Resolves an automated unit's Charge declaration and movement. */
export function runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: AutomatedChargeContext): LogEntry[] {
  if (unit.performingAction) return [];
  if (unit.destroyed || unit.embarkedInUnitId || context.unitSurgedThisPhase(state, unit) || context.isAircraft(unit)
    || unit.inCombat || unit.fellBack || (rules.metadata.edition !== '11e' && unit.arrivedFromReinforcements)
    || unit.emergencyDisembarkedThisTurn
    || unit.combatDisembarkedThisTurn || unit.rapidDisembarkedThisTurn
    || unit.movementAction === 'fellBack' || unit.movementAction === 'advanced') return [];
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
    unit.chargedTurn = state.turn;
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

export interface ChargePhaseActionContext {
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  d6(): number;
  clone(state: BattleState): BattleState;
  hasKeyword(unit: BattleUnit, keyword: string): boolean;
  takeToSkiesDistanceCost(unit: BattleUnit): number;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'charge'): LogEntry;
  chargeRules: ChargePhaseRulesContext;
  enemies(state: BattleState, side: Side): BattleUnit[];
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
  baseEdgeDistance(a: BattleUnit, b: BattleUnit): number;
  findReachablePosition(
    unit: BattleUnit,
    target: Position,
    maximumDistance: number,
    terrain: BattleState['terrain'],
    stopGap: number,
    takesToSkies: boolean,
  ): Position;
  avoidModelOverlap(unit: BattleUnit, desired: Position, state: BattleState): Position;
  resolveInternalModelOverlaps(unit: BattleUnit): void;
  translateFormation(unit: BattleUnit, dx: number, dy: number): void;
  formationExtent(points: Position[], center: Position, direction: Position): number;
  modelBaseRadius(unit: BattleUnit, modelIndex?: number): number;
  centroid(positions: Position[]): Position;
  modelRotation(unit: BattleUnit, modelIndex?: number): number;
  movementLegalityIssues(state: BattleState, unit: BattleUnit): string[];
  unitTakesToSkiesForState(state: BattleState, unit: BattleUnit): boolean;
  distance(from: Position, to: Position): number;
}

function attachedUnitInEngagement(
  state: BattleState,
  unit: BattleUnit,
  targets: BattleUnit[],
  range: number,
  context: ChargePhaseActionContext,
): boolean {
  // A declared target is its whole attached unit. Reaching its Leader is
  // therefore reaching the same target as reaching its Bodyguard models.
  const targetComponents = targets.flatMap(target => context.attachedUnitComponents(state, target));
  return context.attachedUnitComponents(state, unit)
    .some(component => context.inEngagement(component, targetComponents, range));
}

type ChargeFailureReason = 'no-reachable-targets' | 'cannot-reach-engagement' | 'undeclared-enemy';

export type ChargeMovementValidationReason =
  | 'no-pending-charge'
  | 'invalid-movement'
  | 'target-not-engaged'
  | 'undeclared-enemy';

export type ChargeMovementValidation =
  | { valid: true }
  | { valid: false; reason: ChargeMovementValidationReason; modelIndex?: number; issues?: string[] };

/** Resolves the Charge roll and creates the typed pending target state. */
export function playChargeRoll(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargePhaseActionContext,
): BattleState {
  if (!canSelectChargeUnit(state, unitId, side) || state.pendingChargeRoll) return state;
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || context.attachedUnitComponents(state, unit).some((component: BattleUnit) => context.unitSurgedThisPhase(state, component))
    || !unitCanDeclareCharge(state, unit, context.chargeRules)) return state;
  const r1 = context.d6();
  const r2 = context.d6();
  const rawRoll = r1 + r2;
  const roll = state.activeArmy !== side && unit.heroicInterventionMode === 'into-the-fray' ? Math.min(6, rawRoll) : rawRoll;
  const next = context.clone(state);
  const rolledUnit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (!rolledUnit) return state;
  const maximumDistance = Math.max(0, roll - context.takeToSkiesDistanceCost(rolledUnit));
  next.chargeResolution = { unitId, side, dice: [r1, r2], rawTotal: rawRoll, total: roll, maximumDistance, status: 'pending-target' };
  next.pendingChargeRoll = { unitId, side, maximumDistance };
  recordBattleEvent(next, {
    type: BATTLE_EVENT_TYPE.DiceRolled,
    side,
    source: unitId,
    data: { rollKind: 'charge', dice: [r1, r2], rawTotal: rawRoll, total: roll, maximumDistance },
  });
  next.log = [...next.log, context.log(next, side, unit.profile.name,
    `${unit.profile.name} rolls a charge: ${r1}+${r2}=${roll}${roll !== rawRoll ? ` (capped from ${rawRoll})` : ''}.`, 'charge')];
  if (!playChargeTargetOptions(next, unitId, side, rules, context.chargeRules).length) {
    for (const component of context.attachedUnitComponents(next, rolledUnit)) {
      component.activated = true;
      component.takingToSkies = undefined;
    }
    next.pendingChargeRoll = undefined;
    next.chargeResolution = { ...next.chargeResolution, status: 'failed', failureReason: 'no-reachable-targets' };
    completePhaseStepAction(next, chargeActionId(side, chargeActionUnitId(next, unitId)));
    next.log = [...next.log, context.log(next, side, unit.profile.name, `${unit.profile.name} has no reachable charge targets and cannot charge.`, 'charge')];
  } else {
    refreshPlayChargeActions(next, rules, context.chargeRules, false);
    setPhaseStepActionStatus(next, chargeActionId(side, chargeActionUnitId(next, unitId)), 'in-progress');
  }
  return next;
}

function chargeMovementValidation(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargePhaseActionContext,
): ChargeMovementValidation {
  const pending = state.pendingChargeMovement;
  const selectedUnit = state.units.find(candidate => candidate.id === unitId
    && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const pendingBelongsToSelection = !!selectedUnit
    && chargeActionUnitId(state, selectedUnit.id) === chargeActionUnitId(state, pending?.unitId ?? unitId);
  if (state.phase !== 'charge' || state.phaseStep !== PHASE_STEP.ChargeUnits || !pending
    || !pendingBelongsToSelection || pending.side !== side) {
    return { valid: false, reason: 'no-pending-charge' };
  }
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId
    && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const targets = pending.targetUnitIds
    .map((targetId: string) => state.units.find((candidate: BattleUnit) =>
      candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
    .filter((target): target is BattleUnit => !!target);
  if (!unit || targets.length !== pending.targetUnitIds.length || !targets.length) {
    return { valid: false, reason: 'target-not-engaged' };
  }
  const movementIssues = context.attachedUnitComponents(state, unit)
    .flatMap(component => context.movementLegalityIssues(state, component));
  if (movementIssues.length > 0) return { valid: false, reason: 'invalid-movement', issues: movementIssues };

  // The charge move is user-authored. Do not try to search for a hypothetical
  // endpoint for every model here: friendly models may be crossed, and a
  // geometric search cannot reliably distinguish a blocked direct route from
  // a legal route around the unit. The user is responsible for placing each
  // model correctly; core validates the resulting placement and unit-level
  // charge requirements below.
  if (targets.some((target: BattleUnit) => !attachedUnitInEngagement(state, unit, [target], rules.engagementRange(), context))) {
    return { valid: false, reason: 'target-not-engaged' };
  }
  const declaredTargetIds = new Set(targets.flatMap((target: BattleUnit) =>
    context.attachedUnitComponents(state, target).map((component: BattleUnit) => component.id)));
  if (context.enemies(state, side).some((enemy: BattleUnit) =>
    !declaredTargetIds.has(enemy.id) && attachedUnitInEngagement(state, unit, [enemy], rules.engagementRange(), context))) {
    return { valid: false, reason: 'undeclared-enemy' };
  }
  return { valid: true };
}

export function validatePlayChargeMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargePhaseActionContext,
): ChargeMovementValidation {
  return chargeMovementValidation(state, unitId, side, rules, context);
}

/** Completes a manually moved charge after all declared targets are reached. */
export function completePlayChargeMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargePhaseActionContext,
): BattleState {
  const pending = state.pendingChargeMovement;
  if (!pending) return state;
  const validation = chargeMovementValidation(state, unitId, side, rules, context);
  if (!validation.valid) return state;
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId
    && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const targets = pending.targetUnitIds
    .map((targetId: string) => state.units.find((candidate: BattleUnit) =>
      candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
    .filter((target): target is BattleUnit => !!target);
  if (!unit || !targets.length) return state;

  const next = context.clone(state);
  const movedUnit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  const nextTargets = pending.targetUnitIds
    .map((targetId: string) => next.units.find((candidate: BattleUnit) =>
      candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
    .filter((target): target is BattleUnit => !!target);
  if (!movedUnit || nextTargets.length !== pending.targetUnitIds.length) return state;
  for (const component of context.attachedUnitComponents(next, movedUnit)) {
    component.activated = true;
    component.charged = state.activeArmy === side;
    component.chargedTurn = component.charged ? next.turn : undefined;
    component.inCombat = true;
    component.movementComplete = true;
    component.lastMovePhase = next.phase;
    component.lastMoveTurn = next.turn;
    component.movementAllowanceRemaining = 0;
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => 0);
    component.heroicInterventionThisPhase = undefined;
    component.heroicInterventionMode = undefined;
    clearModelMovementWaypoints(component);
  }
  for (const target of nextTargets) target.inCombat = true;
  next.pendingChargeMovement = undefined;
  completePhaseStepAction(next, chargeActionId(side, chargeActionUnitId(next, unitId)));
  next.log = [...next.log, context.log(next, side, movedUnit.profile.name,
    `${movedUnit.profile.name} completes its charge against ${nextTargets.map(target => target.profile.name).join(', ')}.`, 'charge')];
  return next;
}

/** Resolves target declaration and either creates a manual movement window or finishes the charge. */
export function chargePlayUnitTargets(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitIds: string[],
  rules: RulesEdition,
  context: ChargePhaseActionContext,
): BattleState {
  const { attachedUnitComponents, unitSurgedThisPhase, clone, d6, takeToSkiesDistanceCost, log,
    enemies, findReachablePosition, avoidModelOverlap, resolveInternalModelOverlaps,
    translateFormation, formationExtent, modelBaseRadius, centroid, modelRotation, unitTakesToSkiesForState,
    distance, chargeRules } = context;
  if (!canSelectChargeUnit(state, unitId, side)) return state;
  const unit = state.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const uniqueTargetIds = [...new Set(targetUnitIds)];
  const targets = uniqueTargetIds
    .map(targetId => state.units.find((candidate: BattleUnit) =>
      candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
    .filter((target): target is BattleUnit => !!target);
  const target = targets[0];
  const chargeUnitIsValid = !!unit
    && !attachedUnitComponents(state, unit).some((component: BattleUnit) => unitSurgedThisPhase(state, component))
    && sideCanDeclareCharge(state, side, unit)
    && unitCanDeclareCharge(state, unit, chargeRules);
  const chargeTargetsAreValid = !!target
    && targets.length === uniqueTargetIds.length
    && uniqueTargetIds.length > 0
    && !!unit
    && targets.every(candidate => chargeRules.canChargeTarget(unit, candidate));
  const heroicInterventionTargetsAreValid = state.activeArmy === side || (!!unit && (
    unit.heroicInterventionMode === 'leap-to-defend'
      ? targets.every(candidate => candidate.charged)
      : unit.heroicInterventionMode === 'into-the-fray'
        ? targets.every(candidate => chargeNeededDistance(unit, candidate, rules, chargeRules, state) <= 6)
        : false
  ));
  if (!chargeUnitIsValid || !chargeTargetsAreValid || !heroicInterventionTargetsAreValid) return state;
  const needed = Math.max(...targets.map(candidate => chargeNeededDistance(unit, candidate, rules, chargeRules, state)));
  const pendingRoll = state.pendingChargeRoll?.unitId === unitId && state.pendingChargeRoll.side === side ? state.pendingChargeRoll : undefined;
  if (needed > (pendingRoll?.maximumDistance ?? rules.chargeRange())) return state;

  const next = clone(state);
  const chargingUnit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const chargeTargets = uniqueTargetIds
    .map(targetId => next.units.find((candidate: BattleUnit) =>
      candidate.id === targetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId))
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
    pendingRoll
      ? `${chargingUnit.profile.name} declares a charge against ${chargeTargets.map(candidate => candidate.profile.name).join(', ')} (${needed.toFixed(1)}" maximum needed; charge roll already passed).`
      : `${chargingUnit.profile.name} declares a charge against ${chargeTargets.map(candidate => candidate.profile.name).join(', ')} (${needed.toFixed(1)}" maximum needed, rolled ${r1}+${r2}=${roll}${roll !== rawRoll ? ` (capped from ${rawRoll})` : ''}).`, 'charge')];

  if (pendingRoll) {
    for (const component of attachedUnitComponents(next, chargingUnit)) {
      component.movementAction = 'normalMove';
      component.movementAllowanceRemaining = maximumDistance;
      component.movementAllowanceRemainingByModel = component.modelPositions.map(() => maximumDistance);
      component.movementAllowanceTotalByModel = component.modelPositions.map(() => maximumDistance);
      component.movementStartPositionsByModel = component.modelPositions.map((position: Position) => ({ ...position }));
      component.movementStartRotationsByModel = component.modelPositions.map((_: Position, modelIndex: number) => modelRotation(component, modelIndex));
      component.movementPathByModel = component.modelPositions.map((position: Position) => [{ ...position }]);
      component.movementComplete = false;
    }
    next.pendingChargeMovement = { unitId, side, targetUnitIds: uniqueTargetIds, maximumDistance };
    next.pendingChargeRoll = undefined;
    if (next.chargeResolution?.unitId === unitId && next.chargeResolution.side === side) {
      next.chargeResolution = { ...next.chargeResolution, status: 'resolved' };
    }
    refreshPlayChargeActions(next, rules, chargeRules, false);
    setPhaseStepActionStatus(next, chargeActionId(side, chargeActionUnitId(next, unitId)), 'in-progress');
    next.log = [...next.log, ...logs,
      log(next, side, chargingUnit.profile.name, `${chargingUnit.profile.name} must now make its charge move (${maximumDistance.toFixed(1)}" maximum).`, 'charge')];
    return next;
  }
  if (maximumDistance + 0.001 < needed) {
    for (const component of attachedUnitComponents(next, chargingUnit)) {
      component.activated = true;
      component.heroicInterventionThisPhase = undefined;
      component.heroicInterventionMode = undefined;
      component.takingToSkies = undefined;
    }
    logs.push(log(next, side, chargingUnit.profile.name, `${chargingUnit.profile.name} fails the charge.`, 'charge'));
    next.log = [...next.log, ...logs];
    next.pendingChargeRoll = undefined;
    if (next.chargeResolution?.unitId === unitId && next.chargeResolution.side === side) {
      next.chargeResolution = { ...next.chargeResolution, status: 'failed', failureReason: 'cannot-reach-engagement' };
    }
    completePhaseStepAction(next, chargeActionId(side, chargeActionUnitId(next, unitId)));
    return next;
  }

  const d = distance(chargingUnit.position, chargeTarget.position);
  const dirX = d > 0 ? (chargeTarget.position.x - chargingUnit.position.x) / d : 1;
  const dirY = d > 0 ? (chargeTarget.position.y - chargingUnit.position.y) / d : 0;
  const myExtent = formationExtent(chargingUnit.modelPositions, chargingUnit.position, { x: dirX, y: dirY });
  const tgtExtent = formationExtent(chargeTarget.modelPositions, chargeTarget.position, { x: -dirX, y: -dirY });
  const myRadius = Math.max(...chargingUnit.modelPositions.map((_: Position, modelIndex: number) => modelBaseRadius(chargingUnit, modelIndex)), 0);
  const targetRadius = Math.max(...chargeTarget.modelPositions.map((_: Position, modelIndex: number) => modelBaseRadius(chargeTarget, modelIndex)), 0);
  const stopGap = myExtent + tgtExtent + myRadius + targetRadius + 0.05;
  const reachablePos = findReachablePosition(chargingUnit, chargeTarget.position, maximumDistance, next.terrain, stopGap, unitTakesToSkiesForState(next, chargingUnit));
  const newPos = avoidModelOverlap(chargingUnit, reachablePos, next);
  translateFormation(chargingUnit, newPos.x - chargingUnit.position.x, newPos.y - chargingUnit.position.y);
  resolveInternalModelOverlaps(chargingUnit);
  chargingUnit.position = centroid(chargingUnit.modelPositions);

  const failCharge = (reason: string, failureReason?: ChargeFailureReason): BattleState => {
    const failed = clone(state);
    const failedUnit = failed.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side);
    if (!failedUnit) return state;
    for (const component of attachedUnitComponents(failed, failedUnit)) {
      component.activated = true;
      component.heroicInterventionThisPhase = undefined;
      component.heroicInterventionMode = undefined;
      component.takingToSkies = undefined;
    }
    logs.push(log(failed, side, failedUnit.profile.name, reason, 'charge'));
    failed.log = [...failed.log, ...logs];
    failed.pendingChargeRoll = undefined;
    if (failureReason && failed.chargeResolution?.unitId === unitId && failed.chargeResolution.side === side) {
      failed.chargeResolution = { ...failed.chargeResolution, status: 'failed', failureReason };
    }
    completePhaseStepAction(failed, chargeActionId(side, chargeActionUnitId(failed, unitId)));
    return failed;
  };
  if (chargeTargets.some(candidate => !attachedUnitInEngagement(next, chargingUnit, [candidate], rules.engagementRange(), context))) {
    return failCharge(`${chargingUnit.profile.name} cannot reach Engagement Range.`, 'cannot-reach-engagement');
  }
  const declaredTargetComponentIds = new Set(chargeTargets.flatMap(candidate =>
    attachedUnitComponents(next, candidate).map((component: BattleUnit) => component.id)));
  if (enemies(next, side).some((enemy: BattleUnit) =>
    !declaredTargetComponentIds.has(enemy.id) && attachedUnitInEngagement(next, chargingUnit, [enemy], rules.engagementRange(), context))) {
    return failCharge(`${chargingUnit.profile.name} cannot complete the charge while engaging an undeclared enemy unit.`);
  }
  for (const component of attachedUnitComponents(next, chargingUnit)) {
    component.activated = true;
    component.charged = !heroicIntervention;
    component.chargedTurn = component.charged ? next.turn : undefined;
    component.heroicInterventionThisPhase = undefined;
    component.heroicInterventionMode = undefined;
    component.inCombat = true;
    component.lastMovePhase = next.phase;
    component.lastMoveTurn = next.turn;
    component.takingToSkies = undefined;
  }
  for (const chargeTargetUnit of chargeTargets) chargeTargetUnit.inCombat = true;
  logs.push(log(next, side, chargingUnit.profile.name,
    `${chargingUnit.profile.name} makes a successful${state.activeArmy !== side ? ' Heroic Intervention' : ''} charge.`, 'charge'));
  next.log = [...next.log, ...logs];
  next.pendingChargeRoll = undefined;
  if (next.chargeResolution?.unitId === unitId && next.chargeResolution.side === side) {
    next.chargeResolution = { ...next.chargeResolution, status: 'resolved' };
  }
  completePhaseStepAction(next, chargeActionId(side, chargeActionUnitId(next, unitId)));
  return next;
}
