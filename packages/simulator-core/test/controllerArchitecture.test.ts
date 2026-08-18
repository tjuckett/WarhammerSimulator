import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, BattleUnit } from '../src/types/battle';
import { rules40K10th } from '../src/engine/rulesEngine';
import { observeBattleState } from '../src/engine/battleObservation';
import {
  applyAiAction,
  applyControllerAction,
  chooseAiAction,
  heuristicAiPolicy,
  observeBattleForSeat,
  type PlayerSeat,
} from '../src/engine/controllers';

function controllerState(): BattleState {
  return {
    ruleset: rules40K10th.metadata,
    battleRound: 1,
    maxBattleRounds: 5,
    turn: 1,
    maxTurns: 5,
    activeArmy: 0,
    phase: 'setup',
    winner: null,
    log: [],
    units: [],
    terrain: [],
    armies: [
      { name: 'Blue', faction: 'Test', color: '#00f', army: { name: 'Blue', faction: 'Test', units: [] } },
      { name: 'Red', faction: 'Test', color: '#f00', army: { name: 'Red', faction: 'Test', units: [] } },
    ],
    objectives: [],
    objectiveControl: rules40K10th.objectiveControl,
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
  };
}

test('controller seats observe legal actions and apply only intended GameActions', () => {
  const state = controllerState();
  const seat: PlayerSeat = { side: 0, controller: { kind: 'ai', policyId: 'first-legal' } };
  const observation = observeBattleForSeat(state, seat, rules40K10th);
  assert.equal(observation.legalActions[0]?.action.type, 'play.stepPhase');

  const selected = chooseAiAction(state, seat, rules40K10th, heuristicAiPolicy);
  assert.deepEqual(selected, { type: 'play.stepPhase' });

  const next = applyControllerAction(state, { side: 0, action: selected! }, rules40K10th);
  assert.equal(next.phase, 'command');
  assert.equal(applyAiAction(state, seat, rules40K10th).phase, 'command');
  assert.throws(
    () => applyControllerAction(state, { side: 0, action: { type: 'play.stepPhase', side: 1 } as never }, rules40K10th),
    /Illegal action/,
  );
});

test('battle observations use effective objective control for Battle-shocked units', () => {
  const state = controllerState();
  const shocked: BattleUnit = {
    id: 'shocked',
    side: 0,
    profile: {
      name: 'Shocked Squad',
      move: 6,
      toughness: 4,
      save: 4,
      wounds: 1,
      leadership: 7,
      oc: 2,
      baseModelCount: 2,
      keywords: [],
      factionKeywords: [],
      weapons: [],
      abilities: [],
    },
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 10 },
    modelPositions: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: true,
    activated: false,
    destroyed: false,
  };
  const healthy: BattleUnit = { ...shocked, id: 'healthy', battleshocked: false, position: { x: 20, y: 10 }, modelPositions: [{ x: 20, y: 10 }, { x: 21, y: 10 }] };
  state.units = [shocked, healthy];

  const observation = observeBattleState(state);

  assert.equal(observation.units.find(unit => unit.id === shocked.id)?.objectiveControl, 0);
  assert.equal(observation.units.find(unit => unit.id === healthy.id)?.objectiveControl, 4);
  assert.equal(observation.sides[0].objectiveControlTotal, 4);
});
