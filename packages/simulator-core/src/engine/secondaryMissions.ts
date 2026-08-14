import { eleventhSecondaryMissionRuleForName } from '../data/missionRules';
import { battleRound } from './battleRound';
import type {
  BattleState,
  BeaconWhenDrawnSelection,
  BurdenOfTrustGuardSelection,
  BurdenOfTrustWhenDrawnSelection,
  SecondaryMissionCardState,
  SecondaryMissionMode,
  SecondaryMissionPlayerState,
  SecondaryMissionSelectionValue,
  Side,
  TemptingTargetWhenDrawnSelection,
} from '../types/battle';
import { objectiveRoleForIndex } from './missionGeometry';

const MAX_ACTIVE_SECONDARY_MISSIONS = 2;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function emptyPlayerState(mode: SecondaryMissionMode): SecondaryMissionPlayerState {
  return { mode, activeCards: [], drawPile: [], discardedCards: [] };
}

function supportsMode(missionName: string, mode: SecondaryMissionMode): boolean {
  const rule = eleventhSecondaryMissionRuleForName(missionName);
  return !!rule && (rule.mode === mode || rule.mode === 'fixed-or-tactical');
}

function uniqueMissionNames(missionNames: string[]): boolean {
  return new Set(missionNames).size === missionNames.length;
}

function cardFor(
  state: BattleState,
  side: Side,
  sequence: number,
  missionName: string,
  mode: SecondaryMissionMode,
): SecondaryMissionCardState {
  return {
    activationId: `secondary-card-${side}-${sequence}`,
    missionName,
    mode,
    activatedBattleRound: battleRound(state),
    activatedTurn: state.turn,
  };
}

function ensureSecondaryMissionStates(
  state: BattleState,
): [SecondaryMissionPlayerState, SecondaryMissionPlayerState] {
  return state.missionState?.secondaryMissions ?? [emptyPlayerState('tactical'), emptyPlayerState('tactical')];
}

function updatePlayerState(
  state: BattleState,
  side: Side,
  playerState: SecondaryMissionPlayerState,
): BattleState {
  const next = clone(state);
  const secondaryMissions = clone(ensureSecondaryMissionStates(next));
  secondaryMissions[side] = playerState;
  next.missionState = { ...next.missionState, secondaryMissions };
  return next;
}

export function secondaryMissionStateFor(
  state: BattleState,
  side: Side,
): SecondaryMissionPlayerState | undefined {
  return state.missionState?.secondaryMissions?.[side];
}

export function configureSecondaryMissions(
  state: BattleState,
  side: Side,
  mode: SecondaryMissionMode,
  missionNames: string[],
): BattleState {
  if (
    !uniqueMissionNames(missionNames)
    || missionNames.some(name => !supportsMode(name, mode))
    || (mode === 'fixed' && missionNames.length > MAX_ACTIVE_SECONDARY_MISSIONS)
  ) return state;

  const nextActivationIds = [...(state.missionState?.secondaryMissionNextActivationIds ?? [0, 0])] as [number, number];
  const playerState = emptyPlayerState(mode);
  if (mode === 'fixed') {
    playerState.activeCards = missionNames.map(name =>
      cardFor(state, side, nextActivationIds[side]++, name, mode)
    );
  } else {
    playerState.drawPile = [...missionNames];
  }
  const next = updatePlayerState(state, side, playerState);
  next.missionState!.secondaryMissionNextActivationIds = nextActivationIds;
  return next;
}

export function drawSecondaryMission(
  state: BattleState,
  side: Side,
  missionName: string,
): BattleState {
  const current = secondaryMissionStateFor(state, side);
  if (!current || current.mode !== 'tactical' || current.activeCards.length >= MAX_ACTIVE_SECONDARY_MISSIONS) return state;
  const drawIndex = current.drawPile.indexOf(missionName);
  if (drawIndex < 0 || !supportsMode(missionName, 'tactical')) return state;

  const playerState = clone(current);
  playerState.drawPile.splice(drawIndex, 1);
  const nextActivationIds = [...(state.missionState?.secondaryMissionNextActivationIds ?? [0, 0])] as [number, number];
  playerState.activeCards.push(cardFor(state, side, nextActivationIds[side]++, missionName, 'tactical'));
  const next = updatePlayerState(state, side, playerState);
  next.missionState!.secondaryMissionNextActivationIds = nextActivationIds;
  return next;
}

export function discardSecondaryMission(
  state: BattleState,
  side: Side,
  missionName: string,
): BattleState {
  const current = secondaryMissionStateFor(state, side);
  if (!current) return state;
  const activeIndex = current.activeCards.findIndex(card => card.missionName === missionName);
  if (activeIndex < 0) return state;

  const playerState = clone(current);
  const [discarded] = playerState.activeCards.splice(activeIndex, 1);
  playerState.discardedCards.push(discarded);
  return updatePlayerState(state, side, playerState);
}

