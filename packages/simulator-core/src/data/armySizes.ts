import type { ArmyCatalogBattleSize } from '../types/army';

/** Standard point limits available to the army builder when a roster has no catalog-specific list. */
export const STANDARD_BATTLE_SIZES: ArmyCatalogBattleSize[] = [
  { id: 'combat-patrol', label: 'Combat Patrol', maximumPoints: 500 },
  { id: 'incursion', label: 'Incursion', maximumPoints: 1000 },
  { id: 'strike-force', label: 'Strike Force', maximumPoints: 2000 },
  { id: 'onslaught', label: 'Onslaught', maximumPoints: 3000 },
];
