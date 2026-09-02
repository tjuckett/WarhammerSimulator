import { advancePhaseStep } from '@warhammer-simulator/core/engine/phases/phaseStepDispatcher';
import { type BattleState, type Side } from '@warhammer-simulator/core/types/battle';

export type PhaseStepAdvanceResult =
  | { kind: 'advanced'; state: BattleState }
  | { kind: 'unhandled' };

/** Phase-neutral routing; phase modules own the ordered steps in core. */
export function advanceStandardPlayPhaseStep(
  state: BattleState,
  clone: <T>(value: T) => T,
  gainCoreCp: (state: BattleState) => void,
  beginBattleshockStep: (state: BattleState, side: Side) => void,
  markRemainingStationaryUnits: (state: BattleState, side: Side) => void,
  startShootingStep?: (state: BattleState) => void,
  startChargeStep?: (state: BattleState) => void,
): PhaseStepAdvanceResult {
  const next = advancePhaseStep(state, {
    clone,
    gainCoreCommandPoints: gainCoreCp,
    beginBattleshockStep,
    markRemainingStationaryUnits,
    startShootingStep,
    startChargeStep,
  });
  return next ? { kind: 'advanced', state: next } : { kind: 'unhandled' };
}
