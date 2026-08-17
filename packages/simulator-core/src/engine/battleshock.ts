import type { BattleState, BattleUnit, LogEntry } from '../types/battle';
import { d6 } from './dice';

export function unitCanBeAffectedByStratagem(unit: BattleUnit): boolean {
  return !unit.destroyed && !unit.battleshocked;
}

export function objectiveControlValue(unit: BattleUnit): number {
  if (unit.battleshocked) return 0;
  const damaged = unit.profile.damagedProfile;
  const modifier = damaged
    && unit.remainingModels === 1
    && unit.woundsOnLeadModel <= damaged.maxRemainingWounds
    ? damaged.objectiveControlModifier ?? 0
    : 0;
  return Math.max(0, unit.profile.oc + modifier);
}

export function resolveDesperateEscapeTests(
  state: BattleState,
  unit: BattleUnit,
  log: (unit: BattleUnit, message: string) => LogEntry,
  modelIndices?: number[],
  onModelsDestroyed?: (unit: BattleUnit, modelIndices: number[]) => void,
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
    const sortedFailedModelIndices = failedModelIndices.sort((a, b) => b - a);
    onModelsDestroyed?.(unit, sortedFailedModelIndices);
    for (const modelIndex of sortedFailedModelIndices) {
      unit.modelPositions.splice(modelIndex, 1);
      unit.modelRosterIndexes?.splice(modelIndex, 1);
      unit.modelRotations?.splice(modelIndex, 1);
      unit.movementAllowanceRemainingByModel?.splice(modelIndex, 1);
      unit.movementAllowanceTotalByModel?.splice(modelIndex, 1);
      unit.movementStartPositionsByModel?.splice(modelIndex, 1);
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
