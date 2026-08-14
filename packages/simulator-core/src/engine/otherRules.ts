import type { RuleText } from '../types/army';
import type { BattleState, BattleUnit, Position, TerrainFeature } from '../types/battle';
import { attachedUnitComponents, attachedUnitId } from './attachedUnits';
import { baseFootprintDistance, baseFootprintIntersectsRect, modelBaseFootprintInches } from './baseSizes';

export type CoreAbilityTag = 'Aura' | 'Psychic';

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ruleHasCoreTag(rule: RuleText, tag: CoreAbilityTag): boolean {
  if (rule.tags?.some(candidate => normalized(candidate) === normalized(tag))) return true;
  const marker = new RegExp(`(?:\\[|\\()\\s*${tag}\\s*(?:\\]|\\))`, 'i');
  return marker.test(rule.name) || marker.test(rule.description);
}

export function ruleIsAura(rule: RuleText): boolean {
  return ruleHasCoreTag(rule, 'Aura');
}

export function ruleIsPsychic(rule: RuleText): boolean {
  return ruleHasCoreTag(rule, 'Psychic');
}

export function ruleIsActiveForUnit(unit: BattleUnit, rule: RuleText): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || unit.remainingModels <= 0) return false;
  if (rule.bearerModelIndex === undefined) return true;
  return (unit.modelRosterIndexes ?? unit.modelPositions.map((_, index) => index)).includes(rule.bearerModelIndex);
}

/**
 * Faction abilities have no universal effect. This only enforces Core 22.02's
 * army-faction gate for an explicitly classified rule.
 */
export function factionAbilityApplies(armyFaction: string, unit: BattleUnit, rule: RuleText): boolean {
  if (rule.category !== 'faction' || !ruleIsActiveForUnit(unit, rule)) return false;
  if (rule.appliesAcrossArmyFactions) return true;
  const faction = normalized(armyFaction).replace(/^faction:\s*/, '');
  return unit.profile.factionKeywords.some(keyword => normalized(keyword).replace(/^faction:\s*/, '') === faction);
}

/** Psychic ability damage is an attack for trigger/provenance purposes. */
export function abilityDamageSourceTags(rule: RuleText): Array<'psychic'> {
  return ruleIsPsychic(rule) ? ['psychic'] : [];
}

export interface AuraApplication {
  rule: RuleText;
  sourceUnitId: string;
  sourceModelIndex: number;
  distance: number;
}

function sourceModelIndexes(unit: BattleUnit, rule: RuleText): number[] {
  if (rule.bearerModelIndex === undefined) {
    return unit.modelPositions.map((_, index) => index);
  }
  const rosterIndexes = unit.modelRosterIndexes ?? unit.modelPositions.map((_, index) => index);
  const currentIndex = rosterIndexes.indexOf(rule.bearerModelIndex);
  return currentIndex < 0 ? [] : [currentIndex];
}

function modelDistanceToAttachedUnit(
  state: BattleState,
  source: BattleUnit,
  sourceModelIndex: number,
  target: BattleUnit,
): number {
  const sourcePosition = source.modelPositions[sourceModelIndex];
  if (!sourcePosition) return Number.POSITIVE_INFINITY;
  return Math.min(...attachedUnitComponents(state, target).flatMap(component =>
    component.modelPositions.map((targetPosition, targetModelIndex) => {
      const horizontal = baseFootprintDistance(
        sourcePosition,
        modelBaseFootprintInches(source.profile, source.modelRosterIndexes?.[sourceModelIndex] ?? sourceModelIndex),
        targetPosition,
        modelBaseFootprintInches(component.profile, component.modelRosterIndexes?.[targetModelIndex] ?? targetModelIndex),
      );
      return Math.hypot(horizontal, (sourcePosition.z ?? 0) - (targetPosition.z ?? 0));
    }),
  ));
}

