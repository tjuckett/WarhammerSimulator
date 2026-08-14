import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, BattleUnit, Phase, Position, PrimaryMissionScoringRecord, SecondaryMissionScoringRecord, Terrain, TerritoryZoneSet } from '../src/types/battle';
import type { ImportedArmy } from '../src/types/army';
import { rules40K10th, rules40K11th, rulesetMetadataForState } from '../src/engine/rulesEngine';
import { advancePlayUnit, allocatePlayDamageToModel, applyDamage, battleModelIdsWithCoherencyIssues, battleUnitsBaseEdgeDistance, boobyTrapTerrainOptions, chargePlayUnitTarget, cleanseObjectiveOptions, completeEndOfTurnActions, completePlayUnitMovement, consecrateObjectiveOptions, consolidatePlayUnit, decoyObjectiveOptions, disembarkPlayUnit, embarkPlayUnit, extractIntelligenceObjectiveOptions, fallBackPlayUnit, fightPlayUnitWeapon, maintainControlObjectiveOptions, markRemainingStationaryUnits, pileInPlayUnit, placePlayReinforcement, placePlayStrategicReserveUnit, playChargeTargetOptions, playFightActivationUnitIds, playFightWeaponOptions, playMeleeFixedAttackCount, playOverrunFightUnitIds, playPhaseCoherencyIssues, playShootingWeaponOptions, playSnapShootingWeaponOptions, playTransportPassengers, playUnitCanAdvance, playUnitCanConsolidate, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, playUnitCanStartAction, plunderTerrainOptions, punishmentCondemnedUnitOptions, movePlayModels, movePlayModelsVertically, removePlayCasualtyModels, removePlayModels, rotatePlayModels, sabotageObjectiveOptions, selectPlayOverrunFight, sensorSweepOptions, secureAssetObjectiveOptions, shootPlayUnitWeapon, simulateNextPhase, snapShootPlayUnitWeapon, startPlayFightStep, startPlayUnitAction, surveilTargetOptions, targetHasCoverFrom, togglePunishmentCondemnedUnit, transportCapacityRemaining, triangulateObjectiveOptions, vanguardOperationTerrainOptions } from '../src/engine/simulator';
import { localPracticeScenarioRepository } from '../src/practice/scenarioStorage';
import { scenarioFromTimeline } from '../src/practice/scenarios';
import {
  appendTimelineAction,
  appendResolvedTimelineAction,
  createPracticeTimeline,
  currentTimelineState,
  replayTimeline,
  type PracticeTimeline,
} from '../src/practice/timeline';
import { applyGameAction, GAME_ACTION_TYPE, type GameAction } from '../src/practice/actions';
import { getLegalActions } from '../src/engine/legalActions';
import { objectiveControlValue, unitCanBeAffectedByStratagem } from '../src/engine/battleshock';
import { hasLOSEdgeToEdge } from '../src/engine/terrainGeometry';
import { formatPrimaryMissionScoringRecord, formatPrimaryScoringResult, primaryMissionScoringLogs, scorePrimaryMission, scorePrimaryMissionsAtEndOfTurn, updateObjectiveControl } from '../src/engine/missionScoring';
import {
  completeMissionEventsForCurrentTurn,
  recordDestroyedModelMissionEvents,
  recordDestroyedUnitMissionEvent,
  startMissionEventsForNewTurn,
} from '../src/engine/missionEvents';
import { availableStratagems, resolveCommandReroll, useStratagem } from '../src/engine/stratagems';
import { availableUnitAbilities, useUnitAbility } from '../src/engine/unitAbilities';
import { eleventhSetupLabel, TOURNAMENT_MISSIONS } from '../src/engine/missions';
import { ELEVENTH_PRIMARY_MISSION_RULES, ELEVENTH_SECONDARY_MISSION_RULES, eleventhSecondaryMissionRuleForName, type MissionScoringClause } from '../src/data/missionRules';
import { configureSecondaryMissions, discardSecondaryMission, drawSecondaryMission, selectBeaconUnit, selectBurdenOfTrustGuards, selectTemptingTargetObjective } from '../src/engine/secondaryMissions';
import {
  battlefieldCentre,
  battlefieldEdgesAreOpposite,
  battlefieldEdgesWithinRange,
  expansionObjectiveIndexes,
  missionDeploymentZone,
  objectiveRoleForIndex,
  pointWithinMissionTerritory,
  terrainWithinMissionTerritory,
  terrainTerritoryRelation,
  territoryRelationForPoint,
  unitTableQuarter,
  unitWhollyWithinDeploymentZone,
  unitWhollyWithinEnemyTerritory,
  unitWhollyWithinFriendlyTerritory,
  unitWhollyWithinNoMansLand,
  unitWhollyWithinTerrainArea,
  unitWithinBattlefieldCentre,
  unitWithinDeploymentZone,
} from '../src/engine/missionGeometry';
import {
  scoreFixedAssassinationDestroyedModels,
  scoreSecondaryMissionsAtEndOfTurn,
} from '../src/engine/secondaryMissionScoring';

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const emptyArmy: ImportedArmy = {
  name: 'Test Army',
  faction: 'Test',
  units: [],
};

function installStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

function state(phase: Phase, turn = 1): BattleState {
  return {
    ruleset: rulesetMetadataForState(rules40K10th),
    battleRound: turn,
    maxBattleRounds: 5,
    turn,
    maxTurns: 5,
    activeArmy: 0,
    phase,
    winner: null,
    log: [],
    units: [],
    terrain: [],
    armies: [
      { name: 'Blue', faction: 'Test', color: '#00f', army: emptyArmy },
      { name: 'Red', faction: 'Test', color: '#f00', army: emptyArmy },
    ],
    objectives: [],
    objectiveControl: rules40K10th.objectiveControl,
    objectiveOwners: [],
    scores: [0, 0],
    commandPoints: [0, 0],
    unplacedUnits: [[], []],
    deployStrategies: ['Balanced', 'Balanced'],
    setup: {
      missionCode: 'TEST',
      primaryMission: 'Practice',
      deployment: 'Dawn of War',
      terrainLayout: 'Layout 1',
    },
  };
}

function losTestUnit(id: string, side: 0 | 1, position: Position, save = 4): BattleUnit {
  return {
    id,
    side,
    profile: {
      name: id,
      move: 6,
      toughness: 4,
      save,
      wounds: 1,
      leadership: 7,
      oc: 2,
      baseModelCount: 1,
      keywords: ['Infantry'],
      factionKeywords: [],
      weapons: [],
      abilities: [],
    },
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position,
    modelPositions: [position],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
}

function terrainMat(partial: Partial<Terrain> & Pick<Terrain, 'type' | 'x' | 'y' | 'width' | 'height'>): Terrain {
  return {
    id: partial.id ?? 'terrain-1',
    name: partial.name ?? partial.type,
    providesCover: partial.providesCover ?? true,
    difficult: partial.difficult ?? false,
    color: partial.color ?? '#555',
    features: partial.features ?? [],
    ...partial,
  };
}

function verticalTerritories(splitX = 30): TerritoryZoneSet {
  return {
    sides: [
      { polygons: [[{ x: 0, y: 0 }, { x: splitX, y: 0 }, { x: splitX, y: 44 }, { x: 0, y: 44 }]] },
      { polygons: [[{ x: splitX, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 44 }, { x: splitX, y: 44 }]] },
    ],
  };
}

type PrimaryClauseCoverage = {
  missionName: string;
  clause: MissionScoringClause;
};

const PRIMARY_CLAUSE_COVERAGE: PrimaryClauseCoverage[] = ELEVENTH_PRIMARY_MISSION_RULES.flatMap(mission =>
  (mission.scoring ?? []).map(clause => ({ missionName: mission.name, clause })),
);

const PRIMARY_GLOBAL_SCORING_COVERAGE = [
  {
    id: 'round-cap-and-idempotence',
    assertion: '11th primary scoring applies the 15VP round cap across command and turn-end windows idempotently',
  },
  {
    id: 'battle-cap-replay-and-save',
    assertion: '11th primary scoring applies a partial 45VP battle cap and persists its ledger through replay and saves',
  },
  {
    id: 'end-battle-manual-and-simulation-lifecycle',
    assertion: '11th end-of-battle primary clauses score for both players in manual and simulation lifecycles',
  },
] as const;

function scoringPhaseForClause(clause: MissionScoringClause): Phase {
  return clause.timing === 'end-command-phase' ? 'command' : clause.timing === 'end-battle' ? 'end' : 'fight';
}

function scoringRoundForClause(clause: MissionScoringClause): number {
  return clause.rounds === 'any' ? (clause.timing === 'end-battle' ? 5 : 2) : clause.rounds[0];
}

function primaryClauseCoverageState(
  missionName: string,
  clause: MissionScoringClause,
  positive: boolean,
): BattleState {
  const round = scoringRoundForClause(clause);
  const battle = state(scoringPhaseForClause(clause), round);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: [missionName, 'Battlefield Dominance'],
    territoryZones: verticalTerritories(),
  };
  battle.objectives = [
    { x: 10, y: 10 },
    { x: 20, y: 22 },
    { x: 28, y: 12 },
    { x: 36, y: 32 },
    { x: 50, y: 34 },
  ];
  battle.objectiveOwners = battle.objectives.map(() => null);
  battle.terrain = [
    terrainMat({ id: 'home-0', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'central', type: 'ruin', x: 18, y: 20, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'expansion-0', type: 'ruin', x: 26, y: 10, width: 4, height: 4, objectiveRole: 'expansion-0' }),
    terrainMat({ id: 'expansion-1', type: 'ruin', x: 34, y: 30, width: 4, height: 4, objectiveRole: 'expansion-1' }),
    terrainMat({ id: 'home-1', type: 'ruin', x: 48, y: 32, width: 4, height: 4, objectiveRole: 'home-1' }),
    terrainMat({ id: 'trap', type: 'ruin', x: 23, y: 18, width: 4, height: 4 }),
  ];

  if (!positive) {
    if (clause.condition === 'no-enemy-operation-markers') {
      battle.missionState = {
        operationMarkers: [{
          id: 'enemy-marker', side: 1, sourceActionId: 'decoy', placedByUnitId: 'enemy',
          objectiveIndex: 1, position: battle.objectives[1], battleRound: round, turn: round,
        }],
      };
    }
    if (clause.condition === 'no-enemy-units-wholly-within-territory') {
      battle.units = [losTestUnit('enemy-in-territory', 1, { x: 10, y: 10 })];
    }
    const negativeTierCount = clause.kind === 'operation-marker-count-tier'
      ? clause.maximumCount !== undefined ? clause.maximumCount + 1 : Math.max(0, (clause.minimumCount ?? 1) - 1)
      : 0;
    if (negativeTierCount > 0) {
      const sourceActionId = clause.condition === 'consecrated-objectives' ? 'consecrate' : 'triangulate';
      battle.missionState = {
        operationMarkers: Array.from({ length: negativeTierCount }, (_, index) => ({
          id: `negative-tier-${index}`, side: 0, sourceActionId, placedByUnitId: `unit-${index}`,
          objectiveIndex: index, position: battle.objectives[index], battleRound: round, turn: round,
        })),
      };
    }
    if (clause.condition === 'friendly-units-in-three-table-quarters') {
      battle.units = [
        losTestUnit('q1', 0, { x: 5, y: 5 }), losTestUnit('q2', 0, { x: 55, y: 5 }),
        losTestUnit('q3', 0, { x: 5, y: 39 }), losTestUnit('q4', 0, { x: 55, y: 39 }),
      ];
    }
    if (clause.condition === 'friendly-units-in-four-table-quarters') {
      battle.units = [
        losTestUnit('q1', 0, { x: 5, y: 5 }), losTestUnit('q2', 0, { x: 55, y: 5 }),
        losTestUnit('q3', 0, { x: 5, y: 39 }),
      ];
    }
    return battle;
  }

  battle.units = battle.objectives.map((position, index) => losTestUnit(`controller-${index}`, 0, position));
  battle.missionEvents = {
    startOfTurn: {
      activeSide: 0,
      battleRound: round,
      turn: round,
      objectiveOwners: battle.objectives.map(() => null),
      units: [
        {
          unitId: 'enemy-destroyed-0', side: 1, unitName: 'Enemy', remainingModels: 1,
          modelPositions: [{ x: 20, y: 22 }], objectiveIndexesWithinRange: [1], terrainAreaIds: ['trap'],
        },
      ],
    },
    destroyedUnitsThisTurn: Array.from({ length: 3 }, (_, index) => ({
      unitId: `enemy-destroyed-${index}`,
      side: 1,
      unitName: `Enemy ${index}`,
      destroyedBySide: 0,
      destroyedByUnitId: 'controller-1',
      destroyingUnitObjectiveIndexesWithinRange: [1],
      battleRound: round,
      turn: round,
      phase: scoringPhaseForClause(clause),
    })),
    completedActionsThisTurn: [
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'extract-intelligence', actionName: 'Extract Intelligence', targetObjectiveIndex: 1, battleRound: round, turn: round },
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'secure-asset', actionName: 'Secure Asset', targetObjectiveIndex: 1, battleRound: round, turn: round },
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'vanguard-operation', actionName: 'Vanguard Operation', targetTerrainId: 'trap', battleRound: round, turn: round },
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'sensor-sweep', actionName: 'Sensor Sweep', targetObjectiveIndex: 1, battleRound: round, turn: round },
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'surveil', actionName: 'Surveil', targetUnitId: 'removed-enemy', battleRound: round, turn: round },
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'booby-trap', actionName: 'Booby Trap', targetTerrainId: 'trap', battleRound: round, turn: round },
      { side: 0, unitId: 'controller-1', unitName: 'Controller', actionId: 'sabotage', actionName: 'Sabotage', targetObjectiveIndex: 4, objectiveIndexesWithinRange: [4], battleRound: round, turn: round },
    ],
    unitsLeftBattlefieldThisTurn: ['condemned-enemy'],
    lastCompletedTurn: {
      activeSide: 1,
      battleRound: Math.max(1, round - 1),
      turn: Math.max(1, round - 1),
      destroyedUnitCounts: [0, 0],
    },
  };
  battle.missionState = { condemnedUnitIds: [['condemned-enemy'], []] };

  const addMarkers = (sourceActionId: string, count: number, side: 0 | 1 = 0, objectiveIndex = 1) => {
    battle.missionState!.operationMarkers = [
      ...(battle.missionState!.operationMarkers ?? []),
      ...Array.from({ length: count }, (_, index) => ({
        id: `${sourceActionId}-${side}-${index}`,
        side,
        sourceActionId,
        placedByUnitId: `marker-unit-${index}`,
        objectiveIndex: Math.min(objectiveIndex + index, battle.objectives.length - 1),
        position: battle.objectives[Math.min(objectiveIndex + index, battle.objectives.length - 1)],
        battleRound: round,
        turn: round,
      })),
    ];
  };

  if (clause.condition === 'consecrated-objectives') addMarkers('consecrate', clause.minimumCount ?? 1);
  if (clause.condition === 'triangulated-objectives') addMarkers('triangulate', clause.minimumCount ?? 1);
  if (clause.condition === 'enemy-home-objective-consecrated') addMarkers('consecrate', 1, 0, 4);
  if (clause.condition === 'three-operation-markers') addMarkers('extract-intelligence', 3);
  if (clause.condition === 'operation-marker-near-opponent-home-objective') addMarkers('extract-intelligence', 1, 0, 4);
  if (clause.condition === 'operation-markers-near-controlled-central-objectives') addMarkers('maintain-control', 1);
  if (clause.condition === 'decoy-objectives') addMarkers('decoy', 1);
  if (clause.condition === 'four-decoy-objectives') addMarkers('decoy', 4);
  if (clause.condition === 'destroyed-enemy-started-in-trapped-terrain') {
    battle.missionState.operationMarkers = [{
      id: 'trap-marker', side: 0, sourceActionId: 'booby-trap', placedByUnitId: 'controller-1',
      terrainId: 'trap', position: { x: 25, y: 20 }, battleRound: round, turn: round,
    }];
  }
  if (clause.condition === 'only-one-operation-marker-isolated') {
    battle.missionState.operationMarkers = [{
      id: 'own-isolated', side: 0, sourceActionId: 'booby-trap', placedByUnitId: 'controller-1',
      terrainId: 'trap', position: { x: 25, y: 20 }, battleRound: round, turn: round,
    }];
    battle.units.push(losTestUnit('friendly-in-trap', 0, { x: 25, y: 20 }));
  }
  if (clause.condition === 'opponent-operation-marker-isolated') {
    battle.missionState.operationMarkers = [{
      id: 'enemy-isolated', side: 1, sourceActionId: 'decoy', placedByUnitId: 'enemy',
      position: { x: 25, y: 20 }, battleRound: round, turn: round,
    }];
    battle.units.push(losTestUnit('friendly-in-trap', 0, { x: 25, y: 20 }));
  }
  if (clause.condition === 'friendly-units-in-three-table-quarters'
    || clause.condition === 'friendly-units-in-four-table-quarters') {
    const count = clause.condition === 'friendly-units-in-three-table-quarters' ? 3 : 4;
    const positions = [{ x: 5, y: 5 }, { x: 55, y: 5 }, { x: 5, y: 39 }, { x: 55, y: 39 }];
    battle.units = positions.slice(0, count).map((position, index) => losTestUnit(`quarter-${index}`, 0, position));
  }
  return battle;
}

function addStep(timeline: PracticeTimeline, phase: Phase): PracticeTimeline {
  return appendResolvedTimelineAction(timeline, { type: 'play.stepPhase' }, {
    stateBefore: currentTimelineState(timeline),
    stateAfter: state(phase),
  });
}

test('local practice scenario repository keeps checkpoint timelines and branches', async () => {
  installStorage();

  const initial = state('deployment');
  const firstBranch = 'branch-one';
  const gameId = 'game-one';
  const timeline = addStep(addStep(createPracticeTimeline(initial, {
    id: gameId,
    title: 'Practice Game',
  }), 'command'), 'movement');

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline({ ...timeline, cursor: 1 }, {
    id: 'checkpoint-1',
    name: 'Command checkpoint',
    gameId,
    branchId: firstBranch,
    checkpointKind: 'auto-phase',
    sequence: 1,
    timelineCursor: 1,
  }));

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(timeline, {
    id: 'checkpoint-2',
    name: 'Movement checkpoint',
    gameId,
    branchId: firstBranch,
    parentCheckpointId: 'checkpoint-1',
    checkpointKind: 'auto-phase',
    sequence: 2,
    timelineCursor: 2,
  }));

  const loadedFirst = await localPracticeScenarioRepository.loadScenario('checkpoint-1');
  assert.equal(loadedFirst?.timeline.cursor, 1);
  assert.equal(loadedFirst?.timeline.entries.length, 1);
  assert.equal(currentTimelineState(loadedFirst!.timeline).phase, 'command');

  const loadedSecond = await localPracticeScenarioRepository.loadScenario('checkpoint-2');
  assert.equal(loadedSecond?.timeline.cursor, 2);
  assert.equal(loadedSecond?.timeline.entries.length, 2);
  assert.equal(currentTimelineState(loadedSecond!.timeline).phase, 'movement');

  const branchTimeline = addStep(loadedFirst!.timeline, 'shooting');
  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(branchTimeline, {
    id: 'checkpoint-3',
    name: 'Branch checkpoint',
    gameId,
    branchId: 'branch-two',
    parentCheckpointId: 'checkpoint-1',
    checkpointKind: 'play',
    sequence: 3,
    timelineCursor: 2,
  }));

  const summaries = await localPracticeScenarioRepository.listSummaries();
  assert.deepEqual(summaries.map(summary => summary.id), ['checkpoint-1', 'checkpoint-2', 'checkpoint-3']);
  assert.equal(summaries.filter(summary => summary.parentCheckpointId === 'checkpoint-1').length, 2);

  const afterDelete = await localPracticeScenarioRepository.deleteScenarios(['checkpoint-1', 'checkpoint-2', 'checkpoint-3']);
  assert.deepEqual(afterDelete, []);
});

test('battle-shocked units cannot receive stratagems and have zero objective control', () => {
  const battle = state('command');
  const unit = {
    id: 'unit-1',
    side: 0 as const,
    profile: {
      name: 'Test Unit',
      move: 6,
      toughness: 4,
      save: 3,
      wounds: 1,
      leadership: 7,
      oc: 2,
      baseModelCount: 1,
      keywords: [],
      factionKeywords: [],
      weapons: [],
      abilities: [],
    },
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 0 },
    modelPositions: [{ x: 0, y: 0 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: true,
    activated: false,
    destroyed: false,
  };

  battle.units = [unit];

  assert.equal(unitCanBeAffectedByStratagem(unit), false);
  assert.equal(objectiveControlValue(unit), 0);
});

test('stratagem framework spends command points and records the use once per phase', () => {
  const battle = state('shooting');
  battle.commandPoints = [2, 0];

  const first = useStratagem(battle, 0, 'command-reroll', rules40K10th);
  assert.deepEqual(first.commandPoints, [1, 0]);
  assert.equal(first.stratagemUses?.length, 1);
  assert.equal(first.stratagemUses?.[0].stratagemId, 'command-reroll');
  assert.equal(first.stratagemUses?.[0].phase, 'shooting');

  const second = useStratagem(first, 0, 'command-reroll', rules40K10th);
  assert.deepEqual(second.commandPoints, [1, 0]);
  assert.equal(second.stratagemUses?.length, 1);
});

test('Command Re-roll creates and resolves a pending reroll token', () => {
  const battle = state('charge');
  battle.commandPoints = [1, 0];

  const used = useStratagem(battle, 0, 'command-reroll', rules40K10th);
  assert.equal(used.pendingCommandReroll?.side, 0);
  assert.equal(used.pendingCommandReroll?.phase, 'charge');

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const resolved = resolveCommandReroll(used, 0, [1, 2], { label: 'charge roll' });
    assert.equal(resolved.pendingCommandReroll, undefined);
    assert.match(resolved.log.at(-1)?.message ?? '', /Command Re-roll charge roll: \[1, 2\] -> \[6, 6\]/);
  } finally {
    Math.random = originalRandom;
  }
});

test('Command Re-roll can be replayed through practice actions', () => {
  const battle = state('shooting');
  battle.commandPoints = [1, 0];
  const used = useStratagem(battle, 0, 'command-reroll', rules40K10th);

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const replayed = applyGameAction(used, {
      type: 'play.resolveCommandReroll',
      side: 0,
      originalRolls: [6],
      label: 'save roll',
    }, { rules: rules40K10th });
    assert.equal(replayed.pendingCommandReroll, undefined);
    assert.match(replayed.log.at(-1)?.message ?? '', /Command Re-roll save roll: \[6\] -> \[1\]/);
  } finally {
    Math.random = originalRandom;
  }
});

test('stratagem framework blocks battle-shocked target units', () => {
  const battle = state('command');
  battle.commandPoints = [1, 0];
  const target = losTestUnit('blue-1', 0, { x: 10, y: 10 });
  target.battleshocked = true;
  battle.units = [target];
  const rules = {
    ...rules40K10th,
    stratagems: [{
      id: 'test-friendly-buff',
      name: 'Test Friendly Buff',
      cost: 1,
      phases: 'any' as const,
      target: 'friendly-unit' as const,
      description: 'Test stratagem with a friendly unit target.',
    }],
  };

  assert.deepEqual(availableStratagems(battle, 0, rules, target.id), []);
  const next = useStratagem(battle, 0, 'test-friendly-buff', rules, target.id);
  assert.equal(next, battle);
  assert.deepEqual(battle.commandPoints, [1, 0]);
});

test('11th edition preview exposes core stratagems from the rules preview', () => {
  assert.equal(rules40K11th.metadata.status, 'implemented');
  assert.equal(rules40K11th.metadata.rulesVersion, 'preview-core');
  assert.deepEqual(rules40K11th.stratagems.map(stratagem => stratagem.id), [
    'command-reroll',
    'epic-challenge',
    'insane-bravery',
    'explosives',
    'crushing-impact',
    'rapid-ingress',
    'fire-overwatch',
    'smokescreen',
    'heroic-intervention',
    'counteroffensive',
  ]);
  assert.equal(rules40K11th.objectiveControl.kind, 'terrain-area');
});

test('11th edition setup tracks each player primary mission separately', () => {
  const setup = eleventhSetupLabel(TOURNAMENT_MISSIONS[0], 'Layout 1', ['take-and-hold', 'reconnaissance']);

  assert.equal(setup.missionCode, `11E-${TOURNAMENT_MISSIONS[0].code}`);
  assert.deepEqual(setup.forceDispositions, ['take-and-hold', 'reconnaissance']);
  assert.deepEqual(setup.primaryMissions, ['Purge and Secure', 'Reconnaissance Sweep']);
  assert.equal(setup.primaryMission, 'Purge and Secure / Reconnaissance Sweep');
});

test('11th primary mission rules are tracked as missing source placeholders', () => {
  assert.equal(ELEVENTH_PRIMARY_MISSION_RULES.length, 25);
  assert.equal(ELEVENTH_PRIMARY_MISSION_RULES.filter(rule => rule.status === 'implemented').length, 25);
  assert.equal(ELEVENTH_PRIMARY_MISSION_RULES.some(rule => rule.name === "Destroyer's Wrath"), true);
  assert.equal(ELEVENTH_PRIMARY_MISSION_RULES.some(rule => rule.name === 'Vital Link'), true);
});

test('11th secondary mission rules track transcribed scoring text', () => {
  assert.equal(ELEVENTH_SECONDARY_MISSION_RULES.length, 18);
  assert.deepEqual(ELEVENTH_SECONDARY_MISSION_RULES.map(rule => rule.name), [
    'A Grievous Blow',
    'A Tempting Target',
    'Assassination',
    'Beacon',
    'Behind Enemy Lines',
    'Bring It Down',
    'Burden of Trust',
    'Centre Ground',
    'Cleanse',
    'Defend Stronghold',
    'Display of Might',
    'Engage on All Fronts',
    'Forward Position',
    'No Prisoners',
    'Outflank',
    'Overwhelming Force',
    'Plunder',
    "Secure No Man's Land",
  ]);
  assert.equal(ELEVENTH_SECONDARY_MISSION_RULES.every(rule => rule.deck === 'secondary'), true);

  const grievousBlow = eleventhSecondaryMissionRuleForName('A Grievous Blow');
  assert.match(grievousBlow?.scoring[1].sourceText ?? '', /One or more.+5VP/);
  assert.equal(grievousBlow?.scoring[1].maxVp, undefined);

  const assassination = eleventhSecondaryMissionRuleForName('Assassination');
  assert.equal(assassination?.mode, 'fixed-or-tactical');
  assert.equal(assassination?.scoring.length, 3);
  assert.equal(assassination?.scoring[1].relationship, 'cumulative');
  assert.equal(assassination?.scoring[2].relationship, 'or');

  const behindEnemyLines = eleventhSecondaryMissionRuleForName('Behind Enemy Lines');
  assert.equal(behindEnemyLines?.scoring[0].maxVp, 5);
  assert.match(behindEnemyLines?.scoring[0].notes ?? '', /Automatically scored.*deployment-zone/);

  const bringItDown = eleventhSecondaryMissionRuleForName('Bring It Down');
  assert.match(bringItDown?.scoring[1].sourceText ?? '', /One or more.+5VP/);
  assert.equal(bringItDown?.scoring[1].maxVp, undefined);

  const burden = eleventhSecondaryMissionRuleForName('Burden of Trust');
  assert.equal(burden?.scoring[0].maxVp, 5);
  assert.match(burden?.whenDrawn ?? '', /guard/);

  const engage = eleventhSecondaryMissionRuleForName('Engage on All Fronts');
  assert.equal(engage?.mode, 'fixed-or-tactical');
  assert.equal(engage?.scoring.length, 4);
  assert.equal(engage?.scoring[1].relationship, 'exclusive');
  assert.equal(engage?.scoring[3].relationship, 'exclusive');

  const noPrisoners = eleventhSecondaryMissionRuleForName('No Prisoners');
  assert.equal(noPrisoners?.scoring[0].maxVp, 5);

  const outflank = eleventhSecondaryMissionRuleForName('Outflank');
  assert.equal(outflank?.scoring[1].relationship, 'exclusive');

  const overwhelmingForce = eleventhSecondaryMissionRuleForName('Overwhelming Force');
  assert.equal(overwhelmingForce?.scoring[0].maxVp, 5);

  const plunder = eleventhSecondaryMissionRuleForName('Plunder');
  assert.match(plunder?.whenDrawn ?? '', /Cleanse/);

  const secureNoMansLand = eleventhSecondaryMissionRuleForName("Secure No Man's Land");
  assert.match(secureNoMansLand?.scoring[0].sourceText ?? '', /two or more objectives/);
});

test('11th edition preview blocks multiple stratagems targeting the same unit in a phase', () => {
  const battle = state('fight');
  battle.commandPoints = [3, 0];
  const character = losTestUnit('character-1', 0, { x: 10, y: 10 });
  character.profile.keywords = ['Character', 'Infantry'];
  battle.units = [character];

  const challenged = useStratagem(battle, 0, 'epic-challenge', rules40K11th, character.id);
  assert.deepEqual(challenged.commandPoints, [2, 0]);
  assert.equal(challenged.stratagemUses?.length, 1);

  assert.deepEqual(
    availableStratagems(challenged, 0, rules40K11th, character.id).map(stratagem => stratagem.id),
    [],
  );
  const counteredSameTarget = useStratagem(challenged, 0, 'counteroffensive', rules40K11th, character.id);
  assert.equal(counteredSameTarget, challenged);
});

test('11th edition preview Insane Bravery can only be used once per battle', () => {
  const battle = state('command');
  battle.commandPoints = [2, 0];
  const unit = losTestUnit('blue-1', 0, { x: 10, y: 10 });
  battle.units = [unit];

  const first = useStratagem(battle, 0, 'insane-bravery', rules40K11th, unit.id);
  assert.deepEqual(first.commandPoints, [1, 0]);
  assert.equal(first.stratagemUses?.length, 1);

  const nextPhase = { ...first, phase: 'shooting' as Phase };
  const nextCommand = { ...nextPhase, phase: 'command' as Phase };
  const second = useStratagem(nextCommand, 0, 'insane-bravery', rules40K11th, unit.id);
  assert.equal(second, nextCommand);
  assert.deepEqual(second.commandPoints, [1, 0]);
});

test('11th edition preview Insane Bravery clears Battle-shock on its target', () => {
  const battle = state('command');
  battle.commandPoints = [1, 0];
  const unit = losTestUnit('blue-1', 0, { x: 10, y: 10 });
  unit.battleshocked = true;
  battle.units = [unit];

  const next = useStratagem(battle, 0, 'insane-bravery', rules40K11th, unit.id);

  assert.equal(next.units[0].battleshocked, false);
  assert.deepEqual(next.commandPoints, [0, 0]);
  assert.equal(next.stratagemUses?.at(-1)?.stratagemId, 'insane-bravery');
  assert.equal(next.log.at(-1)?.message, 'blue-1 automatically passes its Battle-shock test.');
});

