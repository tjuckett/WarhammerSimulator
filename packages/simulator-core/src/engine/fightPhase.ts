import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

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
  state.engagedUnitIdsAtFightStepStart = state.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
        && context.inEngagement(unit, [enemy], rules.engagementRange())))
    .map(unit => unit.id);
}

export function unitHasCounteroffensive(state: BattleState, unit: BattleUnit, context: FightPhaseContext): boolean {
  return context.unitHasActiveStratagem(state, unit, 'counteroffensive', 'fight');
}

export function unitHasFightsFirst(state: BattleState, unit: BattleUnit, context: FightPhaseContext): boolean {
  return unit.charged || unitHasCounteroffensive(state, unit, context)
    || context.attachedUnitHasRule(state, unit, 'Fights First');
}

export function finishAttachedFightComponent(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  context: FightPhaseContext,
): void {
  if (rules.metadata.edition !== '11e') return;
  const remaining = context.attachedComponents(state, unit)
    .filter(component => !component.activated && context.unitEligibleToFight(component, state, rules));
  if (remaining.length) {
    state.activeAttachedFightUnitId = context.attachedUnitId(unit);
    return;
  }
  state.activeAttachedFightUnitId = undefined;
  const forcedUnit = state.units.find(candidate => candidate.id === state.forcedFightUnitId);
  if (forcedUnit && context.attachedUnitId(forcedUnit) === context.attachedUnitId(unit)) state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = unit.side;
}

export function sideCanSelectFightUnit(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseContext): boolean {
  return state.phase === 'fight'
    && (rules.metadata.edition === '11e'
      || state.activeArmy === side
      || context.activeUnits(state, side).some(unit => unitHasCounteroffensive(state, unit, context)));
}

export function playFightActivationUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseContext,
): string[] {
  if (!sideCanSelectFightUnit(state, side, rules, context)) return [];
  const eligible = context.activeUnits(state, side).filter(unit => context.unitEligibleToFight(unit, state, rules));
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
    const priorityEligible = counteroffensive.length ? counteroffensive
      : allEligible.some(unit => unitHasFightsFirst(state, unit, context))
        ? allEligible.filter(unit => unitHasFightsFirst(state, unit, context)) : allEligible;
    const preferredSide = state.lastFightSelectionSide === undefined
      ? state.activeArmy : (state.lastFightSelectionSide === 0 ? 1 : 0) as Side;
    const selectingSide = priorityEligible.some(unit => unit.side === preferredSide)
      ? preferredSide : (preferredSide === 0 ? 1 : 0) as Side;
    return side === selectingSide ? priorityEligible.filter(unit => unit.side === side).map(unit => unit.id) : [];
  }
  const counteroffensive = eligible.filter(unit => unitHasCounteroffensive(state, unit, context));
  if (counteroffensive.length) return counteroffensive.map(unit => unit.id);
  const fightsFirst = eligible.filter(unit => unitHasFightsFirst(state, unit, context));
  return (fightsFirst.length ? fightsFirst : eligible).map(unit => unit.id);
}

export function playFightFirstUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseContext,
): string[] {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight' || state.fightStepStarted !== true) return [];
  return context.activeUnits(state, side)
    .filter(unit => context.unitEligibleToFight(unit, state, rules) && unitHasFightsFirst(state, unit, context))
    .map(unit => unit.id);
}

export function playOverrunFightUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseContext,
): string[] {
  if (rules.metadata.edition !== '11e' || state.fightStepStarted !== true) return [];
  return playFightActivationUnitIds(state, side, rules, context).filter(unitId => {
    const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
    if (!unit || unit.overrunFightSelected) return false;
    const engaged = context.enemies(state, side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
    return !engaged || (!context.unitWasEngagedAtFightStepStart(state, unit) && engaged);
  });
}
