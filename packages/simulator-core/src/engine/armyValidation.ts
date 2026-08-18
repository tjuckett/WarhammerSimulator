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
const RULE_TAGS = new Set(['Aura', 'Psychic']);
const RULE_CATEGORIES = new Set(['datasheet', 'faction', 'wargear']);
const GENERATION_STRATEGIES = new Set(['balanced', 'aggressive', 'objective']);

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
  return Array.isArray(army.units)
    ? army.units.find(unit => unit && (unitRosterId(unit) === reference || unit.name === reference))
    : undefined;
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
  const armyFaction = typeof army?.faction === 'string' ? army.faction : '';

  const rawCatalog = options?.catalog;
  let catalog: ArmyCatalog | undefined = rawCatalog;
  let catalogShapeValid = true;
  const battleSizeId = typeof options?.battleSizeId === 'string' && options.battleSizeId.trim()
    ? options.battleSizeId.trim()
    : undefined;
  if (options?.battleSizeId !== undefined && !battleSizeId) {
    errors.push(issue('error', 'catalog-battle-size-option-invalid', 'Battle size ID must be a non-empty string.'));
  }
  if (rawCatalog !== undefined) {
    if (!rawCatalog || typeof rawCatalog !== 'object' || Array.isArray(rawCatalog)) {
      errors.push(issue('error', 'catalog-shape-invalid', 'Army catalog has an invalid shape.'));
      catalogShapeValid = false;
    } else {
      if (typeof rawCatalog.id !== 'string' || !rawCatalog.id.trim()) {
        errors.push(issue('error', 'catalog-id-invalid', 'Army catalog needs a non-empty ID.'));
        catalogShapeValid = false;
      }
      if (typeof rawCatalog.faction !== 'string' || !rawCatalog.faction.trim()) {
        errors.push(issue('error', 'catalog-faction-invalid', 'Army catalog needs a non-empty faction.'));
        catalogShapeValid = false;
      }
      if (armyFaction.trim()
        && typeof rawCatalog.faction === 'string'
        && rawCatalog.faction.trim()
        && armyFaction.trim().toLowerCase() !== rawCatalog.faction.trim().toLowerCase()) {
        errors.push(issue('error', 'catalog-faction-mismatch', `Army faction "${armyFaction}" does not match catalog faction "${rawCatalog.faction}".`));
      }
      if (!Array.isArray(rawCatalog.units)) {
        errors.push(issue('error', 'catalog-unit-list-invalid', 'Army catalog units must be an array.'));
        catalogShapeValid = false;
      } else {
        const catalogUnitIds = new Set<string>();
        rawCatalog.units.forEach((catalogUnit, catalogUnitIndex) => {
          if (!catalogUnit || typeof catalogUnit !== 'object' || Array.isArray(catalogUnit)
            || typeof catalogUnit.id !== 'string' || !catalogUnit.id.trim()) {
            errors.push(issue('error', 'catalog-unit-shape-invalid', `Catalog unit ${catalogUnitIndex + 1} has an invalid shape.`));
            catalogShapeValid = false;
            return;
          }
          if (catalogUnitIds.has(catalogUnit.id)) {
            errors.push(issue('error', 'catalog-unit-id-duplicate', `Catalog unit ID "${catalogUnit.id}" is duplicated.`));
            catalogShapeValid = false;
          }
          catalogUnitIds.add(catalogUnit.id);
          if (catalogUnit.names !== undefined
            && (!Array.isArray(catalogUnit.names)
              || catalogUnit.names.some(name => typeof name !== 'string' || !name.trim()))) {
            errors.push(issue('error', 'catalog-unit-names-invalid', `Catalog unit ${catalogUnit.id} has invalid names.`));
            catalogShapeValid = false;
          }
          if (catalogUnit.modelCountPoints !== undefined
            && (!catalogUnit.modelCountPoints || typeof catalogUnit.modelCountPoints !== 'object'
              || Array.isArray(catalogUnit.modelCountPoints)
              || Object.values(catalogUnit.modelCountPoints).some(points => typeof points !== 'number' || !Number.isFinite(points) || points < 0))) {
            errors.push(issue('error', 'catalog-points-shape-invalid', `Catalog unit ${catalogUnit.id} has invalid points data.`));
            catalogShapeValid = false;
          }
          if (catalogUnit.modelCountPoints && typeof catalogUnit.modelCountPoints === 'object'
            && !Array.isArray(catalogUnit.modelCountPoints)) {
            const invalidModelCountKey = Object.keys(catalogUnit.modelCountPoints)
              .find(modelCount => !/^[1-9]\d*$/.test(modelCount));
            if (invalidModelCountKey) {
              errors.push(issue('error', 'catalog-model-count-key-invalid', `Catalog unit ${catalogUnit.id} has an invalid model-count points key.`));
              catalogShapeValid = false;
            }
          }
          for (const [field, value] of [
            ['minimumModels', catalogUnit.minimumModels],
            ['maximumModels', catalogUnit.maximumModels],
            ['maximumCopies', catalogUnit.maximumCopies],
          ] as const) {
            if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
              errors.push(issue('error', 'catalog-constraint-invalid', `Catalog unit ${catalogUnit.id} has an invalid ${field}.`));
              catalogShapeValid = false;
            }
          }
          if (catalogUnit.minimumModels !== undefined && catalogUnit.maximumModels !== undefined
            && catalogUnit.minimumModels > catalogUnit.maximumModels) {
            errors.push(issue('error', 'catalog-model-range-invalid', `Catalog unit ${catalogUnit.id} has a reversed model range.`));
            catalogShapeValid = false;
          }
        });
      }
      if (rawCatalog.battleSizes !== undefined && !Array.isArray(rawCatalog.battleSizes)) {
        errors.push(issue('error', 'catalog-battle-size-list-invalid', 'Catalog battle sizes must be an array.'));
        catalogShapeValid = false;
      } else {
        const battleSizeIds = new Set<string>();
        rawCatalog.battleSizes?.forEach((battleSize, battleSizeIndex) => {
          if (!battleSize || typeof battleSize !== 'object' || Array.isArray(battleSize)
            || typeof battleSize.id !== 'string' || !battleSize.id.trim()
            || typeof battleSize.label !== 'string' || !battleSize.label.trim()) {
            errors.push(issue('error', 'catalog-battle-size-invalid', `Catalog battle size ${battleSizeIndex + 1} has invalid identity fields.`));
            catalogShapeValid = false;
            return;
          }
          if (battleSizeIds.has(battleSize.id)) {
            errors.push(issue('error', 'catalog-battle-size-id-duplicate', `Catalog battle size ID "${battleSize.id}" is duplicated.`));
            catalogShapeValid = false;
          }
          battleSizeIds.add(battleSize.id);
          if (battleSize.minimumPoints !== undefined
            && (typeof battleSize.minimumPoints !== 'number' || !Number.isFinite(battleSize.minimumPoints) || battleSize.minimumPoints < 0)
            || battleSize.maximumPoints !== undefined
            && (typeof battleSize.maximumPoints !== 'number' || !Number.isFinite(battleSize.maximumPoints) || battleSize.maximumPoints < 0)) {
            errors.push(issue('error', 'catalog-battle-size-points-invalid', `Catalog battle size ${battleSize.id} has invalid points limits.`));
            catalogShapeValid = false;
          }
          if (battleSize.minimumPoints !== undefined && battleSize.maximumPoints !== undefined
            && battleSize.minimumPoints > battleSize.maximumPoints) {
            errors.push(issue('error', 'catalog-battle-size-range-invalid', `Catalog battle size ${battleSize.id} has reversed points limits.`));
            catalogShapeValid = false;
          }
        });
      }
    }
    if (!catalogShapeValid) catalog = undefined;
  }
  const catalogUnitCounts = new Map<string, number>();
  let catalogPoints = 0;
  const armyName = typeof army?.name === 'string' ? army.name : '';
  const units = Array.isArray(army?.units) ? army.units : [];

  if (typeof army?.name !== 'string') errors.push(issue('error', 'army-name-invalid', 'Army name must be a string.'));
  else if (!armyName.trim()) warnings.push(issue('warning', 'army-name-missing', 'Army name is empty.'));
  if (typeof army?.faction !== 'string') errors.push(issue('error', 'army-faction-invalid', 'Army faction must be a string.'));
  else if (!armyFaction.trim()) warnings.push(issue('warning', 'army-faction-missing', 'Army faction is empty.'));
  if (!Array.isArray(army?.units)) errors.push(issue('error', 'unit-list-shape-invalid', 'Army units must be an array.'));
  else if (units.length === 0) warnings.push(issue('warning', 'army-empty', 'Army has no units.'));

  const generation = army?.generation;
  if (generation !== undefined && (!generation || typeof generation !== 'object' || Array.isArray(generation))) {
    errors.push(issue('error', 'generation-shape-invalid', 'Army generation metadata has an invalid shape.'));
  } else if (generation) {
    if (typeof generation.strategy !== 'string' || !GENERATION_STRATEGIES.has(generation.strategy)) {
      errors.push(issue('error', 'generation-strategy-invalid', 'Army generation metadata has an invalid strategy.'));
    }
    if (typeof generation.sourceArmyName !== 'string' || !generation.sourceArmyName.trim()) {
      errors.push(issue('error', 'generation-source-invalid', 'Army generation metadata has an invalid source army name.'));
    }
    if (typeof generation.explanation !== 'string') {
      errors.push(issue('error', 'generation-explanation-invalid', 'Army generation metadata has an invalid explanation.'));
    }
    if (typeof generation.heuristicScore !== 'number' || !Number.isFinite(generation.heuristicScore)) {
      errors.push(issue('error', 'generation-score-invalid', 'Army generation metadata has an invalid heuristic score.'));
    }
    if (generation.scenarioId !== undefined
      && (typeof generation.scenarioId !== 'string' || !generation.scenarioId.trim())) {
      errors.push(issue('error', 'generation-scenario-invalid', 'Army generation metadata has an invalid scenario ID.'));
    }
    if (generation.scenarioEvaluations !== undefined && !Array.isArray(generation.scenarioEvaluations)) {
      errors.push(issue('error', 'generation-evaluations-shape-invalid', 'Army generation evaluations must be an array.'));
    } else {
      generation.scenarioEvaluations?.forEach((evaluation, evaluationIndex) => {
        const evaluationLabel = `Army generation evaluation ${evaluationIndex + 1}`;
        if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
          errors.push(issue('error', 'generation-evaluation-invalid', `${evaluationLabel} has an invalid shape.`));
          return;
        }
        if (typeof evaluation.scenarioId !== 'string' || !evaluation.scenarioId.trim()
          || typeof evaluation.strategy !== 'string' || !GENERATION_STRATEGIES.has(evaluation.strategy)
          || typeof evaluation.score !== 'number' || !Number.isFinite(evaluation.score)
          || typeof evaluation.explanation !== 'string') {
          errors.push(issue('error', 'generation-evaluation-invalid', `${evaluationLabel} has invalid fields.`));
        }
      });
    }
  }

  units.forEach((unit, index) => {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      errors.push(issue('error', 'unit-shape-invalid', `Unit ${index + 1} has an invalid shape.`, index));
      return;
    }
    const label = typeof unit.name === 'string' && unit.name.trim() ? unit.name.trim() : `Unit ${index + 1}`;
    const weapons = Array.isArray(unit.weapons) ? unit.weapons : [];
    for (const [keywordType, keywords] of [
      ['unit', unit.keywords],
      ['faction', unit.factionKeywords],
    ] as const) {
      if (!Array.isArray(keywords) || keywords.some(keyword => typeof keyword !== 'string' || !keyword.trim())) {
        errors.push(issue('error', 'keyword-list-invalid', `${label} has an invalid ${keywordType} keyword list.`, index));
      }
    }

    if (catalog) {
      if (armyFaction.trim().toLowerCase() === catalog.faction.trim().toLowerCase()) {
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
    if (typeof unit.name !== 'string' || !unit.name.trim()) errors.push(issue('error', 'unit-name-missing', `${label} has no name.`, index));
    if (!Array.isArray(unit.weapons)) {
      errors.push(issue('error', 'weapon-list-shape-invalid', `${label} has an invalid weapon list.`, index));
    } else {
      weapons.forEach((weapon, weaponIndex) => {
        const weaponLabel = `${label} weapon ${weaponIndex + 1}`;
        if (!weapon || typeof weapon.name !== 'string' || !weapon.name.trim()) {
          errors.push(issue('error', 'weapon-name-invalid', `${weaponLabel} has no name.`, index));
        }
        if (weapon?.profileGroup !== undefined
          && (typeof weapon.profileGroup !== 'string' || !weapon.profileGroup.trim())) {
          errors.push(issue('error', 'weapon-profile-group-invalid', `${weaponLabel} has an invalid profile group.`, index));
        }
        if (!Number.isFinite(weapon?.range) || (weapon?.range ?? -1) < 0) {
          errors.push(issue('error', 'weapon-stat-invalid', `${weaponLabel} has an invalid range.`, index));
        }
        if (typeof weapon?.attacks !== 'string' || !weapon.attacks.trim()
          || typeof weapon?.damage !== 'string' || !weapon.damage.trim()) {
          errors.push(issue('error', 'weapon-expression-invalid', `${weaponLabel} has an invalid attacks or damage expression.`, index));
        }
        for (const [characteristic, value] of [
          ['Skill', weapon?.skill],
          ['Strength', weapon?.strength],
          ['AP', weapon?.ap],
        ] as const) {
          if (!Number.isFinite(value)) {
            errors.push(issue('error', 'weapon-stat-invalid', `${weaponLabel} has an invalid ${characteristic} characteristic.`, index));
          }
        }
        if (!Array.isArray(weapon?.keywords)
          || weapon.keywords.some(keyword => typeof keyword !== 'string' || !keyword.trim())) {
          errors.push(issue('error', 'weapon-keywords-invalid', `${weaponLabel} has an invalid keyword list.`, index));
        }
        if (typeof weapon?.isMelee !== 'boolean') {
          errors.push(issue('error', 'weapon-melee-flag-invalid', `${weaponLabel} has an invalid melee flag.`, index));
        }
      });
    }
    const validateRules = (value: unknown, ruleType: string): void => {
      if (!Array.isArray(value)) {
        errors.push(issue('error', 'rule-list-shape-invalid', `${label} has an invalid ${ruleType} rule list.`, index));
        return;
      }
      value.forEach((rule, ruleIndex) => {
        const ruleLabel = `${label} ${ruleType} rule ${ruleIndex + 1}`;
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
          errors.push(issue('error', 'rule-shape-invalid', `${ruleLabel} has an invalid shape.`, index));
          return;
        }
        const candidate = rule as Record<string, unknown>;
        if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
          errors.push(issue('error', 'rule-name-invalid', `${ruleLabel} has no name.`, index));
        }
        if (typeof candidate.description !== 'string') {
          errors.push(issue('error', 'rule-description-invalid', `${ruleLabel} has an invalid description.`, index));
        }
        if (candidate.tags !== undefined
          && (!Array.isArray(candidate.tags)
            || candidate.tags.some(tag => typeof tag !== 'string' || !RULE_TAGS.has(tag)))) {
          errors.push(issue('error', 'rule-tags-invalid', `${ruleLabel} has unsupported tags.`, index));
        }
        if (candidate.category !== undefined
          && (typeof candidate.category !== 'string' || !RULE_CATEGORIES.has(candidate.category))) {
          errors.push(issue('error', 'rule-category-invalid', `${ruleLabel} has an unsupported category.`, index));
        }
        if (candidate.range !== undefined
          && (typeof candidate.range !== 'number' || !finitePositive(candidate.range) && candidate.range !== 0)) {
          errors.push(issue('error', 'rule-range-invalid', `${ruleLabel} has an invalid range.`, index));
        }
        if (candidate.bearerModelIndex !== undefined
          && (typeof candidate.bearerModelIndex !== 'number'
            || !Number.isInteger(candidate.bearerModelIndex)
            || candidate.bearerModelIndex < 0)) {
          errors.push(issue('error', 'rule-bearer-index-invalid', `${ruleLabel} has an invalid bearer model index.`, index));
        }
        if (candidate.appliesAcrossArmyFactions !== undefined
          && typeof candidate.appliesAcrossArmyFactions !== 'boolean') {
          errors.push(issue('error', 'rule-scope-invalid', `${ruleLabel} has an invalid army-faction scope flag.`, index));
        }
      });
    };
    validateRules(unit.abilities, 'ability');
    if (unit.rules !== undefined) validateRules(unit.rules, 'datasheet');
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
          if (!Number.isInteger(weaponIndex) || weaponIndex < 0 || weaponIndex >= weapons.length) {
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
    if (unit.modelBases !== undefined && !Array.isArray(unit.modelBases)) {
      errors.push(issue('error', 'model-base-shape-invalid', `${label} has an invalid model base shape.`, index));
    } else {
      unit.modelBases?.forEach((base, baseIndex) => {
        const baseLabel = `${label} model base ${baseIndex + 1}`;
        if (!base || typeof base.shape !== 'string') {
          errors.push(issue('error', 'model-base-shape-invalid', `${baseLabel} has an invalid shape.`, index));
          return;
        }
        if (base.shape === 'round') {
          if (!finitePositive(base.diameterMm)) {
            errors.push(issue('error', 'model-base-dimension-invalid', `${baseLabel} has an invalid diameter.`, index));
          }
        } else if (base.shape === 'oval' || base.shape === 'hull') {
          if (!finitePositive(base.widthMm) || !finitePositive(base.lengthMm)) {
            errors.push(issue('error', 'model-base-dimension-invalid', `${baseLabel} has invalid dimensions.`, index));
          }
          if (base.shape === 'hull'
            && base.footprint !== undefined
            && !['square', 'rectangle', 'circle'].includes(base.footprint)) {
            errors.push(issue('error', 'model-base-footprint-invalid', `${baseLabel} has an unsupported hull footprint.`, index));
          }
        } else if (base.shape === 'other') {
          if (typeof base.label !== 'string' || !base.label.trim()) {
            errors.push(issue('error', 'model-base-label-invalid', `${baseLabel} needs a label.`, index));
          }
        } else {
          errors.push(issue('error', 'model-base-shape-invalid', `${baseLabel} has an unsupported shape.`, index));
        }
      });
    }
    if (unit.movementOverrides !== undefined
      && (!unit.movementOverrides || typeof unit.movementOverrides !== 'object' || Array.isArray(unit.movementOverrides))) {
      errors.push(issue('error', 'movement-override-shape-invalid', `${label} has an invalid movement override shape.`, index));
    } else if (unit.movementOverrides) {
      const movement = unit.movementOverrides;
      if (movement.moveModifier !== undefined && !Number.isFinite(movement.moveModifier)) {
        errors.push(issue('error', 'movement-override-invalid', `${label} has an invalid Move modifier.`, index));
      }
      if (movement.advanceModifier !== undefined && !Number.isFinite(movement.advanceModifier)) {
        errors.push(issue('error', 'movement-override-invalid', `${label} has an invalid Advance modifier.`, index));
      }
      if (movement.advanceRoll !== undefined
        && (typeof movement.advanceRoll !== 'string' || !movement.advanceRoll.trim())) {
        errors.push(issue('error', 'movement-override-invalid', `${label} has an invalid Advance roll override.`, index));
      }
    }
    if (unit.damagedProfile !== undefined
      && (!unit.damagedProfile || typeof unit.damagedProfile !== 'object' || Array.isArray(unit.damagedProfile))) {
      errors.push(issue('error', 'damaged-profile-shape-invalid', `${label} has an invalid damaged profile shape.`, index));
    } else if (unit.damagedProfile) {
      const damaged = unit.damagedProfile;
      if (!Number.isInteger(damaged.maxRemainingWounds) || damaged.maxRemainingWounds < 1) {
        errors.push(issue('error', 'damaged-profile-invalid', `${label} has an invalid damaged-profile wound threshold.`, index));
      }
      if (damaged.hitRollModifier !== undefined && !Number.isFinite(damaged.hitRollModifier)) {
        errors.push(issue('error', 'damaged-profile-invalid', `${label} has an invalid damaged-profile Hit modifier.`, index));
      }
      if (damaged.objectiveControlModifier !== undefined && !Number.isFinite(damaged.objectiveControlModifier)) {
        errors.push(issue('error', 'damaged-profile-invalid', `${label} has an invalid damaged-profile Objective Control modifier.`, index));
      }
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
    if (unit.invulnSave !== undefined && !finitePositive(unit.invulnSave)) {
      errors.push(issue('error', 'invulnerable-save-invalid', `${label} has an invalid invulnerable save.`, index));
    }

    if (unit.rosterId !== undefined
      && (typeof unit.rosterId !== 'string' || !unit.rosterId.trim())) {
      errors.push(issue('error', 'roster-id-invalid', `${label} has an invalid roster ID.`, index));
    }
    if (typeof unit.rosterId === 'string' && unit.rosterId.trim()) {
      const previousIndex = explicitRosterIds.get(unit.rosterId);
      if (previousIndex !== undefined) {
        errors.push(issue('error', 'roster-id-duplicate', `${label} reuses roster ID "${unit.rosterId}" from unit ${previousIndex + 1}.`, index));
      } else {
        explicitRosterIds.set(unit.rosterId, index);
      }
    }

    const deployment = unit.deployment;
    const deploymentIsObject = deployment !== undefined
      && deployment !== null
      && typeof deployment === 'object'
      && !Array.isArray(deployment);
    if (deployment !== undefined && !deploymentIsObject) {
      errors.push(issue('error', 'deployment-shape-invalid', `${label} has an invalid deployment assignment shape.`, index));
    }
    if (deploymentIsObject && !DEPLOYMENT_MODES.has(deployment.mode)) {
      errors.push(issue('error', 'deployment-mode-invalid', `${label} uses an unsupported deployment mode.`, index));
    }
    if (deploymentIsObject) {
      for (const [field, value] of [
        ['transport unit ID', deployment.transportUnitId],
        ['transport name', deployment.transportName],
      ] as const) {
        if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
          errors.push(issue('error', 'deployment-target-invalid', `${label} has an invalid ${field}.`, index));
        }
      }
      if (deployment.mode !== UNIT_DEPLOYMENT_MODE.Transport
        && (deployment.transportUnitId !== undefined || deployment.transportName !== undefined)) {
        errors.push(issue('error', 'deployment-target-mode-invalid', `${label} has a transport target without transport deployment mode.`, index));
      }
      if (deployment.mode === UNIT_DEPLOYMENT_MODE.Transport
        && deployment.transportUnitId && deployment.transportName) {
        errors.push(issue('error', 'transport-target-ambiguous', `${label} specifies both a transport ID and a transport name.`, index));
      }
    }
    if (deploymentIsObject && deployment.mode === UNIT_DEPLOYMENT_MODE.Transport) {
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

    const attachment = unit.leaderAttachment;
    const attachmentIsObject = attachment !== undefined
      && attachment !== null
      && typeof attachment === 'object'
      && !Array.isArray(attachment);
    if (attachment !== undefined && !attachmentIsObject) {
      errors.push(issue('error', 'leader-attachment-shape-invalid', `${label} has an invalid leader attachment shape.`, index));
    }
    if (attachmentIsObject) {
      for (const [field, value] of [
        ['attached unit ID', attachment.attachedToUnitId],
        ['attached unit name', attachment.attachedToName],
      ] as const) {
        if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
          errors.push(issue('error', 'leader-target-invalid', `${label} has an invalid ${field}.`, index));
        }
      }
      if (attachment.attachedToUnitId && attachment.attachedToName) {
        errors.push(issue('error', 'leader-target-ambiguous', `${label} specifies both an attached unit ID and name.`, index));
      }
    }
    const leaderTarget = attachmentIsObject
      ? attachment.attachedToUnitId ?? attachment.attachedToName
      : undefined;
    if (attachmentIsObject && !leaderTarget) {
      errors.push(issue('error', 'leader-target-missing', `${label} has no attached unit target.`, index));
    }
    if (leaderTarget) {
      const target = referencedUnit(army, leaderTarget);
      if (!target) errors.push(issue('error', 'leader-target-invalid', `${label} references an attached unit that is not in this army.`, index));
      if (target === unit) errors.push(issue('error', 'leader-self-reference', `${label} cannot attach to itself.`, index));
    }
  });

  if (catalog && battleSizeId) {
    const battleSize = catalog.battleSizes?.find(candidate => candidate.id === battleSizeId);
    if (!battleSize) {
      errors.push(issue('error', 'catalog-battle-size-unknown', `Battle size "${battleSizeId}" is not present in catalog ${catalog.id}.`));
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
