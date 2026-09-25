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
    /anti-[a-z/]+ \d+\+/gi,
    /close-quarters/gi,
    /devastating wounds(?:\s*:\s*(?:non-)?[a-z/]+)?/gi,
    /lethal hits(?:\s*:\s*(?:non-)?[a-z/]+)?/gi,
    /sustained hits \d+(?:\s*:\s*(?:non-)?[a-z/]+)?/gi,
    /rapid fire \d+/gi,
    /melta \d+/gi,
    /feel no pain \d+\+/gi,
    /cleave \d+/gi,
    /extra attacks/gi,
    /indirect fire/gi,
    /ignores cover/gi,
    /twin-linked/gi,
    /one shot/gi,
    /deadly demise \w+/gi,
    /hazardous/gi,
    /precision/gi,
    /torrent/gi,
    /pistol/gi,
    /assault/gi,
    /blast(?: \d+)?/gi,
    /heavy/gi,
    /lance/gi,
    /psychic/gi,
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const keyword = match[0].replace(/\s+/g, ' ').trim();
      if (!found.some(existing => existing.toLowerCase() === keyword.toLowerCase())) found.push(keyword);
    }
  }
  return found.map(keyword => keyword
    .replace(/\banti-/gi, 'Anti-')
    .replace(/\bclose-quarters\b/gi, 'Close-Quarters')
    .replace(/\bdevastating wounds\b/gi, 'Devastating Wounds')
    .replace(/\blethal hits\b/gi, 'Lethal Hits')
    .replace(/\bsustained hits\b/gi, 'Sustained Hits')
    .replace(/\brapid fire\b/gi, 'Rapid Fire')
    .replace(/\bmelta\b/gi, 'Melta')
    .replace(/\bfeel no pain\b/gi, 'Feel No Pain')
    .replace(/\bcleave\b/gi, 'Cleave')
    .replace(/\bextra attacks\b/gi, 'Extra Attacks')
    .replace(/\bindirect fire\b/gi, 'Indirect Fire')
    .replace(/\bignores cover\b/gi, 'Ignores Cover')
    .replace(/\btwin-linked\b/gi, 'Twin-linked')
    .replace(/\bone shot\b/gi, 'One Shot')
    .replace(/\bdeadly demise\b/gi, 'Deadly Demise')
    .replace(/\bhazardous\b/gi, 'Hazardous')
    .replace(/\bprecision\b/gi, 'Precision')
    .replace(/\btorrent\b/gi, 'Torrent')
    .replace(/\bpistol\b/gi, 'Pistol')
    .replace(/\bassault\b/gi, 'Assault')
    .replace(/\bblast\b/gi, 'Blast')
    .replace(/\bheavy\b/gi, 'Heavy')
    .replace(/\blance\b/gi, 'Lance')
    .replace(/\bpsychic\b/gi, 'Psychic'));
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

function unitNumber(label) {
  const range = label.match(/\b(\d+)(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d+)/i);
  if (range) return { minimum: Number(range[1]), maximum: Number(range[2]) };
  const from = label.match(/\b(\d+)(?:st|nd|rd|th)?\s*\+/i);
  if (from) return { minimum: Number(from[1]) };
  const single = label.match(/\b(\d+)(?:st|nd|rd|th)?\s+unit\b/i);
  return single ? { minimum: Number(single[1]), maximum: Number(single[1]) } : undefined;
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
    const numberRange = unitNumber(beforeCost);
    if (modelCount > 0) points.push({
      modelCount,
      points: Number(pointMatch[1]),
      ...(numberRange ? { unitNumber: numberRange } : {}),
    });
  }
  return points;
}

