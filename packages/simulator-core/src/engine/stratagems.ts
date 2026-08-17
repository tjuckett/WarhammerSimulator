import type { BattleState, BattleUnit, Phase, Side } from '../types/battle';
import type { CommandRerollRollType, StratagemDefinition, StratagemUse } from '../types/stratagem';
import { battleRound } from './battleRound';
import { canSpendCommandPoints, spendCommandPoints } from './commandPoints';
import { unitCanBeAffectedByStratagem } from './battleshock';
import { countSuccesses, rollMultiple } from './dice';
import { hasLOSEdgeToEdge } from './terrainGeometry';
import { battleUnitMaxBaseRadiusInches } from './baseSizes';
import { applyDamage, battleUnitsBaseEdgeDistance } from './simulator';
import type { RulesEdition } from './rulesEngine';
import { unitHasRule } from './armyUnits';

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

function turnAllowed(state: BattleState, side: Side, stratagem: StratagemDefinition): boolean {
  if (!stratagem.turn || stratagem.turn === 'either') return true;
  return stratagem.turn === 'own'
    ? state.activeArmy === side
    : state.activeArmy !== side;
}

function battleRoundAllowed(state: BattleState, stratagem: StratagemDefinition): boolean {
  return stratagem.minimumBattleRound === undefined
    || battleRound(state) >= stratagem.minimumBattleRound;
}

function targetUnitFor(state: BattleState, targetUnitId?: string): BattleUnit | null {
  if (!targetUnitId) return null;
  return state.units.find(unit => unit.id === targetUnitId && !unit.destroyed && !unit.embarkedInUnitId) ?? null;
}

function appendStratagemEffectLog(
  state: BattleState,
  side: Side,
  unitName: string,
  message: string,
  type: 'info' | 'roll' | 'damage' = 'info',
): void {
  state.log = [...state.log, {
    id: nextLogId(state, type === 'info' ? 'stratagem' : type),
    battleRound: battleRound(state),
    turn: battleRound(state),
    phase: state.phase,
    side,
    unitName,
    message,
    type,
  }];
}

function unitHasKeyword(unit: BattleUnit, keyword: string): boolean {
  return unitHasRule(unit.profile, keyword);
}

function unitHasAnyKeyword(unit: BattleUnit, keywords: string[]): boolean {
  return keywords.some(keyword => unitHasKeyword(unit, keyword));
}

function weaponIsSidearm(weapon: BattleUnit['profile']['weapons'][number]): boolean {
  return weapon.keywords.some(keyword => {
    const normalized = keyword.toLowerCase();
    return normalized.startsWith('pistol') || normalized.startsWith('sidearm');
  });
}

