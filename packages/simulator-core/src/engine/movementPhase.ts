import { BATTLE_PHASE, MOVEMENT_PHASE_STEP, type BattleState, type MovementPhaseStep } from '../types/battle';
import { movementPhaseNode } from './battleStateMachine';

/**
 * The Movement phase's public step contract. It deliberately owns only
 * Movement sequencing; geometry and move-type eligibility remain in their
 * dedicated movement rule modules.
 */
export interface MovementPhase {
  step: MovementPhaseStep;
  canSelectUnits: boolean;
  canPlaceReinforcements: boolean;
  canAdvance: boolean;
}

export function createMovementPhase(
  state: Pick<BattleState, 'phase' | 'movementStep' | 'movementPhaseStep'>,
): MovementPhase | null {
  const node = movementPhaseNode(state);
  if (!node || node.phase !== BATTLE_PHASE.Movement) return null;
  return {
    step: node.step,
    canSelectUnits: node.step === MOVEMENT_PHASE_STEP.MoveUnits,
    canPlaceReinforcements: node.step === MOVEMENT_PHASE_STEP.Reinforcements,
    // Start/end timing effects are resolved by their owning phase step before
    // the player is offered another phase action.
    canAdvance: node.step === MOVEMENT_PHASE_STEP.MoveUnits || node.step === MOVEMENT_PHASE_STEP.Reinforcements,
  };
}
