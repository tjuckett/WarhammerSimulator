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
    source?: string;
    sourceUnitId?: string;
    sourceObjectiveIndexesWithinRange?: number[];
  }>;
  position: Position;          // centroid of modelPositions; display and coarse AI positioning
  modelPositions: Position[];  // one entry per remaining model
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
  arrivedFromReinforcements?: boolean;
  inStrategicReserves?: boolean;
  rapidIngressThisPhase?: boolean;
  heroicInterventionThisPhase?: boolean;
  embarkedInUnitId?: string;
  emergencyDisembarkedThisTurn?: boolean;
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
  oneShotSpentWeaponIndices?: number[];
  piledIn?: boolean;
  consolidated?: boolean;
  inCombat: boolean;
  battleshocked: boolean;
  activated: boolean;
  destroyed: boolean;
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
  battleRound: number;
  turn: number;
  phase: Phase;
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
  winner: null | Side | 'draw';
  log: LogEntry[];
  units: BattleUnit[];
  terrain: Terrain[];
  board?: BoardFormat;
  armies: [
    { name: string; faction: string; color: string; army: ImportedArmy },
    { name: string; faction: string; color: string; army: ImportedArmy },
  ];
  objectives: Position[];
  objectiveControl: ObjectiveControlProfile;
  objectiveOwners: (Side | null)[];
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
  abilityUses?: UnitAbilityUse[];
  missionEvents?: MissionEvents;
  missionState?: MissionState;
  // Deployment phase: units not yet placed on the board
  unplacedUnits: [UnitProfile[], UnitProfile[]];
  deployStrategies: [string, string]; // DeploymentStrategy labels for record-keeping
  setup?: BattleSetup;
}
