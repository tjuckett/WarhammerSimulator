import type { BattleState } from '../types/battle';

export function commandPoints(state: Pick<BattleState, 'commandPoints'>): [number, number] {
  return state.commandPoints ?? [0, 0];
}

export function setCommandPoints(state: BattleState, points: [number, number]): void {
  state.commandPoints = points;
}

export function gainCommandPhaseCommandPoints(state: BattleState): [number, number] {
  const current = commandPoints(state);
  const next: [number, number] = [current[0] + 1, current[1] + 1];
  setCommandPoints(state, next);
  return next;
}
