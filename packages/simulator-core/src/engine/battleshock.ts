import type { BattleState, BattleUnit, LogEntry } from '../types/battle';
import { d6 } from './dice';

export function unitCanBeAffectedByStratagem(unit: BattleUnit): boolean {
  return !unit.destroyed && !unit.battleshocked;
}

export function objectiveControlValue(unit: BattleUnit): number {
  return unit.battleshocked ? 0 : unit.profile.oc;
}

export function resolveDesperateEscapeTests(
  state: BattleState,
  unit: BattleUnit,
  log: (unit: BattleUnit, message: string) => LogEntry,
): LogEntry[] {
  if (!unit.battleshocked || unit.destroyed) return [];

  const logs: LogEntry[] = [];
  let failed = 0;
  const rolls: number[] = [];

  for (let i = 0; i < unit.remainingModels; i++) {
    const roll = d6();
    rolls.push(roll);
    if (roll <= 1) failed++;
  }

  if (failed > 0) {
    unit.remainingModels = Math.max(0, unit.remainingModels - failed);
    unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
    unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
    unit.destroyed = unit.remainingModels <= 0;
  }

  logs.push(log(
    unit,
    `${unit.profile.name} is Battle-shocked and Falls Back: Desperate Escape rolls ${rolls.join(', ')}${failed ? `; ${failed} model${failed === 1 ? '' : 's'} destroyed` : '; no models destroyed'}.`,
  ));

  return logs;
}
