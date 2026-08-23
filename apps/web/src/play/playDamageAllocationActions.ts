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

  return { selectPendingDamageUnit };
}
