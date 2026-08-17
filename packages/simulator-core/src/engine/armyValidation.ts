import { UNIT_DEPLOYMENT_MODE, type ImportedArmy, type UnitProfile } from '../types/army';
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

/**
 * Checks portable roster structure only. Points, faction limits, battle size,
 * and official army-construction rules require an external catalog/source.
 */
export function validateImportedArmy(army: ImportedArmy): ArmyValidationResult {
  const errors: ArmyValidationIssue[] = [];
  const warnings: ArmyValidationIssue[] = [];
  const explicitRosterIds = new Map<string, number>();

  if (!army.name.trim()) warnings.push(issue('warning', 'army-name-missing', 'Army name is empty.'));
  if (!army.faction.trim()) warnings.push(issue('warning', 'army-faction-missing', 'Army faction is empty.'));
  if (army.units.length === 0) warnings.push(issue('warning', 'army-empty', 'Army has no units.'));

  army.units.forEach((unit, index) => {
    const label = unit.name.trim() || `Unit ${index + 1}`;
    if (!unit.name.trim()) errors.push(issue('error', 'unit-name-missing', `${label} has no name.`, index));
    if (!Number.isInteger(unit.baseModelCount) || unit.baseModelCount < 1) {
      errors.push(issue('error', 'model-count-invalid', `${label} must contain at least one model.`, index));
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

  return { valid: errors.length === 0, errors, warnings };
}
