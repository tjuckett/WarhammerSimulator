import type { BattleState, BattleUnit, BoardFormat, Position, Side } from '../types/battle';
import type { UnitProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import { boardFormatForId, boardFormatForState } from '../data/boardFormats';
import { zoneFor, pointInDeploymentZone, type DeploymentZone } from './deployment';
import { baseFootprintDistance, modelBaseRadiusInches } from './baseSizes';
import { distance as dist } from './coherency';
import { centroid, translateFormation } from './unitModelState';

/** Shared model-formation geometry used by setup, movement, charge, and formation editing. */
function modelRadius(unit: BattleUnit, modelIndex = 0): number {
  return modelBaseRadiusInches(unit.profile, modelIndex);
}

export function profileModelRadii(profile: UnitProfile): number[] {
  return Array.from({ length: profile.baseModelCount }, (_, modelIndex) => modelBaseRadiusInches(profile, modelIndex));
}

function gridModelSpacing(radii: number[]): number {
  return Math.max(...radii.map(radius => radius * 2), 1) + 0.08;
}

export function gridFormation(profile: UnitProfile, anchor: Position, side: Side): Position[] {
  const count = profile.baseModelCount;
  if (count <= 1) return [anchor];
  const spacing = gridModelSpacing(profileModelRadii(profile));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const forward = side === 0 ? 1 : -1;
  const startY = anchor.y - ((rows - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, modelIndex) => ({
    x: anchor.x + forward * (modelIndex % columns) * spacing,
    y: startY + Math.floor(modelIndex / columns) * spacing,
  }));
}

export function gridFormationByRows(profile: UnitProfile, center: Position, side: Side, rows: number, modelIndices?: number[]): Position[] {
  const indices = modelIndices?.length ? modelIndices : Array.from({ length: profile.baseModelCount }, (_, index) => index);
  const count = indices.length;
  if (count <= 1) return [center];
  const rowCount = Math.max(1, Math.min(rows, count));
  const columns = Math.ceil(count / rowCount);
  const spacing = gridModelSpacing(indices.map(index => modelBaseRadiusInches(profile, index)));
  const forward = side === 0 ? 1 : -1;
  const startX = center.x - forward * ((columns - 1) * spacing) / 2;
  const startY = center.y - ((rowCount - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, modelIndex) => ({
    x: startX + forward * Math.floor(modelIndex / rowCount) * spacing,
    y: startY + (modelIndex % rowCount) * spacing,
  }));
}

export function clampModelToBoard(point: Position, radius: number, zone?: DeploymentZone, board: BoardFormat = boardFormatForId()): Position {
  const minX = zone ? zone.x0 + radius : radius;
  const maxX = zone ? zone.x1 - radius : board.width - radius;
  return { x: Math.min(maxX, Math.max(minX, point.x)), y: Math.min(board.height - radius, Math.max(radius, point.y)) };
}

export function formationHasInternalOverlap(unit: BattleUnit): boolean {
  return unit.modelPositions.some((position, index) => unit.modelPositions.some((other, otherIndex) =>
    otherIndex > index && dist(position, other) < modelRadius(unit, index) + modelRadius(unit, otherIndex),
  ));
}

export function resolveInternalModelOverlaps(unit: BattleUnit, zone?: DeploymentZone, board: BoardFormat = boardFormatForId()): void {
  const positions = unit.modelPositions.map(position => ({ ...position }));
  for (let pass = 0; pass < 16; pass++) {
    let changed = false;
    for (let index = 0; index < positions.length; index++) {
      for (let otherIndex = index + 1; otherIndex < positions.length; otherIndex++) {
        const radius = modelRadius(unit, index);
        const otherRadius = modelRadius(unit, otherIndex);
        const minimum = radius + otherRadius + 0.02;
        const dx = positions[otherIndex].x - positions[index].x;
        const dy = positions[otherIndex].y - positions[index].y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minimum) continue;
        const angle = distance > 0.001 ? Math.atan2(dy, dx) : ((index + otherIndex) % 8) * (Math.PI / 4);
        const push = (minimum - Math.max(distance, 0.001)) / 2;
        positions[index] = clampModelToBoard({ x: positions[index].x - Math.cos(angle) * push, y: positions[index].y - Math.sin(angle) * push }, radius, zone, board);
        positions[otherIndex] = clampModelToBoard({ x: positions[otherIndex].x + Math.cos(angle) * push, y: positions[otherIndex].y + Math.sin(angle) * push }, otherRadius, zone, board);
        changed = true;
      }
    }
    if (!changed) break;
  }
  unit.modelPositions = positions;
  unit.position = centroid(positions);
}

