import { applyBaseSizesToArmy } from '../data/unitBaseSizes';
import { loadNecronCatalog, loadOrkCatalog } from '../engine/catalog';
import type { ArmyCatalog, ImportedArmy, RuleText, UnitProfile, WargearChoice } from '../types/army';
import type { UnitDefinition } from '../types/catalog';

export type ListhammerAttachmentRole = 'leader' | 'support' | 'bodyguard';

export interface ListhammerWargearEntry {
  count: number;
  name: string;
}

export interface ListhammerUnitEntry {
  name: string;
  points: number;
  section?: string;
  attachmentGroup?: string;
  attachmentRole?: ListhammerAttachmentRole;
  wargear: ListhammerWargearEntry[];
  enhancements: string[];
}

export interface ListhammerParserOptions {
  /** Resolve a list heading to a complete playable profile from a catalog. */
  resolveUnit?: (unit: ListhammerUnitEntry, occurrence: number) => UnitProfile | undefined;
}

type ParsedHeader = {
  label: string;
  points: number;
  id: string;
};

type ParsedRoster = {
  name: string;
  faction: string;
  battleSize?: ParsedHeader;
  detachment?: { name: string; points?: number };
  mission?: string;
  sourceUrl?: string;
  units: ListhammerUnitEntry[];
};

const FACTION_CATALOGS = [loadOrkCatalog(), loadNecronCatalog()];

