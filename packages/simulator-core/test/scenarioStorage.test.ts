import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, BattleUnit, Phase } from '../src/types/battle';
import type { ImportedArmy } from '../src/types/army';
import { rules40K10th, rulesetMetadataForState } from '../src/engine/rulesEngine';
import { advanceManualUnit, fallBackManualUnit, manualUnitCanAdvance, manualUnitCanFallBack, simulateNextPhase } from '../src/engine/simulator';
import { localPracticeScenarioRepository } from '../src/practice/scenarioStorage';
import { scenarioFromTimeline } from '../src/practice/scenarios';
import {
  appendResolvedTimelineAction,
  createPracticeTimeline,
  currentTimelineState,
  type PracticeTimeline,
} from '../src/practice/timeline';
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
  return appendResolvedTimelineAction(timeline, { type: 'manual.stepPhase' }, {
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
    checkpointKind: 'manual',
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

test('manual Fall Back moves an engaged active unit out of Engagement Range', () => {
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

  assert.equal(manualUnitCanFallBack(battle, 'unit-1', 0), true);

  const next = fallBackManualUnit(battle, 'unit-1', 0);
  const moved = next.units.find(candidate => candidate.id === 'unit-1')!;
  const foe = next.units.find(candidate => candidate.id === 'enemy-1')!;

  assert.equal(moved.inCombat, false);
  assert.equal(moved.fellBack, true);
  assert.equal(moved.movementAction, 'fellBack');
  assert.ok(moved.position.x < unit.position.x);
  assert.ok(Math.hypot(moved.position.x - foe.position.x, moved.position.y - foe.position.y) > rules40K10th.engagementRange());
  assert.match(next.log.at(-1)?.message ?? '', /Falls Back/);
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

  const shooting = simulateNextPhase(battle, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Shooter shoots')), false);

  const charge = simulateNextPhase(shooting, rules40K10th);
  assert.equal(charge.phase, 'charge');
  assert.equal(charge.units.find(candidate => candidate.id === 'unit-1')?.charged, false);
  assert.equal(charge.log.some(entry => entry.message.includes('Shooter charges')), false);
});

test('manual Advance marks a unit and prevents shooting or charging', () => {
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
    profile: { ...profile, name: 'Target' },
    position: { x: 14, y: 10 },
    modelPositions: [{ x: 14, y: 10 }],
  };
  battle.units = [unit, enemy];

  assert.equal(manualUnitCanAdvance(battle, 'unit-1', 0), true);

  const advanced = advanceManualUnit(battle, 'unit-1', 0);
  assert.equal(advanced.units.find(candidate => candidate.id === 'unit-1')?.movementAction, 'advanced');
  assert.match(advanced.log.at(-1)?.message ?? '', /Advances: rolled [1-6]/);

  const shooting = simulateNextPhase(advanced, rules40K10th);
  assert.equal(shooting.phase, 'shooting');
  assert.equal(shooting.log.some(entry => entry.message.includes('Advancing Unit shoots')), false);

  const charge = simulateNextPhase(shooting, rules40K10th);
  assert.equal(charge.phase, 'charge');
  assert.equal(charge.units.find(candidate => candidate.id === 'unit-1')?.charged, false);
  assert.equal(charge.log.some(entry => entry.message.includes('Advancing Unit charges')), false);
});
