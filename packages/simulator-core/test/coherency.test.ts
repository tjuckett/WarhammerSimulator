import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleUnit } from '../src/types/battle';
import type { CoherencyModel } from '../src/engine/coherency';
import { modelListIsCoherent } from '../src/engine/coherency';

function model(index: number, x: number): CoherencyModel {
  return {
    unit: {
      id: 'unit-1',
      profile: { keywords: [] },
    } as unknown as BattleUnit,
    model: { x, y: 0 },
    modelIndex: index,
  };
}

test('11th coherency requires every model to remain within 9 inches of every other model', () => {
  const models = [model(0, 0), model(1, 2.9), model(2, 5.8), model(3, 8.7), model(4, 11.6)];

  assert.equal(modelListIsCoherent(models, '10e'), true);
  assert.equal(modelListIsCoherent(models, '11e'), false);
});

test('11th coherency still allows a compact unit with one 2-inch neighbor per model', () => {
  const models = [model(0, 0), model(1, 1.9), model(2, 3.8)];

  assert.equal(modelListIsCoherent(models, '11e'), true);
});