test('11th Fire Overwatch is only available in the opponent Movement phase', () => {
  const battle = state('movement');
  battle.activeArmy = 0;
  battle.commandPoints = [1, 1];
  const overwatcher = losTestUnit('overwatcher', 1, { x: 10, y: 10 });
  overwatcher.profile.weapons = [
    { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
  ];
  battle.units = [overwatcher];

  assert.equal(
    availableStratagems(battle, 1, rules40K11th, overwatcher.id).some(stratagem => stratagem.id === 'fire-overwatch'),
    true,
  );
  assert.equal(
    availableStratagems({ ...battle, activeArmy: 1 }, 1, rules40K11th, overwatcher.id).some(stratagem => stratagem.id === 'fire-overwatch'),
    false,
  );

  const used = useStratagem(battle, 1, 'fire-overwatch', rules40K11th, overwatcher.id);
  assert.deepEqual(used.commandPoints, [1, 0]);
  assert.equal(used.stratagemUses?.at(-1)?.side, 1);
});

test('11th battle round flow starts player turns at Command and advances rounds after both players', () => {
  const battle = state('setup', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.commandPoints = [0, 0];
  battle.units = [
    losTestUnit('blue-1', 0, { x: 10, y: 10 }),
    losTestUnit('red-1', 1, { x: 30, y: 10 }),
  ];

  const blueCommand = simulateNextPhase(battle, rules40K11th);
  assert.equal(blueCommand.phase, 'command');
  assert.equal(blueCommand.activeArmy, 0);
  assert.equal(blueCommand.battleRound, 1);
  assert.equal(blueCommand.turn, 1);
  assert.deepEqual(blueCommand.commandPoints, [1, 1]);

  const blueTurnEnd = { ...blueCommand, phase: 'fight' as Phase, scores: [0, 0] as [number, number] };
  const redSetup = simulateNextPhase(blueTurnEnd, rules40K11th);
  assert.equal(redSetup.phase, 'setup');
  assert.equal(redSetup.activeArmy, 1);
  assert.equal(redSetup.battleRound, 1);
  assert.equal(redSetup.turn, 1);

  const redTurnEnd = { ...redSetup, phase: 'fight' as Phase, scores: [0, 0] as [number, number] };
  const nextRound = simulateNextPhase(redTurnEnd, rules40K11th);
  assert.equal(nextRound.phase, 'setup');
  assert.equal(nextRound.activeArmy, 0);
  assert.equal(nextRound.battleRound, 2);
  assert.equal(nextRound.turn, 2);
});

test('11th command phase grants core CP and resets active player turn state', () => {
  const battle = state('setup', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.commandPoints = [2, 5];
  const blue = losTestUnit('blue-1', 0, { x: 10, y: 10 });
  blue.activated = true;
  blue.charged = true;
  blue.piledIn = true;
  blue.consolidated = true;
  blue.firedWeaponIndices = [0];
  blue.movementAction = 'normalMove';
  blue.movementComplete = true;
  blue.arrivedFromReinforcements = true;
  blue.rapidIngressThisPhase = true;
  blue.heroicInterventionThisPhase = true;
  blue.emergencyDisembarkedThisTurn = true;
  blue.fellBack = true;
  blue.inCombat = true;
  blue.actionStartedThisTurn = true;
  const red = losTestUnit('red-1', 1, { x: 30, y: 10 });
  red.activated = true;
  battle.units = [blue, red];

  const command = simulateNextPhase(battle, rules40K11th);
  const resetBlue = command.units.find(unit => unit.id === blue.id)!;
  const waitingRed = command.units.find(unit => unit.id === red.id)!;

  assert.equal(command.phase, 'command');
  assert.equal(command.movementStep, undefined);
  assert.deepEqual(command.commandPoints, [3, 6]);
  assert.equal(resetBlue.activated, false);
  assert.equal(resetBlue.charged, false);
  assert.equal(resetBlue.piledIn, undefined);
  assert.equal(resetBlue.consolidated, undefined);
  assert.equal(resetBlue.firedWeaponIndices, undefined);
  assert.equal(resetBlue.movementAction, undefined);
  assert.equal(resetBlue.movementComplete, undefined);
  assert.equal(resetBlue.arrivedFromReinforcements, undefined);
  assert.equal(resetBlue.rapidIngressThisPhase, undefined);
  assert.equal(resetBlue.heroicInterventionThisPhase, undefined);
  assert.equal(resetBlue.emergencyDisembarkedThisTurn, undefined);
  assert.equal(resetBlue.fellBack, false);
  assert.equal(resetBlue.inCombat, false);
  assert.equal(resetBlue.actionStartedThisTurn, undefined);
  assert.equal(waitingRed.activated, true);
});

test('11th battle-shock step tests damaged active units and clears healthy units', () => {
  const battle = state('setup', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const failing = losTestUnit('failing', 0, { x: 10, y: 10 });
  failing.profile.wounds = 4;
  failing.woundsOnLeadModel = 1;
  const passing = losTestUnit('passing', 0, { x: 12, y: 10 });
  passing.profile.wounds = 4;
  passing.woundsOnLeadModel = 1;
  const healthy = losTestUnit('healthy', 0, { x: 14, y: 10 });
  healthy.battleshocked = true;
  battle.units = [failing, passing, healthy];

  const originalRandom = Math.random;
  const rolls = [0, 0, 0.99, 0.99];
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const command = simulateNextPhase(battle, rules40K11th);

    assert.equal(command.units.find(unit => unit.id === failing.id)?.battleshocked, true);
    assert.equal(command.units.find(unit => unit.id === passing.id)?.battleshocked, false);
    assert.equal(command.units.find(unit => unit.id === healthy.id)?.battleshocked, false);
    assert.equal(command.log.filter(entry => entry.message.includes('Battle-shock')).length, 2);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th command abilities are only exposed during the Command phase', () => {
  const command = state('command');
  command.ruleset = rulesetMetadataForState(rules40K11th);
  const captain = losTestUnit('captain', 0, { x: 10, y: 10 });
  captain.profile.abilities = [{ name: 'Command Vox', description: 'Command ability.' }];
  command.units = [captain];
  const rules = {
    ...rules40K11th,
    unitAbilities: [{
      id: 'command-vox',
      name: 'Command Vox',
      timing: 'command-phase' as const,
      target: 'self' as const,
      oncePerTurn: true,
      description: 'Test command phase ability.',
    }],
  };

  assert.deepEqual(availableUnitAbilities(command, captain.id, 0, 'command-phase', rules).map(option => option.id), ['command-vox']);

  const used = useUnitAbility(command, captain.id, 0, 'command-vox', 'command-phase', rules);
  assert.equal(used.abilityUses?.at(-1)?.phase, 'command');
  assert.deepEqual(availableUnitAbilities(used, captain.id, 0, 'command-phase', rules), []);

  const movement = { ...command, phase: 'movement' as Phase };
  assert.deepEqual(availableUnitAbilities(movement, captain.id, 0, 'command-phase', rules), []);
});

test('11th battle round flow ends the battle after the second player turn of the final round', () => {
  const battle = state('fight', 5);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.activeArmy = 1;
  battle.scores = [12, 8];
  battle.units = [
    losTestUnit('blue-1', 0, { x: 10, y: 10 }),
    losTestUnit('red-1', 1, { x: 30, y: 10 }),
  ];

  const ended = simulateNextPhase(battle, rules40K11th);

  assert.equal(ended.phase, 'end');
  assert.equal(ended.activeArmy, 0);
  assert.equal(ended.battleRound, 6);
  assert.equal(ended.winner, 0);
});

test('11th out-of-phase snap shooting does not consume normal shooting-phase weapon state', () => {
  const battle = state('movement');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.activeArmy = 0;
  battle.commandPoints = [1, 1];
  const overwatcher = losTestUnit('overwatcher', 1, { x: 10, y: 10 });
  overwatcher.profile.weapons = [
    { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
  ];
  const target = losTestUnit('target', 0, { x: 18, y: 10 });
  target.profile.wounds = 10;
  target.woundsOnLeadModel = 10;
  battle.units = [target, overwatcher];

  const used = useStratagem(battle, 1, 'fire-overwatch', rules40K11th, overwatcher.id);
  const snapped = snapShootPlayUnitWeapon(used, overwatcher.id, 1, target.id, 'all', rules40K11th);
  const snappedUnit = snapped.units.find(unit => unit.id === overwatcher.id)!;

  assert.equal(snappedUnit.activated, true);
  assert.equal(snappedUnit.actionStartedThisTurn, true);
  assert.equal(snappedUnit.firedWeaponIndices, undefined);

  const reinforcements = simulateNextPhase(snapped, rules40K11th);
  const shooting = simulateNextPhase(reinforcements, rules40K11th);
  const charge = simulateNextPhase(shooting, rules40K11th);
  const fight = simulateNextPhase(charge, rules40K11th);
  const redSetup = simulateNextPhase(fight, rules40K11th);
  const redCommand = simulateNextPhase(redSetup, rules40K11th);
  const resetUnit = redCommand.units.find(unit => unit.id === overwatcher.id)!;

  assert.equal(redCommand.activeArmy, 1);
  assert.equal(redCommand.phase, 'command');
  assert.equal(resetUnit.activated, false);
  assert.equal(resetUnit.actionStartedThisTurn, undefined);
});

test('11th core stratagems enforce target keyword and reserve restrictions', () => {
  const fight = state('fight');
  fight.commandPoints = [3, 0];
  const character = losTestUnit('captain', 0, { x: 10, y: 10 });
  character.profile.keywords = ['Character', 'Infantry'];
  const infantry = losTestUnit('intercessors', 0, { x: 12, y: 10 });
  fight.units = [character, infantry];

  assert.equal(availableStratagems(fight, 0, rules40K11th, character.id).some(stratagem => stratagem.id === 'epic-challenge'), true);
  assert.equal(availableStratagems(fight, 0, rules40K11th, infantry.id).some(stratagem => stratagem.id === 'epic-challenge'), false);

  const abilityCharacter = losTestUnit('ability-captain', 0, { x: 14, y: 10 });
  abilityCharacter.profile.keywords = ['Infantry'];
  abilityCharacter.profile.abilities = [{ name: 'Character', description: 'This model is a Character.' }];
  fight.units = [abilityCharacter];
  assert.equal(availableStratagems(fight, 0, rules40K11th, abilityCharacter.id).some(stratagem => stratagem.id === 'epic-challenge'), true);

  const movement = state('movement');
  movement.activeArmy = 0;
  movement.commandPoints = [0, 2];
  const reserve = losTestUnit('terminators', 1, { x: 0, y: 0 });
  reserve.inStrategicReserves = true;
  reserve.modelPositions = [];
  const aircraft = losTestUnit('aircraft', 1, { x: 0, y: 0 });
  aircraft.profile.keywords = ['Aircraft', 'Vehicle', 'Fly'];
  aircraft.inStrategicReserves = true;
  aircraft.modelPositions = [];
  movement.units = [reserve, aircraft];

  assert.equal(availableStratagems(movement, 1, rules40K11th, reserve.id).some(stratagem => stratagem.id === 'rapid-ingress'), true);
  assert.equal(availableStratagems(movement, 1, rules40K11th, aircraft.id).some(stratagem => stratagem.id === 'rapid-ingress'), false);
});

test('11th Rapid Ingress lets a non-Aircraft unit return from Strategic Reserves in the opponent Movement phase', () => {
  const battle = state('movement');
  battle.activeArmy = 0;
  battle.movementStep = 'reinforcements';
  battle.commandPoints = [0, 1];
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const reserve = losTestUnit('reserve-1', 1, { x: 0, y: 0 });
  reserve.profile.name = 'Reserve Infantry';
  reserve.inStrategicReserves = true;
  reserve.modelPositions = [];
  battle.units = [reserve];

  const blocked = placePlayStrategicReserveUnit(battle, 1, reserve.id, { x: 3, y: 10 });
  assert.equal(blocked, battle);

  const ingress = useStratagem(battle, 1, 'rapid-ingress', rules40K11th, reserve.id);
  assert.equal(ingress.commandPoints?.[1], 0);
  assert.equal(ingress.units[0].rapidIngressThisPhase, true);

  const returned = placePlayStrategicReserveUnit(ingress, 1, reserve.id, { x: 3, y: 10 });
  const returnedReserve = returned.units.find(unit => unit.id === reserve.id)!;
  assert.equal(returnedReserve.inStrategicReserves, false);
  assert.equal(returnedReserve.arrivedFromReinforcements, true);
  assert.equal(returnedReserve.rapidIngressThisPhase, undefined);
  assert.match(returned.log.at(-1)?.message ?? '', /using Rapid Ingress/);
});

test('11th Heroic Intervention lets the targeted defender declare a charge in the opponent Charge phase', () => {
  const battle = state('charge');
  battle.activeArmy = 0;
  battle.commandPoints = [0, 1];
  const attacker = losTestUnit('attacker', 0, { x: 10, y: 10 });
  const defender = losTestUnit('defender', 1, { x: 16, y: 10 });
  battle.units = [attacker, defender];

  assert.deepEqual(playChargeTargetOptions(battle, defender.id, 1, rules40K11th), []);

  const intervening = useStratagem(battle, 1, 'heroic-intervention', rules40K11th, defender.id);
  assert.equal(intervening.commandPoints?.[1], 0);
  assert.equal(intervening.units.find(unit => unit.id === defender.id)?.heroicInterventionThisPhase, true);
  assert.deepEqual(playChargeTargetOptions(intervening, defender.id, 1, rules40K11th).map(option => option.targetId), [attacker.id]);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const charged = chargePlayUnitTarget(intervening, defender.id, 1, attacker.id, rules40K11th);
    const chargedDefender = charged.units.find(unit => unit.id === defender.id)!;
    assert.equal(chargedDefender.charged, true);
    assert.equal(chargedDefender.heroicInterventionThisPhase, undefined);
    assert.equal(chargedDefender.inCombat, true);
    assert.equal(charged.units.find(unit => unit.id === attacker.id)?.inCombat, true);
    assert.match(charged.log.at(-1)?.message ?? '', /Heroic Intervention charge/);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th Smokescreen applies cover and a hit penalty for the phase', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  battle.commandPoints = [0, 1];
  const shooter = losTestUnit('shooter', 0, { x: 0, y: 0 });
  shooter.profile.weapons = [
    { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
  ];
  const smoke = losTestUnit('smoke', 1, { x: 12, y: 0 }, 4);
  smoke.profile.keywords = ['Infantry', 'Smoke'];
  smoke.profile.wounds = 3;
  smoke.woundsOnLeadModel = 3;
  battle.units = [shooter, smoke];

  const screened = useStratagem(battle, 1, 'smokescreen', rules40K11th, smoke.id);
  assert.deepEqual(screened.commandPoints, [0, 0]);

  const originalRandom = Math.random;
  const rolls = [0.5, 0.5, 0.34];
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = shootPlayUnitWeapon(screened, shooter.id, 0, smoke.id, 'all', rules40K11th);
    const messages = shooting.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Smokescreen -1 to Hit; target has Benefit of Cover/);
    assert.match(messages, /Hit rolls \(4\+\)/);
    assert.match(messages, /Save rolls \(3\+, cover \+1\)/);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th Counteroffensive lets only the targeted defender fight next', () => {
  const battle = state('fight');
  battle.activeArmy = 0;
  battle.commandPoints = [0, 2];
  const charger = losTestUnit('charger', 0, { x: 10, y: 10 });
  charger.charged = true;
  charger.inCombat = true;
  charger.profile.weapons = [
    { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
  ];
  const defender = losTestUnit('defender', 1, { x: 10.5, y: 10 });
  defender.inCombat = true;
  defender.profile.weapons = [
    { name: 'Claw', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
  ];
  const otherDefender = losTestUnit('other-defender', 1, { x: 10, y: 10.5 });
  otherDefender.inCombat = true;
  otherDefender.profile.weapons = defender.profile.weapons;
  battle.units = [charger, defender, otherDefender];

  const countered = useStratagem(battle, 1, 'counteroffensive', rules40K11th, defender.id);
  assert.deepEqual(countered.commandPoints, [0, 0]);
  assert.deepEqual(playFightActivationUnitIds(countered, 1, rules40K11th), [defender.id]);
  assert.deepEqual(playFightWeaponOptions(countered, defender.id, 1, rules40K11th).map(option => option.name), ['Claw']);
  assert.deepEqual(playFightWeaponOptions(countered, otherDefender.id, 1, rules40K11th), []);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const fought = fightPlayUnitWeapon(countered, defender.id, 1, charger.id, 'all', rules40K11th);
    assert.equal(fought.units.find(unit => unit.id === defender.id)?.activated, true);
    assert.notEqual(fought, countered);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th Explosives deals mortal wounds to the nearest visible enemy within 8 inches', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  battle.commandPoints = [1, 0];
  const grenadier = losTestUnit('grenadier', 0, { x: 10, y: 10 });
  grenadier.profile.keywords = ['Infantry', 'Explosives'];
  grenadier.profile.weapons = [
    { name: 'Pistol', range: 12, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
  ];
  const target = losTestUnit('target', 1, { x: 16, y: 10 });
  target.profile.wounds = 5;
  target.woundsOnLeadModel = 5;
  const farTarget = losTestUnit('far-target', 1, { x: 30, y: 10 });
  battle.units = [grenadier, target, farTarget];

  const originalRandom = Math.random;
  const rolls = [0.5, 0.3, 0.67, 0.99, 0.0, 0.5];
  Math.random = () => rolls.shift() ?? 0;
  try {
    const exploded = useStratagem(battle, 0, 'explosives', rules40K11th, grenadier.id);
    assert.deepEqual(exploded.commandPoints, [0, 0]);
    assert.deepEqual(exploded.units.find(unit => unit.id === target.id)?.pendingDamageAllocations, [
      { damage: 4, noCarryOver: undefined, source: 'Explosives' },
    ]);
    assert.equal(exploded.units.find(unit => unit.id === farTarget.id)?.pendingDamageAllocations, undefined);
    assert.match(exploded.log.map(entry => entry.message).join(' '), /Explosives targets target/);
    assert.match(exploded.log.map(entry => entry.message).join(' '), /Explosives rolls: \[4, 2, 5, 6, 1, 4\] -> 4 mortal wound/);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th Crushing Impact deals mortal wounds to an engaged enemy', () => {
  const battle = state('charge');
  battle.activeArmy = 0;
  battle.commandPoints = [1, 0];
  const crusher = losTestUnit('crusher', 0, { x: 10, y: 10 });
  crusher.charged = true;
  crusher.profile.keywords = ['Monster'];
  const target = losTestUnit('target', 1, { x: 10.5, y: 10 });
  target.profile.wounds = 4;
  target.woundsOnLeadModel = 4;
  battle.units = [crusher, target];

  const originalRandom = Math.random;
  const rolls = [0.5, 0.5, 0.3, 0.3, 0.99, 0.0];
  Math.random = () => rolls.shift() ?? 0;
  try {
    const impacted = useStratagem(battle, 0, 'crushing-impact', rules40K11th, crusher.id);
    assert.deepEqual(impacted.commandPoints, [0, 0]);
    assert.deepEqual(impacted.units.find(unit => unit.id === target.id)?.pendingDamageAllocations, [
      { damage: 3, noCarryOver: undefined, source: 'Crushing Impact' },
    ]);
    assert.match(impacted.log.map(entry => entry.message).join(' '), /Crushing Impact targets target/);
    assert.match(impacted.log.map(entry => entry.message).join(' '), /Crushing Impact rolls: \[4, 4, 2, 2, 6, 1\] -> 3 mortal wound/);
  } finally {
    Math.random = originalRandom;
  }
});

test('unit ability framework matches profile ability text and records once-per-battle use', () => {
  const battle = state('command');
  const warboss = losTestUnit('warboss-1', 0, { x: 10, y: 10 });
  warboss.profile.abilities = [{ name: 'Waaagh!', description: 'Once per battle.' }];
  battle.units = [warboss];

  const options = availableUnitAbilities(battle, warboss.id, 0, 'manual', rules40K10th);
  assert.deepEqual(options.map(option => option.id), ['waaagh']);

  const used = useUnitAbility(battle, warboss.id, 0, 'waaagh', 'manual', rules40K10th);
  assert.equal(used.abilityUses?.length, 1);
  assert.equal(used.abilityUses?.[0].abilityId, 'waaagh');
  assert.equal(used.abilityUses?.[0].sourceUnitId, warboss.id);

  assert.deepEqual(availableUnitAbilities(used, warboss.id, 0, 'manual', rules40K10th), []);
});

test('unit ability framework exposes end-of-phase abilities and replays use actions', () => {
  const battle = state('fight');
  const overlord = losTestUnit('overlord-1', 0, { x: 10, y: 10 });
  overlord.profile.abilities = [{ name: 'Reanimation Protocols', description: 'At the end of each phase.' }];
  battle.units = [overlord];

  const options = availableUnitAbilities(battle, overlord.id, 0, 'end-of-phase', rules40K10th);
  assert.deepEqual(options.map(option => option.id), ['reanimation-protocols']);

  const replayed = applyGameAction(battle, {
    type: 'play.useUnitAbility',
    side: 0,
    unitId: overlord.id,
    abilityId: 'reanimation-protocols',
    timing: 'end-of-phase',
  }, { rules: rules40K10th });

  assert.equal(replayed.abilityUses?.length, 1);
  assert.equal(replayed.abilityUses?.[0].targetUnitId, overlord.id);
});

test('primary scoring framework preserves current 10th marker objective fallback', () => {
  const battle = state('fight');
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.units = [
    losTestUnit('blue-1', 0, { x: 10, y: 10 }),
    losTestUnit('red-1', 1, { x: 20, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K10th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, 'generic-objective-control');
  assert.equal(result.vpGained, 1);
  assert.deepEqual(battle.objectiveOwners, [0, 1]);
  assert.deepEqual(battle.scores, [1, 0]);
});

test('primary scoring framework leaves unsupported objective-control rules unscored', () => {
  const battle = state('fight');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.objectives = [{ x: 10, y: 10 }];
  battle.objectiveOwners = [null];
  battle.units = [losTestUnit('blue-1', 0, { x: 10, y: 10 })];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'unsupported');
  assert.equal(result.vpGained, 0);
  assert.deepEqual(battle.objectiveOwners, [null]);
  assert.deepEqual(battle.scores, [0, 0]);
});

test('11th Battlefield Dominance scores from mission data', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Battlefield Dominance', 'Battlefield Dominance'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-home', 0, { x: 10, y: 10 }),
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('red-home', 1, { x: 30, y: 10 }),
  ];

  const roundOne = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(roundOne.kind, 'scored');
  assert.equal(roundOne.scoringModel, '11e-data:Battlefield Dominance');
  assert.equal(roundOne.vpGained, 2);
  assert.deepEqual(battle.scores, [2, 0]);

  const command = { ...battle, phase: 'command' as Phase, battleRound: 2, turn: 2, scores: [0, 0] as [number, number] };
  const roundTwo = scorePrimaryMission(command, 0, rules40K11th);

  assert.equal(roundTwo.vpGained, 8);
  assert.deepEqual(command.scores, [8, 0]);
  assert.match(formatPrimaryScoringResult(roundTwo), /Battlefield Dominance/);
});

test('11th Inescapable Dominion scores fixed objective conditions from mission data', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Inescapable Dominion', 'Secure Asset'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-home', 0, { x: 10, y: 10 }),
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('red-home', 1, { x: 30, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Inescapable Dominion');
  assert.equal(result.vpGained, 9);
  assert.deepEqual(battle.scores, [9, 0]);
});

test('11th primary scoring coverage matrix exercises every clause positively and at a negative boundary', () => {
  assert.equal(ELEVENTH_PRIMARY_MISSION_RULES.length, 25);
  assert.equal(PRIMARY_CLAUSE_COVERAGE.length, 127);
  assert.equal(new Set(PRIMARY_CLAUSE_COVERAGE.map(({ missionName, clause }) => `${missionName}:${clause.id}`)).size, 127);
  assert.deepEqual(
    PRIMARY_GLOBAL_SCORING_COVERAGE.map(entry => entry.id),
    ['round-cap-and-idempotence', 'battle-cap-replay-and-save', 'end-battle-manual-and-simulation-lifecycle'],
  );
  assert.equal(new Set(PRIMARY_GLOBAL_SCORING_COVERAGE.map(entry => entry.assertion)).size, 3);

  for (const { missionName, clause } of PRIMARY_CLAUSE_COVERAGE) {
    const label = `${missionName}:${clause.id}`;
    const positive = scorePrimaryMission(primaryClauseCoverageState(missionName, clause, true), 0, rules40K11th);
    const positiveDetail = positive.scoringDetails?.find(detail => detail.startsWith(clause.sourceText));
    assert.ok(positiveDetail, `${label} must be evaluated in its published scoring window`);
    assert.doesNotMatch(positiveDetail, /(?:\+0VP|-> \+0VP)$/, `${label} needs a positive scoring assertion`);

    const negative = scorePrimaryMission(primaryClauseCoverageState(missionName, clause, false), 0, rules40K11th);
    const negativeDetail = negative.scoringDetails?.find(detail => detail.startsWith(clause.sourceText));
    assert.ok(negativeDetail, `${label} negative case must reach the clause evaluator`);
    assert.match(negativeDetail, /(?:\+0VP|-> \+0VP)$/, `${label} needs a condition or exclusive-tier negative assertion`);

    const wrongTimingState = primaryClauseCoverageState(missionName, clause, true);
    wrongTimingState.phase = clause.timing === 'end-command-phase' ? 'fight' : 'command';
    const wrongTiming = scorePrimaryMission(wrongTimingState, 0, rules40K11th);
    assert.equal(
      wrongTiming.scoringDetails?.some(detail => detail.startsWith(clause.sourceText)) ?? false,
      false,
      `${label} must not evaluate at the wrong timing`,
    );

    if (clause.rounds !== 'any') {
      const applicableRounds: readonly number[] = clause.rounds;
      const wrongRound = [1, 2, 3, 4, 5].find(round => !applicableRounds.includes(round));
      assert.notEqual(wrongRound, undefined, `${label} needs an out-of-round boundary`);
      const wrongRoundState = primaryClauseCoverageState(missionName, clause, true);
      wrongRoundState.battleRound = wrongRound!;
      wrongRoundState.turn = wrongRound!;
      const wrongRoundResult = scorePrimaryMission(wrongRoundState, 0, rules40K11th);
      assert.equal(
        wrongRoundResult.scoringDetails?.some(detail => detail.startsWith(clause.sourceText)) ?? false,
        false,
        `${label} must not evaluate outside its published rounds`,
      );
    }
  }
});

test('primary scoring logs format serialized player, timing, award, cap, and unsupported details', () => {
  const battle = state('fight', 3);
  const baseRecord: PrimaryMissionScoringRecord = {
    id: '0:Mission:3:3:0:end-turn',
    side: 0,
    missionName: 'Mission',
    clauseIds: ['control'],
    status: 'awarded',
    requestedVp: 5,
    vp: 5,
    detail: 'Controlled the central objective. Requested and awarded 5VP.',
    battleRound: 3,
    turn: 3,
    activeSide: 0,
    phase: 'fight',
    scoreAfter: 17,
    timing: 'end-turn',
    clauseDetails: ['Controlled the central objective. -> +5VP'],
    capDetail: 'Requested and awarded 5VP.',
    unsupportedReasons: [],
  };
  const capped: PrimaryMissionScoringRecord = {
    ...baseRecord,
    id: '0:Mission:4:4:0:end-command-phase',
    status: 'capped',
    requestedVp: 8,
    vp: 2,
    battleRound: 4,
    turn: 4,
    phase: 'command',
    scoreAfter: 45,
    timing: 'end-command-phase',
    capDetail: 'Requested 8VP; awarded 2VP after the 15VP battle-round and 45VP battle caps.',
  };
  const unsupported: PrimaryMissionScoringRecord = {
    ...baseRecord,
    id: '1:Mission:5:5:1:end-battle',
    side: 1,
    status: 'unsupported',
    requestedVp: 0,
    vp: 0,
    battleRound: 5,
    turn: 5,
    activeSide: 1,
    phase: 'end',
    scoreAfter: 21,
    timing: 'end-battle',
    clauseDetails: ['Territory condition could not be evaluated. -> +0VP'],
    unsupportedReasons: ['Territory geometry is unavailable.'],
  };

  const logs = primaryMissionScoringLogs(battle, [baseRecord, capped, unsupported]);

  assert.deepEqual(logs.map(entry => entry.id), [
    `primary-score-log:${baseRecord.id}`,
    `primary-score-log:${capped.id}`,
    `primary-score-log:${unsupported.id}`,
  ]);
  assert.match(logs[0].message, /Blue \(Player 1\).*Mission.*End of turn, battle round 3.*requested 5VP, awarded 5VP \(awarded\).*score 17VP.*Controlled the central objective/);
  assert.doesNotMatch(logs[0].message, /Side [01]/);
  assert.match(logs[1].message, /End of Command phase, battle round 4.*requested 8VP, awarded 2VP \(capped\).*45VP battle caps/);
  assert.match(logs[2].message, /Red \(Player 2\).*End of battle.*requested 0VP, awarded 0VP \(unsupported\).*Territory geometry is unavailable/);
  assert.equal(formatPrimaryMissionScoringRecord(baseRecord, 'Blue'), logs[0].message);
});

test('primary scoring lifecycle omits empty windows and logs each serialized evaluation once', () => {
  const roundOne = state('command', 1);
  roundOne.ruleset = rulesetMetadataForState(rules40K11th);
  roundOne.objectiveControl = rules40K11th.objectiveControl;
  roundOne.setup = { ...roundOne.setup!, primaryMissions: ['Battlefield Dominance', 'Battlefield Dominance'] };

  const noScoringWindow = applyGameAction(roundOne, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
  assert.equal(noScoringWindow.missionState?.primaryMissionScoringRecords?.length ?? 0, 0);
  assert.equal(noScoringWindow.log.some(entry => entry.id.startsWith('primary-score-log:')), false);

  const roundTwo = state('command', 2);
  roundTwo.ruleset = rulesetMetadataForState(rules40K11th);
  roundTwo.objectiveControl = rules40K11th.objectiveControl;
  roundTwo.setup = { ...roundTwo.setup!, primaryMissions: ['Delaying Action', 'Delaying Action'] };
  roundTwo.objectives = [{ x: 20, y: 20 }];
  roundTwo.objectiveOwners = [null];
  roundTwo.terrain = [terrainMat({ id: 'central', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'central' })];
  roundTwo.units = [losTestUnit('holder', 0, { x: 20, y: 20 })];

  const scored = applyGameAction(roundTwo, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
  const primaryLogs = scored.log.filter(entry => entry.id.startsWith('primary-score-log:'));
  assert.equal(scored.missionState?.primaryMissionScoringRecords?.length, 1);
  assert.equal(primaryLogs.length, 1);
  assert.match(primaryLogs[0].message, /Blue \(Player 1\).*Delaying Action.*End of Command phase.*requested 4VP, awarded 4VP/);

  const unsupportedStart = state('command', 1);
  unsupportedStart.ruleset = rulesetMetadataForState(rules40K11th);
  unsupportedStart.objectiveControl = rules40K11th.objectiveControl;
  unsupportedStart.objectives = [{ x: 10, y: 10 }];
  unsupportedStart.objectiveOwners = [null];
  unsupportedStart.units = [losTestUnit('holder', 0, { x: 10, y: 10 })];
  const unsupported = applyGameAction(unsupportedStart, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
  const unsupportedLogs = unsupported.log.filter(entry => entry.id.startsWith('primary-score-unsupported:'));
  assert.equal(unsupportedLogs.length, 1);
  assert.match(unsupportedLogs[0].message, /Blue \(Player 1\).*Practice.*requested 0VP, awarded 0VP \(unsupported\).*unavailable/i);
  assert.doesNotMatch(unsupportedLogs[0].message, /Side [01]/);
});

test('11th secondary mission state tracks fixed, tactical, draw, and discard state', () => {
  const initial = {
    ...state('command'),
    ruleset: rulesetMetadataForState(rules40K11th),
  };
  const fixed = configureSecondaryMissions(initial, 0, 'fixed', ['Assassination', 'Engage on All Fronts']);
  assert.deepEqual(fixed.missionState?.secondaryMissions?.[0].activeCards.map(card => card.missionName), [
    'Assassination',
    'Engage on All Fronts',
  ]);
  assert.equal(fixed.missionState?.secondaryMissions?.[0].mode, 'fixed');
  assert.deepEqual(fixed.missionState?.secondaryMissions?.[0].drawPile, []);

  const configured = configureSecondaryMissions(fixed, 1, 'tactical', ['A Grievous Blow', 'Bring It Down', 'No Prisoners']);
  const drawn = drawSecondaryMission(configured, 1, 'A Grievous Blow');
  const discarded = discardSecondaryMission(drawn, 1, 'A Grievous Blow');
  const tactical = discarded.missionState?.secondaryMissions?.[1];

  assert.deepEqual(tactical?.drawPile, ['Bring It Down', 'No Prisoners']);
  assert.deepEqual(tactical?.activeCards, []);
  assert.equal(tactical?.discardedCards[0].whenDrawnSelections, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(discarded)).missionState?.secondaryMissions, discarded.missionState?.secondaryMissions);
  assert.equal(configureSecondaryMissions(initial, 0, 'fixed', ['Beacon']), initial);
});

test('secondary mission game actions replay and persist through practice saves', async () => {
  installStorage();
  const initial = {
    ...state('command'),
    ruleset: rulesetMetadataForState(rules40K11th),
  };
  initial.units = [losTestUnit('beacon-unit', 0, { x: 12, y: 12 })];
  initial.objectives = [{ x: 12, y: 12 }];
  initial.terrain = [
    terrainMat({ id: 'no-mans-land', type: 'ruin', x: 10, y: 10, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  let timeline = createPracticeTimeline(initial, { id: 'secondary-state-game' });
  let current = initial;
  const actions = [
    {
      type: GAME_ACTION_TYPE.ConfigureSecondaryMissions,
      side: 0 as const,
      mode: 'tactical' as const,
      missionNames: ['A Tempting Target', 'Beacon', 'Burden of Trust'],
    },
    {
      type: GAME_ACTION_TYPE.DrawSecondaryMission,
      side: 0 as const,
      missionName: 'A Tempting Target',
    },
    {
      type: GAME_ACTION_TYPE.SelectTemptingTargetObjective,
      side: 0 as const,
      selection: { objectiveIndex: 0, selectedBySide: 1 as const },
    },
    {
      type: GAME_ACTION_TYPE.DrawSecondaryMission,
      side: 0 as const,
      missionName: 'Beacon',
    },
    {
      type: GAME_ACTION_TYPE.SelectBeaconUnit,
      side: 0 as const,
      selection: { unitId: 'beacon-unit' },
    },
    {
      type: GAME_ACTION_TYPE.DiscardSecondaryMission,
      side: 0 as const,
      missionName: 'A Tempting Target',
    },
    {
      type: GAME_ACTION_TYPE.DrawSecondaryMission,
      side: 0 as const,
      missionName: 'Burden of Trust',
    },
    {
      type: GAME_ACTION_TYPE.SelectBurdenOfTrustGuards,
      side: 0 as const,
      selection: { guards: [{ objectiveIndex: 0, unitId: 'beacon-unit' }] },
    },
  ];

  for (const action of actions) {
    const result = appendTimelineAction(timeline, current, action, { rules: rules40K11th });
    timeline = result.timeline;
    current = result.state;
  }

  const replayed = replayTimeline(timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.secondaryMissions, current.missionState?.secondaryMissions);

  const scenario = scenarioFromTimeline(timeline, { id: 'secondary-state-save' });
  await localPracticeScenarioRepository.saveScenario(scenario);
  const loaded = await localPracticeScenarioRepository.loadScenario('secondary-state-save');
  assert.deepEqual(
    currentTimelineState(loaded!.timeline).missionState?.secondaryMissions,
    current.missionState?.secondaryMissions,
  );
});

test('Cleanse and Plunder actions replay, complete at end of turn, and persist their targets', async () => {
  installStorage();
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.objectiveControl = rules40K11th.objectiveControl;
  initial.objectives = [{ x: 12, y: 12 }];
  initial.objectiveOwners = [null];
  initial.terrain = [
    terrainMat({ id: 'cleanse-area', type: 'ruin', x: 10, y: 10, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'blue-territory', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'neutral-area', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const cleanser = losTestUnit('cleanser', 0, { x: 12, y: 12 });
  const plunderer = losTestUnit('plunderer', 0, { x: 20, y: 10 });
  initial.units = [cleanser, plunderer];

  let timeline = createPracticeTimeline(initial, { id: 'cleanse-plunder-game' });
  let current = initial;
  const actions = [
    {
      type: GAME_ACTION_TYPE.ConfigureSecondaryMissions,
      side: 0 as const,
      mode: 'tactical' as const,
      missionNames: ['Cleanse', 'Plunder'],
    },
    { type: GAME_ACTION_TYPE.DrawSecondaryMission, side: 0 as const, missionName: 'Cleanse' },
    { type: GAME_ACTION_TYPE.DrawSecondaryMission, side: 0 as const, missionName: 'Plunder' },
    {
      type: GAME_ACTION_TYPE.StartAction,
      side: 0 as const,
      unitId: cleanser.id,
      actionId: 'cleanse',
      actionName: 'Cleanse',
      targetObjectiveIndex: 0,
    },
    {
      type: GAME_ACTION_TYPE.StartAction,
      side: 0 as const,
      unitId: plunderer.id,
      actionId: 'plunder',
      actionName: 'Plunder',
      targetTerrainId: 'neutral-area',
    },
    { type: GAME_ACTION_TYPE.StepPhase },
  ];

  for (const action of actions) {
    const result = appendTimelineAction(timeline, current, action, { rules: rules40K11th });
    timeline = result.timeline;
    current = result.state;
  }

  assert.deepEqual(
    current.missionState?.completedSecondaryActionsDuringBattle?.map(event =>
      [event.actionId, event.targetObjectiveIndex, event.targetTerrainId]
    ),
    [['cleanse', 0, undefined], ['plunder', undefined, 'neutral-area']],
  );
  assert.equal(current.units.some(unit => unit.performingAction), false);

  const replayed = replayTimeline(timeline, { rules: rules40K11th }, false);
  assert.deepEqual(
    replayed.missionState?.completedSecondaryActionsDuringBattle,
    current.missionState?.completedSecondaryActionsDuringBattle,
  );

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(timeline, { id: 'cleanse-plunder-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('cleanse-plunder-save');
  assert.deepEqual(
    currentTimelineState(loaded!.timeline).missionState?.completedSecondaryActionsDuringBattle,
    current.missionState?.completedSecondaryActionsDuringBattle,
  );
});

test('Cleanse and Plunder validate active cards, unique targets, explicit territory, and completion eligibility', () => {
  const initial = state('shooting');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.objectiveControl = rules40K11th.objectiveControl;
  initial.objectives = [{ x: 12, y: 12 }];
  initial.objectiveOwners = [null];
  initial.terrain = [
    terrainMat({ id: 'cleanse-area', type: 'ruin', x: 10, y: 10, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'friendly-home', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'friendly-expansion', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'expansion-0' }),
    terrainMat({ id: 'neutral', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'unclassified', type: 'ruin', x: 18, y: 8, width: 4, height: 4 }),
  ];
  const cleanser = losTestUnit('cleanser', 0, { x: 12, y: 12 });
  const secondCleanser = losTestUnit('second-cleanser', 0, { x: 12, y: 12 });
  const plunderer = losTestUnit('plunderer', 0, { x: 20, y: 10 });
  initial.units = [cleanser, secondCleanser, plunderer];

  assert.deepEqual(cleanseObjectiveOptions(initial, cleanser.id, 0, rules40K11th), []);
  assert.deepEqual(plunderTerrainOptions(initial, plunderer.id, 0, rules40K11th), []);
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Cleanse', 'Plunder']);
  battle = drawSecondaryMission(battle, 0, 'Cleanse');
  battle = drawSecondaryMission(battle, 0, 'Plunder');

  assert.deepEqual(cleanseObjectiveOptions(battle, cleanser.id, 0, rules40K11th), [0]);
  assert.deepEqual(plunderTerrainOptions(battle, plunderer.id, 0, rules40K11th), ['neutral']);

  const plundered = startPlayUnitAction(
    battle,
    plunderer.id,
    0,
    'plunder',
    'Plunder',
    rules40K11th,
    undefined,
    'neutral',
  );
  completeEndOfTurnActions(plundered, 0);
  assert.equal(plundered.missionEvents?.completedActionsThisTurn?.[0]?.targetTerrainId, 'neutral');
  assert.equal(plundered.missionState?.completedSecondaryActionsDuringBattle?.[0]?.actionId, 'plunder');

  const started = startPlayUnitAction(battle, cleanser.id, 0, 'cleanse', 'Cleanse', rules40K11th, 0);
  assert.deepEqual(cleanseObjectiveOptions(started, secondCleanser.id, 0, rules40K11th), []);
  const movedAway: BattleState = JSON.parse(JSON.stringify(started));
  const actingUnit = movedAway.units.find(unit => unit.id === cleanser.id)!;
  actingUnit.position = { x: 30, y: 30 };
  actingUnit.modelPositions = [{ x: 30, y: 30 }];
  completeEndOfTurnActions(movedAway, 0);

  assert.equal(actingUnit.performingAction, undefined);
  assert.equal(movedAway.missionEvents?.completedActionsThisTurn?.length ?? 0, 0);
  assert.equal(movedAway.missionState?.completedSecondaryActionsDuringBattle?.length ?? 0, 0);
  assert.match(movedAway.log.at(-1)?.message ?? '', /no longer eligible/);
});

test('11th mission geometry uses model footprints at deployment, centre, edge, quarter, and terrain boundaries', () => {
  const battle = state('shooting');
  battle.setup = { ...battle.setup!, deployment: 'Dawn of War' };
  const unit = losTestUnit('geometry-unit', 0, { x: 10, y: 11.5 });
  unit.profile.modelBases = [{ shape: 'round', diameterMm: 25.4 }];
  battle.units = [unit];
  battle.terrain = [
    terrainMat({ id: 'bounded-area', type: 'ruin', x: 9, y: 11, width: 2, height: 2, objectiveRole: 'no-mans-land' }),
  ];

  assert.equal(missionDeploymentZone(battle, 0)?.name, 'Top Deployment Zone');
  assert.equal(unitWhollyWithinDeploymentZone(battle, unit, 0), true);
  assert.equal(unitWithinDeploymentZone(battle, unit, 0), true);
  assert.equal(unitWhollyWithinNoMansLand(battle, unit), false);
  assert.equal(unitWhollyWithinTerrainArea(battle, unit, 'bounded-area'), true);

  unit.position = { x: 10, y: 12.5 };
  unit.modelPositions = [{ x: 10, y: 12.5 }];
  assert.equal(unitWhollyWithinDeploymentZone(battle, unit, 0), false);
  assert.equal(unitWithinDeploymentZone(battle, unit, 0), true);
  assert.equal(unitWhollyWithinNoMansLand(battle, unit), false);

  unit.position = { x: 10, y: 12.51 };
  unit.modelPositions = [{ x: 10, y: 12.51 }];
  assert.equal(unitWithinDeploymentZone(battle, unit, 0), false);
  assert.equal(unitWhollyWithinNoMansLand(battle, unit), true);

  unit.position = { x: 36.5, y: 22 };
  unit.modelPositions = [{ x: 36.5, y: 22 }];
  assert.deepEqual(battlefieldCentre(battle), { x: 30, y: 22 });
  assert.equal(unitWithinBattlefieldCentre(battle, unit, 6), true);
  unit.position = { x: 36.51, y: 22 };
  unit.modelPositions = [{ x: 36.51, y: 22 }];
  assert.equal(unitWithinBattlefieldCentre(battle, unit, 6), false);

  unit.position = { x: 6.5, y: 8 };
  unit.modelPositions = [{ x: 6.5, y: 8 }];
  assert.deepEqual(battlefieldEdgesWithinRange(battle, unit, 6), ['left']);
  unit.position = { x: 6.51, y: 8 };
  unit.modelPositions = [{ x: 6.51, y: 8 }];
  assert.deepEqual(battlefieldEdgesWithinRange(battle, unit, 6), []);
  assert.equal(battlefieldEdgesAreOpposite('left', 'right'), true);
  assert.equal(battlefieldEdgesAreOpposite('left', 'top'), false);

  unit.position = { x: 29.5, y: 10 };
  unit.modelPositions = [{ x: 29.5, y: 10 }];
  assert.equal(unitTableQuarter(battle, unit), 0);
  unit.remainingModels = 2;
  unit.modelPositions = [{ x: 29.5, y: 10 }, { x: 30.5, y: 10 }];
  assert.equal(unitTableQuarter(battle, unit), undefined);
});

test('11th mission geometry exposes explicit territory and expansion roles without inferring missing layout geometry', () => {
  const battle = state('shooting');
  battle.setup = { ...battle.setup!, deployment: 'Layout Defined' };
  battle.objectives = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 25, y: 5 }];
  battle.terrain = [
    terrainMat({ id: 'friendly-expansion', type: 'ruin', x: 3, y: 3, width: 4, height: 4, objectiveRole: 'expansion-0' }),
    terrainMat({ id: 'enemy-expansion', type: 'ruin', x: 13, y: 3, width: 4, height: 4, objectiveRole: 'expansion-1' }),
    terrainMat({ id: 'neutral', type: 'ruin', x: 23, y: 3, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'unknown', type: 'ruin', x: 30, y: 3, width: 4, height: 4 }),
  ];
  const unit = losTestUnit('unknown-zone-unit', 0, { x: 20, y: 20 });

  assert.equal(missionDeploymentZone(battle, 0), undefined);
  assert.equal(unitWhollyWithinDeploymentZone(battle, unit, 0), undefined);
  assert.equal(unitWhollyWithinNoMansLand(battle, unit), undefined);
  assert.equal(terrainTerritoryRelation(battle.terrain[0], 0), 'friendly');
  assert.equal(terrainTerritoryRelation(battle.terrain[1], 0), 'enemy');
  assert.equal(terrainTerritoryRelation(battle.terrain[2], 0), 'no-mans-land');
  assert.equal(terrainTerritoryRelation(battle.terrain[3], 0), 'unclassified');
  assert.equal(territoryRelationForPoint(battle, { x: 5, y: 5 }, 0), 'friendly');
  unit.profile.modelBases = [{ shape: 'round', diameterMm: 25.4 }];
  unit.position = { x: 5, y: 5 };
  unit.modelPositions = [{ x: 5, y: 5 }];
  assert.equal(unitWhollyWithinFriendlyTerritory(battle, unit, 0), true);
  assert.equal(unitWhollyWithinEnemyTerritory(battle, unit, 0), false);
  unit.position = { x: 30, y: 5 };
  unit.modelPositions = [{ x: 30, y: 5 }];
  assert.equal(unitWhollyWithinFriendlyTerritory(battle, unit, 0), undefined);
  assert.equal(objectiveRoleForIndex(battle, 1), 'expansion-1');
  assert.deepEqual(expansionObjectiveIndexes(battle), [0, 1]);
  assert.deepEqual(expansionObjectiveIndexes(battle, 0), [0]);
  assert.deepEqual(expansionObjectiveIndexes(battle, 1), [1]);
});

test('11th mission territory geometry supports shared boundaries and diagonal polygons', () => {
  const battle = state('fight');
  battle.setup = {
    ...battle.setup!,
    territoryZones: {
      sides: [
        { polygons: [[{ x: 0, y: 0 }, { x: 60, y: 44 }, { x: 0, y: 44 }]] },
        { polygons: [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 44 }]] },
      ],
    },
  };
  const crossingTerrain = terrainMat({ type: 'ruin', x: 28, y: 20, width: 4, height: 4 });

  assert.equal(pointWithinMissionTerritory(battle, { x: 10, y: 30 }, 0), true);
  assert.equal(pointWithinMissionTerritory(battle, { x: 50, y: 10 }, 0), false);
  assert.equal(pointWithinMissionTerritory(battle, { x: 30, y: 22 }, 0), true);
  assert.equal(pointWithinMissionTerritory(battle, { x: 30, y: 22 }, 1), true);
  assert.equal(territoryRelationForPoint(battle, { x: 30, y: 22 }, 0), 'both');
  assert.equal(terrainWithinMissionTerritory(battle, crossingTerrain, 0), true);
  assert.equal(terrainWithinMissionTerritory(battle, crossingTerrain, 1), true);

  delete battle.setup!.territoryZones;
  assert.equal(pointWithinMissionTerritory(battle, { x: 10, y: 30 }, 0), undefined);
  assert.equal(terrainWithinMissionTerritory(battle, crossingTerrain, 1), undefined);
});

test('mission geometry setup and start-of-turn source facts replay and persist through practice saves', async () => {
  installStorage();
  const initial = state('setup');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.setup = { ...initial.setup!, deployment: 'Dawn of War', territoryZones: verticalTerritories() };
  initial.objectives = [{ x: 20, y: 20 }];
  initial.objectiveOwners = [null];
  initial.terrain = [
    terrainMat({ id: 'expansion', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'expansion-0' }),
  ];
  initial.units = [losTestUnit('snapshot-unit', 0, { x: 20, y: 20 })];

  let timeline = createPracticeTimeline(initial, { id: 'mission-geometry-game' });
  const result = appendTimelineAction(timeline, initial, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
  timeline = result.timeline;
  const replayed = replayTimeline(timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionEvents?.startOfTurn, result.state.missionEvents?.startOfTurn);
  assert.equal(objectiveRoleForIndex(replayed, 0), 'expansion-0');
  assert.equal(pointWithinMissionTerritory(replayed, { x: 20, y: 20 }, 0), true);
  assert.equal(unitWhollyWithinNoMansLand(replayed, replayed.units[0]), true);

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(timeline, { id: 'mission-geometry-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('mission-geometry-save');
  const loadedState = currentTimelineState(loaded!.timeline);
  assert.deepEqual(loadedState.setup?.territoryZones, verticalTerritories());
  assert.deepEqual(loadedState.missionEvents?.startOfTurn, result.state.missionEvents?.startOfTurn);
  assert.equal(objectiveRoleForIndex(loadedState, 0), 'expansion-0');
  assert.equal(unitWhollyWithinNoMansLand(loadedState, loadedState.units[0]), true);
});

test('automatic A Grievous Blow scoring applies fixed multiplication, tactical VP, and idempotence', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  const blue = losTestUnit('blue-survivor', 0, { x: 10, y: 10 });
  const largeA = losTestUnit('large-a', 1, { x: 20, y: 10 });
  const largeB = losTestUnit('large-b', 1, { x: 22, y: 10 });
  largeA.profile.baseModelCount = 13;
  largeB.profile.baseModelCount = 20;
  initial.units = [blue, largeA, largeB];
  recordDestroyedUnitMissionEvent(initial, largeA, 0);
  recordDestroyedUnitMissionEvent(initial, largeB, 0);

  const fixed = configureSecondaryMissions(initial, 0, 'fixed', ['A Grievous Blow']);
  const fixedRecords = scoreSecondaryMissionsAtEndOfTurn(fixed, 0, rules40K11th);
  assert.equal(fixedRecords[0].vp, 8);
  assert.equal(fixed.scores[0], 8);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(fixed, 0, rules40K11th), []);
  assert.equal(fixed.scores[0], 8);

  let tactical = configureSecondaryMissions(initial, 0, 'tactical', ['A Grievous Blow']);
  tactical = drawSecondaryMission(tactical, 0, 'A Grievous Blow');
  const tacticalRecords = scoreSecondaryMissionsAtEndOfTurn(tactical, 0, rules40K11th);
  assert.equal(tacticalRecords[0].vp, 5);
  assert.equal(tactical.scores[0], 5);

  const negative = configureSecondaryMissions(state('fight'), 0, 'fixed', ['A Grievous Blow']);
  negative.ruleset = rulesetMetadataForState(rules40K11th);
  const negativeRecords = scoreSecondaryMissionsAtEndOfTurn(negative, 0, rules40K11th);
  assert.equal(negativeRecords[0].status, 'not-met');
  assert.equal(negative.scores[0], 0);
});

test('secondary scoring centrally applies round, battle, and per-Fixed-card caps with partial awards', () => {
  const scoringBattle = () => {
    const initial = state('fight', 2);
    initial.ruleset = rulesetMetadataForState(rules40K11th);
    const large = losTestUnit('large-target', 1, { x: 20, y: 10 });
    large.profile.baseModelCount = 13;
    initial.units = [losTestUnit('blue', 0, { x: 10, y: 10 }), large];
    recordDestroyedUnitMissionEvent(initial, large, 0);
    return configureSecondaryMissions(initial, 0, 'fixed', ['A Grievous Blow']);
  };
  const priorRecord = (
    vp: number,
    round: number,
    activationId = 'prior-secondary-card',
  ): SecondaryMissionScoringRecord => ({
    id: `prior-${activationId}-${round}-${vp}`,
    activationId,
    side: 0,
    missionName: 'Prior Secondary',
    clauseIds: ['prior'],
    status: 'awarded',
    requestedVp: vp,
    vp,
    detail: 'Prior secondary award.',
    battleRound: round,
    turn: round,
    activeSide: 0,
    phase: 'fight',
    scoreAfter: vp,
  });

  const roundCapped = scoringBattle();
  roundCapped.missionState!.secondaryMissionScoringRecords = [priorRecord(14, 2)];
  roundCapped.scores[0] = 14;
  const roundRecord = scoreSecondaryMissionsAtEndOfTurn(roundCapped, 0, rules40K11th)[0];
  assert.equal(roundRecord.requestedVp, 4);
  assert.equal(roundRecord.vp, 1);
  assert.equal(roundRecord.status, 'awarded');
  assert.match(roundRecord.detail, /15VP battle-round secondary limit/);
  assert.equal(roundCapped.scores[0], 15);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(roundCapped, 0, rules40K11th), []);

  const battleCapped = scoringBattle();
  battleCapped.missionState!.secondaryMissionScoringRecords = [priorRecord(44, 1)];
  battleCapped.scores[0] = 44;
  const battleRecord = scoreSecondaryMissionsAtEndOfTurn(battleCapped, 0, rules40K11th)[0];
  assert.equal(battleRecord.vp, 1);
  assert.match(battleRecord.detail, /45VP battle secondary limit/);

  const fixedCapped = scoringBattle();
  const activationId = fixedCapped.missionState!.secondaryMissions![0].activeCards[0].activationId;
  fixedCapped.missionState!.secondaryMissionScoringRecords = [
    { ...priorRecord(19, 1, activationId), missionName: 'A Grievous Blow' },
  ];
  fixedCapped.scores[0] = 19;
  const fixedRecord = scoreSecondaryMissionsAtEndOfTurn(fixedCapped, 0, rules40K11th)[0];
  assert.equal(fixedRecord.vp, 1);
  assert.match(fixedRecord.detail, /20VP Fixed card limit/);

  const fullyCapped = scoringBattle();
  fullyCapped.missionState!.secondaryMissionScoringRecords = [priorRecord(15, 2)];
  fullyCapped.scores[0] = 15;
  const cappedRecord = scoreSecondaryMissionsAtEndOfTurn(fullyCapped, 0, rules40K11th)[0];
  assert.equal(cappedRecord.requestedVp, 4);
  assert.equal(cappedRecord.vp, 0);
  assert.equal(cappedRecord.status, 'capped');
});

test('partial secondary cap awards replay and persist idempotently', async () => {
  installStorage();
  const initial = state('fight', 2);
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  const large = losTestUnit('large-target', 1, { x: 20, y: 10 });
  large.profile.baseModelCount = 13;
  initial.units = [losTestUnit('blue', 0, { x: 10, y: 10 }), large];
  recordDestroyedUnitMissionEvent(initial, large, 0);
  const battle = configureSecondaryMissions(initial, 0, 'fixed', ['A Grievous Blow']);
  battle.missionState!.secondaryMissionScoringRecords = [{
    id: 'prior-round-award', activationId: 'prior-card', side: 0, missionName: 'Prior Secondary', clauseIds: ['prior'],
    status: 'awarded', requestedVp: 14, vp: 14, detail: 'Prior award.', battleRound: 2, turn: 2,
    activeSide: 0, phase: 'fight', scoreAfter: 14,
  }];
  battle.scores[0] = 14;
  const result = appendTimelineAction(
    createPracticeTimeline(battle, { id: 'secondary-cap-game' }),
    battle,
    { type: GAME_ACTION_TYPE.StepPhase },
    { rules: rules40K11th },
  );
  assert.equal(result.state.scores[0], 15);
  assert.equal(result.state.missionState?.secondaryMissionScoringRecords?.at(-1)?.requestedVp, 4);
  assert.equal(result.state.missionState?.secondaryMissionScoringRecords?.at(-1)?.vp, 1);
  assert.ok(result.state.log.some(entry => /Requested 4VP; awarded 1VP.*15VP battle-round/.test(entry.message)));
  const replayed = replayTimeline(result.timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.secondaryMissionScoringRecords, result.state.missionState?.secondaryMissionScoringRecords);
  assert.deepEqual(replayed.scores, result.state.scores);

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(result.timeline, { id: 'secondary-cap-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('secondary-cap-save');
  assert.deepEqual(
    currentTimelineState(loaded!.timeline).missionState?.secondaryMissionScoringRecords,
    result.state.missionState?.secondaryMissionScoringRecords,
  );
});

test('automatic A Tempting Target scores only at the end of its owner turn', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.objectiveControl = rules40K11th.objectiveControl;
  initial.objectives = [{ x: 20, y: 20 }];
  initial.objectiveOwners = [null];
  initial.terrain = [
    terrainMat({ id: 'tempting', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  initial.units = [
    losTestUnit('blue-holder', 0, { x: 20, y: 20 }),
    losTestUnit('red-survivor', 1, { x: 40, y: 20 }),
  ];
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['A Tempting Target']);
  battle = drawSecondaryMission(battle, 0, 'A Tempting Target');
  battle = selectTemptingTargetObjective(battle, 0, { objectiveIndex: 0, selectedBySide: 1 });

  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(battle, 1, rules40K11th), []);
  const records = scoreSecondaryMissionsAtEndOfTurn(battle, 0, rules40K11th);
  assert.equal(records[0].vp, 5);
  assert.equal(battle.scores[0], 5);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(battle, 0, rules40K11th), []);
});

test('automatic Assassination scores fixed base and bonus at turn end and tactical OR once', () => {
  const initial = state('shooting');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  const blue = losTestUnit('blue', 0, { x: 10, y: 10 });
  const characters = losTestUnit('characters', 1, { x: 20, y: 10 });
  characters.profile.keywords = ['Character', 'Infantry'];
  characters.profile.baseModelCount = 2;
  characters.profile.modelProfiles = [
    { name: 'Aide', count: 1, move: 6, toughness: 4, save: 4, wounds: 3, leadership: 7, oc: 1 },
    { name: 'Commander', count: 1, move: 6, toughness: 4, save: 4, wounds: 5, leadership: 7, oc: 1 },
  ];
  characters.remainingModels = 2;
  characters.modelPositions = [{ x: 20, y: 10 }, { x: 21, y: 10 }];
  characters.modelRosterIndexes = [0, 1];
  initial.units = [blue, characters];
  const fixed = configureSecondaryMissions(initial, 0, 'fixed', ['Assassination']);

  recordDestroyedModelMissionEvents(fixed, fixed.units[1], [0, 1], 0, { destroyedByUnitId: blue.id });
  assert.equal(fixed.scores[0], 0);
  const fixedRecords = scoreSecondaryMissionsAtEndOfTurn(fixed, 0, rules40K11th);
  assert.equal(fixed.scores[0], 7);
  assert.deepEqual(fixedRecords.map(record => record.vp), [3, 4]);
  assert.deepEqual(
    scoreFixedAssassinationDestroyedModels(fixed, fixed.missionEvents?.destroyedModelsThisTurn ?? []),
    [],
  );

  let tactical = configureSecondaryMissions(initial, 0, 'tactical', ['Assassination']);
  tactical = drawSecondaryMission(tactical, 0, 'Assassination');
  const tacticalCharacter = tactical.units[1];
  tacticalCharacter.destroyed = true;
  tacticalCharacter.remainingModels = 0;
  recordDestroyedModelMissionEvents(tactical, tacticalCharacter, [0], 0);
  const tacticalRecords = scoreSecondaryMissionsAtEndOfTurn(tactical, 0, rules40K11th);
  assert.deepEqual(tacticalRecords.map(record => record.vp), [5]);
  assert.equal(tactical.scores[0], 5);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(tactical, 0, rules40K11th), []);
});

test('automatic Beacon observes its deadline, exclusive tiers, and unknown geometry', () => {
  const makeBeacon = (deployment: string, terrain: Terrain[], position: Position) => {
    const initial = state('fight');
    initial.ruleset = rulesetMetadataForState(rules40K11th);
    initial.setup = { ...initial.setup!, deployment };
    initial.terrain = terrain;
    initial.units = [
      losTestUnit('beacon', 0, position),
      losTestUnit('red-survivor', 1, { x: 50, y: 20 }),
    ];
    let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Beacon']);
    battle = drawSecondaryMission(battle, 0, 'Beacon');
    return selectBeaconUnit(battle, 0, { unitId: 'beacon' });
  };

  const explicit = makeBeacon('Dawn of War', [
    terrainMat({ id: 'neutral', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ], { x: 20, y: 20 });
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(explicit, 0, rules40K11th), []);
  explicit.activeArmy = 1;
  const explicitRecords = scoreSecondaryMissionsAtEndOfTurn(explicit, 1, rules40K11th);
  assert.deepEqual(explicitRecords.map(record => record.vp), [5]);
  assert.equal(explicit.scores[0], 5);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(explicit, 1, rules40K11th), []);

  const fallback = makeBeacon('Dawn of War', [], { x: 20, y: 20 });
  fallback.activeArmy = 1;
  const fallbackRecords = scoreSecondaryMissionsAtEndOfTurn(fallback, 1, rules40K11th);
  assert.deepEqual(fallbackRecords.map(record => record.status), ['awarded', 'unsupported']);
  assert.equal(fallbackRecords[0].vp, 3);
  assert.equal(fallback.scores[0], 3);

  const unsupported = makeBeacon('Layout Defined', [], { x: 20, y: 20 });
  unsupported.activeArmy = 1;
  const unsupportedRecords = scoreSecondaryMissionsAtEndOfTurn(unsupported, 1, rules40K11th);
  assert.deepEqual(unsupportedRecords.map(record => record.status), ['unsupported']);
  assert.equal(unsupported.scores[0], 0);
});

test('automatic Behind Enemy Lines uses whole-unit containment, exclusions, timing, and the 5VP cap', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.setup = { ...initial.setup!, deployment: 'Dawn of War' };
  const first = losTestUnit('first', 0, { x: 10, y: 40 });
  const second = losTestUnit('second', 0, { x: 20, y: 40 });
  const partial = losTestUnit('partial', 0, { x: 30, y: 32.2 });
  const shocked = losTestUnit('shocked', 0, { x: 40, y: 40 });
  shocked.battleshocked = true;
  const aircraft = losTestUnit('aircraft', 0, { x: 50, y: 40 });
  aircraft.profile.keywords = ['Aircraft'];
  initial.units = [first, second, partial, shocked, aircraft, losTestUnit('red', 1, { x: 50, y: 5 })];
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Behind Enemy Lines']);
  battle = drawSecondaryMission(battle, 0, 'Behind Enemy Lines');

  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(battle, 1, rules40K11th), []);
  const records = scoreSecondaryMissionsAtEndOfTurn(battle, 0, rules40K11th);
  assert.equal(records[0].vp, 5);
  assert.match(records[0].detail, /2 eligible friendly units/);
});

test('automatic Bring It Down scores fixed and tactical destruction facts at turn end', () => {
  const initial = state('shooting');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  const highWounds = losTestUnit('high-wounds', 1, { x: 20, y: 10 });
  highWounds.profile.wounds = 12;
  const lowWounds = losTestUnit('low-wounds', 1, { x: 22, y: 10 });
  lowWounds.profile.wounds = 9;
  initial.units = [losTestUnit('blue', 0, { x: 10, y: 10 }), highWounds, lowWounds];

  const fixed = configureSecondaryMissions(initial, 0, 'fixed', ['Bring It Down']);
  recordDestroyedModelMissionEvents(fixed, fixed.units[1], [0], 0);
  recordDestroyedModelMissionEvents(fixed, fixed.units[2], [0], 0);
  assert.equal(fixed.scores[0], 0);
  const fixedRecords = scoreSecondaryMissionsAtEndOfTurn(fixed, 0, rules40K11th);
  assert.equal(fixed.scores[0], 4);
  assert.equal(fixedRecords.length, 1);

  let tactical = configureSecondaryMissions(initial, 0, 'tactical', ['Bring It Down']);
  tactical = drawSecondaryMission(tactical, 0, 'Bring It Down');
  recordDestroyedModelMissionEvents(tactical, tactical.units[1], [0], 0);
  const records = scoreSecondaryMissionsAtEndOfTurn(tactical, 0, rules40K11th);
  assert.equal(records[0].vp, 5);
  assert.equal(tactical.scores[0], 5);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(tactical, 0, rules40K11th), []);
});

test('automatic Burden of Trust validates guards at its deadline and applies its 5VP cap', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  initial.objectiveOwners = [null, null, null];
  const guards = [
    losTestUnit('guard-1', 0, { x: 10, y: 10 }),
    losTestUnit('guard-2', 0, { x: 20, y: 10 }),
    losTestUnit('guard-3', 0, { x: 30, y: 10 }),
  ];
  initial.units = [...guards, losTestUnit('red', 1, { x: 50, y: 30 })];
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Burden of Trust']);
  battle = drawSecondaryMission(battle, 0, 'Burden of Trust');
  battle = selectBurdenOfTrustGuards(battle, 0, {
    guards: guards.map((unit, objectiveIndex) => ({ unitId: unit.id, objectiveIndex })),
  });
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(battle, 0, rules40K11th), []);
  battle.activeArmy = 1;
  const records = scoreSecondaryMissionsAtEndOfTurn(battle, 1, rules40K11th);
  assert.equal(records[0].vp, 5);
  assert.match(records[0].detail, /3 objectives remained guarded/);

  const unsupported = state('fight');
  unsupported.ruleset = rulesetMetadataForState(rules40K11th);
  unsupported.objectiveControl = rules40K11th.objectiveControl;
  unsupported.objectives = [{ x: 10, y: 10 }];
  unsupported.units = [losTestUnit('guard', 0, { x: 10, y: 10 }), losTestUnit('red', 1, { x: 40, y: 30 })];
  let unknown = configureSecondaryMissions(unsupported, 0, 'tactical', ['Burden of Trust']);
  unknown = drawSecondaryMission(unknown, 0, 'Burden of Trust');
  unknown = selectBurdenOfTrustGuards(unknown, 0, { guards: [{ objectiveIndex: 0, unitId: 'guard' }] });
  unknown.activeArmy = 1;
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(unknown, 1, rules40K11th)[0].status, 'unsupported');
});

test('automatic Centre Ground uses footprints, eligibility filters, and exclusive tiers', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  const friendly = losTestUnit('friendly-centre', 0, { x: 30, y: 22 });
  initial.units = [friendly, losTestUnit('enemy-far', 1, { x: 45, y: 35 })];
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Centre Ground']);
  battle = drawSecondaryMission(battle, 0, 'Centre Ground');
  const records = scoreSecondaryMissionsAtEndOfTurn(battle, 0, rules40K11th);
  assert.deepEqual(records.map(record => record.vp), [5]);
  assert.equal(battle.scores[0], 5);

  const contested = state('fight');
  contested.ruleset = rulesetMetadataForState(rules40K11th);
  const shockedEnemy = losTestUnit('shocked-enemy', 1, { x: 30, y: 26 });
  shockedEnemy.battleshocked = true;
  contested.units = [losTestUnit('friendly-centre', 0, { x: 30, y: 22 }), shockedEnemy];
  let limited = configureSecondaryMissions(contested, 0, 'tactical', ['Centre Ground']);
  limited = drawSecondaryMission(limited, 0, 'Centre Ground');
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(limited, 0, rules40K11th).map(record => record.vp), [3]);
});

test('automatic Cleanse scores mutually exclusive completed-action target counts', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  let one = configureSecondaryMissions(initial, 0, 'tactical', ['Cleanse']);
  one = drawSecondaryMission(one, 0, 'Cleanse');
  one.missionEvents = {
    completedActionsThisTurn: [{
      actionId: 'cleanse', actionName: 'Cleanse', side: 0, unitId: 'unit-1', unitName: 'Unit 1',
      targetObjectiveIndex: 0, battleRound: 1, turn: 1,
    }],
  };
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(one, 0, rules40K11th).map(record => record.vp), [2, 0]);

  let two = configureSecondaryMissions(initial, 0, 'tactical', ['Cleanse']);
  two = drawSecondaryMission(two, 0, 'Cleanse');
  two.missionEvents = {
    completedActionsThisTurn: [0, 1].map(index => ({
      actionId: 'cleanse', actionName: 'Cleanse', side: 0 as const, unitId: `unit-${index}`, unitName: `Unit ${index}`,
      targetObjectiveIndex: index, battleRound: 1, turn: 1,
    })),
  };
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(two, 0, rules40K11th).map(record => record.vp), [0, 5]);
  assert.equal(two.scores[0], 5);
});

test('automatic Defend Stronghold scores its cumulative bonus and fails closed for unknown deployment geometry', () => {
  const makeStronghold = (deployment: string, enemyPosition: Position) => {
    const initial = state('fight', 2);
    initial.ruleset = rulesetMetadataForState(rules40K11th);
    initial.setup = { ...initial.setup!, deployment };
    initial.objectives = [{ x: 10, y: 5 }];
    initial.objectiveOwners = [null];
    initial.terrain = [terrainMat({ id: 'home', type: 'ruin', x: 8, y: 3, width: 4, height: 4, objectiveRole: 'home-0' })];
    initial.units = [losTestUnit('blue-home', 0, { x: 10, y: 5 }), losTestUnit('red', 1, enemyPosition)];
    let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Defend Stronghold']);
    battle = drawSecondaryMission(battle, 0, 'Defend Stronghold');
    battle.activeArmy = 1;
    return battle;
  };
  const clear = makeStronghold('Dawn of War', { x: 40, y: 30 });
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(clear, 1, rules40K11th).map(record => record.vp), [3, 2]);
  assert.equal(clear.scores[0], 5);

  const invaded = makeStronghold('Dawn of War', { x: 20, y: 5 });
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(invaded, 1, rules40K11th).map(record => record.vp), [3, 0]);

  const unknown = makeStronghold('Layout Defined', { x: 40, y: 30 });
  const unknownRecords = scoreSecondaryMissionsAtEndOfTurn(unknown, 1, rules40K11th);
  assert.deepEqual(unknownRecords.map(record => record.status), ['awarded', 'unsupported']);
  assert.equal(unknown.scores[0], 3);
});

