import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ARMIES } from '../src/data/sampleArmies';
import { applyBaseSizesToArmy } from '../src/data/unitBaseSizes';

test('bundled Ork sample uses current 11th-edition profiles and bases', () => {
  const army = SAMPLE_ARMIES.find(candidate => candidate.faction === 'Orks');
  assert.ok(army);
  assert.equal(army.sourceEdition, '11e');

  const warboss = army.units.find(unit => unit.name === 'Warboss in Mega Armour');
  assert.equal(warboss?.move, 5);
  assert.equal(warboss?.toughness, 7);
  assert.equal(warboss?.save, 2);
  assert.equal(warboss?.invulnSave, 5);
  assert.equal(warboss?.weapons.find(weapon => weapon.name === "'Uge choppa")?.attacks, '5');
  assert.equal(warboss?.weapons.find(weapon => weapon.name === "'Uge choppa")?.damage, '3');
  assert.deepEqual(warboss?.abilities.map(ability => ability.name), [
    'Leader',
    'Waaagh!',
    "Krushin' Impetus",
    'Intimidating Motivation (Once per battle round, per army)',
  ]);
  assert.deepEqual(warboss?.modelBases, [{ shape: 'round', diameterMm: 50 }]);

  const boyz = army.units.find(unit => unit.rosterId === 'orks.boyz-default-1');
  assert.equal(boyz?.toughness, 5);
  assert.equal(boyz?.modelProfiles?.[0]?.name, 'Boss Nob');
  assert.equal(boyz?.modelProfiles?.[0]?.wounds, 2);
  assert.deepEqual(boyz?.modelBases?.[0], { shape: 'round', diameterMm: 40, label: 'Boss Nob' });
  assert.equal(boyz?.modelBases?.slice(1).every(base => base.shape === 'round' && base.diameterMm === 32), true);
  assert.ok(boyz);
  const staleBoyz = {
    ...boyz,
    modelBases: Array.from({ length: 20 }, () => ({ shape: 'round' as const, diameterMm: 32 })),
  };
  const repaired = applyBaseSizesToArmy({ ...army, units: [staleBoyz] }).units[0];
  assert.deepEqual(repaired?.modelBases?.[0], { shape: 'round', diameterMm: 40, label: 'Boss Nob' });
  assert.equal(repaired?.modelBases?.slice(1).every(base => base.shape === 'round' && base.diameterMm === 32), true);
  assert.equal(boyz?.modelWeaponLoadouts?.length, 20);
  assert.deepEqual(boyz?.modelWeaponLoadouts?.[0], [7, 8]);
  assert.deepEqual(boyz?.modelWeaponLoadouts?.[19], [7, 9]);

  const dread = army.units.find(unit => unit.name === 'Deff Dread');
  assert.equal(dread?.save, 2);
  assert.equal(dread?.modelWeaponLoadouts?.[0]?.length, 5);
  assert.deepEqual(dread?.modelBases, [{ shape: 'round', diameterMm: 60 }]);
});

test('bundled Necron sample uses current 11th-edition profiles and bases', () => {
  const army = SAMPLE_ARMIES.find(candidate => candidate.faction === 'Necrons');
  assert.ok(army);
  assert.equal(army.sourceEdition, '11e');

  const overlord = army.units.find(unit => unit.name === 'Overlord');
  assert.equal(overlord?.move, 5);
  assert.equal(overlord?.save, 2);
  assert.deepEqual(overlord?.modelWeaponLoadouts, [[1, 2]]);
  assert.deepEqual(overlord?.modelBases, [{ shape: 'round', diameterMm: 40 }]);

  const immortals = army.units.find(unit => unit.name === 'Immortals');
  assert.equal(immortals?.toughness, 5);
  assert.equal(immortals?.oc, 2);
  assert.equal(immortals?.weapons[0]?.skill, 3);
  assert.deepEqual(immortals?.modelBases, Array.from({ length: 10 }, () => ({ shape: 'round', diameterMm: 32 })));

  const wraiths = army.units.find(unit => unit.name === 'Canoptek Wraiths');
  assert.equal(wraiths?.toughness, 6);
  assert.equal(wraiths?.wounds, 4);
  assert.equal(wraiths?.keywords.includes('Beasts'), true);

  const ark = army.units.find(unit => unit.name === 'Doomsday Ark');
  assert.equal(ark?.move, 10);
  assert.equal(ark?.wounds, 14);
  assert.equal(ark?.damagedProfile?.maxRemainingWounds, 5);
  assert.equal(ark?.weapons.filter(weapon => weapon.name.startsWith('Gauss flayer array')).length, 2);
  assert.deepEqual(ark?.modelBases, [{ shape: 'other', label: 'Large Flying Base' }]);
});
