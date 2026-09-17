import test from 'node:test';
import assert from 'node:assert/strict';
import { rules40K11th } from '../src/engine/rulesEngine';
import { validateImportedArmy } from '../src/engine/armyValidation';
import { modelWeaponLoadout } from '../src/engine/unitModelState';
import {
  CatalogRegistry,
  CatalogMaterializationError,
  loadNecronCatalog,
  loadOrkCatalog,
  rulesEditionWithCatalog,
} from '../src/engine/catalog';

test('the Ork catalog exposes every current non-Legends datasheet and aliases', () => {
  const catalog = loadOrkCatalog();

  assert.equal(catalog.unitsForFaction('orks').length, 58);
  assert.equal(catalog.unitIdForName('orks', 'Boss-Snikrot'), 'orks.boss-snikrot');
  assert.equal(catalog.unitIdForName('orks', 'Boyz (x20)'), 'orks.boyz');
  assert.equal(catalog.manifest.catalogRevision, '2026-08-29.1');
  assert.equal(catalog.manifest.coverage?.sourceEntryCount, 58);
  assert.equal(catalog.manifest.coverage?.normalizedEntryCount, 58);
  assert.doesNotThrow(() => new CatalogRegistry(catalog.bundle, {
    expectedCatalogId: 'warhammer-40k',
    expectedEdition: '11e',
    expectedCatalogRevision: '2026-08-29.1',
  }));
  assert.throws(
    () => new CatalogRegistry(catalog.bundle, { expectedCatalogRevision: 'old-revision' }),
    /Expected catalog revision old-revision/,
  );
});

test('the Necron catalog exposes every current non-Legends datasheet, bases, and detachments', () => {
  const catalog = loadNecronCatalog();
  const units = catalog.unitsForFaction('necrons');

  assert.equal(units.length, 52);
  assert.equal(catalog.faction('necrons')?.detachmentRefs?.length, 12);
  assert.equal(catalog.unitIdForName('necrons', 'Necron-Warriors'), 'necrons.necron-warriors');
  assert.equal(catalog.unitIdForName('necrons', 'C-tan Shard of the Void Dragon'), 'necrons.c-tan-shard-of-the-void-dragon');
  assert.equal(catalog.rulesForContext({ factionId: 'necrons', detachmentId: 'necrons.detachment.awakened-dynasty' })
    .filter(rule => rule.kind === 'stratagem').length, 6);

  for (const definition of units) {
    const result = catalog.materializeUnit({ unitId: definition.id }, { factionId: 'necrons' });
    assert.ok(result.profile.baseModelCount >= 1, `${definition.name} has a model count`);
    assert.ok(result.profile.weapons.length >= 1, `${definition.name} has weapons`);
    assert.equal(result.profile.modelBases?.length, result.profile.baseModelCount, `${definition.name} has resolved bases`);
  }

  const silentKing = catalog.materializeUnit({ unitId: 'necrons.the-silent-king' }, { factionId: 'necrons' });
  assert.deepEqual(silentKing.profile.modelBases?.map(base => 'diameterMm' in base ? base.diameterMm : undefined), [100, 50, 50]);
  assert.equal(silentKing.profile.modelProfiles?.[1]?.count, 2);
});

test('every current Ork datasheet materializes into a selectable profile', () => {
  const catalog = loadOrkCatalog();
  const baseSizeGaps = new Set(['Bigboss', 'Wartrakk', 'Big Mek Dakkarig']);

  for (const definition of catalog.unitsForFaction('orks')) {
    const result = catalog.materializeUnit({ unitId: definition.id }, { factionId: 'orks' });
    assert.ok(result.profile.baseModelCount >= 1, `${definition.name} has a model count`);
    assert.ok(result.profile.weapons.length >= 1, `${definition.name} has weapons`);
    if (!baseSizeGaps.has(definition.name)) {
      assert.equal(result.profile.modelBases?.length, result.profile.baseModelCount, `${definition.name} has resolved bases`);
    }
  }
});

test('Ork wargear uses the generic catalog choice format across replacement and unit upgrades', () => {
  const catalog = loadOrkCatalog();
  const structured = catalog.unitsForFaction('orks').filter(unit => unit.wargearChoices?.length);

  assert.equal(structured.length, 32);
  for (const definition of structured) {
    for (const choice of definition.wargearChoices ?? []) {
      for (const weaponName of [...(choice.weaponNames ?? []), ...(choice.replacesWeaponNames ?? [])]) {
        assert.ok(
          definition.profile.weapons.some(weapon => weapon.name.toLowerCase() === weaponName.toLowerCase()),
          `${definition.name} references missing ${weaponName}`,
        );
      }
    }
  }

  const beastSnaggaBoyz = catalog.unit('orks.beast-snagga-boyz');
  assert.equal(beastSnaggaBoyz?.modelCount?.step, 10);
  assert.equal(beastSnaggaBoyz?.wargearChoices?.find(choice => choice.id === 'beast-snagga-boy-thump-gun')?.maximumSelectionsPerModels, 10);

  const battlewagon = catalog.unit('orks.battlewagon');
  assert.equal(battlewagon?.wargearChoices?.find(choice => choice.id === 'battlewagon-additional-big-shoota')?.maximumSelections, 4);

  const deffDread = catalog.unit('orks.deff-dread');
  assert.equal(deffDread?.wargearChoices?.filter(choice => choice.selectionMode === 'replacement-slot').length, 20);
  assert.equal(deffDread?.wargearChoices?.find(choice => choice.slotId === 'deff-dread-big-shoota-1')?.replacesWeaponNames?.[0], 'Big shoota');
  const materializedDeffDread = catalog.materializeUnit({ unitId: 'orks.deff-dread' }, { factionId: 'orks' });
  assert.deepEqual(materializedDeffDread.profile.modelWeaponLoadouts, [[0, 0, 4, 4, 5]]);
});

