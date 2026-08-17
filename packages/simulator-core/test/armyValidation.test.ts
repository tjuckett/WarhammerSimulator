import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArmyCatalog, ImportedArmy, UnitProfile } from '../src/types/army';
import { validateImportedArmy } from '../src/engine/armyValidation';

function unit(overrides: Partial<UnitProfile> = {}): UnitProfile {
  return {
    rosterId: 'unit-1',
    name: 'Unit',
    move: 6,
    toughness: 4,
    save: 4,
    wounds: 2,
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

function army(units: UnitProfile[]): ImportedArmy {
  return { name: 'Test Army', faction: 'Test', units };
}

test('army validation accepts a structurally valid roster', () => {
  const result = validateImportedArmy(army([unit()]));
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('army validation catches duplicate IDs and invalid transport references', () => {
  const result = validateImportedArmy(army([
    unit({ rosterId: 'duplicate' }),
    unit({ rosterId: 'duplicate', deployment: { mode: 'transport', transportUnitId: 'missing' } }),
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'roster-id-duplicate'));
  assert.ok(result.errors.some(error => error.code === 'transport-target-invalid'));
});

test('army validation allows a transport assignment only when capacity exists', () => {
  const transport = unit({ rosterId: 'transport', name: 'Transport', transportCapacity: 10 });
  const passenger = unit({ rosterId: 'passenger', name: 'Passenger', deployment: { mode: 'transport', transportUnitId: 'transport' } });
  const result = validateImportedArmy(army([transport, passenger]));
  assert.equal(result.valid, true);
});

test('army validation applies catalog unit, copy, model-count, and battle-size constraints when supplied', () => {
  const catalog: ArmyCatalog = {
    id: 'test-catalog',
    faction: 'Test',
    units: [{
      id: 'unit-1',
      names: ['Unit'],
      modelCountPoints: { '5': 100 },
      minimumModels: 5,
      maximumModels: 10,
      maximumCopies: 1,
    }],
    battleSizes: [{ id: 'patrol', label: 'Patrol', minimumPoints: 100, maximumPoints: 150 }],
  };
  const result = validateImportedArmy({
    ...army([unit({ baseModelCount: 11 }), unit({ rosterId: 'unit-2', baseModelCount: 5 })]),
  }, { catalog, battleSizeId: 'patrol' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'catalog-model-count-high'));
  assert.ok(result.errors.some(error => error.code === 'catalog-unit-limit'));
});

test('army validation remains source-agnostic without a catalog', () => {
  const result = validateImportedArmy(army([unit({ baseModelCount: 11 })]));
  assert.equal(result.valid, true);
});
