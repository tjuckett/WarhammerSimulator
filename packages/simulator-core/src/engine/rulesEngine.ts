import type { BattleUnit } from '../types/battle';
import type { WeaponProfile } from '../types/army';
import type { StratagemDefinition } from '../types/stratagem';
import type { UnitAbilityDefinition } from '../types/ability';
import {
  ELEVENTH_EDITION_TERRAIN_OBJECTIVE_PLACEHOLDER,
  TENTH_EDITION_MARKER_OBJECTIVE_CONTROL,
  type ObjectiveControlProfile,
} from './objectiveGeometry';

// ─── Shared interfaces ────────────────────────────────────────────────────────

export interface HitResult {
  hits: number;
  rolls: number[];
  mortalsFromCrits: number;
  logNote: string;
}

export interface WoundResult {
  wounds: number;
  rolls: number[];
  mortalsFromCrits: number;
  devastatingWounds: number;
  logNote: string;
}

export interface PhaseDefinition {
  id: string;
  label: string;
  icon: string;
}

export interface RulesetMetadata {
  id: string;
  gameSystem: 'warhammer-40k';
  edition: '10e' | '11e';
  rulesVersion: string;
  status: 'implemented' | 'placeholder' | 'unreleased';
  compatibilitySourceId?: string;
}

export interface RulesEdition {
  id: string;
  name: string;
  description: string;
  metadata: RulesetMetadata;
  phases: PhaseDefinition[];
  objectiveControl: ObjectiveControlProfile;
  stratagems: StratagemDefinition[];
  unitAbilities: UnitAbilityDefinition[];

  // Core combat resolution
  woundTarget(strength: number, toughness: number): number;
  saveTarget(save: number, ap: number, invuln?: number): number;
  coverSaveBonus(unit: BattleUnit): number;

  processHits(rolls: number[], skill: number, weapon: WeaponProfile): HitResult;
  processWounds(rolls: number[], woundTarget: number, weapon: WeaponProfile): WoundResult;

  // Modify attack count for weapon keywords (Rapid Fire, Blast, etc.)
  modifyAttackCount(
    baseAttacks: number,
    firingUnit: BattleUnit,
    weapon: WeaponProfile,
    distToTarget: number,
    targetModelCount: number,
  ): number;

  // Movement constants
  advanceBonus(): string;   // dice expr e.g. "D6"
  chargeRange(): number;    // inches
  engagementRange(): number; // inches
}

// ─── Weapon keyword helpers ────────────────────────────────────────────────────
// Single source of truth for keyword lookups used by both the rules engine and the simulator.
// Uses startsWith so that "Fire" does not accidentally match "Rapid Fire".

export function weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return weapon.keywords.some(k => k.toLowerCase().startsWith(needle));
}

export function weaponKeywordValue(weapon: WeaponProfile, keyword: string): number {
  const needle = keyword.toLowerCase();
  const k = weapon.keywords.find(k => k.toLowerCase().startsWith(needle));
  if (!k) return 0;
  const m = k.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 1;
}

// ─── 40K 10th Edition ─────────────────────────────────────────────────────────

