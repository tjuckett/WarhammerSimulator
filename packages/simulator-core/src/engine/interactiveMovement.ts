import type { BattleState, BattleUnit, BoardFormat, LogEntry, LogType, Position, Side } from '../types/battle';
import type { UnitProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';
import { boardFormatForId, boardFormatForState } from '../data/boardFormats';
import { zoneFor, pointInDeploymentZone, type DeploymentZone, type DeploymentZoneSource } from './deployment';
import { baseFootprintDistance, baseFootprintIntersectsRect, baseFootprintMaxPointDistance, baseFootprintsOverlap, modelBaseFootprintInches, modelBaseRadiusInches } from './baseSizes';
import { distance as dist, verticalDistance } from './coherency';
import { centroid, translateFormation } from './unitModelState';

/** Shared model-formation geometry used by setup, movement, charge, and formation editing. */
function modelRadius(unit: BattleUnit, modelIndex = 0): number {
  return modelBaseRadiusInches(unit.profile, modelIndex);
}

export interface SingleModelMoveContext {
  clone(state: BattleState): BattleState;
  isModelEditPhase(phase: BattleState['phase']): boolean;
  movementStep(state: BattleState): string;
  modelBaseRadius(unit: BattleUnit, modelIndex: number): number;
  setupDeploymentZoneSource(setup: BattleState['setup']): DeploymentZoneSource;
  canInfiltrate(state: BattleState, side: Side, profile: UnitProfile): boolean;
  infiltratorPlacementIsLegal(state: BattleState, side: Side, profile: UnitProfile, position: Position, modelIndex: number, deployment: DeploymentZoneSource, board: BoardFormat): boolean;
  infiltratorModelsAreOutsideEnemyUnits(state: BattleState, side: Side, profile: UnitProfile, positions: Position[], modelIndices: number[]): boolean;
  modelMoveHasNoBaseOverlap(state: BattleState, unit: BattleUnit, modelIndex: number): boolean;
}

export function moveModel(state: BattleState, unitId: string, modelIndex: number, position: Position, context: SingleModelMoveContext): BattleState {
  const next = context.clone(state);
  if (!context.isModelEditPhase(next.phase)) return next;
  if (next.phase === 'movement' && context.movementStep(next) !== 'moveUnits') return next;
  const unit = next.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !unit.modelPositions[modelIndex]) return next;
  if (next.phase === 'deployment') {
    const board = boardFormatForState(next);
    const radius = context.modelBaseRadius(unit, modelIndex);
    const deployment = context.setupDeploymentZoneSource(next.setup);
    const zone = zoneFor(unit.side, deployment, board);
    const canInfiltrate = context.canInfiltrate(next, unit.side, unit.profile);
    if (!canInfiltrate && !pointInDeploymentZone(position, zone, radius)) return next;
    if (canInfiltrate && !context.infiltratorPlacementIsLegal(next, unit.side, unit.profile, position, modelIndex, deployment, board)) return next;
    if (canInfiltrate && !context.infiltratorModelsAreOutsideEnemyUnits(next, unit.side, unit.profile, [position], [modelIndex])) return next;
  }
  unit.modelPositions[modelIndex] = position;
  unit.position = centroid(unit.modelPositions);
  return context.modelMoveHasNoBaseOverlap(next, unit, modelIndex) ? next : state;
}

export function modelMoveHasNoBaseOverlap(state: BattleState, unit: BattleUnit, modelIndex: number): boolean {
  const model = unit.modelPositions[modelIndex];
  const footprint = modelBaseFootprintInches(unit.profile, modelIndex, unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0);
  return state.units.every(otherUnit => {
    if (otherUnit.destroyed || otherUnit.embarkedInUnitId) return true;
    return otherUnit.modelPositions.every((otherModel, otherModelIndex) => {
      if (otherUnit.id === unit.id && otherModelIndex === modelIndex) return true;
      if (verticalDistance(model, otherModel) > 0.5) return true;
      const otherFootprint = modelBaseFootprintInches(otherUnit.profile, otherModelIndex, otherUnit.modelRotations?.[otherModelIndex] ?? otherUnit.facingDeg ?? 0);
      return !baseFootprintsOverlap(model, footprint, otherModel, otherFootprint);
    });
  });
}

export interface SuperHeavyMobileContext {
  clone(state: BattleState): BattleState;
  movementStep(state: BattleState): string;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  hasRule(unit: BattleUnit, rule: string): boolean;
  log(state: BattleState, side: Side, source: string, message: string, kind: 'move'): LogEntry;
}

