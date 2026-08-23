import type { BattleState, BattleUnit } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface FightEligibilityContext {
  enemies(state: BattleState, side: 0 | 1): BattleUnit[];
  canFightTarget(unit: BattleUnit, target: BattleUnit): boolean;
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
}

export function unitCanFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightEligibilityContext): boolean {
  return !unit.destroyed && !unit.embarkedInUnitId && !unit.activated
    && context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
}

export function unitWasEngagedAtFightStepStart(state: BattleState, unit: BattleUnit): boolean {
  return state.engagedUnitIdsAtFightStepStart?.includes(unit.id) ?? false;
}

export function unitEligibleToFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightEligibilityContext): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.activated) return false;
  if (rules.metadata.edition !== '11e') return unitCanFight(unit, state, rules, context);
  if (state.fightStepStarted === false) return false;
  return unit.charged || unitWasEngagedAtFightStepStart(state, unit)
    || context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
      && context.inEngagement(unit, [enemy], rules.engagementRange()));
}
