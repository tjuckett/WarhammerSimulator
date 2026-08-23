/**
 * Stable public boundary for deterministic combat math. Resolution orchestration
 * remains in `resolveCombatAttacks`; phases and effects should import shared
 * save, Feel No Pain, and damage math from this module.
 */
export {
  resolveDamageOutcome,
  resolveFeelNoPainOutcome,
  resolveSaveOutcome,
  type DamageResolutionInput,
  type DamageResolutionOutcome,
} from './damageResolution';
