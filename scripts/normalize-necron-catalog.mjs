import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const sourcePath = resolve(root, 'docs/army-references/wahapedia/necrons.md');
const outputDir = resolve(root, 'packages/simulator-core/src/data/catalogs/11e');
const unitPath = resolve(outputDir, 'units/necrons.json');
const factionPath = resolve(outputDir, 'factions/necrons.json');
const rulePath = resolve(outputDir, 'rules/necrons.json');

const FORCE_DISPOSITIONS_BY_DETACHMENT = {
  'necrons.detachment.awakened-dynasty': ['take-and-hold'],
  'necrons.detachment.annihilation-legion': ['purge-the-foe'],
  'necrons.detachment.canoptek-court': ['take-and-hold'],
  'necrons.detachment.obeisance-phalanx': ['disruption'],
  'necrons.detachment.hypercrypt-legion': ['reconnaissance'],
  'necrons.detachment.starshatter-arsenal': ['priority-targets'],
  'necrons.detachment.cryptek-conclave': ['priority-targets'],
  'necrons.detachment.cursed-legion': ['purge-the-foe'],
  'necrons.detachment.pantheon-of-woe': ['disruption'],
  'necrons.detachment.hand-of-the-dynasty': ['take-and-hold'],
  'necrons.detachment.skyshroud-spearhead': ['reconnaissance'],
  'necrons.detachment.the-phaerons-armoury': ['priority-targets'],
};

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019`']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value) {
  return normalizeName(value).replace(/\bctan\b/g, 'c-tan').replace(/\s+/g, '-');
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

function mappedBase(value) {
  if (value && typeof value === 'object') return { ...value };
  return modelBase(value);
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

function plainText(value) {
  return String(value ?? '')
    .replace(/^\*\*ABILITIES:\*\*\s*/i, '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listItems(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
}

function unitNumber(label) {
  const range = label.match(/(\d+)(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d+)/i);
  if (range) return { minimum: Number(range[1]), maximum: Number(range[2]) };
  const from = label.match(/(\d+)(?:st|nd|rd|th)?\s*\+/i);
  return from ? { minimum: Number(from[1]) } : undefined;
}

function parsePoints(section) {
  const points = [];
  for (const line of sectionText(section, '#### Points').split(/\r?\n/)) {
    const pointMatch = line.match(/\*\*(\d+) pts\*\*/i);
    const modelMatch = line.match(/\b(\d+)\s+models?\b/i);
    if (!pointMatch || !modelMatch) continue;
    const label = line.replace(/^[-*]\s+/, '').split('--')[0].trim();
    const group = label.split(':')[0].trim();
    points.push({
      modelCount: Number(modelMatch[1]),
      points: Number(pointMatch[1]),
      ...(group ? { label: label.replace(`${group}:`, '').trim(), unitNumber: unitNumber(group) } : {}),
    });
  }
  return points;
}

function parseKeywords(section) {
  const keywordText = sectionText(section, '#### Keywords');
  const unitLine = keywordText.match(/\*\*Unit:\*\*\s*(?:KEYWORDS\s*[-:]\s*)?([\s\S]+?)(?=\n\s*-\s*\*\*Faction keywords|$)/i)?.[1] ?? '';
  return unitLine
    .replace(/\s+/g, ' ')
    .split(';')
    .map(keyword => keyword.trim())
    .filter(Boolean);
}

function parseCoreAbilities(section) {
  return listItems(sectionText(section, '#### Core Abilities'))
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

function parseEquipment(section, weapons, modelCount) {
  const composition = sectionText(section, '#### Unit Composition');
  const match = composition.match(/(?:Every model|This model) is equipped with:\s*([^\.]+)\./i);
  if (!match) return undefined;
  const names = match[1].split(';').map(value => value.replace(/^\s*\d+\s+/, '').trim());
  const loadout = [];
  for (const name of names) {
    const indexes = weapons
      .map((weapon, index) => weapon.name.toLowerCase() === name.toLowerCase() ? index : -1)
      .filter(index => index >= 0);
    if (!indexes.length) return undefined;
    loadout.push(...indexes);
  }
  return Array.from({ length: modelCount }, () => [...loadout]);
}

function parseTargetNames(section) {
  return listItems(section)
    .filter(item => /^[A-Z0-9][A-Z0-9 /'&.-]+$/.test(item))
    .map(item => item.replace(/\s+/g, ' ').trim());
}

function namedRules(value, fallbackName) {
  const body = String(value ?? '').replace(/^\*\*ABILITIES:\*\*\s*/i, '').trim();
  const entries = [];
  let current;
  for (const line of body.split(/\r?\n/)) {
    if (/^-\s+/.test(line)) {
      if (current) entries.push(current);
      current = line.replace(/^-\s+/, '').trim();
    } else if (current && line.trim()) {
      current += ` ${line.trim().replace(/^-\s+/, '')}`;
    }
  }
  if (current) entries.push(current);
  if (!entries.length) return [{ name: fallbackName, description: plainText(body), category: 'datasheet' }];
  return entries.map(text => {
    const separator = text.indexOf(':');
    return {
      name: separator > 0 ? text.slice(0, separator).trim() : text,
      description: separator > 0 ? text.slice(separator + 1).trim() : text,
      category: 'datasheet',
    };
  });
}

function parseRawRules(section) {
  const headings = [
    ['#### Abilities', 'Datasheet abilities'],
    ['#### Wargear Abilities', 'Wargear abilities'],
    ['#### Leader', 'Leader'],
    ['#### Support', 'Support'],
    ['#### Transport', 'Transport'],
    ['#### Deployment', 'Deployment'],
    ['#### Supreme Commander', 'Supreme Commander'],
    ['#### Triarchal Menhirs', 'Triarchal Menhirs'],
    ['#### Cryptek Retinue', 'Cryptek Retinue'],
    ['#### Damaged:', 'Damaged profile'],
  ];
  return headings.flatMap(([heading, name]) => {
    const sourceText = sectionText(section, heading);
    if (!sourceText) return [];
    if (heading === '#### Abilities' || heading === '#### Wargear Abilities') return namedRules(sourceText, name);
    const description = plainText(sourceText);
    return description ? [{ name, description, category: 'datasheet' }] : [];
  });
}

function parseProfileRows(rows, modelCount) {
  return rows.map((row, index) => ({
    name: row[0],
    count: index === 0 ? 1 : Math.max(1, modelCount - 1),
    move: stat(row[2], 0),
    toughness: stat(row[3], 4),
    save: stat(row[4], 6),
    wounds: stat(row[5], 1),
    leadership: stat(row[6], 7),
    oc: stat(row[7], 0),
  }));
}

function parseBaseMap(raw) {
  const entries = raw?.units ?? {};
  return Object.fromEntries(Object.entries(entries).map(([name, entry]) => [normalizeName(name), entry]));
}

function basesForUnit(name, modelCount, sourceBase, baseMap) {
  const normalized = normalizeName(name);
  if (normalized === 'the silent king') {
    const szarekh = mappedBase(baseMap['the silent king szarekh']?.base);
    const menhir = mappedBase(baseMap['the silent king triarchal menhir']?.base);
    if (szarekh && menhir) return [{ ...szarekh }, ...Array.from({ length: Math.max(0, modelCount - 1) }, () => ({ ...menhir }))];
  }
  const entry = baseMap[normalized];
  const mapped = mappedBase(entry?.base);
  if (mapped) return Array.from({ length: modelCount }, () => ({ ...mapped }));
  if (sourceBase) return Array.from({ length: modelCount }, () => ({ ...sourceBase }));
  return undefined;
}

function parseUnit(name, section, baseMap, capturedAt) {
  const profileRows = tableRows(section, '#### Profiles');
  const weaponRows = tableRows(section, '#### Weapons');
  if (!profileRows[0]) throw new Error(`${name} has no profile table.`);
  const points = parsePoints(section);
  const counts = [...new Set(points.map(point => point.modelCount))].sort((left, right) => left - right);
  const modelCount = counts[0] ?? 1;
  const weapons = weaponRows.map(row => ({
    name: row[2],
    range: /^melee$/i.test(row[4]) ? 0 : stat(row[4]),
    attacks: row[5],
    skill: /^n\/a$/i.test(row[6]) ? 6 : stat(row[6], 6),
    strength: stat(row[7]),
    ap: Number(row[8]) || 0,
    damage: row[9],
    keywords: weaponKeywords(row[3]),
    isMelee: row[0].toLowerCase() === 'melee',
  }));
  const first = profileRows[0];
  const profile = {
    name,
    move: stat(first[2], 0),
    toughness: stat(first[3], 4),
    save: stat(first[4], 6),
    ...(first[8] !== '--' ? { invulnSave: stat(first[8]) } : {}),
    wounds: stat(first[5], 1),
    leadership: stat(first[6], 7),
    oc: stat(first[7], 0),
    baseModelCount: modelCount,
    modelBases: basesForUnit(name, modelCount, modelBase(first[1]), baseMap),
    ...(profileRows.length > 1 ? { modelProfiles: parseProfileRows(profileRows, modelCount) } : {}),
    keywords: parseKeywords(section),
    factionKeywords: ['Necrons'],
    weapons,
    abilities: parseCoreAbilities(section),
    rules: [],
    preBattleFormations: parsePreBattleFormations(section),
    ...(parseEquipment(section, weapons, modelCount) ? { modelWeaponLoadouts: parseEquipment(section, weapons, modelCount) } : {}),
  };
  const transportCapacity = section.match(/transport capacity of\s+(\d+)/i)?.[1];
  if (transportCapacity) profile.transportCapacity = Number(transportCapacity);
  const damaged = section.match(/#### Damaged:\s*(\d+)-(\d+) Wounds Remaining/i);
  if (damaged) profile.damagedProfile = { maxRemainingWounds: Number(damaged[2]), hitRollModifier: 1 };

  const composition = listItems(sectionText(section, '#### Unit Composition'));
  const role = section.match(/- \*\*Role:\*\*\s*(.+)/)?.[1]?.trim() ?? 'Unit';
  const wahapediaSlug = section.match(/- \*\*Wahapedia slug:\*\* \[[^\]]+\]\([^/]+\/([^/)]+)\)/)?.[1];
  const leaderTargetNames = parseTargetNames(sectionText(section, '#### Leader'));
  const supportTargetNames = parseTargetNames(sectionText(section, '#### Support'));
  const rawRules = parseRawRules(section);
  return {
    id: `necrons.${slug(name)}`,
    name,
    ...(wahapediaSlug ? { aliases: [wahapediaSlug], externalIds: { wahapedia: wahapediaSlug } } : {}),
    status: 'current',
    implementationStatus: 'partial',
    role,
    modelCount: {
      minimum: counts[0] ?? 1,
      ...(counts.length > 1 ? { maximum: counts.at(-1) } : {}),
    },
    points,
    ...(composition.length ? { composition } : {}),
    ...(leaderTargetNames.length ? { leaderTargetNames } : {}),
    ...(supportTargetNames.length ? { _supportTargetNames: supportTargetNames } : {}),
    profile,
    ruleRefs: ['necrons.army-rule.reanimation-protocols'],
    ...(rawRules.length ? { rawRules } : {}),
    sources: [{
      title: `Wahapedia ${name} datasheet`,
      ...(wahapediaSlug ? { url: `https://wahapedia.ru/wh40k11ed/factions/necrons/${wahapediaSlug}` } : {}),
      capturedAt,
    }],
    notes: ['Generated from the saved Wahapedia reference. Datasheet text is available for display; executable ability effects and model-specific wargear validation remain follow-up work.'],
  };
}

