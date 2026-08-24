import type { BattleState, BattleUnit, Position, Side } from '../types/battle';
import { UNIT_DEPLOYMENT_MODE, type UnitProfile } from '../types/army';
import { attachedUnitProfilesFor, unitHasRule, unitRosterId } from './armyUnits';
import { baseFootprintDistance, baseFootprintWithinRect, modelBaseFootprintInches } from './baseSizes';
import { boardFormatForState } from '../data/boardFormats';
import { modelWeaponLoadout } from './unitModelState';
import { rulesEditionForRuleset, weaponHasKeyword } from './rulesEngine';

function modelFootprint(unit: BattleUnit, modelIndex: number) {
  return modelBaseFootprintInches(unit.profile, modelIndex, unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0);
}

export function reinforcementPlacementIsOutsideEnemyRange(
  state: BattleState,
  side: Side,
  profile: UnitProfile,
  modelPositions: Position[],
  minRange = rulesEditionForRuleset(state.ruleset).reinforcementRange(),
): boolean {
  const foes = state.units.filter(unit => unit.side !== side && !unit.destroyed && !unit.embarkedInUnitId && !unit.inStrategicReserves);
  return modelPositions.every((model, modelIndex) => foes.every(enemy =>
    enemy.modelPositions.every((enemyModel, enemyModelIndex) => baseFootprintDistance(
      model, modelBaseFootprintInches(profile, modelIndex), enemyModel, modelFootprint(enemy, enemyModelIndex),
    ) > minRange),
  ));
}

export function profileDropHasDeepStrike(state: BattleState, side: Side, profile: UnitProfile): boolean {
  if (state.units.some(unit => unit.side === side && unit.inStrategicReserves && unit.deepStrikeUntilPhase === state.phase && unitRosterId(unit.profile) === unitRosterId(profile))) return true;
  return attachedUnitProfilesFor(state.armies[side].army, profile).every(candidate =>
    candidate.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike || unitHasRule(candidate, 'Deep Strike'));
}

export interface StrategicReservePlacementContext {
  battleRound(state: BattleState): number;
  modelIsInOpponentDeploymentZone(state: BattleState, unit: BattleUnit, modelIndex: number): boolean;
}

export function strategicReservePlacementIsOutsideOpponentDeploymentZone(
  state: BattleState,
  unit: BattleUnit,
  context: StrategicReservePlacementContext,
): boolean {
  return context.battleRound(state) > 2
    || unit.modelPositions.every((_, modelIndex) => !context.modelIsInOpponentDeploymentZone(state, unit, modelIndex));
}

function profileHasCloseQuartersOnEveryModel(profile: UnitProfile): boolean {
  return profile.baseModelCount > 0 && Array.from({ length: profile.baseModelCount }, (_, modelIndex) =>
    modelWeaponLoadout(profile, modelIndex).some(weaponIndex => weaponHasKeyword(profile.weapons[weaponIndex], 'Close-Quarters')),
  ).every(Boolean);
}

export function strategicReserveUnitHasCloseQuartersIngress(state: BattleState, side: Side, profile: UnitProfile): boolean {
  return state.ruleset.edition === '11e'
    && profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve
    && attachedUnitProfilesFor(state.armies[side].army, profile).every(profileHasCloseQuartersOnEveryModel);
}

const STRATEGIC_RESERVES_EDGE_RANGE = 6;

export function reinforcementPlacementIsWithinStrategicReserveEdge(unit: BattleUnit, state: BattleState): boolean {
  const board = boardFormatForState(state);
  const edgeBands = [
    { x: 0, y: 0, width: STRATEGIC_RESERVES_EDGE_RANGE, height: board.height },
    { x: board.width - STRATEGIC_RESERVES_EDGE_RANGE, y: 0, width: STRATEGIC_RESERVES_EDGE_RANGE, height: board.height },
    { x: 0, y: 0, width: board.width, height: STRATEGIC_RESERVES_EDGE_RANGE },
    { x: 0, y: board.height - STRATEGIC_RESERVES_EDGE_RANGE, width: board.width, height: STRATEGIC_RESERVES_EDGE_RANGE },
  ];
  return edgeBands.some(rect => unit.modelPositions.every((model, modelIndex) => baseFootprintWithinRect(model, modelFootprint(unit, modelIndex), rect)));
}

export function markUnitArrivedFromReinforcements(unit: BattleUnit): void {
  unit.movementAction = 'normalMove';
  unit.movementAllowanceRemaining = 0;
  unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
  unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
  unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
  unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0);
  unit.movementComplete = true;
  unit.arrivedFromReinforcements = true;
  unit.inCombat = false;
  unit.fellBack = false;
}
