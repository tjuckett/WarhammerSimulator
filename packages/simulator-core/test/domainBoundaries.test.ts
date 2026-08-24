import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportedArmy, UnitProfile } from '../src/types/army';
import type { BattleState, BattleUnit, Position } from '../src/types/battle';
import { boardFormatForId } from '../src/data/boardFormats';
import {
  addAircraftStrategicReserves,
  infiltratorModelsAreOutsideEnemyUnits,
  modelIsOutsideEnemyDeploymentZoneBuffer,
} from '../src/engine/deployment';
import { unitsInEngagementRange } from '../src/engine/coherency';
import {
  unitHasBaseOverlap,
  unitHasModelOutsideBattlefield,
  unitHasStartedCurrentMove,
} from '../src/engine/interactiveMovement';
import { rules40K11th, rulesetMetadataForState } from '../src/engine/rulesEngine';
import {
  appendResolvedTimelineAction,
  createPracticeTimeline,
  redoTimeline,
  undoTimeline,
} from '../src/practice/timeline';
import { GAME_ACTION_TYPE } from '../src/practice/actions';
import { getLegalActions } from '../src/engine/legalActions';
import { localPracticeScenarioRepository, PRACTICE_SCENARIO_STORAGE_KEY } from '../src/practice/scenarioStorage';
import { scenarioFromTimeline } from '../src/practice/scenarios';

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

function profile(overrides: Partial<UnitProfile> = {}): UnitProfile {
  return {
    name: 'Test Unit',
    move: 6,
    toughness: 4,
    save: 4,
    wounds: 2,
    leadership: 7,
    oc: 1,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [],
    abilities: [],
    ...overrides,
  };
}

