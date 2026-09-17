import { BATTLE_PHASE, PHASE_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';
import { phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';

export type FightTransitionResult = { state: BattleState } | { warning: string } | null;

export function transitionFightStart(state: BattleState, clone: <T>(value: T) => T): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight || phaseStepFor(state) !== PHASE_STEP.FightStart) return null;
  // Keep the Fight Start cursor intact. The caller passes this state to
  // startPlayFightPileInStep, which owns the transition to FightPileIn and
  // publishes the typed Pile-in action ledger. Advancing the cursor here
  // bypasses that initializer and makes the UI recompute every target query.
  return { state: clone(state) };
}

export function transitionFightEnd(state: BattleState, clone: <T>(value: T) => T): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight || !state.consolidationStepStarted || phaseStepFor(state) === PHASE_STEP.FightEnd) return null;
  const next = clone(state); next.phaseStep = PHASE_STEP.FightEnd;
  return { state: next };
}

export function transitionFightPileIn(
  state: BattleState,
  advancePileIn: (state: BattleState) => BattleState,
): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight || phaseStepFor(state) !== PHASE_STEP.FightPileIn) return null;
  if (state.pendingFightMovement) return { warning: 'Complete the current Pile In move before advancing the Fight step.' };
  const next = advancePileIn(state);
  if (next === state) return { warning: 'Choose Pile In for each eligible unit you want to move, or finish the current side.' };
  return { state: next };
}

export function transitionFightConsolidation(
  state: BattleState,
  startConsolidation: (state: BattleState) => BattleState,
  pendingFights: (state: BattleState) => boolean,
  advanceConsolidation: (state: BattleState) => BattleState,
): FightTransitionResult {
  if (state.phase !== BATTLE_PHASE.Fight) return null;
  if (state.pendingFightMovement) return { warning: 'Complete the current Fight movement before advancing the Fight step.' };
  const fightStep = phaseStepFor(state);
  if (fightStep !== PHASE_STEP.FightUnits && fightStep !== PHASE_STEP.FightConsolidate) return null;
  if (!state.consolidationStepStarted) {
    if (pendingFights(state)) return { warning: 'Resolve every eligible fight before starting Consolidation.' };
    const next = startConsolidation(state); if (next === state) return null;
    next.phaseStep = PHASE_STEP.FightConsolidate; return { state: next };
  }
  if (pendingFights(state)) return { warning: 'Resolve the newly engaged enemy fight opportunity first.' };
  return { state: advanceConsolidation(state) };
}
