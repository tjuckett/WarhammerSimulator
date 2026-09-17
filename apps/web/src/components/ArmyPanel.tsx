import React from 'react';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitDeploymentMode, type UnitProfile } from '@warhammer-simulator/core/types/army';
import { DEPLOYMENT_STRATEGIES, type DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { canDeployOutsideDeploymentZone, isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { parseListhammerMarkdown } from '@warhammer-simulator/core/parsers/listhammer';
import type { SavedArmyRecord } from '../army/armyRepository';
import { uiTokens } from '../theme/uiTokens';
import { UnitList } from './ArmyUnitList';
import { StaticUnitList } from './ArmyStaticUnitList';
import { PlayDeploymentList } from './ArmyDeploymentList';
import {
  attachmentGroupIds,
  attachmentGroupModelCount,
  buildLeaderManifest,
  buildTransportManifest,
  deploymentLabel,
  deploymentMode,
  findTransportUnit,
  generateRosterId,
  isLeaderUnit,
  isTransportUnit,
  normalizeArmyForEditing,
  parseCountToken,
  splitPlanForUnit,
  unitKey,
  type LeaderManifestEntry,
  type TransportManifestEntry,
  type UnitSplitPlan,
} from './armyPanelHelpers';

interface Props {
  side: 0 | 1;
  army: ImportedArmy | null;
  battleState: BattleState | null;
  color: string;
  strategy: DeploymentStrategy;
  showDeploymentControls?: boolean;
  unitPoints?: (unit: UnitProfile, unitIndex: number) => number | undefined;
  savedArmies?: SavedArmyRecord[];
  onLoadSavedArmy?: (id: string) => void | Promise<void>;
  playDeployment?: boolean;
  selectedPlayUnitIndex?: number | null;
  selectedPlayModelUnitId?: string | null;
  selectedInspectedUnitId?: string | null;
  selectedInspectedProfileIndex?: number | null;
  onImport: (army: ImportedArmy) => void;
  onChange: (army: ImportedArmy) => void;
  onSaveLocal?: () => void | Promise<void>;
  onExport: () => void;
  onStrategyChange: (s: DeploymentStrategy) => void;
  onSelectPlayUnit?: (side: 0 | 1, unitIndex: number) => void;
  onSelectStagedUnit?: (side: 0 | 1, unitIndex: number) => void;
  onSelectReserveUnit?: (side: 0 | 1, unitId: string) => void;
  onSelectPlacedUnit?: (unitId: string, side: 0 | 1) => void;
  onInspectUnit?: (unitId: string, side: 0 | 1) => void;
  onInspectProfile?: (side: 0 | 1, unitIndex: number) => void;
  onUndeployPlacedUnit?: (unitId: string, side: 0 | 1) => void;
}

export function ArmyPanel({
  side,
  army,
  battleState,
  color,
  strategy,
  showDeploymentControls = true,
  unitPoints,
  savedArmies = [],
  onLoadSavedArmy,
  playDeployment = false,
  selectedPlayUnitIndex = null,
  selectedPlayModelUnitId = null,
  selectedInspectedUnitId = null,
  selectedInspectedProfileIndex = null,
  onImport,
  onChange,
  onSaveLocal,
  onExport,
  onStrategyChange,
  onSelectPlayUnit,
  onSelectStagedUnit,
  onSelectReserveUnit,
  onSelectPlacedUnit,
  onInspectUnit,
  onInspectProfile,
  onUndeployPlacedUnit,
}: Props) {
  const label = side === 0 ? 'Army 1' : 'Army 2';
  const normalizedArmyRef = React.useRef<ImportedArmy | null>(null);

  React.useEffect(() => {
    // This normalizes an editable roster.  Once play is active, `onChange`
    // intentionally resets the configured battle; treating a just-loaded
    // roster as an edit would therefore discard its restored checkpoint.
    if (battleState) return;
    if (!army) {
      normalizedArmyRef.current = null;
      return;
    }
    // App renders can be triggered by battlefield selection/state changes while
    // the army object itself is unchanged. Avoid normalizing and serializing
    // the complete roster on those renders.
    if (normalizedArmyRef.current === army) return;
    normalizedArmyRef.current = army;
    const normalizedArmy = applyBaseSizesToArmy(normalizeArmyForEditing(army));
    if (JSON.stringify(normalizedArmy) !== JSON.stringify(army)) onChange(normalizedArmy);
  }, [army, battleState, onChange]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then(async raw => {
      try {
        if (/\.(?:md|markdown|txt)$/i.test(file.name)) {
          onImport(normalizeArmyForEditing(parseListhammerMarkdown(raw)));
          return;
        }
        const json: unknown = JSON.parse(raw);
        if (isImportedArmy(json)) {
          onImport(applyBaseSizesToArmy(normalizeArmyForEditing(json)));
          return;
        }
        const { parseBattleScribeJSON } = await import('@warhammer-simulator/core/parsers/battlescribe');
        onImport(normalizeArmyForEditing(parseBattleScribeJSON(json)));
      } catch (error) {
        alert(`Army import failed: ${error instanceof Error ? error.message : 'invalid roster file'}`);
      }
    }).catch(error => {
      alert(`Army import failed: ${error instanceof Error ? error.message : 'could not read the file'}`);
    });
    e.target.value = '';
  }

  function changeUnit(unitIndex: number, nextUnit: UnitProfile) {
    if (!army) return;
    const previousUnit = army.units[unitIndex];
    const normalizedUnit = previousUnit?.baseModelCount !== nextUnit.baseModelCount
      ? { ...nextUnit, modelBases: undefined }
      : nextUnit;
    const previousDeployment = previousUnit?.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport ? previousUnit.deployment : undefined;
    const nextDeployment = normalizedUnit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport ? normalizedUnit.deployment : undefined;
    const transportChanged = previousDeployment?.transportUnitId !== nextDeployment?.transportUnitId
      || previousDeployment?.transportName !== nextDeployment?.transportName
      || previousUnit?.deployment?.mode !== normalizedUnit.deployment?.mode;
    const groupIds = transportChanged ? new Set(attachmentGroupIds(army, unitIndex)) : null;
    onChange(applyBaseSizesToArmy({
      ...army,
      units: army.units.map((unit, index) => {
        const unitToApply = index === unitIndex ? normalizedUnit : unit;
        if (!groupIds?.has(unitKey(unitToApply, index)) || isTransportUnit(unitToApply)) return unitToApply;
        if (nextDeployment) return { ...unitToApply, deployment: nextDeployment };
        if (previousDeployment) return { ...unitToApply, deployment: undefined };
        return unitToApply;
      }),
    }));
  }

  function deleteUnit(unitIndex: number) {
    if (!army) return;
    const removedId = unitKey(army.units[unitIndex], unitIndex);
    onChange({
      ...army,
      units: army.units
        .filter((_, index) => index !== unitIndex)
        .map(unit => {
          const nextUnit = unit.deployment?.transportUnitId === removedId
            ? { ...unit, deployment: { mode: UNIT_DEPLOYMENT_MODE.Transport } }
            : unit;
          return nextUnit.leaderAttachment?.attachedToUnitId === removedId
            ? { ...nextUnit, leaderAttachment: undefined }
            : nextUnit;
        }),
    });
  }

  function splitUnit(unitIndex: number, plan: UnitSplitPlan) {
    if (!army) return;
    const source = army.units[unitIndex];
    if (!source || source.baseModelCount !== plan.totalModels) return;

    let modelOffset = 0;
    const splitUnits = plan.modelCounts.map((modelCount, splitIndex): UnitProfile => {
      const nextUnit = JSON.parse(JSON.stringify(source)) as UnitProfile;
      nextUnit.name = `${source.name} ${splitIndex + 1}`;
      nextUnit.rosterId = splitIndex === 0 ? source.rosterId ?? generateRosterId() : generateRosterId();
      nextUnit.baseModelCount = modelCount;
      if (source.modelBases?.length) {
        nextUnit.modelBases = source.modelBases.slice(modelOffset, modelOffset + modelCount);
      }
      modelOffset += modelCount;
      return nextUnit;
    });

    onChange(applyBaseSizesToArmy({
      ...army,
      units: [
        ...army.units.slice(0, unitIndex),
        ...splitUnits,
        ...army.units.slice(unitIndex + 1),
      ],
    }));
  }

  const units = React.useMemo(
    () => battleState ? battleState.units.filter(u => u.side === side && !u.inStrategicReserves) : null,
    [battleState, side],
  );
  const reserveUnits = React.useMemo(
    () => battleState ? battleState.units.filter(u => u.side === side && !u.destroyed && u.inStrategicReserves) : [],
    [battleState, side],
  );
  const battlefieldUnits = army?.units.filter(unit => deploymentMode(unit) === UNIT_DEPLOYMENT_MODE.Battlefield).length ?? 0;
  const stagedUnits = army ? army.units.length - battlefieldUnits : 0;
  const pointCosts = React.useMemo(
    () => army?.units.map((unit, index) => unitPoints?.(unit, index) ?? catalogPointCost(unit, army)) ?? [],
    [army, unitPoints],
  );
  const knownPointTotal = pointCosts.reduce((total, points) => total + (points ?? 0), 0);
  const unknownPointCount = pointCosts.filter(points => points === undefined).length;
  const pointSummary = pointCosts.some(points => points !== undefined)
    ? unknownPointCount === 0
      ? `${knownPointTotal} pts`
      : `${knownPointTotal} pts + ${unknownPointCount} unknown`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ background: `${color}22`, borderBottom: `2px solid ${color}`, padding: '6px 8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color, fontWeight: 'bold', fontSize: 14 }}>{label}</div>
          {battleState && (
            <div style={{ color, fontWeight: 'bold', fontSize: 14 }}>
              {battleState.scores[side]} VP
            </div>
          )}
        </div>
        <div style={{ color: uiTokens.color.text.secondary, fontSize: 12 }}>
          {army ? `${army.name} (${army.faction})` : 'No army loaded'}
        </div>
        {pointSummary && (
          <div style={{ color: uiTokens.color.text.primary, fontSize: 12, fontWeight: 'bold', marginTop: 2 }}>
            Army total: {pointSummary}
          </div>
        )}
      </div>

      {!playDeployment && showDeploymentControls && (
        <div style={{ padding: '5px 8px', flexShrink: 0, borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: uiTokens.color.text.muted, fontSize: 11, whiteSpace: 'nowrap' }}>Deploy:</span>
          <select
            value={strategy}
            onChange={e => onStrategyChange(e.target.value as DeploymentStrategy)}
            disabled={!!battleState}
            style={{
              flex: 1, background: '#1a1a1a', border: `1px solid ${color}44`,
              color: '#ccc', fontSize: 11, padding: '3px 5px', borderRadius: uiTokens.radius.control, cursor: 'pointer',
            }}
          >
            {DEPLOYMENT_STRATEGIES.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ padding: '6px 8px', flexShrink: 0, borderBottom: '1px solid #2a2a2a' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <label style={{
            display: 'inline-block', padding: '4px 8px', background: '#222', border: `1px solid ${color}55`,
            borderRadius: 4, cursor: 'pointer', color, fontSize: 11,
          }}>
            Import roster
            <input type="file" accept=".json,.md,.markdown,.txt" onChange={handleFile} style={{ display: 'none' }} />
          </label>
          {army && !battleState && onSaveLocal && (
            <button type="button" onClick={onSaveLocal} style={miniButtonStyle(color)}>Save to library</button>
          )}
          {army && !battleState && (
            <button type="button" onClick={onExport} style={miniButtonStyle(color)}>Export</button>
          )}
          {army && !battleState && onLoadSavedArmy && (
            <select
              aria-label={`Load saved army into ${label}`}
              defaultValue=""
              onChange={event => {
                const id = event.target.value;
                if (id) void onLoadSavedArmy(id);
                event.target.value = '';
              }}
              style={{ ...miniButtonStyle(color), maxWidth: 170 }}
              disabled={savedArmies.length === 0}
            >
              <option value="">Load from library</option>
              {savedArmies.map(record => (
                <option key={record.id} value={record.id}>{record.army.name}</option>
              ))}
            </select>
          )}
        </div>
        {army && !battleState && (
          <div style={{ marginTop: 4, color: uiTokens.color.text.faint, fontSize: 11 }}>
            {army.units.length} units loaded, {battlefieldUnits} deploying{stagedUnits ? `, ${stagedUnits} staged` : ''}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {playDeployment && battleState && (battleState.phase === 'deployment' || battleState.phase === 'movement') ? (
          <PlayDeploymentList
            side={side}
            army={army!}
            placedUnits={units ?? []}
            reserveUnits={reserveUnits}
            unplacedUnits={battleState.unplacedUnits[side]}
            color={color}
            selectedIndex={selectedPlayUnitIndex}
            selectedPlacedUnitId={selectedPlayModelUnitId ?? selectedInspectedUnitId}
            onSelect={onSelectPlayUnit}
            onSelectPlacedUnit={onSelectPlacedUnit}
            onSelectStagedUnit={onSelectStagedUnit}
            onSelectReserveUnit={onSelectReserveUnit}
            onInspectStagedUnit={onInspectProfile ? unitIndex => onInspectProfile(side, unitIndex) : undefined}
            onUndeployPlacedUnit={battleState.phase === 'deployment' ? onUndeployPlacedUnit : undefined}
          />
        ) : units ? (
          <UnitList units={units} selectedUnitId={selectedInspectedUnitId} onSelectUnit={onInspectUnit} />
        ) : army ? (
          <StaticUnitList
            army={army}
            color={color}
            editable={!battleState}
            showDeploymentControls={showDeploymentControls}
            unitPoints={unitPoints}
            selectedUnitIndex={selectedInspectedProfileIndex}
            onInspectUnit={onInspectProfile ? unitIndex => onInspectProfile(side, unitIndex) : undefined}
            onChangeUnit={changeUnit}
            onDeleteUnit={deleteUnit}
            onSplitUnit={splitUnit}
          />
        ) : (
          <div style={{ color: uiTokens.color.text.subtle, fontSize: 11, padding: '8px', textAlign: 'center' }}>
            Load an army or use the sample armies
          </div>
        )}
      </div>
    </div>
  );
}



function miniButtonStyle(color: string): React.CSSProperties {
  return {
    padding: '4px 8px',
    background: '#181820',
    border: `1px solid ${color}44`,
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 11,
  };
}

function catalogPointCost(unit: UnitProfile, army: ImportedArmy | null): number | undefined {
  if (!army?.catalog) return undefined;
  const rosterId = unitRosterId(unit);
  const entry = army.catalog.units.find(candidate =>
    candidate.id === rosterId
    || candidate.names?.includes(unit.name)
    || candidate.profile?.name === unit.name,
  );
  return entry?.modelCountPoints?.[String(unit.baseModelCount)];
}
