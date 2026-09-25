import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const referenceDir = resolve(root, 'docs/army-references/wahapedia');
const outputDir = resolve(root, 'packages/simulator-core/src/data/catalogs/11e');
const requested = process.argv.slice(2)
  .find(argument => argument.startsWith('--factions='))
  ?.slice('--factions='.length)
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

const FORCE_DISPOSITION_IDS = new Map([
  ['take and hold', 'take-and-hold'],
  ['purge the foe', 'purge-the-foe'],
  ['disruption', 'disruption'],
  ['reconnaissance', 'reconnaissance'],
  ['priority assets', 'priority-targets'],
  ['priority targets', 'priority-targets'],
]);

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[â€™â€˜’‘`']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value) {
  return normalizeName(value).replace(/\s+/g, '-');
}

function integer(value, fallback = 0) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function stat(value, fallback = 0) {
  return integer(String(value ?? '').replace(/^\D+/, ''), fallback);
}

function modelBase(value) {
  const text = String(value ?? '').replace(/[()]/g, '').trim();
  const oval = text.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)mm/i);
  if (oval) return { shape: 'oval', widthMm: Number(oval[1]), lengthMm: Number(oval[2]) };
  const round = text.match(/(\d+(?:\.\d+)?)mm/i);
  if (round) return { shape: 'round', diameterMm: Number(round[1]) };
  return /use model/i.test(text) ? { shape: 'other', label: 'Use model' } : undefined;
}

function weaponKeywords(raw) {
  if (!raw || raw === '--') return [];
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
  const found = [];
  for (const pattern of patterns) {
    for (const match of String(raw).matchAll(pattern)) {
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
    .filter(line => line.startsWith('|') && !/^\|[-:|]+\|?$/.test(line))
    .filter(line => !line.includes('| Model |') && !line.includes('| Type |'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}

function sectionText(section, heading) {
  const start = section.indexOf(heading);
  if (start < 0) return '';
  const rest = section.slice(start + heading.length);
  const next = rest.search(/\n#### /);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function listItems(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function prose(value) {
  return listItems(value).join(' ').replace(/\s+/g, ' ').trim();
}

function unitNumber(label) {
  const range = String(label).match(/\b(\d+)(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d+)/i);
  if (range) return { minimum: Number(range[1]), maximum: Number(range[2]) };
  const from = String(label).match(/\b(\d+)(?:st|nd|rd|th)?\s*\+/i);
  if (from) return { minimum: Number(from[1]) };
  const single = String(label).match(/\b(\d+)(?:st|nd|rd|th)?\s+unit\b/i);
  return single ? { minimum: Number(single[1]), maximum: Number(single[1]) } : undefined;
}

function parsePoints(section) {
  const points = [];
  for (const line of sectionText(section, '#### Points').split('\n')) {
    const pointMatch = line.match(/\*\*(\d+) pts\*\*/i);
    if (!pointMatch) continue;
    const beforeCost = line.split('--')[0] ?? line;
    const modelMatch = beforeCost.match(/\b(\d+)\s+(?:models?|[A-Za-z][A-Za-z'’ -]*)\b/i);
    if (!modelMatch) continue;
    const group = beforeCost.replace(/^[-*]\s*/, '').split(':')[0].trim();
    const label = beforeCost.replace(/^[-*]\s*/, '').replace(`${group}:`, '').trim();
    points.push({
      modelCount: Number(modelMatch[1]),
      points: Number(pointMatch[1]),
      ...(label && !/^\d+\s+models?$/i.test(label) ? { label } : {}),
      ...(unitNumber(group) ? { unitNumber: unitNumber(group) } : {}),
    });
  }
  return points;
}

function modelCountFromComposition(section, modelName) {
  const composition = sectionText(section, '#### Unit Composition');
  const escaped = String(modelName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = composition.match(new RegExp(`(?:^|\\n)\\s*[-*]?\\s*(\\d+)(?:[-–](\\d+))?\\s+${escaped}\\s+models?\\b`, 'i'));
  return match ? Number(match[1]) : 1;
}

function sourceCompositionModelCount(section, modelName) {
  const composition = sectionText(section, '#### Unit Composition');
  const names = [String(modelName), String(modelName).replace(/s$/i, '')];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = composition.match(new RegExp(`(?:^|\\n)\\s*[-*]?\\s*(\\d+)(?:-\\d+)?\\s+${escaped}s?(?:\\s+models?)?\\b`, 'i'));
    if (match) return Number(match[1]);
  }
  return 1;
}

function parseEquipment(section, weapons, modelCount) {
  const composition = sectionText(section, '#### Unit Composition');
  const equipmentLines = [...composition.matchAll(/(?:Every [^:]+|This model|The [^:]+) is equipped with:\s*([^\.]+)\./gi)];
  if (!equipmentLines.length) return undefined;
  const profileRows = tableRows(section, '#### Profiles');
  const profileRanges = profileRows.map((row, rowIndex) => ({
    name: row[0],
    start: profileRows
      .slice(0, rowIndex)
      .reduce((total, previous) => total + sourceCompositionModelCount(section, previous[0]), 0),
    count: sourceCompositionModelCount(section, row[0]),
  }));
  const indexesForEquipment = equipped => equipped
    .split(';')
    .flatMap(value => {
      const count = Number(value.match(/^\s*(\d+)\s+/)?.[1] ?? 1);
      const name = value.replace(/^\s*\d+\s+/, '').trim().toLowerCase();
      const exact = weapons
        .map((weapon, index) => ({ weapon, index }))
        .filter(({ weapon }) => weapon.name.toLowerCase() === name)
        .map(({ index }) => index);
      const matches = exact.length ? exact : weapons
        .map((weapon, index) => ({ weapon, index }))
        .filter(({ weapon }) => weapon.profileGroup?.toLowerCase() === name)
        .map(({ index }) => index);
      return Array.from({ length: count }, () => matches).flat();
    });
  if (equipmentLines.length === 1) {
    const loadout = indexesForEquipment(equipmentLines[0][1]);
    return loadout.length ? Array.from({ length: modelCount }, () => [...loadout]) : undefined;
  }
  const loadouts = Array.from({ length: modelCount }, () => undefined);
  for (const match of equipmentLines) {
    const loadout = indexesForEquipment(match[1]);
    if (!loadout.length) continue;
    const modelName = match[0].split(' is equipped')[0].replace(/^(?:Every|This model|The)\s+/i, '').trim();
    const profileRange = profileRanges.find(profile => normalizeName(profile.name) === normalizeName(modelName))
      ?? profileRanges.find(profile => normalizeName(profile.name).includes(normalizeName(modelName)) || normalizeName(modelName).includes(normalizeName(profile.name)));
    const start = profileRange?.start ?? 0;
    const count = profileRange?.count ?? sourceCompositionModelCount(section, modelName);
    for (let index = start; index < Math.min(modelCount, start + count); index += 1) loadouts[index] = [...loadout];
  }
  return loadouts.every(loadout => loadout) ? loadouts : undefined;
}

function parseKeywords(section) {
  const line = sectionText(section, '#### Keywords').split(/\r?\n/).find(value => /\*\*Unit:\*\*/i.test(value)) ?? '';
  return line
    .replace(/^.*?\*\*Unit:\*\*\s*/i, '')
    .replace(/^KEYWORDS:\s*/i, '')
    .split(';')
    .map(keyword => keyword.trim())
    .filter(Boolean);
}

function parseCoreAbilities(section) {
  return listItems(sectionText(section, '#### Core Abilities'))
    .flatMap(item => item.split(',').map(value => value.trim()).filter(Boolean))
    .map(name => ({
      name,
      description: `Core ability: ${name}.`,
      category: 'datasheet',
    }));
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
    const continuation = /^\s{2,}[-*]\s*/.test(rawLine);
    const line = rawLine.trim().replace(/^[-*]\s*/, '');
    if (!line) continue;
    if (continuation && continuationIndex !== undefined) options[continuationIndex] += `; ${line}`;
    else {
      options.push(line);
      continuationIndex = /one of the following:\s*$/i.test(line) ? options.length - 1 : undefined;
    }
  }
  return options;
}

function namedRules(value, fallbackName) {
  const body = String(value ?? '').replace(/^\*\*[A-Z ]+:\*\*\s*/i, '').trim();
  const entries = [];
  let current;
  for (const line of body.split(/\r?\n/)) {
    if (/^[-*]\s+/.test(line)) {
      if (current) entries.push(current);
      current = line.replace(/^[-*]\s+/, '').trim();
    } else if (current && line.trim()) current += ` ${line.trim().replace(/^[-*]\s+/, '')}`;
  }
  if (current) entries.push(current);
  if (!entries.length && body) entries.push(body.replace(/\n+/g, ' '));
  return entries.map(text => {
    const separator = text.indexOf(':');
    return {
      name: separator > 0 ? text.slice(0, separator).trim() : fallbackName,
      description: separator > 0 ? text.slice(separator + 1).trim() : text,
      category: 'datasheet',
    };
  });
}

function parseRawRules(section) {
  const result = [];
  for (const [heading, fallback] of [
    ['#### Abilities', 'Datasheet abilities'],
    ['#### Wargear Abilities', 'Wargear abilities'],
    ['#### Leader', 'Leader'],
    ['#### Support', 'Support'],
    ['#### Transport', 'Transport'],
    ['#### Deployment', 'Deployment'],
    ['#### Supreme Commander', 'Supreme Commander'],
    ['#### Damaged:', 'Damaged profile'],
  ]) {
    const text = sectionText(section, heading);
    if (!text) continue;
    if (heading === '#### Abilities' || heading === '#### Wargear Abilities') result.push(...namedRules(text, fallback));
    else result.push({ name: fallback, description: prose(text), category: 'datasheet' });
  }
  return result;
}

function parseTargetNames(section, heading) {
  return listItems(sectionText(section, heading))
    .filter(item => !/^this model can be attached/i.test(item))
    .filter(item => !/^this unit can be attached/i.test(item))
    .filter(item => /^[A-Z0-9][A-Z0-9 /'’&.-]+$/.test(item))
    .map(item => item.replace(/\s+/g, ' ').trim());
}

function modelProfiles(section, profileRows, modelCount) {
  if (profileRows.length <= 1) return undefined;
  const profiles = profileRows.map(row => ({
    name: row[0],
    count: sourceCompositionModelCount(section, row[0]),
    move: stat(row[2], 6),
    toughness: stat(row[3], 4),
    save: stat(row[4], 6),
    wounds: stat(row[5], 1),
    leadership: stat(row[6], 7),
    oc: stat(row[7], 1),
  }));
  const total = profiles.reduce((sum, profile) => sum + profile.count, 0);
  if (total < modelCount) profiles.at(-1).count += modelCount - total;
  if (total > modelCount) {
    let excess = total - modelCount;
    for (let index = profiles.length - 1; index >= 0 && excess > 0; index -= 1) {
      const removable = Math.min(excess, Math.max(0, profiles[index].count - 1));
      profiles[index].count -= removable;
      excess -= removable;
    }
  }
  return profiles;
}

function parseUnit(name, section, factionId, factionName, armyRuleIds, capturedAt, index) {
  const profileRows = tableRows(section, '#### Profiles');
  const first = profileRows[0];
  if (!first) throw new Error(`${name} has no profile table.`);
  const weaponRows = tableRows(section, '#### Weapons');
  const weapons = weaponRows.map(row => ({
    name: row[2],
    ...(row[2].includes(' - ') ? { profileGroup: row[2].split(' - ')[0] } : {}),
    range: /^melee$/i.test(row[4]) ? 0 : stat(row[4]),
    attacks: row[5],
    skill: /^n\/a$/i.test(row[6]) || row[6] === '-' ? 6 : stat(row[6], 6),
    strength: stat(row[7]),
    ap: Number(row[8]) || 0,
    damage: row[9],
    keywords: weaponKeywords(row[3]),
    isMelee: row[0].toLowerCase() === 'melee',
  }));
  const points = parsePoints(section);
  const counts = [...new Set(points.map(point => point.modelCount))].sort((left, right) => left - right);
  const compositionModelCount = profileRows.length > 1
    ? profileRows.reduce((total, row) => total + sourceCompositionModelCount(section, row[0]), 0)
    : undefined;
  const modelCount = compositionModelCount ?? counts[0] ?? Math.max(1, integer(section.match(/\n-\s*(\d+)/)?.[1], 1));
  const role = section.match(/- \*\*Role:\*\*\s*(.+)/)?.[1]?.trim() ?? 'Unit';
  const sourceLabel = section.match(/- \*\*Source label:\*\*\s*(.+)/)?.[1]?.trim() ?? factionName;
  const wahapediaSlug = section.match(/- \*\*Wahapedia slug:\*\* \[[^\]]+\]\(https?:\/\/[^)]+\/([^/)]+)\)/)?.[1];
  const sourceBase = modelBase(first[1]);
  const defaultLoadout = parseEquipment(section, weapons, modelCount);
  const modelAliases = counts.flatMap(count => count > 1 ? [`${name} (x${count})`] : []);
  const profileBases = profileRows.flatMap(row => Array.from(
    { length: sourceCompositionModelCount(section, row[0]) },
    () => modelBase(row[1]) ?? sourceBase,
  ));
  const resolvedBases = profileBases.length === modelCount ? profileBases : Array.from({ length: modelCount }, () => sourceBase);
  const leaderTargetNames = parseTargetNames(section, '#### Leader');
  const supportTargetNames = parseTargetNames(section, '#### Support');
  const profile = {
    name,
    move: stat(first[2], 6),
    toughness: stat(first[3], 4),
    save: stat(first[4], 6),
    ...(first[8] && first[8] !== '--' ? { invulnSave: stat(first[8]) } : {}),
    wounds: stat(first[5], 1),
    leadership: stat(first[6], 7),
    oc: stat(first[7], 1),
    baseModelCount: modelCount,
    ...(resolvedBases.some(Boolean) ? { modelBases: resolvedBases.map(base => base ? { ...base } : undefined).filter(Boolean) } : {}),
    ...(modelProfiles(section, profileRows, modelCount) ? { modelProfiles: modelProfiles(section, profileRows, modelCount) } : {}),
    keywords: parseKeywords(section),
    factionKeywords: [factionId, factionName],
    weapons,
    abilities: parseCoreAbilities(section),
    rules: [],
    preBattleFormations: parsePreBattleFormations(section),
    ...(defaultLoadout ? { modelWeaponLoadouts: defaultLoadout } : {}),
  };
  const transportCapacity = section.match(/transport capacity of\s+(\d+)/i)?.[1];
  if (transportCapacity) profile.transportCapacity = Number(transportCapacity);
  const damaged = section.match(/#### Damaged:\s*(\d+)-(\d+) Wounds Remaining/i);
  if (damaged) profile.damagedProfile = { maxRemainingWounds: Number(damaged[2]), hitRollModifier: 1 };
  const modelCounts = counts.length > 1 ? { minimum: counts[0], maximum: counts.at(-1), step: counts[1] - counts[0] } : { minimum: counts[0] ?? modelCount };
  const idSlug = slug(wahapediaSlug ?? name) || `unit-${index + 1}`;
  return {
    id: `${factionId}.${idSlug}`,
    name,
    ...(modelAliases.length ? { aliases: modelAliases } : {}),
    ...(wahapediaSlug ? { externalIds: { wahapedia: wahapediaSlug } } : {}),
    status: 'current',
    implementationStatus: 'partial',
    role,
    modelCount: modelCounts,
    points,
    ...(parseWargearOptions(section).length ? { wargearOptions: parseWargearOptions(section) } : {}),
    profile,
    ruleRefs: armyRuleIds,
    rawRules: parseRawRules(section),
    ...(leaderTargetNames.length ? { leaderTargetNames } : {}),
    ...(supportTargetNames.length ? { supportedByNames: supportTargetNames } : {}),
    sources: [{
      title: `Wahapedia ${name} datasheet`,
      ...(wahapediaSlug ? { url: `https://wahapedia.ru/wh40k11ed/factions/${factionId}/${wahapediaSlug}` } : {}),
      capturedAt,
    }],
    notes: ['Generated from the current 11th-edition Wahapedia reference. Wargear choices are derived by the shared catalog normalizer.'],
    _sourceLabel: sourceLabel,
  };
}

