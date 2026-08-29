import { PHASE_STEP, type BattleState, type PhaseStep } from '../../types/battle';
import { storedOrInitialStep, type PhaseDefinition } from './phaseDefinition';

const steps = [PHASE_STEP.ChargeStart, PHASE_STEP.ChargeUnits, PHASE_STEP.ChargeEnd] as const;

export const chargePhaseDefinition: PhaseDefinition = {
  phase: 'charge',
  steps,
  currentStep: (state: Pick<BattleState, 'phaseStep'>): PhaseStep => storedOrInitialStep(state, steps),
};

export interface ChargePhaseStepTransitionContext {
  clone(state: BattleState): BattleState;
}

/** Advances only within the Charge phase. Phase boundaries are handled by the battle flow. */
export function advanceChargePhaseStep(
  state: BattleState,
  context: ChargePhaseStepTransitionContext,
): BattleState | null {
  if (state.phase !== 'charge') return null;
  const current = chargePhaseDefinition.currentStep(state);
  const index = steps.indexOf(current as (typeof steps)[number]);
  const nextStep = index >= 0 ? steps[index + 1] : undefined;
  if (!nextStep) return null;
  const next = context.clone(state);
  next.phaseStep = nextStep;
  return next;
}
