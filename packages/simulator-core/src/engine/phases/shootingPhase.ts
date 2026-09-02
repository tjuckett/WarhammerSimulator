import { PHASE_STEP, type BattleState, type PhaseStep } from '../../types/battle';
import { storedOrInitialStep, type PhaseDefinition } from './phaseDefinition';

const steps = [PHASE_STEP.ShootingStart, PHASE_STEP.ShootingUnits, PHASE_STEP.ShootingEnd] as const;

export const shootingPhaseDefinition: PhaseDefinition = {
  phase: 'shooting',
  steps,
  currentStep: (state: Pick<BattleState, 'phaseStep'>): PhaseStep => storedOrInitialStep(state, steps),
};

export interface ShootingPhaseStepTransitionContext {
  clone(state: BattleState): BattleState;
  startShootingStep?(state: BattleState): void;
}

/** Advances only within the Shooting phase. Phase boundaries are handled by the battle flow. */
export function advanceShootingPhaseStep(
  state: BattleState,
  context: ShootingPhaseStepTransitionContext,
): BattleState | null {
  if (state.phase !== 'shooting') return null;
  const current = shootingPhaseDefinition.currentStep(state);
  const index = steps.indexOf(current as (typeof steps)[number]);
  const nextStep = index >= 0 ? steps[index + 1] : undefined;
  if (!nextStep) return null;
  const next = context.clone(state);
  next.phaseStep = nextStep;
  if (nextStep === PHASE_STEP.ShootingUnits) context.startShootingStep?.(next);
  return next;
}