test('automatic Display of Might scores at either turn end and fails closed without deployment geometry', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.setup = { ...initial.setup!, deployment: 'Dawn of War' };
  const shocked = losTestUnit('shocked', 1, { x: 40, y: 22 });
  shocked.battleshocked = true;
  initial.units = [
    losTestUnit('blue-a', 0, { x: 20, y: 22 }),
    losTestUnit('blue-b', 0, { x: 30, y: 22 }),
    losTestUnit('red-a', 1, { x: 40, y: 22 }),
    shocked,
  ];
  let ownTurn = configureSecondaryMissions(initial, 0, 'tactical', ['Display of Might']);
  ownTurn = drawSecondaryMission(ownTurn, 0, 'Display of Might');
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(ownTurn, 0, rules40K11th)[0].vp, 2);

  let opponentTurn = configureSecondaryMissions(initial, 0, 'tactical', ['Display of Might']);
  opponentTurn = drawSecondaryMission(opponentTurn, 0, 'Display of Might');
  opponentTurn.activeArmy = 1;
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(opponentTurn, 1, rules40K11th)[0].vp, 5);

  const unknown = structuredClone(opponentTurn);
  unknown.missionState!.secondaryMissionScoringRecords = [];
  unknown.scores[0] = 0;
  unknown.setup = { ...unknown.setup!, deployment: 'Layout Defined' };
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(unknown, 1, rules40K11th)[0].status, 'unsupported');
});

test('automatic Engage on All Fronts applies exclusive fixed and tactical quarter tiers', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.units = [
    losTestUnit('q1', 0, { x: 10, y: 8 }),
    losTestUnit('q2', 0, { x: 50, y: 8 }),
    losTestUnit('q3', 0, { x: 10, y: 36 }),
    losTestUnit('q4', 0, { x: 50, y: 36 }),
    losTestUnit('red', 1, { x: 30, y: 22 }),
  ];
  const fixed = configureSecondaryMissions(initial, 0, 'fixed', ['Engage on All Fronts']);
  const fixedRecords = scoreSecondaryMissionsAtEndOfTurn(fixed, 0, rules40K11th);
  assert.deepEqual(fixedRecords.map(record => record.vp), [4]);
  assert.deepEqual(fixedRecords[0].clauseIds, ['fixed-presence-four-quarters']);

  let tactical = configureSecondaryMissions(initial, 0, 'tactical', ['Engage on All Fronts']);
  tactical = drawSecondaryMission(tactical, 0, 'Engage on All Fronts');
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(tactical, 0, rules40K11th).map(record => record.vp), [5]);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(tactical, 1, rules40K11th), []);
});

test('automatic Forward Position accepts either published objective-control alternative and fails closed on incomplete roles', () => {
  const makeBattle = (unitPositions: Position[], terrain: Terrain[]) => {
    const initial = state('fight');
    initial.ruleset = rulesetMetadataForState(rules40K11th);
    initial.objectives = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 50, y: 10 }];
    initial.objectiveOwners = [null, null, null];
    initial.terrain = terrain;
    initial.units = [
      ...unitPositions.map((position, index) => losTestUnit(`blue-${index}`, 0, position)),
      losTestUnit('red', 1, { x: 40, y: 35 }),
    ];
    let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Forward Position']);
    return drawSecondaryMission(battle, 0, 'Forward Position');
  };
  const roles = [
    terrainMat({ id: 'enemy-home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
    terrainMat({ id: 'exp-a', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'expansion-0' }),
    terrainMat({ id: 'exp-b', type: 'ruin', x: 48, y: 8, width: 4, height: 4, objectiveRole: 'expansion-1' }),
  ];
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(makeBattle([{ x: 10, y: 10 }], roles), 0, rules40K11th)[0].vp, 5);
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(makeBattle([{ x: 30, y: 10 }, { x: 50, y: 10 }], roles), 0, rules40K11th)[0].vp, 5);
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(makeBattle([], []), 0, rules40K11th)[0].status, 'unsupported');
});

test('automatic No Prisoners and Overwhelming Force use either-turn destruction facts and printed caps', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  const targets = [0, 1, 2].map(index => losTestUnit(`target-${index}`, 1, { x: 20 + index * 2, y: 20 }));
  initial.units = [losTestUnit('blue', 0, { x: 10, y: 10 }), ...targets];
  targets.forEach(target => recordDestroyedUnitMissionEvent(initial, target, 0));
  let prisoners = configureSecondaryMissions(initial, 0, 'tactical', ['No Prisoners']);
  prisoners = drawSecondaryMission(prisoners, 0, 'No Prisoners');
  prisoners.activeArmy = 1;
  const prisonersRecord = scoreSecondaryMissionsAtEndOfTurn(prisoners, 1, rules40K11th)[0];
  assert.equal(prisonersRecord.requestedVp, 5);
  assert.equal(prisonersRecord.vp, 5);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(prisoners, 1, rules40K11th), []);

  let overwhelming = configureSecondaryMissions(initial, 0, 'tactical', ['Overwhelming Force']);
  overwhelming = drawSecondaryMission(overwhelming, 0, 'Overwhelming Force');
  overwhelming.missionEvents!.startOfTurn = {
    activeSide: 1, battleRound: 1, turn: 1, objectiveOwners: [],
    units: targets.map(target => ({
      unitId: target.id, side: 1, unitName: target.profile.name, remainingModels: 1,
      modelPositions: target.modelPositions, objectiveIndexesWithinRange: [0],
    })),
  };
  overwhelming.activeArmy = 1;
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(overwhelming, 1, rules40K11th)[0].vp, 5);
  const unsupported = structuredClone(overwhelming);
  unsupported.missionState!.secondaryMissionScoringRecords = [];
  unsupported.scores[0] = 0;
  unsupported.missionEvents!.startOfTurn = undefined;
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(unsupported, 1, rules40K11th)[0].status, 'unsupported');
});

test('automatic Outflank uses opposite edges, eligibility filters, exclusive tiers, and conservative territory', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.terrain = [
    terrainMat({ id: 'left-neutral', type: 'ruin', x: 0, y: 0, width: 10, height: 20, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'right-neutral', type: 'ruin', x: 50, y: 0, width: 10, height: 20, objectiveRole: 'no-mans-land' }),
  ];
  initial.units = [
    losTestUnit('left', 0, { x: 3, y: 10 }),
    losTestUnit('right', 0, { x: 57, y: 10 }),
    losTestUnit('red', 1, { x: 30, y: 22 }),
  ];
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Outflank']);
  battle = drawSecondaryMission(battle, 0, 'Outflank');
  const record = scoreSecondaryMissionsAtEndOfTurn(battle, 0, rules40K11th)[0];
  assert.equal(record.vp, 5);
  assert.deepEqual(record.clauseIds, ['two-units-near-opposite-edges-one-outside-territory']);

  const unknown = structuredClone(battle);
  unknown.missionState!.secondaryMissionScoringRecords = [];
  unknown.scores[0] = 0;
  unknown.terrain = [];
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(unknown, 0, rules40K11th)[0].status, 'unsupported');
});

