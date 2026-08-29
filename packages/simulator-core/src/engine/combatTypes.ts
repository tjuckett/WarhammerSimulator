import type {
  ShootingHitCalculation,
  ShootingHitModifier,
  ShootingHitPreview,
  ShootingHitPreviewGroup,
  ShootingWeaponResult,
} from '../types/battle';

export type ShootingCoverStatus = ShootingHitPreview['coverStatus'];

/** A modifier to the number required on a hit roll. Positive values worsen it. */
export type CombatHitModifier = ShootingHitModifier;

/** The rule-owned hit-roll calculation used by both previews and resolution. */
export type CombatHitCalculation = ShootingHitCalculation;

export type CombatHitPreviewGroup = ShootingHitPreviewGroup;

/** Pre-roll information for one weapon/target declaration. */
export type CombatHitPreview = ShootingHitPreview;

/** Options shared by every combat attack path before it reaches damage application. */
export interface CombatAttackResolutionOptions {
  deferCasualties?: boolean;
  snapShooting?: boolean;
  attackCountOverride?: number;
  selectedTargetCount?: number;
  modelIndexes?: number[];
  result?: ShootingWeaponResult;
}
