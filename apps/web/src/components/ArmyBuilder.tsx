import { useMemo, useRef, useState } from 'react';
import type { ImportedArmy, UnitProfile } from '@warhammer-simulator/core/types/army';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { validateImportedArmy } from '@warhammer-simulator/core/engine/armyValidation';
import { generateAiArmy, selectAiArmyForScenario } from '@warhammer-simulator/core/engine/armyGeneration';
import type { AiArmyScenario, AiArmyStrategy, AiMissionFocus } from '@warhammer-simulator/core/engine/armyGeneration';
import type { DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import { parseBattleScribeJSON } from '@warhammer-simulator/core/parsers/battlescribe';
import { ArmyPanel } from './ArmyPanel';
import { uiTokens } from '../theme/uiTokens';

type Props = {
  armies: [ImportedArmy, ImportedArmy];
  sampleArmies: ImportedArmy[];
  savedSlot: 0 | 1;
  onSavedSlotChange: (slot: 0 | 1) => void;
  onChange: (side: 0 | 1, army: ImportedArmy) => void;
  onSave: (side: 0 | 1) => void | Promise<void>;
  onLoad: (side: 0 | 1) => void | Promise<void>;
  storageStatus?: string;
};

const BUILDER_COLOR: [string, string] = ['#4af26a', '#f24a4a'];
const BUILDER_STRATEGY: DeploymentStrategy = 'balanced';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function blankArmy(): ImportedArmy {
  return { name: 'New Army', faction: 'Custom', units: [] };
}

function displayUnitId(unit: UnitProfile): string {
  return `${unitRosterId(unit)}:${unit.name}`;
}

function uniqueLibraryUnits(armies: ImportedArmy[]): UnitProfile[] {
  const seen = new Set<string>();
  const units: UnitProfile[] = [];
  for (const army of armies) {
    for (const unit of army.units) {
      const key = displayUnitId(unit);
      if (seen.has(key)) continue;
      seen.add(key);
      units.push(unit);
    }
  }
  return units;
}

export function ArmyBuilder({ armies, sampleArmies, savedSlot, onSavedSlotChange, onChange, onSave, onLoad, storageStatus }: Props) {
  const [side, setSide] = useState<0 | 1>(0);
  const [aiContext, setAiContext] = useState<'strategy' | AiMissionFocus>('strategy');
  const [aiStrategy, setAiStrategy] = useState<AiArmyStrategy>('balanced');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const addedUnitSequence = useRef(0);
  const army = armies[side];
  const library = useMemo(() => uniqueLibraryUnits([...sampleArmies, army]), [army, sampleArmies]);
  const validation = useMemo(() => validateImportedArmy(army), [army]);
  const selectedUnit = army.units.find(unit => displayUnitId(unit) === selectedUnitId) ?? army.units[0] ?? null;

  function updateArmy(nextArmy: ImportedArmy) {
    onChange(side, nextArmy);
  }

  function addUnit(source: UnitProfile) {
    const copy = clone(source);
    addedUnitSequence.current += 1;
    copy.rosterId = `${unitRosterId(source)}-builder-${addedUnitSequence.current}`;
    copy.deployment = undefined;
    copy.leaderAttachment = undefined;
    updateArmy(applyBaseSizesToArmy({ ...army, units: [...army.units, copy] }));
    setSelectedUnitId(displayUnitId(copy));
  }

  function handleImport(file: File) {
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const value: unknown = JSON.parse(String(event.target?.result ?? ''));
        const imported = isImportedArmy(value) ? value : parseBattleScribeJSON(value);
        updateArmy(applyBaseSizesToArmy(imported));
        setSelectedUnitId(null);
      } catch (error) {
        window.alert(`Army import failed: ${error instanceof Error ? error.message : 'invalid JSON'}`);
      }
    };
    reader.readAsText(file);
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

  function generateArmy() {
    const result = aiContext === 'strategy'
      ? generateAiArmy(army, { strategy: aiStrategy })
      : selectAiArmyForScenario(army, {
        id: `builder-${aiContext}`,
        focus: aiContext,
        opponent: armies[side === 0 ? 1 : 0],
      } satisfies AiArmyScenario);
    updateArmy(result.army);
    setSelectedUnitId(null);
  }

  return (
    <div className="army-builder">
      <div className="army-builder-toolbar">
        <strong>Army Builder</strong>
        <label>
          Army slot
          <select value={side} onChange={event => setSide(Number(event.target.value) as 0 | 1)}>
            <option value={0}>Army 1</option>
            <option value={1}>Army 2</option>
          </select>
        </label>
        <label>
          Saved army
          <select value={savedSlot} onChange={event => onSavedSlotChange(Number(event.target.value) as 0 | 1)}>
            <option value={0}>Slot 1</option>
            <option value={1}>Slot 2</option>
          </select>
        </label>
        <button type="button" onClick={() => { updateArmy(blankArmy()); setSelectedUnitId(null); }}>New</button>
        <label>
          AI context
          <select value={aiContext} onChange={event => setAiContext(event.target.value as 'strategy' | AiMissionFocus)}>
            <option value="strategy">Plan: use selected strategy</option>
            <option value="objectives">Scenario: hold objectives</option>
            <option value="attrition">Scenario: attrition</option>
            <option value="balanced">Scenario: balanced mission</option>
          </select>
        </label>
        {aiContext === 'strategy' && <label>
          AI plan
          <select value={aiStrategy} onChange={event => setAiStrategy(event.target.value as AiArmyStrategy)}>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
            <option value="objective">Objective</option>
          </select>
        </label>}
        <button type="button" onClick={generateArmy} disabled={army.units.length === 0}>Generate AI</button>
        <button type="button" onClick={() => onSave(side)}>Save</button>
        <button type="button" onClick={() => onLoad(side)}>Load</button>
        <label className="army-builder-file-button">
          Import JSON
          <input type="file" accept=".json" onChange={event => {
            const file = event.target.files?.[0];
            if (file) handleImport(file);
            event.target.value = '';
          }} />
        </label>
        <button type="button" onClick={exportArmy}>Export JSON</button>
        {storageStatus && <span className="army-builder-storage-status">{storageStatus}</span>}
      </div>

      <div className={`army-builder-validation ${validation.valid ? 'is-valid' : 'has-errors'}`}>
        <strong>{validation.valid ? 'Roster structure valid' : `${validation.errors.length} roster issue${validation.errors.length === 1 ? '' : 's'}`}</strong>
        {validation.errors.slice(0, 3).map(item => <span key={`${item.code}:${item.unitIndex ?? 'army'}`}>{item.message}</span>)}
        {validation.warnings.slice(0, 2).map(item => <span key={`${item.code}:${item.unitIndex ?? 'army'}`}>{item.message}</span>)}
        {(validation.errors.length > 3 || validation.warnings.length > 2) && <span>Additional issues are shown in the exported/inspected roster data.</span>}
        {army.generation?.explanation && <span>AI plan: {army.generation.explanation}</span>}
      </div>

      <div className="army-builder-columns">
        <section className="army-builder-library">
          <div className="army-builder-section-title">Available units</div>
          <div className="army-builder-hint">Sample and imported units are available to add.</div>
          {library.map(unit => (
            <button key={displayUnitId(unit)} type="button" className="army-builder-library-item" onClick={() => addUnit(unit)}>
              <span>{unit.name}</span>
              <small>{unit.factionKeywords.join(', ') || 'Unit'} · Add</small>
            </button>
          ))}
        </section>

        <section className="army-builder-current">
          <div className="army-builder-section-title">Current army</div>
          <div className="army-builder-meta">
            <input aria-label="Army name" value={army.name} onChange={event => updateArmy({ ...army, name: event.target.value })} />
            <input aria-label="Army faction" value={army.faction} onChange={event => updateArmy({ ...army, faction: event.target.value })} />
          </div>
          <ArmyPanel
            side={side}
            army={army}
            battleState={null}
            color={BUILDER_COLOR[side]}
            strategy={BUILDER_STRATEGY}
            onImport={updateArmy}
            onChange={updateArmy}
            onSaveLocal={() => onSave(side)}
            onExport={exportArmy}
            onStrategyChange={() => undefined}
            onInspectProfile={(_builderSide, unitIndex) => setSelectedUnitId(displayUnitId(army.units[unitIndex]))}
          />
        </section>

        <section className="army-builder-stats">
          <div className="army-builder-section-title">Selected unit</div>
          {selectedUnit ? (
            <>
              <h2>{selectedUnit.name}</h2>
              <div className="army-builder-stat-grid">
                <span>Move</span><strong>{selectedUnit.move}&quot;</strong>
                <span>Toughness</span><strong>{selectedUnit.toughness}</strong>
                <span>Save</span><strong>{selectedUnit.save}+</strong>
                <span>Wounds</span><strong>{selectedUnit.wounds}</strong>
                <span>OC</span><strong>{selectedUnit.oc}</strong>
                <span>Models</span><strong>{selectedUnit.baseModelCount}</strong>
              </div>
              <h3>Keywords</h3>
              <p>{[...selectedUnit.keywords, ...selectedUnit.factionKeywords].join(', ') || 'None listed'}</p>
              <h3>Weapons</h3>
              <p>{selectedUnit.weapons.map(weapon => weapon.name).join(', ') || 'None listed'}</p>
            </>
          ) : (
            <p style={{ color: uiTokens.color.text.muted }}>Add or select a unit to inspect its profile.</p>
          )}
        </section>
      </div>
    </div>
  );
}
