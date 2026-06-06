import type { BattleState, LogEntry } from '../types/battle';

export function battleRound(state: Pick<BattleState, 'battleRound' | 'turn'>): number {
  return state.battleRound ?? state.turn;
}

export function maxBattleRounds(state: Pick<BattleState, 'maxBattleRounds' | 'maxTurns'>): number {
  return state.maxBattleRounds ?? state.maxTurns;
}

export function setBattleRound(state: BattleState, round: number): void {
  state.battleRound = round;
  state.turn = round;
}

export function logWithBattleRound(entry: Omit<LogEntry, 'battleRound'>): LogEntry {
  return {
    ...entry,
    battleRound: entry.turn,
  };
}
