import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const sourcePath = resolve(root, 'docs/ORKS_WAHAPEDIA_REFERENCE.md');
const unitPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/units/orks.json');
const factionPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/factions/orks.json');
const manifestPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/manifest.json');

const source = await readFile(sourcePath, 'utf8');
const catalog = JSON.parse(await readFile(unitPath, 'utf8'));
const faction = JSON.parse(await readFile(factionPath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const unitsById = new Map(catalog.units.map(unit => [unit.id, unit]));

const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[\u2019\u2018`']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function sourceSection(name) {
  const marker = `### ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const end = source.indexOf('\n### ', start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function sourceWargearOptions(name) {
  const section = sourceSection(name);
  const heading = '#### Wargear options';
  const start = section.indexOf(heading);
  if (start < 0) return [];
  const rest = section.slice(start + heading.length);
  const end = rest.search(/\n#### /);
  return (end < 0 ? rest : rest.slice(0, end))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim());
}

function weaponIndexes(unit, names) {
  return names.map(name => {
    const index = unit.profile.weapons.findIndex(weapon => weapon.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (index < 0) throw new Error(`${unit.name}: weapon ${name} is not present in the profile.`);
    return index;
  });
}

function modelChoice(id, label, eligibleModelIndexes, weaponNames, extra = {}) {
  return {
    id,
    label,
    kind: 'model-loadout',
    eligibleModelIndexes,
    weaponNames,
    ...extra,
  };
}

function unitUpgrade(id, label, weaponNames, extra = {}) {
  return {
    id,
    label,
    kind: 'unit-upgrade',
    ...(weaponNames ? { weaponNames } : {}),
    ...extra,
  };
}

function replacementSlot(slotId, label, replacesWeaponName, replacementNames) {
  return replacementNames.map(weaponName => modelChoice(
    `${slotId}-${slug(weaponName)}`,
    `${label}: ${weaponName}`,
    [0],
    [weaponName],
    {
      selectionMode: 'replacement-slot',
      slotId,
      replacesWeaponNames: [replacesWeaponName],
      maximumSelections: 1,
    },
  ));
}

function loadout(unit, names) {
  return weaponIndexes(unit, names);
}

function repeatedLoadout(unit, count, names) {
  return Array.from({ length: count }, () => loadout(unit, names));
}

function configure(id, choices, options = {}) {
  const unit = unitsById.get(id);
  if (!unit) throw new Error(`Missing Ork catalog unit ${id}.`);
  for (const choice of choices) {
    if (choice.weaponNames) weaponIndexes(unit, choice.weaponNames);
    if (choice.replacesWeaponNames) weaponIndexes(unit, choice.replacesWeaponNames);
  }
  unit.wargearChoices = choices;
  if (options.loadouts) unit.profile.modelWeaponLoadouts = options.loadouts;
  unit.modelCount ??= { minimum: unit.profile.baseModelCount };
  if (options.maximumModelCount !== undefined) unit.modelCount.maximum = options.maximumModelCount;
  if (options.step !== undefined) unit.modelCount.step = options.step;
  const optionsText = sourceWargearOptions(unit.name);
  if (optionsText.length) unit.wargearOptions = optionsText;
}

const bossSnagga = unitsById.get('orks.beast-snagga-boyz');
configure('orks.beastboss-on-squigosaur', [
  unitUpgrade('thump-gun', 'Thump gun', ['Thump gun'], { maximumSelections: 1 }),
], { maximumModelCount: 1 });
configure('orks.beast-snagga-boyz', [
  modelChoice('beast-snagga-nob-standard', 'Beast Snagga Nob: slugga and power snappa', [0], ['Slugga', 'Power snappa'], {
    maximumSelections: 1,
    limitGroup: 'beast-snagga-nob',
  }),
  modelChoice('beast-snagga-boy-standard', 'Beast Snagga Boy: slugga and choppa', range(1, 19), ['Slugga', 'Choppa']),
  modelChoice('beast-snagga-boy-thump-gun', 'Beast Snagga Boy: thump gun and close combat weapon', range(1, 19), ['Thump gun', 'Close combat weapon'], {
    maximumSelectionsPerModels: 10,
    limitGroup: 'beast-snagga-special',
  }),
], {
  maximumModelCount: 20,
  step: 10,
  loadouts: [
    loadout(bossSnagga, ['Slugga', 'Power snappa']),
    ...repeatedLoadout(bossSnagga, 9, ['Slugga', 'Choppa']),
  ],
});

configure('orks.burna-bommer', [
  unitUpgrade('skorcha-missile-rack', 'Skorcha missile rack', ['Skorcha missile rack'], { maximumSelections: 1 }),
], { maximumModelCount: 1 });
const dakkajet = unitsById.get('orks.dakkajet');
configure('orks.dakkajet', [
  modelChoice('dakkajet-standard', 'Dakkajet: 2 twin supa-shootas', [0], ['Twin supa-shoota', 'Twin supa-shoota', 'Armoured hull'], { maximumSelections: 1 }),
  modelChoice('dakkajet-additional-shoota', 'Dakkajet: 3 twin supa-shootas', [0], ['Twin supa-shoota', 'Twin supa-shoota', 'Twin supa-shoota', 'Armoured hull'], { maximumSelections: 1 }),
], { maximumModelCount: 1, loadouts: [loadout(dakkajet, ['Twin supa-shoota', 'Twin supa-shoota', 'Armoured hull'])] });
const wazbom = unitsById.get('orks.wazbom-blastajet');
configure('orks.wazbom-blastajet', [
  modelChoice('wazbom-mega-kannon', 'Wazbom: twin wazbom mega-kannon', [0], ['Smasha gun', 'Twin wazbom mega-kannon', 'Armoured hull'], { maximumSelections: 1, limitGroup: 'wazbom-primary' }),
  modelChoice('wazbom-tellyport-mega-blasta', 'Wazbom: twin tellyport mega-blasta', [0], ['Smasha gun', 'Twin tellyport mega-blasta', 'Armoured hull'], { maximumSelections: 1, limitGroup: 'wazbom-primary' }),
  unitUpgrade('blastajet-force-field', 'Blastajet force field', undefined, { maximumSelections: 1, limitGroup: 'wazbom-utility' }),
  unitUpgrade('twin-supa-shoota', 'Twin supa-shoota', ['Twin supa-shoota'], { maximumSelections: 1 }),
], { maximumModelCount: 1, loadouts: [loadout(wazbom, ['Smasha gun', 'Twin wazbom mega-kannon', 'Armoured hull'])] });

const breaka = unitsById.get('orks.breaka-boyz');
configure('orks.breaka-boyz', [
  modelChoice('breaka-boss-smash-hammer', 'Boss Nob: rokkit pistol, smash hammer and choppa', [0], ['Rokkit pistol', 'Smash hammer', 'Choppa'], { maximumSelections: 1, limitGroup: 'breaka-boss' }),
  modelChoice('breaka-boss-rokkit-pistol', 'Boss Nob: 2 rokkit pistols and choppa', [0], ['Rokkit pistol', 'Rokkit pistol', 'Choppa'], { maximumSelections: 1, limitGroup: 'breaka-boss' }),
  modelChoice('breaka-smash-hammer', 'Breaka Boy: smash hammer', range(1, 5), ['Smash hammer']),
  modelChoice('breaka-knucklebustas', 'Breaka Boy: knucklebustas', range(1, 5), ['Knucklebustas'], { maximumSelections: 1 }),
  modelChoice('breaka-tankhammer', 'Breaka Boy: tankhammer', range(1, 5), ['Tankhammer'], { maximumSelections: 1 }),
], {
  maximumModelCount: 6,
  loadouts: [loadout(breaka, ['Rokkit pistol', 'Smash hammer', 'Choppa']), ...repeatedLoadout(breaka, 5, ['Smash hammer'])],
});

const burnaBoyz = unitsById.get('orks.burna-boyz');
configure('orks.burna-boyz', [
  modelChoice('burna-spanner-big-shoota', 'Spanner: big shoota and close combat weapon', [0, 5], ['Big shoota', 'Close combat weapon']),
  modelChoice('burna-spanner-kustom-mega-blasta', 'Spanner: kustom mega-blasta and close combat weapon', [0, 5], ['Kustom mega-blasta', 'Close combat weapon']),
  modelChoice('burna-spanner-rokkit-launcha', 'Spanner: rokkit launcha and close combat weapon', [0, 5], ['Rokkit launcha', 'Close combat weapon']),
  modelChoice('burna-boy', 'Burna Boy: burna and cuttin\' flames', [1, 2, 3, 4, 6, 7, 8, 9], ['Burna', "Cuttin' flames"]),
], {
  maximumModelCount: 10,
  step: 5,
  loadouts: [
    loadout(burnaBoyz, ['Big shoota', 'Close combat weapon']),
    ...repeatedLoadout(burnaBoyz, 4, ['Burna', "Cuttin' flames"]),
  ],
});
configure('orks.flash-gitz', [
  unitUpgrade('ammo-runt', 'Ammo runt', undefined, { maximumSelectionsPerModels: 5 }),
], { maximumModelCount: 10, step: 5 });

const lootas = unitsById.get('orks.lootas');
configure('orks.lootas', [
  modelChoice('loota-spanner-big-shoota', 'Spanner: big shoota and close combat weapon', [0, 5], ['Big shoota', 'Close combat weapon']),
  modelChoice('loota-spanner-kustom-mega-blasta', 'Spanner: kustom mega-blasta and close combat weapon', [0, 5], ['Kustom mega-blasta', 'Close combat weapon']),
  modelChoice('loota-spanner-rokkit-launcha', 'Spanner: rokkit launcha and close combat weapon', [0, 5], ['Rokkit launcha', 'Close combat weapon']),
  modelChoice('loota', 'Loota: deffgun and close combat weapon', [1, 2, 3, 4, 6, 7, 8, 9], ['Deffgun', 'Close combat weapon']),
], {
  maximumModelCount: 10,
  step: 5,
  loadouts: [
    loadout(lootas, ['Big shoota', 'Close combat weapon']),
    ...repeatedLoadout(lootas, 4, ['Deffgun', 'Close combat weapon']),
  ],
});

const meganobz = unitsById.get('orks.meganobz');
configure('orks.meganobz', [
  modelChoice('meganob-kustom-shoota-power-klaw', 'Meganob: kustom shoota and power klaw', range(0, 5), ['Kustom shoota', 'Power klaw']),
  modelChoice('meganob-kombi-power-klaw', 'Meganob: kombi-weapon and power klaw', range(0, 5), ['Kombi-weapon', 'Power klaw']),
  modelChoice('meganob-kombi-killsaw', 'Meganob: kombi-weapon and killsaw', range(0, 5), ['Kombi-weapon', 'Killsaw']),
  modelChoice('meganob-kustom-shoota-killsaw', 'Meganob: kustom shoota and killsaw', range(0, 5), ['Kustom shoota', 'Killsaw']),
  modelChoice('meganob-killsaw-power-klaw', 'Meganob: killsaw and power klaw', range(0, 5), ['Killsaw', 'Power klaw']),
  modelChoice('meganob-twin-killsaw', 'Meganob: twin killsaw', range(0, 5), ['Twin killsaw']),
], { maximumModelCount: 6, step: 1, loadouts: repeatedLoadout(meganobz, 2, ['Kustom shoota', 'Power klaw']) });

const nobz = unitsById.get('orks.nobz');
configure('orks.nobz', [
  modelChoice('nob-slugga-big-choppa', 'Nob: slugga and big choppa', range(0, 9), ['Slugga', 'Big choppa']),
  modelChoice('nob-slugga-power-klaw', 'Nob: slugga and power klaw', range(0, 9), ['Slugga', 'Power klaw']),
  modelChoice('nob-kombi-close-combat-weapon', 'Nob: kombi-weapon and close combat weapon', range(0, 9), ['Kombi-weapon', 'Close combat weapon']),
  unitUpgrade('ammo-runt', 'Ammo runt', undefined, { maximumSelectionsPerModels: 5 }),
], { maximumModelCount: 10, step: 5, loadouts: repeatedLoadout(nobz, 5, ['Slugga', 'Big choppa']) });

const stormboyz = unitsById.get('orks.stormboyz');
configure('orks.stormboyz', [
  modelChoice('stormboy-boss-choppa', 'Boss Nob: slugga and choppa', [0], ['Slugga', 'Choppa'], { maximumSelections: 1, limitGroup: 'stormboy-boss' }),
  modelChoice('stormboy-boss-power-klaw', 'Boss Nob: slugga and power klaw', [0], ['Slugga', 'Power klaw'], { maximumSelections: 1, limitGroup: 'stormboy-boss' }),
  modelChoice('stormboy', 'Stormboy: slugga and choppa', range(1, 9), ['Slugga', 'Choppa']),
], { maximumModelCount: 10, step: 5, loadouts: repeatedLoadout(stormboyz, 5, ['Slugga', 'Choppa']) });

const tankbustas = unitsById.get('orks.tankbustas');
configure('orks.tankbustas', [
  modelChoice('tankbusta-boss-smash-hammer', 'Boss Nob: rokkit pistol, smash hammer and choppa', [0], ['Rokkit pistol', 'Smash hammer', 'Choppa'], { maximumSelections: 1, limitGroup: 'tankbusta-boss' }),
  modelChoice('tankbusta-boss-rokkit-pistols', 'Boss Nob: 2 rokkit pistols and choppa', [0], ['Rokkit pistol', 'Rokkit pistol', 'Choppa'], { maximumSelections: 1, limitGroup: 'tankbusta-boss' }),
  modelChoice('tankbusta-standard', 'Tankbusta: rokkit launcha and close combat weapon', range(1, 5), ['Rokkit launcha', 'Close combat weapon']),
  modelChoice('tankbusta-additional-rokkit', 'Tankbusta: 2 rokkit launchas and close combat weapon', range(1, 5), ['Rokkit launcha', 'Rokkit launcha', 'Close combat weapon'], { maximumSelections: 1, limitGroup: 'tankbusta-special' }),
  unitUpgrade('tankbusta-pulsa-rokkit', 'Pulsa rokkit', undefined, { maximumSelections: 1, limitGroup: 'tankbusta-special' }),
], { maximumModelCount: 6, loadouts: [loadout(tankbustas, ['Rokkit pistol', 'Rokkit pistol', 'Choppa']), ...repeatedLoadout(tankbustas, 5, ['Rokkit launcha', 'Close combat weapon'])] });

const gargantuan = unitsById.get('orks.gargantuan-squiggoth');
configure('orks.gargantuan-squiggoth', [
  modelChoice('gargantuan-tusks', 'Gargantuan Squiggoth: huge tusks', [0], ['Huge tusks - strike', 'Huge tusks - sweep'], { maximumSelections: 1, limitGroup: 'gargantuan-primary' }),
  modelChoice('gargantuan-kannon-frag', 'Gargantuan Squiggoth: kannon', [0], ['Kannon - frag', 'Kannon - shell', 'Huge tusks - strike', 'Huge tusks - sweep'], { maximumSelections: 1, limitGroup: 'gargantuan-primary' }),
  modelChoice('gargantuan-supa-kannon', 'Gargantuan Squiggoth: supa-kannon', [0], ['Supa-kannon', 'Huge tusks - strike', 'Huge tusks - sweep'], { maximumSelections: 1, limitGroup: 'gargantuan-primary' }),
], { maximumModelCount: 1, loadouts: [loadout(gargantuan, ['Huge tusks - strike', 'Huge tusks - sweep'])] });

const squighog = unitsById.get('orks.squighog-boyz');
configure('orks.squighog-boyz', [
  modelChoice('squighog-nob', 'Nob on Smasha Squig: slugga, big choppa and squig jaws', [0, 7], ['Slugga', 'Big Choppa', 'Squig jaws']),
  modelChoice('squighog-boy', 'Squighog Boy: saddlegit weapons, stikka and squig jaws', range(1, 6), ['Saddlegit weapons', 'Stikka', 'Squig jaws']),
  unitUpgrade('bomb-squig', 'Bomb squig', undefined, { maximumSelectionsPerModels: 3 }),
], { maximumModelCount: 8, step: 4, loadouts: [
  loadout(squighog, ['Slugga', 'Big Choppa', 'Squig jaws']),
  ...repeatedLoadout(squighog, 3, ['Saddlegit weapons', 'Stikka', 'Squig jaws']),
] });

const warbikers = unitsById.get('orks.warbikers');
configure('orks.warbikers', [
  modelChoice('warbiker-boss-standard', 'Boss Nob on Warbike: twin dakkagun and close combat weapon', [0], ['Twin dakkagun', 'Close combat weapon'], { maximumSelections: 1, limitGroup: 'warbiker-boss' }),
  modelChoice('warbiker-boss-slugga', 'Boss Nob on Warbike: twin dakkagun, close combat weapon and slugga', [0], ['Twin dakkagun', 'Close combat weapon', 'Slugga'], { maximumSelections: 1, limitGroup: 'warbiker-boss' }),
  modelChoice('warbiker-boss-big-choppa', 'Boss Nob on Warbike: twin dakkagun, close combat weapon and big choppa', [0], ['Twin dakkagun', 'Close combat weapon', 'Big choppa'], { maximumSelections: 1, limitGroup: 'warbiker-boss' }),
  modelChoice('warbiker-boss-power-klaw', 'Boss Nob on Warbike: twin dakkagun, close combat weapon and power klaw', [0], ['Twin dakkagun', 'Close combat weapon', 'Power klaw'], { maximumSelections: 1, limitGroup: 'warbiker-boss' }),
  modelChoice('warbiker-standard', 'Warbiker: twin dakkagun and close combat weapon', range(1, 5), ['Twin dakkagun', 'Close combat weapon']),
  modelChoice('warbiker-slugga', 'Warbiker: twin dakkagun, close combat weapon and slugga', range(1, 5), ['Twin dakkagun', 'Close combat weapon', 'Slugga']),
  modelChoice('warbiker-choppa', 'Warbiker: twin dakkagun, close combat weapon and choppa', range(1, 5), ['Twin dakkagun', 'Close combat weapon', 'Choppa']),
], { maximumModelCount: 6, step: 3, loadouts: repeatedLoadout(warbikers, 3, ['Twin dakkagun', 'Close combat weapon']) });

const battlewagon = unitsById.get('orks.battlewagon');
configure('orks.battlewagon', [
  modelChoice('battlewagon-tracks', 'Battlewagon: tracks and wheels', [0], ['Tracks and wheels'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-deff-rolla', 'Battlewagon: deff rolla', [0], ['Deff rolla'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-kannon-tracks', 'Battlewagon: kannon and tracks and wheels', [0], ['Kannon - frag', 'Kannon - shell', 'Tracks and wheels'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-kannon-deff-rolla', 'Battlewagon: kannon and deff rolla', [0], ['Kannon - frag', 'Kannon - shell', 'Deff rolla'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-killkannon-tracks', 'Battlewagon: killkannon and tracks and wheels', [0], ['Killkannon', 'Tracks and wheels'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-killkannon-deff-rolla', 'Battlewagon: killkannon and deff rolla', [0], ['Killkannon', 'Deff rolla'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-zzap-tracks', 'Battlewagon: zzap gun and tracks and wheels', [0], ['Zzap gun', 'Tracks and wheels'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  modelChoice('battlewagon-zzap-deff-rolla', 'Battlewagon: zzap gun and deff rolla', [0], ['Zzap gun', 'Deff rolla'], { maximumSelections: 1, limitGroup: 'battlewagon-main' }),
  unitUpgrade('battlewagon-lobba', 'Lobba', ['Lobba'], { maximumSelections: 1 }),
  unitUpgrade('battlewagon-additional-big-shoota', 'Additional big shoota', ['Big shoota'], { maximumSelections: 4 }),
  unitUpgrade('battlewagon-ard-case', "'Ard case", undefined, { maximumSelections: 1 }),
  unitUpgrade('battlewagon-grabbin-klaw', "Grabbin' klaw", ["Grabbin' klaw"], { maximumSelections: 1 }),
  unitUpgrade('battlewagon-wreckin-ball', "Wreckin' ball", ["Wreckin' ball"], { maximumSelections: 1 }),
], { maximumModelCount: 1, loadouts: [loadout(battlewagon, ['Tracks and wheels'])] });

const deffkoptas = unitsById.get('orks.deffkoptas');
configure('orks.deffkoptas', [
  modelChoice('deffkopta-rokkits', "Deffkopta: kopta rokkits, slugga and spinnin' blades", range(0, 5), ['Kopta rokkits', 'Slugga', "Spinnin' blades"]),
  modelChoice('deffkopta-kustom-mega-blasta', "Deffkopta: kustom mega-blasta, slugga and spinnin' blades", range(0, 5), ['Kustom mega-blasta', 'Slugga', "Spinnin' blades"], { maximumSelectionsPerModels: 3, limitGroup: 'deffkopta-rokkit-replacement' }),
], { maximumModelCount: 6, step: 3, loadouts: repeatedLoadout(deffkoptas, 3, ['Kopta rokkits', 'Slugga', "Spinnin' blades"]) });

const mekGunz = unitsById.get('orks.mek-gunz');
configure('orks.mek-gunz', [
  modelChoice('mek-gun-smasha', 'Mek Gun: smasha gun and grot crew', range(0, 2), ['Smasha gun', 'Grot crew']),
  modelChoice('mek-gun-bubblechukka', 'Mek Gun: bubblechukka and grot crew', range(0, 2), ['Bubblechukka - big bubble', 'Bubblechukka - wobbly bubble', 'Bubblechukka - dense bubble', 'Grot crew']),
  modelChoice('mek-gun-kustom-mega-kannon', 'Mek Gun: kustom mega-kannon and grot crew', range(0, 2), ['Kustom mega-kannon', 'Grot crew']),
  modelChoice('mek-gun-traktor-kannon', 'Mek Gun: traktor kannon and grot crew', range(0, 2), ['Traktor kannon', 'Grot crew']),
], { maximumModelCount: 3, step: 1, loadouts: [loadout(mekGunz, ['Smasha gun', 'Grot crew'])] });

const deffDread = unitsById.get('orks.deff-dread');
configure('orks.deff-dread', [
  ...replacementSlot('deff-dread-big-shoota-1', 'Big shoota 1', 'Big shoota', ['Big shoota', 'Dread klaw', 'Kustom mega-blasta', 'Rokkit launcha', 'Skorcha']),
  ...replacementSlot('deff-dread-big-shoota-2', 'Big shoota 2', 'Big shoota', ['Big shoota', 'Dread klaw', 'Kustom mega-blasta', 'Rokkit launcha', 'Skorcha']),
  ...replacementSlot('deff-dread-klaw-1', 'Dread klaw 1', 'Dread klaw', ['Dread klaw', 'Big shoota', 'Kustom mega-blasta', 'Rokkit launcha', 'Skorcha']),
  ...replacementSlot('deff-dread-klaw-2', 'Dread klaw 2', 'Dread klaw', ['Dread klaw', 'Big shoota', 'Kustom mega-blasta', 'Rokkit launcha', 'Skorcha']),
], { maximumModelCount: 1, loadouts: [loadout(deffDread, ['Big shoota', 'Big shoota', 'Dread klaw', 'Dread klaw', 'Stompy feet'])] });

const killaKans = unitsById.get('orks.killa-kans');
configure('orks.killa-kans', [
  modelChoice('killa-kan-shoota', 'Killa Kan: kan shoota and kan klaw', range(0, 5), ['Kan shoota', 'Kan klaw']),
  modelChoice('killa-kan-grotzooka', 'Killa Kan: grotzooka and kan klaw', range(0, 5), ['Grotzooka', 'Kan klaw']),
  modelChoice('killa-kan-rokkit', 'Killa Kan: rokkit launcha and kan klaw', range(0, 5), ['Rokkit launcha', 'Kan klaw']),
  modelChoice('killa-kan-skorcha', 'Killa Kan: skorcha and kan klaw', range(0, 5), ['Skorcha', 'Kan klaw']),
], { maximumModelCount: 6, step: 3, loadouts: repeatedLoadout(killaKans, 3, ['Kan shoota', 'Kan klaw']) });

const bossbunka = unitsById.get('orks.biged-bossbunka');
configure('orks.biged-bossbunka', [
  modelChoice('bossbunka-gaze', "Big'ed Bossbunka: big shoota and Gaze of Gork", [0], ['Big shoota', 'Gaze of Gork - glare', 'Gaze of Gork - squint'], { maximumSelections: 1 }),
  unitUpgrade('bossbunka-additional-big-shoota', 'Additional big shoota', ['Big shoota'], { maximumSelections: 3 }),
], { maximumModelCount: 1, loadouts: [loadout(bossbunka, ['Big shoota', 'Gaze of Gork - glare', 'Gaze of Gork - squint'])] });

const bigMek = unitsById.get('orks.big-mek');
configure('orks.big-mek', [
  modelChoice('big-mek-standard', 'Big Mek: kustom mega-blasta and power klaw', [0], ['Kustom mega-blasta', 'Power klaw'], { maximumSelections: 1 }),
  modelChoice('big-mek-traktor-drilla', 'Big Mek: traktor blasta and drilla', [0], ['Traktor blasta', 'Drilla'], { maximumSelections: 1 }),
  modelChoice('big-mek-traktor-power-klaw', 'Big Mek: traktor blasta and power klaw', [0], ['Traktor blasta', 'Power klaw'], { maximumSelections: 1 }),
  modelChoice('big-mek-kustom-drilla', 'Big Mek: kustom mega-blasta and drilla', [0], ['Kustom mega-blasta', 'Drilla'], { maximumSelections: 1 }),
], { maximumModelCount: 1, loadouts: [loadout(bigMek, ['Kustom mega-blasta', 'Power klaw'])] });

const megaMek = unitsById.get('orks.big-mek-in-mega-armour');
configure('orks.big-mek-in-mega-armour', [
  modelChoice('mega-mek-kustom-mega-blasta', 'Big Mek in Mega Armour: kustom mega-blasta and power klaw', [0], ['Kustom mega-blasta', 'Power klaw'], { maximumSelections: 1, limitGroup: 'mega-mek-primary' }),
  modelChoice('mega-mek-killsaw', 'Big Mek in Mega Armour: killsaw and power klaw', [0], ['Killsaw', 'Power klaw'], { maximumSelections: 1, limitGroup: 'mega-mek-primary' }),
  modelChoice('mega-mek-kombi-weapon', 'Big Mek in Mega Armour: kombi-weapon and power klaw', [0], ['Kombi-weapon', 'Power klaw'], { maximumSelections: 1, limitGroup: 'mega-mek-primary' }),
  modelChoice('mega-mek-kustom-shoota', 'Big Mek in Mega Armour: kustom shoota and power klaw', [0], ['Kustom shoota', 'Power klaw'], { maximumSelections: 1, limitGroup: 'mega-mek-primary' }),
  unitUpgrade('mega-mek-tellyport-blasta', 'Tellyport blasta', ['Tellyport blasta'], { maximumSelections: 1, limitGroup: 'mega-mek-utility' }),
  unitUpgrade('mega-mek-kustom-force-field', 'Kustom force field', undefined, { maximumSelections: 1, limitGroup: 'mega-mek-utility' }),
  unitUpgrade('mega-mek-grot-oiler', 'Grot oiler', undefined, { maximumSelections: 1 }),
], { maximumModelCount: 1, loadouts: [loadout(megaMek, ['Kustom mega-blasta', 'Power klaw'])] });

configure('orks.painboss', [unitUpgrade('grot-orderly', 'Grot orderly', undefined, { maximumSelections: 1 })], { maximumModelCount: 1 });
configure('orks.painboy', [unitUpgrade('grot-orderly', 'Grot orderly', undefined, { maximumSelections: 1 })], { maximumModelCount: 1 });

const warboss = unitsById.get('orks.warboss');
configure('orks.warboss', [
  modelChoice('warboss-standard', 'Warboss: kombi-weapon, twin slugga and big choppa', [0], ['Kombi-weapon', 'Twin slugga', 'Big choppa'], { maximumSelections: 1, limitGroup: 'warboss-primary' }),
  modelChoice('warboss-power-klaw', 'Warboss: kombi-weapon, twin slugga and power klaw', [0], ['Kombi-weapon', 'Twin slugga', 'Power klaw'], { maximumSelections: 1, limitGroup: 'warboss-primary' }),
  modelChoice('warboss-kustom', 'Warboss: kustom choppa and kustom shoota', [0], ['Kustom Choppa', 'Kustom Shoota'], { maximumSelections: 1, limitGroup: 'warboss-primary' }),
  unitUpgrade('attack-squig', 'Attack squig', ['Attack squig'], { maximumSelections: 1 }),
], { maximumModelCount: 1, loadouts: [loadout(warboss, ['Kombi-weapon', 'Twin slugga', 'Big choppa'])] });
configure('orks.big-mek-with-shokk-attack-gun', [unitUpgrade('grot-assistant', 'Grot assistant', undefined, { maximumSelections: 1 })], { maximumModelCount: 1 });
const mek = unitsById.get('orks.mek');
configure('orks.mek', [
  modelChoice('mek-wrench', 'Mek: kustom mega-slugga and wrench', [0], ['Kustom mega-slugga', 'Wrench'], { maximumSelections: 1, limitGroup: 'mek-melee' }),
  modelChoice('mek-killsaw', 'Mek: kustom mega-slugga and killsaw', [0], ['Kustom mega-slugga', 'Killsaw'], { maximumSelections: 1, limitGroup: 'mek-melee' }),
], { maximumModelCount: 1, loadouts: [loadout(mek, ['Kustom mega-slugga', 'Wrench'])] });

for (const unit of catalog.units) {
  if (!unit.wargearChoices?.length) continue;
  const ids = unit.wargearChoices.map(choice => choice.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${unit.name}: duplicate wargear choice ID.`);
  const optionsText = sourceWargearOptions(unit.name);
  if (optionsText.length) unit.wargearOptions = optionsText;
}

faction.coverage = {
  ...faction.coverage,
  notes: [
    'All current non-Legends datasheets are selectable.',
    'Structured model loadouts and unit upgrades are available for the current Ork datasheets with wargear options; Deff Dread replacement slots are represented without enumerating every combination.',
    'Remaining entries retain source-derived partial profiles pending executable-effect review.',
  ],
};
manifest.coverage = faction.coverage;
manifest.parserVersion = 'wahapedia-reference-normalizer-2-wargear';

await writeFile(unitPath, `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(factionPath, `${JSON.stringify(faction, null, 2)}\n`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const structured = catalog.units.filter(unit => unit.wargearChoices?.length ?? 0);
console.log(`Structured wargear for ${structured.length} Ork datasheets.`);
