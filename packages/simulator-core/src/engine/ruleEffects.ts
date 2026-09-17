import type {
  BattleState,
  BattleUnit,
  LogType,
  Side,
} from '../types/battle';
import type { HeroicInterventionMode } from '../types/stratagem';
import type {
  ActiveRuleEffect,
  ActiveModifierEffect,
  RuleEffect,
} from '../types/ruleEffects';
import { battleRound } from './battleRound';
import { attachedUnitComponents } from './attachedUnits';
import { d3 } from './dice';
import { BATTLE_EVENT_TYPE, recordBattleEvent } from './battleEvents';
import { queueEventRequest } from './eventTriggers';
import { openPendingCombatAction } from './combatActionWindows';

export interface RuleEffectContext {
  state: BattleState;
  side: Side;
  sourceRuleId: string;
  sourceName: string;
  sourceUseId?: string;
  sourceUnitId?: string;
  targetUnitId?: string;
  secondaryTargetUnitId?: string;
  targetModelIndex?: number;
  sourceModelIndex?: number;
  heroicInterventionMode?: HeroicInterventionMode;
}

function nextLogId(state: BattleState, prefix: string): string {
  // Battle logs are append-only; deriving the suffix from their length avoids
  // allocating and scanning a Set for every rule-effect message.
  return `${prefix}-${state.log.length + 1}`;
}

function appendEffectLog(
  state: BattleState,
  side: Side,
  unitName: string,
  message: string,
  type: LogType = 'info',
): void {
  state.log = [...state.log, {
    id: nextLogId(state, type === 'info' ? 'ability' : type),
    battleRound: battleRound(state),
    turn: battleRound(state),
    phase: state.phase,
    side,
    unitName,
    message,
    type,
  }];
}

function unitFor(state: BattleState, unitId: string | undefined): BattleUnit | undefined {
  if (!unitId) return undefined;
  return state.units.find(unit => unit.id === unitId && !unit.destroyed && !unit.embarkedInUnitId);
}

function unitForTarget(context: RuleEffectContext, target: 'source-unit' | 'target-unit' | 'secondary-target-unit'): BattleUnit | undefined {
  const unitId = target === 'source-unit'
    ? context.sourceUnitId
    : target === 'target-unit'
      ? context.targetUnitId
      : context.secondaryTargetUnitId;
  return unitFor(context.state, unitId);
}

function activeModifierId(context: RuleEffectContext, effectIndex: number): string {
  return `${context.sourceUseId ?? context.sourceRuleId}-effect-${effectIndex}`;
}

function addActiveModifier(
  context: RuleEffectContext,
  effect: ActiveModifierEffect,
  effectIndex: number,
): void {
  const target = unitForTarget(context, effect.target);
  const active: ActiveRuleEffect = {
    id: activeModifierId(context, effectIndex),
    sourceRuleId: context.sourceRuleId,
    sourceUseId: context.sourceUseId,
    side: context.side,
    sourceUnitId: context.sourceUnitId,
    targetUnitId: target?.id ?? context.targetUnitId,
    targetModelIndex: context.targetModelIndex,
    createdAt: {
      battleRound: battleRound(context.state),
      turn: context.state.turn,
      phase: context.state.phase,
      phaseStep: context.state.phaseStep,
    },
    effect,
  };
  const existing = context.state.activeRuleEffects ?? [];
  if (existing.some(candidate => candidate.id === active.id)) return;
  context.state.activeRuleEffects = [...existing, active];
}

