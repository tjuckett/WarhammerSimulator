import { MOVEMENT_STEP, type BattleSetup, type BattleState, type BattleUnit, type LogEntry, type MovementStep, type PendingFightOnDeath, type Phase, type Position, type Side, type Terrain, type TerrainFeature, type ShootingWeaponResult } from '../types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile, type WeaponProfile } from '../types/army';
import { rules40K10th, rulesEditionForRuleset, rulesetMetadataForState, weaponHasKeyword, weaponKeywordValue, type RulesEdition } from './rulesEngine';
import { rollExpression, rollMultiple, countSuccesses, d6 } from './dice';
import { deployArmy, distanceToDeploymentZone, everyModelWithinRange as everyModelWithinTransportRange, fp, isTransportProfile, nearestFriendlyTransportInRange as nearestTransportInRange, pointInDeploymentZone, transportCapacityRemaining as deploymentTransportCapacityRemaining, transportPassengers, zoneFor, unitRole, type DeploymentStrategy, type DeploymentZoneSource } from './deployment';
import * as deploymentActions from './deployment';
import { selectUnitToDrop, reactivePosition, deployModelFormation } from './deploymentBrain';
import { DEFAULT_OBJECTIVES } from './missions';
import { boardFormatForId, boardFormatForState } from '../data/boardFormats';
import { advanceAllowance, normalMoveAllowance } from './movement';
import { objectiveIndexesWithinRange, primaryMissionScoringLogs, scorePrimaryMission, scorePrimaryMissionsAtEndOfBattle, scorePrimaryMissionsAtEndOfTurn, terrainAreaIdsContainingUnit, unsupportedPrimaryMissionScoringLogs, updateObjectiveControl } from './missionScoring';
import { battleRound, setBattleRound } from './battleRound';
import {
  completeMissionEventsForCurrentTurn,
  recordCompletedMissionAction,
  recordDestroyedModelMissionEvents,
  recordDestroyedUnitMissionEvent,
  recordUnitLeftBattlefieldMissionEvent,
  startMissionEventsForNewTurn,
} from './missionEvents';
import { gainCommandPhaseCommandPoints } from './commandPoints';
import { runAutomaticCommandUnitAbilities, runAutomaticUnitAbilities } from './unitAbilities';
import { objectiveControlValue, resolveDesperateEscapeTests } from './battleshock';
import { circleIntersectsTerrain, findUnblockedLOSRay, hasAnyHiddenModelPair as hasAnyHiddenModelPairGeometry, hasAnyModelLOSConsideringHidden as hasAnyModelLOSConsideringHiddenGeometry, hasLOSEdgeToEdge, lineIntersectsTerrain, linePassesThroughTerrain, modelIsHiddenFrom as modelIsHiddenFromGeometry, pointInTerrain, targetHasTerrainCoverFrom as targetHasTerrainCoverFromGeometry, terrainCorners } from './terrainGeometry';
import { COHERENCY_VERTICAL_RANGE, distance as dist, modelIndicesWithCoherencyIssues, modelListIsCoherent, verticalDistance, type CoherencyModel } from './coherency';
import { secondaryMissionStateFor } from './secondaryMissions';
import { objectiveRoleForIndex, terrainTerritoryRelation, terrainWithinMissionTerritory } from './missionGeometry';
import { scoreSecondaryMissionsAtEndOfTurn, secondaryMissionScoringLogs } from './secondaryMissionScoring';
import {
  attachedFollowersFor,
  attachedLeadersFor,
  attachedUnitProfilesFor,
  canDeployOutsideDeploymentZone,
  deployableDrops,
  isAttachedLeaderDrop,
  unitHasRule,
  unitMatchesAttachmentTarget,
  unitRosterId,
} from './armyUnits';
import {
  attachedUnitComponents,
  attachedUnitHasRule,
  attachedUnitId,
  attachedUnitIsFormed,
  attachedUnitKeywordSet,
  attachedUnitLiveBodyguard,
  attachedUnitRemainingModels,
  attachedUnitTargetRepresentative,
  attachedUnitToughness,
} from './attachedUnits';
import {
  baseFootprintDistance,
  baseFootprintMaxPointDistance,
  baseFootprintIntersectsRect,
  baseFootprintWithinRect,
  baseFootprintsOverlap,
  battleUnitMaxBaseRadiusInches,
  modelBaseFootprintInches,
  modelBaseRadiusInches,
} from './baseSizes';
import { attackingModelHasPlungingFire, auraAbilitiesInRange } from './otherRules';
import { BATTLE_EVENT_TYPE, recordBattleEvent } from './battleEvents';
import { advanceBattlePhase, battlePhaseNode, battleRoundLimit, initializeBattlePhase, nextBattlePhase, nextTurnTransition } from './battleStateMachine';
import { battleLog as log, phaseLog, resetBattleLogSequence } from './battleLog';
import { resetUnitForActiveTurn } from './turnState';
import { resolveDamageOutcome, resolveFeelNoPainOutcome, resolveSaveOutcome } from './combatResolution';
import {
  centroid,
  formationExtent,
  markUnitDestroyed,
  modelWeaponLoadout,
  rememberDestroyedPositions,
  spliceModelIndices,
  translateFormation,
  trimUnitModelState,
} from './unitModelState';
import {
  attachedInvulnerableSave,
  datasheetRuleText,
  feelNoPainTargets,
  leadingAttackModifiers,
  leadingRerolls,
  leadingWeaponKeywords,
  rangedSaveModifier,
  unitGrantedWeaponKeywords,
  unitHasDatasheetRule,
  unitHasKeyword,
} from './unitCombatModifiers';
import { runBattleshockPhase } from './battleshockPhase';
import * as deadlyDemise from './deadlyDemise';
import * as damageApplication from './damageApplication';
import type { CombatAttackResolutionOptions } from './combatTypes';
import * as manualCombat from './manualCombat';
import { createTransportDestruction } from './transportDestruction';
import * as movementSimulation from './movementSimulation';
import * as missionActions from './missionActions';
import * as interactiveMovementState from './interactiveMovement';
import { battleCoherencyIssues, coherencyEditionForState, coherencyModelLists } from './battleCoherency';
import {
  markUnitArrivedFromReinforcements,
  profileDropHasDeepStrike,
  reinforcementPlacementIsOutsideEnemyRange,
  reinforcementPlacementIsWithinStrategicReserveEdge,
  strategicReservePlacementIsOutsideOpponentDeploymentZone as isStrategicReservePlacementOutsideOpponentDeploymentZone,
  strategicReserveUnitHasCloseQuartersIngress,
  type StrategicReservePlacementContext,
} from './reinforcements';
import * as reinforcementPlay from './reinforcements';
import * as turnAdvance from './turnAdvance';
import * as firingDeck from './firingDeck';
import * as movementPathing from './movementPathing';
import * as aircraftMovement from './aircraftMovement';
import * as movementLegality from './movementLegality';
import * as battleSimulation from './battleSimulation';
export { battleCoherencyIssues, battleModelIdsWithCoherencyIssues, battleUnitIdsWithCoherencyIssues } from './battleCoherency';

// ─── ID generators ────────────────────────────────────────────────────────────

let _unitId = 0;

// ─── Log factory ─────────────────────────────────────────────────────────────

// ─── Geometry helpers ────────────────────────────────────────────────────────

function hasKeyword(unit: BattleUnit, keyword: string): boolean {
  return unit.profile.keywords.some(k => k.toLowerCase() === keyword.toLowerCase());
}

function hasAnyKeyword(unit: BattleUnit, keywords: string[]): boolean {
  const set = keywords.map(k => k.toLowerCase());
  return unit.profile.keywords.some(k => set.includes(k.toLowerCase()));
}

function isAircraft(unit: BattleUnit): boolean {
  return hasKeyword(unit, 'aircraft');
}

function aircraftCanMakeNormalMove(rules: RulesEdition): boolean {
  return rules.metadata.edition !== '11e';
}

function isFortification(unit: BattleUnit): boolean {
  return hasKeyword(unit, 'fortification');
}

const ELEVENTH_SPECIAL_SETUP_ENEMY_BUFFER = 8;
const FIGHT_PHASE_MOVE_RANGE = 3;

function setupDeploymentZoneSource(setup?: BattleSetup): DeploymentZoneSource {
  return setup?.deploymentZones ?? setup?.deployment ?? 'Default';
}

function modelIsOutsideEnemyDeploymentZoneBuffer(unit: UnitProfile, side: Side, position: Position, modelIndex = 0, deployment: DeploymentZoneSource = 'Default', board = boardFormatForId()): boolean {
  if (!canDeployOutsideDeploymentZone(unit)) return true;
  const enemyZone = zoneFor((1 - side) as Side, deployment, board);
  return distanceToDeploymentZone(position, enemyZone) > ELEVENTH_SPECIAL_SETUP_ENEMY_BUFFER + modelBaseRadiusInches(unit, modelIndex);
}

function modelBaseRadius(unit: BattleUnit, modelIndex = 0): number {
  return modelBaseRadiusInches(unit.profile, modelIndex);
}

function modelRotation(unit: BattleUnit, modelIndex = 0): number {
  return unit.modelRotations?.[modelIndex] ?? unit.facingDeg ?? 0;
}

function modelFootprint(unit: BattleUnit, modelIndex = 0, rotationDeg = modelRotation(unit, modelIndex)) {
  return modelBaseFootprintInches(unit.profile, modelIndex, rotationDeg);
}

function maxModelBaseRadius(unit: BattleUnit): number {
  return battleUnitMaxBaseRadiusInches(unit);
}

function featureBlocksMovementForUnit(feature: TerrainFeature, parent: Terrain, unit: BattleUnit): boolean {
  if (!feature.blocksMovement) return false;
  if (unitHasRule(unit.profile, 'Super-heavy Walker') && feature.featureHeight === 'low') return false;
  if (hasKeyword(unit, 'infantry') && parent.type === 'ruin') return false;
  if (hasKeyword(unit, 'infantry') && feature.featureHeight === 'low') return false;
  return true;
}

function terrainMatBlocksMovementForUnit(t: Terrain, unit: BattleUnit): boolean {
  if (unit.superHeavyMobile && t.type === 'ruin') return false;
  if (hasKeyword(unit, 'titanic')) return true;
  if (t.type === 'ruin' && hasAnyKeyword(unit, ['vehicle', 'monster'])) return true;
  return t.type === 'impassable';
}

function takeToSkiesDistanceCost(unit: BattleUnit): number {
  return unit.takingToSkies && !unitHasRule(unit.profile, 'Hover') ? 2 : 0;
}

function profileDropHasInfiltrators(state: BattleState, side: Side, profile: UnitProfile): boolean {
  if (state.ruleset.edition !== '11e') return canDeployOutsideDeploymentZone(profile);
  return attachedUnitProfilesFor(state.armies[side].army, profile).every(candidate => unitHasRule(candidate, 'Infiltrators'));
}

function infiltratorModelsAreOutsideEnemyUnits(
  state: BattleState,
  side: Side,
  profile: UnitProfile,
  modelPositions: Position[],
  modelIndexes = modelPositions.map((_, index) => index),
): boolean {
  return modelPositions.every((position, modelIndex) => enemies(state, side).every(enemy =>
    enemy.modelPositions.every((enemyPosition, enemyModelIndex) => baseFootprintDistance(
      position,
      modelBaseFootprintInches(profile, modelIndexes[modelIndex] ?? modelIndex),
      enemyPosition,
      modelFootprint(enemy, enemyModelIndex),
    ) > ELEVENTH_SPECIAL_SETUP_ENEMY_BUFFER),
  ));
}

function unitTakesToSkiesForState(state: BattleState, unit: BattleUnit): boolean {
  return hasKeyword(unit, 'fly')
    && (state.ruleset.edition !== '11e' || unit.takingToSkies === true);
}

function unitMovedThisPhase(state: BattleState, unit: BattleUnit): boolean {
  return unit.lastMovePhase === state.phase && unit.lastMoveTurn === state.turn;
}

function unitSurgedThisPhase(state: BattleState, unit: BattleUnit): boolean {
  return unit.surgeMovePhase === state.phase && unit.surgeMoveTurn === state.turn;
}

export function findReachablePosition(
  unit: BattleUnit,
  to: Position,
  maxInches: number,
  terrain: Terrain[],
  stopGap = 1.05,
  ignoreTerrain = false,
): Position {
  return movementPathing.findReachablePosition(unit, to, maxInches, terrain, movementPathingContext, stopGap, ignoreTerrain);
}

// Counts models in the unit that carry weaponIndex and optionally have LOS to the defender.
// Pass defender + terrain to restrict to models with edge-to-edge LOS (ranged, non-Indirect Fire weapons).
function aliveWeaponModelCount(
  unit: BattleUnit,
  weaponIndex: number,
  defender?: BattleUnit,
  terrain?: Terrain[],
): number {
  return aliveWeaponModelIndexes(unit, weaponIndex, defender, terrain).length;
}

function aliveWeaponModelIndexes(
  unit: BattleUnit,
  weaponIndex: number,
  defender?: BattleUnit,
  terrain?: Terrain[],
  state?: BattleState,
): number[] {
  const indexes: number[] = [];
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterModelIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    if (!modelWeaponLoadout(unit.profile, rosterModelIndex).some(i => i === weaponIndex)) continue;
    if (defender && terrain) {
      const fromCenter = unit.modelPositions[modelIndex];
      if (!fromCenter) continue;
      const fromRadius = modelBaseRadius(unit, modelIndex);
      const canSee = defender.modelPositions.some((toCenter, ti) =>
        (!state || !modelIsHiddenFrom(state, unit, modelIndex, defender, ti))
          && hasLOSEdgeToEdge(fromCenter, fromRadius, toCenter, modelBaseRadius(defender, ti), terrain, state?.ruleset?.edition),
      );
      if (!canSee) continue;
    }
    indexes.push(modelIndex);
  }
  return indexes;
}

function weaponIsSidearm(weapon: WeaponProfile): boolean {
  return weaponHasKeyword(weapon, 'Pistol') || weaponHasKeyword(weapon, 'Sidearm');
}

function weaponProfileGroup(weapon: WeaponProfile): string | null {
  const group = weapon.profileGroup?.trim();
  return group ? group.toLowerCase() : null;
}

function chooseOneProfilePerGroup<T extends { weapon: WeaponProfile }>(weapons: T[]): T[] {
  const usedGroups = new Set<string>();
  return weapons.filter(option => {
    const group = weaponProfileGroup(option.weapon);
    if (!group) return true;
    if (usedGroups.has(group)) return false;
    usedGroups.add(group);
    return true;
  });
}


// True if the shooter model (at fromCenter with fromRadius) has edge-to-edge LOS
// to at least one model in the target unit.
function hasAnyModelLOS(
  fromCenter: Position, fromRadius: number,
  target: BattleUnit,
  terrain: Terrain[],
  edition?: '10e' | '11e',
): boolean {
  return target.modelPositions.some((toCenter, i) =>
    hasLOSEdgeToEdge(fromCenter, fromRadius, toCenter, modelBaseRadius(target, i), terrain, edition),
  );
}

function terrainVisibilityContext() {
  return {
    modelRadius: modelBaseRadius,
    hasKeyword,
    modelBaseEdgeDistance: (source: BattleUnit, sourceModelIndex: number, target: BattleUnit, targetModelIndex: number) =>
      modelBaseEdgeDistance3d(
        source.modelPositions[sourceModelIndex], modelFootprint(source, sourceModelIndex),
        target.modelPositions[targetModelIndex], modelFootprint(target, targetModelIndex),
      ),
  };
}

function modelIsHiddenFrom(state: BattleState, source: BattleUnit, sourceModelIndex: number, target: BattleUnit, targetModelIndex: number): boolean {
  return modelIsHiddenFromGeometry(state, source, sourceModelIndex, target, targetModelIndex, terrainVisibilityContext());
}

function hasAnyModelLOSConsideringHidden(state: BattleState, source: BattleUnit, target: BattleUnit): boolean {
  return hasAnyModelLOSConsideringHiddenGeometry(state, source, target, terrainVisibilityContext());
}