test('explicit empty model loadouts remain unarmed instead of falling back to every weapon', () => {
  const profile = {
    name: 'Test unit',
    move: 6,
    toughness: 4,
    save: 6,
    wounds: 1,
    leadership: 7,
    oc: 1,
    baseModelCount: 1,
    keywords: [],
    factionKeywords: [],
    weapons: [
      { name: 'Test weapon', range: 12, attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', keywords: [], isMelee: false },
    ],
    abilities: [],
    modelWeaponLoadouts: [[]],
  };

  assert.deepEqual(modelWeaponLoadout(profile, 0), []);
});

test('catalog materialization resolves rules, bases, loadouts, and army-list identity', () => {
  const catalog = loadOrkCatalog();
  const snikrot = catalog.materializeUnit({ unitId: 'orks.boss-snikrot' }, { factionId: 'orks' });

  assert.equal(snikrot.profile.rosterId, 'orks.boss-snikrot');
  assert.deepEqual(snikrot.profile.modelBases, [{ shape: 'round', diameterMm: 40 }]);
  assert.deepEqual(snikrot.profile.modelWeaponLoadouts, [[0, 1]]);
  assert.equal(snikrot.profile.abilities.find(rule => rule.ruleId === 'kunnin-infiltrator')?.sourceRuleId, 'orks.unit-rule.kunnin-infiltrator');
  assert.equal(snikrot.profile.abilities.find(rule => rule.ruleId === 'orks.unit-rule.red-skull-kommandos'), undefined);
  assert.match(snikrot.warnings.join(' '), /raw abilities/);

  const boyz = catalog.materializeUnit({ unitId: 'orks.boyz', instanceId: 'boyz-alpha', modelCount: 20 }, { factionId: 'orks' });
  assert.equal(boyz.profile.rosterId, 'boyz-alpha');
  assert.equal(boyz.profile.baseModelCount, 20);
  assert.equal(boyz.profile.modelBases?.length, 20);
  assert.deepEqual(boyz.profile.modelBases?.[0], { shape: 'round', diameterMm: 40, label: 'Boss Nob' });
  assert.equal(boyz.profile.modelBases?.slice(1).every(base => base.shape === 'round' && base.diameterMm === 32), true);
  assert.equal(boyz.profile.modelWeaponLoadouts?.length, 20);
  assert.deepEqual(boyz.profile.modelWeaponLoadouts?.[0], [7, 8]);
  assert.deepEqual(boyz.profile.modelWeaponLoadouts?.[10], [7, 9]);
  assert.deepEqual(boyz.profile.modelWeaponLoadouts?.[19], [7, 9]);
  assert.equal(boyz.profile.wargearChoices?.find(choice => choice.id === 'boy-big-shoota')?.maximumSelectionsPerModels, 10);
  assert.equal(boyz.profile.wargearChoices?.find(choice => choice.id === 'boy-rokkit')?.limitGroup, 'boy-heavy-weapon');

  const squighog = catalog.materializeUnit({ unitId: 'orks.squighog-boyz', modelCount: 4 }, { factionId: 'orks' });
  assert.deepEqual(squighog.profile.modelBases?.[0], {
    shape: 'oval', widthMm: 90, lengthMm: 52.5, label: 'Nob on Smasha Squig',
  });
  assert.equal(squighog.profile.modelBases?.slice(1).every(base =>
    base.shape === 'oval' && base.widthMm === 75 && base.lengthMm === 42,
  ), true);
  assert.deepEqual(modelWeaponLoadout(squighog.profile, 0), [1, 3, 5]);
  assert.deepEqual(modelWeaponLoadout(squighog.profile, 1), [0, 2, 4, 5]);

  const largeSquighog = catalog.materializeUnit({ unitId: 'orks.squighog-boyz', modelCount: 8 }, { factionId: 'orks' });
  assert.deepEqual(largeSquighog.profile.modelBases?.[7], {
    shape: 'oval', widthMm: 90, lengthMm: 52.5, label: 'Nob on Smasha Squig',
  });

  const nobz = catalog.materializeUnit({ unitId: 'orks.nobz' }, { factionId: 'orks' });
  assert.equal(nobz.profile.wargearChoices?.find(choice => choice.id === 'ammo-runt')?.description, 'For every 5 models in this unit, this unit can be equipped with 1 ammo runt.');
  assert.deepEqual(nobz.profile.selectedWargear, ['ammo-runt']);

  const largeNobz = catalog.materializeUnit({ unitId: 'orks.nobz', modelCount: 10 }, { factionId: 'orks' });
  assert.deepEqual(largeNobz.profile.selectedWargear, ['ammo-runt', 'ammo-runt']);

  const trukk = catalog.materializeUnit({
    unitId: 'orks.trukk',
    selectedWargear: ['wreckin-ball'],
  }, { factionId: 'orks' });
  assert.equal(trukk.profile.wargearChoices?.[0]?.id, 'wreckin-ball');
  assert.deepEqual(trukk.profile.selectedWargear, ['wreckin-ball']);

  const ghaz = catalog.materializeUnit({ unitId: 'orks.ghazghkull-thraka' }, { factionId: 'orks' });
  assert.deepEqual(ghaz.profile.modelBases?.map(base => base.label), ['Ghazghkull Thraka', 'Makari']);
  assert.equal(ghaz.profile.modelProfiles?.[1]?.save, 7);

  const army = catalog.materializeArmy({
    name: 'Catalog Orks',
    factionId: 'orks',
    selections: [
      { unitId: 'orks.boyz', modelCount: 10 },
      { unitId: 'orks.boyz', modelCount: 10 },
    ],
  });
  assert.deepEqual(army.army.units.map(unit => unit.rosterId), ['orks.boyz-1', 'orks.boyz-2']);
  assert.equal(army.army.sourceEdition, '11e');
  assert.equal(army.catalog.catalogRevision, '2026-08-29.1');
  assert.equal(validateImportedArmy(army.army).valid, true);
});

test('catalog runtime rules replace matching hardcoded definitions without per-unit branches', () => {
  const catalog = loadOrkCatalog();
  const rules = rulesEditionWithCatalog(rules40K11th, catalog, { factionId: 'orks' });
  const waaagh = rules.unitAbilities.find(ability => ability.id === 'waaagh');
  const kunnin = rules.unitAbilities.find(ability => ability.id === 'kunnin-infiltrator');
  const grotRiggers = rules.unitAbilities.find(ability => ability.id === 'grot-riggers');

  assert.equal(waaagh?.effects?.[0]?.type, 'activate-army-ability');
  assert.equal(kunnin?.effects?.[0]?.type, 'move-to-strategic-reserves');
  assert.equal(grotRiggers?.automatic, true);
  assert.equal(rules.unitAbilities.filter(ability => ability.id === 'waaagh').length, 1);
});

test('unsupported detachment Stratagems remain queryable but are not executable runtime rules', () => {
  const catalog = loadOrkCatalog();
  const warHordeStratagems = catalog.stratagemsForContext({
    factionId: 'orks',
    detachmentId: 'orks.detachment.war-horde',
  });

  assert.equal(warHordeStratagems.length, 6);
  assert.equal(warHordeStratagems.every(stratagem => stratagem.status === 'unsupported'), true);
  assert.equal(catalog.runtimeStratagems({ factionId: 'orks', detachmentId: 'orks.detachment.war-horde' }).length, 0);
  assert.equal(rulesEditionWithCatalog(
    rules40K11th,
    catalog,
    { factionId: 'orks', detachmentId: 'orks.detachment.war-horde' },
  ).stratagems.some(stratagem => stratagem.id === 'orks.stratagem.war-horde.careen'), false);
});

test('catalog materialization fails closed for illegal model counts', () => {
  const catalog = loadOrkCatalog();

  assert.throws(
    () => catalog.materializeUnit({ unitId: 'orks.boyz', modelCount: 15 }, { factionId: 'orks' }),
    (error: unknown) => error instanceof CatalogMaterializationError && /does not allow.*15/.test(error.message),
  );
  assert.throws(
    () => catalog.materializeUnit({ unitId: 'orks.boyz' }, {
      factionId: 'orks',
      catalog: { catalogId: 'warhammer-40k', edition: '11e', catalogRevision: 'old-revision' },
    }),
    /does not match/,
  );
});

test('Legends are excluded by default and opt-in only', () => {
  const base = loadOrkCatalog();
  const legendId = 'orks.legend-test';
  const legend = { ...base.bundle.units[0]!, id: legendId, name: 'Legend Test', status: 'legend' as const };
  const bundle = {
    ...base.bundle,
    units: [...base.bundle.units, legend],
    factions: base.bundle.factions.map(faction => ({
      ...faction,
      unitRefs: [...faction.unitRefs, legendId],
    })),
  };

  assert.equal(new CatalogRegistry(bundle).unitsForFaction('orks').length, 58);
  assert.equal(new CatalogRegistry(bundle, { includeLegends: true }).unitsForFaction('orks').length, 59);
});
