import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { shootPlayUnitWeapon, shootPlayUnitWeapons } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { primaryPlaySelectionPart } from './playSelectionHelpers';
import { buildShootingAttackAllocations } from './playAttackAllocations';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };
type AllocationTable = Record<string, Record<string, number>>;

export function createPlayShootingResolution({
  battleStateRef,
  playModelSelection,
  selectedPlayShootingOptions,
  shootingAttackAllocations,
  damageAllocationLocked,
  shootingResolutionStatus,
  casualtyRemovalShooterId,
  playUndoEntry,
  pushPlayUndo,
  selectPendingDamageUnit,
  commitBattleState,
  setShootingResolutionStatus,
  setTargetErrorMsg,
  setCasualtyRemovalShooterId,
  setPlayModelSelection,
  setInspectedSelection,
  setShootingAttackAllocations,
}: {
  battleStateRef: StateRef;
  playModelSelection: PlayModelSelection | null;
  selectedPlayShootingOptions: PlayShootingWeaponOption[];
  shootingAttackAllocations: AllocationTable;
  damageAllocationLocked: boolean;
  shootingResolutionStatus: 'idle' | 'rolled';
  casualtyRemovalShooterId: string | null;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  selectPendingDamageUnit: (state: BattleState, shooterUnitId: string | null) => boolean;
  commitBattleState: (state: BattleState) => void;
  setShootingResolutionStatus: (status: 'idle' | 'rolled') => void;
  setTargetErrorMsg: (message: string | null) => void;
  setCasualtyRemovalShooterId: (unitId: string | null) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: null) => void;
  setShootingAttackAllocations: (allocations: AllocationTable) => void;
}) {
  function resolveSelectedPlayShooting() {
    const selection = primaryPlaySelectionPart(playModelSelection);
    const prev = battleStateRef.current;
    if (!prev || prev.phase !== 'shooting' || !selection) return;
    if (!damageAllocationLocked && shootingResolutionStatus === 'rolled') {
      setShootingResolutionStatus('idle');
      setTargetErrorMsg(null);
      setCasualtyRemovalShooterId(null);
      setPlayModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    if (damageAllocationLocked) {
      if (shootingResolutionStatus === 'rolled' && selectPendingDamageUnit(prev, casualtyRemovalShooterId)) return;
      setTargetErrorMsg('Allocate pending damage before shooting again');
      return;
    }
    const noRangedWeapons = selectedPlayShootingOptions.length === 1 && selectedPlayShootingOptions[0].weaponIndex < 0;
    const allocations = buildShootingAttackAllocations(shootingAttackAllocations);
    if (!allocations.length && !noRangedWeapons) {
      setTargetErrorMsg('Assign every ranged weapon to at least one valid target before rolling.');
      return;
    }
    const rules = rulesEditionForRuleset(prev.ruleset);
    const next = noRangedWeapons
      ? shootPlayUnitWeapon(prev, selection.unitId, selection.side, undefined, -1, rules)
      : shootPlayUnitWeapons(prev, selection.unitId, selection.side, allocations, rules);
    if (next === prev) {
      setTargetErrorMsg('Shooting declaration could not be resolved. Check that every weapon-bearing model is assigned to a valid target and that each target has enough visible models.');
      return;
    }
    setShootingResolutionStatus('rolled');
    const pendingDamageUnit = next.units.find(unit => !unit.destroyed && !unit.embarkedInUnitId && (unit.pendingDamageAllocations?.length ?? 0) > 0);
    setCasualtyRemovalShooterId(pendingDamageUnit ? selection.unitId : null);
    setTargetErrorMsg(null);
    setShootingAttackAllocations({});
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.ShootUnitWeapon,
      unitId: selection.unitId,
      side: selection.side,
      targetUnitId: '',
      weaponIndex: 'all',
    });
    commitBattleState(next);
  }

  return { resolveSelectedPlayShooting };
}
