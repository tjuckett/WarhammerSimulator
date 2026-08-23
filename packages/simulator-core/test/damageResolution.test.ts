import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDamageOutcome } from '../src/engine/damageResolution';

test('damage resolution discards excess normal weapon damage but carries mortal damage', () => {
  assert.deepEqual(resolveDamageOutcome({
    damage: 5, modelCount: 3, woundsOnCurrentModel: 2, woundsPerModel: 3, noCarryOver: true,
  }), { killedModels: 1, remainingModels: 2, woundsOnCurrentModel: 3 });
  assert.deepEqual(resolveDamageOutcome({
    damage: 5, modelCount: 3, woundsOnCurrentModel: 2, woundsPerModel: 3,
  }), { killedModels: 2, remainingModels: 1, woundsOnCurrentModel: 3 });
});
