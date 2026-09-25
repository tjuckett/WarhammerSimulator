import type { UnitProfile, WargearChoice } from '../types/army';

type ParsedWargearOption = {
  text: string;
  eligibleModelIndexes: number[];
  maximumSelections?: number;
  maximumSelectionsPerModels?: number;
  kind: 'replace' | 'equip';
  replaces: string[];
  alternatives: string[][];
};

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2019\u2018`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slug(value: string): string {
  return normalizeName(value).replace(/\s+/g, '-');
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function modelIndexesForRole(unit: UnitProfile, role: string | undefined): number[] {
  if (!role || normalizeName(role) === 'model') {
    return Array.from({ length: unit.baseModelCount }, (_, index) => index);
  }

  const profiles = unit.modelProfiles ?? [];
  if (!profiles.length) return Array.from({ length: unit.baseModelCount }, (_, index) => index);

  const wanted = normalizeName(role).replace(/\bmodels?\b/g, '').trim();
  const indexes: number[] = [];
  let offset = 0;
  profiles.forEach((profile, profileIndex) => {
    const count = profileIndex === profiles.length - 1
      ? Math.max(profile.count, unit.baseModelCount - offset)
      : profile.count;
    const candidate = normalizeName(profile.name);
    if (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate)) {
      for (let index = offset; index < Math.min(unit.baseModelCount, offset + count); index += 1) indexes.push(index);
    }
    offset += count;
  });

  return indexes.length
    ? indexes
    : Array.from({ length: unit.baseModelCount }, (_, index) => index);
}

function subjectForOption(text: string): { role?: string; eligibleModelIndexes: number[]; maximumSelections?: number; maximumSelectionsPerModels?: number } {
  const everyModel = text.match(/for every\s+(\d+)\s+models?\s+in this unit,\s*(?:\d+\s+)?model\s+can\b/i);
  if (everyModel) return { eligibleModelIndexes: [], maximumSelectionsPerModels: Number(everyModel[1]) };

  const every = text.match(/for every\s+(\d+)\s+models?\s+in this unit,\s*(?:\d+\s+)?(.+?)\s+models?\s+can\b/i);
  if (every) {
    const role = every[2].trim();
    return { role, eligibleModelIndexes: [], maximumSelectionsPerModels: Number(every[1]) };
  }

  const all = text.match(/^all(?:\s+of\s+the)?\s+(.+?)(?:\s+in\s+this\s+unit)?\s+can\s+each\b/i);
  if (all) {
    const role = all[1].trim();
    return { role: normalizeName(role) === 'models' ? undefined : role, eligibleModelIndexes: [] };
  }

  const upToModels = text.match(/^up\s+to\s+(\d+)\s+models?\s+can\b/i);
  if (upToModels) return { eligibleModelIndexes: [], maximumSelections: Number(upToModels[1]) };

  const upTo = text.match(/up to\s+(\d+)\s+(.+?)\s+models?\s+can\b/i);
  if (upTo) return { role: upTo[2].trim(), eligibleModelIndexes: [], maximumSelections: Number(upTo[1]) };

  const numbered = text.match(/(?:^|\s)(\d+|one)\s+(.+?)\s+models?\s+(?:can|may)\b/i);
  if (numbered) return {
    role: numbered[2].trim(),
    eligibleModelIndexes: [],
    maximumSelections: numbered[1].toLowerCase() === 'one' ? 1 : Number(numbered[1]),
  };
  const numberedModels = text.match(/^(\d+|one)\s+models?\s+(?:can|may)\b/i);
  if (numberedModels) return {
    eligibleModelIndexes: [],
    maximumSelections: numberedModels[1].toLowerCase() === 'one' ? 1 : Number(numberedModels[1]),
  };

  const anyNumber = text.match(/any number of\s+(.+?)\s+models?\s+can\b/i);
  if (anyNumber) return { role: anyNumber[1].trim(), eligibleModelIndexes: [] };

  if (/any number of models can\b/i.test(text)) return { eligibleModelIndexes: [] };

  const named = text.match(/the\s+(.+?)\s+can\s+(?:have|be)\b/i);
  if (named) return { role: named[1].trim(), eligibleModelIndexes: [], maximumSelections: 1 };

  if (/^this model\b/i.test(text)) return { eligibleModelIndexes: [0], maximumSelections: 1 };
  return { eligibleModelIndexes: [], maximumSelections: 1 };
}

function equipmentTerms(value: string): string[] {
  const terms = value
    .replace(/\s+in addition to any other weapons?$/i, '')
    .trim();
  if (normalizeName(terms) === 'tracks and wheels') return [terms];
  return terms
    .split(/\s+and\s+(?:(?:\d+|up to \d+)\s+)?/i)
    .flatMap(term => {
      const cleaned = term.trim().replace(/^up to\s+\d+\s+/i, '').trim();
      const count = Number(cleaned.match(/^(\d+)\s+/)?.[1] ?? 1);
      const name = cleaned.replace(/^\d+\s+/, '').trim();
      return name ? Array.from({ length: count }, () => name) : [];
    });
}

function equipmentAlternatives(value: string): string[][] {
  const following = value.match(/one of the following\s*:\s*(.*)$/i);
  const body = following?.[1] ?? value;
  return body
    .split(';')
    .map(alternative => equipmentTerms(alternative))
    .filter(alternative => alternative.length > 0);
}

function weaponNamesForTerm(unit: UnitProfile, term: string, preferCurrentLoadout = false, eligibleModelIndexes: number[] = []): string[] {
  const wanted = normalizeName(term);
  const exact = unit.weapons.filter(weapon => normalizeName(weapon.name) === wanted);
  if (exact.length) return exact.map(weapon => weapon.name);

  const grouped = unit.weapons.filter(weapon => normalizeName(weapon.profileGroup ?? '') === wanted);
  if (!grouped.length) return [];
  if (!preferCurrentLoadout) return grouped.map(weapon => weapon.name);

  const currentIndexes = unit.modelWeaponLoadouts?.[eligibleModelIndexes[0] ?? 0] ?? [];
  const current = currentIndexes
    .map(index => unit.weapons[index])
    .filter((weapon): weapon is NonNullable<typeof weapon> => !!weapon && normalizeName(weapon.profileGroup ?? '') === wanted);
  return current.length ? current.map(weapon => weapon.name) : grouped.map(weapon => weapon.name);
}

function namesForTerms(unit: UnitProfile, terms: string[], preferCurrentLoadout: boolean, eligibleModelIndexes: number[]): string[] {
  return terms.flatMap(term => weaponNamesForTerm(unit, term, preferCurrentLoadout, eligibleModelIndexes));
}

function defaultLoadoutNames(unit: UnitProfile, eligibleModelIndexes: number[]): string[] {
  const loadout = unit.modelWeaponLoadouts?.[eligibleModelIndexes[0] ?? 0] ?? [];
  return loadout.map(index => unit.weapons[index]?.name).filter((name): name is string => !!name);
}

function parseOption(unit: UnitProfile, text: string): ParsedWargearOption | undefined {
  const normalizedText = text
    .replace(/[\u2019\u2018`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]$/, '');
  const subject = subjectForOption(normalizedText);
  const equippedMaximum = normalizedText.match(/equipped with up to\s+(\d+)\b/i)?.[1];
  if (equippedMaximum && /^this model\b/i.test(normalizedText)) subject.maximumSelections = Number(equippedMaximum);
  subject.eligibleModelIndexes = subject.eligibleModelIndexes.length
    ? subject.eligibleModelIndexes
    : modelIndexesForRole(unit, subject.role);

  const replacement = normalizedText.match(/(?:replaced|replace)\s+with\s+(.+)$/i);
  if (replacement) {
    const beforeReplacement = normalizedText.slice(0, replacement.index ?? 0);
    const oldEquipment = beforeReplacement
      .match(/(?:their|its|model's|models')\s+(.+)$/i)?.[1]
      ?.replace(/\s+can\s+(?:have|be)\s*$/i, '')
      .trim();
    if (!oldEquipment) return undefined;
    const replaces = namesForTerms(
      unit,
      equipmentTerms(oldEquipment),
      true,
      subject.eligibleModelIndexes,
    );
    const alternatives = equipmentAlternatives(replacement[1]).map(terms => {
      const names = namesForTerms(unit, terms, false, subject.eligibleModelIndexes);
      return names.length ? names : terms;
    });
    if (!replaces.length || alternatives.some(alternative => !alternative.length)) return undefined;
    return {
      text,
      eligibleModelIndexes: subject.eligibleModelIndexes,
      maximumSelections: subject.maximumSelections,
      maximumSelectionsPerModels: subject.maximumSelectionsPerModels,
      kind: 'replace',
      replaces,
      alternatives,
    };
  }

  const equipped = normalizedText.match(/equipped with\s+(.+)$/i);
  if (!equipped) return undefined;
  const alternatives = equipmentAlternatives(equipped[1]).map(terms => {
    const names = namesForTerms(unit, terms, false, subject.eligibleModelIndexes);
    return names.length ? names : terms;
  });
  if (alternatives.some(alternative => !alternative.length)) return undefined;
  return {
    text,
    eligibleModelIndexes: subject.eligibleModelIndexes,
    maximumSelections: subject.maximumSelections,
    maximumSelectionsPerModels: subject.maximumSelectionsPerModels,
    kind: 'equip',
    replaces: [],
    alternatives,
  };
}

