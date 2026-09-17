import type { SetStateAction } from 'react';
import type { PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import type { ShootingResolutionOrderEntry } from './playAttackAllocations';

export type ShootingAllocationTable = Record<string, Record<string, number>>;
export type ShootingResolutionStatus = 'idle' | 'rolled';
export type ShootingSessionKind = 'idle' | 'declaring' | 'result' | 'allocating-damage';

export type ShootingTargetVisibility = {
  status: 'checking' | 'visible' | 'blocked';
  weaponModelIndexes: Readonly<Record<number, readonly number[]>>;
};

/**
 * The declaration is frozen when the player selects a shooter.  It is UI
 * input, not a rules result: the core still validates the declaration when it
 * is resolved.  Keeping it here means changing weapon tabs never asks the
 * rules engine to rediscover targets or weapons.
 */
export type ShootingDeclarationSnapshot = {
  shooterUnitId: string;
  weaponOptions: PlayShootingWeaponOption[];
  targetIds: string[];
};

/**
 * Framework-free interactive Shooting state. This intentionally stores IDs
 * and declaration choices only; BattleState remains the rules authority.
 */
export type ShootingSession = {
  kind: ShootingSessionKind;
  shooterUnitId: string | null;
  /** Defender currently receiving the typed pending-damage queue. */
  damageAllocationTargetId: string;
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  attackAllocations: ShootingAllocationTable;
  resolutionOrder: ShootingResolutionOrderEntry[];
  declarationSnapshot: ShootingDeclarationSnapshot | null;
  /** Exact LOS/model eligibility requested by the current declaration. */
  targetVisibility: ReadonlyMap<string, ShootingTargetVisibility>;
};

export const initialShootingSession = (): ShootingSession => ({
  kind: 'idle',
  shooterUnitId: null,
  damageAllocationTargetId: '',
  selectedTargetId: '',
  selectedWeaponIndex: 'all',
  attackAllocations: {},
  resolutionOrder: [],
  declarationSnapshot: null,
  targetVisibility: new Map(),
});

export type ShootingSessionEvent =
  | { type: 'begin-declaration'; shooterUnitId: string }
  | { type: 'set-declaration-snapshot'; snapshot: ShootingDeclarationSnapshot }
  | { type: 'set-target-visibility'; value: SetStateAction<ReadonlyMap<string, ShootingTargetVisibility>> }
  | { type: 'set-target'; targetId: string }
  | { type: 'set-weapon'; weaponIndex: 'all' | string }
  | { type: 'set-allocations'; value: SetStateAction<ShootingAllocationTable> }
  | { type: 'set-resolution-order'; value: SetStateAction<ShootingResolutionOrderEntry[]> }
  | { type: 'set-result-status'; status: ShootingResolutionStatus }
  | { type: 'set-shooter'; shooterUnitId: string | null }
  | { type: 'begin-damage-allocation'; shooterUnitId: string; targetUnitId: string }
  | { type: 'set-damage-allocation-target'; targetUnitId: string }
  | { type: 'finish-damage-allocation' }
  | { type: 'clear' };

function applyStateAction<T>(value: SetStateAction<T>, previous: T): T {
  return typeof value === 'function' ? (value as (current: T) => T)(previous) : value;
}

export function shootingSessionReducer(state: ShootingSession, event: ShootingSessionEvent): ShootingSession {
  switch (event.type) {
    case 'begin-declaration':
      return {
        kind: 'declaring',
        shooterUnitId: event.shooterUnitId,
        damageAllocationTargetId: '',
        selectedTargetId: '',
        selectedWeaponIndex: 'all',
        attackAllocations: {},
        resolutionOrder: [],
        declarationSnapshot: null,
        targetVisibility: new Map(),
      };
    case 'set-declaration-snapshot':
      if (state.kind !== 'declaring' || state.shooterUnitId !== event.snapshot.shooterUnitId) return state;
      return sameDeclarationSnapshot(state.declarationSnapshot, event.snapshot)
        ? state
        : { ...state, declarationSnapshot: event.snapshot };
    case 'set-target-visibility': {
      const targetVisibility = applyStateAction(event.value, state.targetVisibility);
      return targetVisibility === state.targetVisibility || sameTargetVisibility(state.targetVisibility, targetVisibility)
        ? state
        : { ...state, targetVisibility };
    }
    case 'set-target':
      return state.selectedTargetId === event.targetId ? state : { ...state, selectedTargetId: event.targetId };
    case 'set-weapon':
      return state.selectedWeaponIndex === event.weaponIndex ? state : { ...state, selectedWeaponIndex: event.weaponIndex };
    case 'set-allocations': {
      const attackAllocations = applyStateAction(event.value, state.attackAllocations);
      return attackAllocations === state.attackAllocations || sameAllocationTable(state.attackAllocations, attackAllocations)
        ? state
        : { ...state, attackAllocations };
    }
    case 'set-resolution-order': {
      const resolutionOrder = applyStateAction(event.value, state.resolutionOrder);
      return resolutionOrder === state.resolutionOrder || sameResolutionOrder(state.resolutionOrder, resolutionOrder)
        ? state
        : { ...state, resolutionOrder };
    }
    case 'set-result-status':
      // A generic result refresh must never replace the active, core-owned
      // allocation cursor with the attacker result view.
      if (state.kind === 'allocating-damage') return state;
      return event.status === 'rolled'
        ? { ...state, kind: 'result' }
        : state.kind === 'result' || state.kind === 'allocating-damage'
          ? { ...state, kind: state.shooterUnitId ? 'declaring' : 'idle' }
          : state;
    case 'set-shooter':
      // Selection lifecycle code clears its shooter cursor in several normal
      // paths. During allocation that cursor is required only to retain the
      // result; it cannot end the defender interaction.
      if (state.kind === 'allocating-damage' && event.shooterUnitId === null) return state;
      return event.shooterUnitId === null && state.kind === 'idle'
        ? state
        : { ...state, shooterUnitId: event.shooterUnitId, kind: event.shooterUnitId ? state.kind : 'idle' };
    case 'begin-damage-allocation':
      return { ...state, kind: 'allocating-damage', shooterUnitId: event.shooterUnitId, damageAllocationTargetId: event.targetUnitId };
    case 'set-damage-allocation-target':
      return state.damageAllocationTargetId === event.targetUnitId
        ? state
        : { ...state, damageAllocationTargetId: event.targetUnitId };
    case 'finish-damage-allocation':
      return state.kind === 'allocating-damage' ? initialShootingSession() : state;
    case 'clear':
      // Generic cleanup is not allocation completion. The player exits the
      // completed result through its explicit Done action instead.
      if (state.kind === 'allocating-damage') return state;
      return isInitialShootingSession(state) ? state : initialShootingSession();
  }
}

export function createShootingDeclarationSnapshot(
  shooterUnitId: string,
  weaponOptions: PlayShootingWeaponOption[],
): ShootingDeclarationSnapshot {
  const copiedWeaponOptions = weaponOptions.map(option => ({
    ...option,
    targetIds: [...option.targetIds],
    targetModelCounts: option.targetModelCounts ? { ...option.targetModelCounts } : undefined,
    targetModelIndexes: option.targetModelIndexes
      ? Object.fromEntries(Object.entries(option.targetModelIndexes).map(([targetId, modelIndexes]) => [targetId, [...modelIndexes]]))
      : undefined,
  }));
  return {
    shooterUnitId,
    weaponOptions: copiedWeaponOptions,
    targetIds: [...new Set(copiedWeaponOptions.flatMap(option => option.targetIds))],
  };
}

function sameDeclarationSnapshot(
  left: ShootingDeclarationSnapshot | null,
  right: ShootingDeclarationSnapshot,
): boolean {
  if (!left || left.shooterUnitId !== right.shooterUnitId || left.weaponOptions.length !== right.weaponOptions.length) return false;
  return left.weaponOptions.every((option, index) => {
    const candidate = right.weaponOptions[index];
    return option.weaponIndex === candidate.weaponIndex
      && option.name === candidate.name
      && option.sourceUnitId === candidate.sourceUnitId
      && option.sourceWeaponIndex === candidate.sourceWeaponIndex
      && option.modelCount === candidate.modelCount
      && option.targetIds.length === candidate.targetIds.length
      && option.targetIds.every((targetId, targetIndex) => targetId === candidate.targetIds[targetIndex]);
  });
}

function sameTargetVisibility(
  left: ReadonlyMap<string, ShootingTargetVisibility>,
  right: ReadonlyMap<string, ShootingTargetVisibility>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [targetId, leftVisibility] of left) {
    const rightVisibility = right.get(targetId);
    if (!rightVisibility || leftVisibility.status !== rightVisibility.status) return false;
    const leftWeaponIndexes = Object.entries(leftVisibility.weaponModelIndexes);
    const rightWeaponIndexes = Object.entries(rightVisibility.weaponModelIndexes);
    if (leftWeaponIndexes.length !== rightWeaponIndexes.length) return false;
    for (const [weaponIndex, leftModelIndexes] of leftWeaponIndexes) {
      const rightModelIndexes = rightVisibility.weaponModelIndexes[Number(weaponIndex)];
      if (!rightModelIndexes || leftModelIndexes.length !== rightModelIndexes.length) return false;
      if (leftModelIndexes.some((modelIndex, index) => modelIndex !== rightModelIndexes[index])) return false;
    }
  }
  return true;
}

