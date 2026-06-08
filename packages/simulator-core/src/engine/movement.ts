import type { BattleUnit } from '../types/battle';
import type { RulesEdition } from './rulesEngine';
import { rollExpression } from './dice';

export interface AdvanceAllowance {
  baseMove: number;
  advanceRoll: number;
  advanceModifier: number;
  total: number;
}

export function normalMoveAllowance(unit: BattleUnit): number {
  const modifier = unit.profile.movementOverrides?.moveModifier ?? 0;
  return Math.max(0, unit.profile.move + modifier);
}

export function advanceAllowance(unit: BattleUnit, rules: RulesEdition): AdvanceAllowance {
  const baseMove = normalMoveAllowance(unit);
  const override = unit.profile.movementOverrides;
  const advanceRoll = override?.advanceRoll === 'auto6'
    ? 6
    : rollExpression(override?.advanceRoll ?? rules.advanceBonus()).total;
  const advanceModifier = override?.advanceModifier ?? 0;
  return {
    baseMove,
    advanceRoll,
    advanceModifier,
    total: Math.max(0, baseMove + advanceRoll + advanceModifier),
  };
}
