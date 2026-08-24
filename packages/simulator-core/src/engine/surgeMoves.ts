import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface SurgeMoveContext {
  clone(state: BattleState): BattleState;
  getUnit(state: BattleState, unitId: string, side: Side): BattleUnit | undefined;
  enemies(state: BattleState, side: Side): BattleUnit[];
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  attachedUnitId(unit: BattleUnit): string;
  attachedUnitHasFly(state: BattleState, unit: BattleUnit): boolean;
  isAircraft(unit: BattleUnit): boolean;
  unitDistance(state: BattleState, from: BattleUnit, to: BattleUnit): number;
  unitMovedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  unitHasStartedCurrentMove(unit: BattleUnit): boolean;
  inEngagement(unit: BattleUnit, enemies: BattleUnit[], range: number): boolean;
  moveTowardTarget(state: BattleState, unit: BattleUnit, target: BattleUnit, maximumDistance: number, rules: RulesEdition): void;
  unitHasCollision(state: BattleState, unit: BattleUnit): boolean;
  battleHasCoherencyIssues(state: BattleState, side: Side): boolean;
  cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void;
  createLog(state: BattleState, side: Side, actor: string, message: string): void;
}

export function targetUnitIds(state: BattleState, unitId: string, side: Side, context: SurgeMoveContext): string[] {
  const pending = state.pendingSurgeMove;
  const unit = context.getUnit(state, unitId, side);
  if (!pending || pending.unitId !== unitId || pending.side !== side || !unit) return [];
  const candidates = context.enemies(state, side).filter(candidate =>
    !candidate.destroyed && !candidate.embarkedInUnitId && (!context.isAircraft(candidate) || context.attachedUnitHasFly(state, unit)),
  );
  if (!candidates.length) return [];
  const distances = candidates.map(candidate => ({ candidate, distance: context.unitDistance(state, unit, candidate) }));
  const closest = Math.min(...distances.map(entry => entry.distance));
  return distances.filter(entry => entry.distance <= closest + 0.001).map(entry => entry.candidate.id);
}

export function grant(
  state: BattleState, unitId: string, side: Side, maximumDistance: number, source: string, rules: RulesEdition, context: SurgeMoveContext,
): BattleState {
  if (rules.metadata.edition !== '11e' || state.pendingSurgeMove || !Number.isFinite(maximumDistance) || maximumDistance <= 0 || !source.trim()) return state;
  const unit = context.getUnit(state, unitId, side);
  if (!unit) return state;
  const components = context.attachedComponents(state, unit);
  if (components.some(component => component.battleshocked || context.unitMovedThisPhase(state, component) || context.unitHasStartedCurrentMove(component))) return state;
  if (components.some(component => context.inEngagement(component, context.enemies(state, side), rules.engagementRange()))) return state;
  const next = context.clone(state);
  next.pendingSurgeMove = { unitId, side, maximumDistance, source: source.trim(), triggeredPhase: next.phase };
  context.createLog(next, side, unit.profile.name, `${source.trim()} triggers a Surge Move of up to ${maximumDistance}" for ${unit.profile.name}.`);
  return next;
}

export function resolve(
  state: BattleState, unitId: string, side: Side, targetUnitId: string, rules: RulesEdition, context: SurgeMoveContext,
): BattleState {
  const pending = state.pendingSurgeMove;
  if (rules.metadata.edition !== '11e' || !pending || pending.unitId !== unitId || pending.side !== side || pending.triggeredPhase !== state.phase || !targetUnitIds(state, unitId, side, context).includes(targetUnitId)) return state;
  const next = context.clone(state);
  const unit = context.getUnit(next, unitId, side);
  const target = next.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !target) return state;
  const components = context.attachedComponents(next, unit);
  for (const component of components) context.moveTowardTarget(next, component, target, pending.maximumDistance, rules);
  if (components.some(component => context.unitHasCollision(next, component))) return state;
  const otherEnemies = context.enemies(next, side).filter(enemy => context.attachedUnitId(enemy) !== context.attachedUnitId(target));
  if (components.some(component => context.inEngagement(component, otherEnemies, rules.engagementRange())) || context.battleHasCoherencyIssues(next, side)) return state;
  for (const component of components) {
    context.cancelUnitAction(next, component, 'it made a Surge Move');
    component.lastMovePhase = next.phase;
    component.lastMoveTurn = next.turn;
    component.surgeMovePhase = next.phase;
    component.surgeMoveTurn = next.turn;
    component.movementComplete = next.phase === 'movement' ? true : component.movementComplete;
    component.inCombat = context.inEngagement(component, [target], rules.engagementRange());
  }
  target.inCombat = context.inEngagement(target, components, rules.engagementRange());
  next.pendingSurgeMove = undefined;
  context.createLog(next, side, unit.profile.name, `${unit.profile.name} makes a Surge Move toward ${target.profile.name}.`);
  return next;
}
