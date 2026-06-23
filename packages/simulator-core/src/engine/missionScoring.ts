import type { BattleState, BattleUnit, Side } from '../types/battle';
import { modelBaseRadiusInches } from './baseSizes';
import { objectiveControlValue } from './battleshock';
import { distance } from './coherency';
import { objectiveControlRadius } from './objectiveGeometry';
import type { RulesEdition } from './rulesEngine';
import { pointInTerrain } from './terrainGeometry';

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

function terrainObjectiveForPoint(state: BattleState, objective: { x: number; y: number; z?: number }) {
  const matches = state.terrain.filter(terrain => pointInTerrain(objective, terrain));
  return matches.sort((a, b) => (a.width * a.height) - (b.width * b.height))[0] ?? null;
}

function modelWithinTerrainObjective(unit: BattleUnit, modelIndex: number, terrain: NonNullable<ReturnType<typeof terrainObjectiveForPoint>>): boolean {
  const model = unit.modelPositions[modelIndex];
  if (!model) return false;
  if (pointInTerrain(model, terrain)) return true;

  const radius = modelBaseRadiusInches(unit.profile, modelIndex);
  return [
    { x: model.x + radius, y: model.y },
    { x: model.x - radius, y: model.y },
    { x: model.x, y: model.y + radius },
    { x: model.x, y: model.y - radius },
  ].some(point => pointInTerrain(point, terrain));
}

function terrainObjectiveControlValue(unit: BattleUnit, terrain: NonNullable<ReturnType<typeof terrainObjectiveForPoint>>): number {
  if (unit.battleshocked) return 0;
  return unit.modelPositions.reduce((total, _model, modelIndex) =>
    total + (modelWithinTerrainObjective(unit, modelIndex, terrain) ? unit.profile.oc : 0),
  0);
}

export function updateObjectiveControl(state: BattleState, rules: RulesEdition): ObjectiveControlResult[] | null {
  const objectiveControl = state.objectiveControl ?? rules.objectiveControl;
  const controlRadius = objectiveControlRadius(objectiveControl);

  if (objectiveControl.kind === 'terrain-area') {
    const objectiveTerrains = state.objectives.map(objective => terrainObjectiveForPoint(state, objective));
    if (objectiveTerrains.some(terrain => terrain === null)) return null;

    return state.objectives.map((_objective, objectiveIndex) => {
      const terrain = objectiveTerrains[objectiveIndex]!;
      const oc: [number, number] = [0, 0];
      for (const unit of state.units) {
        if (unit.destroyed || unit.embarkedInUnitId) continue;
        oc[unit.side] += terrainObjectiveControlValue(unit, terrain);
      }

      let owner: Side | null = null;
      if (oc[0] > oc[1]) owner = 0;
      else if (oc[1] > oc[0]) owner = 1;
      state.objectiveOwners[objectiveIndex] = owner;
      return { objectiveIndex, owner, oc };
    });
  }

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
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission ?? 'Primary Mission';
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
    scoringModel: objectiveControl.kind === 'terrain-area' ? 'terrain-objective-control' : 'generic-objective-control',
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