export const rules40K10th: RulesEdition = {
  id: 'w40k-10th',
  name: '40K 10th Edition',
  description: 'Warhammer 40,000 10th Edition (2023)',
  metadata: {
    id: 'w40k-10e-2023-core',
    gameSystem: 'warhammer-40k',
    edition: '10e',
    rulesVersion: '2023-core',
    status: 'implemented',
  },
  objectiveControl: TENTH_EDITION_MARKER_OBJECTIVE_CONTROL,
  stratagems: [
    {
      id: 'command-reroll',
      name: 'Command Re-roll',
      cost: 1,
      phases: 'any',
      target: 'none',
      oncePerPhase: true,
      description: 'Framework placeholder for spending CP on a core re-roll effect.',
    },
  ],
  unitAbilities: [
    {
      id: 'waaagh',
      name: 'Waaagh!',
      timing: 'manual',
      target: 'none',
      oncePerBattle: true,
      description: 'Framework placeholder for a once-per-battle army ability.',
    },
    {
      id: 'reanimation-protocols',
      name: 'Reanimation Protocols',
      timing: 'end-of-phase',
      target: 'self',
      oncePerTurn: true,
      description: 'Framework placeholder for an end-of-phase unit ability.',
    },
  ],

  phases: [
    { id: 'command',      label: 'Command',      icon: '⚡' },
    { id: 'movement',     label: 'Movement',     icon: '🚶' },
    { id: 'shooting',     label: 'Shooting',     icon: '🔫' },
    { id: 'charge',       label: 'Charge',       icon: '⚔️' },
    { id: 'fight',        label: 'Fight',        icon: '🗡️' },
  ],

  woundTarget(s: number, t: number): number {
    if (s >= t * 2) return 2;
    if (s > t)       return 3;
    if (s === t)     return 4;
    if (s * 2 <= t)  return 6;
    return 5;
  },

  saveTarget(save: number, ap: number, invuln?: number): number {
    const modified = save + Math.abs(ap);
    if (invuln !== undefined) return Math.min(modified, invuln);
    return modified;
  },

  coverSaveBonus(unit: BattleUnit): number {
    return unit.profile.save <= 6 ? 1 : 0;
  },

  processHits(rolls: number[], skill: number, weapon: WeaponProfile): HitResult {
    // Torrent: auto-hits, skip roll
    if (weaponHasKeyword(weapon,'Torrent')) {
      return {
        hits: rolls.length,
        rolls,
        mortalsFromCrits: 0,
        logNote: 'Torrent — auto-hits',
      };
    }

    let hits = 0;
    let mortalsFromCrits = 0;
    const notes: string[] = [];

    const sustainedVal = weaponHasKeyword(weapon,'Sustained Hits') ? weaponKeywordValue(weapon,'Sustained Hits') : 0;

    for (const r of rolls) {
      if (r === 1) continue;
      if (r >= skill) {
        hits++;
        if (r === 6 && sustainedVal > 0) {
          hits += sustainedVal;
          notes.push(`crit→+${sustainedVal} (Sustained Hits)`);
        }
      }
    }

    return { hits, rolls, mortalsFromCrits, logNote: notes.join('; ') };
  },

  processWounds(rolls: number[], wt: number, weapon: WeaponProfile): WoundResult {
    let wounds = 0;
    let mortalsFromCrits = 0;
    let devastatingWounds = 0;
    const notes: string[] = [];

    const hasDevWounds = weaponHasKeyword(weapon,'Devastating Wounds');
    const hasLethal = weaponHasKeyword(weapon,'Lethal Hits');

    for (const r of rolls) {
      if (r === 1) continue;
      if (r === 6) {
        if (hasDevWounds) {
          devastatingWounds++;
          notes.push('crit wound->no save (Devastating Wounds)');
          continue;
        }
        if (hasLethal) {
          // Lethal Hits: critical hits on the hit roll auto-wound, handled upstream;
          // critical wounds here just succeed normally
        }
        wounds++;
      } else if (r >= wt) {
        wounds++;
      }
    }

    return { wounds, rolls, mortalsFromCrits, devastatingWounds, logNote: notes.join('; ') };
  },

  modifyAttackCount(base, firingUnit, weapon, distToTarget, targetModelCount): number {
    let count = base;

    // Rapid Fire: extra shots within half range (per model)
    if (weaponHasKeyword(weapon,'Rapid Fire') && distToTarget <= weapon.range / 2) {
      const rfVal = weaponKeywordValue(weapon,'Rapid Fire');
      count += rfVal * firingUnit.remainingModels;
    }

    // Blast: add one attack for each five models in the target unit.
    if (weaponHasKeyword(weapon,'Blast') && targetModelCount >= 5) {
      count += Math.floor(targetModelCount / 5);
    }

    return count;
  },

  advanceBonus(): string { return 'D6'; },
  chargeRange(): number  { return 12; },
  engagementRange(): number { return 1; },
};

// ─── 40K 11th Edition (stub) ──────────────────────────────────────────────────
const ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE = true;

