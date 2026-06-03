export interface WeaponProfile {
  name: string;
  range: number;       // inches; 0 = melee
  attacks: string;     // "2", "D6", "2D3+1"
  skill: number;       // target number (3 = 3+, 4 = 4+, etc.)
  strength: number;
  ap: number;          // 0, -1, -2, etc.
  damage: string;      // "1", "D3", "2"
  keywords: string[];  // "Rapid Fire 1", "Lethal Hits", "Blast", etc.
  isMelee: boolean;
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
  keywords: string[];
  factionKeywords: string[];
  weapons: WeaponProfile[];
  abilities: RuleText[];
  rules?: RuleText[];
  deployment?: UnitDeploymentAssignment;
  leaderAttachment?: LeaderAttachment;
}

export interface ImportedArmy {
  name: string;
  faction: string;
  units: UnitProfile[];
}

export type UnitDeploymentMode = 'battlefield' | 'deepStrike' | 'strategicReserve' | 'transport';

export interface UnitDeploymentAssignment {
  mode: UnitDeploymentMode;
  transportUnitId?: string;
  transportName?: string;
}

export interface LeaderAttachment {
  attachedToUnitId?: string;
  attachedToName?: string;
}
