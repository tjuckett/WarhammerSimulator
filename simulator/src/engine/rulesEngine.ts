import type { BattleUnit } from '../types/battle';
import type { WeaponProfile } from '../types/army';

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
  logNote: string;
}

export interface PhaseDefinition {
  id: string;
  label: string;
  icon: string;
}

export interface RulesEdition {
  id: string;
  name: string;
  description: string;
  phases: PhaseDefinition[];

  // Core combat resolution
  woundTarget(strength: number, toughness: number): number;
  saveTarget(save: number, ap: number, invuln?: number): number;
  coverSaveBonus(unit: BattleUnit, weapon: WeaponProfile): number;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasKw(w: WeaponProfile, kw: string): boolean {
  return w.keywords.some(k => k.toLowerCase().includes(kw.toLowerCase()));
}

function kwValue(w: WeaponProfile, kw: string): number {
  const k = w.keywords.find(k => k.toLowerCase().includes(kw.toLowerCase()));
  if (!k) return 0;
  const m = k.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : 1;
}

// ─── 40K 10th Edition ─────────────────────────────────────────────────────────

export const rules40K10th: RulesEdition = {
  id: 'w40k-10th',
  name: '40K 10th Edition',
  description: 'Warhammer 40,000 10th Edition (2023)',

  phases: [
    { id: 'command',      label: 'Command',      icon: '⚡' },
    { id: 'movement',     label: 'Movement',     icon: '🚶' },
    { id: 'shooting',     label: 'Shooting',     icon: '🔫' },
    { id: 'charge',       label: 'Charge',       icon: '⚔️' },
    { id: 'fight',        label: 'Fight',        icon: '🗡️' },
    { id: 'battle-shock', label: 'Battle-shock', icon: '😰' },
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

  coverSaveBonus(unit: BattleUnit, weapon: WeaponProfile): number {
    const isInfantry = unit.profile.keywords.some(k => k.toLowerCase() === 'infantry');
    return isInfantry && weapon.ap >= -1 ? 1 : 0;
  },

  processHits(rolls: number[], skill: number, weapon: WeaponProfile): HitResult {
    // Torrent: auto-hits, skip roll
    if (hasKw(weapon, 'Torrent')) {
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

    const sustainedVal = hasKw(weapon, 'Sustained Hits') ? kwValue(weapon, 'Sustained Hits') : 0;
    const hasDeadlyDemise = hasKw(weapon, 'Deadly Demise');

    for (const r of rolls) {
      if (r === 1) continue;
      if (r >= skill) {
        hits++;
        if (r === 6 && sustainedVal > 0) {
          hits += sustainedVal;
          notes.push(`crit→+${sustainedVal} (Sustained Hits)`);
        }
      }
      if (r === 6 && hasDeadlyDemise) {
        mortalsFromCrits++;
        notes.push('crit→mortal (Deadly Demise)');
      }
    }

    return { hits, rolls, mortalsFromCrits, logNote: notes.join('; ') };
  },

  processWounds(rolls: number[], wt: number, weapon: WeaponProfile): WoundResult {
    let wounds = 0;
    let mortalsFromCrits = 0;
    const notes: string[] = [];

    const hasDevWounds = hasKw(weapon, 'Devastating Wounds');
    const hasLethal = hasKw(weapon, 'Lethal Hits');

    for (const r of rolls) {
      if (r === 1) continue;
      if (r === 6) {
        if (hasDevWounds) {
          mortalsFromCrits++;
          notes.push('crit wound→mortal (Devastating Wounds)');
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

    return { wounds, rolls, mortalsFromCrits, logNote: notes.join('; ') };
  },

  modifyAttackCount(base, firingUnit, weapon, distToTarget, targetModelCount): number {
    let count = base;

    // Rapid Fire: extra shots within half range (per model)
    if (hasKw(weapon, 'Rapid Fire') && distToTarget <= weapon.range / 2) {
      const rfVal = kwValue(weapon, 'Rapid Fire');
      count += rfVal * firingUnit.remainingModels;
    }

    // Blast: minimum 3 attacks vs 6+ model units
    if (hasKw(weapon, 'Blast') && targetModelCount >= 6) {
      count = Math.max(count, 3);
    }

    return count;
  },

  advanceBonus(): string { return 'D6'; },
  chargeRange(): number  { return 12; },
  engagementRange(): number { return 1; },
};

// ─── 40K 11th Edition (stub) ──────────────────────────────────────────────────
// Rules not yet released. Mirrors 10th edition until the core rulebook drops.

export const rules40K11th: RulesEdition = {
  ...rules40K10th,
  id: 'w40k-11th',
  name: '40K 11th Edition',
  description:
    '11th Edition rules not yet published — simulating with 10th Edition rules as a placeholder. Update this file when the core book releases.',
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const EDITIONS: RulesEdition[] = [rules40K10th, rules40K11th];