function parseEquipment(section, weapons, profileRows, modelCount) {
  const composition = sectionText(section, '#### Unit Composition');
  const equipmentLines = [...composition.matchAll(/((?:Every [^:]+|This model)) is equipped with:\s*([^\.]+)\./gi)];
  if (!equipmentLines.length) return undefined;
  const toIndexes = (equipped) => {
    const names = equipped.split(';').map(value => value.replace(/^\s*\d+\s+/, '').trim().toLowerCase());
    const indexes = names.map(name => weapons.findIndex(weapon => (
      weapon.name.toLowerCase() === name
      || weapon.profileGroup?.toLowerCase() === name
      || weapon.name.toLowerCase().startsWith(`${name} - `)
    )));
    return indexes.every(index => index >= 0) ? indexes : undefined;
  };
  if (equipmentLines.length === 1) {
    const indexes = toIndexes(equipmentLines[0][2]);
    return indexes ? Array.from({ length: modelCount }, () => [...indexes]) : undefined;
  }
  const loadouts = Array.from({ length: modelCount }, () => undefined);
  let start = 0;
  for (const match of equipmentLines) {
    const row = profileRows.find(candidate => match[1].toLowerCase().includes(candidate[0].toLowerCase()));
    const indexes = toIndexes(match[2]);
    if (!indexes) continue;
    const count = row ? modelCountFromComposition(section, row[0]) : modelCount;
    for (let index = start; index < Math.min(modelCount, start + count); index += 1) loadouts[index] = [...indexes];
    start += count;
  }
  return loadouts.every(loadout => loadout) ? loadouts : undefined;
}

function parseKeywords(section) {
  const keywordText = sectionText(section, '#### Keywords');
  const unitLine = keywordText.match(/\*\*Unit:\*\*\s*(?:KEYWORDS:\s*)?([^\n]+)/i)?.[1] ?? '';
  return unitLine
    .split(';')
    .map(keyword => keyword.trim())
    .filter(Boolean);
}

function parseCoreAbilities(section) {
  return sectionText(section, '#### Core Abilities')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .flatMap(line => line.split(',').map(value => value.trim()).filter(Boolean))
    .map(name => ({ name, description: `Core ability: ${name}.`, category: 'datasheet' }));
}

function parsePreBattleFormations(section) {
  const text = sectionText(section, '#### Abilities');
  const match = text.match(/split this unit into two units, each with a starting strength of (\d+)[\s\S]*?will have the (.+?) ability and which one of those units will have the (.+?) ability/i);
  if (!match) return undefined;
  return [{
    id: `split-${slug(match[2])}-${slug(match[3])}`,
    kind: 'split-unit',
    modelCounts: [Number(match[1]), Number(match[1])],
    abilityGroups: [{ id: 'exclusive-abilities', abilityNames: [match[2].trim(), match[3].trim()] }],
  }];
}

function parseWargearOptions(section) {
  const options = [];
  let continuationIndex;
  for (const rawLine of sectionText(section, '#### Wargear options').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s*/, '');
    if (!line) continue;
    const continuation = /^\s{2,}[-*]\s*/.test(rawLine);
    if (continuation && continuationIndex !== undefined) {
      options[continuationIndex] += `; ${line}`;
    } else {
      options.push(line);
      continuationIndex = /one of the following:\s*$/i.test(line) ? options.length - 1 : undefined;
    }
  }
  return options;
}

function parseRawRules(section) {
  const abilityText = sectionText(section, '#### Abilities');
  if (!abilityText) return [];
  const body = abilityText.replace(/^\*\*ABILITIES:\*\*\s*/i, '').trim();
  const lines = body.split(/\r?\n/);
  const entries = [];
  let current;
  for (const line of lines) {
    if (/^-\s+/.test(line)) {
      if (current) entries.push(current);
      current = { text: line.replace(/^-\s+/, '').trim() };
    } else if (current && line.trim()) {
      current.text += ` ${line.trim().replace(/^-\s+/, '')}`;
    }
  }
  if (current) entries.push(current);
  if (!entries.length) {
    return [{ name: 'Datasheet abilities', description: body.replace(/\n+/g, ' ').trim(), category: 'datasheet' }];
  }
  return entries.map(({ text }) => {
    const separator = text.indexOf(':');
    return {
      name: separator > 0 ? text.slice(0, separator).trim() : text,
      description: separator > 0 ? text.slice(separator + 1).trim() : text,
      category: 'datasheet',
    };
  });
}

function parseLeaderTargets(section) {
  const leaderText = sectionText(section, '#### Leader');
  if (!leaderText) return [];
  return leaderText
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line && !/^this model can be attached/i.test(line))
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function modelCountFromComposition(section, modelName) {
  const composition = sectionText(section, '#### Unit Composition');
  if (!composition) return 1;
  const escaped = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = composition.match(new RegExp(`(?:^|\\n)[- ]*(\\d+)(?:[-–](\\d+))?\\s+${escaped}\\s+models?\\b`, 'i'));
  if (!match) return 1;
  return Number(match[1]);
}

