import { BATTLE_PHASE, MOVEMENT_STEP, type BeaconWhenDrawnSelection, type BurdenOfTrustWhenDrawnSelection, type Phase, type Position, type SecondaryMissionMode, type SecondaryMissionSelectionValue, type Side, type BattleState, type TemptingTargetWhenDrawnSelection } from '../types/battle';
import type { RulesEdition } from '../engine/rulesEngine';
import { battleRound, maxBattleRounds, setBattleRound } from '../engine/battleRound';
import { gainCommandPhaseCommandPoints } from '../engine/commandPoints';
import { primaryMissionScoringLogs, scorePrimaryMission, scorePrimaryMissionsAtEndOfBattle, scorePrimaryMissionsAtEndOfTurn, securePlayObjective, unsupportedPrimaryMissionScoringLogs, updateObjectiveControl } from '../engine/missionScoring';
import { resolveCommandReroll, useStratagem } from '../engine/stratagems';
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
  consecrateObjective,
  consolidatePlayUnit,
  disembarkPlayUnit,
  embarkPlayUnit,
  fallBackPlayUnit,
  fightPlayUnitWeapon,
  type PlayMeleeAttackSplit,
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
  playFightActivationUnitIds,
  playPhaseCoherencyIssues,
  removePlayCasualtyModels,
  removePlayModels,
  reorganizePlayModelsGrid,
  rotatePlayModels,
  shootPlayUnitWeapon,
  simulateNextPhase,
  selectPlayOverrunFight,
  startPlayFightStep,
  snapShootPlayUnitWeapon,
  startPlayUnitAction,
  togglePunishmentCondemnedUnit,
  undeployPlayUnit,
} from '../engine/simulator';
import { completeMissionEventsForCurrentTurn, startMissionEventsForNewTurn } from '../engine/missionEvents';
import { configureSecondaryMissions, discardSecondaryMission, drawSecondaryMission, selectBeaconUnit, selectBurdenOfTrustGuards, selectSecondaryMissionWhenDrawn, selectTemptingTargetObjective } from '../engine/secondaryMissions';
import { scoreSecondaryMissionsAtEndOfTurn, secondaryMissionScoringLogs } from '../engine/secondaryMissionScoring';

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

export const GAME_ACTION_TYPE = {
  PlaceUnit: 'play.placeUnit',
  PlaceReinforcement: 'play.placeReinforcement',
  PlaceStrategicReserveUnit: 'play.placeStrategicReserveUnit',
  UndeployUnit: 'play.undeployUnit',
  MoveModels: 'play.moveModels',
  MoveModelsVertically: 'play.moveModelsVertically',
  AdvanceUnit: 'play.advanceUnit',
  FallBackUnit: 'play.fallBackUnit',
  CompleteUnitMovement: 'play.completeUnitMovement',
  EmbarkUnit: 'play.embarkUnit',
  DisembarkUnit: 'play.disembarkUnit',
  RotateModels: 'play.rotateModels',
  ReorganizeModels: 'play.reorganizeModels',
  RemoveModels: 'play.removeModels',
  RemoveCasualties: 'play.removeCasualties',
  AssignWoundedModel: 'play.assignWoundedModel',
  AllocateDamage: 'play.allocateDamage',
  ShootUnitWeapon: 'play.shootUnitWeapon',
  SnapShootUnitWeapon: 'play.snapShootUnitWeapon',
  LockUnitShooting: 'play.lockUnitShooting',
  ChargeUnitTarget: 'play.chargeUnitTarget',
  FightUnitWeapon: 'play.fightUnitWeapon',
  StartFightStep: 'play.startFightStep',
  SelectOverrunFight: 'play.selectOverrunFight',
  PileInUnit: 'play.pileInUnit',
  ConsolidateUnit: 'play.consolidateUnit',
  BeginBattle: 'play.beginBattle',
  StepPhase: 'play.stepPhase',
  UseStratagem: 'play.useStratagem',
  ResolveCommandReroll: 'play.resolveCommandReroll',
  UseUnitAbility: 'play.useUnitAbility',
  StartAction: 'play.startAction',
  ConsecrateObjective: 'mission.consecrateObjective',
  SecureObjective: 'play.secureObjective',
  ToggleCondemnedUnit: 'play.toggleCondemnedUnit',
  ConfigureSecondaryMissions: 'mission.configureSecondaryMissions',
  DrawSecondaryMission: 'mission.drawSecondaryMission',
  DiscardSecondaryMission: 'mission.discardSecondaryMission',
  SelectSecondaryMissionWhenDrawn: 'mission.selectSecondaryMissionWhenDrawn',
  SelectTemptingTargetObjective: 'mission.selectTemptingTargetObjective',
  SelectBeaconUnit: 'mission.selectBeaconUnit',
  SelectBurdenOfTrustGuards: 'mission.selectBurdenOfTrustGuards',
  SimulationPlaceNextUnit: 'simulation.placeNextUnit',
  SimulationStepPhase: 'simulation.stepPhase',
} as const;

