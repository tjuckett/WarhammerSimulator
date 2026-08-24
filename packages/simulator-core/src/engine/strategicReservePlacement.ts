import type { BattleState, BattleUnit } from '../types/battle';

export interface StrategicReservePlacementContext {
  battleRound(state: BattleState): number;
  modelIsInOpponentDeploymentZone(state: BattleState, unit: BattleUnit, modelIndex: number): boolean;
}

export function isOutsideOpponentDeploymentZone(
  state: BattleState, unit: BattleUnit, context: StrategicReservePlacementContext,
): boolean {
  return context.battleRound(state) > 2
    || unit.modelPositions.every((_, modelIndex) => !context.modelIsInOpponentDeploymentZone(state, unit, modelIndex));
}
