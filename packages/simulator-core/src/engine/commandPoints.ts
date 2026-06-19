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

export function canSpendCommandPoints(state: BattleState, side: 0 | 1, amount: number): boolean {
  return commandPoints(state)[side] >= amount;
}

export function spendCommandPoints(state: BattleState, side: 0 | 1, amount: number): [number, number] | null {
  if (!canSpendCommandPoints(state, side, amount)) return null;
  const next = commandPoints(state);
  next[side] -= amount;
  setCommandPoints(state, next);
  return next;
}
