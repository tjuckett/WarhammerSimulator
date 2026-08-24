import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';
import { secondaryMissionStateFor } from './secondaryMissions';
import { terrainTerritoryRelation } from './missionGeometry';

export function hasActiveSecondaryMission(state: BattleState, side: Side, missionName: string): boolean {
  return secondaryMissionStateFor(state, side)?.activeCards.some(card => card.missionName === missionName) ?? false;
}

export function terrainIsExplicitlyOutsideTerritory(state: BattleState, side: Side, terrainId: string): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  return !!terrain && ['enemy', 'no-mans-land'].includes(terrainTerritoryRelation(terrain, side));
}

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

export interface StartPlayMissionActionContext extends Record<string, any> {
  playUnitCanStartAction(state: BattleState, unitId: string, side: Side, rules: RulesEdition): boolean;
  extractIntelligenceObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  triangulateObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  consecrateObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  maintainControlObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  secureAssetObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  decoyObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  sabotageObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  cleanseObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): number[];
  plunderTerrainOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): string[];
  vanguardOperationTerrainOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): string[];
  boobyTrapTerrainOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): string[];
  sensorSweepOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): Array<{ objectiveIndex?: number; operationMarkerId?: string }>;
  surveilTargetOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition): string[];
  applyStartedMissionAction: typeof applyStartedMissionAction;
}

