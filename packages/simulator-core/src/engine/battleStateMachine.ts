import { BATTLE_PHASE, MOVEMENT_STEP, type BattleState, type MovementStep, type Phase, type Side } from '../types/battle';

export type BattlePhaseNode =
  | { phase: typeof BATTLE_PHASE.Deployment }
  | { phase: typeof BATTLE_PHASE.Setup }
  | { phase: typeof BATTLE_PHASE.Command }
  | { phase: typeof BATTLE_PHASE.Movement; step: MovementStep }
  | { phase: typeof BATTLE_PHASE.Shooting }
  | { phase: typeof BATTLE_PHASE.Charge }
  | { phase: typeof BATTLE_PHASE.Fight }
  | { phase: typeof BATTLE_PHASE.BattleShock }
  | { phase: typeof BATTLE_PHASE.End };

export type BattlePhaseTransition =
  | { kind: 'phase'; from: BattlePhaseNode; to: BattlePhaseNode }
  | { kind: 'turn'; from: BattlePhaseNode; nextSide: Side; nextBattleRound: number }
  | { kind: 'end'; from: BattlePhaseNode };

/**
 * Owns temporary state that may exist while a phase is active.  Rules and
 * simulation sequencing live outside this registry; these handlers only make
 * phase entry deterministic for every caller (play, simulation and replay).
 */
export interface BattlePhaseStateHandler {
  phase: Phase;
  enter(state: BattleState, node: BattlePhaseNode): void;
}

const TURN_PHASES: Phase[] = [
  BATTLE_PHASE.Command,
  BATTLE_PHASE.Movement,
  BATTLE_PHASE.Shooting,
  BATTLE_PHASE.Charge,
  BATTLE_PHASE.Fight,
];

export function isTurnPhase(phase: Phase): boolean {
  return TURN_PHASES.includes(phase);
}

export function battlePhaseNode(state: Pick<BattleState, 'phase' | 'movementStep'>): BattlePhaseNode {
  if (state.phase === BATTLE_PHASE.Movement) {
    return { phase: BATTLE_PHASE.Movement, step: state.movementStep ?? MOVEMENT_STEP.MoveUnits };
  }
  return { phase: state.phase } as BattlePhaseNode;
}

export function setBattlePhase(state: Pick<BattleState, 'phase' | 'movementStep'>, node: BattlePhaseNode): void {
  state.phase = node.phase;
  state.movementStep = node.phase === BATTLE_PHASE.Movement ? node.step : undefined;
}

function clearShootingCursors(state: BattleState): void {
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
}

function clearChargeCursors(state: BattleState): void {
  state.pendingChargeRoll = undefined;
  state.pendingChargeMovement = undefined;
}

function clearFightCursors(state: BattleState): void {
  state.fightStepStarted = undefined;
  state.engagedUnitIdsAtFightStepStart = undefined;
  state.lastFightSelectionSide = undefined;
  state.activeAttachedFightUnitId = undefined;
}

function enterNonCombatPhase(state: BattleState): void {
  clearShootingCursors(state);
  clearChargeCursors(state);
  clearFightCursors(state);
}

export const BATTLE_PHASE_STATE_HANDLERS: Record<Phase, BattlePhaseStateHandler> = {
  [BATTLE_PHASE.Deployment]: { phase: BATTLE_PHASE.Deployment, enter: enterNonCombatPhase },
  [BATTLE_PHASE.Setup]: { phase: BATTLE_PHASE.Setup, enter: enterNonCombatPhase },
  [BATTLE_PHASE.Command]: { phase: BATTLE_PHASE.Command, enter: enterNonCombatPhase },
  [BATTLE_PHASE.Movement]: { phase: BATTLE_PHASE.Movement, enter: enterNonCombatPhase },
  [BATTLE_PHASE.Shooting]: {
    phase: BATTLE_PHASE.Shooting,
    enter(state) {
      clearChargeCursors(state);
      clearFightCursors(state);
    },
  },
  [BATTLE_PHASE.Charge]: {
    phase: BATTLE_PHASE.Charge,
    enter(state) {
      clearShootingCursors(state);
      clearFightCursors(state);
    },
  },
  [BATTLE_PHASE.Fight]: {
    phase: BATTLE_PHASE.Fight,
    enter(state) {
      clearShootingCursors(state);
      clearChargeCursors(state);
      state.fightStepStarted = false;
      state.engagedUnitIdsAtFightStepStart = undefined;
      state.lastFightSelectionSide = undefined;
      state.activeAttachedFightUnitId = undefined;
    },
  },
  [BATTLE_PHASE.BattleShock]: { phase: BATTLE_PHASE.BattleShock, enter: enterNonCombatPhase },
  [BATTLE_PHASE.End]: { phase: BATTLE_PHASE.End, enter: enterNonCombatPhase },
};

