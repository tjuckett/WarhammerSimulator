// Fight-phase state transitions, movement actions, and melee resolution.
// Shared attack resolution remains in manualCombat; this module owns when and
// how Fight can call it.
// @ts-nocheck
import { PHASE_STEP, type BattleState, type BattleUnit, type LogEntry, type Position, type Side } from '../../types/battle';
import type { UnitProfile, WeaponProfile } from '../../types/army';
import type { RulesEdition } from '../rulesEngine';
import { moveModelTowardPoint } from '../interactiveMovement';
import * as manualCombat from '../manualCombat';
import {
  fightPhaseStep,
  isFightConsolidationStep,
  isFightPileInStep,
  isFightResolutionStep,
  isFightUnitsStep,
  playFightActivationUnitIds,
  playFightFirstUnitIds,
  playOverrunFightUnitIds,
  playUnitCanConsolidate,
  playUnitCanPileIn,
  sideCanSelectFightUnit,
  unitChargedThisTurn,
  type FightMovementRulesContext,
  type FightPhaseContext,
} from './fightPhaseRules';

export type PlayFightWeaponOption = {
  weaponIndex: number;
  name: string;
  targetIds: string[];
  modelCount?: number;
  targetModelCounts?: Record<string, number>;
};

export type PlayMeleeAttackAllocation = {
  weaponIndex: number;
  targetUnitId: string;
  /** Number of models using this weapon against the target. */
  modelCount?: number;
};

export type PlayMeleeAttackSplit = {
  targetUnitId: string;
  attacks: number;
};

export interface FightPhaseActionContext extends FightMovementRulesContext {
  clone(state: BattleState): BattleState;
  distance(a: Position, b: Position): number;
  centroid(positions: Position[]): Position;
  modelBaseRadius(unit: BattleUnit, modelIndex?: number): number;
  modelBaseEdgeHorizontalDistance(
    unit: BattleUnit,
    modelIndex: number,
    target: BattleUnit,
    targetModelIndex: number,
  ): number;
  hasNoBaseOverlap(state: BattleState, unit: BattleUnit, modelIndices: Set<number>): boolean;
  hasNoWallOverlap(state: BattleState, unit: BattleUnit, modelIndices: Set<number>): boolean;
  log(state: BattleState, side: Side, source: string, message: string, kind: string): LogEntry;
  moveRange: number;
  modelWeaponLoadout(profile: UnitProfile, modelIndex: number): number[];
  weaponHasKeyword(weapon: WeaponProfile, keyword: string): boolean;
  chooseOneProfilePerGroup<T extends { weapon: WeaponProfile }>(weapons: T[]): T[];
  aliveWeaponModelCount(unit: BattleUnit, weaponIndex: number): number;
  aliveWeaponModelIndexes(unit: BattleUnit, weaponIndex: number): number[];
  participatingWeaponModelIndexes(
    unit: BattleUnit,
    target: BattleUnit,
    weapon: WeaponProfile,
    weaponIndex: number,
    terrain: BattleState['terrain'],
    state: BattleState,
  ): number[];
  nearest(unit: BattleUnit, targets: BattleUnit[]): BattleUnit | null;
  resolveCombatAttacks(...args: any[]): LogEntry[];
  resolveHazardousTests(unit: BattleUnit, weapon: WeaponProfile, weaponIndex: number, state: BattleState): LogEntry[];
  resolvePendingDeadlyDemisesInPlace(state: BattleState): LogEntry[];
}

export interface AutomatedFightContext extends FightPhaseActionContext {
  selectOverrunFight(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  pileIn(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  consolidate(state: BattleState, unitId: string, side: Side, rules: RulesEdition): BattleState;
  runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition): LogEntry[];
}

/** Captures the engagement snapshot required by the Fight step. */
export function startFightStepInPlace(state: BattleState, rules: RulesEdition, context: FightPhaseContext): void {
  state.fightStepStarted = true;
  state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = undefined;
  state.activeAttachedFightUnitId = undefined;
  state.activeAttachedShootingUnitId = undefined;
  state.attachedShootingTargetUnitId = undefined;
  state.engagedUnitIdsAtFightStepStart = state.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && context.enemies(state, unit.side).some(enemy => context.canFightTarget(unit, enemy)
        && context.inEngagement(unit, [enemy], rules.engagementRange())))
    .map(unit => unit.id);
}

