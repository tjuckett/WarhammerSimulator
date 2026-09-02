import { PHASE_STEP, type BattleState, type BattleUnit, type FightConsolidationMode, type PhaseStep, type Side } from '../../types/battle';
import { phaseStepFor } from '../battleStateMachine';
import { closestModelDistanceBetweenUnits } from '../modelMovementRules';
import type { RulesEdition } from '../rulesEngine';

/** Dependencies supplied by the simulator facade for Fight-specific rules. */
export interface FightEligibilityContext {
  enemies(state: BattleState, side: Side): BattleUnit[];
  canFightTarget(unit: BattleUnit, target: BattleUnit): boolean;
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
}

export interface FightPhaseContext extends FightEligibilityContext {
  activeUnits(state: BattleState, side: Side): BattleUnit[];
  unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean;
  unitWasEngagedAtFightStepStart(state: BattleState, unit: BattleUnit): boolean;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  attachedUnitId(unit: BattleUnit): string;
  attachedUnitHasRule(state: BattleState, unit: BattleUnit, rule: string): boolean;
  unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: string): boolean;
  objectiveIndexesWithinRange(state: BattleState, unit: BattleUnit, rules: RulesEdition): number[];
}

export interface FightMovementRulesContext extends FightPhaseContext {
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  modelBaseEdgeDistance(
    unit: BattleUnit,
    modelIndex: number,
    target: BattleUnit,
    targetModelIndex: number,
  ): number;
}

export type FightConsolidationOption =
  | { mode: Exclude<FightConsolidationMode, 'objective'>; targetUnitIds: string[] }
  | { mode: 'objective'; targetUnitIds: []; objectiveIndex: number };

/** Returns the Fight step, including compatibility for saves made before phaseStep existed. */
export function fightPhaseStep(state: Pick<BattleState, 'phase' | 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'>): PhaseStep {
  return phaseStepFor(state) ?? PHASE_STEP.FightStart;
}

export function isFightPileInStep(state: Pick<BattleState, 'phase' | 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'>): boolean {
  return state.phase === 'fight' && fightPhaseStep(state) === PHASE_STEP.FightPileIn;
}

export function isFightUnitsStep(state: Pick<BattleState, 'phase' | 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'>): boolean {
  return state.phase === 'fight' && fightPhaseStep(state) === PHASE_STEP.FightUnits;
}

export function isFightConsolidationStep(state: Pick<BattleState, 'phase' | 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'>): boolean {
  return state.phase === 'fight' && fightPhaseStep(state) === PHASE_STEP.FightConsolidate;
}

/**
 * Older play/scenario states sometimes switch `phase` without clearing the
 * previous phaseStep and have no Fight cursor at all. Keep those states
 * playable while every newly entered Fight phase uses explicit steps.
 */
function isLegacyFightState(state: Pick<BattleState, 'phase' | 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'>): boolean {
  return state.phase === 'fight'
    && state.fightStepStarted === undefined
    && state.consolidationStepStarted === undefined
    && !([PHASE_STEP.FightStart, PHASE_STEP.FightPileIn, PHASE_STEP.FightUnits, PHASE_STEP.FightConsolidate, PHASE_STEP.FightEnd] as string[])
      .includes(state.phaseStep ?? '');
}

/** A unit may be selected to resolve a fight in Fight or for a newly engaged consolidation opportunity. */
export function isFightResolutionStep(state: Pick<BattleState, 'phase' | 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'> & Pick<BattleState, 'consolidationPendingFightUnitIds'>): boolean {
  return isFightUnitsStep(state)
    || (isFightConsolidationStep(state) && (state.consolidationPendingFightUnitIds?.length ?? 0) > 0)
    || isLegacyFightState(state);
}

/** Aircraft may only be targeted by Flying units, and Aircraft cannot target non-Flying units in melee. */
export function unitCanFightTarget(
  unit: BattleUnit,
  target: BattleUnit,
  hasKeyword: (unit: BattleUnit, keyword: string) => boolean,
): boolean {
  if (hasKeyword(unit, 'aircraft')) return hasKeyword(target, 'fly');
  return !hasKeyword(target, 'aircraft') || hasKeyword(unit, 'fly');
}

export function unitCanFight(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  context: FightEligibilityContext,
): boolean {
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

export function unitEligibleToFight(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  context: FightEligibilityContext,
): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated) return false;
  if (rules.metadata.edition !== '11e') return unitCanFight(unit, state, rules, context);
  if (state.fightStepStarted === false) return false;
  return unitChargedThisTurn(state, unit) || unitWasEngagedAtFightStepStart(state, unit)
    || context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
}

/**
 * Returns the deployed units that cannot qualify for the current Fight
 * selection. This is intentionally separate from activation IDs: a unit can
 * be eligible to fight while waiting for its side or priority opportunity.
 */