export function formationOverlapsUnits(unit: BattleUnit, newCenter: Position, state: BattleState): boolean {
  const dx = newCenter.x - unit.position.x;
  const dy = newCenter.y - unit.position.y;
  return state.units.some(other => other.id !== unit.id && !other.destroyed && unit.modelPositions.some((model, modelIndex) =>
    other.modelPositions.some((otherModel, otherModelIndex) =>
      dist({ x: model.x + dx, y: model.y + dy }, otherModel) < modelRadius(unit, modelIndex) + modelRadius(other, otherModelIndex),
    ),
  ));
}

export function avoidModelOverlap(unit: BattleUnit, desired: Position, state: BattleState): Position {
  if (!formationOverlapsUnits(unit, desired, state)) return desired;
  let best = unit.position;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 18; index++) {
    const ratio = (low + high) / 2;
    const candidate = { x: unit.position.x + (desired.x - unit.position.x) * ratio, y: unit.position.y + (desired.y - unit.position.y) * ratio };
    if (formationOverlapsUnits(unit, candidate, state)) high = ratio;
    else { best = candidate; low = ratio; }
  }
  return best;
}

export function formationWithinBounds(unit: BattleUnit, center: Position, zone?: DeploymentZone, board: BoardFormat = boardFormatForId()): boolean {
  const dx = center.x - unit.position.x;
  const dy = center.y - unit.position.y;
  return unit.modelPositions.every((model, modelIndex) => {
    const radius = modelRadius(unit, modelIndex);
    const position = { x: model.x + dx, y: model.y + dy };
    return position.x >= radius && position.x <= board.width - radius && position.y >= radius && position.y <= board.height - radius
      && (!zone || pointInDeploymentZone(position, zone, radius));
  });
}

export function avoidDeploymentOverlap(unit: BattleUnit, state: BattleState, zone: DeploymentZone): void {
  const board = boardFormatForState(state);
  if (!formationHasInternalOverlap(unit) && !formationOverlapsUnits(unit, unit.position, state) && formationWithinBounds(unit, unit.position, zone, board)) return;
  for (let radius = 0.5; radius <= 14; radius += 0.5) {
    for (let angleIndex = 0; angleIndex < 24; angleIndex++) {
      const angle = (angleIndex / 24) * Math.PI * 2;
      const candidate = { x: unit.position.x + Math.cos(angle) * radius, y: unit.position.y + Math.sin(angle) * radius };
      if (!formationWithinBounds(unit, candidate, zone, board) || formationOverlapsUnits(unit, candidate, state)) continue;
      translateFormation(unit, candidate.x - unit.position.x, candidate.y - unit.position.y);
      return;
    }
  }
}

export interface InteractiveMovementStateContext {
  modelRotation(unit: BattleUnit, modelIndex?: number): number;
  modelFootprint(unit: BattleUnit, modelIndex?: number, rotationDeg?: number): unknown;
  movementAllowanceForPlayMove(unit: BattleUnit): number;
  hasKeyword(unit: BattleUnit, keyword: string): boolean;
  verticalDistance(a: Position, b: Position): number;
  baseFootprintMaxPointDistance(
    from: Position,
    fromFootprint: unknown,
    to: Position,
    toFootprint: unknown,
  ): number;
}

export function ensureModelMovementStartPositions(unit: BattleUnit): Position[] {
  if (!unit.movementStartPositionsByModel || unit.movementStartPositionsByModel.length !== unit.modelPositions.length) {
    unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  }
  return unit.movementStartPositionsByModel;
}

export function ensureModelMovementStartRotations(unit: BattleUnit, context: InteractiveMovementStateContext): number[] {
  if (!unit.movementStartRotationsByModel || unit.movementStartRotationsByModel.length !== unit.modelPositions.length) {
    unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => context.modelRotation(unit, modelIndex));
  }
  return unit.movementStartRotationsByModel;
}

export function ensureModelMovementPaths(unit: BattleUnit): Position[][] {
  if (!unit.movementPathByModel || unit.movementPathByModel.length !== unit.modelPositions.length) {
    unit.movementPathByModel = unit.modelPositions.map(position => [{ ...position }]);
  }
  return unit.movementPathByModel;
}