export function declareSuperHeavyMobile(state: BattleState, unitId: string, side: Side, context: SuperHeavyMobileContext): BattleState {
  if (state.ruleset.edition !== '11e' || state.phase !== 'movement' || context.movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || existing.inStrategicReserves || existing.movementComplete
    || existing.movementStartPositionsByModel?.some((start, modelIndex) => {
      const current = existing.modelPositions[modelIndex];
      return current && (dist(start, current) > 0.001 || verticalDistance(start, current) > 0.001);
    })
    || context.attachedComponents(state, existing).some(component => component.superHeavyMobile)
    || !context.attachedComponents(state, existing).every(component => context.hasRule(component, 'Super-heavy Walker'))) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  for (const component of context.attachedComponents(next, unit)) component.superHeavyMobile = true;
  next.log = [...next.log, context.log(next, side, unit.profile.name, `${unit.profile.name} declares MOBILE for this move.`, 'move')];
  return next;
}

export interface MovementBudgetContext {
  ensureMovementStartPositions(unit: BattleUnit): void;
  ensureMovementStartRotations(unit: BattleUnit): void;
  ensureMovementAllowanceTotals(unit: BattleUnit): number[];
  modelMovementDistanceFromStart(unit: BattleUnit, modelIndex: number): number;
  modelRotation(unit: BattleUnit, modelIndex: number): number;
  hasKeyword(unit: BattleUnit, keyword: string): boolean;
}

export function budgetAdjustedMove(unit: BattleUnit, modelIndices: number[], dx: number, dy: number, context: MovementBudgetContext): { dx: number; dy: number } {
  const requestedDistance = Math.hypot(dx, dy);
  if (requestedDistance < 0.001) return { dx, dy };
  context.ensureMovementStartPositions(unit);
  context.ensureMovementStartRotations(unit);
  context.ensureMovementAllowanceTotals(unit);
  const pathAware = !!unit.movementPathByModel;
  const moveWithinAllowance = (scale: number) => modelIndices.every(modelIndex => {
    const current = unit.modelPositions[modelIndex];
    const total = unit.movementAllowanceTotalByModel?.[modelIndex] ?? 0;
    const proposed = { x: current.x + dx * scale, y: current.y + dy * scale };
    if (pathAware) {
      const path = unit.movementPathByModel?.[modelIndex] ?? [current];
      const last = path[path.length - 1] ?? current;
      let distance = 0;
      for (let index = 1; index < path.length; index++) {
        distance += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y)
          + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : verticalDistance(path[index - 1], path[index]));
      }
      distance += Math.hypot(proposed.x - last.x, proposed.y - last.y)
        + (unit.takingToSkies && context.hasKeyword(unit, 'fly') ? 0 : verticalDistance(last, proposed));
      return distance <= total + 0.000001;
    }
    const start = unit.movementStartPositionsByModel?.[modelIndex] ?? current;
    const startRotation = unit.movementStartRotationsByModel?.[modelIndex] ?? context.modelRotation(unit, modelIndex);
    return baseFootprintMaxPointDistance(
      start,
      modelBaseFootprintInches(unit.profile, modelIndex, startRotation),
      proposed,
      modelBaseFootprintInches(unit.profile, modelIndex, context.modelRotation(unit, modelIndex)),
    ) <= total + 0.000001;
  });
  if (moveWithinAllowance(1)) return { dx, dy };
  if (pathAware) {
    const scale = Math.min(...modelIndices.map(modelIndex => {
      const total = unit.movementAllowanceTotalByModel?.[modelIndex] ?? 0;
      const remaining = Math.max(0, total - context.modelMovementDistanceFromStart(unit, modelIndex));
      return Math.min(1, remaining / requestedDistance);
    }));
    return { dx: dx * scale, dy: dy * scale };
  }
  const rotationsUnchanged = modelIndices.every(modelIndex =>
    Math.abs((unit.movementStartRotationsByModel?.[modelIndex] ?? context.modelRotation(unit, modelIndex))
      - context.modelRotation(unit, modelIndex)) < 0.001);
  if (rotationsUnchanged) {
    let scale = 1;
    for (const modelIndex of modelIndices) {
      const current = unit.modelPositions[modelIndex];
      const start = unit.movementStartPositionsByModel?.[modelIndex] ?? current;
      const total = unit.movementAllowanceTotalByModel?.[modelIndex] ?? 0;
      const a = dx * dx + dy * dy;
      const b = 2 * ((current.x - start.x) * dx + (current.y - start.y) * dy);
      const c = (current.x - start.x) ** 2 + (current.y - start.y) ** 2 - total * total;
      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0 || a <= 0.000001) { scale = 0; continue; }
      scale = Math.min(scale, Math.max(0, (-b + Math.sqrt(discriminant)) / (2 * a)));
    }
    return { dx: dx * scale, dy: dy * scale };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (moveWithinAllowance(mid)) lo = mid;
    else hi = mid;
  }
  return { dx: dx * lo, dy: dy * lo };
}

