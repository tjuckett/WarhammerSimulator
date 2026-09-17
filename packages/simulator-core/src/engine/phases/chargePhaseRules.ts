import { PHASE_STEP, type BattleState, type BattleUnit, type Side } from '../../types/battle';
import { attachedUnitTargetRepresentative } from '../attachedUnits';
import type { RulesEdition } from '../rulesEngine';

/** Dependencies supplied by the simulator facade for Charge-specific rules. */
export interface ChargePhaseRulesContext {
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  enemies(state: BattleState, side: Side): BattleUnit[];
  inEngagement(state: BattleState, unit: BattleUnit): boolean;
  isAircraft(unit: BattleUnit): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  canChargeTarget(unit: BattleUnit, target: BattleUnit): boolean;
  baseEdgeDistance(a: BattleUnit, b: BattleUnit): number;
}

export type ChargeTargetOption = { targetId: string; needed: number };

/** Aircraft can only charge Flying units; non-Aircraft can charge other units. */
export function unitCanChargeTarget(
  unit: BattleUnit,
  target: BattleUnit,
  hasKeyword: (unit: BattleUnit, keyword: string) => boolean,
): boolean {
  if (hasKeyword(unit, 'aircraft')) return false;
  return !hasKeyword(target, 'aircraft') || hasKeyword(unit, 'fly');
}

export function sideCanDeclareCharge(state: BattleState, side: Side, unit: BattleUnit): boolean {
  return state.activeArmy === side || (state.activeArmy !== side && unit.heroicInterventionThisPhase === true);
}

/** A unit can be selected for the normal Charge step before targets are chosen. */
export function canSelectChargeUnit(state: BattleState, unitId: string, side: Side): boolean {
  if (state.phase !== 'charge' || state.phaseStep !== PHASE_STEP.ChargeUnits) return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  return !!unit
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.activated
    && sideCanDeclareCharge(state, side, unit);
}

export function chargeNeededDistance(
  unit: BattleUnit,
  target: BattleUnit,
  _rules: RulesEdition,
  context: ChargePhaseRulesContext,
  state?: BattleState,
): number {
  // Attached leaders and bodyguards form one unit for charge declarations.
  // When state is available, use the closest live component pair so a leader
  // can provide the model that actually reaches Engagement Range.
  if (state) {
    const sourceComponents = context.attachedComponents(state, unit);
    const targetComponents = context.attachedComponents(state, target);
    if (sourceComponents.length > 0 && targetComponents.length > 0) {
      return Math.max(0, Math.min(...sourceComponents.flatMap(source =>
        targetComponents.map(candidate => context.baseEdgeDistance(source, candidate)))));
    }
  }
  return Math.max(0, context.baseEdgeDistance(unit, target));
}

export function unitCanDeclareCharge(state: BattleState, unit: BattleUnit, context: ChargePhaseRulesContext): boolean {
  const isAlreadyEngaged = unit.inCombat
    || context.attachedComponents(state, unit).some(component => context.inEngagement(state, component));
  return !unit.destroyed && !unit.embarkedInUnitId && !unit.activated && !unit.performingAction && !context.isAircraft(unit)
    // `inCombat` is serialized for replay; geometry is authoritative when an
    // enemy moved into Engagement Range or an attached component is engaged.
    && !isAlreadyEngaged
    && !unit.fellBack
    // Tactical Disembark intentionally does not appear here: after a Tactical
    // Disembark, a unit may make a Normal Move and still declare a Charge.
    && !unit.emergencyDisembarkedThisTurn
    && !unit.combatDisembarkedThisTurn
    && !unit.rapidDisembarkedThisTurn
    && unit.movementAction !== 'fellBack'
    && (unit.movementAction !== 'advanced' || state.activeArmyAbilities?.[unit.side]?.includes('waaagh') === true);
}

export function playChargeEligibilityReason(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: ChargePhaseRulesContext,
): string | null {
  if (state.phase !== 'charge' || state.phaseStep !== PHASE_STEP.ChargeUnits) return 'The Charge units step is not active.';
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return 'Select a living unit that is on the battlefield.';
  if (state.chargeResolution?.unitId === unitId && state.chargeResolution.side === side && state.chargeResolution.status === 'failed') {
    return 'This unit already failed its charge this phase.';
  }
  if (!sideCanDeclareCharge(state, side, unit)) return 'This army cannot declare a charge right now.';
  if (context.attachedComponents(state, unit).some(component => context.unitSurgedThisPhase(state, component))) return 'This unit already surged this phase.';
  if (context.isAircraft(unit)) return 'Aircraft cannot declare charges.';
  if (unit.inCombat || context.attachedComponents(state, unit).some(component => context.inEngagement(state, component))) {
    return 'This unit is already within Engagement Range and cannot declare a charge.';
  }
  if (unit.fellBack || unit.movementAction === 'fellBack') return 'A unit that fell back cannot charge this phase.';
  if (unit.emergencyDisembarkedThisTurn || unit.combatDisembarkedThisTurn || unit.rapidDisembarkedThisTurn) {
    return 'This unit cannot charge after a Rapid, Combat, or Emergency Disembark this turn.';
  }
  if (unit.performingAction) return 'This unit is performing an action.';
  if (unit.movementAction === 'advanced' && state.activeArmyAbilities?.[side]?.includes('waaagh') !== true) return 'A unit that advanced cannot charge this phase.';
  const candidates = context.enemies(state, side).filter(target => context.canChargeTarget(unit, target));
  if (!candidates.length) return 'There are no eligible enemy units to charge.';
  const needed = candidates.map(target => chargeNeededDistance(unit, target, rules, context, state));
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
  context: ChargePhaseRulesContext,
): ChargeTargetOption[] {
  if (!canSelectChargeUnit(state, unitId, side)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || context.attachedComponents(state, unit).some(component => context.unitSurgedThisPhase(state, component))
    || !unitCanDeclareCharge(state, unit, context)) return [];
  const pendingRoll = state.pendingChargeRoll?.unitId === unitId && state.pendingChargeRoll.side === side ? state.pendingChargeRoll : undefined;
  const seenAttachedGroups = new Set<string>();
  return context.enemies(state, side)
    .filter(target => {
      const components = context.attachedComponents(state, target);
      // Keep target identity consistent with shooting and Fight. The shared
      // representative also handles older saves whose attachment fields were
      // inferred from roster metadata rather than serialized on the units.
      const representative = attachedUnitTargetRepresentative(state, target)
        ?? components.find(component => !component.attachedToUnitId)
        ?? components[0]
        ?? target;
      if (target.id !== representative.id || seenAttachedGroups.has(representative.id)) return false;
      seenAttachedGroups.add(representative.id);
      return true;
    })
    .filter(target => context.canChargeTarget(unit, target)
      && (state.activeArmy === side || (unit.heroicInterventionMode === 'leap-to-defend'
        ? target.charged : unit.heroicInterventionMode === 'into-the-fray' ? chargeNeededDistance(unit, target, rules, context, state) <= 6 : false)))
    .map(target => ({ targetId: target.id, needed: chargeNeededDistance(unit, target, rules, context, state) }))
    .filter(option => option.needed <= (pendingRoll?.maximumDistance ?? rules.chargeRange()));
}