function enemies(state: BattleState, side: Side): BattleUnit[] {
  return state.units.filter(unit =>
    unit.side !== side
    && !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.inStrategicReserves
  );
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function unitHasVisibleLineToTarget(state: BattleState, unit: BattleUnit, target: BattleUnit): boolean {
  const unitRadius = battleUnitMaxBaseRadiusInches(unit);
  const targetRadius = battleUnitMaxBaseRadiusInches(target);
  return unit.modelPositions.some(from =>
    target.modelPositions.some(to => hasLOSEdgeToEdge(from, unitRadius, to, targetRadius, state.terrain))
  );
}

function nearestValidEnemy(
  state: BattleState,
  unit: BattleUnit,
  predicate: (enemy: BattleUnit) => boolean,
): BattleUnit | null {
  const candidates = enemies(state, unit.side).filter(predicate);
  return candidates.reduce<BattleUnit | null>((best, enemy) => {
    if (!best) return enemy;
    return battleUnitsBaseEdgeDistance(unit, enemy) < battleUnitsBaseEdgeDistance(unit, best) ? enemy : best;
  }, null);
}

function unitIsEngaged(state: BattleState, unit: BattleUnit, rules: RulesEdition): boolean {
  return enemies(state, unit.side).some(enemy => distance(unit.position, enemy.position) <= rules.engagementRange());
}

function unitEligibleToShoot(state: BattleState, unit: BattleUnit, rules: RulesEdition): boolean {
  if (unit.destroyed || unit.embarkedInUnitId || unit.inStrategicReserves || unit.activated) return false;
  if (unit.fellBack || unit.movementAction === 'fellBack') return false;
  const advanced = unit.movementAction === 'advanced';
  const engaged = unitIsEngaged(state, unit, rules);
  const monsterOrVehicle = unitHasAnyKeyword(unit, ['Monster', 'Vehicle']);
  if (!unit.profile.weapons.some(weapon => !weapon.isMelee && weapon.range > 0)) {
    return !advanced && (!engaged || monsterOrVehicle);
  }
  return unit.profile.weapons.some(weapon =>
    !weapon.isMelee
    && weapon.range > 0
    && (!advanced || weapon.keywords.some(keyword => keyword.toLowerCase().startsWith('assault')))
    && (!engaged || monsterOrVehicle || weaponIsSidearm(weapon))
  );
}

function unitEligibleToFight(state: BattleState, unit: BattleUnit, rules: RulesEdition): boolean {
  return !unit.destroyed
    && !unit.embarkedInUnitId
    && !unit.inStrategicReserves
    && !unit.activated
    && unitIsEngaged(state, unit, rules)
    && unit.profile.weapons.some(weapon => weapon.isMelee);
}

function targetRestrictionsAllowed(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  target: BattleUnit,
  rules: RulesEdition,
): boolean {
  if (stratagem.targetKeywordsAny?.length && !unitHasAnyKeyword(target, stratagem.targetKeywordsAny)) return false;
  if (stratagem.targetForbiddenKeywordsAny?.length && unitHasAnyKeyword(target, stratagem.targetForbiddenKeywordsAny)) return false;
  if (
    stratagem.targetVehicleRequiresAnyKeywords?.length
    && unitHasKeyword(target, 'Vehicle')
    && !unitHasAnyKeyword(target, stratagem.targetVehicleRequiresAnyKeywords)
  ) return false;
  if (stratagem.targetMustBeInStrategicReserves && !target.inStrategicReserves) return false;
  if (!stratagem.targetMustBeInStrategicReserves && target.inStrategicReserves) return false;
  if (stratagem.targetMustBeUnengaged && unitIsEngaged(state, target, rules)) return false;
  if (stratagem.targetMustBeEngaged && !unitIsEngaged(state, target, rules)) return false;
  if (stratagem.targetMustBeEligibleToShoot && !unitEligibleToShoot(state, target, rules)) return false;
  if (stratagem.targetMustBeEligibleToFight && !unitEligibleToFight(state, target, rules)) return false;
  if (stratagem.targetMustHaveCharged && !target.charged) return false;
  if (stratagem.targetMustNotHaveAdvanced && target.movementAction === 'advanced') return false;
  if (
    stratagem.targetWithinEnemyDistance !== undefined
    && !enemies(state, side).some(enemy => distance(target.position, enemy.position) <= stratagem.targetWithinEnemyDistance!)
  ) return false;
  return true;
}

function targetAllowed(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  rules: RulesEdition,
  targetUnitId?: string,
): boolean {
  if (stratagem.target === 'none') return targetUnitId === undefined;
  const target = targetUnitFor(state, targetUnitId);
  if (!target) return false;
  if (stratagem.id !== 'insane-bravery' && !unitCanBeAffectedByStratagem(target)) return false;
  if (stratagem.target === 'friendly-unit' && target.side !== side) return false;
  if (stratagem.target === 'enemy-unit' && target.side === side) return false;
  if (!targetRestrictionsAllowed(state, side, stratagem, target, rules)) return false;
  return true;
}

function targetModelIndexAllowed(target: BattleUnit, stratagem: StratagemDefinition, targetModelIndex?: number): boolean {
  if (stratagem.id !== 'epic-challenge') return targetModelIndex === undefined;
  const index = targetModelIndex ?? 0;
  return Number.isInteger(index) && index >= 0 && !!target.modelPositions[index];
}

function applyInsaneBraveryStratagemEffect(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  targetUnitId?: string,
): void {
  if (stratagem.id !== 'insane-bravery') return;
  const unit = targetUnitFor(state, targetUnitId);
  if (!unit) return;

  unit.battleshocked = false;
  appendStratagemEffectLog(state, side, unit.profile.name, `${unit.profile.name} automatically passes its Battle-shock test.`, 'info');
}

function applyRapidIngressStratagemEffect(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  targetUnitId?: string,
): void {
  if (stratagem.id !== 'rapid-ingress') return;
  const unit = targetUnitFor(state, targetUnitId);
  if (!unit) return;

  unit.rapidIngressThisPhase = true;
  appendStratagemEffectLog(state, side, unit.profile.name, `${unit.profile.name} can be set up from Strategic Reserves this phase.`, 'info');
}

function applyHeroicInterventionStratagemEffect(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  targetUnitId?: string,
): void {
  if (stratagem.id !== 'heroic-intervention') return;
  const unit = targetUnitFor(state, targetUnitId);
  if (!unit) return;

  unit.heroicInterventionThisPhase = true;
  appendStratagemEffectLog(state, side, unit.profile.name, `${unit.profile.name} can declare a Heroic Intervention charge this phase.`, 'info');
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function applyCommandRerollStratagemEffect(
  state: BattleState,
  side: Side,
  use: StratagemUse,
): void {
  if (use.stratagemId !== 'command-reroll') return;
  state.pendingCommandReroll = {
    side,
    stratagemUseId: use.id,
    phase: state.phase,
    battleRound: battleRound(state),
    targetUnitId: use.targetUnitId,
  };
}

export function resolveCommandReroll(
  state: BattleState,
  side: Side,
  originalRolls: number[],
  options: { sides?: number; label?: string; rollType?: CommandRerollRollType } = {},
): BattleState {
  const pending = state.pendingCommandReroll;
  const sides = options.sides ?? 6;
  const rollType = options.rollType ?? 'hit';
  if (
    !pending
    || pending.side !== side
    || pending.phase !== state.phase
    || pending.battleRound !== battleRound(state)
    || originalRolls.length === 0
    || sides < 2
  ) return state;

  const next: BattleState = JSON.parse(JSON.stringify(state));
  const rerolls = originalRolls.map((roll, index) =>
    rollType === 'charge' || index === 0 ? rollDie(sides) : roll,
  );
  next.pendingCommandReroll = undefined;
  const label = options.label ?? 'roll';
  next.log = [...next.log, {
    id: nextLogId(next, 'command-reroll'),
    battleRound: battleRound(next),
    turn: battleRound(next),
    phase: next.phase,
    side,
    unitName: next.armies[side].name,
    message: `Command Re-roll ${label}: [${originalRolls.join(', ')}] -> [${rerolls.join(', ')}].`,
    type: 'roll',
  }];
  return next;
}

function applyMortalWoundStratagemEffect(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  targetUnitId?: string,
): void {
  if (stratagem.id !== 'explosives' && stratagem.id !== 'crushing-impact') return;
  const unit = targetUnitFor(state, targetUnitId);
  if (!unit) return;

  const enemy = stratagem.id === 'explosives'
    ? nearestValidEnemy(state, unit, candidate =>
        battleUnitsBaseEdgeDistance(unit, candidate) <= 8
        && unitHasVisibleLineToTarget(state, unit, candidate)
      )
    : stratagem.id === 'crushing-impact'
      ? nearestValidEnemy(state, unit, candidate =>
          battleUnitsBaseEdgeDistance(unit, candidate) <= 1
        )
      : null;
  if (!enemy) {
    appendStratagemEffectLog(state, side, unit.profile.name, `${stratagem.name} has no valid enemy target.`, 'info');
    return;
  }

  const rolls = rollMultiple(6);
  const mortalWounds = countSuccesses(rolls, 4);
  appendStratagemEffectLog(state, side, unit.profile.name, `${stratagem.name} targets ${enemy.profile.name}.`, 'info');
  appendStratagemEffectLog(state, side, unit.profile.name, `${stratagem.name} rolls: [${rolls.join(', ')}] -> ${mortalWounds} mortal wound(s).`, 'roll');
  if (mortalWounds > 0) {
    state.log = [
      ...state.log,
      ...applyDamage(enemy, mortalWounds, state, side, { deferCasualties: true, source: stratagem.name }),
    ];
  }
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
    && turnAllowed(state, side, stratagem)
    && battleRoundAllowed(state, stratagem)
    && canSpendCommandPoints(state, side, stratagem.cost)
    && !alreadyUsedThisPhase(state, side, stratagem)
    && !alreadyUsedThisBattle(state, side, stratagem)
    && !targetAlreadyUsedThisPhase(state, side, stratagem, targetUnitId)
    && (
      stratagem.target === 'none'
      || targetUnitId === undefined
      || targetAllowed(state, side, stratagem, rules, targetUnitId)
    )
  );
}

export function useStratagem(
  state: BattleState,
  side: Side,
  stratagemId: string,
  rules: RulesEdition,
  targetUnitId?: string,
  targetModelIndex?: number,
): BattleState {
  const stratagem = stratagemById(rules, stratagemId);
  if (!stratagem) return state;
  if (!phaseAllowed(stratagem, state.phase)) return state;
  if (!turnAllowed(state, side, stratagem)) return state;
  if (!battleRoundAllowed(state, stratagem)) return state;
  if (alreadyUsedThisPhase(state, side, stratagem)) return state;
  if (alreadyUsedThisBattle(state, side, stratagem)) return state;
  if (targetAlreadyUsedThisPhase(state, side, stratagem, targetUnitId)) return state;
  if (!targetAllowed(state, side, stratagem, rules, targetUnitId)) return state;
  const target = targetUnitFor(state, targetUnitId);
  if (stratagem.id === 'epic-challenge' && (!target || !targetModelIndexAllowed(target, stratagem, targetModelIndex))) return state;
  if (stratagem.id !== 'epic-challenge' && targetModelIndex !== undefined) return state;

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
    ...(stratagem.id === 'epic-challenge' ? { targetModelIndex: targetModelIndex ?? 0 } : {}),
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
  applyCommandRerollStratagemEffect(next, side, use);
  applyInsaneBraveryStratagemEffect(next, side, stratagem, targetUnitId);
  applyRapidIngressStratagemEffect(next, side, stratagem, targetUnitId);
  applyHeroicInterventionStratagemEffect(next, side, stratagem, targetUnitId);
  applyMortalWoundStratagemEffect(next, side, stratagem, targetUnitId);
  return next;
}