export interface MovementCollisionContext {
  clone(state: BattleState): BattleState;
  boardFormatForState(state: BattleState): BoardFormat;
  terrainBlocksMovement(terrain: BattleState['terrain'][number], unit: BattleUnit): boolean;
  featureBlocksMovement(feature: NonNullable<BattleState['terrain'][number]['features']>[number], terrain: BattleState['terrain'][number], unit: BattleUnit): boolean;
  hasNoPathCollision(state: BattleState, unit: BattleUnit, modelIndices: Set<number>, dx: number, dy: number, options: { ignoreEnemyModelPath?: boolean }): boolean;
  inEngagement(state: BattleState, unit: BattleUnit): boolean;
  enemies(state: BattleState, side: Side): BattleUnit[];
  engagementRange(state: BattleState): number;
}

function modelFootprint(unit: BattleUnit, modelIndex: number) {
  return modelBaseFootprintInches(unit.profile, modelIndex, unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0);
}

export function applyHorizontalTranslation(unit: BattleUnit, modelIndices: number[], dx: number, dy: number, board: BoardFormat): void {
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    unit.modelPositions[modelIndex] = {
      ...position,
      x: Math.max(0, Math.min(board.width, position.x + dx)),
      y: Math.max(0, Math.min(board.height, position.y + dy)),
    };
  }
  unit.position = centroid(unit.modelPositions);
}

export function applyVerticalTranslation(unit: BattleUnit, modelIndices: number[], dz: number): void {
  for (const modelIndex of modelIndices) {
    const position = unit.modelPositions[modelIndex];
    unit.modelPositions[modelIndex] = { ...position, z: Math.max(0, (position.z ?? 0) + dz) };
  }
  unit.position = centroid(unit.modelPositions);
}

export function hasNoBaseOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  for (const modelIndex of movingIndices) {
    const model = movingUnit.modelPositions[modelIndex];
    const footprint = modelFootprint(movingUnit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed || otherUnit.embarkedInUnitId) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (otherUnit.id === movingUnit.id && movingIndices.has(otherModelIndex)) continue;
        if (verticalDistance(model, otherUnit.modelPositions[otherModelIndex]) > 0.5) continue;
        if (baseFootprintsOverlap(model, footprint, otherUnit.modelPositions[otherModelIndex], modelFootprint(otherUnit, otherModelIndex))) return false;
      }
    }
  }
  return true;
}

export function hasNoWallOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>, context: MovementCollisionContext): boolean {
  for (const modelIndex of movingIndices) {
    const model = movingUnit.modelPositions[modelIndex];
    const footprint = modelFootprint(movingUnit, modelIndex);
    for (const terrain of state.terrain) {
      if (context.terrainBlocksMovement(terrain, movingUnit) && baseFootprintIntersectsRect(model, footprint, terrain)) return false;
      for (const feature of terrain.features) {
        if (context.featureBlocksMovement(feature, terrain, movingUnit) && baseFootprintIntersectsRect(model, footprint, feature)) return false;
      }
    }
  }
  return true;
}

export function hasNoEndCollision(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>, allowEngagement: boolean, context: MovementCollisionContext): boolean {
  return hasNoBaseOverlap(state, movingUnit, movingIndices)
    && hasNoWallOverlap(state, movingUnit, movingIndices, context)
    && (allowEngagement || !context.inEngagement(state, movingUnit));
}

