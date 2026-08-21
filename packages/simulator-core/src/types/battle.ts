import type { UnitProfile, ImportedArmy } from './army';
import type { ObjectiveControlProfile } from '../engine/objectiveGeometry';
import type { RulesetMetadata } from '../engine/rulesEngine';
import type { StratagemUse } from './stratagem';
import type { UnitAbilityUse } from './ability';
import type { DeploymentZoneSet } from '../data/deploymentZoneTypes';
import type { EleventhForceDispositionId } from '../data/missions';

export const BATTLE_PHASE = {
  Deployment: 'deployment',
  Setup: 'setup',
  Command: 'command',
  Movement: 'movement',
  Shooting: 'shooting',
  Charge: 'charge',
  Fight: 'fight',
  BattleShock: 'battle-shock',
  End: 'end',
} as const;

export type Phase = (typeof BATTLE_PHASE)[keyof typeof BATTLE_PHASE];

export type Side = 0 | 1;

export type MovementAction = 'remainedStationary' | 'normalMove' | 'advanced' | 'fellBack';
export const MOVEMENT_STEP = {
  MoveUnits: 'moveUnits',
  Reinforcements: 'reinforcements',
} as const;

export type MovementStep = (typeof MOVEMENT_STEP)[keyof typeof MOVEMENT_STEP];

export interface Position {
  x: number;
  y: number;
  z?: number;
}

export interface BattleUnit {
  id: string;
  attachedToUnitId?: string;
  tabletopUnitId?: string;
  side: Side;
  profile: UnitProfile;
  remainingModels: number;
  woundsOnLeadModel: number;
  woundedModelIndex?: number;
  pendingCasualties?: number;
  pendingWoundAssignment?: { woundsOnModel: number };
  pendingDamageAllocations?: Array<{
    damage: number;
    noCarryOver?: boolean;
    targetModelIndex?: number;
    source?: string;
    sourceUnitId?: string;
    sourceObjectiveIndexesWithinRange?: number[];
    /** Core 22 attack provenance, e.g. damage caused by a Psychic ability. */
    sourceTags?: Array<'psychic'>;
  }>;
  position: Position;          // centroid of modelPositions; display and coarse AI positioning
  modelPositions: Position[];  // one entry per remaining model
  /** Last known formation retained after the unit is destroyed for later measurements. */
  lastDestroyedPosition?: Position;
  lastDestroyedModelPositions?: Position[];
  modelRosterIndexes?: number[]; // original roster-model index for each current model position
  modelRotations?: number[];   // facing for each model footprint in degrees
  facingDeg: number;
  charged: boolean;
  movementAction?: MovementAction;
  movementAllowanceRemaining?: number;
  movementAllowanceRemainingByModel?: number[];
  movementAllowanceTotalByModel?: number[];
  movementStartPositionsByModel?: Position[];
  movementStartRotationsByModel?: number[];
  movementComplete?: boolean;
  /** 11e Core 21.03 declaration for the move currently being resolved. */
  takingToSkies?: boolean;
  /** Core 24 Scouts pre-battle Normal move allowance. */
  scoutMoveAllowance?: number;
  scoutMoveStarted?: boolean;
  scoutMoved?: boolean;
  /** Core 24 Super-heavy Walker MOBILE declaration for the current move. */
  superHeavyMobile?: boolean;
  /** Last phase in which this component completed a move of any type. */
  lastMovePhase?: Phase;
  lastMoveTurn?: number;
  surgeMovePhase?: Phase;
  surgeMoveTurn?: number;
  arrivedFromReinforcements?: boolean;
  inStrategicReserves?: boolean;
  /** Temporary Deep Strike granted by a datasheet ability until the current phase ends. */
  deepStrikeUntilPhase?: Phase;
  rapidIngressThisPhase?: boolean;
  heroicInterventionThisPhase?: boolean;
  heroicInterventionMode?: 'leap-to-defend' | 'into-the-fray';
  embarkedInUnitId?: string;
  /** Core 18.04: a unit that embarked this turn cannot disembark this phase. */
  embarkedThisTurn?: boolean;
  /** Core 18.02: a unit that disembarked this turn cannot embark again this phase. */
  disembarkedThisTurn?: boolean;
  emergencyDisembarkedThisTurn?: boolean;
  /** 11e Core 18.04 Combat Disembark restriction for the current turn. */
  combatDisembarkedThisTurn?: boolean;
  /** 11e Core 18.04 Rapid Disembark restriction for the current turn. */
  rapidDisembarkedThisTurn?: boolean;
  performingAction?: {
    id: string;
    name: string;
    startedPhase: Phase;
    completesAt: 'end-of-turn';
    targetObjectiveIndex?: number;
    targetTerrainId?: string;
    targetOperationMarkerId?: string;
    targetUnitId?: string;
  };
  actionStartedThisTurn?: boolean;
  fellBack?: boolean;
  firedWeaponIndices?: number[];
  /** 11e Core 13.09: whether this unit made ranged attacks during the current turn. */
  rangedAttacksMadeThisTurn?: boolean;
  /** 11e Core 13.09: whether this unit made ranged attacks during the previous turn. */
  rangedAttacksMadePreviousTurn?: boolean;
  oneShotSpentWeaponIndices?: number[];
  firingDeckBaseWeaponCount?: number;
  firingDeckGrantedWeaponIndices?: number[];
  firingDeckTurn?: number;
  piledIn?: boolean;
  overrunFightSelected?: boolean;
  overrunPiledIn?: boolean;
  consolidated?: boolean;
  inCombat: boolean;
  battleshocked: boolean;
  activated: boolean;
  destroyed: boolean;
}

