import type { BattleState } from '../types/battle';
import { battleRound, setBattleRound } from './battleRound';
import { battleRoundLimit, nextTurnTransition } from './battleStateMachine';
import { completeMissionEventsForCurrentTurn } from './missionEvents';
import { destroyExpiredStrategicReserves } from './reinforcements';

export interface TurnAdvanceContext {
  clone(state: BattleState): BattleState;
  enterBattlePhase(state: BattleState, node: { phase: 'setup' | 'end' }, side: BattleState['activeArmy']): void;
}

export function advanceTurn(state: BattleState, context: TurnAdvanceContext): BattleState {
  const next = context.clone(state);
  if (next.winner !== null) return next;
  completeMissionEventsForCurrentTurn(next);
  const transition = nextTurnTransition(next);
  if (transition.nextBattleRound === 4) destroyExpiredStrategicReserves(next);
  next.activeArmy = transition.nextSide;
  if (transition.nextBattleRound !== battleRound(next)) setBattleRound(next, transition.nextBattleRound);
  if (transition.nextBattleRound > battleRoundLimit(next)) {
    if (next.scores[0] > next.scores[1]) next.winner = 0;
    else if (next.scores[1] > next.scores[0]) next.winner = 1;
    else next.winner = 'draw';
    context.enterBattlePhase(next, { phase: 'end' }, next.activeArmy);
  } else {
    context.enterBattlePhase(next, { phase: 'setup' }, next.activeArmy);
  }
  return next;
}

export function advanceTurnInPlace(state: BattleState, context: TurnAdvanceContext): void {
  if (state.winner !== null) return;
  completeMissionEventsForCurrentTurn(state);
  const transition = nextTurnTransition(state);
  if (transition.nextBattleRound === 4) destroyExpiredStrategicReserves(state);
  state.activeArmy = transition.nextSide;
  if (transition.nextBattleRound !== battleRound(state)) setBattleRound(state, transition.nextBattleRound);
  if (transition.nextBattleRound > battleRoundLimit(state)) {
    if (state.scores[0] > state.scores[1]) state.winner = 0;
    else if (state.scores[1] > state.scores[0]) state.winner = 1;
    else state.winner = 'draw';
    context.enterBattlePhase(state, { phase: 'end' }, state.activeArmy);
    return;
  }
  context.enterBattlePhase(state, { phase: 'setup' }, state.activeArmy);
}