export type GameAction =
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.PlaceUnit;
      side: Side;
      unitIndex: number;
      position: Position;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.PlaceReinforcement;
      side: Side;
      armyUnitIndex: number;
      position: Position;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.PlaceStrategicReserveUnit;
      side: Side;
      unitId: string;
      position: Position;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.UndeployUnit;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.MoveModels;
      parts: ModelSelectionPart[];
      dx: number;
      dy: number;
      collide: boolean;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.MoveModelsVertically;
      parts: ModelSelectionPart[];
      dz: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.FallBackUnit;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.AdvanceUnit;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.CompleteUnitMovement;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.EmbarkUnit;
      side: Side;
      unitId: string;
      transportUnitId?: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.DisembarkUnit;
      side: Side;
      transportUnitId: string;
      passengerUnitId?: string;
      armyUnitIndex?: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.RotateModels;
      parts: ModelSelectionPart[];
      degrees: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ReorganizeModels;
      parts: ModelSelectionPart[];
      rows: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.RemoveModels;
      parts: ModelSelectionPart[];
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.RemoveCasualties;
      parts: ModelSelectionPart[];
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.AssignWoundedModel;
      side: Side;
      unitId: string;
      modelIndex: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.AllocateDamage;
      side: Side;
      unitId: string;
      modelIndex: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ShootUnitWeapon;
      side: Side;
      unitId: string;
      targetUnitId: string;
      weaponIndex: number | 'all';
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SnapShootUnitWeapon;
      side: Side;
      unitId: string;
      targetUnitId: string;
      weaponIndex: number | 'all';
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.LockUnitShooting;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ChargeUnitTarget;
      side: Side;
      unitId: string;
      targetUnitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.FightUnitWeapon;
      side: Side;
      unitId: string;
      targetUnitId: string;
      weaponIndex: number | 'all';
      targetSplits?: PlayMeleeAttackSplit[];
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.StartFightStep;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SelectOverrunFight;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.PileInUnit;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ConsolidateUnit;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.BeginBattle;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.StepPhase;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.UseStratagem;
      side: Side;
      stratagemId: string;
      targetUnitId?: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ResolveCommandReroll;
      side: Side;
      originalRolls: number[];
      sides?: number;
      label?: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.UseUnitAbility;
      side: Side;
      unitId: string;
      abilityId: string;
      timing: AbilityTiming;
      targetUnitId?: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.StartAction;
      side: Side;
      unitId: string;
      actionId?: string;
      actionName?: string;
      targetObjectiveIndex?: number;
      targetTerrainId?: string;
      targetOperationMarkerId?: string;
      targetUnitId?: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ToggleCondemnedUnit;
      side: Side;
      unitId: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ConsecrateObjective;
      side: Side;
      unitId: string;
      objectiveIndex: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SecureObjective;
      side: Side;
      objectiveIndex: number;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.ConfigureSecondaryMissions;
      side: Side;
      mode: SecondaryMissionMode;
      missionNames: string[];
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.DrawSecondaryMission;
      side: Side;
      missionName: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.DiscardSecondaryMission;
      side: Side;
      missionName: string;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SelectSecondaryMissionWhenDrawn;
      side: Side;
      missionName: string;
      selections: Record<string, SecondaryMissionSelectionValue>;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SelectTemptingTargetObjective;
      side: Side;
      selection: TemptingTargetWhenDrawnSelection;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SelectBeaconUnit;
      side: Side;
      selection: BeaconWhenDrawnSelection;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SelectBurdenOfTrustGuards;
      side: Side;
      selection: BurdenOfTrustWhenDrawnSelection;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SimulationPlaceNextUnit;
    })
  | (GameActionBase & {
      type: typeof GAME_ACTION_TYPE.SimulationStepPhase;
    });

export interface GameActionContext {
  rules: RulesEdition;
}

