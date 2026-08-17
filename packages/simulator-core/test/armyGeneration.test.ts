import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportedArmy, UnitProfile } from '../src/types/army';
import { generateAiArmy } from '../src/engine/armyGeneration';

function unit(overrides: Partial<UnitProfile> = {}): UnitProfile {
  return {
    rosterId: overrides.rosterId ?? 'unit',
    name: overrides.name ?? 'Unit',
    move: 6,
    toughness: 4,
    save: 4,
    wounds: 1,
    leadership: 7,
    oc: 1,
    baseModelCount: 5,
    keywords: ['Infantry'],
    factionKeywords: ['Test'],
    weapons: [],
    abilities: [],
    ...overrides,
  };
}

const source: ImportedArmy = {
  name: 'Test Roster',
  faction: 'Test',
  units: [
    unit({ rosterId: 'objective', name: 'Objective Squad', baseModelCount: 10, oc: 2 }),
    unit({ rosterId: 'elite', name: 'Elite Squad', toughness: 8, wounds: 3, baseModelCount: 3 }),
    unit({ rosterId: 'fast', name: 'Fast Squad', move: 12 }),
  ],
};

test('AI army generation is deterministic and records its explanation', () => {
  const result = generateAiArmy(source, { strategy: 'objective', maxUnits: 2 });
  assert.deepEqual(result.selectedUnitNames, ['Objective Squad', 'Elite Squad']);
  assert.equal(result.army.name, 'Test Roster AI (objective)');
  assert.equal(result.army.generation?.strategy, 'objective');
  assert.match(result.explanation, /points, faction limits/);
});

test('AI army generation clears stale deployment relationships', () => {
  const result = generateAiArmy({
    ...source,
    units: [unit({ rosterId: 'leader', leaderAttachment: { attachedToUnitId: 'target' } }), unit({ rosterId: 'target' })],
  });
  assert.equal(result.army.units.every(candidate => !candidate.deployment && !candidate.leaderAttachment), true);
});