export function startPlayUnitAction(
  state: BattleState,
  unitId: string,
  side: Side,
  actionId: string,
  actionName: string,
  rules: RulesEdition,
  targetObjectiveIndex: number | undefined,
  targetTerrainId: string | undefined,
  targetOperationMarkerId: string | undefined,
  targetUnitId: string | undefined,
  context: StartPlayMissionActionContext,
): BattleState {
  if (actionId !== 'surveil' && !context.playUnitCanStartAction(state, unitId, side, rules)) return state;
  if (actionId === 'extract-intelligence'
    && (targetObjectiveIndex === undefined
      || !context.extractIntelligenceObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'triangulate'
    && (targetObjectiveIndex === undefined
      || !context.triangulateObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'consecrate') return state;
  if (actionId === 'maintain-control'
    && (targetObjectiveIndex === undefined
      || !context.maintainControlObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'secure-asset'
    && (targetObjectiveIndex === undefined
      || !context.secureAssetObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'decoy'
    && (targetObjectiveIndex === undefined
      || !context.decoyObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'sabotage'
    && (targetObjectiveIndex === undefined
      || !context.sabotageObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'cleanse'
    && (targetObjectiveIndex === undefined
      || !context.cleanseObjectiveOptions(state, unitId, side, rules).includes(targetObjectiveIndex))) return state;
  if (actionId === 'plunder'
    && (targetTerrainId === undefined
      || !context.plunderTerrainOptions(state, unitId, side, rules).includes(targetTerrainId))) return state;
  if (actionId === 'vanguard-operation'
    && (targetTerrainId === undefined
      || !context.vanguardOperationTerrainOptions(state, unitId, side, rules).includes(targetTerrainId))) return state;
  if (actionId === 'booby-trap'
    && (targetTerrainId === undefined
      || !context.boobyTrapTerrainOptions(state, unitId, side, rules).includes(targetTerrainId))) return state;
  if (actionId === 'sensor-sweep'
    && !context.sensorSweepOptions(state, unitId, side, rules).some(option =>
      option.objectiveIndex === targetObjectiveIndex && option.operationMarkerId === targetOperationMarkerId)) return state;
  if (actionId === 'surveil'
    && (targetUnitId === undefined
      || !context.surveilTargetOptions(state, unitId, side, rules).includes(targetUnitId))) return state;
  return context.applyStartedMissionAction(state, unitId, side, actionId, actionName, rules, {
    objectiveIndex: targetObjectiveIndex,
    terrainId: targetTerrainId,
    operationMarkerId: targetOperationMarkerId,
    unitId: targetUnitId,
  }, context);
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

export function completedOrInProgressObjectiveTargets(state: BattleState, side: Side, actionId: string): Set<number> {
  return new Set([
    ...(state.missionEvents?.completedActionsThisTurn ?? []).filter(event => event.side === side && event.actionId === actionId)
      .flatMap(event => event.targetObjectiveIndex === undefined ? [] : [event.targetObjectiveIndex]),
    ...state.units.filter(unit => unit.side === side && unit.performingAction?.id === actionId)
      .flatMap(unit => unit.performingAction?.targetObjectiveIndex === undefined ? [] : [unit.performingAction.targetObjectiveIndex]),
  ]);
}

export function completedOrInProgressTerrainTargets(state: BattleState, side: Side, actionId: string): Set<string> {
  return new Set([
    ...(state.missionEvents?.completedActionsThisTurn ?? []).filter(event => event.side === side && event.actionId === actionId)
      .flatMap(event => event.targetTerrainId === undefined ? [] : [event.targetTerrainId]),
    ...state.units.filter(unit => unit.side === side && unit.performingAction?.id === actionId)
      .flatMap(unit => unit.performingAction?.targetTerrainId === undefined ? [] : [unit.performingAction.targetTerrainId]),
  ]);
}

export interface SecondaryMissionActionOptionsContext {
  hasActiveSecondaryMission(state: BattleState, side: Side, missionName: string): boolean;
  canStartAction(state: BattleState, unitId: string, side: Side, rules: RulesEdition): boolean;
  objectiveIndexesWithinRange(state: BattleState, unit: BattleUnit, rules: RulesEdition): number[];
  terrainAreaIdsContainingUnit(state: BattleState, unit: BattleUnit): string[];
  terrainIsExplicitlyOutsideTerritory(state: BattleState, side: Side, terrainId: string): boolean;
}

export interface TargetedMissionActionContext extends SecondaryMissionActionOptionsContext {
  unitIsEligibleToStartAction(unit: BattleUnit, state: BattleState, rules: RulesEdition, ignoreActionStartedThisTurn?: boolean): boolean;
  objectiveRoleForIndex(state: BattleState, objectiveIndex: number): string | undefined;
  battleUnitsWithinBaseEdgeRange(a: BattleUnit, b: BattleUnit, range: number): boolean;
  hasAnyModelLOSConsideringHidden(state: BattleState, attacker: BattleUnit, target: BattleUnit): boolean;
  terrainWithinOpponentTerritory(state: BattleState, terrain: BattleState['terrain'][number], side: Side): boolean;
  terrainContainsObjective(state: BattleState, terrain: BattleState['terrain'][number], objectiveIndex: number): boolean;
  terrainIsOutsideDeploymentZone(state: BattleState, terrain: BattleState['terrain'][number], side: Side): boolean;
  rulesForState(state: BattleState): RulesEdition;
  log(state: BattleState, side: Side, title: string, message: string, type: string): BattleState['log'][number];
  clone(state: BattleState): BattleState;
  battleRound(state: BattleState): number;
  hasUnresolvedFightWork(state: BattleState, side: Side, rules: RulesEdition): boolean;
}

export interface SensorSweepOption {
  objectiveIndex: number;
  operationMarkerId: string;
}

export function objectiveIsCentral(state: BattleState, objectiveIndex: number, context: TargetedMissionActionContext): boolean {
  return !!state.objectives[objectiveIndex] && context.objectiveRoleForIndex(state, objectiveIndex) === 'central';
}

export function consecrateObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TargetedMissionActionContext, resolvingEndOfTurn = false): number[] {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || missionName !== 'Consecrate' || state.activeArmy !== side || state.phase !== 'fight') return [];
  if (!resolvingEndOfTurn && context.hasUnresolvedFightWork(state, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (!unit) return [];
  const destroyedAnEnemy = (state.missionEvents?.destroyedUnitsThisTurn ?? []).some(event =>
    event.destroyedBySide === side && event.side !== side && event.destroyedByUnitId === unitId);
  if (!destroyedAnEnemy) return [];
  const alreadyUsed = (state.missionState?.operationMarkers ?? []).some(marker => marker.side === side
    && marker.sourceActionId === 'consecrate' && marker.placedByUnitId === unitId
    && marker.battleRound === context.battleRound(state) && marker.turn === state.turn);
  if (alreadyUsed) return [];
  const marked = new Set((state.missionState?.operationMarkers ?? []).filter(marker => marker.side === side && marker.sourceActionId === 'consecrate')
    .flatMap(marker => marker.objectiveIndex === undefined ? [] : [marker.objectiveIndex]));
  const ownHomeRole = side === 0 ? 'home-0' : 'home-1';
  return context.objectiveIndexesWithinRange(state, unit, rules).filter(index => !marked.has(index)
    && context.objectiveRoleForIndex(state, index) !== undefined && context.objectiveRoleForIndex(state, index) !== ownHomeRole);
}

export function consecrateObjective(state: BattleState, unitId: string, side: Side, objectiveIndex: number, rules: RulesEdition, context: TargetedMissionActionContext, resolvingEndOfTurn = false): BattleState {
  if (!consecrateObjectiveOptions(state, unitId, side, rules, context, resolvingEndOfTurn).includes(objectiveIndex)) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId)!;
  next.missionState ??= {};
  next.missionState.operationMarkers = [...(next.missionState.operationMarkers ?? []), {
    id: `operation-marker-${side}-consecrate-${objectiveIndex}`, side, sourceActionId: 'consecrate', placedByUnitId: unitId,
    objectiveIndex, position: { ...next.objectives[objectiveIndex] }, battleRound: context.battleRound(next), turn: next.turn,
  }];
  next.log = [...next.log, context.log(next, side, unit.profile.name, `${unit.profile.name} consecrates objective ${objectiveIndex + 1}.`, 'info')];
  return next;
}

export function sensorSweepOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): SensorSweepOption[] {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || (missionName !== 'Extract Relic' && missionName !== 'Locate and Deny')
    || state.phase !== 'shooting' || !context.canStartAction(state, unitId, side, rules)) return [];
  const markers = state.missionState?.operationMarkers ?? [];
  if (markers.length <= 1
    || (state.missionEvents?.completedActionsThisTurn ?? []).some(event => event.side === side && event.actionId === 'sensor-sweep')
    || state.units.some(unit => unit.side === side && unit.performingAction?.id === 'sensor-sweep')) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  return context.objectiveIndexesWithinRange(state, unit, rules)
    .filter(index => objectiveIsCentral(state, index, context))
    .flatMap(objectiveIndex => markers.map(marker => ({ objectiveIndex, operationMarkerId: marker.id })));
}

export function surveilTargetOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): string[] {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || missionName !== 'Surveil the Foe' || state.phase !== 'shooting' || state.activeArmy !== side) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit || !context.unitIsEligibleToStartAction(unit, state, rules, true)) return [];
  const surveilled = new Set((state.missionEvents?.completedActionsThisTurn ?? [])
    .filter(event => event.side === side && event.actionId === 'surveil')
    .flatMap(event => event.targetUnitId ? [event.targetUnitId] : []));
  return state.units.filter(target => target.side !== side && !target.destroyed && !target.embarkedInUnitId
    && !target.inStrategicReserves && !surveilled.has(target.id)
    && context.battleUnitsWithinBaseEdgeRange(unit, target, 18)
    && context.hasAnyModelLOSConsideringHidden(state, unit, target)).map(target => target.id);
}

export function vanguardOperationTerrainIsValid(state: BattleState, unit: BattleUnit, side: Side, terrainId: string, context: TargetedMissionActionContext): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  return !!terrain && context.terrainWithinOpponentTerritory(state, terrain, side)
    && context.terrainAreaIdsContainingUnit(state, unit).includes(terrainId)
    && !state.units.some(candidate => candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId
      && !candidate.inStrategicReserves && context.terrainAreaIdsContainingUnit(state, candidate).includes(terrainId));
}

