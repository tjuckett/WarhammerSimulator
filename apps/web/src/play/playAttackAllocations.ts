import type { PlayMeleeAttackAllocation, PlayShootingAttackAllocation } from '@warhammer-simulator/core/engine/simulator';

type AllocationTable = Record<string, Record<string, number>>;

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

export function buildShootingAttackAllocations(allocations: AllocationTable): PlayShootingAttackAllocation[] {
  return Object.entries(allocations).flatMap(([weaponIndexText, targets]) => {
    const weaponIndex = Number(weaponIndexText);
    const entries = Object.entries(targets).filter(([, attackCount]) => attackCount > 0);
    return entries.map(([targetUnitId, attackCount]) => ({
      weaponIndex,
      targetUnitId,
      ...(entries.length > 1 ? { modelCount: attackCount } : {}),
    }));
  });
}

export function buildMeleeAttackAllocations(allocations: AllocationTable): PlayMeleeAttackAllocation[] {
  return Object.entries(allocations).flatMap(([weaponIndexText, targets]) => {
    const weaponIndex = Number(weaponIndexText);
    const entries = Object.entries(targets).filter(([, attacks]) => attacks > 0);
    return entries.map(([targetUnitId, attacks]) => ({
      weaponIndex,
      targetUnitId,
      ...(entries.length > 1 ? { attackCount: attacks } : {}),
    }));
  });
}
