import type {
  BattleState,
  PhaseStep,
  PhaseStepAction,
  PhaseStepActionLedger,
  PhaseStepActionStatus,
} from '../types/battle';

function ledgerMatchesCurrentStep(state: BattleState): PhaseStepActionLedger | null {
  const ledger = state.phaseStepActions;
  if (!ledger || ledger.phase !== state.phase || ledger.step !== state.phaseStep) return null;
  return ledger;
}

/** Clears action opportunities when a step or phase changes. */
export function clearPhaseStepActions(state: BattleState): void {
  state.phaseStepActions = undefined;
}

/** Replaces the action inventory when the owning phase step opens. */
export function setPhaseStepActions(
  state: BattleState,
  step: PhaseStep,
  actions: PhaseStepAction[],
): boolean {
  // A step may only publish its own current inventory. This prevents a
  // delayed event or an old phase callback from installing actions into a
  // different step's state.
  if (state.phaseStep !== step) return false;
  state.phaseStepActions = {
    phase: state.phase,
    step,
    actions: actions.map(action => ({
      ...action,
      phase: state.phase,
      step,
      modelIndices: action.modelIndices ? [...action.modelIndices] : undefined,
      targetUnitIds: action.targetUnitIds ? [...action.targetUnitIds] : undefined,
    })),
  };
  return true;
}

/** Adds event- or rule-created actions without duplicating a stable action ID. */
export function appendPhaseStepActions(
  state: BattleState,
  actions: PhaseStepAction[],
): void {
  const ledger = phaseStepActionLedgerFor(state) ?? (state.phaseStep
    ? {
        phase: state.phase,
        step: state.phaseStep,
        actions: [],
      }
    : null);
  if (!ledger) return;
  state.phaseStepActions = ledger;
  const existingIds = new Set(ledger.actions.map(action => action.id));
  for (const action of actions) {
    if (existingIds.has(action.id)) continue;
    ledger.actions.push({
      ...action,
      phase: ledger.phase,
      step: ledger.step,
      modelIndices: action.modelIndices ? [...action.modelIndices] : undefined,
      targetUnitIds: action.targetUnitIds ? [...action.targetUnitIds] : undefined,
    });
    existingIds.add(action.id);
  }
}

/** Returns only actions belonging to the current serialized phase step. */
export function phaseStepActionsFor(state: BattleState): PhaseStepAction[] {
  return phaseStepActionLedgerFor(state)?.actions ?? [];
}

/**
 * Returns the current step's inventory, including an intentionally empty
 * inventory. Callers must use this instead of checking `actions.length` when
 * they need to distinguish "no ledger" from "ledger with no actions".
 */
export function phaseStepActionLedgerFor(state: BattleState): PhaseStepActionLedger | null {
  return ledgerMatchesCurrentStep(state);
}

export function phaseStepActionFor(state: BattleState, actionId: string): PhaseStepAction | null {
  return phaseStepActionsFor(state).find(action => action.id === actionId) ?? null;
}

/** Updates a typed action without allowing callers to mutate another step's ledger. */
export function setPhaseStepActionStatus(
  state: BattleState,
  actionId: string,
  status: PhaseStepActionStatus,
): boolean {
  const action = phaseStepActionFor(state, actionId);
  if (!action) return false;
  action.status = status;
  return true;
}

/** Marks a typed action as resolved while preserving it for undo/replay inspection. */
export function completePhaseStepAction(
  state: BattleState,
  actionId: string,
  status: Extract<PhaseStepActionStatus, 'completed' | 'skipped' | 'superseded'> = 'completed',
): boolean {
  return setPhaseStepActionStatus(state, actionId, status);
}

export function pendingRequiredPhaseStepActions(state: BattleState): PhaseStepAction[] {
  return phaseStepActionsFor(state).filter(action =>
    action.requiredToAdvance
    && !['completed', 'skipped', 'superseded'].includes(action.status),
  );
}

export function hasPendingRequiredPhaseStepActions(state: BattleState): boolean {
  return pendingRequiredPhaseStepActions(state).length > 0;
}

/** Unit targets of currently available actions, shared by UI and controllers. */
export function availablePhaseStepActionUnitIds(state: BattleState): Set<string> {
  return new Set(
    phaseStepActionsFor(state)
      .filter(action => action.status === 'available' && action.unitId)
      .map(action => action.unitId!),
  );
}

/** Model targets of currently available actions, using the standard unit:model key. */
export function availablePhaseStepActionModelIds(state: BattleState): Set<string> {
  return new Set(
    phaseStepActionsFor(state)
      .filter(action => action.status === 'available' && action.unitId && action.modelIndices?.length)
      .flatMap(action => action.modelIndices!.map(modelIndex => `${action.unitId}:${modelIndex}`)),
  );
}
