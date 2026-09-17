import { useCallback, useReducer, type SetStateAction } from 'react';
import {
  fightSessionReducer,
  initialFightSession,
  type FightAllocationTable,
  type FightResolutionStatus,
} from './fightSession';
import type { FightConsolidationMode } from '@warhammer-simulator/core/types/battle';

/** React adapter for the pure Fight workflow reducer. */
export function useFightSession() {
  const [session, dispatch] = useReducer(fightSessionReducer, undefined, initialFightSession);
  const setFightResolutionStatus = useCallback((status: FightResolutionStatus) => dispatch({ type: 'set-resolution-status', status }), []);
  const setSelectedFightTargetId = useCallback((targetId: string) => dispatch({ type: 'set-target', targetId }), []);
  const setSelectedFightMovementTargetIds = useCallback((value: SetStateAction<string[]>) => dispatch({ type: 'set-movement-targets', value }), []);
  const setSelectedFightConsolidationMode = useCallback((mode: FightConsolidationMode | null) => dispatch({ type: 'set-consolidation-mode', mode }), []);
  const setSelectedFightObjectiveIndex = useCallback((objectiveIndex: number | null) => dispatch({ type: 'set-objective-index', objectiveIndex }), []);
  const setSelectedFightWeaponIndex = useCallback((weaponIndex: 'all' | string) => dispatch({ type: 'set-weapon', weaponIndex }), []);
  const setFightAttackSplits = useCallback((value: SetStateAction<Record<string, number>>) => dispatch({ type: 'set-attack-splits', value }), []);
  const setFightAttackAllocations = useCallback((value: SetStateAction<FightAllocationTable>) => dispatch({ type: 'set-attack-allocations', value }), []);
  const clearFightSession = useCallback(() => dispatch({ type: 'clear' }), []);

  return {
    ...session,
    setFightResolutionStatus,
    setSelectedFightTargetId,
    setSelectedFightMovementTargetIds,
    setSelectedFightConsolidationMode,
    setSelectedFightObjectiveIndex,
    setSelectedFightWeaponIndex,
    setFightAttackSplits,
    setFightAttackAllocations,
    clearFightSession,
  };
}