export function finishAttachedFightComponent(state: BattleState, unit: BattleUnit, rules: RulesEdition, context: FightPhaseContext): void {
  if (rules.metadata.edition !== '11e') return;
  const remaining = context.attachedComponents(state, unit)
    .filter(component => !component.activated && context.unitEligibleToFight(component, state, rules));
  if (remaining.length) {
    state.activeAttachedFightUnitId = context.attachedUnitId(unit);
    return;
  }
  state.activeAttachedFightUnitId = undefined;
  const forcedUnit = state.units.find(candidate => candidate.id === state.forcedFightUnitId);
  if (forcedUnit && context.attachedUnitId(forcedUnit) === context.attachedUnitId(unit)) state.forcedFightUnitId = undefined;
  state.lastFightSelectionSide = unit.side;
  if (state.consolidationStepStarted && state.consolidationPendingFightUnitIds?.includes(unit.id)) {
    state.consolidationPendingFightUnitIds = state.consolidationPendingFightUnitIds.filter(unitId => unitId !== unit.id);
  }
}

/** Starts the interactive Fight step after both sides have completed ordinary pile-ins. */
export function startPlayFightStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state) || state.fightStepStarted) return state;
  const next = context.clone(state);
  next.units.forEach(unit => { unit.activated = false; });
  next.fightPileInSide = undefined;
  startFightStepInPlace(next, rules, context);
  next.phaseStep = PHASE_STEP.FightUnits;
  next.log = [...next.log, context.log(next, next.activeArmy, next.armies[next.activeArmy].name,
    'Fight step begins; engagement eligibility is recorded.', 'phase')];
  return next;
}

export function playFightPileInUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseActionContext): string[] {
  const pileInSide = state.fightPileInSide ?? state.activeArmy;
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state) || pileInSide !== side) return [];
  return state.units
    .filter(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId)
    .filter(unit => playUnitCanPileIn(state, unit.id, side, rules, context))
    .map(unit => unit.id);
}

/** Resolves the side-by-side ordinary pile-in boundary and enters Fight. */
export function advancePlayFightPileInStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightPileInStep(state)) return state;
  let next = state;
  let currentSide = state.fightPileInSide ?? state.activeArmy;
  while (true) {
    if (playFightPileInUnitIds(next, currentSide, rules, context).length > 0) return next;
    if (currentSide === next.activeArmy) {
      next = context.clone(next);
      currentSide = (currentSide === 0 ? 1 : 0) as Side;
      next.fightPileInSide = currentSide;
      continue;
    }
    return startPlayFightStep(next, rules, context);
  }
}

export function playFightStepNeedsStart(state: BattleState, rules: RulesEdition): boolean {
  return rules.metadata.edition === '11e'
    && isFightPileInStep(state)
    && state.fightStepStarted === false
    && state.fightPileInSide === undefined;
}

export function playConsolidationPendingFightUnitIds(state: BattleState, side: Side, rules: RulesEdition): string[] {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state)) return [];
  return (state.consolidationPendingFightUnitIds ?? []).filter(unitId =>
    state.units.some(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.activated));
}

export function playFightPhaseHasPendingActivations(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): boolean {
  if (rules.metadata.edition !== '11e' || !isFightResolutionStep(state)) return false;
  return state.consolidationStepStarted
    ? playConsolidationPendingFightUnitIds(state, 0, rules).length > 0
      || playConsolidationPendingFightUnitIds(state, 1, rules).length > 0
    : playFightActivationUnitIds(state, 0, rules, context).length > 0
      || playFightActivationUnitIds(state, 1, rules, context).length > 0;
}

export function startPlayConsolidationStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightUnitsStep(state) || state.consolidationStepStarted
    || playFightPhaseHasPendingActivations(state, rules, context)) return state;
  const next = context.clone(state);
  next.consolidationStepStarted = true;
  next.consolidationSide = next.activeArmy;
  const engagedAtFightStart = new Set(next.engagedUnitIdsAtFightStepStart ?? []);
  next.consolidationEligibleUnitIds = next.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && (unitChargedThisTurn(next, unit) || engagedAtFightStart.has(unit.id)))
    .map(unit => unit.id);
  next.consolidationPendingFightUnitIds = [];
  next.phaseStep = PHASE_STEP.FightConsolidate;
  next.log = [...next.log, context.log(next, next.activeArmy, next.armies[next.activeArmy].name,
    'Consolidation step begins; no further units may be selected to fight.', 'phase')];
  return next;
}

export function playConsolidationUnitIds(state: BattleState, side: Side, rules: RulesEdition, context: FightPhaseActionContext): string[] {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state)
    || !state.consolidationStepStarted || state.consolidationSide !== side) return [];
  const eligible = new Set(state.consolidationEligibleUnitIds ?? []);
  return state.units
    .filter(unit => eligible.has(unit.id) && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId && !unit.consolidated)
    .filter(unit => playUnitCanConsolidate(state, unit.id, side, rules, context))
    .map(unit => unit.id);
}