export function playFightIneligibleUnitIds(
  state: BattleState,
  rules: RulesEdition,
  context: FightPhaseContext,
): string[] {
  if (!isFightResolutionStep(state)) return [];
  return state.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId && !unit.inStrategicReserves)
    .filter(unit => !context.unitEligibleToFight(unit, state, rules))
    .map(unit => unit.id);
}

export function unitHasCounteroffensive(state: BattleState, unit: BattleUnit, context: FightPhaseContext): boolean {
  return context.unitHasActiveStratagem(state, unit, 'counteroffensive', 'fight');
}

export function unitHasFightsFirst(state: BattleState, unit: BattleUnit, context: FightPhaseContext): boolean {
  return unitChargedThisTurn(state, unit)
    || unitHasCounteroffensive(state, unit, context)
    || context.attachedUnitHasRule(state, unit, 'Fights First');
}

export function sideCanSelectFightUnit(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): boolean {
  if (state.pendingFightMovement || state.pendingCombatActions?.length) return false;
  return isFightResolutionStep(state)
    && (rules.metadata.edition === '11e' || state.activeArmy === side
      || context.activeUnits(state, side).some(unit => unitHasCounteroffensive(state, unit, context)));
}

export function playFightActivationUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseContext,
): string[] {
  if (!sideCanSelectFightUnit(state, side, rules, context)) return [];
  if (isFightUnitsStep(state) && state.fightPassedSides?.includes(side)) return [];
  const eligible = context.activeUnits(state, side).filter(unit => context.unitEligibleToFight(unit, state, rules));
  if (isFightConsolidationStep(state)) {
    const pending = new Set(state.consolidationPendingFightUnitIds ?? []);
    return eligible.filter(unit => pending.has(unit.id)).map(unit => unit.id);
  }
  if (rules.metadata.edition === '11e' && state.activeAttachedFightUnitId) {
    return eligible.filter(unit => context.attachedUnitId(unit) === state.activeAttachedFightUnitId).map(unit => unit.id);
  }
  if (state.forcedFightUnitId) {
    const forced = state.units.find(unit => unit.id === state.forcedFightUnitId);
    if (!forced || forced.side !== side) return [];
    return eligible.filter(unit => context.attachedUnitId(unit) === context.attachedUnitId(forced)).map(unit => unit.id);
  }
  if (rules.metadata.edition !== '11e' && state.activeArmy !== side) {
    return eligible.filter(unit => unitHasCounteroffensive(state, unit, context)).map(unit => unit.id);
  }
  if (rules.metadata.edition === '11e') {
    const allEligible = state.units.filter(unit => context.unitEligibleToFight(unit, state, rules));
    const counteroffensive = allEligible.filter(unit => unitHasCounteroffensive(state, unit, context));
    const priorityEligible = counteroffensive.length ? counteroffensive : allEligible.some(unit => unitHasFightsFirst(state, unit, context))
      ? allEligible.filter(unit => unitHasFightsFirst(state, unit, context)) : allEligible;
    const preferredSide = state.lastFightSelectionSide === undefined
      ? state.activeArmy
      : (state.lastFightSelectionSide === 0 ? 1 : 0) as Side;
    const selectingSide = priorityEligible.some(unit => unit.side === preferredSide)
      ? preferredSide
      : (preferredSide === 0 ? 1 : 0) as Side;
    return side === selectingSide ? priorityEligible.filter(unit => unit.side === side).map(unit => unit.id) : [];
  }
  const counteroffensive = eligible.filter(unit => unitHasCounteroffensive(state, unit, context));
  if (counteroffensive.length) return counteroffensive.map(unit => unit.id);
  const fightsFirst = eligible.filter(unit => unitHasFightsFirst(state, unit, context));
  return (fightsFirst.length ? fightsFirst : eligible).map(unit => unit.id);
}

/** 11e Appendix: a player may pass when all of their eligible fighters are more than 5" from every enemy. */
export function playFightSideCanPass(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: FightMovementRulesContext,
): boolean {
  if (rules.metadata.edition !== '11e' || !isFightUnitsStep(state)
    || !sideCanSelectFightUnit(state, side, rules, context)
    || state.fightPassedSides?.includes(side)) return false;
  const eligible = context.activeUnits(state, side)
    .filter(unit => context.unitEligibleToFight(unit, state, rules));
  if (!eligible.length || !playFightActivationUnitIds(state, side, rules, context).length) return false;
  return eligible.every(unit => context.enemies(state, side).every(enemy =>
    attachedUnitBaseEdgeDistance(state, unit, enemy, context) > 5 + 0.001));
}