function hasAnyHiddenModelPair(state: BattleState, source: BattleUnit, target: BattleUnit): boolean {
  return hasAnyHiddenModelPairGeometry(state, source, target, terrainVisibilityContext());
}

function markRangedAttackMade(unit: BattleUnit): void {
  unit.rangedAttacksMadeThisTurn = true;
}

function participatingWeaponModelIndexes(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  terrain: Terrain[],
  state?: BattleState,
): number[] {
  const needsLOS = !weapon.isMelee && !weaponHasKeyword(weapon, 'Indirect Fire');
  return needsLOS
    ? aliveWeaponModelIndexes(attacker, weaponIndex, defender, terrain, state)
    : aliveWeaponModelIndexes(attacker, weaponIndex);
}

function linePassesThroughModel(from: Position, to: Position, model: Position, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.0001) return false;
  const projection = ((model.x - from.x) * dx + (model.y - from.y) * dy) / lengthSquared;
  if (projection <= 0.02 || projection >= 0.98) return false;
  const closestX = from.x + projection * dx;
  const closestY = from.y + projection * dy;
  return Math.hypot(model.x - closestX, model.y - closestY) <= radius;
}

function targetIsScreenedBySmoke(state: BattleState, attacker: BattleUnit, target: BattleUnit): boolean {
  const smokeUnits = state.units.filter(unit =>
    unit.side === target.side
    && unit.id !== target.id
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && unitHasActiveStratagem(state, unit, 'smokescreen', 'shooting'),
  );
  return attacker.modelPositions.some(from =>
    target.modelPositions.some(to =>
      smokeUnits.some(smokeUnit => smokeUnit.modelPositions.some((smokeModel, smokeModelIndex) =>
        linePassesThroughModel(
          from,
          to,
          smokeModel,
          modelBaseRadius(smokeUnit, smokeModelIndex),
        )
      ))
    )
  );
}

function meleeWeaponSelection(
  unit: BattleUnit,
  options: Array<{ weapon: WeaponProfile; weaponIndex: number }>,
  requested: number | 'all',
): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  const selected = new Set<number>();
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const carried = new Set(modelWeaponLoadout(unit.profile, rosterIndex));
    const modelOptions = options.filter(option => carried.has(option.weaponIndex));
    const extra = chooseOneProfilePerGroup(modelOptions.filter(option => weaponHasKeyword(option.weapon, 'Extra Attacks')));
    extra.forEach(option => selected.add(option.weaponIndex));
    const normal = chooseOneProfilePerGroup(modelOptions.filter(option => !weaponHasKeyword(option.weapon, 'Extra Attacks')));
    const requestedNormal = typeof requested === 'number'
      ? normal.find(option => option.weaponIndex === requested)
      : undefined;
    const chosenNormal = requestedNormal ?? normal[0];
    if (chosenNormal) selected.add(chosenNormal.weaponIndex);
  }
  return options.filter(option => selected.has(option.weaponIndex));
}

function participatingWeaponModelCount(
  attacker: BattleUnit,
  defender: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  terrain: Terrain[],
  state?: BattleState,
): number {
  return participatingWeaponModelIndexes(attacker, defender, weapon, weaponIndex, terrain, state).length;
}

export function transportCapacityRemaining(state: BattleState, transportUnitId: string): number {
  return deploymentTransportCapacityRemaining(state, transportUnitId);
}

const transportEmbarkContext: deploymentActions.TransportEmbarkContext = {
  movementStep,
  clone,
  cancelUnitAction,
  recordUnitLeftBattlefield: recordUnitLeftBattlefieldMissionEvent,
  modelRotation,
  log,
};

export function playTransportPassengers(state: BattleState, transportUnitId: string): BattleUnit[] {
  return transportPassengers(state, transportUnitId);
}

// ─── Unit queries ─────────────────────────────────────────────────────────────

function enemies(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(u => u.side !== side && !u.destroyed && !u.embarkedInUnitId && !u.inStrategicReserves);
}

function nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null {
  if (!targets.length) return null;
  return targets.reduce((best, t) =>
    dist(unit.position, t.position) < dist(unit.position, best.position) ? t : best,
  );
}

export type SimulationMovementTarget =
  | { kind: 'enemy'; unit: BattleUnit }
  | { kind: 'objective'; index: number; position: Position };

/** Choose between the nearest enemy and a strategically valuable objective. */
export function chooseSimulationMovementTarget(
  state: BattleState,
  unit: BattleUnit,
): SimulationMovementTarget | null {
  const enemy = nearest(unit, enemies(state, unit.side));
  const enemyDistance = enemy ? dist(unit.position, enemy.position) : Number.POSITIVE_INFINITY;
  const objective = state.objectives
    .map((position, index) => {
      const owner = state.objectiveOwners[index] ?? null;
      const priority = owner === unit.side ? 0.45 : owner === null ? 1.5 : 2.25;
      const controlWeight = 1 + Math.max(0, unit.profile.oc) / 2;
      return {
        index,
        position,
        cost: dist(unit.position, position) / (priority * controlWeight),
      };
    })
    .sort((left, right) => left.cost - right.cost)[0];

  if (!objective || !enemy) {
    return objective
      ? { kind: 'objective', index: objective.index, position: objective.position }
      : enemy
        ? { kind: 'enemy', unit: enemy }
        : null;
  }
  return objective.cost < enemyDistance
    ? { kind: 'objective', index: objective.index, position: objective.position }
    : { kind: 'enemy', unit: enemy };
}

function modelBaseEdgeDistance3d(
  aModel: Position,
  aFootprint: ReturnType<typeof modelFootprint>,
  bModel: Position,
  bFootprint: ReturnType<typeof modelFootprint>,
): number {
  const horizontal = baseFootprintDistance(aModel, aFootprint, bModel, bFootprint);
  const vertical = verticalDistance(aModel, bModel);
  return Math.hypot(horizontal, vertical);
}

function attackingModelToAttachedUnitDistance(
  state: BattleState,
  attacker: BattleUnit,
  attackerModelIndex: number,
  defender: BattleUnit,
): number {
  const attackerPosition = attacker.modelPositions[attackerModelIndex];
  if (!attackerPosition) return Number.POSITIVE_INFINITY;
  return Math.min(...attachedUnitComponents(state, defender).flatMap(component =>
    component.modelPositions.map((position, modelIndex) => modelBaseEdgeDistance3d(
      attackerPosition,
      modelFootprint(attacker, attackerModelIndex),
      position,
      modelFootprint(component, modelIndex),
    )),
  ));
}

function modelBaseEdgeHorizontalDistance(
  aUnit: BattleUnit,
  aModelIndex: number,
  bUnit: BattleUnit,
  bModelIndex: number,
): number {
  return baseFootprintDistance(
    aUnit.modelPositions[aModelIndex],
    modelFootprint(aUnit, aModelIndex),
    bUnit.modelPositions[bModelIndex],
    modelFootprint(bUnit, bModelIndex),
  );
}

function modelsWithinEngagementRange(
  aModel: Position,
  aFootprint: ReturnType<typeof modelFootprint>,
  bModel: Position,
  bFootprint: ReturnType<typeof modelFootprint>,
  horizontalRange: number,
): boolean {
  return baseFootprintDistance(aModel, aFootprint, bModel, bFootprint) <= horizontalRange
    && verticalDistance(aModel, bModel) <= COHERENCY_VERTICAL_RANGE;
}

function inEngagement(unit: BattleUnit, others: BattleUnit[], range: number): boolean {
  return others.some(o =>
    unit.modelPositions.some((mp, mi) =>
      o.modelPositions.some((op, oi) =>
        modelsWithinEngagementRange(mp, modelFootprint(unit, mi), op, modelFootprint(o, oi), range),
      ),
    ),
  );
}

function engagedEnemies(state: BattleState, unit: BattleUnit, rules: RulesEdition): BattleUnit[] {
  const eng = rules.engagementRange();
  return enemies(state, unit.side).filter(enemy => inEngagement(unit, [enemy], eng));
}

function nonAircraftEngagedEnemies(state: BattleState, unit: BattleUnit, rules: RulesEdition): BattleUnit[] {
  return engagedEnemies(state, unit, rules).filter(enemy => !isAircraft(enemy));
}

function targetWithinFriendlyEngagement(state: BattleState, target: BattleUnit, side: Side, rules: RulesEdition): boolean {
  const eng = rules.engagementRange();
  return inEngagement(target, activeUnits(state, side), eng);
}

function targetVisibleToFriendlyUnit(state: BattleState, target: BattleUnit, side: Side): boolean {
  return activeUnits(state, side).some(unit => battleUnitHasLosToAttachedUnit(state, unit, target));
}

const unitCanChargeTarget = (unit: BattleUnit, target: BattleUnit): boolean => manualCombat.unitCanChargeTarget(unit, target, hasKeyword);
const unitCanFightTarget = (unit: BattleUnit, target: BattleUnit): boolean => manualCombat.unitCanFightTarget(unit, target, hasKeyword);

// ─── Combat resolution ────────────────────────────────────────────────────────

const combatWoundContext: manualCombat.CombatWoundContext = {
  weaponHasKeyword,
  attachedUnitKeywordSet,
};
const processWoundsAgainstDefender = (
  rolls: number[], woundTarget: number, weapon: WeaponProfile, defender: BattleUnit, rules: RulesEdition, state: BattleState,
) => manualCombat.processWoundsAgainstDefender(rolls, woundTarget, weapon, defender, rules, state, combatWoundContext);

/**
 * Shared dice-to-damage resolution used by every weapon attack path. Phase
 * code validates declarations and sequencing; this resolver owns attack rolls,
 * hit/wound/save/FNP processing, pending damage, and typed resolution groups.
 */

const combatAttackResolutionContext: manualCombat.CombatAttackContext = {
  dist, battleUnitToAttachedUnitDistance, activeEpicChallengeModelIndex, participatingWeaponModelIndexes,
  unitHasRule, attachedUnitIsFormed, attachedUnitHasRule, attachedUnitComponents, leadingAttackModifiers, leadingRerolls,
  leadingWeaponKeywords, unitGrantedWeaponKeywords, auraAbilitiesInRange, attachedUnitRemainingModels,
  attackingModelToAttachedUnitDistance, weaponHasKeyword, weaponKeywordValue, log, attachedUnitToughness,
  rollExpression, hasAnyModelLOS, modelBaseRadius, attackingModelHasPlungingFire, targetVisibleToFriendlyUnit,
  rollMultiple, d6, processWoundsAgainstDefender, attachedInvulnerableSave, rangedSaveModifier,
  resolveSaveOutcome, applyDamage, objectiveIndexesWithinRange, recordBattleEvent, BATTLE_EVENT_TYPE,
};

export function resolveCombatAttacks(
  attacker: BattleUnit, defender: BattleUnit, weapon: WeaponProfile, weaponIndex: number,
  rules: RulesEdition, state: BattleState, hasCover: boolean, hitModifier = 0, hitModifierNote = '',
  options: CombatAttackResolutionOptions = {},
): LogEntry[] {
  return manualCombat.resolveCombatAttacks(
    attacker, defender, weapon, weaponIndex, rules, state, hasCover, hitModifier, hitModifierNote, options, combatAttackResolutionContext,
  );
}

const damageApplicationContext: damageApplication.DamageApplicationContext = {
  applyFeelNoPain,
  queueDeadlyDemise: (state, unit, modelIndexes, attackerSide) =>
    queueDeadlyDemiseForModels(state, unit, modelIndexes, attackerSide),
  recordDestroyedModels: recordDestroyedModelMissionEvents,
  rememberDestroyedPositions,
  trimUnitModelState,
  queueFightOnDeath: queueFightOnDeathWindow,
  markUnitDestroyed,
  recordDestroyedUnit: recordDestroyedUnitMissionEvent,
  emergencyDisembark: (state, unit, attackerSide) => emergencyDisembarkDestroyedTransport(state, unit, attackerSide),
};

export function applyDamage(
  unit: BattleUnit,
  totalDamage: number,
  state: BattleState,
  attackerSide: Side,
  options: damageApplication.DamageApplicationOptions = {},
): LogEntry[] {
  return damageApplication.applyDamage(unit, totalDamage, state, attackerSide, options, damageApplicationContext);
}

const deadlyDemiseContext: deadlyDemise.DeadlyDemiseContext = {
  d6,
  rollExpression,
  log,
  modelFootprint,
  baseFootprintDistance,
  attachedComponents: attachedUnitComponents,
  attachedUnitId,
  applyDamage,
};
const queueDeadlyDemiseForModels = (state: BattleState, unit: BattleUnit, modelIndices: number[], destroyedBySide: Side) =>
  deadlyDemise.queueDeadlyDemiseForModels(state, unit, modelIndices, destroyedBySide, deadlyDemiseContext);
const resolvePendingDeadlyDemisesInPlace = (state: BattleState) =>
  deadlyDemise.resolvePendingDeadlyDemisesInPlace(state, deadlyDemiseContext);

export function resolvePendingDeadlyDemises(state: BattleState): BattleState {
  if (!state.pendingDeadlyDemises?.length) return state;
  const s = clone(state);
  s.log = [...s.log, ...resolvePendingDeadlyDemisesInPlace(s)];
  return s;
}

// ─── Phase simulators ─────────────────────────────────────────────────────────


const transportDestruction = createTransportDestruction({
  markUnitDestroyed, centroid, unitIsTransportProfile: isTransportProfile, embarkedUnitsForTransport: transportPassengers, unitRosterId,
  unitAssignedToTransport: (profile: UnitProfile, transport: BattleUnit) => deploymentActions.unitAssignedToTransport(profile, transport, transportDisembarkPlacementContext),
  makeBattleUnit, disembarkPositions, recordDestroyedModelMissionEvents,
  recordDestroyedUnitMissionEvent, log, modelRotation, d6,
});
const emergencyDisembarkDestroyedTransport = transportDestruction.emergencyDisembarkDestroyedTransport;
const resolveCombatDisembarkHazards = transportDestruction.resolveCombatDisembarkHazards;


const movementSimulationContext: movementSimulation.MovementSimulationContext = {
  unitSurgedThisPhase, isAircraft, aircraftCanMakeNormalMove, enemies, nonAircraftEngagedEnemies,
  inEngagement, log, chooseSimulationMovementTarget, dist, formationExtent, hasKeyword,
  takeToSkiesDistanceCost, findReachablePosition, unitTakesToSkiesForState,
  avoidModelOverlap: interactiveMovementState.avoidModelOverlap,
  translateFormation, cancelUnitAction,
  resolveInternalModelOverlaps: interactiveMovementState.resolveInternalModelOverlaps, centroid,
};
const runMovement = (unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] =>
  movementSimulation.runMovement(unit, state, rules, movementSimulationContext);

function applyFeelNoPain(
  unit: BattleUnit,
  damage: number,
  state: BattleState,
): { damage: number; logs: LogEntry[] } {
  return manualCombat.applyFeelNoPain(unit, damage, state, {
    attachedUnitComponents,
    feelNoPainTargets,
    rollMultiple,
    resolveFeelNoPainOutcome,
    log,
  });
}

function unitCanUseBigGunsNeverTire(unit: BattleUnit): boolean {
  return manualCombat.unitCanUseBigGunsNeverTire(unit, shootingSelectionRulesContext);
}

function weaponIsCloseQuarters(weapon: WeaponProfile): boolean {
  return manualCombat.weaponIsCloseQuarters(weapon, shootingSelectionRulesContext);
}

function unitCanUseCloseQuartersShooting(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  return manualCombat.unitCanUseCloseQuartersShooting(unit, state, rules, shootingSelectionRulesContext);
}

const shootingSelectionRulesContext: manualCombat.ShootingSelectionRulesContext = {
  unitHasKeyword: hasKeyword,
  weaponHasKeyword,
  enemies,
  inEngagement,
  weaponProfileGroup,
  weaponIsSidearm,
};

