import type { UnitProfile } from '../types/army';
import type { BattleUnit, Position } from '../types/battle';

/** Shared model-formation and casualty bookkeeping used by every phase. */
export function centroid(positions: Position[]): Position {
  if (!positions.length) return { x: 0, y: 0 };
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
    z: positions.reduce((sum, position) => sum + (position.z ?? 0), 0) / positions.length,
  };
}

export function formationExtent(
  positions: Position[],
  center: Position,
  direction: { x: number; y: number },
): number {
  return positions.reduce((maximum, position) => {
    const projection = (position.x - center.x) * direction.x + (position.y - center.y) * direction.y;
    return Math.max(maximum, projection);
  }, 0);
}

export function translateFormation(
  unit: { position: Position; modelPositions: Position[] },
  dx: number,
  dy: number,
): void {
  unit.modelPositions = unit.modelPositions.map(position => ({ ...position, x: position.x + dx, y: position.y + dy }));
  unit.position = { ...unit.position, x: unit.position.x + dx, y: unit.position.y + dy };
}

function trimFormation(unit: Pick<BattleUnit, 'position' | 'modelPositions' | 'modelRosterIndexes' | 'modelRotations' | 'remainingModels'>): void {
  if (unit.modelPositions.length > unit.remainingModels) {
    unit.modelPositions = unit.modelPositions.slice(0, unit.remainingModels);
    unit.modelRotations = unit.modelRotations?.slice(0, unit.remainingModels);
    unit.modelRosterIndexes = unit.modelRosterIndexes?.slice(0, unit.remainingModels);
  }
  if (unit.modelPositions.length > 0) unit.position = centroid(unit.modelPositions);
}

export function trimUnitModelState(unit: BattleUnit): void {
  trimFormation(unit);
  unit.movementAllowanceRemainingByModel = unit.movementAllowanceRemainingByModel?.slice(0, unit.remainingModels);
  unit.movementAllowanceTotalByModel = unit.movementAllowanceTotalByModel?.slice(0, unit.remainingModels);
  unit.movementStartPositionsByModel = unit.movementStartPositionsByModel?.slice(0, unit.remainingModels);
  unit.movementStartRotationsByModel = unit.movementStartRotationsByModel?.slice(0, unit.remainingModels);
  if (unit.woundedModelIndex !== undefined && unit.woundedModelIndex >= unit.remainingModels) {
    unit.woundedModelIndex = undefined;
    unit.woundsOnLeadModel = unit.remainingModels > 0 ? unit.profile.wounds : 0;
  }
}

/** Removes model indices in descending order from all model-indexed state. */
export function spliceModelIndices(unit: BattleUnit, sortedDescendingIndices: number[]): void {
  for (const modelIndex of sortedDescendingIndices) {
    if (unit.woundedModelIndex !== undefined) {
      if (unit.woundedModelIndex === modelIndex) {
        unit.woundedModelIndex = undefined;
        unit.woundsOnLeadModel = unit.profile.wounds;
      } else if (unit.woundedModelIndex > modelIndex) {
        unit.woundedModelIndex -= 1;
      }
    }
    unit.modelPositions.splice(modelIndex, 1);
    unit.modelRosterIndexes?.splice(modelIndex, 1);
    unit.modelRotations?.splice(modelIndex, 1);
    unit.movementAllowanceRemainingByModel?.splice(modelIndex, 1);
    unit.movementAllowanceTotalByModel?.splice(modelIndex, 1);
    unit.movementStartPositionsByModel?.splice(modelIndex, 1);
    unit.movementStartRotationsByModel?.splice(modelIndex, 1);
  }
}

export function modelWeaponLoadout(profile: UnitProfile, modelIndex: number): number[] {
  const configured = profile.modelWeaponLoadouts?.[modelIndex];
  if (configured?.length) {
    return configured.filter(weaponIndex => weaponIndex >= 0 && weaponIndex < profile.weapons.length);
  }
  return profile.weapons.map((_, weaponIndex) => weaponIndex);
}

export function rememberDestroyedPositions(unit: BattleUnit): void {
  if (unit.lastDestroyedPosition || unit.lastDestroyedModelPositions) return;
  unit.lastDestroyedPosition = { ...unit.position };
  unit.lastDestroyedModelPositions = unit.modelPositions.map(position => ({ ...position }));
}

export function markUnitDestroyed(unit: BattleUnit): void {
  rememberDestroyedPositions(unit);
  unit.destroyed = true;
}
