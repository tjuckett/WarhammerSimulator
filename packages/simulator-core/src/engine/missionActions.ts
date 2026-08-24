import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface MissionActionEligibilityContext {
  attachedUnitComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  isAircraft(unit: BattleUnit): boolean;
  isFortification(unit: BattleUnit): boolean;
  objectiveControlValue(unit: BattleUnit): number;
  attachedUnitKeywordSet(state: BattleState, unit: BattleUnit): Set<string>;
  inEngagement(unit: BattleUnit, targets: BattleUnit[], range: number): boolean;
  enemies(state: BattleState, side: Side): BattleUnit[];
  log(state: BattleState, side: Side, title: string, message: string, type: string): BattleState['log'][number];
}

export function cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string, context: MissionActionEligibilityContext): void {
  const components = context.attachedUnitComponents(state, unit);
  const action = components.map(component => component.performingAction).find(Boolean);
  if (!action) return;
  for (const component of components) component.performingAction = undefined;
  state.log = [...state.log, context.log(state, unit.side, unit.profile.name,
    `${unit.profile.name} does not complete ${action.name}: ${reason}.`, 'info')];
}

export function unitIsEligibleToStartAction(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  context: MissionActionEligibilityContext,
  ignoreActionStartedThisTurn = false,
): boolean {
  const components = context.attachedUnitComponents(state, unit);
  if (!components.length || components.some(component => component.embarkedInUnitId || component.inStrategicReserves)) return false;
  if (components.some(component => context.isAircraft(component) || context.isFortification(component))) return false;
  if (components.some(component => component.battleshocked)) return false;
  if (components.reduce((total, component) => total + context.objectiveControlValue(component), 0) <= 0) return false;
  if (components.some(component => (!ignoreActionStartedThisTurn && component.actionStartedThisTurn) || component.performingAction)) return false;
  if (rules.metadata.edition === '11e' && state.phase === 'shooting'
    && components.some(component => component.activated || (component.firedWeaponIndices?.length ?? 0) > 0)) return false;
  if (components.some(component => component.movementAction === 'advanced' || component.movementAction === 'fellBack' || component.fellBack)) return false;
  const canActWhileEngaged = context.attachedUnitKeywordSet(state, unit).has('vehicle') || context.attachedUnitKeywordSet(state, unit).has('monster');
  return canActWhileEngaged || !components.some(component => context.inEngagement(component, context.enemies(state, unit.side), rules.engagementRange()));
}

export function playUnitCanStartAction(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: MissionActionEligibilityContext,
): boolean {
  if (state.activeArmy !== side || state.phase === 'deployment' || state.phase === 'setup' || state.phase === 'end') return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  return !!unit && unitIsEligibleToStartAction(unit, state, rules, context);
}

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