const shootingTargetRulesContext: manualCombat.ShootingSelectionRulesContext = {
  ...shootingSelectionRulesContext,
  engagedEnemies,
  attachedUnitTargetRepresentative,
  activeEpicChallengeModelIndex,
  hasLOSEdgeToEdge,
  modelBaseRadius,
  hasAnyModelLOS,
  unitHasDatasheetRule,
  battleUnitsBaseEdgeDistance,
  targetWithinFriendlyEngagement,
  battleUnitHasLosToAttachedUnit,
  attachedUnitComponents,
  hasAnyHiddenModelPair,
  battleUnitToAttachedUnitDistance,
};

const shootingResolutionContext: manualCombat.ShootingResolutionContext = {
  ...shootingTargetRulesContext,
  targetHasTerrainCoverFrom: (_state, unit, target) => targetHasTerrainCoverFromGeometry(unit.modelPositions, target, _state.terrain, {
    modelRadius: modelBaseRadius,
    hasKeyword: unitHasKeyword,
  }),
  targetIsScreenedBySmoke,
  hasAnyModelLOSConsideringHidden,
  attachedUnitHasRule,
  targetWithinFriendlyEngagement,
  unitHasActiveStratagem,
  markRangedAttackMade,
  markOneShotWeaponSpent,
  participatingWeaponModelCount,
  resolveCombatAttacks,
  resolveHazardousTests: (unit, weapon, weaponIndex, state, testCount) => resolveHazardousTests(unit, weapon, weaponIndex, state, testCount),
  log,
};

function resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState, testCount = aliveWeaponModelCount(unit, weaponIndex)): LogEntry[] {
  return manualCombat.resolveHazardousTests(unit, weapon, weaponIndex, state, {
    weaponHasKeyword,
    rollMultiple,
    log,
    applyDamage,
    aliveWeaponModelCount,
    unitHasKeyword,
    unitCanUseBigGunsNeverTire,
  }, testCount);
}

const missionActionEligibilityContext: missionActions.MissionActionEligibilityContext = {
  attachedUnitComponents, isAircraft, isFortification, objectiveControlValue, attachedUnitKeywordSet,
  inEngagement, enemies, log,
};
function cancelUnitAction(state: BattleState, unit: BattleUnit, reason: string): void {
  missionActions.cancelUnitAction(state, unit, reason, missionActionEligibilityContext);
}

function attachedObjectiveIndexesWithinRange(state: BattleState, unit: BattleUnit, rules: RulesEdition): number[] {
  return [...new Set(attachedUnitComponents(state, unit)
    .flatMap(component => objectiveIndexesWithinRange(state, component, rules)))];
}

function attachedTerrainAreaIdsContainingUnit(state: BattleState, unit: BattleUnit): string[] {
  const components = attachedUnitComponents(state, unit);
  if (!components.length) return [];
  return terrainAreaIdsContainingUnit(state, components[0]).filter(terrainId =>
    components.every(component => terrainAreaIdsContainingUnit(state, component).includes(terrainId)),
  );
}

const unitIsEligibleToStartAction = (unit: BattleUnit, state: BattleState, rules: RulesEdition, ignoreActionStartedThisTurn = false): boolean =>
  missionActions.unitIsEligibleToStartAction(unit, state, rules, missionActionEligibilityContext, ignoreActionStartedThisTurn);

export function playUnitCanStartAction(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  if (state.activeArmy !== side || state.phase === 'deployment' || state.phase === 'setup' || state.phase === 'end') return false;
  return missionActions.playUnitCanStartAction(state, unitId, side, rules, missionActionEligibilityContext);
}

const missionActionOptionsContext: missionActions.MissionActionsContext = {
  canStartAction: playUnitCanStartAction,
  objectiveIndexesWithinRange: attachedObjectiveIndexesWithinRange,
  objectiveRoleForIndex,
};
const missionObjectiveActionOptions = (
  state: BattleState, unitId: string, side: Side, rules: RulesEdition, missionName: string, actionId: string,
  objectiveFilter: 'any' | 'non-home' | 'central' = 'non-home',
) => missionActions.missionObjectiveActionOptions(state, unitId, side, rules, missionName, actionId, objectiveFilter, missionActionOptionsContext);

export function extractIntelligenceObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Gather Intel', 'extract-intelligence');
}

export function triangulateObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Triangulation', 'triangulate');
}

export function consecrateObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  resolvingEndOfTurn = false,
): number[] {
  return missionActions.consecrateObjectiveOptions(state, unitId, side, rules, targetedMissionActionContext, resolvingEndOfTurn);
}

export function consecrateObjective(
  state: BattleState,
  unitId: string,
  side: Side,
  objectiveIndex: number,
  rules: RulesEdition,
  resolvingEndOfTurn = false,
): BattleState {
  return missionActions.consecrateObjective(state, unitId, side, objectiveIndex, rules, targetedMissionActionContext, resolvingEndOfTurn);
}

export function maintainControlObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Vital Link', 'maintain-control', 'central');
}

export function secureAssetObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Secure Asset', 'secure-asset');
}

export function decoyObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Smoke and Mirrors', 'decoy');
}

export function sabotageObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionObjectiveActionOptions(state, unitId, side, rules, 'Sabotage', 'sabotage');
}

function hasActiveSecondaryMission(state: BattleState, side: Side, missionName: string): boolean {
  return secondaryMissionStateFor(state, side)?.activeCards.some(card => card.missionName === missionName) ?? false;
}

const secondaryMissionActionOptionsContext: missionActions.SecondaryMissionActionOptionsContext = {
  hasActiveSecondaryMission,
  canStartAction: playUnitCanStartAction,
  objectiveIndexesWithinRange: attachedObjectiveIndexesWithinRange,
  terrainAreaIdsContainingUnit: attachedTerrainAreaIdsContainingUnit,
  terrainIsExplicitlyOutsideTerritory,
};

const targetedMissionActionContext: missionActions.TargetedMissionActionContext = {
  ...secondaryMissionActionOptionsContext,
  unitIsEligibleToStartAction,
  objectiveRoleForIndex,
  battleUnitsWithinBaseEdgeRange,
  hasAnyModelLOSConsideringHidden,
  terrainWithinOpponentTerritory: (state, terrain, side) => terrainWithinMissionTerritory(state, terrain, (1 - side) as Side) === true,
  terrainContainsObjective: (_state, terrain, objectiveIndex) => pointInTerrain(_state.objectives[objectiveIndex], terrain),
  terrainIsOutsideDeploymentZone: (state, terrain, side) => {
    const zone = zoneFor(side, setupDeploymentZoneSource(state.setup), boardFormatForState(state));
    return !pointInDeploymentZone({ x: terrain.x + terrain.width / 2, y: terrain.y + terrain.height / 2 }, zone);
  },
  rulesForState: state => rulesEditionForRuleset(state.ruleset),
  log,
  clone,
  battleRound,
  hasUnresolvedFightWork: (state, side, rules) => activeUnits(state, side).some(candidate =>
    playUnitCanPileIn(state, candidate.id, side, rules) || playUnitCanConsolidate(state, candidate.id, side))
    || playFightActivationUnitIds(state, side, rules).length > 0,
};

function objectiveIsCentral(state: BattleState, objectiveIndex: number): boolean {
  return missionActions.objectiveIsCentral(state, objectiveIndex, targetedMissionActionContext);
}

function vanguardOperationTerrainIsValid(state: BattleState, unit: BattleUnit, side: Side, terrainId: string): boolean {
  return missionActions.vanguardOperationTerrainIsValid(state, unit, side, terrainId, targetedMissionActionContext);
}

function removeOpponentOperationMarkersAfterMove(state: BattleState, unit: BattleUnit): void {
  missionActions.removeOpponentOperationMarkersAfterMove(state, unit, targetedMissionActionContext);
}

function completedOrInProgressObjectiveTargets(state: BattleState, side: Side, actionId: string): Set<number> {
  return missionActions.completedOrInProgressObjectiveTargets(state, side, actionId);
}

export function cleanseObjectiveOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): number[] {
  return missionActions.cleanseObjectiveOptions(state, unitId, side, rules, secondaryMissionActionOptionsContext);
}

function terrainIsExplicitlyOutsideTerritory(state: BattleState, side: Side, terrainId: string): boolean {
  const terrain = state.terrain.find(candidate => candidate.id === terrainId);
  return !!terrain && ['enemy', 'no-mans-land'].includes(terrainTerritoryRelation(terrain, side));
}

function completedOrInProgressTerrainTargets(state: BattleState, side: Side, actionId: string): Set<string> {
  return missionActions.completedOrInProgressTerrainTargets(state, side, actionId);
}

export function plunderTerrainOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  return missionActions.plunderTerrainOptions(state, unitId, side, rules, secondaryMissionActionOptionsContext);
}

export function sensorSweepOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): missionActions.SensorSweepOption[] {
  return missionActions.sensorSweepOptions(state, unitId, side, rules, targetedMissionActionContext);
}

export function surveilTargetOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  return missionActions.surveilTargetOptions(state, unitId, side, rules, targetedMissionActionContext);
}

export function vanguardOperationTerrainOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  return missionActions.vanguardOperationTerrainOptions(state, unitId, side, rules, targetedMissionActionContext);
}

export function boobyTrapTerrainOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): string[] {
  return missionActions.boobyTrapTerrainOptions(state, unitId, side, rules, targetedMissionActionContext);
}

export function punishmentCondemnedUnitOptions(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
): string[] {
  return missionActions.punishmentCondemnedUnitOptions(state, side, rules, targetedMissionActionContext);
}

export function togglePunishmentCondemnedUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
): BattleState {
  return missionActions.togglePunishmentCondemnedUnit(state, unitId, side, rules, targetedMissionActionContext);
}

function autoSelectPunishmentCondemnedUnits(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
): void {
  missionActions.autoSelectPunishmentCondemnedUnits(state, side, rules, targetedMissionActionContext);
}

export function startPlayUnitAction(
  state: BattleState,
  unitId: string,
  side: Side,
  actionId = 'generic-action',
  actionName = 'Action',
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
  targetObjectiveIndex?: number,
  targetTerrainId?: string,
  targetOperationMarkerId?: string,
  targetUnitId?: string,
): BattleState {
  return missionActions.startPlayUnitAction(state, unitId, side, actionId, actionName, rules,
    targetObjectiveIndex, targetTerrainId, targetOperationMarkerId, targetUnitId, {
      playUnitCanStartAction,
      extractIntelligenceObjectiveOptions,
      triangulateObjectiveOptions,
      consecrateObjectiveOptions,
      maintainControlObjectiveOptions,
      secureAssetObjectiveOptions,
      decoyObjectiveOptions,
      sabotageObjectiveOptions,
      cleanseObjectiveOptions,
      plunderTerrainOptions,
      vanguardOperationTerrainOptions,
      boobyTrapTerrainOptions,
      sensorSweepOptions,
      surveilTargetOptions,
      applyStartedMissionAction: missionActions.applyStartedMissionAction,
      clone,
      attachedUnitComponents,
      attachedObjectiveIndexesWithinRange,
      recordCompletedMissionAction,
      log,
    });
}

export function completeEndOfTurnActions(state: BattleState, side: Side): void {
  missionActions.completeEndOfTurnActions(state, side, {
    attachedUnitId, vanguardOperationTerrainIsValid, cancelUnitAction, hasActiveSecondaryMission,
    attachedObjectiveIndexesWithinRange, rulesEditionForRuleset, attachedTerrainAreaIdsContainingUnit,
    terrainIsExplicitlyOutsideTerritory, recordCompletedMissionAction, attachedUnitComponents, log,
    resolveSensorSweepCompletion: (next: BattleState, unit: BattleUnit, actingSide: Side, action: any): string | null => {
      const markerIndex = next.missionState?.operationMarkers?.findIndex(marker => marker.id === action.targetOperationMarkerId) ?? -1;
      const rules = rulesEditionForRuleset(next.ruleset);
      const controls = action.targetObjectiveIndex !== undefined
        && attachedObjectiveIndexesWithinRange(next, unit, rules).includes(action.targetObjectiveIndex)
        && objectiveIsCentral(next, action.targetObjectiveIndex)
        && updateObjectiveControl(next, rules)?.some(objective => objective.objectiveIndex === action.targetObjectiveIndex && objective.owner === actingSide);
      if (markerIndex < 0) return 'the selected operation marker is no longer on the battlefield';
      if (!controls) return 'the unit does not control the selected central objective';
      next.missionState!.operationMarkers = next.missionState!.operationMarkers!.filter(marker => marker.id !== action.targetOperationMarkerId);
      return null;
    },
  });
}

function eligibleShootingWeapons(
  unit: BattleUnit,
  state: BattleState,
  rules: RulesEdition,
  allowActivated = false,
): WeaponProfile[] {
  return manualCombat.eligibleShootingWeapons(unit, state, rules, shootingSelectionRulesContext, allowActivated);
}

function shootingWeaponSelectionForAll(weapons: Array<{ weapon: WeaponProfile; weaponIndex: number }>): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  return chooseOneProfilePerGroup(weapons.filter(option => !weaponIsSidearm(option.weapon)).length
    ? weapons.filter(option => !weaponIsSidearm(option.weapon)) : weapons);
}

function unitCanBeSelectedToShootWithoutAttacks(unit: BattleUnit, state: BattleState, rules: RulesEdition): boolean {
  return manualCombat.unitCanBeSelectedToShootWithoutAttacks(unit, state, rules, shootingSelectionRulesContext);
}

function shootingWeaponCanTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
): boolean {
  return manualCombat.shootingWeaponCanTarget(state, unit, target, weapon, rules, shootingTargetRulesContext);
}

function unitHasVisibleModelToTarget(state: BattleState, unit: BattleUnit, target: BattleUnit): boolean {
  return unit.modelPositions.some((from, i) => hasAnyModelLOS(from, modelBaseRadius(unit, i), target, state.terrain, state.ruleset?.edition));
}

function snapShootingWeaponCanTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  rules: RulesEdition,
): boolean {
  return battleUnitsBaseEdgeDistance(unit, target) <= 24
    && unitHasVisibleModelToTarget(state, unit, target)
    && shootingWeaponCanTarget(state, unit, target, weapon, rules);
}

function activeStratagemTargets(state: BattleState, stratagemId: string, phase: Phase): Set<string> {
  const round = battleRound(state);
  return new Set(
    (state.stratagemUses ?? [])
      .filter(use =>
        use.stratagemId === stratagemId
        && use.phase === phase
        && (use.battleRound ?? round) === round
        && use.targetUnitId
      )
      .map(use => use.targetUnitId!),
  );
}

function unitHasActiveStratagem(state: BattleState, unit: BattleUnit, stratagemId: string, phase: Phase): boolean {
  return activeStratagemTargets(state, stratagemId, phase).has(unit.id);
}

export function battleUnitsBaseEdgeDistance(a: BattleUnit, b: BattleUnit): number {
  let closest = Infinity;
  for (let ai = 0; ai < a.modelPositions.length; ai++) {
    const aModel = a.modelPositions[ai];
    const aFootprint = modelFootprint(a, ai);
    for (let bi = 0; bi < b.modelPositions.length; bi++) {
      const bModel = b.modelPositions[bi];
      const bFootprint = modelFootprint(b, bi);
      closest = Math.min(closest, modelBaseEdgeDistance3d(aModel, aFootprint, bModel, bFootprint));
    }
  }
  return closest;
}

export function battleModelBaseEdgeDistance(
  a: BattleUnit,
  aModelIndex: number,
  b: BattleUnit,
  bModelIndex: number,
): number {
  const aModel = a.modelPositions[aModelIndex];
  const bModel = b.modelPositions[bModelIndex];
  if (!aModel || !bModel) return Infinity;
  return modelBaseEdgeDistance3d(aModel, modelFootprint(a, aModelIndex), bModel, modelFootprint(b, bModelIndex));
}

export function battleUnitsWithinBaseEdgeRange(a: BattleUnit, b: BattleUnit, range: number): boolean {
  return battleUnitsBaseEdgeDistance(a, b) <= range;
}

