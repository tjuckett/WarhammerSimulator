import type { BattleState, BattleUnit, Side } from '../types/battle';
import { clone } from './clone';
import type { AbilityTiming, UnitAbilityDefinition, UnitAbilityUse } from '../types/ability';
import { battleRound } from './battleRound';
import type { RulesEdition } from './rulesEngine';
import { attachedUnitComponents } from './attachedUnits';
import { d3 } from './dice';
import { objectiveIndexesWithinRange, securePlayObjective } from './missionScoring';
import { resolveRuleEffects } from './ruleEffects';

let _abilityUseId = 0;

function nextLogId(state: BattleState, prefix: string): string {
  return `${prefix}-${state.log.length + 1}`;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unitHasAbility(unit: BattleUnit, ability: UnitAbilityDefinition): boolean {
  return [
    ...(unit.profile.abilities ?? []),
    ...(unit.profile.rules ?? []),
  ].some(rule => rule.ruleId === ability.id || normalizeName(rule.name) === normalizeName(ability.name));
}

function abilityUsed(state: BattleState, unit: BattleUnit, ability: UnitAbilityDefinition): boolean {
  if (!ability.oncePerBattle && !ability.oncePerTurn) return false;
  return (state.abilityUses ?? []).some(use => {
    if (use.abilityId !== ability.id || use.side !== unit.side) return false;
    if (!ability.armyWideOncePerBattle && use.sourceUnitId !== unit.id) return false;
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

function timingAllowed(state: BattleState, timing: AbilityTiming, ability: UnitAbilityDefinition): boolean {
  if (timing === 'command-phase') return state.phase === 'command';
  if (ability.phases && ability.phases !== 'any' && !ability.phases.includes(state.phase)) return false;
  return true;
}

function abilityCanBeUsed(state: BattleState, unit: BattleUnit, ability: UnitAbilityDefinition): boolean {
  if (!ability.requiresUnengaged) return true;
  return attachedUnitComponents(state, unit).every(component => !component.inCombat);
}

function automaticCommandTextEffect(unit: BattleUnit): Array<{ kind: 'cp' | 'heal'; name: string; amount?: number }> {
  const effects: Array<{ kind: 'cp' | 'heal'; name: string; amount?: number }> = [];
  for (const rule of [...unit.profile.abilities, ...(unit.profile.rules ?? [])]) {
    const text = `${rule.name} ${rule.description}`;
    if (/grot riggers/i.test(rule.name)) continue;
    if (!/(?:at the start|at the end|in) (?:of )?(?:your|each player's) Command phase/i.test(text)) continue;
    if (/\bcan\b|\bon a \d|\broll\b|once per|select|spend/i.test(text)) continue;
    if (/gain 1\s*CP/i.test(text)) effects.push({ kind: 'cp', name: rule.name });
    else if (/regains? 1 lost wound/i.test(text)) effects.push({ kind: 'heal', name: rule.name, amount: 1 });
    else if (/this model regains? up to D3 lost wounds/i.test(text)) effects.push({ kind: 'heal', name: rule.name, amount: d3() });
  }
  return effects;
}

function retainsControlledObjectivesAtCommand(unit: BattleUnit): boolean {
  return [...unit.profile.abilities, ...(unit.profile.rules ?? [])].some(rule =>
    /objective marker remains under (?:your|you) control/i.test(`${rule.name} ${rule.description}`),
  );
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
    && timingAllowed(state, timing, ability)
    && unitHasAbility(unit, ability)
    && abilityCanBeUsed(state, unit, ability)
    && !abilityUsed(state, unit, ability)
    && targetAllowed(state, unit, ability, targetUnitId)
  );
}

/** Army-wide abilities are declared for a side, rather than by a selected unit. */
export function availableArmyAbilities(
  state: BattleState,
  side: Side,
  timing: AbilityTiming,
  rules: RulesEdition,
): UnitAbilityDefinition[] {
  return rules.unitAbilities.filter(ability =>
    ability.armyWideOncePerBattle === true
    && ability.target === 'none'
    && ability.timing === timing
    && timingAllowed(state, timing, ability)
    && state.units.some(unit =>
      unit.side === side
      && !unit.destroyed
      && !unit.embarkedInUnitId
      && unitHasAbility(unit, ability)
      && abilityCanBeUsed(state, unit, ability)
      && !abilityUsed(state, unit, ability)
      && targetAllowed(state, unit, ability)
    )
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
  resolveRuleEffects({
    state: next,
    side,
    sourceRuleId: ability.id,
    sourceName: ability.name,
    sourceUseId: use.id,
    sourceUnitId: unitId,
    targetUnitId: ability.target === 'self' ? unitId : targetUnitId,
  }, ability.effects);
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

/** Uses an army-wide ability and records one eligible bearer as its source. */
export function useArmyAbility(
  state: BattleState,
  side: Side,
  abilityId: string,
  timing: AbilityTiming,
  rules: RulesEdition,
): BattleState {
  const ability = availableArmyAbilities(state, side, timing, rules)
    .find(candidate => candidate.id === abilityId);
  if (!ability) return state;

  const source = state.units.find(unit =>
    unit.side === side
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && unitHasAbility(unit, ability)
    && abilityCanBeUsed(state, unit, ability)
    && !abilityUsed(state, unit, ability)
  );
  return source
    ? useUnitAbility(state, source.id, side, ability.id, timing, rules)
    : state;
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

/** Resolve automatic command-phase datasheet abilities without auto-using player-declared abilities. */
export function runAutomaticCommandUnitAbilities(
  state: BattleState,
  side: Side,
  rules: RulesEdition,
): void {
  for (const unit of state.units.filter(candidate => candidate.side === side && !candidate.destroyed && !candidate.embarkedInUnitId)) {
    for (const ability of rules.unitAbilities.filter(candidate => candidate.timing === 'command-phase' && candidate.automatic === true)) {
      const next = useUnitAbility(state, unit.id, side, ability.id, 'command-phase', rules);
      if (next !== state) Object.assign(state, next);
    }
    for (const effect of automaticCommandTextEffect(unit)) {
      if (effect.kind === 'cp') {
        const points = state.commandPoints ?? [0, 0];
        points[side] += 1;
        state.commandPoints = points;
        state.log = [...state.log, {
          id: nextLogId(state, 'ability'),
          battleRound: battleRound(state),
          turn: state.turn,
          phase: state.phase,
          side,
          unitName: unit.profile.name,
          message: `${unit.profile.name} uses ${effect.name} and gains 1CP.`,
          type: 'info',
        }];
      } else if (unit.remainingModels > 0 && unit.woundsOnLeadModel < unit.profile.wounds) {
        unit.woundsOnLeadModel = Math.min(unit.profile.wounds, unit.woundsOnLeadModel + (effect.amount ?? 1));
        state.log = [...state.log, {
          id: nextLogId(state, 'ability'),
          battleRound: battleRound(state),
          turn: state.turn,
          phase: state.phase,
          side,
          unitName: unit.profile.name,
          message: `${unit.profile.name} uses ${effect.name} and regains ${effect.amount ?? 1} lost wound${(effect.amount ?? 1) === 1 ? '' : 's'}.`,
          type: 'info',
        }];
      }
    }
    if (rules.metadata.edition === '11e' && retainsControlledObjectivesAtCommand(unit)) {
      for (const objectiveIndex of objectiveIndexesWithinRange(state, unit, rules)) {
        if (state.objectiveOwners[objectiveIndex] !== side) continue;
        const next = securePlayObjective(state, objectiveIndex, side, rules);
        if (next !== state) {
          Object.assign(state, next);
          state.log = [...state.log, {
            id: nextLogId(state, 'ability'),
            battleRound: battleRound(state),
            turn: state.turn,
            phase: state.phase,
            side,
            unitName: unit.profile.name,
            message: `${unit.profile.name} secures objective ${objectiveIndex + 1} through its Command ability.`,
            type: 'info',
          }];
        }
      }
    }
  }
}
