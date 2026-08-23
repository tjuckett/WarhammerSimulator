import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitDeploymentMode, type UnitProfile } from '@warhammer-simulator/core/types/army';
export function deploymentMode(unit: UnitProfile): UnitDeploymentMode {
  return unit.deployment?.mode ?? UNIT_DEPLOYMENT_MODE.Battlefield;
}

export function isTransportUnit(unit: UnitProfile): boolean {
  return Math.max(0, Math.floor(unit.transportCapacity ?? 0)) > 0 || isTransportKeyword(unit);
}

export function deploymentLabel(unit: UnitProfile, army: ImportedArmy): string {
  if (unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.DeepStrike) return 'Deep Strike';
  if (unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.StrategicReserve) return 'Reserves';
  if (unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport) {
    const transport = findTransportUnit(army, unit.deployment);
    return transport ? `In ${transport.name}` : 'In transport';
  }
  return 'Battlefield';
}

export function isLeaderUnit(unit: UnitProfile): boolean {
  return hasUnitKeyword(unit, 'character');
}

export function generateRosterId(): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `unit-${Date.now().toString(36)}-${random}`;
}

export function unitKey(unit: UnitProfile, index: number): string {
  return unit.rosterId ?? `legacy-${index}`;
}

export function normalizeArmyForEditing(army: ImportedArmy): ImportedArmy {
  const unitsWithIds = army.units.map(unit => unit.rosterId ? unit : { ...unit, rosterId: generateRosterId() });
  const units = unitsWithIds.map(unit => {
    let nextUnit = unit;
    if (isTransportUnit(unit) && unit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport) {
      nextUnit = { ...nextUnit, deployment: undefined };
    }
    if (nextUnit.deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport && !nextUnit.deployment.transportUnitId && nextUnit.deployment.transportName) {
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

export function findTransportUnit(army: ImportedArmy, deployment: UnitProfile['deployment']): UnitProfile | null {
  if (!deployment || deployment.mode !== UNIT_DEPLOYMENT_MODE.Transport) return null;
  if (deployment.transportUnitId) {
    const byId = army.units.find((unit, index) => unitKey(unit, index) === deployment.transportUnitId);
    if (byId) return byId;
  }
  if (deployment.transportName) {
    return army.units.find(unit => unit.name === deployment.transportName) ?? null;
  }
  return null;
}

export function isTransportKeyword(unit: UnitProfile): boolean {
  return hasUnitKeyword(unit, 'transport');
}

export function hasUnitKeyword(unit: UnitProfile, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  return [...unit.keywords, ...unit.factionKeywords].some(candidate => candidate.toLowerCase() === needle);
}

export type TransportManifestEntry = {
  id: string;
  unit: UnitProfile;
  index: number;
  capacity: number;
  used: number;
  passengers: UnitProfile[];
};

export function buildTransportManifest(army: ImportedArmy): TransportManifestEntry[] {
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
    if (passenger.deployment?.mode !== UNIT_DEPLOYMENT_MODE.Transport) continue;
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

export type LeaderManifestEntry = {
  id: string;
  unit: UnitProfile;
  index: number;
  leaders: UnitProfile[];
};

export function buildLeaderManifest(army: ImportedArmy): LeaderManifestEntry[] {
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

export function attachmentGroupIds(army: ImportedArmy, unitIndex: number): string[] {
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

export function attachmentGroupModelCount(army: ImportedArmy, unitIndex: number): number {
  const ids = new Set(attachmentGroupIds(army, unitIndex));
  return army.units.reduce((total, unit, index) =>
    ids.has(unitKey(unit, index)) && !isTransportUnit(unit)
      ? total + unit.baseModelCount
      : total,
  0);
}

export type UnitSplitPlan = {
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

export function parseCountToken(token: string): number | null {
  const normalized = token.toLowerCase().trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return NUMBER_WORDS[normalized] ?? null;
}

export function splitPlanForUnit(unit: UnitProfile): UnitSplitPlan | null {
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

export function defaultWeaponLoadout(unit: UnitProfile): number[] {
  return unit.weapons.map((_, weaponIndex) => weaponIndex);
}

export function modelWeaponLoadout(unit: UnitProfile, modelIndex: number): number[] {
  const configured = unit.modelWeaponLoadouts?.[modelIndex];
  if (configured?.length) {
    return configured.filter(weaponIndex => weaponIndex >= 0 && weaponIndex < unit.weapons.length);
  }
  return defaultWeaponLoadout(unit);
}

export function resizeModelWeaponLoadouts(unit: UnitProfile, modelCount: number): number[][] {
  return Array.from({ length: modelCount }, (_, modelIndex) => modelWeaponLoadout(unit, modelIndex));
}

export function updateModelWeaponLoadout(unit: UnitProfile, modelIndex: number, weaponIndex: number, count: number): number[][] {
  const loadouts = resizeModelWeaponLoadouts(unit, unit.baseModelCount);
  const withoutWeapon = (loadouts[modelIndex] ?? []).filter(index => index !== weaponIndex);
  loadouts[modelIndex] = [
    ...withoutWeapon,
    ...Array.from({ length: Math.max(0, Math.floor(count)) }, () => weaponIndex),
  ].sort((a, b) => a - b);
  return loadouts;
}

export function weaponCountForLoadouts(unit: UnitProfile, weaponIndex: number): number {
  let count = 0;
  for (let modelIndex = 0; modelIndex < unit.baseModelCount; modelIndex++) {
    count += modelWeaponLoadout(unit, modelIndex).filter(index => index === weaponIndex).length;
  }
  return count;
}

export function modelWeaponCopyCount(unit: UnitProfile, modelIndex: number, weaponIndex: number): number {
  return modelWeaponLoadout(unit, modelIndex).filter(index => index === weaponIndex).length;
}