export function vanguardOperationTerrainOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): string[] {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || missionName !== 'Vanguard Operation' || !context.canStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  return unit ? state.terrain.filter(terrain => vanguardOperationTerrainIsValid(state, unit, side, terrain.id, context)).map(terrain => terrain.id) : [];
}

export function boobyTrapTerrainIsValid(state: BattleState, unit: BattleUnit, side: Side, terrainId: string, context: TargetedMissionActionContext): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  if (!terrain || !context.terrainAreaIdsContainingUnit(state, unit).includes(terrainId)) return false;
  const homeRole = side === 0 ? 'home-0' : 'home-1';
  const eligibleObjectiveTerrain = context.objectiveIndexesWithinRange(state, unit, context.rulesForState(state)).some(index =>
    !!state.objectives[index] && context.terrainContainsObjective(state, terrain, index) && terrain.objectiveRole !== homeRole);
  return eligibleObjectiveTerrain || context.terrainIsOutsideDeploymentZone(state, terrain, side);
}

export function boobyTrapTerrainOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): string[] {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || missionName !== 'Death Trap' || state.phase !== 'shooting' || !context.canStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const trapped = new Set([...(state.missionState?.operationMarkers ?? []).filter(marker => marker.side === side && marker.sourceActionId === 'booby-trap').flatMap(marker => marker.terrainId ? [marker.terrainId] : []),
    ...(state.missionEvents?.completedActionsThisTurn ?? []).filter(event => event.side === side && event.actionId === 'booby-trap').flatMap(event => event.targetTerrainId ? [event.targetTerrainId] : [])]);
  return state.terrain.filter(terrain => !trapped.has(terrain.id) && boobyTrapTerrainIsValid(state, unit, side, terrain.id, context)).map(terrain => terrain.id);
}

