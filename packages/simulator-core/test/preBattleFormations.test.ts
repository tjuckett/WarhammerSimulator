import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDefaultPreBattleFormations, pendingPreBattleFormations, resolvePreBattleFormation } from '../src/engine/preBattleFormations';
import { loadOrkCatalog } from '../src/engine/catalog';
import type { BattleState } from '../src/types/battle';
import type { ImportedArmy } from '../src/types/army';

function orkArmy(unit: ImportedArmy['units'][number]): ImportedArmy {
  return { name: 'Orks', faction: 'orks', units: [unit] };
}

test('Kommandos expose core abilities and a generic split formation', () => {
  const catalog = loadOrkCatalog();
  const profile = catalog.materializeUnit({ unitId: 'orks.kommandos', instanceId: 'kommandos-1' }, { factionId: 'orks' }).profile;
  const coreAbilities = profile.abilities.filter(rule => ['Infiltrators', 'Stealth'].includes(rule.name));
  assert.deepEqual(coreAbilities.map(rule => rule.name), ['Infiltrators', 'Stealth']);
  assert.match(coreAbilities[0]?.description ?? '', /During deployment/);
  assert.match(coreAbilities[1]?.description ?? '', /benefit of cover/);
  assert.deepEqual(profile.preBattleFormations?.[0]?.modelCounts, [5, 5]);

  const splitArmy = applyDefaultPreBattleFormations(orkArmy(profile));
  assert.deepEqual(splitArmy.units.map(unit => unit.baseModelCount), [5, 5]);
  assert.equal(splitArmy.units[0].abilities.some(rule => rule.name === "Found 'Em!"), false);
  assert.equal(splitArmy.units[0].abilities.some(rule => rule.name.startsWith('Bomb Squig')), true);
  assert.equal(splitArmy.units[1].abilities.some(rule => rule.name.startsWith('Bomb Squig')), false);
  assert.equal(splitArmy.units[1].abilities.some(rule => rule.name === "Found 'Em!"), true);
});

test('interactive formation resolution replaces the pending source unit', () => {
  const catalog = loadOrkCatalog();
  const profile = catalog.materializeUnit({ unitId: 'orks.kommandos', instanceId: 'kommandos-1' }, { factionId: 'orks' }).profile;
  const army = orkArmy(profile);
  const pending = pendingPreBattleFormations([army, { name: 'Necrons', faction: 'necrons', units: [] }]);
  const state = {
    pendingPreBattleFormations: pending,
    armies: [{ army }, { army: { name: 'Necrons', faction: 'necrons', units: [] } }],
    unplacedUnits: [[profile], []],
  } as unknown as BattleState;
  const next = resolvePreBattleFormation(state, {
    requestId: pending[0].id,
    abilityAssignments: { 'exclusive-abilities': ["Found 'Em!", 'Bomb Squig'] },
  });
  assert.equal(next.pendingPreBattleFormations?.length, 0);
  assert.deepEqual(next.armies[0].army.units.map(unit => unit.baseModelCount), [5, 5]);
  assert.equal(next.unplacedUnits[0].length, 2);
  assert.equal(next.armies[0].army.units[0].abilities.some(rule => rule.name === "Found 'Em!"), true);
});