export function playFightFirstUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): string[] {
  if (rules.metadata.edition !== '11e' || !isFightResolutionStep(state)) return [];
  return context.activeUnits(state, side)
    .filter(unit => context.unitEligibleToFight(unit, state, rules) && unitHasFightsFirst(state, unit, context))
    .map(unit => unit.id);
}

export function playOverrunFightUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): string[] {
  if (rules.metadata.edition !== '11e' || !isFightUnitsStep(state)) return [];
  return playFightActivationUnitIds(state, side, rules, context).filter(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
    if (!unit || unit.overrunFightSelected) return false;
    const engaged = context.enemies(state, side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
    return !engaged || (!context.unitWasEngagedAtFightStepStart(state, unit) && engaged);
  });
}

function attachedUnitBaseEdgeDistance(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  context: FightMovementRulesContext,
): number {
  return Math.min(...context.attachedComponents(state, unit).flatMap(source =>
    context.attachedComponents(state, target).map(enemy =>
      closestModelDistanceBetweenUnits(source, enemy, context.modelBaseEdgeDistance))), Number.POSITIVE_INFINITY);
}

function attachedUnitInEngagement(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  range: number,
  context: FightMovementRulesContext,
): boolean {
  return context.attachedComponents(state, unit).some(component =>
    context.inEngagement(component, context.attachedComponents(state, target), range));
}

function canStartPileIn(
  state: BattleState,
  unit: BattleUnit,
  side: Side,
  rules: RulesEdition,
  context: FightMovementRulesContext,
): boolean {
  if (state.phase !== 'fight' || state.pendingFightMovement
    || (state.activeArmy !== side && rules.metadata.edition !== '11e')) return false;
  const pileInSide = state.fightPileInSide ?? state.activeArmy;
  if (rules.metadata.edition === '11e' && isFightPileInStep(state) && pileInSide !== side) return false;
  const isOverrunPileIn = rules.metadata.edition === '11e' && isFightUnitsStep(state) && unit.overrunFightSelected;
  if (isOverrunPileIn) {
    return !unit.overrunPiledIn && context.unitEligibleToFight(unit, state, rules);
  }
  if (rules.metadata.edition === '11e' && !isFightPileInStep(state)) return false;
  return !unit.piledIn
    && (context.unitCanFight(unit, state, rules)
      || (unitChargedThisTurn(state, unit) && context.enemies(state, side).some(enemy => context.canFightTarget(unit, enemy))));
}

/** Enemy units a legal Pile In may select before the models are moved. */
export function playFightPileInTargetOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FightMovementRulesContext,
): string[] {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side
    && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !canStartPileIn(state, unit, side, rules, context)) return [];
  const enemies = context.enemies(state, side).filter(enemy => context.canFightTarget(unit, enemy));
  const engaged = enemies.filter(enemy => attachedUnitInEngagement(state, unit, enemy, rules.engagementRange(), context));
  if (engaged.length) return engaged.map(enemy => enemy.id);
  return enemies
    .filter(enemy => attachedUnitBaseEdgeDistance(state, unit, enemy, context) <= 5 + 0.001)
    .map(enemy => enemy.id);
}

/** Consolidation modes and their legal target choices for the selected unit. */
export function playFightConsolidationOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FightMovementRulesContext,
): FightConsolidationOption[] {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side
    && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || state.pendingFightMovement || state.phase !== 'fight'
    || (state.activeArmy !== side && rules.metadata.edition !== '11e')
    || (rules.metadata.edition === '11e' && (!isFightConsolidationStep(state)
      || state.consolidationSide !== side || !state.consolidationEligibleUnitIds?.includes(unit.id)))
    || rules.metadata.edition === '11e' && !state.consolidationStepStarted
    || unit.consolidated) return [];

  const enemies = context.enemies(state, side).filter(enemy => context.canFightTarget(unit, enemy));
  const engaged = enemies.filter(enemy => attachedUnitInEngagement(state, unit, enemy, rules.engagementRange(), context));
  if (engaged.length) return [{ mode: 'ongoing', targetUnitIds: engaged.map(enemy => enemy.id) }];

  const engaging = enemies.filter(enemy => attachedUnitBaseEdgeDistance(state, unit, enemy, context) <= 3 + 0.001);
  if (engaging.length) return [{ mode: 'engaging', targetUnitIds: engaging.map(enemy => enemy.id) }];

  return context.objectiveIndexesWithinRange(state, unit, rules)
    .map(objectiveIndex => ({ mode: 'objective' as const, targetUnitIds: [] as [], objectiveIndex }));
}

export function playUnitCanPileIn(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FightMovementRulesContext,
): boolean {
  return playFightPileInTargetOptions(state, unitId, side, rules, context).length > 0;
}

export function playUnitCanConsolidate(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FightMovementRulesContext,
): boolean {
  return playFightConsolidationOptions(state, unitId, side, rules, context).length > 0;
}
