import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { UnitProfile } from '../types/army';

export interface ScoutMoveContext {
  clone(state: BattleState): BattleState;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  componentsAreWithinDeploymentZone(state: BattleState, components: BattleUnit[], side: Side): boolean;
  componentsAreTooCloseToEnemy(state: BattleState, components: BattleUnit[], side: Side): boolean;
  componentsHaveMoveCollision(state: BattleState, components: BattleUnit[]): boolean;
  componentsAreCoherent(state: BattleState, components: BattleUnit[]): boolean;
  modelRotation(unit: BattleUnit, modelIndex: number): number;
  createLog(state: BattleState, side: Side, actor: string, message: string): void;
}

export function value(profile: UnitProfile): number | null {
  const texts = [...(profile.abilities ?? []).flatMap(rule => [rule.name, rule.description]), ...(profile.rules ?? []).flatMap(rule => [rule.name, rule.description])];
  for (const text of texts) {
    const match = text.match(/\bScouts?\s+(\d+)\s*["”]?/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function allowance(state: BattleState, unitId: string, side: Side, context: ScoutMoveContext): number | null {
  if (state.ruleset.edition !== '11e' || state.phase !== 'setup' || state.preBattleAbilitiesResolved) return null;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.inStrategicReserves || unit.scoutMoved || unit.scoutMoveStarted) return null;
  const components = context.attachedComponents(state, unit);
  const values = components.map(component => value(component.profile));
  if (values.some(candidate => candidate === null) || !context.componentsAreWithinDeploymentZone(state, components, side)) return null;
  return Math.min(...values as number[]);
}

export function start(state: BattleState, unitId: string, side: Side, context: ScoutMoveContext): BattleState {
  const moveAllowance = allowance(state, unitId, side, context);
  if (moveAllowance === null) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of context.attachedComponents(next, unit)) {
    component.scoutMoveStarted = true;
    component.scoutMoveAllowance = moveAllowance;
    component.movementStartPositionsByModel = component.modelPositions.map(position => ({ ...position }));
    component.movementStartRotationsByModel = component.modelPositions.map((_, modelIndex) => context.modelRotation(component, modelIndex));
    component.movementAllowanceTotalByModel = component.modelPositions.map(() => moveAllowance);
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => moveAllowance);
    component.movementAllowanceRemaining = moveAllowance;
  }
  context.createLog(next, side, unit.profile.name, `${unit.profile.name} begins a Scouts ${moveAllowance}" Normal move.`);
  return next;
}

export function complete(state: BattleState, unitId: string, side: Side, context: ScoutMoveContext): BattleState {
  if (state.phase !== 'setup' || state.preBattleAbilitiesResolved) return state;
  const existing = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!existing || !existing.scoutMoveStarted) return state;
  const components = context.attachedComponents(state, existing);
  if (context.componentsAreTooCloseToEnemy(state, components, side) || context.componentsHaveMoveCollision(state, components) || !context.componentsAreCoherent(state, components)) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of context.attachedComponents(next, unit)) {
    component.scoutMoveStarted = undefined;
    component.scoutMoveAllowance = undefined;
    component.scoutMoved = true;
    component.movementAllowanceRemaining = undefined;
    component.movementAllowanceRemainingByModel = undefined;
    component.movementAllowanceTotalByModel = undefined;
    component.movementStartPositionsByModel = undefined;
    component.movementStartRotationsByModel = undefined;
    component.movementPathByModel = undefined;
  }
  context.createLog(next, side, unit.profile.name, `${unit.profile.name} completes its Scouts move.`);
  return next;
}