export function collisionAdjustedMove(
  state: BattleState, unitId: string, side: Side, modelIndices: number[], dx: number, dy: number,
  options: { allowEngagement?: boolean; ignoreEnemyModelPath?: boolean }, context: MovementCollisionContext,
): { dx: number; dy: number } {
  const movingIndices = new Set(modelIndices);
  const candidate = context.clone(state);
  const candidateUnit = candidate.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed);
  if (!candidateUnit) return { dx, dy };
  const board = context.boardFormatForState(state);
  applyHorizontalTranslation(candidateUnit, modelIndices, dx, dy, board);
  const legal = (test: BattleState, testUnit: BattleUnit, moveX: number, moveY: number) =>
    hasNoEndCollision(test, testUnit, movingIndices, !!options.allowEngagement, context)
    && context.hasNoPathCollision(state, state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed)!, movingIndices, moveX, moveY, {
      ignoreEnemyModelPath: !!options.ignoreEnemyModelPath,
    });
  if (legal(candidate, candidateUnit, dx, dy)) return { dx, dy };
  let lo = 0;
  let hi = 1;
  const movingUnit = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed);
  if (!movingUnit) return { dx: 0, dy: 0 };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const test = context.clone(state);
    const testUnit = test.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed);
    if (!testUnit) break;
    applyHorizontalTranslation(testUnit, modelIndices, dx * mid, dy * mid, board);
    if (legal(test, testUnit, dx * mid, dy * mid)) lo = mid;
    else hi = mid;
  }
  return { dx: dx * lo, dy: dy * lo };
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

export interface ModelMovementContext {
  clone(state: BattleState): BattleState;
  isModelEditPhase(phase: BattleState['phase']): boolean;
  movementStep(state: BattleState): string;
  isSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean;
  isAircraft(unit: BattleUnit): boolean;
  aircraftCanMakeNormalMove(state: BattleState): boolean;
  nonAircraftEngagedEnemies(state: BattleState, unit: BattleUnit): BattleUnit[];
  ensureMovementStartPositions(unit: BattleUnit): void;
  ensureMovementStartRotations(unit: BattleUnit): void;
  ensureMovementAllowanceTotals(unit: BattleUnit): number[];
  ensureMovementPaths(unit: BattleUnit): void;
  aircraftMoveIsStraightForward(unit: BattleUnit, modelIndices: number[], dx: number, dy: number): boolean;
  budgetAdjustedMove(unit: BattleUnit, modelIndices: number[], dx: number, dy: number): { dx: number; dy: number };
  translatedMoveEndsInEngagement(state: BattleState, unit: BattleUnit, modelIndices: number[], dx: number, dy: number): boolean;
  collisionAdjustedMove(state: BattleState, unitId: string, side: Side, modelIndices: number[], dx: number, dy: number, allowEngagement: boolean): { dx: number; dy: number };
  unitHasModelOutsideBattlefield(unit: BattleUnit, state: BattleState): boolean;
  moveAircraftToStrategicReserves(state: BattleState, unit: BattleUnit): void;
  applyHorizontalTranslation(unit: BattleUnit, modelIndices: number[], dx: number, dy: number, state: BattleState): void;
  applyVerticalTranslation(unit: BattleUnit, modelIndices: number[], dz: number): void;
  appendMovementWaypoints(unit: BattleUnit, modelIndices: number[]): void;
  cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void;
  inEngagement(state: BattleState, unit: BattleUnit): boolean;
  lockOtherMovedUnits(state: BattleState, unit: BattleUnit): void;
  updateMovementAllowances(unit: BattleUnit): void;
  modelMovementDistanceFromStart(unit: BattleUnit, modelIndex: number): number;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  centroid(positions: Position[]): Position;
}

