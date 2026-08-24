import { MOVEMENT_STEP, type BattleState, type BattleUnit, type LogEntry, type Phase, type Side } from '../types/battle';
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

/** Dependencies owned by the full-phase and unit-step transition coordinator. */
export interface SimulationPhaseContext extends SimulationSelectionContext {
  clone(state: BattleState): BattleState;
  runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  checkWinner(state: BattleState): void;
  turnPhases: Phase[];
  startCommandPhase(state: BattleState, rules: RulesEdition): LogEntry[];
  scorePrimaryMissionLogs(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  runAutomaticUnitAbilities(state: BattleState, side: Side, timing: 'end-of-phase', rules: RulesEdition): void;
  enterBattlePhase(state: BattleState, node: { phase: Phase; step?: string }, side: Side): void;
  movementLegalityIssues(state: BattleState, side: Side): string[];
  markRemainingStationaryUnits(state: BattleState, side: Side): void;
  phaseLog(state: BattleState, side: Side, armyName: string, message: string): LogEntry;
  log(state: BattleState, side: Side, armyName: string, message: string, kind: 'info'): LogEntry;
  runShootingPhaseUnits(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  startFightStep(state: BattleState, rules: RulesEdition): void;
  consecrateObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, automatic: boolean): number[];
  consecrateObjective(state: BattleState, unitId: string, side: Side, objectiveIndex: number, rules: RulesEdition, automatic: boolean): BattleState;
  completeEndOfTurnActions(state: BattleState, side: Side): void;
  scoreEndOfTurnSecondaryMissionLogs(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  scoreEndOfTurnPrimaryMissionLogs(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  returnOpponentAircraftToStrategicReserves(state: BattleState, side: Side, rules: RulesEdition): void;
  advanceTurnInPlace(state: BattleState): void;
  scoreEndOfBattlePrimaryMissionLogs(state: BattleState, rules: RulesEdition): LogEntry[];
  updateObjectiveControl(state: BattleState, rules: RulesEdition): void;
  runAutomaticEleventhFightPhase(state: BattleState, side: Side, rules: RulesEdition): BattleState;
}

/**
 * Shared transition coordinator for full-phase and one-unit simulation modes.
 * Both modes follow the same phase graph and end-of-turn lifecycle.
 */
export function advancePhase(
  state: BattleState,
  rules: RulesEdition,
  mode: SimulationPhaseAdvanceMode,
  context: SimulationPhaseContext,
): BattleState {
  let s = state;
  const side = s.activeArmy;
  const armyName = s.armies[side].name;
  const newLogs: LogEntry[] = [];
  const fullPhase = mode === 'full-phase';
  const resetActivations = () => {
    if (!fullPhase) resetUnitActivations(s, side, context);
  };

  if (s.phase === 'setup') {
    newLogs.push(...context.startCommandPhase(s, rules));
    if (fullPhase) {
      s.log = [...s.log, ...newLogs];
      return s;
    }
  } else if (!context.turnPhases.includes(s.phase)) {
    context.enterBattlePhase(s, { phase: 'setup' }, side);
  } else if (s.phase === 'command') {
    if (fullPhase) newLogs.push(...context.scorePrimaryMissionLogs(s, side, rules));
    context.runAutomaticUnitAbilities(s, side, 'end-of-phase', rules);
    context.enterBattlePhase(s, { phase: 'movement', step: MOVEMENT_STEP.MoveUnits }, side);
    resetActivations();
    newLogs.push(context.phaseLog(s, side, armyName, '\n--- Movement Phase ---'));
    if (fullPhase) context.activeUnits(s, side).forEach(unit => newLogs.push(...context.runMovement(unit, s, rules)));
  } else if (s.phase === 'movement' && context.movementStep(s) === MOVEMENT_STEP.MoveUnits) {
    if (fullPhase) {
      const issues = context.movementLegalityIssues(s, side);
      if (issues.length) {
        s.log = [...s.log, context.log(s, side, armyName, `Movement is not legal: ${issues.join(' ')}`, 'info')];
        return s;
      }
    }
    context.markRemainingStationaryUnits(s, side);
    context.enterBattlePhase(s, { phase: 'movement', step: MOVEMENT_STEP.Reinforcements }, side);
    newLogs.push(context.phaseLog(s, side, armyName, '\n--- Reinforcements Step ---'));
  } else if (s.phase === 'movement') {
    context.enterBattlePhase(s, { phase: 'shooting' }, side);
    resetActivations();
    newLogs.push(context.phaseLog(s, side, armyName, '\n--- Shooting Phase ---'));
    if (fullPhase) newLogs.push(...context.runShootingPhaseUnits(s, side, rules));
  } else if (s.phase === 'shooting') {
    context.enterBattlePhase(s, { phase: 'charge' }, side);
    resetActivations();
    newLogs.push(context.phaseLog(s, side, armyName, '\n--- Charge Phase ---'));
    if (fullPhase) context.activeUnits(s, side).filter(unit => !unit.inCombat)
      .forEach(unit => newLogs.push(...context.runCharge(unit, s, rules)));
  } else if (s.phase === 'charge') {
    context.enterBattlePhase(s, { phase: 'fight' }, side);
    resetActivations();
    newLogs.push(context.phaseLog(s, side, armyName, '\n--- Fight Phase ---'));
    if (rules.metadata.edition === '11e') {
      if (fullPhase) s = context.runAutomaticEleventhFightPhase(s, side, rules);
      else context.startFightStep(s, rules);
    } else if (fullPhase) {
      context.activeUnits(s, side).filter(unit => unit.charged).forEach(unit => newLogs.push(...context.runFight(unit, s, rules)));
      context.activeUnits(s, side).filter(unit => !unit.charged && unit.inCombat).forEach(unit => newLogs.push(...context.runFight(unit, s, rules)));
      s.units.filter(unit => unit.side !== side && !unit.destroyed && unit.inCombat)
        .forEach(unit => newLogs.push(...context.runFight(unit, s, rules)));
    }
  } else if (s.phase === 'fight') {
    for (const unit of context.activeUnits(s, side)) {
      const objectiveIndex = context.consecrateObjectiveOptions(s, unit.id, side, rules, true)[0];
      if (objectiveIndex !== undefined) s = context.consecrateObjective(s, unit.id, side, objectiveIndex, rules, true);
    }
    context.completeEndOfTurnActions(s, side);
    newLogs.push(...context.scoreEndOfTurnSecondaryMissionLogs(s, side, rules));
    newLogs.push(...context.scoreEndOfTurnPrimaryMissionLogs(s, side, rules));
    context.returnOpponentAircraftToStrategicReserves(s, side, rules);
    context.advanceTurnInPlace(s);
    if (s.phase === 'end') newLogs.push(...context.scoreEndOfBattlePrimaryMissionLogs(s, rules));
  }

  context.checkWinner(s);
  s.log = [...s.log, ...newLogs];
  return s;
}

export function simulateNextPhase(state: BattleState, rules: RulesEdition, context: SimulationPhaseContext): BattleState {
  const next = context.clone(state);
  if (next.phase !== 'movement' || context.movementStep(next) === MOVEMENT_STEP.Reinforcements) context.updateObjectiveControl(next, rules);
  if (next.winner !== null || next.phase === 'deployment' || next.phase === 'end') return next;
  return advancePhase(next, rules, 'full-phase', context);
}

export interface AutomaticCommandPhaseContext {
  enterBattlePhase(state: BattleState, node: { phase: Phase }, side: Side): void;
  selectPunishmentUnits(state: BattleState, side: Side, rules: RulesEdition): void;
  gainCommandPoints(state: BattleState): [number, number];
  phaseLog(state: BattleState, side: Side, armyName: string, message: string): LogEntry;
  log(state: BattleState, side: Side, armyName: string, message: string, kind: 'info'): LogEntry;
  battleRound(state: BattleState): number;
  runBattleshock(state: BattleState, side: Side): LogEntry[];
  scorePrimaryMissionLogs(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  runAutomaticUnitAbilities(state: BattleState, side: Side, timing: 'end-of-phase', rules: RulesEdition): void;
}

export function runAutomaticCommandPhase(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: AutomaticCommandPhaseContext,
): LogEntry[] {
  const armyName = state.armies[side].name;
  context.enterBattlePhase(state, { phase: 'command' }, side);
  context.selectPunishmentUnits(state, side, rules);
  const commandPoints = context.gainCommandPoints(state);
  const logs = [context.phaseLog(state, side, armyName,
    `\n═══ BATTLE ROUND ${context.battleRound(state)} — ${armyName.toUpperCase()} — ${rules.name.toUpperCase()} ═══`)];
  logs.push(context.log(state, side, armyName, `Both players gain 1CP (${commandPoints[0]}CP / ${commandPoints[1]}CP).`, 'info'));
  logs.push(...context.runBattleshock(state, side));
  logs.push(...context.scorePrimaryMissionLogs(state, side, rules));
  context.runAutomaticUnitAbilities(state, side, 'end-of-phase', rules);
  return logs;
}

export interface AutomaticMovementPhaseContext {
  enterBattlePhase(state: BattleState, node: { phase: Phase; step?: string }, side: Side): void;
  phaseLog(state: BattleState, side: Side, armyName: string, message: string): LogEntry;
  runMovement(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  markRemainingStationaryUnits(state: BattleState, side: Side): void;
  updateObjectiveControl(state: BattleState, rules: RulesEdition): void;
}

export function runAutomaticMovementPhase(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: AutomaticMovementPhaseContext,
): LogEntry[] {
  const armyName = state.armies[side].name;
  const logs: LogEntry[] = [];
  context.enterBattlePhase(state, { phase: 'movement', step: MOVEMENT_STEP.MoveUnits }, side);
  logs.push(context.phaseLog(state, side, armyName, '\n─── Movement Phase ───'));
  state.units.filter(unit => unit.side === side && !unit.destroyed)
    .forEach(unit => logs.push(...context.runMovement(unit, state, rules)));
  context.markRemainingStationaryUnits(state, side);
  context.enterBattlePhase(state, { phase: 'movement', step: MOVEMENT_STEP.Reinforcements }, side);
  context.updateObjectiveControl(state, rules);
  return logs;
}

export interface AutomaticShootingPhaseContext {
  enterBattlePhase(state: BattleState, node: { phase: Phase }, side: Side): void;
  phaseLog(state: BattleState, side: Side, armyName: string, message: string): LogEntry;
  runShootingPhaseUnits(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  updateObjectiveControl(state: BattleState, rules: RulesEdition): void;
}

export function runAutomaticShootingPhase(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  context: AutomaticShootingPhaseContext,
): LogEntry[] {
  const armyName = state.armies[side].name;
  context.enterBattlePhase(state, { phase: 'shooting' }, side);
  const logs = [context.phaseLog(state, side, armyName, '\n─── Shooting Phase ───')];
  logs.push(...context.runShootingPhaseUnits(state, side, rules));
  context.updateObjectiveControl(state, rules);
  return logs;
}

export interface AutomaticChargePhaseContext {
  enterBattlePhase(state: BattleState, node: { phase: Phase }, side: Side): void;
  phaseLog(state: BattleState, side: Side, armyName: string, message: string): LogEntry;
  runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  updateObjectiveControl(state: BattleState, rules: RulesEdition): void;
}

export function runAutomaticChargePhase(state: BattleState, side: Side, rules: RulesEdition, context: AutomaticChargePhaseContext): LogEntry[] {
  const armyName = state.armies[side].name;
  context.enterBattlePhase(state, { phase: 'charge' }, side);
  const logs = [context.phaseLog(state, side, armyName, '\n─── Charge Phase ───')];
  state.units.filter(unit => unit.side === side && !unit.destroyed && !unit.inCombat)
    .forEach(unit => logs.push(...context.runCharge(unit, state, rules)));
  context.updateObjectiveControl(state, rules);
  return logs;
}

export interface AutomaticFightPhaseContext {
  enterBattlePhase(state: BattleState, node: { phase: Phase }, side: Side): void;
  phaseLog(state: BattleState, side: Side, armyName: string, message: string): LogEntry;
  runAutomaticEleventhFightPhase(state: BattleState, side: Side, rules: RulesEdition): BattleState;
  runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
  updateObjectiveControl(state: BattleState, rules: RulesEdition): void;
}

export function runAutomaticFightPhase(state: BattleState, side: Side, rules: RulesEdition, context: AutomaticFightPhaseContext): { state: BattleState; logs: LogEntry[] } {
  const armyName = state.armies[side].name;
  context.enterBattlePhase(state, { phase: 'fight' }, side);
  const logs = [context.phaseLog(state, side, armyName, '\n─── Fight Phase ───')];
  if (rules.metadata.edition === '11e') state = context.runAutomaticEleventhFightPhase(state, side, rules);
  else {
    state.units.filter(unit => unit.side === side && !unit.destroyed && unit.charged).forEach(unit => logs.push(...context.runFight(unit, state, rules)));
    state.units.filter(unit => unit.side === side && !unit.destroyed && !unit.charged && unit.inCombat).forEach(unit => logs.push(...context.runFight(unit, state, rules)));
    state.units.filter(unit => unit.side !== side && !unit.destroyed && unit.inCombat).forEach(unit => logs.push(...context.runFight(unit, state, rules)));
  }
  context.updateObjectiveControl(state, rules);
  return { state, logs };
}

export interface AutomaticTurnContext {
  clone(state: BattleState): BattleState;
  resetActiveTurn(state: BattleState, side: Side, rules: RulesEdition): void;
  runCommand(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  runMovement(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  runShooting(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  runCharge(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  runFight(state: BattleState, side: Side, rules: RulesEdition): { state: BattleState; logs: LogEntry[] };
  checkWinner(state: BattleState): void;
  completeEndOfTurnActions(state: BattleState, side: Side): void;
  scoreEndOfTurnSecondaryMissionLogs(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  scoreEndOfTurnPrimaryMissionLogs(state: BattleState, side: Side, rules: RulesEdition): LogEntry[];
  returnOpponentAircraftToStrategicReserves(state: BattleState, side: Side, rules: RulesEdition): void;
}

/** Runs one automated player turn while delegating each phase to its domain. */
export function runAutomaticTurn(state: BattleState, rules: RulesEdition, context: AutomaticTurnContext): BattleState {
  let next = context.clone(state);
  const side = next.activeArmy;
  const logs: LogEntry[] = [];
  const finishIfWon = () => {
    context.checkWinner(next);
    if (next.winner === null) return false;
    next.log = [...next.log, ...logs];
    return true;
  };

  context.resetActiveTurn(next, side, rules);
  logs.push(...context.runCommand(next, side, rules));
  logs.push(...context.runMovement(next, side, rules));
  if (finishIfWon()) return next;

  logs.push(...context.runShooting(next, side, rules));
  if (finishIfWon()) return next;

  logs.push(...context.runCharge(next, side, rules));
  const fight = context.runFight(next, side, rules);
  next = fight.state;
  logs.push(...fight.logs);
  if (finishIfWon()) return next;

  context.completeEndOfTurnActions(next, side);
  logs.push(...context.scoreEndOfTurnSecondaryMissionLogs(next, side, rules));
  logs.push(...context.scoreEndOfTurnPrimaryMissionLogs(next, side, rules));
  context.returnOpponentAircraftToStrategicReserves(next, side, rules);
  next.log = [...next.log, ...logs];
  return next;
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
