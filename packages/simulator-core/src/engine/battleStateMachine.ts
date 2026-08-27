import { BATTLE_PHASE, BATTLE_ROUND_STEP, MOVEMENT_PHASE_STEP, MOVEMENT_STEP, PLAYER_TURN_STEP, type BattleRoundStep, type BattleState, type MovementPhaseStep, type MovementStep, type Phase, type PlayerTurnStep, type Side } from '../types/battle';

export type BattleFlowNode =
  | { kind: 'pre-battle'; phase: typeof BATTLE_PHASE.Deployment | typeof BATTLE_PHASE.Setup }
  | { kind: 'battle-round'; step: typeof BATTLE_ROUND_STEP.Start | typeof BATTLE_ROUND_STEP.End }
  | { kind: 'player-turn'; side: Side; step: PlayerTurnStep; phase?: Phase }
  | { kind: 'battle-end' };

export interface BattleFlowState {
  battleRoundStep: BattleRoundStep;
  playerTurnStep?: PlayerTurnStep;
  currentActivePlayer: Side;
}

export type MovementPhaseNode = {
  phase: typeof BATTLE_PHASE.Movement;
  step: MovementPhaseStep;
};

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

/** Returns the hierarchical Battle Round/Player Turn view of legacy state. */
export function battleFlowNode(
  state: Pick<BattleState, 'phase' | 'activeArmy' | 'battleRoundStep' | 'playerTurnStep' | 'currentActivePlayer'>,
): BattleFlowNode {
  const roundStep = state.battleRoundStep
    ?? (state.phase === BATTLE_PHASE.Deployment || state.phase === BATTLE_PHASE.Setup
      ? BATTLE_ROUND_STEP.PreBattle
      : state.phase === BATTLE_PHASE.End
        ? BATTLE_ROUND_STEP.BattleEnd
        : BATTLE_ROUND_STEP.PlayerTurns);
  if (roundStep === BATTLE_ROUND_STEP.PreBattle) {
    return { kind: 'pre-battle', phase: state.phase === BATTLE_PHASE.Deployment ? BATTLE_PHASE.Deployment : BATTLE_PHASE.Setup };
  }
  if (roundStep === BATTLE_ROUND_STEP.BattleEnd) return { kind: 'battle-end' };
  if (roundStep === BATTLE_ROUND_STEP.Start || roundStep === BATTLE_ROUND_STEP.End) {
    return { kind: 'battle-round', step: roundStep };
  }
  const playerTurnNode: Extract<BattleFlowNode, { kind: 'player-turn' }> = {
    kind: 'player-turn',
    side: state.currentActivePlayer ?? state.activeArmy,
    step: state.playerTurnStep ?? PLAYER_TURN_STEP.Phase,
  };
  if (isTurnPhase(state.phase)) playerTurnNode.phase = state.phase;
  return playerTurnNode;
}

export function setBattleFlowNode(state: Pick<BattleState, 'phase' | 'activeArmy' | 'battleRoundStep' | 'playerTurnStep' | 'currentActivePlayer'>, node: BattleFlowNode): void {
  state.battleRoundStep = node.kind === 'pre-battle'
    ? BATTLE_ROUND_STEP.PreBattle
    : node.kind === 'battle-end'
      ? BATTLE_ROUND_STEP.BattleEnd
      : node.kind === 'battle-round'
        ? node.step
        : BATTLE_ROUND_STEP.PlayerTurns;
  if (node.kind === 'pre-battle') {
    state.phase = node.phase;
    state.playerTurnStep = undefined;
    state.currentActivePlayer = state.activeArmy;
    return;
  }
  if (node.kind === 'battle-end') {
    state.phase = BATTLE_PHASE.End;
    state.playerTurnStep = undefined;
    state.currentActivePlayer = state.activeArmy;
    return;
  }
  if (node.kind === 'battle-round') {
    state.playerTurnStep = undefined;
    state.currentActivePlayer = state.activeArmy;
    return;
  }
  state.activeArmy = node.side;
  state.currentActivePlayer = node.side;
  state.playerTurnStep = node.step;
  if (node.phase) state.phase = node.phase;
}

export function initializeBattleRoundStart(state: BattleState, firstPlayer: Side = state.activeArmy): void {
  state.activeArmy = firstPlayer;
  state.currentActivePlayer = firstPlayer;
  state.battleRoundStep = BATTLE_ROUND_STEP.Start;
  state.playerTurnStep = undefined;
}

export function beginPlayerTurn(state: BattleState, side: Side): void {
  state.activeArmy = side;
  state.currentActivePlayer = side;
  state.battleRoundStep = BATTLE_ROUND_STEP.PlayerTurns;
  state.playerTurnStep = PLAYER_TURN_STEP.Start;
}

export function beginPlayerTurnPhase(state: BattleState, phase: Phase): void {
  state.battleRoundStep = BATTLE_ROUND_STEP.PlayerTurns;
  state.playerTurnStep = PLAYER_TURN_STEP.Phase;
  state.currentActivePlayer = state.activeArmy;
  state.phase = phase;
}

export function beginPlayerTurnEnd(state: BattleState): void {
  state.battleRoundStep = BATTLE_ROUND_STEP.PlayerTurns;
  state.playerTurnStep = PLAYER_TURN_STEP.End;
  state.currentActivePlayer = state.activeArmy;
}

export function beginBattleRoundEnd(state: BattleState): void {
  state.battleRoundStep = BATTLE_ROUND_STEP.End;
  state.playerTurnStep = undefined;
  state.currentActivePlayer = state.activeArmy;
}

/**
 * Returns the explicit Movement-phase step while preserving old saved states
 * that only contain the legacy movementStep cursor.
 */
