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
    const packetOwner = firstPendingDamageUnit(next);
    const packet = packetOwner?.pendingDamageAllocations?.[0];
    const targetUnitId = packet?.targetUnitId ?? packetOwner?.id;
    const pendingDamageUnit = targetUnitId
      ? next.units.find(unit => unit.id === targetUnitId
        && !unit.destroyed
        && !unit.embarkedInUnitId
        && (unit.pendingDamageAllocations?.length ?? 0) > 0) ?? null
      : null;
    if (!pendingDamageUnit) return null;
    if (shooterUnitId) setCasualtyRemovalShooterId(shooterUnitId);
    setTargetErrorMsg('Select a model to allocate the next pending damage');
    return pendingDamageUnit;
  }

  function selectShootingResolutionTarget(next: BattleState, shooterUnitId: string | null, requestedTargetId?: string) {
    const resolution = shooterUnitId
      ? next.lastShootingResolution?.shooterUnitId === shooterUnitId ? next.lastShootingResolution : null
      : next.lastShootingResolution;
    // Defender review is useful even when every wound was saved or every
    // point of damage was ignored by Feel No Pain. Fall back to the first
    // resolved target rather than requiring a wound to have survived.
    const targetId = requestedTargetId ?? resolution?.weapons[0]?.targetUnitId;
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
