import type { BattleState, BattleUnit, Side } from '../types/battle';
import { modelBaseRadiusInches } from './baseSizes';
import { objectiveControlValue } from './battleshock';
import { distance } from './coherency';
import { objectiveControlRadius } from './objectiveGeometry';
import type { RulesEdition } from './rulesEngine';

export interface ObjectiveControlResult {
  objectiveIndex: number;
  owner: Side | null;
  oc: [number, number];
}

export interface PrimaryScoringResult {
  kind: 'scored' | 'unsupported';
  missionName: string;
  scoringModel: string;
  objectiveControlLabel: string;
  side: Side;
  vpGained: number;
  score: [number, number];
  objectives: ObjectiveControlResult[];
}

function unitControlsObjective(unit: BattleUnit, objective: { x: number; y: number; z?: number }, controlRadius: number): boolean {
  return unit.modelPositions.some((model, modelIndex) =>
    distance(model, objective) <= controlRadius + modelBaseRadiusInches(unit.profile, modelIndex),
  );
}

export function updateObjectiveControl(state: BattleState, rules: RulesEdition): ObjectiveControlResult[] | null {
  const objectiveControl = state.objectiveControl ?? rules.objectiveControl;
  const controlRadius = objectiveControlRadius(objectiveControl);
  if (controlRadius === null) return null;

  return state.objectives.map((objective, objectiveIndex) => {
    const oc: [number, number] = [0, 0];
    for (const unit of state.units) {
      if (unit.destroyed || unit.embarkedInUnitId) continue;
      if (unitControlsObjective(unit, objective, controlRadius)) {
        oc[unit.side] += objectiveControlValue(unit);
      }
    }

    let owner: Side | null = null;
    if (oc[0] > oc[1]) owner = 0;
    else if (oc[1] > oc[0]) owner = 1;
    state.objectiveOwners[objectiveIndex] = owner;
    return { objectiveIndex, owner, oc };
  });
}

export function scorePrimaryMission(state: BattleState, side: Side, rules: RulesEdition): PrimaryScoringResult {
  const missionName = state.setup?.primaryMission ?? 'Primary Mission';
  const objectiveControl = state.objectiveControl ?? rules.objectiveControl;
  const objectives = updateObjectiveControl(state, rules);

  if (!objectives) {
    return {
      kind: 'unsupported',
      missionName,
      scoringModel: 'unsupported-objective-control',
      objectiveControlLabel: objectiveControl.label,
      side,
      vpGained: 0,
      score: [...state.scores],
      objectives: [],
    };
  }

  const vpGained = objectives.filter(objective => objective.owner === side).length;
  state.scores[side] += vpGained;

  return {
    kind: 'scored',
    missionName,
    scoringModel: 'generic-objective-control',
    objectiveControlLabel: objectiveControl.label,
    side,
    vpGained,
    score: [...state.scores],
    objectives,
  };
}

export function formatPrimaryScoringResult(result: PrimaryScoringResult): string {
  if (result.kind === 'unsupported') {
    return `Primary scoring unavailable for ${result.objectiveControlLabel}; implement this ruleset case-by-case.`;
  }

  const parts = result.objectives.map(objective => {
    const label = `Obj${objective.objectiveIndex + 1}`;
    if (objective.owner === result.side) return `${label} +1VP`;
    if (objective.owner !== null) return `${label} enemy`;
    return `${label} contested`;
  });
  const scoreStr = parts.join(', ') || 'no objectives scored';
  return `Primary (${result.missionName}, fallback): ${scoreStr} -> ${result.score[0]}VP / ${result.score[1]}VP`;
}
