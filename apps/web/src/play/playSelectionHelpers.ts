import type { BattleState } from '@warhammer-simulator/core/types/battle';
import type { ImportedArmy, UnitProfile } from '@warhammer-simulator/core/types/army';
import { attachedUnitProfilesFor, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import type { PlayModelSelection } from '../components/Battlefield';

export function normalizePlaySelectionParts(selection: PlayModelSelection): PlayModelSelection['parts'] {
  return selection.parts
    .map(part => ({
      unitId: part.unitId,
      side: part.side,
      modelIndices: Array.from(new Set(part.modelIndices)).sort((a, b) => a - b),
    }))
    .filter(part => part.modelIndices.length > 0);
}

export function normalizePlaySelectionForState(
  state: BattleState | null,
  selection: PlayModelSelection | null,
): PlayModelSelection | null {
  if (!state || !selection) return null;
  const rawParts = normalizePlaySelectionParts(selection);
  const primary = rawParts[0];
  if (!primary) return null;

  const primaryUnit = state.units.find(unit =>
    unit.id === primary.unitId && unit.side === primary.side && !unit.destroyed,
  );
  if (!primaryUnit) return null;

  const allowedUnitIds = new Set(attachedBattleUnitIdsForSelection(state, primary.unitId));
  if (!allowedUnitIds.size) allowedUnitIds.add(primary.unitId);

  const parts = rawParts.flatMap(part => {
    if (part.side !== primary.side || !allowedUnitIds.has(part.unitId)) return [];
    const unit = state.units.find(candidate =>
      candidate.id === part.unitId && candidate.side === part.side && !candidate.destroyed,
    );
    if (!unit) return [];
    const modelIndices = part.modelIndices.filter(modelIndex => modelIndex >= 0 && modelIndex < unit.modelPositions.length);
    return modelIndices.length ? [{ unitId: unit.id, side: unit.side, modelIndices }] : [];
  });

  return parts.length ? { side: primary.side, parts } : null;
}

export function primaryPlaySelectionPart(selection: PlayModelSelection | null): PlayModelSelection['parts'][number] | null {
  return selection?.parts[0] ?? null;
}

export function attachedProfilesForInspection(army: ImportedArmy, unit: UnitProfile): UnitProfile[] {
  const selectedId = unitRosterId(unit);
  return attachedUnitProfilesFor(army, unit, army.units).filter(profile => unitRosterId(profile) !== selectedId);
}

export function attachedBattleUnitIdsForSelection(state: BattleState | null, unitId: string | null): string[] {
  if (!state || !unitId) return [];
  const selected = state.units.find(unit => unit.id === unitId && !unit.destroyed);
  if (!selected) return [];

  const army = state.armies[selected.side].army;
  const groupProfiles = attachedUnitProfilesFor(army, selected.profile, army.units);
  const groupIds = new Set(groupProfiles.map(unitRosterId));
  return state.units
    .filter(unit => unit.side === selected.side && !unit.destroyed && groupIds.has(unitRosterId(unit.profile)))
    .map(unit => unit.id);
}

export function battleUnitForProfile(state: BattleState | null, side: 0 | 1, profile: UnitProfile) {
  const rosterId = unitRosterId(profile);
  return state?.units.find(candidate =>
    candidate.side === side
    && !candidate.destroyed
    && unitRosterId(candidate.profile) === rosterId,
  );
}
