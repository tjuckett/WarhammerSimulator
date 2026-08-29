import type { BattleState, PhaseStep } from '@warhammer-simulator/core/types/battle';
import { phaseStepFor, phaseStepsFor } from '@warhammer-simulator/core/engine/battleStateMachine';

const STEP_LABELS: Record<PhaseStep, string> = {
  'command-start': 'Start of Command',
  'command-gain-core-cp': 'Gain Core CP',
  'command-battle-shock': 'Battle-shock',
  'command-abilities': 'Command abilities',
  'command-end': 'End of Command',
  'movement-start': 'Start of Movement',
  'movement-units': 'Move Units',
  'movement-reinforcements': 'Reinforcements',
  'movement-end': 'End of Movement',
  'shooting-start': 'Start of Shooting',
  'shooting-units': 'Shoot',
  'shooting-end': 'End of Shooting',
  'charge-start': 'Start of Charge',
  'charge-units': 'Charge',
  'charge-end': 'End of Charge',
  'fight-start': 'Start of Fight',
  'fight-pile-in': 'Pile In',
  'fight-units': 'Fight',
  'fight-consolidate': 'Consolidate',
  'fight-end': 'End of Fight',
};

export function PhaseStepper({ state }: { state: BattleState }) {
  const steps = phaseStepsFor(state.phase);
  const current = phaseStepFor(state);
  if (!steps.length || !current) return null;
  const currentIndex = steps.indexOf(current);

  return (
    <aside className={`phase-stepper phase-stepper--${state.activeArmy}`} aria-label={`${state.phase} phase steps`}>
      <strong>{state.phase} phase</strong>
      <ol>
        {steps.map((step, index) => (
          <li key={step} className={index < currentIndex ? 'phase-stepper__complete' : index === currentIndex ? 'phase-stepper__current' : ''}>
            <span>{index < currentIndex ? '✓' : index + 1}</span>
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>
    </aside>
  );
}
