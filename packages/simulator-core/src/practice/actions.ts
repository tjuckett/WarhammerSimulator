import type { Phase, Position, Side, BattleState } from '../types/battle';
import type { RulesEdition } from '../engine/rulesEngine';
import { battleRound, maxBattleRounds, setBattleRound } from '../engine/battleRound';
import { gainCommandPhaseCommandPoints } from '../engine/commandPoints';
import {
  advancePlayUnit,
  beginPlayBattle,
  completePlayUnitMovement,
  disembarkPlayUnit,
  embarkPlayUnit,
  fallBackPlayUnit,
  markRemainingStationaryUnits,
  movementStep,
  movePlayModels,
  placePlayReinforcement,
  placePlayUnit,
  placeNextUnit,
  playPhaseCoherencyIssues,
  removePlayModels,
  reorganizePlayModelsGrid,
  rotatePlayModels,
  simulateNextPhase,
  undeployPlayUnit,
} from '../engine/simulator';

export interface GameActionBase {
  id?: string;
  createdAt?: string;
  label?: string;
}

export interface ModelSelectionPart {
  unitId: string;
  side: Side;
  modelIndices: number[];
}

export type GameAction =
  | (GameActionBase & {
      type: 'play.placeUnit';
      side: Side;
      unitIndex: number;
      position: Position;
    })
  | (GameActionBase & {
      type: 'play.placeReinforcement';
      side: Side;
      armyUnitIndex: number;
      position: Position;
    })
  | (GameActionBase & {
      type: 'play.undeployUnit';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.moveModels';
      parts: ModelSelectionPart[];
      dx: number;
      dy: number;
      collide: boolean;
    })
  | (GameActionBase & {
      type: 'play.fallBackUnit';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.advanceUnit';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.completeUnitMovement';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.embarkUnit';
      side: Side;
      unitId: string;
      transportUnitId?: string;
    })
  | (GameActionBase & {
      type: 'play.disembarkUnit';
      side: Side;
      transportUnitId: string;
      passengerUnitId?: string;
      armyUnitIndex?: number;
    })
  | (GameActionBase & {
      type: 'play.rotateModels';
      parts: ModelSelectionPart[];
      degrees: number;
    })
  | (GameActionBase & {
      type: 'play.reorganizeModels';
      parts: ModelSelectionPart[];
      rows: number;
    })
  | (GameActionBase & {
      type: 'play.removeModels';
      parts: ModelSelectionPart[];
    })
  | (GameActionBase & {
      type: 'play.beginBattle';
    })
  | (GameActionBase & {
      type: 'play.stepPhase';
    })
  | (GameActionBase & {
      type: 'simulation.placeNextUnit';
    })
  | (GameActionBase & {
      type: 'simulation.stepPhase';
    });

export interface GameActionContext {
  rules: RulesEdition;
}

const PLAY_TURN_PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];
const LEGACY_PLAY_ACTION_PREFIX = 'man' + 'ual.';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stepPlayPhase(state: BattleState): BattleState {
  const next = clone(state);
  if (next.winner !== null || next.phase === 'deployment' || next.phase === 'end') return next;
  if (playPhaseCoherencyIssues(next).length > 0) return next;

  const startCommand = (): void => {
    next.phase = 'command';
    next.movementStep = undefined;
    for (const unit of next.units) {
      if (unit.side !== next.activeArmy || unit.destroyed) continue;
      unit.activated = false;
      unit.charged = false;
      unit.movementAction = undefined;
      unit.movementAllowanceRemaining = undefined;
      unit.movementAllowanceRemainingByModel = undefined;
      unit.movementComplete = undefined;
      unit.arrivedFromReinforcements = undefined;
      if (unit.emergencyDisembarkedThisTurn) unit.battleshocked = false;
      unit.emergencyDisembarkedThisTurn = undefined;
      unit.fellBack = false;
      unit.inCombat = false;
    }
    gainCommandPhaseCommandPoints(next);
  };

  const currentIndex = PLAY_TURN_PHASES.indexOf(next.phase);
  if (currentIndex < 0) {
    startCommand();
  } else if (currentIndex < PLAY_TURN_PHASES.length - 1) {
    if (next.phase === 'movement') {
      if (movementStep(next) === 'moveUnits') {
        markRemainingStationaryUnits(next);
        next.movementStep = 'reinforcements';
      } else {
        next.movementStep = undefined;
        next.phase = PLAY_TURN_PHASES[currentIndex + 1];
      }
    } else {
      next.phase = PLAY_TURN_PHASES[currentIndex + 1];
      if (next.phase === 'movement') next.movementStep = 'moveUnits';
      else next.movementStep = undefined;
    }
  } else if (next.activeArmy === 0) {
    next.activeArmy = 1;
    startCommand();
  } else {
    next.activeArmy = 0;
    setBattleRound(next, battleRound(next) + 1);
    if (battleRound(next) > maxBattleRounds(next)) next.phase = 'end';
    else startCommand();
  }

  if (next.phase === 'end') {
    next.movementStep = undefined;
    if (next.scores[0] > next.scores[1]) next.winner = 0;
    else if (next.scores[1] > next.scores[0]) next.winner = 1;
    else next.winner = 'draw';
  }

  return next;
}

