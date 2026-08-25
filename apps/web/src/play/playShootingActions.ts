import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { RulesEdition } from '@warhammer-simulator/core/engine/rulesEngine';
import { snapShootPlayUnitWeapon, type PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };

export function createPlayShootingActions({
  battleStateRef,
  overwatchUnit,
  selectedOverwatchTargets,
  selectedShootingTargetId,
  selectedShootingWeaponIndex,
  activeRulesForBattle,
  playUndoEntry,
  pushPlayUndo,
  commitBattleState,
  setTargetErrorMsg,
  setShootingResolutionStatus,
  setOverwatchUnitId,
  setSelectedShootingTargetId,
  setSelectedShootingWeaponIndex,
}: {
  battleStateRef: StateRef;
  overwatchUnit: BattleUnit | null;
  selectedOverwatchTargets: BattleUnit[];
  selectedShootingTargetId: string;
  selectedShootingWeaponIndex: 'all' | string;
  activeRulesForBattle: RulesEdition;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitBattleState: (state: BattleState) => void;
  setTargetErrorMsg: (message: string | null) => void;
  setShootingResolutionStatus: (status: 'idle' | 'rolled') => void;
  setOverwatchUnitId: (unitId: string) => void;
  setSelectedShootingTargetId: (targetId: string) => void;
  setSelectedShootingWeaponIndex: (weaponIndex: 'all' | string) => void;
}) {
  function resolveSelectedPlayOverwatch() {
    const prev = battleStateRef.current;
    if (!prev || !overwatchUnit || !selectedShootingTargetId) return;
    if (!selectedOverwatchTargets.some(target => target.id === selectedShootingTargetId)) {
      setTargetErrorMsg('Selected unit cannot snap shoot that target.');
      return;
    }
    const weaponIndex = selectedShootingWeaponIndex === 'all' ? 'all' : Number(selectedShootingWeaponIndex);
    const next = snapShootPlayUnitWeapon(
      prev,
      overwatchUnit.id,
      overwatchUnit.side,
      selectedShootingTargetId,
      weaponIndex,
      activeRulesForBattle,
    );
    if (next === prev) {
      setTargetErrorMsg('Snap shooting could not be resolved.');
      return;
    }
    pushPlayUndo(playUndoEntry(prev), next, {
      type: GAME_ACTION_TYPE.SnapShootUnitWeapon,
      side: overwatchUnit.side,
      unitId: overwatchUnit.id,
      targetUnitId: selectedShootingTargetId,
      weaponIndex,
    });
    setShootingResolutionStatus('rolled');
    setOverwatchUnitId('');
    setSelectedShootingTargetId('');
    setSelectedShootingWeaponIndex('all');
    setTargetErrorMsg(null);
    commitBattleState(next);
  }

  return { resolveSelectedPlayOverwatch };
}