function choiceId(unitId: string, label: string, index: number): string {
  return `${unitId}.wargear.${slug(label)}-${index + 1}`;
}

function displayWeaponNames(unit: UnitProfile, names: string[]): string[] {
  const profileGroups = new Map<string, { displayName: string; profileNames: Set<string> }>();
  names.forEach(name => {
    const weapon = unit.weapons.find(candidate => normalizeName(candidate.name) === normalizeName(name));
    const group = weapon?.profileGroup?.trim();
    if (!group) return;
    const key = normalizeName(group);
    const entry = profileGroups.get(key) ?? { displayName: group, profileNames: new Set<string>() };
    entry.profileNames.add(normalizeName(name));
    profileGroups.set(key, entry);
  });

  const emittedGroups = new Set<string>();
  return names.flatMap(name => {
    const weapon = unit.weapons.find(candidate => normalizeName(candidate.name) === normalizeName(name));
    const group = weapon?.profileGroup?.trim();
    if (!group) return [name];
    const key = normalizeName(group);
    const profileGroup = profileGroups.get(key);
    if (!profileGroup || profileGroup.profileNames.size <= 1) return [profileGroup?.displayName ?? group];
    if (emittedGroups.has(key)) return [];
    emittedGroups.add(key);
    return [profileGroup.displayName];
  });
}

