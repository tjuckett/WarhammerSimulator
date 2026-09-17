import type { BattleState } from '@warhammer-simulator/core/types/battle';
import { fightPlayUnitWeapon, fightPlayUnitWeapons } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { buildMeleeAttackAllocations } from './playAttackAllocations';
import { primaryPlaySelectionPart } from './playSelectionHelpers';
import { sanitizeMeleeAttackAllocation } from './playUiHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';
import { measurePerformanceTrace } from '../performance/performanceTrace';

type StateRef = { current: BattleState | null };
type AllocationTable = Record<string, Record<string, number>>;

export function createPlayFightResolution({
  battleStateRef,
  playModelSelection,
  damageAllocationLocked,
  fightResolutionStatus,
  fightAttackAllocations,
  selectedFightWeaponIndex,
  selectedPlayFightOptions,
  selectedPlayFightTargets,
  fightAttackSplits,
  selectedFightAttackCount,
  selectedFightTargetId,
  activeRulesForBattle,
  playUndoEntry,
  pushPlayUndo,
  selectPendingDamageUnit,
  selectShootingResolutionTarget,
  commitBattleState,
  setTargetErrorMsg,
  setFightResolutionStatus,
  setSelectedFightWeaponIndex,
  setFightResultWeaponOptions,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  damageAllocationLocked: boolean;
  fightResolutionStatus: 'idle' | 'rolled';
  fightAttackAllocations: AllocationTable;
  selectedFightWeaponIndex: 'all' | string;
  selectedPlayFightOptions: Array<{
    weaponIndex: number;
    name: string;
    targetIds: string[];
    sourceUnitId?: string;
    sourceWeaponIndex?: number;
    modelCount?: number;
    weapon?: { name: string; profileGroup?: string; keywords: string[] };
  }>;
  selectedPlayFightTargets: Array<{ id: string }>;
  fightAttackSplits: Record<string, number>;
  selectedFightAttackCount: number | null;
  selectedFightTargetId: string;
  activeRulesForBattle: Parameters<typeof fightPlayUnitWeapon>[5];
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  selectPendingDamageUnit: (state: BattleState, shooterUnitId: string | null) => boolean;
  selectShootingResolutionTarget: (state: BattleState, shooterUnitId: string | null, targetUnitId?: string) => boolean;
  commitBattleState: (state: BattleState) => void;
  setTargetErrorMsg: (message: string | null) => void;
  setFightResolutionStatus: (status: 'idle' | 'rolled') => void;
  setSelectedFightWeaponIndex: (weaponIndex: 'all' | string) => void;
  setFightResultWeaponOptions: (options: typeof selectedPlayFightOptions) => void;
}) {
  function resolveSelectedPlayFight() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    if (!damageAllocationLocked && fightResolutionStatus === 'rolled') {
      // A defender review is still meaningful when every wound was saved (or
      // every point of damage was ignored). The typed resolution owns those
      // dice; do not discard it merely because no damage packet was created.
      const resolution = prev.lastShootingResolution?.shooterUnitId === selection.unitId
        ? prev.lastShootingResolution
        : null;
      const firstTargetId = resolution?.weapons[0]?.targetUnitId;
      if (firstTargetId && selectShootingResolutionTarget(prev, selection.unitId, firstTargetId)) {
        setTargetErrorMsg(null);
        return;
      }
      setFightResolutionStatus('idle');
      setTargetErrorMsg(null);
      return;
    }
    if (damageAllocationLocked) {
      if (fightResolutionStatus === 'rolled' && selectPendingDamageUnit(prev, selection.unitId)) {
        // The first press after a Fight result explicitly leaves the attacker
        // review and opens allocation on the defender. Do not do this when
        // the dice are rolled: the result tabs must be visible first.
        selectShootingResolutionTarget(prev, selection.unitId);
        return;
      }
      setTargetErrorMsg('Allocate pending damage before fighting again');
      return;
    }
    // A displayed 0/0 row is a real weapon profile whose carrier is not in
    // Engagement Range. It is informative, but cannot make the whole unit's
    // otherwise legal Fight declaration invalid.
    const meleeAllocations = buildMeleeAttackAllocations(fightAttackAllocations)
      .filter(allocation => (selectedPlayFightOptions.find(option =>
        option.weaponIndex === allocation.weaponIndex,
      )?.modelCount ?? 0) > 0);
    if (meleeAllocations.length) {
      // An attached Leader/bodyguard group is one Fight selection. The core
      // resolves each component against its own model loadout, while this
      // popup assigns and presents every component's weapons together.
      const allocationGroups = new Map<string, typeof meleeAllocations>();
      for (const allocation of meleeAllocations) {
        const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
        const sourceUnitId = option?.sourceUnitId ?? selection.unitId;
        const group = allocationGroups.get(sourceUnitId) ?? [];
        group.push({ ...allocation, weaponIndex: option?.sourceWeaponIndex ?? allocation.weaponIndex });
        allocationGroups.set(sourceUnitId, group);
      }
      const next = measurePerformanceTrace('fight-resolution-core', () => {
        let resolved = prev;
        const mergedWeapons: NonNullable<BattleState['lastShootingResolution']>['weapons'] = [];
        for (const [sourceUnitId, allocations] of allocationGroups) {
          const afterComponent = fightPlayUnitWeapons(resolved, sourceUnitId, selection.side, allocations, activeRulesForBattle);
          if (afterComponent === resolved) return prev;
          for (const result of afterComponent.lastShootingResolution?.weapons ?? []) {
            const displayOption = selectedPlayFightOptions.find(option =>
              (option.sourceUnitId ?? selection.unitId) === sourceUnitId
              && (option.sourceWeaponIndex ?? option.weaponIndex) === result.weaponIndex);
            mergedWeapons.push({ ...result, weaponIndex: displayOption?.weaponIndex ?? result.weaponIndex });
          }
          resolved = afterComponent;
        }
        if (resolved !== prev && resolved.lastShootingResolution) {
          resolved.lastShootingResolution = {
            ...resolved.lastShootingResolution,
            shooterUnitId: selection.unitId,
            weapons: mergedWeapons,
          };
        }
        return resolved;
      }, { unitId: selection.unitId, weaponIndex: 'all' });
      if (next === prev) {
        const profileGroupFor = (option: typeof selectedPlayFightOptions[number]) => {
          const weapon = option.weapon;
          const explicit = weapon?.profileGroup?.trim().toLowerCase();
          if (explicit) return explicit;
          return `weapon:${option.weaponIndex}`;
        };
        const declaredProfileGroups = new Set(meleeAllocations.map(allocation => {
          const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
          return option ? `${option.sourceUnitId ?? selection.unitId}:${profileGroupFor(option)}` : '';
        }));
        const unallocatedWeapons = selectedPlayFightOptions
          .filter(option => (option.modelCount ?? 0) > 0)
          .filter(option => {
            if (meleeAllocations.some(allocation => allocation.weaponIndex === option.weaponIndex)) return false;
            const isExtraAttacks = option.weapon?.keywords.some(keyword => keyword.toLowerCase() === 'extra attacks');
            // One normal profile from each physical weapon is enough. Only
            // Extra Attacks weapons remain mandatory alongside that choice.
            return isExtraAttacks || !declaredProfileGroups.has(`${option.sourceUnitId ?? selection.unitId}:${profileGroupFor(option)}`);
          })
          .map(option => `${option.name} (${option.modelCount}/${option.modelCount} needed)`);
        const invalidTargetWeapons = meleeAllocations.flatMap(allocation => {
          const option = selectedPlayFightOptions.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
          return option && !option.targetIds.includes(allocation.targetUnitId)
            ? [`${option.name} targets an ineligible unit`]
            : [];
        });
        const details = [...unallocatedWeapons, ...invalidTargetWeapons];
        setTargetErrorMsg(details.length
          ? `Cannot roll: ${details.join('; ')}.`
          : 'Cannot roll: the current melee allocations were rejected by the Fight rules.');
        return;
      }
      // The core marks the fighter activated, so live option discovery is
      // intentionally empty after this point. Preserve the declared options
      // for the result-review tabs, especially virtual indices from attached
      // Leader/bodyguard components.
      setFightResultWeaponOptions(selectedPlayFightOptions);
      setFightResolutionStatus('rolled');
      setTargetErrorMsg(null);
      pushPlayUndo(playUndoEntry(prev), next, {
        type: GAME_ACTION_TYPE.FightUnitWeapon,
        unitId: selection.unitId,
        side: selection.side,
        targetUnitId: meleeAllocations[0].targetUnitId,
        weaponIndex: 'all',
      });
      commitBattleState(next);
      return;
    }
    const weaponIndex = selectedFightWeaponIndex === 'all' ? 'all' : Number(selectedFightWeaponIndex);
    if (weaponIndex !== 'all' && !Number.isFinite(weaponIndex)) return;
    const targetSplits = selectedPlayFightTargets.flatMap(target => {
      const attacks = sanitizeMeleeAttackAllocation(fightAttackSplits[target.id] ?? 0);
      return attacks > 0 ? [{ targetUnitId: target.id, attacks }] : [];
    });
    const splitTotal = targetSplits.reduce((total, split) => total + split.attacks, 0);
    const usesSplit = selectedPlayFightTargets.length > 1 && targetSplits.length > 0;
    if (usesSplit && (selectedFightAttackCount === null || splitTotal !== selectedFightAttackCount)) {
      setTargetErrorMsg(`Allocate exactly ${selectedFightAttackCount ?? 'the fixed number of'} attacks before resolving`);
      return;
    }
    const targetUnitId = usesSplit ? targetSplits[0].targetUnitId : selectedFightTargetId;
    if (!targetUnitId) return;
    const next = measurePerformanceTrace(
      'fight-resolution-core',
      () => fightPlayUnitWeapon(prev, selection.unitId, selection.side, targetUnitId, weaponIndex, activeRulesForBattle, usesSplit ? targetSplits : undefined),
      { unitId: selection.unitId, weaponIndex: String(weaponIndex) },
    );
    if (next === prev) return;
    setFightResultWeaponOptions(selectedPlayFightOptions);
    setFightResolutionStatus('rolled');
    setTargetErrorMsg(null);
    if (weaponIndex !== 'all') setSelectedFightWeaponIndex('all');
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.FightUnitWeapon,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId,
      weaponIndex,
      ...(usesSplit ? { targetSplits } : {}),
    });
    commitBattleState(next);
  }

  return { resolveSelectedPlayFight };
}
