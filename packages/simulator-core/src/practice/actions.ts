import type { Phase, Position, Side, BattleState } from '../types/battle';
import type { RulesEdition } from '../engine/rulesEngine';
import { battleRound, maxBattleRounds, setBattleRound } from '../engine/battleRound';
import { gainCommandPhaseCommandPoints } from '../engine/commandPoints';
import { scorePrimaryMission } from '../engine/missionScoring';
import { useStratagem } from '../engine/stratagems';
import { useUnitAbility } from '../engine/unitAbilities';
import type { AbilityTiming } from '../types/ability';
import {
  advancePlayUnit,
  allocatePlayDamageToModel,
  assignPlayWoundedModel,
  beginPlayBattle,
  chargePlayUnitTarget,
  completePlayUnitMovement,
  completeEndOfTurnActions,
  consolidatePlayUnit,
  disembarkPlayUnit,
  embarkPlayUnit,
  fallBackPlayUnit,
  fightPlayUnitWeapon,
  lockPlayUnitShooting,
  markRemainingStationaryUnits,
  movementStep,
  movePlayModels,
  movePlayModelsVertically,
  pileInPlayUnit,
  placePlayReinforcement,
  placePlayStrategicReserveUnit,
  placePlayUnit,
  placeNextUnit,
  playPhaseCoherencyIssues,
  removePlayCasualtyModels,
  removePlayModels,
  reorganizePlayModelsGrid,
  rotatePlayModels,
  shootPlayUnitWeapon,
  simulateNextPhase,
  snapShootPlayUnitWeapon,
  startPlayUnitAction,
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
      type: 'play.placeStrategicReserveUnit';
      side: Side;
      unitId: string;
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
      type: 'play.moveModelsVertically';
      parts: ModelSelectionPart[];
      dz: number;
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
      type: 'play.removeCasualties';
      parts: ModelSelectionPart[];
    })
  | (GameActionBase & {
      type: 'play.assignWoundedModel';
      side: Side;
      unitId: string;
      modelIndex: number;
    })
  | (GameActionBase & {
      type: 'play.allocateDamage';
      side: Side;
      unitId: string;
      modelIndex: number;
    })
  | (GameActionBase & {
      type: 'play.shootUnitWeapon';
      side: Side;
      unitId: string;
      targetUnitId: string;
      weaponIndex: number | 'all';
    })
  | (GameActionBase & {
      type: 'play.snapShootUnitWeapon';
      side: Side;
      unitId: string;
      targetUnitId: string;
      weaponIndex: number | 'all';
    })
  | (GameActionBase & {
      type: 'play.lockUnitShooting';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.chargeUnitTarget';
      side: Side;
      unitId: string;
      targetUnitId: string;
    })
  | (GameActionBase & {
      type: 'play.fightUnitWeapon';
      side: Side;
      unitId: string;
      targetUnitId: string;
      weaponIndex: number | 'all';
    })
  | (GameActionBase & {
      type: 'play.pileInUnit';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.consolidateUnit';
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: 'play.beginBattle';
    })
  | (GameActionBase & {
      type: 'play.stepPhase';
    })
  | (GameActionBase & {
      type: 'play.useStratagem';
      side: Side;
      stratagemId: string;
      targetUnitId?: string;
    })
  | (GameActionBase & {
      type: 'play.useUnitAbility';
      side: Side;
      unitId: string;
      abilityId: string;
      timing: AbilityTiming;
      targetUnitId?: string;
    })
  | (GameActionBase & {
      type: 'play.startAction';
      side: Side;
      unitId: string;
      actionId?: string;
      actionName?: string;
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

function stepPlayPhase(state: BattleState, rules: RulesEdition): BattleState {
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
      unit.piledIn = undefined;
      unit.consolidated = undefined;
      unit.movementAction = undefined;
      unit.movementAllowanceRemaining = undefined;
      unit.movementAllowanceRemainingByModel = undefined;
      unit.movementAllowanceTotalByModel = undefined;
      unit.movementStartPositionsByModel = undefined;
      unit.movementComplete = undefined;
      unit.arrivedFromReinforcements = undefined;
      unit.actionStartedThisTurn = undefined;
      if (unit.emergencyDisembarkedThisTurn) unit.battleshocked = false;
      unit.emergencyDisembarkedThisTurn = undefined;
      unit.fellBack = false;
      unit.inCombat = false;
    }
    gainCommandPhaseCommandPoints(next);
  };

  const phaseBeforeStep = next.phase;
  const scoringSide = next.activeArmy;
  const currentIndex = PLAY_TURN_PHASES.indexOf(next.phase);
  if (phaseBeforeStep === 'fight') {
    completeEndOfTurnActions(next, scoringSide);
    scorePrimaryMission(next, scoringSide, rules);
  }
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

    case 'play.placeStrategicReserveUnit':
      return placePlayStrategicReserveUnit(state, normalizedAction.side, normalizedAction.unitId, normalizedAction.position);

    case 'play.undeployUnit':
      return undeployPlayUnit(state, normalizedAction.unitId, normalizedAction.side);

    case 'play.moveModels':
      return normalizedAction.parts.reduce(
        (next, part) => movePlayModels(next, part.unitId, part.side, part.modelIndices, normalizedAction.dx, normalizedAction.dy, normalizedAction.collide),
        state,
      );

    case 'play.moveModelsVertically':
      return normalizedAction.parts.reduce(
        (next, part) => movePlayModelsVertically(next, part.unitId, part.side, part.modelIndices, normalizedAction.dz),
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

    case 'play.removeCasualties':
      return normalizedAction.parts.reduce(
        (next, part) => removePlayCasualtyModels(next, part.unitId, part.side, part.modelIndices),
        state,
      );

    case 'play.assignWoundedModel':
      return assignPlayWoundedModel(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.modelIndex);

    case 'play.allocateDamage':
      return allocatePlayDamageToModel(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.modelIndex);

    case 'play.shootUnitWeapon':
      return shootPlayUnitWeapon(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.targetUnitId,
        normalizedAction.weaponIndex,
        context.rules,
      );

    case 'play.snapShootUnitWeapon':
      return snapShootPlayUnitWeapon(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.targetUnitId,
        normalizedAction.weaponIndex,
        context.rules,
      );

    case 'play.lockUnitShooting':
      return lockPlayUnitShooting(state, normalizedAction.unitId, normalizedAction.side);

    case 'play.chargeUnitTarget':
      return chargePlayUnitTarget(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.targetUnitId, context.rules);

    case 'play.fightUnitWeapon':
      return fightPlayUnitWeapon(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.targetUnitId,
        normalizedAction.weaponIndex,
        context.rules,
      );

    case 'play.pileInUnit':
      return pileInPlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case 'play.consolidateUnit':
      return consolidatePlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case 'play.beginBattle':
      return beginPlayBattle(state);

    case 'play.stepPhase':
      return stepPlayPhase(state, context.rules);

    case 'play.useStratagem':
      return useStratagem(state, normalizedAction.side, normalizedAction.stratagemId, context.rules, normalizedAction.targetUnitId);

    case 'play.useUnitAbility':
      return useUnitAbility(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.abilityId,
        normalizedAction.timing,
        context.rules,
        normalizedAction.targetUnitId,
      );

    case 'play.startAction':
      return startPlayUnitAction(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.actionId,
        normalizedAction.actionName,
        context.rules,
      );

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
    case 'play.placeStrategicReserveUnit':
    case 'play.fallBackUnit':
    case 'play.advanceUnit':
    case 'play.startAction':
    case 'play.completeUnitMovement':
    case 'play.embarkUnit':
    case 'play.chargeUnitTarget':
    case 'play.pileInUnit':
    case 'play.consolidateUnit':
      return normalizedAction.unitId === unitId;
    case 'play.fightUnitWeapon':
    case 'play.snapShootUnitWeapon':
      return normalizedAction.unitId === unitId || normalizedAction.targetUnitId === unitId;
    case 'play.useStratagem':
      return normalizedAction.targetUnitId === unitId;
    case 'play.useUnitAbility':
      return normalizedAction.unitId === unitId || normalizedAction.targetUnitId === unitId;
    case 'play.disembarkUnit':
      return normalizedAction.passengerUnitId === unitId || normalizedAction.transportUnitId === unitId;
    case 'play.moveModels':
    case 'play.moveModelsVertically':
    case 'play.rotateModels':
    case 'play.reorganizeModels':
    case 'play.removeModels':
      return normalizedAction.parts.some(part => part.unitId === unitId);
    default:
      return false;
  }
}