function repairText(value: string): string {
  return value
    // Some exports are saved as UTF-8 but later decoded as Windows-1252.
    .replace(/\u00e2\u20ac\u00a2/g, '')
    .replace(/\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac[\u0091\u2011\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-');
}

function cleanLine(value: string): string {
  return repairText(value).replace(/^\s*#{1,6}\s*/, '').trim();
}

function stripBullet(value: string): string {
  return value.replace(/^\s*(?:\u2022|\u25e6|\u00e2\u20ac\u00a2|\*|-)\s*/, '').trim();
}

function normalizeName(value: string): string {
  return repairText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function detachmentIdForName(name: string, faction: string): string | undefined {
  const needle = normalizeName(name);
  if (!needle) return undefined;
  const factionId = normalizeName(faction);
  const catalogs = FACTION_CATALOGS.filter(catalog => catalog.faction(factionId));
  for (const catalog of catalogs) {
    const match = catalog.faction(factionId)?.detachmentRefs?.find(ref => {
      const rule = catalog.rule(ref);
      if (!rule) return false;
      const ruleName = normalizeName(rule.name);
      return ruleName === needle || ruleName.startsWith(`${needle} `);
    });
    if (match) return match;
  }
  return undefined;
}

function slug(value: string): string {
  return normalizeName(value).replace(/\s+/g, '-') || 'roster';
}

function parsePointsHeading(value: string): { label: string; points: number } | undefined {
  const match = value.match(/^(.+?)\s*\(\s*([\d,]+)\s+points?\s*\)$/i);
  if (!match) return undefined;
  return { label: match[1].trim(), points: Number(match[2].replace(/,/g, '')) };
}

function parseDetachmentHeading(value: string): { name: string; points?: number } | undefined {
  const match = value.match(/^(.+?)\s*\(\s*(\d+)\s+detachment\s+points?\s*\)$/i);
  if (!match) return undefined;
  return { name: match[1].trim(), points: Number(match[2]) };
}

function parseCountEntry(value: string): ListhammerWargearEntry | undefined {
  const match = stripBullet(value).match(/^(\d+)\s*x?\s+(.+?)\s*$/i);
  if (!match) return undefined;
  const count = Number(match[1]);
  return Number.isInteger(count) && count > 0
    ? { count, name: match[2].trim() }
    : undefined;
}

function isSectionHeading(value: string): boolean {
  return /^(?:attached units?|characters|other datasheets)$/i.test(value)
    || /^attached unit\s+\d+$/i.test(value);
}

function parseRoster(raw: string): ParsedRoster {
  const lines = raw.split(/\r?\n/).map(cleanLine);
  const nonEmpty = lines.filter(Boolean);
  if (!nonEmpty.length) throw new Error('Listhammer Markdown file is empty.');

  const name = nonEmpty[0];
  const firstUnitIndex = lines.findIndex((line, index) => index > 0 && Boolean(parsePointsHeading(line)) && !/^strike force\b/i.test(line));
  const metadataEnd = firstUnitIndex >= 0 ? firstUnitIndex : lines.length;
  const metadataLines = lines.slice(1, metadataEnd).filter(Boolean);
  const faction = metadataLines.find(line =>
    !parsePointsHeading(line)
    && !parseDetachmentHeading(line)
    && !isSectionHeading(line),
  );
  if (!faction) throw new Error('Listhammer Markdown file does not contain a faction.');

  const battleLine = metadataLines.find(line => /^strike force\b/i.test(line) && parsePointsHeading(line));
  const battlePoints = battleLine ? parsePointsHeading(battleLine) : undefined;
  const battleSize = battlePoints ? {
    ...battlePoints,
    id: slug(`${battlePoints.label} ${battlePoints.points} point limit`),
  } : undefined;
  const detachmentLine = metadataLines.find(line => parseDetachmentHeading(line));
  const detachment = detachmentLine ? parseDetachmentHeading(detachmentLine) : undefined;
  const mission = metadataLines.find(line =>
    line !== faction
    && line !== battleLine
    && line !== detachmentLine
    && !parsePointsHeading(line)
    && !parseDetachmentHeading(line)
    && !isSectionHeading(line),
  );
  const sourceLine = nonEmpty.find(line => /https?:\/\//i.test(line));
  const sourceUrl = sourceLine?.match(/https?:\/\/\S+/i)?.[0];

  const units: ListhammerUnitEntry[] = [];
  let current: ListhammerUnitEntry | undefined;
  let section: string | undefined;
  let attachmentGroup: string | undefined;

  for (const metadataLine of lines.slice(0, metadataEnd)) {
    if (/^attached unit\s+\d+$/i.test(metadataLine)) {
      attachmentGroup = metadataLine;
      section = 'Attached Units';
    } else if (/^(?:attached units?|characters|other datasheets)$/i.test(metadataLine)) {
      section = metadataLine;
    }
  }

  for (const rawLine of lines.slice(metadataEnd)) {
    if (!rawLine) continue;
    if (/^attached unit\s+\d+$/i.test(rawLine)) {
      attachmentGroup = rawLine;
      section = 'Attached Units';
      current = undefined;
      continue;
    }
    if (/^(?:attached units?|characters|other datasheets)$/i.test(rawLine)) {
      section = rawLine;
      if (!/^attached units?$/i.test(rawLine)) attachmentGroup = undefined;
      current = undefined;
      continue;
    }

    const heading = parsePointsHeading(rawLine);
    if (heading) {
      current = {
        name: heading.label,
        points: heading.points,
        ...(section ? { section } : {}),
        ...(attachmentGroup ? { attachmentGroup } : {}),
        wargear: [],
        enhancements: [],
      };
      units.push(current);
      continue;
    }
    if (!current) continue;

    const attachment = stripBullet(rawLine).match(/^attached\s+as:\s*(leader|support|bodyguard)\b/i);
    if (attachment) {
      current.attachmentRole = attachment[1].toLowerCase() as ListhammerAttachmentRole;
      continue;
    }

    const content = stripBullet(rawLine);
    const enhancement = content.match(/^enhancement:\s*(.+)$/i);
    if (enhancement) {
      current.enhancements.push(enhancement[1].trim());
      continue;
    }
    const entry = parseCountEntry(content);
    if (entry) current.wargear.push(entry);
  }

  if (!units.length) throw new Error('Listhammer Markdown file does not contain any datasheets.');
  return { name, faction, battleSize, detachment, mission, sourceUrl, units };
}

function nameMatches(value: string, candidate: string): boolean {
  const left = normalizeName(value);
  const right = normalizeName(candidate);
  return left === right || right.startsWith(`${left} `);
}

function listedWeaponMatches(value: string, candidate: string): boolean {
  const left = normalizeName(value);
  const right = normalizeName(candidate);
  return left === right || right === `${left} strike` || right === `${left} sweep`;
}

function listedCount(entries: ListhammerWargearEntry[], name: string): number {
  return entries
    .filter(entry => nameMatches(entry.name, name) || nameMatches(name, entry.name))
    .reduce((total, entry) => total + entry.count, 0);
}

function inferredModelCount(entry: ListhammerUnitEntry, definition: UnitDefinition): number {
  const weaponNames = definition.profile.weapons.map(weapon => weapon.name);
  const listedModels = entry.wargear
    .filter(item => !weaponNames.some(weaponName => listedWeaponMatches(item.name, weaponName)))
    .reduce((total, item) => total + item.count, 0);
  const pointMatches = definition.points?.filter(point => point.points === entry.points) ?? [];
  const exactModelPoint = pointMatches.find(point => point.modelCount === listedModels);
  if (exactModelPoint) return exactModelPoint.modelCount;
  if (pointMatches.length) return pointMatches[0].modelCount;

  const range = definition.modelCount;
  let count = listedModels || range?.minimum || definition.profile.baseModelCount;
  if (range?.maximum !== undefined) count = Math.min(count, range.maximum);
  if (range?.minimum !== undefined) count = Math.max(count, range.minimum);
  if (range?.step && range.minimum !== undefined) {
    count = range.minimum + Math.floor((count - range.minimum) / range.step) * range.step;
  }
  return Math.max(1, count);
}

function defaultCatalogResolver(entry: ListhammerUnitEntry, occurrence: number): UnitProfile | undefined {
  for (const catalog of FACTION_CATALOGS) {
    const factionId = catalog.bundle.factions[0]?.id;
    if (!factionId) continue;
    const unitId = catalog.unitIdForName(factionId, entry.name);
    if (!unitId) continue;
    const definition = catalog.unit(unitId);
    if (!definition) continue;
    const modelCount = inferredModelCount(entry, definition);
    return catalog.materializeUnit({
      unitId,
      instanceId: `listhammer-${slug(definition.name)}-${occurrence}`,
      modelCount,
    }, { factionId }).profile;
  }
  return undefined;
}

function choiceGroupKey(choice: WargearChoice): string {
  return `${choice.selectionMode ?? 'complete-loadout'}:${choice.slotId ?? 'loadout'}:${(choice.eligibleModelIndexes ?? []).join(',')}`;
}

function weaponIndexesForName(profile: UnitProfile, name: string): number[] {
  const target = normalizeName(name);
  const exact = profile.weapons
    .map((weapon, index) => ({ weapon, index }))
    .filter(({ weapon }) => normalizeName(weapon.name) === target);
  if (exact.length) return [exact[0].index];
  return profile.weapons
    .map((weapon, index) => ({ weapon, index }))
    .filter(({ weapon }) => normalizeName(weapon.name).startsWith(`${target} `))
    .map(({ index }) => index);
}

function weaponIndexesForChoice(profile: UnitProfile, choice: WargearChoice): number[] {
  return (choice.weaponNames ?? []).flatMap(name => weaponIndexesForName(profile, name));
}

function removeWeaponCopies(loadout: number[], indexes: number[]): number[] {
  const next = [...loadout];
  for (const index of indexes) {
    const position = next.indexOf(index);
    if (position >= 0) next.splice(position, 1);
  }
  return next;
}

function loadoutForChoice(profile: UnitProfile, choice: WargearChoice, current: number[]): number[] {
  const weaponIndexes = weaponIndexesForChoice(profile, choice);
  if (choice.selectionMode !== 'replacement-slot') return weaponIndexes;
  return [...removeWeaponCopies(current, (choice.replacesWeaponNames ?? []).flatMap(name => weaponIndexesForName(profile, name))), ...weaponIndexes]
    .sort((left, right) => left - right);
}

function modelRole(choice: WargearChoice): string {
  return normalizeName(choice.label.split(':')[0] ?? choice.label);
}

function modelLoadoutsFromRoster(profile: UnitProfile, entry: ListhammerUnitEntry): UnitProfile {
  const choices = profile.wargearChoices?.filter(choice => choice.kind === 'model-loadout') ?? [];
  if (!choices.length) return profile;

  const modelCount = profile.baseModelCount;
  const loadouts = Array.from({ length: modelCount }, (_, index) => {
    const existing = profile.modelWeaponLoadouts?.[index];
    return existing ? [...existing] : profile.weapons.map((_, weaponIndex) => weaponIndex);
  });
  const modelWargearChoices = Array.from({ length: modelCount }, (_, index) => [
    ...(profile.modelWargearChoices?.[index] ?? []),
  ]);
  const assigned = new Set<number>();
  const groups = [...new Map(choices.map(choice => [choiceGroupKey(choice), choice])).values()]
    .map(first => choices.filter(choice => choiceGroupKey(choice) === choiceGroupKey(first)))
    .sort((left, right) => (left[0]?.eligibleModelIndexes?.length ?? 0) - (right[0]?.eligibleModelIndexes?.length ?? 0));

  for (const group of groups) {
    const activeIndexes = (group[0]?.eligibleModelIndexes ?? [])
      .filter(index => index >= 0 && index < modelCount);
    if (!activeIndexes.length) continue;
    const defaultChoice = group.find(choice => choice.isDefault) ?? group[0];
    const roleCount = listedCount(entry.wargear, modelRole(defaultChoice));
    if (!roleCount) continue;

    const defaultNames = new Set((defaultChoice.weaponNames ?? []).map(normalizeName));
    const alternatives = group
      .filter(choice => choice.id !== defaultChoice.id)
      .map(choice => {
        const signatureNames = (choice.weaponNames ?? []).filter(name => !defaultNames.has(normalizeName(name)));
        const signatureCount = signatureNames.reduce((total, name) => total + listedCount(entry.wargear, name), 0);
        return { choice, signatureCount };
      })
      .filter(candidate => candidate.signatureCount > 0 && weaponIndexesForChoice(profile, candidate.choice).length > 0)
      .sort((left, right) => right.signatureCount - left.signatureCount);

    const assignments: Array<{ choice: WargearChoice; count: number }> = [];
    let assignedCount = 0;
    for (const alternative of alternatives) {
      const count = Math.min(roleCount - assignedCount, alternative.signatureCount);
      if (count <= 0) continue;
      assignments.push({ choice: alternative.choice, count });
      assignedCount += count;
    }
    if (defaultChoice && weaponIndexesForChoice(profile, defaultChoice).length > 0) {
      assignments.push({ choice: defaultChoice, count: Math.max(0, roleCount - assignedCount) });
    }

    let nextSlot = 0;
    for (const assignment of assignments) {
      for (let copy = 0; copy < assignment.count && nextSlot < activeIndexes.length; copy += 1) {
        while (nextSlot < activeIndexes.length && assigned.has(activeIndexes[nextSlot])) nextSlot += 1;
        if (nextSlot >= activeIndexes.length) break;
        const modelIndex = activeIndexes[nextSlot];
        loadouts[modelIndex] = loadoutForChoice(profile, assignment.choice, loadouts[modelIndex]);
        if (assignment.choice.selectionMode === 'replacement-slot') {
          modelWargearChoices[modelIndex] = modelWargearChoices[modelIndex]
            .filter(id => !group.some(choice => choice.id === id));
          modelWargearChoices[modelIndex].push(assignment.choice.id);
        }
        assigned.add(modelIndex);
        nextSlot += 1;
      }
    }
  }

  return { ...profile, modelWeaponLoadouts: loadouts, modelWargearChoices };
}

function unitUpgradesFromRoster(profile: UnitProfile, entry: ListhammerUnitEntry): UnitProfile {
  const upgrades = profile.wargearChoices?.filter(choice => choice.kind === 'unit-upgrade') ?? [];
  if (!upgrades.length) return profile;

  let selected = [...(profile.selectedWargear ?? [])];
  for (const choice of upgrades) {
    const matches = entry.wargear.filter(item =>
      nameMatches(item.name, choice.label)
      || (choice.weaponNames ?? []).some(weaponName => nameMatches(item.name, weaponName)),
    );
    if (!matches.length) continue;
    const requested = matches.reduce((total, item) => total + item.count, 0);
    const limit = choice.maximumSelections === undefined
      ? choice.maximumSelectionsPerModels === undefined
        ? requested
        : Math.floor(profile.baseModelCount / choice.maximumSelectionsPerModels)
      : choice.maximumSelectionsPerModels === undefined
        ? choice.maximumSelections
        : Math.min(choice.maximumSelections, Math.floor(profile.baseModelCount / choice.maximumSelectionsPerModels));
    selected = selected.filter(id => id !== choice.id);
    selected.push(...Array.from({ length: Math.min(requested, limit) }, () => choice.id));
  }

  return selected.length || profile.selectedWargear?.length
    ? { ...profile, selectedWargear: selected }
    : profile;
}

function addImportedEnhancements(profile: UnitProfile, entry: ListhammerUnitEntry): UnitProfile {
  if (!entry.enhancements.length) return profile;
  const additions: RuleText[] = entry.enhancements.map(name => ({
    name: `Enhancement: ${name}`,
    description: 'Selected in the Listhammer roster. The Markdown export does not include the enhancement rules text.',
    category: 'wargear',
  }));
  return { ...profile, abilities: [...profile.abilities, ...additions] };
}

function applyRosterSelections(profile: UnitProfile, entry: ListhammerUnitEntry): UnitProfile {
  return addImportedEnhancements(
    unitUpgradesFromRoster(modelLoadoutsFromRoster(profile, entry), entry),
    entry,
  );
}

function catalogForRoster(roster: ParsedRoster, profiles: UnitProfile[]): ArmyCatalog | undefined {
  const nameCounts = new Map<string, number>();
  for (const profile of profiles) {
    nameCounts.set(profile.name, (nameCounts.get(profile.name) ?? 0) + 1);
  }
  const units = profiles.map((profile, index) => {
    const source = roster.units[index];
    return {
      id: profile.rosterId ?? `listhammer-${index + 1}`,
      ...(nameCounts.get(profile.name) === 1 ? { names: [profile.name] } : {}),
      modelCountPoints: { [String(profile.baseModelCount)]: source.points },
      ...(profile.modelCountRange?.minimum !== undefined ? { minimumModels: profile.modelCountRange.minimum } : {}),
      ...(profile.modelCountRange?.maximum !== undefined ? { maximumModels: profile.modelCountRange.maximum } : {}),
    };
  });
  return units.length ? {
    id: `listhammer-${slug(roster.name)}`,
    faction: roster.faction,
    units,
    ...(roster.battleSize ? {
      battleSizes: [{
        id: roster.battleSize.id,
        label: roster.battleSize.label,
        maximumPoints: roster.battleSize.points,
      }],
    } : {}),
  } : undefined;
}

/** Parse a Listhammer.info Markdown roster into resolved simulator units. */
export function parseListhammerMarkdown(raw: string, options: ListhammerParserOptions = {}): ImportedArmy {
  const roster = parseRoster(raw);
  const resolver = options.resolveUnit ?? defaultCatalogResolver;
  const occurrences = new Map<string, number>();
  const unresolved: string[] = [];
  const resolved = roster.units.map(entry => {
    const key = normalizeName(entry.name);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const profile = resolver(entry, occurrence);
    if (!profile) {
      unresolved.push(entry.name);
      return undefined;
    }
    const rosterId = `listhammer-${slug(entry.name)}-${occurrence}`;
    return {
      entry,
      profile: applyRosterSelections({ ...profile, rosterId }, entry),
    };
  });

  if (unresolved.length) {
    const names = [...new Set(unresolved)].join(', ');
    throw new Error(`Listhammer roster contains units that are not in the available catalog: ${names}`);
  }

  const resolvedUnits = resolved.filter((unit): unit is { entry: ListhammerUnitEntry; profile: UnitProfile } => Boolean(unit));
  const units = resolvedUnits.map(unit => unit.profile);
  for (const group of new Set(resolvedUnits.map(unit => unit.entry.attachmentGroup).filter((value): value is string => Boolean(value)))) {
    const members = resolvedUnits.filter(unit => unit.entry.attachmentGroup === group);
    const bodyguard = members.find(unit => unit.entry.attachmentRole === 'bodyguard');
    if (!bodyguard) continue;
    for (const member of members) {
      if (member.entry.attachmentRole !== 'leader' && member.entry.attachmentRole !== 'support') continue;
      member.profile.leaderAttachment = { attachedToUnitId: bodyguard.profile.rosterId };
    }
  }

  const sourceMetadata = {
    sourceName: 'Listhammer.info',
    ...(roster.sourceUrl ? { sourceUrl: roster.sourceUrl } : {}),
    ...(roster.detachment ? {
      detachmentName: roster.detachment.name,
      ...(roster.detachment.points === undefined ? {} : { detachmentPoints: roster.detachment.points }),
    } : {}),
    ...(roster.mission ? { missionName: roster.mission } : {}),
  };
  return applyBaseSizesToArmy({
    name: roster.name,
    faction: roster.faction,
    units,
    sourceEdition: '11e',
    ...(roster.battleSize ? { battleSizeId: roster.battleSize.id } : {}),
    ...(roster.detachment ? { detachmentId: detachmentIdForName(roster.detachment.name, roster.faction) } : {}),
    ...(Object.keys(sourceMetadata).length ? { sourceMetadata } : {}),
    catalog: catalogForRoster(roster, units),
  });
}
