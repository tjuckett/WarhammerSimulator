import { CATALOG_BUNDLES, NECRONS_CATALOG, ORKS_CATALOG } from '../data/catalogs/11e';
import coreAbilityCatalogData from '../data/catalogs/11e/coreAbilities.json';
import { baseSizesForUnit, mergeCanonicalBaseGeometry } from '../data/unitBaseSizes';
import { deriveWargearChoices } from './unitWargear';
import type { RulesEdition } from './rulesEngine';
import type { RuleText, UnitProfile, WargearChoice } from '../types/army';
import type {
  CatalogArmyContext,
  CatalogArmyMaterializationOptions,
  CatalogArmyMaterializationResult,
  CatalogBundle,
  CatalogMaterializationResult,
  CatalogRegistryOptions,
  CatalogRuleKind,
  CatalogValidationIssue,
  FactionCatalog,
  RuleDefinition,
  UnitDefinition,
  UnitSelection,
} from '../types/catalog';

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2019\u2018`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const coreAbilityDescriptions = Object.entries(coreAbilityCatalogData.abilities)
  .map(([name, description]) => ({ name, normalizedName: normalizeName(name), description }))
  .sort((left, right) => right.normalizedName.length - left.normalizedName.length);

function hydrateCoreAbilityDescription(rule: RuleText): RuleText {
  const match = rule.description.match(/^Core ability:\s*(.+?)\.\s*$/s);
  if (!match) return rule;
  const abilityName = match[1].trim();
  const normalizedAbilityName = normalizeName(abilityName);
  const definition = coreAbilityDescriptions.find(entry =>
    normalizedAbilityName === entry.normalizedName
      || normalizedAbilityName.startsWith(`${entry.normalizedName} `),
  );
  if (!definition) return rule;

  let description = definition.description;
  const suffix = abilityName.slice(definition.name.length).trim();
  if (suffix) {
    const escapedName = definition.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parameterToken = definition.name === 'Feel No Pain'
      ? 'X\\+'
      : definition.name === 'Scouts' || definition.name === 'Lone Operative'
        ? 'X"'
        : 'X';
    description = description.replace(
      new RegExp(`(${escapedName}\\s+)${parameterToken}`, 'gi'),
      `$1${suffix}`,
    );
  }
  return { ...rule, description };
}

function hydrateCoreAbilities(rules: RuleText[]): RuleText[] {
  return rules.map(hydrateCoreAbilityDescription);
}

function isCharacterUnit(unit: UnitProfile): boolean {
  return unit.keywords.some(keyword => normalizeName(keyword) === 'character')
    || /\bcharacter\b/i.test(unit.catalogRole ?? '')
    || !!unit.leaderTargetNames?.length
    || !!unit.leaderTargetRefs?.length;
}

function enhancementSubject(rule: RuleDefinition): { subject: string; scope: 'model' | 'unit'; excluded?: string } | undefined {
  const match = rule.description.match(/(?:^|\.\s*)([^.]+?)\s+(model|unit)\s+only\b(?:\s*\(excluding\s+([^.)]+)\))?/i);
  return match
    ? {
        subject: match[1],
        scope: match[2].toLowerCase() as 'model' | 'unit',
        excluded: match[3],
      }
    : undefined;
}

function restrictionMatchesUnit(subject: string, unit: UnitProfile, faction: FactionCatalog): boolean {
  const candidates = [
    unit.name,
    ...(unit.keywords ?? []),
    ...(unit.factionKeywords ?? []),
    unit.catalogRole ?? '',
  ].map(normalizeName).filter(Boolean);
  const factionTerms = [faction.name, ...(faction.factionKeywords ?? [])].map(normalizeName);
  const candidateText = candidates.join(' ');
  const requiredKeywords = ['infantry', 'mounted', 'monster', 'vehicle', 'aircraft']
    .filter(keyword => new RegExp(`\\b${keyword}\\b`, 'i').test(subject));
  if (requiredKeywords.some(keyword => !new RegExp(`\\b${keyword}\\b`, 'i').test(candidateText))) return false;
  const alternatives = subject
    .replace(/\([^)]*\)/g, '')
    .split(/\s+or\s+|\//i)
    .map(value => normalizeName(value)
      .split(' ')
      .filter(token => !factionTerms.includes(token)
        && !['model', 'models', 'unit', 'units', 'only', 'infantry', 'mounted', 'monster', 'vehicle', 'aircraft', 'epic', 'hero', 'character'].includes(token))
      .join(' '))
    .filter(Boolean);
  if (!alternatives.length) return true;
  return alternatives.some(alternative => candidates.some(candidate =>
    candidate === alternative || candidate.includes(alternative) || alternative.includes(candidate),
  ));
}

function enhancementEligible(rule: RuleDefinition, unit: UnitProfile, faction: FactionCatalog): boolean {
  const scope = enhancementSubject(rule);
  if (!scope) return false;
  if (scope.excluded && restrictionMatchesUnit(scope.excluded, unit, faction)) return false;
  if (scope.scope === 'model' && !isCharacterUnit(unit)) return false;
  return restrictionMatchesUnit(scope.subject, unit, faction);
}

export function rulePoints(rule: RuleDefinition): number | undefined {
  if (rule.points !== undefined) return rule.points;
  const points = rule.description.match(/^\s*(\d+)\s+pts\b/i)?.[1];
  return points === undefined ? undefined : Number(points);
}

function wargearChoiceGroupKey(choice: WargearChoice): string {
  return `${choice.kind}:${choice.selectionMode ?? 'complete-loadout'}:${choice.slotId ?? 'loadout'}:${(choice.eligibleModelIndexes ?? []).join(',')}`;
}

function wargearChoiceDescription(choice: WargearChoice, options: string[]): string | undefined {
  if (choice.kind !== 'unit-upgrade') return undefined;
  const choiceName = normalizeName(choice.label);
  if (!choiceName) return undefined;
  return options.find(option => normalizeName(option).includes(choiceName));
}

function materializeWargearChoices(choices: WargearChoice[], options: string[] = []): WargearChoice[] {
  const explicitDefaultGroups = new Set(
    choices
      .filter(choice => choice.kind === 'model-loadout' && choice.isDefault)
      .map(wargearChoiceGroupKey),
  );
  const seenGroups = new Set<string>();
  return choices.map(choice => {
    const description = choice.description ?? wargearChoiceDescription(choice, options);
    if (choice.kind !== 'model-loadout') return { ...choice, description };
    const groupKey = wargearChoiceGroupKey(choice);
    const isDefault = choice.isDefault
      ?? (!explicitDefaultGroups.has(groupKey) && !seenGroups.has(groupKey));
    seenGroups.add(groupKey);
    return { ...choice, isDefault, description };
  });
}

function automaticFreeScalableUnitUpgrades(choices: WargearChoice[], modelCount: number): string[] {
  return choices.flatMap(choice => {
    if (
      choice.kind !== 'unit-upgrade'
      || choice.maximumSelectionsPerModels === undefined
      || choice.limitGroup
      || (choice.points !== undefined && choice.points > 0)
    ) return [];
    const dynamicLimit = Math.floor(modelCount / choice.maximumSelectionsPerModels);
    const maximum = choice.maximumSelections === undefined
      ? dynamicLimit
      : Math.min(choice.maximumSelections, dynamicLimit);
    return Array.from({ length: Math.max(0, maximum) }, () => choice.id);
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function entryStatusAllowed(
  status: UnitDefinition['status'] | RuleDefinition['status'],
  options: CatalogRegistryOptions,
): boolean {
  if (status === 'legend') return options.includeLegends === true;
  if (status === 'retired') return options.includeRetired === true;
  return true;
}

function addIssue(
  issues: CatalogValidationIssue[],
  severity: CatalogValidationIssue['severity'],
  code: string,
  message: string,
  entryId?: string,
): void {
  issues.push({ severity, code, message, entryId });
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

/** Validate the structural parts of a catalog before it becomes a registry. */
export function validateCatalogBundle(bundle: CatalogBundle): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const unitIds = new Set<string>();
  const ruleIds = new Set<string>();
  const factionIds = new Set<string>();

  if (!bundle.manifest || bundle.manifest.gameSystem !== 'warhammer-40k') {
    addIssue(issues, 'error', 'manifest-invalid', 'Catalog manifest is missing or has an unsupported game system.');
  }
  if (!bundle.manifest?.catalogId || !bundle.manifest.catalogRevision) {
    addIssue(issues, 'error', 'manifest-identity-invalid', 'Catalog manifest must identify its catalog and revision.');
  }

  for (const unit of bundle.units) {
    if (unitIds.has(unit.id)) addIssue(issues, 'error', 'duplicate-unit-id', `Duplicate unit ID: ${unit.id}.`, unit.id);
    unitIds.add(unit.id);
    if (!unit.id.trim() || !unit.name.trim()) {
      addIssue(issues, 'error', 'unit-identity-invalid', 'A unit must have a non-empty ID and name.', unit.id);
    }
    if (unit.modelCount && (
      !Number.isInteger(unit.modelCount.minimum)
      || unit.modelCount.minimum < 1
      || (unit.modelCount.maximum !== undefined
        && (!Number.isInteger(unit.modelCount.maximum) || unit.modelCount.maximum < unit.modelCount.minimum))
    )) {
      addIssue(issues, 'error', 'unit-model-range-invalid', `Invalid model-count range for ${unit.name}.`, unit.id);
    }
    for (const duplicate of duplicateValues(unit.ruleRefs ?? [])) {
      addIssue(issues, 'warning', 'duplicate-unit-rule-ref', `${unit.name} references ${duplicate} more than once.`, unit.id);
    }
    for (const ref of unit.ruleRefs ?? []) {
      if (!ruleIds.has(ref) && !bundle.rules.some(rule => rule.id === ref)) {
        addIssue(issues, 'error', 'dangling-unit-rule-ref', `${unit.name} references missing rule ${ref}.`, unit.id);
      }
    }
  }

  for (const rule of bundle.rules) {
    if (ruleIds.has(rule.id)) addIssue(issues, 'error', 'duplicate-rule-id', `Duplicate rule ID: ${rule.id}.`, rule.id);
    ruleIds.add(rule.id);
    if (!rule.id.trim() || !rule.name.trim()) {
      addIssue(issues, 'error', 'rule-identity-invalid', 'A rule must have a non-empty ID and name.', rule.id);
    }
    if (rule.runtime?.ability && rule.runtime?.stratagem) {
      addIssue(issues, 'error', 'rule-runtime-ambiguous', `${rule.id} declares both an ability and a Stratagem runtime.`, rule.id);
    }
  }

  for (const faction of bundle.factions) {
    if (factionIds.has(faction.id)) addIssue(issues, 'error', 'duplicate-faction-id', `Duplicate faction ID: ${faction.id}.`, faction.id);
    factionIds.add(faction.id);
    if (!faction.id.trim() || !faction.name.trim()) {
      addIssue(issues, 'error', 'faction-identity-invalid', 'A faction must have a non-empty ID and name.', faction.id);
    }
    for (const ref of [...faction.unitRefs, ...(faction.excludedUnitRefs ?? [])]) {
      if (!unitIds.has(ref)) addIssue(issues, 'error', 'dangling-faction-unit-ref', `${faction.id} references missing unit ${ref}.`, faction.id);
    }
    for (const ref of [...(faction.ruleRefs ?? []), ...(faction.stratagemRefs ?? [])]) {
      if (!ruleIds.has(ref)) addIssue(issues, 'error', 'dangling-faction-rule-ref', `${faction.id} references missing rule ${ref}.`, faction.id);
    }
    for (const ref of faction.detachmentRefs ?? []) {
      const detachmentExists = bundle.rules.some(rule => rule.id === ref || rule.detachmentId === ref);
      if (!detachmentExists) addIssue(issues, 'error', 'dangling-detachment-ref', `${faction.id} references missing detachment ${ref}.`, faction.id);
    }
    for (const duplicate of duplicateValues(faction.unitRefs)) {
      addIssue(issues, 'warning', 'duplicate-faction-unit-ref', `${faction.id} lists ${duplicate} more than once.`, faction.id);
    }
  }

  for (const factionId of bundle.manifest?.factions ?? []) {
    if (!factionIds.has(factionId)) addIssue(issues, 'error', 'dangling-manifest-faction', `Manifest references missing faction ${factionId}.`, factionId);
  }

  const runtimeIds = new Map<string, string>();
  for (const rule of bundle.rules) {
    const runtimeId = rule.runtimeId ?? rule.id;
    if (!rule.runtime) continue;
    const existing = runtimeIds.get(runtimeId);
    if (existing && existing !== rule.id) {
      addIssue(issues, 'warning', 'duplicate-runtime-id', `${rule.id} shares runtime ID ${runtimeId} with ${existing}.`, rule.id);
    }
    runtimeIds.set(runtimeId, rule.id);
  }

  return issues;
}

export class CatalogValidationError extends Error {
  readonly issues: CatalogValidationIssue[];

  constructor(issues: CatalogValidationIssue[]) {
    super(issues.map(issue => issue.message).join(' '));
    this.name = 'CatalogValidationError';
    this.issues = issues;
  }
}

export class CatalogMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogMaterializationError';
  }
}

function copyUnitProfile(profile: UnitProfile): UnitProfile {
  return {
    ...profile,
    modelProfiles: profile.modelProfiles?.map(modelProfile => ({ ...modelProfile })),
    modelBases: profile.modelBases?.map(base => ({ ...base })),
    modelWeaponLoadouts: profile.modelWeaponLoadouts?.map(loadout => [...loadout]),
    modelWargearChoices: profile.modelWargearChoices?.map(choices => [...choices]),
    wargearOptions: profile.wargearOptions ? [...profile.wargearOptions] : undefined,
    wargearChoices: profile.wargearChoices?.map(choice => ({
      ...choice,
      eligibleModelIndexes: choice.eligibleModelIndexes ? [...choice.eligibleModelIndexes] : undefined,
      weaponNames: choice.weaponNames ? [...choice.weaponNames] : undefined,
      replacesWeaponNames: choice.replacesWeaponNames ? [...choice.replacesWeaponNames] : undefined,
    })),
    unitLoadoutOptions: profile.unitLoadoutOptions?.map(option => ({
      ...option,
      modelWeaponLoadouts: option.modelWeaponLoadouts?.map(loadout => [...loadout]),
      modelWargearChoices: option.modelWargearChoices?.map(choices => [...choices]),
      selectedWargear: option.selectedWargear ? [...option.selectedWargear] : undefined,
    })),
    preBattleFormations: profile.preBattleFormations?.map(rule => ({
      ...rule,
      modelCounts: [...rule.modelCounts],
      abilityGroups: rule.abilityGroups?.map(group => ({ ...group, abilityNames: [...group.abilityNames] })),
    })),
    selectedWargear: profile.selectedWargear ? [...profile.selectedWargear] : undefined,
    movementOverrides: profile.movementOverrides ? { ...profile.movementOverrides } : undefined,
    keywords: [...profile.keywords],
    factionKeywords: [...profile.factionKeywords],
    weapons: profile.weapons.map(weapon => ({ ...weapon, keywords: [...weapon.keywords] })),
    abilities: hydrateCoreAbilities(profile.abilities.map(rule => ({ ...rule, tags: rule.tags ? [...rule.tags] : undefined }))),
    rules: profile.rules?.map(rule => ({ ...rule, tags: rule.tags ? [...rule.tags] : undefined })),
    deployment: profile.deployment ? { ...profile.deployment } : undefined,
    leaderAttachment: profile.leaderAttachment ? { ...profile.leaderAttachment } : undefined,
  };
}

function resizeModelValues<T>(values: T[] | undefined, count: number, copy: (value: T) => T): T[] | undefined {
  if (!values?.length) return undefined;
  return Array.from({ length: count }, (_, index) => copy(values[index % values.length]));
}

function resizeModelBases(values: UnitProfile['modelBases'], count: number): UnitProfile['modelBases'] {
  if (!values?.length) return undefined;
  return Array.from({ length: count }, (_, index) => ({ ...values[Math.min(index, values.length - 1)] }));
}

function resizeModelLoadouts(values: number[][] | undefined, count: number): number[][] | undefined {
  if (!values?.length) return undefined;
  return Array.from({ length: count }, (_, index) => [...values[Math.min(index, values.length - 1)]]);
}

function runtimeIdForRule(rule: RuleDefinition): string {
  return rule.runtimeId ?? rule.id;
}

function ruleCategory(kind: CatalogRuleKind): RuleText['category'] {
  if (kind === 'army-rule') return 'faction';
  if (kind === 'wargear') return 'wargear';
  return 'datasheet';
}

function ruleTextForDefinition(rule: RuleDefinition): RuleText {
  return {
    ruleId: runtimeIdForRule(rule),
    sourceRuleId: rule.id,
    name: rule.name,
    description: rule.description,
    category: ruleCategory(rule.kind),
  };
}

function addRuleText(target: RuleText[], additions: RuleText[]): RuleText[] {
  const result = [...target];
  for (const addition of additions) {
    const duplicate = result.some(existing =>
      (addition.ruleId && existing.ruleId === addition.ruleId)
      || (!addition.ruleId && normalizeName(existing.name) === normalizeName(addition.name)),
    );
    if (!duplicate) result.push(addition);
  }
  return result;
}

function availableRule(rule: RuleDefinition, options: CatalogRegistryOptions): boolean {
  return entryStatusAllowed(rule.status, options) && rule.status !== 'unsupported';
}

export class CatalogRegistry {
  readonly bundle: CatalogBundle;
  readonly options: CatalogRegistryOptions;
  private readonly unitsById: Map<string, UnitDefinition>;
  private readonly rulesById: Map<string, RuleDefinition>;
  private readonly factionsById: Map<string, FactionCatalog>;

  constructor(bundle: CatalogBundle, options: CatalogRegistryOptions = {}) {
    const issues = validateCatalogBundle(bundle);
    if (options.expectedCatalogId && bundle.manifest.catalogId !== options.expectedCatalogId) {
      addIssue(issues, 'error', 'catalog-id-mismatch', `Expected catalog ${options.expectedCatalogId}, received ${bundle.manifest.catalogId}.`);
    }
    if (options.expectedEdition && bundle.manifest.edition !== options.expectedEdition) {
      addIssue(issues, 'error', 'catalog-edition-mismatch', `Expected ${options.expectedEdition}, received ${bundle.manifest.edition}.`);
    }
    if (options.expectedCatalogRevision && bundle.manifest.catalogRevision !== options.expectedCatalogRevision) {
      addIssue(issues, 'error', 'catalog-revision-mismatch', `Expected catalog revision ${options.expectedCatalogRevision}, received ${bundle.manifest.catalogRevision}.`);
    }
    const errors = issues.filter(issue => issue.severity === 'error');
    if (errors.length) throw new CatalogValidationError(errors);

    this.bundle = bundle;
    this.options = { ...options };
    this.unitsById = new Map(bundle.units.map(unit => [unit.id, unit]));
    this.rulesById = new Map(bundle.rules.map(rule => [rule.id, rule]));
    this.factionsById = new Map(bundle.factions.map(faction => [faction.id, faction]));
  }

  get manifest() {
    return this.bundle.manifest;
  }

  private assertCatalogContext(context: CatalogArmyContext): void {
    if (!context.catalog) return;
    const expected = context.catalog;
    const actual = this.manifest;
    if (expected.catalogId !== actual.catalogId
      || expected.edition !== actual.edition
      || expected.catalogRevision !== actual.catalogRevision) {
      throw new CatalogMaterializationError(
        `Catalog context ${expected.catalogId}/${expected.edition}/${expected.catalogRevision} does not match ${actual.catalogId}/${actual.edition}/${actual.catalogRevision}.`,
      );
    }
  }

  faction(factionId: string): FactionCatalog | undefined {
    return this.factionsById.get(factionId);
  }

  /** Resolve a faction's shared base catalog before applying its local entries. */
  effectiveFaction(factionId: string): FactionCatalog | undefined {
    const visited = new Set<string>();
    const resolve = (id: string): FactionCatalog | undefined => {
      if (visited.has(id)) throw new CatalogValidationError([{
        severity: 'error',
        code: 'faction-inheritance-cycle',
        message: `Faction catalog inheritance contains a cycle at ${id}.`,
        entryId: id,
      }]);
      const faction = this.factionsById.get(id);
      if (!faction) return undefined;
      visited.add(id);
      const base = faction.baseCatalogId ? resolve(faction.baseCatalogId) : undefined;
      if (!base) return { ...faction };
      return {
        ...base,
        ...faction,
        unitRefs: unique([...base.unitRefs, ...faction.unitRefs]),
        excludedUnitRefs: unique([...(base.excludedUnitRefs ?? []), ...(faction.excludedUnitRefs ?? [])]),
        ruleRefs: unique([...(base.ruleRefs ?? []), ...(faction.ruleRefs ?? [])]),
        stratagemRefs: unique([...(base.stratagemRefs ?? []), ...(faction.stratagemRefs ?? [])]),
        detachmentRefs: unique([...(base.detachmentRefs ?? []), ...(faction.detachmentRefs ?? [])]),
        factionKeywords: unique([...(base.factionKeywords ?? []), ...(faction.factionKeywords ?? [])]),
        coverage: faction.coverage ?? base.coverage,
      };
    };
    return resolve(factionId);
  }

  unit(unitId: string): UnitDefinition | undefined {
    const unit = this.unitsById.get(unitId);
    return unit && entryStatusAllowed(unit.status, this.options) ? unit : undefined;
  }

  rule(ruleId: string): RuleDefinition | undefined {
    const rule = this.rulesById.get(ruleId);
    return rule && entryStatusAllowed(rule.status, this.options) ? rule : undefined;
  }

  unitsForFaction(factionId: string): UnitDefinition[] {
    const faction = this.effectiveFaction(factionId);
    if (!faction) return [];
    const excluded = new Set(faction.excludedUnitRefs ?? []);
    return faction.unitRefs
      .filter(unitId => !excluded.has(unitId))
      .map(unitId => this.unit(unitId))
      .filter((unit): unit is UnitDefinition => unit !== undefined);
  }

  unitIdForName(factionId: string, name: string): string | undefined {
    const needle = normalizeName(name);
    return this.unitsForFaction(factionId).find(unit =>
      [unit.name, ...(unit.aliases ?? []), ...Object.values(unit.externalIds ?? {})]
        .some(candidate => normalizeName(candidate) === needle),
    )?.id;
  }

  rulesForContext(context: CatalogArmyContext | string): RuleDefinition[] {
    const normalizedContext: CatalogArmyContext = typeof context === 'string'
      ? { factionId: context }
      : context;
    this.assertCatalogContext(normalizedContext);
    const faction = this.effectiveFaction(normalizedContext.factionId);
    if (!faction) return [];

    const rules = new Map<string, RuleDefinition>();
    for (const ruleId of [...(faction.ruleRefs ?? []), ...(faction.stratagemRefs ?? [])]) {
      const rule = this.rule(ruleId);
      if (rule) rules.set(rule.id, rule);
    }

    const detachmentIds = unique([
      ...(normalizedContext.detachmentIds ?? []),
      ...(normalizedContext.detachmentId ? [normalizedContext.detachmentId] : []),
    ]);
    for (const detachmentId of detachmentIds) {
      const detachmentAllowed = faction.detachmentRefs?.includes(detachmentId) ?? false;
      if (!detachmentAllowed) continue;
      for (const rule of this.bundle.rules) {
        if (rule.detachmentId !== detachmentId && rule.id !== detachmentId) continue;
        if (entryStatusAllowed(rule.status, this.options)) rules.set(rule.id, rule);
      }
    }
    return [...rules.values()];
  }

  stratagemsForContext(context: CatalogArmyContext | string): RuleDefinition[] {
    return this.rulesForContext(context).filter(rule => rule.kind === 'stratagem');
  }

  enhancementsForContext(context: CatalogArmyContext | string): RuleDefinition[] {
    return this.rulesForContext(context).filter(rule => rule.kind === 'wargear');
  }

  enhancementsForUnit(context: CatalogArmyContext | string, unit: UnitProfile): RuleDefinition[] {
    const normalizedContext: CatalogArmyContext = typeof context === 'string'
      ? { factionId: context }
      : context;
    const faction = this.effectiveFaction(normalizedContext.factionId);
    if (!faction) return [];
    return this.enhancementsForContext(normalizedContext)
      .filter(rule => enhancementEligible(rule, unit, faction));
  }

  materializeUnit(selection: UnitSelection, context: CatalogArmyContext): CatalogMaterializationResult {
    this.assertCatalogContext(context);
    const definition = this.unit(selection.unitId);
    if (!definition) throw new CatalogMaterializationError(`Unit ${selection.unitId} is not available in this catalog.`);
    const faction = this.effectiveFaction(context.factionId);
    if (!faction) throw new CatalogMaterializationError(`Faction ${context.factionId} is not available in this catalog.`);
    if (!this.unitsForFaction(context.factionId).some(unit => unit.id === definition.id)) {
      throw new CatalogMaterializationError(`${definition.name} is not available to ${faction.name}.`);
    }

    const modelCount = selection.modelCount ?? definition.profile.baseModelCount;
    const range = definition.modelCount;
    if (!Number.isInteger(modelCount) || modelCount < 1) {
      throw new CatalogMaterializationError(`${definition.name} must contain at least one model.`);
    }
    if (range && (modelCount < range.minimum || (range.maximum !== undefined && modelCount > range.maximum))) {
      throw new CatalogMaterializationError(`${definition.name} does not allow ${modelCount} models.`);
    }
    if (range?.step && (modelCount - range.minimum) % range.step !== 0) {
      throw new CatalogMaterializationError(`${definition.name} does not allow a ${modelCount}-model increment.`);
    }

    const profile = copyUnitProfile(definition.profile);
    const warnings: string[] = [];
    profile.name = definition.name;
    profile.catalogRole = definition.role;
    profile.rosterId = selection.instanceId ?? definition.id;
    profile.baseModelCount = modelCount;
    profile.modelCountRange = definition.modelCount ? { ...definition.modelCount } : profile.modelCountRange;
    profile.leaderTargetNames = definition.leaderTargetNames ? [...definition.leaderTargetNames] : undefined;
    profile.leaderTargetRefs = definition.leaderTargetRefs ? [...definition.leaderTargetRefs] : undefined;
    profile.wargearOptions = definition.wargearOptions
      ? [...definition.wargearOptions]
      : profile.wargearOptions;
    profile.deployment = selection.deployment ?? profile.deployment;
    profile.leaderAttachment = selection.leaderAttachment ?? profile.leaderAttachment;
    const explicitSelectedWargear = selection.selectedWargear ?? profile.selectedWargear;
    profile.selectedWargear = explicitSelectedWargear ? [...explicitSelectedWargear] : explicitSelectedWargear;
    const explicitSelectedEnhancement = selection.selectedEnhancementId ?? profile.selectedEnhancementId;
    profile.selectedEnhancementId = explicitSelectedEnhancement;
    profile.modelWeaponLoadouts = resizeModelLoadouts(profile.modelWeaponLoadouts, modelCount);
    const choiceModelCount = Math.max(modelCount, range?.maximum ?? modelCount);
    const choiceProfile = choiceModelCount === modelCount
      ? profile
      : {
        ...profile,
        baseModelCount: choiceModelCount,
        modelWeaponLoadouts: resizeModelLoadouts(profile.modelWeaponLoadouts, choiceModelCount),
      };
    const catalogWargearChoices = definition.wargearChoices
      ?? (definition.wargearOptions?.length
        ? deriveWargearChoices(definition.id, choiceProfile, definition.wargearOptions, definition.wargearOptionGroups)
        : undefined);
    profile.wargearChoices = catalogWargearChoices
      ? materializeWargearChoices(catalogWargearChoices, definition.wargearOptions ?? []).map(choice => ({
        ...choice,
        eligibleModelIndexes: choice.eligibleModelIndexes ? [...choice.eligibleModelIndexes] : undefined,
        weaponNames: choice.weaponNames ? [...choice.weaponNames] : undefined,
        replacesWeaponNames: choice.replacesWeaponNames ? [...choice.replacesWeaponNames] : undefined,
      }))
      : undefined;
    profile.unitLoadoutOptions = definition.unitLoadoutOptions?.map(option => ({
      ...option,
      modelWeaponLoadouts: option.modelWeaponLoadouts?.map(loadout => [...loadout]),
      modelWargearChoices: option.modelWargearChoices?.map(choices => [...choices]),
      selectedWargear: option.selectedWargear ? [...option.selectedWargear] : undefined,
    }));
    profile.preBattleFormations = (definition.preBattleFormations ?? profile.preBattleFormations)?.map(rule => ({
      ...rule,
      modelCounts: [...rule.modelCounts],
      abilityGroups: rule.abilityGroups?.map(group => ({ ...group, abilityNames: [...group.abilityNames] })),
    }));
    if (profile.selectedWargear === undefined && profile.wargearChoices?.length) {
      profile.selectedWargear = automaticFreeScalableUnitUpgrades(profile.wargearChoices, modelCount);
    }
    profile.factionKeywords = unique([...profile.factionKeywords, ...(faction.factionKeywords ?? []), faction.name]);

    const canonicalBases = baseSizesForUnit(faction.name, profile);
    const suppliedBases = mergeCanonicalBaseGeometry(canonicalBases, profile.modelBases);
    if (!profile.modelBases?.length && suppliedBases?.length) {
      warnings.push(`${definition.name} used the compatibility base-size map; move the geometry into the catalog entry during normalization.`);
    }
    profile.modelBases = resizeModelBases(suppliedBases, modelCount);
    if (!profile.modelBases?.length) {
      warnings.push(`${definition.name} has no resolved model-base geometry.`);
    }
    profile.modelWargearChoices = resizeModelValues(profile.modelWargearChoices, modelCount, choices => [...choices]);

    if (definition.status === 'unsupported' || definition.implementationStatus === 'display-only') {
      warnings.push(`${definition.name} is cataloged for display but has no supported runtime behavior.`);
    } else if (definition.implementationStatus === 'partial') {
      warnings.push(`${definition.name} contains raw abilities that are not yet executable.`);
    }

    const referencedRules = (definition.ruleRefs ?? []).map(ruleId => {
      const rule = this.rule(ruleId);
      if (!rule) throw new CatalogMaterializationError(`${definition.name} references missing rule ${ruleId}.`);
      return rule;
    });
    const unitRules = referencedRules.filter(rule => rule.kind !== 'stratagem' && rule.kind !== 'detachment-rule');
    const skippedRules = referencedRules.filter(rule => rule.kind === 'stratagem' || rule.kind === 'detachment-rule');
    for (const rule of skippedRules) warnings.push(`${rule.name} is not a unit ability and was not attached to ${definition.name}.`);

    profile.abilities = addRuleText(
      addRuleText(profile.abilities, definition.rawRules ?? []),
      unitRules.map(ruleTextForDefinition),
    );
    profile.abilities = hydrateCoreAbilities(profile.abilities);

    return {
      profile,
      definition,
      appliedRuleIds: unitRules.map(rule => rule.id),
      warnings,
    };
  }

  materializeArmy(options: CatalogArmyMaterializationOptions): CatalogArmyMaterializationResult {
    const faction = this.effectiveFaction(options.factionId);
    if (!faction) throw new CatalogMaterializationError(`Faction ${options.factionId} is not available in this catalog.`);

    const warnings: string[] = [];
    const units = options.selections.map((selection, index) => {
      const result = this.materializeUnit({
        ...selection,
        instanceId: selection.instanceId ?? `${selection.unitId}-${index + 1}`,
      }, options);
      warnings.push(...result.warnings);
      return result.profile;
    });

    return {
      army: {
        name: options.name,
        faction: faction.name,
        units,
        battleSizeId: options.battleSizeId,
        detachmentId: options.detachmentId ?? options.detachmentIds?.[0],
        ...(options.detachmentIds?.length ? { detachmentIds: [...options.detachmentIds] } : {}),
        sourceEdition: this.manifest.edition,
      },
      catalog: {
        catalogId: this.manifest.catalogId,
        edition: this.manifest.edition,
        catalogRevision: this.manifest.catalogRevision,
      },
      warnings,
    };
  }

  runtimeUnitAbilities(context: CatalogArmyContext | string) {
    return this.rulesForContext(context)
      .filter(rule => availableRule(rule, this.options) && rule.runtime?.ability)
      .map(rule => ({
        ...rule.runtime!.ability!,
        id: runtimeIdForRule(rule),
        name: rule.name,
        description: rule.description,
      }));
  }

  runtimeStratagems(context: CatalogArmyContext | string) {
    return this.rulesForContext(context)
      .filter(rule => availableRule(rule, this.options) && rule.runtime?.stratagem)
      .map(rule => ({
        ...rule.runtime!.stratagem!,
        id: runtimeIdForRule(rule),
        name: rule.name,
        description: rule.description,
      }));
  }
}

/** Merge catalog-provided executable rules into the existing edition runtime. */
export function rulesEditionWithCatalog(
  baseRules: RulesEdition,
  registry: CatalogRegistry,
  context: CatalogArmyContext | string,
): RulesEdition {
  const catalogAbilities = registry.runtimeUnitAbilities(context);
  const catalogStratagems = registry.runtimeStratagems(context);
  const abilityIds = new Set(catalogAbilities.map(ability => ability.id));
  const stratagemIds = new Set(catalogStratagems.map(stratagem => stratagem.id));
  return {
    ...baseRules,
    unitAbilities: [
      ...baseRules.unitAbilities.filter(ability => !abilityIds.has(ability.id)),
      ...catalogAbilities,
    ],
    stratagems: [
      ...baseRules.stratagems.filter(stratagem => !stratagemIds.has(stratagem.id)),
      ...catalogStratagems,
    ],
  };
}

export function materializeCatalogUnit(
  registry: CatalogRegistry,
  selection: UnitSelection,
  context: CatalogArmyContext,
): CatalogMaterializationResult {
  return registry.materializeUnit(selection, context);
}

export function materializeCatalogArmy(
  registry: CatalogRegistry,
  options: CatalogArmyMaterializationOptions,
): CatalogArmyMaterializationResult {
  return registry.materializeArmy(options);
}

const CATALOG_BY_FACTION = new Map(
  CATALOG_BUNDLES.flatMap(bundle => bundle.factions.map(faction => [faction.id, bundle] as const)),
);

export function loadCatalog(factionId: string, options: CatalogRegistryOptions = {}): CatalogRegistry {
  const bundle = CATALOG_BY_FACTION.get(factionId.trim().toLowerCase());
  if (!bundle) throw new CatalogMaterializationError(`Faction catalog ${factionId} is not available.`);
  return new CatalogRegistry(bundle, options);
}

export function loadAllCatalogs(options: CatalogRegistryOptions = {}): CatalogRegistry[] {
  return CATALOG_BUNDLES.map(bundle => new CatalogRegistry(bundle, options));
}

export function loadOrkCatalog(options: CatalogRegistryOptions = {}): CatalogRegistry {
  return new CatalogRegistry(ORKS_CATALOG, options);
}

export function loadNecronCatalog(options: CatalogRegistryOptions = {}): CatalogRegistry {
  return new CatalogRegistry(NECRONS_CATALOG, options);
}

export function createCatalogRegistry(bundle: CatalogBundle, options: CatalogRegistryOptions = {}): CatalogRegistry {
  return new CatalogRegistry(bundle, options);
}

export const orkCatalogRegistry = loadOrkCatalog();