export interface PendingDeadlyDemise {
  id: string;
  sourceUnitId: string;
  sourceUnitName: string;
  sourceSide: Side;
  destroyedBySide: Side;
  position: Position;
  footprint:
    | { shape: 'circle'; radius: number }
    | { shape: 'oval'; halfWidth: number; halfLength: number; rotationDeg?: number }
    | { shape: 'square'; halfSize: number; rotationDeg?: number }
    | { shape: 'rectangle'; halfWidth: number; halfLength: number; rotationDeg?: number };
  mortalWounds: string;
}

export type LogType =
  | 'phase'
  | 'move'
  | 'shoot'
  | 'charge'
  | 'fight'
  | 'damage'
  | 'death'
  | 'info'
  | 'roll';

export interface LogEntry {
  id: string;
  battleRound?: number;
  turn: number;
  phase: Phase;
  side: Side;
  unitName: string;
  message: string;
  type: LogType;
}

export interface DestroyedUnitMissionEvent {
  unitId: string;
  side: Side;
  unitName: string;
  startingStrength?: number;
  isCharacter?: boolean;
  destroyedBySide: Side;
  destroyedByUnitId?: string;
  destroyingUnitObjectiveIndexesWithinRange?: number[];
  sourceTags?: Array<'psychic'>;
  battleRound: number;
  turn: number;
  phase: Phase;
}

export interface CompletedTurnMissionEventSummary {
  activeSide: Side;
  battleRound: number;
  turn: number;
  destroyedUnitCounts: [number, number];
  destroyingUnitIds?: string[];
}

export interface StartOfTurnUnitMissionSnapshot {
  unitId: string;
  side: Side;
  unitName: string;
  remainingModels: number;
  modelPositions: Position[];
  objectiveIndexesWithinRange?: number[];
  terrainAreaIds?: string[];
}

export interface DestroyedModelMissionEvent {
  id: string;
  unitId: string;
  side: Side;
  unitName: string;
  modelName: string;
  modelIndexAtDestruction?: number;
  rosterModelIndex?: number;
  woundsCharacteristic: number;
  unitStartingStrength: number;
  isCharacter: boolean;
  destroyedBySide: Side;
  destroyedByUnitId?: string;
  sourceTags?: Array<'psychic'>;
  battleRound: number;
  turn: number;
  phase: Phase;
}

/** A serialized interrupt opened when a unit with Fight On Death is destroyed. */
export interface PendingFightOnDeath {
  unit: BattleUnit;
  side: Side;
  destroyedBySide: Side;
  phase: Phase;
  battleRound: number;
}

export interface StartOfTurnMissionSnapshot {
  activeSide: Side;
  battleRound: number;
  turn: number;
  objectiveOwners: (Side | null)[];
  units: StartOfTurnUnitMissionSnapshot[];
}