function choiceLabel(unit: UnitProfile, names: string[]): string {
  return `Wargear: ${displayWeaponNames(unit, names).join(' + ')}`;
}

function addSingleModelChoiceGroup(
  choices: WargearChoice[],
  unitId: string,
  unit: UnitProfile,
  option: ParsedWargearOption,
  optionIndex: number,
): void {
  const slotId = `slot-${optionIndex + 1}`;
  const defaultNames = option.kind === 'replace'
    ? option.replaces
    : defaultLoadoutNames(unit, option.eligibleModelIndexes);
  if (!defaultNames.length) return;
  const common = {
    kind: 'model-loadout' as const,
    eligibleModelIndexes: option.eligibleModelIndexes,
    selectionMode: option.kind === 'replace' ? 'replacement-slot' as const : 'complete-loadout' as const,
    slotId,
    description: option.text,
  };
  choices.push({
    id: choiceId(unitId, `${slotId}-standard`, choices.length),
    label: choiceLabel(unit, defaultNames),
    isDefault: true,
    weaponNames: defaultNames,
    ...common,
  });
  option.alternatives.forEach(alternative => {
    const names = option.kind === 'replace'
      ? alternative
      : [...defaultNames, ...alternative];
    choices.push({
      id: choiceId(unitId, `${slotId}-${names.join('-')}`, choices.length),
      label: choiceLabel(unit, names),
      eligibleModelIndexes: option.eligibleModelIndexes,
      selectionMode: common.selectionMode,
      slotId,
      maximumSelections: option.maximumSelections,
      maximumSelectionsPerModels: option.maximumSelectionsPerModels,
      limitGroup: slotId,
      weaponNames: names,
      replacesWeaponNames: option.kind === 'replace' ? option.replaces : undefined,
      description: option.text,
      kind: 'model-loadout',
    });
  });
}

