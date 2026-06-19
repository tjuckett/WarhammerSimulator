import type { BattleState, BattleUnit, Phase, Side } from '../types/battle';
import type { StratagemDefinition, StratagemUse } from '../types/stratagem';
import { battleRound } from './battleRound';
import { canSpendCommandPoints, spendCommandPoints } from './commandPoints';
import { unitCanBeAffectedByStratagem } from './battleshock';
import type { RulesEdition } from './rulesEngine';

let _stratagemUseId = 0;

function stratagemById(rules: RulesEdition, stratagemId: string): StratagemDefinition | null {
  return rules.stratagems.find(stratagem => stratagem.id === stratagemId) ?? null;
}

function nextLogId(state: BattleState, prefix: string): string {
  const used = new Set(state.log.map(entry => entry.id));
  let index = state.log.length + 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) id = `${prefix}-${++index}`;
  return id;
}

function phaseAllowed(stratagem: StratagemDefinition, phase: Phase): boolean {
  return stratagem.phases === 'any' || stratagem.phases.includes(phase);
}

function targetUnitFor(state: BattleState, targetUnitId?: string): BattleUnit | null {
  if (!targetUnitId) return null;
  return state.units.find(unit => unit.id === targetUnitId && !unit.destroyed && !unit.embarkedInUnitId) ?? null;
}

function targetAllowed(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  targetUnitId?: string,
): boolean {
  if (stratagem.target === 'none') return targetUnitId === undefined;
  const target = targetUnitFor(state, targetUnitId);
  if (!target) return false;
  if (!unitCanBeAffectedByStratagem(target)) return false;
  if (stratagem.target === 'friendly-unit') return target.side === side;
  if (stratagem.target === 'enemy-unit') return target.side !== side;
  return true;
}

function alreadyUsedThisPhase(state: BattleState, side: Side, stratagem: StratagemDefinition): boolean {
  if (!stratagem.oncePerPhase) return false;
  return (state.stratagemUses ?? []).some(use =>
    use.side === side
    && use.stratagemId === stratagem.id
    && use.phase === state.phase
    && use.battleRound === battleRound(state)
  );
}

function alreadyUsedThisBattle(state: BattleState, side: Side, stratagem: StratagemDefinition): boolean {
  if (!stratagem.oncePerBattle) return false;
  return (state.stratagemUses ?? []).some(use =>
    use.side === side
    && use.stratagemId === stratagem.id
  );
}

function targetAlreadyUsedThisPhase(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  targetUnitId?: string,
): boolean {
  if (!stratagem.targetOncePerPhase || !targetUnitId) return false;
  return (state.stratagemUses ?? []).some(use =>
    use.side === side
    && use.targetUnitId === targetUnitId
    && use.phase === state.phase
    && use.battleRound === battleRound(state)
  );
}

export function availableStratagems(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
  targetUnitId?: string,
): StratagemDefinition[] {
  return rules.stratagems.filter(stratagem =>
    phaseAllowed(stratagem, state.phase)
    && canSpendCommandPoints(state, side, stratagem.cost)
    && !alreadyUsedThisPhase(state, side, stratagem)
    && !alreadyUsedThisBattle(state, side, stratagem)
    && !targetAlreadyUsedThisPhase(state, side, stratagem, targetUnitId)
    && (
      stratagem.target === 'none'
      || targetUnitId === undefined
      || targetAllowed(state, side, stratagem, targetUnitId)
    )
  );
}

export function useStratagem(
  state: BattleState,
  side: Side,
  stratagemId: string,
  rules: RulesEdition,
  targetUnitId?: string,
): BattleState {
  const stratagem = stratagemById(rules, stratagemId);
  if (!stratagem) return state;
  if (!phaseAllowed(stratagem, state.phase)) return state;
  if (alreadyUsedThisPhase(state, side, stratagem)) return state;
  if (alreadyUsedThisBattle(state, side, stratagem)) return state;
  if (targetAlreadyUsedThisPhase(state, side, stratagem, targetUnitId)) return state;
  if (!targetAllowed(state, side, stratagem, targetUnitId)) return state;

  const next: BattleState = JSON.parse(JSON.stringify(state));
  if (!spendCommandPoints(next, side, stratagem.cost)) return state;

  const use: StratagemUse = {
    id: `stratagem-${++_stratagemUseId}`,
    stratagemId: stratagem.id,
    name: stratagem.name,
    side,
    phase: next.phase,
    battleRound: battleRound(next),
    targetUnitId,
    commandPointsSpent: stratagem.cost,
  };
  next.stratagemUses = [...(next.stratagemUses ?? []), use];
  next.log = [...next.log, {
    id: nextLogId(next, 'stratagem'),
    battleRound: battleRound(next),
    turn: battleRound(next),
    phase: next.phase,
    side,
    unitName: next.armies[side].name,
    message: `${next.armies[side].name} uses ${stratagem.name} for ${stratagem.cost}CP.`,
    type: 'info',
  }];
  return next;
}
