import type { UnitProfile, WeaponProfile } from '../types/army';
import type { BattleState, BattleUnit } from '../types/battle';
import { unitHasRule } from './armyUnits';
import { attachedUnitComponents, attachedUnitIsFormed } from './attachedUnits';

export function unitHasKeyword(unit: BattleUnit, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return unit.profile.keywords.some(candidate => candidate.toLowerCase() === needle);
}

export function unitHasDatasheetRule(unit: BattleUnit, ruleName: string): boolean {
  return unitHasRule(unit.profile, ruleName);
}

export function datasheetRuleText(unit: BattleUnit): string[] {
  return [
    ...unit.profile.keywords,
    ...unit.profile.factionKeywords,
    ...(unit.profile.abilities ?? []).flatMap(rule => [rule.name, rule.description]),
    ...(unit.profile.rules ?? []).flatMap(rule => [rule.name, rule.description]),
  ].filter(Boolean);
}

function attachedLeadingRules(state: BattleState, unit: BattleUnit): Array<{ name: string; description: string }> {
  if (!attachedUnitIsFormed(state, unit)) return [];
  return attachedUnitComponents(state, unit).flatMap(component =>
    [...component.profile.abilities, ...(component.profile.rules ?? [])].filter(rule =>
      /\bwhile\s+(?:this model|the bearer|a .+ model)\s+is leading\b/i.test(rule.description)
      || /\bwhile\s+(?:this|that|the bearer'?s) unit is led\b/i.test(rule.description),
    ),
  );
}

function keywordsGrantedByText(text: string): string[] {
  const keywords: string[] = [];
  for (const keyword of ['Lethal Hits', 'Devastating Wounds', 'Precision', 'Ignores Cover', 'Torrent']) {
    if (new RegExp(`\\[?${keyword.replace(' ', '\\s+')}\\]?`, 'i').test(text)) keywords.push(keyword);
  }
  const sustained = text.match(/Sustained Hits\s*(?:\[?)(D?\d+)(?:\]?)/i);
  if (sustained) keywords.push(`Sustained Hits ${sustained[1]}`);
  const critical = text.match(/Critical Hits?\s*(?:on\s+)?(?:a\s+)?(?:successful\s+)?(?:unmodified\s+)?(?:Hit roll of\s+)?([2-6])\+/i);
  if (critical) keywords.push(`Critical Hits ${critical[1]}+`);
  return keywords;
}

export function leadingWeaponKeywords(state: BattleState, unit: BattleUnit, weapon: WeaponProfile): string[] {
  const keywords: string[] = [];
  for (const rule of attachedLeadingRules(state, unit)) {
    if (/prophet of da great waaagh/i.test(rule.name)) continue;
    const text = `${rule.name} ${rule.description}`;
    if (weapon.isMelee === /melee/i.test(text) || /weapons? equipped by models in (?:this|that|the bearer'?s) unit/i.test(text)) {
      keywords.push(...keywordsGrantedByText(text));
    }
  }
  return keywords;
}

export function unitGrantedWeaponKeywords(state: BattleState, unit: BattleUnit, weapon: WeaponProfile): string[] {
  const keywords: string[] = [];
  for (const component of attachedUnitComponents(state, unit)) {
    for (const rule of [...component.profile.abilities, ...(component.profile.rules ?? [])]) {
      const text = `${rule.name} ${rule.description}`;
      if (/select(?: either| one of)?/i.test(text) || !/weapons? equipped by models in (?:this|that) unit/i.test(text)) continue;
      if (weapon.isMelee && !/melee weapons?|weapons? equipped/i.test(text)) continue;
      if (!weapon.isMelee && /melee weapons?/i.test(text)) continue;
      keywords.push(...keywordsGrantedByText(text));
    }
  }
  return keywords;
}

export function leadingAttackModifiers(
  state: BattleState,
  unit: BattleUnit,
  weapon: WeaponProfile,
): { hit: number; wound: number; strength: number; attacks: number } {
  let hit = 0;
  let wound = 0;
  let strength = 0;
  let attacks = 0;
  for (const rule of attachedLeadingRules(state, unit)) {
    if (/prophet of da great waaagh/i.test(rule.name)) continue;
    const text = `${rule.name} ${rule.description}`;
    if (/add\s+1\s+to\s+(?:the\s+)?hit roll/i.test(text)) hit -= 1;
    if (/add\s+1\s+to\s+(?:the\s+)?wound roll/i.test(text)) wound += 1;
    if (weapon.isMelee && /melee (?:attacks|weapons).*?add\s+1\s+to\s+(?:the\s+)?strength/i.test(text)) strength += 1;
    if (weapon.isMelee && /melee (?:attacks|weapons).*?add\s+1\s+to\s+(?:the\s+)?attacks/i.test(text)) attacks += 1;
  }
  return { hit, wound, strength, attacks };
}

export function leadingRerolls(state: BattleState, unit: BattleUnit): { hit: boolean; wound: boolean } {
  let hit = false;
  let wound = false;
  for (const rule of attachedLeadingRules(state, unit)) {
    if (/prophet of da great waaagh/i.test(rule.name)) continue;
    const text = `${rule.name} ${rule.description}`;
    if (!/re-?roll/i.test(text) || /one\s+(?:such\s+)?roll/i.test(text)) continue;
    if (/(?:failed\s+)?hit rolls?/i.test(text)) hit = true;
    if (/(?:failed\s+)?wound rolls?/i.test(text)) wound = true;
  }
  return { hit, wound };
}

export function attachedInvulnerableSave(state: BattleState, unit: BattleUnit, weapon: WeaponProfile): number | undefined {
  const saves = attachedUnitComponents(state, unit).flatMap(component => {
    const isSameComponent = component.id === unit.id;
    return [...component.profile.abilities, ...(component.profile.rules ?? [])].flatMap(rule => {
      const text = `${rule.name} ${rule.description}`;
      if (!/invulnerable save/i.test(text)) return [];
      if (!isSameComponent && !/\b(?:this|that|the bearer'?s) unit\b/i.test(text)) return [];
      if (weapon.isMelee && /ranged attacks?/i.test(text)) return [];
      if (!weapon.isMelee && /melee attacks?/i.test(text)) return [];
      const match = text.match(/([2-6])\+\s+invulnerable save/i);
      return match ? [Number(match[1])] : [];
    });
  });
  return saves.length ? Math.min(...saves) : undefined;
}

export function rangedSaveModifier(state: BattleState, unit: BattleUnit, weapon: WeaponProfile): number {
  if (weapon.isMelee) return 0;
  return attachedUnitComponents(state, unit).flatMap(component =>
    [...component.profile.abilities, ...(component.profile.rules ?? [])],
  ).reduce((modifier, rule) => {
    const text = `${rule.name} ${rule.description}`;
    return /\+1\s+(?:to\s+)?(?:the\s+)?Sv\b.*ranged attacks?/i.test(text)
      ? Math.max(modifier, 1)
      : modifier;
  }, 0);
}

export function feelNoPainTargets(unit: BattleUnit): Array<{ target: number; sharesWithAttachedUnit: boolean }> {
  return datasheetRuleText(unit).flatMap(text => {
    const match = text.match(/feel\s+no\s+pain(?:\s*\(?\s*)?([2-6])\+/i);
    if (!match) return [];
    const unitScoped = /\b(this unit|that unit|models? in (?:this|that|the bearer'?s) unit)\b/i.test(text);
    return [{ target: Number(match[1]), sharesWithAttachedUnit: unitScoped }];
  });
}
