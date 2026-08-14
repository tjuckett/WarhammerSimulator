import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { AbilityTiming, UnitAbilityDefinition } from '@warhammer-simulator/core/types/ability';

export type AbilityOption = {
  ability: UnitAbilityDefinition;
  timing: AbilityTiming;
};

const WOUND_TARGET_COLORS = {
  easy: '#4caf50',
  favorable: '#8bc34a',
  even: '#cddc39',
  difficult: '#ffc107',
  desperate: '#ff5722',
} as const;

const DAMAGE_SPILL_LABELS = {
  noCarryOver: 'no spillover',
  carryOver: 'can spill over',
} as const;

const DICE_INPUT_SEPARATOR = /[,\s]+/;
const COMMAND_REROLL_PENDING_LABEL = 'Command Re-roll pending: choose a roll to reroll.';

const ABILITY_TIMING_LABELS = {
  'command-phase': 'Command',
  'end-of-phase': 'End phase',
  manual: 'Manual',
} satisfies Record<AbilityTiming, string>;

export function calcWoundTarget(s: number, t: number): number {
  if (s >= t * 2) return 2;
  if (s > t) return 3;
  if (s === t) return 4;
  if (s * 2 <= t) return 6;
  return 5;
}

export function calcWoundTargetColor(wt: number): string {
  if (wt <= 2) return WOUND_TARGET_COLORS.easy;
  if (wt === 3) return WOUND_TARGET_COLORS.favorable;
  if (wt === 4) return WOUND_TARGET_COLORS.even;
  if (wt === 5) return WOUND_TARGET_COLORS.difficult;
  return WOUND_TARGET_COLORS.desperate;
}

export function calcEffectiveSave(save: number, ap: number, invuln?: number): number {
  const modified = save + Math.abs(ap);
  return invuln !== undefined ? Math.min(modified, invuln) : modified;
}

export function pendingDamageLabel(unit: BattleUnit | null): string | null {
  const allocation = unit?.pendingDamageAllocations?.[0];
  if (!unit || !allocation) return null;
  const source = allocation.source ? ` from ${allocation.source}` : '';
  const spill = allocation.noCarryOver ? DAMAGE_SPILL_LABELS.noCarryOver : DAMAGE_SPILL_LABELS.carryOver;
  const remaining = unit.pendingDamageAllocations?.length ?? 0;
  return `${allocation.damage} damage${source} (${spill})${remaining > 1 ? `, ${remaining} allocations queued` : ''}`;
}

export function parseDiceInput(value: string): number[] {
  const parts = value
    .split(DICE_INPUT_SEPARATOR)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return [];
  const rolls = parts.map(part => Number(part));
  if (rolls.some(roll => !Number.isInteger(roll) || roll < 1 || roll > 6)) return [];
  return rolls;
}

export function sanitizeMeleeAttackAllocation(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function stratagemFollowUpLabels(state: BattleState): string[] {
  const labels: string[] = [];
  if (state.pendingCommandReroll) {
    labels.push(COMMAND_REROLL_PENDING_LABEL);
  }
  for (const unit of state.units) {
    if (unit.destroyed) continue;
    if (unit.rapidIngressThisPhase) labels.push(`Rapid Ingress: place ${unit.profile.name} from Strategic Reserves.`);
    if (unit.heroicInterventionThisPhase) labels.push(`Heroic Intervention: declare a charge with ${unit.profile.name}.`);
  }
  return labels;
}

export function abilityOptionKey(option: AbilityOption): string {
  return `${option.timing}:${option.ability.id}`;
}

export function abilityTimingLabel(timing: AbilityTiming): string {
  return ABILITY_TIMING_LABELS[timing];
}