export function moveModels(
  state: BattleState, unitId: string, side: Side, modelIndices: number[], dx: number, dy: number, collide: boolean, context: ModelMovementContext,
): BattleState {
  const chargeMovement = state.phase === 'charge' && state.pendingChargeMovement?.unitId === unitId && state.pendingChargeMovement?.side === side;
  if (!context.isModelEditPhase(state.phase) && !chargeMovement) return state;
  if (state.phase === 'movement' && context.movementStep(state) !== 'moveUnits') return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || (state.phase === 'setup' && !existing.scoutMoveStarted)) return state;
  if (state.phase === 'movement') {
    if (state.activeArmy !== side || existing.movementComplete || context.isSurgedThisPhase(state, existing) || existing.fellBack
      || existing.movementAction === 'fellBack' || existing.movementAction === 'remainedStationary') return state;
    if (context.isAircraft(existing) && !context.aircraftCanMakeNormalMove(state)) return state;
    if (!context.isAircraft(existing) && context.nonAircraftEngagedEnemies(state, existing).length > 0) return state;
  }
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
  const indices = Array.from(new Set(modelIndices)).filter(index => unit.modelPositions[index]);
  if (!indices.length) return state;
  if (next.phase === 'movement' && context.isAircraft(unit)) {
    context.ensureMovementStartPositions(unit);
    context.ensureMovementStartRotations(unit);
    context.ensureMovementAllowanceTotals(unit);
    if (!context.aircraftMoveIsStraightForward(unit, indices, dx, dy)) return state;
  }
  if (next.phase === 'movement') context.ensureMovementPaths(unit);
  const budget = (next.phase === 'movement' || next.phase === 'setup' || chargeMovement) && !context.isAircraft(unit)
    ? context.budgetAdjustedMove(unit, indices, dx, dy) : { dx, dy };
  if (Math.hypot(budget.dx, budget.dy) < 0.001) return state;
  if ((next.phase === 'movement' || next.phase === 'setup') && context.translatedMoveEndsInEngagement(next, unit, indices, budget.dx, budget.dy)) return state;
  const move = collide ? context.collisionAdjustedMove(next, unitId, side, indices, budget.dx, budget.dy, chargeMovement) : budget;
  if (Math.hypot(move.dx, move.dy) < 0.001) return state;
  if (next.phase === 'movement' && context.isAircraft(unit)) {
    const test = context.clone(next);
    const testUnit = test.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
    for (const index of indices) testUnit.modelPositions[index] = { ...testUnit.modelPositions[index], x: testUnit.modelPositions[index].x + move.dx, y: testUnit.modelPositions[index].y + move.dy };
    testUnit.position = context.centroid(testUnit.modelPositions);
    if (context.unitHasModelOutsideBattlefield(testUnit, next)) {
      context.moveAircraftToStrategicReserves(next, unit);
      return next;
    }
  }
  context.applyHorizontalTranslation(unit, indices, move.dx, move.dy, next);
  if (next.phase === 'movement') context.appendMovementWaypoints(unit, indices);
  context.cancelUnitAction(next, unit, 'it made a move');
  if ((next.phase === 'movement' || next.phase === 'setup') && context.inEngagement(next, unit)) return state;
  if (next.phase === 'movement') {
    context.lockOtherMovedUnits(next, unit);
    unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
  }
  context.updateMovementAllowances(unit);
  return next;
}

export function moveModelsVertically(
  state: BattleState, unitId: string, side: Side, modelIndices: number[], dz: number, context: ModelMovementContext,
): BattleState {
  if (Math.abs(dz) < 0.001) return state;
  const scoutMove = state.phase === 'setup';
  if (!scoutMove && (state.phase !== 'movement' || context.movementStep(state) !== 'moveUnits' || state.activeArmy !== side)) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || (scoutMove && !existing.scoutMoveStarted) || existing.inStrategicReserves || existing.movementComplete || existing.fellBack
    || existing.movementAction === 'fellBack' || existing.movementAction === 'remainedStationary' || context.isAircraft(existing)
    || context.nonAircraftEngagedEnemies(state, existing).length > 0) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
  const indices = Array.from(new Set(modelIndices)).filter(index => unit.modelPositions[index]);
  if (!indices.length) return state;
  context.ensureMovementStartPositions(unit);
  context.ensureMovementStartRotations(unit);
  const totals = context.ensureMovementAllowanceTotals(unit);
  if (next.phase === 'movement') context.ensureMovementPaths(unit);
  const before = unit.modelPositions.map(position => ({ ...position }));
  context.applyVerticalTranslation(unit, indices, dz);
  if (indices.every(index => Math.abs((unit.modelPositions[index].z ?? 0) - (before[index].z ?? 0)) < 0.001)) return state;
  if (next.phase === 'movement') context.appendMovementWaypoints(unit, indices);
  if (indices.some(index => context.modelMovementDistanceFromStart(unit, index) > (totals[index] ?? 0) + 0.001) || context.inEngagement(next, unit)) return state;
  context.lockOtherMovedUnits(next, unit);
  context.cancelUnitAction(next, unit, 'it made a move');
  unit.movementAction = unit.movementAction === 'advanced' ? 'advanced' : 'normalMove';
  context.updateMovementAllowances(unit);
  return next;
}

