import type { ArmyGenerationMetadata, ImportedArmy, UnitProfile } from '../types/army';

export type AiArmyStrategy = ArmyGenerationMetadata['strategy'];

export interface AiArmyGenerationOptions {
  strategy?: AiArmyStrategy;
  maxUnits?: number;
}

export type AiMissionFocus = 'balanced' | 'objectives' | 'attrition';

export interface AiArmyScenario {
  id: string;
  focus: AiMissionFocus;
  opponent?: ImportedArmy;
}

export interface AiArmyGenerationResult {
  army: ImportedArmy;
  explanation: string;
  selectedUnitNames: string[];
  heuristicScore: number;
}

export interface AiArmyEvaluation {
  strategy: AiArmyStrategy;
  score: number;
  unitCount: number;
  explanation: string;
}

export interface AiArmyScenarioEvaluation {
  scenarioId: string;
  strategy: AiArmyStrategy;
  score: number;
  explanation: string;
}

export interface AiArmyScenarioResult extends AiArmyGenerationResult {
  scenarioId: string;
  evaluations: AiArmyScenarioEvaluation[];
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

/** Scores an already assembled candidate without applying points or faction rules. */
export function evaluateAiArmyCandidate(army: ImportedArmy, strategy: AiArmyStrategy = 'balanced'): AiArmyEvaluation {
  const rawScore = army.units.reduce((total, unit) => total + unitScore(unit, strategy), 0);
  const averageScore = army.units.length ? rawScore / army.units.length : 0;
  const score = Math.round(averageScore * 10) / 10;
  return {
    strategy,
    score,
    unitCount: army.units.length,
    explanation: `${army.units.length} units scored ${score} using the ${strategy} heuristic.`,
  };
}

function scenarioScore(army: ImportedArmy, scenario: AiArmyScenario, candidateScore: number): number {
  const objectiveControl = army.units.reduce((total, unit) => total + unit.oc * unit.baseModelCount, 0);
  const durability = army.units.reduce((total, unit) => total + unit.toughness * unit.wounds * unit.baseModelCount, 0);
  const rangedPower = army.units.reduce((total, unit) => total + unit.weapons.filter(weapon => !weapon.isMelee).reduce((sum, weapon) => sum + weapon.strength, 0), 0);
  const opponentToughness = scenario.opponent?.units.reduce((total, unit) => total + unit.toughness, 0) ?? 0;
  const opponentCount = scenario.opponent?.units.length ?? 0;
  const opponentAverageToughness = opponentCount ? opponentToughness / opponentCount : 0;
  const focusBonus = scenario.focus === 'objectives'
    ? objectiveControl * 2
    : scenario.focus === 'attrition'
      ? durability + rangedPower * (opponentAverageToughness >= 6 ? 1.5 : 1)
      : objectiveControl + durability * 0.5;
  return Math.round((candidateScore + focusBonus) * 10) / 10;
}

/**
 * Compares the three lightweight strategy candidates for one mission/opponent
 * context. It is intentionally heuristic; official mission scoring and army
 * construction data remain outside this boundary.
 */
export function selectAiArmyForScenario(
  source: ImportedArmy,
  scenario: AiArmyScenario,
  options: Omit<AiArmyGenerationOptions, 'strategy'> = {},
): AiArmyScenarioResult {
  const strategies: AiArmyStrategy[] = ['balanced', 'aggressive', 'objective'];
  const candidates = strategies.map(strategy => {
    const candidate = generateAiArmy(source, { ...options, strategy });
    const score = scenarioScore(candidate.army, scenario, candidate.heuristicScore);
    return {
      candidate,
      evaluation: {
        scenarioId: scenario.id,
        strategy,
        score,
        explanation: `${strategy} scores ${score} for ${scenario.focus} scenario ${scenario.id}.`,
      },
    };
  });
  const best = candidates.reduce((current, next) => next.evaluation.score > current.evaluation.score ? next : current);
  const scenarioExplanation = `Scenario ${scenario.id} selected the ${best.evaluation.strategy} plan at ${best.evaluation.score}.`;
  const army = {
    ...best.candidate.army,
    generation: {
      ...best.candidate.army.generation!,
      scenarioId: scenario.id,
      explanation: `${best.candidate.explanation} ${scenarioExplanation}`,
    },
  };
  return {
    ...best.candidate,
    army,
    explanation: `${best.candidate.explanation} ${scenarioExplanation}`,
    scenarioId: scenario.id,
    evaluations: candidates.map(candidate => candidate.evaluation),
  };
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
  const evaluation = evaluateAiArmyCandidate({ ...source, units }, strategy);
  const explanation = `Selected ${selectedUnitNames.length} of ${source.units.length} available units using the ${strategy} heuristic (score ${evaluation.score}). `
    + 'The list is editable; points, faction limits, and official construction rules are not inferred without catalog data.';
  const generation: ArmyGenerationMetadata = {
    strategy,
    sourceArmyName: source.name,
    explanation,
    heuristicScore: evaluation.score,
  };
  return {
    army: { ...source, name: `${source.name} AI (${strategy})`, units, generation },
    explanation,
    selectedUnitNames,
    heuristicScore: evaluation.score,
  };
}