export interface CompletedMissionActionEvent {
  actionId: string;
  actionName: string;
  side: Side;
  unitId: string;
  unitName: string;
  targetObjectiveIndex?: number;
  targetTerrainId?: string;
  targetOperationMarkerId?: string;
  targetUnitId?: string;
  objectiveIndexesWithinRange?: number[];
  battleRound: number;
  turn: number;
}

export interface OperationMarker {
  id: string;
  side: Side;
  sourceActionId: string;
  placedByUnitId: string;
  objectiveIndex?: number;
  terrainId?: string;
  position: Position;
  battleRound: number;
  turn: number;
}

export interface MissionEvents {
  destroyedUnitsThisTurn?: DestroyedUnitMissionEvent[];
  destroyedModelsThisTurn?: DestroyedModelMissionEvent[];
  unitsLeftBattlefieldThisTurn?: string[];
  completedActionsThisTurn?: CompletedMissionActionEvent[];
  lastCompletedTurn?: CompletedTurnMissionEventSummary;
  startOfTurn?: StartOfTurnMissionSnapshot;
}

export type SecondaryMissionMode = 'fixed' | 'tactical';

export type SecondaryMissionSelectionValue =
  | string
  | number
  | boolean
  | null
  | SecondaryMissionSelectionValue[]
  | { [key: string]: SecondaryMissionSelectionValue };

export interface SecondaryMissionCardState {
  activationId: string;
  missionName: string;
  mode: SecondaryMissionMode;
  activatedBattleRound: number;
  activatedTurn: number;
  whenDrawnSelections?: Record<string, SecondaryMissionSelectionValue>;
}

export interface TemptingTargetWhenDrawnSelection {
  objectiveIndex: number;
  selectedBySide: Side;
}

export interface BeaconWhenDrawnSelection {
  unitId: string;
}

export interface BurdenOfTrustGuardSelection {
  objectiveIndex: number;
  unitId: string;
}

export interface BurdenOfTrustWhenDrawnSelection {
  guards: BurdenOfTrustGuardSelection[];
}

export interface SecondaryMissionPlayerState {
  mode: SecondaryMissionMode;
  activeCards: SecondaryMissionCardState[];
  drawPile: string[];
  discardedCards: SecondaryMissionCardState[];
}

export interface SecondaryMissionScoringRecord {
  id: string;
  activationId: string;
  side: Side;
  missionName: string;
  clauseIds: string[];
  status: 'awarded' | 'capped' | 'not-met' | 'unsupported';
  requestedVp: number;
  vp: number;
  detail: string;
  battleRound: number;
  turn: number;
  activeSide: Side;
  phase: Phase;
  scoreAfter: number;
}

export interface PrimaryMissionScoringRecord {
  id: string;
  side: Side;
  missionName: string;
  clauseIds: string[];
  status: 'awarded' | 'capped' | 'not-met' | 'unsupported';
  requestedVp: number;
  vp: number;
  detail: string;
  battleRound: number;
  turn: number;
  activeSide: Side;
  phase: Phase;
  scoreAfter: number;
  timing?: 'end-command-phase' | 'end-turn' | 'end-battle';
  clauseDetails?: string[];
  capDetail?: string;
  unsupportedReasons?: string[];
}

export interface MissionState {
  operationMarkers?: OperationMarker[];
  condemnedUnitIds?: [string[], string[]];
  secondaryMissions?: [SecondaryMissionPlayerState, SecondaryMissionPlayerState];
  secondaryMissionNextActivationIds?: [number, number];
  secondaryMissionScoringRecords?: SecondaryMissionScoringRecord[];
  primaryMissionScoringRecords?: PrimaryMissionScoringRecord[];
  completedSecondaryActionsDuringBattle?: CompletedMissionActionEvent[];
  destroyedUnitsDuringBattle?: DestroyedUnitMissionEvent[];
  destroyedModelsDuringBattle?: DestroyedModelMissionEvent[];
}

export interface Terrain {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  polygonPoints?: Position[];
  type: 'ruin' | 'obstacle' | 'area' | 'impassable';
  providesCover: boolean;
  difficult: boolean;
  color: string;
  objectiveRole?: 'home-0' | 'home-1' | 'no-mans-land' | 'central' | 'expansion-0' | 'expansion-1';
  features: TerrainFeature[];
}

