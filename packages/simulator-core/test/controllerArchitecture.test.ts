import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState } from '../src/types/battle';
import { rules40K10th } from '../src/engine/rulesEngine';
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
