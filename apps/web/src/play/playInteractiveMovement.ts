import { movePlayModelByDelta, movePlayModelVerticallyByDelta, rotatePlayModelByDelta } from '@warhammer-simulator/core/engine/simulator';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { PlayModelSelection } from '../components/Battlefield';

/**
 * Expands a grouped UI gesture into single-model core operations. The core
 * never needs to understand multi-model pointer gestures; it receives one
 * model operation at a time while this helper preserves the UI's grouped
 * preview behavior.
 */
export function moveSelectedPlayModels(
  state: BattleState,
  selection: PlayModelSelection,
  dx: number,
  dy: number,
  collide: boolean,
): BattleState {
  return selection.parts.reduce(
    (next, part) => part.modelIndices.reduce(
      (modelState, modelIndex) => movePlayModelByDelta(
        modelState,
        part.unitId,
        part.side,
        modelIndex,
        dx,
        dy,
        collide || !!modelState.pendingChargeMovement || !!modelState.pendingFightMovement,
      ),
      next,
    ),
    state,
  );
}

export function moveSelectedPlayModelsVertically(state: BattleState, selection: PlayModelSelection, dz: number): BattleState {
  return selection.parts.reduce(
    (next, part) => part.modelIndices.reduce(
      (modelState, modelIndex) => movePlayModelVerticallyByDelta(modelState, part.unitId, part.side, modelIndex, dz),
      next,
    ),
    state,
  );
}

export function rotateSelectedPlayModels(state: BattleState, selection: PlayModelSelection, degrees: number): BattleState {
  return selection.parts.reduce(
    (next, part) => part.modelIndices.reduce(
      (modelState, modelIndex) => rotatePlayModelByDelta(modelState, part.unitId, part.side, modelIndex, degrees),
      next,
    ),
    state,
  );
}