function activeEpicChallengeModelIndex(state: BattleState, target: BattleUnit): number | undefined {
  const round = battleRound(state);
  return (state.stratagemUses ?? [])
    .find(use => use.stratagemId === 'epic-challenge'
      && use.phase === 'fight'
      && (use.battleRound ?? round) === round
      && use.targetUnitId === target.id)
    ?.targetModelIndex;
}

function battleUnitToAttachedUnitDistance(state: BattleState, source: BattleUnit, target: BattleUnit): number {
  return Math.min(...attachedUnitComponents(state, target).map(component => battleUnitsBaseEdgeDistance(source, component)));
}

function battleUnitHasLosToAttachedUnit(state: BattleState, source: BattleUnit, target: BattleUnit): boolean {
  return attachedUnitComponents(state, target).some(component =>
    hasAnyModelLOSConsideringHidden(state, source, component),
  );
}

function markOneShotWeaponSpent(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number): void {
  if (!weaponHasKeyword(weapon, 'One Shot')) return;
  unit.oneShotSpentWeaponIndices = [...new Set([...(unit.oneShotSpentWeaponIndices ?? []), weaponIndex])];
}

function resolveShootingWeaponIntoTarget(
  state: BattleState,
  unit: BattleUnit,
  target: BattleUnit,
  weapon: WeaponProfile,
  weaponIndex: number,
  rules: RulesEdition,
  options: { deferCasualties?: boolean; snapShooting?: boolean; attackCountOverride?: number; modelIndexes?: number[] } = {},
): LogEntry[] {
  return manualCombat.resolveShootingWeaponIntoTarget(state, unit, target, weapon, weaponIndex, rules, options, shootingResolutionContext);
}

function runShooting(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  return manualCombat.runShooting(unit, state, rules, {
    ...manualShootingSelectionContext,
    nearest,
    resolveShootingWeaponIntoTarget,
    shootingWeaponSelectionForAll,
    log,
  });
}

export type PlayShootingWeaponOption = manualCombat.PlayShootingWeaponOption;
export type PlayShootingAttackAllocation = manualCombat.PlayShootingAttackAllocation;

const manualShootingSelectionContext: manualCombat.ManualShootingSelectionContext = {
  attachedUnitId,
  aliveWeaponModelCount,
  nearest,
  eligibleShootingWeapons,
  enemies,
  shootingWeaponCanTarget,
  unitCanBeSelectedToShootWithoutAttacks,
};

export const playShootingWeaponAttackCount = (unit: BattleUnit, weaponIndex: number): number | null =>
  manualCombat.playShootingWeaponAttackCount(unit, weaponIndex, manualShootingSelectionContext);

export const playShootingWeaponModelCount = (unit: BattleUnit, weaponIndex: number): number =>
  manualCombat.playShootingWeaponModelCount(unit, weaponIndex, manualShootingSelectionContext);

export function shootPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayShootingAttackAllocation[],
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.shootPlayUnitWeapons(state, unitId, side, allocations, rules, {
    ...manualShootingSelectionContext,
    clone,
    aliveWeaponModelIndexes,
    participatingWeaponModelIndexes,
    resolveShootingWeaponIntoTarget,
    shootingWeaponSelectionForAll,
    updateAttachedShootingActivation,
    log,
  });
}

export function playShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayShootingWeaponOption[] {
  return manualCombat.playShootingWeaponOptions(state, unitId, side, rules, manualShootingSelectionContext);
}

function runShootingPhaseUnits(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return manualCombat.runShootingPhaseUnits(state, side, rules, {
    ...manualShootingSelectionContext,
    activeUnits,
    attachedUnitId,
    attachedUnitIsFormed,
    attachedUnitComponents,
    autoSelectFiringDeckInPlace,
    clearFiringDeckWeapons,
    resolvePendingDeadlyDemisesInPlace,
    nearest,
    resolveShootingWeaponIntoTarget,
    shootingWeaponSelectionForAll,
    log,
  });
}

function updateAttachedShootingActivation(
  state: BattleState,
  unit: BattleUnit,
  rules: RulesEdition,
  targetUnitId?: string,
): void {
  manualCombat.updateAttachedShootingActivation(state, unit, rules, {
    ...manualShootingSelectionContext,
    attachedUnitComponents,
    attachedUnitIsFormed,
  }, targetUnitId);
}

export function playSnapShootingWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayShootingWeaponOption[] {
  return manualCombat.playSnapShootingWeaponOptions(state, unitId, side, rules, {
    ...manualShootingSelectionContext,
    unitHasActiveStratagem,
    snapShootingWeaponCanTarget,
    shootingWeaponSelectionForAll,
    resolveShootingWeaponIntoTarget,
    log,
    clone,
  });
}

export function shootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string | undefined,
  weaponIndex: number | 'all',
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.shootPlayUnitWeapon(state, unitId, side, targetUnitId, weaponIndex, rules, {
    ...manualShootingSelectionContext,
    clone,
    clearFiringDeckWeapons,
    resolvePendingDeadlyDemisesInPlace,
    resolveShootingWeaponIntoTarget,
    shootingWeaponSelectionForAll,
    updateAttachedShootingActivation,
    log,
  });
}

export function snapShootPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.snapShootPlayUnitWeapon(state, unitId, side, targetUnitId, weaponIndex, rules, {
    ...manualShootingSelectionContext,
    clone,
    unitHasActiveStratagem,
    snapShootingWeaponCanTarget,
    shootingWeaponSelectionForAll,
    resolveShootingWeaponIntoTarget,
    log,
  });
}

export interface LOSRay {
  from: Position;
  to: Position;
  fromUnitId: string;
  toUnitId: string;
  fromModelIndex: number;
  toModelIndex: number;
  blocked: boolean;
}

export function shootingLOSRays(
  shooter: BattleUnit,
  target: BattleUnit,
  terrain: Terrain[],
  edition?: '10e' | '11e',
): LOSRay[] {
  const fromModels = shooter.modelPositions;
  const toModels = target.modelPositions;
  return fromModels.flatMap((fromCenter, fromIdx) => {
    const fromRadius = modelBaseRadius(shooter, fromIdx);
    return toModels.map((toCenter, toIdx) => {
      const toRadius = modelBaseRadius(target, toIdx);
      const ray = findUnblockedLOSRay(fromCenter, fromRadius, toCenter, toRadius, terrain, edition);
      // Unblocked: draw the actual edge-to-edge ray that has clear sight.
      // Blocked: fall back to center-to-center so the red dashed line shows the obstructed path.
      return ray
        ? {
          from: ray.from,
          to: ray.to,
          fromUnitId: shooter.id,
          toUnitId: target.id,
          fromModelIndex: fromIdx,
          toModelIndex: toIdx,
          blocked: false,
        }
        : {
          from: fromCenter,
          to: toCenter,
          fromUnitId: shooter.id,
          toUnitId: target.id,
          fromModelIndex: fromIdx,
          toModelIndex: toIdx,
          blocked: true,
        };
    });
  });
}

export function targetHasCoverFrom(
  shooterPositions: Position | Position[],
  target: BattleUnit,
  terrain: Terrain[],
): boolean {
  const positions = Array.isArray(shooterPositions) ? shooterPositions : [shooterPositions];
  return targetHasTerrainCoverFromGeometry(positions, target, terrain, {
    modelRadius: modelBaseRadius,
    hasKeyword: unitHasKeyword,
  });
}

export function lockPlayUnitShooting(state: BattleState, unitId: string, side: Side): BattleState {
  return manualCombat.lockPlayUnitShooting(state, unitId, side, { clone, attachedUnitComponents });
}

function runCharge(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  return manualCombat.runCharge(unit, state, rules, {
    enemies,
    unitCanChargeTarget,
    unitSurgedThisPhase,
    isAircraft,
    distance: dist,
    formationExtent,
    d6,
    hasKeyword,
    takesToSkies: unitTakesToSkiesForState,
    takeToSkiesDistanceCost,
    findReachablePosition,
    avoidModelOverlap: interactiveMovementState.avoidModelOverlap,
    translateFormation,
    resolveInternalModelOverlaps: interactiveMovementState.resolveInternalModelOverlaps,
    log,
  });
}

export type PlayChargeTargetOption = {
  targetId: string;
  needed: number;
};

const chargeRulesContext: manualCombat.ChargeRulesContext = {
  attachedComponents: attachedUnitComponents,
  enemies,
  isAircraft,
  unitSurgedThisPhase,
  canChargeTarget: unitCanChargeTarget,
  baseEdgeDistance: battleUnitsBaseEdgeDistance,
};

const manualChargeRollContext: manualCombat.ManualChargeRollContext = {
  attachedUnitComponents,
  unitSurgedThisPhase,
  sideCanDeclareCharge: manualCombat.sideCanDeclareCharge,
  unitCanDeclareCharge: (state: BattleState, unit: BattleUnit) => manualCombat.unitCanDeclareCharge(state, unit, chargeRulesContext),
  d6,
  clone,
  hasKeyword,
  takeToSkiesDistanceCost,
  recordBattleEvent,
  BATTLE_EVENT_TYPE,
  log,
  playChargeTargetOptions,
  enemies,
  inEngagement,
};

const manualChargeDeclarationContext: manualCombat.ManualChargeDeclarationContext = {
  ...manualChargeRollContext,
  chargeRules: chargeRulesContext,
  findReachablePosition,
  avoidModelOverlap: interactiveMovementState.avoidModelOverlap,
  resolveInternalModelOverlaps: interactiveMovementState.resolveInternalModelOverlaps,
  translateFormation,
  formationExtent,
  centroid,
  modelRotation,
  unitTakesToSkiesForState,
  distance: dist,
  unitCanChargeTarget,
};

export function playChargeRoll(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.playChargeRoll(state, unitId, side, rules, manualChargeRollContext);
}

export function playChargeEligibilityReason(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string | null {
  return manualCombat.playChargeEligibilityReason(state, unitId, side, rules, chargeRulesContext);
}

export function playChargeTargetOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayChargeTargetOption[] {
  if (state.phase !== 'charge') return [];
  return manualCombat.playChargeTargetOptions(state, unitId, side, rules, chargeRulesContext);
}

export function chargePlayUnitTarget(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return chargePlayUnitTargets(state, unitId, side, [targetUnitId], rules);
}

export function chargePlayUnitTargets(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitIds: string[],
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.chargePlayUnitTargets(state, unitId, side, targetUnitIds, rules, manualChargeDeclarationContext);
}

export function completePlayChargeMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.completePlayChargeMovement(state, unitId, side, rules, manualChargeRollContext);
}

export type PlayFightWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
};

export type PlayMeleeAttackAllocation = {
  weaponIndex: number;
  targetUnitId: string;
  attackCount?: number;
};

export type PlayMeleeAttackSplit = {
  targetUnitId: string;
  attacks: number;
};

export function playMeleeFixedAttackCount(
  state: BattleState,
  unitId: string,
  side: Side,
  weaponIndex: number,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): number | null {
  const option = playFightWeaponOptions(state, unitId, side, rules)
    .find(candidate => candidate.weaponIndex === weaponIndex);
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side);
  const attacks = unit?.profile.weapons[weaponIndex]?.attacks;
  if (!option || !unit || !/^\d+$/.test(String(attacks).trim())) return null;
  return Number(attacks) * aliveWeaponModelCount(unit, weaponIndex);
}

const fightEligibilityContext: manualCombat.FightEligibilityContext = {
  enemies,
  canFightTarget: unitCanFightTarget,
  inEngagement,
};

const unitCanFight = (unit: BattleUnit, state: BattleState, rules: RulesEdition) =>
  manualCombat.unitCanFight(unit, state, rules, fightEligibilityContext);
const unitWasEngagedAtFightStepStart = (state: BattleState, unit: BattleUnit) =>
  manualCombat.unitWasEngagedAtFightStepStart(state, unit);
const unitEligibleToFight = (unit: BattleUnit, state: BattleState, rules: RulesEdition) =>
  manualCombat.unitEligibleToFight(unit, state, rules, fightEligibilityContext);

const fightPhaseContext: manualCombat.FightPhaseContext = {
  activeUnits,
  enemies,
  canFightTarget: unitCanFightTarget,
  inEngagement,
  unitEligibleToFight,
  unitWasEngagedAtFightStepStart,
  attachedComponents: attachedUnitComponents,
  attachedUnitId,
  attachedUnitHasRule,
  unitHasActiveStratagem,
};

function startFightStepInPlace(s: BattleState, rules: RulesEdition): void {
  manualCombat.startFightStepInPlace(s, rules, fightPhaseContext);
  s.log = [...s.log, log(s, s.activeArmy, s.armies[s.activeArmy].name, 'Fight step begins; engagement eligibility is recorded.', 'phase')];
}

export function startPlayFightStep(
  state: BattleState,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight' || state.fightStepStarted) return state;
  const s = clone(state);
  startFightStepInPlace(s, rules);
  return s;
}

export function playFightStepNeedsStart(
  state: BattleState,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  return rules.metadata.edition === '11e' && state.phase === 'fight' && state.fightStepStarted === false;
}

export function playFightPhaseHasPendingActivations(
  state: BattleState,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  return rules.metadata.edition === '11e'
    && (playFightActivationUnitIds(state, 0, rules).length > 0
      || playFightActivationUnitIds(state, 1, rules).length > 0);
}

const finishAttachedFightComponent = (state: BattleState, unit: BattleUnit, rules: RulesEdition) =>
  manualCombat.finishAttachedFightComponent(state, unit, rules, fightPhaseContext);
const sideCanSelectFightUnit = (state: BattleState, side: Side, rules: RulesEdition) =>
  manualCombat.sideCanSelectFightUnit(state, side, rules, fightPhaseContext);

const manualFightResolutionContext: manualCombat.ManualFightResolutionContext = {
  ...fightPhaseContext,
  clone,
  unitCanFight,
  aliveWeaponModelCount,
  nearest,
  selectMeleeWeapons: meleeWeaponSelection,
  chooseOneProfilePerGroup,
  fixedWeaponAttackCount: (unit, weapon, weaponIndex) => manualCombat.fixedWeaponAttackCount(unit, weapon, weaponIndex, manualShootingSelectionContext),
  resolveCombatAttacks,
  resolvePendingDeadlyDemisesInPlace,
  resolveHazardousTests,
  finishAttachedFightComponent,
  log,
};

export function playFightActivationUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string[] {
  return manualCombat.playFightActivationUnitIds(state, side, rules, fightPhaseContext);
}

export function playFightFirstUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string[] {
  return manualCombat.playFightFirstUnitIds(state, side, rules, fightPhaseContext);
}

export function playOverrunFightUnitIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string[] {
  return manualCombat.playOverrunFightUnitIds(state, side, rules, fightPhaseContext);
}

export function selectPlayOverrunFight(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  if (!playOverrunFightUnitIds(state, side, rules).includes(unitId)) return state;
  const s = clone(state);
  const unit = s.units.find(candidate => candidate.id === unitId && candidate.side === side)!;
  unit.overrunFightSelected = true;
  s.log = [...s.log, log(s, side, unit.profile.name, `${unit.profile.name} is selected to make an Overrun Fight.`, 'fight')];
  return s;
}

const fightMovementContext: manualCombat.FightMovementContext = {
  enemies,
  modelBaseEdgeHorizontalDistance,
  modelBaseRadius,
  centroid,
  distance: dist,
};

const fightMovementWorkflowContext: manualCombat.FightMovementWorkflowContext = {
  ...fightMovementContext,
  clone,
  attachedComponents: attachedUnitComponents,
  inEngagement,
  unitSurgedThisPhase,
  unitCanFight,
  unitEligibleToFight,
  canConsolidate: playUnitCanConsolidate,
  hasNoBaseOverlap: (state, unit, modelIndices) => playMoveHasNoBaseOverlap(state, unit, modelIndices),
  hasNoWallOverlap: (state, unit, modelIndices) => playMoveHasNoWallOverlap(state, unit, modelIndices),
  log,
  moveRange: FIGHT_PHASE_MOVE_RANGE,
};

function applyFightPhaseMove(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
): BattleState {
  return manualCombat.applyFightPhaseMove(state, unitId, side, kind, rules, fightMovementWorkflowContext);
}