function modelProfileRows(section, profileRows, baseModelCount) {
  if (profileRows.length <= 1) return undefined;
  const profiles = profileRows.map(row => ({
    name: row[0],
    count: modelCountFromComposition(section, row[0]),
    move: stat(row[2], 6),
    toughness: stat(row[3], 4),
    save: stat(row[4], 6),
    wounds: stat(row[5], 1),
    leadership: stat(row[6], 7),
    oc: stat(row[7], 1),
  }));
  const total = profiles.reduce((sum, profile) => sum + profile.count, 0);
  if (total < baseModelCount) profiles[profiles.length - 1].count += baseModelCount - total;
  if (total > baseModelCount) {
    let excess = total - baseModelCount;
    for (let index = profiles.length - 1; index >= 0 && excess > 0; index -= 1) {
      const removable = Math.min(excess, Math.max(0, profiles[index].count - 1));
      profiles[index].count -= removable;
      excess -= removable;
    }
  }
  return profiles;
}

function parseGeneratedUnit(name, section) {
  const role = section.match(/- \*\*Role:\*\*\s*(.+)/)?.[1]?.trim() ?? 'Unit';
  const wahapediaSlug = section.match(/- \*\*Wahapedia slug:\*\* \[[^\]]+\]\(https?:\/\/[^)]+\/([^/)]+)\)/)?.[1];
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
  const wargearOptions = parseWargearOptions(section);
  const counts = [...new Set(points.map(point => point.modelCount))].sort((left, right) => left - right);
  const modelCount = counts[0] ?? 1;
  const defaultLoadout = parseEquipment(section, weapons, profileRows, modelCount);
  const leaderTargetNames = parseLeaderTargets(section);
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
    ...(modelProfileRows(section, profileRows, modelCount) ? { modelProfiles: modelProfileRows(section, profileRows, modelCount) } : {}),
    keywords: parseKeywords(section),
    factionKeywords: ['Orks'],
    weapons,
    abilities: parseCoreAbilities(section),
    rules: [],
    preBattleFormations: parsePreBattleFormations(section),
    ...(defaultLoadout ? { modelWeaponLoadouts: defaultLoadout } : {}),
  };
  const transportCapacity = section.match(/transport capacity of\s+(\d+)/i)?.[1];
  if (transportCapacity) profile.transportCapacity = Number(transportCapacity);
  const damaged = section.match(/#### Damaged:\s*(\d+)-(\d+) Wounds Remaining[\s\S]*?subtract 1 from the Hit roll/i);
  if (damaged) profile.damagedProfile = { maxRemainingWounds: Number(damaged[2]), hitRollModifier: 1 };

  return {
    id: `orks.${slug(name)}`,
    name,
    ...(counts.at(-1) ? { aliases: [`${name} (x${counts.at(-1)})`] } : {}),
    ...(wahapediaSlug ? { externalIds: { wahapedia: wahapediaSlug } } : {}),
    status: 'current',
    implementationStatus: 'partial',
    role,
    modelCount: {
      minimum: counts[0] ?? 1,
      ...(counts.length > 1 ? { maximum: counts.at(-1) } : {}),
      ...(counts.length > 2 && new Set(counts.slice(1).map((count, index) => count - counts[index])).size === 1
        ? { step: counts[1] - counts[0] }
        : counts.length === 2 ? { step: counts[1] - counts[0] } : {}),
    },
    points,
    ...(wargearOptions.length ? { wargearOptions } : {}),
    profile,
    ruleRefs: ['orks.army-rule.waaagh'],
    rawRules: parseRawRules(section),
    ...(leaderTargetNames.length ? {
      leaderTargetNames,
      leaderTargetRefs: leaderTargetNames.map(target => `orks.${slug(target)}`),
    } : {}),
    sources: [{
      title: `Wahapedia ${name} datasheet`,
      ...(wahapediaSlug ? { url: `https://wahapedia.ru/wh40k11ed/factions/orks/${wahapediaSlug}` } : {}),
      capturedAt: sourceCapturedAt,
    }],
    notes: ['Generated from the saved Wahapedia reference. Review model-specific loadouts, wargear selections, and executable effects before treating this entry as rules-complete.'],
  };
}