export function removeOpponentOperationMarkersAfterMove(state: BattleState, unit: BattleUnit, context: TargetedMissionActionContext): void {
  const missionName = state.setup?.primaryMissions?.[unit.side] ?? state.setup?.primaryMission;
  if (state.ruleset?.edition !== '11e' || missionName !== 'Surveil the Foe') return;
  const objectives = new Set(context.objectiveIndexesWithinRange(state, unit, context.rulesForState(state)));
  if (!objectives.size) return;
  const markers = state.missionState?.operationMarkers ?? [];
  const removed = markers.filter(marker => marker.side !== unit.side && marker.objectiveIndex !== undefined && objectives.has(marker.objectiveIndex));
  if (!removed.length) return;
  state.missionState!.operationMarkers = markers.filter(marker => !removed.includes(marker));
  state.log = [...state.log, context.log(state, unit.side, unit.profile.name,
    `${unit.profile.name} removes ${removed.length} enemy operation marker${removed.length === 1 ? '' : 's'} after ending a move within objective range.`, 'info')];
}

export function punishmentCondemnedUnitOptions(state: BattleState, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): string[] {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission;
  if (rules.metadata.edition !== '11e' || missionName !== 'Punishment' || state.phase !== 'command' || state.activeArmy !== side) return [];
  const enemies = state.units.filter(unit => unit.side !== side && !unit.destroyed && !unit.embarkedInUnitId
    && !unit.inStrategicReserves && unit.modelPositions.length > 0);
  const previousDestroyers = new Set(state.missionEvents?.lastCompletedTurn?.destroyingUnitIds ?? []);
  const eligible = enemies.filter(unit => context.objectiveIndexesWithinRange(state, unit, rules).length > 0 || previousDestroyers.has(unit.id));
  return (eligible.length ? eligible : enemies).map(unit => unit.id);
}

export function togglePunishmentCondemnedUnit(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): BattleState {
  if (!punishmentCondemnedUnitOptions(state, side, rules, context).includes(unitId)) return state;
  const current = state.missionState?.condemnedUnitIds?.[side] ?? [];
  const alreadySelected = current.includes(unitId);
  if (!alreadySelected && current.length >= 3) return state;
  const next = context.clone(state);
  next.missionState ??= {};
  const selections: [string[], string[]] = next.missionState.condemnedUnitIds ?? [[], []];
  selections[side] = alreadySelected ? selections[side].filter(id => id !== unitId) : [...selections[side], unitId];
  next.missionState.condemnedUnitIds = selections;
  const unit = next.units.find(candidate => candidate.id === unitId)!;
  next.log = [...next.log, context.log(next, side, next.armies[side].name,
    `${unit.profile.name} is ${alreadySelected ? 'no longer condemned' : 'condemned'} by ${next.armies[side].name}.`, 'info')];
  return next;
}

export function autoSelectPunishmentCondemnedUnits(state: BattleState, side: Side, rules: RulesEdition, context: TargetedMissionActionContext): void {
  const unitIds = punishmentCondemnedUnitOptions(state, side, rules, context).slice(0, 3);
  if (!unitIds.length) return;
  state.missionState ??= {};
  const selections: [string[], string[]] = state.missionState.condemnedUnitIds ?? [[], []];
  selections[side] = unitIds;
  state.missionState.condemnedUnitIds = selections;
  state.log = [...state.log, context.log(state, side, state.armies[side].name,
    `${state.armies[side].name} condemns ${unitIds.map(id => state.units.find(unit => unit.id === id)?.profile.name ?? id).join(', ')}.`, 'info')];
}

export function cleanseObjectiveOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: SecondaryMissionActionOptionsContext): number[] {
  if (rules.metadata.edition !== '11e' || !context.hasActiveSecondaryMission(state, side, 'Cleanse') || !context.canStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const used = completedOrInProgressObjectiveTargets(state, side, 'cleanse');
  return context.objectiveIndexesWithinRange(state, unit, rules).filter(index => !used.has(index));
}

export function plunderTerrainOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: SecondaryMissionActionOptionsContext): string[] {
  if (rules.metadata.edition !== '11e' || !context.hasActiveSecondaryMission(state, side, 'Plunder') || !context.canStartAction(state, unitId, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return [];
  const used = completedOrInProgressTerrainTargets(state, side, 'plunder');
  return context.terrainAreaIdsContainingUnit(state, unit).filter(terrainId => !used.has(terrainId) && context.terrainIsExplicitlyOutsideTerritory(state, side, terrainId));
}
