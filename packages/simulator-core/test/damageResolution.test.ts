import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDamageOutcome, resolveFeelNoPainOutcome, resolveSaveOutcome } from '../src/engine/damageResolution';

test('damage resolution discards excess normal weapon damage but carries mortal damage', () => {
  assert.deepEqual(resolveDamageOutcome({
    damage: 5, modelCount: 3, woundsOnCurrentModel: 2, woundsPerModel: 3, noCarryOver: true,
  }), { killedModels: 1, remainingModels: 2, woundsOnCurrentModel: 3 });
  assert.deepEqual(resolveDamageOutcome({
    damage: 5, modelCount: 3, woundsOnCurrentModel: 2, woundsPerModel: 3,
  }), { killedModels: 2, remainingModels: 1, woundsOnCurrentModel: 3 });
});

test('feel no pain resolution counts successful prevention rolls', () => {
  assert.deepEqual(resolveFeelNoPainOutcome(4, 5, [5, 3, 6, 2]), { ignored: 2, damage: 2 });
});

test('save resolution counts saved and unsaved wounds', () => {
  assert.deepEqual(resolveSaveOutcome(4, 4, [4, 2, 6, 1]), { saved: 2, unsaved: 2 });
});