export function playUnitCanPileIn(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit
    && state.phase === 'fight'
    && (state.activeArmy === side || rules.metadata.edition === '11e')
    && (rules.metadata.edition === '11e' && state.fightStepStarted
      ? !!unit.overrunFightSelected && !unit.overrunPiledIn && unitEligibleToFight(unit, state, rules)
      : !unit.piledIn && (unitCanFight(unit, state, rules) || (unit.charged && enemies(state, side).length > 0)));
}

export function playUnitCanConsolidate(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  return !!unit && state.phase === 'fight' && (state.activeArmy === side || rules.metadata.edition === '11e') && unit.activated && !unit.consolidated
    && (rules.metadata.edition !== '11e' || !state.units.some(candidate => unitEligibleToFight(candidate, state, rules)));
}

export function pileInPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return applyFightPhaseMove(state, unitId, side, 'pileIn', rules);
}

export function consolidatePlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return applyFightPhaseMove(state, unitId, side, 'consolidate', rules);
}

export function playFightWeaponOptions(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): PlayFightWeaponOption[] {
  if (!sideCanSelectFightUnit(state, side, rules)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !unitCanFight(unit, state, rules)) return [];
  if (!playFightActivationUnitIds(state, side, rules).includes(unit.id)) return [];
  const targetIds = enemies(state, side)
    .filter(target => unitCanFightTarget(unit, target) && inEngagement(unit, [target], rules.engagementRange()))
    .map(target => target.id);
  const options = unit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee)
    .map(option => ({ weaponIndex: option.weaponIndex, name: option.weapon.name, targetIds }));
  if (options.length === 0) return [{ weaponIndex: -1, name: 'No melee weapons', targetIds }];
  return options;
}

export function fightPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
  targetSplits?: PlayMeleeAttackSplit[],
): BattleState {
  return manualCombat.fightPlayUnitWeapon(state, unitId, side, targetUnitId, weaponIndex, rules, manualFightResolutionContext, targetSplits);
}

export function fightPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayMeleeAttackAllocation[],
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.fightPlayUnitWeapons(state, unitId, side, allocations, rules, manualFightResolutionContext);
}

function unitHasFightOnDeath(unit: BattleUnit): boolean {
  return [...unit.profile.abilities, ...(unit.profile.rules ?? [])].some(rule =>
    /fight\s+on\s+death|fight\s+before\s+(?:it|being)\s+removed|can\s+fight\s+before\s+it\s+is\s+removed/i.test(`${rule.name} ${rule.description}`),
  );
}

function queueFightOnDeathWindow(
  state: BattleState,
  unit: BattleUnit,
  destroyedBySide: Side,
  modelPositions: Position[],
  modelRosterIndexes?: number[],
): void {
  if (state.ruleset?.edition !== '11e' || !unitHasFightOnDeath(unit) || !modelPositions.length) return;
  const fighter = clone(unit);
  fighter.destroyed = false;
  fighter.remainingModels = modelPositions.length;
  fighter.modelPositions = modelPositions.map(position => ({ ...position }));
  fighter.position = centroid(fighter.modelPositions);
  fighter.modelRosterIndexes = modelRosterIndexes?.length
    ? [...modelRosterIndexes]
    : fighter.modelRosterIndexes?.slice(0, modelPositions.length);
  fighter.modelRotations = fighter.modelRotations?.slice(0, modelPositions.length);
  fighter.activated = false;
  fighter.pendingDamageAllocations = undefined;
  fighter.pendingCasualties = undefined;
  fighter.pendingWoundAssignment = undefined;
  state.pendingFightOnDeath = [
    ...(state.pendingFightOnDeath ?? []),
    {
      unit: fighter,
      side: unit.side,
      destroyedBySide,
      phase: state.phase,
      battleRound: battleRound(state),
    },
  ];
}

export function fightOnDeathTargetIds(
  state: BattleState,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): string[] {
  return manualCombat.fightOnDeathTargetIds(state, side, rules, manualFightResolutionContext);
}

export function fightOnDeathWeaponOptions(
  state: BattleState,
  side: Side,
  targetUnitId: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): Array<{ weaponIndex: number; name: string }> {
  return manualCombat.fightOnDeathWeaponOptions(state, side, targetUnitId, rules, manualFightResolutionContext);
}

export function fightOnDeathUnitWeapon(
  state: BattleState,
  side: Side,
  targetUnitId: string,
  weaponIndex: number,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.fightOnDeathUnitWeapon(state, side, targetUnitId, weaponIndex, rules, manualFightResolutionContext);
}

export function declineFightOnDeath(
  state: BattleState,
  side: Side,
  _rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return manualCombat.declineFightOnDeath(state, side, manualFightResolutionContext);
}

function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[] {
  return manualCombat.runFight(unit, state, rules, manualFightResolutionContext);
}

function runAutomaticFightForUnit(state: BattleState, unitId: string, rules: RulesEdition): BattleState {
  let s = state;
  const unit = s.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return s;
  if (playOverrunFightUnitIds(s, unit.side, rules).includes(unit.id)) {
    s = selectPlayOverrunFight(s, unit.id, unit.side, rules);
    const piled = pileInPlayUnit(s, unit.id, unit.side, rules);
    if (piled !== s) s = piled;
  }
  const selected = s.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!selected) return s;
  const fightLogs = runFight(selected, s, rules);
  if (fightLogs.length) s.log = [...s.log, ...fightLogs];
  return s;
}

function runAutomaticEleventhFightPhase(state: BattleState, startingSide: Side, rules: RulesEdition): BattleState {
  let s = state;
  for (const pileSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    for (const unit of activeUnits(s, pileSide)) {
      const piled = pileInPlayUnit(s, unit.id, pileSide, rules);
      if (piled !== s) s = piled;
    }
  }
  startFightStepInPlace(s, rules);

  let nextSide = startingSide;
  while (true) {
    const otherSide = (nextSide === 0 ? 1 : 0) as Side;
    const nextIds = playFightActivationUnitIds(s, nextSide, rules);
    const otherIds = playFightActivationUnitIds(s, otherSide, rules);
    const unitId = nextIds[0] ?? otherIds[0];
    if (!unitId) break;
    const selectedSide = nextIds.length ? nextSide : otherSide;
    s = runAutomaticFightForUnit(s, unitId, rules);
    if (!s.units.find(unit => unit.id === unitId)?.activated) break;
    nextSide = (selectedSide === 0 ? 1 : 0) as Side;
  }

  for (const unit of s.units.filter(candidate => candidate.activated && !candidate.destroyed)) {
    const consolidated = consolidatePlayUnit(s, unit.id, unit.side, rules);
    if (consolidated !== s) s = consolidated;
  }
  return s;
}

function bestLeadership(state: BattleState, unit: BattleUnit): number {
  return Math.min(...attachedUnitComponents(state, unit).flatMap(component => [
    component.profile.leadership,
    ...(component.profile.modelProfiles?.map(profile => profile.leadership) ?? []),
  ]));
}

function isBelowHalfStrength(state: BattleState, unit: BattleUnit): boolean {
  const startingStrength = attachedUnitComponents(state, unit, true)
    .reduce((total, component) => total + component.profile.baseModelCount, 0);
  if (startingStrength === 1) {
    return unit.woundsOnLeadModel <= unit.profile.wounds / 2;
  }

  return attachedUnitRemainingModels(state, unit) <= startingStrength / 2;
}

// ─── Victory check ────────────────────────────────────────────────────────────

function scorePrimaryMissionLogs(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const recordCount = s.missionState?.primaryMissionScoringRecords?.length ?? 0;
  const result = scorePrimaryMission(s, side, rules);
  const records = s.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
  return [...primaryMissionScoringLogs(s, records), ...unsupportedPrimaryMissionScoringLogs(s, [result])];
}

function scoreEndOfTurnPrimaryMissionLogs(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  const recordCount = s.missionState?.primaryMissionScoringRecords?.length ?? 0;
  const results = scorePrimaryMissionsAtEndOfTurn(s, side, rules);
  const records = s.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
  const logs = primaryMissionScoringLogs(s, records);
  return [...logs, ...unsupportedPrimaryMissionScoringLogs(s, results)];
}

function scoreEndOfBattlePrimaryMissionLogs(s: BattleState, rules: RulesEdition): LogEntry[] {
  const recordCount = s.missionState?.primaryMissionScoringRecords?.length ?? 0;
  const results = scorePrimaryMissionsAtEndOfBattle(s, rules);
  const records = s.missionState?.primaryMissionScoringRecords?.slice(recordCount) ?? [];
  const logs = primaryMissionScoringLogs(s, records);
  return [...logs, ...unsupportedPrimaryMissionScoringLogs(s, results)];
}

function scoreEndOfTurnSecondaryMissionLogs(s: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return secondaryMissionScoringLogs(s, scoreSecondaryMissionsAtEndOfTurn(s, side, rules));
}

function checkWinner(state: BattleState): void {
  const a0 = state.units.some(u => u.side === 0 && !u.destroyed);
  const a1 = state.units.some(u => u.side === 1 && !u.destroyed);
  if (!a0 && !a1) { state.winner = 'draw'; enterBattlePhase(state, { phase: 'end' }); }
  else if (!a0)   { state.winner = 1;      enterBattlePhase(state, { phase: 'end' }); }
  else if (!a1)   { state.winner = 0;      enterBattlePhase(state, { phase: 'end' }); }
}

// ─── Deep copy ────────────────────────────────────────────────────────────────

const TURN_PHASES: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];
const PLAY_MODEL_EDIT_PHASES: Phase[] = ['deployment', 'setup', 'movement'];

function enterBattlePhase(state: BattleState, phase: Parameters<typeof initializeBattlePhase>[1], side = state.activeArmy): void {
  const from = battlePhaseNode(state);
  const transition = nextBattlePhase(state);
  const isNormalAdvance = transition?.kind === 'phase'
    && transition.to.phase === phase.phase
    && (phase.phase !== 'movement' || (transition.to.phase === 'movement' && transition.to.step === phase.step));
  if (isNormalAdvance) advanceBattlePhase(state);
  else initializeBattlePhase(state, phase);
  recordBattleEvent(state, {
    type: phase.phase === 'movement' && from.phase === 'movement'
      ? BATTLE_EVENT_TYPE.StepStarted
      : BATTLE_EVENT_TYPE.PhaseStarted,
    side,
    source: state.armies[side]?.name,
    data: {
      from: from.phase,
      to: phase.phase,
      ...(phase.phase === 'movement' ? { step: phase.step } : {}),
    },
  });
}

export function movementStep(state: BattleState): MovementStep {
  return state.phase === 'movement' ? state.movementStep ?? 'moveUnits' : 'moveUnits';
}

function activeUnits(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(u => u.side === side && !u.destroyed && !u.embarkedInUnitId && !u.inStrategicReserves);
}

export function markRemainingStationaryUnits(state: BattleState, side: Side = state.activeArmy): void {
  for (const unit of activeUnits(state, side)) {
    if (isAircraft(unit)) continue;
    if (!unit.movementAction && !unit.fellBack) {
      unit.movementAction = 'remainedStationary';
      unit.movementAllowanceRemaining = 0;
      unit.movementAllowanceRemainingByModel = unit.modelPositions.map(() => 0);
      unit.movementAllowanceTotalByModel = unit.modelPositions.map(() => 0);
      unit.movementStartPositionsByModel = unit.modelPositions.map(position => ({ ...position }));
      unit.movementStartRotationsByModel = unit.modelPositions.map((_, modelIndex) => modelRotation(unit, modelIndex));
      unit.movementComplete = true;
    }
  }
}

function startCommandPhase(s: BattleState, rules: RulesEdition): LogEntry[] {
  return battleSimulation.startCommandPhase(s, rules, {
    activeUnits,
    startMissionEventsForNewTurn,
    clearFiringDeckWeapons,
    resetUnitForActiveTurn,
    enterBattlePhase,
    attachedUnitTargetRepresentative,
    isBelowHalfStrength,
    selectPunishmentUnits: autoSelectPunishmentCondemnedUnits,
    runAutomaticUnitAbilities,
    gainCommandPoints: gainCommandPhaseCommandPoints,
    phaseLog,
    log,
    battleRound,
    runBattleshock: runBattleshockPhase,
  });
}