test('automatic Plunder and Secure No Man\'s Land score owner-turn action and objective facts', () => {
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.objectives = [{ x: 20, y: 20 }, { x: 40, y: 20 }];
  initial.objectiveOwners = [null, null];
  initial.terrain = [
    terrainMat({ id: 'mid-a', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'mid-b', type: 'ruin', x: 38, y: 18, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  initial.units = [
    losTestUnit('blue-a', 0, { x: 20, y: 20 }),
    losTestUnit('blue-b', 0, { x: 40, y: 20 }),
    losTestUnit('red', 1, { x: 50, y: 35 }),
  ];
  let secure = configureSecondaryMissions(initial, 0, 'tactical', ["Secure No Man's Land"]);
  secure = drawSecondaryMission(secure, 0, "Secure No Man's Land");
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(secure, 0, rules40K11th)[0].vp, 5);

  let plunder = configureSecondaryMissions(initial, 0, 'tactical', ['Plunder']);
  plunder = drawSecondaryMission(plunder, 0, 'Plunder');
  plunder.missionEvents = { completedActionsThisTurn: [{
    actionId: 'plunder', actionName: 'Plunder', side: 0, unitId: 'blue-a', unitName: 'Blue',
    targetTerrainId: 'mid-a', battleRound: 1, turn: 1,
  }] };
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(plunder, 0, rules40K11th)[0].vp, 5);
  assert.deepEqual(scoreSecondaryMissionsAtEndOfTurn(plunder, 1, rules40K11th), []);

  const unknown = structuredClone(secure);
  unknown.missionState!.secondaryMissionScoringRecords = [];
  unknown.scores[0] = 0;
  unknown.terrain.pop();
  assert.equal(scoreSecondaryMissionsAtEndOfTurn(unknown, 0, rules40K11th)[0].status, 'unsupported');
});

test('final secondary scoring batch runs through manual and simulation lifecycles and persists', async () => {
  installStorage();
  const initial = state('fight');
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.units = [
    losTestUnit('q1', 0, { x: 10, y: 8 }), losTestUnit('q2', 0, { x: 50, y: 8 }),
    losTestUnit('q3', 0, { x: 10, y: 36 }), losTestUnit('q4', 0, { x: 50, y: 36 }),
    losTestUnit('red', 1, { x: 30, y: 22 }),
  ];
  const battle = configureSecondaryMissions(initial, 0, 'fixed', ['Engage on All Fronts']);
  const result = appendTimelineAction(
    createPracticeTimeline(battle, { id: 'final-secondary-batch' }), battle,
    { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th },
  );
  assert.equal(result.state.scores[0], 4);
  assert.ok(result.state.log.some(entry => /Secondary \(Engage on All Fronts\).+\+4VP/.test(entry.message)));
  const replayed = replayTimeline(result.timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.secondaryMissionScoringRecords, result.state.missionState?.secondaryMissionScoringRecords);
  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(result.timeline, { id: 'final-secondary-batch-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('final-secondary-batch-save');
  assert.deepEqual(currentTimelineState(loaded!.timeline).scores, result.state.scores);

  const simulated = simulateNextPhase(battle, rules40K11th);
  assert.equal(simulated.scores[0], 4);
  assert.ok(simulated.log.some(entry => entry.message.includes('Secondary (Engage on All Fronts)')));
});

test('secondary scoring lifecycle replays and persists Defend Stronghold awards and logs', async () => {
  installStorage();
  const initial = state('fight', 2);
  initial.ruleset = rulesetMetadataForState(rules40K11th);
  initial.activeArmy = 1;
  initial.objectives = [{ x: 10, y: 5 }];
  initial.objectiveOwners = [null];
  initial.terrain = [terrainMat({ id: 'home', type: 'ruin', x: 8, y: 3, width: 4, height: 4, objectiveRole: 'home-0' })];
  initial.units = [losTestUnit('blue-home', 0, { x: 10, y: 5 }), losTestUnit('red', 1, { x: 40, y: 30 })];
  let battle = configureSecondaryMissions(initial, 0, 'tactical', ['Defend Stronghold']);
  battle = drawSecondaryMission(battle, 0, 'Defend Stronghold');
  const result = appendTimelineAction(
    createPracticeTimeline(battle, { id: 'stronghold-scoring-game' }),
    battle,
    { type: GAME_ACTION_TYPE.StepPhase },
    { rules: rules40K11th },
  );
  assert.equal(result.state.scores[0], 5);
  assert.equal(result.state.log.filter(entry => entry.message.includes('Secondary (Defend Stronghold)')).length, 2);
  const replayed = replayTimeline(result.timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.secondaryMissionScoringRecords, result.state.missionState?.secondaryMissionScoringRecords);
  assert.deepEqual(replayed.scores, result.state.scores);

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(result.timeline, { id: 'stronghold-scoring-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('stronghold-scoring-save');
  const loadedState = currentTimelineState(loaded!.timeline);
  assert.deepEqual(loadedState.missionState?.secondaryMissionScoringRecords, result.state.missionState?.secondaryMissionScoringRecords);
  assert.deepEqual(loadedState.scores, result.state.scores);
});

test('secondary scoring lifecycle logs and fixed Assassination replay and persistence are deterministic', async () => {
  installStorage();
  const battle = state('shooting');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const attacker = losTestUnit('attacker', 0, { x: 10, y: 10 });
  const target = losTestUnit('target-character', 1, { x: 20, y: 10 });
  target.profile.keywords = ['Character'];
  target.profile.wounds = 5;
  target.pendingDamageAllocations = [{ damage: 5, source: 'Test', sourceUnitId: attacker.id }];
  battle.units = [attacker, target];
  const configured = configureSecondaryMissions(battle, 0, 'fixed', ['Assassination']);
  const action = { type: GAME_ACTION_TYPE.AllocateDamage, side: 1 as const, unitId: target.id, modelIndex: 0 };
  let result = appendTimelineAction(
    createPracticeTimeline(configured, { id: 'secondary-scoring-game' }),
    configured,
    action,
    { rules: rules40K11th },
  );
  assert.equal(result.state.scores[0], 0);
  for (let step = 0; step < 4; step += 1) {
    result = appendTimelineAction(result.timeline, result.state, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
  }
  assert.equal(result.state.scores[0], 4);
  assert.equal(result.state.missionState?.secondaryMissionScoringRecords?.length, 1);
  assert.ok(result.state.log.some(entry => /Secondary \(Assassination\).+\+4VP/.test(entry.message)));

  const replayed = replayTimeline(result.timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.secondaryMissionScoringRecords, result.state.missionState?.secondaryMissionScoringRecords);
  assert.deepEqual(replayed.scores, result.state.scores);

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(result.timeline, { id: 'secondary-scoring-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('secondary-scoring-save');
  const loadedState = currentTimelineState(loaded!.timeline);
  assert.deepEqual(loadedState.missionState?.secondaryMissionScoringRecords, result.state.missionState?.secondaryMissionScoringRecords);
  assert.deepEqual(loadedState.scores, result.state.scores);
});

test('typed when-drawn secondary choices validate objectives and battlefield units', () => {
  const initial = {
    ...state('command'),
    ruleset: rulesetMetadataForState(rules40K11th),
  };
  initial.objectives = [{ x: 5, y: 5 }, { x: 15, y: 15 }, { x: 25, y: 15 }];
  initial.terrain = [
    terrainMat({ id: 'blue-home', type: 'ruin', x: 3, y: 3, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'tempting-area', type: 'ruin', x: 13, y: 13, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'central-area', type: 'ruin', x: 23, y: 13, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const guard = losTestUnit('guard-unit', 0, { x: 15, y: 15 });
  const transport = losTestUnit('transport-unit', 0, { x: 20, y: 15 });
  transport.profile.transportCapacity = 10;
  const passenger = losTestUnit('passenger-unit', 0, { x: 20, y: 15 });
  passenger.embarkedInUnitId = transport.id;
  const enemy = losTestUnit('enemy-unit', 1, { x: 25, y: 15 });
  initial.units = [guard, transport, passenger, enemy];

  let next = configureSecondaryMissions(initial, 0, 'tactical', [
    'A Tempting Target',
    'Beacon',
    'Burden of Trust',
  ]);
  next = drawSecondaryMission(next, 0, 'A Tempting Target');
  next = drawSecondaryMission(next, 0, 'Beacon');

  assert.equal(selectTemptingTargetObjective(next, 0, { objectiveIndex: 0, selectedBySide: 1 }), next);
  assert.equal(selectTemptingTargetObjective(next, 0, { objectiveIndex: 1, selectedBySide: 0 }), next);
  const temptingSelected = selectTemptingTargetObjective(next, 0, { objectiveIndex: 1, selectedBySide: 1 });
  assert.deepEqual(
    temptingSelected.missionState?.secondaryMissions?.[0].activeCards[0].whenDrawnSelections,
    { objectiveIndex: 1, selectedBySide: 1 },
  );

  assert.equal(selectBeaconUnit(temptingSelected, 0, { unitId: enemy.id }), temptingSelected);
  const beaconSelected = selectBeaconUnit(temptingSelected, 0, { unitId: passenger.id });
  assert.deepEqual(
    beaconSelected.missionState?.secondaryMissions?.[0].activeCards[1].whenDrawnSelections,
    { unitId: passenger.id },
  );

  const withoutTempting = discardSecondaryMission(beaconSelected, 0, 'A Tempting Target');
  const burdenDrawn = drawSecondaryMission(withoutTempting, 0, 'Burden of Trust');
  assert.equal(selectBurdenOfTrustGuards(burdenDrawn, 0, {
    guards: [{ objectiveIndex: 0, unitId: guard.id }, { objectiveIndex: 0, unitId: transport.id }],
  }), burdenDrawn);
  assert.equal(selectBurdenOfTrustGuards(burdenDrawn, 0, {
    guards: [{ objectiveIndex: 1, unitId: passenger.id }],
  }), burdenDrawn);
  const guarded = selectBurdenOfTrustGuards(burdenDrawn, 0, {
    guards: [{ objectiveIndex: 0, unitId: guard.id }, { objectiveIndex: 2, unitId: transport.id }],
  });
  assert.deepEqual(
    guarded.missionState?.secondaryMissions?.[0].activeCards.find(card => card.missionName === 'Burden of Trust')?.whenDrawnSelections,
    { guards: [{ objectiveIndex: 0, unitId: guard.id }, { objectiveIndex: 2, unitId: transport.id }] },
  );
});

test('model destruction facts replay and persist after the selected model is removed', async () => {
  installStorage();
  const battle = state('shooting');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.activeArmy = 0;
  const attacker = losTestUnit('attacker-unit', 0, { x: 10, y: 10 });
  const target = losTestUnit('character-pair', 1, { x: 20, y: 10 });
  target.profile = {
    ...target.profile,
    name: 'Character Pair',
    wounds: 5,
    baseModelCount: 2,
    keywords: ['Character', 'Infantry'],
    modelProfiles: [
      { name: 'Companion', count: 1, move: 6, toughness: 4, save: 4, wounds: 3, leadership: 7, oc: 1 },
      { name: 'Commander', count: 1, move: 6, toughness: 4, save: 4, wounds: 5, leadership: 7, oc: 1 },
    ],
  };
  target.remainingModels = 2;
  target.modelPositions = [{ x: 20, y: 10 }, { x: 21, y: 10 }];
  target.modelRosterIndexes = [0, 1];
  target.pendingDamageAllocations = [{ damage: 5, source: 'Test weapon', sourceUnitId: attacker.id }];
  battle.units = [attacker, target];

  const action = {
    type: GAME_ACTION_TYPE.AllocateDamage,
    side: 1 as const,
    unitId: target.id,
    modelIndex: 1,
  };
  const result = appendTimelineAction(
    createPracticeTimeline(battle, { id: 'model-destruction-game' }),
    battle,
    action,
    { rules: rules40K11th },
  );
  const event = result.state.missionEvents?.destroyedModelsThisTurn?.[0];

  assert.deepEqual(event, {
    id: 'character-pair:destroyed-model:0',
    unitId: 'character-pair',
    side: 1,
    unitName: 'Character Pair',
    modelName: 'Commander',
    modelIndexAtDestruction: 1,
    rosterModelIndex: 1,
    woundsCharacteristic: 5,
    unitStartingStrength: 2,
    isCharacter: true,
    destroyedBySide: 0,
    destroyedByUnitId: 'attacker-unit',
    battleRound: 1,
    turn: 1,
    phase: 'shooting',
  });
  assert.deepEqual(result.state.missionState?.destroyedModelsDuringBattle, [event]);
  assert.deepEqual(result.state.units.find(unit => unit.id === target.id)?.modelRosterIndexes, [0]);

  const replayed = replayTimeline(result.timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.destroyedModelsDuringBattle, [event]);

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(result.timeline, {
    id: 'model-destruction-save',
  }));
  const loaded = await localPracticeScenarioRepository.loadScenario('model-destruction-save');
  assert.deepEqual(
    currentTimelineState(loaded!.timeline).missionState?.destroyedModelsDuringBattle,
    [event],
  );
});

test('11th Consecrate lets a unit that destroyed an enemy consecrate one non-home objective and replays the choice', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Consecrate', 'Triangulation'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const unit = losTestUnit('blue-killer', 0, { x: 20, y: 10 });
  const target = losTestUnit('red-target', 1, { x: 30, y: 10 });
  target.destroyed = true;
  target.remainingModels = 0;
  target.modelPositions = [];
  battle.units = [unit, target];
  recordDestroyedUnitMissionEvent(battle, target, 0, { destroyedByUnitId: unit.id });

  assert.deepEqual(consecrateObjectiveOptions(battle, unit.id, 0, rules40K11th), [1]);
  assert.equal(getLegalActions(battle, 0, rules40K11th).some(option => option.action.type === GAME_ACTION_TYPE.ConsecrateObjective), true);
  const simulated = simulateNextPhase(battle, rules40K11th);
  assert.equal(simulated.missionState?.operationMarkers?.[0]?.sourceActionId, 'consecrate');
  assert.equal(simulated.scores[0], 3);
  const action = { type: GAME_ACTION_TYPE.ConsecrateObjective, side: 0 as const, unitId: unit.id, objectiveIndex: 1 };
  const started = applyGameAction(battle, action, { rules: rules40K11th });
  const replayed = replayTimeline(appendTimelineAction(
    createPracticeTimeline(battle, { id: 'consecrate-replay' }),
    battle,
    action,
    { rules: rules40K11th },
  ).timeline, { rules: rules40K11th }, false);

  assert.equal(started.missionState?.operationMarkers?.[0]?.sourceActionId, 'consecrate');
  assert.deepEqual(replayed.missionState?.operationMarkers, started.missionState?.operationMarkers);
  assert.deepEqual(consecrateObjectiveOptions(started, unit.id, 0, rules40K11th), []);
  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Consecrate marker tiers and enemy-home end-battle bonus score from persistent markers', () => {
  const battle = state('fight', 3);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Consecrate', 'Triangulation'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.missionState = {
    operationMarkers: battle.objectives.map((position, objectiveIndex) => ({
      id: `consecrate-${objectiveIndex}`,
      side: 0,
      sourceActionId: 'consecrate',
      placedByUnitId: `unit-${objectiveIndex}`,
      objectiveIndex,
      position,
      battleRound: objectiveIndex + 1,
      turn: objectiveIndex + 1,
    })),
  };

  const tierResult = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(tierResult.vpGained, 6);
  assert.deepEqual(tierResult.unsupportedClauses, []);

  const endBattle: BattleState = JSON.parse(JSON.stringify(battle));
  endBattle.phase = 'end';
  endBattle.scores = [0, 0];
  const finalResult = scorePrimaryMission(endBattle, 0, rules40K11th);
  assert.equal(finalResult.vpGained, 5);
  assert.deepEqual(finalResult.unsupportedClauses, []);
});

test('11th Consecrate waits for the end-turn choice window and uses final objective proximity', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = { ...battle.setup!, primaryMissions: ['Consecrate', 'Triangulation'] };
  battle.objectives = [{ x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'central', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'expansion', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'expansion-0' }),
  ];
  const killer = losTestUnit('blue-killer', 0, { x: 20, y: 10 });
  const survivor = losTestUnit('red-survivor', 1, { x: 21, y: 10 });
  const destroyed = losTestUnit('red-destroyed', 1, { x: 40, y: 10 });
  destroyed.destroyed = true;
  destroyed.remainingModels = 0;
  destroyed.modelPositions = [];
  battle.units = [killer, survivor, destroyed];
  recordDestroyedUnitMissionEvent(battle, destroyed, 0, { destroyedByUnitId: killer.id });

  assert.deepEqual(consecrateObjectiveOptions(battle, killer.id, 0, rules40K11th), []);
  assert.equal(applyGameAction(battle, {
    type: GAME_ACTION_TYPE.ConsecrateObjective,
    side: 0,
    unitId: killer.id,
    objectiveIndex: 0,
  }, { rules: rules40K11th }), battle);

  killer.activated = true;
  killer.piledIn = true;
  killer.consolidated = true;
  killer.position = { x: 30, y: 10 };
  killer.modelPositions = [{ x: 30, y: 10 }];
  assert.deepEqual(consecrateObjectiveOptions(battle, killer.id, 0, rules40K11th), [1]);
});

test("11th Destroyer's Wrath scores objective control clauses from mission data", () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ["Destroyer's Wrath", 'Vital Link'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-home', 0, { x: 10, y: 10 }),
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('red-home', 1, { x: 30, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, "11e-data:Destroyer's Wrath");
  assert.equal(result.vpGained, 10);
  assert.deepEqual(battle.scores, [10, 0]);
});

test("11th destroyed-unit mission events score Destroyer's Wrath kill clause", () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ["Destroyer's Wrath", 'Vital Link'],
  };
  const target = losTestUnit('red-target', 1, { x: 20, y: 10 });
  battle.units = [
    losTestUnit('blue-attacker', 0, { x: 10, y: 10 }),
    target,
  ];

  applyDamage(target, 1, battle, 0);

  assert.equal(target.destroyed, true);
  assert.equal(battle.missionEvents?.destroyedUnitsThisTurn?.length, 1);
  assert.equal(battle.missionEvents?.destroyedUnitsThisTurn?.[0].destroyedBySide, 0);
  assert.equal(battle.missionEvents?.destroyedUnitsThisTurn?.[0].startingStrength, 1);
  assert.equal(battle.missionEvents?.destroyedModelsThisTurn?.[0].woundsCharacteristic, 1);
  assert.equal(battle.missionState?.destroyedUnitsDuringBattle?.length, 1);
  assert.equal(battle.missionState?.destroyedModelsDuringBattle?.length, 1);

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /One or more enemy units were destroyed this turn/);
});

test('mission event helpers record each destroyed unit once and preserve the completed turn summary', () => {
  const battle = state('shooting', 2);
  battle.activeArmy = 1;
  const destroyedUnit = losTestUnit('blue-target', 0, { x: 20, y: 10 });
  destroyedUnit.profile.name = 'Blue Target';

  recordDestroyedUnitMissionEvent(battle, destroyedUnit, 1);
  recordDestroyedUnitMissionEvent(battle, destroyedUnit, 1);

  assert.deepEqual(battle.missionEvents?.destroyedUnitsThisTurn, [{
    unitId: 'blue-target',
    side: 0,
    unitName: 'Blue Target',
    startingStrength: 1,
    isCharacter: false,
    destroyedBySide: 1,
    battleRound: 2,
    turn: 2,
    phase: 'shooting',
  }]);

  completeMissionEventsForCurrentTurn(battle);

  assert.deepEqual(battle.missionEvents?.lastCompletedTurn, {
    activeSide: 1,
    battleRound: 2,
    turn: 2,
    destroyedUnitCounts: [1, 0],
  });

  startMissionEventsForNewTurn(battle, rules40K11th);

  assert.deepEqual(battle.missionEvents?.destroyedUnitsThisTurn, []);
  assert.deepEqual(battle.missionEvents?.destroyedModelsThisTurn, []);
  assert.deepEqual(battle.missionEvents?.lastCompletedTurn?.destroyedUnitCounts, [1, 0]);
  assert.equal(battle.missionState?.destroyedUnitsDuringBattle?.length, 1);
});

test('mission event turn start captures objective owners and stable battlefield unit positions', () => {
  const battle = state('setup', 2);
  battle.objectives = [{ x: 10, y: 10 }];
  battle.objectiveOwners = [null];
  const controller = losTestUnit('blue-controller', 0, { x: 10, y: 10 });
  controller.profile.name = 'Blue Controller';
  const reserve = losTestUnit('red-reserve', 1, { x: 20, y: 10 });
  reserve.inStrategicReserves = true;
  reserve.modelPositions = [];
  battle.units = [controller, reserve];

  startMissionEventsForNewTurn(battle, rules40K10th);
  controller.modelPositions[0].x = 30;

  assert.deepEqual(battle.missionEvents?.startOfTurn, {
    activeSide: 0,
    battleRound: 2,
    turn: 2,
    objectiveOwners: [0],
    units: [{
      unitId: 'blue-controller',
      side: 0,
      unitName: 'Blue Controller',
      remainingModels: 1,
      modelPositions: [{ x: 10, y: 10 }],
      objectiveIndexesWithinRange: [0],
      terrainAreaIds: [],
    }],
  });
});

test('11th Determined Acquisition scores newly controlled non-home objectives from the turn-start snapshot', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Determined Acquisition', 'Death Trap'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  const blueHome = losTestUnit('blue-home', 0, { x: 10, y: 10 });
  const blueAdvance = losTestUnit('blue-advance', 0, { x: 15, y: 10 });
  battle.units = [blueHome, blueAdvance];

  startMissionEventsForNewTurn(battle, rules40K11th);
  blueAdvance.position = { x: 20, y: 10 };
  blueAdvance.modelPositions = [{ x: 20, y: 10 }];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.vpGained, 2);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /1 objective x 2VP/);
});

test('11th Determined Acquisition does not score objectives already controlled at turn start', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Determined Acquisition', 'Death Trap'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  battle.units = [losTestUnit('blue-mid', 0, { x: 20, y: 10 })];

  startMissionEventsForNewTurn(battle, rules40K11th);
  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 0);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Determined Acquisition scores each controlled objective in opponent territory and preserves base VP without geometry', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Determined Acquisition', 'Death Trap'],
    territoryZones: verticalTerritories(30),
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 40, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = battle.objectives.map((objective, index) => terrainMat({
    id: `objective-${index}`,
    type: 'ruin',
    x: objective.x - 1,
    y: objective.y - 1,
    width: 2,
    height: 2,
  }));
  battle.units = battle.objectives.map((objective, index) => losTestUnit(`blue-${index}`, 0, objective));

  const exact = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(exact.vpGained, 15);
  assert.deepEqual(exact.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(exact), /opponent-territory bonus 2 x 3VP/);

  const unknown: BattleState = JSON.parse(JSON.stringify(battle));
  unknown.scores = [0, 0];
  unknown.missionState!.primaryMissionScoringRecords = [];
  delete unknown.setup!.territoryZones;
  const baseOnly = scorePrimaryMission(unknown, 0, rules40K11th);
  assert.equal(baseOnly.vpGained, 9);
  assert.match(baseOnly.unsupportedClauses?.[0] ?? '', /territory geometry/);
});

test('11th Extract Relic scores an enemy destroyed after starting within objective range', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Extract Relic', 'Gather Intel'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const target = losTestUnit('red-target', 1, { x: 20, y: 10 });
  battle.units = [target];

  startMissionEventsForNewTurn(battle, rules40K11th);
  applyDamage(target, 1, battle, 0);
  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /started the turn within range/);
});

test('11th Sensor Sweep removes a selected operation marker while controlling a central objective', () => {
  const battle = state('shooting', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Extract Relic', 'Locate and Deny'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'central', name: 'Central', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'remote', name: 'Remote', type: 'ruin', x: 38, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  const unit = losTestUnit('blue-sweeper', 0, { x: 20, y: 10 });
  battle.units = [unit];
  battle.missionState = {
    operationMarkers: [
      {
        id: 'marker-central',
        side: 1,
        sourceActionId: 'decoy',
        placedByUnitId: 'red-a',
        objectiveIndex: 0,
        position: { x: 20, y: 10 },
        battleRound: 1,
        turn: 1,
      },
      {
        id: 'marker-remote',
        side: 1,
        sourceActionId: 'decoy',
        placedByUnitId: 'red-b',
        objectiveIndex: 0,
        position: { x: 40, y: 10 },
        battleRound: 1,
        turn: 1,
      },
    ],
  };

  assert.deepEqual(sensorSweepOptions(battle, unit.id, 0, rules40K11th), [
    { objectiveIndex: 0, operationMarkerId: 'marker-central' },
    { objectiveIndex: 0, operationMarkerId: 'marker-remote' },
  ]);
  const beforeShooting: BattleState = { ...battle, phase: 'movement' };
  assert.deepEqual(sensorSweepOptions(beforeShooting, unit.id, 0, rules40K11th), []);
  const replayed = applyGameAction(battle, {
    type: 'play.startAction',
    side: 0,
    unitId: unit.id,
    actionId: 'sensor-sweep',
    actionName: 'Sensor Sweep',
    targetObjectiveIndex: 0,
    targetOperationMarkerId: 'marker-central',
  }, { rules: rules40K11th });
  assert.equal(replayed.units[0].performingAction?.targetOperationMarkerId, 'marker-central');

  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'sensor-sweep',
    'Sensor Sweep',
    rules40K11th,
    0,
    undefined,
    'marker-central',
  );
  completeEndOfTurnActions(started, 0);

  assert.deepEqual(started.missionState?.operationMarkers?.map(marker => marker.id), ['marker-remote']);
  assert.equal(started.missionEvents?.completedActionsThisTurn?.[0]?.targetOperationMarkerId, 'marker-central');
  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 4);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.deepEqual(sensorSweepOptions(started, unit.id, 0, rules40K11th), []);
});

test('11th Sensor Sweep requires more than one marker and central objective control at completion', () => {
  const battle = state('shooting', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Locate and Deny', 'Extract Relic'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'central', name: 'Central', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const unit = losTestUnit('blue-sweeper', 0, { x: 20, y: 10 });
  const marker = {
    id: 'marker-a',
    side: 1 as const,
    sourceActionId: 'decoy',
    placedByUnitId: 'red-a',
    objectiveIndex: 0,
    position: { x: 20, y: 10 },
    battleRound: 1,
    turn: 1,
  };
  battle.units = [unit];
  battle.missionState = { operationMarkers: [marker] };
  assert.deepEqual(sensorSweepOptions(battle, unit.id, 0, rules40K11th), []);

  battle.missionState.operationMarkers = [
    marker,
    { ...marker, id: 'marker-b', placedByUnitId: 'red-b' },
  ];
  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'sensor-sweep',
    'Sensor Sweep',
    rules40K11th,
    0,
    undefined,
    'marker-a',
  );
  started.units.push(losTestUnit('red-controller', 1, { x: 20, y: 10 }));
  completeEndOfTurnActions(started, 0);

  assert.equal(started.missionState?.operationMarkers?.length, 2);
  assert.equal(started.missionEvents?.completedActionsThisTurn?.length ?? 0, 0);
});

test('11th Extract Relic and Locate and Deny score remaining operation marker state', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Extract Relic', 'Locate and Deny'],
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [
    terrainMat({ id: 'relic-area', name: 'Relic Area', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  battle.units = [losTestUnit('blue-searcher', 0, { x: 20, y: 10 })];
  battle.missionState = {
    operationMarkers: [{
      id: 'last-red-marker',
      side: 1,
      sourceActionId: 'decoy',
      placedByUnitId: 'red-unit',
      objectiveIndex: 0,
      position: { x: 20, y: 10 },
      battleRound: 1,
      turn: 1,
    }],
  };

  assert.equal(scorePrimaryMission(battle, 0, rules40K11th).vpGained, 4);
  battle.phase = 'end';
  assert.equal(scorePrimaryMission(battle, 0, rules40K11th).vpGained, 5);

  battle.setup.primaryMissions = ['Extract Relic', 'Locate and Deny'];
  battle.missionState.operationMarkers = [];
  assert.equal(scorePrimaryMission(battle, 1, rules40K11th).vpGained, 5);
});

test('11th Secure Asset only counts destroyed enemies that started near a central objective', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Secure Asset', 'Reconnaissance Sweep'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const homeTarget = losTestUnit('red-home-target', 1, { x: 10, y: 10 });
  const centralTarget = losTestUnit('red-central-target', 1, { x: 20, y: 10 });
  battle.units = [homeTarget, centralTarget];

  startMissionEventsForNewTurn(battle, rules40K11th);
  applyDamage(homeTarget, 1, battle, 0);
  let result = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(result.vpGained, 0);

  battle.scores = [0, 0];
  battle.missionState!.primaryMissionScoringRecords = [];
  applyDamage(centralTarget, 1, battle, 0);
  result = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(result.vpGained, 2);
  assert.match(formatPrimaryScoringResult(result), /central objectives/);
});

test('11th Purge and Secure scores when the destroying unit is within objective range', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Purge and Secure', 'Reconnaissance Sweep'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const attacker = losTestUnit('blue-attacker', 0, { x: 20, y: 10 });
  const target = losTestUnit('red-target', 1, { x: 30, y: 10 });
  battle.units = [attacker, target];

  startMissionEventsForNewTurn(battle, rules40K11th);
  applyDamage(target, 1, battle, 0, {
    source: 'Test attack',
    sourceUnitId: attacker.id,
    sourceObjectiveIndexesWithinRange: [0],
  });
  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.equal(battle.missionEvents?.destroyedUnitsThisTurn?.[0].destroyedByUnitId, attacker.id);
  assert.deepEqual(battle.missionEvents?.destroyedUnitsThisTurn?.[0].destroyingUnitObjectiveIndexesWithinRange, [0]);
  assert.match(formatPrimaryScoringResult(result), /friendly unit that was within range/);
});

test('11th Purge and Secure does not score a distant kill with no start-of-turn proximity', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Purge and Secure', 'Reconnaissance Sweep'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const attacker = losTestUnit('blue-attacker', 0, { x: 10, y: 10 });
  const target = losTestUnit('red-target', 1, { x: 30, y: 10 });
  battle.units = [attacker, target];

  startMissionEventsForNewTurn(battle, rules40K11th);
  applyDamage(target, 1, battle, 0, {
    sourceUnitId: attacker.id,
    sourceObjectiveIndexesWithinRange: [],
  });
  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 0);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Search and Scour scores an enemy destroyed after starting within a terrain area', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Search and Scour', 'Vanguard Operation'],
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [
    terrainMat({ id: 'ruin-a', name: 'Ruin A', type: 'ruin', x: 18, y: 8, width: 4, height: 4 }),
  ];
  const target = losTestUnit('red-target', 1, { x: 20, y: 10 });
  battle.units = [target];

  startMissionEventsForNewTurn(battle, rules40K11th);
  applyDamage(target, 1, battle, 0);
  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 2);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.deepEqual(battle.missionEvents?.startOfTurn?.units[0].terrainAreaIds, ['ruin-a']);
  assert.match(formatPrimaryScoringResult(result), /started the turn within a terrain area/);
});

test('11th Search and Scour does not score an enemy that started outside terrain areas', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Search and Scour', 'Vanguard Operation'],
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [
    terrainMat({ id: 'ruin-a', name: 'Ruin A', type: 'ruin', x: 18, y: 8, width: 4, height: 4 }),
  ];
  const target = losTestUnit('red-target', 1, { x: 30, y: 10 });
  battle.units = [target];

  startMissionEventsForNewTurn(battle, rules40K11th);
  applyDamage(target, 1, battle, 0);
  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 0);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Search and Scour end-battle territory clause uses whole-unit footprints and fails closed without geometry', () => {
  const battle = state('end', 5);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Search and Scour', 'Vanguard Operation'],
    territoryZones: verticalTerritories(),
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.units = [losTestUnit('red-crossing', 1, { x: 30, y: 10 })];

  const clear = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(clear.vpGained, 5);
  assert.deepEqual(clear.unsupportedClauses, []);

  const occupied: BattleState = JSON.parse(JSON.stringify(battle));
  occupied.scores = [0, 0];
  occupied.missionState!.primaryMissionScoringRecords = [];
  occupied.units[0].position = { x: 10, y: 10 };
  occupied.units[0].modelPositions = [{ x: 10, y: 10 }];
  assert.equal(scorePrimaryMission(occupied, 0, rules40K11th).vpGained, 0);

  const unknown: BattleState = JSON.parse(JSON.stringify(battle));
  unknown.scores = [0, 0];
  unknown.missionState!.primaryMissionScoringRecords = [];
  delete unknown.setup!.territoryZones;
  const unsupported = scorePrimaryMission(unknown, 0, rules40K11th);
  assert.equal(unsupported.vpGained, 0);
  assert.match(unsupported.unsupportedClauses?.[0] ?? '', /Territory geometry/);
});

test('11th Reconnaissance Sweep scores three occupied table quarters and excludes centre-near units', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Reconnaissance Sweep', 'Purge and Secure'],
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [];
  battle.units = [
    losTestUnit('top-left', 0, { x: 5, y: 5 }),
    losTestUnit('top-right', 0, { x: 55, y: 5 }),
    losTestUnit('bottom-left', 0, { x: 5, y: 39 }),
    losTestUnit('near-centre', 0, { x: 30, y: 16.5 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /three different table quarters/);
});

test('11th Reconnaissance Sweep uses the non-cumulative four-quarter tier and per-unit kill scoring', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Reconnaissance Sweep', 'Purge and Secure'],
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [];
  const targets = [
    losTestUnit('red-target-a', 1, { x: 25, y: 5 }),
    losTestUnit('red-target-b', 1, { x: 35, y: 39 }),
  ];
  battle.units = [
    losTestUnit('top-left', 0, { x: 5, y: 5 }),
    losTestUnit('top-right', 0, { x: 55, y: 5 }),
    losTestUnit('bottom-left', 0, { x: 5, y: 39 }),
    losTestUnit('bottom-right', 0, { x: 55, y: 39 }),
    ...targets,
  ];
  applyDamage(targets[0], 1, battle, 0);
  applyDamage(targets[1], 1, battle, 0);

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 8);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /four different table quarters/);
  assert.match(formatPrimaryScoringResult(result), /2 units x 1VP/);
});

test('11th Surveil the Foe immediately surveils a visible enemy within 18 inches', () => {
  const battle = state('shooting', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Surveil the Foe', 'Smoke and Mirrors'],
  };
  const observer = losTestUnit('blue-observer', 0, { x: 10, y: 10 });
  const target = losTestUnit('red-target', 1, { x: 20, y: 10 });
  const secondTarget = losTestUnit('red-second-target', 1, { x: 20, y: 14 });
  const distant = losTestUnit('red-distant', 1, { x: 40, y: 10 });
  battle.units = [observer, target, secondTarget, distant];

  assert.deepEqual(surveilTargetOptions(battle, observer.id, 0, rules40K11th), [target.id, secondTarget.id]);
  const replayed = applyGameAction(battle, {
    type: 'play.startAction',
    side: 0,
    unitId: observer.id,
    actionId: 'surveil',
    actionName: 'Surveil the Foe',
    targetUnitId: target.id,
  }, { rules: rules40K11th });

  assert.equal(replayed.units[0].performingAction, undefined);
  assert.equal(replayed.missionEvents?.completedActionsThisTurn?.[0]?.targetUnitId, target.id);
  assert.deepEqual(surveilTargetOptions(replayed, observer.id, 0, rules40K11th), [secondTarget.id]);
  const result = scorePrimaryMission(replayed, 0, rules40K11th);
  assert.equal(result.vpGained, 4);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Surveil the Foe does not score when every surveilled unit is protected by a marked objective', () => {
  const battle = state('shooting', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Surveil the Foe', 'Smoke and Mirrors'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'marked-objective', name: 'Marked Objective', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const observer = losTestUnit('blue-observer', 0, { x: 10, y: 10 });
  const target = losTestUnit('red-target', 1, { x: 20, y: 10 });
  battle.units = [observer, target];
  battle.missionState = {
    operationMarkers: [{
      id: 'red-decoy',
      side: 1,
      sourceActionId: 'decoy',
      placedByUnitId: 'red-marker-unit',
      objectiveIndex: 0,
      position: { x: 20, y: 10 },
      battleRound: 1,
      turn: 1,
    }],
  };

  const surveilled = startPlayUnitAction(
    battle,
    observer.id,
    0,
    'surveil',
    'Surveil the Foe',
    rules40K11th,
    undefined,
    undefined,
    undefined,
    target.id,
  );

  assert.equal(scorePrimaryMission(surveilled, 0, rules40K11th).vpGained, 0);
  const exposed: BattleState = JSON.parse(JSON.stringify(surveilled));
  exposed.missionState!.primaryMissionScoringRecords = [];
  exposed.units.find(unit => unit.id === target.id)!.position = { x: 30, y: 10 };
  exposed.units.find(unit => unit.id === target.id)!.modelPositions = [{ x: 30, y: 10 }];
  assert.equal(scorePrimaryMission(exposed, 0, rules40K11th).vpGained, 4);
});

test('11th Surveil the Foe removes enemy operation markers when a friendly unit ends a move near their objective', () => {
  const battle = state('movement', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Surveil the Foe', 'Smoke and Mirrors'],
  };
  battle.objectives = [{ x: 20, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'marked-objective', name: 'Marked Objective', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const mover = losTestUnit('blue-mover', 0, { x: 15, y: 10 });
  battle.units = [mover];
  battle.missionState = {
    operationMarkers: [
      {
        id: 'red-decoy-a',
        side: 1,
        sourceActionId: 'decoy',
        placedByUnitId: 'red-a',
        objectiveIndex: 0,
        position: { x: 20, y: 10 },
        battleRound: 1,
        turn: 1,
      },
      {
        id: 'red-decoy-b',
        side: 1,
        sourceActionId: 'decoy',
        placedByUnitId: 'red-b',
        objectiveIndex: 0,
        position: { x: 20, y: 10 },
        battleRound: 1,
        turn: 1,
      },
    ],
  };

  const moved = movePlayModels(battle, mover.id, 0, [0], 5, 0);
  const completed = completePlayUnitMovement(moved, mover.id, 0);

  assert.deepEqual(completed.missionState?.operationMarkers, []);
  assert.match(completed.log.at(-1)?.message ?? '', /removes 2 enemy operation markers/);
  const result = scorePrimaryMission(completed, 0, rules40K11th);
  assert.equal(result.vpGained, 5);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th destroyed-unit mission events reset at the start of a new player turn', () => {
  const battle = state('setup', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.missionEvents = {
    destroyedUnitsThisTurn: [{
      unitId: 'old-red-target',
      side: 1,
      unitName: 'Old Red Target',
      destroyedBySide: 0,
      battleRound: 1,
      turn: 1,
      phase: 'fight',
    }],
  };

  const command = simulateNextPhase(battle, rules40K11th);

  assert.equal(command.phase, 'command');
  assert.deepEqual(command.missionEvents?.destroyedUnitsThisTurn, []);
  assert.deepEqual(command.missionEvents?.startOfTurn, {
    activeSide: 0,
    battleRound: 1,
    turn: 1,
    objectiveOwners: [],
    units: [],
  });
});

test("11th Destroyer's Wrath scores previous-turn destroyed-unit comparison", () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ["Destroyer's Wrath", 'Vital Link'],
  };
  battle.missionEvents = {
    destroyedUnitsThisTurn: [{
      unitId: 'red-target',
      side: 1,
      unitName: 'Red Target',
      destroyedBySide: 0,
      battleRound: 2,
      turn: 2,
      phase: 'fight',
    }],
    lastCompletedTurn: {
      activeSide: 1,
      battleRound: 1,
      turn: 1,
      destroyedUnitCounts: [0, 0],
    },
  };

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.vpGained, 7);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /More enemy units were destroyed this turn/);
});

test("11th Destroyer's Wrath withholds previous-turn kill bonus when counts tie", () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ["Destroyer's Wrath", 'Vital Link'],
  };
  battle.missionEvents = {
    destroyedUnitsThisTurn: [{
      unitId: 'red-target',
      side: 1,
      unitName: 'Red Target',
      destroyedBySide: 0,
      battleRound: 2,
      turn: 2,
      phase: 'fight',
    }],
    lastCompletedTurn: {
      activeSide: 1,
      battleRound: 1,
      turn: 1,
      destroyedUnitCounts: [1, 0],
    },
  };

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Meatgrinder scores kill clauses and opponent home control', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Meatgrinder', 'Meatgrinder'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-home', 0, { x: 10, y: 10 }),
    losTestUnit('blue-red-home', 0, { x: 30, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Meatgrinder');
  assert.equal(result.vpGained, 5);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.doesNotMatch(formatPrimaryScoringResult(result), /Unsupported clauses:/);
});

test('11th Punishment selects up to three eligible condemned enemies and replays the selection', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Punishment', 'Delaying Action'],
  };
  battle.objectives = [{ x: 20, y: 30 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'central', name: 'Central', type: 'ruin', x: 18, y: 28, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const nearObjective = losTestUnit('red-near-objective', 1, { x: 20, y: 30 });
  const previousDestroyer = losTestUnit('red-previous-destroyer', 1, { x: 35, y: 30 });
  const ineligible = losTestUnit('red-ineligible', 1, { x: 40, y: 30 });
  battle.units = [nearObjective, previousDestroyer, ineligible];
  battle.missionEvents = {
    lastCompletedTurn: {
      activeSide: 1,
      battleRound: 1,
      turn: 1,
      destroyedUnitCounts: [1, 0],
      destroyingUnitIds: [previousDestroyer.id],
    },
  };

  assert.deepEqual(
    punishmentCondemnedUnitOptions(battle, 0, rules40K11th),
    [nearObjective.id, previousDestroyer.id],
  );
  assert.match(playPhaseCoherencyIssues(battle)[0], /condemn/i);

  const condemned = applyGameAction(battle, {
    type: 'play.toggleCondemnedUnit',
    side: 0,
    unitId: nearObjective.id,
  }, { rules: rules40K11th });
  const twiceCondemned = togglePunishmentCondemnedUnit(
    condemned,
    previousDestroyer.id,
    0,
    rules40K11th,
  );

  assert.deepEqual(twiceCondemned.missionState?.condemnedUnitIds?.[0], [
    nearObjective.id,
    previousDestroyer.id,
  ]);
  assert.deepEqual(playPhaseCoherencyIssues(twiceCondemned), []);
});

test('11th Punishment scores only its condemned clause during the opponent turn', () => {
  const battle = state('fight', 5);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.activeArmy = 1;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Punishment', 'Delaying Action'],
  };
  battle.objectives = [{ x: 18, y: 30 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 16, y: 28, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const condemned = losTestUnit('red-condemned', 1, { x: 20, y: 30 });
  const blueAttacker = losTestUnit('blue-attacker', 0, { x: 18, y: 30 });
  battle.units = [condemned, blueAttacker];
  battle.missionState = { condemnedUnitIds: [[condemned.id], []] };
  battle.missionEvents = { destroyedUnitsThisTurn: [], unitsLeftBattlefieldThisTurn: [] };

  condemned.destroyed = true;
  condemned.remainingModels = 0;
  condemned.modelPositions = [];
  recordDestroyedUnitMissionEvent(battle, condemned, 0, { destroyedByUnitId: blueAttacker.id });

  const results = scorePrimaryMissionsAtEndOfTurn(battle, 1, rules40K11th);

  assert.deepEqual(results.map(result => result.side), [1, 0]);
  assert.equal(results[1].vpGained, 5);
  assert.equal(battle.scores[0], 5);
  assert.deepEqual(results[1].unsupportedClauses, []);

  battle.activeArmy = 0;
  startMissionEventsForNewTurn(battle, rules40K11th);
  assert.deepEqual(battle.missionState?.condemnedUnitIds?.[0], []);
});

test('11th Unstoppable Force scores an objective gained after the start of the turn', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Unstoppable Force', 'Unstoppable Force'],
  };
  battle.objectives = [{ x: 30, y: 22 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 28, y: 20, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  battle.units = [losTestUnit('blue-controller', 0, { x: 30, y: 22 })];
  battle.missionEvents = {
    startOfTurn: {
      activeSide: 0,
      battleRound: 2,
      turn: battle.turn,
      objectiveOwners: [null],
      units: [],
    },
  };

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Unstoppable Force does not award its gained-objective bonus for prior control', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Unstoppable Force', 'Unstoppable Force'],
  };
  battle.objectives = [{ x: 30, y: 22 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 28, y: 20, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  battle.units = [losTestUnit('blue-controller', 0, { x: 30, y: 22 })];
  battle.missionEvents = {
    startOfTurn: {
      activeSide: 0,
      battleRound: 2,
      turn: battle.turn,
      objectiveOwners: [0],
      units: [],
    },
  };

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 0);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Gather Intel scores objective control without unsupported marker clauses', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Gather Intel', 'Gather Intel'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  battle.units = [losTestUnit('blue-mid', 0, { x: 20, y: 10 })];

  const roundOne = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(roundOne.kind, 'scored');
  assert.equal(roundOne.scoringModel, '11e-data:Gather Intel');
  assert.equal(roundOne.vpGained, 6);

  const roundTwo = { ...battle, phase: 'fight' as Phase, battleRound: 2, turn: 2, scores: [0, 0] as [number, number] };
  const endTurn = scorePrimaryMission(roundTwo, 0, rules40K11th);

  assert.equal(endTurn.vpGained, 0);
  assert.deepEqual(endTurn.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(endTurn), /extracted intelligence/i);
});

test('11th Gather Intel completes Extract Intelligence, places a persistent marker, and scores the action', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Gather Intel', 'Gather Intel'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const unit = losTestUnit('blue-mid', 0, { x: 20, y: 10 });
  battle.units = [unit];

  assert.deepEqual(extractIntelligenceObjectiveOptions(battle, unit.id, 0, rules40K11th), [1]);
  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'extract-intelligence',
    'Extract Intelligence',
    rules40K11th,
    1,
  );
  completeEndOfTurnActions(started, 0);

  assert.equal(started.missionEvents?.completedActionsThisTurn?.[0]?.actionId, 'extract-intelligence');
  assert.deepEqual(started.missionState?.operationMarkers?.[0], {
    id: 'operation-marker-0-extract-intelligence-1',
    side: 0,
    sourceActionId: 'extract-intelligence',
    placedByUnitId: unit.id,
    objectiveIndex: 1,
    position: { x: 20, y: 10 },
    battleRound: 2,
    turn: 2,
  });
  assert.deepEqual(extractIntelligenceObjectiveOptions(started, unit.id, 0, rules40K11th), []);

  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 7);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /1 action x 7VP/);
});

test('11th Gather Intel end-of-battle scoring uses operation marker count and opponent home placement', () => {
  const battle = state('end', 5);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Gather Intel', 'Gather Intel'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.missionState = {
    operationMarkers: battle.objectives.map((position, objectiveIndex) => ({
      id: `marker-${objectiveIndex}`,
      side: 0,
      sourceActionId: 'extract-intelligence',
      placedByUnitId: `unit-${objectiveIndex}`,
      objectiveIndex,
      position,
      battleRound: objectiveIndex + 1,
      turn: objectiveIndex + 1,
    })),
  };

  const result = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(result.vpGained, 10);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Triangulation scores control clauses and records triangulated objective clauses', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Triangulation', 'Triangulation'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 40, y: 10 }];
  battle.objectiveOwners = [null, null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid-a', name: 'Mid A', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'mid-b', name: 'Mid B', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 38, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-home', 0, { x: 10, y: 10 }),
    losTestUnit('blue-mid-a', 0, { x: 20, y: 10 }),
    losTestUnit('blue-mid-b', 0, { x: 30, y: 10 }),
    losTestUnit('blue-red-home', 0, { x: 40, y: 10 }),
  ];

  const command = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(command.kind, 'scored');
  assert.equal(command.scoringModel, '11e-data:Triangulation');
  assert.equal(command.vpGained, 4);

  const endBattle = { ...battle, phase: 'end' as Phase, scores: [0, 0] as [number, number] };
  const final = scorePrimaryMission(endBattle, 0, rules40K11th);

  assert.equal(final.vpGained, 10);
});

