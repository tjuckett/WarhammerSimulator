export interface WeaponProfile {
  name: string;
  profileGroup?: string; // alternate profiles for the same physical weapon; choose one profile per attack sequence
  range: number;       // inches; 0 = melee
  attacks: string;     // "2", "D6", "2D3+1"
  skill: number;       // target number (3 = 3+, 4 = 4+, etc.)
  strength: number;
  ap: number;          // 0, -1, -2, etc.
  damage: string;      // "1", "D3", "2"
  keywords: string[];  // "Rapid Fire 1", "Lethal Hits", "Blast", etc.
  isMelee: boolean;
  /** Temporary Core 24.14 source, present only while a transport resolves Firing Deck attacks. */
  firingDeckSource?: { passengerRosterId: string; passengerName: string; modelIndex: number; weaponIndex: number };
}

export interface ModelStatProfile {
  name: string;
  count: number;
  move: number;
  toughness: number;
  save: number;
  wounds: number;
  leadership: number;
  oc: number;
}

export interface RuleText {
  name: string;
  description: string;
  /** Core 22 tags printed on the rule. Text-only imports remain supported. */
  tags?: Array<'Aura' | 'Psychic'>;
  /** Core 22 classification; this does not invent or execute a datasheet effect. */
  category?: 'datasheet' | 'faction' | 'wargear';
  /** Explicit Aura range in inches when the source data provides one. */
  range?: number;
  /** Original roster-model index for a bearer-only Wargear or Aura ability. */
  bearerModelIndex?: number;
  /** Explicit Core 22.02 "unless otherwise stated" exception from source data. */
  appliesAcrossArmyFactions?: boolean;
}

export interface MovementRuleOverride {
  moveModifier?: number;
  advanceRoll?: 'auto6' | string;
  advanceModifier?: number;
}

export type ModelBase =
  | { shape: 'round'; diameterMm: number; label?: string }
  | { shape: 'oval'; widthMm: number; lengthMm: number; label?: string }
  | { shape: 'hull'; widthMm: number; lengthMm: number; footprint?: 'square' | 'rectangle' | 'circle'; label?: string }
  | { shape: 'other'; label: string };

export interface UnitProfile {
  rosterId?: string;
  name: string;
  move: number;
  toughness: number;
  save: number;
  invulnSave?: number;
  wounds: number;       // per model
  leadership: number;   // battleshock target (7 = 7+)
  oc: number;           // objective control
  baseModelCount: number;
  modelProfiles?: ModelStatProfile[];
  transportCapacity?: number;
  modelBases?: ModelBase[]; // one entry per model; repeated automatically when loaded from army data
  modelWeaponLoadouts?: number[][]; // weapon indices carried by each model; defaults to every model carrying every weapon
  movementOverrides?: MovementRuleOverride;
  keywords: string[];
  factionKeywords: string[];
  weapons: WeaponProfile[];
  abilities: RuleText[];
  rules?: RuleText[];
  deployment?: UnitDeploymentAssignment;
  leaderAttachment?: LeaderAttachment;
  /** Typed datasheet bracket; effects are applied only when explicitly supplied. */
  damagedProfile?: {
    maxRemainingWounds: number;
    hitRollModifier?: number;
    objectiveControlModifier?: number;
  };
}

export interface ImportedArmy {
  name: string;
  faction: string;
  units: UnitProfile[];
  generation?: ArmyGenerationMetadata;
}

export interface ArmyGenerationMetadata {
  strategy: 'balanced' | 'aggressive' | 'objective';
  sourceArmyName: string;
  explanation: string;
}

export const UNIT_DEPLOYMENT_MODE = {
  Battlefield: 'battlefield',
  DeepStrike: 'deepStrike',
  StrategicReserve: 'strategicReserve',
  Transport: 'transport',
} as const;

export type UnitDeploymentMode = (typeof UNIT_DEPLOYMENT_MODE)[keyof typeof UNIT_DEPLOYMENT_MODE];

export interface UnitDeploymentAssignment {
  mode: UnitDeploymentMode;
  transportUnitId?: string;
  transportName?: string;
}

export interface LeaderAttachment {
  attachedToUnitId?: string;
  attachedToName?: string;
}