function sameAllocationTable(left: ShootingAllocationTable, right: ShootingAllocationTable): boolean {
  const leftWeaponIds = Object.keys(left);
  const rightWeaponIds = Object.keys(right);
  if (leftWeaponIds.length !== rightWeaponIds.length) return false;
  return leftWeaponIds.every(weaponId => {
    const leftTargets = left[weaponId];
    const rightTargets = right[weaponId];
    if (!rightTargets) return false;
    const leftTargetIds = Object.keys(leftTargets);
    const rightTargetIds = Object.keys(rightTargets);
    return leftTargetIds.length === rightTargetIds.length
      && leftTargetIds.every(targetId => leftTargets[targetId] === rightTargets[targetId]);
  });
}

function sameResolutionOrder(left: ShootingResolutionOrderEntry[], right: ShootingResolutionOrderEntry[]): boolean {
  return left.length === right.length
    && left.every((entry, index) => entry.weaponIndex === right[index]?.weaponIndex
      && entry.targetUnitId === right[index]?.targetUnitId);
}

function isInitialShootingSession(session: ShootingSession): boolean {
  return session.kind === 'idle'
    && session.shooterUnitId === null
    && session.selectedTargetId === ''
    && session.selectedWeaponIndex === 'all'
    && !Object.keys(session.attackAllocations).length
    && !session.resolutionOrder.length
    && session.declarationSnapshot === null
    && !session.targetVisibility.size;
}

export function shootingSessionResolutionStatus(session: ShootingSession): ShootingResolutionStatus {
  return session.kind === 'result' || session.kind === 'allocating-damage' ? 'rolled' : 'idle';
}
