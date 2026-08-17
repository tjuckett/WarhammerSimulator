import type { Phase, Side } from './battle';

export type StratagemTargetKind = 'none' | 'friendly-unit' | 'enemy-unit' | 'any-unit';

export type CommandRerollRollType =
  | 'advance'
  | 'charge'
  | 'damage'
  | 'hazard'
  | 'hit'
  | 'save'
  | 'wound'
  | 'attacks';

export interface StratagemDefinition {
  id: string;
  name: string;
  cost: number;
  phases: Phase[] | 'any';
  turn?: 'own' | 'opponent' | 'either';
  target: StratagemTargetKind;
  targetKeywordsAny?: string[];
  targetForbiddenKeywordsAny?: string[];
  targetVehicleRequiresAnyKeywords?: string[];
  targetMustBeUnengaged?: boolean;
  targetMustBeEngaged?: boolean;
  targetMustBeInStrategicReserves?: boolean;
  targetMustBeEligibleToShoot?: boolean;
  targetMustBeEligibleToFight?: boolean;
  targetMustHaveCharged?: boolean;
  targetMustNotHaveAdvanced?: boolean;
  targetWithinEnemyDistance?: number;
  minimumBattleRound?: number;
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
  targetModelIndex?: number;
  commandPointsSpent: number;
}
