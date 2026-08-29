import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { PlayModelSelection } from '../components/Battlefield';
import { firstPendingDamageUnit } from './playBattleSelectors';
import { normalizePlaySelectionForState } from './playSelectionHelpers';

type StateRef = { current: BattleState | null };

export function createPendingDamageSelectionAction({
  battleStateRef,
  pendingDamageAllocationUnitIds,
  casualtyRemovalShooterId,
  setCasualtyRemovalShooterId,
  setPlayModelSelection,
  setInspectedSelection,
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  pendingDamageAllocationUnitIds: Set<string>;
  casualtyRemovalShooterId: string | null;
  setCasualtyRemovalShooterId: (unitId: string | null) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: { kind: 'battle'; side: 0 | 1; unitId: string } | null) => void;
  setTargetErrorMsg: (message: string | null) => void;
}) {
  function selectPendingDamageUnit(next: BattleState, shooterUnitId: string | null) {
    const pendingDamageUnit = firstPendingDamageUnit(next);
    if (!pendingDamageUnit) return false;
    if (shooterUnitId) setCasualtyRemovalShooterId(shooterUnitId);
    setPlayModelSelection(normalizePlaySelectionForState(next, {
      side: pendingDamageUnit.side,
      parts: [{
        unitId: pendingDamageUnit.id,
        side: pendingDamageUnit.side,
        modelIndices: pendingDamageUnit.modelPositions.map((_, modelIndex) => modelIndex),
      }],
    }));
    setInspectedSelection({ kind: 'battle', side: pendingDamageUnit.side, unitId: pendingDamageUnit.id });
    setTargetErrorMsg('Select a model to allocate the next pending damage');
    return true;
  }

  function selectShootingResolutionTarget(next: BattleState, shooterUnitId: string | null, requestedTargetId?: string) {
    const resolution = shooterUnitId
      ? next.lastShootingResolution?.shooterUnitId === shooterUnitId ? next.lastShootingResolution : null
      : next.lastShootingResolution;
    const targetId = requestedTargetId ?? resolution?.weapons.find(weapon => weapon.wounds > 0)?.targetUnitId;
    const target = targetId
      ? next.units.find(unit => unit.id === targetId && !unit.destroyed && !unit.embarkedInUnitId)
      : null;
    if (!target) return false;
    if (shooterUnitId) setCasualtyRemovalShooterId(shooterUnitId);
    setPlayModelSelection(normalizePlaySelectionForState(next, {
      side: target.side,
      parts: [{ unitId: target.id, side: target.side, modelIndices: target.modelPositions.map((_, index) => index) }],
    }));
    setInspectedSelection({ kind: 'battle', side: target.side, unitId: target.id });
    setTargetErrorMsg(null);
    return true;
  }

  return { selectPendingDamageUnit, selectShootingResolutionTarget };
}
