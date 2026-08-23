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

export function nextTurnTransition(
  state: Pick<BattleState, 'phase' | 'movementStep' | 'activeArmy' | 'battleRound' | 'turn' | 'maxBattleRounds' | 'maxTurns'>,
): BattlePhaseTransition {
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
