import type { BattleState, BattleUnit } from '../types/battle';
import { unitHasRule } from './armyUnits';

/** Stable rules-unit identity. Attached components share this id for the battle. */
export function attachedUnitId(unit: BattleUnit): string {
  return unit.attachedToUnitId ?? unit.tabletopUnitId ?? unit.id;
}

export function attachedUnitComponents(
  state: BattleState,
  unit: BattleUnit,
  includeDestroyed = false,
): BattleUnit[] {
  const id = attachedUnitId(unit);
  const components = state.units.filter(candidate =>
    candidate.side === unit.side
    && attachedUnitId(candidate) === id
    && (includeDestroyed || (!candidate.destroyed && candidate.remainingModels > 0)),
  );
  return components.length || !includeDestroyed ? components : [unit];
}

export function attachedUnitIsFormed(state: BattleState, unit: BattleUnit): boolean {
  return attachedUnitComponents(state, unit, true).length > 1;
}

export function attachedUnitBodyguard(state: BattleState, unit: BattleUnit): BattleUnit | undefined {
  const components = attachedUnitComponents(state, unit, true);
  const bodyguardId = components.find(candidate => candidate.attachedToUnitId)?.attachedToUnitId;
  return components.find(candidate => candidate.id === bodyguardId)
    ?? components.find(candidate => !candidate.attachedToUnitId);
}

export function attachedUnitLiveBodyguard(state: BattleState, unit: BattleUnit): BattleUnit | undefined {
  const bodyguard = attachedUnitBodyguard(state, unit);
  return bodyguard && !bodyguard.destroyed && bodyguard.remainingModels > 0 ? bodyguard : undefined;
}

export function attachedUnitTargetRepresentative(state: BattleState, unit: BattleUnit): BattleUnit | undefined {
  return attachedUnitLiveBodyguard(state, unit) ?? attachedUnitComponents(state, unit)[0];
}

export function attachedUnitKeywordSet(
  state: BattleState,
  unit: BattleUnit,
  includeDestroyed = false,
): Set<string> {
  const result = new Set<string>();
  for (const component of attachedUnitComponents(state, unit, includeDestroyed)) {
    for (const keyword of [...component.profile.keywords, ...component.profile.factionKeywords]) {
      result.add(keyword.trim().toLowerCase());
    }
  }
  return result;
}

export function attachedUnitHasRule(state: BattleState, unit: BattleUnit, ruleName: string): boolean {
  return attachedUnitComponents(state, unit).some(component => unitHasRule(component.profile, ruleName));
}

function componentToughness(unit: BattleUnit): number {
  const profiles = unit.profile.modelProfiles;
  if (!profiles?.length) return unit.profile.toughness;
  const rosterIndexes = unit.modelRosterIndexes
    ?? Array.from({ length: unit.remainingModels }, (_, modelIndex) => modelIndex);
  const liveToughness = rosterIndexes.map(rosterIndex => {
    let offset = 0;
    for (const profile of profiles) {
      if (rosterIndex < offset + profile.count) return profile.toughness;
      offset += profile.count;
    }
    return unit.profile.toughness;
  });
  return liveToughness.length ? Math.max(...liveToughness) : unit.profile.toughness;
}

export function attachedUnitToughness(state: BattleState, unit: BattleUnit): number {
  const bodyguard = attachedUnitLiveBodyguard(state, unit);
  if (bodyguard) return componentToughness(bodyguard);
  const components = attachedUnitComponents(state, unit);
  return components.length ? Math.max(...components.map(componentToughness)) : componentToughness(unit);
}

export function attachedUnitStartingStrength(state: BattleState, unit: BattleUnit): number {
  return attachedUnitComponents(state, unit, true)
    .reduce((total, component) => total + component.profile.baseModelCount, 0);
}

export function attachedUnitRemainingModels(state: BattleState, unit: BattleUnit): number {
  return attachedUnitComponents(state, unit)
    .reduce((total, component) => total + component.remainingModels, 0);
}
