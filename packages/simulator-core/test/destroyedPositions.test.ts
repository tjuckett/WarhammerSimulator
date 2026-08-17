import assert from 'node:assert/strict';
import test from 'node:test';
import type { BattleState, BattleUnit } from '../src/types/battle';
import { applyDamage } from '../src/engine/simulator';

function unit(): BattleUnit {
  return {
    id: 'destroyed-unit',
    side: 0,
    profile: {
      name: 'Destroyed Unit', move: 6, toughness: 4, save: 4, wounds: 1, leadership: 7, oc: 1,
      baseModelCount: 2, keywords: ['Infantry'], factionKeywords: [], weapons: [], abilities: [],
    },
    remainingModels: 2,
    woundsOnLeadModel: 1,
    position: { x: 10, y: 12 },
    modelPositions: [{ x: 9, y: 12 }, { x: 11, y: 12 }],
    facingDeg: 0,
    charged: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
}

test('destroyed units retain their last known formation positions', () => {
  const target = unit();
  const state = { turn: 1, battleRound: 1, phase: 'shooting', units: [target], log: [] } as unknown as BattleState;

  applyDamage(target, 2, state, 1);

  assert.equal(target.destroyed, true);
  assert.deepEqual(target.lastDestroyedPosition, { x: 10, y: 12 });
  assert.deepEqual(target.lastDestroyedModelPositions, [{ x: 9, y: 12 }, { x: 11, y: 12 }]);
});