function removeWeaponNames(loadout: string[], removed: string[]): string[] {
  const remaining = [...loadout];
  for (const name of removed) {
    const index = remaining.findIndex(candidate => normalizeName(candidate) === normalizeName(name));
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

function addSharedModelChoiceGroup(
  choices: WargearChoice[],
  unitId: string,
  unit: UnitProfile,
  groupId: string,
  options: ParsedWargearOption[],
): void {
  const eligibleModelIndexes = options[0]?.eligibleModelIndexes ?? [];
  if (!eligibleModelIndexes.length || options.some(option => option.eligibleModelIndexes.join(',') !== eligibleModelIndexes.join(','))) {
    options.forEach((option, index) => addSingleModelChoiceGroup(choices, unitId, unit, option, index));
    return;
  }
  const defaultNames = defaultLoadoutNames(unit, eligibleModelIndexes);
  if (!defaultNames.length) return;
  const slotId = `group-${slug(groupId)}`;
  choices.push({
    id: choiceId(unitId, `${slotId}-standard`, choices.length),
    label: choiceLabel(unit, defaultNames),
    isDefault: true,
    weaponNames: defaultNames,
    kind: 'model-loadout',
    eligibleModelIndexes,
    selectionMode: 'complete-loadout',
    slotId,
    description: options[0].text,
  });
  options.forEach(option => option.alternatives.forEach(alternative => {
    const names = option.kind === 'replace'
      ? [...removeWeaponNames(defaultNames, option.replaces), ...alternative]
      : [...defaultNames, ...alternative];
    choices.push({
      id: choiceId(unitId, `${slotId}-${names.join('-')}`, choices.length),
      label: choiceLabel(unit, names),
      kind: 'model-loadout',
      eligibleModelIndexes,
      selectionMode: 'complete-loadout',
      slotId,
      maximumSelections: option.maximumSelections,
      maximumSelectionsPerModels: option.maximumSelectionsPerModels,
      limitGroup: slotId,
      weaponNames: names,
      description: option.text,
    });
  }));
}

export function deriveWargearChoices(
  unitId: string,
  unit: UnitProfile,
  options: string[],
  optionGroups: Array<string | undefined> = [],
): WargearChoice[] {
  const choices: WargearChoice[] = [];
  const sharedGroups = new Map<string, ParsedWargearOption[]>();
  options.forEach((text, optionIndex) => {
    const option = parseOption(unit, text);
    if (!option) return;
    const isSingleModelUpgrade = option.kind === 'equip'
      && option.eligibleModelIndexes.length === 1
      && option.eligibleModelIndexes[0] === 0;
    if (isSingleModelUpgrade) {
      const limitGroup = option.alternatives.length > 1 ? `unit-option-${optionIndex + 1}` : undefined;
      option.alternatives.forEach(alternative => {
        choices.push({
          id: choiceId(unitId, alternative.join('-'), choices.length),
          label: choiceLabel(unit, alternative),
          kind: 'unit-upgrade',
          maximumSelections: option.maximumSelections,
          maximumSelectionsPerModels: option.maximumSelectionsPerModels,
          limitGroup,
          weaponNames: alternative,
          description: text,
        });
      });
      return;
    }
    const explicitGroupId = optionGroups[optionIndex];
    const inferredGroupId = option.eligibleModelIndexes.length > 1
      ? `eligible-models-${option.eligibleModelIndexes.join('-')}`
      : undefined;
    const groupId = explicitGroupId ?? inferredGroupId;
    if (!groupId) {
      addSingleModelChoiceGroup(choices, unitId, unit, option, optionIndex);
      return;
    }
    const group = sharedGroups.get(groupId) ?? [];
    group.push(option);
    sharedGroups.set(groupId, group);
  });
  for (const [groupId, group] of sharedGroups) addSharedModelChoiceGroup(choices, unitId, unit, groupId, group);
  return choices;
}