function forceDispositionIds(value) {
  return [...new Set(String(value ?? '').split(';').map(item => FORCE_DISPOSITION_IDS.get(normalizeName(item))).filter(Boolean))];
}

function sourceInfo(factionId, factionName, section, capturedAt) {
  return [{
    title: `Wahapedia ${factionName} ${section}`,
    url: `https://wahapedia.ru/wh40k11ed/factions/${factionId}/`,
    capturedAt,
    section,
  }];
}

function parseEnhancements(text, detachmentId, detachmentName, factionId, factionName, capturedAt) {
  const start = text.indexOf('#### Enhancements');
  if (start < 0) return [];
  const block = text.slice(start + '#### Enhancements'.length).split(/^#### /m)[0];
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].replace(/^[-*]\s+/, '').trim();
    const match = header.match(/^(.+?)\s+(\d+)\s+pts$/i);
    if (!match) continue;
    const name = match[1].trim();
    const details = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeader = lines[cursor].replace(/^[-*]\s+/, '').match(/^.+?\s+\d+\s+pts$/i);
      if (nextHeader) break;
      details.push(lines[cursor].replace(/^[-*]\s+/, '').trim());
      index = cursor;
    }
    result.push({
      id: `${detachmentId}.enhancement.${slug(name)}`,
      name,
      kind: 'wargear',
      status: 'current',
      implementationStatus: 'display-only',
      detachmentId,
      ...(match[1].match(/UPGRADE$/i) ? { maximumSelections: 3 } : {}),
      description: `${match[2]} pts.${details.length ? ` ${details.join(' ')}` : ''}`.trim(),
      sources: sourceInfo(factionId, factionName, `${detachmentName} enhancements`, capturedAt),
    });
  }
  return result;
}

