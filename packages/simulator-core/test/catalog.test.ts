import test from 'node:test';
import assert from 'node:assert/strict';
import { rules40K11th } from '../src/engine/rulesEngine';
import { validateImportedArmy } from '../src/engine/armyValidation';
import { modelWeaponLoadout } from '../src/engine/unitModelState';
import { unitLoadoutOptions } from '../src/engine/unitLoadouts';
import {
  CatalogRegistry,
  CatalogMaterializationError,
  loadNecronCatalog,
  loadOrkCatalog,
  rulesEditionWithCatalog,
} from '../src/engine/catalog';

test('the Ork catalog exposes every current non-Legends datasheet and aliases', () => {
  const catalog = loadOrkCatalog();

  assert.equal(catalog.unitsForFaction('orks').length, 55);
  assert.equal(catalog.unitIdForName('orks', 'Boss-Snikrot'), 'orks.boss-snikrot');
  assert.equal(catalog.unitIdForName('orks', 'Boyz (x20)'), 'orks.boyz');
  assert.equal(catalog.manifest.catalogRevision, '2026-09-24.1');
  assert.equal(catalog.manifest.coverage?.sourceEntryCount, 55);
  assert.equal(catalog.manifest.coverage?.normalizedEntryCount, 55);
  assert.equal(catalog.faction('orks')?.detachmentRefs?.length, 15);
  assert.doesNotThrow(() => new CatalogRegistry(catalog.bundle, {
    expectedCatalogId: 'warhammer-40k',
    expectedEdition: '11e',
    expectedCatalogRevision: '2026-09-24.1',
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
  const combinedDetachmentRules = catalog.rulesForContext({
    factionId: 'necrons',
    detachmentIds: [
      'necrons.detachment.awakened-dynasty',
      'necrons.detachment.annihilation-legion',
    ],
  });
  assert.equal(combinedDetachmentRules.filter(rule => rule.kind === 'detachment-rule').length, 2);
  assert.equal(combinedDetachmentRules.filter(rule => rule.kind === 'stratagem').length, 12);

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

test('Lokhust Lord retains the Lord\'s blade alongside the Staff of light melee profile', () => {
  const catalog = loadNecronCatalog();
  const lord = catalog.materializeUnit({ unitId: 'necrons.lokhust-lord' }, { factionId: 'necrons' });

  assert.deepEqual(modelWeaponLoadout(lord.profile, 0), [0, 1, 2]);
  assert.deepEqual(
    modelWeaponLoadout(lord.profile, 0)
      .map(weaponIndex => lord.profile.weapons[weaponIndex])
      .filter(weapon => weapon.isMelee)
      .map(weapon => weapon.name),
    ["Lord's blade", 'Staff of light'],
  );
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

test('refreshed Ork profiles expose source-derived default loadouts', () => {
  const catalog = loadOrkCatalog();
  const definitions = catalog.unitsForFaction('orks');
  assert.ok(definitions.some(unit => unit.profile.modelWeaponLoadouts?.length));
  for (const definition of definitions) {
    for (const loadout of definition.profile.modelWeaponLoadouts ?? []) {
      assert.ok(loadout.every(index => index >= 0 && index < definition.profile.weapons.length), `${definition.name} has valid loadout indexes`);
    }
  }
});

test('Ork weapon keywords retain source quantities and target qualifiers', () => {
  const catalog = loadOrkCatalog();
  const flashGitz = catalog.materializeUnit({ unitId: 'orks.flash-gitz' }, { factionId: 'orks' }).profile;
  const dakka = flashGitz.weapons.find(weapon => weapon.name === 'Snazzgun - Dakka');
  assert.deepEqual(dakka?.keywords, ['Lethal Hits: non-MONSTER/VEHICLE', 'Sustained Hits 1']);
  assert.equal(flashGitz.wargearChoices?.some(choice => choice.id === 'ammo-runt') ?? false, false);

  const warboss = catalog.materializeUnit({ unitId: 'orks.warboss' }, { factionId: 'orks' }).profile;
  assert.ok(warboss.weapons.some(weapon => weapon.name === 'Kustom Choppa' && weapon.keywords.includes('Cleave 2')));

  const keywordValues = catalog.unitsForFaction('orks').flatMap(unit => unit.profile.weapons.flatMap(weapon => weapon.keywords));
  assert.ok(keywordValues.includes('Close-Quarters'));
  assert.ok(keywordValues.includes('Anti-MONSTER/VEHICLE 4+'));
});

test('Ork points retain repeated-unit brackets from the source data', () => {
  const catalog = loadOrkCatalog();
  assert.deepEqual(catalog.unit('orks.big-mek-with-shokk-attack-gun')?.points, [
    { modelCount: 1, points: 95, unitNumber: { minimum: 1, maximum: 1 } },
    { modelCount: 1, points: 105, unitNumber: { minimum: 2 } },
  ]);
  assert.deepEqual(catalog.unit('orks.big-mek')?.points, [
    { modelCount: 1, points: 85, unitNumber: { minimum: 1, maximum: 2 } },
    { modelCount: 1, points: 95, unitNumber: { minimum: 3 } },
  ]);
});

test('catalog enhancement queries restrict model and unit enhancements generically', () => {
  const catalog = loadOrkCatalog();
  const warHorde = { factionId: 'orks', detachmentId: 'orks.detachment.war-horde' };
  const warboss = catalog.materializeUnit({ unitId: 'orks.warboss' }, { factionId: 'orks' }).profile;
  const boyz = catalog.materializeUnit({ unitId: 'orks.boyz' }, { factionId: 'orks' }).profile;

  assert.ok(catalog.enhancementsForUnit(warHorde, warboss).some(rule => rule.name === "Headwoppa's Killchoppa"));
  assert.equal(catalog.enhancementsForUnit(warHorde, boyz).length, 0);

  const greenTide = { factionId: 'orks', detachmentId: 'orks.detachment.green-tide' };
  assert.ok(catalog.enhancementsForUnit(greenTide, boyz).some(rule => rule.name === "'ArdboyzUPGRADE"));

  const dreadMob = { factionId: 'orks', detachmentId: 'orks.detachment.dread-mob' };
  const dakkarig = catalog.materializeUnit({ unitId: 'orks.big-mek-dakkarig' }, { factionId: 'orks' }).profile;
  assert.deepEqual(dakkarig.keywords, ['VEHICLE', 'BIG MEK', 'CHARACTER', 'WALKER']);
  const dakkarigEnhancements = catalog.enhancementsForUnit(dreadMob, dakkarig);
  assert.ok(dakkarigEnhancements.some(rule => rule.name === 'Cybork Boosta'));
  const dreadherder = dakkarigEnhancements.find(rule => rule.name === 'Dreadherder');
  assert.ok(dreadherder);
  assert.match(dreadherder?.description ?? '', /This model has Lone Operative/);
  assert.match(dreadherder?.description ?? '', /re-roll hit rolls of 1 until the end of the turn/);

  const weirdboy = catalog.materializeUnit({ unitId: 'orks.weirdboy' }, { factionId: 'orks' }).profile;
  const shootaBoyz = { factionId: 'orks', detachmentId: 'orks.detachment.shoota-boyz' };
  assert.equal(
    catalog.enhancementsForUnit(shootaBoyz, weirdboy).some(rule => rule.name === 'Supa-glowy Fing'),
    false,
  );
});

test('catalog enhancements retain their source-defined army selection limits', () => {
  const catalog = loadOrkCatalog();
  const blitzBrigade = catalog.enhancementsForContext({
    factionId: 'orks',
    detachmentId: 'orks.detachment.blitz-brigade',
  });
  const targetinGizmos = blitzBrigade.find(rule => rule.name === "Targetin' GizmosUPGRADE");
  const bossBoomer = blitzBrigade.find(rule => rule.name === 'Boss BoomerUPGRADE');
  const ordinaryEnhancement = catalog.enhancementsForContext({
    factionId: 'orks',
    detachmentId: 'orks.detachment.war-horde',
  }).find(rule => rule.name === "Headwoppa's Killchoppa");

  assert.equal(targetinGizmos?.maximumSelections, 3);
  assert.equal(bossBoomer?.maximumSelections, 3);
  assert.equal(ordinaryEnhancement?.maximumSelections, undefined);
});

test('catalog enhancements retain nested source rule text across factions', () => {
  const catalog = loadNecronCatalog();
  const awakenedDynasty = catalog.rulesForContext({
    factionId: 'necrons',
    detachmentId: 'necrons.detachment.awakened-dynasty',
  });
  const phaeronsArmoury = catalog.rulesForContext({
    factionId: 'necrons',
    detachmentId: 'necrons.detachment.the-phaerons-armoury',
  });
  const veilOfDarkness = awakenedDynasty.find(rule => rule.name === 'Veil of Darkness');
  const relocationalOptimiser = phaeronsArmoury.find(rule => rule.name === 'Relocational Optimiser');

  assert.match(veilOfDarkness?.description ?? '', /This unit has Deep Strike until the start of your next Shooting phase/);
  assert.match(relocationalOptimiser?.description ?? '', /\[SUSTAINED HITS 1\]/);
});

test('current Ork character datasheets retain source keywords and named abilities', () => {
  const catalog = loadOrkCatalog();
  const characterDefinitions = catalog.unitsForFaction('orks').filter(definition =>
    /character/i.test(definition.role ?? '')
    || definition.profile.keywords.some(keyword => keyword.trim().toLowerCase() === 'character'),
  );

  assert.ok(characterDefinitions.length >= 16);
  for (const definition of characterDefinitions) {
    const result = catalog.materializeUnit({ unitId: definition.id }, { factionId: 'orks' });
    assert.ok(result.profile.keywords.length > 0, `${definition.name} has source keywords`);
    assert.ok(
      result.profile.keywords.some(keyword => keyword.trim().toLowerCase() === 'character'),
      `${definition.name} retains the CHARACTER keyword`,
    );
    assert.ok(result.profile.weapons.length > 0, `${definition.name} has weapons`);
    assert.ok(
      result.profile.abilities.some(rule => rule.category === 'datasheet' && rule.name !== 'Datasheet abilities'),
      `${definition.name} has named datasheet abilities`,
    );
    if (definition.leaderTargetRefs?.length) {
      assert.equal(definition.leaderTargetRefs.length, definition.leaderTargetNames?.length, `${definition.name} leader metadata is paired`);
      assert.ok(
        definition.leaderTargetRefs.every(targetId => catalog.unit(targetId)),
        `${definition.name} leader targets resolve in the catalog`,
      );
    }
  }
});

test('catalog materializes datasheet wargear options for units with loadout choices', () => {
  const catalog = loadOrkCatalog();
  const battlewagon = catalog.materializeUnit({ unitId: 'orks.battlewagon' }, { factionId: 'orks' }).profile;
  const gunwagon = catalog.materializeUnit({ unitId: 'orks.gunwagon' }, { factionId: 'orks' }).profile;

  assert.deepEqual(battlewagon.wargearChoices?.map(choice => choice.label), [
    'Wargear: Wreckin\' Ball',
    'Wargear: Big Shoota',
    'Wargear: Grabbin\' Klaw',
  ]);
  assert.ok(battlewagon.wargearChoices?.every(choice => choice.kind === 'unit-upgrade'));
  assert.deepEqual(
    modelWeaponLoadout(battlewagon, 0).map(weaponIndex => battlewagon.weapons[weaponIndex]?.name),
    ["Crushin' Bulk"],
  );
  assert.deepEqual(battlewagon.wargearOptions, [
    "This model can be equipped with 1 Wreckin' Ball.",
    'This model can be equipped with up to 4 Big Shoota.',
    "This model can be equipped with 1 Grabbin' Klaw.",
  ]);
  assert.equal(
    battlewagon.wargearChoices?.find(choice => choice.weaponNames?.includes('Big Shoota'))?.maximumSelections,
    4,
  );
  assert.ok(gunwagon.wargearChoices?.some(choice => choice.weaponNames?.includes('Killkannon')));
  assert.ok(gunwagon.wargearChoices?.some(choice => choice.weaponNames?.includes('Zzap Gun')));
});

test('catalog shares model loadout pools across source options that compete for the same models', () => {
  const catalog = loadOrkCatalog();
  const kommandos = catalog.materializeUnit({ unitId: 'orks.kommandos' }, { factionId: 'orks' }).profile;
  const kommandoChoices = kommandos.wargearChoices?.filter(choice => choice.eligibleModelIndexes?.every(index => index < 9)) ?? [];
  assert.equal(new Set(kommandoChoices.map(choice => choice.slotId)).size, 1);
  assert.equal(kommandoChoices.filter(choice => choice.isDefault).length, 1);
  assert.equal(kommandoChoices.length, 5);
  assert.deepEqual(kommandoChoices.find(choice => choice.isDefault)?.weaponNames, ['Choppa', 'Slugga']);
  assert.equal(kommandoChoices.find(choice => choice.isDefault)?.label, 'Wargear: Choppa + Slugga');
  assert.equal(
    kommandoChoices.find(choice => choice.description?.includes('1 Rokkit Launcha'))?.label,
    'Wargear: Choppa + Slugga + Rokkit Launcha',
  );

  const breakaBoyz = catalog.materializeUnit({ unitId: 'orks.breaka-boyz' }, { factionId: 'orks' }).profile;
  const breakaChoices = breakaBoyz.wargearChoices?.filter(choice => choice.eligibleModelIndexes?.every(index => index < 5)) ?? [];
  assert.equal(new Set(breakaChoices.map(choice => choice.slotId)).size, 1);
  assert.equal(breakaChoices.filter(choice => choice.isDefault).length, 1);
  assert.equal(breakaChoices.length, 3);
});

test('wargear choices hold model loadout alternatives without separate unit presets', () => {
  const catalog = loadOrkCatalog();
  const tankbustas = catalog.materializeUnit({ unitId: 'orks.tankbustas' }, { factionId: 'orks' }).profile;
  assert.equal(tankbustas.unitLoadoutOptions, undefined);
  assert.ok(tankbustas.wargearChoices?.some(choice => choice.isDefault && choice.label.includes('Busta Rokkit Launcha')));
  assert.equal(
    tankbustas.wargearChoices?.find(choice => choice.weaponNames?.includes('Pulsa Rokkit'))?.maximumSelections,
    1,
  );
  assert.equal(
    tankbustas.wargearChoices?.find(choice => choice.weaponNames?.includes('Pulsa Rokkit'))?.selectionMode,
    'replacement-slot',
  );
  const doubleRokkitChoice = tankbustas.wargearChoices?.find(choice =>
    choice.weaponNames?.filter(name => name === 'Busta Rokkit Launcha - Standard').length === 2,
  );
  assert.equal(doubleRokkitChoice?.maximumSelections, 1);
  assert.equal(doubleRokkitChoice?.selectionMode, 'replacement-slot');
  assert.deepEqual(doubleRokkitChoice?.replacesWeaponNames, ['Busta Rokkit Launcha - Standard']);
  assert.deepEqual(
    tankbustas.wargearChoices?.find(choice => choice.weaponNames?.includes('Pulsa Rokkit'))?.replacesWeaponNames,
    ['Busta Rokkit Launcha - Standard'],
  );
  assert.deepEqual(
    tankbustas.wargearChoices?.find(choice => choice.isDefault && choice.label.includes('Busta Rokkit Launcha'))?.eligibleModelIndexes,
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    tankbustas.wargearChoices?.find(choice => choice.isDefault && choice.label === 'Wargear: Rokkit Pistol')?.eligibleModelIndexes,
    [5],
  );
  assert.ok(tankbustas.wargearChoices?.some(choice => choice.label === 'Wargear: Smash Hammer'));

  const gretchin = catalog.materializeUnit({ unitId: 'orks.gretchin' }, { factionId: 'orks' }).profile;
  assert.deepEqual(unitLoadoutOptions(gretchin).map(option => option.label), ['10', '20']);
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
  assert.deepEqual(snikrot.profile.leaderTargetNames, ['KOMMANDOS']);
  assert.deepEqual(snikrot.profile.leaderTargetRefs, ['orks.kommandos']);
  assert.deepEqual(snikrot.profile.modelBases, [{ shape: 'round', diameterMm: 40 }]);
  assert.deepEqual(snikrot.profile.modelWeaponLoadouts, [[1, 0]]);
  assert.equal(snikrot.profile.weapons.find(weapon => weapon.name === "Mork's Teef")?.damage, '2');
  assert.match(snikrot.warnings.join(' '), /raw abilities/);

  const boyz = catalog.materializeUnit({ unitId: 'orks.boyz', instanceId: 'boyz-alpha', modelCount: 20 }, { factionId: 'orks' });
  assert.equal(boyz.profile.rosterId, 'boyz-alpha');
  assert.equal(boyz.profile.baseModelCount, 20);
  assert.equal(boyz.profile.modelBases?.length, 20);
  assert.deepEqual(boyz.profile.modelBases?.[0], { shape: 'round', diameterMm: 40, label: 'Boss Nob' });
  assert.equal(boyz.profile.modelBases?.slice(1).every(base => base.shape === 'round' && base.diameterMm === 32), true);
  assert.equal(boyz.profile.modelWeaponLoadouts?.length, 20);
  assert.equal(boyz.profile.modelProfiles?.find(profile => profile.name === 'Nob')?.wounds, 3);

  const squighog = catalog.materializeUnit({ unitId: 'orks.squighog-boyz', modelCount: 4 }, { factionId: 'orks' });
  assert.deepEqual(squighog.profile.modelBases?.[0], {
    shape: 'oval', widthMm: 90, lengthMm: 52.5, label: 'Nob on Smasha Squig',
  });
  assert.equal(squighog.profile.modelBases?.slice(1).every(base =>
    base.shape === 'oval' && base.widthMm === 75 && base.lengthMm === 42,
  ), true);
  assert.equal(squighog.profile.modelProfiles?.find(profile => profile.name === 'Nob on Smasha Squig')?.wounds, 4);

  const largeSquighog = catalog.materializeUnit({ unitId: 'orks.squighog-boyz', modelCount: 8 }, { factionId: 'orks' });
  assert.deepEqual(largeSquighog.profile.modelBases?.[7], {
    shape: 'oval', widthMm: 90, lengthMm: 52.5, label: 'Nob on Smasha Squig',
  });

  const trukk = catalog.materializeUnit({ unitId: 'orks.trukk' }, { factionId: 'orks' });
  assert.equal(trukk.profile.transportCapacity, 12);

  const battlewagon = catalog.materializeUnit({ unitId: 'orks.battlewagon' }, { factionId: 'orks' });
  assert.deepEqual(battlewagon.profile.modelBases, [{
    shape: 'hull', widthMm: 90, lengthMm: 180, footprint: 'rectangle', label: 'Hull (approx.)',
  }]);

  const ghaz = catalog.materializeUnit({ unitId: 'orks.ghazghkull-thraka' }, { factionId: 'orks' });
  assert.deepEqual(ghaz.profile.modelBases, [{ shape: 'round', diameterMm: 80 }]);

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
  assert.equal(army.catalog.catalogRevision, '2026-09-24.1');
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

  assert.equal(new CatalogRegistry(bundle).unitsForFaction('orks').length, 55);
  assert.equal(new CatalogRegistry(bundle, { includeLegends: true }).unitsForFaction('orks').length, 56);
});
