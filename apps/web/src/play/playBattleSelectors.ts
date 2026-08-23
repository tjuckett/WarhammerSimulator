import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';

export type TargetOption = { targetIds: string[] };

export function unitForSelection(
  battleState: BattleState | null | undefined,
  unitId: string | null | undefined,
  side?: 0 | 1,
): BattleUnit | null {
  if (!battleState || !unitId) return null;
  return battleState.units.find(unit =>
    unit.id === unitId
    && (side === undefined || unit.side === side)
    && !unit.destroyed
    && !unit.embarkedInUnitId,
  ) ?? null;
}

export function targetIdsForOptions(options: TargetOption[]): Set<string> {
  return new Set(options.flatMap(option => option.targetIds));
}

export function enemyTargetsForIds(
  battleState: BattleState | null | undefined,
  sourceSide: 0 | 1,
  targetIds: Set<string>,
): BattleUnit[] {
  if (!battleState) return [];
  return battleState.units.filter(unit =>
    unit.side !== sourceSide
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && targetIds.has(unit.id),
  );
}
