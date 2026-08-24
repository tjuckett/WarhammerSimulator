import type { BattleState, BattleUnit, LogEntry, Side } from '../types/battle';
import type { ModelBaseFootprint } from './baseSizes';

export interface DeadlyDemiseContext {
  d6(): number;
  rollExpression(expression: string): { total: number };
  log(state: BattleState, side: Side, source: string, message: string, type: LogEntry['type']): LogEntry;
  modelFootprint(unit: BattleUnit, modelIndex: number): ModelBaseFootprint;
  baseFootprintDistance(
    aPosition: BattleUnit['position'],
    aFootprint: ModelBaseFootprint,
    bPosition: BattleUnit['position'],
    bFootprint: ModelBaseFootprint,
  ): number;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  attachedUnitId(unit: BattleUnit): string;
  applyDamage(unit: BattleUnit, damage: number, state: BattleState, attackerSide: Side, options: { source?: string; sourceUnitId?: string }): LogEntry[];
}

function deadlyDemiseExpression(unit: BattleUnit): string | null {
  for (const rule of [...unit.profile.abilities, ...(unit.profile.rules ?? [])]) {
    const match = `${rule.name} ${rule.description}`.match(/Deadly\s+Demise\s+((?:\d+)?D\d+(?:[+-]\d+)?|\d+)/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

export function queueDeadlyDemiseForModels(
  state: BattleState,
  unit: BattleUnit,
  modelIndices: number[],
  destroyedBySide: Side,
  context: DeadlyDemiseContext,
): void {
  const mortalWounds = deadlyDemiseExpression(unit);
  if (!mortalWounds) return;
  const queued = state.pendingDeadlyDemises ?? [];
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    if (!position) continue;
    queued.push({
      id: `deadly-demise:${unit.id}:${unit.modelRosterIndexes?.[modelIndex] ?? modelIndex}:${queued.length}`,
      sourceUnitId: unit.id,
      sourceUnitName: unit.profile.name,
      sourceSide: unit.side,
      destroyedBySide,
      position: { ...position },
      footprint: { ...context.modelFootprint(unit, modelIndex) },
      mortalWounds,
    });
  }
  state.pendingDeadlyDemises = queued;
}

function unitWithinDeadlyDemiseRange(
  state: BattleState,
  unit: BattleUnit,
  pending: NonNullable<BattleState['pendingDeadlyDemises']>[number],
  context: DeadlyDemiseContext,
): boolean {
  return context.attachedComponents(state, unit).some(component => component.modelPositions.some((position, modelIndex) => {
    const horizontal = context.baseFootprintDistance(pending.position, pending.footprint, position, context.modelFootprint(component, modelIndex));
    return Math.hypot(horizontal, (pending.position.z ?? 0) - (position.z ?? 0)) <= 6;
  }));
}

export function resolvePendingDeadlyDemisesInPlace(state: BattleState, context: DeadlyDemiseContext): LogEntry[] {
  const logs: LogEntry[] = [];
  while (state.pendingDeadlyDemises?.length) {
    const pending = state.pendingDeadlyDemises.shift()!;
    const triggerRoll = context.d6();
    logs.push(context.log(state, pending.sourceSide, pending.sourceUnitName,
      `${pending.sourceUnitName} Deadly Demise roll: ${triggerRoll}${triggerRoll === 6 ? ' - deadly demise!' : ' - no effect'}.`, 'roll'));
    if (triggerRoll !== 6) continue;
    const handled = new Set<string>();
    const targets = state.units.filter(unit => {
      if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || !unit.modelPositions.length) return false;
      const id = context.attachedUnitId(unit);
      if (handled.has(id)) return false;
      handled.add(id);
      return unitWithinDeadlyDemiseRange(state, unit, pending, context);
    });
    for (const target of targets) {
      const damage = context.rollExpression(pending.mortalWounds).total;
      logs.push(context.log(state, pending.sourceSide, pending.sourceUnitName,
        `${target.profile.name} suffers ${damage} mortal wound${damage === 1 ? '' : 's'} from Deadly Demise.`, 'damage'));
      logs.push(...context.applyDamage(target, damage, state, pending.destroyedBySide, {
        source: `Deadly Demise (${pending.sourceUnitName})`, sourceUnitId: pending.sourceUnitId,
      }));
    }
  }
  state.pendingDeadlyDemises = undefined;
  return logs;
}