const PLAY_TURN_PHASES: Phase[] = [
  BATTLE_PHASE.Command,
  BATTLE_PHASE.Movement,
  BATTLE_PHASE.Shooting,
  BATTLE_PHASE.Charge,
  BATTLE_PHASE.Fight,
];
const LEGACY_PLAY_ACTION_PREFIX = 'man' + 'ual.';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stepPlayPhase(state: BattleState, rules: RulesEdition): BattleState {
  if (state.phase === BATTLE_PHASE.Fight && rules.metadata.edition === '11e') {
    if (state.fightStepStarted === false) return startPlayFightStep(state, rules);
    if (playFightActivationUnitIds(state, 0, rules).length || playFightActivationUnitIds(state, 1, rules).length) return state;
  }
  const next = clone(state);
  if (next.winner !== null || next.phase === BATTLE_PHASE.Deployment || next.phase === BATTLE_PHASE.End) return next;
  if (playPhaseCoherencyIssues(next).length > 0) return next;
  if (next.phase !== BATTLE_PHASE.Movement || movementStep(next) === MOVEMENT_STEP.Reinforcements) {
    updateObjectiveControl(next, rules);
  }

  const startCommand = (): void => {
    next.phase = BATTLE_PHASE.Command;
    next.movementStep = undefined;
    next.fightStepStarted = undefined;
    next.engagedUnitIdsAtFightStepStart = undefined;
    next.lastFightSelectionSide = undefined;
    next.units.forEach(unit => {
      unit.overrunFightSelected = undefined;
      unit.overrunPiledIn = undefined;
    });
    startMissionEventsForNewTurn(next, rules);
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
      unit.rapidIngressThisPhase = undefined;
      unit.heroicInterventionThisPhase = undefined;
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
  if (phaseBeforeStep === BATTLE_PHASE.Command) {
    const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
    const result = scorePrimaryMission(next, scoringSide, rules);
    const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
    next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, [result])];
  }
  if (phaseBeforeStep === BATTLE_PHASE.Fight) {
    completeEndOfTurnActions(next, scoringSide);
    const secondaryRecords = scoreSecondaryMissionsAtEndOfTurn(next, scoringSide, rules);
    next.log = [...next.log, ...secondaryMissionScoringLogs(next, secondaryRecords)];
    const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
    const results = scorePrimaryMissionsAtEndOfTurn(next, scoringSide, rules);
    const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
    next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, results)];
    completeMissionEventsForCurrentTurn(next);
  }
  if (currentIndex < 0) {
    startCommand();
  } else if (currentIndex < PLAY_TURN_PHASES.length - 1) {
    if (next.phase === BATTLE_PHASE.Movement) {
      if (movementStep(next) === MOVEMENT_STEP.MoveUnits) {
        markRemainingStationaryUnits(next);
        next.movementStep = MOVEMENT_STEP.Reinforcements;
      } else {
        next.movementStep = undefined;
        next.phase = PLAY_TURN_PHASES[currentIndex + 1];
      }
    } else {
      next.phase = PLAY_TURN_PHASES[currentIndex + 1];
      if (next.phase === BATTLE_PHASE.Fight) {
        next.fightStepStarted = false;
        next.engagedUnitIdsAtFightStepStart = undefined;
        next.lastFightSelectionSide = undefined;
      }
      if (next.phase === BATTLE_PHASE.Movement) next.movementStep = MOVEMENT_STEP.MoveUnits;
      else next.movementStep = undefined;
    }
  } else if (next.activeArmy === 0) {
    next.activeArmy = 1;
    startCommand();
  } else {
    next.activeArmy = 0;
    setBattleRound(next, battleRound(next) + 1);
    if (battleRound(next) > maxBattleRounds(next)) next.phase = BATTLE_PHASE.End;
    else startCommand();
  }

  if (next.phase === BATTLE_PHASE.End) {
    next.movementStep = undefined;
    const recordCount = next.missionState?.primaryMissionScoringRecords?.length ?? 0;
    const results = scorePrimaryMissionsAtEndOfBattle(next, rules);
    const records = next.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
    next.log = [...next.log, ...primaryMissionScoringLogs(next, records), ...unsupportedPrimaryMissionScoringLogs(next, results)];
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
    case GAME_ACTION_TYPE.PlaceUnit:
      return placePlayUnit(state, normalizedAction.side, normalizedAction.unitIndex, normalizedAction.position);

    case GAME_ACTION_TYPE.PlaceReinforcement:
      return placePlayReinforcement(state, normalizedAction.side, normalizedAction.armyUnitIndex, normalizedAction.position);

    case GAME_ACTION_TYPE.PlaceStrategicReserveUnit:
      return placePlayStrategicReserveUnit(state, normalizedAction.side, normalizedAction.unitId, normalizedAction.position);

    case GAME_ACTION_TYPE.UndeployUnit:
      return undeployPlayUnit(state, normalizedAction.unitId, normalizedAction.side);

    case GAME_ACTION_TYPE.MoveModels:
      return normalizedAction.parts.reduce(
        (next, part) => movePlayModels(next, part.unitId, part.side, part.modelIndices, normalizedAction.dx, normalizedAction.dy, normalizedAction.collide),
        state,
      );

    case GAME_ACTION_TYPE.MoveModelsVertically:
      return normalizedAction.parts.reduce(
        (next, part) => movePlayModelsVertically(next, part.unitId, part.side, part.modelIndices, normalizedAction.dz),
        state,
      );

    case GAME_ACTION_TYPE.FallBackUnit:
      return fallBackPlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case GAME_ACTION_TYPE.AdvanceUnit:
      return advancePlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case GAME_ACTION_TYPE.CompleteUnitMovement:
      return completePlayUnitMovement(state, normalizedAction.unitId, normalizedAction.side);

    case GAME_ACTION_TYPE.EmbarkUnit:
      return embarkPlayUnit(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.transportUnitId);

    case GAME_ACTION_TYPE.DisembarkUnit:
      return disembarkPlayUnit(
        state,
        normalizedAction.side,
        normalizedAction.transportUnitId,
        normalizedAction.passengerUnitId,
        normalizedAction.armyUnitIndex,
      );

    case GAME_ACTION_TYPE.RotateModels:
      return normalizedAction.parts.reduce(
        (next, part) => rotatePlayModels(next, part.unitId, part.side, part.modelIndices, normalizedAction.degrees),
        state,
      );

    case GAME_ACTION_TYPE.ReorganizeModels:
      return normalizedAction.parts.reduce(
        (next, part) => reorganizePlayModelsGrid(next, part.unitId, part.side, part.modelIndices, normalizedAction.rows),
        state,
      );

    case GAME_ACTION_TYPE.RemoveModels:
      return normalizedAction.parts.reduce(
        (next, part) => removePlayModels(next, part.unitId, part.side, part.modelIndices),
        state,
      );

    case GAME_ACTION_TYPE.RemoveCasualties:
      return normalizedAction.parts.reduce(
        (next, part) => removePlayCasualtyModels(next, part.unitId, part.side, part.modelIndices),
        state,
      );

    case GAME_ACTION_TYPE.AssignWoundedModel:
      return assignPlayWoundedModel(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.modelIndex);

    case GAME_ACTION_TYPE.AllocateDamage:
      return allocatePlayDamageToModel(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.modelIndex);

    case GAME_ACTION_TYPE.ShootUnitWeapon:
      return shootPlayUnitWeapon(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.targetUnitId,
        normalizedAction.weaponIndex,
        context.rules,
      );

    case GAME_ACTION_TYPE.SnapShootUnitWeapon:
      return snapShootPlayUnitWeapon(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.targetUnitId,
        normalizedAction.weaponIndex,
        context.rules,
      );

    case GAME_ACTION_TYPE.LockUnitShooting:
      return lockPlayUnitShooting(state, normalizedAction.unitId, normalizedAction.side);

    case GAME_ACTION_TYPE.ChargeUnitTarget:
      return chargePlayUnitTarget(state, normalizedAction.unitId, normalizedAction.side, normalizedAction.targetUnitId, context.rules);

    case GAME_ACTION_TYPE.FightUnitWeapon:
      return fightPlayUnitWeapon(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.targetUnitId,
        normalizedAction.weaponIndex,
        context.rules,
        normalizedAction.targetSplits,
      );

    case GAME_ACTION_TYPE.StartFightStep:
      return startPlayFightStep(state, context.rules);

    case GAME_ACTION_TYPE.SelectOverrunFight:
      return selectPlayOverrunFight(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case GAME_ACTION_TYPE.PileInUnit:
      return pileInPlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case GAME_ACTION_TYPE.ConsolidateUnit:
      return consolidatePlayUnit(state, normalizedAction.unitId, normalizedAction.side, context.rules);

    case GAME_ACTION_TYPE.BeginBattle:
      return beginPlayBattle(state);

    case GAME_ACTION_TYPE.StepPhase:
      return stepPlayPhase(state, context.rules);

    case GAME_ACTION_TYPE.UseStratagem:
      return useStratagem(state, normalizedAction.side, normalizedAction.stratagemId, context.rules, normalizedAction.targetUnitId);

    case GAME_ACTION_TYPE.ResolveCommandReroll:
      return resolveCommandReroll(state, normalizedAction.side, normalizedAction.originalRolls, {
        sides: normalizedAction.sides,
        label: normalizedAction.label,
      });

    case GAME_ACTION_TYPE.UseUnitAbility:
      return useUnitAbility(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.abilityId,
        normalizedAction.timing,
        context.rules,
        normalizedAction.targetUnitId,
      );

    case GAME_ACTION_TYPE.StartAction:
      return startPlayUnitAction(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.actionId,
        normalizedAction.actionName,
        context.rules,
        normalizedAction.targetObjectiveIndex,
        normalizedAction.targetTerrainId,
        normalizedAction.targetOperationMarkerId,
        normalizedAction.targetUnitId,
      );

    case GAME_ACTION_TYPE.ConsecrateObjective:
      return consecrateObjective(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        normalizedAction.objectiveIndex,
        context.rules,
      );

    case GAME_ACTION_TYPE.SecureObjective:
      return securePlayObjective(state, normalizedAction.objectiveIndex, normalizedAction.side, context.rules);

    case GAME_ACTION_TYPE.ToggleCondemnedUnit:
      return togglePunishmentCondemnedUnit(
        state,
        normalizedAction.unitId,
        normalizedAction.side,
        context.rules,
      );

    case GAME_ACTION_TYPE.ConfigureSecondaryMissions:
      return configureSecondaryMissions(
        state,
        normalizedAction.side,
        normalizedAction.mode,
        normalizedAction.missionNames,
      );

    case GAME_ACTION_TYPE.DrawSecondaryMission:
      return drawSecondaryMission(state, normalizedAction.side, normalizedAction.missionName);

    case GAME_ACTION_TYPE.DiscardSecondaryMission:
      return discardSecondaryMission(state, normalizedAction.side, normalizedAction.missionName);

    case GAME_ACTION_TYPE.SelectSecondaryMissionWhenDrawn:
      return selectSecondaryMissionWhenDrawn(
        state,
        normalizedAction.side,
        normalizedAction.missionName,
        normalizedAction.selections,
      );

    case GAME_ACTION_TYPE.SelectTemptingTargetObjective:
      return selectTemptingTargetObjective(state, normalizedAction.side, normalizedAction.selection);

    case GAME_ACTION_TYPE.SelectBeaconUnit:
      return selectBeaconUnit(state, normalizedAction.side, normalizedAction.selection);

    case GAME_ACTION_TYPE.SelectBurdenOfTrustGuards:
      return selectBurdenOfTrustGuards(state, normalizedAction.side, normalizedAction.selection);

    case GAME_ACTION_TYPE.SimulationPlaceNextUnit:
      return placeNextUnit(state);

    case GAME_ACTION_TYPE.SimulationStepPhase:
      return simulateNextPhase(state, context.rules);
  }
}

