import React from 'react';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitDeploymentMode, type UnitProfile } from '@warhammer-simulator/core/types/army';
import { DEPLOYMENT_STRATEGIES, type DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { canDeployOutsideDeploymentZone, isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { uiTokens } from '../theme/uiTokens';
import { ModelWeaponLoadoutEditor } from './ArmyModelWeaponLoadoutEditor';
import { UnitList } from './ArmyUnitList';
import { StaticUnitList } from './ArmyStaticUnitList';
import { PlayDeploymentList } from './ArmyDeploymentList';
import {
  attachmentGroupIds,
  attachmentGroupModelCount,
  buildLeaderManifest,
  buildTransportManifest,
  defaultWeaponLoadout,
  deploymentLabel,
  deploymentMode,
  findTransportUnit,
  generateRosterId,
  isLeaderUnit,
  isTransportUnit,
  modelWeaponCopyCount,
  modelWeaponLoadout,
  normalizeArmyForEditing,
  parseCountToken,
  resizeModelWeaponLoadouts,
  splitPlanForUnit,
  unitKey,
  updateModelWeaponLoadout,
  weaponCountForLoadouts,
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
  playDeployment?: boolean;
  selectedPlayUnitIndex?: number | null;
  selectedPlayModelUnitId?: string | null;
  selectedInspectedUnitId?: string | null;
  selectedInspectedProfileIndex?: number | null;
  onImport: (army: ImportedArmy) => void;
  onChange: (army: ImportedArmy) => void;
  onSaveLocal: () => void;
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

  React.useEffect(() => {
    if (!army) return;
    const normalizedArmy = normalizeArmyForEditing(army);
    if (JSON.stringify(normalizedArmy) !== JSON.stringify(army)) onChange(normalizedArmy);
  }, [army, onChange]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        if (isImportedArmy(json)) {
          onImport(applyBaseSizesToArmy(normalizeArmyForEditing(json)));
          return;
        }
        import('@warhammer-simulator/core/parsers/battlescribe').then(({ parseBattleScribeJSON }) => {
          try {
            onImport(normalizeArmyForEditing(parseBattleScribeJSON(json)));
          } catch (err) {
            alert(`Parse error: ${(err as Error).message}`);
          }
        });
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
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

  const units = battleState ? battleState.units.filter(u => u.side === side && !u.inStrategicReserves) : null;
  const reserveUnits = battleState ? battleState.units.filter(u => u.side === side && !u.destroyed && u.inStrategicReserves) : [];
  const battlefieldUnits = army?.units.filter(unit => deploymentMode(unit) === UNIT_DEPLOYMENT_MODE.Battlefield).length ?? 0;
  const stagedUnits = army ? army.units.length - battlefieldUnits : 0;

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
      </div>

      {!playDeployment && (
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
            Import JSON
            <input type="file" accept=".json" onChange={handleFile} style={{ display: 'none' }} />
          </label>
          {army && !battleState && (
            <>
              <button type="button" onClick={onSaveLocal} style={miniButtonStyle(color)}>Save</button>
              <button type="button" onClick={onExport} style={miniButtonStyle(color)}>Export</button>
            </>
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
