import type { BattleState } from '../types/battle';
import { battleRound, setBattleRound } from './battleRound';
import { battleRoundLimit, nextTurnTransition } from './battleStateMachine';
import { completeMissionEventsForCurrentTurn } from './missionEvents';

export interface TurnAdvanceContext {
  clone(state: BattleState): BattleState;
  enterBattlePhase(state: BattleState, node: { phase: 'setup' | 'end' }, side: BattleState['activeArmy']): void;
}

export function advanceTurn(state: BattleState, context: TurnAdvanceContext): BattleState {
  const next = context.clone(state);
  if (next.winner !== null) return next;
  completeMissionEventsForCurrentTurn(next);
  const transition = nextTurnTransition(next);
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
