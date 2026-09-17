import type { BattleState, BattleUnit, LogEntry, Position, Side } from '../types/battle';
import { BATTLE_EVENT_TYPE, recordBattleEvent } from './battleEvents';
import { battleLog } from './battleLog';
import { resolveDamageOutcome } from './combatResolution';

export interface DamageApplicationOptions {
  deferCasualties?: boolean;
  noCarryOver?: boolean;
  source?: string;
  sourceUnitId?: string;
  targetModelIndex?: number;
  sourceObjectiveIndexesWithinRange?: number[];
  sourceTags?: Array<'psychic'>;
}

export interface DamageApplicationContext {
  applyFeelNoPain(unit: BattleUnit, damage: number, state: BattleState): { damage: number; logs: LogEntry[] };
  queueDeadlyDemise(state: BattleState, unit: BattleUnit, modelIndexes: number[], attackerSide: Side): void;
  recordDestroyedModels(state: BattleState, unit: BattleUnit, modelIndexes: number[], attackerSide: Side, source: { destroyedByUnitId?: string; sourceTags?: Array<'psychic'> }): void;
  rememberDestroyedPositions(unit: BattleUnit): void;
  trimUnitModelState(unit: BattleUnit): void;
  queueFightOnDeath(state: BattleState, unit: BattleUnit, attackerSide: Side, positions: Position[], rosterIndexes: number[]): void;
  markUnitDestroyed(unit: BattleUnit): void;
  recordDestroyedUnit(state: BattleState, unit: BattleUnit, attackerSide: Side, source: { destroyedByUnitId?: string; destroyingUnitObjectiveIndexesWithinRange?: number[]; sourceTags?: Array<'psychic'> }): void;
  emergencyDisembark(state: BattleState, unit: BattleUnit, attackerSide: Side): LogEntry[];
}

export function applyDamage(
  unit: BattleUnit, totalDamage: number, state: BattleState, attackerSide: Side,
  options: DamageApplicationOptions = {}, context: DamageApplicationContext,
): LogEntry[] {
  const logs: LogEntry[] = [];
  if (options.deferCasualties) {
    unit.pendingDamageAllocations = [...(unit.pendingDamageAllocations ?? []), {
      targetUnitId: unit.id, damage: totalDamage, noCarryOver: options.noCarryOver, source: options.source,
      ...(options.sourceUnitId ? { sourceUnitId: options.sourceUnitId } : {}),
      ...(options.targetModelIndex !== undefined ? { targetModelIndex: options.targetModelIndex } : {}),
      ...(options.sourceObjectiveIndexesWithinRange ? { sourceObjectiveIndexesWithinRange: options.sourceObjectiveIndexesWithinRange } : {}),
      ...(options.sourceTags?.length ? { sourceTags: [...options.sourceTags] } : {}),
    }];
    recordBattleEvent(state, { type: BATTLE_EVENT_TYPE.DamagePending, side: attackerSide, source: options.sourceUnitId,
      data: { targetUnitId: unit.id, damage: totalDamage, noCarryOver: options.noCarryOver ?? false, source: options.source ?? 'attack' } });
    logs.push(battleLog(state, attackerSide, unit.profile.name, `  ${unit.profile.name}: allocate ${totalDamage} damage${options.source ? ` from ${options.source}` : ''}`, 'damage'));
    return logs;
  }
  const feelNoPain = context.applyFeelNoPain(unit, totalDamage, state);
  logs.push(...feelNoPain.logs);
  totalDamage = feelNoPain.damage;
  const beforeModels = unit.remainingModels - (unit.pendingCasualties ?? 0);
  const beforeWounds = unit.woundedModelIndex !== undefined ? unit.woundsOnLeadModel : unit.pendingWoundAssignment?.woundsOnModel ?? unit.profile.wounds;
  const outcome = resolveDamageOutcome({ damage: totalDamage, modelCount: beforeModels, woundsOnCurrentModel: beforeWounds, woundsPerModel: unit.profile.wounds, noCarryOver: options.noCarryOver });
  const killed = outcome.killedModels;
  const destroyedIndexes = Array.from({ length: killed }, (_, index) => outcome.remainingModels + index);
  const positions = killed ? unit.modelPositions.slice(Math.max(0, outcome.remainingModels)).map(position => ({ ...position })) : [];
  const rosterIndexes = destroyedIndexes.map(index => unit.modelRosterIndexes?.[index] ?? index);
  if (killed) {
    context.queueDeadlyDemise(state, unit, destroyedIndexes, attackerSide);
    context.recordDestroyedModels(state, unit, destroyedIndexes, attackerSide, { destroyedByUnitId: options.sourceUnitId, sourceTags: options.sourceTags });
  }
  unit.remainingModels = outcome.remainingModels;
  unit.woundsOnLeadModel = outcome.remainingModels > 0 ? outcome.woundsOnCurrentModel : 0;
  unit.woundedModelIndex = unit.woundsOnLeadModel > 0 && unit.woundsOnLeadModel < unit.profile.wounds ? 0 : undefined;
  unit.pendingWoundAssignment = undefined;
  if (killed && outcome.remainingModels <= 0) context.rememberDestroyedPositions(unit);
  if (killed) context.trimUnitModelState(unit);
  if (killed) context.queueFightOnDeath(state, unit, attackerSide, positions, rosterIndexes);
  if (killed && outcome.remainingModels <= 0) {
    context.markUnitDestroyed(unit);
    context.recordDestroyedUnit(state, unit, attackerSide, { destroyedByUnitId: options.sourceUnitId, destroyingUnitObjectiveIndexesWithinRange: options.sourceObjectiveIndexesWithinRange, sourceTags: options.sourceTags });
    logs.push(battleLog(state, attackerSide, unit.profile.name, `  💀 ${unit.profile.name} DESTROYED`, 'death'));
    logs.push(...context.emergencyDisembark(state, unit, attackerSide));
  } else if (killed) {
    logs.push(battleLog(state, attackerSide, unit.profile.name, `  ⚠️  ${unit.profile.name}: ${killed} model(s) slain (${unit.remainingModels}/${unit.profile.baseModelCount} remain)`, 'damage'));
  } else if (totalDamage > 0) {
    logs.push(battleLog(state, attackerSide, unit.profile.name, `  🩸 ${unit.profile.name}: ${totalDamage} damage absorbed (${unit.woundsOnLeadModel}W left on lead model)`, 'damage'));
  }
  recordBattleEvent(state, { type: BATTLE_EVENT_TYPE.DamageApplied, side: attackerSide, source: options.sourceUnitId,
    data: { targetUnitId: unit.id, damage: totalDamage, killedModels: killed, remainingModels: unit.remainingModels, woundsOnCurrentModel: unit.woundsOnLeadModel, noCarryOver: options.noCarryOver ?? false, source: options.source ?? 'attack' } });
  return logs;
}
