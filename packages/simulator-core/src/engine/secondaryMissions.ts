import { eleventhSecondaryMissionRuleForName } from '../data/missionRules';
import { battleRound } from './battleRound';
import type {
  BattleState,
  SecondaryMissionCardState,
  SecondaryMissionMode,
  SecondaryMissionPlayerState,
  SecondaryMissionSelectionValue,
  Side,
} from '../types/battle';

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

function cardFor(state: BattleState, missionName: string, mode: SecondaryMissionMode): SecondaryMissionCardState {
  return {
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

  const playerState = emptyPlayerState(mode);
  if (mode === 'fixed') {
    playerState.activeCards = missionNames.map(name => cardFor(state, name, mode));
  } else {
    playerState.drawPile = [...missionNames];
  }
  return updatePlayerState(state, side, playerState);
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
  playerState.activeCards.push(cardFor(state, missionName, 'tactical'));
  return updatePlayerState(state, side, playerState);
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

  const playerState = clone(current!);
  playerState.activeCards[activeIndex].whenDrawnSelections = clone(selections);
  return updatePlayerState(state, side, playerState);
}
