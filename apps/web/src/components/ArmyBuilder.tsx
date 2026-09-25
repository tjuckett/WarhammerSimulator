import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmyCatalog, ArmyCatalogBattleSize, ImportedArmy, UnitProfile } from '@warhammer-simulator/core/types/army';
import type { RuleDefinition, UnitPointsEntry } from '@warhammer-simulator/core/types/catalog';
import type { SavedArmyRecord } from '../army/armyRepository';
import { STANDARD_BATTLE_SIZES } from '@warhammer-simulator/core/data/armySizes';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { validateImportedArmy } from '@warhammer-simulator/core/engine/armyValidation';
import { loadAllCatalogs, rulePoints } from '@warhammer-simulator/core/engine/catalog';
import type { CatalogRegistry } from '@warhammer-simulator/core/engine/catalog';
import type { DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import { ELEVENTH_EDITION_FORCE_DISPOSITIONS } from '@warhammer-simulator/core/engine/missions';
import type { EleventhForceDispositionId } from '@warhammer-simulator/core/engine/missions';
import { parseBattleScribeCatalogueJSON, parseBattleScribeJSON } from '@warhammer-simulator/core/parsers/battlescribe';
import { parseListhammerMarkdown } from '@warhammer-simulator/core/parsers/listhammer';
import { ArmyPanel } from './ArmyPanel';
import { UnitStatsPanel } from './UnitStatsPanel';
import { maximizeFreeScalableUnitUpgrades } from './armyPanelHelpers';

type Props = {
  army: ImportedArmy;
  sampleArmies: ImportedArmy[];
  savedArmies: SavedArmyRecord[];
  onChange: (army: ImportedArmy) => void;
  onSave: (army: ImportedArmy, id?: string) => Promise<SavedArmyRecord | null>;
  onLoad: (id: string) => Promise<SavedArmyRecord | null>;
  onDelete: (id: string) => Promise<void>;
  storageStatus?: string;
};

const BUILDER_COLOR: [string, string] = ['#4af26a', '#f24a4a'];
const BUILDER_STRATEGY: DeploymentStrategy = 'balanced';
const AVAILABLE_CATALOGS = loadAllCatalogs();
const CATALOGS_BY_FACTION = Object.fromEntries(
  AVAILABLE_CATALOGS.flatMap(catalog => catalog.bundle.factions.map(faction => [faction.id, catalog] as const)),
);

const BUILDER_FACTIONS = [
  ...AVAILABLE_CATALOGS.flatMap(catalog => catalog.bundle.factions.map(faction => ({
    id: faction.id,
    name: faction.name,
    availability: '11th-edition Wahapedia catalog units and current faction rules',
  }))),
  { id: 'custom', name: 'Custom', availability: 'Imported units only' },
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function blankArmy(): ImportedArmy {
  return {
    name: 'New Army',
    faction: 'Custom',
    units: [],
  };
}

const EXCLUDED_BUILDER_BATTLE_SIZE_IDS = new Set(['combat-patrol', 'onslaught']);

function isBuilderBattleSizeAllowed(size: ArmyCatalogBattleSize): boolean {
  const id = size.id.trim().toLowerCase();
  const label = size.label.trim().toLowerCase();
  return !EXCLUDED_BUILDER_BATTLE_SIZE_IDS.has(id)
    && !EXCLUDED_BUILDER_BATTLE_SIZE_IDS.has(label.replace(/\s+/g, '-'));
}

function forceDispositionFor(
  army: ImportedArmy,
  availableDispositions: readonly { id: EleventhForceDispositionId }[],
): EleventhForceDispositionId | undefined {
  return availableDispositions.some(disposition => disposition.id === army.forceDisposition)
    ? army.forceDisposition
    : availableDispositions[0]?.id;
}

function normalizeFaction(value: string): string {
  return value.trim().toLowerCase();
}

function factionOptionFor(value: string) {
  return BUILDER_FACTIONS.find(option => option.id === normalizeFaction(value));
}

function catalogForFaction(faction: string) {
  return CATALOGS_BY_FACTION[normalizeFaction(faction) as keyof typeof CATALOGS_BY_FACTION];
}

function unitBelongsToFaction(unit: UnitProfile, faction: string): boolean {
  const normalizedFaction = normalizeFaction(faction);
  if (normalizedFaction === 'custom') return false;
  return unit.factionKeywords.some(keyword => normalizeFaction(keyword) === normalizedFaction);
}

function displayUnitId(unit: UnitProfile): string {
  return `${unitRosterId(unit)}:${unit.name}`;
}

function normalizedUnitName(unit: UnitProfile): string {
  return unit.name.trim().toLowerCase();
}

function uniqueLibraryUnits(armies: ImportedArmy[], catalogUnits: UnitProfile[] = [], faction: string): UnitProfile[] {
  const seen = new Set<string>();
  const units: UnitProfile[] = [];
  const catalogNames = new Set(catalogUnits.map(normalizedUnitName));
  const addUnit = (unit: UnitProfile) => {
    const key = displayUnitId(unit);
    if (seen.has(key)) return;
    seen.add(key);
    units.push(unit);
  };
  for (const unit of catalogUnits) addUnit(unit);
  for (const army of armies) {
    for (const unit of army.units) {
      if (unitBelongsToFaction(unit, faction) && !catalogNames.has(normalizedUnitName(unit))) addUnit(unit);
    }
    for (const catalogUnit of army.catalog?.units ?? []) {
      const unit = catalogUnit.profile;
      if (!unit) continue;
      if (unitBelongsToFaction(unit, faction) && !catalogNames.has(normalizedUnitName(unit))) addUnit(unit);
    }
  }
  return units.sort((left, right) => left.name.localeCompare(right.name));
}

function catalogUnitsForFaction(faction: string): UnitProfile[] {
  const factionId = normalizeFaction(faction);
  const catalog = catalogForFaction(factionId);
  if (!catalog) return [];
  return catalog.unitsForFaction(factionId).map(definition =>
    catalog.materializeUnit({ unitId: definition.id, instanceId: definition.id }, { factionId: factionId }).profile,
  );
}

type BuilderDetachmentOption = {
  id: string;
  label: string;
  description?: string;
  forceDispositions: EleventhForceDispositionId[];
};

function detachmentRuleForId(id: string, catalog: CatalogRegistry): RuleDefinition | undefined {
  return catalog.rule(id)
    ?? catalog.bundle.rules.find(rule => rule.detachmentId === id);
}

function detachmentLabel(rule: RuleDefinition): string {
  return rule.name.replace(/\s+[-–—]\s+.*$/, '').trim() || rule.name;
}

function detachmentOptionsFor(army: ImportedArmy): BuilderDetachmentOption[] {
  const options: BuilderDetachmentOption[] = [];
  const factionId = normalizeFaction(army.faction);
  const catalog = catalogForFaction(factionId);
  if (catalog) {
    const faction = catalog.faction(factionId);
    for (const id of faction?.detachmentRefs ?? []) {
      const rule = detachmentRuleForId(id, catalog);
      if (!rule) continue;
      options.push({
        id,
        label: detachmentLabel(rule),
        description: rule.description,
        forceDispositions: [...(rule.forceDispositions ?? [])],
      });
    }
  }

  const currentIds = [...new Set([
    ...(army.detachmentIds ?? []),
    ...(army.detachmentId ? [army.detachmentId] : []),
  ])];
  const importedName = army.sourceMetadata?.detachmentName?.trim();
  for (const currentId of currentIds) {
    if (!options.some(option => option.id === currentId)) {
      options.push({
        id: currentId,
        label: currentId === army.detachmentId ? importedName || currentId : currentId,
        forceDispositions: [],
      });
    }
  }
  if (importedName && !options.some(option =>
    option.label.trim().toLowerCase() === importedName.toLowerCase(),
  )) {
    options.push({
      id: army.detachmentId || `imported-detachment-${importedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: importedName,
      forceDispositions: [],
    });
  }

  return options.sort((left, right) => left.label.localeCompare(right.label));
}

function selectedDetachmentIdsFor(army: ImportedArmy, options: BuilderDetachmentOption[]): string[] {
  if (army.detachmentIds) return [...army.detachmentIds];
  if (army.detachmentId) return [army.detachmentId];
  const importedName = army.sourceMetadata?.detachmentName?.trim().toLowerCase();
  const importedOption = importedName
    ? options.find(option => option.label.trim().toLowerCase() === importedName)
    : undefined;
  return importedOption ? [importedOption.id] : [];
}

function forceDispositionOptionsFor(
  selectedIds: string[],
  options: BuilderDetachmentOption[],
) {
  const availableIds = new Set<EleventhForceDispositionId>();
  for (const id of selectedIds) {
    for (const disposition of options.find(option => option.id === id)?.forceDispositions ?? []) {
      availableIds.add(disposition);
    }
  }
  return ELEVENTH_EDITION_FORCE_DISPOSITIONS.filter(disposition => availableIds.has(disposition.id));
}

function DetachmentSummaryPanel({
  faction,
  selectedIds,
  options,
}: {
  faction: string;
  selectedIds: string[];
  options: BuilderDetachmentOption[];
}) {
  const factionId = normalizeFaction(faction);
  const catalog = catalogForFaction(factionId);
  const rules = catalog?.rulesForContext({ factionId, detachmentIds: selectedIds })
    .filter(rule => rule.kind === 'detachment-rule') ?? [];
  const rulesByDetachment = new Map<string, RuleDefinition[]>();
  for (const rule of rules) {
    const detachmentRules = rulesByDetachment.get(rule.detachmentId ?? rule.id) ?? [];
    detachmentRules.push(rule);
    rulesByDetachment.set(rule.detachmentId ?? rule.id, detachmentRules);
  }

  return (
    <div className="army-builder-detachment-summary">
      <div className="army-builder-section-title">Detachment rules</div>
      {selectedIds.length === 0 ? (
        <div className="army-builder-empty-summary">Select one or more detachments to see their combined rules.</div>
      ) : (
        <div className="army-builder-summary-rules">
          {selectedIds.map(id => {
            const option = options.find(candidate => candidate.id === id);
            const detachmentRules = rulesByDetachment.get(id) ?? [];
            return (
              <article key={id} className="army-builder-summary-rule">
                <strong>{option?.label ?? id}</strong>
                {detachmentRules.length ? detachmentRules.map(rule => <p key={rule.id}>{rule.description}</p>) : (
                  <p>{option?.description ?? 'No rule text is available in the built-in catalog.'}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function battleSizeOptionsFor(army: ImportedArmy): ArmyCatalogBattleSize[] {
  const options = STANDARD_BATTLE_SIZES.filter(isBuilderBattleSizeAllowed).map(size => ({ ...size }));
  for (const importedSize of army.catalog?.battleSizes ?? []) {
    if (!isBuilderBattleSizeAllowed(importedSize)) continue;
    const matchingIndex = options.findIndex(size =>
      size.id === importedSize.id
      || (size.maximumPoints !== undefined && size.maximumPoints === importedSize.maximumPoints),
    );
    if (matchingIndex >= 0) options[matchingIndex] = { ...importedSize };
    else options.push({ ...importedSize });
  }
  if (army.battleSizeId
    && !options.some(size => size.id === army.battleSizeId)
    && !EXCLUDED_BUILDER_BATTLE_SIZE_IDS.has(army.battleSizeId.trim().toLowerCase())) {
    options.push({ id: army.battleSizeId, label: army.battleSizeId });
  }
  return options;
}

function catalogWithStandardBattleSizes(army: ImportedArmy): ArmyCatalog | undefined {
  if (!army.catalog) return undefined;
  return { ...army.catalog, battleSizes: battleSizeOptionsFor(army) };
}

function keepEnhancementSelections(
  units: UnitProfile[],
  rules: Map<string, RuleDefinition>,
): { units: UnitProfile[]; changed: boolean } {
  const selectedEnhancements = new Map<string, number>();
  let changed = false;
  const normalizedUnits = units.map(unit => {
    const enhancementId = unit.selectedEnhancementId;
    if (!enhancementId) return unit;
    const selectionCount = selectedEnhancements.get(enhancementId) ?? 0;
    const maximumSelections = Math.max(1, rules.get(enhancementId)?.maximumSelections ?? 1);
    if (selectionCount < maximumSelections) {
      selectedEnhancements.set(enhancementId, selectionCount + 1);
      return unit;
    }
    changed = true;
    return { ...unit, selectedEnhancementId: undefined };
  });
  return { units: normalizedUnits, changed };
}

function hydrateCatalogWargear(army: ImportedArmy, catalogUnits: UnitProfile[], selectedDetachmentIds: string[]): ImportedArmy {
  const catalogByName = new Map(catalogUnits.map(unit => [normalizedUnitName(unit), unit]));
  let changed = false;
  const factionId = normalizeFaction(army.faction);
  const catalog = catalogForFaction(factionId);
  const enhancementRules = new Map(
    catalog?.enhancementsForContext({ factionId, detachmentIds: selectedDetachmentIds }).map(rule => [rule.id, rule]) ?? [],
  );
  const units = army.units.map(unit => {
    if (!unitBelongsToFaction(unit, factionId)) return unit;
    const catalogUnit = catalogByName.get(normalizedUnitName(unit));
    if (!catalogUnit) return unit;
    // Catalog fixes can add the melee half of a ranged/melee weapon (such as
    // the Lokhust Lord's Staff of light). Keep an already-saved roster in
    // sync when it is missing that exact profile, even if the unit has no
    // configurable wargear choices of its own.
    const catalogAddsWeaponProfile = catalogUnit.weapons.some(catalogWeapon =>
      !unit.weapons.some(weapon =>
        weapon.name.trim().toLowerCase() === catalogWeapon.name.trim().toLowerCase()
        && weapon.isMelee === catalogWeapon.isMelee,
      ),
    );
    const hasCatalogChoices = !!catalogUnit.wargearChoices?.length || !!unit.wargearChoices?.length;
    const catalogHasLoadoutOptions = !!catalogUnit.unitLoadoutOptions?.length;
    const clearLegacyLoadoutOptions = !catalogHasLoadoutOptions
      && !!unit.unitLoadoutOptions?.length
      && !!catalogUnit.wargearChoices?.length;
    const hasCatalogLoadoutOptions = catalogHasLoadoutOptions || clearLegacyLoadoutOptions;
    const catalogRoleChanged = unit.catalogRole !== catalogUnit.catalogRole;
    const leaderMetadataChanged = JSON.stringify(unit.leaderTargetNames) !== JSON.stringify(catalogUnit.leaderTargetNames)
      || JSON.stringify(unit.leaderTargetRefs) !== JSON.stringify(catalogUnit.leaderTargetRefs);
    const preBattleFormationChanged = JSON.stringify(unit.preBattleFormations) !== JSON.stringify(catalogUnit.preBattleFormations);
    const catalogAbilitiesByName = new Map(catalogUnit.abilities.map(rule => [rule.name.trim().toLowerCase(), rule]));
    const abilities = unit.abilities.map(rule => {
      if (!rule.description.startsWith('Core ability: ')) return rule;
      const catalogAbility = catalogAbilitiesByName.get(rule.name.trim().toLowerCase());
      return catalogAbility?.description && catalogAbility.description !== rule.description
        ? { ...rule, description: catalogAbility.description }
        : rule;
    });
    const abilitiesChanged = abilities.some((rule, index) => rule !== unit.abilities[index]);
    const catalogChoicesChanged = !!catalogUnit.wargearChoices?.length
      && JSON.stringify(unit.wargearChoices) !== JSON.stringify(catalogUnit.wargearChoices);
    const legalEnhancements = catalog?.enhancementsForUnit({ factionId, detachmentIds: selectedDetachmentIds }, catalogUnit) ?? [];
    const selectedEnhancementId = unit.selectedEnhancementId
      && legalEnhancements.some(enhancement => enhancement.id === unit.selectedEnhancementId)
      ? unit.selectedEnhancementId
      : undefined;
    const enhancementChanged = selectedEnhancementId !== unit.selectedEnhancementId;
    if (!hasCatalogChoices && !hasCatalogLoadoutOptions && !catalogAddsWeaponProfile && !catalogRoleChanged && !leaderMetadataChanged && !abilitiesChanged && !preBattleFormationChanged && !enhancementChanged) return unit;
    const catalogChoicesById = new Map((catalogUnit.wargearChoices ?? []).map(choice => [choice.id, choice]));
    const wargearChoices = catalogChoicesChanged
      ? clone(catalogUnit.wargearChoices)
      : hasCatalogChoices && unit.wargearChoices?.length
      ? unit.wargearChoices.map(choice => {
        const catalogChoice = catalogChoicesById.get(choice.id);
        return choice.description || !catalogChoice?.description
          ? choice
          : { ...choice, description: catalogChoice.description };
      })
      : hasCatalogChoices ? clone(catalogUnit.wargearChoices) : undefined;
    const unitLoadoutOptions = catalogHasLoadoutOptions
      ? clone(catalogUnit.unitLoadoutOptions)
      : undefined;
    const choiceWeaponNames = wargearChoices?.flatMap(choice => choice.weaponNames ?? []) ?? [];
    const needsCanonicalWeaponData = catalogAddsWeaponProfile || (!unit.wargearChoices?.length && hasCatalogChoices)
      || choiceWeaponNames.some(name => {
        const normalizedName = name.trim().toLowerCase();
        const catalogHasWeapon = catalogUnit.weapons.some(weapon => weapon.name.trim().toLowerCase() === normalizedName);
        return catalogHasWeapon && !unit.weapons.some(weapon => weapon.name.trim().toLowerCase() === normalizedName);
      });
    const hydratedUnit = { ...unit, wargearChoices };
    const selectedWargear = unit.selectedWargear === undefined
      ? maximizeFreeScalableUnitUpgrades(hydratedUnit)
      : unit.selectedWargear;
    const choicesChanged = catalogChoicesChanged || (
      hasCatalogChoices
      && (!unit.wargearChoices?.length
        || wargearChoices?.some((choice, index) => choice !== unit.wargearChoices?.[index]))
    );
    const loadoutOptionsChanged = clearLegacyLoadoutOptions
      || (catalogHasLoadoutOptions && JSON.stringify(unitLoadoutOptions) !== JSON.stringify(unit.unitLoadoutOptions));
    if (!choicesChanged && !loadoutOptionsChanged && !needsCanonicalWeaponData && !enhancementChanged && !preBattleFormationChanged && unit.modelCountRange && selectedWargear === unit.selectedWargear) return unit;
    changed = true;
    return {
      ...unit,
      ...(abilitiesChanged ? { abilities } : {}),
      catalogRole: catalogUnit.catalogRole,
      modelCountRange: unit.modelCountRange ?? catalogUnit.modelCountRange,
      leaderTargetNames: catalogUnit.leaderTargetNames?.length ? [...catalogUnit.leaderTargetNames] : undefined,
      leaderTargetRefs: catalogUnit.leaderTargetRefs?.length ? [...catalogUnit.leaderTargetRefs] : undefined,
      preBattleFormations: catalogUnit.preBattleFormations
        ? clone(catalogUnit.preBattleFormations)
        : undefined,
      ...(wargearChoices ? { wargearChoices } : {}),
      ...(choicesChanged && wargearChoices
        ? {
          modelWargearChoices: unit.modelWargearChoices?.map(choices => choices.filter(choiceId =>
            wargearChoices.some(choice => choice.id === choiceId),
          )),
        }
        : {}),
      ...(catalogHasLoadoutOptions || clearLegacyLoadoutOptions ? { unitLoadoutOptions } : {}),
      ...(selectedWargear === undefined ? {} : { selectedWargear }),
      selectedEnhancementId,
      ...(needsCanonicalWeaponData
        ? {
          weapons: clone(catalogUnit.weapons),
          modelWeaponLoadouts: catalogUnit.modelWeaponLoadouts
            ? clone(catalogUnit.modelWeaponLoadouts)
            : unit.modelWeaponLoadouts,
        }
        : {}),
    };
  });
  const normalizedEnhancementSelections = keepEnhancementSelections(units, enhancementRules);
  if (normalizedEnhancementSelections.changed) changed = true;
  return changed ? { ...army, units: normalizedEnhancementSelections.units } : army;
}

function pointEntriesForUnit(unit: UnitProfile, army: ImportedArmy): UnitPointsEntry[] {
  const importedEntry = army.catalog?.units.find(candidate =>
    candidate.id === unit.rosterId
    || (candidate.names ?? []).some(name => name.trim().toLowerCase() === normalizedUnitName(unit))
    || candidate.profile?.name?.trim().toLowerCase() === normalizedUnitName(unit),
  );
  if (importedEntry?.modelCountPoints) {
    return Object.entries(importedEntry.modelCountPoints).map(([modelCount, points]) => ({
      modelCount: Number(modelCount),
      points,
    }));
  }
  const factionId = normalizeFaction(army.faction);
  const catalog = catalogForFaction(factionId);
  if (!catalog) return [];
  const unitId = catalog.unitIdForName(factionId, unit.name);
  return unitId ? catalog.unit(unitId)?.points ?? [] : [];
}

function unitOccurrence(army: ImportedArmy, unit: UnitProfile, unitIndex: number): number {
  const name = normalizedUnitName(unit);
  return army.units
    .slice(0, unitIndex)
    .filter(candidate => normalizedUnitName(candidate) === name)
    .length + 1;
}

function pointEntryForUnit(entries: UnitPointsEntry[], modelCount: number, occurrence: number): UnitPointsEntry | undefined {
  const matching = entries.filter(entry => entry.modelCount === modelCount);
  if (!matching.length) return undefined;
  if (matching.length === 1) return matching[0];

  const ranged = matching.find(entry => {
    if (entry.unitNumber) {
      return (entry.unitNumber.minimum === undefined || occurrence >= entry.unitNumber.minimum)
        && (entry.unitNumber.maximum === undefined || occurrence <= entry.unitNumber.maximum);
    }
    const label = entry.label?.toLowerCase() ?? '';
    const range = label.match(/(\d+)(?:st|nd|rd|th)?\s*(?:to|-|–)\s*(\d+)/);
    if (range) return occurrence >= Number(range[1]) && occurrence <= Number(range[2]);
    const from = label.match(/(\d+)(?:st|nd|rd|th)?\s*\+/);
    return from ? occurrence >= Number(from[1]) : false;
  });
  if (ranged) return ranged;

  // Older normalized Ork entries retain duplicate brackets in source order
  // without the unit-number label: first/second units, then third and later.
  return matching[Math.min(Math.floor((Math.max(1, occurrence) - 1) / 2), matching.length - 1)];
}

function unitPointCost(unit: UnitProfile, unitIndex: number, army: ImportedArmy): number | undefined {
  const entry = pointEntryForUnit(pointEntriesForUnit(unit, army), unit.baseModelCount, unitOccurrence(army, unit, unitIndex));
  if (entry === undefined) return undefined;
  const factionId = normalizeFaction(army.faction);
  const catalog = catalogForFaction(factionId);
  const detachmentIds = selectedDetachmentIdsFor(army, detachmentOptionsFor(army));
  const enhancement = unit.selectedEnhancementId && catalog
    ? catalog.enhancementsForUnit({ factionId, detachmentIds }, unit)
      .find(rule => rule.id === unit.selectedEnhancementId)
    : undefined;
  return entry.points + (enhancement ? rulePoints(enhancement) ?? 0 : 0);
}

export function ArmyBuilder({ army, sampleArmies, savedArmies, onChange, onSave, onLoad, onDelete, storageStatus }: Props) {
  const [savedArmyId, setSavedArmyId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitSearch, setUnitSearch] = useState('');
  const addedUnitSequence = useRef(0);
  const catalogUnits = useMemo(() => catalogUnitsForFaction(army.faction), [army.faction]);
  const detachmentOptions = useMemo(() => detachmentOptionsFor(army), [army]);
  const selectedDetachmentIds = useMemo(
    () => selectedDetachmentIdsFor(army, detachmentOptions),
    [army, detachmentOptions],
  );
  const forceDispositionOptions = useMemo(
    () => forceDispositionOptionsFor(selectedDetachmentIds, detachmentOptions),
    [detachmentOptions, selectedDetachmentIds],
  );
  const hydratedArmy = useMemo(
    () => hydrateCatalogWargear(army, catalogUnits, selectedDetachmentIds),
    [army, catalogUnits, selectedDetachmentIds],
  );
  useEffect(() => {
    if (hydratedArmy !== army) onChange(hydratedArmy);
  }, [army, hydratedArmy, onChange]);
  const library = useMemo(
    () => uniqueLibraryUnits([...sampleArmies, hydratedArmy], catalogUnits, hydratedArmy.faction),
    [catalogUnits, hydratedArmy, sampleArmies],
  );
  const visibleLibrary = useMemo(() => {
    const needle = unitSearch.trim().toLowerCase();
    if (!needle) return library;
    return library.filter(unit => [unit.name, ...unit.keywords, ...unit.factionKeywords]
      .some(value => value.toLowerCase().includes(needle)));
  }, [library, unitSearch]);
  const validationCatalog = useMemo(() => catalogWithStandardBattleSizes(army), [army]);
  const validation = useMemo(() => validateImportedArmy(army, {
    catalog: validationCatalog,
    battleSizeId: army.battleSizeId,
  }), [army, validationCatalog]);
  const battleSizeOptions = useMemo(() => battleSizeOptionsFor(army), [army]);
  const selectedUnit = army.units.find(unit => displayUnitId(unit) === selectedUnitId) ?? army.units[0] ?? null;
  const selectedEnhancementOptions = useMemo(() => {
    const factionId = normalizeFaction(army.faction);
    const catalog = catalogForFaction(factionId);
    if (!selectedUnit || !catalog) return [];
    return catalog.enhancementsForUnit({ factionId, detachmentIds: selectedDetachmentIds }, selectedUnit)
      .filter(option => option.id === selectedUnit.selectedEnhancementId);
  }, [army, selectedDetachmentIds, selectedUnit]);
  const selectedFaction = factionOptionFor(army.faction);
  const mismatchedUnits = army.units.filter(unit => !unitBelongsToFaction(unit, army.faction));
  const pointCosts = useMemo(() => army.units.map((unit, index) => unitPointCost(unit, index, army)), [army]);
  const knownPointTotal = pointCosts.reduce((total, points) => total + (points ?? 0), 0);
  const unknownPointCount = pointCosts.filter(points => points === undefined).length;
  const pointSummary = unknownPointCount === 0
    ? `${knownPointTotal} pts`
    : knownPointTotal > 0
      ? `${knownPointTotal} pts + ${unknownPointCount} unknown`
      : 'Points unavailable';

  function updateArmy(nextArmy: ImportedArmy) {
    onChange(nextArmy);
  }

  function changeFaction(faction: string) {
    const selected = factionOptionFor(faction);
    const nextFaction = selected?.name ?? faction;
    updateArmy({
      ...army,
      faction: nextFaction,
      ...(normalizeFaction(nextFaction) === normalizeFaction(army.faction)
        ? {}
        : { detachmentId: undefined, detachmentIds: [], forceDisposition: undefined }),
    });
    setUnitSearch('');
  }

  function toggleDetachment(id: string, checked: boolean) {
    const nextIds = checked
      ? [...selectedDetachmentIds.filter(candidate => candidate !== id), id]
      : selectedDetachmentIds.filter(candidate => candidate !== id);
    const nextForceDispositionOptions = forceDispositionOptionsFor(nextIds, detachmentOptions);
    updateArmy({
      ...army,
      detachmentId: nextIds[0],
      detachmentIds: nextIds,
      forceDisposition: forceDispositionFor(army, nextForceDispositionOptions),
    });
  }

  function addUnit(source: UnitProfile) {
    const copy = clone(source);
    addedUnitSequence.current += 1;
    copy.rosterId = `${unitRosterId(source)}-builder-${addedUnitSequence.current}`;
    copy.deployment = undefined;
    copy.leaderAttachment = undefined;
    copy.selectedWargear = maximizeFreeScalableUnitUpgrades(copy);
    updateArmy(applyBaseSizesToArmy({ ...army, units: [...army.units, copy] }));
    setSelectedUnitId(displayUnitId(copy));
  }

  function handleImport(file: File) {
    void file.text().then(raw => {
      try {
        const imported = /\.(?:md|markdown|txt)$/i.test(file.name)
          ? parseListhammerMarkdown(raw)
          : (() => {
            const value: unknown = JSON.parse(raw);
            return isImportedArmy(value)
              ? value
              : (value && typeof value === 'object' && 'catalogue' in value)
                ? parseBattleScribeCatalogueJSON(value)
                : parseBattleScribeJSON(value);
          })();
        updateArmy(applyBaseSizesToArmy(imported));
        setSelectedUnitId(null);
      } catch (error) {
        window.alert(`Army import failed: ${error instanceof Error ? error.message : 'invalid roster file'}`);
      }
    }).catch(error => {
      window.alert(`Army import failed: ${error instanceof Error ? error.message : 'could not read the file'}`);
    });
  }

  function exportArmy() {
    const blob = new Blob([JSON.stringify(army, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${army.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'army'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveCurrentArmy(asNew = false) {
    const result = await onSave(army, asNew ? undefined : savedArmyId ?? undefined);
    if (result) setSavedArmyId(result.id);
  }

  async function loadArmy(id: string) {
    const result = await onLoad(id);
    if (!result) return;
    updateArmy(clone(result.army));
    setSelectedUnitId(null);
    setSavedArmyId(result.id);
  }

  async function deleteSelectedArmy() {
    if (!savedArmyId) return;
    await onDelete(savedArmyId);
    setSavedArmyId(null);
  }

  return (
    <div className="army-builder">
      <div className="army-builder-toolbar">
        <strong>Army Builder</strong>
        <label>
          Army library
          <select value={savedArmyId ?? ''} onChange={event => {
            const id = event.target.value;
            setSavedArmyId(id || null);
            if (id) void loadArmy(id);
          }}>
            <option value="">New or unsaved army</option>
            {savedArmies.map(record => <option key={record.id} value={record.id}>{record.army.name} ({record.army.faction})</option>)}
          </select>
        </label>
        <button type="button" onClick={() => { updateArmy(blankArmy()); setSavedArmyId(null); setSelectedUnitId(null); setUnitSearch(''); }}>New</button>
        <button
          type="button"
          onClick={() => { updateArmy({ ...army, units: [] }); setSelectedUnitId(null); }}
          disabled={army.units.length === 0}
          title="Remove every unit from this roster"
        >
          Clear roster
        </button>
        <button type="button" onClick={() => { void saveCurrentArmy(); }}>Save army</button>
        <button type="button" onClick={() => { void saveCurrentArmy(true); }}>Save as new</button>
        <button type="button" onClick={() => { void deleteSelectedArmy(); }} disabled={!savedArmyId}>Delete</button>
        <label className="army-builder-file-button">
          Import roster
          <input type="file" accept=".json,.md,.markdown,.txt" onChange={event => {
            const file = event.target.files?.[0];
            if (file) { setSavedArmyId(null); handleImport(file); }
            event.target.value = '';
          }} />
        </label>
        <button type="button" onClick={exportArmy}>Export JSON</button>
        {storageStatus && <span className="army-builder-storage-status">{storageStatus}</span>}
      </div>

      <div className={`army-builder-validation ${validation.valid ? 'is-valid' : 'has-errors'}`}>
        <strong>{validation.valid ? 'Roster structure valid' : `${validation.errors.length} roster issue${validation.errors.length === 1 ? '' : 's'}`}</strong>
        {mismatchedUnits.length > 0 && <span>{mismatchedUnits.length} unit{mismatchedUnits.length === 1 ? '' : 's'} do not match the selected faction.</span>}
        {validation.errors.slice(0, 3).map(item => <span key={`${item.code}:${item.unitIndex ?? 'army'}`}>{item.message}</span>)}
        {validation.warnings.slice(0, 2).map(item => <span key={`${item.code}:${item.unitIndex ?? 'army'}`}>{item.message}</span>)}
        {(validation.errors.length > 3 || validation.warnings.length > 2) && <span>Additional issues are shown in the exported/inspected roster data.</span>}
        {army.generation?.explanation && <span>AI plan: {army.generation.explanation}</span>}
        {army.generation?.scenarioEvaluations?.length ? (
          <span>
            AI candidates: {army.generation.scenarioEvaluations
              .map(evaluation => `${evaluation.strategy} ${evaluation.score}`)
              .join(' · ')}
          </span>
        ) : null}
      </div>

      <div className="army-builder-columns">
        <section className="army-builder-library">
          <div className="army-builder-section-title">Available units</div>
          <label className="army-builder-field">
            Faction
            <select value={selectedFaction?.id ?? 'custom'} onChange={event => changeFaction(event.target.value)}>
              {BUILDER_FACTIONS.map(faction => <option key={faction.id} value={faction.id}>{faction.name}</option>)}
            </select>
          </label>
          {(!selectedFaction || selectedFaction.id === 'custom') && (
            <label className="army-builder-field">
              Roster faction name
              <input
                value={army.faction}
                onChange={event => updateArmy({ ...army, faction: event.target.value || 'Custom' })}
                placeholder="e.g. Space Marines"
              />
            </label>
          )}
          {selectedFaction ? (
            <div className="army-builder-hint">{selectedFaction.availability}</div>
          ) : (
            <div className="army-builder-hint">This faction has no built-in unit source yet. Import a roster to use it here.</div>
          )}
          <input
            className="army-builder-search"
            aria-label="Search available units"
            value={unitSearch}
            onChange={event => setUnitSearch(event.target.value)}
            placeholder="Search units or keywords"
          />
          <div className="army-builder-library-count">{visibleLibrary.length} available unit{visibleLibrary.length === 1 ? '' : 's'}</div>
          {visibleLibrary.map(unit => (
            <button key={displayUnitId(unit)} type="button" className="army-builder-library-item" onClick={() => addUnit(unit)}>
              <span>{unit.name}</span>
              <small>{unit.factionKeywords.join(', ') || 'Unit'} · Add</small>
            </button>
          ))}
          {visibleLibrary.length === 0 && (
            <div className="army-builder-empty-library">No units match this faction and search.</div>
          )}
        </section>

        <section className="army-builder-current">
          <div className="army-builder-section-title">Current army</div>
          <div className="army-builder-meta">
            <input aria-label="Army name" value={army.name} onChange={event => updateArmy({ ...army, name: event.target.value })} />
            <span className="army-builder-point-total">Army total: {pointSummary}</span>
            <span>{army.units.length} unit{army.units.length === 1 ? '' : 's'} · {army.units.reduce((total, unit) => total + unit.baseModelCount, 0)} models</span>
          </div>
          <div className="army-builder-settings">
            <div className="army-builder-settings-stack">
              <div className="army-builder-field army-builder-army-size-field">
                <span>Army size</span>
                <div className="army-builder-selection-options" role="radiogroup" aria-label="Army size">
                  {battleSizeOptions.map(size => (
                    <label key={size.id} className="army-builder-selection-option">
                      <input
                        type="radio"
                        name="army-size"
                        value={size.id}
                        checked={army.battleSizeId === size.id}
                        onChange={() => updateArmy({ ...army, battleSizeId: size.id })}
                      />
                      <span>{size.label}{size.maximumPoints === undefined ? '' : ` (${size.maximumPoints} pts)`}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="army-builder-field army-builder-force-disposition-field">
                <span>Force disposition</span>
                <div className="army-builder-selection-options" role="radiogroup" aria-label="Force disposition">
                  {forceDispositionOptions.length ? forceDispositionOptions.map(disposition => (
                    <label key={disposition.id} className="army-builder-selection-option">
                      <input
                        type="radio"
                        name="force-disposition"
                        value={disposition.id}
                        checked={army.forceDisposition === disposition.id}
                        onChange={() => updateArmy({ ...army, forceDisposition: disposition.id })}
                      />
                      <span>{disposition.name}</span>
                    </label>
                  )) : (
                    <small className="army-builder-setting-description">
                      {selectedDetachmentIds.length ? 'No force dispositions are defined for the selected detachment.' : 'Select a detachment first.'}
                    </small>
                  )}
                </div>
              </div>
            </div>
            <div className="army-builder-field army-builder-detachments-field">
              <span>Detachments</span>
              {detachmentOptions.length ? (
                <div className="army-builder-selection-options" role="group" aria-label="Detachments">
                  {detachmentOptions.map(option => (
                    <label key={option.id} className="army-builder-selection-option">
                      <input
                        type="checkbox"
                        checked={selectedDetachmentIds.includes(option.id)}
                        onChange={event => toggleDetachment(option.id, event.target.checked)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <small className="army-builder-setting-description">No detachments available</small>
              )}
            </div>
          </div>
          <ArmyPanel
            side={0}
            army={army}
            battleState={null}
            color={BUILDER_COLOR[0]}
            strategy={BUILDER_STRATEGY}
            showDeploymentControls
            unitPoints={(unit, index) => unitPointCost(unit, index, army)}
            enhancementOptionsForUnit={unit => {
              const catalog = catalogForFaction(normalizeFaction(army.faction));
              return catalog?.enhancementsForUnit({
                factionId: normalizeFaction(army.faction),
                detachmentIds: selectedDetachmentIds,
              }, unit) ?? [];
            }}
            enhancementMaximumSelectionsForId={enhancementId => {
              const catalog = catalogForFaction(normalizeFaction(army.faction));
              return catalog?.rule(enhancementId)?.maximumSelections;
            }}
            onImport={updateArmy}
            onChange={updateArmy}
            onExport={exportArmy}
            onStrategyChange={() => undefined}
            onInspectProfile={(_builderSide, unitIndex) => setSelectedUnitId(displayUnitId(army.units[unitIndex]))}
          />
        </section>

        <section className="army-builder-stats army-builder-stats-panel">
          <DetachmentSummaryPanel faction={army.faction} selectedIds={selectedDetachmentIds} options={detachmentOptions} />
          <div className="army-builder-unit-stats">
            <UnitStatsPanel
              inspected={selectedUnit ? {
                kind: 'profile',
                side: 0,
                armyName: army.name,
                color: BUILDER_COLOR[0],
                unit: selectedUnit,
              } : null}
              enhancementOptions={selectedEnhancementOptions}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
