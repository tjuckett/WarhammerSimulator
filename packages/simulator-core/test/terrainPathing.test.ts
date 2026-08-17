import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleUnit } from '../src/types/battle';
import { findReachablePosition } from '../src/engine/simulator';

test('terrain pathing helper is reusable and respects movement distance', () => {
  const unit = {
    id: 'pathing-unit',
    position: { x: 5, y: 5 },
    modelPositions: [{ x: 5, y: 5 }],
    profile: { keywords: [] },
  } as unknown as BattleUnit;
  const destination = findReachablePosition(unit, { x: 20, y: 5 }, 6, [], 0);

  assert.equal(destination.x, 11);
  assert.equal(destination.y, 5);
});
