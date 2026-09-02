import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleUnit } from '../src/types/battle';
import { estimateSequentialModelEquivalentLosses, modelGroupsForCombatEstimate } from '../src/engine/combatEstimation';

test('sequential estimate discards excess normal damage on one-wound models', () => {
  const estimate = estimateSequentialModelEquivalentLosses({
    modelCount: 10,
    woundsPerModel: 1,
    expectedUnsavedPackets: 5,
    averageDamagePerPacket: 2,
  });

  assert.equal(estimate.modelEquivalentLosses, 5);
  assert.equal(estimate.fullModelsLost, 5);
  assert.equal(estimate.partialModelEquivalent, 0);
});

test('sequential estimate preserves partial damage on the surviving model', () => {
  const estimate = estimateSequentialModelEquivalentLosses({
    modelCount: 10,
    woundsPerModel: 3,
    expectedUnsavedPackets: 5,
    averageDamagePerPacket: 2,
  });

  assert.equal(estimate.fullModelsLost, 2);
  assert.ok(Math.abs(estimate.modelEquivalentLosses - (2 + (2 / 3))) < 0.000001);
  assert.ok(Math.abs(estimate.partialModelEquivalent - (2 / 3)) < 0.000001);
});

test('sequential estimate uses the current wounds of an already wounded model', () => {
  const estimate = estimateSequentialModelEquivalentLosses({
    modelCount: 10,
    woundsPerModel: 3,
    currentWounds: 1,
    expectedUnsavedPackets: 1,
    averageDamagePerPacket: 2,
  });

  assert.equal(estimate.modelEquivalentLosses, 1);
  assert.equal(estimate.fullModelsLost, 1);
  assert.equal(estimate.partialModelEquivalent, 0);
});

test('model groups track live mixed-profile counts and the wounded profile', () => {
  const unit = {
    remainingModels: 3,
    woundsOnLeadModel: 1,
    woundedModelIndex: 2,
    modelPositions: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    modelRosterIndexes: [0, 2, 3],
    profile: {
      name: 'Mixed unit',
      baseModelCount: 4,
      move: 6,
      toughness: 4,
      save: 4,
      wounds: 2,
      leadership: 7,
      oc: 1,
      keywords: [],
      factionKeywords: [],
      weapons: [],
      abilities: [],
      modelProfiles: [
        { name: 'Bodyguard', count: 3, move: 6, toughness: 4, save: 4, wounds: 2, leadership: 7, oc: 1 },
        { name: 'Specialist', count: 1, move: 6, toughness: 5, save: 3, wounds: 3, leadership: 7, oc: 1 },
      ],
    },
  } as unknown as BattleUnit;

  assert.deepEqual(modelGroupsForCombatEstimate(unit), [
    { name: 'Bodyguard', modelCount: 2, toughness: 4, save: 4, wounds: 2, currentWounds: undefined },
    { name: 'Specialist', modelCount: 1, toughness: 5, save: 3, wounds: 3, currentWounds: 1 },
  ]);
});
