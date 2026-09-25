import type {
  ImportedArmy,
  PreBattleFormationRule,
  RuleText,
  UnitProfile,
} from '../types/army';
import type {
  BattleState,
  PendingPreBattleFormation,
  PreBattleFormationResolution,
  Side,
} from '../types/battle';

export type { PreBattleFormationResolution } from '../types/battle';
import { clone } from './clone';
import { unitRosterId } from './armyUnits';

function normalized(value: string): string {
  return value
    .replace(/[’‘`]/g, "'")
    .trim()
    .toLowerCase();
}

function matchesRuleName(actual: string, requested: string): boolean {
  const actualName = normalized(actual);
  const requestedName = normalized(requested);
  return actualName === requestedName || actualName.startsWith(`${requestedName} (`);
}

function formationGroups(profile: UnitProfile, rule: PreBattleFormationRule): number[][] | null {
  if (rule.kind !== 'split-unit' || !rule.modelCounts.length) return null;
  if (rule.modelCounts.some(count => !Number.isInteger(count) || count < 1)) return null;
  if (rule.modelCounts.reduce((total, count) => total + count, 0) !== profile.baseModelCount) return null;

  const groups: number[][] = [];
  let cursor = 0;
  for (const count of rule.modelCounts) {
    groups.push(Array.from({ length: count }, (_, index) => cursor + index));
    cursor += count;
  }
  return groups;
}

function sourceProfileForModel(profile: UnitProfile, modelIndex: number): number {
  let cursor = 0;
  for (let profileIndex = 0; profileIndex < (profile.modelProfiles?.length ?? 0); profileIndex += 1) {
    const count = profile.modelProfiles![profileIndex].count;
    if (modelIndex < cursor + count) return profileIndex;
    cursor += count;
  }
  return 0;
}

function sliceModelProfiles(profile: UnitProfile, indexes: number[]): UnitProfile['modelProfiles'] {
  if (!profile.modelProfiles?.length) return undefined;
  const counts = profile.modelProfiles.map(() => 0);
  indexes.forEach(index => { counts[sourceProfileForModel(profile, index)] += 1; });
  return profile.modelProfiles
    .map((modelProfile, profileIndex) => ({ ...modelProfile, count: counts[profileIndex] }))
    .filter(modelProfile => modelProfile.count > 0);
}

function sliceModelValues<T>(values: T[] | undefined, indexes: number[], copy: (value: T) => T): T[] | undefined {
  if (!values?.length) return undefined;
  return indexes.map(index => copy(values[index] ?? values[0]));
}

function assignedRuleText(profile: UnitProfile, name: string): RuleText {
  const existing = [...profile.abilities, ...(profile.rules ?? [])].find(rule => matchesRuleName(rule.name, name));
  return existing ? { ...existing, tags: existing.tags ? [...existing.tags] : undefined } : {
    name,
    description: `Assigned to this split unit by the ${name} formation rule.`,
    category: 'datasheet',
  };
}

function assignedAbilities(
  profile: UnitProfile,
  rule: PreBattleFormationRule,
  groupIndex: number,
  childIndex: number,
  assignments: Record<string, string[]> | undefined,
): string[] {
  const group = rule.abilityGroups?.[groupIndex];
  if (!group) return [];
  const selected = assignments?.[group.id]?.[childIndex] ?? group.abilityNames[childIndex] ?? group.abilityNames[0];
  return selected ? [selected] : [];
}

function validateAssignments(rule: PreBattleFormationRule, assignments: Record<string, string[]> | undefined): boolean {
  for (const group of rule.abilityGroups ?? []) {
    const selected = assignments?.[group.id];
    if (!selected || selected.length !== rule.modelCounts.length) return false;
    if (selected.some(value => !group.abilityNames.some(option => normalized(option) === normalized(value)))) return false;
    if (group.abilityNames.length >= rule.modelCounts.length
      && new Set(selected.map(value => normalized(value))).size !== selected.length) return false;
  }
  return true;
}

function splitProfile(
  profile: UnitProfile,
  rule: PreBattleFormationRule,
  assignments?: Record<string, string[]>,
): UnitProfile[] | null {
  const groups = formationGroups(profile, rule);
  if (!groups || !validateAssignments(rule, assignments)) return null;
  const exclusiveNames = (rule.abilityGroups ?? []).flatMap(group => group.abilityNames);
  const splitCount = groups.length;

  return groups.map((indexes, childIndex) => {
    const child = clone(profile);
    const originalRosterId = unitRosterId(profile);
    child.rosterId = childIndex === 0 ? originalRosterId : `${originalRosterId}::${rule.id}::${childIndex + 1}`;
    child.name = `${profile.name} (Split ${childIndex + 1})`;
    child.baseModelCount = indexes.length;
    child.modelCountRange = { minimum: indexes.length, maximum: indexes.length };
    child.modelProfiles = sliceModelProfiles(profile, indexes);
    child.modelBases = sliceModelValues(profile.modelBases, indexes, base => ({ ...base }));
    child.modelWeaponLoadouts = sliceModelValues(profile.modelWeaponLoadouts, indexes, loadout => [...loadout]);
    child.modelWargearChoices = sliceModelValues(profile.modelWargearChoices, indexes, choices => [...choices]);
    child.wargearChoices = profile.wargearChoices?.map(choice => ({
      ...choice,
      eligibleModelIndexes: choice.eligibleModelIndexes
        ?.map(sourceIndex => indexes.indexOf(sourceIndex))
        .filter(index => index >= 0),
      weaponNames: choice.weaponNames ? [...choice.weaponNames] : undefined,
      replacesWeaponNames: choice.replacesWeaponNames ? [...choice.replacesWeaponNames] : undefined,
    }));
    child.unitLoadoutOptions = undefined;
    child.preBattleFormations = profile.preBattleFormations?.filter(candidate => candidate.id !== rule.id)
      .map(candidate => ({
        ...candidate,
        modelCounts: [...candidate.modelCounts],
        abilityGroups: candidate.abilityGroups?.map(group => ({ ...group, abilityNames: [...group.abilityNames] })),
      }));
    child.abilities = profile.abilities
      .filter(ability => !exclusiveNames.some(name => matchesRuleName(ability.name, name)))
      .map(ability => ({ ...ability, tags: ability.tags ? [...ability.tags] : undefined }));
    child.rules = profile.rules
      ?.filter(ability => !exclusiveNames.some(name => matchesRuleName(ability.name, name)))
      .map(ability => ({ ...ability, tags: ability.tags ? [...ability.tags] : undefined }));
    for (let groupIndex = 0; groupIndex < (rule.abilityGroups ?? []).length; groupIndex += 1) {
      for (const abilityName of assignedAbilities(profile, rule, groupIndex, childIndex, assignments)) {
        child.abilities.push(assignedRuleText(profile, abilityName));
      }
    }
    return child;
  });
}

function replaceArmyFormation(
  army: ImportedArmy,
  sourceUnitId: string,
  rule: PreBattleFormationRule,
  assignments?: Record<string, string[]>,
): boolean {
  const sourceIndex = army.units.findIndex(profile => unitRosterId(profile) === sourceUnitId);
  if (sourceIndex < 0) return false;
  const source = army.units[sourceIndex];
  const split = splitProfile(source, rule, assignments);
  if (!split) return false;
  const firstChildId = unitRosterId(split[0]);
  army.units = [...army.units.slice(0, sourceIndex), ...split, ...army.units.slice(sourceIndex + 1)];
  army.units.forEach(profile => {
    if (profile.leaderAttachment?.attachedToUnitId === sourceUnitId
      || profile.leaderAttachment?.attachedToName === source.name) {
      profile.leaderAttachment = { attachedToUnitId: firstChildId };
    }
  });
  return true;
}

export function pendingPreBattleFormations(armies: [ImportedArmy, ImportedArmy]): PendingPreBattleFormation[] {
  return armies.flatMap((army, side) => army.units.flatMap(profile => (profile.preBattleFormations ?? [])
    .filter(rule => formationGroups(profile, rule) !== null)
    .map(rule => ({
      id: `${side}:${unitRosterId(profile)}:${rule.id}`,
      side: side as Side,
      unitRosterId: unitRosterId(profile),
      unitName: profile.name,
      formation: {
        ...rule,
        modelCounts: [...rule.modelCounts],
        abilityGroups: rule.abilityGroups?.map(group => ({ ...group, abilityNames: [...group.abilityNames] })),
      },
    }))));
}

export function resolvePreBattleFormation(
  state: BattleState,
  resolution: PreBattleFormationResolution,
): BattleState {
  const request = state.pendingPreBattleFormations?.find(candidate => candidate.id === resolution.requestId);
  if (!request) return state;
  const next = clone(state);
  const nextRequest = next.pendingPreBattleFormations?.find(candidate => candidate.id === resolution.requestId);
  if (!nextRequest) return state;
  if (!replaceArmyFormation(next.armies[request.side].army, request.unitRosterId, nextRequest.formation, resolution.abilityAssignments)) return state;
  const sourceIndex = next.unplacedUnits[request.side].findIndex(profile => unitRosterId(profile) === request.unitRosterId);
  if (sourceIndex >= 0) {
    const source = next.unplacedUnits[request.side][sourceIndex];
    const split = splitProfile(source, nextRequest.formation, resolution.abilityAssignments);
    if (!split) return state;
    next.unplacedUnits[request.side] = [
      ...next.unplacedUnits[request.side].slice(0, sourceIndex),
      ...split,
      ...next.unplacedUnits[request.side].slice(sourceIndex + 1),
    ];
  }
  next.pendingPreBattleFormations = (next.pendingPreBattleFormations ?? []).filter(candidate => candidate.id !== resolution.requestId);
  next.activeArmy = next.pendingPreBattleFormations[0]?.side ?? next.activeArmy;
  return next;
}

/** Resolve formation rules deterministically for non-interactive simulations. */
export function applyDefaultPreBattleFormations(army: ImportedArmy): ImportedArmy {
  const next = clone(army);
  for (let index = 0; index < next.units.length; index += 1) {
    const profile = next.units[index];
    const rule = profile.preBattleFormations?.[0];
    if (!rule) continue;
    const assignments = Object.fromEntries((rule.abilityGroups ?? []).map(group => [
      group.id,
      rule.modelCounts.map((_, childIndex) => group.abilityNames[childIndex] ?? group.abilityNames[0]),
    ]));
    replaceArmyFormation(next, unitRosterId(profile), rule, assignments);
    index += rule.modelCounts.length - 1;
  }
  return next;
}
