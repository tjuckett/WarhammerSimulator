import type { BattleState, LogEntry, Side } from '../types/battle';
import { battleRound, logWithBattleRound } from './battleRound';

let nextLogSequence = 0;

export function resetBattleLogSequence(): void {
  nextLogSequence = 0;
}

function nextLogId(state?: BattleState): string {
  const usedIds = new Set(state?.log.map(entry => entry.id) ?? []);
  let id = String(++nextLogSequence);
  while (usedIds.has(id)) id = String(++nextLogSequence);
  return id;
}

/** Creates presentation/audit output; never use log messages as rules input. */
export function battleLog(state: BattleState, side: Side, unitName: string, message: string, type: LogEntry['type']): LogEntry {
  return logWithBattleRound({ id: nextLogId(state), turn: battleRound(state), phase: state.phase, side, unitName, message, type });
}

export function phaseLog(state: BattleState, side: Side, armyName: string, label: string): LogEntry {
  return battleLog(state, side, armyName, label, 'phase');
}