export function selectSecondaryMissionWhenDrawn(
  state: BattleState,
  side: Side,
  missionName: string,
  selections: Record<string, SecondaryMissionSelectionValue>,
): BattleState {
  const current = secondaryMissionStateFor(state, side);
  const activeIndex = current?.activeCards.findIndex(card => card.missionName === missionName) ?? -1;
  if (activeIndex < 0 || !eleventhSecondaryMissionRuleForName(missionName)?.whenDrawn) return state;

  if (missionName === 'A Tempting Target') {
    const objectiveIndex = selections.objectiveIndex;
    const selectedBySide = selections.selectedBySide;
    if (typeof objectiveIndex !== 'number' || (selectedBySide !== 0 && selectedBySide !== 1)) return state;
    return selectTemptingTargetObjective(state, side, { objectiveIndex, selectedBySide });
  }
  if (missionName === 'Beacon') {
    return typeof selections.unitId === 'string'
      ? selectBeaconUnit(state, side, { unitId: selections.unitId })
      : state;
  }
  if (missionName === 'Burden of Trust') {
    const guards = selections.guards;
    if (!Array.isArray(guards) || !guards.every(guard =>
      !!guard
      && !Array.isArray(guard)
      && typeof guard === 'object'
      && typeof guard.objectiveIndex === 'number'
      && typeof guard.unitId === 'string',
    )) return state;
    return selectBurdenOfTrustGuards(state, side, {
      guards: guards.map(guard => ({
        objectiveIndex: (guard as { objectiveIndex: number }).objectiveIndex,
        unitId: (guard as { unitId: string }).unitId,
      })),
    });
  }

  return setWhenDrawnSelections(state, side, activeIndex, selections);
}

function setWhenDrawnSelections(
  state: BattleState,
  side: Side,
  activeIndex: number,
  selections: Record<string, SecondaryMissionSelectionValue>,
): BattleState {
  const current = secondaryMissionStateFor(state, side);
  if (!current?.activeCards[activeIndex]) return state;

  const playerState = clone(current);
  playerState.activeCards[activeIndex].whenDrawnSelections = clone(selections);
  return updatePlayerState(state, side, playerState);
}

function activeCardIndex(state: BattleState, side: Side, missionName: string): number {
  return secondaryMissionStateFor(state, side)?.activeCards.findIndex(card => card.missionName === missionName) ?? -1;
}

function unitIsDeployedOnBattlefield(state: BattleState, unitId: string, side: Side): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  return !!unit && !unit.inStrategicReserves && !unit.embarkedInUnitId && unit.modelPositions.length > 0;
}

function unitIsBeaconEligible(state: BattleState, unitId: string, side: Side): boolean {
  const unit = state.units.find(candidate => candidate.id === unitId && candidate.side === side && !candidate.destroyed);
  if (!unit || unit.inStrategicReserves) return false;
  if (!unit.embarkedInUnitId) return unit.modelPositions.length > 0;

  const transport = state.units.find(candidate =>
    candidate.id === unit.embarkedInUnitId
    && candidate.side === side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId
    && !candidate.inStrategicReserves
    && candidate.modelPositions.length > 0,
  );
  return !!transport;
}

export function selectTemptingTargetObjective(
  state: BattleState,
  side: Side,
  selection: TemptingTargetWhenDrawnSelection,
): BattleState {
  const activeIndex = activeCardIndex(state, side, 'A Tempting Target');
  const objectiveRole = objectiveRoleForIndex(state, selection.objectiveIndex);
  if (
    activeIndex < 0
    || selection.selectedBySide !== (side === 0 ? 1 : 0)
    || !Number.isInteger(selection.objectiveIndex)
    || !['no-mans-land', 'central', 'expansion-0', 'expansion-1'].includes(objectiveRole ?? '')
  ) return state;
  return setWhenDrawnSelections(state, side, activeIndex, {
    objectiveIndex: selection.objectiveIndex,
    selectedBySide: selection.selectedBySide,
  });
}

export function selectBeaconUnit(
  state: BattleState,
  side: Side,
  selection: BeaconWhenDrawnSelection,
): BattleState {
  const activeIndex = activeCardIndex(state, side, 'Beacon');
  if (activeIndex < 0 || !unitIsBeaconEligible(state, selection.unitId, side)) return state;
  return setWhenDrawnSelections(state, side, activeIndex, { unitId: selection.unitId });
}

export function selectBurdenOfTrustGuards(
  state: BattleState,
  side: Side,
  selection: BurdenOfTrustWhenDrawnSelection,
): BattleState {
  const activeIndex = activeCardIndex(state, side, 'Burden of Trust');
  const objectiveIndexes = selection.guards.map(guard => guard.objectiveIndex);
  const guardsAreValid = selection.guards.every((guard: BurdenOfTrustGuardSelection) =>
    Number.isInteger(guard.objectiveIndex)
    && guard.objectiveIndex >= 0
    && guard.objectiveIndex < state.objectives.length
    && unitIsDeployedOnBattlefield(state, guard.unitId, side),
  );
  if (activeIndex < 0 || new Set(objectiveIndexes).size !== objectiveIndexes.length || !guardsAreValid) return state;
  return setWhenDrawnSelections(state, side, activeIndex, {
    guards: selection.guards.map(guard => ({ objectiveIndex: guard.objectiveIndex, unitId: guard.unitId })),
  });
}
