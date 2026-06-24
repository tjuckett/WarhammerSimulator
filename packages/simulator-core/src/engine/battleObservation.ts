import type { BattleState, Phase, Position, Side } from '../types/battle';
import { battleRound } from './battleRound';
import { battleUnitsBaseEdgeDistance } from './simulator';

export interface UnitObservation {
  id: string;
  side: Side;
  name: string;
  position: Position;
  models: number;
  startingModels: number;
  woundsRemainingEstimate: number;
  objectiveControl: number;
  destroyed: boolean;
  battleshocked: boolean;
  inCombat: boolean;
  movementComplete: boolean;
  performingAction: boolean;
  nearestEnemyDistance: number | null;
  nearestObjectiveDistance: number | null;
}

export interface SideObservation {
  side: Side;
  score: number;
  commandPoints: number;
  unitsAlive: number;
  unitsDestroyed: number;
  modelsAlive: number;
  objectiveControlTotal: number;
}

export interface BattleObservation {
  perspective: Side;
  phase: Phase;
  activeArmy: Side;
  battleRound: number;
  turn: number;
  scores: [number, number];
  commandPoints: [number, number];
  objectiveOwners: (Side | null)[];
  objectives: Position[];
  sides: [SideObservation, SideObservation];
  units: UnitObservation[];
}

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestObjectiveDistance(state: BattleState, position: Position): number | null {
  if (!state.objectives.length) return null;
  return Math.min(...state.objectives.map(objective => distance(position, objective)));
}

function woundsRemainingEstimate(unit: BattleState['units'][number]): number {
  if (unit.destroyed) return 0;
  return Math.max(0, unit.remainingModels * unit.profile.wounds - unit.woundsOnLeadModel);
}

function observeUnit(state: BattleState, unit: BattleState['units'][number]): UnitObservation {
  const enemies = state.units.filter(candidate =>
    candidate.side !== unit.side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId
    && !candidate.inStrategicReserves,
  );
  const nearestEnemyDistance = enemies.length
    ? Math.min(...enemies.map(enemy => battleUnitsBaseEdgeDistance(unit, enemy)))
    : null;
  return {
    id: unit.id,
    side: unit.side,
    name: unit.profile.name,
    position: { ...unit.position },
    models: unit.remainingModels,
    startingModels: unit.profile.baseModelCount,
    woundsRemainingEstimate: woundsRemainingEstimate(unit),
    objectiveControl: unit.profile.oc * unit.remainingModels,
    destroyed: unit.destroyed,
    battleshocked: unit.battleshocked,
    inCombat: unit.inCombat,
    movementComplete: !!unit.movementComplete,
    performingAction: !!unit.performingAction,
    nearestEnemyDistance,
    nearestObjectiveDistance: nearestObjectiveDistance(state, unit.position),
  };
}

function observeSide(state: BattleState, side: Side): SideObservation {
  const units = state.units.filter(unit => unit.side === side);
  const alive = units.filter(unit => !unit.destroyed);
  return {
    side,
    score: state.scores[side],
    commandPoints: state.commandPoints?.[side] ?? 0,
    unitsAlive: alive.length,
    unitsDestroyed: units.length - alive.length,
    modelsAlive: alive.reduce((sum, unit) => sum + unit.remainingModels, 0),
    objectiveControlTotal: alive.reduce((sum, unit) => sum + unit.profile.oc * unit.remainingModels, 0),
  };
}

export function observeBattleState(state: BattleState, perspective: Side = state.activeArmy): BattleObservation {
  return {
    perspective,
    phase: state.phase,
    activeArmy: state.activeArmy,
    battleRound: battleRound(state),
    turn: state.turn,
    scores: [...state.scores],
    commandPoints: state.commandPoints ? [...state.commandPoints] : [0, 0],
    objectiveOwners: [...state.objectiveOwners],
    objectives: state.objectives.map(objective => ({ ...objective })),
    sides: [observeSide(state, 0), observeSide(state, 1)],
    units: state.units.map(unit => observeUnit(state, unit)),
  };
}