function unit(id: string, side: 0 | 1, position: Position, unitProfile = profile()): BattleUnit {
  return {
    id,
    side,
    profile: unitProfile,
    remainingModels: unitProfile.baseModelCount,
    woundsOnLeadModel: unitProfile.wounds,
    position,
    modelPositions: Array.from({ length: unitProfile.baseModelCount }, () => ({ ...position })),
    facingDeg: side === 0 ? 0 : 180,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
}

function battleState(overrides: Partial<BattleState> = {}): BattleState {
  const army: ImportedArmy = { name: 'Test', faction: 'Test', units: [] };
  return {
    ruleset: rulesetMetadataForState(rules40K11th),
    battleRound: 1,
    turn: 1,
    maxBattleRounds: 5,
    maxTurns: 5,
    activeArmy: 0,
    phase: 'deployment',
    winner: null,
    log: [],
    units: [],
    terrain: [],
    armies: [
      { name: 'Blue', faction: 'Test', color: '#00f', army },
      { name: 'Red', faction: 'Test', color: '#f00', army },
    ],
    objectives: [],
    objectiveControl: rules40K11th.objectiveControl,
    objectiveOwners: [],
    scores: [0, 0],
    commandPoints: [0, 0],
    unplacedUnits: [[], []],
    deployStrategies: ['balanced', 'balanced'],
    setup: {
      missionCode: 'TEST',
      primaryMission: 'Practice',
      deployment: 'Dawn of War',
      terrainLayout: 'Layout 1',
    },
    ...overrides,
  };
}

test('aircraft reserve setup creates off-board reserve units', () => {
  const aircraft = profile({ name: 'Aircraft', keywords: ['Aircraft'] });
  const army: ImportedArmy = { name: 'Test', faction: 'Test', units: [aircraft] };
  const units: BattleUnit[] = [];

  addAircraftStrategicReserves(units, army, 0, boardFormatForId());

  assert.equal(units.length, 1);
  assert.equal(units[0].inStrategicReserves, true);
  assert.ok(units[0].modelPositions[0].x < 0);
});

test('Infiltrators must remain outside the enemy deployment buffer', () => {
  const infiltrator = profile({ abilities: [{ name: 'Infiltrators', description: 'Can deploy forward.' }] });
  const board = boardFormatForId();

  assert.equal(modelIsOutsideEnemyDeploymentZoneBuffer(infiltrator, 0, { x: board.width - 1, y: board.height / 2 }, 0, 'Default', board), false);
  assert.equal(modelIsOutsideEnemyDeploymentZoneBuffer(infiltrator, 0, { x: 0, y: board.height / 2 }, 0, 'Default', board), true);
});

test('Infiltrator placement rejects models too close to enemy models', () => {
  const infiltrator = profile({ abilities: [{ name: 'Infiltrators', description: 'Can deploy forward.' }] });
  const enemy = unit('enemy', 1, { x: 10, y: 10 });
  const state = battleState({ units: [enemy] });

  assert.equal(infiltratorModelsAreOutsideEnemyUnits(state, 0, infiltrator, [{ x: 10, y: 10 }]), false);
  assert.equal(infiltratorModelsAreOutsideEnemyUnits(state, 0, infiltrator, [{ x: 25, y: 25 }]), true);
});

test('shared movement geometry detects overlap, board exits, and started moves', () => {
  const mover = unit('mover', 0, { x: 10, y: 10 });
  const blocker = unit('blocker', 1, { x: 10, y: 10 });
  const state = battleState({ units: [mover, blocker], board: boardFormatForId() });

  assert.equal(unitHasBaseOverlap(state, mover), true);
  mover.modelPositions[0] = { x: -2, y: 10 };
  assert.equal(unitHasModelOutsideBattlefield(mover, state), true);
  mover.modelPositions[0] = { x: 10, y: 10 };
  mover.movementStartPositionsByModel = [{ x: 9, y: 10 }];
  assert.equal(unitHasStartedCurrentMove(mover), true);
});

test('engagement geometry includes base edge distance and vertical limits', () => {
  const attacker = unit('attacker', 0, { x: 10, y: 10 });
  const target = unit('target', 1, { x: 11.25, y: 10 });

  assert.equal(unitsInEngagementRange(attacker, [target], 1), true);
  target.modelPositions[0] = { x: 11.25, y: 10, z: 6 };
  assert.equal(unitsInEngagementRange(attacker, [target], 1), false);
});

test('timeline undo and redo restore immutable state snapshots', () => {
  const initial = battleState({ phase: 'command' });
  const changed = { ...initial, phase: 'shooting' as const, turn: 2 };
  const timeline = createPracticeTimeline(initial, { id: 'timeline-test', createdAt: '2026-01-01T00:00:00.000Z' });
  const appended = appendResolvedTimelineAction(timeline, { type: GAME_ACTION_TYPE.StepPhase }, {
    stateBefore: initial,
    stateAfter: changed,
    id: 'entry-test',
    createdAt: '2026-01-01T00:01:00.000Z',
  });

  const undone = undoTimeline(appended);
  assert.equal(undone.timeline.cursor, 0);
  assert.equal(undone.state.phase, 'command');
  const redone = redoTimeline(undone.timeline);
  assert.equal(redone.timeline.cursor, 1);
  assert.equal(redone.state.phase, 'shooting');
  assert.equal(redone.state.turn, 2);
});

test('legacy manual checkpoint metadata remains readable as a play checkpoint', async () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const initial = battleState({ phase: 'command' });
  const timeline = createPracticeTimeline(initial, { id: 'legacy-timeline', createdAt: '2026-01-01T00:00:00.000Z' });
  const legacy = scenarioFromTimeline(timeline, { id: 'legacy-save', branchId: 'legacy-game' });
  legacy.metadata.checkpointKind = 'manual' as never;

  await localPracticeScenarioRepository.saveScenario(legacy);

  const summary = (await localPracticeScenarioRepository.listSummaries()).find(item => item.id === 'legacy-save');
  assert.equal(summary?.checkpointKind, 'play');
  assert.ok(storage.getItem(PRACTICE_SCENARIO_STORAGE_KEY));
});

test('legal actions do not expose phase-specific actions outside their phase', () => {
  const state = battleState({ phase: 'command' });
  const actions = getLegalActions(state, 0, rules40K11th).map(option => option.action.type);

  assert.equal(actions.includes(GAME_ACTION_TYPE.ShootUnitWeapon), false);
  assert.equal(actions.includes(GAME_ACTION_TYPE.ChargeUnitTarget), false);
  assert.equal(actions.includes(GAME_ACTION_TYPE.FightUnitWeapon), false);
});
