import type { UnitLoadoutOption, UnitProfile } from '../types/army';

function modelCountOptions(unit: UnitProfile): UnitLoadoutOption[] {
  const range = unit.modelCountRange;
  if (!range?.maximum || range.maximum < range.minimum) return [];
  const minimum = Math.max(1, range.minimum);
  const step = Math.max(1, range.step ?? 1);
  const options: UnitLoadoutOption[] = [];
  for (let count = minimum; count <= range.maximum; count += step) {
    options.push({
      id: `model-count-${count}`,
      label: `${count}`,
      modelCount: count,
    });
  }
  return options;
}

/** Returns the catalog-defined unit configurations, or ordinary size brackets when no loadouts exist. */
export function unitLoadoutOptions(unit: UnitProfile): UnitLoadoutOption[] {
  if (unit.unitLoadoutOptions?.length) return unit.unitLoadoutOptions;
  return modelCountOptions(unit);
}

function arraysEqual<T>(left: T[] | undefined, right: T[] | undefined): boolean {
  return !!left && !!right && left.length === right.length && left.every((value, index) => value === right[index]);
}

function nestedArraysEqual<T extends number | string>(left: T[][] | undefined, right: T[][] | undefined): boolean {
  return !!left && !!right && left.length === right.length && left.every((values, index) => arraysEqual(values, right[index]));
}

/** Finds the catalog configuration represented by the current typed unit state. */
export function selectedUnitLoadoutOption(
  unit: UnitProfile,
  options = unitLoadoutOptions(unit),
): UnitLoadoutOption | undefined {
  return options.find(option => {
    if (option.modelCount !== unit.baseModelCount) return false;
    if (option.modelWeaponLoadouts && !nestedArraysEqual(option.modelWeaponLoadouts, unit.modelWeaponLoadouts)) return false;
    if (option.modelWargearChoices && !nestedArraysEqual(option.modelWargearChoices, unit.modelWargearChoices)) return false;
    if (option.selectedWargear && !arraysEqual(option.selectedWargear, unit.selectedWargear)) return false;
    return true;
  }) ?? options.find(option => option.modelCount === unit.baseModelCount);
}

function resizeModelWeaponLoadouts(values: number[][] | undefined, count: number): number[][] | undefined {
  if (!values?.length) return undefined;
  return Array.from({ length: count }, (_, index) => [...values[Math.min(index, values.length - 1)]]);
}

function resizeModelWargearChoices(values: string[][] | undefined, count: number): string[][] | undefined {
  if (!values?.length) return undefined;
  return Array.from({ length: count }, (_, index) => [...(values[index] ?? [])]);
}

/** Applies a catalog configuration without making the roster UI interpret its legality. */
export function applyUnitLoadoutOption(unit: UnitProfile, option: UnitLoadoutOption): UnitProfile {
  return {
    ...unit,
    baseModelCount: option.modelCount,
    modelWeaponLoadouts: option.modelWeaponLoadouts
      ? resizeModelWeaponLoadouts(option.modelWeaponLoadouts, option.modelCount)
      : resizeModelWeaponLoadouts(unit.modelWeaponLoadouts, option.modelCount),
    modelWargearChoices: option.modelWargearChoices
      ? resizeModelWargearChoices(option.modelWargearChoices, option.modelCount)
      : resizeModelWargearChoices(unit.modelWargearChoices, option.modelCount),
    selectedWargear: option.selectedWargear === undefined
      ? unit.selectedWargear
      : [...option.selectedWargear],
  };
}