function advanceTurnInPlace(s: BattleState): void {
  turnAdvance.advanceTurnInPlace(s, turnAdvanceContext);
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function makeBattleUnit(
  profile: UnitProfile,
  side: Side,
  modelPositions: Position[],
  attachedToUnitId?: string,
  tabletopUnitId?: string,
): BattleUnit {
  const id = `${side}_${_unitId++}`;
  return {
    id,
    attachedToUnitId,
    tabletopUnitId: tabletopUnitId ?? id,
    side,
    profile,
    remainingModels: profile.baseModelCount,
    woundsOnLeadModel: profile.wounds,
    position: centroid(modelPositions),
    modelPositions,
    modelRosterIndexes: Array.from({ length: profile.baseModelCount }, (_, modelIndex) => modelIndex),
    modelRotations: modelPositions.map(() => side === 0 ? 0 : 180),
    facingDeg: side === 0 ? 0 : 180,
    charged: false,
    movementAction: undefined,
    movementAllowanceRemaining: undefined,
    movementAllowanceRemainingByModel: undefined,
    movementAllowanceTotalByModel: undefined,
    movementStartPositionsByModel: undefined,
    movementStartRotationsByModel: undefined,
    fellBack: false,
    inCombat: false,
    battleshocked: false,
    activated: false,
    destroyed: false,
  };
}

function leaderAnchor(bodyguard: BattleUnit, leader: UnitProfile, leaderIndex: number, side: Side, deployment: DeploymentZoneSource = 'Default', board = boardFormatForId()): Position {
  const forward = side === 0 ? -1 : 1;
  const zone = zoneFor(side, deployment, board);
  const radius = modelBaseRadiusInches(leader);
  const offsetX = forward * (battleUnitMaxBaseRadiusInches(bodyguard) + radius + 0.4);
  const offsetY = (leaderIndex - 0.5) * 1.2;
  return interactiveMovementState.clampModelToBoard({
    x: bodyguard.position.x + offsetX,
    y: bodyguard.position.y + offsetY,
  }, radius, zone, board);
}

function removeUnitFromUnplaced(s: BattleState, side: Side, profile: UnitProfile): void {
  const key = unitRosterId(profile);
  s.unplacedUnits[side] = s.unplacedUnits[side].filter(unit => unitRosterId(unit) !== key);
}

function unitIsStagedReinforcement(unit: UnitProfile): boolean {
  return unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike
    || unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve;
}

function profileIsAircraft(profile: UnitProfile): boolean {
  return profile.keywords.some(keyword => keyword.toLowerCase() === 'aircraft');
}

function deployableProfilesForRules(army: ImportedArmy, rules: RulesEdition): UnitProfile[] {
  const profiles = deployableDrops(army);
  return rules.metadata.edition === '11e'
    ? profiles.filter(profile => !profileIsAircraft(profile))
    : profiles;
}

function add11eAircraftStrategicReserves(
  units: BattleUnit[],
  army: ImportedArmy,
  side: Side,
  board: ReturnType<typeof boardFormatForId>,
): void {
  if (!army.units.length) return;
  deployableDrops(army).filter(profileIsAircraft).forEach(profile => {
    const reservePosition = { x: side === 0 ? -100 : board.width + 100, y: board.height / 2 };
    const unit = makeBattleUnit(profile, side, Array.from({ length: profile.baseModelCount }, () => ({ ...reservePosition })));
    unit.inStrategicReserves = true;
    units.push(unit);
    attachedFollowersFor(army, profile).forEach(leader => {
      const leaderUnit = makeBattleUnit(leader, side, Array.from({ length: leader.baseModelCount }, () => ({ ...reservePosition })), unit.id, unit.tabletopUnitId);
      leaderUnit.inStrategicReserves = true;
      units.push(leaderUnit);
    });
  });
}

function disembarkPositions(
  state: BattleState,
  transport: BattleUnit,
  profile: UnitProfile,
  combatDisembark = false,
  rapidDisembark = false,
  emergencyDisembark = false,
): Position[] | null {
  return deploymentActions.disembarkPositions(state, transport, profile, transportDisembarkPlacementContext, combatDisembark, rapidDisembark, emergencyDisembark);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export { type DeploymentStrategy };

export function createBattleState(
  army1: ImportedArmy, color1: string, army2: ImportedArmy, color2: string, terrain: Terrain[],
  strategy1: DeploymentStrategy = 'balanced', strategy2: DeploymentStrategy = 'balanced', setup?: BattleState['setup'], objectivesOverride?: Position[], rules: RulesEdition = rules40K10th,
): BattleState {
  return deploymentActions.createBattleState(army1, color1, army2, color2, terrain, strategy1, strategy2, setup, objectivesOverride, rules, battleSetupContext);
}

export function createDeploymentState(
  army1: ImportedArmy, color1: string, army2: ImportedArmy, color2: string, terrain: Terrain[],
  strategy1: DeploymentStrategy = 'balanced', strategy2: DeploymentStrategy = 'balanced', setup?: BattleState['setup'], objectivesOverride?: Position[], rules: RulesEdition = rules40K10th,
): BattleState {
  return deploymentActions.createDeploymentState(army1, color1, army2, color2, terrain, strategy1, strategy2, setup, objectivesOverride, rules, battleSetupContext);
}

export function placeNextUnit(state: BattleState): BattleState {
  return deploymentActions.placeNextUnit(state, automatedDeploymentContext);
}

export function placePlayUnit(state: BattleState, side: Side, unitIndex: number, position: Position): BattleState {
  return deploymentActions.placePlayUnit(state, side, unitIndex, position, manualDeploymentContext);
}

export function placePlayReinforcement(state: BattleState, side: Side, armyUnitIndex: number, position: Position): BattleState {
  return reinforcementPlay.placePlayReinforcement(state, side, armyUnitIndex, position, reinforcementPlayContext);
}

export function placePlayStrategicReserveUnit(state: BattleState, side: Side, unitId: string, position: Position): BattleState {
  return reinforcementPlay.placePlayStrategicReserveUnit(state, side, unitId, position, reinforcementPlayContext);
}

export function playUnitCanEmbark(
  state: BattleState,
  unitId: string,
  side: Side,
  transportUnitId?: string,
): boolean {
  return deploymentActions.playUnitCanEmbark(state, unitId, side, transportEmbarkContext, transportUnitId);
}

export function embarkPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  transportUnitId?: string,
): BattleState {
  return deploymentActions.embarkPlayUnit(state, unitId, side, transportEmbarkContext, transportUnitId);
}

export type PlayDisembarkModes = deploymentActions.PlayDisembarkModes;

export function playDisembarkModes(
  state: BattleState,
  transportUnitId: string,
  passengerUnitId?: string,
  passengerProfile?: UnitProfile,
): PlayDisembarkModes {
  return deploymentActions.playDisembarkModes(state, transportUnitId, transportDisembarkContext, passengerUnitId, passengerProfile);
}

export function playUnitCanDisembark(
  state: BattleState,
  side: Side,
  transportUnitId: string,
  passengerUnitId?: string,
  armyUnitIndex?: number,
  combatDisembark?: boolean,
  rapidDisembark?: boolean,
): boolean {
  return deploymentActions.playUnitCanDisembark(state, side, transportUnitId, transportDisembarkContext, passengerUnitId, armyUnitIndex, combatDisembark, rapidDisembark);
}

export function disembarkPlayUnit(
  state: BattleState,
  side: Side,
  transportUnitId: string,
  passengerUnitId?: string,
  armyUnitIndex?: number,
  combatDisembark?: boolean,
  rapidDisembark?: boolean,
): BattleState {
  return deploymentActions.disembarkPlayUnit(state, side, transportUnitId, transportDisembarkContext, passengerUnitId, armyUnitIndex, combatDisembark, rapidDisembark);
}

export function playPhaseCoherencyIssues(state: BattleState): string[] {
  if (state.pendingSurgeMove) {
    const unitName = state.units.find(unit => unit.id === state.pendingSurgeMove?.unitId)?.profile.name ?? 'Unit';
    return [`Resolve ${unitName}'s triggered Surge Move before leaving the phase.`];
  }
  if (state.phase === 'command') {
    const options = punishmentCondemnedUnitOptions(state, state.activeArmy, rulesEditionForRuleset(state.ruleset));
    const selected = state.missionState?.condemnedUnitIds?.[state.activeArmy] ?? [];
    return options.length > 0 && selected.length === 0
      ? ['Select at least one enemy unit to condemn before leaving the Command phase.']
      : [];
  }
  if (state.phase !== 'movement') return [];
  return [
    ...battleCoherencyIssues(state, state.activeArmy),
    ...playMovementLegalityIssues(state, state.activeArmy),
  ];
}

export function movePlayModel(state: BattleState, unitId: string, modelIndex: number, position: Position): BattleState {
  return interactiveMovementState.moveModel(state, unitId, modelIndex, position, {
    clone,
    isModelEditPhase: phase => PLAY_MODEL_EDIT_PHASES.includes(phase),
    movementStep,
    modelBaseRadius,
    setupDeploymentZoneSource,
    canInfiltrate: profileDropHasInfiltrators,
    infiltratorPlacementIsLegal: (next, side, profile, candidate, index, deployment, board) =>
      modelIsOutsideEnemyDeploymentZoneBuffer(profile, side, candidate, index, deployment as DeploymentZoneSource, board),
    infiltratorModelsAreOutsideEnemyUnits,
    modelMoveHasNoBaseOverlap: interactiveMovementState.modelMoveHasNoBaseOverlap,
  });
}

function applyPlayModelTranslation(
  unit: BattleUnit,
  modelIndices: number[],
  dx: number,
  dy: number,
  board = boardFormatForId(),
): void {
  interactiveMovementState.applyHorizontalTranslation(unit, modelIndices, dx, dy, board);
}

function applyPlayModelVerticalTranslation(
  unit: BattleUnit,
  modelIndices: number[],
  dz: number,
): void {
  interactiveMovementState.applyVerticalTranslation(unit, modelIndices, dz);
}

function playMoveHasNoBaseOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  return interactiveMovementState.hasNoBaseOverlap(state, movingUnit, movingIndices);
}

function playMoveHasNoWallOverlap(state: BattleState, movingUnit: BattleUnit, movingIndices: Set<number>): boolean {
  return interactiveMovementState.hasNoWallOverlap(state, movingUnit, movingIndices, movementCollisionContext);
}

function playMoveHasNoEndCollision(
  state: BattleState,
  movingUnit: BattleUnit,
  movingIndices: Set<number>,
  allowEngagement = false,
): boolean {
  return interactiveMovementState.hasNoEndCollision(state, movingUnit, movingIndices, allowEngagement, movementCollisionContext);
}

const movementPathingContext: movementPathing.MovementPathingContext = {
  distance: dist,
  verticalDistance,
  modelBaseRadius,
  takesToSkies: unitTakesToSkiesForState,
  isAircraft,
  unitHasRule: (unit, rule) => unitHasRule(unit.profile, rule),
  unitHasKeyword: hasKeyword,
  terrainBlocksMovement: terrainMatBlocksMovementForUnit,
  featureBlocksMovement: featureBlocksMovementForUnit,
  pointInTerrain,
  linePassesThroughTerrain,
  terrainCorners,
};

const distancePointToSegment = (point: Position, from: Position, to: Position) =>
  movementPathing.distancePointToSegment(point, from, to, movementPathingContext);
const playMovePathCrossesEnemyModels = (state: BattleState, unit: BattleUnit, indices: Set<number>, dx: number, dy: number, includeFriendly = false) =>
  movementPathing.crossesEnemyModels(state, unit, indices, dx, dy, movementPathingContext, includeFriendly);
const playMoveEnemyCrossingModelIndices = (state: BattleState, unit: BattleUnit, indices: Set<number>, dx: number, dy: number) =>
  movementPathing.enemyCrossingModelIndices(state, unit, indices, dx, dy, movementPathingContext);
const playMovePathCrossesBlockingTerrain = (state: BattleState, unit: BattleUnit, indices: Set<number>, dx: number, dy: number) =>
  movementPathing.crossesBlockingTerrain(state, unit, indices, dx, dy, movementPathingContext);
const playMoveHasNoPathCollision = (state: BattleState, unit: BattleUnit, indices: Set<number>, dx: number, dy: number, options: { ignoreEnemyModelPath?: boolean } = {}) =>
  movementPathing.hasNoPathCollision(state, unit, indices, dx, dy, movementPathingContext, options);

const movementCollisionContext: interactiveMovementState.MovementCollisionContext = {
  clone,
  boardFormatForState,
  terrainBlocksMovement: terrainMatBlocksMovementForUnit,
  featureBlocksMovement: featureBlocksMovementForUnit,
  hasNoPathCollision: playMoveHasNoPathCollision,
  inEngagement: (state, unit) => inEngagement(unit, enemies(state, unit.side), rulesEditionForRuleset(state.ruleset).engagementRange()),
  enemies,
  engagementRange: state => rulesEditionForRuleset(state.ruleset).engagementRange(),
};

function translatedPlayMoveEndsInEngagement(
  state: BattleState,
  movingUnit: BattleUnit,
  modelIndices: number[],
  dx: number,
  dy: number,
): boolean {
  const test = clone(state);
  const testUnit = test.units.find(u => u.id === movingUnit.id && u.side === movingUnit.side && !u.destroyed);
  if (!testUnit) return false;
  applyPlayModelTranslation(testUnit, modelIndices, dx, dy, boardFormatForState(state));
  return inEngagement(testUnit, enemies(test, testUnit.side), rulesEditionForRuleset(test.ruleset).engagementRange());
}

function unitHasBaseOverlap(state: BattleState, unit: BattleUnit): boolean {
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const model = unit.modelPositions[modelIndex];
    const footprint = modelFootprint(unit, modelIndex);
    for (const otherUnit of state.units) {
      if (otherUnit.destroyed) continue;
      for (let otherModelIndex = 0; otherModelIndex < otherUnit.modelPositions.length; otherModelIndex++) {
        if (otherUnit.id === unit.id && otherModelIndex === modelIndex) continue;
        if (verticalDistance(model, otherUnit.modelPositions[otherModelIndex]) > 0.5) continue;
        const otherFootprint = modelFootprint(otherUnit, otherModelIndex);
        if (baseFootprintsOverlap(model, footprint, otherUnit.modelPositions[otherModelIndex], otherFootprint, 0.001)) return true;
      }
    }
  }
  return false;
}

function unitHasModelOutsideBattlefield(unit: BattleUnit, state: BattleState): boolean {
  const board = boardFormatForState(state);
  return unit.modelPositions.some((model, modelIndex) =>
    !baseFootprintWithinRect(model, modelFootprint(unit, modelIndex), { x: 0, y: 0, width: board.width, height: board.height }),
  );
}

const aircraftMovementContext: aircraftMovement.AircraftMovementContext = {
  isAircraft,
  modelRotation,
  movementDistanceFromStart: (unit, modelIndex) => modelMovementDistanceFromStart(unit, modelIndex),
  cancelUnitAction,
  recordUnitLeftBattlefield: recordUnitLeftBattlefieldMissionEvent,
  createLog: (state, side, actor, message) => log(state, side, actor, message, 'move'),
};

const aircraftMoveIsStraightForward = (unit: BattleUnit, modelIndices: number[], dx: number, dy: number) =>
  aircraftMovement.moveIsStraightForward(unit, modelIndices, dx, dy, aircraftMovementContext);
const aircraftMovedMinimumDistance = (unit: BattleUnit) =>
  aircraftMovement.movedMinimumDistance(unit, aircraftMovementContext);
const aircraftPivotWithinLimit = (unit: BattleUnit, modelIndices: number[]) =>
  aircraftMovement.pivotWithinLimit(unit, modelIndices, aircraftMovementContext);
const moveAircraftToStrategicReserves = (state: BattleState, unit: BattleUnit) =>
  aircraftMovement.moveToStrategicReserves(state, unit, aircraftMovementContext);

export function returnOpponentAircraftToStrategicReserves(state: BattleState, activeSide: Side, rules: RulesEdition): void {
  aircraftMovement.returnOpponentAircraftToStrategicReserves(state, activeSide, rules, aircraftMovementContext);
}

function unitHasWallOverlap(state: BattleState, unit: BattleUnit): boolean {
  return !playMoveHasNoWallOverlap(state, unit, new Set(unit.modelPositions.map((_, modelIndex) => modelIndex)));
}

const movementLegalityContext: movementLegality.MovementLegalityContext = {
  isAircraft,
  aircraftCanMakeNormalMove,
  rulesForState: state => rulesEditionForRuleset(state.ruleset),
  movementDistanceRequirementMet: aircraftMovedMinimumDistance,
  unitTakesToSkies: unitTakesToSkiesForState,
  modelBaseRadius,
  verticalDistance,
  distance: dist,
  distancePointToSegment,
  terrainBlocksMovement: terrainMatBlocksMovementForUnit,
  featureBlocksMovement: featureBlocksMovementForUnit,
  lineIntersectsTerrain,
  hasAnyKeyword,
  unitHasModelOutsideBattlefield: (state, unit) => unitHasModelOutsideBattlefield(unit, state),
  unitHasBaseOverlap,
  unitHasWallOverlap,
  inEngagement,
  enemies,
};

const playMovementUnitLegalityIssues = (state: BattleState, unit: BattleUnit): string[] =>
  movementLegality.unitIssues(state, unit, movementLegalityContext);
const playMovementLegalityIssues = (state: BattleState, side: Side): string[] =>
  movementLegality.issues(state, side, movementLegalityContext);

function collisionAdjustedPlayMove(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dx: number,
  dy: number,
  options: { allowEngagement?: boolean; ignoreEnemyModelPath?: boolean } = {},
): { dx: number; dy: number } {
  return interactiveMovementState.collisionAdjustedMove(state, unitId, side, modelIndices, dx, dy, options, movementCollisionContext);
}

function movementAllowanceForPlayMove(unit: BattleUnit): number {
  if (unit.movementAllowanceTotalByModel?.length) {
    return Math.max(...unit.movementAllowanceTotalByModel);
  }
  if (unit.movementAction === 'advanced') {
    return unit.movementAllowanceRemaining ?? normalMoveAllowance(unit);
  }
  return Math.max(0, normalMoveAllowance(unit) - takeToSkiesDistanceCost(unit));
}

