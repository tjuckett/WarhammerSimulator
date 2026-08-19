import type { BattleState, BattleUnit, Side } from '../types/battle';
import type { AbilityTiming, UnitAbilityDefinition, UnitAbilityUse } from '../types/ability';
import { battleRound } from './battleRound';
import type { RulesEdition } from './rulesEngine';

let _abilityUseId = 0;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function nextLogId(state: BattleState, prefix: string): string {
  const used = new Set(state.log.map(entry => entry.id));
  let index = state.log.length + 1;
  let id = `${prefix}-${index}`;
  while (used.has(id)) id = `${prefix}-${++index}`;
  return id;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unitHasAbility(unit: BattleUnit, ability: UnitAbilityDefinition): boolean {
  const names = [
    ...(unit.profile.abilities ?? []),
    ...(unit.profile.rules ?? []),
  ].map(rule => normalizeName(rule.name));
  return names.includes(normalizeName(ability.name));
}

function abilityUsed(state: BattleState, unit: BattleUnit, ability: UnitAbilityDefinition): boolean {
  if (!ability.oncePerBattle && !ability.oncePerTurn) return false;
  return (state.abilityUses ?? []).some(use => {
    if (use.sourceUnitId !== unit.id || use.abilityId !== ability.id) return false;
    if (ability.oncePerBattle) return true;
    return use.battleRound === battleRound(state);
  });
}

function targetAllowed(
  state: BattleState,
  source: BattleUnit,
  ability: UnitAbilityDefinition,
  targetUnitId?: string,
): boolean {
  if (ability.target === 'none') return targetUnitId === undefined;
  if (ability.target === 'self') return targetUnitId === undefined || targetUnitId === source.id;
  const target = targetUnitId
    ? state.units.find(unit => unit.id === targetUnitId && !unit.destroyed && !unit.embarkedInUnitId)
    : null;
  if (!target) return false;
  if (ability.target === 'friendly-unit') return target.side === source.side;
  if (ability.target === 'enemy-unit') return target.side !== source.side;
  return true;
}

function timingAllowed(state: BattleState, timing: AbilityTiming): boolean {
  if (timing === 'command-phase') return state.phase === 'command';
  return true;
}

export function availableUnitAbilities(
  state: BattleState,
  unitId: string,
  side: Side,
  timing: AbilityTiming,
  rules: RulesEdition,
  targetUnitId?: string,
): UnitAbilityDefinition[] {
  const unit = state.units.find(candidate =>
    candidate.id === unitId
    && candidate.side === side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId
  );
  if (!unit) return [];

  return rules.unitAbilities.filter(ability =>
    ability.timing === timing
    && timingAllowed(state, timing)
    && unitHasAbility(unit, ability)
    && !abilityUsed(state, unit, ability)
    && targetAllowed(state, unit, ability, targetUnitId)
  );
}

export function useUnitAbility(
  state: BattleState,
  unitId: string,
  side: Side,
  abilityId: string,
  timing: AbilityTiming,
  rules: RulesEdition,
  targetUnitId?: string,
): BattleState {
  const unit = state.units.find(candidate =>
    candidate.id === unitId
    && candidate.side === side
    && !candidate.destroyed
    && !candidate.embarkedInUnitId
  );
  if (!unit) return state;

  const ability = availableUnitAbilities(state, unitId, side, timing, rules, targetUnitId)
    .find(candidate => candidate.id === abilityId);
  if (!ability) return state;

  const next = clone(state);
  const use: UnitAbilityUse = {
    id: `ability-${++_abilityUseId}`,
    abilityId: ability.id,
    name: ability.name,
    side,
    sourceUnitId: unitId,
    phase: next.phase,
    battleRound: battleRound(next),
    targetUnitId: ability.target === 'self' ? unitId : targetUnitId,
  };
  next.abilityUses = [...(next.abilityUses ?? []), use];
  if (ability.id === 'waaagh') {
    const active = next.activeArmyAbilities ?? [[], []];
    active[side] = [...new Set([...active[side], ability.id])];
    next.activeArmyAbilities = active;
  }
  next.log = [...next.log, {
    id: nextLogId(next, 'ability'),
    battleRound: battleRound(next),
    turn: battleRound(next),
    phase: next.phase,
    side,
    unitName: unit.profile.name,
    message: `${unit.profile.name} uses ${ability.name}.`,
    type: 'info',
  }];
  return next;
}

/** Resolve modeled automatic abilities at their declared simulation timing. */
export function runAutomaticUnitAbilities(
  state: BattleState,
  side: Side,
  timing: AbilityTiming,
  rules: RulesEdition,
): void {
  const unitIds = state.units
    .filter(unit => unit.side === side && !unit.destroyed && !unit.embarkedInUnitId)
    .map(unit => unit.id);
  const abilities = rules.unitAbilities.filter(ability => ability.timing === timing);
  for (const unitId of unitIds) {
    for (const ability of abilities) {
      const next = useUnitAbility(state, unitId, side, ability.id, timing, rules);
      if (next !== state) Object.assign(state, next);
    }
  }
}