test('11th Triangulation completes actions on different non-home objectives and scores one marker', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Triangulation', 'Triangulation'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const unit = losTestUnit('blue-mid', 0, { x: 20, y: 10 });
  battle.units = [unit];

  assert.deepEqual(triangulateObjectiveOptions(battle, unit.id, 0, rules40K11th), [1]);
  assert.equal(
    startPlayUnitAction(battle, unit.id, 0, 'triangulate', 'Triangulate', rules40K11th, 0),
    battle,
  );

  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'triangulate',
    'Triangulate',
    rules40K11th,
    1,
  );
  completeEndOfTurnActions(started, 0);

  assert.equal(started.missionState?.operationMarkers?.[0]?.sourceActionId, 'triangulate');
  assert.deepEqual(triangulateObjectiveOptions(started, unit.id, 0, rules40K11th), []);
  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Triangulation marker scoring uses only the highest matching tier', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Triangulation', 'Triangulation'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 40, y: 10 }];
  battle.objectiveOwners = [null, null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid-a', name: 'Mid A', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'mid-b', name: 'Mid B', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 38, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];

  const scoreForMarkerCount = (count: number) => {
    const scoringState: BattleState = JSON.parse(JSON.stringify(battle));
    scoringState.missionState = {
      operationMarkers: scoringState.objectives.slice(1, count + 1).map((position, markerIndex) => ({
        id: `triangulate-${markerIndex + 1}`,
        side: 0,
        sourceActionId: 'triangulate',
        placedByUnitId: `unit-${markerIndex + 1}`,
        objectiveIndex: markerIndex + 1,
        position,
        battleRound: 2,
        turn: 2,
      })),
    };
    return scorePrimaryMission(scoringState, 0, rules40K11th).vpGained;
  };

  assert.equal(scoreForMarkerCount(1), 3);
  assert.equal(scoreForMarkerCount(2), 6);
  assert.equal(scoreForMarkerCount(3), 10);
});

test('11th Secure Asset scores objective control clauses from mission data', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Secure Asset', 'Secure Asset'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-home', 0, { x: 10, y: 10 }),
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('blue-red-home', 0, { x: 30, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Secure Asset');
  assert.equal(result.vpGained, 8);
});

test('11th Secure Asset completes on a non-home objective and scores once without placing a marker', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Secure Asset', 'Secure Asset'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
  ];
  const unit = losTestUnit('blue-mid', 0, { x: 20, y: 10 });
  battle.units = [unit];

  assert.deepEqual(secureAssetObjectiveOptions(battle, unit.id, 0, rules40K11th), [1]);
  assert.equal(
    startPlayUnitAction(battle, unit.id, 0, 'secure-asset', 'Secure Asset', rules40K11th, 0),
    battle,
  );
  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'secure-asset',
    'Secure Asset',
    rules40K11th,
    1,
  );
  completeEndOfTurnActions(started, 0);

  assert.equal(started.missionEvents?.completedActionsThisTurn?.[0]?.actionId, 'secure-asset');
  assert.equal(started.missionState?.operationMarkers, undefined);
  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 4);
  assert.deepEqual(result.unsupportedClauses, []);
});

test('11th Sabotage snapshots completion-time objective proximity and scores exact territory bonuses', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Sabotage', 'Sabotage'],
    territoryZones: verticalTerritories(25),
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  const midUnit = losTestUnit('blue-mid', 0, { x: 20, y: 10 });
  const forwardUnit = losTestUnit('blue-forward', 0, { x: 30, y: 10 });
  battle.units = [midUnit, forwardUnit];

  assert.deepEqual(sabotageObjectiveOptions(battle, midUnit.id, 0, rules40K11th), [1]);
  const firstStarted = startPlayUnitAction(battle, midUnit.id, 0, 'sabotage', 'Sabotage', rules40K11th, 1);
  assert.deepEqual(sabotageObjectiveOptions(firstStarted, forwardUnit.id, 0, rules40K11th), [2]);
  const bothStarted = startPlayUnitAction(firstStarted, forwardUnit.id, 0, 'sabotage', 'Sabotage', rules40K11th, 2);
  completeEndOfTurnActions(bothStarted, 0);

  assert.equal(bothStarted.missionEvents?.completedActionsThisTurn?.length, 2);
  assert.deepEqual(bothStarted.missionEvents?.completedActionsThisTurn?.map(event => event.objectiveIndexesWithinRange), [[1], [2]]);
  const persistedCompletion: BattleState = JSON.parse(JSON.stringify(bothStarted));
  assert.deepEqual(persistedCompletion.missionEvents?.completedActionsThisTurn?.map(event => event.objectiveIndexesWithinRange), [[1], [2]]);
  assert.equal(bothStarted.missionState?.operationMarkers?.length, 2);
  const completedForwardUnit = bothStarted.units.find(candidate => candidate.id === forwardUnit.id)!;
  completedForwardUnit.position = { x: 10, y: 10 };
  completedForwardUnit.modelPositions = [{ x: 10, y: 10 }];
  const result = scorePrimaryMission(bothStarted, 0, rules40K11th);
  assert.equal(result.vpGained, 8);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /territory bonus 1 x 2VP/);

  const unknown: BattleState = JSON.parse(JSON.stringify(bothStarted));
  unknown.scores = [0, 0];
  unknown.missionState!.primaryMissionScoringRecords = [];
  delete unknown.setup!.territoryZones;
  const baseOnly = scorePrimaryMission(unknown, 0, rules40K11th);
  assert.equal(baseOnly.vpGained, 6);
  assert.match(baseOnly.unsupportedClauses?.[0] ?? '', /territory bonus/);

  let timeline = createPracticeTimeline(battle, { id: 'sabotage-territory-replay' });
  let current = battle;
  for (const action of [
    { type: GAME_ACTION_TYPE.StartAction, side: 0 as const, unitId: midUnit.id, actionId: 'sabotage', actionName: 'Sabotage', targetObjectiveIndex: 1 },
    { type: GAME_ACTION_TYPE.StartAction, side: 0 as const, unitId: forwardUnit.id, actionId: 'sabotage', actionName: 'Sabotage', targetObjectiveIndex: 2 },
    { type: GAME_ACTION_TYPE.StepPhase },
  ]) {
    const appended = appendTimelineAction(timeline, current, action, { rules: rules40K11th });
    timeline = appended.timeline;
    current = appended.state;
  }
  const replayed = replayTimeline(timeline, { rules: rules40K11th }, false);
  assert.equal(replayed.scores[0], 8);
});

test('11th Vital Link scores control clauses without unsupported operation-marker clauses', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Vital Link', 'Vital Link'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('blue-red-home', 0, { x: 30, y: 10 }),
  ];

  const command = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(command.kind, 'scored');
  assert.equal(command.scoringModel, '11e-data:Vital Link');
  assert.equal(command.vpGained, 8);

  const endTurn = { ...battle, phase: 'fight' as Phase, battleRound: 1, turn: 1, scores: [0, 0] as [number, number] };
  const roundOne = scorePrimaryMission(endTurn, 0, rules40K11th);

  assert.equal(roundOne.vpGained, 2);
  assert.deepEqual(roundOne.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(roundOne), /0 markers/);
});

test('11th Vital Link completes Maintain Control on a central objective and scores its marker bonus', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Vital Link', 'Vital Link'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  const unit = losTestUnit('blue-mid', 0, { x: 20, y: 10 });
  battle.units = [unit];

  assert.deepEqual(maintainControlObjectiveOptions(battle, unit.id, 0, rules40K11th), [1]);
  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'maintain-control',
    'Maintain Control',
    rules40K11th,
    1,
  );
  completeEndOfTurnActions(started, 0);

  assert.equal(started.missionState?.operationMarkers?.[0]?.sourceActionId, 'maintain-control');
  assert.deepEqual(maintainControlObjectiveOptions(started, unit.id, 0, rules40K11th), []);
  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /1 marker x 1VP/);
});

test('11th Vanguard Operation scores opponent home control at end of battle', () => {
  const battle = state('end', 5);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Vanguard Operation', 'Vanguard Operation'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [losTestUnit('blue-red-home', 0, { x: 30, y: 10 })];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Vanguard Operation');
  assert.equal(result.vpGained, 10);
});

test('11th Vanguard Operation completes in an enemy-free terrain area overlapping opponent territory', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Vanguard Operation', 'Vanguard Operation'],
    territoryZones: verticalTerritories(),
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [
    terrainMat({ id: 'enemy-territory', name: 'Enemy Territory', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  const unit = losTestUnit('blue-vanguard', 0, { x: 30, y: 10 });
  battle.units = [unit];

  assert.equal(terrainWithinMissionTerritory(battle, battle.terrain[0], 1), true);
  assert.deepEqual(vanguardOperationTerrainOptions(battle, unit.id, 0, rules40K11th), ['enemy-territory']);
  const simulationStarted = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'vanguard-operation',
    'Vanguard Operation',
    rules40K11th,
    undefined,
    'enemy-territory',
  );
  const simulated = simulateNextPhase(simulationStarted, rules40K11th);
  assert.equal(simulated.scores[0], 4);
  assert.match(simulated.log.map(entry => entry.message).join('\n'), /completes Vanguard Operation/);
  const started = startPlayUnitAction(
    battle,
    unit.id,
    0,
    'vanguard-operation',
    'Vanguard Operation',
    rules40K11th,
    undefined,
    'enemy-territory',
  );
  completeEndOfTurnActions(started, 0);

  assert.equal(started.missionEvents?.completedActionsThisTurn?.[0]?.targetTerrainId, 'enemy-territory');
  const result = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(result.vpGained, 4);
  assert.deepEqual(result.unsupportedClauses, []);

  const contested: BattleState = JSON.parse(JSON.stringify(battle));
  contested.units.push(losTestUnit('red-defender', 1, { x: 30, y: 10 }));
  assert.deepEqual(vanguardOperationTerrainOptions(contested, unit.id, 0, rules40K11th), []);

  const unknown: BattleState = JSON.parse(JSON.stringify(battle));
  delete unknown.setup!.territoryZones;
  assert.deepEqual(vanguardOperationTerrainOptions(unknown, unit.id, 0, rules40K11th), []);
});

test('11th Death Trap immediately traps a different eligible terrain area and scores its objective bonus', () => {
  const battle = state('shooting', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Death Trap', 'Death Trap'],
  };
  battle.objectives = [{ x: 20, y: 30 }];
  battle.objectiveOwners = [null];
  battle.terrain = [
    terrainMat({ id: 'central-trap', name: 'Central Trap', type: 'ruin', x: 18, y: 28, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const unit = losTestUnit('blue-sapper', 0, { x: 20, y: 30 });
  battle.units = [unit];

  assert.deepEqual(boobyTrapTerrainOptions(battle, unit.id, 0, rules40K11th), ['central-trap']);
  const trapped = applyGameAction(battle, {
    type: 'play.startAction',
    side: 0,
    unitId: unit.id,
    actionId: 'booby-trap',
    actionName: 'Booby Trap',
    targetTerrainId: 'central-trap',
  }, { rules: rules40K11th });

  assert.equal(trapped.units[0].performingAction, undefined);
  assert.equal(trapped.units[0].actionStartedThisTurn, true);
  assert.equal(trapped.missionEvents?.completedActionsThisTurn?.[0]?.targetTerrainId, 'central-trap');
  assert.equal(trapped.missionState?.operationMarkers?.[0]?.terrainId, 'central-trap');
  assert.deepEqual(boobyTrapTerrainOptions(trapped, unit.id, 0, rules40K11th), []);

  const result = scorePrimaryMission(trapped, 0, rules40K11th);
  assert.equal(result.vpGained, 5);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /objective bonus 1 x 3VP/);
});

test('11th Death Trap scores a kill from trapped terrain and its isolated marker at battle end', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Death Trap', 'Death Trap'],
  };
  battle.objectives = [];
  battle.objectiveOwners = [];
  battle.terrain = [
    terrainMat({ id: 'kill-zone', name: 'Kill Zone', type: 'ruin', x: 18, y: 28, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  const friendly = losTestUnit('blue-holder', 0, { x: 20, y: 30 });
  const enemy = losTestUnit('red-target', 1, { x: 20, y: 30 });
  battle.units = [friendly, enemy];
  battle.missionState = {
    operationMarkers: [{
      id: 'booby-marker',
      side: 0,
      sourceActionId: 'booby-trap',
      placedByUnitId: friendly.id,
      terrainId: 'kill-zone',
      position: { x: 20, y: 30 },
      battleRound: 1,
      turn: 1,
    }],
  };

  startMissionEventsForNewTurn(battle, rules40K11th);
  enemy.destroyed = true;
  enemy.remainingModels = 0;
  enemy.modelPositions = [];
  recordDestroyedUnitMissionEvent(battle, enemy, 0, { destroyedByUnitId: friendly.id });

  const turnResult = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(turnResult.vpGained, 3);
  assert.deepEqual(turnResult.unsupportedClauses, []);

  battle.phase = 'end';
  battle.scores = [0, 0];
  const finalResult = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(finalResult.vpGained, 5);
  assert.deepEqual(finalResult.unsupportedClauses, []);
});

test('11th Delaying Action scores objective control clauses from mission data', () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Delaying Action', 'Delaying Action'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('blue-red-home', 0, { x: 30, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Delaying Action');
  assert.equal(result.vpGained, 4);
});

test('11th Delaying Action scores control of central and friendly expansion objectives', () => {
  const battle = state('fight', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Delaying Action', 'Delaying Action'],
  };
  battle.objectives = [{ x: 20, y: 30 }, { x: 12, y: 20 }, { x: 32, y: 40 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'central', name: 'Central', type: 'ruin', x: 18, y: 28, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'blue-expansion', name: 'Blue Expansion', type: 'ruin', x: 10, y: 18, width: 4, height: 4, objectiveRole: 'expansion-0' }),
    terrainMat({ id: 'red-expansion', name: 'Red Expansion', type: 'ruin', x: 30, y: 38, width: 4, height: 4, objectiveRole: 'expansion-1' }),
  ];
  battle.units = [
    losTestUnit('blue-central', 0, { x: 20, y: 30 }),
    losTestUnit('blue-expansion', 0, { x: 12, y: 20 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.vpGained, 3);
  assert.deepEqual(result.unsupportedClauses, []);
});

test(PRIMARY_GLOBAL_SCORING_COVERAGE[0].assertion, () => {
  const battle = state('command', 2);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = { ...battle.setup!, primaryMissions: ['Delaying Action', 'Delaying Action'] };
  battle.objectives = [{ x: 20, y: 20 }, { x: 30, y: 20 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'central', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'central' }),
    terrainMat({ id: 'expansion', type: 'ruin', x: 28, y: 18, width: 4, height: 4, objectiveRole: 'expansion-0' }),
  ];
  battle.units = [
    losTestUnit('central-holder', 0, { x: 20, y: 20 }),
    losTestUnit('expansion-holder', 0, { x: 30, y: 20 }),
  ];

  assert.equal(scorePrimaryMission(battle, 0, rules40K11th).vpGained, 4);
  battle.phase = 'fight';
  battle.missionEvents = {
    destroyedUnitsThisTurn: Array.from({ length: 6 }, (_, index) => ({
      unitId: `enemy-${index}`,
      side: 1 as const,
      unitName: `Enemy ${index}`,
      destroyedBySide: 0 as const,
      battleRound: 2,
      turn: battle.turn,
      phase: 'fight' as const,
    })),
  };
  const capped = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(capped.vpGained, 11);
  assert.equal(battle.scores[0], 15);
  assert.deepEqual(
    battle.missionState?.primaryMissionScoringRecords?.map(record => [record.requestedVp, record.vp, record.status]),
    [[4, 4, 'awarded'], [15, 11, 'capped']],
  );
  assert.equal(scorePrimaryMission(battle, 0, rules40K11th).vpGained, 0);
  assert.equal(battle.missionState?.primaryMissionScoringRecords?.length, 2);
});

test(PRIMARY_GLOBAL_SCORING_COVERAGE[1].assertion, async () => {
  installStorage();
  const battle = state('command', 4);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = { ...battle.setup!, primaryMissions: ['Delaying Action', 'Delaying Action'] };
  battle.objectives = [{ x: 20, y: 20 }];
  battle.objectiveOwners = [null];
  battle.terrain = [terrainMat({ id: 'non-home', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'central' })];
  battle.units = [losTestUnit('holder', 0, { x: 20, y: 20 })];
  battle.missionState = {
    primaryMissionScoringRecords: [15, 15, 14].map((vp, index) => ({
      id: `prior-${index}`,
      side: 0,
      missionName: 'Delaying Action',
      clauseIds: ['prior'],
      status: 'awarded',
      requestedVp: vp,
      vp,
      detail: 'Prior primary VP.',
      battleRound: index + 1,
      turn: index + 1,
      activeSide: 0,
      phase: 'command',
      scoreAfter: [15, 30, 44][index],
    })),
  };
  battle.scores = [44, 0];

  const awarded = scorePrimaryMission(battle, 0, rules40K11th);
  assert.equal(awarded.vpGained, 1);
  assert.equal(battle.missionState.primaryMissionScoringRecords?.at(-1)?.requestedVp, 4);
  assert.equal(battle.missionState.primaryMissionScoringRecords?.at(-1)?.vp, 1);
  assert.equal(battle.missionState.primaryMissionScoringRecords?.at(-1)?.status, 'capped');

  const replayStart = state('command', 2);
  replayStart.ruleset = rulesetMetadataForState(rules40K11th);
  replayStart.objectiveControl = rules40K11th.objectiveControl;
  replayStart.setup = { ...replayStart.setup!, primaryMissions: ['Delaying Action', 'Delaying Action'] };
  replayStart.objectives = [{ x: 20, y: 20 }];
  replayStart.objectiveOwners = [null];
  replayStart.terrain = [terrainMat({ id: 'non-home', type: 'ruin', x: 18, y: 18, width: 4, height: 4, objectiveRole: 'central' })];
  replayStart.units = [losTestUnit('holder', 0, { x: 20, y: 20 })];
  const appended = appendTimelineAction(
    createPracticeTimeline(replayStart, { id: 'primary-ledger-replay' }),
    replayStart,
    { type: GAME_ACTION_TYPE.StepPhase },
    { rules: rules40K11th },
  );
  const replayed = replayTimeline(appended.timeline, { rules: rules40K11th }, false);
  assert.deepEqual(replayed.missionState?.primaryMissionScoringRecords, appended.state.missionState?.primaryMissionScoringRecords);
  assert.deepEqual(
    replayed.log.filter(entry => entry.id.startsWith('primary-score-log:')),
    appended.state.log.filter(entry => entry.id.startsWith('primary-score-log:')),
  );

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(appended.timeline, { id: 'primary-ledger-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('primary-ledger-save');
  assert.deepEqual(
    currentTimelineState(loaded!.timeline).missionState?.primaryMissionScoringRecords,
    appended.state.missionState?.primaryMissionScoringRecords,
  );
  assert.deepEqual(
    currentTimelineState(loaded!.timeline).log.filter(entry => entry.id.startsWith('primary-score-log:')),
    appended.state.log.filter(entry => entry.id.startsWith('primary-score-log:')),
  );
});

test(PRIMARY_GLOBAL_SCORING_COVERAGE[2].assertion, () => {
  const finalTurn = state('fight', 5);
  finalTurn.ruleset = rulesetMetadataForState(rules40K11th);
  finalTurn.objectiveControl = rules40K11th.objectiveControl;
  finalTurn.activeArmy = 1;
  finalTurn.setup = { ...finalTurn.setup!, primaryMissions: ['Inescapable Dominion', 'Locate and Deny'] };
  finalTurn.objectives = [{ x: 10, y: 10 }, { x: 30, y: 10 }];
  finalTurn.objectiveOwners = [null, null];
  finalTurn.terrain = [
    terrainMat({ id: 'blue-home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'red-home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  finalTurn.units = [
    losTestUnit('blue-controller', 0, { x: 30, y: 10 }),
    losTestUnit('red-survivor', 1, { x: 50, y: 30 }),
  ];

  const manual = applyGameAction(finalTurn, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
  const simulated = simulateNextPhase(finalTurn, rules40K11th);

  assert.equal(manual.phase, 'end');
  assert.equal(manual.scores[0], 5);
  assert.equal(manual.missionState?.primaryMissionScoringRecords?.at(-1)?.battleRound, 5);
  assert.match(manual.log.map(entry => entry.message).join('\n'), /Blue \(Player 1\).*End of battle/);
  assert.equal(simulated.phase, 'end');
  assert.equal(simulated.scores[0], 5);
  assert.match(simulated.log.map(entry => entry.message).join('\n'), /Blue \(Player 1\).*End of battle/);
});

test('11th Smoke and Mirrors scores non-home objective control without unsupported decoy clauses', () => {
  const battle = state('fight', 5);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Smoke and Mirrors', 'Smoke and Mirrors'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }];
  battle.objectiveOwners = [null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
  ];
  battle.units = [losTestUnit('blue-mid', 0, { x: 20, y: 10 })];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Smoke and Mirrors');
  assert.equal(result.vpGained, 4);
  assert.deepEqual(result.unsupportedClauses, []);
  assert.match(formatPrimaryScoringResult(result), /decoys/i);
});

test('11th Smoke and Mirrors completes Decoy actions and scores persistent marker thresholds', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Smoke and Mirrors', 'Smoke and Mirrors'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }, { x: 40, y: 10 }, { x: 50, y: 10 }];
  battle.objectiveOwners = [null, null, null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid-a', name: 'Mid A', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'mid-b', name: 'Mid B', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'mid-c', name: 'Mid C', type: 'ruin', x: 38, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 48, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  const unit = losTestUnit('blue-mid', 0, { x: 20, y: 10 });
  battle.units = [unit];

  assert.deepEqual(decoyObjectiveOptions(battle, unit.id, 0, rules40K11th), [1]);
  const started = startPlayUnitAction(battle, unit.id, 0, 'decoy', 'Decoy', rules40K11th, 1);
  completeEndOfTurnActions(started, 0);
  assert.equal(started.missionState?.operationMarkers?.[0]?.sourceActionId, 'decoy');

  const turnResult = scorePrimaryMission(started, 0, rules40K11th);
  assert.equal(turnResult.vpGained, 3);
  assert.deepEqual(turnResult.unsupportedClauses, []);

  const endBattle: BattleState = JSON.parse(JSON.stringify(started));
  endBattle.phase = 'end';
  endBattle.scores = [0, 0];
  endBattle.missionState = {
    operationMarkers: endBattle.objectives.slice(1).map((position, markerIndex) => ({
      id: `decoy-${markerIndex + 1}`,
      side: 0,
      sourceActionId: 'decoy',
      placedByUnitId: `unit-${markerIndex + 1}`,
      objectiveIndex: markerIndex + 1,
      position,
      battleRound: markerIndex + 1,
      turn: markerIndex + 1,
    })),
  };
  const finalResult = scorePrimaryMission(endBattle, 0, rules40K11th);
  assert.equal(finalResult.vpGained, 5);
  assert.deepEqual(finalResult.unsupportedClauses, []);
});

test('11th Outmanoeuvre scores escalating objective control and opponent home clauses', () => {
  const battle = state('fight', 1);
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.setup = {
    ...battle.setup!,
    primaryMissions: ['Outmanoeuvre', 'Outmanoeuvre'],
  };
  battle.objectives = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 10 }];
  battle.objectiveOwners = [null, null, null];
  battle.terrain = [
    terrainMat({ id: 'home-blue', name: 'Blue Home', type: 'ruin', x: 8, y: 8, width: 4, height: 4, objectiveRole: 'home-0' }),
    terrainMat({ id: 'mid', name: 'Mid', type: 'ruin', x: 18, y: 8, width: 4, height: 4, objectiveRole: 'no-mans-land' }),
    terrainMat({ id: 'home-red', name: 'Red Home', type: 'ruin', x: 28, y: 8, width: 4, height: 4, objectiveRole: 'home-1' }),
  ];
  battle.units = [
    losTestUnit('blue-mid', 0, { x: 20, y: 10 }),
    losTestUnit('blue-red-home', 0, { x: 30, y: 10 }),
  ];

  const result = scorePrimaryMission(battle, 0, rules40K11th);

  assert.equal(result.kind, 'scored');
  assert.equal(result.scoringModel, '11e-data:Outmanoeuvre');
  assert.equal(result.vpGained, 15);
});

test('11th terrain objective control counts models inside the terrain area', () => {
  const battle = state('fight');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.objectiveControl = rules40K11th.objectiveControl;
  battle.objectives = [{ x: 10, y: 10 }];
  battle.objectiveOwners = [null];
  battle.terrain = [terrainMat({
    id: 'objective-ruin',
    name: 'Objective Ruin',
    type: 'ruin',
    x: 8,
    y: 8,
    width: 6,
    height: 6,
  })];

  const blue = losTestUnit('blue-1', 0, { x: 9, y: 9 });
  blue.profile.oc = 2;
  blue.remainingModels = 2;
  blue.modelPositions = [{ x: 9, y: 9 }, { x: 20, y: 20 }];
  const red = losTestUnit('red-1', 1, { x: 11, y: 11 });
  red.profile.oc = 1;
  battle.units = [blue, red];

  const objectives = updateObjectiveControl(battle, rules40K11th);

  assert.deepEqual(objectives?.[0].oc, [2, 1]);
  assert.deepEqual(battle.objectiveOwners, [0]);
  assert.deepEqual(battle.scores, [0, 0]);
});

test('11th actions block shooting and charging until completed or cancelled', () => {
  const battle = state('shooting');
  const unit = losTestUnit('action-unit', 0, { x: 10, y: 10 });
  unit.profile.weapons = [
    { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
  ];
  const target = losTestUnit('target', 1, { x: 14, y: 10 });
  battle.units = [unit, target];

  assert.equal(playUnitCanStartAction(battle, unit.id, 0, rules40K11th), true);
  const started = startPlayUnitAction(battle, unit.id, 0, 'deploy-device', 'Deploy Device', rules40K11th);
  assert.equal(started.units.find(candidate => candidate.id === unit.id)?.performingAction?.name, 'Deploy Device');
  assert.equal(playShootingWeaponOptions(started, unit.id, 0, rules40K11th).length, 0);

  const charge = { ...started, phase: 'charge' as Phase };
  assert.deepEqual(playChargeTargetOptions(charge, unit.id, 0, rules40K11th), []);
});

test('11th actions are cancelled by movement and complete at end of turn', () => {
  const movement = state('movement');
  const mover = losTestUnit('mover', 0, { x: 10, y: 10 });
  movement.units = [mover];
  const started = startPlayUnitAction(movement, mover.id, 0, 'deploy-device', 'Deploy Device', rules40K11th);
  const moved = movePlayModels(started, mover.id, 0, [0], 1, 0);
  const movedUnit = moved.units.find(candidate => candidate.id === mover.id)!;
  assert.equal(movedUnit.performingAction, undefined);
  assert.equal(movedUnit.actionStartedThisTurn, true);
  assert.match(moved.log.at(-1)?.message ?? '', /does not complete Deploy Device/);

  const fight = state('fight');
  const finisher = losTestUnit('finisher', 0, { x: 10, y: 10 });
  fight.units = [finisher];
  const completing = startPlayUnitAction(fight, finisher.id, 0, 'deploy-device', 'Deploy Device', rules40K11th);
  const nextTurn = applyGameAction(completing, { type: 'play.stepPhase' }, { rules: rules40K11th });
  assert.equal(nextTurn.units.find(candidate => candidate.id === finisher.id)?.performingAction, undefined);
  assert.match(nextTurn.log.map(entry => entry.message).join(' '), /completes Deploy Device/);
});

test('11th snap shooting targets one visible enemy within 24 inches and hits only on 6s', () => {
  const battle = state('movement');
  battle.activeArmy = 0;
  const shooter = losTestUnit('overwatcher', 1, { x: 10, y: 10 });
  shooter.profile.weapons = [
    { name: 'Overwatch Rifle', range: 48, attacks: '2', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
  ];
  const visibleTarget = losTestUnit('visible-target', 0, { x: 20, y: 10 });
  const farTarget = losTestUnit('far-target', 0, { x: 40, y: 10 });
  battle.units = [shooter, visibleTarget, farTarget];

  assert.deepEqual(playSnapShootingWeaponOptions(battle, shooter.id, 1, rules40K11th)[0].targetIds, ['visible-target']);
  assert.deepEqual(playSnapShootingWeaponOptions({ ...battle, activeArmy: 1 }, shooter.id, 1, rules40K11th), []);

  const originalRandom = Math.random;
  const rolls = [0.99, 0.1, 0.99, 0.99];
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const snapped = snapShootPlayUnitWeapon(battle, shooter.id, 1, visibleTarget.id, 'all', rules40K11th);
    const snappedShooter = snapped.units.find(unit => unit.id === shooter.id)!;
    assert.equal(snappedShooter.activated, true);
    assert.equal(snappedShooter.actionStartedThisTurn, true);
    assert.equal(playUnitCanStartAction(snapped, shooter.id, 1, rules40K11th), false);
    assert.match(snapped.log.map(entry => entry.message).join(' '), /Snap Shooting: unmodified 6s to hit/);
    assert.match(snapped.log.map(entry => entry.message).join(' '), /Hit rolls \(6\+\): \[6, 1\].*1 hits/);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Fall Back moves an engaged active unit out of Engagement Range', () => {
  const battle = state('movement');
  const profile = {
    name: 'Test Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Enemy Unit' },
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
  };
  battle.units = [unit, enemy];

  assert.equal(playUnitCanFallBack(battle, 'unit-1', 0), true);

  const next = fallBackPlayUnit(battle, 'unit-1', 0);
  const moved = next.units.find(candidate => candidate.id === 'unit-1')!;
  const foe = next.units.find(candidate => candidate.id === 'enemy-1')!;

  assert.equal(moved.inCombat, false);
  assert.equal(moved.fellBack, true);
  assert.equal(moved.movementAction, 'fellBack');
  assert.ok(moved.position.x < unit.position.x);
  assert.ok(Math.hypot(moved.position.x - foe.position.x, moved.position.y - foe.position.y) > rules40K10th.engagementRange());
  assert.match(next.log.at(-1)?.message ?? '', /Falls Back/);
});

test('11th Movement mode choices depend on Engagement Range', () => {
  const battle = state('movement');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const unengaged = losTestUnit('unengaged', 0, { x: 5, y: 5 });
  const engaged = losTestUnit('engaged', 0, { x: 10, y: 10 });
  const enemy = losTestUnit('enemy', 1, { x: 10.5, y: 10 });
  battle.units = [unengaged, engaged, enemy];

  assert.equal(playUnitCanAdvance(battle, unengaged.id, 0, rules40K11th), true);
  assert.equal(playUnitCanFallBack(battle, unengaged.id, 0, rules40K11th), false);
  assert.equal(movePlayModels(battle, unengaged.id, 0, [0], 1, 0).units.find(unit => unit.id === unengaged.id)?.movementAction, 'normalMove');

  assert.equal(playUnitCanAdvance(battle, engaged.id, 0, rules40K11th), false);
  assert.equal(movePlayModels(battle, engaged.id, 0, [0], 1, 0).units.find(unit => unit.id === engaged.id)?.position.x, engaged.position.x);
  assert.equal(playUnitCanFallBack(battle, engaged.id, 0, rules40K11th), true);

  markRemainingStationaryUnits(battle, 0);
  const stationary = battle.units.find(unit => unit.id === engaged.id)!;
  assert.equal(stationary.movementAction, 'remainedStationary');
  assert.equal(stationary.movementComplete, true);
});

test('play Fall Back makes crossing models take Desperate Escape tests', () => {
  const battle = state('movement');
  const profile = {
    name: 'Escaping Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 11 },
    modelPositions: [{ x: 10, y: 10 }, { x: 10, y: 12 }],
    facingDeg: 0,
    charged: false,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const engagedEnemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Engaged Enemy', baseModelCount: 1 },
    remainingModels: 1,
    position: { x: 10.5, y: 12 },
    modelPositions: [{ x: 10.5, y: 12 }],
  };
  const crossedEnemy: BattleUnit = {
    ...engagedEnemy,
    id: 'enemy-2',
    profile: { ...profile, name: 'Crossed Enemy', baseModelCount: 1 },
    position: { x: 9.5, y: 7 },
    modelPositions: [{ x: 9.5, y: 7 }],
  };
  battle.units = [unit, engagedEnemy, crossedEnemy];

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const next = fallBackPlayUnit(battle, 'unit-1', 0);
    const escaped = next.units.find(candidate => candidate.id === 'unit-1')!;

    assert.equal(escaped.remainingModels, 1);
    assert.equal(escaped.modelPositions.length, 1);
    assert.match(next.log.at(-1)?.message ?? '', /moves over enemy models while Falling Back: Desperate Escape rolls 1; 1 model destroyed/);
  } finally {
    Math.random = originalRandom;
  }
});

test('Battle-shocked units test every model when Falling Back', () => {
  const battle = state('movement');
  const profile = {
    name: 'Shocked Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }, { x: 10, y: 12 }],
    facingDeg: 0,
    charged: false,
    inCombat: true,
    battleshocked: true,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Enemy', baseModelCount: 1 },
    remainingModels: 1,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
    battleshocked: false,
  };
  battle.units = [unit, enemy];

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const next = fallBackPlayUnit(battle, 'unit-1', 0);
    const escaped = next.units.find(candidate => candidate.id === 'unit-1')!;

    assert.equal(escaped.remainingModels, 0);
    assert.equal(escaped.destroyed, true);
    assert.match(next.log.at(-1)?.message ?? '', /is Battle-shocked and Falls Back: Desperate Escape rolls 1, 1; 2 models destroyed/);
  } finally {
    Math.random = originalRandom;
  }
});

test('units that Fell Back do not shoot or charge until reset', () => {
  const battle = state('movement');
  const profile = {
    name: 'Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    fellBack: true,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Target' },
    position: { x: 14, y: 10 },
    modelPositions: [{ x: 14, y: 10 }],
    fellBack: false,
  };
  battle.units = [unit, enemy];

  const reinforcements = simulateNextPhase(battle, rules40K10th);
  assert.equal(reinforcements.phase, 'movement');
  assert.equal(reinforcements.movementStep, 'reinforcements');
  const shooting = simulateNextPhase(reinforcements, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Shooter shoots')), false);

  const charge = simulateNextPhase(shooting, rules40K10th);
  assert.equal(charge.phase, 'charge');
  assert.equal(charge.units.find(candidate => candidate.id === 'unit-1')?.charged, false);
  assert.equal(charge.log.some(entry => entry.message.includes('Shooter charges')), false);
});

test('play Advance marks a unit and prevents shooting or charging', () => {
  const battle = state('movement');
  const profile = {
    name: 'Advancing Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Target', wounds: 99 },
    woundsOnLeadModel: 99,
    position: { x: 14, y: 10 },
    modelPositions: [{ x: 14, y: 10 }],
  };
  battle.units = [unit, enemy];

  assert.equal(playUnitCanAdvance(battle, 'unit-1', 0), true);

  const advanced = advancePlayUnit(battle, 'unit-1', 0);
  const advancedUnit = advanced.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(advancedUnit.movementAction, 'advanced');
  assert.ok((advancedUnit.movementAllowanceRemaining ?? 0) >= 7);
  assert.ok((advancedUnit.movementAllowanceRemaining ?? 0) <= 12);
  assert.match(advanced.log.at(-1)?.message ?? '', /Advances: rolled [1-6]/);

  const reinforcements = simulateNextPhase(advanced, rules40K10th);
  assert.equal(reinforcements.phase, 'movement');
  assert.equal(reinforcements.movementStep, 'reinforcements');
  const shooting = simulateNextPhase(reinforcements, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Advancing Unit shoots')), false);

  const charge = simulateNextPhase(shooting, rules40K10th);
  assert.equal(charge.phase, 'charge');
  assert.equal(charge.units.find(candidate => candidate.id === 'unit-1')?.charged, false);
  assert.equal(charge.log.some(entry => entry.message.includes('Advancing Unit charges')), false);
});

test('play step phase marks unmoved active units as Remained Stationary', () => {
  const battle = state('movement');
  const profile = {
    name: 'Movement Choice',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const movedUnit: BattleUnit = {
    id: 'moved-unit',
    side: 0,
    profile: { ...profile, name: 'Moved Unit' },
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const stationaryUnit: BattleUnit = {
    ...movedUnit,
    id: 'stationary-unit',
    profile: { ...profile, name: 'Stationary Unit' },
    position: { x: 20, y: 10 },
    modelPositions: [{ x: 20, y: 10 }],
  };
  const enemyUnit: BattleUnit = {
    ...movedUnit,
    id: 'enemy-unit',
    side: 1,
    profile: { ...profile, name: 'Enemy Unit' },
    position: { x: 30, y: 10 },
    modelPositions: [{ x: 30, y: 10 }],
  };
  battle.units = [movedUnit, stationaryUnit, enemyUnit];

  const moved = movePlayModels(battle, 'moved-unit', 0, [0], 1, 0);
  const reinforcements = applyGameAction(moved, { type: 'play.stepPhase' }, { rules: rules40K10th });

  assert.equal(reinforcements.phase, 'movement');
  assert.equal(reinforcements.movementStep, 'reinforcements');
  assert.equal(reinforcements.units.find(candidate => candidate.id === 'moved-unit')?.movementAction, 'normalMove');
  const marked = reinforcements.units.find(candidate => candidate.id === 'stationary-unit')!;
  assert.equal(marked.movementAction, 'remainedStationary');
  assert.equal(marked.movementAllowanceRemaining, 0);
  assert.deepEqual(marked.movementAllowanceRemainingByModel, [0]);
  assert.equal(marked.movementComplete, true);
  assert.equal(reinforcements.units.find(candidate => candidate.id === 'enemy-unit')?.movementAction, undefined);
});

test('Remained Stationary units cannot move after being marked', () => {
  const battle = state('movement');
  const profile = {
    name: 'Stationary Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  markRemainingStationaryUnits(battle, 0);
  const moved = movePlayModels(battle, 'unit-1', 0, [0], 1, 0);
  const marked = moved.units.find(candidate => candidate.id === 'unit-1')!;

  assert.equal(marked.modelPositions[0].x, 10);
  assert.equal(marked.movementAction, 'remainedStationary');
});

test('Remained Stationary units can still shoot and charge', () => {
  const battle = state('movement');
  const profile = {
    name: 'Stationary Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Target', wounds: 99 },
    woundsOnLeadModel: 99,
    position: { x: 14, y: 10 },
    modelPositions: [{ x: 14, y: 10 }],
  };
  battle.units = [unit, enemy];

  const reinforcements = simulateNextPhase(battle, rules40K10th);
  assert.equal(reinforcements.phase, 'movement');
  assert.equal(reinforcements.movementStep, 'reinforcements');
  const shooting = simulateNextPhase(reinforcements, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.units.find(candidate => candidate.id === 'unit-1')?.movementAction, 'remainedStationary');
  assert.equal(shooting.log.some(entry => entry.message.includes('Stationary Shooter shoots')), true);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const charge = simulateNextPhase(shooting, rules40K10th);
    assert.equal(charge.phase, 'charge');
    assert.equal(charge.units.find(candidate => candidate.id === 'unit-1')?.charged, true);
    assert.equal(charge.log.some(entry => entry.message.includes('Stationary Shooter charges')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Remained Stationary resets at that army next command phase', () => {
  const battle = state('fight');
  battle.activeArmy = 1;
  const profile = {
    name: 'Stationary Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
    movementAction: 'remainedStationary',
    movementAllowanceRemaining: 0,
    movementAllowanceRemainingByModel: [0],
  };
  battle.units = [unit];

  const command = applyGameAction(battle, { type: 'play.stepPhase' }, { rules: rules40K10th });

  assert.equal(command.activeArmy, 0);
  assert.equal(command.phase, 'command');
  const reset = command.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(reset.movementAction, undefined);
  assert.equal(reset.movementAllowanceRemaining, undefined);
  assert.equal(reset.movementAllowanceRemainingByModel, undefined);
});

test('play Movement drags cannot exceed normal move allowance', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const first = movePlayModels(battle, 'unit-1', 0, [0], 10, 0);
  const firstUnit = first.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(firstUnit.modelPositions[0].x, 16);
  assert.equal(firstUnit.movementAction, 'normalMove');
  assert.equal(firstUnit.movementAllowanceRemaining, 0);

  const second = movePlayModels(first, 'unit-1', 0, [0], 1, 0);
  assert.equal(second.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 16);
});

test('play Movement locks a moved unit when another unit starts moving', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const firstUnit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile: { ...profile, name: 'First Unit' },
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const secondUnit: BattleUnit = {
    ...firstUnit,
    id: 'unit-2',
    profile: { ...profile, name: 'Second Unit' },
    position: { x: 20, y: 10 },
    modelPositions: [{ x: 20, y: 10 }],
  };
  battle.units = [firstUnit, secondUnit];

  const firstMove = movePlayModels(battle, 'unit-1', 0, [0], 2, 0);
  assert.equal(firstMove.units.find(candidate => candidate.id === 'unit-1')?.movementComplete, undefined);

  const secondMove = movePlayModels(firstMove, 'unit-2', 0, [0], 1, 0);
  const lockedFirst = secondMove.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(lockedFirst.movementComplete, true);
  assert.equal(secondMove.units.find(candidate => candidate.id === 'unit-2')?.movementComplete, undefined);

  const lateFirstMove = movePlayModels(secondMove, 'unit-1', 0, [0], 1, 0);
  assert.equal(lateFirstMove.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 12);
});

test('play Movement Done locks a moved unit', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 2, 0);
  const complete = completePlayUnitMovement(moved, 'unit-1', 0);
  assert.equal(complete.units.find(candidate => candidate.id === 'unit-1')?.movementComplete, true);

  const lateMove = movePlayModels(complete, 'unit-1', 0, [0], 1, 0);
  assert.equal(lateMove.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 12);
});

test('play Movement cannot end a normal move within enemy Engagement Range', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Enemy' },
    position: { x: 16.5, y: 10 },
    modelPositions: [{ x: 16.5, y: 10 }],
  };
  battle.units = [unit, enemy];

  const legal = movePlayModels(battle, 'unit-1', 0, [0], 3, 0);
  assert.equal(legal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 13);

  const illegal = movePlayModels(battle, 'unit-1', 0, [0], 5, 0);
  assert.equal(illegal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 10);
  assert.equal(illegal.units.find(candidate => candidate.id === 'unit-1')?.movementAction, undefined);
});

test('play Movement collision mode cannot move through enemy models', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Enemy' },
    position: { x: 13, y: 10 },
    modelPositions: [{ x: 13, y: 10 }],
  };
  battle.units = [unit, enemy];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 6, 0, true);
  const movedUnit = moved.units.find(candidate => candidate.id === 'unit-1')!;

  assert.ok(movedUnit.modelPositions[0].x < 13 - 0.9);
  assert.equal(movedUnit.movementAction, 'normalMove');
});