export function undoUnitMovement(state: BattleState, unitId: string, side: Side, context: ModelMovementContext): BattleState {
  if (state.phase !== 'movement' || context.movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || !context.attachedComponents(state, existing).some(unit => unit.movementStartPositionsByModel?.length === unit.modelPositions.length)) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
  for (const component of context.attachedComponents(next, unit)) {
    if (component.movementStartPositionsByModel?.length !== component.modelPositions.length) continue;
    component.modelPositions = component.movementStartPositionsByModel.map(position => ({ ...position }));
    component.modelRotations = component.movementStartRotationsByModel ? [...component.movementStartRotationsByModel] : undefined;
    component.position = context.centroid(component.modelPositions);
    component.movementAction = undefined;
    component.movementComplete = undefined;
    component.movementAllowanceRemaining = undefined;
    component.movementAllowanceRemainingByModel = undefined;
    component.movementAllowanceTotalByModel = undefined;
    component.movementStartPositionsByModel = undefined;
    component.movementStartRotationsByModel = undefined;
    component.movementPathByModel = undefined;
    component.takingToSkies = undefined;
  }
  return next;
}

export interface AdvanceMovementContext {
  clone(state: BattleState): BattleState;
  movementStep(state: BattleState): string;
  isAircraft(unit: BattleUnit): boolean;
  nonAircraftEngagedEnemies(state: BattleState, unit: BattleUnit): BattleUnit[];
  lockOtherMovedUnits(state: BattleState, unit: BattleUnit): void;
  cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void;
  advanceAllowance(unit: BattleUnit, rules: RulesEdition): { advanceRoll: number; total: number };
  normalMoveAllowance(unit: BattleUnit): number;
  takeToSkiesDistanceCost(unit: BattleUnit): number;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  modelRotation(unit: BattleUnit, modelIndex: number): number;
  createLog(state: BattleState, side: Side, actor: string, message: string): void;
}

export function canAdvance(state: BattleState, unitId: string, side: Side, context: AdvanceMovementContext): boolean {
  if (state.phase !== 'movement' || context.movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.inStrategicReserves || context.isAircraft(unit) || unit.movementComplete || unit.fellBack || !!unit.movementAction
    || typeof unit.movementAllowanceRemaining === 'number' || !!unit.movementAllowanceRemainingByModel || !!unit.movementAllowanceTotalByModel
    || !!unit.movementStartPositionsByModel || !!unit.movementStartRotationsByModel) return false;
  return context.nonAircraftEngagedEnemies(state, unit).length === 0;
}

export function canFallBack(state: BattleState, unitId: string, side: Side, context: AdvanceMovementContext): boolean {
  if (state.phase !== 'movement' || context.movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return false;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit && !unit.inStrategicReserves && !context.isAircraft(unit) && !unit.movementComplete && !unit.movementAction
    && context.nonAircraftEngagedEnemies(state, unit).length > 0;
}

export function advanceUnit(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: AdvanceMovementContext): BattleState {
  if (!canAdvance(state, unitId, side, context)) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  context.lockOtherMovedUnits(next, unit);
  context.cancelUnitAction(next, unit, 'it made an Advance move');
  const advance = context.advanceAllowance(unit, rules);
  for (const component of context.attachedComponents(next, unit)) {
    const total = Math.max(0, context.normalMoveAllowance(component) + advance.advanceRoll + (component.profile.movementOverrides?.advanceModifier ?? 0) - context.takeToSkiesDistanceCost(component));
    component.movementAction = 'advanced';
    component.movementAllowanceRemaining = total;
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => total);
    component.movementAllowanceTotalByModel = component.modelPositions.map(() => total);
    component.movementStartPositionsByModel = component.modelPositions.map(position => ({ ...position }));
    component.movementStartRotationsByModel = component.modelPositions.map((_, index) => context.modelRotation(component, index));
    component.movementComplete = total <= 0.001;
    component.fellBack = false;
  }
  context.createLog(next, side, unit.profile.name, `${unit.profile.name} Advances: ${advance.advanceRoll === 6 && unit.profile.movementOverrides?.advanceRoll === 'auto6' ? 'auto 6' : `rolled ${advance.advanceRoll}`}; movement allowance is ${advance.total.toFixed(0)}\".`);
  return next;
}