const source = await readFile(sourcePath, 'utf8');
const sourceCapturedAt = source.match(/^- Captured:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? new Date().toISOString().slice(0, 10);
const existing = JSON.parse(await readFile(unitPath, 'utf8'));
const existingById = new Map(existing.units.map(unit => [unit.id, unit]));
const [unitBody] = source.slice(source.indexOf('### Boss Snikrot')).split('### War Horde');
const sections = [...unitBody.matchAll(/^### (.+?)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
  .map(match => ({ name: match[1].trim(), body: match[0] }));
const units = sections.map(({ name, body }) => {
  const generated = parseGeneratedUnit(name, body);
  // The saved catalog can contain hand-reviewed fields from an older faction
  // pack. Keep the source-derived profile authoritative so a refresh cannot
  // silently retain stale stats, weapons, or points.
  const previous = existingById.get(generated.id);
  if (!previous) return generated;
  const previousWeapons = previous.profile?.weapons ?? [];
  const remappedLoadouts = previous.profile?.modelWeaponLoadouts?.map(loadout => {
    const indexes = loadout.map(index => previousWeapons[index]?.name)
      .map(name => name
        ? generated.profile.weapons.findIndex(weapon => weapon.name.toLowerCase() === name.toLowerCase())
        : -1);
    return indexes.every(index => index >= 0) ? indexes : null;
  });
  const profile = remappedLoadouts?.length && remappedLoadouts.every(loadout => loadout !== null)
    ? { ...generated.profile, modelWeaponLoadouts: remappedLoadouts }
    : generated.profile;
  return {
    ...generated,
    ...(previous.aliases ? { aliases: previous.aliases } : {}),
    ...(previous.composition ? { composition: previous.composition } : {}),
    ...(previous.wargearChoices ? { wargearChoices: previous.wargearChoices } : {}),
    ...(previous.leaderTargetNames ? { leaderTargetNames: previous.leaderTargetNames } : {}),
    ...(previous.leaderTargetRefs ? { leaderTargetRefs: previous.leaderTargetRefs } : {}),
    profile,
  };
});

const capturedAt = source.match(/^- Captured:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? new Date().toISOString().slice(0, 10);
const sourceEntryCount = Number(source.match(/^- Coverage:\s*(\d+) current datasheets/i)?.[1] ?? units.length);
const excludedLegendCount = Number(source.match(/;\s*(\d+) Legends datasheets excluded/i)?.[1] ?? 0);
if (units.length !== sourceEntryCount) {
  throw new Error(`Expected ${sourceEntryCount} current non-Legends Ork datasheets; found ${units.length}.`);
}

await writeFile(unitPath, `${JSON.stringify({ factionId: 'orks', units }, null, 2)}\n`);
const faction = JSON.parse(await readFile(factionPath, 'utf8'));
faction.unitRefs = units.map(unit => unit.id);
faction.coverage = {
  sourceEntryCount,
  normalizedEntryCount: units.length,
  excludedLegendCount,
  notes: ['All current non-Legends datasheets are selectable. Profiles, weapons, abilities, points, and base sizes are regenerated from the saved Wahapedia capture; model-specific loadouts and executable effects remain source-scoped work.'],
};
faction.sources = (faction.sources ?? []).map(sourceEntry => ({ ...sourceEntry, capturedAt }));
await writeFile(factionPath, `${JSON.stringify(faction, null, 2)}\n`);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.coverage = faction.coverage;
manifest.catalogRevision = `${capturedAt}.1`;
manifest.parserVersion = 'wahapedia-reference-normalizer-3-source-refresh';
manifest.sources = (manifest.sources ?? []).map(sourceEntry => ({ ...sourceEntry, capturedAt }));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Normalized ${units.length} current non-Legends Ork datasheets.`);

// Structured wargear choices are intentionally not re-applied here. The old
// hand-authored choices refer to the previous Ork pack and several of those
// weapon names no longer exist in the refreshed source. Keeping them would
// make the catalog claim illegal loadouts. They can be rebuilt from the new
// datasheet options in a separate reviewed pass.
