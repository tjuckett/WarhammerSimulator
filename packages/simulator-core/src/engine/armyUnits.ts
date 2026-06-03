import type { ImportedArmy, UnitProfile } from '../types/army';

export function isImportedArmy(value: unknown): value is ImportedArmy {
  if (!value || typeof value !== 'object') return false;
  const army = value as Partial<ImportedArmy>;
  return typeof army.name === 'string'
    && typeof army.faction === 'string'
    && Array.isArray(army.units);
}

function normalizedRuleName(value: string): string {
  return value.trim().toLowerCase();
}

export function unitHasRule(unit: UnitProfile, ruleName: string): boolean {
  const needle = normalizedRuleName(ruleName);
  const keywordMatch = [...unit.keywords, ...unit.factionKeywords]
    .some(keyword => normalizedRuleName(keyword) === needle);
  if (keywordMatch) return true;

  const ruleText = [...unit.abilities, ...(unit.rules ?? [])];
  return ruleText.some(rule =>
    normalizedRuleName(rule.name) === needle
    || normalizedRuleName(rule.description).includes(needle),
  );
}

export function canDeployOutsideDeploymentZone(unit: UnitProfile): boolean {
  return unitHasRule(unit, 'Infiltrators');
}

export function unitRosterId(unit: UnitProfile): string {
  return unit.rosterId ?? unit.name;
}

export function deployableUnits(army: ImportedArmy): UnitProfile[] {
  return army.units.filter(unit => (unit.deployment?.mode ?? 'battlefield') === 'battlefield');
}

export function unitMatchesAttachmentTarget(unit: UnitProfile, target: UnitProfile): boolean {
  return unit.leaderAttachment?.attachedToUnitId === unitRosterId(target)
    || (!unit.leaderAttachment?.attachedToUnitId && unit.leaderAttachment?.attachedToName === target.name);
}

export function attachedLeadersFor(
  army: ImportedArmy,
  bodyguard: UnitProfile,
  units = deployableUnits(army),
): UnitProfile[] {
  return units.filter(unit => unit !== bodyguard && unitMatchesAttachmentTarget(unit, bodyguard));
}

export function attachedUnitProfilesFor(
  army: ImportedArmy,
  unit: UnitProfile,
  units = deployableUnits(army),
): UnitProfile[] {
  const unitId = unitRosterId(unit);
  const bodyguard = unit.leaderAttachment
    ? units.find(candidate =>
      unitRosterId(candidate) !== unitId && unitMatchesAttachmentTarget(unit, candidate),
    ) ?? unit
    : unit;
  const bodyguardId = unitRosterId(bodyguard);
  const leaders = attachedLeadersFor(army, bodyguard, units).filter(leader => unitRosterId(leader) !== bodyguardId);
  const profiles = [bodyguard, ...leaders];
  const seen = new Set<string>();
  return profiles.filter(profile => {
    const id = unitRosterId(profile);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function attachedFollowersFor(
  army: ImportedArmy,
  bodyguard: UnitProfile,
  units = deployableUnits(army),
): UnitProfile[] {
  const bodyguardId = unitRosterId(bodyguard);
  return attachedUnitProfilesFor(army, bodyguard, units).filter(unit => unitRosterId(unit) !== bodyguardId);
}

export function isAttachedLeaderDrop(army: ImportedArmy, unit: UnitProfile): boolean {
  if (!unit.leaderAttachment) return false;
  return deployableUnits(army).some(candidate => candidate !== unit && unitMatchesAttachmentTarget(unit, candidate));
}

export function deployableDrops(army: ImportedArmy): UnitProfile[] {
  return deployableUnits(army).filter(unit => !isAttachedLeaderDrop(army, unit));
}
