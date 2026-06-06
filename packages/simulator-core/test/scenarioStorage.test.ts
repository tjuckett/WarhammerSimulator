import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, Phase } from '../src/types/battle';
import type { ImportedArmy } from '../src/types/army';
import { rules40K10th, rulesetMetadataForState } from '../src/engine/rulesEngine';
import { localPracticeScenarioRepository } from '../src/practice/scenarioStorage';
import { scenarioFromTimeline } from '../src/practice/scenarios';
import {
  appendResolvedTimelineAction,
  createPracticeTimeline,
  currentTimelineState,
  type PracticeTimeline,
} from '../src/practice/timeline';

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