export const rules40K11th: RulesEdition = {
  ...rules40K10th,
  id: 'w40k-11th',
  name: '40K 11th Edition',
  metadata: {
    id: 'w40k-11e-preview-core',
    gameSystem: 'warhammer-40k',
    edition: '11e',
    rulesVersion: 'preview-core',
    status: 'implemented',
    compatibilitySourceId: rules40K10th.id,
  },
  objectiveControl: ELEVENTH_EDITION_TERRAIN_OBJECTIVE_PLACEHOLDER,
  stratagems: [
    {
      id: 'command-reroll',
      name: 'Command Re-roll',
      cost: 1,
      phases: 'any',
      turn: 'either',
      target: 'friendly-unit',
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'Re-roll one eligible roll for a friendly unit or model.',
    },
    {
      id: 'epic-challenge',
      name: 'Epic Challenge',
      cost: 1,
      phases: ['fight'],
      turn: 'own',
      target: 'friendly-unit',
      targetKeywordsAny: ['Character'],
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'A selected Character model gains Precision on melee weapons until the end of the phase.',
    },
    {
      id: 'insane-bravery',
      name: 'Insane Bravery',
      cost: 1,
      phases: ['command'],
      turn: 'own',
      target: 'friendly-unit',
      oncePerPhase: true,
      oncePerBattle: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'Automatically pass one Battle-shock roll for a friendly unit.',
    },
    {
      id: 'explosives',
      name: 'Explosives',
      cost: 1,
      phases: ['shooting'],
      turn: 'own',
      target: 'friendly-unit',
      targetKeywordsAny: ['Explosives', 'Grenades'],
      targetMustBeUnengaged: true,
      targetMustBeEligibleToShoot: true,
      targetMustNotHaveAdvanced: true,
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'An eligible Explosives/Grenades unit can inflict mortal wounds on a visible enemy within 8 inches.',
    },
    {
      id: 'crushing-impact',
      name: 'Crushing Impact',
      cost: 1,
      phases: ['charge'],
      turn: 'own',
      target: 'friendly-unit',
      targetKeywordsAny: ['Monster', 'Vehicle'],
      targetMustHaveCharged: true,
      targetMustBeEngaged: true,
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'A Monster or Vehicle that ended a charge move can roll against an engaged enemy for mortal wounds.',
    },
    {
      id: 'rapid-ingress',
      name: 'Rapid Ingress',
      cost: 1,
      phases: ['movement'],
      turn: 'opponent',
      target: 'friendly-unit',
      targetMustBeInStrategicReserves: true,
      targetForbiddenKeywordsAny: ['Aircraft'],
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'A non-Aircraft unit in Strategic Reserves makes an ingress move at the end of the opponent movement phase.',
    },
    {
      id: 'fire-overwatch',
      name: 'Fire Overwatch',
      cost: 1,
      phases: ['movement'],
      turn: 'opponent',
      target: 'friendly-unit',
      targetMustBeUnengaged: true,
      targetForbiddenKeywordsAny: ['Titanic'],
      targetMustBeEligibleToShoot: true,
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'An unengaged non-Titanic unit uses snap shooting at the end of the opponent movement phase.',
    },
    {
      id: 'smokescreen',
      name: 'Smokescreen',
      cost: 1,
      phases: ['shooting'],
      turn: 'opponent',
      target: 'friendly-unit',
      targetKeywordsAny: ['Smoke'],
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'A Smoke unit grants the benefit of cover against attacks until the end of the phase.',
    },
    {
      id: 'heroic-intervention',
      name: 'Heroic Intervention',
      cost: 1,
      phases: ['charge'],
      turn: 'opponent',
      target: 'friendly-unit',
      targetMustBeUnengaged: true,
      targetWithinEnemyDistance: 12,
      targetVehicleRequiresAnyKeywords: ['Character', 'Walker'],
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'An unengaged friendly unit within 12 inches of enemy units resolves a charge at the end of the opponent charge phase.',
    },
    {
      id: 'counteroffensive',
      name: 'Counteroffensive',
      cost: 2,
      phases: ['fight'],
      turn: 'opponent',
      target: 'friendly-unit',
      targetMustBeEligibleToFight: true,
      oncePerPhase: true,
      targetOncePerPhase: ELEVENTH_EDITION_TARGET_ONCE_PER_PHASE,
      description: 'An eligible friendly unit gains Fights First and must be selected to fight next.',
    },
  ],
  unitAbilities: [],
  description: 'Warhammer 40,000 11th Edition preview core rules with terrain objectives, actions, snap shooting, aircraft/vertical movement support, and core stratagem targeting/effects implemented where preview wording is available. Remaining mechanics fall back to compatible 10th Edition behavior until final 11th rules are added.',
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const EDITIONS: RulesEdition[] = [rules40K10th, rules40K11th];

export function rulesetMetadataForState(rules: RulesEdition): RulesetMetadata {
  return { ...rules.metadata };
}

export function rulesEditionForId(id: string): RulesEdition | undefined {
  return EDITIONS.find(edition => edition.id === id);
}

export function rulesEditionForRuleset(ruleset?: RulesetMetadata | null): RulesEdition {
  if (!ruleset) return rules40K10th;
  return (
    EDITIONS.find(edition => edition.metadata.id === ruleset.id)
    ?? EDITIONS.find(edition =>
      edition.metadata.edition === ruleset.edition
      && edition.metadata.rulesVersion === ruleset.rulesVersion
    )
    ?? EDITIONS.find(edition => edition.id === ruleset.compatibilitySourceId)
    ?? EDITIONS.find(edition => edition.metadata.edition === ruleset.edition)
    ?? rules40K10th
  );
}
