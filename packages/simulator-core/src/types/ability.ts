import type { Phase, Side } from './battle';
import type { RuleEffect } from './ruleEffects';

export type AbilityTiming = 'manual' | 'command-phase' | 'end-of-phase';

export type AbilityTargetKind = 'self' | 'friendly-unit' | 'enemy-unit' | 'any-unit' | 'none';

export interface UnitAbilityDefinition {
  id: string;
  name: string;
  timing: AbilityTiming;
  target: AbilityTargetKind;
  oncePerBattle?: boolean;
  /** Once-per-battle use shared by every source unit on the same army side. */
  armyWideOncePerBattle?: boolean;
  oncePerTurn?: boolean;
  phases?: Phase[] | 'any';
  /** Resolve this command-phase ability without a player-declared action. */
  automatic?: boolean;
  /** The source unit and its attached components must be unengaged. */
  requiresUnengaged?: boolean;
  effects?: RuleEffect[];
  description: string;
}

export interface UnitAbilityUse {
  id: string;
  abilityId: string;
  name: string;
  side: Side;
  sourceUnitId: string;
  phase: Phase;
  battleRound?: number;
  targetUnitId?: string;
}
