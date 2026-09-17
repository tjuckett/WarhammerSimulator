import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArmyCatalog, ArmyCatalogBattleSize, ImportedArmy, UnitProfile } from '@warhammer-simulator/core/types/army';
import type { RuleDefinition, UnitPointsEntry } from '@warhammer-simulator/core/types/catalog';
import type { SavedArmyRecord } from '../army/armyRepository';
import { STANDARD_BATTLE_SIZES } from '@warhammer-simulator/core/data/armySizes';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { validateImportedArmy } from '@warhammer-simulator/core/engine/armyValidation';
import { loadNecronCatalog, loadOrkCatalog } from '@warhammer-simulator/core/engine/catalog';
import type { DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
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
const CATALOGS_BY_FACTION = {
  orks: loadOrkCatalog(),
  necrons: loadNecronCatalog(),
};

const BUILDER_FACTIONS = [
  { id: 'orks', name: 'Orks', availability: '11th-edition catalog units and the current sample roster' },
  { id: 'necrons', name: 'Necrons', availability: '11th-edition catalog units and the current sample roster' },
  { id: 'custom', name: 'Custom', availability: 'Imported units only' },
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function blankArmy(): ImportedArmy {
  return { name: 'New Army', faction: 'Custom', units: [] };
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
};

function detachmentRuleForId(id: string, catalog: ReturnType<typeof loadOrkCatalog>): RuleDefinition | undefined {
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
      options.push({ id, label: detachmentLabel(rule), description: rule.description });
    }
  }

  const currentId = army.detachmentId;
  const importedName = army.sourceMetadata?.detachmentName?.trim();
  if (currentId && !options.some(option => option.id === currentId)) {
    options.push({ id: currentId, label: importedName || currentId });
  } else if (importedName && !options.some(option =>
    option.label.trim().toLowerCase() === importedName.toLowerCase(),
  )) {
    options.push({
      id: currentId || `imported-detachment-${importedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: importedName,
    });
  }

  return options.sort((left, right) => left.label.localeCompare(right.label));
}

function battleSizeOptionsFor(army: ImportedArmy): ArmyCatalogBattleSize[] {
  const options = STANDARD_BATTLE_SIZES.map(size => ({ ...size }));
  for (const importedSize of army.catalog?.battleSizes ?? []) {
    const matchingIndex = options.findIndex(size =>
      size.id === importedSize.id
      || (size.maximumPoints !== undefined && size.maximumPoints === importedSize.maximumPoints),
    );
    if (matchingIndex >= 0) options[matchingIndex] = { ...importedSize };
    else options.push({ ...importedSize });
  }
  if (army.battleSizeId && !options.some(size => size.id === army.battleSizeId)) {
    options.push({ id: army.battleSizeId, label: army.battleSizeId });
  }
  return options;
}

function catalogWithStandardBattleSizes(army: ImportedArmy): ArmyCatalog | undefined {
  if (!army.catalog) return undefined;
  return { ...army.catalog, battleSizes: battleSizeOptionsFor(army) };
}

function hydrateCatalogWargear(army: ImportedArmy, catalogUnits: UnitProfile[]): ImportedArmy {
  if (!catalogUnits.length) return army;
  const catalogByName = new Map(catalogUnits.map(unit => [normalizedUnitName(unit), unit]));
  let changed = false;
  const factionId = normalizeFaction(army.faction);
  const units = army.units.map(unit => {
    if (!unitBelongsToFaction(unit, factionId)) return unit;
    const catalogUnit = catalogByName.get(normalizedUnitName(unit));
    if (!catalogUnit) return unit;
    if (!catalogUnit?.wargearChoices?.length && !unit.wargearChoices?.length) return unit;
    const catalogChoicesById = new Map((catalogUnit.wargearChoices ?? []).map(choice => [choice.id, choice]));
    const wargearChoices = unit.wargearChoices?.length
      ? unit.wargearChoices.map(choice => {
        const catalogChoice = catalogChoicesById.get(choice.id);
        return choice.description || !catalogChoice?.description
          ? choice
          : { ...choice, description: catalogChoice.description };
      })
      : clone(catalogUnit.wargearChoices);
    const choiceWeaponNames = wargearChoices.flatMap(choice => choice.weaponNames ?? []);
    const needsCanonicalWeaponData = !unit.wargearChoices?.length
      || choiceWeaponNames.some(name => !unit.weapons.some(weapon =>
        weapon.name.trim().toLowerCase() === name.trim().toLowerCase(),
      ));
    const hydratedUnit = { ...unit, wargearChoices };
    const selectedWargear = unit.selectedWargear === undefined
      ? maximizeFreeScalableUnitUpgrades(hydratedUnit)
      : unit.selectedWargear;
    const choicesChanged = !unit.wargearChoices?.length
      || wargearChoices.some((choice, index) => choice !== unit.wargearChoices?.[index]);
    if (!choicesChanged && !needsCanonicalWeaponData && unit.modelCountRange && selectedWargear === unit.selectedWargear) return unit;
    changed = true;
    return {
      ...unit,
      modelCountRange: unit.modelCountRange ?? catalogUnit.modelCountRange,
      wargearChoices,
      ...(selectedWargear === undefined ? {} : { selectedWargear }),
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
  return changed ? { ...army, units } : army;
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
  return entry?.points;
}

export function ArmyBuilder({ army, sampleArmies, savedArmies, onChange, onSave, onLoad, onDelete, storageStatus }: Props) {
  const [savedArmyId, setSavedArmyId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [unitSearch, setUnitSearch] = useState('');
  const addedUnitSequence = useRef(0);
  const catalogUnits = useMemo(() => catalogUnitsForFaction(army.faction), [army.faction]);
  const hydratedArmy = useMemo(() => hydrateCatalogWargear(army, catalogUnits), [army, catalogUnits]);
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
  const detachmentOptions = useMemo(() => detachmentOptionsFor(army), [army]);
  const selectedDetachmentId = army.detachmentId
    ?? detachmentOptions.find(option => option.label.toLowerCase() === army.sourceMetadata?.detachmentName?.trim().toLowerCase())?.id
    ?? '';
  const selectedUnit = army.units.find(unit => displayUnitId(unit) === selectedUnitId) ?? army.units[0] ?? null;
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
      ...(normalizeFaction(nextFaction) === normalizeFaction(army.faction) ? {} : { detachmentId: undefined }),
    });
    setUnitSearch('');
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
            <label className="army-builder-field">
              Army size
              <select
                aria-label="Army size"
                value={army.battleSizeId ?? ''}
                onChange={event => updateArmy({ ...army, battleSizeId: event.target.value || undefined })}
              >
                <option value="">Choose army size</option>
                {battleSizeOptions.map(size => (
                  <option key={size.id} value={size.id}>
                    {size.label}{size.maximumPoints === undefined ? '' : ` (${size.maximumPoints} pts)`}
                  </option>
                ))}
              </select>
            </label>
            <label className="army-builder-field">
              Detachment
              <select
                aria-label="Detachment"
                value={selectedDetachmentId}
                onChange={event => updateArmy({ ...army, detachmentId: event.target.value || undefined })}
                disabled={detachmentOptions.length === 0}
              >
                <option value="">{detachmentOptions.length ? 'Choose detachment' : 'No detachments available'}</option>
                {detachmentOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              {detachmentOptions.find(option => option.id === selectedDetachmentId)?.description && (
                <small className="army-builder-setting-description">
                  {detachmentOptions.find(option => option.id === selectedDetachmentId)?.description}
                </small>
              )}
            </label>
          </div>
          <ArmyPanel
            side={0}
            army={army}
            battleState={null}
            color={BUILDER_COLOR[0]}
            strategy={BUILDER_STRATEGY}
            showDeploymentControls={false}
            unitPoints={(unit, index) => unitPointCost(unit, index, army)}
            onImport={updateArmy}
            onChange={updateArmy}
            onExport={exportArmy}
            onStrategyChange={() => undefined}
            onInspectProfile={(_builderSide, unitIndex) => setSelectedUnitId(displayUnitId(army.units[unitIndex]))}
          />
        </section>

        <section className="army-builder-stats army-builder-stats-panel">
          <UnitStatsPanel
            inspected={selectedUnit ? {
              kind: 'profile',
              side: 0,
              armyName: army.name,
              color: BUILDER_COLOR[0],
              unit: selectedUnit,
            } : null}
          />
        </section>
      </div>
    </div>
  );
}