export function appendModelMovementWaypoints(unit: BattleUnit, modelIndices: number[]): void {
  const paths = ensureModelMovementPaths(unit);
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    if (!position) continue;
    const path = paths[modelIndex] ?? (paths[modelIndex] = []);
    const previous = path[path.length - 1];
    if (!previous || Math.hypot(position.x - previous.x, position.y - previous.y) > 0.0001 || Math.abs((position.z ?? 0) - (previous.z ?? 0)) > 0.0001) {
      const beforePrevious = path[path.length - 2];
      if (beforePrevious) {
        const segmentX = previous.x - beforePrevious.x;
        const segmentY = previous.y - beforePrevious.y;
        const positionX = position.x - beforePrevious.x;
        const positionY = position.y - beforePrevious.y;
        const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
        const projection = segmentLengthSquared > 0.000001
          ? (positionX * segmentX + positionY * segmentY) / segmentLengthSquared
          : -1;
        const cross = Math.abs(positionX * segmentY - positionY * segmentX);
        const verticalOnSegment = Math.abs((position.z ?? 0) - (beforePrevious.z ?? 0)) <= 0.0001
          && Math.abs((previous.z ?? 0) - (beforePrevious.z ?? 0)) <= 0.0001;
        if (projection >= -0.0001 && projection <= 1.0001 && cross <= 0.0001 && verticalOnSegment) {
          path[path.length - 1] = { ...position };
          continue;
        }
      }
      path.push({ ...position });
    }
  }
}

export function ensureModelMovementAllowanceTotals(unit: BattleUnit, context: InteractiveMovementStateContext): number[] {
  const allowance = context.movementAllowanceForPlayMove(unit);
  if (!unit.movementAllowanceTotalByModel || unit.movementAllowanceTotalByModel.length !== unit.modelPositions.length) {
    unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => allowance);
  }
  return unit.movementAllowanceTotalByModel;
}

export function modelMovementDistanceFromStart(unit: BattleUnit, modelIndex: number, context: InteractiveMovementStateContext): number {
  const position = unit.modelPositions[modelIndex];
  const path = unit.movementPathByModel?.[modelIndex];
  if (path && path.length > 1) {
    let distance = 0;
    for (let index = 1; index < path.length; index++) {
      distance += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y)
        + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : context.verticalDistance(path[index - 1], path[index]));
    }
    const last = path[path.length - 1];
    if (Math.hypot(position.x - last.x, position.y - last.y) > 0.0001 || Math.abs((position.z ?? 0) - (last.z ?? 0)) > 0.0001) {
      distance += Math.hypot(position.x - last.x, position.y - last.y)
        + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : context.verticalDistance(last, position));
    }
    return distance;
  }
  const start = unit.movementStartPositionsByModel?.[modelIndex] ?? position;
  const startRotation = unit.movementStartRotationsByModel?.[modelIndex] ?? context.modelRotation(unit, modelIndex);
  const currentRotation = context.modelRotation(unit, modelIndex);
  const horizontal = context.baseFootprintMaxPointDistance(
    start,
    context.modelFootprint(unit, modelIndex, startRotation),
    position,
    context.modelFootprint(unit, modelIndex, currentRotation),
  );
  return horizontal + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : context.verticalDistance(start, position));
}

export function refreshModelMovementAllowances(unit: BattleUnit, context: InteractiveMovementStateContext): number[] {
  ensureModelMovementStartPositions(unit);
  ensureModelMovementStartRotations(unit, context);
  const totals = ensureModelMovementAllowanceTotals(unit, context);
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map((_, modelIndex) =>
    Math.max(0, (totals[modelIndex] ?? 0) - modelMovementDistanceFromStart(unit, modelIndex, context)),
  );
  unit.movementAllowanceRemaining = unit.movementAllowanceRemainingByModel.length
    ? Math.max(...unit.movementAllowanceRemainingByModel)
    : 0;
  return unit.movementAllowanceRemainingByModel;
}

export function updateModelMovementAllowances(unit: BattleUnit, context: InteractiveMovementStateContext): void {
  refreshModelMovementAllowances(unit, context);
}

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