function firingDeckPassengerProfiles(state: BattleState, transport: BattleUnit): UnitProfile[] {
  const staged = state.armies[transport.side].army.units.filter(profile => deploymentActions.unitAssignedToTransport(profile, transport, transportDisembarkPlacementContext));
  const live = transportPassengers(state, transport.id).map(unit => unit.profile);
  const seen = new Set<string>();
  return [...live, ...staged].filter(profile => {
    const id = unitRosterId(profile);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export type FiringDeckSelection = firingDeck.FiringDeckSelection;

const firingDeckContext: firingDeck.FiringDeckContext = {
  clone,
  isTransport: unit => unitHasKeyword(unit, 'Transport'),
  passengerProfiles: firingDeckPassengerProfiles,
  createLog: (state, side, actor, message) => log(state, side, actor, message, 'shoot'),
};

export function playFiringDeckCapacity(unit: BattleUnit): number {
  return firingDeck.capacity(unit);
}

export function playFiringDeckOptions(state: BattleState, transportUnitId: string, side: Side): FiringDeckSelection[] {
  return firingDeck.options(state, transportUnitId, side, firingDeckContext);
}

const strategicReservePlacementContext: StrategicReservePlacementContext = {
  battleRound,
  modelIsInOpponentDeploymentZone: (state, unit, modelIndex) => {
    const zone = zoneFor((1 - unit.side) as Side, setupDeploymentZoneSource(state.setup), boardFormatForState(state));
    return pointInDeploymentZone(unit.modelPositions[modelIndex], zone, modelBaseRadius(unit, modelIndex));
  },
};
const strategicReservePlacementIsOutsideOpponentDeploymentZone = (unit: BattleUnit, state: BattleState): boolean =>
  isStrategicReservePlacementOutsideOpponentDeploymentZone(state, unit, strategicReservePlacementContext);

const transportDisembarkPlacementContext: deploymentActions.TransportDisembarkPlacementContext = {
  enemies,
  engagedEnemies: (state, unit) => engagedEnemies(state, unit, rulesEditionForRuleset(state.ruleset)),
  gridFormation: interactiveMovementState.gridFormation,
  makeBattleUnit,
  inEngagement: (state, unit, targets) => inEngagement(unit, targets, rulesEditionForRuleset(state.ruleset).engagementRange()),
  hasNoBaseOverlap: playMoveHasNoBaseOverlap,
  hasNoWallOverlap: playMoveHasNoWallOverlap,
  rapidPlacementIsLegal: (state, transport, profile, positions, unit) => reinforcementPlacementIsOutsideEnemyRange(state, transport.side, profile, positions)
    && reinforcementPlacementIsWithinStrategicReserveEdge(unit, state) && strategicReservePlacementIsOutsideOpponentDeploymentZone(unit, state),
  unitRosterId,
};

const transportDisembarkContext: deploymentActions.TransportDisembarkContext = {
  ...transportDisembarkPlacementContext,
  movementStep,
  clone,
  normalMoveAllowance,
  centroid,
  modelRotation,
  resolveCombatDisembarkHazards,
  log,
};

const manualDeploymentContext: deploymentActions.ManualDeploymentContext = {
  clone,
  boardFormatForState,
  setupDeploymentZoneSource,
  canInfiltrate: profileDropHasInfiltrators,
  infiltratorPlacementIsLegal: (state, side, profile, positions, deployment, board) =>
    positions.every((position, modelIndex) => modelIsOutsideEnemyDeploymentZoneBuffer(profile, side, position, modelIndex, deployment, board))
      && infiltratorModelsAreOutsideEnemyUnits(state, side, profile, positions),
  gridFormation: interactiveMovementState.gridFormation,
  makeBattleUnit,
  attachedFollowers: attachedFollowersFor,
  leaderAnchor,
  resolveInternalModelOverlaps: interactiveMovementState.resolveInternalModelOverlaps,
  avoidDeploymentOverlap: interactiveMovementState.avoidDeploymentOverlap,
  removeUnitFromUnplaced,
  log,
};

const automatedDeploymentContext: deploymentActions.AutomatedDeploymentContext = {
  ...manualDeploymentContext,
  deployableProfiles: (army, edition) => edition === '11e'
    ? deployableDrops(army).filter(profile => !profileIsAircraft(profile))
    : deployableDrops(army),
  selectUnitToDrop,
  reactivePosition,
  deployModelFormation,
  profileModelRadii: interactiveMovementState.profileModelRadii,
  maxModelBaseRadius,
  modelBaseRadius,
  enterSetup: (state, side) => enterBattlePhase(state, { phase: 'setup' }, side),
};

const battleSetupContext: deploymentActions.BattleSetupContext = {
  ...automatedDeploymentContext,
  reset: () => {
    resetBattleLogSequence();
    _unitId = 0;
  },
  boardFormatForId,
  rulesetMetadata: rules => rulesetMetadataForState(rules as RulesEdition),
  defaultObjectives: DEFAULT_OBJECTIVES,
  addAircraftStrategicReserves: add11eAircraftStrategicReserves,
};

const reinforcementPlayContext: reinforcementPlay.PlayReinforcementContext = {
  movementStep,
  clone,
  makeBattleUnit,
  gridFormation: interactiveMovementState.gridFormation,
  resolveInternalModelOverlaps: (unit, board) => interactiveMovementState.resolveInternalModelOverlaps(unit, undefined, board),
  hasNoBaseOverlap: playMoveHasNoBaseOverlap,
  hasNoWallOverlap: playMoveHasNoWallOverlap,
  isAircraft,
  centroid,
  battleRound,
  modelIsInOpponentDeploymentZone: strategicReservePlacementContext.modelIsInOpponentDeploymentZone,
  log,
};

export function selectPlayFiringDeckWeapons(
  state: BattleState,
  transportUnitId: string,
  side: Side,
  selections: FiringDeckSelection[],
): BattleState {
  return firingDeck.select(state, transportUnitId, side, selections, firingDeckContext);
}

function autoSelectFiringDeckInPlace(state: BattleState, transport: BattleUnit): void {
  firingDeck.autoSelectInPlace(state, transport, firingDeckContext);
}

function clearFiringDeckWeapons(unit: BattleUnit): void {
  firingDeck.clearWeapons(unit);
}

function unitHasStartedCurrentMove(unit: BattleUnit): boolean {
  return !!unit.movementStartPositionsByModel?.some((start, modelIndex) => {
    const current = unit.modelPositions[modelIndex];
    return current && (dist(start, current) > 0.001 || verticalDistance(start, current) > 0.001);
  });
}

const takeToSkiesContext: interactiveMovementState.TakeToSkiesContext = {
  clone,
  getUnit: (state, unitId, side) => state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId),
  attachedComponents: attachedUnitComponents,
  isAircraft,
  unitSurgedThisPhase,
  hasFlyKeyword: (state, unit) => attachedUnitKeywordSet(state, unit).has('fly'),
  movementCanBegin: (state, side) => state.activeArmy === side && movementStep(state) === 'moveUnits',
  chargeCanBegin: (state, side, unit) => manualCombat.sideCanDeclareCharge(state, side, unit) && manualCombat.unitCanDeclareCharge(state, unit, chargeRulesContext),
  unitHasStartedCurrentMove,
  unitHasHover: unit => unitHasRule(unit.profile, 'Hover'),
  updateMovementAllowances: unit => updateModelMovementAllowances(unit),
  createLog: (state, side, actor, message) => { state.log = [...state.log, log(state, side, actor, message, 'move')]; },
};

export const playUnitCanTakeToSkies = (
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean => interactiveMovementState.canDeclareTakeToSkies(state, unitId, side, rules, takeToSkiesContext);

export const declarePlayUnitTakeToSkies = (
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState => interactiveMovementState.declareTakeToSkies(state, unitId, side, rules, takeToSkiesContext);

const scoutMoveContext: interactiveMovementState.ScoutMoveContext = {
  clone,
  attachedComponents: attachedUnitComponents,
  componentsAreWithinDeploymentZone: (state, components, side) => {
    const zone = zoneFor(side, setupDeploymentZoneSource(state.setup), boardFormatForState(state));
    return components.every(component => component.modelPositions.every((position, modelIndex) =>
      pointInDeploymentZone(position, zone, modelBaseRadius(component, modelIndex)),
    ));
  },
  componentsAreTooCloseToEnemy: (state, components, side) => {
    const enemyUnits = state.units.filter(candidate => candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId && !candidate.inStrategicReserves);
    return components.some(component => component.modelPositions.some((position, modelIndex) =>
      enemyUnits.some(enemy => enemy.modelPositions.some((enemyPosition, enemyModelIndex) =>
        baseFootprintDistance(position, modelFootprint(component, modelIndex), enemyPosition, modelFootprint(enemy, enemyModelIndex)) <= 8,
      )),
    ));
  },
  componentsHaveMoveCollision: (state, components) => components.some(component => {
    const moving = new Set(component.modelPositions.map((_, index) => index));
    return !playMoveHasNoBaseOverlap(state, component, moving) || !playMoveHasNoWallOverlap(state, component, moving);
  }),
  componentsAreCoherent: (state, components) => coherencyModelLists(state)
    .filter(list => list.models.some(model => components.some(component => component.id === model.unit.id)))
    .every(list => modelListIsCoherent(list.models, coherencyEditionForState(state))),
  modelRotation,
  createLog: (state, side, actor, message) => { state.log = [...state.log, log(state, side, actor, message, 'move')]; },
};

export const playScoutMoveAllowance = (state: BattleState, unitId: string, side: Side): number | null =>
  interactiveMovementState.scoutMoveAllowance(state, unitId, side, scoutMoveContext);
export const startPlayScoutMove = (state: BattleState, unitId: string, side: Side): BattleState =>
  interactiveMovementState.startScoutMove(state, unitId, side, scoutMoveContext);
export const completePlayScoutMove = (state: BattleState, unitId: string, side: Side): BattleState =>
  interactiveMovementState.completeScoutMove(state, unitId, side, scoutMoveContext);

function moveSurgeComponentTowardTarget(
  state: BattleState, component: BattleUnit, target: BattleUnit, maximumDistance: number, rules: RulesEdition,
): void {
  const distance = dist(component.position, target.position);
  const direction = distance > 0.001
    ? { x: (target.position.x - component.position.x) / distance, y: (target.position.y - component.position.y) / distance }
    : { x: 1, y: 0 };
  const stopGap = rules.engagementRange()
    + formationExtent(component.modelPositions, component.position, direction)
    + formationExtent(target.modelPositions, target.position, { x: -direction.x, y: -direction.y }) + 0.02;
  const reachable = findReachablePosition(component, target.position, maximumDistance, state.terrain, stopGap);
  const candidate = interactiveMovementState.avoidModelOverlap(component, reachable, state);
  translateFormation(component, candidate.x - component.position.x, candidate.y - component.position.y);
  interactiveMovementState.resolveInternalModelOverlaps(component);
  component.position = centroid(component.modelPositions);
}

const surgeMoveContext: interactiveMovementState.SurgeMoveContext = {
  clone,
  getUnit: (state, unitId, side) => state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId),
  enemies,
  attachedComponents: attachedUnitComponents,
  attachedUnitId,
  attachedUnitHasFly: (state, unit) => attachedUnitKeywordSet(state, unit).has('fly'),
  isAircraft,
  unitDistance: battleUnitToAttachedUnitDistance,
  unitMovedThisPhase,
  unitHasStartedCurrentMove,
  inEngagement,
  moveTowardTarget: moveSurgeComponentTowardTarget,
  unitHasCollision: (state, unit) => unitHasBaseOverlap(state, unit) || unitHasWallOverlap(state, unit),
  battleHasCoherencyIssues: (state, side) => battleCoherencyIssues(state, side).length > 0,
  cancelUnitAction,
  createLog: (state, side, actor, message) => { state.log = [...state.log, log(state, side, actor, message, 'move')]; },
};

export const playSurgeTargetUnitIds = (state: BattleState, unitId: string, side: Side): string[] =>
  interactiveMovementState.surgeMoveTargetUnitIds(state, unitId, side, surgeMoveContext);
export const grantPlaySurgeMove = (
  state: BattleState, unitId: string, side: Side, maximumDistance: number, source: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState => interactiveMovementState.grantSurgeMove(state, unitId, side, maximumDistance, source, rules, surgeMoveContext);
export const resolvePlaySurgeMove = (
  state: BattleState, unitId: string, side: Side, targetUnitId: string,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState => interactiveMovementState.resolveSurgeMove(state, unitId, side, targetUnitId, rules, surgeMoveContext);

const interactiveMovementStateContext: interactiveMovementState.InteractiveMovementStateContext = {
  modelRotation,
  modelFootprint,
  movementAllowanceForPlayMove,
  hasKeyword,
  verticalDistance,
  baseFootprintMaxPointDistance,
};

const ensureModelMovementStartPositions = interactiveMovementState.ensureModelMovementStartPositions;
const ensureModelMovementStartRotations = (unit: BattleUnit) => interactiveMovementState.ensureModelMovementStartRotations(unit, interactiveMovementStateContext);
const ensureModelMovementPaths = interactiveMovementState.ensureModelMovementPaths;
const appendModelMovementWaypoints = interactiveMovementState.appendModelMovementWaypoints;
const ensureModelMovementAllowanceTotals = (unit: BattleUnit) => interactiveMovementState.ensureModelMovementAllowanceTotals(unit, interactiveMovementStateContext);
const modelMovementDistanceFromStart = (unit: BattleUnit, modelIndex: number) => interactiveMovementState.modelMovementDistanceFromStart(unit, modelIndex, interactiveMovementStateContext);
const refreshModelMovementAllowances = (unit: BattleUnit) => interactiveMovementState.refreshModelMovementAllowances(unit, interactiveMovementStateContext);
const updateModelMovementAllowances = (unit: BattleUnit) => interactiveMovementState.updateModelMovementAllowances(unit, interactiveMovementStateContext);

function playMovementGroupId(unit: BattleUnit): string {
  return unit.tabletopUnitId ?? unit.id;
}

const movementGroupContext: interactiveMovementState.MovementGroupContext = {
  groupId: playMovementGroupId,
  removeOpponentMarkersAfterMove: removeOpponentOperationMarkersAfterMove,
};
const lockOtherMovedPlayUnits = (state: BattleState, currentUnit: BattleUnit): void =>
  interactiveMovementState.lockOtherMovedUnits(state, currentUnit, movementGroupContext);
const markPlayMovementGroupComplete = (state: BattleState, currentUnit: BattleUnit): void =>
  interactiveMovementState.markMovementGroupComplete(state, currentUnit, movementGroupContext);

const modelMovementContext: interactiveMovementState.ModelMovementContext = {
  clone,
  isModelEditPhase: phase => PLAY_MODEL_EDIT_PHASES.includes(phase),
  movementStep,
  isSurgedThisPhase: unitSurgedThisPhase,
  isAircraft,
  aircraftCanMakeNormalMove: state => aircraftCanMakeNormalMove(rulesEditionForRuleset(state.ruleset)),
  nonAircraftEngagedEnemies: (state, unit) => nonAircraftEngagedEnemies(state, unit, rulesEditionForRuleset(state.ruleset)),
  ensureMovementStartPositions: ensureModelMovementStartPositions,
  ensureMovementStartRotations: ensureModelMovementStartRotations,
  ensureMovementAllowanceTotals: ensureModelMovementAllowanceTotals,
  ensureMovementPaths: ensureModelMovementPaths,
  aircraftMoveIsStraightForward: aircraftMoveIsStraightForward,
  budgetAdjustedMove: (unit, indices, dx, dy) => interactiveMovementState.budgetAdjustedMove(unit, indices, dx, dy, {
    ensureMovementStartPositions: ensureModelMovementStartPositions,
    ensureMovementStartRotations: ensureModelMovementStartRotations,
    ensureMovementAllowanceTotals: ensureModelMovementAllowanceTotals,
    modelMovementDistanceFromStart,
    modelRotation,
    hasKeyword,
  }),
  translatedMoveEndsInEngagement: translatedPlayMoveEndsInEngagement,
  collisionAdjustedMove: (state, unitId, side, indices, dx, dy, allowEngagement) =>
    collisionAdjustedPlayMove(state, unitId, side, indices, dx, dy, { allowEngagement }),
  unitHasModelOutsideBattlefield,
  moveAircraftToStrategicReserves,
  applyHorizontalTranslation: (unit, indices, dx, dy, state) => applyPlayModelTranslation(unit, indices, dx, dy, boardFormatForState(state)),
  applyVerticalTranslation: applyPlayModelVerticalTranslation,
  appendMovementWaypoints: appendModelMovementWaypoints,
  cancelUnitAction,
  inEngagement: (state, unit) => inEngagement(unit, enemies(state, unit.side), rulesEditionForRuleset(state.ruleset).engagementRange()),
  lockOtherMovedUnits: lockOtherMovedPlayUnits,
  updateMovementAllowances: updateModelMovementAllowances,
  modelMovementDistanceFromStart,
  attachedComponents: attachedUnitComponents,
  centroid,
};

const advanceMovementContext: interactiveMovementState.AdvanceMovementContext = {
  clone,
  movementStep,
  isAircraft,
  nonAircraftEngagedEnemies: (state, unit) => nonAircraftEngagedEnemies(state, unit, rulesEditionForRuleset(state.ruleset)),
  lockOtherMovedUnits: lockOtherMovedPlayUnits,
  cancelUnitAction,
  advanceAllowance,
  normalMoveAllowance,
  takeToSkiesDistanceCost,
  attachedComponents: attachedUnitComponents,
  modelRotation,
  createLog: (state, side, actor, message) => { state.log = [...state.log, log(state, side, actor, message, 'move')]; },
};

export function movePlayModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dx: number,
  dy: number,
  collide = false,
): BattleState {
  return interactiveMovementState.moveModels(state, unitId, side, modelIndices, dx, dy, collide, modelMovementContext);
}

export function movePlayModelsVertically(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  dz: number,
): BattleState {
  return interactiveMovementState.moveModelsVertically(state, unitId, side, modelIndices, dz, modelMovementContext);
}

export function undoPlayUnitMovement(state: BattleState, unitId: string, side: Side): BattleState {
  return interactiveMovementState.undoUnitMovement(state, unitId, side, modelMovementContext);
}

const coherencyModelRemovalContext: interactiveMovementState.CoherencyModelRemovalContext = {
  clone,
  movementStep,
  recordDestroyedModels: recordDestroyedModelMissionEvents,
  spliceModelIndices,
  recordDestroyedUnit: recordDestroyedUnitMissionEvent,
  centroid,
  createLog: log,
};

export function removePlayModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
): BattleState {
  return interactiveMovementState.removeModelsForCoherency(state, unitId, side, modelIndices, coherencyModelRemovalContext);
}

const manualDamageAllocationContext: manualCombat.ManualDamageAllocationContext = {
  clone,
  queueDeadlyDemiseForModels,
  recordDestroyedModelMissionEvents,
  spliceModelIndices,
  queueFightOnDeathWindow,
  markUnitDestroyed,
  recordDestroyedUnitMissionEvent,
  emergencyDisembarkDestroyedTransport,
  centroid,
  log,
  resolvePendingDeadlyDemisesInPlace,
  applyFeelNoPain,
  recordBattleEvent,
  BATTLE_EVENT_TYPE,
  resolveDamageOutcome,
};

export function removePlayCasualtyModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
): BattleState {
  return manualCombat.removePlayCasualtyModels(state, unitId, side, modelIndices, manualDamageAllocationContext);
}

export function assignPlayWoundedModel(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndex: number,
): BattleState {
  return manualCombat.assignPlayWoundedModel(state, unitId, side, modelIndex, manualDamageAllocationContext);
}

export function allocatePlayDamageToModel(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndex: number,
): BattleState {
  return manualCombat.allocatePlayDamageToModel(state, unitId, side, modelIndex, manualDamageAllocationContext);
}

export function playUnitCanFallBack(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  return interactiveMovementState.canFallBack(state, unitId, side, advanceMovementContext);
}

export function playUnitCanAdvance(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): boolean {
  return interactiveMovementState.canAdvance(state, unitId, side, advanceMovementContext);

}

export function declarePlaySuperHeavyMobile(state: BattleState, unitId: string, side: Side): BattleState {
  return interactiveMovementState.declareSuperHeavyMobile(state, unitId, side, {
    clone,
    movementStep,
    attachedComponents: attachedUnitComponents,
    hasRule: (unit, rule) => unitHasRule(unit.profile, rule),
    log,
  });
}

function resolveSuperHeavyMobileInPlace(state: BattleState, unit: BattleUnit): void {
  const components = attachedUnitComponents(state, unit);
  if (!components.some(component => component.superHeavyMobile)) return;
  const roll = d6();
  if (roll === 1) components.forEach(component => { component.battleshocked = true; });
  components.forEach(component => { component.superHeavyMobile = undefined; });
  state.log = [...state.log, log(state, unit.side, unit.profile.name,
    `${unit.profile.name} resolves MOBILE: rolled ${roll}${roll === 1 ? ' and is Battle-shocked.' : '.'}`, roll === 1 ? 'damage' : 'move')];
}

const fallBackMovementContext: interactiveMovementState.FallBackMovementContext = {
  advanceContext: advanceMovementContext,
  clone,
  engagedEnemies,
  nearest,
  distance: dist,
  takeToSkiesDistanceCost,
  collisionAdjustedMove: (state, unitId, side, modelIndices, dx, dy) =>
    collisionAdjustedPlayMove(state, unitId, side, modelIndices, dx, dy, { ignoreEnemyModelPath: true }),
  enemyCrossingModelIndices: playMoveEnemyCrossingModelIndices,
  applyHorizontalTranslation: (unit, indices, dx, dy, state) => applyPlayModelTranslation(unit, indices, dx, dy, boardFormatForState(state)),
  cancelUnitAction,
  inEngagement: (state, unit, rules) => inEngagement(unit, enemies(state, unit.side), rules.engagementRange()),
  modelRotation,
  attachedComponents: attachedUnitComponents,
  lockOtherMovedUnits: lockOtherMovedPlayUnits,
  removeOpponentOperationMarkersAfterMove,
  resolveDesperateEscape: (state, unit, modelIndices, onModelsDestroyed) => resolveDesperateEscapeTests(
    state,
    unit,
    (testedUnit, message) => log(state, testedUnit.side, testedUnit.profile.name, message, 'roll'),
    modelIndices,
    onModelsDestroyed,
  ),
  bestLeadership,
  d6,
  resolveSuperHeavyMobile: resolveSuperHeavyMobileInPlace,
  recordDestroyedModels: recordDestroyedModelMissionEvents,
  recordDestroyedUnit: recordDestroyedUnitMissionEvent,
  centroid,
  createLog: log,
};

const completeMovementContext: interactiveMovementState.CompleteMovementContext = {
  clone,
  movementStep,
  unitLegalityIssues: playMovementUnitLegalityIssues,
  markMovementGroupComplete: markPlayMovementGroupComplete,
  resolveSuperHeavyMobile: resolveSuperHeavyMobileInPlace,
};

export function advancePlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return interactiveMovementState.advanceUnit(state, unitId, side, rules, advanceMovementContext);

}

export function fallBackPlayUnit(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition = rulesEditionForRuleset(state.ruleset),
): BattleState {
  return interactiveMovementState.fallBackUnit(state, unitId, side, rules, fallBackMovementContext);
}

export function completePlayUnitMovement(
  state: BattleState,
  unitId: string,
  side: Side,
): BattleState {
  return interactiveMovementState.completeUnitMovement(state, unitId, side, completeMovementContext);
}

export function undeployPlayUnit(state: BattleState, unitId: string, side: Side): BattleState {
  return deploymentActions.undeployPlayUnit(state, unitId, side, {
    clone,
    unitRosterId,
    unitMatchesAttachmentTarget,
    attachedLeaders: attachedLeadersFor,
    isAttachedLeaderDrop,
    log,
  });
}

const formationEditContext: interactiveMovementState.FormationEditContext = {
  clone,
  isModelEditPhase: phase => PLAY_MODEL_EDIT_PHASES.includes(phase),
  movementStep,
  centroid,
  gridFormation: (unit, center, side, rows, modelIndices) => interactiveMovementState.gridFormationByRows(unit.profile, center, side, rows, modelIndices),
  isAircraft,
  aircraftCanMakeNormalMove: state => aircraftCanMakeNormalMove(rulesEditionForRuleset(state.ruleset)),
  ensureMovementStartPositions: ensureModelMovementStartPositions,
  ensureMovementStartRotations: ensureModelMovementStartRotations,
  ensureMovementAllowanceTotals: ensureModelMovementAllowanceTotals,
  modelRotation,
  aircraftPivotWithinLimit,
  movementDistanceFromStart: modelMovementDistanceFromStart,
  lockOtherMovedUnits: lockOtherMovedPlayUnits,
  updateMovementAllowances: updateModelMovementAllowances,
};

export function reorganizePlayUnitGrid(state: BattleState, unitId: string, side: Side, rows: number): BattleState {
  return interactiveMovementState.reorganizeUnitGrid(state, unitId, side, rows, formationEditContext);
}

export function reorganizePlayModelsGrid(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  rows: number,
): BattleState {
  return interactiveMovementState.reorganizeModelsGrid(state, unitId, side, modelIndices, rows, formationEditContext);
}

export function rotatePlayModels(
  state: BattleState,
  unitId: string,
  side: Side,
  modelIndices: number[],
  degrees: number,
): BattleState {
  return interactiveMovementState.rotateModels(state, unitId, side, modelIndices, degrees, formationEditContext);
}

const deploymentLegalityContext: deploymentActions.DeploymentLegalityContext = {
  coherencyLists: coherencyModelLists,
  isCoherent: (models, state) => modelListIsCoherent(models as CoherencyModel[], coherencyEditionForState(state)),
  unitHasBaseOverlap,
  boardFormatForState,
  setupDeploymentZoneSource,
  canInfiltrate: profileDropHasInfiltrators,
  infiltratorPlacementIsLegal: (state, side, profile, positions, deployment, board) =>
    positions.every((position, modelIndex) => modelIsOutsideEnemyDeploymentZoneBuffer(profile, side, position, modelIndex, deployment, board))
      && infiltratorModelsAreOutsideEnemyUnits(state, side, profile, positions),
  modelBaseRadius,
  unitHasWallOverlap,
};

export function playDeploymentIssues(state: BattleState): string[] {
  return deploymentActions.deploymentIssues(state, deploymentLegalityContext);
}

const deploymentStartContext: deploymentActions.DeploymentStartContext = {
  clone,
  deploymentIssues: playDeploymentIssues,
  enterSetup: (state, side) => enterBattlePhase(state, { phase: 'setup' }, side),
  log,
};

export function beginPlayBattle(state: BattleState): BattleState {
  return deploymentActions.beginPlayBattle(state, deploymentStartContext);
}

const simulationSelectionContext: battleSimulation.SimulationSelectionContext = {
  movementStep,
  activeUnits,
  fightActivationUnitIds: playFightActivationUnitIds,
};

const simulationPhaseContext: battleSimulation.SimulationPhaseContext = {
  ...simulationSelectionContext,
  clone,
  runMovement,
  runCharge,
  runFight,
  checkWinner,
  turnPhases: TURN_PHASES,
  startCommandPhase,
  scorePrimaryMissionLogs,
  runAutomaticUnitAbilities,
  enterBattlePhase,
  movementLegalityIssues: playMovementLegalityIssues,
  markRemainingStationaryUnits,
  phaseLog,
  log,
  runShootingPhaseUnits,
  startFightStep: startFightStepInPlace,
  consecrateObjectiveOptions,
  consecrateObjective,
  completeEndOfTurnActions,
  scoreEndOfTurnSecondaryMissionLogs,
  scoreEndOfTurnPrimaryMissionLogs,
  returnOpponentAircraftToStrategicReserves,
  advanceTurnInPlace,
  scoreEndOfBattlePrimaryMissionLogs,
  updateObjectiveControl,
  runAutomaticEleventhFightPhase,
};

export function simulateNextPhase(state: BattleState, rules: RulesEdition): BattleState {
  return battleSimulation.simulateNextPhase(state, rules, simulationPhaseContext);
}

function resetSimulationUnitActivations(state: BattleState, side: Side): void {
  battleSimulation.resetUnitActivations(state, side, simulationSelectionContext);
}

export function simulationNextUnitId(state: BattleState, rules: RulesEdition): string | undefined {
  return battleSimulation.nextUnitId(state, rules, simulationSelectionContext);
}

function advanceSimulationUnitPhase(state: BattleState, rules: RulesEdition): BattleState {
  return battleSimulation.advancePhase(state, rules, 'unit-step', simulationPhaseContext);
}

const simulationUnitStepContext: battleSimulation.SimulationUnitStepContext = {
  ...simulationSelectionContext,
  clone,
  runMovement,
  runShooting,
  runCharge,
  runFight,
  runEleventhFight: runAutomaticFightForUnit,
  checkWinner,
  advancePhase: advanceSimulationUnitPhase,
};

export function simulateNextUnit(state: BattleState, rules: RulesEdition): BattleState {
  return battleSimulation.simulateNextUnit(state, rules, simulationUnitStepContext);
}

const automaticCommandPhaseContext: battleSimulation.AutomaticCommandPhaseContext = {
  enterBattlePhase,
  selectPunishmentUnits: autoSelectPunishmentCondemnedUnits,
  gainCommandPoints: gainCommandPhaseCommandPoints,
  phaseLog,
  log,
  battleRound,
  runBattleshock: runBattleshockPhase,
  scorePrimaryMissionLogs,
  runAutomaticUnitAbilities,
};

function runSimulatedCommandPhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return battleSimulation.runAutomaticCommandPhase(state, side, rules, automaticCommandPhaseContext);
}