export function movementPhaseNode(
  state: Pick<BattleState, 'phase' | 'movementStep' | 'movementPhaseStep'>,
): MovementPhaseNode | null {
  if (state.phase !== BATTLE_PHASE.Movement) return null;
  if (state.movementPhaseStep) return { phase: BATTLE_PHASE.Movement, step: state.movementPhaseStep };
  return {
    phase: BATTLE_PHASE.Movement,
    step: state.movementStep === MOVEMENT_STEP.Reinforcements
      ? MOVEMENT_PHASE_STEP.Reinforcements
      : MOVEMENT_PHASE_STEP.MoveUnits,
  };
}

/** Updates the explicit Movement boundary and its legacy action cursor together. */
export function setMovementPhaseNode(
  state: Pick<BattleState, 'phase' | 'movementStep' | 'movementPhaseStep'>,
  node: MovementPhaseNode,
): void {
  state.phase = node.phase;
  state.movementPhaseStep = node.step;
  if (node.step === MOVEMENT_PHASE_STEP.MoveUnits) state.movementStep = MOVEMENT_STEP.MoveUnits;
  if (node.step === MOVEMENT_PHASE_STEP.Reinforcements) state.movementStep = MOVEMENT_STEP.Reinforcements;
}

export function nextMovementPhaseNode(
  state: Pick<BattleState, 'phase' | 'movementStep' | 'movementPhaseStep'>,
): MovementPhaseNode | null {
  const current = movementPhaseNode(state);
  if (!current) return null;
  switch (current.step) {
    case MOVEMENT_PHASE_STEP.Start:
      return { phase: BATTLE_PHASE.Movement, step: MOVEMENT_PHASE_STEP.MoveUnits };
    case MOVEMENT_PHASE_STEP.MoveUnits:
      return { phase: BATTLE_PHASE.Movement, step: MOVEMENT_PHASE_STEP.Reinforcements };
    case MOVEMENT_PHASE_STEP.Reinforcements:
      return { phase: BATTLE_PHASE.Movement, step: MOVEMENT_PHASE_STEP.End };
    default:
      return null;
  }
}

export function advanceMovementPhase(state: BattleState): MovementPhaseNode | null {
  const next = nextMovementPhaseNode(state);
  if (!next) return null;
  setMovementPhaseNode(state, next);
  return next;
}

export function battlePhaseNode(state: Pick<BattleState, 'phase' | 'movementStep'>): BattlePhaseNode {
  if (state.phase === BATTLE_PHASE.Movement) {
    return { phase: BATTLE_PHASE.Movement, step: state.movementStep ?? MOVEMENT_STEP.MoveUnits };
  }
  return { phase: state.phase } as BattlePhaseNode;
}

export function setBattlePhase(state: Pick<BattleState, 'phase' | 'movementStep' | 'movementPhaseStep'>, node: BattlePhaseNode): void {
  state.phase = node.phase;
  state.movementStep = node.phase === BATTLE_PHASE.Movement ? node.step : undefined;
  state.movementPhaseStep = node.phase === BATTLE_PHASE.Movement
    ? node.step === MOVEMENT_STEP.Reinforcements ? MOVEMENT_PHASE_STEP.Reinforcements : MOVEMENT_PHASE_STEP.MoveUnits
    : undefined;
}

function clearShootingCursors(state: BattleState): void {
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
}

function clearChargeCursors(state: BattleState): void {
  state.pendingChargeRoll = undefined;
  state.pendingChargeMovement = undefined;
  state.chargeResolution = undefined;
}

function clearFightCursors(state: BattleState): void {
  state.fightStepStarted = undefined;
  state.fightPileInSide = undefined;
  state.consolidationStepStarted = undefined;
  state.consolidationSide = undefined;
  state.consolidationEligibleUnitIds = undefined;
  state.consolidationPendingFightUnitIds = undefined;
  state.engagedUnitIdsAtFightStepStart = undefined;
  state.lastFightSelectionSide = undefined;
  state.activeAttachedFightUnitId = undefined;
  state.pendingFightMovement = undefined;
}

/** `activated` records a completed action in the current phase, not the turn. */
function resetPhaseActivations(state: BattleState): void {
  state.units?.forEach(unit => { unit.activated = false; });
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
      resetPhaseActivations(state);
      clearChargeCursors(state);
      clearFightCursors(state);
    },
  },
  [BATTLE_PHASE.Charge]: {
    phase: BATTLE_PHASE.Charge,
    enter(state) {
      resetPhaseActivations(state);
      clearShootingCursors(state);
      clearFightCursors(state);
    },
  },
  [BATTLE_PHASE.Fight]: {
    phase: BATTLE_PHASE.Fight,
    enter(state) {
      resetPhaseActivations(state);
      clearShootingCursors(state);
      clearChargeCursors(state);
      state.fightStepStarted = false;
      state.fightPileInSide = state.activeArmy;
      state.consolidationStepStarted = undefined;
      state.consolidationSide = undefined;
      state.consolidationEligibleUnitIds = undefined;
      state.consolidationPendingFightUnitIds = undefined;
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
  if (node.phase === BATTLE_PHASE.Deployment || node.phase === BATTLE_PHASE.Setup) {
    state.battleRoundStep = BATTLE_ROUND_STEP.PreBattle;
    state.playerTurnStep = undefined;
  } else if (node.phase === BATTLE_PHASE.End) {
    state.battleRoundStep = BATTLE_ROUND_STEP.BattleEnd;
    state.playerTurnStep = undefined;
  } else {
    state.battleRoundStep = BATTLE_ROUND_STEP.PlayerTurns;
    state.playerTurnStep = PLAYER_TURN_STEP.Phase;
    state.currentActivePlayer = state.activeArmy;
  }
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
