import type { Side, BattleState } from '../types/battle';
import type { GameAction } from '../practice/actions';
import { applyGameAction } from '../practice/actions';
import { getLegalActions, type LegalAction } from './legalActions';
import type { RulesEdition } from './rulesEngine';

export type PlayerSeatController =
  | { kind: 'local-human' }
  | { kind: 'remote-human'; playerId: string }
  | { kind: 'ai'; policyId: string };

export interface PlayerSeat {
  side: Side;
  controller: PlayerSeatController;
}

export interface ControllerActionRequest {
  side: Side;
  action: GameAction;
}

export interface BattleObservation {
  readonly state: BattleState;
  readonly side: Side;
  readonly rules: RulesEdition;
  readonly legalActions: readonly LegalAction[];
}

export type AiPolicy = (observation: BattleObservation) => GameAction | null;

const HEURISTIC_CATEGORY_PRIORITY: Record<LegalAction['category'], number> = {
  damage: 0,
  deployment: 1,
  movement: 2,
  shooting: 3,
  charge: 4,
  fight: 5,
  action: 6,
  ability: 7,
  stratagem: 8,
  phase: 9,
};

/** A deterministic baseline policy for smoke tests and AI-vs-AI simulations. */
export function heuristicAiPolicy(observation: BattleObservation): GameAction | null {
  const [candidate] = [...observation.legalActions].sort((left, right) =>
    (HEURISTIC_CATEGORY_PRIORITY[left.category] - HEURISTIC_CATEGORY_PRIORITY[right.category])
    || left.label.localeCompare(right.label),
  );
  return candidate?.action ?? null;
}

export function legalActionsForSeat(
  state: BattleState,
  seat: PlayerSeat,
  rules: RulesEdition,
): LegalAction[] {
  return getLegalActions(state, seat.side, rules);
}

export function observeBattleForSeat(
  state: BattleState,
  seat: PlayerSeat,
  rules: RulesEdition,
): BattleObservation {
  return {
    state,
    side: seat.side,
    rules,
    legalActions: legalActionsForSeat(state, seat, rules),
  };
}

function actionKey(action: GameAction): string {
  const meaningfulEntries = Object.entries(action)
    .filter(([key]) => key !== 'id' && key !== 'createdAt' && key !== 'label')
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(meaningfulEntries);
}

export function controllerActionIsLegal(
  state: BattleState,
  request: ControllerActionRequest,
  rules: RulesEdition,
): boolean {
  return legalActionsForSeat(state, { side: request.side, controller: { kind: 'local-human' } }, rules)
    .some(legalAction => actionKey(legalAction.action) === actionKey(request.action));
}

export function applyControllerAction(
  state: BattleState,
  request: ControllerActionRequest,
  rules: RulesEdition,
): BattleState {
  if (!controllerActionIsLegal(state, request, rules)) {
    throw new Error(`Illegal action for side ${request.side}: ${request.action.type}`);
  }
  return applyGameAction(state, request.action, { rules });
}

export function chooseAiAction(
  state: BattleState,
  seat: PlayerSeat,
  rules: RulesEdition,
  policy: AiPolicy,
): GameAction | null {
  if (seat.controller.kind !== 'ai') return null;
  const action = policy(observeBattleForSeat(state, seat, rules));
  if (!action) return null;
  const request = { side: seat.side, action };
  return controllerActionIsLegal(state, request, rules) ? action : null;
}

export function applyAiAction(
  state: BattleState,
  seat: PlayerSeat,
  rules: RulesEdition,
  policy: AiPolicy = heuristicAiPolicy,
): BattleState {
  const action = chooseAiAction(state, seat, rules, policy);
  if (!action) return state;
  return applyControllerAction(state, { side: seat.side, action }, rules);
}
