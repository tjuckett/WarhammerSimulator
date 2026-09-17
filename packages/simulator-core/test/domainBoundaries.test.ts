import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportedArmy, UnitProfile } from '../src/types/army';
import { PHASE_STEP, type BattleState, type BattleUnit, type Position } from '../src/types/battle';
import { boardFormatForId } from '../src/data/boardFormats';
import {
  addAircraftStrategicReserves,
  baseFootprintInDeploymentZone,
  infiltratorModelsAreOutsideEnemyUnits,
  modelIsOutsideEnemyDeploymentZoneBuffer,
  pointInDeploymentZone,
  zoneFor,
} from '../src/engine/deployment';
import { unitsInEngagementRange } from '../src/engine/coherency';
import {
  formationHasInternalOverlap,
  gridFormation,
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
import {
  closePendingCombatAction,
  declinePendingCombatAction,
  normalShootingActionWindowOpen,
  openPendingCombatAction,
  shootingActionWindowOpen,
} from '../src/engine/combatActionWindows';
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

test('mixed-base deployment formations group like models without overlap', () => {
  const squighogProfile = profile({
    name: 'Squighog Boyz',
    baseModelCount: 8,
    modelBases: [
      { shape: 'oval', widthMm: 90, lengthMm: 52.5 },
      ...Array.from({ length: 6 }, () => ({ shape: 'oval' as const, widthMm: 75, lengthMm: 42 })),
      { shape: 'oval', widthMm: 90, lengthMm: 52.5 },
    ],
  });
  const positions = gridFormation(squighogProfile, { x: 20, y: 10 }, 0);
  const deployed = unit('squighog-boyz', 0, { x: 20, y: 10 }, squighogProfile);
  deployed.modelPositions = positions;
  deployed.position = { x: 20, y: 10 };

  assert.equal(formationHasInternalOverlap(deployed), false);
  const likeBaseDistance = Math.hypot(positions[7].x - positions[0].x, positions[7].y - positions[0].y);
  const mixedBaseDistance = Math.hypot(positions[1].x - positions[0].x, positions[1].y - positions[0].y);
  assert.ok(likeBaseDistance < mixedBaseDistance);
});

test('Infiltrators must remain outside the enemy deployment buffer', () => {
  const infiltrator = profile({ abilities: [{ name: 'Infiltrators', description: 'Can deploy forward.' }] });
  const board = boardFormatForId();

  assert.equal(modelIsOutsideEnemyDeploymentZoneBuffer(infiltrator, 0, { x: board.width - 1, y: board.height / 2 }, 0, 'Default', board), false);
  assert.equal(modelIsOutsideEnemyDeploymentZoneBuffer(infiltrator, 0, { x: 0, y: board.height / 2 }, 0, 'Default', board), true);
});

test('round bases use circular clearance at diagonal deployment boundaries', () => {
  const redZone = zoneFor(1, 'Crucible of Battle', boardFormatForId());

  // This base is 0.25" from the diagonal by its centre and remains wholly
  // inside the triangle. A square-corner approximation incorrectly rejects it.
  assert.equal(pointInDeploymentZone({ x: 44, y: 20 }, redZone, 0.25), true);
  assert.equal(pointInDeploymentZone({ x: 43.8, y: 20 }, redZone, 0.25), false);
});

test('deployment sides allow a base to cross a shared edge between touching shapes', () => {
  const tippingPointZone = zoneFor(0, 'Tipping Point', boardFormatForId());

  assert.equal(pointInDeploymentZone({ x: 10, y: 22 }, tippingPointZone, 0.5), true);
  assert.equal(pointInDeploymentZone({ x: 12.25, y: 22 }, tippingPointZone, 0.5), false);
});

test('deployment containment uses the rotated oval footprint rather than its bounding circle', () => {
  const zone = {
    name: 'Test Zone',
    side: 0 as const,
    role: 'defender' as const,
    axis: 'x' as const,
    deployment: 'Test',
    shapes: [{ type: 'rect' as const, x1: 0, y1: 0, x2: 10, y2: 10 }],
    minX: 0,
    maxX: 10,
    minY: 0,
    maxY: 10,
    x0: 0,
    x1: 10,
    y0: 0,
    y1: 10,
  };
  const center = { x: 8.75, y: 5 };
  const footprint = { shape: 'oval' as const, halfWidth: 1, halfLength: 2, rotationDeg: 90 };

  assert.equal(pointInDeploymentZone(center, zone, 2), false);
  assert.equal(baseFootprintInDeploymentZone(center, footprint, zone), true);
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

test('combat action windows keep normal steps strict while allowing typed event exceptions', () => {
  const state = battleState({ phase: 'shooting', phaseStep: PHASE_STEP.ShootingStart });
  assert.equal(normalShootingActionWindowOpen(state, 0), false);
  assert.equal(shootingActionWindowOpen(state, 'shooter', 0), false);

  state.phase = 'movement';
  state.phaseStep = PHASE_STEP.MovementReinforcements;
  openPendingCombatAction(state, {
    id: 'combat-event-1',
    kind: 'shooting',
    unitId: 'shooter',
    side: 1,
    source: 'Test ability',
    triggeredPhase: state.phase,
    triggeredPhaseStep: state.phaseStep,
  });

  assert.equal(normalShootingActionWindowOpen(state, 1), false);
  assert.equal(shootingActionWindowOpen(state, 'shooter', 1), true);
  assert.equal(shootingActionWindowOpen(state, 'other-unit', 1), false);

  const declined = declinePendingCombatAction(state, 1, 'combat-event-1');
  assert.equal(declined.pendingCombatActions, undefined);
  assert.equal(state.pendingCombatActions?.length, 1);
  closePendingCombatAction(state, 'combat-event-1');
  assert.equal(state.pendingCombatActions, undefined);
});
