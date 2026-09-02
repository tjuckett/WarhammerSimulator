import { PHASE_STEP, type BattleState } from '@warhammer-simulator/core/types/battle';
import { allocatePlayDamageToModel } from '@warhammer-simulator/core/engine/simulator';
import { phaseStepFor } from '@warhammer-simulator/core/engine/battleStateMachine';
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
  shootingResolutionShooterId,
  casualtyRemovalShooterId,
  playModelSelection,
  playUndoEntry,
  pushPlayUndo,
  commitBattleState,
  setPlayDeploySelection,
  setPlayModelSelection,
  setInspectedSelection,
  setCasualtyRemovalShooterId,
  setShootingResolutionStatus,
  setTargetErrorMsg,
}: {
  battleStateRef: StateRef;
  battleState: BattleState | null;
  isPlayMode: boolean;
  damageAllocationLocked: boolean;
  pendingDamageAllocationUnitIds: Set<string>;
  shootingResolutionShooterId: string | null;
  casualtyRemovalShooterId: string | null;
  playModelSelection: PlayModelSelection | null;
  playUndoEntry: (state: BattleState) => PlayUndoEntry;
  pushPlayUndo: (entry: PlayUndoEntry, stateAfter?: BattleState, action?: GameAction) => void;
  commitBattleState: (state: BattleState) => void;
  setPlayDeploySelection: (selection: null) => void;
  setPlayModelSelection: (selection: PlayModelSelection | null) => void;
  setInspectedSelection: (selection: InspectedSelection) => void;
  setCasualtyRemovalShooterId: (unitId: string | null) => void;
  setShootingResolutionStatus: (status: 'idle' | 'rolled') => void;
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
        if (next.phase === 'shooting' || next.phase === 'fight') {
          // The final damage allocation completes the combat result. Clear
          // the UI-only resolution cursor so another eligible unit can be
          // selected immediately.
          setShootingResolutionStatus('idle');
          setCasualtyRemovalShooterId(null);
          setPlayModelSelection(null);
          setInspectedSelection(null);
          setTargetErrorMsg(null);
          commitBattleState(next);
          return;
        }
        const actingUnit = next.phase === 'fight' && casualtyRemovalShooterId
          ? next.units.find(unit => unit.id === casualtyRemovalShooterId && unit.side === next.activeArmy && !unit.destroyed && !unit.embarkedInUnitId)
          : null;
        const shootingResolution = next.phase === 'shooting' && casualtyRemovalShooterId
          && next.lastShootingResolution?.shooterUnitId === casualtyRemovalShooterId
          ? next.lastShootingResolution
          : null;
        const shootingResolutionTargetIds = shootingResolution
          ? [...new Set(shootingResolution.weapons.filter(weapon => weapon.wounds > 0).map(weapon => weapon.targetUnitId))]
          : [];
        const shootingResolutionHasDamage = !!shootingResolution?.weapons.some(weapon => weapon.unsavedWounds > 0);
        const keepShootingResolutionOpen = shootingResolutionTargetIds.length > 1
          || !shootingResolutionHasDamage;
        const shootingResolutionTargetId = keepShootingResolutionOpen ? shootingResolutionTargetIds[0] : undefined;
        const shootingResolutionTarget = shootingResolutionTargetId
          ? next.units.find(unit => unit.id === shootingResolutionTargetId && !unit.destroyed && !unit.embarkedInUnitId)
          : null;
        if (shootingResolutionTarget) {
          setPlayModelSelection(normalizePlaySelectionForState(next, {
            side: shootingResolutionTarget.side,
            parts: [{ unitId: shootingResolutionTarget.id, side: shootingResolutionTarget.side, modelIndices: shootingResolutionTarget.modelPositions.map((_, index) => index) }],
          }));
          setInspectedSelection({ kind: 'battle', side: shootingResolutionTarget.side, unitId: shootingResolutionTarget.id });
        } else if (actingUnit) {
          setPlayModelSelection(normalizePlaySelectionForState(next, {
            side: actingUnit.side,
            parts: [{ unitId: actingUnit.id, side: actingUnit.side, modelIndices: actingUnit.modelPositions.map((_, index) => index) }],
          }));
          setInspectedSelection({ kind: 'battle', side: actingUnit.side, unitId: actingUnit.id });
        } else {
          setPlayModelSelection(null);
          setInspectedSelection(null);
        }
        if (!shootingResolutionTarget) setCasualtyRemovalShooterId(null);
        setTargetErrorMsg(null);
      }
      commitBattleState(next);
      return;
    }
    // Pointer events can arrive between the state commit and React's next
    // render. Use the ref's state for validation so a selection made after a
    // Fight Pile In side handoff is not checked against the previous side.
    const currentState = battleStateRef.current ?? battleState;
    const normalized = normalizePlaySelectionForState(currentState, selection);
    if (!normalized) {
      setPlayModelSelection(null);
      setInspectedSelection(null);
      return;
    }
    const primary = normalized.parts[0];
    if (isPlayMode
      && currentState?.phase === 'shooting'
      && shootingResolutionShooterId
      && (primary.unitId !== shootingResolutionShooterId || primary.side !== currentState.activeArmy)) {
      setTargetErrorMsg('Resolve the current shooting result before selecting another unit');
      return;
    }
    if (isPlayMode && currentState?.phase === 'shooting') {
      const unit = currentState.units.find(candidate => candidate.id === primary.unitId && candidate.side === primary.side && !candidate.destroyed);
      if (!unit || primary.side !== currentState.activeArmy || (unit.activated && primary.unitId !== shootingResolutionShooterId)) return;
    }
    if (isPlayMode && currentState?.pendingFightMovement) {
      const pending = currentState.pendingFightMovement;
      if (primary.unitId !== pending.unitId || primary.side !== pending.side) return;
    }
    if (isPlayMode && (currentState?.phase === 'charge' || currentState?.phase === 'fight')) {
      const unit = currentState.units.find(candidate => candidate.id === primary.unitId && candidate.side === primary.side && !candidate.destroyed);
      const fightStep = currentState.phase === 'fight' ? phaseStepFor(currentState) : undefined;
      const fightSelectionSide = currentState.phase === 'fight'
        && fightStep === PHASE_STEP.FightPileIn
        ? (currentState.fightPileInSide ?? currentState.activeArmy)
        : currentState.phase === 'fight'
          && fightStep === PHASE_STEP.FightConsolidate
          ? (currentState.consolidationSide ?? currentState.activeArmy)
          : currentState.activeArmy;
      if (!unit || primary.side !== fightSelectionSide || (currentState.phase === 'fight' && unit.activated)) return;
    }
    setPlayDeploySelection(null);
    setInspectedSelection({ kind: 'battle', side: primary.side, unitId: primary.unitId });
    setPlayModelSelection(normalized);
  }

  return { selectPlayModels };
}
