import type { BattleState, BattleUnit, LogEntry, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export type SimulationPhaseAdvanceMode = 'full-phase' | 'unit-step';

export interface SimulationSelectionContext {
  movementStep(state: BattleState): string;
  activeUnits(state: BattleState, side: Side): BattleUnit[];
  fightActivationUnitIds(state: BattleState, side: Side, rules: RulesEdition): string[];
}

export function nextUnitId(state: BattleState, rules: RulesEdition, context: SimulationSelectionContext): string | undefined {
  if (state.winner !== null || state.phase === 'deployment' || state.phase === 'end') return undefined;
  if (state.phase === 'movement' && context.movementStep(state) === 'reinforcements') return undefined;
  if (state.phase === 'fight') {
    for (const side of [state.activeArmy, (1 - state.activeArmy) as Side]) {
      const id = context.fightActivationUnitIds(state, side, rules)[0];
      if (id) return id;
    }
    return undefined;
  }
  if (!['movement', 'shooting', 'charge'].includes(state.phase)) return undefined;
  return context.activeUnits(state, state.activeArmy).find(unit => !unit.activated)?.id;
}

export function resetUnitActivations(state: BattleState, side: Side, context: SimulationSelectionContext): void {
  context.activeUnits(state, side).forEach(unit => { unit.activated = false; });
}

export interface SimulationUnitStepContext extends SimulationSelectionContext {
  clone(state: BattleState): BattleState;
  runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  runShooting(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  runEleventhFight(state: BattleState, unitId: string, rules: RulesEdition): BattleState;
  checkWinner(state: BattleState): void;
  advancePhase(state: BattleState, rules: RulesEdition): BattleState;
}

export function simulateNextUnit(state: BattleState, rules: RulesEdition, context: SimulationUnitStepContext): BattleState {
  const next = context.clone(state);
  if (next.winner !== null || next.phase === 'deployment' || next.phase === 'end') return next;
  const unitId = nextUnitId(next, rules, context);
  if (!unitId) return context.advancePhase(next, rules);
  const unit = next.units.find(candidate => candidate.id === unitId);
  if (!unit) return next;
  if (next.phase === 'movement') next.log = [...next.log, ...context.runMovement(unit, next, rules)];
  else if (next.phase === 'shooting') next.log = [...next.log, ...context.runShooting(unit, next, rules)];
  else if (next.phase === 'charge') next.log = [...next.log, ...context.runCharge(unit, next, rules)];
  else if (next.phase === 'fight') {
    if (rules.metadata.edition === '11e') {
      const afterFight = context.runEleventhFight(next, unit.id, rules);
      if (afterFight !== next) return afterFight;
    } else next.log = [...next.log, ...context.runFight(unit, next, rules)];
  }
  const current = next.units.find(candidate => candidate.id === unitId);
  if (current && !current.activated) current.activated = true;
  context.checkWinner(next);
  return next;
}