export interface FallBackMovementContext {
  advanceContext: AdvanceMovementContext;
  clone(state: BattleState): BattleState;
  engagedEnemies(state: BattleState, unit: BattleUnit, rules: RulesEdition): BattleUnit[];
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  distance(a: Position, b: Position): number;
  takeToSkiesDistanceCost(unit: BattleUnit): number;
  lockOtherMovedUnits(state: BattleState, unit: BattleUnit): void;
  collisionAdjustedMove(
    state: BattleState,
    unitId: string,
    side: Side,
    modelIndices: number[],
    dx: number,
    dy: number,
  ): { dx: number; dy: number };
  enemyCrossingModelIndices(state: BattleState, unit: BattleUnit, modelIndices: Set<number>, dx: number, dy: number): number[];
  applyHorizontalTranslation(unit: BattleUnit, modelIndices: number[], dx: number, dy: number, state: BattleState): void;
  cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void;
  inEngagement(state: BattleState, unit: BattleUnit, rules: RulesEdition): boolean;
  modelRotation(unit: BattleUnit, modelIndex: number): number;
  attachedComponents(state: BattleState, unit: BattleUnit): BattleUnit[];
  removeOpponentOperationMarkersAfterMove(state: BattleState, unit: BattleUnit): void;
  resolveDesperateEscape(
    state: BattleState,
    unit: BattleUnit,
    modelIndices: number[] | undefined,
    onModelsDestroyed: (unit: BattleUnit, modelIndices: number[]) => void,
  ): LogEntry[];
  bestLeadership(state: BattleState, unit: BattleUnit): number;
  d6(): number;
  resolveSuperHeavyMobile(state: BattleState, unit: BattleUnit): void;
  recordDestroyedModels(state: BattleState, unit: BattleUnit, modelIndices: number[], destroyedBySide: Side): void;
  recordDestroyedUnit(state: BattleState, unit: BattleUnit, destroyedBySide: Side): void;
  centroid(positions: Position[]): Position;
  createLog(state: BattleState, side: Side, actor: string, message: string, type: LogType): LogEntry;
}

