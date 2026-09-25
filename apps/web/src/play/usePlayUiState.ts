import { useCallback, useRef, useState } from 'react';
import type { PlayModelSelection } from '../components/Battlefield';
import { useShootingSession } from './useShootingSession';
import { useFightSession } from './useFightSession';

export type DamageAllocationOutcome = {
  targetUnitId: string;
  modelIndex: number;
  damage: number;
  killedModels: number;
  feelNoPain?: { target: number; rolls: number[]; ignored: number };
};

export const PLAY_DEPLOY_SELECTION_KIND = {
  Deployment: 'deployment',
  Reinforcement: 'reinforcement',
  StrategicReserve: 'strategicReserve',
} as const;

export type PlayDeploySelection =
  | { kind: typeof PLAY_DEPLOY_SELECTION_KIND.Deployment; side: 0 | 1; unitIndex: number }
  | { kind: typeof PLAY_DEPLOY_SELECTION_KIND.Reinforcement; side: 0 | 1; armyUnitIndex: number }
  | { kind: typeof PLAY_DEPLOY_SELECTION_KIND.StrategicReserve; side: 0 | 1; unitId: string };

export type InspectedSelection =
  | { kind: 'battle'; side: 0 | 1; unitId: string }
  | { kind: 'profile'; side: 0 | 1; unitIndex: number };

export function usePlayUiState() {
  const [playDeploySelection, setPlayDeploySelection] = useState<PlayDeploySelection | null>(null);
  const [playModelSelection, setPlayModelSelection] = useState<PlayModelSelection | null>(null);
  const shooting = useShootingSession();
  const fight = useFightSession();
  const [selectedChargeTargetIds, setSelectedChargeTargetIds] = useState<string[]>([]);
  const [overwatchUnitId, setOverwatchUnitId] = useState('');
  const [selectedStratagemId, setSelectedStratagemId] = useState('');
  const [selectedAbilityKey, setSelectedAbilityKey] = useState('');
  const [targetErrorMsg, setTargetErrorMsg] = useState<string | null>(null);
  const [damageAllocationOutcome, setDamageAllocationOutcome] = useState<DamageAllocationOutcome | null>(null);
  const [inspectedSelection, setInspectedSelection] = useState<InspectedSelection | null>(null);
  const lastShooterIdRef = useRef<string | null>(null);
  const clearShootingSession = useCallback(() => {
    setDamageAllocationOutcome(null);
    shooting.clearShootingSession();
  }, [shooting]);
  const beginShootingDamageAllocation = useCallback((shooterUnitId: string, targetUnitId: string) => {
    setDamageAllocationOutcome(null);
    shooting.beginShootingDamageAllocation(shooterUnitId, targetUnitId);
  }, [shooting]);
  const finishShootingDamageAllocation = useCallback(() => {
    setDamageAllocationOutcome(null);
    shooting.finishShootingDamageAllocation();
  }, [shooting]);

  function clearPlayUiSelection() {
    setPlayDeploySelection(null);
    setPlayModelSelection(null);
    setSelectedChargeTargetIds([]);
    setInspectedSelection(null);
  }

  return {
    deployment: {
      playDeploySelection,
      setPlayDeploySelection,
    },
    models: {
      playModelSelection,
      setPlayModelSelection,
    },
    targeting: {
      selectedShootingTargetId: shooting.selectedShootingTargetId,
      setSelectedShootingTargetId: shooting.setSelectedShootingTargetId,
      selectedShootingWeaponIndex: shooting.selectedShootingWeaponIndex,
      setSelectedShootingWeaponIndex: shooting.setSelectedShootingWeaponIndex,
      shootingDeclarationSnapshot: shooting.shootingDeclarationSnapshot,
      shootingTargetVisibility: shooting.shootingTargetVisibility,
      setShootingTargetVisibility: shooting.setShootingTargetVisibility,
      shootingAttackAllocations: shooting.shootingAttackAllocations,
      setShootingAttackAllocations: shooting.setShootingAttackAllocations,
      shootingResolutionOrder: shooting.shootingResolutionOrder,
      setShootingResolutionOrder: shooting.setShootingResolutionOrder,
      selectedChargeTargetIds,
      setSelectedChargeTargetIds,
      selectedFightTargetId: fight.selectedTargetId,
      setSelectedFightTargetId: fight.setSelectedFightTargetId,
      selectedFightMovementTargetIds: fight.selectedMovementTargetIds,
      setSelectedFightMovementTargetIds: fight.setSelectedFightMovementTargetIds,
      selectedFightConsolidationMode: fight.consolidationMode,
      setSelectedFightConsolidationMode: fight.setSelectedFightConsolidationMode,
      selectedFightObjectiveIndex: fight.objectiveIndex,
      setSelectedFightObjectiveIndex: fight.setSelectedFightObjectiveIndex,
      selectedFightWeaponIndex: fight.selectedWeaponIndex,
      setSelectedFightWeaponIndex: fight.setSelectedFightWeaponIndex,
      fightAttackSplits: fight.attackSplits,
      setFightAttackSplits: fight.setFightAttackSplits,
      fightAttackAllocations: fight.attackAllocations,
      setFightAttackAllocations: fight.setFightAttackAllocations,
      overwatchUnitId,
      setOverwatchUnitId,
      casualtyRemovalShooterId: shooting.casualtyRemovalShooterId,
      setCasualtyRemovalShooterId: shooting.setCasualtyRemovalShooterId,
      damageAllocationTargetId: shooting.damageAllocationTargetId,
      setDamageAllocationTargetId: shooting.setDamageAllocationTargetId,
    },
    tactics: {
      selectedStratagemId,
      setSelectedStratagemId,
      selectedAbilityKey,
      setSelectedAbilityKey,
    },
    feedback: {
      shootingResolutionStatus: shooting.shootingResolutionStatus,
      setShootingResolutionStatus: shooting.setShootingResolutionStatus,
      fightResolutionStatus: fight.resolutionStatus,
      setFightResolutionStatus: fight.setFightResolutionStatus,
      targetErrorMsg,
      setTargetErrorMsg,
      damageAllocationOutcome,
      setDamageAllocationOutcome,
    },
    inspection: {
      inspectedSelection,
      setInspectedSelection,
    },
    refs: {
      lastShooterIdRef,
    },
    actions: {
      clearPlayUiSelection,
      beginShootingDeclaration: shooting.beginShootingDeclaration,
      clearShootingSession,
      beginShootingDamageAllocation,
      finishShootingDamageAllocation,
      setShootingDeclarationSnapshot: shooting.setShootingDeclarationSnapshot,
      shootingSessionKind: shooting.shootingSessionKind,
      clearFightSession: fight.clearFightSession,
    },
  };
}
