import type { BattleState, BattleUnit, LogEntry, Side } from '../types/battle';
import type { UnitProfile } from '../types/army';
import { weaponHasKeyword } from './rulesEngine';
import { unitRosterId } from './armyUnits';
import { modelWeaponLoadout } from './unitModelState';

export interface FiringDeckSelection {
  passengerRosterId: string;
  passengerName?: string;
  modelIndex: number;
  weaponIndex: number;
  weaponName?: string;
}

export interface FiringDeckContext {
  clone<T>(value: T): T;
  isTransport(unit: BattleUnit): boolean;
  passengerProfiles(state: BattleState, transport: BattleUnit): UnitProfile[];
  createLog(state: BattleState, side: Side, actor: string, message: string): LogEntry;
}

export function capacity(unit: BattleUnit): number {
  for (const rule of [...unit.profile.abilities, ...(unit.profile.rules ?? [])]) {
    const match = `${rule.name} ${rule.description}`.match(/Firing\s+Deck\s+(\d+)/i);
    if (match) return Number.parseInt(match[1], 10);
  }
  return 0;
}

export function options(state: BattleState, transportUnitId: string, side: Side, context: FiringDeckContext): FiringDeckSelection[] {
  if (state.phase !== 'shooting' || state.activeArmy !== side) return [];
  const transport = state.units.find(unit => unit.id === transportUnitId && unit.side === side && !unit.destroyed && !unit.embarkedInUnitId);
  if (!transport || transport.activated || capacity(transport) <= 0 || !context.isTransport(transport)) return [];
  return context.passengerProfiles(state, transport).flatMap(profile =>
    Array.from({ length: profile.baseModelCount }, (_, modelIndex) =>
      modelWeaponLoadout(profile, modelIndex).flatMap(weaponIndex => {
        const weapon = profile.weapons[weaponIndex];
        return weapon && !weapon.isMelee && !weaponHasKeyword(weapon, 'One Shot')
          ? [{ passengerRosterId: unitRosterId(profile), passengerName: profile.name, modelIndex, weaponIndex, weaponName: weapon.name }]
          : [];
      }),
    ).flat(),
  );
}

export function select(
  state: BattleState,
  transportUnitId: string,
  side: Side,
  selections: FiringDeckSelection[],
  context: FiringDeckContext,
): BattleState {
  const available = options(state, transportUnitId, side, context);
  const transport = state.units.find(unit => unit.id === transportUnitId && unit.side === side && !unit.destroyed);
  if (!transport || transport.firingDeckTurn === state.turn) return state;
  const modelKeys = selections.map(selection => `${selection.passengerRosterId}:${selection.modelIndex}`);
  if (
    selections.length > capacity(transport)
    || new Set(modelKeys).size !== selections.length
    || selections.some(selection => !available.some(option =>
      option.passengerRosterId === selection.passengerRosterId
      && option.modelIndex === selection.modelIndex
      && option.weaponIndex === selection.weaponIndex
    ))
  ) return state;

  const next = context.clone(state);
  applySelectionsInPlace(next, transportUnitId, side, selections, context);
  return next;
}

export function applySelectionsInPlace(
  state: BattleState,
  transportUnitId: string,
  side: Side,
  selections: FiringDeckSelection[],
  context: FiringDeckContext,
): void {
  const transport = state.units.find(unit => unit.id === transportUnitId && unit.side === side && !unit.destroyed);
  if (!transport) return;
  const passengerProfiles = context.passengerProfiles(state, transport);
  const baseWeaponCount = transport.profile.weapons.length;
  const loadouts = transport.modelPositions.map((_, modelIndex) =>
    [...modelWeaponLoadout(transport.profile, transport.modelRosterIndexes?.[modelIndex] ?? modelIndex)],
  );
  const grantedIndices: number[] = [];
  for (const selection of selections) {
    const passenger = passengerProfiles.find(profile => unitRosterId(profile) === selection.passengerRosterId);
    const sourceWeapon = passenger?.weapons[selection.weaponIndex];
    if (!passenger || !sourceWeapon) continue;
    const grantedIndex = transport.profile.weapons.length;
    transport.profile.weapons.push({
      ...sourceWeapon,
      name: `${sourceWeapon.name} (Firing Deck: ${passenger.name})`,
      firingDeckSource: {
        passengerRosterId: selection.passengerRosterId,
        passengerName: passenger.name,
        modelIndex: selection.modelIndex,
        weaponIndex: selection.weaponIndex,
      },
    });
    loadouts[0] = [...(loadouts[0] ?? []), grantedIndex];
    grantedIndices.push(grantedIndex);
  }
  transport.profile.modelWeaponLoadouts = loadouts;
  transport.firingDeckBaseWeaponCount = baseWeaponCount;
  transport.firingDeckGrantedWeaponIndices = grantedIndices;
  transport.firingDeckTurn = state.turn;
  const selectedPassengerIds = new Set(selections.map(selection => selection.passengerRosterId));
  const lockedIds = state.units
    .filter(unit => unit.embarkedInUnitId === transport.id && selectedPassengerIds.has(unitRosterId(unit.profile)))
    .map(unit => unit.id);
  state.firingDeckLockedUnitIds = [...new Set([...(state.firingDeckLockedUnitIds ?? []), ...lockedIds])];
  state.log = [...state.log, context.createLog(
    state,
    side,
    transport.profile.name,
    selections.length
      ? `${transport.profile.name} selects ${selections.length} embarked model${selections.length === 1 ? '' : 's'} for Firing Deck.`
      : `${transport.profile.name} selects no embarked models for Firing Deck.`,
  )];
}

export function autoSelectInPlace(state: BattleState, transport: BattleUnit, context: FiringDeckContext): void {
  if (transport.firingDeckTurn === state.turn) return;
  const max = capacity(transport);
  if (max <= 0) return;
  const usedModels = new Set<string>();
  const selections = options(state, transport.id, transport.side, context).filter(option => {
    const key = `${option.passengerRosterId}:${option.modelIndex}`;
    if (usedModels.has(key) || usedModels.size >= max) return false;
    usedModels.add(key);
    return true;
  });
  applySelectionsInPlace(state, transport.id, transport.side, selections, context);
}

export function clearWeapons(unit: BattleUnit): void {
  if (unit.firingDeckBaseWeaponCount === undefined) return;
  unit.profile.weapons = unit.profile.weapons.slice(0, unit.firingDeckBaseWeaponCount);
  unit.profile.modelWeaponLoadouts = unit.profile.modelWeaponLoadouts?.map(loadout =>
    loadout.filter(weaponIndex => weaponIndex < unit.firingDeckBaseWeaponCount!),
  );
  unit.firingDeckBaseWeaponCount = undefined;
  unit.firingDeckGrantedWeaponIndices = undefined;
}