test('play Movement ignores model collisions unless collision mode is enabled', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const friendly: BattleUnit = {
    ...unit,
    id: 'friend-1',
    profile: { ...profile, name: 'Friend' },
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [unit, friendly];

  const normalDragOntoFriendly = movePlayModels(battle, 'unit-1', 0, [0], 2, 0, false);
  assert.equal(normalDragOntoFriendly.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 12);

  const collisionDragOntoFriendly = movePlayModels(battle, 'unit-1', 0, [0], 2, 0, true);
  assert.ok((collisionDragOntoFriendly.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x ?? 0) < 12);
});

test('play Movement with Fly can move over enemy models and blocking terrain', () => {
  const battle = state('movement');
  const profile = {
    name: 'Flyer',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Fly'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const enemyProfile = { ...profile, name: 'Enemy', keywords: [] };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: enemyProfile,
    position: { x: 13, y: 10 },
    modelPositions: [{ x: 13, y: 10 }],
  };
  battle.units = [unit, enemy];
  battle.terrain = [{
    id: 'terrain-1',
    name: 'Wall',
    x: 14,
    y: 8,
    width: 1,
    height: 4,
    type: 'obstacle',
    providesCover: true,
    difficult: false,
    color: '#555',
    features: [{
      id: 'feature-1',
      name: 'Wall',
      x: 14,
      y: 8,
      width: 1,
      height: 4,
      featureHeight: 'tall',
      blocksLOS: true,
      blocksMovement: true,
      difficult: false,
    }],
  }];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 6, 0);
  assert.equal(moved.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 16);

  const illegalEnd = movePlayModels(battle, 'unit-1', 0, [0], 3, 0);
  assert.ok((illegalEnd.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x ?? 0) < 13);
});

test('play Movement ignores blocking terrain unless collision mode is enabled', () => {
  const battle = state('movement');
  const profile = {
    name: 'Vehicle',
    move: 6,
    toughness: 8,
    save: 3,
    wounds: 10,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Vehicle'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];
  battle.terrain = [{
    id: 'terrain-1',
    name: 'Wall',
    x: 12,
    y: 8,
    width: 1,
    height: 4,
    type: 'obstacle',
    providesCover: true,
    difficult: false,
    color: '#555',
    features: [{
      id: 'feature-1',
      name: 'Wall',
      x: 12,
      y: 8,
      width: 1,
      height: 4,
      featureHeight: 'tall',
      blocksLOS: true,
      blocksMovement: true,
      difficult: false,
    }],
  }];

  const normalDrag = movePlayModels(battle, 'unit-1', 0, [0], 4, 0, false);
  assert.equal(normalDrag.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 14);

  const collisionDrag = movePlayModels(battle, 'unit-1', 0, [0], 4, 0, true);
  assert.ok((collisionDrag.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x ?? 0) < 12);
});

test('play Movement lets units deployed inside terrain mats move without collision mode', () => {
  const battle = state('movement');
  const profile = {
    name: 'Monster',
    move: 6,
    toughness: 8,
    save: 3,
    wounds: 10,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Monster'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];
  battle.terrain = [{
    id: 'terrain-1',
    name: 'Ruin',
    x: 8,
    y: 8,
    width: 6,
    height: 6,
    type: 'ruin',
    providesCover: true,
    difficult: false,
    color: '#555',
    features: [],
  }];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 2, 0, false);
  assert.equal(moved.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 12);
});

test('play Movement can set up Reinforcements more than 9 inches from enemies', () => {
  const battle = state('movement');
  const reserveProfile = {
    name: 'Reserve Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
    deployment: { mode: 'deepStrike' as const },
  };
  const enemyProfile = { ...reserveProfile, name: 'Enemy', deployment: undefined };
  const enemy: BattleUnit = {
    id: 'enemy-1',
    side: 1,
    profile: enemyProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 20, y: 10 },
    modelPositions: [{ x: 20, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.armies[0].army = { ...battle.armies[0].army, units: [reserveProfile] };
  battle.units = [enemy];

  const beforeStep = placePlayReinforcement(battle, 0, 0, { x: 10, y: 10 });
  assert.equal(beforeStep, battle);

  battle.movementStep = 'reinforcements';
  const tooClose = placePlayReinforcement(battle, 0, 0, { x: 12, y: 10 });
  assert.equal(tooClose, battle);

  const placed = placePlayReinforcement(battle, 0, 0, { x: 10, y: 10 });
  const reserve = placed.units.find(candidate => candidate.id !== 'enemy-1')!;
  assert.equal(reserve.profile.name, 'Reserve Unit');
  assert.equal(reserve.movementAction, 'normalMove');
  assert.equal(reserve.movementComplete, true);
  assert.equal(reserve.arrivedFromReinforcements, true);
  assert.deepEqual(reserve.movementAllowanceRemainingByModel, [0]);
  assert.match(placed.log.at(-1)?.message ?? '', /sets up Reserve Unit as Reinforcements/);
});

test('play Movement advances to Reinforcements before Shooting', () => {
  const battle = state('movement');
  const profile = {
    name: 'Waiting Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  battle.units = [{
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  }];

  const reinforcements = applyGameAction(battle, { type: 'play.stepPhase' }, { rules: rules40K10th });
  assert.equal(reinforcements.phase, 'movement');
  assert.equal(reinforcements.movementStep, 'reinforcements');
  assert.equal(reinforcements.units[0].movementAction, 'remainedStationary');

  const shooting = applyGameAction(reinforcements, { type: 'play.stepPhase' }, { rules: rules40K10th });
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.movementStep, undefined);
});

test('play Reinforcements step blocks normal movement but allows multiple Reinforcements', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const baseProfile = {
    name: 'Reserve One',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
    deployment: { mode: 'deepStrike' as const },
  };
  const activeProfile = { ...baseProfile, name: 'Active Unit', deployment: undefined };
  const enemyProfile = { ...baseProfile, name: 'Enemy', deployment: undefined };
  battle.armies[0].army = {
    ...battle.armies[0].army,
    units: [baseProfile, { ...baseProfile, name: 'Reserve Two' }],
  };
  battle.units = [
    {
      id: 'active-1',
      side: 0,
      profile: activeProfile,
      remainingModels: 1,
      woundsOnLeadModel: 1,
      position: { x: 2, y: 2 },
      modelPositions: [{ x: 2, y: 2 }],
      facingDeg: 0,
      charged: false,
      inCombat: false,
      battleshocked: false,
      activated: false,
      destroyed: false,
    },
    {
      id: 'enemy-1',
      side: 1,
      profile: enemyProfile,
      remainingModels: 1,
      woundsOnLeadModel: 1,
      position: { x: 20, y: 10 },
      modelPositions: [{ x: 20, y: 10 }],
      facingDeg: 0,
      charged: false,
      inCombat: false,
      battleshocked: false,
      activated: false,
      destroyed: false,
    },
  ];

  const moved = movePlayModels(battle, 'active-1', 0, [0], 1, 0);
  assert.equal(moved, battle);

  const firstPlaced = placePlayReinforcement(battle, 0, 0, { x: 10, y: 10 });
  assert.equal(firstPlaced.phase, 'movement');
  assert.equal(firstPlaced.movementStep, 'reinforcements');
  const secondPlaced = placePlayReinforcement(firstPlaced, 0, 1, { x: 10, y: 22 });
  assert.equal(secondPlaced.units.some(unit => unit.profile.name === 'Reserve One'), true);
  assert.equal(secondPlaced.units.some(unit => unit.profile.name === 'Reserve Two'), true);
  assert.equal(secondPlaced.phase, 'movement');
  assert.equal(secondPlaced.movementStep, 'reinforcements');
});

test('Reinforcements can shoot but cannot charge that turn', () => {
  const battle = state('movement');
  const reserveProfile = {
    name: 'Reserve Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
    deployment: { mode: 'strategicReserve' as const },
  };
  const enemyProfile = { ...reserveProfile, name: 'Target', wounds: 99, deployment: undefined };
  const enemy: BattleUnit = {
    id: 'enemy-1',
    side: 1,
    profile: enemyProfile,
    remainingModels: 1,
    woundsOnLeadModel: 99,
    position: { x: 20, y: 10 },
    modelPositions: [{ x: 20, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.armies[0].army = { ...battle.armies[0].army, units: [reserveProfile] };
  battle.units = [enemy];
  battle.movementStep = 'reinforcements';

  const placed = placePlayReinforcement(battle, 0, 0, { x: 10, y: 10 });
  const shooting = simulateNextPhase(placed, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Reserve Shooter shoots')), true);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const charge = simulateNextPhase(shooting, rules40K10th);
    assert.equal(charge.phase, 'charge');
    assert.equal(charge.units.find(candidate => candidate.profile.name === 'Reserve Shooter')?.charged, false);
    assert.equal(charge.log.some(entry => entry.message.includes('Reserve Shooter charges')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Shooting resolves a selected weapon into a selected target', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const shooterProfile = {
    name: 'Rifle Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Unit',
    save: 6,
    wounds: 3,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    remainingModels: 1,
    woundsOnLeadModel: 3,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const options = playShootingWeaponOptions(battle, 'shooter-1', 0, rules40K10th);
  assert.deepEqual(options.map(option => ({ weaponIndex: option.weaponIndex, targetIds: option.targetIds })), [
    { weaponIndex: 0, targetIds: ['target-1'] },
  ]);

  const rolls = [0.5, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shot = shootPlayUnitWeapon(battle, 'shooter-1', 0, 'target-1', 0, rules40K10th);
    const shotTarget = shot.units.find(unit => unit.id === 'target-1')!;
    assert.equal(shot.units.find(unit => unit.id === 'shooter-1')?.activated, true);
    assert.deepEqual(shotTarget.pendingDamageAllocations, [{
      damage: 1,
      noCarryOver: true,
      source: 'Bolt Rifle',
      sourceUnitId: 'shooter-1',
      sourceObjectiveIndexesWithinRange: [],
    }]);
    const assigned = allocatePlayDamageToModel(shot, 'target-1', 1, 0);
    const assignedTarget = assigned.units.find(unit => unit.id === 'target-1')!;
    assert.equal(assignedTarget.woundedModelIndex, 0);
    assert.equal(assignedTarget.woundsOnLeadModel, 2);
    assert.equal(shot.log.some(entry => entry.message.includes('Rifle Team shoots Target Unit')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th Shooting phase exposes weapons only during the active player Shoot step and advances to Charge', () => {
  const battle = state('shooting');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const shooter = losTestUnit('shooter', 0, { x: 0, y: 10 });
  shooter.profile.weapons = [
    { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
  ];
  const target = losTestUnit('target', 1, { x: 12, y: 10 });
  battle.units = [shooter, target];

  assert.equal(playShootingWeaponOptions(battle, shooter.id, 0, rules40K11th).length, 1);
  assert.deepEqual(playShootingWeaponOptions({ ...battle, activeArmy: 1 }, shooter.id, 0, rules40K11th), []);
  assert.deepEqual(playShootingWeaponOptions({ ...battle, phase: 'movement' }, shooter.id, 0, rules40K11th), []);

  const charge = simulateNextPhase(battle, rules40K11th);
  assert.equal(charge.phase, 'charge');
  assert.equal(charge.movementStep, undefined);
});

test('wound rolls use the highest toughness in a mixed-profile target unit', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const shooterProfile = {
    name: 'Mixed Toughness Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Strength Eight Rifle', range: 24, attacks: '1', skill: 3, strength: 8, ap: -10, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Mixed Toughness Target',
    toughness: 4,
    save: 6,
    wounds: 3,
    baseModelCount: 2,
    modelProfiles: [
      { name: 'Guard', count: 1, move: 6, toughness: 4, save: 6, wounds: 3, leadership: 7, oc: 1 },
      { name: 'Brute', count: 1, move: 6, toughness: 8, save: 6, wounds: 3, leadership: 7, oc: 1 },
    ],
    weapons: [],
  };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  target.profile = targetProfile;
  target.remainingModels = 2;
  target.woundsOnLeadModel = 3;
  target.modelPositions = [{ x: 12, y: 10 }, { x: 12, y: 11 }];
  battle.units = [shooter, target];

  const rolls = [0.5, 0.4];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0;
  try {
    const shot = shootPlayUnitWeapon(battle, 'shooter-1', 0, 'target-1', 0, rules40K11th);
    const shotTarget = shot.units.find(unit => unit.id === 'target-1')!;
    const messages = shot.log.map(entry => entry.message).join(' ');
    assert.equal(shotTarget.pendingDamageAllocations, undefined);
    assert.match(messages, /\[combat-stats\].*t=8/);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Shooting measures weapon range base edge to base edge', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const shooterProfile = {
    name: 'Edge Rifle Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    modelBases: [{ shape: 'round' as const, diameterMm: 25 }],
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Edge Target',
    save: 6,
    wounds: 3,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'edge-shooter',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'edge-target',
    side: 1,
    profile: targetProfile,
    remainingModels: 1,
    woundsOnLeadModel: 3,
    position: { x: 34.8, y: 10 },
    modelPositions: [{ x: 34.8, y: 10 }],
  };
  battle.units = [shooter, target];

  assert.equal(Math.hypot(target.position.x - shooter.position.x, target.position.y - shooter.position.y) > 24, true);
  assert.equal(battleUnitsBaseEdgeDistance(shooter, target) <= 24, true);

  const options = playShootingWeaponOptions(battle, 'edge-shooter', 0, rules40K10th);
  assert.deepEqual(options.map(option => ({ weaponIndex: option.weaponIndex, targetIds: option.targetIds })), [
    { weaponIndex: 0, targetIds: ['edge-target'] },
  ]);
});

test('play Shooting range respects oval and rotated square base shapes', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const ovalProfile = {
    name: 'Oval Rifle Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    modelBases: [{ shape: 'oval' as const, widthMm: 40, lengthMm: 75 }],
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const squareProfile = {
    ...ovalProfile,
    name: 'Square Rifle Team',
    modelBases: [{ shape: 'hull' as const, widthMm: 50, lengthMm: 50, footprint: 'square' as const }],
  };
  const targetProfile = {
    ...ovalProfile,
    name: 'Round Target',
    save: 6,
    wounds: 3,
    modelBases: [{ shape: 'round' as const, diameterMm: 25 }],
    weapons: [],
  };
  const ovalShooter: BattleUnit = {
    id: 'oval-shooter',
    side: 0,
    profile: ovalProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 90,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const ovalTarget: BattleUnit = {
    ...ovalShooter,
    id: 'oval-target',
    side: 1,
    profile: targetProfile,
    remainingModels: 1,
    woundsOnLeadModel: 3,
    position: { x: 35.3, y: 10 },
    modelPositions: [{ x: 35.3, y: 10 }],
    facingDeg: 0,
  };
  battle.units = [ovalShooter, ovalTarget];

  assert.equal(battleUnitsBaseEdgeDistance(ovalShooter, ovalTarget) > 24, true);
  assert.deepEqual(playShootingWeaponOptions(battle, 'oval-shooter', 0, rules40K10th)[0].targetIds, []);

  const squareShooter: BattleUnit = {
    ...ovalShooter,
    id: 'square-shooter',
    profile: squareProfile,
    position: { x: 10, y: 20 },
    modelPositions: [{ x: 10, y: 20 }],
    facingDeg: 45,
  };
  const squareTarget: BattleUnit = {
    ...ovalTarget,
    id: 'square-target',
    position: { x: 35.8, y: 20 },
    modelPositions: [{ x: 35.8, y: 20 }],
  };
  battle.units = [squareShooter, squareTarget];

  assert.equal(Math.hypot(squareTarget.position.x - squareShooter.position.x, squareTarget.position.y - squareShooter.position.y) > 24, true);
  assert.equal(battleUnitsBaseEdgeDistance(squareShooter, squareTarget) <= 24, true);
  assert.deepEqual(playShootingWeaponOptions(battle, 'square-shooter', 0, rules40K10th)[0].targetIds, ['square-target']);
});

test('shooting applies target Stealth ability as a hit modifier', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const shooter = losTestUnit('stealth-shooter', 0, { x: 10, y: 10 });
  shooter.profile = {
    ...shooter.profile,
    name: 'Stealth Shooter',
    weapons: [
      { name: 'Test Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
  };
  const target = losTestUnit('stealth-target', 1, { x: 15, y: 10 }, 6);
  target.profile = {
    ...target.profile,
    name: 'Stealth Target',
    abilities: [{ name: 'Stealth', description: 'Each time a ranged attack targets this unit, subtract 1 from the Hit roll.' }],
  };
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.34;
  try {
    const shot = shootPlayUnitWeapon(battle, shooter.id, 0, target.id, 0, rules40K10th);
    const messages = shot.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Stealth -1 to Hit/);
    assert.match(messages, /Hit rolls \(4\+\): \[3\]/);
    assert.equal(shot.units.find(unit => unit.id === target.id)?.pendingDamageAllocations, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Shooting lets the defender remove selected casualty models', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const shooterProfile = {
    name: 'Rifle Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Squad',
    save: 6,
    baseModelCount: 2,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 12, y: 11 },
    modelPositions: [{ x: 12, y: 10 }, { x: 12, y: 12 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.5, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shot = shootPlayUnitWeapon(battle, 'shooter-1', 0, 'target-1', 0, rules40K10th);
    const pendingTarget = shot.units.find(unit => unit.id === 'target-1')!;
    assert.deepEqual(pendingTarget.pendingDamageAllocations, [{
      damage: 1,
      noCarryOver: true,
      source: 'Bolt Rifle',
      sourceUnitId: 'shooter-1',
      sourceObjectiveIndexesWithinRange: [],
    }]);
    assert.equal(pendingTarget.remainingModels, 2);
    assert.equal(pendingTarget.modelPositions.length, 2);

    const removed = allocatePlayDamageToModel(shot, 'target-1', 1, 1);
    const trimmedTarget = removed.units.find(unit => unit.id === 'target-1')!;
    assert.equal(trimmedTarget.pendingDamageAllocations, undefined);
    assert.equal(trimmedTarget.remainingModels, 1);
    assert.deepEqual(trimmedTarget.modelPositions, [{ x: 12, y: 10 }]);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Shooting removes slain models before assigning a newly wounded model', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const shooterProfile = {
    name: 'Heavy Rifle Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Heavy Rifle', range: 24, attacks: '3', skill: 2, strength: 10, ap: -10, damage: '2', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Multiwound Squad',
    save: 6,
    wounds: 3,
    baseModelCount: 2,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'heavy-shooter',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'multi-target',
    side: 1,
    profile: targetProfile,
    remainingModels: 2,
    woundsOnLeadModel: 3,
    position: { x: 12, y: 11 },
    modelPositions: [{ x: 12, y: 10 }, { x: 12, y: 12 }],
  };
  battle.units = [shooter, target];

  const rolls = Array.from({ length: 12 }, () => 0.99);
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shot = shootPlayUnitWeapon(battle, 'heavy-shooter', 0, 'multi-target', 0, rules40K10th);
    const pendingTarget = shot.units.find(unit => unit.id === 'multi-target')!;
    assert.equal(pendingTarget.pendingDamageAllocations?.length, 3);
    assert.equal(pendingTarget.woundedModelIndex, undefined);

    const wounded = allocatePlayDamageToModel(shot, 'multi-target', 1, 1);
    const woundedTarget = wounded.units.find(unit => unit.id === 'multi-target')!;
    assert.equal(woundedTarget.remainingModels, 2);
    assert.equal(woundedTarget.woundedModelIndex, 1);
    assert.equal(woundedTarget.woundsOnLeadModel, 1);
    assert.equal(woundedTarget.pendingDamageAllocations?.length, 2);

    const rejected = allocatePlayDamageToModel(wounded, 'multi-target', 1, 0);
    assert.equal(rejected, wounded);

    const killed = allocatePlayDamageToModel(wounded, 'multi-target', 1, 1);
    const killedTarget = killed.units.find(unit => unit.id === 'multi-target')!;
    assert.equal(killedTarget.remainingModels, 1);
    assert.equal(killedTarget.woundedModelIndex, undefined);
    assert.equal(killedTarget.pendingDamageAllocations?.length, 1);

    const assigned = allocatePlayDamageToModel(killed, 'multi-target', 1, 0);
    const assignedTarget = assigned.units.find(unit => unit.id === 'multi-target')!;
    assert.equal(assignedTarget.pendingDamageAllocations, undefined);
    assert.equal(assignedTarget.woundedModelIndex, 0);
    assert.equal(assignedTarget.woundsOnLeadModel, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('damage allocation applies Feel No Pain before wounds are removed', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const target = losTestUnit('fnp-target', 1, { x: 12, y: 10 });
  target.profile = {
    ...target.profile,
    name: 'Feel No Pain Target',
    wounds: 3,
    abilities: [{ name: 'Feel No Pain 5+', description: 'Each time this model would lose a wound, roll one D6; on a 5+, that wound is not lost.' }],
  };
  target.woundsOnLeadModel = 3;
  target.pendingDamageAllocations = [{ damage: 3, noCarryOver: true, source: 'Test Damage' }];
  battle.units = [target];

  const rolls = [0.99, 0, 0.83];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0;
  try {
    const allocated = allocatePlayDamageToModel(battle, target.id, 1, 0);
    const allocatedTarget = allocated.units.find(unit => unit.id === target.id)!;
    const messages = allocated.log.map(entry => entry.message).join(' ');
    assert.equal(allocatedTarget.remainingModels, 1);
    assert.equal(allocatedTarget.woundedModelIndex, 0);
    assert.equal(allocatedTarget.woundsOnLeadModel, 2);
    assert.equal(allocatedTarget.pendingDamageAllocations, undefined);
    assert.match(messages, /Feel No Pain \(5\+\): \[6, 1, 5\] -> 2 ignored, 1 damage remains/);
    assert.match(messages, /allocates 1 damage to model 1 \(2W remaining\)/);
  } finally {
    Math.random = originalRandom;
  }
});

test('damage allocation can ignore all damage with Feel No Pain', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const target = losTestUnit('fnp-all-target', 1, { x: 12, y: 10 });
  target.profile = {
    ...target.profile,
    name: 'Full Ignore Target',
    wounds: 2,
    abilities: [{ name: 'Feel No Pain 4+', description: 'Ignore wounds on a 4+.' }],
  };
  target.woundsOnLeadModel = 2;
  target.pendingDamageAllocations = [{ damage: 2, noCarryOver: true, source: 'Test Damage' }];
  battle.units = [target];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const allocated = allocatePlayDamageToModel(battle, target.id, 1, 0);
    const allocatedTarget = allocated.units.find(unit => unit.id === target.id)!;
    assert.equal(allocatedTarget.remainingModels, 1);
    assert.equal(allocatedTarget.woundedModelIndex, undefined);
    assert.equal(allocatedTarget.woundsOnLeadModel, 2);
    assert.equal(allocatedTarget.pendingDamageAllocations, undefined);
    assert.match(allocated.log.map(entry => entry.message).join(' '), /no damage gets through/);
  } finally {
    Math.random = originalRandom;
  }
});

test('Advanced units can shoot Assault weapons but not other ranged weapons', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const profile = {
    name: 'Assault Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Assault Carbine', range: 18, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Assault'], isMelee: false },
      { name: 'Heavy Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: 'advanced',
    movementAllowanceRemaining: 0,
    movementAllowanceRemainingByModel: [0],
    movementComplete: true,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Target', wounds: 99, weapons: [] },
    woundsOnLeadModel: 99,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    position: { x: 16, y: 10 },
    modelPositions: [{ x: 16, y: 10 }],
  };
  battle.units = [unit, enemy];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Assault Shooter shoots')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Assault Carbine')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Heavy Rifle')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('Engaged units can shoot Pistols but not other ranged weapons', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const profile = {
    name: 'Pistol Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Pistol', range: 12, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const engagedEnemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Engaged Target', wounds: 99, weapons: [] },
    woundsOnLeadModel: 99,
    inCombat: true,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
  };
  const distantEnemy: BattleUnit = {
    ...engagedEnemy,
    id: 'enemy-2',
    profile: { ...profile, name: 'Distant Target', wounds: 99, weapons: [] },
    position: { x: 16, y: 10 },
    modelPositions: [{ x: 16, y: 10 }],
  };
  battle.units = [unit, engagedEnemy, distantEnemy];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Pistol Shooter shoots')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Pistol')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Rifle')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('Sidearms are not mixed with other ranged weapons when shooting all weapons', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Sidearm Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Pistol', range: 12, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('sidearm-shooter', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('sidearm-target', 1, { x: 12, y: 10 }, 6);
  target.profile = { ...profile, name: 'Target Dummy', wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const next = shootPlayUnitWeapon(battle, shooter.id, shooter.side, target.id, 'all', rules40K10th);
    const messages = next.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Bolt Rifle/);
    assert.equal(messages.includes('Bolt Pistol'), false);
    assert.equal(next.units.find(unit => unit.id === shooter.id)?.activated, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Choosing non-sidearm ranged weapons locks out sidearms for the rest of that shooting activation', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Two Rifle Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Pistol', range: 12, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Pistol'], isMelee: false },
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Plasma Gun', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('two-rifle-shooter', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('two-rifle-target', 1, { x: 12, y: 10 }, 6);
  target.profile = { ...profile, name: 'Target Dummy', wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const afterRifle = shootPlayUnitWeapon(battle, shooter.id, shooter.side, target.id, 1, rules40K10th);
    const options = playShootingWeaponOptions(afterRifle, shooter.id, shooter.side, rules40K10th);
    assert.equal(afterRifle.units.find(unit => unit.id === shooter.id)?.activated, false);
    assert.deepEqual(options.map(option => option.name), ['Plasma Gun']);
  } finally {
    Math.random = originalRandom;
  }
});

test('Multiple ranged weapon profiles choose only one profile when shooting all weapons', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Missile Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Frag Missile', profileGroup: 'Missile Launcher', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Krak Missile', profileGroup: 'Missile Launcher', range: 24, attacks: '1', skill: 3, strength: 8, ap: -2, damage: '2', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('missile-shooter', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('missile-target', 1, { x: 12, y: 10 }, 6);
  target.profile = { ...profile, name: 'Target Dummy', wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const next = shootPlayUnitWeapon(battle, shooter.id, shooter.side, target.id, 'all', rules40K10th);
    const messages = next.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Frag Missile/);
    assert.equal(messages.includes('Krak Missile'), false);
    assert.equal(next.units.find(unit => unit.id === shooter.id)?.activated, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Firing one ranged weapon profile locks out its alternate profiles', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Profile Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Frag Missile', profileGroup: 'Missile Launcher', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Krak Missile', profileGroup: 'Missile Launcher', range: 24, attacks: '1', skill: 3, strength: 8, ap: -2, damage: '2', keywords: [], isMelee: false },
      { name: 'Boltgun', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('profile-shooter', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('profile-target', 1, { x: 12, y: 10 }, 6);
  target.profile = { ...profile, name: 'Target Dummy', wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const afterFrag = shootPlayUnitWeapon(battle, shooter.id, shooter.side, target.id, 0, rules40K10th);
    const options = playShootingWeaponOptions(afterFrag, shooter.id, shooter.side, rules40K10th);
    assert.equal(afterFrag.units.find(unit => unit.id === shooter.id)?.activated, false);
    assert.deepEqual(options.map(option => option.name), ['Boltgun']);
  } finally {
    Math.random = originalRandom;
  }
});

test('Selected weapon profile abilities do not affect alternate profiles', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Profile Ability Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Plain Missile', profileGroup: 'Missile Launcher', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Coverbreaker Missile', profileGroup: 'Missile Launcher', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Ignores Cover'], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('profile-ability-shooter', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('profile-ability-target', 1, { x: 12, y: 10 }, 6);
  target.profile = { ...profile, name: 'Target Dummy', save: 4, wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];
  battle.terrain = [{
    id: 'cover-1',
    name: 'Cover',
    x: 10,
    y: 8,
    width: 4,
    height: 4,
    type: 'area',
    providesCover: true,
    difficult: false,
    color: '#555',
    features: [],
  }];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const next = shootPlayUnitWeapon(battle, shooter.id, shooter.side, target.id, 0, rules40K11th);
    const messages = next.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Plain Missile/);
    assert.match(messages, /Save rolls \(3\+, cover \+1\)/);
    assert.equal(messages.includes('Coverbreaker Missile'), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('Selected ranged target only resolves weapons that can still attack that target', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Split Range Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Short Blaster', range: 12, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Long Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('split-range-shooter', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('split-range-target', 1, { x: 20, y: 10 }, 7);
  target.profile = { ...profile, name: 'Far Target', save: 7, wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  const nearTarget = losTestUnit('split-range-near-target', 1, { x: 8, y: 10 }, 7);
  nearTarget.profile = { ...profile, name: 'Near Target', save: 7, wounds: 99, weapons: [] };
  nearTarget.woundsOnLeadModel = 99;
  battle.units = [shooter, target, nearTarget];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const next = shootPlayUnitWeapon(battle, shooter.id, shooter.side, target.id, 'all', rules40K11th);
    const messages = next.log.map(entry => entry.message).join(' ');
    const nextShooter = next.units.find(unit => unit.id === shooter.id)!;
    assert.match(messages, /Long Rifle/);
    assert.match(messages, /Short Blaster: Far Target is not a valid target/);
    assert.equal(nextShooter.activated, false);
    assert.deepEqual(nextShooter.firedWeaponIndices, [1]);
    assert.deepEqual(playShootingWeaponOptions(next, shooter.id, shooter.side, rules40K11th), [
      { weaponIndex: 0, name: 'Short Blaster', targetIds: [nearTarget.id] },
    ]);
  } finally {
    Math.random = originalRandom;
  }
});

test('Engaged units without Pistols cannot shoot', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const profile = {
    name: 'Locked Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
      { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Engaged Target', wounds: 99, weapons: [] },
    woundsOnLeadModel: 99,
    inCombat: true,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
  };
  battle.units = [unit, enemy];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Locked Shooter shoots')), false);
  assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Rifle')), false);
});

test('Engaged Vehicles can shoot non-Pistol weapons with Big Guns Never Tire', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const vehicleProfile = {
    name: 'Battle Tank',
    move: 8,
    toughness: 10,
    save: 3,
    wounds: 12,
    leadership: 7,
    oc: 3,
    baseModelCount: 1,
    keywords: ['Vehicle'],
    factionKeywords: [],
    weapons: [
      { name: 'Battle Cannon', range: 48, attacks: '1', skill: 3, strength: 10, ap: -1, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const infantryProfile = {
    ...vehicleProfile,
    name: 'Infantry Target',
    toughness: 4,
    wounds: 99,
    keywords: ['Infantry'],
    weapons: [],
  };
  const vehicle: BattleUnit = {
    id: 'vehicle-1',
    side: 0,
    profile: vehicleProfile,
    remainingModels: 1,
    woundsOnLeadModel: 12,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...vehicle,
    id: 'enemy-1',
    side: 1,
    profile: infantryProfile,
    woundsOnLeadModel: 99,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
  };
  battle.units = [vehicle, enemy];

  const originalRandom = Math.random;
  Math.random = () => 0.34;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Battle Tank shoots')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Battle Cannon')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Big Guns Never Tire -1 to Hit')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Big Guns Never Tire does not fire Blast weapons at engaged targets', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const vehicleProfile = {
    name: 'Blast Tank',
    move: 8,
    toughness: 10,
    save: 3,
    wounds: 12,
    leadership: 7,
    oc: 3,
    baseModelCount: 1,
    keywords: ['Vehicle'],
    factionKeywords: [],
    weapons: [
      { name: 'Demolisher Cannon', range: 24, attacks: '1', skill: 3, strength: 12, ap: -2, damage: '1', keywords: ['Blast'], isMelee: false },
    ],
    abilities: [],
  };
  const infantryProfile = {
    ...vehicleProfile,
    name: 'Infantry Target',
    toughness: 4,
    wounds: 99,
    keywords: ['Infantry'],
    weapons: [],
  };
  const vehicle: BattleUnit = {
    id: 'vehicle-1',
    side: 0,
    profile: vehicleProfile,
    remainingModels: 1,
    woundsOnLeadModel: 12,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const engagedEnemy: BattleUnit = {
    ...vehicle,
    id: 'enemy-1',
    side: 1,
    profile: { ...infantryProfile, name: 'Engaged Target' },
    woundsOnLeadModel: 99,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
  };
  battle.units = [vehicle, engagedEnemy];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Blast Tank shoots')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('Demolisher Cannon: no valid targets')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Engaged Target')), false);
});

test('Units cannot shoot enemy Infantry locked in combat with friendly units', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Rifle Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Locked Target',
    wounds: 99,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const friendly: BattleUnit = {
    ...shooter,
    id: 'friendly-1',
    profile: { ...shooterProfile, name: 'Friendly Screen', weapons: [] },
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
    inCombat: true,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 99,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    inCombat: true,
  };
  battle.units = [shooter, friendly, target];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Rifle Squad shoots')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Rifle: no valid targets')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Locked Target')), false);
});

test('Units can target enemy Vehicles locked in combat with friendly units', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Anti-Tank Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Lascannon', range: 48, attacks: '1', skill: 3, strength: 12, ap: -3, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const vehicleProfile = {
    ...shooterProfile,
    name: 'Locked Vehicle',
    toughness: 10,
    wounds: 99,
    keywords: ['Vehicle'],
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const friendly: BattleUnit = {
    ...shooter,
    id: 'friendly-1',
    profile: { ...shooterProfile, name: 'Friendly Screen', weapons: [] },
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
    inCombat: true,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: vehicleProfile,
    woundsOnLeadModel: 99,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    inCombat: true,
  };
  battle.units = [shooter, friendly, target];

  const originalRandom = Math.random;
  Math.random = () => 0.34;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Anti-Tank Squad shoots')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Lascannon')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Locked Vehicle')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Big Guns Never Tire -1 to Hit')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Lone Operative units cannot be targeted from more than 12 inches away', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Rifle Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const loneOperativeProfile = {
    ...shooterProfile,
    name: 'Lone Operative Target',
    wounds: 99,
    keywords: ['Infantry', 'Lone Operative'],
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: loneOperativeProfile,
    woundsOnLeadModel: 99,
    position: { x: 13, y: 10 },
    modelPositions: [{ x: 13, y: 10 }],
  };
  battle.units = [shooter, target];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Rifle Squad shoots')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Rifle: no valid targets')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Lone Operative Target')), false);
});

test('Lone Operative ability text blocks targeting from more than 12 inches away', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Ability Rifle Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Ability Lone Operative',
    wounds: 99,
    weapons: [],
    abilities: [{ name: 'Lone Operative', description: 'Unless the attacking model is within 12 inches, this unit cannot be selected as the target of ranged attacks.' }],
  };
  const shooter = losTestUnit('ability-shooter', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('ability-target', 1, { x: 13, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Rifle: no valid targets')), true);
  assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Ability Lone Operative')), false);
});

test('Lone Operative units can be targeted within 12 inches', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Close Rifle Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const loneOperativeProfile = {
    ...shooterProfile,
    name: 'Close Lone Operative',
    wounds: 99,
    keywords: ['Infantry', 'Lone Operative'],
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: loneOperativeProfile,
    woundsOnLeadModel: 99,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Close Rifle Squad shoots')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Bolt Rifle')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Close Lone Operative')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Lone Operative range is measured base edge to base edge', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Edge Rifle Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Bolt Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Edge Lone Operative',
    wounds: 99,
    keywords: ['Infantry', 'Lone Operative'],
    weapons: [],
  };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 12.9, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Edge Lone Operative')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Ignores Cover weapons do not grant the target a cover save bonus', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Cover Breaker',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Marker Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Ignores Cover'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Covered Target',
    save: 4,
    wounds: 1,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];
  battle.terrain = [{
    id: 'cover-1',
    name: 'Cover Area',
    x: 10,
    y: 8,
    width: 4,
    height: 4,
    type: 'area',
    providesCover: true,
    difficult: false,
    color: '#555',
    features: [],
  }];

  const rolls = [0.5, 0.5, 0.34];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.log.some(entry => entry.message.includes('Marker Rifle')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Save rolls (4+)')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('cover +1')), false);
    assert.equal(shooting.units.find(unit => unit.id === 'target-1')?.destroyed, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('obstacle mats do not block LOS without blocking features', () => {
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  const terrain = [terrainMat({
    id: 'obstacle-1',
    name: 'Barricade Footprint',
    type: 'obstacle',
    x: 5,
    y: 8,
    width: 3,
    height: 4,
    features: [],
  })];

  assert.equal(hasLOSEdgeToEdge(shooter.position, 0.5, target.position, 0.5, terrain), true);
  assert.equal(targetHasCoverFrom(shooter.position, target, terrain), false);
});

test('ruin footprints block LOS through the mat but not into or out of it', () => {
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  const targetBehind = losTestUnit('target-1', 1, { x: 12, y: 10 });
  const targetInside = losTestUnit('target-2', 1, { x: 6, y: 10 });
  const shooterInside = losTestUnit('shooter-2', 0, { x: 6, y: 10 });
  const terrain = [terrainMat({
    id: 'ruin-1',
    name: 'Ruin',
    type: 'ruin',
    x: 5,
    y: 8,
    width: 3,
    height: 4,
    features: [],
  })];

  assert.equal(hasLOSEdgeToEdge(shooter.position, 0.5, targetBehind.position, 0.5, terrain), false);
  assert.equal(hasLOSEdgeToEdge(shooter.position, 0.5, targetInside.position, 0.5, terrain), true);
  assert.equal(hasLOSEdgeToEdge(shooterInside.position, 0.5, targetBehind.position, 0.5, terrain), true);
  assert.equal(targetHasCoverFrom(shooter.position, targetInside, terrain), true);
});

test('blocking terrain features stop LOS even when their parent mat is not solid', () => {
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  const terrain = [terrainMat({
    id: 'wall-mat-1',
    name: 'Wall Footprint',
    type: 'obstacle',
    x: 5,
    y: 8,
    width: 3,
    height: 4,
    features: [{
      id: 'wall-1',
      name: 'Wall',
      x: 6,
      y: 7,
      width: 0.5,
      height: 6,
      featureHeight: 'tall',
      blocksLOS: true,
      blocksMovement: true,
      difficult: false,
    }],
  })];

  assert.equal(hasLOSEdgeToEdge(shooter.position, 0.5, target.position, 0.5, terrain), false);
  assert.equal(targetHasCoverFrom(shooter.position, target, terrain), true);
});

test('woods footprints grant cover without blocking LOS', () => {
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  const terrain = [terrainMat({
    id: 'woods-1',
    name: 'Woods',
    type: 'area',
    x: 5,
    y: 8,
    width: 3,
    height: 4,
    features: [],
  })];

  assert.equal(hasLOSEdgeToEdge(shooter.position, 0.5, target.position, 0.5, terrain), true);
  assert.equal(targetHasCoverFrom(shooter.position, target, terrain), true);
});

test('elevated models can see over low and mid blocking features', () => {
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10, z: 6 });
  const target = losTestUnit('target-1', 1, { x: 12, y: 10, z: 6 });
  const terrain = [terrainMat({
    id: 'wall-mat-1',
    name: 'Low Wall Footprint',
    type: 'obstacle',
    x: 5,
    y: 8,
    width: 3,
    height: 4,
    features: [{
      id: 'wall-1',
      name: 'Mid Wall',
      x: 6,
      y: 7,
      width: 0.5,
      height: 6,
      featureHeight: 'mid',
      blocksLOS: true,
      blocksMovement: true,
      difficult: false,
    }],
  })];

  assert.equal(hasLOSEdgeToEdge(shooter.position, 0.5, target.position, 0.5, terrain), true);
  assert.equal(targetHasCoverFrom(shooter.position, target, terrain), false);
});

test('Heavy weapons get +1 to Hit when the shooter Remained Stationary', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Heavy Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Heavy Bolter', range: 36, attacks: '1', skill: 4, strength: 5, ap: 0, damage: '1', keywords: ['Heavy'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 4,
    save: 6,
    wounds: 99,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: 'remainedStationary',
    movementAllowanceRemaining: 0,
    movementAllowanceRemainingByModel: [0],
    movementComplete: true,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 99,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.34, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Heavy Bolter')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Heavy +1 to Hit')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Hit rolls (3+)')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('1 hits')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Torrent weapons automatically hit instead of rolling to hit', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Flamer Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Flamer', range: 12, attacks: '3', skill: 6, strength: 4, ap: 0, damage: '1', keywords: ['Torrent'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 4,
    save: 6,
    wounds: 99,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 99,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
  };
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Flamer')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Torrent: 3 auto-hit(s)')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Hit rolls')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('units with no ranged weapons can be selected to shoot and make no attacks', () => {
  const battle = state('shooting');
  const shooter = losTestUnit('Unarmed Shooter', 0, { x: 0, y: 10 });
  const target = losTestUnit('Target Dummy', 1, { x: 12, y: 10 });
  battle.units = [shooter, target];

  const options = playShootingWeaponOptions(battle, shooter.id, shooter.side, rules40K10th);
  assert.equal(options.length, 1);
  assert.equal(options[0].weaponIndex, -1);
  assert.deepEqual(options[0].targetIds, []);

  const next = shootPlayUnitWeapon(battle, shooter.id, shooter.side, undefined, -1, rules40K10th);
  const resolvedShooter = next.units.find(unit => unit.id === shooter.id);
  assert.equal(resolvedShooter?.activated, true);
  assert.match(next.log.at(-1)?.message ?? '', /has no ranged weapons, so it makes no attacks/);
});

test('units with no melee weapons can be selected to fight and make no attacks', () => {
  const battle = state('fight');
  const fighter = losTestUnit('Unarmed Fighter', 0, { x: 10, y: 10 });
  const target = losTestUnit('Engaged Target', 1, { x: 10.8, y: 10 });
  battle.units = [fighter, target];

  const options = playFightWeaponOptions(battle, fighter.id, fighter.side, rules40K10th);
  assert.equal(options.length, 1);
  assert.equal(options[0].weaponIndex, -1);
  assert.deepEqual(options[0].targetIds, [target.id]);

  const next = fightPlayUnitWeapon(battle, fighter.id, fighter.side, target.id, -1, rules40K10th);
  const resolvedFighter = next.units.find(unit => unit.id === fighter.id);
  assert.equal(resolvedFighter?.activated, true);
  assert.match(next.log.at(-1)?.message ?? '', /has no melee weapons, so it makes no attacks/);
});

test('Hazardous shooting destroys one normal model on a failed test', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Plasma Trooper',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Plasma Gun', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Hazardous'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 99,
    wounds: 99,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 99,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.5, 0, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.log.some(entry => entry.message.includes('Hazardous tests for Plasma Gun: [1] -> 1 failure(s)')), true);
    assert.equal(shooting.units.find(unit => unit.id === 'shooter-1')?.destroyed, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Hazardous Vehicle shooting takes 3 damage on a failed test', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Plasma Tank',
    move: 8,
    toughness: 10,
    save: 3,
    wounds: 12,
    leadership: 7,
    oc: 3,
    baseModelCount: 1,
    keywords: ['Vehicle'],
    factionKeywords: [],
    weapons: [
      { name: 'Hazard Cannon', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Hazardous'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 99,
    wounds: 99,
    keywords: ['Infantry'],
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 12,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 99,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.5, 0, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const damagedTank = shooting.units.find(unit => unit.id === 'shooter-1');
    assert.equal(shooting.log.some(entry => entry.message.includes('Hazardous tests for Hazard Cannon: [1] -> 1 failure(s)')), true);
    assert.equal(damagedTank?.destroyed, false);
    assert.equal(damagedTank?.woundsOnLeadModel, 9);
  } finally {
    Math.random = originalRandom;
  }
});

test('Hazardous ranged tests only models that could attack the visible target', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  battle.terrain = [
    terrainMat({
      type: 'obstacle',
      x: 5,
      y: 9.8,
      width: 2,
      height: 2.8,
      providesCover: false,
      features: [{ id: 'wall-1', name: 'Wall', x: 5, y: 9.8, width: 2, height: 2.8, blocksLOS: true, blocksMovement: true, featureHeight: 'tall', difficult: false }],
    }),
  ];

  const shooterProfile = {
    name: 'Split Plasma Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Hazard Flamer', range: 24, attacks: '1', skill: 6, strength: 1, ap: 0, damage: '1', keywords: ['Torrent', 'Hazardous'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 99,
    wounds: 99,
    baseModelCount: 1,
    weapons: [],
  };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 9 });
  shooter.profile = shooterProfile;
  shooter.remainingModels = 2;
  shooter.modelPositions = [{ x: 0, y: 9 }, { x: 0, y: 12 }];
  shooter.position = { x: 0, y: 10.5 };
  const target = losTestUnit('target-1', 1, { x: 12, y: 9 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const rolls = [0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shot = shootPlayUnitWeapon(battle, 'shooter-1', 0, 'target-1', 0, rules40K11th);
    const messages = shot.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Hazard Flamer .* 1 model\(s\).* = 1 attacks/);
    assert.match(messages, /Hazardous tests for Hazard Flamer: \[1\] -> 1 failure/);
  } finally {
    Math.random = originalRandom;
  }
});

test('Hazardous melee weapons test after their fight attacks resolve', () => {
  const battle = state('fight');
  battle.activeArmy = 0;
  const fighter = losTestUnit('fighter-1', 0, { x: 10, y: 10 });
  fighter.profile = {
    ...fighter.profile,
    name: 'Risky Fighter',
    weapons: [
      { name: 'Hazard Blade', range: 0, attacks: '1', skill: 3, strength: 1, ap: 0, damage: '1', keywords: ['Hazardous'], isMelee: true },
    ],
  };
  const target = losTestUnit('target-1', 1, { x: 10.8, y: 10 });
  target.profile = { ...target.profile, name: 'Fight Target', toughness: 99 };
  battle.units = [fighter, target];

  const rolls = [0.5, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const fought = fightPlayUnitWeapon(battle, 'fighter-1', 0, 'target-1', 0, rules40K11th);
    const messages = fought.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Hazard Blade/);
    assert.match(messages, /Hazardous tests for Hazard Blade: \[1\] -> 1 failure/);
    assert.equal(fought.units.find(unit => unit.id === 'fighter-1')?.destroyed, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('deferred mortal damage carries over during defender allocation', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  target.profile = {
    ...target.profile,
    name: 'Mortal Target',
    baseModelCount: 2,
    wounds: 1,
  };
  target.remainingModels = 2;
  target.modelPositions = [{ x: 12, y: 10 }, { x: 13, y: 10 }];
  target.position = { x: 12.5, y: 10 };
  target.pendingDamageAllocations = [{ damage: 2, source: 'mortal wounds' }];
  battle.units = [target];

  const first = allocatePlayDamageToModel(battle, 'target-1', 1, 0);
  const afterFirst = first.units.find(unit => unit.id === 'target-1')!;
  assert.equal(afterFirst.remainingModels, 1);
  assert.deepEqual(afterFirst.pendingDamageAllocations, [{ damage: 1, source: 'mortal wounds' }]);

  const second = allocatePlayDamageToModel(first, 'target-1', 1, 0);
  const afterSecond = second.units.find(unit => unit.id === 'target-1')!;
  assert.equal(afterSecond.destroyed, true);
  assert.equal(afterSecond.pendingDamageAllocations, undefined);
});

test('Twin-linked weapons reroll failed wound rolls once', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Twin Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Twin Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Twin-linked'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 4,
    save: 6,
    wounds: 99,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 99,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.5, 0, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Twin-linked wound rerolls (4+): [4] -> 1 wounds')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Save rolls')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Melta weapons add damage within half range', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Melta Gunner',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Meltagun', range: 12, attacks: '1', skill: 3, strength: 8, ap: 0, damage: '1', keywords: ['Melta 2'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Target Dummy',
    toughness: 4,
    save: 6,
    wounds: 5,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 5,
    position: { x: 6, y: 10 },
    modelPositions: [{ x: 6, y: 10 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.5, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const damagedTarget = shooting.units.find(unit => unit.id === 'target-1');
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Melta: +2 damage within half range')), true);
    assert.equal(damagedTarget?.woundsOnLeadModel, 2);
  } finally {
    Math.random = originalRandom;
  }
});

test('Melta half range is measured base edge to base edge', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Edge Melta Gunner',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Meltagun', range: 12, attacks: '1', skill: 3, strength: 8, ap: 0, damage: '1', keywords: ['Melta 2'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Edge Target Dummy',
    toughness: 4,
    save: 6,
    wounds: 5,
    weapons: [],
  };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 6.9, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 5;
  battle.units = [shooter, target];

  const rolls = [0.5, 0.5, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const damagedTarget = shooting.units.find(unit => unit.id === 'target-1');
    assert.equal(shooting.log.some(entry => entry.message.includes('Melta: +2 damage within half range')), true);
    assert.equal(damagedTarget?.woundsOnLeadModel, 2);
  } finally {
    Math.random = originalRandom;
  }
});

test('Rapid Fire half range is measured base edge to base edge', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Rapid Gunner',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Rapid Rifle', range: 12, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Rapid Fire 2'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = { ...shooterProfile, name: 'Rapid Target', wounds: 99, weapons: [] };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 6.9, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.log.some(entry => entry.message.includes('Rapid Rifle') && entry.message.includes('= 3 attacks')), true);
});

