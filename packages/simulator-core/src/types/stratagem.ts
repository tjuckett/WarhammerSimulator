import type { Phase, PhaseStep, Side } from './battle';
import type { RuleEffect } from './ruleEffects';

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

export type HeroicInterventionMode = 'leap-to-defend' | 'into-the-fray';

export type StratagemSelectionRequirement = 'forbidden' | 'optional' | 'required';

export interface StratagemSelectionDefinition {
  targetModel?: StratagemSelectionRequirement;
  sourceModel?: StratagemSelectionRequirement;
  secondaryTarget?: StratagemSelectionRequirement;
  heroicInterventionMode?: StratagemSelectionRequirement;
  heroicInterventionModes?: HeroicInterventionMode[];
}

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
  /** Some rules are only legal for a unit that is currently Battle-shock eligible. */
  targetMustBeBattleshockEligible?: boolean;
  /** Some effects require the unit to have made no ranged attacks this turn. */
  targetMustNotHaveFired?: boolean;
  /** The fight-step snapshot must already exist before this Stratagem can be used. */
  requiresFightStepStarted?: boolean;
  targetWithinEnemyDistance?: number;
  minimumBattleRound?: number;
  /** Restrict a phase to a typed state-machine step when the source specifies one. */
  phaseSteps?: PhaseStep[];
  /** Used by rules that interrupt the opposing player's fight selection. */
  requiresOpponentFightSelection?: boolean;
  /** Extra cost for a named selection, such as Heroic Intervention's mode. */
  choiceCosts?: Partial<Record<string, number>>;
  selection?: StratagemSelectionDefinition;
  effects?: RuleEffect[];
  /** Insane Bravery is allowed to target a unit already marked Battle-shocked. */
  targetMayBeBattleshocked?: boolean;
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
  secondaryTargetUnitId?: string;
  sourceModelIndex?: number;
  heroicInterventionMode?: HeroicInterventionMode;
  commandPointsSpent: number;
}