export function advancePlayConsolidationStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (rules.metadata.edition !== '11e' || !isFightConsolidationStep(state) || !state.consolidationStepStarted) return state;
  const side = state.consolidationSide ?? state.activeArmy;
  if (playConsolidationUnitIds(state, side, rules, context).length > 0) return state;
  if (side === state.activeArmy) {
    const next = context.clone(state);
    next.consolidationSide = (side === 0 ? 1 : 0) as Side;
    return next;
  }
  return state;
}

/**
 * Advances the explicit Fight substep without allowing the generic phase
 * coordinator to know about pile-in, activation, or consolidation rules.
 * `null` means this state is not an 11th-edition Fight phase; returning the
 * unchanged state means the phase is waiting for a player choice.
 */
export function advanceFightPhaseStep(state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): BattleState | null {
  if (rules.metadata.edition !== '11e' || state.phase !== 'fight' || fightPhaseStep(state) === PHASE_STEP.FightEnd) return null;
  const step = fightPhaseStep(state);
  if (step === PHASE_STEP.FightStart) {
    const next = context.clone(state);
    next.phaseStep = PHASE_STEP.FightPileIn;
    return next;
  }
  if (step === PHASE_STEP.FightPileIn) return advancePlayFightPileInStep(state, rules, context);
  if (step === PHASE_STEP.FightUnits) {
    if (playFightPhaseHasPendingActivations(state, rules, context)) return state;
    return startPlayConsolidationStep(state, rules, context);
  }
  if (step === PHASE_STEP.FightConsolidate) {
    if (playFightPhaseHasPendingActivations(state, rules, context)) return state;
    const consolidationSide = state.consolidationSide ?? state.activeArmy;
    if (playConsolidationUnitIds(state, consolidationSide, rules, context).length > 0) return state;
    if (consolidationSide === state.activeArmy) return advancePlayConsolidationStep(state, rules, context);
    const next = context.clone(state);
    next.phaseStep = PHASE_STEP.FightEnd;
    return next;
  }
  return null;
}

function closestEnemyModelFor(unit: BattleUnit, modelIndex: number, state: BattleState, context: FightPhaseActionContext) {
  let closest: { unit: BattleUnit; modelIndex: number; distance: number } | null = null;
  for (const enemy of context.enemies(state, unit.side)) {
    for (let enemyModelIndex = 0; enemyModelIndex < enemy.modelPositions.length; enemyModelIndex++) {
      const distance = context.modelBaseEdgeHorizontalDistance(unit, modelIndex, enemy, enemyModelIndex);
      if (!closest || distance < closest.distance) closest = { unit: enemy, modelIndex: enemyModelIndex, distance };
    }
  }
  return closest;
}

export function nearestObjectiveToModel(model: Position, state: BattleState, context: FightPhaseActionContext): Position | null {
  if (!state.objectives.length) return null;
  return state.objectives.reduce((best, objective) =>
    context.distance(model, objective) < context.distance(model, best) ? objective : best);
}

export function moveModelTowardEnemy(unit: BattleUnit, modelIndex: number, state: BattleState, maxDistance: number, context: FightPhaseActionContext): boolean {
  const closest = closestEnemyModelFor(unit, modelIndex, state, context);
  if (!closest) return false;
  const targetModel = closest.unit.modelPositions[closest.modelIndex];
  return moveModelTowardPoint(unit, modelIndex, targetModel, maxDistance, context.centroid,
    context.modelBaseRadius(unit, modelIndex) + context.modelBaseRadius(closest.unit, closest.modelIndex) + 0.02);
}

/** Applies an automated, straight-line Pile In or Consolidation move. */
export function applyFightPhaseMove(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  if (state.phase !== 'fight' || (state.activeArmy !== side && rules.metadata.edition !== '11e')) return state;
  const existing = state.units.find(unit => unit.id === unitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!existing || context.attachedComponents(state, existing).some(component => context.unitSurgedThisPhase(state, component))) return state;
  if (kind === 'pileIn' && !playUnitCanPileIn(state, unitId, side, rules, context)) return state;
  if (kind === 'consolidate' && !playUnitCanConsolidate(state, unitId, side, rules, context)) return state;
  const isOverrunPileIn = kind === 'pileIn' && rules.metadata.edition === '11e'
    && isFightUnitsStep(state) && existing.overrunFightSelected;

  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  let movedModels = 0;
  for (let modelIndex = 0; modelIndex < unit.modelPositions.length; modelIndex++) {
    const before = unit.modelPositions[modelIndex];
    const movedTowardEnemy = moveModelTowardEnemy(unit, modelIndex, next, context.moveRange, context);
    const movedTowardObjective = !movedTowardEnemy && kind === 'consolidate'
      ? (() => {
          const objective = nearestObjectiveToModel(unit.modelPositions[modelIndex], next, context);
          return objective ? moveModelTowardPoint(unit, modelIndex, objective, context.moveRange, context.centroid) : false;
        })()
      : false;
    if (!movedTowardEnemy && !movedTowardObjective) continue;
    const movingIndices = new Set([modelIndex]);
    if (!context.hasNoBaseOverlap(next, unit, movingIndices) || !context.hasNoWallOverlap(next, unit, movingIndices)) {
      unit.modelPositions[modelIndex] = before;
      unit.position = context.centroid(unit.modelPositions);
      continue;
    }
    movedModels++;
  }
  if (kind === 'pileIn' && !context.inEngagement(unit, context.enemies(next, side), rules.engagementRange())) return state;
  if (kind === 'pileIn' && isOverrunPileIn) unit.overrunPiledIn = true;
  else if (kind === 'pileIn') unit.piledIn = true;
  else unit.consolidated = true;
  unit.lastMovePhase = next.phase;
  unit.lastMoveTurn = next.turn;
  unit.inCombat = context.inEngagement(unit, context.enemies(next, side), rules.engagementRange());
  next.log = [...next.log, context.log(next, side, unit.profile.name,
    `${unit.profile.name} ${isOverrunPileIn ? 'makes its Overrun pile-in' : kind === 'pileIn' ? 'piles in' : 'consolidates'}${movedModels ? ` with ${movedModels} model${movedModels === 1 ? '' : 's'}` : ''}.`, 'move')];
  return next;
}

