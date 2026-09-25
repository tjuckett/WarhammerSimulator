import { PHASE_STEP, type BattleState, type BattleUnit, type CombatRerollSelection, type Phase, type Side } from '../types/battle';
import type { CommandRerollRollType, HeroicInterventionMode, StratagemDefinition, StratagemUse } from '../types/stratagem';
import type { RuleEffect } from '../types/ruleEffects';
import { battleRound } from './battleRound';
import { clone } from './clone';
import { canSpendCommandPoints, spendCommandPoints } from './commandPoints';
import { unitCanBeAffectedByStratagem } from './battleshock';
import { resolveBattleshockUnit } from './battleshockPhase';
import { countSuccesses, rollMultiple } from './dice';
import { hasLOSEdgeToEdge } from './terrainGeometry';
import { battleUnitMaxBaseRadiusInches } from './baseSizes';
import { applyDamage, battleModelBaseEdgeDistance, battleUnitsBaseEdgeDistance } from './simulator';
import type { RulesEdition } from './rulesEngine';
import { unitHasRule } from './armyUnits';
import { attachedUnitComponents } from './attachedUnits';
import { resolveRuleEffects } from './ruleEffects';

let _stratagemUseId = 0;

function stratagemById(rules: RulesEdition, stratagemId: string): StratagemDefinition | null {
  return rules.stratagems.find(stratagem => stratagem.id === stratagemId) ?? null;
}

function nextLogId(state: BattleState, prefix: string): string {
  return `${prefix}-${state.log.length + 1}`;
}

function phaseAllowed(stratagem: StratagemDefinition, phase: Phase): boolean {
  return stratagem.phases === 'any' || stratagem.phases.includes(phase);
}

function phaseStepAllowed(state: BattleState, stratagem: StratagemDefinition): boolean {
  if (!stratagem.phaseSteps?.length || state.phaseStep === undefined) {
    // Older saved states only carry movementStep/fightStepStarted. Keep those
    // states legal while newer states use the canonical phase-step field.
    return true;
  }
  return stratagem.phaseSteps.includes(state.phaseStep);
}

