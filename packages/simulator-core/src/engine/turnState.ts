import type { BattleUnit } from '../types/battle';

export interface ActiveTurnResetOptions {
  clearEmergencyDisembarkBattleshock?: boolean;
}

/** Clears state that belongs to a unit's previous player turn. */
export function resetUnitForActiveTurn(unit: BattleUnit, options: ActiveTurnResetOptions = {}): void {
  unit.rangedAttacksMadePreviousTurn = unit.rangedAttacksMadeThisTurn ?? false;
  unit.rangedAttacksMadeThisTurn = false;
  unit.activated = false;
  unit.charged = false;
  unit.piledIn = undefined;
  unit.consolidated = undefined;
  unit.firedWeaponIndices = undefined;
  unit.movementAction = undefined;
  unit.movementAllowanceRemaining = undefined;
  unit.movementAllowanceRemainingByModel = undefined;
  unit.movementAllowanceTotalByModel = undefined;
  unit.movementStartPositionsByModel = undefined;
  unit.movementStartRotationsByModel = undefined;
  unit.movementPathByModel = undefined;
  unit.movementComplete = undefined;
  unit.takingToSkies = undefined;
  unit.arrivedFromReinforcements = undefined;
  unit.rapidIngressThisPhase = undefined;
  unit.heroicInterventionThisPhase = undefined;
  unit.heroicInterventionMode = undefined;
  if (options.clearEmergencyDisembarkBattleshock && unit.emergencyDisembarkedThisTurn) unit.battleshocked = false;
  unit.emergencyDisembarkedThisTurn = undefined;
  unit.combatDisembarkedThisTurn = undefined;
  unit.rapidDisembarkedThisTurn = undefined;
  unit.fellBack = false;
  unit.inCombat = false;
}
