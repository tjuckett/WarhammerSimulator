import type { ShootingWeaponResult } from '../types/battle';

/** Options shared by every combat attack path before it reaches damage application. */
export interface CombatAttackResolutionOptions {
  deferCasualties?: boolean;
  snapShooting?: boolean;
  attackCountOverride?: number;
  selectedTargetCount?: number;
  modelIndexes?: number[];
  result?: ShootingWeaponResult;
}
