import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { ImportedArmy, UnitProfile } from '@warhammer-simulator/core/types/army';
import { attachedUnitProfilesFor, unitRosterId } from '@warhammer-simulator/core/engine/armyUnits';
import { attachedUnitComponents } from '@warhammer-simulator/core/engine/attachedUnits';
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
  const modelHighlights = normalizePlaySelectionParts({
    side: selection.side,
    parts: selection.modelHighlights ?? [],
  }).flatMap(part => {
    if (part.side !== primary.side || !allowedUnitIds.has(part.unitId)) return [];
    const unit = state.units.find(candidate =>
      candidate.id === part.unitId && candidate.side === part.side && !candidate.destroyed,
    );
    if (!unit) return [];
    const modelIndices = part.modelIndices.filter(modelIndex => modelIndex >= 0 && modelIndex < unit.modelPositions.length);
    return modelIndices.length ? [{ unitId: unit.id, side: unit.side, modelIndices }] : [];
  });

  // An attached Leader is not a separately selectable unit. Normal board
  // selection always expands to the complete attached unit and uses the
  // bodyguard-first representative as its stable action identity. Rules that
  // explicitly target a Leader bypass board selection and use typed targets.
  if (allowedUnitIds.size > 1) {
    const representative = attachedBattleUnitRepresentativeForSelection(state, primary.unitId);
    const groupParts = [...allowedUnitIds]
      .map(unitId => state.units.find(unit => unit.id === unitId && unit.side === primary.side && !unit.destroyed))
      .filter((unit): unit is BattleUnit => !!unit)
      .map(unit => ({
        unitId: unit.id,
        side: unit.side,
        modelIndices: unit.modelPositions.map((_, modelIndex) => modelIndex),
      }));
    const representativeIndex = groupParts.findIndex(part => part.unitId === representative?.id);
    if (representativeIndex > 0) {
      const [representativePart] = groupParts.splice(representativeIndex, 1);
      groupParts.unshift(representativePart);
    }
    return groupParts.length ? {
      side: primary.side,
      parts: groupParts,
      ...(modelHighlights.length ? { modelHighlights } : {}),
    } : null;
  }

  const parts = rawParts.flatMap(part => {
    if (part.side !== primary.side || !allowedUnitIds.has(part.unitId)) return [];
    const unit = state.units.find(candidate =>
      candidate.id === part.unitId && candidate.side === part.side && !candidate.destroyed,
    );
    if (!unit) return [];
    const modelIndices = part.modelIndices.filter(modelIndex => modelIndex >= 0 && modelIndex < unit.modelPositions.length);
    return modelIndices.length ? [{ unitId: unit.id, side: unit.side, modelIndices }] : [];
  });

  return parts.length ? {
    side: primary.side,
    parts,
    ...(modelHighlights.length ? { modelHighlights } : {}),
  } : null;
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

  // Battle deployment stores the authoritative attachment relationship on the
  // BattleUnit (`attachedToUnitId`/`tabletopUnitId`). Use that relationship
  // rather than reconstructing it from roster profiles: imported profiles can
  // be normalized or cloned without carrying the original leader metadata.
  return attachedUnitComponents(state, selected).map(unit => unit.id);
}

/** Returns the bodyguard-first representative used for unit-level targets. */
export function attachedBattleUnitRepresentativeForSelection(
  state: BattleState | null,
  unitId: string | null,
): BattleUnit | null {
  if (!state || !unitId) return null;
  const selected = state.units.find(unit => unit.id === unitId && !unit.destroyed);
  if (!selected) return null;
  const components = attachedUnitComponents(state, selected);
  return components.find(unit => !unit.attachedToUnitId) ?? components[0] ?? selected;
}

export function battleUnitForProfile(state: BattleState | null, side: 0 | 1, profile: UnitProfile) {
  const rosterId = unitRosterId(profile);
  return state?.units.find(candidate =>
    candidate.side === side
    && !candidate.destroyed
    && unitRosterId(candidate.profile) === rosterId,
  );
}
