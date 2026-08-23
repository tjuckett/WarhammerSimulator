import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile } from '@warhammer-simulator/core/types/army';
import { canDeployOutsideDeploymentZone, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { uiTokens } from '../theme/uiTokens';
import { Badge } from './ArmyStaticUnitList';
import { UnitList } from './ArmyUnitList';
import { buildTransportManifest, deploymentLabel, deploymentMode, groupedUnitDisplayItems, isTransportUnit, type TransportManifestEntry, unitKey } from './armyPanelHelpers';

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

export function PlayDeploymentList({
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