export function actionTouchesUnit(action: GameAction, unitId: string): boolean {
  const normalizedAction = normalizeGameAction(action);
  switch (normalizedAction.type) {
    case GAME_ACTION_TYPE.UndeployUnit:
    case GAME_ACTION_TYPE.PlaceStrategicReserveUnit:
    case GAME_ACTION_TYPE.FallBackUnit:
    case GAME_ACTION_TYPE.AdvanceUnit:
    case GAME_ACTION_TYPE.StartAction:
    case GAME_ACTION_TYPE.CompleteUnitMovement:
    case GAME_ACTION_TYPE.EmbarkUnit:
    case GAME_ACTION_TYPE.ChargeUnitTarget:
    case GAME_ACTION_TYPE.PileInUnit:
    case GAME_ACTION_TYPE.ConsolidateUnit:
      return normalizedAction.unitId === unitId;
    case GAME_ACTION_TYPE.FightUnitWeapon:
    case GAME_ACTION_TYPE.SnapShootUnitWeapon:
      return normalizedAction.unitId === unitId
        || normalizedAction.targetUnitId === unitId
        || (normalizedAction.type === GAME_ACTION_TYPE.FightUnitWeapon
          && normalizedAction.targetSplits?.some(split => split.targetUnitId === unitId) === true);
    case GAME_ACTION_TYPE.UseStratagem:
      return normalizedAction.targetUnitId === unitId;
    case GAME_ACTION_TYPE.UseUnitAbility:
      return normalizedAction.unitId === unitId || normalizedAction.targetUnitId === unitId;
    case GAME_ACTION_TYPE.DisembarkUnit:
      return normalizedAction.passengerUnitId === unitId || normalizedAction.transportUnitId === unitId;
    case GAME_ACTION_TYPE.MoveModels:
    case GAME_ACTION_TYPE.MoveModelsVertically:
    case GAME_ACTION_TYPE.RotateModels:
    case GAME_ACTION_TYPE.ReorganizeModels:
    case GAME_ACTION_TYPE.RemoveModels:
      return normalizedAction.parts.some(part => part.unitId === unitId);
    default:
      return false;
  }
}
