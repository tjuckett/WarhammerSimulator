import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListhammerMarkdown } from '../src/parsers/listhammer';
import { validateImportedArmy } from '../src/engine/armyValidation';

const listPath = resolve(__dirname, '../../../..', 'docs', 'army-lists', 'listhammer', 'I like piggies.md');
const necronListPath = resolve(__dirname, '../../../..', 'docs', 'army-lists', 'listhammer', 'I get knocked down, but I get up again.md');

test('Listhammer Markdown imports the stored Ork roster through the current catalog', () => {
  const army = parseListhammerMarkdown(readFileSync(listPath, 'utf8'));
  const names = army.units.map(unit => unit.name);
  const unit = (name: string) => army.units.find(candidate => candidate.name === name);

  assert.equal(army.name, 'I like piggies');
  assert.equal(army.faction, 'Orks');
  assert.equal(army.sourceEdition, '11e');
  assert.equal(army.units.length, 15);
  assert.equal(new Set(army.units.map(candidate => candidate.rosterId)).size, army.units.length);
  assert.deepEqual(names.slice(0, 5), [
    'Ghazghkull Thraka',
    'Painboy',
    'Boyz',
    'Mozrog Skragbad',
    'Squighog Boyz',
  ]);

  assert.equal(unit('Boyz')?.baseModelCount, 20);
  assert.equal(army.units.filter(candidate => candidate.name === 'Squighog Boyz')[0]?.baseModelCount, 4);
  assert.equal(army.units.filter(candidate => candidate.name === 'Squighog Boyz')[1]?.baseModelCount, 8);
  assert.equal(army.units.filter(candidate => candidate.name === 'Squighog Boyz')[2]?.baseModelCount, 8);
  assert.equal(army.units.filter(candidate => candidate.name === 'Gretchin')[0]?.baseModelCount, 10);
  assert.equal(unit('Flash Gitz')?.baseModelCount, 5);

  const boyz = unit('Boyz');
  const painboy = unit('Painboy');
  assert.equal(painboy?.leaderAttachment?.attachedToUnitId, boyz?.rosterId);
  assert.equal(army.sourceMetadata?.detachmentName, 'War Horde');
  assert.equal(army.sourceMetadata?.detachmentPoints, 3);
  assert.equal(army.sourceMetadata?.missionName, 'Take and Hold');
  assert.match(army.sourceMetadata?.sourceUrl ?? '', /^https:\/\/listhammer\.info\//);

  assert.equal(army.catalog?.battleSizes?.[0]?.maximumPoints, 2000);
  assert.equal(army.catalog?.units.find(candidate => candidate.id === boyz?.rosterId)?.modelCountPoints?.['20'], 160);
  assert.equal(army.catalog?.units.find(candidate => candidate.id === painboy?.rosterId)?.modelCountPoints?.['1'], 45);
  assert.equal(validateImportedArmy(army, { battleSizeId: army.battleSizeId }).valid, true);
});

test('Listhammer Markdown imports a Necron roster whose title also contains points', () => {
  const army = parseListhammerMarkdown(readFileSync(necronListPath, 'utf8'));
  const unit = (name: string) => army.units.find(candidate => candidate.name === name);

  assert.equal(army.faction, 'Necrons');
  assert.equal(army.units.length, 12);
  assert.equal(army.battleSizeId, 'strike-force-2000-point-limit');
  assert.equal(army.sourceMetadata?.detachmentName, 'Awakened Dynasty');
  assert.equal(army.sourceMetadata?.missionName, 'Take and Hold');
  assert.equal(unit('Lokhust Lord')?.leaderAttachment?.attachedToUnitId, unit('Lokhust Destroyers')?.rosterId);
  assert.equal(unit('C\'tan Shard of the Deceiver')?.baseModelCount, 1);
  assert.equal(unit('Ophydian Destroyers')?.baseModelCount, 3);
  assert.equal(validateImportedArmy(army, { battleSizeId: army.battleSizeId }).valid, true);
});
