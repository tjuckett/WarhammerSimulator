import type { BattleState, BattleUnit, Side } from '../types/battle';
import { attachedUnitProfilesFor, unitRosterId } from './armyUnits';
import { modelIndicesWithCoherencyIssues, modelListIsCoherent, type CoherencyModel } from './coherency';

function coherencyListLabel(units: BattleUnit[]): string {
  return Array.from(new Set(units.map(unit => unit.profile.name))).join(' + ');
}

export function coherencyModelLists(state: BattleState): Array<{ label: string; models: CoherencyModel[] }> {
  const deployedUnits = state.units.filter(unit => !unit.destroyed && !unit.embarkedInUnitId && !unit.inStrategicReserves);
  const handled = new Set<string>();
  const lists: Array<{ label: string; models: CoherencyModel[] }> = [];
  const pushList = (units: BattleUnit[]): void => {
    lists.push({
      label: coherencyListLabel(units),
      models: units.flatMap(unit => unit.modelPositions.map((model, modelIndex) => ({ unit, model, modelIndex }))),
    });
    units.forEach(unit => handled.add(unit.id));
  };
  for (const unit of deployedUnits) {
    if (handled.has(unit.id)) continue;
    const attachedProfileIds = new Set(attachedUnitProfilesFor(state.armies[unit.side].army, unit.profile).map(unitRosterId));
    pushList(deployedUnits.filter(candidate => candidate.side === unit.side && attachedProfileIds.has(unitRosterId(candidate.profile))));
  }
  return lists;
}

function shouldShowCoherencyIssues(state: BattleState): boolean {
  return state.phase === 'deployment' || state.phase === 'movement';
}

export function coherencyEditionForState(state: BattleState): '10e' | '11e' {
  return state.ruleset.edition;
}

export function battleUnitIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (!shouldShowCoherencyIssues(state)) return new Set();
  const unitIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    if (modelListIsCoherent(list.models, coherencyEditionForState(state))) continue;
    list.models.forEach(model => unitIds.add(model.unit.id));
  }
  return unitIds;
}

export function battleModelIdsWithCoherencyIssues(state: BattleState): Set<string> {
  if (!shouldShowCoherencyIssues(state)) return new Set();
  const modelIds = new Set<string>();
  for (const list of coherencyModelLists(state)) {
    modelIndicesWithCoherencyIssues(list.models, coherencyEditionForState(state)).forEach(index => {
      const model = list.models[index];
      if (model) modelIds.add(`${model.unit.id}:${model.modelIndex}`);
    });
  }
  return modelIds;
}

export function battleCoherencyIssues(state: BattleState, side?: Side): string[] {
  const issues: string[] = [];
  for (const list of coherencyModelLists(state)) {
    if (side !== undefined && !list.models.some(model => model.unit.side === side)) continue;
    if (modelListIsCoherent(list.models, coherencyEditionForState(state))) continue;
    issues.push(`${list.label} (${list.models.length} models) is out of coherency.`);
  }
  return issues;
}
