import type { BattleState, BattleUnit, LogEntry, Side } from '../types/battle';
import { attachedUnitComponents, attachedUnitRemainingModels, attachedUnitTargetRepresentative } from './attachedUnits';
import { battleLog } from './battleLog';
import { battleRound } from './battleRound';
import { d6 } from './dice';

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

function hasInsaneBraveryForCurrentBattleshock(state: BattleState, unit: BattleUnit): boolean {
  const currentRound = battleRound(state);
  return (state.stratagemUses ?? []).some(use =>
    use.stratagemId === 'insane-bravery'
    && use.targetUnitId === unit.id
    && use.phase === 'command'
    && use.battleRound === currentRound,
  );
}

/** Resolves the Command-phase Battle-shock step for one side. */
export function runBattleshockPhase(state: BattleState, side: Side): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const unit of state.units) {
    if (unit.destroyed || unit.side !== side) continue;
    if (attachedUnitTargetRepresentative(state, unit)?.id !== unit.id) continue;
    const components = attachedUnitComponents(state, unit);
    const belowHalfStrength = isBelowHalfStrength(state, unit);
    if (unit.battleshocked || belowHalfStrength) {
      if (hasInsaneBraveryForCurrentBattleshock(state, unit)) {
        for (const component of components) component.battleshocked = false;
        logs.push(battleLog(state, unit.side, unit.profile.name,
          `${unit.profile.name} automatically passes its Battle-shock test with Insane Bravery.`,
          'info',
        ));
        continue;
      }
      const rolls = [d6(), d6()];
      const total = rolls[0] + rolls[1];
      const needed = bestLeadership(state, unit);
      const passed = total >= needed;
      for (const component of components) component.battleshocked = !passed;
      logs.push(battleLog(state, unit.side, unit.profile.name,
        `😰 ${unit.profile.name} below half strength — Battle-shock (${needed}+): rolled ${rolls[0]}+${rolls[1]}=${total} → ${passed ? 'PASSED' : 'FAILED (Battleshocked!)'}`,
        'info',
      ));
    } else {
      for (const component of components) component.battleshocked = false;
    }
  }
  return logs;
}
