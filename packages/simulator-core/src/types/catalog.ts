import type { ImportedArmy, LeaderAttachment, ModelBase, RuleText, UnitDeploymentAssignment, UnitProfile, WargearChoice } from './army';
import type { UnitAbilityDefinition } from './ability';
import type { StratagemDefinition } from './stratagem';

export type CatalogEdition = '10e' | '11e';

export type CatalogEntryStatus = 'current' | 'legend' | 'retired' | 'unsupported';

export type CatalogImplementationStatus = 'complete' | 'partial' | 'display-only';

export interface CatalogReference {
  catalogId: string;
  edition: CatalogEdition;
  catalogRevision: string;
}

export interface CatalogSource {
  title: string;
  url?: string;
  capturedAt?: string;
  section?: string;
  page?: number | string;
  sourceRevision?: string;
}

export interface CatalogCoverage {
  sourceEntryCount: number;
  normalizedEntryCount: number;
  excludedLegendCount?: number;
  remainingEntryIds?: string[];
  notes?: string[];
}

export interface CatalogManifest extends CatalogReference {
  schemaVersion: number;
  gameSystem: 'warhammer-40k';
  factions: string[];
  unitFiles?: string[];
  ruleFiles?: string[];
  reviewStatus?: 'working' | 'reviewed' | 'released';
  parserVersion?: string;
  sources?: CatalogSource[];
  coverage?: CatalogCoverage;
}

export interface UnitModelCountRange {
  minimum: number;
  maximum?: number;
  step?: number;
}

export interface UnitPointsEntry {
  modelCount: number;
  points: number;
  label?: string;
  unitNumber?: {
    minimum?: number;
    maximum?: number;
  };
}

export interface UnitDefinition {
  id: string;
  name: string;
  aliases?: string[];
  externalIds?: Record<string, string>;
  status?: CatalogEntryStatus;
  implementationStatus?: CatalogImplementationStatus;
  role?: string;
  modelCount?: UnitModelCountRange;
  points?: UnitPointsEntry[];
  composition?: string[];
  wargearOptions?: string[];
  /** Machine-readable choices used to build and validate a unit's loadout. */
  wargearChoices?: WargearChoice[];
  leaderTargetNames?: string[];
  leaderTargetRefs?: string[];
  supportedByNames?: string[];
  supportedByRefs?: string[];
  transport?: string;
  profile: UnitProfile;
  ruleRefs?: string[];
  rawRules?: RuleText[];
  sources?: CatalogSource[];
  notes?: string[];
}

export type CatalogRuleKind =
  | 'unit-ability'
  | 'army-rule'
  | 'core-rule'
  | 'wargear'
  | 'detachment-rule'
  | 'stratagem';

export interface CatalogRuleRuntime {
  ability?: Omit<UnitAbilityDefinition, 'id' | 'name' | 'description'>;
  stratagem?: Omit<StratagemDefinition, 'id' | 'name' | 'description'>;
}

export interface RuleDefinition {
  /** Canonical, namespaced catalog ID. */
  id: string;
  /** Runtime IDs may remain stable when the catalog namespace changes. */
  runtimeId?: string;
  name: string;
  description: string;
  kind: CatalogRuleKind;
  status?: CatalogEntryStatus;
  implementationStatus?: CatalogImplementationStatus;
  detachmentId?: string;
  runtime?: CatalogRuleRuntime;
  sources?: CatalogSource[];
  notes?: string[];
}

export interface FactionCatalog {
  id: string;
  name: string;
  edition: CatalogEdition;
  baseCatalogId?: string;
  unitRefs: string[];
  excludedUnitRefs?: string[];
  ruleRefs?: string[];
  stratagemRefs?: string[];
  detachmentRefs?: string[];
  factionKeywords?: string[];
  sources?: CatalogSource[];
  coverage?: CatalogCoverage;
}

export interface CatalogUnitFile {
  factionId: string;
  units: UnitDefinition[];
}

export interface CatalogRuleFile {
  factionId?: string;
  rules: RuleDefinition[];
}

export interface CatalogBundle {
  manifest: CatalogManifest;
  factions: FactionCatalog[];
  units: UnitDefinition[];
  rules: RuleDefinition[];
}

export interface UnitSelection {
  unitId: string;
  instanceId?: string;
  modelCount?: number;
  selectedWargear?: string[];
  deployment?: UnitDeploymentAssignment;
  leaderAttachment?: LeaderAttachment;
  notes?: string[];
}

export interface CatalogArmyContext {
  factionId: string;
  chapterId?: string;
  detachmentId?: string;
  catalog?: CatalogReference;
}

export interface CatalogMaterializationResult {
  profile: UnitProfile;
  definition: UnitDefinition;
  appliedRuleIds: string[];
  warnings: string[];
}

export interface CatalogArmyMaterializationOptions extends CatalogArmyContext {
  name: string;
  selections: UnitSelection[];
  battleSizeId?: string;
}

export interface CatalogArmyMaterializationResult {
  army: ImportedArmy;
  catalog: CatalogReference;
  warnings: string[];
}

export interface CatalogRegistryOptions {
  includeLegends?: boolean;
  includeRetired?: boolean;
  expectedCatalogId?: string;
  expectedEdition?: CatalogEdition;
  expectedCatalogRevision?: string;
}

export interface CatalogValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  entryId?: string;
}

/** A model base is re-exported here for catalog-facing consumers. */
export type CatalogModelBase = ModelBase;
