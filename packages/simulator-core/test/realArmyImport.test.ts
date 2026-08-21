import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBattleScribeCatalogueJSON, parseBattleScribeJSON } from '../src/parsers/battlescribe';
import { validateImportedArmy } from '../src/engine/armyValidation';

const rosterPaths = [
  ['necrons', 'Necron - 5_23_26.json'],
  ['necrons', 'Necrons  - Cursed Legion.json'],
  ['orks', 'Orks - Warhorde 2000.json'],
] as const;

test('BattleScribe parser imports the real rosters stored in lists/', () => {
  for (const [faction, filename] of rosterPaths) {
    const raw = JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'lists', faction, filename), 'utf8'));
    const army = parseBattleScribeJSON(raw);
    const rosterIds = army.units.map(unit => unit.rosterId).filter((id): id is string => Boolean(id));

    assert.ok(army.name, `${filename} should provide a roster name`);
    assert.ok(army.units.length > 0, `${filename} should contain units`);
    const expectedEdition = filename.startsWith('Orks') ? '11e' : '10e';
    assert.equal(army.sourceEdition, expectedEdition, `${filename} should preserve the roster edition`);
    assert.ok(army.units.every(unit => unit.name && unit.baseModelCount > 0), `${filename} should produce usable unit profiles`);
    assert.equal(new Set(rosterIds).size, rosterIds.length, `${filename} should preserve unique roster IDs`);
    if (expectedEdition === '11e') {
      assert.equal(army.catalog?.battleSizes?.[0]?.maximumPoints, 2000);
      assert.equal(army.catalog?.units.length, new Set(army.units.map(unit => unit.rosterId ?? unit.name)).size);
      assert.ok(army.catalog?.units.every(unit => unit.modelCountPoints));
      assert.equal(army.catalog?.rules?.some(rule => rule.name === 'Get Stuck In'), true);
      assert.equal(army.battleSizeId, 'strike-force-2000-point-limit');
      assert.equal(validateImportedArmy(army, { battleSizeId: army.battleSizeId }).valid, true);
    }
  }
});

test('BSData catalogue imports a selectable unit library without selecting the units', () => {
  const catalogue = parseBattleScribeCatalogueJSON({
    catalogue: {
      name: 'Orks',
      sharedSelectionEntries: [{
        id: 'boyz-id',
        name: 'Boyz',
        type: 'unit',
        costs: [{ name: 'pts', value: 75 }],
        categories: [{ name: 'Infantry' }, { name: 'Faction: Orks' }],
        selectionEntryGroups: [{ selectionEntries: [{
          name: 'Boy', type: 'model', number: 5,
          profiles: [{ name: 'Boy', typeName: 'Unit', characteristics: [
            { name: 'M', $text: '6"' }, { name: 'T', $text: '5' }, { name: 'Sv', $text: '5+' },
            { name: 'W', $text: '1' }, { name: 'Ld', $text: '7+' }, { name: 'OC', $text: '2' },
          ] }],
        }] }],
      }],
    },
  });

  assert.equal(catalogue.sourceEdition, '11e');
  assert.equal(catalogue.units.length, 0);
  assert.equal(catalogue.catalog?.units.length, 1);
  assert.equal(catalogue.catalog?.units[0].profile?.name, 'Boyz');
  assert.equal(catalogue.catalog?.units[0].profile?.baseModelCount, 5);
  assert.equal(catalogue.catalog?.units[0].modelCountPoints?.['5'], 75);
});
