import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, BattleUnit, Phase } from '../src/types/battle';
import type { ImportedArmy } from '../src/types/army';
import { rules40K10th, rulesetMetadataForState } from '../src/engine/rulesEngine';
import { advancePlayUnit, battleModelIdsWithCoherencyIssues, completePlayUnitMovement, disembarkPlayUnit, embarkPlayUnit, fallBackPlayUnit, markRemainingStationaryUnits, placePlayReinforcement, playPhaseCoherencyIssues, playTransportPassengers, playUnitCanAdvance, playUnitCanDisembark, playUnitCanEmbark, playUnitCanFallBack, movePlayModels, removePlayModels, simulateNextPhase, transportCapacityRemaining } from '../src/engine/simulator';
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
    position: { x: 9.1, y: 7.1 },
    modelPositions: [{ x: 9.1, y: 7.1 }],
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

  const legal = movePlayModels(battle, 'unit-1', 0, [0], 5, 0);
  assert.equal(legal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 15);

  const illegal = movePlayModels(battle, 'unit-1', 0, [0], 6, 0);
  assert.equal(illegal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 10);
  assert.equal(illegal.units.find(candidate => candidate.id === 'unit-1')?.movementAction, undefined);
});

test('play Movement cannot move through enemy models', () => {
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

  const moved = movePlayModels(battle, 'unit-1', 0, [0], 6, 0);
  const movedUnit = moved.units.find(candidate => candidate.id === 'unit-1')!;

  assert.ok(movedUnit.modelPositions[0].x < 13 - 0.9);
  assert.equal(movedUnit.movementAction, 'normalMove');
});

test('play Movement can move over friendly models but cannot end on them', () => {
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

  const overFriendly = movePlayModels(battle, 'unit-1', 0, [0], 4, 0);
  assert.equal(overFriendly.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 14);

  const ontoFriendly = movePlayModels(battle, 'unit-1', 0, [0], 2, 0);
  assert.ok((ontoFriendly.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x ?? 0) < 12);
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
  const legal = movePlayModels(advanced, 'unit-1', 0, [0], 9, 0);
  assert.equal(legal.units.find(candidate => candidate.id === 'unit-1')?.modelPositions[0].x, 19);

  const illegal = movePlayModels(advanced, 'unit-1', 0, [0], 10, 0);
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
