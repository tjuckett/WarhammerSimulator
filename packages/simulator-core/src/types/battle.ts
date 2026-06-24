import type { UnitProfile, ImportedArmy } from './army';
import type { ObjectiveControlProfile } from '../engine/objectiveGeometry';
import type { RulesetMetadata } from '../engine/rulesEngine';
import type { StratagemUse } from './stratagem';
import type { UnitAbilityUse } from './ability';
import type { DeploymentZoneSet } from '../data/deploymentZoneTypes';

export type Phase =
  | 'deployment'
  | 'setup'
  | 'command'
  | 'movement'
  | 'shooting'
  | 'charge'
  | 'fight'
  | 'battle-shock'
  | 'end';

export type Side = 0 | 1;

export type MovementAction = 'remainedStationary' | 'normalMove' | 'advanced' | 'fellBack';
export type MovementStep = 'moveUnits' | 'reinforcements';

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
  pendingDamageAllocations?: Array<{ damage: number; noCarryOver?: boolean; source?: string }>;
  position: Position;          // centroid of modelPositions; display and coarse AI positioning
  modelPositions: Position[];  // one entry per remaining model
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
  };
  actionStartedThisTurn?: boolean;
  fellBack?: boolean;
  firedWeaponIndices?: number[];
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
  objectiveRole?: 'home-0' | 'home-1' | 'no-mans-land';
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
  forceDispositions?: [string, string];
  deployment: string;
  deploymentZones?: DeploymentZoneSet;
  terrainLayout: string;
  boardFormat?: BoardFormat['id'];
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
  abilityUses?: UnitAbilityUse[];
  // Deployment phase: units not yet placed on the board
  unplacedUnits: [UnitProfile[], UnitProfile[]];
  deployStrategies: [string, string]; // DeploymentStrategy labels for record-keeping
  setup?: BattleSetup;
}