function auraRange(rule: RuleText): number | null {
  if (Number.isFinite(rule.range) && (rule.range ?? -1) >= 0) return rule.range!;
  const match = rule.description.match(/within\s+(\d+(?:\.\d+)?)\s*(?:"|inches?)/i);
  return match ? Number.parseFloat(match[1]) : null;
}

/**
 * Returns distinct Aura abilities whose source is in range. It deliberately
 * does not infer friendly/enemy target scope or the effect from prose.
 */
export function auraAbilitiesInRange(
  state: BattleState,
  target: BattleUnit,
): AuraApplication[] {
  const applications = new Map<string, AuraApplication>();
  for (const source of state.units) {
    if (source.destroyed || source.embarkedInUnitId || source.inStrategicReserves) continue;
    for (const rule of [...source.profile.abilities, ...(source.profile.rules ?? [])]) {
      if (!ruleIsAura(rule) || !ruleIsActiveForUnit(source, rule)) continue;
      const range = auraRange(rule);
      if (range === null) continue;
      for (const sourceModelIndex of sourceModelIndexes(source, rule)) {
        const sameUnit = attachedUnitId(source) === attachedUnitId(target);
        const distance = sameUnit ? 0 : modelDistanceToAttachedUnit(state, source, sourceModelIndex, target);
        if (distance > range) continue;
        const key = normalized(rule.name.replace(/(?:\[|\()\s*aura\s*(?:\]|\))/ig, ''));
        const existing = applications.get(key);
        if (!existing || distance < existing.distance) {
          applications.set(key, { rule, sourceUnitId: source.id, sourceModelIndex, distance });
        }
      }
    }
  }
  return [...applications.values()];
}

/** True when a model is represented at ground level. */
export function modelIsOnGroundLevel(position: Position): boolean {
  return (position.z ?? 0) < 0.001;
}

function unitHasKeyword(unit: BattleUnit, keyword: string): boolean {
  const wanted = normalized(keyword);
  return [...unit.profile.keywords, ...unit.profile.factionKeywords]
    .some(candidate => normalized(candidate) === wanted);
}

function modelIsOnElevatedTerrainSection(unit: BattleUnit, modelIndex: number, state: BattleState): boolean {
  const position = unit.modelPositions[modelIndex];
  if (!position || (position.z ?? 0) < 3) return false;
  const footprint = modelBaseFootprintInches(unit.profile, unit.modelRosterIndexes?.[modelIndex] ?? modelIndex);
  return state.terrain.flatMap(terrain => terrain.features).some((feature: TerrainFeature) =>
    feature.featureHeight !== 'low'
    && baseFootprintIntersectsRect(position, footprint, feature),
  );
}

function modelWithinAttachedUnitRange(
  state: BattleState,
  attacker: BattleUnit,
  attackerModelIndex: number,
  target: BattleUnit,
  range: number,
): boolean {
  const attackerPosition = attacker.modelPositions[attackerModelIndex];
  if (!attackerPosition) return false;
  const attackerFootprint = modelBaseFootprintInches(
    attacker.profile,
    attacker.modelRosterIndexes?.[attackerModelIndex] ?? attackerModelIndex,
  );
  return attachedUnitComponents(state, target).some(component => component.modelPositions.some((position, modelIndex) => {
    const horizontal = baseFootprintDistance(
      attackerPosition,
      attackerFootprint,
      position,
      modelBaseFootprintInches(component.profile, component.modelRosterIndexes?.[modelIndex] ?? modelIndex),
    );
    return Math.hypot(horizontal, (attackerPosition.z ?? 0) - (position.z ?? 0)) <= range;
  }));
}

/** Exact Core 22.05/23.03 eligibility for a single ranged attacking model. */
export function attackingModelHasPlungingFire(
  state: BattleState,
  attacker: BattleUnit,
  attackerModelIndex: number,
  target: BattleUnit,
  targetIsVisible: boolean,
): boolean {
  if (state.ruleset.edition !== '11e' || !targetIsVisible) return false;
  if (unitHasKeyword(attacker, 'Aircraft')) return false;
  const targetComponents = attachedUnitComponents(state, target);
  if (targetComponents.some(component => unitHasKeyword(component, 'Aircraft'))) return false;
  if (!targetComponents.some(component => component.modelPositions.some(modelIsOnGroundLevel))) return false;
  return modelIsOnElevatedTerrainSection(attacker, attackerModelIndex, state)
    || (unitHasKeyword(attacker, 'Towering')
      && modelWithinAttachedUnitRange(state, attacker, attackerModelIndex, target, 12));
}
