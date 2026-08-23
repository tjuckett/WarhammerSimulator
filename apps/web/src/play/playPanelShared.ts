import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import { uiTokens } from '../theme/uiTokens';

export const PLAY_PANEL_LABELS = {
  resolve: 'Resolve',
  roll: 'Roll',
  weapon: 'Weapon',
  target: 'Target',
  shooting: 'Shooting',
  charge: 'Charge',
  fight: 'Fight',
  tactics: 'Tactics',
  pendingDamage: 'Pending Damage',
  stratagems: 'Stratagems',
  ability: 'Ability',
  useAbility: 'Use Ability',
  startAction: 'Start Action',
} as const;

export const PLAY_PANEL_MESSAGES = {
  selectActiveUnit: "Select one of the active army's units on the battlefield.",
  selectEligibleUnit: "Select one of the active army's eligible units.",
  noRangedWeapons: 'No eligible ranged weapons for this unit.',
  noMeleeWeapons: 'No eligible melee weapons for this unit.',
  noValidTargets: 'No valid targets for the selected weapon.',
  noChargeTargets: 'No eligible charge targets.',
  noFightTargets: 'No enemy units in Engagement Range.',
  noTactics: 'No available stratagems, actions, or selected-unit abilities.',
  noStratagems: 'No available stratagems for the selected unit/timing.',
} as const;

export const panelTitleSx = { fontWeight: 800, color: uiTokens.color.text.primary };
export const mutedTextSx = { color: uiTokens.color.text.muted };
export const disabledTextSx = { color: uiTokens.color.text.disabled };
export const warningTextSx = { color: uiTokens.color.status.warning };

export function averageCharacteristic(value: string): number | null {
  const expression = String(value).replace(/\s+/g, '').toLowerCase();
  if (/^\d+$/.test(expression)) return Number(expression);
  let total = 0;
  let matched = false;
  let lastEnd = 0;
  const tokenPattern = /([+-]?)(\d*)d(\d+)|([+-]?\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(expression))) {
    matched = true;
    lastEnd = match.index + match[0].length;
    if (match[3]) {
      total += (match[1] === '-' ? -1 : 1) * (Number(match[2] || 1) * (Number(match[3]) + 1) / 2);
    } else {
      total += Number(match[4]);
    }
  }
  return matched && lastEnd === expression.length ? total : null;
}

export function bestFeelNoPain(unit: BattleUnit): number | null {
  const targets = [...(unit.profile.abilities ?? []), ...(unit.profile.rules ?? [])]
    .flatMap(rule => `${rule.name} ${rule.description}`.matchAll(/feel\s+no\s+pain\s*\(?\s*([2-6])\+?/gi))
    .map(match => Number(match[1]))
    .filter(value => Number.isFinite(value));
  return targets.length ? Math.min(...targets) : null;
}

export const playPanelSx = {
  border: `1px solid ${uiTokens.border.subtle}`,
  borderRadius: uiTokens.radius.panel,
  background: uiTokens.surface.panel,
  padding: 1.25,
  display: 'grid',
  gap: 1,
};

export const popupPanelSx = {
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  padding: 0,
  boxShadow: 'none',
  display: 'grid',
  gap: 1,
};
