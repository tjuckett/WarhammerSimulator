import type { BattleState, BattleUnit } from '../types/battle';
import type { WeaponProfile } from '../types/army';
import type { RulesEdition } from './rulesEngine';

export interface CombatWoundContext {
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  attachedUnitKeywordSet(state: BattleState, unit: BattleUnit): Set<string>;
}

export function antiKeywordThreshold(
  weapon: WeaponProfile,
  defender: BattleUnit,
  state: BattleState,
  context: CombatWoundContext,
): number | null {
  for (const keyword of weapon.keywords) {
    const match = keyword.match(/^anti[-\s]+(.+?)\s+([2-6])\+$/i);
    if (!match) continue;
    const targetKeyword = match[1].trim().toLowerCase();
    if (context.attachedUnitKeywordSet(state, defender).has(targetKeyword)) return Number.parseInt(match[2], 10);
  }
  return null;
}

export function processWoundsAgainstDefender(
  rolls: number[],
  woundTarget: number,
  weapon: WeaponProfile,
  defender: BattleUnit,
  rules: RulesEdition,
  state: BattleState,
  context: CombatWoundContext,
): { wounds: number; rolls: number[]; mortalsFromCrits: number; devastatingWounds: number; logNote: string } {
  const antiThreshold = antiKeywordThreshold(weapon, defender, state, context);
  if (antiThreshold === null) return rules.processWounds(rolls, woundTarget, weapon);

  let wounds = 0;
  let devastatingWounds = 0;
  const hasDevastatingWounds = context.weaponHasKeyword(weapon, 'Devastating Wounds');
  for (const roll of rolls) {
    if (roll === 1) continue;
    const critical = roll === 6 || roll >= antiThreshold;
    if (critical) {
      if (hasDevastatingWounds) devastatingWounds++;
      else wounds++;
    } else if (roll >= woundTarget) wounds++;
  }
  const notes = [`Anti ${antiThreshold}+ critical wounds`];
  if (hasDevastatingWounds && devastatingWounds > 0) notes.push('critical wound->no save (Devastating Wounds)');
  return { wounds, rolls, mortalsFromCrits: 0, devastatingWounds, logNote: notes.join('; ') };
}