export function battlePhaseStateHandler(node: BattlePhaseNode): BattlePhaseStateHandler {
  return BATTLE_PHASE_STATE_HANDLERS[node.phase];
}

/**
 * Applies the phase-owned cursor/state invariants shared by manual play and simulation.
 * Rule-specific resets remain in the phase handlers; this only clears cursors that cannot
 * survive a phase boundary.
 */
export function initializeBattlePhase(state: BattleState, node: BattlePhaseNode): void {
  setBattlePhase(state, node);
  battlePhaseStateHandler(node).enter(state, node);
}

export function nextBattlePhase(state: Pick<BattleState, 'phase' | 'movementStep'>): BattlePhaseTransition | null {
  const from = battlePhaseNode(state);
  switch (from.phase) {
    case BATTLE_PHASE.Setup:
      return { kind: 'phase', from, to: { phase: BATTLE_PHASE.Command } };
    case BATTLE_PHASE.Command:
      return { kind: 'phase', from, to: { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.MoveUnits } };
    case BATTLE_PHASE.Movement:
      return from.step === MOVEMENT_STEP.MoveUnits
        ? { kind: 'phase', from, to: { phase: BATTLE_PHASE.Movement, step: MOVEMENT_STEP.Reinforcements } }
        : { kind: 'phase', from, to: { phase: BATTLE_PHASE.Shooting } };
    case BATTLE_PHASE.Shooting:
      return { kind: 'phase', from, to: { phase: BATTLE_PHASE.Charge } };
    case BATTLE_PHASE.Charge:
      return { kind: 'phase', from, to: { phase: BATTLE_PHASE.Fight } };
    case BATTLE_PHASE.Fight:
      return { kind: 'turn', from, nextSide: 0, nextBattleRound: 0 };
    default:
      return null;
  }
}

/**
 * Advance only within the active turn. Turn rollover has phase-owned effects
 * (command resets, scoring and winner resolution) and is therefore performed
 * by the caller's turn handler. All ordinary phase/substep transitions flow
 * through this function so they receive identical entry-state invariants.
 */
export function advanceBattlePhase(state: BattleState): Extract<BattlePhaseTransition, { kind: 'phase' }> | null {
  const transition = nextBattlePhase(state);
  if (!transition || transition.kind !== 'phase') return null;
  initializeBattlePhase(state, transition.to);
  return transition;
}

export function nextTurnTransition(
  state: Pick<BattleState, 'phase' | 'movementStep' | 'activeArmy' | 'battleRound' | 'turn' | 'maxBattleRounds' | 'maxTurns'>,
): Extract<BattlePhaseTransition, { kind: 'turn' }> {
  const from = battlePhaseNode(state);
  if (state.activeArmy === 0) {
    return { kind: 'turn', from, nextSide: 1, nextBattleRound: state.battleRound ?? state.turn };
  }
  return {
    kind: 'turn',
    from,
    nextSide: 0,
    nextBattleRound: (state.battleRound ?? state.turn) + 1,
  };
}

export function battleRoundLimit(state: Pick<BattleState, 'maxBattleRounds' | 'maxTurns'>): number {
  return state.maxBattleRounds ?? state.maxTurns;
}
