import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface ChargeRulesContext {
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  enemies(state: BattleState, side: Side): BattleUnit[];
  isAircraft(unit: BattleUnit): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  canChargeTarget(unit: BattleUnit, target: BattleUnit): boolean;
  baseEdgeDistance(a: BattleUnit, b: BattleUnit): number;
}

export type ChargeTargetOption = { targetId: string; needed: number };

export function chargeNeededDistance(
  unit: BattleUnit,
  target: BattleUnit,
  rules: RulesEdition,
  context: ChargeRulesContext,
): number {
  return Math.max(0, context.baseEdgeDistance(unit, target) - rules.engagementRange());
}

export function unitCanDeclareCharge(state: BattleState, unit: BattleUnit, context: ChargeRulesContext): boolean {
  return !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.performingAction
    && !context.isAircraft(unit)
    && !unit.inCombat
    && !unit.fellBack
    && !unit.arrivedFromReinforcements
    && !unit.emergencyDisembarkedThisTurn
    && !unit.combatDisembarkedThisTurn
    && !unit.rapidDisembarkedThisTurn
    && unit.movementAction !== 'fellBack'
    && (unit.movementAction !== 'advanced' || state.activeArmyAbilities?.[unit.side]?.includes('waaagh') === true);
}

export function sideCanDeclareCharge(state: BattleState, side: Side, unit: BattleUnit): boolean {
  return state.activeArmy === side || (state.activeArmy !== side && unit.heroicInterventionThisPhase === true);
}

export function playChargeEligibilityReason(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargeRulesContext,
): string | null {
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

export function playChargeTargetOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargeRulesContext,
): ChargeTargetOption[] {
  if (state.phase !== 'charge') return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit
    || context.attachedComponents(state, unit).some(component => context.unitSurgedThisPhase(state, component))
    || !sideCanDeclareCharge(state, side, unit)
    || !unitCanDeclareCharge(state, unit, context)) return [];
  const pendingRoll = state.pendingChargeRoll?.unitId === unitId && state.pendingChargeRoll.side === side
    ? state.pendingChargeRoll
    : undefined;
  return context.enemies(state, side)
    .filter(target => context.canChargeTarget(unit, target)
      && (state.activeArmy === side
        || (unit.heroicInterventionMode === 'leap-to-defend'
          ? target.charged
          : unit.heroicInterventionMode === 'into-the-fray'
            ? context.baseEdgeDistance(unit, target) <= 6
            : false)))
    .map(target => ({ targetId: target.id, needed: chargeNeededDistance(unit, target, rules, context) }))
    .filter(option => option.needed <= (pendingRoll?.maximumDistance ?? rules.chargeRange()));
}
