import { PHASE_STEP, type BattleState, type PhaseStep } from '../../types/battle';
import { storedOrInitialStep, type PhaseDefinition } from './phaseDefinition';

const steps = [PHASE_STEP.FightStart, PHASE_STEP.FightPileIn, PHASE_STEP.FightUnits, PHASE_STEP.FightConsolidate, PHASE_STEP.FightEnd] as const;

export const fightPhaseDefinition: PhaseDefinition = {
  phase: 'fight',
  steps,
  currentStep: (state: Pick<BattleState, 'phaseStep' | 'fightStepStarted' | 'consolidationStepStarted'>): PhaseStep => {
    if (state.phaseStep && steps.includes(state.phaseStep as (typeof steps)[number])) return state.phaseStep;
    if (state.consolidationStepStarted) return PHASE_STEP.FightConsolidate;
    return state.fightStepStarted ? PHASE_STEP.FightUnits : PHASE_STEP.FightPileIn;
  },
};
