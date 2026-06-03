import type { ImportedArmy, ModelStatProfile, UnitProfile, WeaponProfile } from '../types/army';
import { applyBaseSizesToArmy } from '../data/unitBaseSizes';

// ─── Raw BattleScribe JSON shape ──────────────────────────────────────────────

interface BSChar { name: string; value?: string; $text?: string }

interface BSProfile {
  name: string;
  typeName: string;
  characteristics: BSChar[];
}

interface BSRule { name: string; description: string }

interface BSCategory { name: string; primary?: boolean }

interface BSSelection {
  id?: string;
  name: string;
  type?: string;
  number?: number;
  profiles?: BSProfile[];
  selections?: BSSelection[];
  rules?: BSRule[];
  categories?: BSCategory[];
}

interface ParsedWeaponEntry {
  profile: BSProfile;
  isMelee: boolean;
  modelIndexes: number[];
}

interface BSForce {
  catalogueName?: string;
  selections?: BSSelection[];
}

interface BSRoster {
  name?: string;
  forces?: BSForce[];
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function charVal(profile: BSProfile, name: string): string {
  const characteristic = profile.characteristics?.find(c => c.name.toLowerCase() === name.toLowerCase());
  return characteristic?.value ?? characteristic?.$text ?? '';
}

// "3+" → 3,  "6+" → 6,  "7+" → 7
function parseSave(s: string): number {
  const m = s.match(/^(\d+)\+?/);
  return m ? parseInt(m[1], 10) : 7;
}

// "6\"" | "6" → 6
function parseInches(s: string): number {
  if (!s) return 0;
  const m = s.replace(/['"]/g, '').trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function parseNum(s: string): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/['"]/g, '').trim(), 10);
  return isNaN(n) ? 0 : n;
}

// Recursively collect all profiles from a selection tree
function collectProfiles(sel: BSSelection): BSProfile[] {
  const out: BSProfile[] = [...(sel.profiles ?? [])];
  for (const sub of sel.selections ?? []) out.push(...collectProfiles(sub));
  return out;
}

function collectModelSelections(sel: BSSelection): BSSelection[] {
  if (sel.type === 'model') return [sel];
  return (sel.selections ?? []).flatMap(collectModelSelections);
}

function hasModelSelection(sel: BSSelection): boolean {
  return collectModelSelections(sel).length > 0;
}

function modelIndexRange(start: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => start + index);
}

function collectWeaponEntries(sel: BSSelection): ParsedWeaponEntry[] {
  const modelSubs = collectModelSelections(sel);
  if (modelSubs.length === 0) {
    return collectSelectionWeaponEntries(sel, modelIndexRange(0, countModels(sel)));
  }

  const out: ParsedWeaponEntry[] = [];
  let modelStart = 0;
  for (const model of modelSubs) {
    const modelCount = Math.max(1, model.number ?? 1);
    out.push(...collectSelectionWeaponEntries(model, modelIndexRange(modelStart, modelCount)));
    modelStart += modelCount;
  }

  const allModelIndexes = modelIndexRange(0, modelStart);
  for (const sub of sel.selections ?? []) {
    if (!hasModelSelection(sub)) {
      out.push(...collectSelectionWeaponEntries(sub, allModelIndexes));
    }
  }
  return out;
}

function collectSelectionWeaponEntries(sel: BSSelection, ownerModelIndexes: number[]): ParsedWeaponEntry[] {
  const out: ParsedWeaponEntry[] = [];
  const localCount = Math.max(1, sel.number ?? ownerModelIndexes.length);
  const modelIndexes = ownerModelIndexes.slice(0, Math.min(ownerModelIndexes.length, localCount));
  for (const profile of sel.profiles ?? []) {
    if (profile.typeName === 'Ranged Weapons') out.push({ profile, isMelee: false, modelIndexes });
    else if (profile.typeName === 'Melee Weapons') out.push({ profile, isMelee: true, modelIndexes });
  }

  for (const sub of sel.selections ?? []) {
    out.push(...collectSelectionWeaponEntries(sub, modelIndexes));
  }
  return out;
}

// Recursively collect all rules
function collectRules(sel: BSSelection): BSRule[] {
  const out: BSRule[] = [...(sel.rules ?? [])];
  for (const sub of sel.selections ?? []) out.push(...collectRules(sub));
  return out;
}

// Count models from sub-selections; fall back to selection.number
function countModels(sel: BSSelection): number {
  const modelSubs = collectModelSelections(sel);
  if (modelSubs.length > 0) return modelSubs.reduce((n, s) => n + (s.number ?? 1), 0);
  if (sel.type === 'model') return sel.number ?? 1;
  return sel.number ?? 1;
}

function parseWeapon(profile: BSProfile, isMelee: boolean): WeaponProfile {
  const range = isMelee ? 0 : parseInches(charVal(profile, 'Range'));
  const attacks = charVal(profile, 'A') || '1';
  const skillStr = charVal(profile, isMelee ? 'WS' : 'BS') || '4+';
  const skill = parseSave(skillStr);
  const strength = parseNum(charVal(profile, 'S')) || 3;
  const ap = parseInt(charVal(profile, 'AP')) || 0;
  const damage = charVal(profile, 'D') || '1';
  const kwRaw = charVal(profile, 'Keywords') || charVal(profile, 'Abilities') || '';
  const keywords = kwRaw.split(',').map(k => k.trim()).filter(Boolean);

  return { name: profile.name, range, attacks, skill, strength, ap, damage, keywords, isMelee };
}

function parseModelStatProfile(profile: BSProfile, count: number): ModelStatProfile {
  const saveRaw = charVal(profile, 'SV') || charVal(profile, 'Sv') || '6+';
  const ldRaw = charVal(profile, 'LD') || charVal(profile, 'Ld') || '7+';

  return {
    name: profile.name,
    count,
    move: parseInches(charVal(profile, 'M')) || 6,
    toughness: parseNum(charVal(profile, 'T')) || 4,
    save: parseSave(saveRaw),
    wounds: parseNum(charVal(profile, 'W')) || 1,
    leadership: parseSave(ldRaw),
    oc: parseNum(charVal(profile, 'OC')) || 1,
  };
}

function collectModelStatProfiles(sel: BSSelection): ModelStatProfile[] {
  const modelSubs = collectModelSelections(sel);
  const modelProfiles = modelSubs.flatMap(model => {
    const count = Math.max(1, model.number ?? 1);
    return (model.profiles ?? [])
      .filter(profile => profile.typeName === 'Unit')
      .map(profile => parseModelStatProfile(profile, count));
  });

  const fallbackProfile = (sel.profiles ?? []).find(profile => profile.typeName === 'Unit');
  const profiles = modelProfiles.length || !fallbackProfile
    ? modelProfiles
    : [parseModelStatProfile(fallbackProfile, countModels(sel))];
  return aggregateModelStatProfiles(profiles);
}

function aggregateModelStatProfiles(profiles: ModelStatProfile[]): ModelStatProfile[] {
  const merged = new Map<string, ModelStatProfile>();
  for (const profile of profiles) {
    const key = [
      profile.name,
      profile.move,
      profile.toughness,
      profile.save,
      profile.wounds,
      profile.leadership,
      profile.oc,
    ].join('|');
    const existing = merged.get(key);
    if (existing) {
      existing.count += profile.count;
    } else {
      merged.set(key, { ...profile });
    }
  }
  return [...merged.values()];
}

function parseAbility(profile: BSProfile): { name: string; description: string } {
  const description = charVal(profile, 'Description')
    || profile.characteristics?.map(c => c.value ?? c.$text ?? '').filter(Boolean).join('\n')
    || '';
  return { name: profile.name, description };
}

function buildModelWeaponLoadouts(modelCount: number, weaponModelIndexes: number[][]): number[][] {
  const loadouts = Array.from({ length: modelCount }, () => [] as number[]);
  if (!modelCount) return loadouts;

  weaponModelIndexes.forEach((modelIndexes, weaponIndex) => {
    for (const modelIndex of modelIndexes) {
      if (modelIndex < 0 || modelIndex >= modelCount) continue;
      loadouts[modelIndex].push(weaponIndex);
    }
  });

  return loadouts;
}

function weaponProfileKey(weapon: WeaponProfile): string {
  return [
    weapon.name.trim().toLowerCase(),
    weapon.range,
    weapon.attacks.trim().toLowerCase(),
    weapon.skill,
    weapon.strength,
    weapon.ap,
    weapon.damage.trim().toLowerCase(),
    weapon.isMelee ? 'melee' : 'ranged',
    weapon.keywords.map(keyword => keyword.trim().toLowerCase()).join(','),
  ].join('|');
}

function combineWeaponProfiles(
  weapons: WeaponProfile[],
  weaponModelIndexes: number[][],
): { weapons: WeaponProfile[]; weaponModelIndexes: number[][] } {
  const merged = new Map<string, number>();
  const combinedWeapons: WeaponProfile[] = [];
  const combinedModelIndexes: number[][] = [];

  weapons.forEach((weapon, weaponIndex) => {
    const key = weaponProfileKey(weapon);
    const existingIndex = merged.get(key);
    if (existingIndex === undefined) {
      merged.set(key, combinedWeapons.length);
      combinedWeapons.push(weapon);
      combinedModelIndexes.push([...weaponModelIndexes[weaponIndex]]);
      return;
    }

    const modelIndexes = new Set([
      ...combinedModelIndexes[existingIndex],
      ...weaponModelIndexes[weaponIndex],
    ]);
    combinedModelIndexes[existingIndex] = [...modelIndexes].sort((a, b) => a - b);
  });

  return { weapons: combinedWeapons, weaponModelIndexes: combinedModelIndexes };
}

// ─── Skip non-unit selections ─────────────────────────────────────────────────

const SKIP_NAMES = ['Battle Size', 'Detachment', 'Enhancement', 'Stratagems', 'Secondary'];

function isUnit(sel: BSSelection): boolean {
  if (SKIP_NAMES.some(s => sel.name.includes(s))) return false;
  return collectProfiles(sel).some(p => p.typeName === 'Unit');
}

// ─── Parse one unit selection → UnitProfile ───────────────────────────────────

function parseUnit(sel: BSSelection): UnitProfile | null {
  const profiles = collectProfiles(sel);
  const unitProf = profiles.find(p => p.typeName === 'Unit');
  if (!unitProf) return null;

  const move = parseInches(charVal(unitProf, 'M')) || 6;
  const toughness = parseNum(charVal(unitProf, 'T')) || 4;
  const saveRaw = charVal(unitProf, 'SV') || charVal(unitProf, 'Sv') || '6+';
  const save = parseSave(saveRaw);
  const wounds = parseNum(charVal(unitProf, 'W')) || 1;
  const ldRaw = charVal(unitProf, 'LD') || charVal(unitProf, 'Ld') || '7+';
  const leadership = parseSave(ldRaw);
  const oc = parseNum(charVal(unitProf, 'OC')) || 1;

  const weaponEntries = collectWeaponEntries(sel);
  const parsedWeapons: WeaponProfile[] = weaponEntries.map(entry => parseWeapon(entry.profile, entry.isMelee));
  const parsedWeaponModelIndexes = weaponEntries.map(entry => entry.modelIndexes);
  const { weapons, weaponModelIndexes } = combineWeaponProfiles(parsedWeapons, parsedWeaponModelIndexes);
  const modelProfiles = collectModelStatProfiles(sel);

  // Ensure every unit has at least a basic melee weapon
  if (!weapons.some(w => w.isMelee)) {
    weapons.push({
      name: 'Close Combat Weapon',
      range: 0, attacks: '1', skill: 4, strength: 3, ap: 0, damage: '1', keywords: [], isMelee: true,
    });
    weaponModelIndexes.push(modelIndexRange(0, countModels(sel)));
  }

  const rules = collectRules(sel);
  const abilityProfiles = profiles.filter(p => p.typeName === 'Abilities');
  const cats = sel.categories ?? [];
  const keywords = cats
    .map(c => c.name)
    .filter(name => !name.toLowerCase().startsWith('faction:'));
  const factionKeywords = cats
    .map(c => c.name)
    .filter(name => name.toLowerCase().startsWith('faction:'));

  return {
    name: sel.name,
    move,
    toughness,
    save,
    wounds,
    leadership,
    oc,
    baseModelCount: countModels(sel),
    modelProfiles,
    keywords,
    factionKeywords,
    weapons,
    modelWeaponLoadouts: buildModelWeaponLoadouts(countModels(sel), weaponModelIndexes),
    abilities: abilityProfiles.map(parseAbility),
    rules: rules.map(r => ({ name: r.name, description: r.description })),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseBattleScribeJSON(raw: unknown): ImportedArmy {
  const roster = (raw as { roster?: BSRoster })?.roster;
  if (!roster) throw new Error('Not a valid BattleScribe JSON file (missing "roster" key)');

  const force = roster.forces?.[0];
  if (!force) throw new Error('No forces found in this roster');

  const faction = force.catalogueName ?? 'Unknown';
  const name = roster.name ?? faction;

  const units: UnitProfile[] = [];
  for (const sel of force.selections ?? []) {
    if (isUnit(sel)) {
      const unit = parseUnit(sel);
      if (unit) units.push(unit);
    }
  }

  if (units.length === 0) throw new Error('No units could be parsed from this roster');

  return applyBaseSizesToArmy({ name, faction, units });
}
