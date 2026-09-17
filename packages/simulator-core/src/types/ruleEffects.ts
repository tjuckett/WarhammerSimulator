import type {
  BattleState,
  CombatActionKind,
  EventTriggerTiming,
  Phase,
  PhaseStep,
  Side,
} from './battle';

/** JSON-safe values that a rule effect may copy into an event/request payload. */
export type RuleEffectDataValue = string | number | boolean | null;

export type RuleEffectTarget = 'source-unit' | 'target-unit' | 'secondary-target-unit';

export type RuleEffectDuration = 'phase-end' | 'turn-end' | 'next-command-phase';

export type RuleEffectDice =
  | { type: 'fixed'; count: number }
  | { type: 'source-model-toughness'; max: number };

export type SecondaryTargetValidation = 'visible-enemy-within-8' | 'engaged-enemy';

/**
 * The data-only effect vocabulary shared by imported unit abilities and
 * Stratagems. Effects describe state transitions; the engine owns resolution.
 */
export type RuleEffect =
  | {
      type: 'activate-army-ability';
      abilityId: string;
    }
  | {
      type: 'restore-wounds';
      target: 'source-unit' | 'target-unit';
      amount: number | 'D3';
      maximum?: number | 'model-wounds';
    }
  | {
      type: 'move-to-strategic-reserves';
      target: 'source-unit' | 'target-unit';
      grantDeepStrikeUntil?: 'phase-end' | 'turn-end';
    }
  | {
      type: 'clear-battleshock';
      target: 'source-unit' | 'target-unit';
      log?: 'automatic-battle-shock-pass';
    }
  | {
      type: 'create-command-reroll';
      target?: 'source-unit' | 'target-unit';
    }
  | {
      type: 'open-event-request';
      target: 'source-unit' | 'target-unit';
      requestKind: string;
      timing: EventTriggerTiming;
      triggerId?: string;
      data?: Record<string, RuleEffectDataValue>;
      log?: 'ingress-opportunity';
    }
  | {
      type: 'open-combat-action';
      target: 'source-unit' | 'target-unit';
      kind: CombatActionKind;
      allowActivated?: boolean;
      snapShooting?: boolean;
    }
  | {
      type: 'set-unit-flag';
      target: 'source-unit' | 'target-unit';
      flag: 'rapid-ingress' | 'heroic-intervention';
      copyHeroicInterventionMode?: boolean;
    }
  | {
      type: 'force-fight-selection';
      target: 'source-unit' | 'target-unit';
    }
  | {
      type: 'add-active-modifier';
      target: 'source-unit' | 'target-unit';
      duration: RuleEffectDuration;
      modifier:
        | { type: 'weapon-keyword'; keyword: string; weaponType?: 'melee' | 'ranged' | 'all' }
        | { type: 'benefit-of-cover' };
    }
  | {
      /** Damage is resolved by the combat/damage engine after validation. */
      type: 'deal-mortal-wounds';
      target: 'secondary-target-unit';
      dice: RuleEffectDice;
      successOn: number;
      selfDamageOn?: { roll: number; target: 'source-unit' };
      secondaryTargetValidation: SecondaryTargetValidation;
    };

export type ActiveModifierEffect = Extract<RuleEffect, { type: 'add-active-modifier' }>;

export interface ActiveRuleEffect {
  id: string;
  sourceRuleId: string;
  sourceUseId?: string;
  side: Side;
  sourceUnitId?: string;
  targetUnitId?: string;
  targetModelIndex?: number;
  createdAt: {
    battleRound: number;
    turn: number;
    phase: Phase;
    phaseStep?: PhaseStep;
  };
  effect: ActiveModifierEffect;
}