function timingAllowed(state: BattleState, stratagem: StratagemDefinition, side: Side): boolean {
  if (!phaseStepAllowed(state, stratagem)) return false;
  if (stratagem.phaseSteps?.includes(PHASE_STEP.MovementReinforcements)
    && state.phase === 'movement'
    && state.phaseStep === undefined
    && state.movementStep !== 'reinforcements') return false;
  if (stratagem.requiresOpponentFightSelection) {
    return state.phase === 'fight'
      && state.fightStepStarted === true
      && state.activeAttachedFightUnitId === undefined
      && state.lastFightSelectionSide !== undefined
      && state.lastFightSelectionSide !== side;
  }
  return true;
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
    return normalized.startsWith('pistol') || normalized.startsWith('sidearm') || normalized.startsWith('close-quarters');
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

function unitIsEngaged(state: BattleState, unit: BattleUnit, rules: RulesEdition): boolean {
  return enemies(state, unit.side).some(enemy => battleUnitsBaseEdgeDistance(unit, enemy) <= rules.engagementRange());
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
    && unitIsEngaged(state, unit, rules);
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
  if (stratagem.targetMustNotHaveFired && (target.firedWeaponIndices?.length ?? 0) > 0) return false;
  if (stratagem.targetMustBeEligibleToFight && !unitEligibleToFight(state, target, rules)) return false;
  if (stratagem.requiresFightStepStarted && state.phase === 'fight' && state.fightStepStarted !== true) return false;
  if (stratagem.targetMustHaveCharged && !target.charged) return false;
  if (stratagem.targetMustNotHaveAdvanced && target.movementAction === 'advanced') return false;
  if (
    stratagem.targetMustBeBattleshockEligible
    && !target.battleshocked
    && !state.battleshockEligibleUnitIds?.includes(target.id)
  ) return false;
  if (
    stratagem.targetWithinEnemyDistance !== undefined
    && !enemies(state, side).some(enemy => battleUnitsBaseEdgeDistance(target, enemy) <= stratagem.targetWithinEnemyDistance!)
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
  if (!stratagem.targetMayBeBattleshocked && !unitCanBeAffectedByStratagem(target)) return false;
  if (stratagem.target === 'friendly-unit' && target.side !== side) return false;
  if (stratagem.target === 'enemy-unit' && target.side === side) return false;
  if (!targetRestrictionsAllowed(state, side, stratagem, target, rules)) return false;
  return true;
}

function targetModelIndexAllowed(target: BattleUnit, stratagem: StratagemDefinition, targetModelIndex?: number): boolean {
  const requirement = stratagem.selection?.targetModel ?? 'forbidden';
  if (requirement === 'forbidden') return targetModelIndex === undefined;
  if (requirement === 'optional' && targetModelIndex === undefined) return true;
  const index = targetModelIndex ?? 0;
  return Number.isInteger(index) && index >= 0 && !!target.modelPositions[index];
}

function heroicInterventionModeAllowed(stratagem: StratagemDefinition, mode?: HeroicInterventionMode): boolean {
  const requirement = stratagem.selection?.heroicInterventionMode ?? 'forbidden';
  if (requirement === 'required' && mode === undefined) return false;
  if (requirement === 'forbidden' && mode !== undefined) return false;
  return mode === undefined
    || !stratagem.selection?.heroicInterventionModes?.length
    || stratagem.selection.heroicInterventionModes.includes(mode);
}

function sourceModelIndexAllowed(source: BattleUnit | null, stratagem: StratagemDefinition, sourceModelIndex?: number): boolean {
  const requirement = stratagem.selection?.sourceModel ?? 'forbidden';
  if (requirement === 'forbidden') return sourceModelIndex === undefined;
  if (sourceModelIndex === undefined) return requirement !== 'required';
  if (!source) return false;
  return Number.isInteger(sourceModelIndex)
    && sourceModelIndex! >= 0
    && !!source.modelPositions[sourceModelIndex!];
}

export function explosivesTargetAllowed(
  state: BattleState,
  source: BattleUnit,
  target: BattleUnit,
  sourceModelIndex: number,
  rules: RulesEdition,
): boolean {
  const sourcePosition = source.modelPositions[sourceModelIndex];
  if (!sourcePosition || target.side === source.side || target.destroyed || target.embarkedInUnitId || target.inStrategicReserves) return false;
  if (unitIsEngaged(state, target, rules)) return false;
  return target.modelPositions.some(targetPosition =>
    battleUnitsBaseEdgeDistance(source, target) <= 8
      && hasLOSEdgeToEdge(
        sourcePosition,
        battleUnitMaxBaseRadiusInches(source),
        targetPosition,
        battleUnitMaxBaseRadiusInches(target),
        state.terrain,
        rules.metadata.edition,
      )
  );
}

function secondaryTargetAllowed(
  state: BattleState,
  side: Side,
  stratagem: StratagemDefinition,
  source: BattleUnit | null,
  secondaryTargetUnitId: string | undefined,
  sourceModelIndex: number | undefined,
  rules: RulesEdition,
): boolean {
  const requirement = stratagem.selection?.secondaryTarget ?? 'forbidden';
  if (requirement === 'forbidden') return secondaryTargetUnitId === undefined;
  if (!secondaryTargetUnitId) return requirement !== 'required';
  if (!source) return false;
  const target = targetUnitFor(state, secondaryTargetUnitId);
  const mortalEffect = stratagem.effects?.find((effect): effect is Extract<RuleEffect, { type: 'deal-mortal-wounds' }> =>
    effect.type === 'deal-mortal-wounds',
  );
  if (mortalEffect?.secondaryTargetValidation === 'visible-enemy-within-8') {
    return sourceModelIndex !== undefined
      && !!target
      && explosivesTargetAllowed(state, source, target, sourceModelIndex, rules);
  }
  if (mortalEffect?.secondaryTargetValidation !== 'engaged-enemy' || !target) return false;
  if (sourceModelIndex !== undefined) {
    return target.modelPositions.some((_position, targetModelIndex) =>
      battleModelBaseEdgeDistance(source, sourceModelIndex, target, targetModelIndex) <= rules.engagementRange(),
    );
  }
  return !!target
    && target.side !== side
    && battleUnitsBaseEdgeDistance(source, target) <= rules.engagementRange();
}

function firstEngagedModelIndex(source: BattleUnit, target: BattleUnit, rules: RulesEdition): number | undefined {
  for (let sourceModelIndex = 0; sourceModelIndex < source.modelPositions.length; sourceModelIndex++) {
    if (target.modelPositions.some((_targetPosition, targetModelIndex) =>
      battleModelBaseEdgeDistance(source, sourceModelIndex, target, targetModelIndex) <= rules.engagementRange(),
    )) return sourceModelIndex;
  }
  return undefined;
}

function modelToughness(source: BattleUnit, modelIndex: number): number {
  const rosterIndex = source.modelRosterIndexes?.[modelIndex] ?? modelIndex;
  let offset = 0;
  for (const profile of source.profile.modelProfiles ?? []) {
    if (rosterIndex < offset + profile.count) return profile.toughness;
    offset += profile.count;
  }
  return source.profile.toughness;
}

function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function resolveCommandReroll(
  state: BattleState,
  side: Side,
  originalRolls: number[],
  options: { sides?: number; label?: string; rollType?: CommandRerollRollType; combatRoll?: CombatRerollSelection; rules?: RulesEdition; rollUnitId?: string } = {},
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

  const next: BattleState = clone(state);
  const rerolls = originalRolls.map((roll, index) =>
    rollType === 'charge' || rollType === 'leadership' || index === 0 ? rollDie(sides) : roll,
  );
  const combatRoll = options.combatRoll;
  let combatRollApplied = !combatRoll;
  if (!combatRoll && rollType === 'advance') {
    const requestedUnitId = options.rollUnitId ?? pending.targetUnitId;
    const requestedUnit = next.units?.find(unit => unit.id === requestedUnitId && unit.side === side && !unit.destroyed);
    const rootUnit = requestedUnit?.attachedToUnitId
      ? next.units?.find(unit => unit.id === requestedUnit.attachedToUnitId && unit.side === side && !unit.destroyed)
      : requestedUnit;
    const originalAdvanceRoll = rootUnit?.advanceRoll;
    if (!rootUnit || originalAdvanceRoll === undefined
      || rootUnit.profile.movementOverrides?.advanceRoll === 'auto6'
      || originalRolls.length !== 1
      || originalRolls[0] !== originalAdvanceRoll) return state;
    const nextAdvanceRoll = rerolls[0];
    const delta = nextAdvanceRoll - originalAdvanceRoll;
    rootUnit.advanceRoll = nextAdvanceRoll;
    for (const component of attachedUnitComponents(next, rootUnit)) {
      if (component.movementAction !== 'advanced') continue;
      if (component.movementAllowanceRemainingByModel) {
        component.movementAllowanceRemainingByModel = component.movementAllowanceRemainingByModel
          .map(allowance => Math.max(0, allowance + delta));
      }
      if (component.movementAllowanceTotalByModel) {
        component.movementAllowanceTotalByModel = component.movementAllowanceTotalByModel
          .map(allowance => Math.max(0, allowance + delta));
      }
      if (typeof component.movementAllowanceRemaining === 'number') {
        component.movementAllowanceRemaining = Math.max(0, component.movementAllowanceRemaining + delta);
      }
      const remaining = component.movementAllowanceRemainingByModel
        ?? (typeof component.movementAllowanceRemaining === 'number' ? [component.movementAllowanceRemaining] : []);
      component.movementComplete = remaining.length > 0 && remaining.every(allowance => allowance <= 0.001);
    }
  }
  if (!combatRoll && rollType === 'charge') {
    const charge = next.chargeResolution;
    const pendingCharge = next.pendingChargeRoll;
    const originalDice = charge?.dice;
    if (!charge || charge.status === 'resolved' || (!pendingCharge && charge.status !== 'failed')
      || originalRolls.length !== 2
      || !originalDice
      || originalRolls.some((roll, index) => roll !== originalDice[index])) return state;
    const rawTotal = rerolls[0] + rerolls[1];
    // Heroic Intervention's Into the Fray caps the charge roll at 6. The
    // existing maximum distance already includes Take to the Skies costs, so
    // update it by the change in the capped total rather than recomputing the
    // movement modifier here.
    const wasCapped = charge.total !== charge.rawTotal;
    const total = wasCapped ? Math.min(6, rawTotal) : rawTotal;
    next.chargeResolution = {
      ...charge,
      dice: [rerolls[0], rerolls[1]],
      rawTotal,
      total,
      maximumDistance: Math.max(0, charge.maximumDistance + total - charge.total),
    };
    const maximumDistance = Math.max(0, charge.maximumDistance + total - charge.total);
    next.pendingChargeRoll = {
      ...(pendingCharge ?? { unitId: charge.unitId, side: charge.side }),
      maximumDistance,
    };
    if (charge.status === 'failed') {
      const chargeUnit = next.units?.find(unit => unit.id === charge.unitId && unit.side === charge.side && !unit.destroyed);
      if (!chargeUnit) return state;
      for (const component of attachedUnitComponents(next, chargeUnit)) {
        component.activated = false;
        if (charge.heroicInterventionMode) {
          component.heroicInterventionThisPhase = true;
          component.heroicInterventionMode = charge.heroicInterventionMode;
        }
      }
      next.chargeResolution = {
        ...next.chargeResolution,
        maximumDistance,
        status: 'pending-target',
        failureReason: undefined,
      };
      next.pendingChargeMovement = undefined;
    }
  }
  if (!combatRoll && rollType === 'leadership') {
    const result = next.battleshockResults?.find(candidate => candidate.unitId === options.rollUnitId);
    const unit = result ? next.units?.find(candidate => candidate.id === result.unitId && !candidate.destroyed) : undefined;
    if (!result || !unit || result.automaticallyPassed || !result.dice
      || originalRolls.length !== 2
      || originalRolls.some((roll, index) => roll !== result.dice?.[index])) return state;
    const dice: [number, number] = [rerolls[0], rerolls[1]];
    const total = dice[0] + dice[1];
    const passed = total >= result.needed;
    result.dice = dice;
    result.total = total;
    result.passed = passed;
    for (const component of next.units.filter(candidate =>
      candidate.side === unit.side
      && (candidate.id === unit.id || candidate.attachedToUnitId === unit.id || unit.attachedToUnitId === candidate.id),
    )) component.battleshocked = !passed;
  }
  const combatStageForGroup = combatRoll?.groupKind === 'hit'
    ? 'hits'
    : combatRoll?.groupKind === 'wound'
      ? 'wounds'
      : combatRoll?.groupKind === 'save'
        ? 'saves'
        : combatRoll?.groupKind === 'damage'
          ? 'damage'
          : undefined;
  if (combatRoll && next.pendingCombatResolution
    && next.pendingCombatResolution.kind === combatRoll.kind
    && next.pendingCombatResolution.attackerUnitId === combatRoll.attackerUnitId
    && combatStageForGroup
    && next.pendingCombatResolution.stage === combatStageForGroup) {
    const pendingCombat = next.pendingCombatResolution;
    const activeContinuationMatches = pendingCombat.weaponIndex === combatRoll.weaponIndex
      && pendingCombat.targetUnitId === combatRoll.targetUnitId;
    const queuedContinuationIndex = activeContinuationMatches
      ? -1
      : (pendingCombat.continuationQueue ?? []).findIndex(entry =>
        entry.weaponIndex === combatRoll.weaponIndex && entry.targetUnitId === combatRoll.targetUnitId,
      );
    const continuation = activeContinuationMatches
      ? pendingCombat.continuation
      : queuedContinuationIndex >= 0
        ? pendingCombat.continuationQueue?.[queuedContinuationIndex]?.continuation
        : undefined;
    if (!continuation) return state;
    const result = next.lastShootingResolution?.weapons.find(weapon =>
      weapon.weaponIndex === combatRoll.weaponIndex && weapon.targetUnitId === combatRoll.targetUnitId,
    );
    const group = result?.groups[combatRoll.groupIndex];
    const attacker = next.units?.find(unit => unit.id === combatRoll.attackerUnitId && !unit.destroyed);
    const baseWeapon = attacker?.profile.weapons[combatRoll.weaponIndex];
    if (group?.kind === combatRoll.groupKind
      && group.rolls[combatRoll.rollIndex] !== undefined
      && originalRolls.length === 1
      && originalRolls[0] === group.rolls[combatRoll.rollIndex]) {
      const previousRolls = [...group.rolls];
      const groupTarget = group.target;
      const previousSuccesses = group.successes ?? (groupTarget === undefined
        ? 0
        : group.rolls.filter(roll => roll >= groupTarget).length);
      group.rolls[combatRoll.rollIndex] = rerolls[0];
      group.rerolledRollIndices = [...new Set([...(group.rerolledRollIndices ?? []), combatRoll.rollIndex])];

      if (group.kind === 'damage') {
        // Damage groups are linked to the deferred packet they created. Only
        // variable damage expressions are exposed in the popup; fixed damage
        // has no meaningful die to reroll.
        if (!baseWeapon || /^\d+$/i.test(String(baseWeapon.damage).trim())) return state;
        // A bodyguard can be destroyed before its remaining packet transfers
        // to a Leader. Search every component so the typed combat-result link
        // remains valid across that transfer.
        const packetMatchesCombatGroup = (packet: NonNullable<BattleUnit['pendingDamageAllocations']>[number]) =>
          packet.combatResult?.weaponIndex === combatRoll.weaponIndex
          && packet.combatResult.groupIndex === combatRoll.groupIndex;
        const directOwner = next.units?.find(unit => unit.id === combatRoll.targetUnitId
          && unit.pendingDamageAllocations?.some(packetMatchesCombatGroup));
        const relatedOwner = next.units?.find(unit =>
          (unit.id === combatRoll.targetUnitId
            || unit.attachedToUnitId === combatRoll.targetUnitId
            || next.units?.some(candidate => candidate.id === combatRoll.targetUnitId && candidate.attachedToUnitId === unit.id))
          && unit.pendingDamageAllocations?.some(packetMatchesCombatGroup),
        );
        const allocationOwner = directOwner ?? relatedOwner;
        const allocation = allocationOwner?.pendingDamageAllocations?.find(packet =>
          packetMatchesCombatGroup(packet),
        );
        if (!allocation) return state;
        const expressionBonus = previousSuccesses - previousRolls.reduce((total, roll) => total + roll, 0);
        const rerolledDamage = Math.max(1, group.rolls.reduce((total, roll) => total + roll, 0) + expressionBonus);
        group.successes = rerolledDamage;
        allocation.damage = Math.max(1, allocation.damage + rerolledDamage - previousSuccesses);
        pendingCombat.rolls = [...group.rolls];
        combatRollApplied = true;
      } else {
        const rules = options.rules;
        const weapon = baseWeapon && continuation.weaponKeywords
          ? { ...baseWeapon, keywords: [...continuation.weaponKeywords] }
          : baseWeapon;
        const target = groupTarget;
        const oldHitResult = group.kind === 'hit' && rules && weapon
          ? rules.processHits(previousRolls, target ?? 6, weapon)
          : undefined;
        const oldWoundResult = group.kind === 'wound' && rules && weapon && target !== undefined
          ? rules.processWounds(previousRolls, target, weapon)
          : undefined;
        const newHitResult = group.kind === 'hit' && rules && weapon
          ? rules.processHits(group.rolls, target ?? 6, weapon)
          : undefined;
        const newWoundResult = group.kind === 'wound' && rules && weapon && target !== undefined
          ? rules.processWounds(group.rolls, target, weapon)
          : undefined;
        group.successes = newHitResult?.hits
          ?? newWoundResult?.wounds
          ?? (target === undefined ? group.successes : group.rolls.filter(roll => roll >= target).length);
        if (group.kind === 'hit') {
          continuation.hits += (group.successes ?? 0) - previousSuccesses;
          group.bonusHits = newHitResult?.bonusHits;
          if (weapon && rules) {
            const hitGroups = result?.groups.filter(candidate => candidate.kind === 'hit') ?? [];
            continuation.lethalAutoWounds = weapon.keywords.some(keyword => keyword.toLowerCase().startsWith('lethal hits'))
              ? hitGroups.reduce((total, candidate) => total + candidate.rolls.filter(roll => roll === 6).length, 0)
              : continuation.lethalAutoWounds;
            continuation.totalMortals += (newHitResult?.mortalsFromCrits ?? 0) - (oldHitResult?.mortalsFromCrits ?? 0);
          }
        }
        if (group.kind === 'wound') {
          continuation.wounds = (continuation.wounds ?? 0) + (group.successes ?? 0) - previousSuccesses;
          continuation.devastatingWounds += (newWoundResult?.devastatingWounds ?? 0) - (oldWoundResult?.devastatingWounds ?? 0);
          continuation.totalMortals += (newWoundResult?.mortalsFromCrits ?? 0) - (oldWoundResult?.mortalsFromCrits ?? 0);
        }
        if (group.kind === 'save') {
          const previousUnsaved = group.noSave
            ? previousSuccesses
            : previousRolls.length - previousSuccesses;
          const rerolledSaved = target === undefined ? group.successes ?? 0 : group.rolls.filter(roll => roll >= target).length;
          group.successes = rerolledSaved;
          const rerolledUnsaved = group.noSave ? rerolledSaved : group.rolls.length - rerolledSaved;
          continuation.unsaved = (continuation.unsaved ?? 0) + rerolledUnsaved - previousUnsaved;
        }
        if (activeContinuationMatches) pendingCombat.rolls = [...group.rolls];
        combatRollApplied = true;
      }
      if (result) {
        result.hits = result.groups.filter(candidate => candidate.kind === 'hit')
          .reduce((total, candidate) => total + (candidate.successes ?? 0), 0);
        result.wounds = result.groups.filter(candidate => candidate.kind === 'wound')
          .reduce((total, candidate) => total + (candidate.successes ?? 0), 0);
        result.unsavedWounds = result.groups.filter(candidate => candidate.kind === 'save')
          .reduce((total, candidate) => total + (candidate.noSave
            ? (candidate.successes ?? 0)
            : candidate.rolls.length - (candidate.successes ?? 0)), 0);
      }
    }
  }
  if (!combatRollApplied) return state;
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

function applyMortalWoundEffect(
  state: BattleState,
  side: Side,
  sourceName: string,
  effect: Extract<RuleEffect, { type: 'deal-mortal-wounds' }>,
  rules: RulesEdition,
  targetUnitId?: string,
  secondaryTargetUnitId?: string,
  sourceModelIndex?: number,
): void {
  const unit = targetUnitFor(state, targetUnitId);
  if (!unit) return;

  const enemy = targetUnitFor(state, secondaryTargetUnitId);
  if (!enemy) {
    appendStratagemEffectLog(state, side, unit.profile.name, `${sourceName} has no valid enemy target.`, 'info');
    return;
  }

  const selectedModelIndex = effect.dice.type === 'source-model-toughness'
    ? sourceModelIndex ?? firstEngagedModelIndex(unit, enemy, rules) ?? 0
    : undefined;
  const diceCount = effect.dice.type === 'source-model-toughness'
    ? Math.min(effect.dice.max, Math.max(0, Math.floor(modelToughness(unit, selectedModelIndex!))))
    : effect.dice.count;
  const rolls = rollMultiple(diceCount);
  const mortalWounds = countSuccesses(rolls, effect.successOn);
  const returnedMortalWounds = effect.selfDamageOn
    ? rolls.filter(roll => roll === effect.selfDamageOn?.roll).length
    : 0;
  appendStratagemEffectLog(state, side, unit.profile.name,
    `${sourceName} targets ${enemy.profile.name}${selectedModelIndex === undefined ? '' : ` using model ${selectedModelIndex + 1}`}.`,
    'info');
  appendStratagemEffectLog(state, side, unit.profile.name, `${sourceName} rolls: [${rolls.join(', ')}] -> ${mortalWounds} mortal wound(s).`, 'roll');
  if (mortalWounds > 0) {
    state.log = [
      ...state.log,
      ...applyDamage(enemy, mortalWounds, state, side, { deferCasualties: true, source: sourceName }),
    ];
  }
  if (returnedMortalWounds > 0 && effect.selfDamageOn?.target === 'source-unit') {
    state.log = [
      ...state.log,
      ...applyDamage(unit, returnedMortalWounds, state, enemy.side, { deferCasualties: true, source: sourceName }),
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
    && timingAllowed(state, stratagem, side)
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
  secondaryTargetUnitId?: string,
  sourceModelIndex?: number,
  heroicInterventionMode?: HeroicInterventionMode,
): BattleState {
  const stratagem = stratagemById(rules, stratagemId);
  if (!stratagem) return state;
  if (!phaseAllowed(stratagem, state.phase)) return state;
  if (!timingAllowed(state, stratagem, side)) return state;
  if (!heroicInterventionModeAllowed(stratagem, heroicInterventionMode)) return state;
  if (!turnAllowed(state, side, stratagem)) return state;
  if (!battleRoundAllowed(state, stratagem)) return state;
  if (alreadyUsedThisPhase(state, side, stratagem)) return state;
  if (alreadyUsedThisBattle(state, side, stratagem)) return state;
  if (targetAlreadyUsedThisPhase(state, side, stratagem, targetUnitId)) return state;
  if (!targetAllowed(state, side, stratagem, rules, targetUnitId)) return state;
  const target = targetUnitFor(state, targetUnitId);
  if (targetModelIndex !== undefined && (!target || !targetModelIndexAllowed(target, stratagem, targetModelIndex))) return state;
  if (target && !targetModelIndexAllowed(target, stratagem, targetModelIndex)) return state;
  if (!target && targetModelIndex !== undefined) return state;
  const secondaryTarget = targetUnitFor(state, secondaryTargetUnitId);
  const mortalEffect = stratagem.effects?.find((effect): effect is Extract<RuleEffect, { type: 'deal-mortal-wounds' }> =>
    effect.type === 'deal-mortal-wounds',
  );
  const effectiveSourceModelIndex = mortalEffect?.dice.type === 'source-model-toughness'
    ? sourceModelIndex ?? (target && secondaryTarget ? firstEngagedModelIndex(target, secondaryTarget, rules) : undefined)
    : sourceModelIndex;
  if (!sourceModelIndexAllowed(target, stratagem, effectiveSourceModelIndex)) return state;
  if (!secondaryTargetAllowed(state, side, stratagem, target, secondaryTargetUnitId, effectiveSourceModelIndex, rules)) return state;

  const next: BattleState = clone(state);
  const commandPointsSpent = stratagem.cost
    + (heroicInterventionMode ? (stratagem.choiceCosts?.[heroicInterventionMode] ?? 0) : 0);
  if (!spendCommandPoints(next, side, commandPointsSpent)) return state;

  const targetModelRequirement = stratagem.selection?.targetModel ?? 'forbidden';
  const recordedTargetModelIndex = targetModelRequirement === 'required'
    ? targetModelIndex ?? 0
    : targetModelIndex;

  const use: StratagemUse = {
    id: `stratagem-${++_stratagemUseId}`,
    stratagemId: stratagem.id,
    name: stratagem.name,
    side,
    phase: next.phase,
    battleRound: battleRound(next),
    targetUnitId,
    ...(recordedTargetModelIndex !== undefined ? { targetModelIndex: recordedTargetModelIndex } : {}),
    ...(secondaryTargetUnitId ? { secondaryTargetUnitId } : {}),
    ...(effectiveSourceModelIndex !== undefined ? { sourceModelIndex: effectiveSourceModelIndex } : {}),
    ...(heroicInterventionMode ? { heroicInterventionMode } : {}),
    commandPointsSpent,
  };
  next.stratagemUses = [...(next.stratagemUses ?? []), use];
  next.log = [...next.log, {
    id: nextLogId(next, 'stratagem'),
    battleRound: battleRound(next),
    turn: battleRound(next),
    phase: next.phase,
    side,
    unitName: next.armies[side].name,
    message: `${next.armies[side].name} uses ${stratagem.name} for ${commandPointsSpent}CP.`,
    type: 'info',
  }];
  const effectContext = {
    state: next,
    side,
    sourceRuleId: stratagem.id,
    sourceName: stratagem.name,
    sourceUseId: use.id,
    sourceUnitId: targetUnitId,
    targetUnitId,
    secondaryTargetUnitId,
    targetModelIndex: recordedTargetModelIndex,
    sourceModelIndex: effectiveSourceModelIndex,
    heroicInterventionMode,
  };
  resolveRuleEffects(effectContext, stratagem.effects);
  // Insane Bravery replaces this unit's current Battle-shock test. Resolve
  // the typed step action immediately so the player is not asked to press a
  // Roll button merely to record an automatic pass.
  if (stratagem.id === 'insane-bravery'
    && targetUnitId
    && next.phase === 'command'
    && next.phaseStep === PHASE_STEP.CommandBattleShock) {
    const resolution = resolveBattleshockUnit(next, side, targetUnitId);
    if (resolution) next.log = [...next.log, resolution.log];
  }
  for (const effect of stratagem.effects ?? []) {
    if (effect.type !== 'deal-mortal-wounds') continue;
    applyMortalWoundEffect(
      next,
      side,
      stratagem.name,
      effect,
      rules,
      targetUnitId,
      secondaryTargetUnitId,
      effectiveSourceModelIndex,
    );
  }
  return next;
}