test('One Shot ranged weapons can only be fired once per battle', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Missile Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Hunter Missile', range: 48, attacks: '1', skill: 3, strength: 10, ap: -2, damage: 'D6', keywords: ['One Shot'], isMelee: false },
      { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('missile-team', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('target', 1, { x: 12, y: 10 }, 7);
  target.profile = { ...profile, name: 'Target', toughness: 99, wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  assert.deepEqual(playShootingWeaponOptions(battle, shooter.id, 0, rules40K11th).map(option => option.name), ['Hunter Missile', 'Rifle']);

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const fired = shootPlayUnitWeapon(battle, shooter.id, 0, target.id, 0, rules40K11th);
    const firedShooter = fired.units.find(unit => unit.id === shooter.id)!;
    assert.deepEqual(firedShooter.oneShotSpentWeaponIndices, [0]);

    const later = {
      ...fired,
      units: fired.units.map(unit => unit.id === shooter.id
        ? { ...unit, activated: false, firedWeaponIndices: undefined }
        : unit),
    };
    assert.deepEqual(playShootingWeaponOptions(later, shooter.id, 0, rules40K11th).map(option => option.name), ['Rifle']);
  } finally {
    Math.random = originalRandom;
  }
});

test('Anti weapons score critical wounds against matching target keywords', () => {
  const battle = state('shooting');
  const profile = {
    name: 'Poison Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Poison Rifle', range: 24, attacks: '1', skill: 3, strength: 3, ap: -10, damage: '1', keywords: ['Anti-Infantry 4+'], isMelee: false },
    ],
    abilities: [],
  };
  const shooter = losTestUnit('poison-team', 0, { x: 0, y: 10 });
  shooter.profile = profile;
  const target = losTestUnit('target', 1, { x: 12, y: 10 }, 6);
  target.profile = { ...profile, name: 'Infantry Target', toughness: 10, wounds: 2, weapons: [] };
  target.woundsOnLeadModel = 2;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  const rolls = [0.5, 0.5];
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shot = shootPlayUnitWeapon(battle, shooter.id, 0, target.id, 0, rules40K11th);
    const shotTarget = shot.units.find(unit => unit.id === target.id)!;
    const messages = shot.log.map(entry => entry.message).join(' ');
    assert.deepEqual(shotTarget.pendingDamageAllocations, [{
      damage: 1,
      noCarryOver: true,
      source: 'Poison Rifle',
      sourceUnitId: 'poison-team',
      sourceObjectiveIndexesWithinRange: [],
    }]);
    assert.match(messages, /Anti 4\+ critical wounds/);
  } finally {
    Math.random = originalRandom;
  }
});

test('Anti weapons use attached unit keywords while bodyguard is alive', () => {
  const battle = state('shooting');
  const shooterProfile = {
    name: 'Witch Hunter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Judgement Rifle', range: 24, attacks: '1', skill: 3, strength: 1, ap: -10, damage: '1', keywords: ['Anti-Character 4+'], isMelee: false },
    ],
    abilities: [],
  };
  const bodyguardProfile = { ...shooterProfile, name: 'Bodyguard Unit', toughness: 10, wounds: 2, weapons: [] };
  const leaderProfile = { ...bodyguardProfile, name: 'Attached Leader', keywords: ['Infantry', 'Character'] };
  const shooter = losTestUnit('witch-hunter', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const bodyguard = losTestUnit('bodyguard', 1, { x: 12, y: 10 });
  bodyguard.profile = bodyguardProfile;
  bodyguard.woundsOnLeadModel = 2;
  const leader = losTestUnit('leader', 1, { x: 10, y: 10 });
  leader.profile = leaderProfile;
  leader.attachedToUnitId = bodyguard.id;
  leader.woundsOnLeadModel = 2;
  battle.units = [shooter, bodyguard, leader];

  const originalRandom = Math.random;
  const rolls = [0.5, 0.5];
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shot = shootPlayUnitWeapon(battle, shooter.id, 0, bodyguard.id, 0, rules40K11th);
    const shotTarget = shot.units.find(unit => unit.id === bodyguard.id)!;
    const messages = shot.log.map(entry => entry.message).join(' ');
    assert.deepEqual(shotTarget.pendingDamageAllocations, [{
      damage: 1,
      noCarryOver: true,
      source: 'Judgement Rifle',
      sourceUnitId: 'witch-hunter',
      sourceObjectiveIndexesWithinRange: [],
    }]);
    assert.match(messages, /Anti 4\+ critical wounds/);
  } finally {
    Math.random = originalRandom;
  }
});

test('Sustained Hits add extra hits on critical hit rolls', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Sustained Gunner',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Sustained Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Sustained Hits 2'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = { ...shooterProfile, name: 'Sustained Target', wounds: 99, weapons: [] };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 99;
  battle.units = [shooter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.log.some(entry => entry.message.includes('Hit rolls') && entry.message.includes('3 hits')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Blast adds attacks based on target model count', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Blast Gunner',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Blast Cannon', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Blast'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = { ...shooterProfile, name: 'Blast Target', baseModelCount: 10, wounds: 99, weapons: [] };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  target.profile = targetProfile;
  target.remainingModels = 10;
  target.woundsOnLeadModel = 99;
  target.modelPositions = Array.from({ length: 10 }, (_, i) => ({ x: 12, y: 7 + i * 0.7 }));
  target.position = { x: 12, y: 10.15 };
  battle.units = [shooter, target];

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.log.some(entry => entry.message.includes('Blast Cannon') && entry.message.includes('= 3 attacks')), true);
});

test('Devastating Wounds bypass saves and apply weapon damage without mortal carryover', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Devastating Gunner',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Devastator Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '2', keywords: ['Devastating Wounds'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = { ...shooterProfile, name: 'Devastating Target', save: 2, wounds: 3, weapons: [] };
  const shooter = losTestUnit('shooter-1', 0, { x: 0, y: 10 });
  shooter.profile = shooterProfile;
  const target = losTestUnit('target-1', 1, { x: 12, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 3;
  battle.units = [shooter, target];

  const rolls = [0.5, 0.99];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const damagedTarget = shooting.units.find(unit => unit.id === 'target-1');
    assert.equal(shooting.log.some(entry => entry.message.includes('Devastating Wounds: 1 wound(s) bypass saves')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Save rolls')), false);
    assert.equal(damagedTarget?.woundsOnLeadModel, 1);
  } finally {
    Math.random = originalRandom;
  }
});

test('Indirect Fire weapons can target without LOS with hit penalty and cover', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Mortar Team',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Mortar', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Indirect Fire'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Hidden Target',
    toughness: 4,
    save: 4,
    wounds: 3,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 3,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];
  battle.terrain = [{
    id: 'wall-1',
    name: 'Wall',
    x: 6,
    y: 8,
    width: 1,
    height: 4,
    type: 'obstacle',
    providesCover: true,
    difficult: false,
    color: '#555',
    features: [{
      id: 'feature-1',
      name: 'Wall',
      x: 6,
      y: 8,
      width: 1,
      height: 4,
      featureHeight: 'tall',
      blocksLOS: true,
      blocksMovement: true,
      difficult: false,
    }],
  }];

  const rolls = [0.5, 0.5, 0.34];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const hiddenTarget = shooting.units.find(unit => unit.id === 'target-1');
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Mortar')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Indirect Fire -1 to Hit; target has Benefit of Cover')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Hit rolls (4+)')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Save rolls (3+, cover +1)')), true);
    assert.equal(hiddenTarget?.woundsOnLeadModel, 3);
  } finally {
    Math.random = originalRandom;
  }
});

test('Lethal Hits critical hits automatically wound', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Lethal Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Lethal Rifle', range: 24, attacks: '1', skill: 3, strength: 1, ap: 0, damage: '1', keywords: ['Lethal Hits'], isMelee: false },
    ],
    abilities: [],
  };
  const targetProfile = {
    ...shooterProfile,
    name: 'Hard Target',
    toughness: 10,
    save: 6,
    wounds: 3,
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...shooter,
    id: 'target-1',
    side: 1,
    profile: targetProfile,
    woundsOnLeadModel: 3,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  battle.units = [shooter, target];

  const rolls = [0.99, 0];
  const originalRandom = Math.random;
  Math.random = () => rolls.shift() ?? 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const damagedTarget = shooting.units.find(unit => unit.id === 'target-1');
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('Lethal Hits: 1 critical hit(s) auto-wound')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('Wound rolls')), false);
    assert.equal(damagedTarget?.woundsOnLeadModel, 2);
  } finally {
    Math.random = originalRandom;
  }
});

