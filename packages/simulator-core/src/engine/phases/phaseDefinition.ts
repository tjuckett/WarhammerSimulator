import type { BattleState, Phase, PhaseStep } from '../../types/battle';

/**
 * A phase owns its own step ordering and legacy-state interpretation. The
 * central state machine only routes to this contract; it contains no rules
 * about Command, Movement, Shooting, Charge, or Fight.
 */
export interface PhaseDefinition {
  phase: Extract<Phase, 'command' | 'movement' | 'shooting' | 'charge' | 'fight'>;
  steps: readonly PhaseStep[];
  currentStep(state: Pick<BattleState, 'phaseStep' | 'movementStep' | 'fightStepStarted' | 'consolidationStepStarted'>): PhaseStep;
}

export function storedOrInitialStep(
  state: Pick<BattleState, 'phaseStep'>,
  steps: readonly PhaseStep[],
): PhaseStep {
  return state.phaseStep && steps.includes(state.phaseStep) ? state.phaseStep : steps[0];
}