export function fallBackUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FallBackMovementContext,
): BattleState {
  if (!canFallBack(state, unitId, side, context.advanceContext)) return state;

  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  context.lockOtherMovedUnits(next, unit);

  const engaged = context.engagedEnemies(next, unit, rules);
  const closest = context.nearest(unit, engaged);
  if (!closest) return state;
  const distanceToClosest = context.distance(unit.position, closest.position);
  const direction = distanceToClosest > 0.001
    ? { x: (unit.position.x - closest.position.x) / distanceToClosest, y: (unit.position.y - closest.position.y) / distanceToClosest }
    : { x: side === 0 ? -1 : 1, y: 0 };
  const modelIndices = unit.modelPositions.map((_, modelIndex) => modelIndex);
  const maximumDistance = Math.max(0, unit.profile.move - context.takeToSkiesDistanceCost(unit));
  const move = context.collisionAdjustedMove(next, unitId, side, modelIndices, direction.x * maximumDistance, direction.y * maximumDistance);
  if (Math.hypot(move.dx, move.dy) < 0.01) return state;
  const wasBattleshocked = unit.battleshocked;
  const desperateEscapeModelIndices = unit.battleshocked
    ? undefined
    : context.enemyCrossingModelIndices(next, unit, new Set(modelIndices), move.dx, move.dy);
  const usesDesperateEscape = wasBattleshocked || (desperateEscapeModelIndices?.length ?? 0) > 0;

  context.applyHorizontalTranslation(unit, modelIndices, move.dx, move.dy, next);
  context.cancelUnitAction(next, unit, 'it made a Fall Back move');
  if (context.inEngagement(next, unit, rules)) return state;
  unit.inCombat = false;
  unit.movementAction = 'fellBack';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => context.modelRotation(unit, modelIndex));
  unit.movementComplete = true;
  unit.fellBack = true;
  for (const component of context.attachedComponents(next, unit)) {
    component.lastMovePhase = next.phase;
    component.lastMoveTurn = next.turn;
    component.takingToSkies = undefined;
  }
  context.removeOpponentOperationMarkersAfterMove(next, unit);
  for (const enemy of engaged) enemy.inCombat = context.inEngagement(next, enemy, rules);

  const destroyedBySide = (side === 0 ? 1 : 0) as Side;
  const desperateEscapeLogs = context.resolveDesperateEscape(next, unit, desperateEscapeModelIndices,
    (testedUnit, indices) => context.recordDestroyedModels(next, testedUnit, indices, destroyedBySide));
  const postMoveBattleshockLogs: LogEntry[] = [];
  if (rules.metadata.edition === '11e' && usesDesperateEscape && !wasBattleshocked && !unit.destroyed) {
    const rolls = [context.d6(), context.d6()];
    const roll = rolls[0] + rolls[1];
    const needed = context.bestLeadership(next, unit);
    const passed = roll >= needed;
    for (const component of context.attachedComponents(next, unit)) component.battleshocked = !passed;
    postMoveBattleshockLogs.push(context.createLog(next, unit.side, unit.profile.name,
      `${unit.profile.name} makes a Desperate Escape Battle-shock roll (${needed}+): rolled ${rolls[0]}+${rolls[1]}=${roll} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
      'info'));
  }
  context.resolveSuperHeavyMobile(next, unit);
  if (unit.destroyed) context.recordDestroyedUnit(next, unit, destroyedBySide);
  const moved = Math.hypot(move.dx, move.dy);
  next.log = [...next.log,
    context.createLog(next, side, unit.profile.name, `${unit.profile.name} Falls Back ${moved.toFixed(1)}".`, 'move'),
    ...desperateEscapeLogs,
    ...postMoveBattleshockLogs,
  ];
  if (!unit.destroyed) unit.position = context.centroid(unit.modelPositions);
  return next;
}

export interface CoherencyModelRemovalContext {
  clone(state: BattleState): BattleState;
  movementStep(state: BattleState): string;
  recordDestroyedModels(state: BattleState, unit: BattleUnit, modelIndices: number[], destroyedBySide: Side): void;
  spliceModelIndices(unit: BattleUnit, modelIndices: number[]): void;
  recordDestroyedUnit(state: BattleState, unit: BattleUnit, destroyedBySide: Side): void;
  centroid(positions: Position[]): Position;
  createLog(state: BattleState, side: Side, actor: string, message: string, type: LogType): LogEntry;
}

export function removeModelsForCoherency(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  context: CoherencyModelRemovalContext,
): BattleState {
  const next = context.clone(state);
  if (next.phase !== 'movement' || context.movementStep(next) !== 'moveUnits' || next.activeArmy !== side) return next;
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return next;
  const uniqueIndices = Array.from(new Set(modelIndices))
    .filter(modelIndex => unit.modelPositions[modelIndex])
    .sort((left, right) => right - left);
  if (!uniqueIndices.length) return next;

  context.recordDestroyedModels(next, unit, uniqueIndices, side);
  context.spliceModelIndices(unit, uniqueIndices);
  unit.remainingModels = Math.max(0, unit.remainingModels - uniqueIndices.length);
  unit.destroyed = unit.remainingModels <= 0 || unit.modelPositions.length === 0;
  unit.remainingModels = unit.destroyed ? 0 : Math.min(unit.remainingModels, unit.modelPositions.length);
  if (!unit.destroyed) {
    unit.position = context.centroid(unit.modelPositions);
    if (unit.movementAllowanceRemainingByModel?.length) unit.movementAllowanceRemaining = Math.max(...unit.movementAllowanceRemainingByModel);
  } else {
    unit.movementAllowanceRemaining = 0;
    unit.movementAllowanceRemainingByModel = [];
    unit.movementAllowanceTotalByModel = [];
    unit.movementStartPositionsByModel = [];
    unit.movementStartRotationsByModel = [];
    context.recordDestroyedUnit(next, unit, side);
  }
  next.log = [...next.log, context.createLog(
    next,
    side,
    unit.profile.name,
    `${next.armies[side].name} removes ${uniqueIndices.length} ${unit.profile.name} model${uniqueIndices.length === 1 ? '' : 's'} to restore coherency.`,
    'info',
  )];
  return next;
}

export interface CompleteMovementContext {
  clone(state: BattleState): BattleState;
  movementStep(state: BattleState): string;
  unitLegalityIssues(state: BattleState, unit: BattleUnit): string[];
  markMovementGroupComplete(state: BattleState, unit: BattleUnit): void;
  resolveSuperHeavyMobile(state: BattleState, unit: BattleUnit): void;
}

export function completeUnitMovement(state: BattleState, unitId: string, side: Side, context: CompleteMovementContext): BattleState {
  if (state.phase !== 'movement' || context.movementStep(state) !== 'moveUnits' || state.activeArmy !== side) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || existing.movementComplete || (existing.movementAction !== 'normalMove' && existing.movementAction !== 'advanced')) return state;
  if (context.unitLegalityIssues(state, existing).length > 0) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)!;
  context.markMovementGroupComplete(next, unit);
  context.resolveSuperHeavyMobile(next, unit);
  return next;
}