export interface TerrainFeature {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  featureHeight: 'low' | 'mid' | 'tall';
  category?: 'light' | 'dense';
  blocksLOS: boolean;
  blocksMovement: boolean;
  difficult: boolean;
  color?: string;
}

export interface TerrainLayout {
  id: string;
  name: string;
  description: string;
  deploymentZones?: DeploymentZoneSet;
  territoryZones?: TerritoryZoneSet;
  terrain: Terrain[];
}

export interface BoardFormat {
  id: 'combat-patrol' | 'incursion' | 'strike-force';
  name: string;
  width: number;
  height: number;
  deploymentDepth: number;
}

export interface BattleSetup {
  missionCode: string;
  primaryMission: string;
  primaryMissions?: [string, string];
  forceDispositions?: [EleventhForceDispositionId, EleventhForceDispositionId];
  deployment: string;
  deploymentZones?: DeploymentZoneSet;
  territoryZones?: TerritoryZoneSet;
  terrainLayout: string;
  boardFormat?: BoardFormat['id'];
}

export interface TerritoryRegion {
  polygons: Position[][];
}

export interface TerritoryZoneSet {
  sides: [TerritoryRegion, TerritoryRegion];
}

export interface BattleState {
  ruleset: RulesetMetadata;
  battleRound?: number;
  maxBattleRounds?: number;
  turn: number;
  maxTurns: number;
  activeArmy: Side;
  phase: Phase;
  movementStep?: MovementStep;
  /** 11e Core 12.04 snapshot, captured after the phase's ordinary pile-in step. */
  fightStepStarted?: boolean;
  engagedUnitIdsAtFightStepStart?: string[];
  lastFightSelectionSide?: Side;
  /** 11e Core 15.12 target that must be selected next after Counteroffensive. */
  forcedFightUnitId?: string;
  activeAttachedFightUnitId?: string;
  activeAttachedShootingUnitId?: string;
  attachedShootingTargetUnitId?: string;
  /** Trigger supplied by an external rule; Core 21 only defines how the move resolves. */
  pendingSurgeMove?: {
    unitId: string;
    side: Side;
    maximumDistance: number;
    source: string;
    triggeredPhase: Phase;
  };
  pendingChargeRoll?: {
    unitId: string;
    side: Side;
    maximumDistance: number;
  };
  winner: null | Side | 'draw';
  log: LogEntry[];
  units: BattleUnit[];
  pendingDeadlyDemises?: PendingDeadlyDemise[];
  pendingFightOnDeath?: PendingFightOnDeath[];
  firingDeckLockedUnitIds?: string[];
  /** Set after the first Command phase begins; Scouts are only legal before this. */
  preBattleAbilitiesResolved?: boolean;
  terrain: Terrain[];
  board?: BoardFormat;
  armies: [
    { name: string; faction: string; color: string; army: ImportedArmy },
    { name: string; faction: string; color: string; army: ImportedArmy },
  ];
  objectives: Position[];
  objectiveControl: ObjectiveControlProfile;
  objectiveOwners: (Side | null)[];
  /** Objectives currently secured under 11e Core 14.03, indexed like objectives. */
  securedObjectiveOwners?: (Side | null)[];
  scores: [number, number];
  commandPoints?: [number, number];
  stratagemUses?: StratagemUse[];
  pendingCommandReroll?: {
    side: Side;
    stratagemUseId: string;
    phase: Phase;
    battleRound?: number;
    targetUnitId?: string;
  };
  /** Command-phase units that are eligible for the current Battle-shock step. */
  battleshockEligibleUnitIds?: string[];
  abilityUses?: UnitAbilityUse[];
  /** Active typed army abilities, keyed by side; effects expire at that side's next Command phase. */
  activeArmyAbilities?: [string[], string[]];
  missionEvents?: MissionEvents;
  missionState?: MissionState;
  // Deployment phase: units not yet placed on the board
  unplacedUnits: [UnitProfile[], UnitProfile[]];
  deployStrategies: [string, string]; // DeploymentStrategy labels for record-keeping
  setup?: BattleSetup;
}