function applyRuleEffect(context: RuleEffectContext, effect: RuleEffect, effectIndex: number): void {
  const { state, side, sourceName } = context;
  switch (effect.type) {
    case 'activate-army-ability': {
      const active = state.activeArmyAbilities ?? [[], []];
      active[side] = [...new Set([...active[side], effect.abilityId])];
      state.activeArmyAbilities = active;
      return;
    }
    case 'restore-wounds': {
      const unit = unitForTarget(context, effect.target);
      if (!unit || unit.remainingModels <= 0 || unit.woundsOnLeadModel >= unit.profile.wounds) return;
      const amount = effect.amount === 'D3' ? d3() : effect.amount;
      const maximum = effect.maximum === 'model-wounds' || effect.maximum === undefined
        ? unit.profile.wounds
        : effect.maximum;
      unit.woundsOnLeadModel = Math.min(maximum, unit.woundsOnLeadModel + amount);
      return;
    }
    case 'move-to-strategic-reserves': {
      const unit = unitForTarget(context, effect.target);
      if (!unit) return;
      const reservePosition = {
        x: side === 0 ? -100 : (state.board?.width ?? 60) + 100,
        y: (state.board?.height ?? 44) / 2,
      };
      for (const component of attachedUnitComponents(state, unit, true)) {
        component.inStrategicReserves = true;
        component.repositioned = true;
        if (effect.grantDeepStrikeUntil) component.deepStrikeUntilPhase = state.phase;
        component.modelPositions = component.modelPositions.map(() => ({ ...reservePosition }));
        component.position = { ...reservePosition };
      }
      return;
    }
    case 'clear-battleshock': {
      const unit = unitForTarget(context, effect.target);
      if (!unit) return;
      unit.battleshocked = false;
      if (effect.log === 'automatic-battle-shock-pass') {
        appendEffectLog(state, side, unit.profile.name, `${unit.profile.name} automatically passes its Battle-shock test.`);
      }
      return;
    }
    case 'create-command-reroll': {
      const target = effect.target ? unitForTarget(context, effect.target) : undefined;
      state.pendingCommandReroll = {
        side,
        stratagemUseId: context.sourceUseId ?? context.sourceRuleId,
        phase: state.phase,
        battleRound: battleRound(state),
        targetUnitId: target?.id,
      };
      return;
    }
    case 'open-event-request': {
      const unit = unitForTarget(context, effect.target);
      const data = {
        ...(effect.data ?? {}),
        unitId: unit?.id ?? context.targetUnitId ?? context.sourceUnitId,
        stratagemId: context.sourceRuleId,
      };
      const event = recordBattleEvent(state, {
        type: BATTLE_EVENT_TYPE.RuleTriggered,
        side,
        source: sourceName,
        data: {
          triggerTiming: effect.timing,
          rule: effect.requestKind,
          ...data,
        },
      });
      queueEventRequest(state, effect.triggerId ?? `${context.sourceRuleId}-${effectIndex}`, event, {
        kind: effect.requestKind,
        side,
        timing: effect.timing,
        source: sourceName,
        data,
      });
      if (effect.log === 'ingress-opportunity' && unit) {
        appendEffectLog(state, side, unit.profile.name, `${unit.profile.name} can be set up from Strategic Reserves this phase.`);
      }
      return;
    }
    case 'open-combat-action': {
      const unit = unitForTarget(context, effect.target);
      if (!unit) return;
      const event = recordBattleEvent(state, {
        type: BATTLE_EVENT_TYPE.RuleTriggered,
        side,
        source: sourceName,
        data: {
          triggerTiming: 'rule-triggered',
          rule: 'combat-action-window',
          combatAction: effect.kind,
          unitId: unit.id,
          stratagemId: context.sourceRuleId,
        },
      });
      openPendingCombatAction(state, {
        id: `combat-action-${event.id}`,
        kind: effect.kind,
        unitId: unit.id,
        side,
        source: sourceName,
        triggeredPhase: state.phase,
        triggeredPhaseStep: state.phaseStep,
        sourceEventId: event.id,
        allowActivated: effect.allowActivated,
        snapShooting: effect.snapShooting,
      });
      appendEffectLog(state, side, unit.profile.name, `${unit.profile.name} has an event-backed Snap Shooting opportunity.`);
      return;
    }
    case 'set-unit-flag': {
      const unit = unitForTarget(context, effect.target);
      if (!unit) return;
      if (effect.flag === 'rapid-ingress') unit.rapidIngressThisPhase = true;
      if (effect.flag === 'heroic-intervention') {
        unit.heroicInterventionThisPhase = true;
        if (effect.copyHeroicInterventionMode) unit.heroicInterventionMode = context.heroicInterventionMode;
        appendEffectLog(state, side, unit.profile.name, `${unit.profile.name} can declare a Heroic Intervention charge this phase.`);
      }
      return;
    }
    case 'force-fight-selection': {
      const unit = unitForTarget(context, effect.target);
      state.forcedFightUnitId = unit?.id;
      return;
    }
    case 'add-active-modifier':
      addActiveModifier(context, effect, effectIndex);
      return;
    case 'deal-mortal-wounds':
      // Damage is deliberately resolved by the caller, which owns the damage engine.
      return;
  }
}

/** Applies all non-damage effects in declaration order. */
export function resolveRuleEffects(context: RuleEffectContext, effects: RuleEffect[] = []): void {
  effects.forEach((effect, index) => applyRuleEffect(context, effect, index));
}

function isActive(state: BattleState, effect: ActiveRuleEffect): boolean {
  const currentRound = battleRound(state);
  if (effect.effect.duration === 'phase-end') {
    return effect.createdAt.phase === state.phase && effect.createdAt.battleRound === currentRound;
  }
  if (effect.effect.duration === 'turn-end') {
    return effect.createdAt.turn === state.turn && state.activeArmy === effect.side;
  }
  if (state.phase === 'command' && state.activeArmy === effect.side && currentRound > effect.createdAt.battleRound) return false;
  return true;
}

export function activeRuleEffectsFor(
  state: BattleState,
  sourceRuleId: string,
  targetUnitId: string,
): ActiveRuleEffect[] {
  return (state.activeRuleEffects ?? []).filter(effect =>
    effect.sourceRuleId === sourceRuleId
    && effect.targetUnitId === targetUnitId
    && isActive(state, effect),
  );
}

export function unitHasActiveRuleModifier(
  state: BattleState,
  sourceRuleId: string,
  targetUnitId: string,
  modifierType: ActiveModifierEffect['modifier']['type'],
): boolean {
  return activeRuleEffectsFor(state, sourceRuleId, targetUnitId)
    .some(effect => effect.effect.modifier.type === modifierType);
}

export function activeRuleEffectTargetModelIndex(
  state: BattleState,
  sourceRuleId: string,
  targetUnitId: string,
  keyword: string,
): number | undefined {
  const needle = keyword.toLowerCase();
  return activeRuleEffectsFor(state, sourceRuleId, targetUnitId)
    .find(effect => effect.effect.modifier.type === 'weapon-keyword'
      && effect.effect.modifier.keyword.toLowerCase() === needle)
    ?.targetModelIndex;
}