function subsection(section, headingPattern) {
  const match = section.match(new RegExp(`^#### ${headingPattern}.*$`, 'mi'));
  if (!match) return '';
  const rest = section.slice(match.index + match[0].length);
  const next = rest.search(/\n#### /);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

function parseDetachmentRules(detachmentText, capturedAt) {
  const rules = [];
  const detachmentRefs = [];
  const sections = [...detachmentText.matchAll(/^### (.+?)(?: \(\d+ DP\))?\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)];
  for (const match of sections) {
    const name = match[1].trim();
    const section = match[0];
    const detachmentId = `necrons.detachment.${slug(name)}`;
    detachmentRefs.push(detachmentId);
    const detachmentRule = section.match(/^#### Detachment rule -- (.+)\r?\n([\s\S]*?)(?=^#### |$)/m);
    if (detachmentRule) {
      rules.push({
        id: detachmentId,
        name: `${name} - ${detachmentRule[1].trim()}`,
        kind: 'detachment-rule',
        status: 'current',
        implementationStatus: 'display-only',
        detachmentId,
        forceDispositions: FORCE_DISPOSITIONS_BY_DETACHMENT[detachmentId] ?? [],
        description: plainText(detachmentRule[2]),
        sources: [{ title: `Wahapedia ${name} detachment`, url: 'https://wahapedia.ru/wh40k11ed/factions/necrons/', capturedAt, section: name }],
      });
    }

    const enhancements = subsection(section, 'Enhancements');
    const enhancementLines = enhancements.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let index = 0; index < enhancementLines.length; index += 1) {
      const header = enhancementLines[index].replace(/^[-*]\s+/, '').trim();
      const cost = header.match(/(\d+)\s+pts\s*$/i);
      if (!cost) continue;
      const rawEnhancementName = header.slice(0, cost.index).trim();
      const isUpgrade = /\s*UPGRADE\s*$/i.test(rawEnhancementName);
      const enhancementName = rawEnhancementName.replace(/\s*UPGRADE\s*$/i, '').trim();
      const description = [];
      index += 1;
      while (index < enhancementLines.length && !/\d+\s+pts\s*$/i.test(enhancementLines[index].replace(/^[-*]\s+/, ''))) {
        description.push(enhancementLines[index].replace(/^[-*]\s+/, '').trim());
        index += 1;
      }
      index -= 1;
      rules.push({
        id: `${detachmentId}.enhancement.${slug(enhancementName)}`,
        name: enhancementName,
        kind: 'wargear',
        status: 'current',
        implementationStatus: 'display-only',
        detachmentId,
        ...(isUpgrade ? { maximumSelections: 3 } : {}),
        description: `${cost[1]} pts.${description.length ? ` ${description.join(' ')}` : ''}`.trim(),
        sources: [{ title: `Wahapedia ${name} enhancements`, url: 'https://wahapedia.ru/wh40k11ed/factions/necrons/', capturedAt, section: name }],
      });
    }

    const stratagems = subsection(section, 'Stratagems');
    const lines = stratagems.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const cards = [];
    let current;
    for (const line of lines) {
      const content = line.replace(/^[-*]\s+/, '').trim();
      const isName = /^[A-Z0-9][A-Z0-9'’&: -]+$/.test(content)
        && !/^\d+CP$/i.test(content)
        && !/Stratagem$/i.test(content)
        && !/^WHEN:|^TARGET:|^EFFECT:|^RESTRICTION/i.test(content);
      if (isName) {
        current = { name: content, lines: [] };
        cards.push(current);
      } else if (current) {
        current.lines.push(content);
      }
    }
    for (const card of cards) {
      const cp = card.lines.find(line => /^\d+CP$/i.test(line));
      const type = card.lines.find(line => /Stratagem$/i.test(line));
      const body = card.lines.filter(line => line !== cp && line !== type).join(' ');
      rules.push({
        id: `${detachmentId}.stratagem.${slug(card.name)}`,
        name: card.name,
        kind: 'stratagem',
        status: 'unsupported',
        implementationStatus: 'display-only',
        detachmentId,
        description: [cp, type, body].filter(Boolean).join('. ').replace(/\.\s*\./g, '.').trim(),
        sources: [{ title: `Wahapedia ${name} stratagem`, url: 'https://wahapedia.ru/wh40k11ed/factions/necrons/', capturedAt, section: `${name} - ${card.name}` }],
        notes: ['Stored as source data until the stratagem effect is represented by the shared typed ability system.'],
      });
    }
  }
  return { rules, detachmentRefs };
}

const source = await readFile(sourcePath, 'utf8');
const capturedAt = source.match(/- Captured:\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? 'unknown';
const baseSizes = JSON.parse(await readFile(resolve(root, 'packages/simulator-core/src/data/baseSizes/necrons.json'), 'utf8'));
const baseMap = parseBaseMap(baseSizes);
const datasheetStart = source.indexOf('## Datasheets');
const detachmentStart = source.indexOf('## Detachments');
const datasheetBody = source.slice(datasheetStart, detachmentStart);
const sections = [...datasheetBody.matchAll(/^### (.+?)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
  .map(match => ({ name: match[1].trim(), body: match[0] }));
const units = sections.map(({ name, body }) => parseUnit(name, body, baseMap, capturedAt));
const unitByName = new Map(units.map(unit => [normalizeName(unit.name), unit]));
for (const unit of units) {
  const supportTargets = unit._supportTargetNames ?? [];
  delete unit._supportTargetNames;
  for (const target of supportTargets) {
    const targetUnit = unitByName.get(normalizeName(target));
    if (!targetUnit) continue;
    targetUnit.supportedByNames ??= [];
    if (!targetUnit.supportedByNames.includes(unit.name)) targetUnit.supportedByNames.push(unit.name);
  }
}
for (const unit of units) {
  if (unit.leaderTargetNames?.length) {
    unit.leaderTargetRefs = unit.leaderTargetNames
      .map(name => unitByName.get(normalizeName(name))?.id)
      .filter(Boolean);
  }
  if (unit.supportedByNames?.length) {
    unit.supportedByRefs = unit.supportedByNames
      .map(name => unitByName.get(normalizeName(name))?.id)
      .filter(Boolean);
  }
}

const armyBody = source.slice(source.indexOf('## Army rule'), datasheetStart);
const armyRuleMatch = armyBody.match(/^### (.+?)\r?\n([\s\S]*?)(?=^## |$)/m);
const armyRule = {
  id: 'necrons.army-rule.reanimation-protocols',
  name: armyRuleMatch?.[1]?.trim() ?? 'Reanimation Protocols',
  kind: 'army-rule',
  status: 'current',
  implementationStatus: 'partial',
  description: plainText(armyRuleMatch?.[2] ?? ''),
  sources: [{ title: 'Wahapedia Necrons army rule', url: 'https://wahapedia.ru/wh40k11ed/factions/necrons/', capturedAt, section: 'Reanimation Protocols' }],
  notes: ['Army rule text is cataloged; executable reanimation timing and wound restoration are handled separately by the simulator runtime.'],
};
const detachmentResult = parseDetachmentRules(source.slice(detachmentStart, source.indexOf('## Extraction audit')), capturedAt);
const rules = [armyRule, ...detachmentResult.rules];
const faction = {
  id: 'necrons',
  name: 'Necrons',
  edition: '11e',
  unitRefs: units.map(unit => unit.id),
  ruleRefs: [armyRule.id],
  detachmentRefs: detachmentResult.detachmentRefs,
  factionKeywords: ['Necrons'],
  sources: [{ title: 'Wahapedia Necrons faction reference', url: 'https://wahapedia.ru/wh40k11ed/factions/necrons/', capturedAt, sourceRevision: 'Faction Pack. Necrons (11th edition, version 1.2)' }],
  coverage: {
    sourceEntryCount: 52,
    normalizedEntryCount: units.length,
    excludedLegendCount: 12,
    notes: ['All current non-Legends Necron datasheets from the saved reference are selectable.', 'Detachment rules, enhancements, and stratagem text are retained as source data; executable effects remain follow-up work.'],
  },
};

await mkdir(resolve(outputDir, 'units'), { recursive: true });
await mkdir(resolve(outputDir, 'factions'), { recursive: true });
await mkdir(resolve(outputDir, 'rules'), { recursive: true });
await writeFile(unitPath, `${JSON.stringify({ factionId: 'necrons', units }, null, 2)}\n`);
await writeFile(factionPath, `${JSON.stringify(faction, null, 2)}\n`);
await writeFile(rulePath, `${JSON.stringify({ factionId: 'necrons', rules }, null, 2)}\n`);
console.log(`Normalized ${units.length} current non-Legends Necron datasheets and ${rules.length} army/detachment entries.`);
