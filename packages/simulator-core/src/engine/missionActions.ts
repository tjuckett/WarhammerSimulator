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

export type MissionActionStartContext = Record<string, any>;

export function applyStartedMissionAction(
  state: BattleState,
  unitId: string,
  side: Side,
  actionId: string,
  actionName: string,
  rules: RulesEdition,
  targets: { objectiveIndex?: number; terrainId?: string; operationMarkerId?: string; unitId?: string },
  context: MissionActionStartContext,
): BattleState {
  const next = context.clone(state);
  const unit = next.units.find((candidate: BattleUnit) => candidate.id === unitId && candidate.side === side)!;
  if (actionId === 'surveil' || actionId === 'booby-trap') {
    const action = { id: actionId, name: actionName, startedPhase: next.phase, completesAt: 'end-of-turn' as const,
      ...(targets.unitId !== undefined ? { targetUnitId: targets.unitId } : {}),
      ...(targets.terrainId !== undefined ? { targetTerrainId: targets.terrainId } : {}) };
    context.recordCompletedMissionAction(next, unit, action, context.attachedObjectiveIndexesWithinRange(next, unit, rules));
    const target = targets.unitId === undefined ? undefined : next.units.find((candidate: BattleUnit) => candidate.id === targets.unitId);
    const terrain = targets.terrainId === undefined ? undefined : next.terrain.find((candidate: any) => candidate.id === targets.terrainId);
    next.log = [...next.log, context.log(next, side, unit.profile.name,
      actionId === 'surveil' ? `${unit.profile.name} surveils ${target.profile.name}.` : `${unit.profile.name} traps ${terrain.name}.`, 'info')];
    if (actionId === 'booby-trap') for (const component of context.attachedUnitComponents(next, unit)) component.actionStartedThisTurn = true;
    return next;
  }
  const action = { id: actionId, name: actionName, startedPhase: next.phase, completesAt: 'end-of-turn' as const,
    ...(targets.objectiveIndex !== undefined ? { targetObjectiveIndex: targets.objectiveIndex } : {}),
    ...(targets.terrainId !== undefined ? { targetTerrainId: targets.terrainId } : {}),
    ...(targets.operationMarkerId !== undefined ? { targetOperationMarkerId: targets.operationMarkerId } : {}),
    ...(targets.unitId !== undefined ? { targetUnitId: targets.unitId } : {}) };
  for (const component of context.attachedUnitComponents(next, unit)) {
    component.performingAction = { ...action };
    component.actionStartedThisTurn = true;
  }
  next.log = [...next.log, context.log(next, side, unit.profile.name, `${unit.profile.name} starts ${actionName}.`, 'info')];
  return next;
}

export type MissionActionCompletionContext = Record<string, any>;

export function completeEndOfTurnActions(state: BattleState, side: Side, context: MissionActionCompletionContext): void {
  const handled = new Set<string>();
  for (const unit of state.units) {
    if (unit.side !== side || unit.destroyed || !unit.performingAction) continue;
    const groupId = context.attachedUnitId(unit);
    if (handled.has(groupId)) continue;
    handled.add(groupId);
    const action = unit.performingAction;
    if (action.id === 'vanguard-operation' && (action.targetTerrainId === undefined || !context.vanguardOperationTerrainIsValid(state, unit, side, action.targetTerrainId))) {
      context.cancelUnitAction(state, unit, 'the target terrain area is no longer eligible'); continue;
    }
    if (action.id === 'cleanse' && (action.targetObjectiveIndex === undefined || !context.hasActiveSecondaryMission(state, side, 'Cleanse')
      || !context.attachedObjectiveIndexesWithinRange(state, unit, context.rulesEditionForRuleset(state.ruleset)).includes(action.targetObjectiveIndex))) {
      context.cancelUnitAction(state, unit, 'the selected objective is no longer eligible'); continue;
    }
    if (action.id === 'plunder' && (action.targetTerrainId === undefined || !context.hasActiveSecondaryMission(state, side, 'Plunder')
      || !context.attachedTerrainAreaIdsContainingUnit(state, unit).includes(action.targetTerrainId)
      || !context.terrainIsExplicitlyOutsideTerritory(state, side, action.targetTerrainId))) {
      context.cancelUnitAction(state, unit, 'the selected terrain area is no longer eligible'); continue;
    }
    if (action.id === 'sensor-sweep') {
      const reason = context.resolveSensorSweepCompletion(state, unit, side, action);
      if (reason) { context.cancelUnitAction(state, unit, reason); continue; }
    }
    context.recordCompletedMissionAction(state, unit, action, context.attachedObjectiveIndexesWithinRange(state, unit, context.rulesEditionForRuleset(state.ruleset)));
    for (const component of context.attachedUnitComponents(state, unit)) component.performingAction = undefined;
    state.log = [...state.log, context.log(state, side, unit.profile.name, `${unit.profile.name} completes ${action.name}.`, 'info')];
  }
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
