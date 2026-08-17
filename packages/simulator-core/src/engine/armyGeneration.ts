import type { ArmyGenerationMetadata, ImportedArmy, UnitProfile } from '../types/army';

export type AiArmyStrategy = ArmyGenerationMetadata['strategy'];

export interface AiArmyGenerationOptions {
  strategy?: AiArmyStrategy;
  maxUnits?: number;
}

export interface AiArmyGenerationResult {
  army: ImportedArmy;
  explanation: string;
  selectedUnitNames: string[];
}

function hasKeyword(unit: UnitProfile, keyword: string): boolean {
  return [...unit.keywords, ...unit.factionKeywords].some(value => value.toLowerCase() === keyword.toLowerCase());
}

function unitScore(unit: UnitProfile, strategy: AiArmyStrategy): number {
  const rangedWeapons = unit.weapons.filter(weapon => !weapon.isMelee);
  const meleeWeapons = unit.weapons.filter(weapon => weapon.isMelee);
  const rangedScore = rangedWeapons.reduce((total, weapon) => total + Math.max(1, weapon.strength + Math.abs(weapon.ap)), 0);
  const meleeScore = meleeWeapons.reduce((total, weapon) => total + Math.max(1, weapon.strength + Math.abs(weapon.ap)), 0);
  const durability = unit.toughness * unit.wounds * unit.baseModelCount;
  const objective = unit.oc * unit.baseModelCount;
  const leaderBonus = hasKeyword(unit, 'Character') ? 4 : 0;

  if (strategy === 'aggressive') return meleeScore * 2 + rangedScore + durability * 0.25 + leaderBonus;
  if (strategy === 'objective') return objective * 5 + durability * 0.5 + rangedScore * 0.25 + leaderBonus;
  return rangedScore + meleeScore + durability * 0.5 + objective * 2 + leaderBonus;
}

function cloneUnit(unit: UnitProfile): UnitProfile {
  return JSON.parse(JSON.stringify(unit)) as UnitProfile;
}

/**
 * Builds a deterministic candidate army from an imported/sample roster.
 * This intentionally does not invent points, faction limits, or datasheet data;
 * those require an authoritative catalog. The result remains editable and can
 * be saved through the normal Army Builder repository.
 */
export function generateAiArmy(
  source: ImportedArmy,
  options: AiArmyGenerationOptions = {},
): AiArmyGenerationResult {
  const strategy = options.strategy ?? 'balanced';
  const maxUnits = Math.max(1, Math.min(options.maxUnits ?? source.units.length, source.units.length));
  const ranked = source.units
    .map((unit, index) => ({ unit, index, score: unitScore(unit, strategy) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxUnits);
  const units = ranked.map(({ unit }) => {
    const copy = cloneUnit(unit);
    copy.deployment = undefined;
    copy.leaderAttachment = undefined;
    return copy;
  });
  const selectedUnitNames = units.map(unit => unit.name);
  const explanation = `Selected ${selectedUnitNames.length} of ${source.units.length} available units using the ${strategy} heuristic. `
    + 'The list is editable; points, faction limits, and official construction rules are not inferred without catalog data.';
  const generation: ArmyGenerationMetadata = {
    strategy,
    sourceArmyName: source.name,
    explanation,
  };
  return {
    army: { ...source, name: `${source.name} AI (${strategy})`, units, generation },
    explanation,
    selectedUnitNames,
  };
}