function normalizeGameAction(action: GameAction): GameAction {
  const actionType = (action as { type: string }).type;
  if (!actionType.startsWith(LEGACY_PLAY_ACTION_PREFIX)) return action;
  return {
    ...action,
    type: `play.${actionType.slice(LEGACY_PLAY_ACTION_PREFIX.length)}`,
  } as GameAction;
}

export function applyGameAction(
  state: BattleState,
  action: GameAction,
  context: GameActionContext,
): BattleState {
  const normalizedAction = normalizeGameAction(action);
  switch (normalizedAction.type) {
    case 'play.placeUnit':
      return placePlayUnit(state, normalizedAction.side, normalizedAction.unitIndex, normalizedAction.position);

    case 'play.placeReinforcement':
      return placePlayReinforcement(state, normalizedAction.side, normalizedAction.armyUnitIndex, normalizedAction.position);

    case 'play.undeployUnit':
      return undeployPlayUnit(state, normalizedAction.unitId, normalizedAction.side);

    case 'play.moveModels':
      return normalizedAction.parts.reduce(
        (next, part) => movePlayModels(next, part.unitId, part.side, part.modelIndices, normalizedAction.dx, normalizedAction.dy, normalizedAction.collide),
        state,
      );

    case 'play.fallBackUnit':
      return fallBackPlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case 'play.advanceUnit':
      return advancePlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case 'play.completeUnitMovement':
      return completePlayUnitMovement(state, normalizedAction.unitId, normalizedAction.side);

    case 'play.embarkUnit':
      return embarkPlayUnit(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.transportUnitId);

    case 'play.disembarkUnit':
      return disembarkPlayUnit(
        state,
        normalizedAction.side,
        normalizedAction.transportUnitId,
        normalizedAction.passengerUnitId,
        normalizedAction.armyUnitIndex,
      );

    case 'play.rotateModels':
      return normalizedAction.parts.reduce(
        (next, part) => rotatePlayModels(next, part.unitId, part.side, part.modelIndices, normalizedAction.degrees),
        state,
      );

    case 'play.reorganizeModels':
      return normalizedAction.parts.reduce(
        (next, part) => reorganizePlayModelsGrid(next, part.unitId, part.side, part.modelIndices, normalizedAction.rows),
        state,
      );

    case 'play.removeModels':
      return normalizedAction.parts.reduce(
        (next, part) => removePlayModels(next, part.unitId, part.side, part.modelIndices),
        state,
      );

    case 'play.beginBattle':
      return beginPlayBattle(state);

    case 'play.stepPhase':
      return stepPlayPhase(state);

    case 'simulation.placeNextUnit':
      return placeNextUnit(state);

    case 'simulation.stepPhase':
      return simulateNextPhase(state, context.rules);
  }
}

export function actionTouchesUnit(action: GameAction, unitId: string): boolean {
  const normalizedAction = normalizeGameAction(action);
  switch (normalizedAction.type) {
    case 'play.undeployUnit':
    case 'play.fallBackUnit':
    case 'play.advanceUnit':
    case 'play.completeUnitMovement':
    case 'play.embarkUnit':
      return normalizedAction.unitId === unitId;
    case 'play.disembarkUnit':
      return normalizedAction.passengerUnitId === unitId || normalizedAction.transportUnitId === unitId;
    case 'play.moveModels':
    case 'play.rotateModels':
    case 'play.reorganizeModels':
    case 'play.removeModels':
      return normalizedAction.parts.some(part => part.unitId === unitId);
    default:
      return false;
  }
}