export function selectMeleeWeapons(
  unit: BattleUnit,
  options: Array<{ weapon: WeaponProfile; weaponIndex: number }>,
  requested: number | 'all',
  context: Pick<FightPhaseActionContext, 'modelWeaponLoadout' | 'weaponHasKeyword' | 'chooseOneProfilePerGroup'>,
): Array<{ weapon: WeaponProfile; weaponIndex: number }> {
  const selected = new Set<number>();
  for (let modelIndex = 0; modelIndex < unit.remainingModels; modelIndex++) {
    const rosterIndex = unit.modelRosterIndexes?.[modelIndex] ?? modelIndex;
    const carried = new Set(context.modelWeaponLoadout(unit.profile, rosterIndex));
    const modelOptions = options.filter(option => carried.has(option.weaponIndex));
    context.chooseOneProfilePerGroup(modelOptions.filter(option => context.weaponHasKeyword(option.weapon, 'Extra Attacks')))
      .forEach(option => selected.add(option.weaponIndex));
    const normal = context.chooseOneProfilePerGroup(modelOptions.filter(option => !context.weaponHasKeyword(option.weapon, 'Extra Attacks')));
    const requestedNormal = typeof requested === 'number' ? normal.find(option => option.weaponIndex === requested) : undefined;
    const chosenNormal = requestedNormal ?? normal[0];
    if (chosenNormal) selected.add(chosenNormal.weaponIndex);
  }
  return options.filter(option => selected.has(option.weaponIndex));
}

