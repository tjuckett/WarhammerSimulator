import type { Phase, Side } from './battle';

export type AbilityTiming = 'manual' | 'command-phase' | 'end-of-phase';

export type AbilityTargetKind = 'self' | 'friendly-unit' | 'enemy-unit' | 'any-unit' | 'none';

export interface UnitAbilityDefinition {
  id: string;
  name: string;
  timing: AbilityTiming;
  target: AbilityTargetKind;
  oncePerBattle?: boolean;
  oncePerTurn?: boolean;
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
