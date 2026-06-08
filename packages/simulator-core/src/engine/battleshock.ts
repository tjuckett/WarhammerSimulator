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
  modelIndices?: number[],
): LogEntry[] {
  if (unit.destroyed) return [];

  const testModelIndices = Array.from(new Set(
    unit.battleshocked
      ? unit.modelPositions.map((_, modelIndex) => modelIndex)
      : modelIndices ?? [],
  )).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!testModelIndices.length) return [];

  const logs: LogEntry[] = [];
  const failedModelIndices: number[] = [];
  const rolls: number[] = [];

  for (const modelIndex of testModelIndices) {
    const roll = d6();
    rolls.push(roll);
    if (roll <= 1) failedModelIndices.push(modelIndex);
  }

  if (failedModelIndices.length > 0) {
    for (const modelIndex of failedModelIndices.sort((a, b) => b - a)) {
      unit.modelPositions.splice(modelIndex, 1);
      unit.modelRotations?.splice(modelIndex, 1);
      unit.movementAllowanceRemainingByModel?.splice(modelIndex, 1);
    }
    unit.remainingModels = Math.min(unit.remainingModels, unit.modelPositions.length);
    unit.destroyed = unit.remainingModels <= 0;
  }

  const reason = unit.battleshocked
    ? 'is Battle-shocked and Falls Back'
    : 'moves over enemy models while Falling Back';
  const failed = failedModelIndices.length;
  logs.push(log(
    unit,
    `${unit.profile.name} ${reason}: Desperate Escape rolls ${rolls.join(', ')}${failed ? `; ${failed} model${failed === 1 ? '' : 's'} destroyed` : '; no models destroyed'}.`,
  ));

  return logs;
}