export function fightPlayUnitWeapons(
  state: BattleState,
  unitId: string,
  side: Side,
  allocations: PlayMeleeAttackAllocation[],
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  if (!sideCanSelectFightUnit(state, side, rules, context) || !allocations.length) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !context.unitCanFight(unit, state, rules) || !playFightActivationUnitIds(state, side, rules, context).includes(unit.id)) return state;
  const meleeWeapons = unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex })).filter(option => option.weapon.isMelee);
  const selectableWeapons = rules.metadata.edition === '11e'
    ? selectMeleeWeapons(unit, meleeWeapons, 'all', context)
    : context.chooseOneProfilePerGroup(meleeWeapons);
  const selectableIndexes = new Set(selectableWeapons.map(option => option.weaponIndex));
  const grouped = new Map<number, PlayMeleeAttackAllocation[]>();
  for (const allocation of allocations) {
    if (!selectableIndexes.has(allocation.weaponIndex)) return state;
    const target = state.units.find(candidate => candidate.id === allocation.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
    if (!target || !context.canFightTarget(unit, target) || !context.inEngagement(unit, [target], rules.engagementRange())) return state;
    grouped.set(allocation.weaponIndex, [...(grouped.get(allocation.weaponIndex) ?? []), allocation]);
  }
  if (grouped.size !== selectableIndexes.size) return state;
  for (const selected of selectableWeapons) {
    const entries = grouped.get(selected.weaponIndex) ?? [];
    const availableModelIndexes = context.aliveWeaponModelIndexes(unit, selected.weaponIndex);
    const assignedModelIndexes = new Set<number>();
    if (entries.length > 1 && entries.reduce((total, entry) => total + (entry.modelCount ?? 0), 0) !== availableModelIndexes.length) return state;
    const allocationCandidates = entries.map(entry => {
      const target = state.units.find(candidate => candidate.id === entry.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(unit, target, selected.weapon, selected.weaponIndex, state.terrain, state);
      return { entry, eligibleModelIndexes };
    }).sort((a, b) => a.eligibleModelIndexes.length - b.eligibleModelIndexes.length);
    for (const { entry, eligibleModelIndexes } of allocationCandidates) {
      if (entry.modelCount !== undefined && (!Number.isInteger(entry.modelCount) || entry.modelCount < 1)) return state;
      const remainingModelIndexes = eligibleModelIndexes.filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = entry.modelCount ?? remainingModelIndexes.length;
      if (modelCount > remainingModelIndexes.length) return state;
      remainingModelIndexes.slice(0, modelCount).forEach(modelIndex => assignedModelIndexes.add(modelIndex));
    }
  }
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit) return state;
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} locks all melee targets before rolling:`, 'fight')];
  for (const selected of selectableWeapons) {
    const entries = grouped.get(selected.weaponIndex)!;
    const assignedModelIndexes = new Set<number>();
    const orderedEntries = [...entries].sort((a, b) => {
      const targetA = next.units.find(candidate => candidate.id === a.targetUnitId && !candidate.destroyed)!;
      const targetB = next.units.find(candidate => candidate.id === b.targetUnitId && !candidate.destroyed)!;
      return context.participatingWeaponModelIndexes(fightingUnit, targetA, selected.weapon, selected.weaponIndex, next.terrain, next).length
        - context.participatingWeaponModelIndexes(fightingUnit, targetB, selected.weapon, selected.weaponIndex, next.terrain, next).length;
    });
    for (const entry of orderedEntries) {
      const target = next.units.find(candidate => candidate.id === entry.targetUnitId && !candidate.destroyed)!;
      const eligibleModelIndexes = context.participatingWeaponModelIndexes(fightingUnit, target, selected.weapon, selected.weaponIndex, next.terrain, next)
        .filter(modelIndex => !assignedModelIndexes.has(modelIndex));
      const modelCount = entry.modelCount ?? eligibleModelIndexes.length;
      const modelIndexes = eligibleModelIndexes.slice(0, modelCount);
      modelIndexes.forEach(modelIndex => assignedModelIndexes.add(modelIndex));
      const result = manualCombat.createCombatWeaponResult(fightingUnit, target, selected.weapon, selected.weaponIndex);
      logs.push(...context.resolveCombatAttacks(fightingUnit, target, selected.weapon, selected.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        modelIndexes,
        selectedTargetCount: entries.length,
        result,
      }));
      manualCombat.appendCombatWeaponResult(next, fightingUnit, result);
    }
  }
  if (!logs.length) return state;
  fightingUnit.activated = true;
  finishAttachedFightComponent(next, fightingUnit, rules, context);
  next.log = [...next.log, ...logs];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export function fightPlayUnitWeapon(
  state: BattleState,
  unitId: string,
  side: Side,
  targetUnitId: string,
  weaponIndex: number | 'all',
  rules: RulesEdition,
  context: FightPhaseActionContext,
  targetSplits?: PlayMeleeAttackSplit[],
): BattleState {
  if (!sideCanSelectFightUnit(state, side, rules, context)) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const target = state.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const splitTargetIds = targetSplits?.map(split => split.targetUnitId) ?? [];
  const splitTargets = splitTargetIds.map(splitTargetId => state.units.find(candidate => candidate.id === splitTargetId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId));
  if (!unit || !target || !context.unitCanFight(unit, state, rules) || !playFightActivationUnitIds(state, side, rules, context).includes(unit.id)) return state;
  if (!context.canFightTarget(unit, target) || !context.inEngagement(unit, [target], rules.engagementRange())) return state;
  if (targetSplits?.length && splitTargets.some(splitTarget => !splitTarget || !context.canFightTarget(unit, splitTarget) || !context.inEngagement(unit, [splitTarget], rules.engagementRange()))) return state;
  const next = context.clone(state);
  const fightingUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  const fightTarget = next.units.find(candidate => candidate.id === targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!fightingUnit || !fightTarget) return state;
  if (weaponIndex === -1 || (weaponIndex === 'all' && !fightingUnit.profile.weapons.some(weapon => weapon.isMelee))) {
    if (fightingUnit.profile.weapons.some(weapon => weapon.isMelee)) return state;
    fightingUnit.activated = true;
    finishAttachedFightComponent(next, fightingUnit, rules, context);
    next.log = [...next.log, context.log(next, side, fightingUnit.profile.name, `${fightingUnit.profile.name} is selected to fight ${fightTarget.profile.name} but has no melee weapons, so it makes no attacks.`, 'fight')];
    return next;
  }
  const meleeWeapons = fightingUnit.profile.weapons.map((weapon, index) => ({ weapon, weaponIndex: index })).filter(option => option.weapon.isMelee);
  const selectedMeleeWeapons = rules.metadata.edition === '11e'
    ? selectMeleeWeapons(fightingUnit, meleeWeapons, weaponIndex, context)
    : weaponIndex === 'all' ? context.chooseOneProfilePerGroup(meleeWeapons) : meleeWeapons.filter(option => option.weaponIndex === weaponIndex);
  if (!selectedMeleeWeapons.length || (targetSplits?.length && (weaponIndex === 'all' || selectedMeleeWeapons.length !== 1))) return state;
  const logs: LogEntry[] = [context.log(next, side, fightingUnit.profile.name, fightingUnit.overrunFightSelected
    ? `${fightingUnit.profile.name} makes an Overrun Fight against ${fightTarget.profile.name}:`
    : `${fightingUnit.profile.name} fights ${fightTarget.profile.name}:`, 'fight')];
  let madeAttacks = false;
  if (targetSplits?.length) {
    const option = selectedMeleeWeapons[0];
    const maxTargets = Number.parseInt(String(option.weapon.attacks), 10);
    const maxAttacks = maxTargets * context.aliveWeaponModelCount(fightingUnit, option.weaponIndex);
    const declaredAttacks = targetSplits.reduce((total, split) => total + split.attacks, 0);
    if (!Number.isFinite(maxTargets) || targetSplits.some(split => split.attacks < 1 || !Number.isInteger(split.attacks))
      || new Set(targetSplits.map(split => split.targetUnitId)).size !== targetSplits.length || declaredAttacks !== maxAttacks) return state;
    for (const split of targetSplits) {
      const splitTarget = next.units.find(candidate => candidate.id === split.targetUnitId && candidate.side !== side && !candidate.destroyed && !candidate.embarkedInUnitId);
      if (!splitTarget || !context.canFightTarget(fightingUnit, splitTarget) || !context.inEngagement(fightingUnit, [splitTarget], rules.engagementRange())) continue;
      const result = manualCombat.createCombatWeaponResult(fightingUnit, splitTarget, option.weapon, option.weaponIndex);
      const attackLogs = context.resolveCombatAttacks(fightingUnit, splitTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        attackCountOverride: split.attacks,
        selectedTargetCount: targetSplits.length,
        result,
      });
      manualCombat.appendCombatWeaponResult(next, fightingUnit, result);
      logs.push(...attackLogs); madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed) break;
    }
    if (madeAttacks) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
  } else {
    for (const option of selectedMeleeWeapons) {
      const result = manualCombat.createCombatWeaponResult(fightingUnit, fightTarget, option.weapon, option.weaponIndex);
      const modelIndexes = context.participatingWeaponModelIndexes(fightingUnit, fightTarget, option.weapon, option.weaponIndex, next.terrain, next);
      const attackLogs = context.resolveCombatAttacks(fightingUnit, fightTarget, option.weapon, option.weaponIndex, rules, next, false, 0, '', {
        deferCasualties: true,
        modelIndexes,
        result,
      });
      manualCombat.appendCombatWeaponResult(next, fightingUnit, result);
      logs.push(...attackLogs);
      if (attackLogs.length > 0) logs.push(...context.resolveHazardousTests(fightingUnit, option.weapon, option.weaponIndex, next));
      madeAttacks = madeAttacks || attackLogs.length > 0;
      if (fightingUnit.destroyed || fightTarget.destroyed) break;
    }
  }
  if (!madeAttacks) return state;
  fightingUnit.activated = true;
  finishAttachedFightComponent(next, fightingUnit, rules, context);
  next.log = [...next.log, ...logs];
  if (next.pendingDeadlyDemises?.length) next.log = [...next.log, ...context.resolvePendingDeadlyDemisesInPlace(next)];
  return next;
}

export function playFightWeaponOptions(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: FightPhaseActionContext): PlayFightWeaponOption[] {
  if (!sideCanSelectFightUnit(state, side, rules, context)) return [];
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || !context.unitCanFight(unit, state, rules)) return [];
  if (!playFightActivationUnitIds(state, side, rules, context).includes(unit.id)) return [];
  const targetIds = context.enemies(state, side)
    .filter(target => context.canFightTarget(unit, target) && context.inEngagement(unit, [target], rules.engagementRange()))
    .map(target => target.id);
  const options = unit.profile.weapons
    .map((weapon, weaponIndex) => ({ weapon, weaponIndex }))
    .filter(option => option.weapon.isMelee)
    .map(option => {
      const targetModelCounts = Object.fromEntries(targetIds.flatMap(targetId => {
        const target = state.units.find(candidate => candidate.id === targetId);
        if (!target) return [];
        const count = context.participatingWeaponModelIndexes(unit, target, option.weapon, option.weaponIndex, state.terrain, state).length;
        return count > 0 ? [[targetId, count]] : [];
      }));
      const eligibleModelIndexes = new Set(targetIds.flatMap(targetId => {
        const target = state.units.find(candidate => candidate.id === targetId);
        return target
          ? context.participatingWeaponModelIndexes(unit, target, option.weapon, option.weaponIndex, state.terrain, state)
          : [];
      }));
      const result: PlayFightWeaponOption = {
        weaponIndex: option.weaponIndex,
        name: option.weapon.name,
        targetIds: Object.keys(targetModelCounts),
      };
      Object.defineProperties(result, {
        modelCount: { value: eligibleModelIndexes.size, enumerable: false },
        targetModelCounts: { value: targetModelCounts, enumerable: false },
      });
      return result;
    });
  if (options.length === 0) return [{ weaponIndex: -1, name: 'No melee weapons', targetIds }];
  return options;
}

export function runFight(unit: BattleUnit, state: BattleState, rules: RulesEdition, context: FightPhaseActionContext): LogEntry[] {
  if (unit.destroyed || unit.embarkedInUnitId) return [];
  const foes = context.enemies(state, unit.side).filter(enemy => context.canFightTarget(unit, enemy)
    && context.inEngagement(unit, [enemy], rules.engagementRange()));
  if (!foes.length) return [];
  unit.activated = true;
  finishAttachedFightComponent(state, unit, rules, context);
  const meleeOptions = unit.profile.weapons.map((weapon, weaponIndex) => ({ weapon, weaponIndex })).filter(option => option.weapon.isMelee);
  const meleeWeapons = rules.metadata.edition === '11e'
    ? selectMeleeWeapons(unit, meleeOptions, 'all', context)
    : context.chooseOneProfilePerGroup(meleeOptions);
  if (!meleeWeapons.length) return [context.log(state, unit.side, unit.profile.name, `${unit.profile.name} is selected to fight but has no melee weapons.`, 'fight')];
  const target = context.nearest(unit, foes);
  if (!target) return [];
  const logs: LogEntry[] = [context.log(state, unit.side, unit.profile.name, `${unit.profile.name} fights ${target.profile.name}:`, 'fight')];
  for (const { weapon, weaponIndex } of meleeWeapons) {
    if (context.aliveWeaponModelCount(unit, weaponIndex) <= 0) continue;
    logs.push(...context.resolveCombatAttacks(unit, target, weapon, weaponIndex, rules, state, false));
    logs.push(...context.resolveHazardousTests(unit, weapon, weaponIndex, state));
  }
  logs.push(...context.resolvePendingDeadlyDemisesInPlace(state));
  return logs;
}

export function selectPlayOverrunFight(state: BattleState, unitId: string, side: Side, rules: RulesEdition, context: FightPhaseActionContext): BattleState {
  if (!playOverrunFightUnitIds(state, side, rules, context).includes(unitId)) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side);
  if (!unit) return state;
  unit.overrunFightSelected = true;
  next.log = [...next.log, context.log(next, side, unit.profile.name, `${unit.profile.name} is selected to make an Overrun Fight.`, 'fight')];
  return next;
}

/** Opens the interactive model-movement window for a Pile In or Consolidation. */
export function beginPlayFightMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  kind: 'pileIn' | 'consolidate',
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  const canMove = kind === 'pileIn'
    ? playUnitCanPileIn(state, unitId, side, rules, context)
    : playUnitCanConsolidate(state, unitId, side, rules, context);
  if (!canMove || state.pendingFightMovement) return state;
  const next = context.clone(state);
  const unit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  for (const component of context.attachedComponents(next, unit)) {
    component.movementStartPositionsByModel = component.modelPositions.map(position => ({ ...position }));
    component.movementPathByModel = undefined;
    component.movementAllowanceTotalByModel = component.modelPositions.map(() => 3);
    component.movementAllowanceRemainingByModel = component.modelPositions.map(() => 3);
    component.movementAllowanceRemaining = 3;
  }
  const lockedModelIds = context.attachedComponents(next, unit).flatMap(component => component.modelPositions.flatMap((_, modelIndex) =>
    next.units.some(enemy => enemy.side !== side && !enemy.destroyed && !enemy.embarkedInUnitId
      && enemy.modelPositions.some((__, enemyModelIndex) => context.modelBaseEdgeDistance(component, modelIndex, enemy, enemyModelIndex) <= 0.001))
      ? [`${component.id}:${modelIndex}`]
      : [],
  ));
  next.pendingFightMovement = { unitId, side, kind, lockedModelIds };
  return next;
}

/** Commits the interactive Pile In or Consolidation movement window. */
export function completePlayFightMovement(
  state: BattleState,
  unitId: string,
  side: Side,
  rules: RulesEdition,
  context: FightPhaseActionContext,
): BattleState {
  const pending = state.pendingFightMovement;
  if (!pending || pending.unitId !== unitId || pending.side !== side) return state;
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit) return state;
  if (pending.kind === 'pileIn' && !context.inEngagement(unit, context.enemies(state, side), rules.engagementRange())) return state;
  const wasEngaged = context.inEngagement(unit, context.enemies(state, side), rules.engagementRange());
  const next = context.clone(state);
  const movedUnit = next.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!movedUnit) return state;
  for (const component of context.attachedComponents(next, movedUnit)) {
    if (pending.kind === 'pileIn') component.piledIn = true;
    else component.consolidated = true;
    component.lastMovePhase = next.phase;
    component.lastMoveTurn = next.turn;
    component.movementStartPositionsByModel = undefined;
    component.movementStartRotationsByModel = undefined;
    component.movementPathByModel = undefined;
    component.movementAllowanceTotalByModel = undefined;
    component.movementAllowanceRemainingByModel = undefined;
    component.movementAllowanceRemaining = undefined;
  }
  next.pendingFightMovement = undefined;
  if (pending.kind === 'consolidate' && rules.metadata.edition === '11e' && !wasEngaged
    && context.inEngagement(movedUnit, context.enemies(next, side), rules.engagementRange())) {
    const newlyEngaged = context.enemies(next, side)
      .filter(enemy => !enemy.activated && context.inEngagement(movedUnit, [enemy], rules.engagementRange()))
      .map(enemy => enemy.id);
    next.consolidationPendingFightUnitIds = [...new Set([...(next.consolidationPendingFightUnitIds ?? []), ...newlyEngaged])];
  }
  if (pending.kind === 'pileIn' && rules.metadata.edition === '11e' && isFightPileInStep(next)) {
    return advancePlayFightPileInStep(next, rules, context);
  }
  return next;
}

export function runAutomaticFightForUnit(state: BattleState, unitId: string, rules: RulesEdition, context: AutomatedFightContext): BattleState {
  let next = state;
  const unit = next.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!unit || unit.activated) return next;
  if (playOverrunFightUnitIds(next, unit.side, rules, context).includes(unit.id)) {
    next = context.selectOverrunFight(next, unit.id, unit.side, rules);
    const piled = context.pileIn(next, unit.id, unit.side, rules);
    if (piled !== next) next = piled;
  }
  const selected = next.units.find(candidate => candidate.id === unitId && !candidate.destroyed && !candidate.embarkedInUnitId);
  if (!selected) return next;
  const fightLogs = context.runFight(selected, next, rules);
  if (fightLogs.length) next.log = [...next.log, ...fightLogs];
  return next;
}

export function runAutomaticEleventhFightPhase(
  state: BattleState,
  startingSide: Side,
  rules: RulesEdition,
  context: AutomatedFightContext,
): BattleState {
  let next = state;
  next = context.clone(next);
  next.phaseStep = PHASE_STEP.FightPileIn;
  for (const pileSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    next.fightPileInSide = pileSide;
    for (const unit of context.activeUnits(next, pileSide)) {
      const piled = context.pileIn(next, unit.id, pileSide, rules);
      if (piled !== next) next = piled;
    }
  }
  next = context.clone(next);
  startFightStepInPlace(next, rules, context);
  next.phaseStep = PHASE_STEP.FightUnits;

  let nextSide = startingSide;
  while (true) {
    const otherSide = (nextSide === 0 ? 1 : 0) as Side;
    const nextIds = playFightActivationUnitIds(next, nextSide, rules, context);
    const otherIds = playFightActivationUnitIds(next, otherSide, rules, context);
    const unitId = nextIds[0] ?? otherIds[0];
    if (!unitId) break;
    const selectedSide = nextIds.length ? nextSide : otherSide;
    next = runAutomaticFightForUnit(next, unitId, rules, context);
    if (!next.units.find(unit => unit.id === unitId)?.activated) break;
    nextSide = (selectedSide === 0 ? 1 : 0) as Side;
  }

  next.consolidationStepStarted = true;
  next.phaseStep = PHASE_STEP.FightConsolidate;
  next.consolidationSide = startingSide;
  const engagedAtFightStart = new Set(next.engagedUnitIdsAtFightStepStart ?? []);
  next.consolidationEligibleUnitIds = next.units
    .filter(unit => !unit.destroyed && !unit.embarkedInUnitId
      && (unitChargedThisTurn(next, unit) || engagedAtFightStart.has(unit.id)))
    .map(unit => unit.id);
  next.consolidationPendingFightUnitIds = [];
  for (const consolidationSide of [startingSide, (startingSide === 0 ? 1 : 0) as Side]) {
    next.consolidationSide = consolidationSide;
    for (const unit of next.units.filter(candidate => candidate.side === consolidationSide && candidate.activated && !candidate.destroyed)) {
      const consolidated = context.consolidate(next, unit.id, consolidationSide, rules);
      if (consolidated !== next) next = consolidated;
    }
  }
  return next;
}
