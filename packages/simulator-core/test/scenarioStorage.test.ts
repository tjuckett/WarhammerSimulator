import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, BattleUnit, Phase, Terrain } from '../src/types/battle';
import type { ImportedArmy } from '../src/types/army';
import { rules40K10th, rulesetMetadataForState } from '../src/engine/rulesEngine';
import { advancePlayUnit, allocatePlayDamageToModel, battleModelIdsWithCoherencyIssues, battleUnitsBaseEdgeDistance, completePlayUnitMovement, disembarkPlayUnit, embarkPlayUnit, fallBackPlayUnit, markRemainingStationaryUnits, placePlayReinforcement, placePlayStrategicReserveUnit, playPhaseCoherencyIssues, playShootingWeaponOptions, playTransportPassengers, playUnitCanAdvance, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, movePlayModels, movePlayModelsVertically, removePlayCasualtyModels, removePlayModels, rotatePlayModels, shootPlayUnitWeapon, simulateNextPhase, targetHasCoverFrom, transportCapacityRemaining } from '../src/engine/simulator';
import { localPracticeScenarioRepository } from '../src/practice/scenarioStorage';
import { scenarioFromTimeline } from '../src/practice/scenarios';
import {
  appendResolvedTimelineAction,
  createPracticeTimeline,
  currentTimelineState,
  type PracticeTimeline,
} from '../src/practice/timeline';
import { applyGameAction } from '../src/practice/actions';
import { objectiveControlValue, unitCanBeAffectedByStratagem } from '../src/engine/battleshock';
import { hasLOSEdgeToEdge } from '../src/engine/terrainGeometry';

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

function losTestUnit(id: string, side: 0 | 1, position: { x: number; y: number }, save = 4): BattleUnit {
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
    assert.deepEqual(shotTarget.pendingDamageAllocations, [{ damage: 1, noCarryOver: true, source: 'Bolt Rifle' }]);
    const assigned = allocatePlayDamageToModel(shot, 'target-1', 1, 0);
    const assignedTarget = assigned.units.find(unit => unit.id === 'target-1')!;
    assert.equal(assignedTarget.woundedModelIndex, 0);
    assert.equal(assignedTarget.woundsOnLeadModel, 2);
    assert.equal(shot.log.some(entry => entry.message.includes('Rifle Team shoots Target Unit')), true);
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
    assert.deepEqual(pendingTarget.pendingDamageAllocations, [{ damage: 1, noCarryOver: true, source: 'Bolt Rifle' }]);
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
