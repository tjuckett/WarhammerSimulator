import type { UnitProfile, ImportedArmy } from './army';
import type { ObjectiveControlProfile } from '../engine/objectiveGeometry';
import type { RulesetMetadata } from '../engine/rulesEngine';

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

export interface Position {
  x: number;
  y: number;
}

export interface BattleUnit {
  id: string;
  attachedToUnitId?: string;
  tabletopUnitId?: string;
  side: Side;
  profile: UnitProfile;
  remainingModels: number;
  woundsOnLeadModel: number;
  position: Position;          // centroid of modelPositions; used for range/LOS checks
  modelPositions: Position[];  // one entry per remaining model
  modelRotations?: number[];   // facing for each model footprint in degrees
  facingDeg: number;
  charged: boolean;
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
  type: 'ruin' | 'obstacle' | 'area' | 'impassable';
  providesCover: boolean;
  difficult: boolean;
  color: string;
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
  terrain: Terrain[];
}

export interface BattleSetup {
  missionCode: string;
  primaryMission: string;
  deployment: string;
  terrainLayout: string;
}

export interface BattleState {
  ruleset: RulesetMetadata;
  battleRound?: number;
  maxBattleRounds?: number;
  turn: number;
  maxTurns: number;
  activeArmy: Side;
  phase: Phase;
  winner: null | Side | 'draw';
  log: LogEntry[];
  units: BattleUnit[];
  terrain: Terrain[];
  armies: [
    { name: string; faction: string; color: string; army: ImportedArmy },
    { name: string; faction: string; color: string; army: ImportedArmy },
  ];
  objectives: Position[];
  objectiveControl: ObjectiveControlProfile;
  objectiveOwners: (Side | null)[];
  scores: [number, number];
  commandPoints?: [number, number];
  // Deployment phase: units not yet placed on the board
  unplacedUnits: [UnitProfile[], UnitProfile[]];
  deployStrategies: [string, string]; // DeploymentStrategy labels for record-keeping
  setup?: BattleSetup;
}
