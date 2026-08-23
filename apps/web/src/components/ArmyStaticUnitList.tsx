import React from 'react';
import type { ImportedArmy, UnitProfile } from '@warhammer-simulator/core/types/army';
import { UNIT_DEPLOYMENT_MODE } from '@warhammer-simulator/core/types/army';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { canDeployOutsideDeploymentZone, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { uiTokens } from '../theme/uiTokens';
import { ModelWeaponLoadoutEditor } from './ArmyModelWeaponLoadoutEditor';
import { UnitList } from './ArmyUnitList';
import { buildLeaderManifest, buildTransportManifest, deploymentLabel, deploymentMode, groupedUnitDisplayItems, isLeaderUnit, type LeaderManifestEntry, type TransportManifestEntry, type UnitSplitPlan, unitKey } from './armyPanelHelpers';

export function StaticUnitList({
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

export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, padding: '1px 4px', borderRadius: 2,
      background: `${color}33`, color, border: `1px solid ${color}66`,
    }}>
      {label}
    </span>
  );
}
