import React from 'react';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitDeploymentMode, type UnitProfile } from '@warhammer-simulator/core/types/army';
import { DEPLOYMENT_STRATEGIES, type DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { canDeployOutsideDeploymentZone, isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { uiTokens } from '../theme/uiTokens';
import { ModelWeaponLoadoutEditor } from './ArmyModelWeaponLoadoutEditor';
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

function PanelSectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '8px 8px 5px',
      color,
      fontSize: 10,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      <span>{label}</span>
      <span style={{
        minWidth: 18,
        padding: '1px 5px',
        borderRadius: 3,
        textAlign: 'center',
        color: '#d5d8ef',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.09)',
      }}>
        {count}
      </span>
    </div>
  );
}

function PlayDeploymentList({
  side,
  army,
  placedUnits,
  reserveUnits,
  unplacedUnits,
  color,
  selectedIndex,
  selectedPlacedUnitId,
  onSelect,
  onSelectPlacedUnit,
  onSelectStagedUnit,
  onSelectReserveUnit,
  onInspectStagedUnit,
  onUndeployPlacedUnit,
}: {
  side: 0 | 1;
  army: ImportedArmy;
  placedUnits: BattleUnit[];
  reserveUnits: BattleUnit[];
  unplacedUnits: ImportedArmy['units'];
  color: string;
  selectedIndex: number | null;
  selectedPlacedUnitId: string | null;
  onSelect?: (side: 0 | 1, unitIndex: number) => void;
  onSelectPlacedUnit?: (unitId: string, side: 0 | 1) => void;
  onSelectStagedUnit?: (side: 0 | 1, unitIndex: number) => void;
  onSelectReserveUnit?: (side: 0 | 1, unitId: string) => void;
  onInspectStagedUnit?: (unitIndex: number) => void;
  onUndeployPlacedUnit?: (unitId: string, side: 0 | 1) => void;
}) {
  const unplacedDisplayItems = groupedPlayDropDisplayItems(army, unplacedUnits);
  const stagedItems = groupedStagedDisplayItems(army, placedUnits, reserveUnits);
  return (
    <>
      <PanelSectionHeader label="To Deploy" count={unplacedDisplayItems.length} color={color} />
      {unplacedDisplayItems.length ? unplacedDisplayItems.map(({ unit: u, deployIndex, indent, groupRole, groupIndex }) => (
        <button
          key={`${unitRosterId(u)}-${deployIndex}-${groupRole}-${groupIndex}`}
          type="button"
          onClick={() => onSelect?.(side, deployIndex)}
          style={{
            display: 'block',
            width: `calc(100% - ${indent ? 34 : 12}px)`,
            margin: `0 6px 5px ${indent ? 28 : 6}px`,
            padding: '7px 8px',
            textAlign: 'left',
            background: selectedIndex === deployIndex ? `${color}24` : groupRole !== 'solo' ? 'rgba(82,118,190,0.12)' : '#15151f',
            border: `1px solid ${selectedIndex === deployIndex ? color : groupRole !== 'solo' ? '#9ab7ff4d' : '#292940'}`,
            borderLeft: groupRole !== 'solo' ? '4px solid #9ab7ff99' : `4px solid ${selectedIndex === deployIndex ? color : '#292940'}`,
            borderRadius: 5,
            color: uiTokens.color.text.primary,
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          {groupRole === 'leader' && groupIndex === 0 && (
            <div style={{ color: uiTokens.color.status.info, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.4 }}>
              Attached group
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
            <span style={{ color: '#8f8fa8', fontSize: 10, whiteSpace: 'nowrap' }}>{u.baseModelCount} models</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {groupRole === 'leader' && <Badge label="Leader" color={uiTokens.color.status.info} />}
            {groupRole === 'bodyguard' && <Badge label="Bodyguard" color={uiTokens.color.status.info} />}
            {canDeployOutsideDeploymentZone(u) && <Badge label="Infiltrators" color="#66d7aa" />}
          </div>
        </button>
      )) : (
        <div style={{ color: '#555', fontSize: 10, padding: '4px 8px 8px' }}>All battlefield units deployed</div>
      )}

      <PanelSectionHeader label="Staged" count={stagedItems.length} color="#8888aa" />
      {stagedItems.length ? stagedItems.map(({ unit: u, index, indent, groupRole, groupIndex, kind, transportEntry, battleUnit }) => (
        <button
          key={`${kind}-${battleUnit?.id ?? unitRosterId(u)}-${index}-${groupRole}-${groupIndex}-staged`}
          type="button"
          onClick={() => kind === 'reserve' && battleUnit
            ? onSelectReserveUnit?.(side, battleUnit.id)
            : onSelectStagedUnit ? onSelectStagedUnit(side, index) : onInspectStagedUnit?.(index)}
          style={{
            display: 'block',
            width: `calc(100% - ${indent ? 34 : 12}px)`,
            margin: `0 6px 5px ${indent ? 28 : 6}px`,
            padding: '7px 8px',
            textAlign: 'left',
            background: kind === 'transport'
              ? 'rgba(255,224,102,0.07)'
              : kind === 'reserve'
                ? 'rgba(102,215,255,0.07)'
              : groupRole !== 'solo' ? 'rgba(80,120,210,0.06)' : '#111118',
            border: `1px solid ${kind === 'transport' ? '#ffe06644' : kind === 'reserve' ? '#66d7ff44' : groupRole !== 'solo' ? '#9ab7ff33' : '#24243a'}`,
            borderLeft: kind === 'transport'
              ? '4px solid #ffe06688'
              : kind === 'reserve'
                ? '4px solid #66d7ff88'
              : groupRole !== 'solo' ? '4px solid #9ab7ff66' : '4px solid #24243a',
            borderRadius: 5,
            color: '#bbb',
            font: 'inherit',
            cursor: onSelectStagedUnit || onSelectReserveUnit || onInspectStagedUnit ? 'pointer' : 'default',
          }}
        >
          {kind === 'reserve' && (
            <div style={{ color: '#66d7ff', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>
              Strategic Reserves
            </div>
          )}
          {kind === 'transport' && (
            <div style={{ color: '#ffe066', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>
              Transport contents
            </div>
          )}
          {groupRole === 'leader' && groupIndex === 0 && (
            <div style={{ color: uiTokens.color.status.info, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>
              Attached group
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
            <span style={{ color: '#777', fontSize: 10, whiteSpace: 'nowrap' }}>
              {kind === 'reserve'
                ? 'Off-board'
                : kind === 'transport' && transportEntry
                ? `${transportEntry.used}/${transportEntry.capacity || '?'} embarked`
                : deploymentLabel(u, army)}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {kind === 'reserve' && <Badge label="Aircraft" color="#66d7ff" />}
            {kind === 'transport' && <Badge label="Transport" color="#ffe066" />}
            {groupRole === 'leader' && <Badge label="Leader" color={uiTokens.color.status.info} />}
            {groupRole === 'bodyguard' && <Badge label="Bodyguard" color={uiTokens.color.status.info} />}
          </div>
        </button>
      )) : (
        <div style={{ color: '#555', fontSize: 10, padding: '4px 8px 8px' }}>No deep strike, reserve, or embarked units</div>
      )}

      <PanelSectionHeader label="On Board" count={placedUnits.length} color="#8888aa" />
      {placedUnits.length ? (
        <UnitList
          units={placedUnits}
          selectedUnitId={selectedPlacedUnitId}
          onSelectUnit={onSelectPlacedUnit}
          onUndeployUnit={onUndeployPlacedUnit}
        />
      ) : (
        <div style={{ color: '#555', fontSize: 10, padding: '4px 8px' }}>No units placed yet</div>
      )}
    </>
  );
}

type PlayDropDisplayItem = {
  unit: UnitProfile;
  deployIndex: number;
  indent: number;
  groupRole: 'solo' | 'leader' | 'bodyguard';
  groupIndex: number;
};

type StagedDisplayItem = {
  kind: 'unit' | 'transport' | 'reserve';
  unit: UnitProfile;
  index: number;
  indent: number;
  groupRole: 'solo' | 'leader' | 'bodyguard';
  groupIndex: number;
  transportEntry?: TransportManifestEntry;
  battleUnit?: BattleUnit;
};

function groupedPlayDropDisplayItems(army: ImportedArmy, unplacedUnits: UnitProfile[]): PlayDropDisplayItem[] {
  const unplacedById = new Map(unplacedUnits.map((unit, index) => [unitRosterId(unit), { unit, index }]));
  return groupedUnitDisplayItems(army).flatMap((item): PlayDropDisplayItem[] => {
    if (item.groupRole === 'leader') {
      const target = army.units.find(unit =>
        item.unit.leaderAttachment?.attachedToUnitId === unitRosterId(unit)
        || (!item.unit.leaderAttachment?.attachedToUnitId && item.unit.leaderAttachment?.attachedToName === unit.name),
      );
      const drop = target ? unplacedById.get(unitRosterId(target)) : undefined;
      return drop ? [{
        unit: item.unit,
        deployIndex: drop.index,
        indent: item.indent,
        groupRole: item.groupRole,
        groupIndex: item.groupIndex,
      }] : [];
    }

    const drop = unplacedById.get(unitRosterId(item.unit));
    return drop ? [{
      unit: drop.unit,
      deployIndex: drop.index,
      indent: item.indent,
      groupRole: item.groupRole,
      groupIndex: item.groupIndex,
    }] : [];
  });
}

function groupedStagedDisplayItems(army: ImportedArmy, placedUnits: BattleUnit[] = [], reserveUnits: BattleUnit[] = []): StagedDisplayItem[] {
  const placedProfileIds = new Set(
    [...placedUnits, ...reserveUnits].filter(unit => !unit.destroyed).map(unit => unitRosterId(unit.profile)),
  );
  const groupedItems = groupedUnitDisplayItems(army);
  const reserveStaged = reserveUnits.map((unit): StagedDisplayItem => ({
    kind: 'reserve',
    unit: unit.profile,
    index: army.units.findIndex(candidate => unitRosterId(candidate) === unitRosterId(unit.profile)),
    indent: 0,
    groupRole: 'solo',
    groupIndex: 0,
    battleUnit: unit,
  }));
  const nonTransportStaged = groupedItems.flatMap((item): StagedDisplayItem[] => {
    if (placedProfileIds.has(unitRosterId(item.unit))) return [];
    if (item.groupRole === 'leader') {
      const target = army.units.find(unit =>
        item.unit.leaderAttachment?.attachedToUnitId === unitRosterId(unit)
        || (!item.unit.leaderAttachment?.attachedToUnitId && item.unit.leaderAttachment?.attachedToName === unit.name),
      );
      if (!target || deploymentMode(target) === UNIT_DEPLOYMENT_MODE.Battlefield || deploymentMode(target) === UNIT_DEPLOYMENT_MODE.Transport) return [];
      return [{
        kind: 'unit',
        unit: item.unit,
        index: item.index,
        indent: item.indent,
        groupRole: item.groupRole,
        groupIndex: item.groupIndex,
      }];
    }

    const mode = deploymentMode(item.unit);
    if (mode === UNIT_DEPLOYMENT_MODE.Battlefield || mode === UNIT_DEPLOYMENT_MODE.Transport) return [];
    return [{
      kind: 'unit',
      unit: item.unit,
      index: item.index,
      indent: item.indent,
      groupRole: item.groupRole,
      groupIndex: item.groupIndex,
    }];
  });

  const transportStaged = buildTransportManifest(army)
    .filter(entry => entry.passengers.length > 0)
    .filter(entry => !placedProfileIds.has(unitRosterId(entry.unit)))
    .flatMap((entry): StagedDisplayItem[] => [
      {
        kind: 'transport',
        unit: entry.unit,
        index: entry.index,
        indent: 0,
        groupRole: 'solo',
        groupIndex: 0,
        transportEntry: entry,
      },
      ...groupedItems
        .filter(item => isEmbarkedInTransport(item.unit, entry))
        .filter(item => !placedProfileIds.has(unitRosterId(item.unit)))
        .map((item): StagedDisplayItem => ({
          kind: 'unit',
          unit: item.unit,
          index: item.index,
          indent: item.indent + 1,
          groupRole: item.groupRole,
          groupIndex: item.groupIndex,
        })),
    ]);

  return [...reserveStaged, ...nonTransportStaged, ...transportStaged];
}

function isEmbarkedInTransport(unit: UnitProfile, transport: TransportManifestEntry): boolean {
  return unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport
    && (
      unit.deployment.transportUnitId === transport.id
      || (!unit.deployment.transportUnitId && unit.deployment.transportName === transport.unit.name)
    );
}

function UnitList({
  units,
  selectedUnitId = null,
  onSelectUnit,
  onUndeployUnit,
}: {
  units: BattleUnit[];
  selectedUnitId?: string | null;
  onSelectUnit?: (unitId: string, side: 0 | 1) => void;
  onUndeployUnit?: (unitId: string, side: 0 | 1) => void;
}) {
  return (
    <>
      {units.map(u => {
        const pct = u.remainingModels / u.profile.baseModelCount;
        const hpColor = pct > 0.6 ? '#44ee44' : pct > 0.3 ? '#ffaa00' : '#ee3333';
        const selected = selectedUnitId === u.id;
        const interactive = !!onSelectUnit && !u.destroyed;
        return (
          <div
            key={u.id}
            onClick={() => interactive && onSelectUnit?.(u.id, u.side)}
            style={{
              padding: '5px 8px 6px',
              borderBottom: '1px solid #1a1a1a',
              borderLeft: selected ? '2px solid #ffe066' : '2px solid transparent',
              background: selected ? 'rgba(255,224,102,0.10)' : 'transparent',
              opacity: u.destroyed ? 0.35 : 1,
              cursor: interactive ? 'pointer' : 'default',
              position: 'relative',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, paddingRight: 44 }}>
              <span style={{ color: u.destroyed ? uiTokens.color.text.dim : uiTokens.color.text.primary, fontSize: 12, fontWeight: 'bold' }}>
                {u.destroyed && 'x '}{u.profile.name}
              </span>
            </div>
            <div style={{ position: 'absolute', top: 5, right: 8, color: '#d7e8ff', fontSize: 11, fontWeight: 800 }}>
              M{u.profile.move}"
            </div>
            <div style={{ color: hpColor, fontSize: 11, marginTop: 2 }}>
              {u.remainingModels}/{u.profile.baseModelCount} models
            </div>
            <div style={{ color: '#666', fontSize: 10, marginTop: 1, paddingRight: 44 }}>
              T{u.profile.toughness} Sv{u.profile.save}+ W{u.profile.wounds}
              {u.profile.invulnSave ? ` /${u.profile.invulnSave}++` : ''}
            </div>
            <div style={{ position: 'absolute', right: 8, bottom: 7, color: '#f0d58a', fontSize: 11, fontWeight: 800 }}>
              OC{u.profile.oc}
            </div>
            {onUndeployUnit && !u.destroyed && (
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  onUndeployUnit(u.id, u.side);
                }}
                title="Remove from board"
                style={{
                  marginTop: 4,
                  borderRadius: 3,
                  border: '1px solid #663333',
                  background: '#231515',
                  color: '#ff8a8a',
                  cursor: 'pointer',
                  fontSize: 10,
                  padding: '2px 6px',
                }}
              >
                Remove from board
              </button>
            )}
            {!u.destroyed && (
              <div style={{ marginTop: 3, height: 3, background: '#222', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${pct * 100}%`, background: hpColor, borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
              {u.inCombat && <Badge label="melee" color="#ff8800" />}
              {u.charged && <Badge label="charged" color="#ffe000" />}
              {u.movementAction === 'remainedStationary' && <Badge label="stationary" color="#b9d7ff" />}
              {u.movementAction === 'advanced' && <Badge label="advanced" color="#7cff9b" />}
              {u.movementComplete && u.movementAction !== 'remainedStationary' && <Badge label="done" color="#c9c4ff" />}
              {typeof u.movementAllowanceRemaining === 'number' && <Badge label={`${u.movementAllowanceRemaining.toFixed(1)}" left`} color="#7cff9b" />}
              {u.fellBack && <Badge label="fell back" color="#66d9ff" />}
              {u.battleshocked && <Badge label="shocked" color="#8888ff" />}
            </div>
          </div>
        );
      })}
    </>
  );
}

function StaticUnitList({
  army,
  color,
  editable,
  selectedUnitIndex = null,
  onInspectUnit,
  onChangeUnit,
  onDeleteUnit,
  onSplitUnit,
}: {
  army: ImportedArmy;
  color: string;
  editable: boolean;
  selectedUnitIndex?: number | null;
  onInspectUnit?: (unitIndex: number) => void;
  onChangeUnit: (unitIndex: number, unit: UnitProfile) => void;
  onDeleteUnit: (unitIndex: number) => void;
  onSplitUnit: (unitIndex: number, plan: UnitSplitPlan) => void;
}) {
  const transportManifest = buildTransportManifest(army);
  const leaderManifest = buildLeaderManifest(army);
  const [expandedUnitId, setExpandedUnitId] = React.useState<string | null>(null);
  const displayUnits = groupedUnitDisplayItems(army);

  return (
    <>
      {displayUnits.map(({ unit: u, index: i, indent, groupRole, groupIndex }) => {
        const id = unitKey(u, i);
        const expanded = expandedUnitId === id || !editable;
        const currentTransportId = u.deployment?.transportUnitId ?? '';
        const currentLeaderTargetId = u.leaderAttachment?.attachedToUnitId ?? '';
        const currentPassengerCount = deploymentMode(u) === UNIT_DEPLOYMENT_MODE.Transport ? attachmentGroupModelCount(army, i) : 0;
        const unitIsTransport = isTransportUnit(u);
        const showTransportCapacity = unitIsTransport || !!u.transportCapacity;
        const unitIsLeader = isLeaderUnit(u);
        const ownTransportEntry = transportManifest.find(entry => entry.id === unitKey(u, i));
        const ownLeaderEntry = leaderManifest.find(entry => entry.id === unitKey(u, i));
        const selectedTransport = transportManifest.find(entry => entry.id === currentTransportId)
          ?? (u.deployment?.transportName ? transportManifest.find(entry => entry.unit.name === u.deployment?.transportName) : undefined);
        const selectedTransportOverCapacity = !!selectedTransport
          && selectedTransport.capacity > 0
          && selectedTransport.used > selectedTransport.capacity;
        const splitPlan = splitPlanForUnit(u);
        const canSplitUnit = !!splitPlan && u.baseModelCount === splitPlan.totalModels;
        const selected = selectedUnitIndex === i;

        return (
        <div
          key={id}
          style={{
            padding: '5px 8px',
            margin: `3px 6px 5px ${indent ? 24 : 6}px`,
            border: `1px solid ${selected ? '#ffe06688' : groupRole !== 'solo' ? '#9ab7ff33' : '#222238'}`,
            borderLeft: selected ? '4px solid #ffe066' : groupRole !== 'solo' ? '4px solid #9ab7ff66' : '4px solid #222238',
            borderRadius: 5,
            background: selected
              ? 'rgba(255,224,102,0.08)'
              : groupRole !== 'solo'
                ? 'rgba(80,120,210,0.055)'
                : '#11111b',
          }}
        >
          {groupRole === 'leader' && groupIndex === 0 && (
            <div style={{ color: uiTokens.color.status.info, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px 4px', letterSpacing: 0.4 }}>
              Attached group
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              onInspectUnit?.(i);
              if (editable) setExpandedUnitId(expanded ? null : id);
            }}
            style={{
              width: '100%',
              border: 0,
              background: expanded ? `${color}14` : 'transparent',
              color: uiTokens.color.text.primary,
              cursor: editable ? 'pointer' : 'default',
              font: 'inherit',
              padding: '4px',
              borderRadius: 3,
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {editable && (
                <span style={{ color, fontSize: 12, width: 12 }}>{expanded ? '-' : '+'}</span>
              )}
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.name}
              </span>
              <span style={{ color: '#777', fontSize: 10, whiteSpace: 'nowrap' }}>{u.baseModelCount}x</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
              {groupRole === 'leader' && <Badge label="Leader" color={uiTokens.color.status.info} />}
              {groupRole === 'bodyguard' && <Badge label="Bodyguard" color={uiTokens.color.status.info} />}
              {canDeployOutsideDeploymentZone(u) && <Badge label="Infiltrators" color="#66d7aa" />}
            </div>
            <UnitSummaryBadges
              unit={u}
              army={army}
              color={color}
              transportEntry={ownTransportEntry}
              leaderEntry={ownLeaderEntry}
              leaderManifest={leaderManifest}
            />
          </button>

          {expanded && (
            <div style={{ padding: '4px 0 2px' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
            {editable ? (
              <input
                value={u.name}
                onChange={event => onChangeUnit(i, { ...u, name: event.target.value })}
                aria-label="Unit name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: '#111118',
                  border: `1px solid ${color}33`,
                  borderRadius: 3,
                  color: uiTokens.color.text.primary,
                  font: 'inherit',
                  fontSize: 12,
                  fontWeight: 'bold',
                  padding: '2px 4px',
                }}
              />
            ) : (
              <div style={{ color: uiTokens.color.text.primary, fontSize: 12, fontWeight: 'bold' }}>{u.name}</div>
            )}
            {editable && (
              <button
                type="button"
                onClick={() => onDeleteUnit(i)}
                title="Delete unit"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 3,
                  border: '1px solid #663333',
                  background: '#231515',
                  color: '#ff8a8a',
                  cursor: 'pointer',
                  fontSize: 12,
                  lineHeight: '18px',
                }}
              >
                x
              </button>
            )}
          </div>
          {editable && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: showTransportCapacity ? '1fr 1fr 1fr' : '1fr 1fr',
              gap: 4,
              marginTop: 4,
            }}>
              <label style={{ color: '#777', fontSize: 10 }}>
                Models
                <input
                  type="number"
                  min={1}
                  value={u.baseModelCount}
                  onChange={event => {
                    const baseModelCount = Math.max(1, Number(event.target.value) || 1);
                    onChangeUnit(i, {
                      ...u,
                      baseModelCount,
                      modelWeaponLoadouts: resizeModelWeaponLoadouts(u, baseModelCount),
                    });
                  }}
                  style={numberInputStyle}
                />
              </label>
              {showTransportCapacity && (
                <label style={{ color: '#777', fontSize: 10 }}>
                  Capacity
                  <input
                    type="number"
                    min={0}
                    value={u.transportCapacity ?? 0}
                    onChange={event => onChangeUnit(i, {
                      ...u,
                      transportCapacity: Math.max(0, Number(event.target.value) || 0) || undefined,
                      deployment: Math.max(0, Number(event.target.value) || 0) > 0 && u.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport
                        ? undefined
                        : u.deployment,
                    })}
                    style={numberInputStyle}
                  />
                </label>
              )}
              <label style={{ color: '#777', fontSize: 10 }}>
                Deployment
                <select
                  value={deploymentMode(u)}
                  onChange={event => {
                    const mode = event.target.value as UnitDeploymentMode;
                    if (mode === UNIT_DEPLOYMENT_MODE.Transport && unitIsTransport) return;
                    onChangeUnit(i, {
                      ...u,
                      deployment: mode === UNIT_DEPLOYMENT_MODE.Battlefield
                        ? undefined
                        : {
                          mode,
                          transportUnitId: mode === UNIT_DEPLOYMENT_MODE.Transport ? u.deployment?.transportUnitId : undefined,
                          transportName: mode === UNIT_DEPLOYMENT_MODE.Transport ? u.deployment?.transportName : undefined,
                        },
                    });
                  }}
                  style={selectInputStyle(color)}
                >
                  <option value={UNIT_DEPLOYMENT_MODE.Battlefield}>Battlefield</option>
                  <option value={UNIT_DEPLOYMENT_MODE.DeepStrike}>Deep Strike</option>
                  <option value={UNIT_DEPLOYMENT_MODE.StrategicReserve}>Reserves</option>
                  <option value={UNIT_DEPLOYMENT_MODE.Transport} disabled={unitIsTransport}>Transport</option>
                </select>
              </label>
            </div>
          )}
          {editable && splitPlan && (
            <button
              type="button"
              onClick={() => canSplitUnit && onSplitUnit(i, splitPlan)}
              disabled={!canSplitUnit}
              title={canSplitUnit ? splitPlan.abilityName : `Needs ${splitPlan.totalModels} models for ${splitPlan.abilityName}`}
              style={{
                marginTop: 4,
                marginLeft: 4,
                borderRadius: 3,
                border: `1px solid ${canSplitUnit ? color : '#33334a'}33`,
                background: canSplitUnit ? '#15151f' : '#111118',
                color: canSplitUnit ? '#ccc' : '#666',
                cursor: canSplitUnit ? 'pointer' : 'not-allowed',
                font: 'inherit',
                fontSize: 10,
                padding: '2px 6px',
              }}
            >
              Split into {splitPlan.modelCounts.map(count => `${count}x`).join(' + ')}
            </button>
          )}
          {editable && unitIsLeader && (
            <label style={{ display: 'block', color: '#777', fontSize: 10, marginTop: 4 }}>
              Attached to
              <select
                value={currentLeaderTargetId}
                onChange={event => {
                  const target = leaderManifest.find(entry => entry.id === event.target.value);
                  onChangeUnit(i, {
                    ...u,
                    leaderAttachment: target
                      ? { attachedToUnitId: target.id, attachedToName: target.unit.name }
                      : undefined,
                  });
                }}
                style={selectInputStyle(color)}
              >
                <option value="">No attachment</option>
                {leaderManifest
                  .filter(entry => entry.index !== i && !isLeaderUnit(entry.unit))
                  .map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {entry.unit.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {ownLeaderEntry?.leaders.length ? (
            <div style={{ color: uiTokens.color.status.info, fontSize: 10, marginTop: 2 }}>
              Leaders: {ownLeaderEntry.leaders.map(leader => leader.name).join(', ')}
            </div>
          ) : null}
          {editable && u.weapons.length > 0 && (
            <ModelWeaponLoadoutEditor
              unit={u}
              color={color}
              onChange={modelWeaponLoadouts => onChangeUnit(i, { ...u, modelWeaponLoadouts })}
            />
          )}
          {editable && deploymentMode(u) === UNIT_DEPLOYMENT_MODE.Transport && (
            <label style={{ display: 'block', color: '#777', fontSize: 10, marginTop: 4 }}>
              Transport
              <select
                value={currentTransportId}
                onChange={event => {
                  const target = transportManifest.find(entry => entry.id === event.target.value);
                  onChangeUnit(i, {
                    ...u,
                    deployment: {
                      mode: UNIT_DEPLOYMENT_MODE.Transport,
                      transportUnitId: target?.id,
                      transportName: target?.unit.name,
                    },
                  });
                }}
                style={selectInputStyle(color)}
              >
                <option value="">Choose transport</option>
                {transportManifest
                  .filter(entry => entry.index !== i)
                  .map(entry => {
                    const remaining = entry.capacity ? entry.capacity - entry.used : null;
                    const isCurrent = entry.id === currentTransportId;
                    const canFit = isCurrent || remaining === null || remaining >= currentPassengerCount;
                    const label = entry.capacity
                      ? `${entry.unit.name} (${entry.used}/${entry.capacity}${canFit ? '' : ', full'})`
                      : `${entry.unit.name} (capacity not set)`;
                    return (
                      <option key={entry.id} value={entry.id} disabled={!canFit}>
                        {label}
                      </option>
                    );
                  })}
              </select>
            </label>
          )}
          {editable && deploymentMode(u) === UNIT_DEPLOYMENT_MODE.Transport && selectedTransportOverCapacity && (
            <div style={{ color: '#ff8a8a', fontSize: 10, marginTop: 2 }}>
              Transport over capacity: {selectedTransport.used}/{selectedTransport.capacity}
            </div>
          )}
          {ownTransportEntry && (
            <div style={{
              color: ownTransportEntry.capacity && ownTransportEntry.used > ownTransportEntry.capacity ? '#ff8a8a' : '#888',
              fontSize: 10,
              marginTop: 2,
            }}>
              Transport load: {ownTransportEntry.used}/{ownTransportEntry.capacity || '?'}
              {ownTransportEntry.passengers.length ? ` - ${ownTransportEntry.passengers.map(passenger => passenger.name).join(', ')}` : ''}
            </div>
          )}
          {deploymentMode(u) !== UNIT_DEPLOYMENT_MODE.Battlefield && (
            <div style={{ color, fontSize: 10, marginTop: 1 }}>
              {deploymentLabel(u, army)}
            </div>
          )}
          {u.leaderAttachment && (
            <div style={{ color: uiTokens.color.status.info, fontSize: 10, marginTop: 1 }}>
              Attached to {leaderManifest.find(entry => entry.id === u.leaderAttachment?.attachedToUnitId)?.unit.name ?? u.leaderAttachment.attachedToName ?? 'unit'}
            </div>
          )}
            </div>
          )}
        </div>
        );
      })}
    </>
  );
}

type GroupedUnitDisplayItem = {
  unit: UnitProfile;
  index: number;
  indent: number;
  groupRole: 'solo' | 'leader' | 'bodyguard';
  groupIndex: number;
};

function groupedUnitDisplayItems(army: ImportedArmy): GroupedUnitDisplayItem[] {
  const renderedIds = new Set<string>();
  const groups: Array<{ sortIndex: number; hasCharacter: boolean; items: GroupedUnitDisplayItem[] }> = [];

  army.units.forEach((unit, index) => {
    const id = unitKey(unit, index);
    if (renderedIds.has(id) || unit.leaderAttachment) return;

    const leaders = army.units
      .map((candidate, candidateIndex) => ({ unit: candidate, index: candidateIndex, id: unitKey(candidate, candidateIndex) }))
      .filter(candidate =>
        candidate.unit.leaderAttachment?.attachedToUnitId === id
        || (!candidate.unit.leaderAttachment?.attachedToUnitId && candidate.unit.leaderAttachment?.attachedToName === unit.name),
      );

    const groupItems: GroupedUnitDisplayItem[] = [];
    leaders.forEach((leader, leaderIndex) => {
      groupItems.push({ unit: leader.unit, index: leader.index, indent: 0, groupRole: 'leader', groupIndex: leaderIndex });
      renderedIds.add(leader.id);
    });

    groupItems.push({
      unit,
      index,
      indent: leaders.length ? 1 : 0,
      groupRole: leaders.length ? 'bodyguard' : 'solo',
      groupIndex: leaders.length,
    });
    renderedIds.add(id);
    groups.push({
      sortIndex: index,
      hasCharacter: isLeaderUnit(unit) || leaders.some(leader => isLeaderUnit(leader.unit)),
      items: groupItems,
    });
  });

  army.units.forEach((unit, index) => {
    const id = unitKey(unit, index);
    if (!renderedIds.has(id)) {
      groups.push({
        sortIndex: index,
        hasCharacter: isLeaderUnit(unit),
        items: [{ unit, index, indent: 0, groupRole: 'solo', groupIndex: 0 }],
      });
      renderedIds.add(id);
    }
  });

  return groups
    .sort((a, b) => Number(b.hasCharacter) - Number(a.hasCharacter) || a.sortIndex - b.sortIndex)
    .flatMap(group => group.items);
}

function UnitSummaryBadges({
  unit,
  army,
  color,
  transportEntry,
  leaderEntry,
  leaderManifest,
}: {
  unit: UnitProfile;
  army: ImportedArmy;
  color: string;
  transportEntry?: TransportManifestEntry;
  leaderEntry?: LeaderManifestEntry;
  leaderManifest: LeaderManifestEntry[];
}) {
  const badges: { label: string; color: string }[] = [];
  const mode = deploymentMode(unit);
  if (mode !== UNIT_DEPLOYMENT_MODE.Battlefield) badges.push({ label: deploymentLabel(unit, army), color });
  if (unit.leaderAttachment) {
    const target = leaderManifest.find(entry => entry.id === unit.leaderAttachment?.attachedToUnitId)?.unit.name
      ?? unit.leaderAttachment.attachedToName
      ?? 'unit';
    badges.push({ label: `Attached: ${target}`, color: uiTokens.color.status.info });
  }
  if (leaderEntry?.leaders.length) {
    badges.push({ label: `Leaders: ${leaderEntry.leaders.length}`, color: uiTokens.color.status.info });
  }
  if (transportEntry) {
    const over = !!transportEntry.capacity && transportEntry.used > transportEntry.capacity;
    badges.push({
      label: `Load ${transportEntry.used}/${transportEntry.capacity || '?'}`,
      color: over ? '#ff8a8a' : '#888',
    });
  }
  if (!badges.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
      {badges.map((badge, index) => (
        <span
          key={`${badge.label}-${index}`}
          style={{
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 2,
            background: `${badge.color}22`,
            color: badge.color,
            border: `1px solid ${badge.color}44`,
          }}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

const numberInputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 2,
  background: '#111118',
  border: '1px solid #33334a',
  borderRadius: 3,
  color: uiTokens.color.text.primary,
  font: 'inherit',
  fontSize: 11,
  padding: '2px 4px',
};

function selectInputStyle(color: string): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    marginTop: 2,
    background: '#111118',
    border: `1px solid ${color}33`,
    borderRadius: 3,
    color: uiTokens.color.text.primary,
    font: 'inherit',
    fontSize: 11,
    padding: '2px 4px',
  };
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, padding: '1px 4px', borderRadius: 2,
      background: `${color}33`, color, border: `1px solid ${color}66`,
    }}>
      {label}
    </span>
  );
}
