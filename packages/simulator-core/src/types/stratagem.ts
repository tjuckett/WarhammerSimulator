import type { Phase, Side } from './battle';

export type StratagemTargetKind = 'none' | 'friendly-unit' | 'enemy-unit' | 'any-unit';

export interface StratagemDefinition {
  id: string;
  name: string;
  cost: number;
  phases: Phase[] | 'any';
  target: StratagemTargetKind;
  oncePerPhase?: boolean;
  oncePerBattle?: boolean;
  targetOncePerPhase?: boolean;
  description: string;
}

export interface StratagemUse {
  id: string;
  stratagemId: string;
  name: string;
  side: Side;
  phase: Phase;
  battleRound?: number;
  targetUnitId?: string;
  commandPointsSpent: number;
}
