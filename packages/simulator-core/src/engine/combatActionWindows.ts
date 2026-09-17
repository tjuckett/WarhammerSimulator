import { PHASE_STEP, type BattleState, type CombatActionKind, type PendingCombatAction, type Side } from '../types/battle';
import { clone } from './clone';

/** Returns the first unresolved event-backed combat opportunity for a unit. */
export function pendingCombatActionFor(
  state: BattleState,
  kind: CombatActionKind,
  unitId: string,
  side: Side,
): PendingCombatAction | undefined {
  const pending = state.pendingCombatActions?.[0];
  return pending
    && pending.kind === kind
    && pending.unitId === unitId
    && pending.side === side
    ? pending
    : undefined;
}

export function pendingCombatActionById(state: BattleState, id: string): PendingCombatAction | undefined {
  return state.pendingCombatActions?.find(action => action.id === id);
}

/** Ordinary Shooting is available only in its own phase step and for its active player. */
export function normalShootingActionWindowOpen(state: BattleState, side: Side): boolean {
  return state.phase === 'shooting'
    && state.phaseStep === PHASE_STEP.ShootingUnits
    && state.activeArmy === side;
}

/**
 * A unit may resolve a shooting action either through the ordinary Shooting
 * step or through an explicit event-backed window. The latter does not change
 * the normal phase step or active-player rules for any other unit.
 */
export function shootingActionWindowOpen(state: BattleState, unitId: string, side: Side): boolean {
  if (state.pendingCombatActions?.length) {
    return pendingCombatActionFor(state, 'shooting', unitId, side) !== undefined;
  }
  return normalShootingActionWindowOpen(state, side);
}

/** Adds an event-backed opportunity once, preserving deterministic replay. */
export function openPendingCombatAction(state: BattleState, action: PendingCombatAction): void {
  const existing = state.pendingCombatActions ?? [];
  if (existing.some(candidate => candidate.id === action.id)) return;
  state.pendingCombatActions = [...existing, action];
}

/** Closes an event-backed opportunity without touching any phase activation flags. */
export function closePendingCombatAction(state: BattleState, id: string): void {
  const remaining = (state.pendingCombatActions ?? []).filter(action => action.id !== id);
  state.pendingCombatActions = remaining.length ? remaining : undefined;
}

/** Declining is a state transition, so it is available to UI and AI alike. */
export function declinePendingCombatAction(state: BattleState, side: Side, id: string): BattleState {
  const action = pendingCombatActionById(state, id);
  if (!action || action.side !== side) return state;
  const next = clone(state);
  closePendingCombatAction(next, id);
  return next;
}
