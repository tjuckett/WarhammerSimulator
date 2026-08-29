import { MOVEMENT_PHASE_STEP, MOVEMENT_STEP, PHASE_STEP, type BattleState, type PhaseStep, type Side } from '../../types/battle';
import { storedOrInitialStep, type PhaseDefinition } from './phaseDefinition';

const steps = [PHASE_STEP.MovementStart, PHASE_STEP.MovementUnits, PHASE_STEP.MovementReinforcements, PHASE_STEP.MovementEnd] as const;

export const movementPhaseDefinition: PhaseDefinition = {
  phase: 'movement',
  steps,
  currentStep: (state: Pick<BattleState, 'phaseStep' | 'movementStep'>): PhaseStep =>
    state.phaseStep && steps.includes(state.phaseStep as (typeof steps)[number])
      ? state.phaseStep
      : state.movementStep === MOVEMENT_STEP.Reinforcements
        ? PHASE_STEP.MovementReinforcements
        : state.movementStep === MOVEMENT_STEP.MoveUnits
          ? PHASE_STEP.MovementUnits
        : storedOrInitialStep(state, steps),
};

export interface MovementPhaseStepTransitionContext {
  clone(state: BattleState): BattleState;
  markRemainingStationaryUnits(state: BattleState, side: Side): void;
}

/** Advances only within the Movement phase and owns the Move Units boundary. */
export function advanceMovementPhaseStep(
  state: BattleState,
  context: MovementPhaseStepTransitionContext,
): BattleState | null {
  if (state.phase !== 'movement') return null;
  const current = movementPhaseDefinition.currentStep(state);
  const index = steps.indexOf(current as (typeof steps)[number]);
  const nextStep = index >= 0 ? steps[index + 1] : undefined;
  if (!nextStep) return null;

  const next = context.clone(state);
  next.phaseStep = nextStep;
  if (nextStep === PHASE_STEP.MovementUnits) {
    next.movementPhaseStep = MOVEMENT_PHASE_STEP.MoveUnits;
    next.movementStep = MOVEMENT_STEP.MoveUnits;
  } else if (nextStep === PHASE_STEP.MovementReinforcements) {
    context.markRemainingStationaryUnits(next, next.activeArmy);
    next.movementPhaseStep = MOVEMENT_PHASE_STEP.Reinforcements;
    next.movementStep = MOVEMENT_STEP.Reinforcements;
  } else if (nextStep === PHASE_STEP.MovementEnd) {
    next.movementPhaseStep = MOVEMENT_PHASE_STEP.End;
  }
  return next;
}
