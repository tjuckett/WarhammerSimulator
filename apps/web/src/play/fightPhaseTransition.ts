import { BATTLE_PHASE, PHASE_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';

export type FightTransitionResult = { state: BattleState } | { warning: string } | null;

export function transitionFightStart(state: BattleState, clone: <T>(value: T) => T): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight || state.phaseStep !== PHASE_STEP.FightStart) return null;
  const next = clone(state); next.phaseStep = PHASE_STEP.FightPileIn;
  return { state: next };
}

export function transitionFightEnd(state: BattleState, clone: <T>(value: T) => T): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight || !state.consolidationStepStarted || state.phaseStep === PHASE_STEP.FightEnd) return null;
  const next = clone(state); next.phaseStep = PHASE_STEP.FightEnd;
  return { state: next };
}

export function transitionFightPileIn(
  state: BattleState,
  advancePileIn: (state: BattleState) => BattleState,
): FightTransitionResult {
  if (state.phaseStep !== PHASE_STEP.FightPileIn) return null;
  const next = advancePileIn(state);
  if (next === state) return { warning: 'Choose Pile In for each eligible unit you want to move, or finish the current side.' };
  if (next.fightStepStarted) next.phaseStep = PHASE_STEP.FightUnits;
  return { state: next };
}

export function transitionFightConsolidation(
  state: BattleState,
  clone: <T>(value: T) => T,
  startConsolidation: (state: BattleState) => BattleState,
  pendingFights: (state: BattleState) => boolean,
  eligibleConsolidations: (state: BattleState, side: 0 | 1) => boolean,
  advanceConsolidation: (state: BattleState) => BattleState,
): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight || state.phaseStep !== PHASE_STEP.FightUnits && state.phaseStep !== PHASE_STEP.FightConsolidate) return null;
  if (!state.consolidationStepStarted) {
    if (pendingFights(state)) return { warning: 'Resolve every eligible fight before starting Consolidation.' };
    const next = startConsolidation(state); if (next === state) return null;
    next.phaseStep = PHASE_STEP.FightConsolidate; return { state: next };
  }
  const side = state.consolidationSide ?? state.activeArmy;
  if (pendingFights(state)) return { warning: 'Resolve the newly engaged enemy fight opportunity first.' };
  if (eligibleConsolidations(state, side)) return { warning: 'Choose Consolidate for each eligible unit you want to move, or finish the current side.' };
  if (side === state.activeArmy) return { state: advanceConsolidation(state) };
  return transitionFightEnd(state, clone);
}