const automaticMovementPhaseContext: battleSimulation.AutomaticMovementPhaseContext = {
  enterBattlePhase,
  phaseLog,
  runMovement,
  markRemainingStationaryUnits,
  updateObjectiveControl,
};

function runSimulatedMovementPhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return battleSimulation.runAutomaticMovementPhase(state, side, rules, automaticMovementPhaseContext);
}

const automaticShootingPhaseContext: battleSimulation.AutomaticShootingPhaseContext = {
  enterBattlePhase,
  phaseLog,
  runShootingPhaseUnits,
  updateObjectiveControl,
};

function runSimulatedShootingPhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return battleSimulation.runAutomaticShootingPhase(state, side, rules, automaticShootingPhaseContext);
}

const automaticChargePhaseContext: battleSimulation.AutomaticChargePhaseContext = { enterBattlePhase, phaseLog, runCharge, updateObjectiveControl };

function runSimulatedChargePhase(state: BattleState, side: Side, rules: RulesEdition): LogEntry[] {
  return battleSimulation.runAutomaticChargePhase(state, side, rules, automaticChargePhaseContext);
}

const automaticFightPhaseContext: battleSimulation.AutomaticFightPhaseContext = {
  enterBattlePhase, phaseLog, runAutomaticEleventhFightPhase, runFight, updateObjectiveControl,
};

function runSimulatedFightPhase(state: BattleState, side: Side, rules: RulesEdition): { state: BattleState; logs: LogEntry[] } {
  return battleSimulation.runAutomaticFightPhase(state, side, rules, automaticFightPhaseContext);
}

function resetAutomatedTurnState(state: BattleState, side: Side, rules: RulesEdition): void {
  startMissionEventsForNewTurn(state, rules);
  state.fightStepStarted = undefined;
  state.engagedUnitIdsAtFightStepStart = undefined;
  state.lastFightSelectionSide = undefined;
  state.activeAttachedFightUnitId = undefined;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
  state.firingDeckLockedUnitIds = undefined;
  state.units.forEach(clearFiringDeckWeapons);
  state.units.forEach(unit => {
    unit.overrunFightSelected = undefined;
    unit.overrunPiledIn = undefined;
  });
  state.units.filter(unit => unit.side === side && !unit.destroyed).forEach(unit => {
    resetUnitForActiveTurn(unit, { clearEmergencyDisembarkBattleshock: true });
    unit.actionStartedThisTurn = undefined;
    unit.embarkedThisTurn = undefined;
    unit.disembarkedThisTurn = undefined;
  });
}

const automaticTurnContext: battleSimulation.AutomaticTurnContext = {
  clone,
  resetActiveTurn: resetAutomatedTurnState,
  runCommand: runSimulatedCommandPhase,
  runMovement: runSimulatedMovementPhase,
  runShooting: runSimulatedShootingPhase,
  runCharge: runSimulatedChargePhase,
  runFight: runSimulatedFightPhase,
  checkWinner,
  completeEndOfTurnActions,
  scoreEndOfTurnSecondaryMissionLogs,
  scoreEndOfTurnPrimaryMissionLogs,
  returnOpponentAircraftToStrategicReserves,
};

export function simulatePlayerTurn(state: BattleState, rules: RulesEdition): BattleState {
  return battleSimulation.runAutomaticTurn(state, rules, automaticTurnContext);

  // Fight — charged first, then others in melee, then defender counterattacks
}

const turnAdvanceContext: turnAdvance.TurnAdvanceContext = { clone, enterBattlePhase };

export function advanceTurn(state: BattleState): BattleState {
  return turnAdvance.advanceTurn(state, turnAdvanceContext);
}
