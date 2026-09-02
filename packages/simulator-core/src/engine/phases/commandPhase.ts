import { PHASE_STEP, type BattleState, type PhaseStep, type Side } from '../../types/battle';
import { battleshockStepComplete } from '../battleshockPhase';
import { storedOrInitialStep, type PhaseDefinition } from './phaseDefinition';

const steps = [PHASE_STEP.CommandStart, PHASE_STEP.CommandGainCoreCp, PHASE_STEP.CommandBattleShock, PHASE_STEP.CommandAbilities, PHASE_STEP.CommandEnd] as const;

export const commandPhaseDefinition: PhaseDefinition = {
  phase: 'command',
  steps,
  currentStep: (state: Pick<BattleState, 'phaseStep'>): PhaseStep => storedOrInitialStep(state, steps),
};

export interface CommandPhaseStepTransitionContext {
  clone(state: BattleState): BattleState;
  gainCoreCommandPoints(state: BattleState): void;
  beginBattleshockStep(state: BattleState, side: Side): void;
}

/** Advances only within the Command phase. Phase boundaries are handled by the battle flow. */
export function advanceCommandPhaseStep(
  state: BattleState,
  context: CommandPhaseStepTransitionContext,
): BattleState | null {
  if (state.phase !== 'command') return null;
  const current = commandPhaseDefinition.currentStep(state);
  const index = steps.indexOf(current as (typeof steps)[number]);
  const nextStep = index >= 0 ? steps[index + 1] : undefined;
  if (!nextStep) return null;
  if (nextStep === PHASE_STEP.CommandAbilities && !battleshockStepComplete(state)) return null;

  const next = context.clone(state);
  next.phaseStep = nextStep;
  if (nextStep === PHASE_STEP.CommandGainCoreCp) context.gainCoreCommandPoints(next);
  if (nextStep === PHASE_STEP.CommandBattleShock) {
    context.beginBattleshockStep(next, next.activeArmy);
  }
  return next;
}
