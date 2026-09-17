import { useCallback, useReducer, type SetStateAction } from 'react';
import {
  initialShootingSession,
  createShootingDeclarationSnapshot,
  shootingSessionReducer,
  shootingSessionResolutionStatus,
  type ShootingAllocationTable,
  type ShootingResolutionStatus,
  type ShootingTargetVisibility,
} from './shootingSession';
import type { PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import type { ShootingResolutionOrderEntry } from './playAttackAllocations';

/** React adapter around the pure Shooting session reducer. */
export function useShootingSession() {
  const [session, dispatch] = useReducer(shootingSessionReducer, undefined, initialShootingSession);
  const beginShootingDeclaration = useCallback((shooterUnitId: string) => {
    dispatch({ type: 'begin-declaration', shooterUnitId });
  }, []);
  const clearShootingSession = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);
  const setShootingDeclarationSnapshot = useCallback((shooterUnitId: string, weaponOptions: PlayShootingWeaponOption[]) => {
    dispatch({ type: 'set-declaration-snapshot', snapshot: createShootingDeclarationSnapshot(shooterUnitId, weaponOptions) });
  }, []);
  const setShootingTargetVisibility = useCallback((value: SetStateAction<ReadonlyMap<string, ShootingTargetVisibility>>) => {
    dispatch({ type: 'set-target-visibility', value });
  }, []);
  const setSelectedShootingTargetId = useCallback((targetId: string) => {
    dispatch({ type: 'set-target', targetId });
  }, []);
  const setSelectedShootingWeaponIndex = useCallback((weaponIndex: 'all' | string) => {
    dispatch({ type: 'set-weapon', weaponIndex });
  }, []);
  const setShootingAttackAllocations = useCallback((value: SetStateAction<ShootingAllocationTable>) => {
    dispatch({ type: 'set-allocations', value });
  }, []);
  const setShootingResolutionOrder = useCallback((value: SetStateAction<ShootingResolutionOrderEntry[]>) => {
    dispatch({ type: 'set-resolution-order', value });
  }, []);
  const setShootingResolutionStatus = useCallback((status: ShootingResolutionStatus) => {
    dispatch({ type: 'set-result-status', status });
  }, []);
  const setCasualtyRemovalShooterId = useCallback((shooterUnitId: string | null) => {
    dispatch({ type: 'set-shooter', shooterUnitId });
  }, []);
  const beginShootingDamageAllocation = useCallback((shooterUnitId: string, targetUnitId: string) => {
    dispatch({ type: 'begin-damage-allocation', shooterUnitId, targetUnitId });
  }, []);
  const setDamageAllocationTargetId = useCallback((targetUnitId: string) => {
    dispatch({ type: 'set-damage-allocation-target', targetUnitId });
  }, []);
  const finishShootingDamageAllocation = useCallback(() => {
    dispatch({ type: 'finish-damage-allocation' });
  }, []);

  return {
    session,
    beginShootingDeclaration,
    clearShootingSession,
    beginShootingDamageAllocation,
    setDamageAllocationTargetId,
    finishShootingDamageAllocation,
    setShootingDeclarationSnapshot,
    shootingSessionKind: session.kind,
    shootingDeclarationSnapshot: session.declarationSnapshot,
    shootingTargetVisibility: session.targetVisibility,
    setShootingTargetVisibility,
    selectedShootingTargetId: session.selectedTargetId,
    setSelectedShootingTargetId,
    selectedShootingWeaponIndex: session.selectedWeaponIndex,
    setSelectedShootingWeaponIndex,
    shootingAttackAllocations: session.attackAllocations,
    setShootingAttackAllocations,
    shootingResolutionOrder: session.resolutionOrder,
    setShootingResolutionOrder,
    casualtyRemovalShooterId: session.shooterUnitId,
    damageAllocationTargetId: session.damageAllocationTargetId,
    setCasualtyRemovalShooterId,
    shootingResolutionStatus: shootingSessionResolutionStatus(session),
    setShootingResolutionStatus,
  };
}
