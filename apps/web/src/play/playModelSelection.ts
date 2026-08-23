import type { BattleState } from '@warhammer-simulator/core/types/battle';
import { allocatePlayDamageToModel } from '@warhammer-simulator/core/engine/simulator';
import { GAME_ACTION_TYPE, type GameAction } from '@warhammer-simulator/core/practice/actions';
import type { PlayModelSelection } from '../components/Battlefield';
import { normalizePlaySelectionForState } from './playSelectionHelpers';
import type { PlayUndoEntry } from './usePlayUndoState';

type StateRef = { current: BattleState | null };
type InspectedSelection =
  | { kind: 'battle'; side: 0 | 1; unitId: string }
  | null;

export function createPlayModelSelection({
  battleStateRef,
  battleState,
  isPlayMode,
  damageAllocationLocked,
  pendingDamageAllocationUnitIds,
  casualtyRemovalShooterId,
  playModelSelection,
  playUndoEntry,
  pushPlayUndo,
  commitBattleState,
  setPlayDeploySelection,
  setPlayModelSelection,
  setInspectedSelection,
  setCasualtyRemovalShooterId,
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  battleState: BattleState | null;
  isPlayMode: boolean;
  damageAllocationLocked: boolean;
  pendingDamageAllocationUnitIds: Set<string>;
  casualtyRemovalShooterId: string | null;
  playModelSelection: PlayModelSelection | null;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitBattleState: (state: BattleState) => void;
  setPlayDeploySelection: (selection: null) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: InspectedSelection) => void;
  setCasualtyRemovalShooterId: (unitId: string | null) => void;
  setTargetErrorMsg: (message: string | null) => void;
}) {
  function selectPlayModels(selection: PlayModelSelection | null) {
    if (damageAllocationLocked) {
      const part = selection?.parts.find(candidate => pendingDamageAllocationUnitIds.has(candidate.unitId));
      const modelIndex = part?.modelIndices[0];
      const prev = battleStateRef.current;
      if (!part || modelIndex === undefined || !prev) {
        setTargetErrorMsg('Select a model to allocate the next pending damage');
        return;
      }
      const next = allocatePlayDamageToModel(prev, part.unitId, part.side, modelIndex);
      if (next === prev) {
        setTargetErrorMsg('Damage must be allocated to the already wounded model until it is destroyed');
        return;
      }
      pushPlayUndo(playUndoEntry(prev), next, {
        type: GAME_ACTION_TYPE.AllocateDamage,
        unitId: part.unitId,
        side: part.side,
        modelIndex,
      });
      const stillPending = next.units.find(unit => unit.id === part.unitId && unit.side === part.side && (unit.pendingDamageAllocations?.length ?? 0) > 0);
      if (stillPending) {
        setPlayModelSelection(normalizePlaySelectionForState(next, {
          side: stillPending.side,
          parts: [{ unitId: stillPending.id, side: stillPending.side, modelIndices: stillPending.modelPositions.map((_, index) => index) }],
        }));
        setInspectedSelection({ kind: 'battle', side: stillPending.side, unitId: stillPending.id });
        setTargetErrorMsg('Select a model to allocate the next pending damage');
      } else {
        const anotherPending = next.units.find(unit =>
          !unit.destroyed
          && !unit.embarkedInUnitId
          && (unit.pendingDamageAllocations?.length ?? 0) > 0,
        );
        if (anotherPending) {
          setPlayModelSelection(normalizePlaySelectionForState(next, {
            side: anotherPending.side,
            parts: [{ unitId: anotherPending.id, side: anotherPending.side, modelIndices: anotherPending.modelPositions.map((_, index) => index) }],
          }));
          setInspectedSelection({ kind: 'battle', side: anotherPending.side, unitId: anotherPending.id });
          setTargetErrorMsg('Select a model to allocate the next pending damage');
          commitBattleState(next);
          return;
        }
        const actingUnit = next.phase === 'fight' && casualtyRemovalShooterId
          ? next.units.find(unit => unit.id === casualtyRemovalShooterId && unit.side === next.activeArmy && !unit.destroyed && !unit.embarkedInUnitId)
          : null;
        if (actingUnit) {
          setPlayModelSelection(normalizePlaySelectionForState(next, {
            side: actingUnit.side,
            parts: [{ unitId: actingUnit.id, side: actingUnit.side, modelIndices: actingUnit.modelPositions.map((_, index) => index) }],
          }));
          setInspectedSelection({ kind: 'battle', side: actingUnit.side, unitId: actingUnit.id });
        } else {
          setPlayModelSelection(null);
          setInspectedSelection(null);
        }
        setCasualtyRemovalShooterId(null);
        setTargetErrorMsg(null);
      }
      commitBattleState(next);
      return;
    }
    const normalized = normalizePlaySelectionForState(battleState, selection);
    if (!normalized) {
      setPlayModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    const primary = normalized.parts[0];
    if (isPlayMode && battleState?.phase === 'shooting') {
      const unit = battleState.units.find(candidate => candidate.id === primary.unitId && candidate.side === primary.side && !candidate.destroyed);
      if (!unit || primary.side !== battleState.activeArmy || unit.activated) return;
    }
    if (isPlayMode && (battleState?.phase === 'charge' || battleState?.phase === 'fight')) {
      const unit = battleState.units.find(candidate => candidate.id === primary.unitId && candidate.side === primary.side && !candidate.destroyed);
      if (!unit || primary.side !== battleState.activeArmy || (battleState.phase === 'fight' && unit.activated)) return;
    }
    setPlayDeploySelection(null);
    setInspectedSelection({ kind: 'battle', side: primary.side, unitId: primary.unitId });
    setPlayModelSelection(normalized);
  }

  return { selectPlayModels };
}
