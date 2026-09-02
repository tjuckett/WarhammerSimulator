import {
  PHASE_STEP,
  type BattleShockEligibleUnit,
  type BattleShockResult,
  type BattleState,
  type BattleUnit,
  type LogEntry,
  type Side,
} from '../types/battle';
import { attachedUnitComponents, attachedUnitRemainingModels, attachedUnitTargetRepresentative } from './attachedUnits';
import { battleLog } from './battleLog';
import { battleRound } from './battleRound';
import { d6 } from './dice';
import {
  completePhaseStepAction,
  hasPendingRequiredPhaseStepActions,
  phaseStepActionLedgerFor,
  phaseStepActionsFor,
  setPhaseStepActions,
} from './phaseStepActions';

function battleShockActionId(side: Side, unitId: string): string {
  return `battle-shock:${side}:${unitId}`;
}

export function bestLeadership(state: BattleState, unit: BattleUnit): number {
  return Math.min(...attachedUnitComponents(state, unit).flatMap(component => [
    component.profile.leadership,
    ...(component.profile.modelProfiles?.map(profile => profile.leadership) ?? []),
  ]));
}

export function isBelowHalfStrength(state: BattleState, unit: BattleUnit): boolean {
  const startingStrength = attachedUnitComponents(state, unit, true)
    .reduce((total, component) => total + component.profile.baseModelCount, 0);
  if (startingStrength === 1) return unit.woundsOnLeadModel <= unit.profile.wounds / 2;
  return attachedUnitRemainingModels(state, unit) <= startingStrength / 2;
}

function isCurrentlyBattleshocked(state: BattleState, unit: BattleUnit): boolean {
  return attachedUnitComponents(state, unit).some(component => component.battleshocked);
}

/**
 * Returns the immutable eligibility information used by the play UI and AI.
 * Attached units are represented by their live bodyguard (or remaining
 * component) so one attached unit is tested only once.
 */
export function battleshockEligibleUnits(state: BattleState, side: Side): BattleShockEligibleUnit[] {
  return state.units
    .filter(unit => unit.side === side
      && !unit.destroyed
      && attachedUnitTargetRepresentative(state, unit)?.id === unit.id)
    .flatMap(unit => {
      const reasons = [
        ...(isCurrentlyBattleshocked(state, unit) ? ['already-battleshocked' as const] : []),
        ...(isBelowHalfStrength(state, unit) ? ['at-or-below-half-strength' as const] : []),
      ];
      return reasons.length
        ? [{
            unitId: unit.id,
            unitName: unit.profile.name,
            reasons,
            leadership: bestLeadership(state, unit),
          }]
        : [];
    });
}

export function battleshockEligibleUnitIds(state: BattleState, side: Side): string[] {
  return battleshockEligibleUnits(state, side).map(unit => unit.unitId);
}

export function beginBattleshockStep(state: BattleState, side: Side): void {
  const eligible = battleshockEligibleUnits(state, side);
  state.battleshockEligibleUnitIds = eligible.map(unit => unit.unitId);
  state.battleshockEligibility = eligible;
  state.battleshockResults = [];
  state.battleshockPendingUnitId = eligible[0]?.unitId;
  setPhaseStepActions(state, PHASE_STEP.CommandBattleShock, eligible.map(unit => ({
    id: battleShockActionId(side, unit.unitId),
    phase: state.phase,
    step: PHASE_STEP.CommandBattleShock,
    kind: 'battle-shock' as const,
    side,
    unitId: unit.unitId,
    requiredToAdvance: true,
    status: 'available' as const,
    label: `Roll Battle-shock for ${unit.unitName}`,
    description: unit.reasons.join(', '),
  })));
}

export function battleshockPendingUnitIds(state: BattleState): string[] {
  const resolved = new Set((state.battleshockResults ?? []).map(result => result.unitId));
  return (state.battleshockEligibleUnitIds ?? []).filter(unitId => !resolved.has(unitId));
}

export function battleshockStepComplete(state: BattleState): boolean {
  if (phaseStepActionLedgerFor(state)) return !hasPendingRequiredPhaseStepActions(state);
  return battleshockPendingUnitIds(state).length === 0;
}

function hasInsaneBraveryForCurrentBattleshock(state: BattleState, unit: BattleUnit): boolean {
  const currentRound = battleRound(state);
  return (state.stratagemUses ?? []).some(use =>
    use.stratagemId === 'insane-bravery'
    && use.targetUnitId === unit.id
    && use.phase === 'command'
    && use.battleRound === currentRound,
  );
}

interface BattleshockResolution {
  result: BattleShockResult;
  log: LogEntry;
}

/** Resolves one previously snapshotted Battle-shock unit in place. */
export function resolveBattleshockUnit(
  state: BattleState,
  side: Side,
  unitId: string,
): BattleshockResolution | null {
  if (!(state.battleshockEligibleUnitIds ?? []).includes(unitId)) return null;
  if ((state.battleshockResults ?? []).some(result => result.unitId === unitId)) return null;

  const unit = state.units.find(candidate =>
    candidate.id === unitId
    && candidate.side === side
    && !candidate.destroyed
    && attachedUnitTargetRepresentative(state, candidate)?.id === candidate.id,
  );
  if (!unit) return null;

  const components = attachedUnitComponents(state, unit);
  const needed = bestLeadership(state, unit);
  const automaticallyPassed = hasInsaneBraveryForCurrentBattleshock(state, unit);
  let result: BattleShockResult;
  let log: LogEntry;

  if (automaticallyPassed) {
    for (const component of components) component.battleshocked = false;
    result = {
      unitId: unit.id,
      unitName: unit.profile.name,
      side,
      needed,
      passed: true,
      automaticallyPassed: true,
    };
    log = battleLog(state, unit.side, unit.profile.name,
      `${unit.profile.name} automatically passes its Battle-shock test with Insane Bravery.`,
      'info',
    );
  } else {
    const rolls: [number, number] = [d6(), d6()];
    const total = rolls[0] + rolls[1];
    const passed = total >= needed;
    for (const component of components) component.battleshocked = !passed;
    result = {
      unitId: unit.id,
      unitName: unit.profile.name,
      side,
      dice: rolls,
      total,
      needed,
      passed,
    };
    log = battleLog(state, unit.side, unit.profile.name,
      `😰 ${unit.profile.name} below half strength — Battle-shock (${needed}+): rolled ${rolls[0]}+${rolls[1]}=${total} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
      'info',
    );
  }

  state.battleshockResults = [...(state.battleshockResults ?? []), result];
  state.battleshockPendingUnitId = battleshockPendingUnitIds(state)[0];
  completePhaseStepAction(state, battleShockActionId(side, unit.id));
  return { result, log };
}

/** Resolves the Command-phase Battle-shock step for one side in batch mode. */
export function runBattleshockPhase(state: BattleState, side: Side): LogEntry[] {
  const logs: LogEntry[] = [];
  beginBattleshockStep(state, side);
  const eligible = battleshockEligibleUnits(state, side);

  for (const entry of eligible) {
    const resolution = resolveBattleshockUnit(state, side, entry.unitId);
    if (resolution) logs.push(resolution.log);
  }

  const eligibleIds = new Set(eligible.map(unit => unit.unitId));
  for (const unit of state.units) {
    if (unit.destroyed || unit.side !== side) continue;
    if (attachedUnitTargetRepresentative(state, unit)?.id !== unit.id) continue;
    if (eligibleIds.has(unit.id)) continue;
    for (const component of attachedUnitComponents(state, unit)) component.battleshocked = false;
  }
  return logs;
}
