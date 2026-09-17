import type { PlayMeleeAttackAllocation, PlayShootingAttackAllocation } from '@warhammer-simulator/core/engine/simulator';

type AllocationTable = Record<string, Record<string, number>>;

export type ShootingResolutionOrderEntry = {
  weaponIndex: number;
  targetUnitId: string;
};

export function updateAttackAllocation(
  current: AllocationTable,
  weaponIndex: number,
  targetId: string,
  attacks: number,
  maxModels: number | null,
): AllocationTable {
  const weaponKey = String(weaponIndex);
  const weaponAllocations = current[weaponKey] ?? {};
  const otherTargetTotal = Object.entries(weaponAllocations)
    .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
    .reduce((total, [, allocatedModels]) => total + (Number(allocatedModels) || 0), 0);
  const cappedAttacks = maxModels === null
    ? attacks
    : Math.min(attacks, Math.max(0, maxModels - otherTargetTotal));
  return {
    ...current,
    [weaponKey]: {
      ...weaponAllocations,
      [targetId]: cappedAttacks,
    },
  };
}

export function updateMeleeAttackAllocation(
  current: AllocationTable,
  weaponIndex: number,
  targetId: string,
  attacks: number,
): AllocationTable {
  const weaponKey = String(weaponIndex);
  return {
    ...current,
    [weaponKey]: {
      ...(current[weaponKey] ?? {}),
      [targetId]: attacks,
    },
  };
}

export function buildShootingAttackAllocations(
  allocations: AllocationTable,
  resolutionOrder: ShootingResolutionOrderEntry[] = [],
): PlayShootingAttackAllocation[] {
  const entries = Object.entries(allocations).flatMap(([weaponIndexText, targets]) => {
    const weaponIndex = Number(weaponIndexText);
    const entries = Object.entries(targets).filter(([, attackCount]) => attackCount > 0);
    return entries.map(([targetUnitId, attackCount]) => ({
      weaponIndex,
      targetUnitId,
      ...(entries.length > 1 ? { modelCount: attackCount } : {}),
    }));
  });
  if (!resolutionOrder.length) return entries;
  const orderIndex = new Map(resolutionOrder.map((entry, index) => [`${entry.weaponIndex}:${entry.targetUnitId}`, index]));
  return [...entries].sort((left, right) => {
    const leftOrder = orderIndex.get(`${left.weaponIndex}:${left.targetUnitId}`) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderIndex.get(`${right.weaponIndex}:${right.targetUnitId}`) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

export function syncShootingResolutionOrder(
  allocations: AllocationTable,
  current: ShootingResolutionOrderEntry[],
): ShootingResolutionOrderEntry[] {
  const entries = buildShootingAttackAllocations(allocations);
  const validKeys = new Set(entries.map(entry => `${entry.weaponIndex}:${entry.targetUnitId}`));
  const retained = current.filter(entry => validKeys.has(`${entry.weaponIndex}:${entry.targetUnitId}`));
  const retainedKeys = new Set(retained.map(entry => `${entry.weaponIndex}:${entry.targetUnitId}`));
  return [
    ...retained,
    ...entries
      .filter(entry => !retainedKeys.has(`${entry.weaponIndex}:${entry.targetUnitId}`))
      .map(entry => ({ weaponIndex: entry.weaponIndex, targetUnitId: entry.targetUnitId })),
  ];
}

export function moveShootingResolutionOrderEntry(
  current: ShootingResolutionOrderEntry[],
  entry: ShootingResolutionOrderEntry,
  direction: -1 | 1,
): ShootingResolutionOrderEntry[] {
  const index = current.findIndex(candidate => candidate.weaponIndex === entry.weaponIndex && candidate.targetUnitId === entry.targetUnitId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
  const next = [...current];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

export function buildMeleeAttackAllocations(allocations: AllocationTable): PlayMeleeAttackAllocation[] {
  return Object.entries(allocations).flatMap(([weaponIndexText, targets]) => {
    const weaponIndex = Number(weaponIndexText);
    const entries = Object.entries(targets).filter(([, attacks]) => attacks > 0);
    return entries.map(([targetUnitId, modelCount]) => ({
      weaponIndex,
      targetUnitId,
      modelCount,
    }));
  });
}
