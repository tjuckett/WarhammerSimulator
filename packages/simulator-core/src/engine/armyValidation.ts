import { UNIT_DEPLOYMENT_MODE, type ArmyCatalog, type ArmyCatalogUnit, type ImportedArmy, type UnitProfile } from '../types/army';
import { unitRosterId } from './armyUnits';

export type ArmyValidationSeverity = 'error' | 'warning';

export interface ArmyValidationIssue {
  severity: ArmyValidationSeverity;
  code: string;
  message: string;
  unitIndex?: number;
}

export interface ArmyValidationResult {
  valid: boolean;
  errors: ArmyValidationIssue[];
  warnings: ArmyValidationIssue[];
}

export interface ArmyValidationOptions {
  catalog?: ArmyCatalog;
  battleSizeId?: string;
}

const DEPLOYMENT_MODES = new Set<string>(Object.values(UNIT_DEPLOYMENT_MODE));

function issue(
  severity: ArmyValidationSeverity,
  code: string,
  message: string,
  unitIndex?: number,
): ArmyValidationIssue {
  return { severity, code, message, ...(unitIndex === undefined ? {} : { unitIndex }) };
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function referencedUnit(army: ImportedArmy, reference: string): UnitProfile | undefined {
  return army.units.find(unit => unitRosterId(unit) === reference || unit.name === reference);
}

function catalogUnitFor(unit: UnitProfile, catalog: ArmyCatalog): ArmyCatalogUnit | undefined {
  const rosterId = unitRosterId(unit);
  return catalog.units.find(candidate => candidate.id === rosterId || candidate.names?.includes(unit.name));
}

function pointsForCatalogUnit(unit: UnitProfile, catalogUnit: ArmyCatalogUnit): number | null {
  const points = catalogUnit.modelCountPoints?.[String(unit.baseModelCount)];
  return points === undefined || !Number.isFinite(points) || points < 0 ? null : points;
}

/**
 * Checks portable roster structure only. Points, faction limits, battle size,
 * and official army-construction rules require an external catalog/source.
 */
export function validateImportedArmy(army: ImportedArmy, options: ArmyValidationOptions = {}): ArmyValidationResult {
  const errors: ArmyValidationIssue[] = [];
  const warnings: ArmyValidationIssue[] = [];
  const explicitRosterIds = new Map<string, number>();

  const catalog = options.catalog;
  const catalogUnitCounts = new Map<string, number>();
  let catalogPoints = 0;

  if (!army.name.trim()) warnings.push(issue('warning', 'army-name-missing', 'Army name is empty.'));
  if (!army.faction.trim()) warnings.push(issue('warning', 'army-faction-missing', 'Army faction is empty.'));
  if (army.units.length === 0) warnings.push(issue('warning', 'army-empty', 'Army has no units.'));

  army.units.forEach((unit, index) => {
    const label = unit.name.trim() || `Unit ${index + 1}`;

    if (catalog) {
      if (army.faction.trim().toLowerCase() !== catalog.faction.trim().toLowerCase()) {
        if (index === 0) errors.push(issue('error', 'catalog-faction-mismatch', `Army faction "${army.faction}" does not match catalog faction "${catalog.faction}".`));
      } else {
        const catalogUnit = catalogUnitFor(unit, catalog);
        if (!catalogUnit) {
          errors.push(issue('error', 'catalog-unit-unknown', `${label} is not present in catalog ${catalog.id}.`, index));
        } else {
          const count = (catalogUnitCounts.get(catalogUnit.id) ?? 0) + 1;
          catalogUnitCounts.set(catalogUnit.id, count);
          if (catalogUnit.maximumCopies !== undefined && count > catalogUnit.maximumCopies) {
            errors.push(issue('error', 'catalog-unit-limit', `${label} exceeds the catalog limit of ${catalogUnit.maximumCopies} copy/copies.`, index));
          }
          if (catalogUnit.minimumModels !== undefined && unit.baseModelCount < catalogUnit.minimumModels) {
            errors.push(issue('error', 'catalog-model-count-low', `${label} requires at least ${catalogUnit.minimumModels} models in catalog ${catalog.id}.`, index));
          }
          if (catalogUnit.maximumModels !== undefined && unit.baseModelCount > catalogUnit.maximumModels) {
            errors.push(issue('error', 'catalog-model-count-high', `${label} allows at most ${catalogUnit.maximumModels} models in catalog ${catalog.id}.`, index));
          }
          const points = pointsForCatalogUnit(unit, catalogUnit);
          if (points === null && catalogUnit.modelCountPoints) {
            errors.push(issue('error', 'catalog-points-missing', `${label} has no catalog points entry for ${unit.baseModelCount} models.`, index));
          } else if (points !== null) {
            catalogPoints += points;
          }
        }
      }
    }
    if (!unit.name.trim()) errors.push(issue('error', 'unit-name-missing', `${label} has no name.`, index));
    if (!Number.isInteger(unit.baseModelCount) || unit.baseModelCount < 1) {
      errors.push(issue('error', 'model-count-invalid', `${label} must contain at least one model.`, index));
    }
    if (unit.transportCapacity !== undefined
      && (!Number.isInteger(unit.transportCapacity) || unit.transportCapacity < 1)) {
      errors.push(issue('error', 'transport-capacity-invalid', `${label} has an invalid transport capacity.`, index));
    }
    if (unit.modelWeaponLoadouts && !Array.isArray(unit.modelWeaponLoadouts)) {
      errors.push(issue('error', 'model-loadout-shape-invalid', `${label} has an invalid model weapon loadout shape.`, index));
    } else if (unit.modelWeaponLoadouts) {
      if (unit.modelWeaponLoadouts.length > unit.baseModelCount) {
        errors.push(issue('error', 'model-loadout-count-invalid', `${label} has more weapon loadouts than models.`, index));
      }
      unit.modelWeaponLoadouts.forEach((loadout, modelIndex) => {
        if (!Array.isArray(loadout)) {
          errors.push(issue('error', 'model-loadout-shape-invalid', `${label} model ${modelIndex + 1} has an invalid weapon loadout shape.`, index));
          return;
        }
        const seenWeapons = new Set<number>();
        loadout.forEach(weaponIndex => {
          if (!Number.isInteger(weaponIndex) || weaponIndex < 0 || weaponIndex >= unit.weapons.length) {
            errors.push(issue('error', 'model-loadout-weapon-invalid', `${label} model ${modelIndex + 1} references an invalid weapon index.`, index));
          } else if (seenWeapons.has(weaponIndex)) {
            errors.push(issue('error', 'model-loadout-weapon-duplicate', `${label} model ${modelIndex + 1} references the same weapon more than once.`, index));
          }
          seenWeapons.add(weaponIndex);
        });
      });
    }
    if (unit.modelProfiles !== undefined && !Array.isArray(unit.modelProfiles)) {
      errors.push(issue('error', 'model-profile-shape-invalid', `${label} has an invalid model stat profile shape.`, index));
    } else {
      unit.modelProfiles?.forEach((profile, profileIndex) => {
        const profileLabel = `${label} model profile ${profileIndex + 1}`;
        if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) {
          errors.push(issue('error', 'model-profile-name-invalid', `${profileLabel} has no name.`, index));
        }
        if (!Number.isInteger(profile?.count) || profile.count < 1) {
          errors.push(issue('error', 'model-profile-count-invalid', `${profileLabel} must contain at least one model.`, index));
        }
        for (const [characteristic, value] of [
          ['Move', profile?.move],
          ['Toughness', profile?.toughness],
          ['Save', profile?.save],
          ['Wounds', profile?.wounds],
          ['Leadership', profile?.leadership],
          ['Objective Control', profile?.oc],
        ] as const) {
          if (!finitePositive(value)) {
            errors.push(issue('error', 'model-profile-stat-invalid', `${profileLabel} has an invalid ${characteristic} characteristic.`, index));
          }
        }
      });
    }
    for (const [characteristic, value] of [
      ['Move', unit.move],
      ['Toughness', unit.toughness],
      ['Save', unit.save],
      ['Wounds', unit.wounds],
      ['Leadership', unit.leadership],
      ['Objective Control', unit.oc],
    ] as const) {
      if (!finitePositive(value)) errors.push(issue('error', 'stat-invalid', `${label} has an invalid ${characteristic} characteristic.`, index));
    }

    if (unit.rosterId) {
      const previousIndex = explicitRosterIds.get(unit.rosterId);
      if (previousIndex !== undefined) {
        errors.push(issue('error', 'roster-id-duplicate', `${label} reuses roster ID "${unit.rosterId}" from unit ${previousIndex + 1}.`, index));
      } else {
        explicitRosterIds.set(unit.rosterId, index);
      }
    }

    const deployment = unit.deployment;
    if (deployment && !DEPLOYMENT_MODES.has(deployment.mode)) {
      errors.push(issue('error', 'deployment-mode-invalid', `${label} uses an unsupported deployment mode.`, index));
    }
    if (deployment?.mode === UNIT_DEPLOYMENT_MODE.Transport) {
      if (!deployment.transportUnitId && !deployment.transportName) {
        errors.push(issue('error', 'transport-target-missing', `${label} is assigned to a transport but has no transport target.`, index));
      } else {
        const target = referencedUnit(army, deployment.transportUnitId ?? deployment.transportName ?? '');
        if (!target) {
          errors.push(issue('error', 'transport-target-invalid', `${label} references a transport that is not in this army.`, index));
        } else if (target === unit) {
          errors.push(issue('error', 'transport-self-reference', `${label} cannot transport itself.`, index));
        } else if (!target.transportCapacity) {
          errors.push(issue('error', 'transport-target-not-transport', `${label} references ${target.name}, which has no transport capacity.`, index));
        }
      }
    }

    const leaderTarget = unit.leaderAttachment?.attachedToUnitId ?? unit.leaderAttachment?.attachedToName;
    if (leaderTarget) {
      const target = referencedUnit(army, leaderTarget);
      if (!target) errors.push(issue('error', 'leader-target-invalid', `${label} references an attached unit that is not in this army.`, index));
      if (target === unit) errors.push(issue('error', 'leader-self-reference', `${label} cannot attach to itself.`, index));
    }
  });

  if (catalog && options.battleSizeId) {
    const battleSize = catalog.battleSizes?.find(candidate => candidate.id === options.battleSizeId);
    if (!battleSize) {
      errors.push(issue('error', 'catalog-battle-size-unknown', `Battle size "${options.battleSizeId}" is not present in catalog ${catalog.id}.`));
    } else {
      if (battleSize.minimumPoints !== undefined && catalogPoints < battleSize.minimumPoints) {
        errors.push(issue('error', 'catalog-points-low', `Army has ${catalogPoints} catalog points but requires at least ${battleSize.minimumPoints}.`));
      }
      if (battleSize.maximumPoints !== undefined && catalogPoints > battleSize.maximumPoints) {
        errors.push(issue('error', 'catalog-points-high', `Army has ${catalogPoints} catalog points but allows at most ${battleSize.maximumPoints}.`));
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
