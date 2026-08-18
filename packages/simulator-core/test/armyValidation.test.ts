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

test('army validation rejects malformed deployment modes and transport capacities', () => {
  const malformedDeployment = { mode: 'teleport' } as unknown as UnitProfile['deployment'];
  const result = validateImportedArmy(army([
    unit({ deployment: malformedDeployment }),
    unit({ rosterId: 'transport', transportCapacity: 0 }),
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'deployment-mode-invalid'));
  assert.ok(result.errors.some(error => error.code === 'transport-capacity-invalid'));
});

test('army validation rejects invalid model weapon loadout references', () => {
  const weapon = { name: 'Gun', range: 24, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false };
  const result = validateImportedArmy(army([
    unit({ weapons: [weapon], modelWeaponLoadouts: [[0, 0], [1]], baseModelCount: 1 }),
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'model-loadout-count-invalid'));
  assert.ok(result.errors.some(error => error.code === 'model-loadout-weapon-duplicate'));
  assert.ok(result.errors.some(error => error.code === 'model-loadout-weapon-invalid'));
});

test('army validation rejects malformed model stat profiles', () => {
  const result = validateImportedArmy(army([unit({
    modelProfiles: [{
      name: '',
      count: 0,
      move: 0,
      toughness: Number.NaN,
      save: 4,
      wounds: 1,
      leadership: 7,
      oc: -1,
    }],
  })]));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'model-profile-name-invalid'));
  assert.ok(result.errors.some(error => error.code === 'model-profile-count-invalid'));
  assert.equal(result.errors.filter(error => error.code === 'model-profile-stat-invalid').length, 3);
});

test('army validation accepts valid grouped model stat profiles', () => {
  const result = validateImportedArmy(army([unit({
    modelProfiles: [{
      name: 'Battleline', count: 5, move: 6, toughness: 4, save: 4, wounds: 2, leadership: 7, oc: 1,
    }],
  })]));
  assert.equal(result.valid, true);
});

test('army validation rejects malformed model base geometry', () => {
  const result = validateImportedArmy(army([unit({
    modelBases: [
      { shape: 'round', diameterMm: 0 },
      { shape: 'oval', widthMm: 40, lengthMm: Number.NaN },
      { shape: 'hull', widthMm: 50, lengthMm: 75, footprint: 'triangle' as 'square' },
      { shape: 'other', label: ' ' },
    ],
  })]));
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter(error => error.code === 'model-base-dimension-invalid').length, 2);
  assert.ok(result.errors.some(error => error.code === 'model-base-footprint-invalid'));
  assert.ok(result.errors.some(error => error.code === 'model-base-label-invalid'));
});

test('army validation accepts model base fallback geometry', () => {
  const result = validateImportedArmy(army([unit({
    modelBases: [{ shape: 'hull', widthMm: 50, lengthMm: 75, footprint: 'rectangle' }],
  })]));
  assert.equal(result.valid, true);
});

test('army validation rejects malformed typed movement and damaged profiles', () => {
  const result = validateImportedArmy(army([unit({
    movementOverrides: { moveModifier: Number.NaN, advanceModifier: Number.POSITIVE_INFINITY, advanceRoll: ' ' },
    damagedProfile: { maxRemainingWounds: 0, hitRollModifier: Number.NaN, objectiveControlModifier: Number.POSITIVE_INFINITY },
  })]));
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter(error => error.code === 'movement-override-invalid').length, 3);
  assert.equal(result.errors.filter(error => error.code === 'damaged-profile-invalid').length, 3);
});

test('army validation accepts valid typed movement and damaged profiles', () => {
  const result = validateImportedArmy(army([unit({
    movementOverrides: { moveModifier: 2, advanceModifier: 1, advanceRoll: 'D6' },
    damagedProfile: { maxRemainingWounds: 1, hitRollModifier: 1, objectiveControlModifier: -1 },
  })]));
  assert.equal(result.valid, true);
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
