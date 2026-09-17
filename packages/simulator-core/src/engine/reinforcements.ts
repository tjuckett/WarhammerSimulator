import { EVENT_REQUEST_KIND, type BattleState, type BattleUnit, type Position, type Side } from '../types/battle';
import { UNIT_DEPLOYMENT_MODE, type UnitProfile } from '../types/army';
import { attachedUnitProfilesFor, unitHasRule, unitRosterId } from './armyUnits';
import { baseFootprintDistance, baseFootprintWithinRect, modelBaseFootprintForUnit, modelBaseFootprintInches } from './baseSizes';
import { boardFormatForState } from '../data/boardFormats';
import { modelWeaponLoadout } from './unitModelState';
import { rulesEditionForRuleset, weaponHasKeyword } from './rulesEngine';
import { resolvePendingEventRequest } from './eventTriggers';

function modelFootprint(unit: BattleUnit, modelIndex: number) {
  return modelBaseFootprintForUnit(unit, modelIndex);
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
    modelWeaponLoadout(profile, modelIndex).some(weaponIndex =>
      weaponHasKeyword(profile.weapons[weaponIndex], 'Close-Quarters')
      || weaponHasKeyword(profile.weapons[weaponIndex], 'Pistol')
      || weaponHasKeyword(profile.weapons[weaponIndex], 'Sidearm')),
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
  unit.hasMadeIngressMove = true;
  unit.inCombat = false;
  unit.fellBack = false;
}

/** Core 20.04: unarrived Strategic Reserves are destroyed at the end of round three. */
export function destroyExpiredStrategicReserves(state: BattleState): string[] {
  if (state.ruleset.edition !== '11e') return [];
  const destroyedIds: string[] = [];
  for (const unit of state.units) {
    if (unit.destroyed || !unit.inStrategicReserves || unit.repositioned) continue;
    const transport = unit.embarkedInUnitId
      ? state.units.find(candidate => candidate.id === unit.embarkedInUnitId)
      : undefined;
    if (transport?.hasMadeIngressMove) continue;
    unit.destroyed = true;
    unit.remainingModels = 0;
    unit.inStrategicReserves = false;
    destroyedIds.push(unit.id);
  }
  return destroyedIds;
}

export interface PlayReinforcementContext {
  movementStep(state: BattleState): string;
  clone(state: BattleState): BattleState;
  makeBattleUnit(profile: UnitProfile, side: Side, positions: Position[]): BattleUnit;
  gridFormation(profile: UnitProfile, position: Position, side: Side): Position[];
  resolveInternalModelOverlaps(unit: BattleUnit, board: ReturnType<typeof boardFormatForState>): void;
  hasNoBaseOverlap(state: BattleState, unit: BattleUnit, indices: Set<number>): boolean;
  hasNoWallOverlap(state: BattleState, unit: BattleUnit, indices: Set<number>): boolean;
  isAircraft(unit: BattleUnit): boolean;
  centroid(points: Position[]): Position;
  battleRound(state: BattleState): number;
  modelIsInOpponentDeploymentZone(state: BattleState, unit: BattleUnit, modelIndex: number): boolean;
  log(state: BattleState, side: Side, title: string, message: string, type: string): BattleState['log'][number];
}

function stagedReinforcement(profile: UnitProfile): boolean {
  return profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike || profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve;
}

export function placePlayReinforcement(state: BattleState, side: Side, armyUnitIndex: number, position: Position, context: PlayReinforcementContext): BattleState {
  if (state.phase !== 'movement' || context.movementStep(state) !== 'reinforcements' || state.activeArmy !== side) return state;
  const profile = state.armies[side].army.units[armyUnitIndex];
  if (!profile || !stagedReinforcement(profile)) return state;
  if (profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve && context.battleRound(state) === 1) return state;
  if (profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike && !profileDropHasDeepStrike(state, side, profile)) return state;
  if (state.units.some(unit => unit.side === side && !unit.destroyed && unitRosterId(unit.profile) === unitRosterId(profile))) return state;
  const positions = context.gridFormation(profile, position, side);
  if (!reinforcementPlacementIsOutsideEnemyRange(state, side, profile, positions)) return state;
  const next = context.clone(state);
  const unit = context.makeBattleUnit(profile, side, positions);
  markUnitArrivedFromReinforcements(unit);
  context.resolveInternalModelOverlaps(unit, boardFormatForState(next));
  next.units.push(unit);
  const indices = new Set(unit.modelPositions.map((_, index) => index));
  if (!context.hasNoBaseOverlap(next, unit, indices) || !context.hasNoWallOverlap(next, unit, indices)
    || (next.ruleset.edition === '11e' && profile.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve
      && !strategicReserveUnitHasCloseQuartersIngress(next, side, profile)
      && (!reinforcementPlacementIsWithinStrategicReserveEdge(unit, next)
        || !strategicReservePlacementIsOutsideOpponentDeploymentZone(next, unit, context)))) return state;
  next.log = [...next.log, context.log(next, side, profile.name,
    `${next.armies[side].name} sets up ${profile.name} as Reinforcements more than ${rulesEditionForRuleset(next.ruleset).reinforcementRange()}" horizontally from enemy units.`, 'move')];
  return next;
}

export function placePlayStrategicReserveUnit(state: BattleState, side: Side, unitId: string, position: Position, context: PlayReinforcementContext): BattleState {
  if (state.phase !== 'movement' || context.movementStep(state) !== 'reinforcements') return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && unit.inStrategicReserves
    && ((state.activeArmy === side && (context.isAircraft(unit) || unit.deepStrikeUntilPhase === state.phase))
      || (state.activeArmy !== side && unit.rapidIngressThisPhase)));
  if (!existing) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed)!;
  if (context.battleRound(next) === 1 && unit.deepStrikeUntilPhase !== state.phase) return state;
  unit.modelPositions = context.gridFormation(unit.profile, position, side).slice(0, unit.remainingModels);
  unit.modelRotations = unit.modelPositions.map(() => side === 0 ? 0 : 180);
  unit.facingDeg = side === 0 ? 0 : 180;
  unit.position = context.centroid(unit.modelPositions);
  unit.inStrategicReserves = false;
  unit.rapidIngressThisPhase = undefined;
  markUnitArrivedFromReinforcements(unit);
  context.resolveInternalModelOverlaps(unit, boardFormatForState(next));
  const indices = new Set(unit.modelPositions.map((_, index) => index));
  if (!reinforcementPlacementIsOutsideEnemyRange(next, side, unit.profile, unit.modelPositions)
    || (unit.deepStrikeUntilPhase !== state.phase && !reinforcementPlacementIsWithinStrategicReserveEdge(unit, next))
    || (unit.deepStrikeUntilPhase !== state.phase && !strategicReservePlacementIsOutsideOpponentDeploymentZone(next, unit, context))
    || !context.hasNoBaseOverlap(next, unit, indices) || !context.hasNoWallOverlap(next, unit, indices)) return state;
  const ingressRequest = next.pendingEventRequests?.find(request =>
    request.kind === EVENT_REQUEST_KIND.IngressMove
    && request.side === side
    && request.data.unitId === unit.id,
  );
  if (ingressRequest) resolvePendingEventRequest(next, ingressRequest.id);
  next.log = [...next.log, context.log(next, side, unit.profile.name,
    `${next.armies[side].name} returns ${unit.profile.name} from Strategic Reserves more than ${rulesEditionForRuleset(next.ruleset).reinforcementRange()}" horizontally from enemy units${state.activeArmy !== side ? ' using Rapid Ingress' : ''}.`, 'move')];
  return next;
}
