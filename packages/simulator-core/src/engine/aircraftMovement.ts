import type { BattleState, BattleUnit, LogEntry, Position, Side } from '../types/battle';
import type { RulesEdition } from './rulesEngine';

export interface AircraftMovementContext {
  isAircraft(unit: BattleUnit): boolean;
  modelRotation(unit: BattleUnit, modelIndex: number): number;
  movementDistanceFromStart(unit: BattleUnit, modelIndex: number): number;
  cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void;
  recordUnitLeftBattlefield(state: BattleState, unitId: string): void;
  createLog(state: BattleState, side: Side, actor: string, message: string): LogEntry;
}

export function moveIsStraightForward(unit: BattleUnit, modelIndices: number[], dx: number, dy: number, context: AircraftMovementContext): boolean {
  if (Math.hypot(dx, dy) < 0.001) return false;
  return modelIndices.every(modelIndex => {
    const startRotation = unit.movementStartRotationsByModel?.[modelIndex] ?? context.modelRotation(unit, modelIndex);
    const radians = (startRotation * Math.PI) / 180;
    const forward = { x: Math.cos(radians), y: Math.sin(radians) };
    const parallel = dx * forward.x + dy * forward.y;
    const perpendicular = Math.abs(dx * forward.y - dy * forward.x);
    return parallel > 0 && perpendicular <= 0.01;
  });
}

export function movedMinimumDistance(unit: BattleUnit, context: AircraftMovementContext): boolean {
  if (!context.isAircraft(unit) || unit.inStrategicReserves) return true;
  if (unit.movementAction !== 'normalMove') return false;
  return unit.modelPositions.every((_, modelIndex) => context.movementDistanceFromStart(unit, modelIndex) >= 19.999);
}

function normalizedAngleDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

export function pivotWithinLimit(unit: BattleUnit, modelIndices: number[], context: AircraftMovementContext): boolean {
  return modelIndices.every(modelIndex => {
    const start = unit.movementStartRotationsByModel?.[modelIndex] ?? context.modelRotation(unit, modelIndex);
    return Math.abs(normalizedAngleDelta(context.modelRotation(unit, modelIndex), start)) <= 90.001;
  });
}

export function moveToStrategicReserves(state: BattleState, unit: BattleUnit, context: AircraftMovementContext): void {
  context.cancelUnitAction(state, unit, 'it left the battlefield');
  context.recordUnitLeftBattlefield(state, unit.id);
  unit.inStrategicReserves = true;
  unit.modelPositions = [];
  unit.modelRotations = [];
  unit.position = { x: 0, y: 0 };
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = [];
  unit.movementAllowanceTotalByModel = [];
  unit.movementStartPositionsByModel = [];
  unit.movementStartRotationsByModel = [];
  unit.movementComplete = true;
  unit.inCombat = false;
  state.log = [...state.log, context.createLog(
    state,
    unit.side,
    unit.profile.name,
    `${unit.profile.name} leaves the battlefield and is placed into Strategic Reserves.`,
  )];
}

export function returnOpponentAircraftToStrategicReserves(
  state: BattleState,
  activeSide: Side,
  rules: RulesEdition,
  context: AircraftMovementContext,
): void {
  if (rules.metadata.edition !== '11e') return;
  for (const unit of state.units.filter(candidate =>
    candidate.side !== activeSide && context.isAircraft(candidate) && !candidate.destroyed && !candidate.inStrategicReserves,
  )) {
    for (const component of state.units.filter(candidate => candidate.id === unit.id || candidate.attachedToUnitId === unit.id)) {
      if (!component.destroyed && !component.inStrategicReserves) moveToStrategicReserves(state, component, context);
    }
  }
}
