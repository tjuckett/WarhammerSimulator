import { BATTLE_EVENT_TYPE, recordBattleEvent } from '../battleEvents';
import { EVENT_TRIGGER_TIMING, type BattleState, type Side } from '../../types/battle';
import { advanceChargePhaseStep } from './chargePhase';
import { advanceCommandPhaseStep } from './commandPhase';
import { advanceMovementPhaseStep } from './movementPhase';
import { advanceShootingPhaseStep } from './shootingPhase';

export interface PhaseStepTransitionContext {
  clone(state: BattleState): BattleState;
  gainCoreCommandPoints(state: BattleState): void;
  markRemainingStationaryUnits(state: BattleState, side: Side): void;
}

/**
 * Routes standard player-turn step transitions to the owning phase module.
 * This is deliberately only a dispatcher; eligibility and step effects remain
 * in the phase modules themselves.
 */
export function advancePhaseStep(
  state: BattleState,
  context: PhaseStepTransitionContext,
): BattleState | null {
  const next = state.phase === 'command'
    ? advanceCommandPhaseStep(state, context)
    : state.phase === 'movement'
      ? advanceMovementPhaseStep(state, context)
      : state.phase === 'shooting'
        ? advanceShootingPhaseStep(state, context)
        : state.phase === 'charge'
          ? advanceChargePhaseStep(state, context)
          : null;
  if (!next) return null;

  recordBattleEvent(next, {
    type: BATTLE_EVENT_TYPE.StepStarted,
    side: next.activeArmy,
    source: next.armies?.[next.activeArmy]?.name,
    data: {
      triggerTiming: EVENT_TRIGGER_TIMING.StepStart,
      from: state.phaseStep,
      to: next.phaseStep,
    },
  });
  return next;
}
