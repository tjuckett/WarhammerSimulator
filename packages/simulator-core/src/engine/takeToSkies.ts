import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface TakeToSkiesContext {
  clone(state: BattleState): BattleState;
  getUnit(state: BattleState, unitId: string, side: Side): BattleUnit | undefined;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  isAircraft(unit: BattleUnit): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  hasFlyKeyword(state: BattleState, unit: BattleUnit): boolean;
  movementCanBegin(state: BattleState, side: Side, unit: BattleUnit): boolean;
  chargeCanBegin(state: BattleState, side: Side, unit: BattleUnit): boolean;
  unitHasStartedCurrentMove(unit: BattleUnit): boolean;
  unitHasHover(unit: BattleUnit): boolean;
  updateMovementAllowances(unit: BattleUnit): void;
  createLog(state: BattleState, side: Side, actor: string, message: string): void;
}

export function canDeclare(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: TakeToSkiesContext,
): boolean {
  if (rules.metadata.edition !== '11e') return false;
  const unit = context.getUnit(state, unitId, side);
  if (!unit || unit.inStrategicReserves || context.isAircraft(unit) || !context.hasFlyKeyword(state, unit)) return false;
  const components = context.attachedComponents(state, unit);
  if (components.some(component => component.takingToSkies || context.unitSurgedThisPhase(state, component))) return false;
  if (state.phase === 'movement') {
    return context.movementCanBegin(state, side, unit)
      && components.every(component => !component.movementComplete && !context.unitHasStartedCurrentMove(component));
  }
  return state.phase === 'charge'
    && context.chargeCanBegin(state, side, unit)
    && components.every(component => !component.activated && !component.charged);
}

export function declare(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: TakeToSkiesContext,
): BattleState {
  if (!canDeclare(state, unitId, side, rules, context)) return state;
  const next = context.clone(state);
  const unit = context.getUnit(next, unitId, side)!;
  for (const component of context.attachedComponents(next, unit)) {
    component.takingToSkies = true;
    if (component.movementAllowanceTotalByModel?.length) {
      component.movementAllowanceTotalByModel = component.movementAllowanceTotalByModel.map(total => Math.max(0, total - 2));
      context.updateMovementAllowances(component);
    }
  }
  context.createLog(next, side, unit.profile.name, context.unitHasHover(unit)
    ? `${unit.profile.name} declares Take to the Skies; Hover prevents the -2" maximum-distance cost.`
    : `${unit.profile.name} declares Take to the Skies (-2" maximum distance).`);
  return next;
}
