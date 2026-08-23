import type { BattleState, LogEntry } from '@warhammer-simulator/core/types/battle';
import { fightPlayUnitWeapon, fightPlayUnitWeapons } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { buildMeleeAttackAllocations } from './playAttackAllocations';
import { primaryPlaySelectionPart } from './playSelectionHelpers';
import { sanitizeMeleeAttackAllocation } from './playUiHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };
type AllocationTable = Record<string, Record<string, number>>;

export function createPlayFightResolution({
  battleStateRef,
  playModelSelection,
  damageAllocationLocked,
  fightAttackAllocations,
  selectedFightWeaponIndex,
  selectedPlayFightTargets,
  fightAttackSplits,
  selectedFightAttackCount,
  selectedFightTargetId,
  activeRulesForBattle,
  playUndoEntry,
  pushPlayUndo,
  selectPendingDamageUnit,
  commitBattleState,
  setTargetErrorMsg,
  setShootingResultEntries,
  setFightAttackAllocations,
  setSelectedFightWeaponIndex,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  damageAllocationLocked: boolean;
  fightAttackAllocations: AllocationTable;
  selectedFightWeaponIndex: 'all' | string;
  selectedPlayFightTargets: Array<{ id: string }>;
  fightAttackSplits: Record<string, number>;
  selectedFightAttackCount: number | null;
  selectedFightTargetId: string;
  activeRulesForBattle: Parameters<typeof fightPlayUnitWeapon>[5];
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  selectPendingDamageUnit: (state: BattleState, shooterUnitId: string | null) => boolean;
  commitBattleState: (state: BattleState) => void;
  setTargetErrorMsg: (message: string | null) => void;
  setShootingResultEntries: (entries: LogEntry[]) => void;
  setFightAttackAllocations: (allocations: AllocationTable) => void;
  setSelectedFightWeaponIndex: (weaponIndex: 'all' | string) => void;
}) {
  function resolveSelectedPlayFight() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'fight' || !selection) return;
    if (damageAllocationLocked) {
      setTargetErrorMsg('Allocate pending damage before fighting again');
      return;
    }
    const meleeAllocations = buildMeleeAttackAllocations(fightAttackAllocations);
    if (meleeAllocations.length) {
      const next = fightPlayUnitWeapons(prev, selection.unitId, selection.side, meleeAllocations, activeRulesForBattle);
      if (next === prev) {
        setTargetErrorMsg('Allocate every selected melee weapon to valid engaged targets before rolling.');
        return;
      }
      setShootingResultEntries(next.log.slice(prev.log.length));
      const hasPendingDamage = selectPendingDamageUnit(next, selection.unitId);
      if (!hasPendingDamage) setTargetErrorMsg(null);
      setFightAttackAllocations({});
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
    const next = fightPlayUnitWeapon(prev, selection.unitId, selection.side, targetUnitId, weaponIndex, activeRulesForBattle, usesSplit ? targetSplits : undefined);
    if (next === prev) return;
    setShootingResultEntries(next.log.slice(prev.log.length));
    const hasPendingDamage = selectPendingDamageUnit(next, selection.unitId);
    if (!hasPendingDamage) setTargetErrorMsg(null);
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
