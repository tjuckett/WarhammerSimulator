import { movePlaySelectionByDelta, movePlayModelVerticallyByDelta, rotatePlayModelByDelta } from '@warhammer-simulator/core/engine/simulator';
import type { ModelMovementRequest } from '@warhammer-simulator/core/engine/interactiveMovement';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { PlayModelSelection } from '../components/Battlefield';

/**
 * Expands a grouped UI gesture into unit-scoped model requests. The core
 * applies the complete gesture in one state transition while this helper
 * preserves the UI's grouped preview behavior.
 */
export function moveSelectedPlayModels(
  state: BattleState,
  selection: PlayModelSelection,
  dx: number,
  dy: number,
  collide: boolean,
  preview = false,
): BattleState {
  const partsByUnit = new Map<string, { unitId: string; side: 0 | 1; modelIndices: Set<number> }>();
  for (const part of selection.parts) {
    const key = `${part.side}:${part.unitId}`;
    const existing = partsByUnit.get(key) ?? {
      unitId: part.unitId,
      side: part.side,
      modelIndices: new Set<number>(),
    };
    part.modelIndices.forEach(modelIndex => existing.modelIndices.add(modelIndex));
    partsByUnit.set(key, existing);
  }

  const requests: ModelMovementRequest[] = [...partsByUnit.values()].map(part => ({
    unitId: part.unitId,
    side: part.side,
    modelIndices: [...part.modelIndices],
  }));
  return movePlaySelectionByDelta(state, requests, dx, dy, collide, preview);
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
