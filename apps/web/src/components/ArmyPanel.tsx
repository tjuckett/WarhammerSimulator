import React from 'react';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { ImportedArmy, UnitDeploymentMode, UnitProfile } from '@warhammer-simulator/core/types/army';
import { DEPLOYMENT_STRATEGIES, type DeploymentStrategy } from '@warhammer-simulator/core/engine/deployment';
import { applyBaseSizesToArmy } from '@warhammer-simulator/core/data/unitBaseSizes';
import { canDeployOutsideDeploymentZone, isImportedArmy, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';

interface Props {
  side: 0 | 1;
  army: ImportedArmy | null;
  battleState: BattleState | null;
  color: string;
  strategy: DeploymentStrategy;
  manualDeployment?: boolean;
  selectedManualUnitIndex?: number | null;
  selectedManualModelUnitId?: string | null;
  selectedInspectedUnitId?: string | null;
  selectedInspectedProfileIndex?: number | null;
  onImport: (army: ImportedArmy) => void;
  onChange: (army: ImportedArmy) => void;
  onSaveLocal: () => void;
  onExport: () => void;
  onStrategyChange: (s: DeploymentStrategy) => void;
  onSelectManualUnit?: (side: 0 | 1, unitIndex: number) => void;
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
  manualDeployment = false,
  selectedManualUnitIndex = null,
  selectedManualModelUnitId = null,
  selectedInspectedUnitId = null,
  selectedInspectedProfileIndex = null,
  onImport,
  onChange,
  onSaveLocal,
  onExport,
  onStrategyChange,
  onSelectManualUnit,
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
    const previousDeployment = previousUnit?.deployment?.mode === 'transport' ? previousUnit.deployment : undefined;
    const nextDeployment = normalizedUnit.deployment?.mode === 'transport' ? normalizedUnit.deployment : undefined;
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
            ? { ...unit, deployment: { mode: 'transport' as const } }
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

  const units = battleState ? battleState.units.filter(u => u.side === side) : null;
  const battlefieldUnits = army?.units.filter(unit => deploymentMode(unit) === 'battlefield').length ?? 0;
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
        <div style={{ color: '#aaa', fontSize: 12 }}>
          {army ? `${army.name} (${army.faction})` : 'No army loaded'}
        </div>
      </div>

      {!manualDeployment && (
        <div style={{ padding: '5px 8px', flexShrink: 0, borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#888', fontSize: 11, whiteSpace: 'nowrap' }}>Deploy:</span>
          <select
            value={strategy}
            onChange={e => onStrategyChange(e.target.value as DeploymentStrategy)}
            disabled={!!battleState}
            style={{
              flex: 1, background: '#1a1a1a', border: `1px solid ${color}44`,
              color: '#ccc', fontSize: 11, padding: '3px 5px', borderRadius: 3, cursor: 'pointer',
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
          <div style={{ marginTop: 4, color: '#666', fontSize: 11 }}>
            {army.units.length} units loaded, {battlefieldUnits} deploying{stagedUnits ? `, ${stagedUnits} staged` : ''}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {manualDeployment && battleState?.phase === 'deployment' ? (
          <ManualDeploymentList
            side={side}
            army={army!}
            placedUnits={units ?? []}
            unplacedUnits={battleState.unplacedUnits[side]}
            color={color}
            selectedIndex={selectedManualUnitIndex}
            selectedPlacedUnitId={selectedManualModelUnitId ?? selectedInspectedUnitId}
            onSelect={onSelectManualUnit}
            onSelectPlacedUnit={onSelectPlacedUnit}
            onInspectStagedUnit={onInspectProfile ? unitIndex => onInspectProfile(side, unitIndex) : undefined}
            onUndeployPlacedUnit={onUndeployPlacedUnit}
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
          <div style={{ color: '#444', fontSize: 11, padding: '8px', textAlign: 'center' }}>
            Load an army or use the sample armies
          </div>
        )}
      </div>
    </div>
  );
}

function deploymentMode(unit: UnitProfile): UnitDeploymentMode {
  return unit.deployment?.mode ?? 'battlefield';
}

function isTransportUnit(unit: UnitProfile): boolean {
  return Math.max(0, Math.floor(unit.transportCapacity ?? 0)) > 0 || isTransportKeyword(unit);
}

function deploymentLabel(unit: UnitProfile, army: ImportedArmy): string {
  if (unit.deployment?.mode === 'deepStrike') return 'Deep Strike';
  if (unit.deployment?.mode === 'strategicReserve') return 'Reserves';
  if (unit.deployment?.mode === 'transport') {
    const transport = findTransportUnit(army, unit.deployment);
    return transport ? `In ${transport.name}` : 'In transport';
  }
  return 'Battlefield';
}

function isLeaderUnit(unit: UnitProfile): boolean {
  return hasUnitKeyword(unit, 'character');
}

function generateRosterId(): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `unit-${Date.now().toString(36)}-${random}`;
}

function unitKey(unit: UnitProfile, index: number): string {
  return unit.rosterId ?? `legacy-${index}`;
}

function normalizeArmyForEditing(army: ImportedArmy): ImportedArmy {
  const unitsWithIds = army.units.map(unit => unit.rosterId ? unit : { ...unit, rosterId: generateRosterId() });
  const units = unitsWithIds.map(unit => {
    let nextUnit = unit;
    if (isTransportUnit(unit) && unit.deployment?.mode === 'transport') {
      nextUnit = { ...nextUnit, deployment: undefined };
    }
    if (nextUnit.deployment?.mode === 'transport' && !nextUnit.deployment.transportUnitId && nextUnit.deployment.transportName) {
      const transport = unitsWithIds.find(candidate => candidate.name === nextUnit.deployment?.transportName);
      if (transport?.rosterId) {
        nextUnit = { ...nextUnit, deployment: { ...nextUnit.deployment, transportUnitId: transport.rosterId } };
      }
    }
    if (!isLeaderUnit(nextUnit) && nextUnit.leaderAttachment) {
      nextUnit = { ...nextUnit, leaderAttachment: undefined };
    }
    if (nextUnit.leaderAttachment?.attachedToName && !nextUnit.leaderAttachment.attachedToUnitId) {
      const attachedTo = unitsWithIds.find(candidate => candidate.name === nextUnit.leaderAttachment?.attachedToName);
      if (attachedTo?.rosterId) {
        nextUnit = { ...nextUnit, leaderAttachment: { ...nextUnit.leaderAttachment, attachedToUnitId: attachedTo.rosterId } };
      }
    }
    return nextUnit;
  });
  return { ...army, units };
}

function findTransportUnit(army: ImportedArmy, deployment: UnitProfile['deployment']): UnitProfile | null {
  if (!deployment || deployment.mode !== 'transport') return null;
  if (deployment.transportUnitId) {
    const byId = army.units.find((unit, index) => unitKey(unit, index) === deployment.transportUnitId);
    if (byId) return byId;
  }
  if (deployment.transportName) {
    return army.units.find(unit => unit.name === deployment.transportName) ?? null;
  }
  return null;
}

function isTransportKeyword(unit: UnitProfile): boolean {
  return hasUnitKeyword(unit, 'transport');
}

function hasUnitKeyword(unit: UnitProfile, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return [...unit.keywords, ...unit.factionKeywords].some(candidate => candidate.toLowerCase() === needle);
}

type TransportManifestEntry = {
  id: string;
  unit: UnitProfile;
  index: number;
  capacity: number;
  used: number;
  passengers: UnitProfile[];
};

function buildTransportManifest(army: ImportedArmy): TransportManifestEntry[] {
  const entries = army.units
    .map((unit, index): TransportManifestEntry | null => {
      const capacity = Math.max(0, Math.floor(unit.transportCapacity ?? 0));
      if (!isTransportUnit(unit)) return null;
      return {
        id: unitKey(unit, index),
        unit,
        index,
        capacity,
        used: 0,
        passengers: [],
      };
    })
    .filter((entry): entry is TransportManifestEntry => entry !== null);

  for (const passenger of army.units) {
    if (passenger.deployment?.mode !== 'transport') continue;
    const target = entries.find(entry =>
      entry.id === passenger.deployment?.transportUnitId
      || (!passenger.deployment?.transportUnitId && entry.unit.name === passenger.deployment?.transportName),
    );
    if (!target) continue;
    target.used += passenger.baseModelCount;
    target.passengers.push(passenger);
  }

  return entries;
}

type LeaderManifestEntry = {
  id: string;
  unit: UnitProfile;
  index: number;
  leaders: UnitProfile[];
};

function buildLeaderManifest(army: ImportedArmy): LeaderManifestEntry[] {
  return army.units.map((unit, index) => ({
    id: unitKey(unit, index),
    unit,
    index,
    leaders: army.units.filter(leader =>
      leader.leaderAttachment?.attachedToUnitId === unitKey(unit, index)
      || (!leader.leaderAttachment?.attachedToUnitId && leader.leaderAttachment?.attachedToName === unit.name),
    ),
  }));
}

function attachmentGroupIds(army: ImportedArmy, unitIndex: number): string[] {
  const unit = army.units[unitIndex];
  if (!unit) return [];
  const unitId = unitKey(unit, unitIndex);
  const bodyguard = unit.leaderAttachment
    ? army.units.find(target =>
      unit.leaderAttachment?.attachedToUnitId === unitKey(target, army.units.indexOf(target))
      || (!unit.leaderAttachment?.attachedToUnitId && unit.leaderAttachment?.attachedToName === target.name),
    ) ?? unit
    : unit;
  const bodyguardIndex = army.units.indexOf(bodyguard);
  const bodyguardId = unitKey(bodyguard, bodyguardIndex);
  const leaders = army.units
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) =>
      candidate.leaderAttachment?.attachedToUnitId === bodyguardId
      || (!candidate.leaderAttachment?.attachedToUnitId && candidate.leaderAttachment?.attachedToName === bodyguard.name),
    );
  return Array.from(new Set([unitId, bodyguardId, ...leaders.map(({ candidate, index }) => unitKey(candidate, index))]));
}

function attachmentGroupModelCount(army: ImportedArmy, unitIndex: number): number {
  const ids = new Set(attachmentGroupIds(army, unitIndex));
  return army.units.reduce((total, unit, index) =>
    ids.has(unitKey(unit, index)) && !isTransportUnit(unit)
      ? total + unit.baseModelCount
      : total,
  0);
}

type UnitSplitPlan = {
  abilityName: string;
  modelCounts: number[];
  totalModels: number;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
};

function parseCountToken(token: string): number | null {
  const normalized = token.toLowerCase().trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return NUMBER_WORDS[normalized] ?? null;
}

function splitPlanForUnit(unit: UnitProfile): UnitSplitPlan | null {
  for (const ability of unit.abilities) {
    const text = `${ability.name} ${ability.description}`.replace(/\s+/g, ' ');
    const match = text.match(/split into\s+(\d+|[a-z]+)\s+units?,\s+each containing\s+(\d+|[a-z]+)\s+models?/i)
      ?? text.match(/split into\s+(\d+|[a-z]+)\s+units?\s+of\s+(\d+|[a-z]+)\s+models?/i);
    if (!match) continue;
    const unitCount = parseCountToken(match[1]);
    const modelsPerUnit = parseCountToken(match[2]);
    if (!unitCount || !modelsPerUnit) continue;
    return {
      abilityName: ability.name,
      modelCounts: Array.from({ length: unitCount }, () => modelsPerUnit),
      totalModels: unitCount * modelsPerUnit,
    };
  }
  return null;
}

function defaultWeaponLoadout(unit: UnitProfile): number[] {
  return unit.weapons.map((_, weaponIndex) => weaponIndex);
}

function modelWeaponLoadout(unit: UnitProfile, modelIndex: number): number[] {
  const configured = unit.modelWeaponLoadouts?.[modelIndex];
  if (configured?.length) {
    return configured.filter(weaponIndex => weaponIndex >= 0 && weaponIndex < unit.weapons.length);
  }
  return defaultWeaponLoadout(unit);
}

function resizeModelWeaponLoadouts(unit: UnitProfile, modelCount: number): number[][] {
  return Array.from({ length: modelCount }, (_, modelIndex) => modelWeaponLoadout(unit, modelIndex));
}

function updateModelWeaponLoadout(unit: UnitProfile, modelIndex: number, weaponIndex: number, count: number): number[][] {
  const loadouts = resizeModelWeaponLoadouts(unit, unit.baseModelCount);
  const withoutWeapon = (loadouts[modelIndex] ?? []).filter(index => index !== weaponIndex);
  loadouts[modelIndex] = [
    ...withoutWeapon,
    ...Array.from({ length: Math.max(0, Math.floor(count)) }, () => weaponIndex),
  ].sort((a, b) => a - b);
  return loadouts;
}

function weaponCountForLoadouts(unit: UnitProfile, weaponIndex: number): number {
  let count = 0;
  for (let modelIndex = 0; modelIndex < unit.baseModelCount; modelIndex++) {
    count += modelWeaponLoadout(unit, modelIndex).filter(index => index === weaponIndex).length;
  }
  return count;
}

function modelWeaponCopyCount(unit: UnitProfile, modelIndex: number, weaponIndex: number): number {
  return modelWeaponLoadout(unit, modelIndex).filter(index => index === weaponIndex).length;
}

function ModelWeaponLoadoutEditor({
  unit,
  color,
  onChange,
}: {
  unit: UnitProfile;
  color: string;
  onChange: (loadouts: number[][]) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div style={{ marginTop: 6, border: `1px solid ${color}22`, borderRadius: 4, background: '#111118' }}>
      <button
        type="button"
        onClick={() => setExpanded(open => !open)}
        style={{
          width: '100%',
          border: 0,
          background: 'transparent',
          color: '#bbb',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 10,
          padding: '5px 6px',
          textAlign: 'left',
        }}
      >
        {expanded ? '-' : '+'} Model weapon loadouts
        <span style={{ color: '#777', marginLeft: 6 }}>
          {unit.weapons.map((weapon, weaponIndex) => `${weapon.name}: ${weaponCountForLoadouts(unit, weaponIndex)}`).join(' | ')}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 6px 6px', display: 'grid', gap: 4 }}>
          {Array.from({ length: unit.baseModelCount }, (_, modelIndex) => {
            return (
              <div key={modelIndex} style={{ borderTop: '1px solid #222236', paddingTop: 4 }}>
                <div style={{ color: '#888', fontSize: 10, marginBottom: 3 }}>Model {modelIndex + 1}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 3 }}>
                  {unit.weapons.map((weapon, weaponIndex) => (
                    <label key={`${weapon.name}-${weaponIndex}`} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', alignItems: 'center', gap: 4, color: '#aaa', fontSize: 10 }}>
                      <input
                        type="number"
                        min={0}
                        value={modelWeaponCopyCount(unit, modelIndex, weaponIndex)}
                        onChange={event => onChange(updateModelWeaponLoadout(unit, modelIndex, weaponIndex, Number(event.target.value) || 0))}
                        style={{ ...numberInputStyle, marginTop: 0, padding: '1px 3px' }}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{weapon.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
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

function ManualDeploymentList({
  side,
  army,
  placedUnits,
  unplacedUnits,
  color,
  selectedIndex,
  selectedPlacedUnitId,
  onSelect,
  onSelectPlacedUnit,
  onInspectStagedUnit,
  onUndeployPlacedUnit,
}: {
  side: 0 | 1;
  army: ImportedArmy;
  placedUnits: BattleUnit[];
  unplacedUnits: ImportedArmy['units'];
  color: string;
  selectedIndex: number | null;
  selectedPlacedUnitId: string | null;
  onSelect?: (side: 0 | 1, unitIndex: number) => void;
  onSelectPlacedUnit?: (unitId: string, side: 0 | 1) => void;
  onInspectStagedUnit?: (unitIndex: number) => void;
  onUndeployPlacedUnit?: (unitId: string, side: 0 | 1) => void;
}) {
  const unplacedDisplayItems = groupedManualDropDisplayItems(army, unplacedUnits);
  const stagedItems = groupedStagedDisplayItems(army);
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
            color: '#ddd',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          {groupRole === 'leader' && groupIndex === 0 && (
            <div style={{ color: '#9ab7ff', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.4 }}>
              Attached group
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
            <span style={{ color: '#8f8fa8', fontSize: 10, whiteSpace: 'nowrap' }}>{u.baseModelCount} models</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {groupRole === 'leader' && <Badge label="Leader" color="#9ab7ff" />}
            {groupRole === 'bodyguard' && <Badge label="Bodyguard" color="#9ab7ff" />}
            {canDeployOutsideDeploymentZone(u) && <Badge label="Infiltrators" color="#66d7aa" />}
          </div>
        </button>
      )) : (
        <div style={{ color: '#555', fontSize: 10, padding: '4px 8px 8px' }}>All battlefield units deployed</div>
      )}

      <PanelSectionHeader label="Staged" count={stagedItems.length} color="#8888aa" />
      {stagedItems.length ? stagedItems.map(({ unit: u, index, indent, groupRole, groupIndex, kind, transportEntry }) => (
        <button
          key={`${kind}-${unitRosterId(u)}-${index}-${groupRole}-${groupIndex}-staged`}
          type="button"
          onClick={() => onInspectStagedUnit?.(index)}
          style={{
            display: 'block',
            width: `calc(100% - ${indent ? 34 : 12}px)`,
            margin: `0 6px 5px ${indent ? 28 : 6}px`,
            padding: '7px 8px',
            textAlign: 'left',
            background: kind === 'transport'
              ? 'rgba(255,224,102,0.07)'
              : groupRole !== 'solo' ? 'rgba(80,120,210,0.06)' : '#111118',
            border: `1px solid ${kind === 'transport' ? '#ffe06644' : groupRole !== 'solo' ? '#9ab7ff33' : '#24243a'}`,
            borderLeft: kind === 'transport'
              ? '4px solid #ffe06688'
              : groupRole !== 'solo' ? '4px solid #9ab7ff66' : '4px solid #24243a',
            borderRadius: 5,
            color: '#bbb',
            font: 'inherit',
            cursor: onInspectStagedUnit ? 'pointer' : 'default',
          }}
        >
          {kind === 'transport' && (
            <div style={{ color: '#ffe066', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>
              Transport contents
            </div>
          )}
          {groupRole === 'leader' && groupIndex === 0 && (
            <div style={{ color: '#9ab7ff', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', marginBottom: 2 }}>
              Attached group
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
            <span style={{ color: '#777', fontSize: 10, whiteSpace: 'nowrap' }}>
              {kind === 'transport' && transportEntry
                ? `${transportEntry.used}/${transportEntry.capacity || '?'} embarked`
                : deploymentLabel(u, army)}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {kind === 'transport' && <Badge label="Transport" color="#ffe066" />}
            {groupRole === 'leader' && <Badge label="Leader" color="#9ab7ff" />}
            {groupRole === 'bodyguard' && <Badge label="Bodyguard" color="#9ab7ff" />}
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

type ManualDropDisplayItem = {
  unit: UnitProfile;
  deployIndex: number;
  indent: number;
  groupRole: 'solo' | 'leader' | 'bodyguard';
  groupIndex: number;
};

type StagedDisplayItem = {
  kind: 'unit' | 'transport';
  unit: UnitProfile;
  index: number;
  indent: number;
  groupRole: 'solo' | 'leader' | 'bodyguard';
  groupIndex: number;
  transportEntry?: TransportManifestEntry;
};

function groupedManualDropDisplayItems(army: ImportedArmy, unplacedUnits: UnitProfile[]): ManualDropDisplayItem[] {
  const unplacedById = new Map(unplacedUnits.map((unit, index) => [unitRosterId(unit), { unit, index }]));
  return groupedUnitDisplayItems(army).flatMap((item): ManualDropDisplayItem[] => {
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

function groupedStagedDisplayItems(army: ImportedArmy): StagedDisplayItem[] {
  const groupedItems = groupedUnitDisplayItems(army);
  const nonTransportStaged = groupedItems.flatMap((item): StagedDisplayItem[] => {
    if (item.groupRole === 'leader') {
      const target = army.units.find(unit =>
        item.unit.leaderAttachment?.attachedToUnitId === unitRosterId(unit)
        || (!item.unit.leaderAttachment?.attachedToUnitId && item.unit.leaderAttachment?.attachedToName === unit.name),
      );
      if (!target || deploymentMode(target) === 'battlefield' || deploymentMode(target) === 'transport') return [];
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
    if (mode === 'battlefield' || mode === 'transport') return [];
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
        .map((item): StagedDisplayItem => ({
          kind: 'unit',
          unit: item.unit,
          index: item.index,
          indent: item.indent + 1,
          groupRole: item.groupRole,
          groupIndex: item.groupIndex,
        })),
    ]);

  return [...nonTransportStaged, ...transportStaged];
}

function isEmbarkedInTransport(unit: UnitProfile, transport: TransportManifestEntry): boolean {
  return unit.deployment?.mode === 'transport'
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
              <span style={{ color: u.destroyed ? '#555' : '#ddd', fontSize: 12, fontWeight: 'bold' }}>
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
              {u.movementAction === 'advanced' && <Badge label="advanced" color="#7cff9b" />}
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
        const currentPassengerCount = deploymentMode(u) === 'transport' ? attachmentGroupModelCount(army, i) : 0;
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
            <div style={{ color: '#9ab7ff', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', margin: '0 0 4px 4px', letterSpacing: 0.4 }}>
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
              color: '#ddd',
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
              {groupRole === 'leader' && <Badge label="Leader" color="#9ab7ff" />}
              {groupRole === 'bodyguard' && <Badge label="Bodyguard" color="#9ab7ff" />}
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
                  color: '#ddd',
                  font: 'inherit',
                  fontSize: 12,
                  fontWeight: 'bold',
                  padding: '2px 4px',
                }}
              />
            ) : (
              <div style={{ color: '#ddd', fontSize: 12, fontWeight: 'bold' }}>{u.name}</div>
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
                      deployment: Math.max(0, Number(event.target.value) || 0) > 0 && u.deployment?.mode === 'transport'
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
                    if (mode === 'transport' && unitIsTransport) return;
                    onChangeUnit(i, {
                      ...u,
                      deployment: mode === 'battlefield'
                        ? undefined
                        : {
                          mode,
                          transportUnitId: mode === 'transport' ? u.deployment?.transportUnitId : undefined,
                          transportName: mode === 'transport' ? u.deployment?.transportName : undefined,
                        },
                    });
                  }}
                  style={selectInputStyle(color)}
                >
                  <option value="battlefield">Battlefield</option>
                  <option value="deepStrike">Deep Strike</option>
                  <option value="strategicReserve">Reserves</option>
                  <option value="transport" disabled={unitIsTransport}>Transport</option>
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
            <div style={{ color: '#9ab7ff', fontSize: 10, marginTop: 2 }}>
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
          {editable && deploymentMode(u) === 'transport' && (
            <label style={{ display: 'block', color: '#777', fontSize: 10, marginTop: 4 }}>
              Transport
              <select
                value={currentTransportId}
                onChange={event => {
                  const target = transportManifest.find(entry => entry.id === event.target.value);
                  onChangeUnit(i, {
                    ...u,
                    deployment: {
                      mode: 'transport',
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
          {editable && deploymentMode(u) === 'transport' && selectedTransportOverCapacity && (
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
          {deploymentMode(u) !== 'battlefield' && (
            <div style={{ color, fontSize: 10, marginTop: 1 }}>
              {deploymentLabel(u, army)}
            </div>
          )}
          {u.leaderAttachment && (
            <div style={{ color: '#9ab7ff', fontSize: 10, marginTop: 1 }}>
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
  if (mode !== 'battlefield') badges.push({ label: deploymentLabel(unit, army), color });
  if (unit.leaderAttachment) {
    const target = leaderManifest.find(entry => entry.id === unit.leaderAttachment?.attachedToUnitId)?.unit.name
      ?? unit.leaderAttachment.attachedToName
      ?? 'unit';
    badges.push({ label: `Attached: ${target}`, color: '#9ab7ff' });
  }
  if (leaderEntry?.leaders.length) {
    badges.push({ label: `Leaders: ${leaderEntry.leaders.length}`, color: '#9ab7ff' });
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
  color: '#ddd',
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
    color: '#ddd',
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
