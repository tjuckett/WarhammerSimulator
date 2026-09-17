import type { BattleState, LogEntry, Side } from '../types/battle';
import { battleRound, logWithBattleRound } from './battleRound';

let nextLogSequence = 0;
let logSequenceInitialized = false;

export function resetBattleLogSequence(): void {
  nextLogSequence = 0;
  logSequenceInitialized = false;
}

function nextLogId(state?: BattleState): string {
  // Synchronize once for a loaded state, then rely on the process-wide
  // sequence. Rebuilding a Set for every log entry made long simulations
  // increasingly expensive.
  if (!logSequenceInitialized) {
    for (const entry of state?.log ?? []) {
      if (!/^\d+$/.test(entry.id)) continue;
      nextLogSequence = Math.max(nextLogSequence, Number(entry.id));
    }
    logSequenceInitialized = true;
  }
  return String(++nextLogSequence);
}

/** Creates presentation/audit output; never use log messages as rules input. */
export function battleLog(state: BattleState, side: Side, unitName: string, message: string, type: LogEntry['type']): LogEntry {
  return logWithBattleRound({ id: nextLogId(state), turn: battleRound(state), phase: state.phase, side, unitName, message, type });
}

export function phaseLog(state: BattleState, side: Side, armyName: string, label: string): LogEntry {
  return battleLog(state, side, armyName, label, 'phase');
}
