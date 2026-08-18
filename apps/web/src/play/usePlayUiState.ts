import { useRef, useState } from 'react';
import type { LogEntry } from '@warhammer-simulator/core/types/battle';
import type { PlayModelSelection } from '../components/Battlefield';

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
  const [selectedShootingTargetId, setSelectedShootingTargetId] = useState('');
  const [selectedShootingWeaponIndex, setSelectedShootingWeaponIndex] = useState<'all' | string>('all');
  const [selectedChargeTargetIds, setSelectedChargeTargetIds] = useState<string[]>([]);
  const [selectedFightTargetId, setSelectedFightTargetId] = useState('');
  const [selectedFightWeaponIndex, setSelectedFightWeaponIndex] = useState<'all' | string>('all');
  const [fightAttackSplits, setFightAttackSplits] = useState<Record<string, number>>({});
  const [overwatchUnitId, setOverwatchUnitId] = useState('');
  const [selectedStratagemId, setSelectedStratagemId] = useState('');
  const [selectedAbilityKey, setSelectedAbilityKey] = useState('');
  const [casualtyRemovalShooterId, setCasualtyRemovalShooterId] = useState<string | null>(null);
  const [shootingResultEntries, setShootingResultEntries] = useState<LogEntry[]>([]);
  const [targetErrorMsg, setTargetErrorMsg] = useState<string | null>(null);
  const [inspectedSelection, setInspectedSelection] = useState<InspectedSelection | null>(null);
  const lastShooterIdRef = useRef<string | null>(null);

  function clearPlayUiSelection() {
    setPlayDeploySelection(null);
    setPlayModelSelection(null);
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
      selectedShootingTargetId,
      setSelectedShootingTargetId,
      selectedShootingWeaponIndex,
      setSelectedShootingWeaponIndex,
      selectedChargeTargetIds,
      setSelectedChargeTargetIds,
      selectedFightTargetId,
      setSelectedFightTargetId,
      selectedFightWeaponIndex,
      setSelectedFightWeaponIndex,
      fightAttackSplits,
      setFightAttackSplits,
      overwatchUnitId,
      setOverwatchUnitId,
      casualtyRemovalShooterId,
      setCasualtyRemovalShooterId,
    },
    tactics: {
      selectedStratagemId,
      setSelectedStratagemId,
      selectedAbilityKey,
      setSelectedAbilityKey,
    },
    feedback: {
      shootingResultEntries,
      setShootingResultEntries,
      targetErrorMsg,
      setTargetErrorMsg,
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
    },
  };
}