test('Attached leaders cannot be targeted while their bodyguard is alive', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Rifle Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
  };
  const bodyguardProfile = { ...shooterProfile, name: 'Bodyguard Unit', wounds: 99, weapons: [] };
  const leaderProfile = { ...shooterProfile, name: 'Attached Leader', wounds: 99, keywords: ['Infantry', 'Character'], weapons: [] };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const bodyguard: BattleUnit = {
    ...shooter,
    id: 'bodyguard-1',
    side: 1,
    profile: bodyguardProfile,
    woundsOnLeadModel: 99,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  const leader: BattleUnit = {
    ...bodyguard,
    id: 'leader-1',
    attachedToUnitId: 'bodyguard-1',
    profile: leaderProfile,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
  };
  battle.units = [shooter, bodyguard, leader];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Bodyguard Unit')), true);
    assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Attached Leader')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('Precision weapons can target attached leaders while their bodyguard is alive', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Precision Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Sniper Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: ['Precision'], isMelee: false },
    ],
    abilities: [],
  };
  const bodyguardProfile = { ...shooterProfile, name: 'Bodyguard Unit', wounds: 99, weapons: [] };
  const leaderProfile = { ...shooterProfile, name: 'Attached Leader', wounds: 99, keywords: ['Infantry', 'Character'], weapons: [] };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 0, y: 10 },
    modelPositions: [{ x: 0, y: 10 }],
    facingDeg: 0,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementComplete: undefined,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const bodyguard: BattleUnit = {
    ...shooter,
    id: 'bodyguard-1',
    side: 1,
    profile: bodyguardProfile,
    woundsOnLeadModel: 99,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  const leader: BattleUnit = {
    ...bodyguard,
    id: 'leader-1',
    attachedToUnitId: 'bodyguard-1',
    profile: leaderProfile,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
  };
  battle.units = [shooter, bodyguard, leader];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    assert.equal(shooting.phase, 'shooting');
    assert.equal(shooting.log.some(entry => entry.message.includes('attacks vs Attached Leader')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Charge resolves a selected charger into a selected target', () => {
  const battle = state('charge');
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const chargerProfile = {
    name: 'Charging Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const targetProfile = { ...chargerProfile, name: 'Charge Target', weapons: [] };
  const charger = losTestUnit('charger-1', 0, { x: 0, y: 10 });
  charger.profile = chargerProfile;
  const target = losTestUnit('target-1', 1, { x: 6, y: 10 });
  target.profile = targetProfile;
  battle.units = [charger, target];

  const options = playChargeTargetOptions(battle, 'charger-1', 0, rules40K10th);
  assert.deepEqual(options.map(option => option.targetId), ['target-1']);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const charged = chargePlayUnitTarget(battle, 'charger-1', 0, 'target-1', rules40K10th);
    const chargedUnit = charged.units.find(unit => unit.id === 'charger-1')!;
    const chargedTarget = charged.units.find(unit => unit.id === 'target-1')!;
    assert.equal(chargedUnit.charged, true);
    assert.equal(chargedUnit.activated, true);
    assert.equal(chargedUnit.inCombat, true);
    assert.equal(chargedTarget.inCombat, true);
    assert.equal(charged.log.some(entry => entry.message.includes('makes a successful charge')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('11th Charge phase gates charge declarations and failed charges activate the unit without moving', () => {
  const battle = state('charge');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const charger = losTestUnit('charger-1', 0, { x: 0, y: 10 });
  charger.profile = { ...charger.profile, name: 'Charging Unit', weapons: [meleeWeapon] };
  const target = losTestUnit('target-1', 1, { x: 8.4, y: 10 });
  target.profile = { ...target.profile, name: 'Charge Target', weapons: [] };
  battle.units = [charger, target];

  assert.equal(playChargeTargetOptions(battle, charger.id, 0, rules40K11th).length, 1);
  assert.deepEqual(playChargeTargetOptions({ ...battle, activeArmy: 1 }, charger.id, 0, rules40K11th), []);
  assert.deepEqual(playChargeTargetOptions({ ...battle, phase: 'shooting' }, charger.id, 0, rules40K11th), []);

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const failed = chargePlayUnitTarget(battle, charger.id, 0, target.id, rules40K11th);
    const failedCharger = failed.units.find(unit => unit.id === charger.id)!;
    assert.equal(failedCharger.activated, true);
    assert.equal(failedCharger.charged, false);
    assert.equal(failedCharger.inCombat, false);
    assert.deepEqual(failedCharger.position, charger.position);
    assert.match(failed.log.map(entry => entry.message).join(' '), /fails the charge/);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Fight resolves selected melee weapons into a selected target', () => {
  const battle = state('fight');
  const meleeWeapon = { name: 'Power Blade', range: 0, attacks: '1', skill: 2, strength: 10, ap: -10, damage: '2', keywords: [], isMelee: true };
  const fighterProfile = {
    name: 'Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const targetProfile = { ...fighterProfile, name: 'Fight Target', save: 6, wounds: 3, weapons: [] };
  const fighter = losTestUnit('fighter-1', 0, { x: 0, y: 10 });
  fighter.profile = fighterProfile;
  fighter.charged = true;
  fighter.inCombat = true;
  const target = losTestUnit('target-1', 1, { x: 0.9, y: 10 });
  target.profile = targetProfile;
  target.woundsOnLeadModel = 3;
  target.inCombat = true;
  battle.units = [fighter, target];

  const options = playFightWeaponOptions(battle, 'fighter-1', 0, rules40K10th);
  assert.deepEqual(options, [{ weaponIndex: 0, name: 'Power Blade', targetIds: ['target-1'] }]);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const fought = fightPlayUnitWeapon(battle, 'fighter-1', 0, 'target-1', 'all', rules40K10th);
    const foughtUnit = fought.units.find(unit => unit.id === 'fighter-1')!;
    const foughtTarget = fought.units.find(unit => unit.id === 'target-1')!;
    assert.equal(foughtUnit.activated, true);
    assert.deepEqual(foughtTarget.pendingDamageAllocations, [{
      damage: 2,
      noCarryOver: true,
      source: 'Power Blade',
      sourceUnitId: 'fighter-1',
      sourceObjectiveIndexesWithinRange: [],
    }]);
    assert.equal(fought.log.some(entry => entry.message.includes('Fighter fights Fight Target')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('fight damage allocation lets the defender pick the damaged model', () => {
  const battle = state('fight');
  const meleeWeapon = { name: 'Power Blade', range: 0, attacks: '1', skill: 2, strength: 10, ap: -10, damage: '2', keywords: [], isMelee: true };
  const fighterProfile = {
    name: 'Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const targetProfile = { ...fighterProfile, name: 'Fight Target', save: 6, wounds: 3, baseModelCount: 2, weapons: [] };
  const fighter = losTestUnit('fighter-1', 0, { x: 0, y: 10 });
  fighter.profile = fighterProfile;
  fighter.charged = true;
  fighter.inCombat = true;
  const target = losTestUnit('target-1', 1, { x: 0.9, y: 10 });
  target.profile = targetProfile;
  target.remainingModels = 2;
  target.woundsOnLeadModel = 3;
  target.modelPositions = [{ x: 0.9, y: 10 }, { x: 0.9, y: 11 }];
  target.inCombat = true;
  battle.units = [fighter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const fought = fightPlayUnitWeapon(battle, 'fighter-1', 0, 'target-1', 'all', rules40K10th);
    const allocated = allocatePlayDamageToModel(fought, 'target-1', 1, 1);
    const allocatedTarget = allocated.units.find(unit => unit.id === 'target-1')!;
    assert.equal(allocatedTarget.remainingModels, 2);
    assert.equal(allocatedTarget.woundedModelIndex, 1);
    assert.equal(allocatedTarget.woundsOnLeadModel, 1);
    assert.equal(allocatedTarget.pendingDamageAllocations, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('normal damage allocated to a model does not carry excess damage to another model', () => {
  const battle = state('shooting');
  battle.activeArmy = 0;
  const profile = {
    name: 'Multiwound Target',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 3,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const target = losTestUnit('target-1', 1, { x: 10, y: 10 });
  target.profile = profile;
  target.remainingModels = 2;
  target.woundsOnLeadModel = 3;
  target.modelPositions = [{ x: 10, y: 10 }, { x: 10, y: 11 }];
  target.pendingDamageAllocations = [{ damage: 5, noCarryOver: true, source: 'High Damage Hit' }];
  battle.units = [target];

  const allocated = allocatePlayDamageToModel(battle, 'target-1', 1, 0);
  const allocatedTarget = allocated.units.find(unit => unit.id === 'target-1')!;
  assert.equal(allocatedTarget.remainingModels, 1);
  assert.equal(allocatedTarget.woundedModelIndex, undefined);
  assert.equal(allocatedTarget.woundsOnLeadModel, 3);
  assert.equal(allocatedTarget.pendingDamageAllocations, undefined);
});

test('Multiple melee weapon profiles choose only one profile when fighting all weapons', () => {
  const battle = state('fight');
  const profile = {
    name: 'Axe Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Sweep', profileGroup: 'Power Axe', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true },
      { name: 'Strike', profileGroup: 'Power Axe', range: 0, attacks: '1', skill: 3, strength: 8, ap: -2, damage: '2', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const fighter = losTestUnit('axe-fighter', 0, { x: 10, y: 10 });
  fighter.profile = profile;
  fighter.inCombat = true;
  const target = losTestUnit('axe-target', 1, { x: 10.8, y: 10 }, 6);
  target.profile = { ...profile, name: 'Target Dummy', wounds: 99, weapons: [] };
  target.woundsOnLeadModel = 99;
  target.inCombat = true;
  battle.units = [fighter, target];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const next = fightPlayUnitWeapon(battle, fighter.id, fighter.side, target.id, 'all', rules40K10th);
    const messages = next.log.map(entry => entry.message).join(' ');
    assert.match(messages, /Sweep/);
    assert.equal(messages.includes('Strike'), false);
    assert.equal(next.units.find(unit => unit.id === fighter.id)?.activated, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('Melee weapons can split declared attacks between engaged targets', () => {
  const battle = state('fight');
  const profile = {
    name: 'Split Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [
      { name: 'Chainblade', range: 0, attacks: '4', skill: 3, strength: 8, ap: -5, damage: '1', keywords: [], isMelee: true },
    ],
    abilities: [],
  };
  const fighter = losTestUnit('split-fighter', 0, { x: 10, y: 10 });
  fighter.profile = profile;
  fighter.inCombat = true;
  const targetA = losTestUnit('split-target-a', 1, { x: 10.8, y: 10 }, 7);
  targetA.profile = { ...profile, name: 'Target A', save: 7, wounds: 99, weapons: [] };
  targetA.woundsOnLeadModel = 99;
  targetA.inCombat = true;
  const targetB = losTestUnit('split-target-b', 1, { x: 10, y: 10.8 }, 7);
  targetB.profile = { ...profile, name: 'Target B', save: 7, wounds: 99, weapons: [] };
  targetB.woundsOnLeadModel = 99;
  targetB.inCombat = true;
  battle.units = [fighter, targetA, targetB];
  assert.equal(playMeleeFixedAttackCount(battle, fighter.id, fighter.side, 0, rules40K11th), 4);
  assert.equal(fightPlayUnitWeapon(battle, fighter.id, fighter.side, targetA.id, 0, rules40K11th, [
    { targetUnitId: targetA.id, attacks: 1 },
    { targetUnitId: targetB.id, attacks: 2 },
  ]), battle);
  assert.equal(fightPlayUnitWeapon(battle, fighter.id, fighter.side, targetA.id, 0, rules40K11th, [
    { targetUnitId: targetA.id, attacks: -1 },
    { targetUnitId: targetB.id, attacks: 5 },
  ]), battle);

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const next = fightPlayUnitWeapon(battle, fighter.id, fighter.side, targetA.id, 0, rules40K11th, [
      { targetUnitId: targetA.id, attacks: 2 },
      { targetUnitId: targetB.id, attacks: 2 },
    ]);
    const nextFighter = next.units.find(unit => unit.id === fighter.id)!;
    const nextTargetA = next.units.find(unit => unit.id === targetA.id)!;
    const nextTargetB = next.units.find(unit => unit.id === targetB.id)!;
    const messages = next.log.map(entry => entry.message).join(' ');
    assert.equal(nextFighter.activated, true);
    assert.deepEqual(nextTargetA.pendingDamageAllocations, [
      { damage: 1, noCarryOver: true, source: 'Chainblade', sourceUnitId: 'split-fighter', sourceObjectiveIndexesWithinRange: [] },
      { damage: 1, noCarryOver: true, source: 'Chainblade', sourceUnitId: 'split-fighter', sourceObjectiveIndexesWithinRange: [] },
    ]);
    assert.deepEqual(nextTargetB.pendingDamageAllocations, [
      { damage: 1, noCarryOver: true, source: 'Chainblade', sourceUnitId: 'split-fighter', sourceObjectiveIndexesWithinRange: [] },
      { damage: 1, noCarryOver: true, source: 'Chainblade', sourceUnitId: 'split-fighter', sourceObjectiveIndexesWithinRange: [] },
    ]);
    assert.match(messages, /Split melee attacks: 2 attack\(s\) declared against Target A/);
    assert.match(messages, /Split melee attacks: 2 attack\(s\) declared against Target B/);

    const action = {
      type: GAME_ACTION_TYPE.FightUnitWeapon,
      unitId: fighter.id,
      side: fighter.side,
      targetUnitId: targetA.id,
      weaponIndex: 0,
      targetSplits: [
        { targetUnitId: targetA.id, attacks: 2 },
        { targetUnitId: targetB.id, attacks: 2 },
      ],
    } satisfies GameAction;
    const resolved = applyGameAction(battle, action, { rules: rules40K11th });
    const appended = appendTimelineAction(createPracticeTimeline(battle), battle, action, { rules: rules40K11th });
    const replayed = replayTimeline(appended.timeline, { rules: rules40K11th }, false);
    assert.deepEqual(
      replayed.units.map(unit => unit.pendingDamageAllocations),
      resolved.units.map(unit => unit.pendingDamageAllocations),
    );
  } finally {
    Math.random = originalRandom;
  }
});

test('play Fight activation options require charged units to fight first', () => {
  const battle = state('fight');
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const profile = {
    name: 'Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const charged = losTestUnit('charged-1', 0, { x: 0, y: 10 });
  charged.profile = { ...profile, name: 'Charged Fighter' };
  charged.charged = true;
  charged.inCombat = true;
  const normal = losTestUnit('normal-1', 0, { x: 0, y: 15 });
  normal.profile = { ...profile, name: 'Normal Fighter' };
  normal.inCombat = true;
  const enemyA = losTestUnit('enemy-a', 1, { x: 0.9, y: 10 });
  enemyA.profile = { ...profile, name: 'Enemy A', weapons: [] };
  enemyA.inCombat = true;
  const enemyB = losTestUnit('enemy-b', 1, { x: 0.9, y: 15 });
  enemyB.profile = { ...profile, name: 'Enemy B', weapons: [] };
  enemyB.inCombat = true;
  battle.units = [charged, normal, enemyA, enemyB];

  assert.deepEqual(playFightActivationUnitIds(battle, 0, rules40K10th), ['charged-1']);
  assert.equal(playFightWeaponOptions(battle, 'normal-1', 0, rules40K10th).length, 0);
  const afterCharged = { ...battle, units: battle.units.map(unit => unit.id === 'charged-1' ? { ...unit, activated: true } : unit) };
  assert.deepEqual(playFightActivationUnitIds(afterCharged, 0, rules40K10th), ['normal-1']);
});

test('play Fight activation treats Fights First ability as fight priority', () => {
  const battle = state('fight');
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const profile = {
    name: 'Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const charged = losTestUnit('charged-first', 0, { x: 0, y: 10 });
  charged.profile = { ...profile, name: 'Charged Fighter' };
  charged.charged = true;
  charged.inCombat = true;
  const fightsFirst = losTestUnit('ability-first', 0, { x: 0, y: 15 });
  fightsFirst.profile = {
    ...profile,
    name: 'Fights First Fighter',
    abilities: [{ name: 'Fights First', description: 'This unit fights first.' }],
  };
  fightsFirst.inCombat = true;
  const normal = losTestUnit('normal-later', 0, { x: 0, y: 20 });
  normal.profile = { ...profile, name: 'Normal Fighter' };
  normal.inCombat = true;
  const enemyA = losTestUnit('enemy-first-a', 1, { x: 0.9, y: 10 });
  enemyA.profile = { ...profile, name: 'Enemy A', weapons: [] };
  enemyA.inCombat = true;
  const enemyB = losTestUnit('enemy-first-b', 1, { x: 0.9, y: 15 });
  enemyB.profile = { ...profile, name: 'Enemy B', weapons: [] };
  enemyB.inCombat = true;
  const enemyC = losTestUnit('enemy-first-c', 1, { x: 0.9, y: 20 });
  enemyC.profile = { ...profile, name: 'Enemy C', weapons: [] };
  enemyC.inCombat = true;
  battle.units = [charged, fightsFirst, normal, enemyA, enemyB, enemyC];

  assert.deepEqual(playFightActivationUnitIds(battle, 0, rules40K10th), ['charged-first', 'ability-first']);
});

test('play Fight pile-in and consolidate move a selected unit once each', () => {
  const battle = state('fight');
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const mover = losTestUnit('mover-1', 0, { x: 0, y: 10 });
  mover.profile = profile;
  mover.charged = true;
  mover.inCombat = true;
  const enemy = losTestUnit('enemy-1', 1, { x: 2.5, y: 10 });
  enemy.profile = { ...profile, name: 'Enemy', weapons: [] };
  enemy.inCombat = true;
  battle.units = [mover, enemy];

  const piled = pileInPlayUnit(battle, 'mover-1', 0, rules40K10th);
  const piledMover = piled.units.find(unit => unit.id === 'mover-1')!;
  assert.equal(piledMover.piledIn, true);
  assert.equal(piledMover.position.x > mover.position.x, true);
  assert.equal(pileInPlayUnit(piled, 'mover-1', 0, rules40K10th), piled);

  const fought = fightPlayUnitWeapon(piled, 'mover-1', 0, 'enemy-1', 'all', rules40K10th);
  const consolidated = consolidatePlayUnit(fought, 'mover-1', 0, rules40K10th);
  const consolidatedMover = consolidated.units.find(unit => unit.id === 'mover-1')!;
  assert.equal(consolidatedMover.consolidated, true);
  assert.equal(consolidatePlayUnit(consolidated, 'mover-1', 0, rules40K10th), consolidated);
});

test('11th Fight phase lets a charged unit pile in before selecting melee attacks', () => {
  const battle = state('fight');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const profile = {
    name: 'Overrun Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const fighter = losTestUnit('fighter-1', 0, { x: 0, y: 10 });
  fighter.profile = profile;
  fighter.charged = true;
  fighter.inCombat = false;
  const target = losTestUnit('target-1', 1, { x: 2.5, y: 10 });
  target.profile = { ...profile, name: 'Fight Target', weapons: [] };
  battle.units = [fighter, target];

  assert.deepEqual(playFightWeaponOptions(battle, fighter.id, 0, rules40K11th), []);

  const piled = pileInPlayUnit(battle, fighter.id, 0, rules40K11th);
  const piledFighter = piled.units.find(unit => unit.id === fighter.id)!;
  assert.equal(piledFighter.piledIn, true);
  assert.equal(piledFighter.inCombat, true);
  assert.deepEqual(playFightWeaponOptions(piled, fighter.id, 0, rules40K11th), [
    { weaponIndex: 0, name: 'Blade', targetIds: [target.id] },
  ]);
});

test('11th Overrun uses the Fight-step engagement snapshot and current eligibility', () => {
  const profile = {
    name: 'Overrun Unit', move: 6, toughness: 4, save: 3, wounds: 2, leadership: 7, oc: 1,
    baseModelCount: 1, keywords: ['Infantry'], factionKeywords: [],
    weapons: [{ name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true }],
    abilities: [],
  };
  const makeBattle = (fighterX: number, targetX: number, charged = false) => {
    const battle = state('fight');
    battle.ruleset = rulesetMetadataForState(rules40K11th);
    battle.fightStepStarted = false;
    const fighter = losTestUnit('overrunner', 0, { x: fighterX, y: 10 });
    fighter.profile = profile;
    fighter.charged = charged;
    const target = losTestUnit('new-foe', 1, { x: targetX, y: 10 });
    target.profile = { ...profile, name: 'New Foe', weapons: [], abilities: [{ name: 'Fights First', description: 'This unit fights first.' }] };
    battle.units = [fighter, target];
    return battle;
  };

  const chargedUnengaged = makeBattle(0, 3.5, true);
  assert.deepEqual(playFightActivationUnitIds(chargedUnengaged, 0, rules40K11th), []);
  const chargedStarted = startPlayFightStep(chargedUnengaged, rules40K11th);
  assert.deepEqual(chargedStarted.engagedUnitIdsAtFightStepStart, []);
  assert.deepEqual(playOverrunFightUnitIds(chargedStarted, 0, rules40K11th), ['overrunner']);
  const selected = selectPlayOverrunFight(chargedStarted, 'overrunner', 0, rules40K11th);
  const piled = pileInPlayUnit(selected, 'overrunner', 0, rules40K11th);
  assert.equal(piled.units[0].overrunPiledIn, true);
  assert.equal(pileInPlayUnit(piled, 'overrunner', 0, rules40K11th), piled);
  assert.deepEqual(playFightActivationUnitIds(piled, 1, rules40K11th), []);

  const originalRandom = Math.random;
  Math.random = () => 0.01;
  try {
    const fought = fightPlayUnitWeapon(piled, 'overrunner', 0, 'new-foe', 0, rules40K11th);
    assert.equal(fought.units[0].activated, true);
    assert.deepEqual(playFightActivationUnitIds(fought, 1, rules40K11th), ['new-foe']);
    assert.equal(playUnitCanConsolidate(fought, 'overrunner', 0, rules40K11th), false);
    const foeFought = fightPlayUnitWeapon(fought, 'new-foe', 1, 'overrunner', -1, rules40K11th);
    assert.equal(foeFought.units[1].activated, true);
    assert.equal(playUnitCanConsolidate(foeFought, 'overrunner', 0, rules40K11th), true);
    const nextTurn = applyGameAction(foeFought, { type: GAME_ACTION_TYPE.StepPhase }, { rules: rules40K11th });
    assert.equal(nextTurn.phase, 'command');
    assert.equal(nextTurn.fightStepStarted, undefined);
    assert.equal(nextTurn.engagedUnitIdsAtFightStepStart, undefined);
    assert.equal(nextTurn.lastFightSelectionSide, undefined);
    assert.equal(nextTurn.units.every(unit => unit.overrunFightSelected === undefined && unit.overrunPiledIn === undefined), true);
  } finally {
    Math.random = originalRandom;
  }

  const newlyEngagedStart = startPlayFightStep(makeBattle(0, 3.5), rules40K11th);
  const newlyEngaged = structuredClone(newlyEngagedStart);
  newlyEngaged.units[1].position.x = 0.9;
  newlyEngaged.units[1].modelPositions[0].x = 0.9;
  newlyEngaged.units[1].activated = true;
  assert.deepEqual(playOverrunFightUnitIds(newlyEngaged, 0, rules40K11th), ['overrunner']);

  const formerlyEngagedStart = startPlayFightStep(makeBattle(0, 0.9), rules40K11th);
  const nowUnengaged = structuredClone(formerlyEngagedStart);
  nowUnengaged.units[1].position.x = 10;
  nowUnengaged.units[1].modelPositions[0].x = 10;
  nowUnengaged.units[1].activated = true;
  assert.deepEqual(playOverrunFightUnitIds(nowUnengaged, 0, rules40K11th), ['overrunner']);

  const neverEligible = startPlayFightStep(makeBattle(0, 10), rules40K11th);
  assert.deepEqual(playOverrunFightUnitIds(neverEligible, 0, rules40K11th), []);
  const alreadyActivated = structuredClone(chargedStarted);
  alreadyActivated.units[0].activated = true;
  assert.deepEqual(playOverrunFightUnitIds(alreadyActivated, 0, rules40K11th), []);
});

test('11th Overrun actions replay and save the named selection and additional pile-in', async () => {
  installStorage();
  const battle = state('fight');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  battle.fightStepStarted = false;
  const fighter = losTestUnit('replay-overrunner', 0, { x: 0, y: 10 });
  fighter.charged = true;
  const target = losTestUnit('replay-target', 1, { x: 3.5, y: 10 });
  battle.units = [fighter, target];
  let timeline = createPracticeTimeline(battle, { id: 'overrun-replay' });
  let current = battle;
  for (const action of [
    { type: GAME_ACTION_TYPE.StartFightStep },
    { type: GAME_ACTION_TYPE.SelectOverrunFight, side: 0 as const, unitId: fighter.id },
    { type: GAME_ACTION_TYPE.PileInUnit, side: 0 as const, unitId: fighter.id },
  ] satisfies GameAction[]) {
    const appended = appendTimelineAction(timeline, current, action, { rules: rules40K11th });
    timeline = appended.timeline;
    current = appended.state;
  }
  const replayed = replayTimeline(timeline, { rules: rules40K11th }, false);
  assert.equal(replayed.fightStepStarted, true);
  assert.equal(replayed.units[0].overrunFightSelected, true);
  assert.equal(replayed.units[0].overrunPiledIn, true);
  assert.deepEqual(replayed.units[0].modelPositions, current.units[0].modelPositions);

  await localPracticeScenarioRepository.saveScenario(scenarioFromTimeline(timeline, { id: 'overrun-save' }));
  const loaded = await localPracticeScenarioRepository.loadScenario('overrun-save');
  const loadedState = currentTimelineState(loaded!.timeline);
  assert.equal(loadedState.fightStepStarted, true);
  assert.equal(loadedState.units[0].overrunFightSelected, true);
  assert.equal(loadedState.units[0].overrunPiledIn, true);
});

test('11th simulation records the Fight-step snapshot before resolving fights and consolidation', () => {
  const battle = state('charge');
  battle.ruleset = rulesetMetadataForState(rules40K11th);
  const fighter = losTestUnit('simulation-fighter', 0, { x: 0, y: 10 });
  fighter.charged = true;
  fighter.profile.weapons = [];
  const target = losTestUnit('simulation-target', 1, { x: 3.5, y: 10 });
  target.profile.weapons = [];
  battle.units = [fighter, target];
  const simulated = simulateNextPhase(battle, rules40K11th);
  assert.equal(simulated.phase, 'fight');
  assert.equal(simulated.fightStepStarted, true);
  assert.deepEqual(new Set(simulated.engagedUnitIdsAtFightStepStart), new Set([fighter.id, target.id]));
  assert.deepEqual(simulated.units.map(unit => unit.activated), [true, true]);
  assert.deepEqual(simulated.units.map(unit => unit.consolidated), [true, true]);
});

test('play Movement can embark a nearby unit into a transport', () => {
  const battle = state('movement');
  const infantryProfile = {
    name: 'Infantry',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [{ name: 'Rifle', range: 24, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false }],
    abilities: [],
  };
  const transportProfile = {
    ...infantryProfile,
    name: 'Transport',
    baseModelCount: 1,
    toughness: 9,
    wounds: 10,
    oc: 0,
    transportCapacity: 4,
    keywords: ['Transport'],
    weapons: [],
  };
  const enemyProfile = { ...infantryProfile, name: 'Enemy', baseModelCount: 1, wounds: 99 };
  const infantry: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile: infantryProfile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const transport: BattleUnit = {
    ...infantry,
    id: 'transport-1',
    profile: transportProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 12, y: 10 }],
  };
  const enemy: BattleUnit = {
    ...infantry,
    id: 'enemy-1',
    side: 1,
    profile: enemyProfile,
    remainingModels: 1,
    woundsOnLeadModel: 99,
    position: { x: 20, y: 10 },
    modelPositions: [{ x: 20, y: 10 }],
  };
  battle.units = [infantry, transport, enemy];

  assert.equal(playUnitCanEmbark(battle, 'unit-1', 0, 'transport-1'), true);
  const embarked = embarkPlayUnit(battle, 'unit-1', 0, 'transport-1');
  const passenger = embarked.units.find(unit => unit.id === 'unit-1')!;
  assert.equal(passenger.embarkedInUnitId, 'transport-1');
  assert.equal(passenger.movementComplete, true);
  assert.equal(transportCapacityRemaining(embarked, 'transport-1'), 2);
  assert.equal(playTransportPassengers(embarked, 'transport-1').map(unit => unit.id).join(','), 'unit-1');

  const shooting = simulateNextPhase({ ...embarked, movementStep: 'reinforcements' }, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Infantry shoots')), false);
});

test('play Movement disembarks a staged transport passenger before the transport moves', () => {
  const battle = state('movement');
  const passengerProfile = {
    name: 'Passengers',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
    deployment: { mode: 'transport' as const, transportUnitId: 'transport-roster', transportName: 'Transport' },
  };
  const transportProfile = {
    ...passengerProfile,
    rosterId: 'transport-roster',
    name: 'Transport',
    baseModelCount: 1,
    toughness: 9,
    wounds: 10,
    oc: 0,
    transportCapacity: 4,
    keywords: ['Transport'],
    deployment: undefined,
  };
  const transport: BattleUnit = {
    id: 'transport-1',
    side: 0,
    profile: transportProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 20, y: 20 },
    modelPositions: [{ x: 20, y: 20 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.armies[0].army = { ...battle.armies[0].army, units: [transportProfile, passengerProfile] };
  battle.units = [transport];

  assert.equal(playUnitCanDisembark(battle, 0, 'transport-1', undefined, 1), true);
  const disembarked = disembarkPlayUnit(battle, 0, 'transport-1', undefined, 1);
  const passenger = disembarked.units.find(unit => unit.profile.name === 'Passengers')!;
  assert.ok(passenger);
  assert.equal(passenger.embarkedInUnitId, undefined);
  assert.equal(passenger.movementComplete, false);
  assert.deepEqual(passenger.movementAllowanceRemainingByModel, [6, 6]);
  assert.match(disembarked.log.at(-1)?.message ?? '', /disembarks from Transport/);

  const movedTransport = movePlayModels(battle, 'transport-1', 0, [0], 1, 0);
  assert.equal(playUnitCanDisembark(movedTransport, 0, 'transport-1', undefined, 1), false);
});

test('destroyed transports force embarked passengers to emergency disembark', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [{ name: 'Lascannon', range: 48, attacks: '6', skill: 2, strength: 20, ap: -10, damage: '20', keywords: [], isMelee: false }],
    abilities: [],
  };
  const passengerProfile = {
    ...shooterProfile,
    name: 'Passengers',
    baseModelCount: 2,
    weapons: [],
  };
  const transportProfile = {
    ...shooterProfile,
    name: 'Transport',
    toughness: 9,
    wounds: 10,
    oc: 0,
    transportCapacity: 4,
    keywords: ['Transport'],
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 20 },
    modelPositions: [{ x: 10, y: 20 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const transport: BattleUnit = {
    ...shooter,
    id: 'transport-1',
    side: 1,
    profile: transportProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 20, y: 20 },
    modelPositions: [{ x: 20, y: 20 }],
  };
  const passenger: BattleUnit = {
    ...shooter,
    id: 'passenger-1',
    side: 1,
    profile: passengerProfile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 20, y: 20 },
    modelPositions: [{ x: 20, y: 20 }, { x: 20, y: 20 }],
    embarkedInUnitId: 'transport-1',
  };
  battle.units = [shooter, transport, passenger];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const destroyedTransport = shooting.units.find(unit => unit.id === 'transport-1')!;
    const disembarkedPassenger = shooting.units.find(unit => unit.id === 'passenger-1')!;
    assert.equal(destroyedTransport.destroyed, true);
    assert.equal(disembarkedPassenger.embarkedInUnitId, undefined);
    assert.equal(disembarkedPassenger.battleshocked, true);
    assert.equal(disembarkedPassenger.emergencyDisembarkedThisTurn, true);
    assert.equal(disembarkedPassenger.destroyed, false);
    assert.equal(disembarkedPassenger.remainingModels, 2);
    assert.equal(shooting.log.some(entry => entry.message.includes('emergency disembarks from Transport')), true);

    const charge = simulateNextPhase({ ...shooting, activeArmy: 1 }, rules40K10th);
    const afterChargePassenger = charge.units.find(unit => unit.id === 'passenger-1')!;
    assert.equal(afterChargePassenger.charged, false);
    assert.equal(charge.log.some(entry => entry.message.includes('Passengers charges')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('destroyed transports emergency disembark staged passengers assigned to that transport', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const shooterProfile = {
    name: 'Shooter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [{ name: 'Lascannon', range: 48, attacks: '6', skill: 2, strength: 20, ap: -10, damage: '20', keywords: [], isMelee: false }],
    abilities: [],
  };
  const passengerProfile = {
    ...shooterProfile,
    name: 'Staged Passengers',
    baseModelCount: 2,
    weapons: [],
    deployment: { mode: 'transport' as const, transportUnitId: 'transport-roster', transportName: 'Transport' },
  };
  const transportProfile = {
    ...shooterProfile,
    rosterId: 'transport-roster',
    name: 'Transport',
    toughness: 9,
    wounds: 10,
    oc: 0,
    transportCapacity: 4,
    keywords: ['Transport'],
    weapons: [],
  };
  const shooter: BattleUnit = {
    id: 'shooter-1',
    side: 0,
    profile: shooterProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 20 },
    modelPositions: [{ x: 10, y: 20 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const transport: BattleUnit = {
    ...shooter,
    id: 'transport-1',
    side: 1,
    profile: transportProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 20, y: 20 },
    modelPositions: [{ x: 20, y: 20 }],
  };
  battle.armies[1].army = { ...battle.armies[1].army, units: [transportProfile, passengerProfile] };
  battle.units = [shooter, transport];

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const shooting = simulateNextPhase(battle, rules40K10th);
    const passenger = shooting.units.find(unit => unit.profile.name === 'Staged Passengers')!;
    assert.ok(passenger);
    assert.equal(passenger.embarkedInUnitId, undefined);
    assert.equal(passenger.destroyed, false);
    assert.equal(passenger.remainingModels, 2);
    assert.equal(shooting.log.some(entry => entry.message.includes('Staged Passengers emergency disembarks')), true);
  } finally {
    Math.random = originalRandom;
  }
});

test('emergency disembark Battle-shock clears at that army next play Command phase', () => {
  const battle = state('fight');
  battle.activeArmy = 0;
  const profile = {
    name: 'Emergency Passengers',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'passenger-1',
    side: 1,
    profile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 20, y: 20 },
    modelPositions: [{ x: 20, y: 20 }, { x: 21, y: 20 }],
    facingDeg: 180,
    charged: false,
    inCombat: false,
    battleshocked: true,
    activated: false,
    destroyed: false,
    emergencyDisembarkedThisTurn: true,
  };
  battle.units = [unit];

  const command = applyGameAction(battle, { type: 'play.stepPhase' }, { rules: rules40K10th });
  const reset = command.units.find(candidate => candidate.id === 'passenger-1')!;
  assert.equal(command.activeArmy, 1);
  assert.equal(command.phase, 'command');
  assert.equal(reset.battleshocked, false);
  assert.equal(reset.emergencyDisembarkedThisTurn, undefined);
});

test('play Advance is not available after a unit has already moved', () => {
  const battle = state('movement');
  const profile = {
    name: 'Moved Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 1, 0);

  assert.equal(playUnitCanAdvance(moved, 'unit-1', 0), false);
  assert.equal(advancePlayUnit(moved, 'unit-1', 0), moved);
});

test('play Movement tracks remaining allowance per model in a unit', () => {
  const battle = state('movement');
  const profile = {
    name: 'Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }, { x: 10, y: 14 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const first = movePlayModels(battle, 'unit-1', 0, [0], 6, 0);
  const firstUnit = first.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(firstUnit.modelPositions[0].x, 16);
  assert.equal(firstUnit.modelPositions[1].x, 10);
  assert.deepEqual(firstUnit.movementAllowanceRemainingByModel, [0, 6]);
  assert.equal(firstUnit.movementAllowanceRemaining, 6);

  const second = movePlayModels(first, 'unit-1', 0, [1], 6, 0);
  const secondUnit = second.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(secondUnit.modelPositions[0].x, 16);
  assert.equal(secondUnit.modelPositions[1].x, 16);
  assert.deepEqual(secondUnit.movementAllowanceRemainingByModel, [0, 0]);
  assert.equal(secondUnit.movementAllowanceRemaining, 0);
});

test('play Movement keeps individual models editable until the unit is locked', () => {
  const battle = state('movement');
  const profile = {
    name: 'Editable Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 12 },
    modelPositions: [{ x: 10, y: 10 }, { x: 10, y: 14 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const firstMove = movePlayModels(battle, 'unit-1', 0, [0], 3, 0);
  const secondMove = movePlayModels(firstMove, 'unit-1', 0, [1], 2, 0);
  const undoFirstModel = movePlayModels(secondMove, 'unit-1', 0, [0], -3, 0);
  const redoFirstModel = movePlayModels(undoFirstModel, 'unit-1', 0, [0], 0, 6);
  const movedUnit = redoFirstModel.units.find(candidate => candidate.id === 'unit-1')!;

  assert.deepEqual(movedUnit.modelPositions, [{ x: 10, y: 16 }, { x: 12, y: 14 }]);
  assert.deepEqual(movedUnit.movementAllowanceRemainingByModel, [0, 4]);
  assert.equal(movedUnit.movementComplete, undefined);
});

test('play Movement tracks vertical movement allowance per model', () => {
  const battle = state('movement');
  const profile = {
    name: 'Climber',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const up = movePlayModelsVertically(battle, 'unit-1', 0, [0], 3);
  const upUnit = up.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(upUnit.modelPositions[0].z, 3);
  assert.deepEqual(upUnit.movementAllowanceRemainingByModel, [3]);

  const across = movePlayModels(up, 'unit-1', 0, [0], 3, 0);
  const acrossUnit = across.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(acrossUnit.modelPositions[0].x, 13);
  assert.deepEqual(acrossUnit.movementAllowanceRemainingByModel, [0]);

  const tooHigh = movePlayModelsVertically(across, 'unit-1', 0, [0], 1);
  assert.equal(tooHigh, across);

  const replayed = applyGameAction(battle, {
    type: 'play.moveModelsVertically',
    parts: [{ unitId: 'unit-1', side: 0, modelIndices: [0] }],
    dz: 2,
  }, { rules: rules40K10th });
  assert.equal(replayed.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].z, 2);
});

test('vertical coherency allows 5 inches but not more', () => {
  const battle = state('movement');
  const profile = {
    name: 'Stacked Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 2,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10, z: 2.5 },
    modelPositions: [{ x: 10, y: 10, z: 0 }, { x: 10, y: 10, z: 5 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];
  assert.equal(playPhaseCoherencyIssues(battle).length, 0);

  const separated = { ...battle, units: [{ ...unit, modelPositions: [{ x: 10, y: 10, z: 0 }, { x: 10, y: 10, z: 6 }] }] };
  assert.match(playPhaseCoherencyIssues(separated).join(' '), /out of coherency/);
});

test('vertical engagement range requires horizontal contact and 5 inch vertical reach', () => {
  const battle = state('charge');
  const meleeWeapon = { name: 'Blade', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const profile = {
    name: 'Fighter',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 99,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const attacker: BattleUnit = {
    id: 'attacker-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 99,
    position: { x: 10, y: 10, z: 0 },
    modelPositions: [{ x: 10, y: 10, z: 0 }],
    facingDeg: 0,
    charged: true,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const target: BattleUnit = {
    ...attacker,
    id: 'target-1',
    side: 1,
    profile: { ...profile, name: 'Target' },
    position: { x: 10.5, y: 10, z: 6 },
    modelPositions: [{ x: 10.5, y: 10, z: 6 }],
    charged: false,
  };
  battle.units = [attacker, target];

  const tooHigh = simulateNextPhase(battle, rules40K10th);
  assert.equal(tooHigh.log.some(entry => entry.message.includes('Fighter fights Target')), false);

  const reachable = { ...battle, units: [attacker, { ...target, position: { x: 10.5, y: 10, z: 5 }, modelPositions: [{ x: 10.5, y: 10, z: 5 }] }] };
  const fight = simulateNextPhase(reachable, rules40K10th);
  assert.equal(fight.log.some(entry => entry.message.includes('Fighter fights Target')), true);
});

test('base edge range includes vertical separation', () => {
  const battle = state('movement');
  const profile = {
    name: 'Ranger',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const low: BattleUnit = {
    id: 'low-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10, z: 0 },
    modelPositions: [{ x: 10, y: 10, z: 0 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const high: BattleUnit = {
    ...low,
    id: 'high-1',
    side: 1,
    position: { x: 10, y: 10, z: 6 },
    modelPositions: [{ x: 10, y: 10, z: 6 }],
  };
  battle.units = [low, high];

  assert.equal(battleUnitsBaseEdgeDistance(low, high), 6);
});

test('play Movement charges non-round pivot distance against movement allowance', () => {
  const battle = state('movement');
  const profile = {
    name: 'Oval Bike',
    move: 2,
    toughness: 5,
    save: 3,
    wounds: 3,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    modelBases: [{ shape: 'oval' as const, widthMm: 50, lengthMm: 100 }],
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 3,
    position: { x: 20, y: 20 },
    modelPositions: [{ x: 20, y: 20 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const rejected = rotatePlayModels(battle, 'unit-1', 0, [0], 90);
  assert.equal(rejected.units.find(candidate => candidate.id === 'unit-1')?.facingDeg, 0);

  const faster = { ...battle, units: [{ ...unit, profile: { ...profile, move: 6 } }] };
  const rotated = rotatePlayModels(faster, 'unit-1', 0, [0], 90);
  const rotatedUnit = rotated.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(rotatedUnit.facingDeg, 90);
  assert.ok((rotatedUnit.movementAllowanceRemainingByModel?.[0] ?? 6) < 6);
});

test('play Movement cannot be completed after freely dragging through enemy models', () => {
  const battle = state('movement');
  const profile = {
    name: 'Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Enemy' },
    position: { x: 13, y: 10 },
    modelPositions: [{ x: 13, y: 10 }],
  };
  battle.units = [unit, enemy];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 6, 0, false);
  assert.equal(moved.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 16);
  assert.match(playPhaseCoherencyIssues(moved).join(' '), /moved across an enemy model/);

  const completed = completePlayUnitMovement(moved, 'unit-1', 0);
  assert.equal(completed.units.find(candidate => candidate.id === 'unit-1')?.movementComplete, undefined);
});

test('play Movement applies Aircraft movement restrictions', () => {
  const battle = state('movement');
  const aircraftProfile = {
    name: 'Interceptor',
    move: 20,
    toughness: 9,
    save: 3,
    wounds: 10,
    leadership: 7,
    oc: 0,
    baseModelCount: 1,
    modelBases: [{ shape: 'hull' as const, widthMm: 120, lengthMm: 92, footprint: 'rectangle' as const }],
    keywords: ['Aircraft', 'Vehicle', 'Fly'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const infantryProfile = {
    ...aircraftProfile,
    name: 'Infantry',
    move: 6,
    wounds: 1,
    oc: 2,
    modelBases: undefined,
    keywords: ['Infantry'],
  };
  const aircraft: BattleUnit = {
    id: 'aircraft-1',
    side: 0,
    profile: aircraftProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...aircraft,
    id: 'enemy-1',
    side: 1,
    profile: infantryProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
  };
  battle.units = [aircraft, enemy];

  assert.equal(playUnitCanAdvance(battle, 'aircraft-1', 0), false);
  assert.equal(playUnitCanFallBack(battle, 'aircraft-1', 0), false);

  const sideways = movePlayModels(battle, 'aircraft-1', 0, [0], 0, 20);
  assert.equal(sideways, battle);

  const shortMove = movePlayModels(battle, 'aircraft-1', 0, [0], 10, 0);
  assert.match(playPhaseCoherencyIssues(shortMove).join(' '), /Aircraft and must make a Normal move of at least 20/);
  assert.equal(completePlayUnitMovement(shortMove, 'aircraft-1', 0), shortMove);

  const moved = movePlayModels(battle, 'aircraft-1', 0, [0], 21, 0);
  const movedAircraft = moved.units.find(candidate => candidate.id === 'aircraft-1')!;
  assert.equal(movedAircraft.modelPositions[0].x, 31);
  assert.equal(playPhaseCoherencyIssues(moved).length, 0);

  const pivoted = rotatePlayModels(moved, 'aircraft-1', 0, [0], 90);
  assert.equal(pivoted.units.find(candidate => candidate.id === 'aircraft-1')?.facingDeg, 90);
  const overPivot = rotatePlayModels(pivoted, 'aircraft-1', 0, [0], 5);
  assert.equal(overPivot, pivoted);
});

test('play Movement sends Aircraft that cross the battlefield edge into Strategic Reserves', () => {
  const battle = state('movement');
  const aircraftProfile = {
    name: 'Edge Flyer',
    move: 20,
    toughness: 9,
    save: 3,
    wounds: 10,
    leadership: 7,
    oc: 0,
    baseModelCount: 1,
    keywords: ['Aircraft', 'Vehicle', 'Fly'],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const aircraft: BattleUnit = {
    id: 'aircraft-1',
    side: 0,
    profile: aircraftProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 50, y: 10 },
    modelPositions: [{ x: 50, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [aircraft];

  const moved = movePlayModels(battle, 'aircraft-1', 0, [0], 20, 0);
  const reserve = moved.units.find(candidate => candidate.id === 'aircraft-1')!;
  assert.equal(reserve.inStrategicReserves, true);
  assert.deepEqual(reserve.modelPositions, []);
  assert.match(moved.log.at(-1)?.message ?? '', /Strategic Reserves/);
});

test('play Reinforcements can return Aircraft from Strategic Reserves at a battlefield edge', () => {
  const battle = state('movement');
  battle.movementStep = 'reinforcements';
  const aircraftProfile = {
    name: 'Edge Flyer',
    move: 20,
    toughness: 9,
    save: 3,
    wounds: 10,
    leadership: 7,
    oc: 0,
    baseModelCount: 1,
    keywords: ['Aircraft', 'Vehicle', 'Fly'],
    factionKeywords: [],
    weapons: [{ name: 'Claws', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true }],
    abilities: [],
  };
  const enemyProfile = {
    ...aircraftProfile,
    name: 'Enemy Infantry',
    move: 6,
    toughness: 4,
    wounds: 1,
    oc: 2,
    keywords: ['Infantry'],
  };
  const aircraft: BattleUnit = {
    id: 'aircraft-1',
    side: 0,
    profile: aircraftProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 0, y: 0 },
    modelPositions: [],
    modelRotations: [],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
    inStrategicReserves: true,
    movementComplete: true,
  };
  const enemy: BattleUnit = {
    ...aircraft,
    id: 'enemy-1',
    side: 1,
    profile: enemyProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 20, y: 10 },
    modelPositions: [{ x: 20, y: 10 }],
    modelRotations: [180],
    inStrategicReserves: false,
    movementComplete: undefined,
  };
  battle.units = [aircraft, enemy];

  const middle = placePlayStrategicReserveUnit(battle, 0, 'aircraft-1', { x: 20, y: 20 });
  assert.equal(middle, battle);

  const returned = placePlayStrategicReserveUnit(battle, 0, 'aircraft-1', { x: 3, y: 10 });
  const returnedAircraft = returned.units.find(unit => unit.id === 'aircraft-1')!;
  assert.equal(returned.units.filter(unit => unit.id === 'aircraft-1').length, 1);
  assert.equal(returnedAircraft.inStrategicReserves, false);
  assert.equal(returnedAircraft.arrivedFromReinforcements, true);
  assert.equal(returnedAircraft.movementComplete, true);
  assert.deepEqual(returnedAircraft.modelPositions, [{ x: 3, y: 10 }]);
  assert.match(returned.log.at(-1)?.message ?? '', /returns Edge Flyer from Strategic Reserves/);

  const actionReturned = applyGameAction(battle, {
    type: 'play.placeStrategicReserveUnit',
    side: 0,
    unitId: 'aircraft-1',
    position: { x: 3, y: 10 },
  }, { rules: rules40K10th });
  assert.equal(actionReturned.units.find(unit => unit.id === 'aircraft-1')?.inStrategicReserves, false);

  const shooting = { ...returned, phase: 'shooting' as Phase, movementStep: undefined };
  const charge = simulateNextPhase(shooting, rules40K10th);
  assert.equal(charge.phase, 'charge');
  assert.equal(charge.log.some(entry => entry.message.includes('Edge Flyer charges Enemy Infantry')), false);
});

test('Aircraft charge restrictions require Fly to charge Aircraft', () => {
  const battle = state('shooting');
  const meleeWeapon = { name: 'Claws', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const infantryProfile = {
    name: 'Infantry',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const flyProfile = { ...infantryProfile, name: 'Jump Infantry', keywords: ['Infantry', 'Fly'] };
  const aircraftProfile = {
    ...infantryProfile,
    name: 'Aircraft',
    toughness: 9,
    wounds: 10,
    oc: 0,
    keywords: ['Aircraft', 'Vehicle', 'Fly'],
  };
  const attacker: BattleUnit = {
    id: 'attacker-1',
    side: 0,
    profile: infantryProfile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const aircraft: BattleUnit = {
    ...attacker,
    id: 'aircraft-1',
    side: 1,
    profile: aircraftProfile,
    remainingModels: 1,
    woundsOnLeadModel: 10,
    position: { x: 11.1, y: 10 },
    modelPositions: [{ x: 11.1, y: 10 }],
  };
  battle.units = [attacker, aircraft];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const blocked = simulateNextPhase(battle, rules40K10th);
    assert.equal(blocked.phase, 'charge');
    assert.equal(blocked.units.find(candidate => candidate.id === 'attacker-1')?.charged, false);
    assert.equal(blocked.log.some(entry => entry.message.includes('Infantry charges Aircraft')), false);

    const flyBattle = { ...battle, units: [{ ...attacker, profile: flyProfile }, aircraft] };
    const charged = simulateNextPhase(flyBattle, rules40K10th);
    assert.equal(charged.log.some(entry => entry.message.includes('Jump Infantry charges Aircraft')), true);

    const aircraftBattle = { ...battle, units: [{ ...attacker, profile: aircraftProfile }, { ...aircraft, profile: infantryProfile }] };
    const aircraftCharge = simulateNextPhase(aircraftBattle, rules40K10th);
    assert.equal(aircraftCharge.units.find(candidate => candidate.id === 'attacker-1')?.charged, false);
    assert.equal(aircraftCharge.log.some(entry => entry.message.includes('Aircraft charges Infantry')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('Aircraft fight restrictions only allow melee with Fly units', () => {
  const battle = state('charge');
  const meleeWeapon = { name: 'Claws', range: 0, attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: true };
  const infantryProfile = {
    name: 'Infantry',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 99,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: ['Infantry'],
    factionKeywords: [],
    weapons: [meleeWeapon],
    abilities: [],
  };
  const flyProfile = { ...infantryProfile, name: 'Jump Infantry', keywords: ['Infantry', 'Fly'] };
  const aircraftProfile = {
    ...infantryProfile,
    name: 'Aircraft',
    toughness: 9,
    oc: 0,
    keywords: ['Aircraft', 'Vehicle', 'Fly'],
  };
  const attacker: BattleUnit = {
    id: 'attacker-1',
    side: 0,
    profile: infantryProfile,
    remainingModels: 1,
    woundsOnLeadModel: 99,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: true,
    inCombat: true,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const aircraft: BattleUnit = {
    ...attacker,
    id: 'aircraft-1',
    side: 1,
    profile: aircraftProfile,
    position: { x: 10.5, y: 10 },
    modelPositions: [{ x: 10.5, y: 10 }],
    charged: false,
  };
  battle.units = [attacker, aircraft];

  const originalRandom = Math.random;
  Math.random = () => 0.99;
  try {
    const blocked = simulateNextPhase(battle, rules40K10th);
    assert.equal(blocked.phase, 'fight');
    assert.equal(blocked.log.some(entry => entry.message.includes('Infantry fights Aircraft')), false);
    assert.equal(blocked.log.some(entry => entry.message.includes('Aircraft fights Infantry')), false);

    const flyBattle = { ...battle, units: [{ ...attacker, profile: flyProfile }, aircraft] };
    const flyFight = simulateNextPhase(flyBattle, rules40K10th);
    assert.equal(flyFight.log.some(entry => entry.message.includes('Jump Infantry fights Aircraft')), true);
    assert.equal(flyFight.log.some(entry => entry.message.includes('Aircraft fights Jump Infantry')), true);

    const aircraftAttackerBattle = {
      ...battle,
      units: [
        { ...attacker, profile: aircraftProfile },
        { ...aircraft, profile: infantryProfile },
      ],
    };
    const aircraftBlocked = simulateNextPhase(aircraftAttackerBattle, rules40K10th);
    assert.equal(aircraftBlocked.log.some(entry => entry.message.includes('Aircraft fights Infantry')), false);
  } finally {
    Math.random = originalRandom;
  }
});

test('play Movement reports coherency issues without clamping model movement', () => {
  const battle = state('movement');
  const profile = {
    name: 'Coherency Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 3,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 3,
    woundsOnLeadModel: 1,
    position: { x: 12, y: 10 },
    modelPositions: [{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 14, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const moved = movePlayModels(battle, 'unit-1', 0, [0], -6, 0);
  const movedUnit = moved.units.find(candidate => candidate.id === 'unit-1')!;

  assert.equal(movedUnit.modelPositions[0].x, 4);
  assert.deepEqual([...battleModelIdsWithCoherencyIssues(moved)].sort(), ['unit-1:0']);
  assert.deepEqual(playPhaseCoherencyIssues(moved), ['Coherency Squad (3 models) is out of coherency.']);
});

test('play step phase is blocked until movement coherency is restored', () => {
  const battle = state('movement');
  const profile = {
    name: 'Blocked Squad',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 3,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 3,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 14, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const blocked = applyGameAction(battle, { type: 'play.stepPhase' }, { rules: rules40K10th });
  assert.equal(blocked.phase, 'movement');

  const restored = removePlayModels(battle, 'unit-1', 0, [0]);
  assert.deepEqual(playPhaseCoherencyIssues(restored), []);
  const advanced = applyGameAction(restored, { type: 'play.stepPhase' }, { rules: rules40K10th });
  assert.equal(advanced.phase, 'movement');
  assert.equal(advanced.movementStep, 'reinforcements');
});

test('play Advance drags cannot exceed advance allowance', () => {
  const battle = state('movement');
  const profile = {
    name: 'Advance Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const advanced = advancePlayUnit(battle, 'unit-1', 0);
  const allowance = advanced.units.find(candidate => candidate.id === 'unit-1')!.movementAllowanceRemaining!;
  const moved = movePlayModels(advanced, 'unit-1', 0, [0], 20, 0);
  const movedUnit = moved.units.find(candidate => candidate.id === 'unit-1')!;

  assert.equal(movedUnit.modelPositions[0].x, 10 + allowance);
  assert.equal(movedUnit.movementAction, 'advanced');
  assert.equal(movedUnit.movementAllowanceRemaining, 0);
});

test('play Advance movement cannot end within enemy Engagement Range', () => {
  const battle = state('movement');
  const profile = {
    name: 'Advance Mover',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    movementOverrides: { advanceRoll: 'auto6' as const },
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  const enemy: BattleUnit = {
    ...unit,
    id: 'enemy-1',
    side: 1,
    profile: { ...profile, name: 'Enemy' },
    position: { x: 20.5, y: 10 },
    modelPositions: [{ x: 20.5, y: 10 }],
  };
  battle.units = [unit, enemy];

  const advanced = advancePlayUnit(battle, 'unit-1', 0);
  const legal = movePlayModels(advanced, 'unit-1', 0, [0], 7, 0);
  assert.equal(legal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 17);

  const illegal = movePlayModels(advanced, 'unit-1', 0, [0], 9, 0);
  const illegalUnit = illegal.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(illegalUnit.modelPositions[0].x, 10);
  assert.equal(illegalUnit.movementAction, 'advanced');
  assert.equal(illegalUnit.movementAllowanceRemaining, 12);
});

test('movement overrides can increase move and auto 6 an Advance', () => {
  const battle = state('movement');
  const profile = {
    name: 'Fast Unit',
    move: 6,
    toughness: 4,
    save: 3,
    wounds: 1,
    leadership: 7,
    oc: 2,
    baseModelCount: 1,
    movementOverrides: {
      moveModifier: 2,
      advanceRoll: 'auto6',
      advanceModifier: 1,
    },
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
  };
  const unit: BattleUnit = {
    id: 'unit-1',
    side: 0,
    profile,
    remainingModels: 1,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
  battle.units = [unit];

  const normal = movePlayModels(battle, 'unit-1', 0, [0], 20, 0);
  assert.equal(normal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 18);

  const advanceBattle = state('movement');
  advanceBattle.units = [unit];
  const advanced = advancePlayUnit(advanceBattle, 'unit-1', 0);
  const advancedUnit = advanced.units.find(candidate => candidate.id === 'unit-1')!;
  assert.equal(advancedUnit.movementAllowanceRemaining, 15);
  assert.deepEqual(advancedUnit.movementAllowanceRemainingByModel, [15]);
  assert.match(advanced.log.at(-1)?.message ?? '', /auto 6/);
});