function parseStratagems(text, detachmentId, detachmentName, factionId, factionName, capturedAt) {
  const start = text.indexOf('#### Stratagems');
  if (start < 0) return [];
  const block = text.slice(start + '#### Stratagems'.length).split(/^#### /m)[0];
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result = [];
  const isName = (value, next) => /^[A-Z0-9][A-Z0-9'’&: .!?-]*$/.test(value) && /^\d+CP$/i.test(next ?? '');
  for (let index = 0; index < lines.length; index += 1) {
    const name = lines[index].replace(/^[-*]\s+/, '').trim();
    const cp = lines[index + 1]?.replace(/^[-*]\s+/, '').trim();
    if (!isName(name, cp)) continue;
    const type = lines[index + 2]?.replace(/^[-*]\s+/, '').trim() ?? `${detachmentName} Stratagem`;
    const details = [];
    let cursor = index + 3;
    for (; cursor < lines.length; cursor += 1) {
      const nextName = lines[cursor].replace(/^[-*]\s+/, '').trim();
      if (isName(nextName, lines[cursor + 1]?.replace(/^[-*]\s+/, '').trim())) break;
      details.push(nextName);
    }
    result.push({
      id: `${detachmentId}.stratagem.${slug(name)}`,
      name,
      kind: 'stratagem',
      status: 'unsupported',
      implementationStatus: 'display-only',
      detachmentId,
      description: [cp, type, prose(details.join('\n'))].filter(Boolean).join('. ').trim(),
      sources: sourceInfo(factionId, factionName, `${detachmentName} - ${name}`, capturedAt),
      notes: ['Stored as source data until the stratagem effect is represented by the shared typed ability system.'],
    });
    index = cursor - 1;
  }
  return result;
}

async function normalizeFaction(factionId) {
  const sourcePath = resolve(referenceDir, `${factionId}.md`);
  const source = await readFile(sourcePath, 'utf8');
  const capturedAt = source.match(/^- Captured:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? new Date().toISOString().slice(0, 10);
  const factionName = source.match(/^# (.+?) -- Wahapedia reference/m)?.[1]?.trim() ?? factionId;
  const datasheetStart = source.indexOf('## Datasheets');
  const detachmentStart = source.indexOf('## Detachments');
  const datasheetBody = source.slice(datasheetStart, detachmentStart);
  const sections = [...datasheetBody.matchAll(/^### (.+?)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
    .map(match => ({ name: match[1].trim(), body: match[0] }));
  const armyBody = source.slice(source.indexOf('## Army rule'), datasheetStart);
  const armySections = [...armyBody.matchAll(/^### (.+?)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)];
  const armyRules = armySections.map(([, name, body]) => ({
    id: `${factionId}.army-rule.${slug(name)}`,
    name: name.trim(),
    kind: 'army-rule',
    status: 'current',
    implementationStatus: 'partial',
    description: prose(body),
    sources: sourceInfo(factionId, factionName, name.trim(), capturedAt),
  }));
  const armyRuleIds = armyRules.map(rule => rule.id);
  const units = sections.map(({ name, body }, index) => parseUnit(name, body, factionId, factionName, armyRuleIds, capturedAt, index));
  const idsByBaseId = new Map();
  for (const unit of units) idsByBaseId.set(unit.id, (idsByBaseId.get(unit.id) ?? 0) + 1);
  const usedIds = new Set();
  for (const unit of units) {
    const baseId = unit.id;
    if ((idsByBaseId.get(baseId) ?? 0) > 1) {
      const sourceSuffix = slug(String(unit._sourceLabel ?? '').replace(/^Faction Pack\.\s*/i, '').replace(/\s*\(.+$/, '')) || 'variant';
      let candidate = `${baseId}-${sourceSuffix}`;
      let suffix = 2;
      while (usedIds.has(candidate)) candidate = `${baseId}-${sourceSuffix}-${suffix++}`;
      unit.id = candidate;
    }
    usedIds.add(unit.id);
    delete unit._sourceLabel;
  }
  const unitByName = new Map();
  for (const unit of units) {
    const matches = unitByName.get(normalizeName(unit.name)) ?? [];
    matches.push(unit.id);
    unitByName.set(normalizeName(unit.name), matches);
  }
  for (const unit of units) {
    if (unit.leaderTargetNames?.length) unit.leaderTargetRefs = unit.leaderTargetNames.flatMap(name => unitByName.get(normalizeName(name)) ?? []);
    if (unit.supportedByNames?.length) unit.supportedByRefs = unit.supportedByNames.flatMap(name => unitByName.get(normalizeName(name)) ?? []);
  }
  const detachmentBody = source.slice(detachmentStart, source.indexOf('## Extraction audit'));
  const detachmentSections = [...detachmentBody.matchAll(/^### (.+?) \((\d+) DP\)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
    .map(([, name, points, text]) => ({ name: name.trim(), points: Number(points), text }));
  const detachmentRules = detachmentSections.flatMap(detachment => {
    const detachmentId = `${factionId}.detachment.${slug(detachment.name)}`;
    const ruleMatch = detachment.text.match(/#### Detachment rule -- (.+?)\r?\n([\s\S]*?)(?=^#### |$(?![\s\S]))/m);
    const rule = ruleMatch ? {
      id: detachmentId,
      name: `${detachment.name} - ${ruleMatch[1].trim()}`,
      kind: 'detachment-rule',
      status: 'current',
      implementationStatus: 'display-only',
      detachmentId,
      forceDispositions: forceDispositionIds(detachment.text.match(/\*\*Force dispositions:\*\*\s*(.+)/i)?.[1]),
      description: prose(ruleMatch[2]),
      sources: sourceInfo(factionId, factionName, detachment.name, capturedAt),
      notes: [`Detachment cost: ${detachment.points} DP.`],
    } : undefined;
    return [
      ...(rule ? [rule] : []),
      ...parseEnhancements(detachment.text, detachmentId, detachment.name, factionId, factionName, capturedAt),
      ...parseStratagems(detachment.text, detachmentId, detachment.name, factionId, factionName, capturedAt),
    ];
  });
  const rules = [...armyRules, ...detachmentRules];
  const faction = {
    id: factionId,
    name: factionName,
    edition: '11e',
    unitRefs: units.map(unit => unit.id),
    ruleRefs: armyRuleIds,
    detachmentRefs: detachmentSections.map(detachment => `${factionId}.detachment.${slug(detachment.name)}`),
    factionKeywords: [factionId, factionName],
    sources: [{ title: `Wahapedia ${factionName} faction reference`, url: `https://wahapedia.ru/wh40k11ed/factions/${factionId}/`, capturedAt, sourceRevision: 'Faction Pack. 11th edition' }],
    coverage: {
      sourceEntryCount: Number(source.match(/^- Coverage:\s*(\d+) current datasheets/i)?.[1] ?? units.length),
      normalizedEntryCount: units.length,
      excludedLegendCount: Number(source.match(/;\s*(\d+) Legends datasheets excluded/i)?.[1] ?? 0),
      notes: ['Current non-Legends datasheets, profiles, weapons, abilities, points, wargear text, detachments, enhancements, stratagems, and force dispositions are regenerated from the saved 11th-edition Wahapedia capture.'],
    },
  };
  if (faction.coverage.sourceEntryCount !== units.length) throw new Error(`${factionId}: expected ${faction.coverage.sourceEntryCount} units, found ${units.length}.`);
  await mkdir(resolve(outputDir, 'units'), { recursive: true });
  await mkdir(resolve(outputDir, 'factions'), { recursive: true });
  await mkdir(resolve(outputDir, 'rules'), { recursive: true });
  await writeFile(resolve(outputDir, 'units', `${factionId}.json`), `${JSON.stringify({ factionId, units }, null, 2)}\n`);
  await writeFile(resolve(outputDir, 'factions', `${factionId}.json`), `${JSON.stringify(faction, null, 2)}\n`);
  await writeFile(resolve(outputDir, 'rules', `${factionId}.json`), `${JSON.stringify({ factionId, rules }, null, 2)}\n`);
  return { faction, rules, capturedAt };
}

const files = await readdir(referenceDir);
const factions = (requested?.length ? requested : files
  .filter(file => file.endsWith('.md') && file !== 'INDEX.md')
  .map(file => file.slice(0, -3)))
  .sort();
const normalized = [];
for (const factionId of factions) {
  const result = await normalizeFaction(factionId);
  normalized.push(result);
  console.log(`Normalized ${result.faction.coverage.normalizedEntryCount} ${result.faction.name} datasheets and ${result.faction.detachmentRefs.length} detachments.`);
}
const capturedAt = normalized.map(result => result.capturedAt).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
const manifest = {
  catalogId: 'warhammer-40k',
  edition: '11e',
  catalogRevision: `${capturedAt}.1`,
  schemaVersion: 1,
  gameSystem: 'warhammer-40k',
  factions: normalized.map(result => result.faction.id),
  unitFiles: normalized.map(result => `units/${result.faction.id}.json`),
  ruleFiles: normalized.map(result => `rules/${result.faction.id}.json`),
  reviewStatus: 'working',
  parserVersion: 'wahapedia-reference-normalizer-4-all-factions',
  sources: normalized.map(result => result.faction.sources[0]),
  coverage: {
    sourceEntryCount: normalized.reduce((total, result) => total + result.faction.coverage.sourceEntryCount, 0),
    normalizedEntryCount: normalized.reduce((total, result) => total + result.faction.coverage.normalizedEntryCount, 0),
    excludedLegendCount: normalized.reduce((total, result) => total + (result.faction.coverage.excludedLegendCount ?? 0), 0),
    notes: ['Generated from sequential GET-only Wahapedia 11th-edition faction captures.'],
  },
};
await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
