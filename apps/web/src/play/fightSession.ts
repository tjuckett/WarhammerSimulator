import type { SetStateAction } from 'react';
import type { FightConsolidationMode } from '@warhammer-simulator/core/types/battle';

export type FightResolutionStatus = 'idle' | 'rolled';
export type FightAllocationTable = Record<string, Record<string, number>>;

/** UI-only workflow state for Fight. BattleState remains the rules authority. */
export type FightSession = {
  resolutionStatus: FightResolutionStatus;
  selectedTargetId: string;
  selectedMovementTargetIds: string[];
  consolidationMode: FightConsolidationMode | null;
  objectiveIndex: number | null;
  selectedWeaponIndex: 'all' | string;
  attackSplits: Record<string, number>;
  attackAllocations: FightAllocationTable;
};

export const initialFightSession = (): FightSession => ({
  resolutionStatus: 'idle',
  selectedTargetId: '',
  selectedMovementTargetIds: [],
  consolidationMode: null,
  objectiveIndex: null,
  selectedWeaponIndex: 'all',
  attackSplits: {},
  attackAllocations: {},
});

export type FightSessionEvent =
  | { type: 'set-resolution-status'; status: FightResolutionStatus }
  | { type: 'set-target'; targetId: string }
  | { type: 'set-movement-targets'; value: SetStateAction<string[]> }
  | { type: 'set-consolidation-mode'; mode: FightConsolidationMode | null }
  | { type: 'set-objective-index'; objectiveIndex: number | null }
  | { type: 'set-weapon'; weaponIndex: 'all' | string }
  | { type: 'set-attack-splits'; value: SetStateAction<Record<string, number>> }
  | { type: 'set-attack-allocations'; value: SetStateAction<FightAllocationTable> }
  | { type: 'clear' };

function applyStateAction<T>(value: SetStateAction<T>, previous: T): T {
  return typeof value === 'function' ? (value as (current: T) => T)(previous) : value;
}

export function fightSessionReducer(state: FightSession, event: FightSessionEvent): FightSession {
  switch (event.type) {
    case 'set-resolution-status':
      return state.resolutionStatus === event.status ? state : { ...state, resolutionStatus: event.status };
    case 'set-target':
      return state.selectedTargetId === event.targetId ? state : { ...state, selectedTargetId: event.targetId };
    case 'set-movement-targets': {
      const selectedMovementTargetIds = applyStateAction(event.value, state.selectedMovementTargetIds);
      return selectedMovementTargetIds === state.selectedMovementTargetIds || sameStringArray(state.selectedMovementTargetIds, selectedMovementTargetIds)
        ? state
        : { ...state, selectedMovementTargetIds };
    }
    case 'set-consolidation-mode':
      return state.consolidationMode === event.mode ? state : { ...state, consolidationMode: event.mode };
    case 'set-objective-index':
      return state.objectiveIndex === event.objectiveIndex ? state : { ...state, objectiveIndex: event.objectiveIndex };
    case 'set-weapon':
      return state.selectedWeaponIndex === event.weaponIndex ? state : { ...state, selectedWeaponIndex: event.weaponIndex };
    case 'set-attack-splits': {
      const attackSplits = applyStateAction(event.value, state.attackSplits);
      return attackSplits === state.attackSplits || sameNumberRecord(state.attackSplits, attackSplits)
        ? state
        : { ...state, attackSplits };
    }
    case 'set-attack-allocations': {
      const attackAllocations = applyStateAction(event.value, state.attackAllocations);
      return attackAllocations === state.attackAllocations || sameAllocationTable(state.attackAllocations, attackAllocations)
        ? state
        : { ...state, attackAllocations };
    }
    case 'clear':
      return isInitialFightSession(state) ? state : initialFightSession();
  }
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumberRecord(left: Record<string, number>, right: Record<string, number>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => left[key] === right[key]);
}

function sameAllocationTable(left: FightAllocationTable, right: FightAllocationTable): boolean {
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

function isInitialFightSession(session: FightSession): boolean {
  return session.resolutionStatus === 'idle'
    && session.selectedTargetId === ''
    && !session.selectedMovementTargetIds.length
    && session.consolidationMode === null
    && session.objectiveIndex === null
    && session.selectedWeaponIndex === 'all'
    && !Object.keys(session.attackSplits).length
    && !Object.keys(session.attackAllocations).length;
}