export function markMovementGroupComplete(state: BattleState, currentUnit: BattleUnit, context: MovementGroupContext): void {
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

export function scoutMoveValue(profile: UnitProfile): number | null {
  const texts = [...(profile.abilities ?? []).flatMap(rule => [rule.name, rule.description]), ...(profile.rules ?? []).flatMap(rule => [rule.name, rule.description])];
  for (const text of texts) {
    const match = text.match(/\bScouts?\s+(\d+)\s*["â€]?/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function scoutMoveAllowance(state: BattleState, unitId: string, side: Side, context: ScoutMoveContext): number | null {
  if (state.ruleset.edition !== '11e' || state.phase !== 'setup' || state.preBattleAbilitiesResolved) return null;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.inStrategicReserves || unit.scoutMoved || unit.scoutMoveStarted) return null;
  const components = context.attachedComponents(state, unit);
  const values = components.map(component => scoutMoveValue(component.profile));
  if (values.some(candidate => candidate === null) || !context.componentsAreWithinDeploymentZone(state, components, side)) return null;
  return Math.min(...values as number[]);
}

export function startScoutMove(state: BattleState, unitId: string, side: Side, context: ScoutMoveContext): BattleState {
  const moveAllowance = scoutMoveAllowance(state, unitId, side, context);
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

export function completeScoutMove(state: BattleState, unitId: string, side: Side, context: ScoutMoveContext): BattleState {
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

export function surgeMoveTargetUnitIds(state: BattleState, unitId: string, side: Side, context: SurgeMoveContext): string[] {
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

export function grantSurgeMove(
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

export function resolveSurgeMove(
  state: BattleState, unitId: string, side: Side, targetUnitId: string, rules: RulesEdition, context: SurgeMoveContext,
): BattleState {
  const pending = state.pendingSurgeMove;
  if (rules.metadata.edition !== '11e' || !pending || pending.unitId !== unitId || pending.side !== side || pending.triggeredPhase !== state.phase || !surgeMoveTargetUnitIds(state, unitId, side, context).includes(targetUnitId)) return state;
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

export interface TakeToSkiesContext {
  clone(state: BattleState): BattleState;
  getUnit(state: BattleState, unitId: string, side: Side): BattleUnit | undefined;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  isAircraft(unit: BattleUnit): boolean;
  unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  hasFlyKeyword(state: BattleState, unit: BattleUnit): boolean;
  movementCanBegin(state: BattleState, side: Side, unit: BattleUnit): boolean;
  chargeCanBegin(state: BattleState, side: Side, unit: BattleUnit): boolean;
  unitHasStartedCurrentMove(unit: BattleUnit): boolean;
  unitHasHover(unit: BattleUnit): boolean;
  updateMovementAllowances(unit: BattleUnit): void;
  createLog(state: BattleState, side: Side, actor: string, message: string): void;
}

export function canDeclareTakeToSkies(
  state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TakeToSkiesContext,
): boolean {
  if (rules.metadata.edition !== '11e') return false;
  const unit = context.getUnit(state, unitId, side);
  if (!unit || unit.inStrategicReserves || context.isAircraft(unit) || !context.hasFlyKeyword(state, unit)) return false;
  const components = context.attachedComponents(state, unit);
  if (components.some(component => component.takingToSkies || context.unitSurgedThisPhase(state, component))) return false;
  if (state.phase === 'movement') {
    return context.movementCanBegin(state, side, unit)
      && components.every(component => !component.movementComplete && !context.unitHasStartedCurrentMove(component));
  }
  return state.phase === 'charge'
    && context.chargeCanBegin(state, side, unit)
    && components.every(component => !component.activated && !component.charged);
}

export function declareTakeToSkies(
  state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: TakeToSkiesContext,
): BattleState {
  if (!canDeclareTakeToSkies(state, unitId, side, rules, context)) return state;
  const next = context.clone(state);
  const unit = context.getUnit(next, unitId, side)!;
  for (const component of context.attachedComponents(next, unit)) {
    component.takingToSkies = true;
    if (component.movementAllowanceTotalByModel?.length) {
      component.movementAllowanceTotalByModel = component.movementAllowanceTotalByModel.map(total => Math.max(0, total - 2));
      context.updateMovementAllowances(component);
    }
  }
  context.createLog(next, side, unit.profile.name, context.unitHasHover(unit)
    ? `${unit.profile.name} declares Take to the Skies; Hover prevents the -2" maximum-distance cost.`
    : `${unit.profile.name} declares Take to the Skies (-2" maximum distance).`);
  return next;
}

export interface FormationEditContext {
  clone(state: BattleState): BattleState;
  isModelEditPhase(phase: BattleState['phase']): boolean;
  movementStep(state: BattleState): string;
  centroid(positions: Position[]): Position;
  gridFormation(unit: BattleUnit, center: Position, side: Side, rows: number, modelIndices?: number[]): Position[];
  isAircraft(unit: BattleUnit): boolean;
  aircraftCanMakeNormalMove(state: BattleState): boolean;
  ensureMovementStartPositions(unit: BattleUnit): void;
  ensureMovementStartRotations(unit: BattleUnit): void;
  ensureMovementAllowanceTotals(unit: BattleUnit): number[];
  modelRotation(unit: BattleUnit, modelIndex: number): number;
  aircraftPivotWithinLimit(unit: BattleUnit, modelIndices: number[]): boolean;
  movementDistanceFromStart(unit: BattleUnit, modelIndex: number): number;
  lockOtherMovedUnits(state: BattleState, unit: BattleUnit): void;
  updateMovementAllowances(unit: BattleUnit): void;
}

export function reorganizeUnitGrid(
  state: BattleState, unitId: string, side: Side, rows: number, context: FormationEditContext,
): BattleState {
  const next = context.clone(state);
  if (!context.isModelEditPhase(next.phase) || (next.phase === 'movement' && context.movementStep(next) !== 'moveUnits')) return next;
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return next;
  const center = context.centroid(unit.modelPositions);
  unit.modelPositions = context.gridFormation(unit, center, side, rows);
  unit.position = context.centroid(unit.modelPositions);
  return next;
}

export function reorganizeModelsGrid(
  state: BattleState, unitId: string, side: Side, modelIndices: number[], rows: number, context: FormationEditContext,
): BattleState {
  const next = context.clone(state);
  if (!context.isModelEditPhase(next.phase) || (next.phase === 'movement' && context.movementStep(next) !== 'moveUnits')) return next;
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return next;
  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return next;
  const center = context.centroid(uniqueIndices.map(modelIndex => unit.modelPositions[modelIndex]));
  const positions = context.gridFormation(unit, center, side, rows, uniqueIndices);
  uniqueIndices.forEach((modelIndex, index) => { unit.modelPositions[modelIndex] = positions[index]; });
  unit.position = context.centroid(unit.modelPositions);
  return next;
}

export function rotateModels(
  state: BattleState, unitId: string, side: Side, modelIndices: number[], degrees: number, context: FormationEditContext,
): BattleState {
  const next = context.clone(state);
  if (!context.isModelEditPhase(next.phase) || (next.phase === 'movement' && context.movementStep(next) !== 'moveUnits')) return next;
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (!unit) return next;
  const uniqueIndices = Array.from(new Set(modelIndices)).filter(modelIndex => unit.modelPositions[modelIndex]);
  if (!uniqueIndices.length) return next;
  if (next.phase === 'movement') {
    if (next.activeArmy !== side || unit.movementComplete || unit.movementAction === 'remainedStationary') return state;
    if (context.isAircraft(unit) && !context.aircraftCanMakeNormalMove(next)) return state;
    context.ensureMovementStartPositions(unit);
    context.ensureMovementStartRotations(unit);
    context.ensureMovementAllowanceTotals(unit);
  }
  const center = context.centroid(uniqueIndices.map(modelIndex => unit.modelPositions[modelIndex]));
  const radians = degrees * Math.PI / 180;
  const rotations = unit.modelRotations ?? unit.modelPositions.map((_, index) => context.modelRotation(unit, index));
  for (const modelIndex of uniqueIndices) {
    const model = unit.modelPositions[modelIndex];
    const dx = model.x - center.x;
    const dy = model.y - center.y;
    unit.modelPositions[modelIndex] = { x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
    rotations[modelIndex] = ((rotations[modelIndex] ?? unit.facingDeg ?? 0) + degrees) % 360;
  }
  unit.modelRotations = rotations;
  if (uniqueIndices.length === unit.modelPositions.length) unit.facingDeg = ((unit.facingDeg ?? 0) + degrees) % 360;
  unit.position = context.centroid(unit.modelPositions);
  if (next.phase === 'movement' && context.isAircraft(unit)) return context.aircraftPivotWithinLimit(unit, uniqueIndices) ? next : state;
  if (next.phase === 'movement') {
    const totals = context.ensureMovementAllowanceTotals(unit);
    if (uniqueIndices.some(index => context.movementDistanceFromStart(unit, index) > (totals[index] ?? 0) + 0.001)) return state;
    context.lockOtherMovedUnits(next, unit);
    unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
    context.updateMovementAllowances(unit);
  }
  return next;
}
