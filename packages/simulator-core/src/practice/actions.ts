import type { Phase, Position, Side, BattleState } from '../types/battle';
import type { RulesEdition } from '../engine/rulesEngine';
import {
  beginManualBattle,
  moveManualModels,
  placeManualUnit,
  placeNextUnit,
  reorganizeManualModelsGrid,
  rotateManualModels,
  simulateNextPhase,
  undeployManualUnit,
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
      type: 'manual.placeUnit';
      side: Side;
      unitIndex: number;
      position: Position;
    })
  | (GameActionBase & {
      type: 'manual.undeployUnit';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'manual.moveModels';
      parts: ModelSelectionPart[];
      dx: number;
      dy: number;
      collide: boolean;
    })
  | (GameActionBase & {
      type: 'manual.rotateModels';
      parts: ModelSelectionPart[];
      degrees: number;
    })
  | (GameActionBase & {
      type: 'manual.reorganizeModels';
      parts: ModelSelectionPart[];
      rows: number;
    })
  | (GameActionBase & {
      type: 'manual.beginBattle';
    })
  | (GameActionBase & {
      type: 'manual.stepPhase';
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

const MANUAL_TURN_PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stepManualPhase(state: BattleState): BattleState {
  const next = clone(state);
  if (next.winner !== null || next.phase === 'deployment' || next.phase === 'end') return next;

  const currentIndex = MANUAL_TURN_PHASES.indexOf(next.phase);
  if (currentIndex < 0) {
    next.phase = 'command';
  } else if (currentIndex < MANUAL_TURN_PHASES.length - 1) {
    next.phase = MANUAL_TURN_PHASES[currentIndex + 1];
  } else if (next.activeArmy === 0) {
    next.activeArmy = 1;
    next.phase = 'command';
  } else {
    next.activeArmy = 0;
    next.turn++;
    next.phase = next.turn > next.maxTurns ? 'end' : 'command';
  }

  if (next.phase === 'end') {
    if (next.scores[0] > next.scores[1]) next.winner = 0;
    else if (next.scores[1] > next.scores[0]) next.winner = 1;
    else next.winner = 'draw';
  }

  return next;
}

export function applyGameAction(
  state: BattleState,
  action: GameAction,
  context: GameActionContext,
): BattleState {
  switch (action.type) {
    case 'manual.placeUnit':
      return placeManualUnit(state, action.side, action.unitIndex, action.position);

    case 'manual.undeployUnit':
      return undeployManualUnit(state, action.unitId, action.side);

    case 'manual.moveModels':
      return action.parts.reduce(
        (next, part) => moveManualModels(next, part.unitId, part.side, part.modelIndices, action.dx, action.dy, action.collide),
        state,
      );

    case 'manual.rotateModels':
      return action.parts.reduce(
        (next, part) => rotateManualModels(next, part.unitId, part.side, part.modelIndices, action.degrees),
        state,
      );

    case 'manual.reorganizeModels':
      return action.parts.reduce(
        (next, part) => reorganizeManualModelsGrid(next, part.unitId, part.side, part.modelIndices, action.rows),
        state,
      );

    case 'manual.beginBattle':
      return beginManualBattle(state);

    case 'manual.stepPhase':
      return stepManualPhase(state);

    case 'simulation.placeNextUnit':
      return placeNextUnit(state);

    case 'simulation.stepPhase':
      return simulateNextPhase(state, context.rules);
  }
}

export function actionTouchesUnit(action: GameAction, unitId: string): boolean {
  switch (action.type) {
    case 'manual.undeployUnit':
      return action.unitId === unitId;
    case 'manual.moveModels':
    case 'manual.rotateModels':
    case 'manual.reorganizeModels':
      return action.parts.some(part => part.unitId === unitId);
    default:
      return false;
  }
}
