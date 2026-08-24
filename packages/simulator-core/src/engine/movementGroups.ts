import type { BattleState, BattleUnit } from '../types/battle';

export interface MovementGroupContext {
  groupId(unit: BattleUnit): string;
  removeOpponentMarkersAfterMove(state: BattleState, unit: BattleUnit): void;
}

export function lockOtherMovedUnits(state: BattleState, currentUnit: BattleUnit, context: MovementGroupContext): void {
  if (state.phase !== 'movement') return;
  const currentGroupId = context.groupId(currentUnit);
  for (const unit of state.units) {
    if (unit.side !== currentUnit.side || unit.destroyed || context.groupId(unit) === currentGroupId || unit.movementComplete) continue;
    if (unit.movementAction === 'normalMove' || unit.movementAction === 'advanced') {
      unit.movementComplete = true;
      context.removeOpponentMarkersAfterMove(state, unit);
    }
  }
}

export function markGroupComplete(state: BattleState, currentUnit: BattleUnit, context: MovementGroupContext): void {
  const currentGroupId = context.groupId(currentUnit);
  for (const unit of state.units) {
    if (unit.side !== currentUnit.side || unit.destroyed || context.groupId(unit) !== currentGroupId) continue;
    unit.movementComplete = true;
    unit.lastMovePhase = state.phase;
    unit.lastMoveTurn = state.turn;
    unit.takingToSkies = undefined;
    context.removeOpponentMarkersAfterMove(state, unit);
  }
}
