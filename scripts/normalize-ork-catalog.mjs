import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const sourcePath = resolve(root, 'docs/army-references/wahapedia/orks.md');
const unitPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/units/orks.json');
const factionPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/factions/orks.json');
const manifestPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/manifest.json');
const handReviewedIds = new Set([
  'orks.boss-snikrot',
  'orks.ghazghkull-thraka',
  'orks.boyz',
  'orks.trukk',
  'orks.kommandos',
]);

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function integer(value, fallback = 0) {
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function stat(value, fallback = 0) {
  return integer(String(value).replace(/^\D+/, ''), fallback);
}

function modelBase(value) {
  const text = String(value).replace(/[()]/g, '').trim();
  const oval = text.match(/(\d+)\s*x\s*(\d+)mm/i);
  if (oval) return { shape: 'oval', widthMm: Number(oval[1]), lengthMm: Number(oval[2]) };
  const round = text.match(/(\d+)mm/i);
  if (round) return { shape: 'round', diameterMm: Number(round[1]) };
  return /use model/i.test(text) ? { shape: 'other', label: 'Use model' } : undefined;
}

function weaponKeywords(raw) {
  if (!raw || raw === '--') return [];
  const found = [];
  const patterns = [
    /anti-[a-z-]+ \d+\+/g,
    /rapid fire \d+/g,
    /sustained hits \d+/g,
    /melta \d+/g,
    /feel no pain \d+\+/g,
    /devastating wounds/g,
    /extra attacks/g,
    /indirect fire/g,
    /ignores cover/g,
    /twin-linked/g,
    /lethal hits/g,
    /one shot/g,
    /deadly demise \w+/g,
    /hazardous/g,
    /precision/g,
    /torrent/g,
    /pistol/g,
    /assault/g,
    /blast/g,
    /heavy/g,
    /lance/g,
    /psychic/g,
  ];
  const lower = raw.toLowerCase();
  for (const pattern of patterns) {
    for (const match of lower.matchAll(pattern)) {
      if (!found.includes(match[0])) found.push(match[0]);
    }
  }
  return found.map(keyword => keyword.replace(/\b\w/g, letter => letter.toUpperCase()));
}

function tableRows(section, heading) {
  const start = section.indexOf(heading);
  if (start < 0) return [];
  const table = section.slice(start + heading.length).split(/\r?\n\r?\n/)[0];
  return table
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|') && !/^\|[-:|]+\|?$/.test(line) && !line.includes('| Model |') && !line.includes('| Type |'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}

function sectionText(section, heading) {
  const start = section.indexOf(heading);
  if (start < 0) return '';
  const rest = section.slice(start + heading.length);
  const next = rest.search(/\n#### /);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function parsePoints(section) {
  const pointText = sectionText(section, '#### Points');
  const points = [];
  for (const line of pointText.split('\n')) {
    const pointMatch = line.match(/\*\*(\d+) pts\*\*/i);
    if (!pointMatch) continue;
    const beforeCost = line.split('--')[0] ?? line;
    const modelCount = [...beforeCost.matchAll(/\b(\d+)\s+(?:models?|[A-Za-z][A-Za-z' -]*)/g)]
      .reduce((total, match) => total + Number(match[1]), 0);
    if (modelCount > 0) points.push({ modelCount, points: Number(pointMatch[1]) });
  }
  return points;
}

function parseEquipment(section, weapons) {
  const composition = sectionText(section, '#### Unit Composition');
  const equipped = composition.match(/(?:Every model|This model) is equipped with:\s*([^\.]+)\./i)?.[1];
  if (!equipped) return undefined;
  const names = equipped.split(';').map(value => value.replace(/^\s*\d+\s+/,'').trim().toLowerCase());
  const indexes = names
    .map(name => weapons.findIndex(weapon => weapon.name.toLowerCase() === name))
    .filter(index => index >= 0);
  return indexes.length === names.length ? indexes : undefined;
}

function parseKeywords(section) {
  const keywordText = sectionText(section, '#### Keywords');
  const unitLine = keywordText.match(/\*\*Unit:\*\*\s*(?:KEYWORDS:\s*)?([^\n]+)/i)?.[1] ?? '';
  return unitLine
    .split(';')
    .map(keyword => keyword.trim())
    .filter(Boolean);
}

function parseRawRules(section) {
  const abilityText = sectionText(section, '#### Abilities');
  if (!abilityText) return [];
  return [{
    name: 'Datasheet abilities',
    description: abilityText.replace(/^\*\*ABILITIES:\*\*\s*/i, '').replace(/\n+/g, ' ').trim(),
    category: 'datasheet',
  }];
}

function parseGeneratedUnit(name, section) {
  const role = section.match(/- \*\*Role:\*\*\s*(.+)/)?.[1]?.trim() ?? 'Unit';
  const wahapediaSlug = section.match(/- \*\*Wahapedia slug:\*\* \[[^\]]+\]\([^/]+\/([^/)]+)\)/)?.[1];
  const profileRows = tableRows(section, '#### Profiles');
  const firstProfile = profileRows[0];
  if (!firstProfile) throw new Error(`${name} has no profile table.`);
  const weaponRows = tableRows(section, '#### Weapons');
  const weapons = weaponRows.map(row => ({
    name: row[2],
    ...(row[2].includes(' - ') ? { profileGroup: row[2].split(' - ')[0] } : {}),
    range: /^melee$/i.test(row[4]) ? 0 : stat(row[4]),
    attacks: row[5],
    skill: /^n\/a$/i.test(row[6]) ? 6 : stat(row[6], 6),
    strength: stat(row[7]),
    ap: Number(row[8]) || 0,
    damage: row[9],
    keywords: weaponKeywords(row[3]),
    isMelee: row[0].toLowerCase() === 'melee',
  }));
  const points = parsePoints(section);
  const counts = [...new Set(points.map(point => point.modelCount))].sort((left, right) => left - right);
  const modelCount = counts[0] ?? 1;
  const defaultLoadout = parseEquipment(section, weapons);
  const sourceBase = modelBase(firstProfile[1]);
  const profile = {
    name,
    move: stat(firstProfile[2], 6),
    toughness: stat(firstProfile[3], 4),
    save: stat(firstProfile[4], 6),
    ...(firstProfile[8] !== '--' ? { invulnSave: stat(firstProfile[8]) } : {}),
    wounds: stat(firstProfile[5], 1),
    leadership: stat(firstProfile[6], 7),
    oc: stat(firstProfile[7], 1),
    baseModelCount: modelCount,
    ...(sourceBase ? { modelBases: Array.from({ length: modelCount }, () => ({ ...sourceBase })) } : {}),
    keywords: parseKeywords(section),
    factionKeywords: ['Orks'],
    weapons,
    abilities: [],
    rules: [],
    ...(defaultLoadout ? { modelWeaponLoadouts: Array.from({ length: modelCount }, () => [...defaultLoadout]) } : {}),
  };
  const transportCapacity = section.match(/transport capacity of\s+(\d+)/i)?.[1];
  if (transportCapacity) profile.transportCapacity = Number(transportCapacity);
  const damaged = section.match(/#### Damaged:\s*(\d+)-(\d+) Wounds Remaining[\s\S]*?subtract 1 from the Hit roll/i);
  if (damaged) profile.damagedProfile = { maxRemainingWounds: Number(damaged[2]), hitRollModifier: 1 };

  return {
    id: `orks.${slug(name)}`,
    name,
    ...(wahapediaSlug ? { externalIds: { wahapedia: wahapediaSlug } } : {}),
    status: 'current',
    implementationStatus: 'partial',
    role,
    modelCount: {
      minimum: counts[0] ?? 1,
      ...(counts.length > 1 ? { maximum: counts.at(-1) } : {}),
    },
    points,
    profile,
    ruleRefs: ['orks.army-rule.waaagh'],
    rawRules: parseRawRules(section),
    sources: [{
      title: `Wahapedia ${name} datasheet`,
      ...(wahapediaSlug ? { url: `https://wahapedia.ru/wh40k11ed/factions/orks/${wahapediaSlug}` } : {}),
      capturedAt: '2026-08-29',
    }],
    notes: ['Generated from the saved Wahapedia reference. Review model-specific loadouts, wargear selections, and executable effects before treating this entry as rules-complete.'],
  };
}

const source = await readFile(sourcePath, 'utf8');
const [unitBody] = source.slice(source.indexOf('### Boss Snikrot')).split('### War Horde');
const sections = [...unitBody.matchAll(/^### (.+?)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
  .map(match => ({ name: match[1].trim(), body: match[0] }));
const existing = JSON.parse(await readFile(unitPath, 'utf8'));
const existingById = new Map(existing.units
  .filter(unit => handReviewedIds.has(unit.id))
  .map(unit => [unit.id, unit]));
const units = sections.map(({ name, body }) => {
  const generated = parseGeneratedUnit(name, body);
  return existingById.get(generated.id) ?? generated;
});

if (units.length !== 58) throw new Error(`Expected 58 non-Legends Ork datasheets; found ${units.length}.`);

await writeFile(unitPath, `${JSON.stringify({ factionId: 'orks', units }, null, 2)}\n`);
const faction = JSON.parse(await readFile(factionPath, 'utf8'));
faction.unitRefs = units.map(unit => unit.id);
faction.coverage = {
  sourceEntryCount: 58,
  normalizedEntryCount: 58,
  excludedLegendCount: 30,
  notes: ['All current non-Legends datasheets are selectable. Five pilot entries are hand-reviewed; the remaining entries retain source-derived partial profiles pending per-model loadout, wargear, and executable-effect review.'],
};
await writeFile(factionPath, `${JSON.stringify(faction, null, 2)}\n`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.coverage = faction.coverage;
manifest.parserVersion = 'wahapedia-reference-normalizer-1';
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Normalized ${units.length} current non-Legends Ork datasheets.`);

// Keep the structured wargear layer attached to the generated catalog when
// the source refresh pipeline is run end-to-end.
await import('./normalize-ork-wargear.mjs');
