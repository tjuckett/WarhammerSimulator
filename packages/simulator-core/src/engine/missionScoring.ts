import type { BattleState, BattleUnit, Side } from '../types/battle';
import { modelBaseRadiusInches } from './baseSizes';
import { objectiveControlValue } from './battleshock';
import { battleRound } from './battleRound';
import { distance } from './coherency';
import {
  eleventhPrimaryMissionRuleForName,
  type MissionCondition,
  type MissionObjectiveFilter,
  type MissionScoringClause,
  type MissionScoringTiming,
} from '../data/missionRules';
import { objectiveControlRadius } from './objectiveGeometry';
import type { RulesEdition } from './rulesEngine';
import { pointInTerrain } from './terrainGeometry';
import { boardFormatForState } from '../data/boardFormats';

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
  unsupportedReason?: string;
  side: Side;
  vpGained: number;
  score: [number, number];
  objectives: ObjectiveControlResult[];
  scoringDetails?: string[];
  unsupportedClauses?: string[];
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

function terrainObjectiveRoleForPoint(state: BattleState, objective: { x: number; y: number; z?: number }) {
  return terrainObjectiveForPoint(state, objective)?.objectiveRole;
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

function currentScoringTiming(state: BattleState): MissionScoringTiming {
  if (state.phase === 'command') return 'end-command-phase';
  if (state.phase === 'end') return 'end-battle';
  return 'end-turn';
}

function clauseAppliesToRound(clause: MissionScoringClause, round: number): boolean {
  return clause.rounds === 'any' || clause.rounds.includes(round);
}

function homeRole(side: Side): 'home-0' | 'home-1' {
  return side === 0 ? 'home-0' : 'home-1';
}

function opponentHomeRole(side: Side): 'home-0' | 'home-1' {
  return side === 0 ? 'home-1' : 'home-0';
}

function objectiveRole(
  state: BattleState,
  objective: ObjectiveControlResult,
): BattleState['terrain'][number]['objectiveRole'] {
  return terrainObjectiveRoleForPoint(state, state.objectives[objective.objectiveIndex]);
}

function controlledObjectives(state: BattleState, objectives: ObjectiveControlResult[], side: Side): ObjectiveControlResult[] {
  return objectives.filter(objective => objective.owner === side);
}

function objectiveMatchesFilter(
  state: BattleState,
  objective: ObjectiveControlResult,
  side: Side,
  filter: MissionObjectiveFilter = 'all',
): boolean {
  const role = objectiveRole(state, objective);
  if (filter === 'all') return true;
  if (filter === 'non-home') return role !== homeRole(side);
  if (filter === 'central') return role === 'no-mans-land' || (role !== homeRole(side) && role !== opponentHomeRole(side));
  return true;
}

function destroyedEnemyUnitsThisTurn(state: BattleState, side: Side): number {
  return (state.missionEvents?.destroyedUnitsThisTurn ?? []).filter(event =>
    event.destroyedBySide === side && event.side !== side,
  ).length;
}

function completedMissionActionCount(state: BattleState, side: Side, actionId: string): number {
  return (state.missionEvents?.completedActionsThisTurn ?? []).filter(event =>
    event.side === side && event.actionId === actionId,
  ).length;
}

function operationMarkersForAction(state: BattleState, side: Side, actionId: string) {
  return (state.missionState?.operationMarkers ?? []).filter(marker =>
    marker.side === side && marker.sourceActionId === actionId,
  );
}

function extractIntelligenceMarkers(state: BattleState, side: Side) {
  return operationMarkersForAction(state, side, 'extract-intelligence');
}

export function tableQuarterPresenceCount(state: BattleState, side: Side): number {
  const board = boardFormatForState(state);
  const centre = { x: board.width / 2, y: board.height / 2 };
  const occupied = new Set<number>();

  for (const unit of state.units) {
    if (unit.side !== side || unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || !unit.modelPositions.length) continue;
    if (unit.modelPositions.some((model, modelIndex) =>
      distance(model, centre) <= 6 + modelBaseRadiusInches(unit.profile, modelIndex),
    )) continue;

    const whollyLeft = unit.modelPositions.every((model, modelIndex) =>
      model.x + modelBaseRadiusInches(unit.profile, modelIndex) <= centre.x,
    );
    const whollyRight = unit.modelPositions.every((model, modelIndex) =>
      model.x - modelBaseRadiusInches(unit.profile, modelIndex) >= centre.x,
    );
    const whollyTop = unit.modelPositions.every((model, modelIndex) =>
      model.y + modelBaseRadiusInches(unit.profile, modelIndex) <= centre.y,
    );
    const whollyBottom = unit.modelPositions.every((model, modelIndex) =>
      model.y - modelBaseRadiusInches(unit.profile, modelIndex) >= centre.y,
    );

    if (whollyLeft && whollyTop) occupied.add(0);
    else if (whollyRight && whollyTop) occupied.add(1);
    else if (whollyLeft && whollyBottom) occupied.add(2);
    else if (whollyRight && whollyBottom) occupied.add(3);
  }

  return occupied.size;
}

export function terrainAreaIdsContainingUnit(state: BattleState, unit: BattleUnit): string[] {
  return state.terrain.flatMap(terrain =>
    unit.modelPositions.some((_model, modelIndex) => modelWithinTerrainObjective(unit, modelIndex, terrain))
      ? [terrain.id]
      : [],
  );
}

export function objectiveIndexesWithinRange(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
): number[] {
  const objectiveControl = state.objectiveControl ?? rules.objectiveControl;
  const controlRadius = objectiveControlRadius(objectiveControl);

  if (objectiveControl.kind === 'terrain-area') {
    return state.objectives.flatMap((objective, objectiveIndex) => {
      const terrain = terrainObjectiveForPoint(state, objective);
      return terrain && unit.modelPositions.some((_model, modelIndex) => modelWithinTerrainObjective(unit, modelIndex, terrain))
        ? [objectiveIndex]
        : [];
    });
  }

  if (controlRadius === null) return [];
  return state.objectives.flatMap((objective, objectiveIndex) =>
    unitControlsObjective(unit, objective, controlRadius) ? [objectiveIndex] : [],
  );
}

function objectiveConditionMet(
  state: BattleState,
  objective: ObjectiveControlResult,
  side: Side,
  condition: MissionCondition,
): boolean {
  if (condition !== 'controlled-objective-not-controlled-at-start-of-turn') return false;

  const snapshot = state.missionEvents?.startOfTurn;
  return snapshot?.activeSide === side
    && snapshot.battleRound === battleRound(state)
    && snapshot.turn === state.turn
    && snapshot.objectiveOwners[objective.objectiveIndex] !== side;
}

function controlsObjectiveNotControlledAtTurnStart(
  state: BattleState,
  objectives: ObjectiveControlResult[],
  side: Side,
): boolean {
  const snapshot = state.missionEvents?.startOfTurn;
  if (snapshot?.activeSide !== side || snapshot.battleRound !== battleRound(state) || snapshot.turn !== state.turn) {
    return false;
  }

  return controlledObjectives(state, objectives, side).some(objective =>
    objectiveMatchesFilter(state, objective, side, 'non-home')
    && snapshot.objectiveOwners[objective.objectiveIndex] !== side,
  );
}

function destroyedEnemyStartedWithinObjectiveRange(
  state: BattleState,
  objectives: ObjectiveControlResult[],
  side: Side,
  centralOnly: boolean,
): boolean {
  const snapshot = state.missionEvents?.startOfTurn;
  if (snapshot?.activeSide !== side || snapshot.battleRound !== battleRound(state) || snapshot.turn !== state.turn) {
    return false;
  }

  const destroyedEnemyIds = new Set((state.missionEvents?.destroyedUnitsThisTurn ?? [])
    .filter(event => event.destroyedBySide === side && event.side !== side)
    .map(event => event.unitId));

  return snapshot.units.some(unit => unit.side !== side
    && destroyedEnemyIds.has(unit.unitId)
    && (unit.objectiveIndexesWithinRange ?? []).some(objectiveIndex => {
      if (!centralOnly) return true;
      const objective = objectives.find(candidate => candidate.objectiveIndex === objectiveIndex);
      return objective ? objectiveMatchesFilter(state, objective, side, 'central') : false;
    }));
}

function destroyedEnemyByUnitWithinObjectiveRange(state: BattleState, side: Side): boolean {
  return (state.missionEvents?.destroyedUnitsThisTurn ?? []).some(event =>
    event.destroyedBySide === side
    && event.side !== side
    && (event.destroyingUnitObjectiveIndexesWithinRange?.length ?? 0) > 0,
  );
}

function destroyedEnemyStartedWithinTerrainArea(state: BattleState, side: Side): boolean {
  const snapshot = state.missionEvents?.startOfTurn;
  if (snapshot?.activeSide !== side || snapshot.battleRound !== battleRound(state) || snapshot.turn !== state.turn) {
    return false;
  }

  const destroyedEnemyIds = new Set((state.missionEvents?.destroyedUnitsThisTurn ?? [])
    .filter(event => event.destroyedBySide === side && event.side !== side)
    .map(event => event.unitId));

  return snapshot.units.some(unit =>
    unit.side !== side
    && destroyedEnemyIds.has(unit.unitId)
    && (unit.terrainAreaIds?.length ?? 0) > 0,
  );
}

function conditionMet(
  state: BattleState,
  objectives: ObjectiveControlResult[],
  side: Side,
  condition: MissionCondition,
): boolean {
  const controlled = controlledObjectives(state, objectives, side);
  const opponentControlled = controlledObjectives(state, objectives, (1 - side) as Side);
  switch (condition) {
    case 'controls-more-objectives-than-opponent':
      return controlled.length > opponentControlled.length;
    case 'controls-at-least-one-central-objective':
      return controlled.some(objective => objectiveMatchesFilter(state, objective, side, 'central'));
    case 'controls-at-least-one-non-home-objective':
      return controlled.some(objective => objectiveMatchesFilter(state, objective, side, 'non-home'));
    case 'controls-at-least-three-objectives':
      return controlled.length >= 3;
    case 'controls-at-least-four-objectives':
      return controlled.length >= 4;
    case 'controls-at-least-two-objectives':
      return controlled.length >= 2;
    case 'controls-home-objective':
      return controlled.some(objective => objectiveRole(state, objective) === homeRole(side));
    case 'controls-opponent-home-objective':
      return controlled.some(objective => objectiveRole(state, objective) === opponentHomeRole(side));
    case 'destroyed-enemy-this-turn':
      return destroyedEnemyUnitsThisTurn(state, side) > 0;
    case 'more-enemy-units-destroyed-than-friendly-previous-turn':
      return destroyedEnemyUnitsThisTurn(state, side) > (state.missionEvents?.lastCompletedTurn?.destroyedUnitCounts[side] ?? 0);
    case 'destroyed-enemy-near-objective':
      return destroyedEnemyStartedWithinObjectiveRange(state, objectives, side, false)
        || destroyedEnemyByUnitWithinObjectiveRange(state, side);
    case 'destroyed-enemy-started-near-objective':
      return destroyedEnemyStartedWithinObjectiveRange(state, objectives, side, false);
    case 'controlled-objective-not-controlled-at-start-of-turn':
      return controlsObjectiveNotControlledAtTurnStart(state, objectives, side);
    case 'destroyed-enemy-started-near-central-objective':
      return destroyedEnemyStartedWithinObjectiveRange(state, objectives, side, true);
    case 'destroyed-enemy-in-terrain':
      return destroyedEnemyStartedWithinTerrainArea(state, side);
    case 'friendly-units-in-three-table-quarters':
      return tableQuarterPresenceCount(state, side) === 3;
    case 'friendly-units-in-four-table-quarters':
      return tableQuarterPresenceCount(state, side) >= 4;
    case 'extracted-intelligence':
      return completedMissionActionCount(state, side, 'extract-intelligence') > 0;
    case 'three-operation-markers':
      return extractIntelligenceMarkers(state, side).length >= 3;
    case 'operation-marker-near-opponent-home-objective':
      return extractIntelligenceMarkers(state, side).some(marker => {
        const objective = state.objectives[marker.objectiveIndex] ?? marker.position;
        return terrainObjectiveRoleForPoint(state, objective) === opponentHomeRole(side);
      });
    case 'enemy-home-objective-consecrated':
      return operationMarkersForAction(state, side, 'consecrate').some(marker => {
        const objective = state.objectives[marker.objectiveIndex] ?? marker.position;
        return terrainObjectiveRoleForPoint(state, objective) === opponentHomeRole(side);
      });
    case 'controls-central-and-expansion-objectives':
    case 'condemned-enemy-left-battlefield':
    case 'consecrated-objectives':
    case 'surveilled-enemy-units':
    case 'no-enemy-operation-markers':
    case 'triangulated-objectives':
    case 'no-enemy-units-wholly-within-territory':
    case 'sensor-sweep':
    case 'opponent-operation-marker-isolated':
    case 'committed-sabotage':
    case 'secured-asset':
    case 'vanguard-operation':
    case 'operation-markers-near-controlled-central-objectives':
    case 'booby-trapped-terrain':
    case 'destroyed-enemy-started-in-trapped-terrain':
    case 'only-one-operation-marker-isolated':
    case 'decoy-objectives':
    case 'four-decoy-objectives':
      return false;
  }
}

function evaluateMissionClause(
  state: BattleState,
  objectives: ObjectiveControlResult[],
  side: Side,
  clause: MissionScoringClause,
): { vp: number; detail?: string; unsupported?: string } {
  if (clause.kind === 'unsupported-event') {
    return { vp: 0, unsupported: `${clause.sourceText}${clause.notes ? ` (${clause.notes})` : ''}` };
  }

  if (clause.kind === 'fixed-if') {
    const met = clause.condition ? conditionMet(state, objectives, side, clause.condition) : false;
    return {
      vp: met ? clause.vp : 0,
      detail: `${clause.sourceText} ${met ? `+${clause.vp}VP` : '+0VP'}`,
    };
  }

  const controlled = controlledObjectives(state, objectives, side)
    .filter(objective => objectiveMatchesFilter(state, objective, side, clause.objectiveFilter));
  if (clause.kind === 'per-objective-if') {
    const condition = clause.condition;
    const matched = condition
      ? controlled.filter(objective => objectiveConditionMet(state, objective, side, condition))
      : [];
    const vp = matched.length * clause.vp;
    return {
      vp,
      detail: `${clause.sourceText} ${matched.length} objective${matched.length === 1 ? '' : 's'} x ${clause.vp}VP -> +${vp}VP`,
    };
  }

  if (clause.kind === 'per-completed-action') {
    const count = clause.condition === 'extracted-intelligence'
      ? completedMissionActionCount(state, side, 'extract-intelligence')
      : 0;
    const vp = count * clause.vp;
    return {
      vp,
      detail: `${clause.sourceText} ${count} action${count === 1 ? '' : 's'} x ${clause.vp}VP -> +${vp}VP`,
    };
  }

  if (clause.kind === 'operation-marker-count-tier') {
    const actionId = clause.condition === 'triangulated-objectives'
      ? 'triangulate'
      : clause.condition === 'consecrated-objectives'
        ? 'consecrate'
        : null;
    const count = actionId ? operationMarkersForAction(state, side, actionId).length : 0;
    const minimum = clause.minimumCount ?? 0;
    const maximum = clause.maximumCount ?? Number.POSITIVE_INFINITY;
    const met = count >= minimum && count <= maximum;
    return {
      vp: met ? clause.vp : 0,
      detail: `${clause.sourceText} ${count} marker${count === 1 ? '' : 's'} -> ${met ? `+${clause.vp}VP` : '+0VP'}`,
    };
  }

  if (clause.kind === 'per-destroyed-enemy-unit') {
    const count = destroyedEnemyUnitsThisTurn(state, side);
    const vp = count * clause.vp;
    return {
      vp,
      detail: `${clause.sourceText} ${count} unit${count === 1 ? '' : 's'} x ${clause.vp}VP -> +${vp}VP`,
    };
  }

  let vp = controlled.length * clause.vp;
  let detail = `${clause.sourceText} ${controlled.length} objective${controlled.length === 1 ? '' : 's'} x ${clause.vp}VP`;

  if (clause.kind === 'per-objective-with-bonus' && clause.bonusVp && clause.bonusCondition) {
    const bonusMet = conditionMet(state, objectives, side, clause.bonusCondition);
    const bonusObjectives = controlled.filter(objective => objectiveRole(state, objective) !== homeRole(side));
    const bonusVp = bonusMet ? bonusObjectives.length * clause.bonusVp : 0;
    vp += bonusVp;
    detail += `; bonus ${bonusMet ? `${bonusObjectives.length} x ${clause.bonusVp}VP` : '+0VP'}`;
  }

  return { vp, detail: `${detail} -> +${vp}VP` };
}

function scoreDataDrivenPrimaryMission(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  mission: NonNullable<ReturnType<typeof eleventhPrimaryMissionRuleForName>>,
  objectives: ObjectiveControlResult[],
): PrimaryScoringResult {
  const timing = currentScoringTiming(state);
  const round = battleRound(state);
  const activeClauses = (mission.scoring ?? []).filter(clause =>
    clause.timing === timing
    && clauseAppliesToRound(clause, round)
  );

  const scored = activeClauses.map(clause => evaluateMissionClause(state, objectives, side, clause));
  const vpGained = scored.reduce((total, clause) => total + clause.vp, 0);
  state.scores[side] += vpGained;

  return {
    kind: 'scored',
    missionName: mission.name,
    scoringModel: `11e-data:${mission.name}`,
    objectiveControlLabel: (state.objectiveControl ?? rules.objectiveControl).label,
    side,
    vpGained,
    score: [...state.scores],
    objectives,
    scoringDetails: scored.flatMap(clause => clause.detail ? [clause.detail] : []),
    unsupportedClauses: scored.flatMap(clause => clause.unsupported ? [clause.unsupported] : []),
  };
}

export function scorePrimaryMission(state: BattleState, side: Side, rules: RulesEdition): PrimaryScoringResult {
  const missionName = state.setup?.primaryMissions?.[side] ?? state.setup?.primaryMission ?? 'Primary Mission';
  const objectiveControl = state.objectiveControl ?? rules.objectiveControl;
  const eleventhMissionRule = rules.metadata.edition === '11e'
    ? eleventhPrimaryMissionRuleForName(missionName)
    : null;
  if (eleventhMissionRule?.status === 'missing-source') {
    return {
      kind: 'unsupported',
      missionName,
      scoringModel: 'missing-11th-primary-mission-source',
      objectiveControlLabel: objectiveControl.label,
      unsupportedReason: eleventhMissionRule.notes,
      side,
      vpGained: 0,
      score: [...state.scores],
      objectives: updateObjectiveControl(state, rules) ?? [],
    };
  }

  const objectives = updateObjectiveControl(state, rules);

  if (!objectives) {
    return {
      kind: 'unsupported',
      missionName,
      scoringModel: 'unsupported-objective-control',
      objectiveControlLabel: objectiveControl.label,
      unsupportedReason: `Objective scoring unavailable for ${objectiveControl.label}.`,
      side,
      vpGained: 0,
      score: [...state.scores],
      objectives: [],
    };
  }

  if (eleventhMissionRule?.status === 'implemented' && eleventhMissionRule.scoring?.length) {
    return scoreDataDrivenPrimaryMission(state, side, rules, eleventhMissionRule, objectives);
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
    if (result.scoringModel === 'missing-11th-primary-mission-source') {
      return `Primary scoring unavailable for ${result.missionName}: mission scoring text has not been transcribed yet.`;
    }
    return result.unsupportedReason ?? `Primary scoring unavailable for ${result.objectiveControlLabel}; implement this ruleset case-by-case.`;
  }

  if (result.scoringModel.startsWith('11e-data:')) {
    const details = result.scoringDetails?.length ? result.scoringDetails.join('; ') : 'no active scoring clauses';
    const unsupported = result.unsupportedClauses?.length
      ? ` Unsupported clauses: ${result.unsupportedClauses.join(' ')}`
      : '';
    return `Primary (${result.missionName}): ${details} -> ${result.score[0]}VP / ${result.score[1]}VP.${unsupported}`;
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
