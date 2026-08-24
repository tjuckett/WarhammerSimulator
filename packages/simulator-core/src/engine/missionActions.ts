import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface MissionActionsContext {
  canStartAction(state: BattleState, unitId: string, side: Side, rules: RulesEdition): boolean;
  objectiveIndexesWithinRange(state: BattleState, unit: BattleUnit, rules: RulesEdition): number[];
  objectiveRoleForIndex(state: BattleState, objectiveIndex: number): string | undefined;
}

export function missionObjectiveActionOptions(
  state: BattleState, unitId: string, side: Side, rules: RulesEdition,
  missionName: string, actionId: string, objectiveFilter: 'any' | 'non-home' | 'central' = 'non-home',
  context: MissionActionsContext,
): number[] {
  const selectedMissionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || selectedMissionName !== missionName) return [];
  if (!context.canStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const marked = new Set([
    ...(state.missionState?.operationMarkers ?? []).filter(marker => marker.side === side && marker.sourceActionId === actionId)
      .flatMap(marker => marker.objectiveIndex === undefined ? [] : [marker.objectiveIndex]),
    ...state.units.filter(candidate => candidate.side === side && candidate.performingAction?.id === actionId)
      .flatMap(candidate => candidate.performingAction?.targetObjectiveIndex === undefined ? [] : [candidate.performingAction.targetObjectiveIndex]),
  ]);
  const homeRole = side === 0 ? 'home-0' : 'home-1';
  return context.objectiveIndexesWithinRange(state, unit, rules).filter(objectiveIndex => {
    if (marked.has(objectiveIndex) || !state.objectives[objectiveIndex]) return false;
    const role = context.objectiveRoleForIndex(state, objectiveIndex);
    return objectiveFilter === 'any' || (objectiveFilter === 'central' ? role === 'central' : role !== undefined && role !== homeRole);
  });
}
