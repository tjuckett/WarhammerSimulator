import { type ReactNode, useState } from 'react';
import { Box, Button, CircularProgress, TextField, Tooltip, Typography } from '@mui/material';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { CommandRerollRollType, HeroicInterventionMode, StratagemDefinition } from '@warhammer-simulator/core/types/stratagem';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { estimateSequentialModelEquivalentLosses, modelGroupsForCombatEstimate } from '@warhammer-simulator/core/engine/combatEstimation';
import { battleUnitsBaseEdgeDistance, playShootingWeaponModelCount, type CombatHitPreview, type FiringDeckSelection, type PlayChargeTargetOption, type PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import type { ShootingTargetVisibility } from './shootingSession';
import { explosivesTargetAllowed } from '@warhammer-simulator/core/engine/stratagems';
import {
  abilityOptionKey,
  abilityTimingLabel,
  calcEffectiveSave,
  calcWoundTarget,
  calcWoundTargetColor,
  parseDiceInput,
  orderedDice,
  pendingDamageLabel,
  sanitizeMeleeAttackAllocation,
  stratagemFollowUpLabels,
  type AbilityOption,
} from './playUiHelpers';
import { uiTokens } from '../theme/uiTokens';
import { ShootingResultSummary as StructuredShootingResultSummary } from './ShootingResultSummary';
import {
  PLAY_PANEL_LABELS,
  PLAY_PANEL_MESSAGES,
  averageCharacteristic,
  bestFeelNoPain,
  disabledTextSx,
  mutedTextSx,
  panelTitleSx,
  playPanelSx,
  popupPanelSx,
  warningTextSx,
} from './playPanelShared';
import { buildShootingAttackAllocations, type ShootingResolutionOrderEntry } from './playAttackAllocations';
import { CombatDeclarationPanel } from './CombatDeclarationPanel';
export { PlayTacticsPanel } from './PlayTacticsPanel';
export { PlayChargePanel } from './PlayChargePanel';
export { BattleShockPanel } from './BattleShockPanel';

function hitCalculationTooltip({
  combatMode,
  weaponSkill,
  preview,
}: {
  combatMode: 'ranged' | 'melee';
  weaponSkill: number;
  preview?: CombatHitPreview | null;
}) {
  const skillName = combatMode === 'melee' ? 'WS' : 'BS';
  const lines = [`Base ${skillName}: ${preview?.baseSkill ?? weaponSkill}+`];
  if (!preview || preview.groups.length === 0) {
    lines.push('Modifiers: none.');
    return lines.join('\n');
  }
  preview.groups.forEach(group => {
    const modelLabel = preview.groups.length > 1
      ? `${group.modelIndexes.length} model${group.modelIndexes.length === 1 ? '' : 's'}: `
      : '';
    if (group.specialRule) {
      lines.push(`${modelLabel}${group.specialRule}.`);
    } else if (group.modifiers.length === 0) {
      lines.push(`${modelLabel}Modifiers: none.`);
    } else {
      lines.push(`${modelLabel}Modifiers: ${group.modifiers.map(modifier => {
        const amount = modifier.requiredRollModifier > 0
          ? `+${modifier.requiredRollModifier} required`
          : `-${Math.abs(modifier.requiredRollModifier)} required`;
        return `${modifier.label} (${amount})`;
      }).join(', ')}.`);
    }
    if (!group.autoHits && group.requiredHit !== null) {
      lines.push(`${modelLabel}Requires ${group.requiredHit > 6 ? '6*' : `${group.requiredHit}+`} to hit.`);
    }
  });
  return lines.join('\n');
}

/** Formats the engine-owned per-model hit pools without re-calculating them. */
function hitPreviewTargetLabel(preview?: CombatHitPreview | null): string {
  if (!preview) return '—';
  if (preview.autoHits) return 'Auto';
  if (preview.hitTargetVaries) {
    const targets = [...new Set(preview.groups
      .filter(group => !group.autoHits && group.requiredHit !== null)
      .map(group => group.requiredHit!))];
    return targets.length ? targets.map(target => target > 6 ? '6*' : `${target}+`).join(' / ') : '—';
  }
  if (preview.commonHitTarget === undefined) return '—';
  return preview.commonHitTarget > 6 ? '6*' : `${preview.commonHitTarget}+`;
}

function woundCalculationTooltip(strength: number, toughness: number) {
  const woundTarget = calcWoundTarget(strength, toughness);
  const comparison = strength >= toughness * 2
    ? 'Strength is at least double Toughness.'
    : strength > toughness
      ? 'Strength is greater than Toughness.'
      : strength === toughness
        ? 'Strength equals Toughness.'
        : strength * 2 <= toughness
          ? 'Strength is half or less than Toughness.'
          : 'Strength is less than Toughness.';
  return `Strength ${strength} vs Toughness ${toughness}\n${comparison}\nWound target: ${woundTarget}+`;
}

function saveCalculationTooltip({
  baseSave,
  ap,
  coverBonus,
  effectiveSave,
  invulnerableSave,
  usesInvulnerable,
}: {
  baseSave: number;
  ap: number;
  coverBonus: number;
  effectiveSave: number;
  invulnerableSave?: number;
  usesInvulnerable: boolean;
}) {
  const armorSaveBeforeCover = baseSave + Math.abs(ap);
  const armorSaveAfterCover = armorSaveBeforeCover - coverBonus;
  const lines = [`Base save: ${baseSave}+`];
  lines.push(ap === 0
    ? `AP: none (armor save ${armorSaveBeforeCover}+)`
    : `AP ${ap > 0 ? '+' : ''}${ap} (armor save ${armorSaveBeforeCover}+)`);
  if (coverBonus > 0) {
    lines.push(`Cover improves the armor save to ${armorSaveAfterCover}+.`);
  }
  if (invulnerableSave !== undefined) {
    lines.push(usesInvulnerable
      ? `Invulnerable save: ${invulnerableSave}+ used.`
      : `Invulnerable save: ${invulnerableSave}+ available, but not used.`);
  }
  lines.push(`Final save: ${effectiveSave > 6 ? 'none' : `${effectiveSave}+`}.`);
  return lines.join('\n');
}

function formatEstimateValue(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}

function formatEstimateChance(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function TargetDistanceMarker({ distance }: { distance?: number }) {
  if (distance === undefined || !Number.isFinite(distance)) return null;
  return (
    <Tooltip title="Shortest base-edge distance across attacker-model and target-model combinations that have clear, rules-legal visibility.">
      <Typography
        variant="caption"
        sx={{
          color: uiTokens.color.combat.hit,
          fontWeight: 800,
          whiteSpace: 'nowrap',
          cursor: 'help',
        }}
      >
        {distance.toFixed(1)}&quot;
      </Typography>
    </Tooltip>
  );
}

const combatEstimateGroupsCache = new WeakMap<BattleUnit, ReturnType<typeof modelGroupsForCombatEstimate>>();

function cachedCombatEstimateGroups(unit: BattleUnit) {
  const cached = combatEstimateGroupsCache.get(unit);
  if (cached) return cached;
  const groups = modelGroupsForCombatEstimate(unit);
  combatEstimateGroupsCache.set(unit, groups);
  return groups;
}

export function PendingDamageAllocationHud({ unit, result, shooter, targetIds = [], selectedTargetId, onTargetSelect, onDone, lastAllocationOutcome }: { unit: BattleUnit; result?: import('@warhammer-simulator/core/types/battle').ShootingResolution | null; shooter?: BattleUnit | null; targetIds?: string[]; selectedTargetId?: string; onTargetSelect?: (targetId: string) => void; onDone?: () => void; lastAllocationOutcome?: { modelIndex: number; damage: number; killedModels: number } | null }) {
  const label = pendingDamageLabel(unit);
  const feelNoPain = bestFeelNoPain(unit);
  const hasResultForUnit = !!result?.weapons.some(weapon => weapon.targetUnitId === unit.id);
  if (!label && !hasResultForUnit) return null;
  const pendingAllocations = unit.pendingDamageAllocations ?? [];
  const nextAllocation = pendingAllocations[0];
  const damageByWeapon = new Map<string, typeof pendingAllocations>();
  for (const allocation of pendingAllocations) {
    const weapon = allocation.source ?? 'Unattributed attack';
    damageByWeapon.set(weapon, [...(damageByWeapon.get(weapon) ?? []), allocation]);
  }
  const forcedModel = unit.woundedModelIndex !== undefined
    ? `Model ${unit.woundedModelIndex + 1} is already wounded and must take this.`
    : 'Click a defender model to apply it.';

  return (
    <Box sx={{
      width: '100%',
      minWidth: 0,
      maxWidth: 'none',
      boxSizing: 'border-box',
      p: 1,
      border: `1px solid ${uiTokens.border.warning}`,
      background: uiTokens.surface.pendingHud,
      boxShadow: uiTokens.shadow.pendingHud,
      display: 'grid',
      gap: 0.35,
    }}>
      <StructuredShootingResultSummary result={result} section="defender" />
      {targetIds.length > 1 && onTargetSelect && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {targetIds.map(targetId => {
            const targetName = result?.weapons.find(weapon => weapon.targetUnitId === targetId)?.targetUnitName ?? targetId;
            return (
              <Button
                key={targetId}
                size="small"
                variant={selectedTargetId === targetId ? 'contained' : 'outlined'}
                onClick={() => onTargetSelect(targetId)}
                sx={{ minWidth: 0, flex: '1 1 45%', textTransform: 'none', justifyContent: 'flex-start' }}
              >
                {targetName}
              </Button>
            );
          })}
        </Box>
      )}
      <Typography variant="caption" sx={{ color: uiTokens.color.status.pending, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 }}>
        Damage to apply
      </Typography>
      {[...damageByWeapon.entries()].map(([weapon, damages]) => (
        <Box key={weapon} sx={{ display: 'grid', gap: 0.25 }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800, lineHeight: 1.15 }}>
            {weapon}
            {(() => {
              const weaponResult = result?.weapons.find(candidate => candidate.weaponName === weapon && candidate.targetUnitId === unit.id)
                ?? result?.weapons.find(candidate => candidate.weaponName === weapon);
              const weaponProfile = weaponResult && shooter?.profile.weapons[weaponResult.weaponIndex];
              return weaponProfile ? ` — Damage ${weaponProfile.damage}` : '';
            })()}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.4, flexWrap: 'wrap' }}>
            {damages.map((allocation, index) => {
              const isNext = allocation === nextAllocation;
              return (
                <Box key={`${weapon}-${index}`} sx={{ minWidth: 25, height: 25, px: 0.45, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${isNext ? uiTokens.color.status.pending : uiTokens.color.combat.damage}`, borderRadius: 0.75, background: isNext ? 'rgba(255, 209, 102, 0.32)' : 'rgba(155, 143, 212, 0.18)', color: isNext ? '#ffe08a' : uiTokens.color.combat.damage, fontWeight: 900, fontSize: 13, boxShadow: isNext ? '0 0 0 2px rgba(255, 209, 102, 0.2)' : 'none' }}>
                  {allocation.damage}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
      {!damageByWeapon.size && (
        <Typography variant="body2" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800, lineHeight: 1.15 }}>
          {label ?? 'No damage to apply.'}
        </Typography>
      )}
      {!label && onDone && (
        <Button size="small" variant="contained" onClick={onDone} sx={{ justifySelf: 'start' }}>
          Done
        </Button>
      )}
      {feelNoPain !== null && (
        <Typography variant="caption" sx={{ color: uiTokens.color.combat.save, fontWeight: 800, lineHeight: 1.2 }}>
          Feel No Pain {feelNoPain}+ active: one roll is made for each point of pending damage when you allocate it. Only damage not ignored is applied.
        </Typography>
      )}
      {lastAllocationOutcome && (
        <Typography variant="caption" sx={{ color: lastAllocationOutcome.damage > 0 ? uiTokens.color.combat.damage : uiTokens.color.combat.save, fontWeight: 800, lineHeight: 1.2 }}>
          {lastAllocationOutcome.damage > 0
            ? `Last allocation: ${lastAllocationOutcome.damage} damage applied to Model ${lastAllocationOutcome.modelIndex + 1}${lastAllocationOutcome.killedModels > 0 ? ' (destroyed).' : '.'}`
            : `Last allocation: Model ${lastAllocationOutcome.modelIndex + 1} ignored all damage.`}
        </Typography>
      )}
      {label && (
        <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingMuted, lineHeight: 1.2 }}>
          {forcedModel} Each hit's damage applies to one model; excess damage does not carry over.
        </Typography>
      )}
    </Box>
  );
}

function ShootingTargetDice({
  result,
  weaponIndex,
  targetId,
}: {
  result?: import('@warhammer-simulator/core/types/battle').ShootingResolution | null;
  weaponIndex: number;
  targetId: string;
}) {
  // Large Fight/Shooting activations can contain hundreds of rolls. The
  // complete typed result is retained for resolution and history, but
  // mounting a MUI element for every die makes the popup take seconds to
  // paint. Keep a representative, ordered sample alongside the exact total.
  const maxRenderedDice = 48;
  const weaponResult = result?.weapons.find(candidate => candidate.weaponIndex === weaponIndex && candidate.targetUnitId === targetId);
  if (!weaponResult) return null;
  // The engine can resolve model subsets independently (for example when
  // cover produces multiple pools). Preserve those typed pools, but display
  // them by attack stage rather than execution order: Hit pools first, then
  // Wound pools. Without this a valid split reads "Hit, Wound, Hit".
  const groups = weaponResult.groups
    .filter(group => group.kind === 'hit' || group.kind === 'wound')
    .sort((left, right) => (left.kind === 'hit' ? 0 : 1) - (right.kind === 'hit' ? 0 : 1));
  if (!groups.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.25, mt: 0.25, pl: 0.5 }}>
      {groups.map((group, groupIndex) => {
        const displayedRolls = orderedDice(group.rolls).slice(0, maxRenderedDice);
        const successCount = group.target !== undefined
          ? group.rolls.filter(roll => roll >= group.target).length
          : group.successes;
        const label = group.kind === 'hit' ? 'Hit' : 'Wound';
        return (
          <Box key={`${group.kind}-${groupIndex}`} sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: uiTokens.color.text.secondary, fontSize: 10, fontWeight: 700 }}>
              {label}{successCount !== undefined ? ` - ${successCount} ${group.kind === 'hit' ? 'hits' : 'wounds'}` : ''}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.25, flexWrap: 'wrap' }}>
              {displayedRolls.map((roll, rollIndex) => {
                const success = group.target !== undefined && roll >= group.target;
                const critical = roll === 6;
                return (
                  <Box key={`${roll}-${rollIndex}`} sx={{ minWidth: 18, px: 0.35, border: `1px solid ${critical ? '#7040a0' : success ? '#2a5c2a' : '#3a1818'}`, borderRadius: 0.75, background: critical ? '#241238' : success ? '#0d260d' : '#1a0d0d', color: critical ? '#d5a6ff' : success ? '#78d786' : '#664444', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
                    {roll}
                  </Box>
                );
              })}
              {group.rolls.length > displayedRolls.length && (
                <Typography variant="caption" sx={{ alignSelf: 'center', color: uiTokens.color.text.secondary, fontSize: 10 }}>
                  +{group.rolls.length - displayedRolls.length} more
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function CombatPanel({
  shooter,
  popup = false,
  structuredResult = null,
  resultSection = 'all',
  title = PLAY_PANEL_LABELS.shooting,
  actionLabel = 'Shoot',
  pendingDamageActionLabel = 'Resolve',
  combatMode = 'ranged',
  warning,
  optionsPending = false,
  targets,
  resultTargets = [],
  selectedTarget,
  targetIsValid,
  coverSaveEnabled = true,
  damageAllocationLocked,
  pendingDamageLabel,
  weaponOptions,
  shootingAttackAllocations = {},
  shootingResolutionOrder = [],
  selectedTargetId,
  selectedWeaponIndex,
  combatHitPreviews,
  targetDistances,
  shootingTargetVisibility,
  onTargetChange,
  onWeaponChange,
  onShootingAttackAllocationChange = () => undefined,
  onShootingResolutionOrderMove,
  firingDeckOptions = [],
  firingDeckCapacity = 0,
  onFiringDeckSelect,
  weaponModelCountFor,
  targetAllocationCap,
  onResolve,
}: {
  shooter: BattleUnit | null;
  popup?: boolean;
  structuredResult?: import('@warhammer-simulator/core/types/battle').ShootingResolution | null;
  resultSection?: 'attacker' | 'defender' | 'all';
  title?: string;
  actionLabel?: string;
  pendingDamageActionLabel?: string;
  combatMode?: 'ranged' | 'melee';
  warning?: ReactNode;
  optionsPending?: boolean;
  targets: BattleUnit[];
  resultTargets?: BattleUnit[];
  selectedTarget: BattleUnit | null;
  targetIsValid: boolean;
  coverSaveEnabled?: boolean;
  damageAllocationLocked: boolean;
  pendingDamageLabel?: string | null;
  weaponOptions: PlayShootingWeaponOption[];
  shootingAttackAllocations?: Record<string, Record<string, number>>;
  shootingResolutionOrder?: ShootingResolutionOrderEntry[];
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  combatHitPreviews?: Map<string, Map<number, CombatHitPreview>>;
  targetDistances?: ReadonlyMap<string, number>;
  shootingTargetVisibility?: ReadonlyMap<string, ShootingTargetVisibility>;
  onTargetChange: (value: string) => void;
  onWeaponChange: (value: 'all' | string) => void;
  onShootingAttackAllocationChange?: (weaponIndex: number, targetId: string, attacks: number) => void;
  onShootingResolutionOrderMove?: (weaponIndex: number, targetUnitId: string, direction: -1 | 1) => void;
  firingDeckOptions?: FiringDeckSelection[];
  firingDeckCapacity?: number;
  onFiringDeckSelect?: (selections: FiringDeckSelection[]) => void;
  weaponModelCountFor?: (weaponIndex: number) => number;
  targetAllocationCap?: (weaponIndex: number, targetId: string, allocatedElsewhere: number, weaponModelCount: number) => number;
  onResolve: () => void;
}) {
  const [firingDeckKeys, setFiringDeckKeys] = useState<string[]>([]);
  if (!shooter) {
    return (
      <Box sx={playPanelSx}>
        <Typography variant="subtitle2" sx={panelTitleSx}>{title}</Typography>
        <Typography variant="body2" sx={mutedTextSx}>{PLAY_PANEL_MESSAGES.selectActiveUnit}</Typography>
      </Box>
    );
  }

  const shootingLocked = damageAllocationLocked;
  const hasStructuredResult = !!structuredResult?.weapons.length;
  const isAttackerResultReview = hasStructuredResult && resultSection === 'attacker';
  const allocationsReadOnly = hasStructuredResult;
  const resolvePendingDamage = shootingLocked && hasStructuredResult;
  const completedWithoutPendingDamage = hasStructuredResult && !shootingLocked;
  const noAttackSelected = selectedWeaponIndex !== 'all'
    && weaponOptions.some(option => String(option.weaponIndex) === selectedWeaponIndex && option.weaponIndex < 0);
  const weaponForOption = (option: PlayShootingWeaponOption) =>
    option.weapon ?? shooter.profile.weapons[option.sourceWeaponIndex ?? option.weaponIndex];
  const exactModelCountForWeapon = (option: PlayShootingWeaponOption): number | null => {
    if (combatMode !== 'ranged' || !shootingTargetVisibility || option.weaponIndex < 0) return null;
    const modelIndexes = new Set<number>();
    for (const targetId of option.targetIds) {
      const visibility = shootingTargetVisibility.get(targetId);
      if (!visibility || visibility.status === 'checking') return null;
      for (const modelIndex of visibility.weaponModelIndexes[option.weaponIndex] ?? []) modelIndexes.add(modelIndex);
    }
    return modelIndexes.size;
  };
  const allocatedModelsForWeapon = (option: PlayShootingWeaponOption) => Object.values(
    shootingAttackAllocations[String(option.weaponIndex)] ?? {},
  ).reduce((total, models) => total + (Number(models) || 0), 0);
  // Legal declarations are validated by the engine action. This component
  // only prevents UI states that cannot submit anything at all (a locked or
  // completed unit); it must not approve/reject allocations independently.
  const canResolve = resolvePendingDamage || completedWithoutPendingDamage || (!shootingLocked
    && !shooter.activated
    && weaponOptions.length > 0);
  const hitPreviewForTargetAndWeapon = (targetId: string, weaponIndex: number): CombatHitPreview | null =>
    structuredResult?.weapons.find(result => result.targetUnitId === targetId && result.weaponIndex === weaponIndex)?.hitPreview
      ?? combatHitPreviews?.get(targetId)?.get(weaponIndex)
      ?? null;
  const coverStatusForTargetAndWeapon = (targetId: string, weaponIndex: number) =>
    hitPreviewForTargetAndWeapon(targetId, weaponIndex)?.coverStatus ?? 'none';

  const refWeapons = selectedTarget && targetIsValid
    ? (selectedWeaponIndex === 'all'
        ? weaponOptions.filter(o => o.targetIds.includes(selectedTargetId))
        : weaponOptions.filter(o => String(o.weaponIndex) === selectedWeaponIndex && o.targetIds.includes(selectedTargetId))
      ).map(weaponForOption).filter(Boolean)
    : [];
  const resultWeaponIndices = new Set(structuredResult?.weapons.map(result => result.weaponIndex) ?? []);
  const resultWeapons = weaponOptions
    .filter(option => option.weaponIndex >= 0 && resultWeaponIndices.has(option.weaponIndex))
    .map(weaponForOption)
    .filter(Boolean);
  const resultTargetPool = [...targets, ...resultTargets].filter((unit, index, all) => all.findIndex(candidate => candidate.id === unit.id && candidate.side === unit.side) === index);
  const targetOrder = new Map(resultTargetPool.map((target, index) => [target.id, index]));
  const targetOrderValue = (targetId: string) => targetOrder.get(targetId) ?? Number.MAX_SAFE_INTEGER;
  const resultWeaponOptions: PlayShootingWeaponOption[] = structuredResult?.weapons
    ? Array.from(new Map(structuredResult.weapons.map(result => [result.weaponIndex, result])).values())
      .map(result => ({
        weaponIndex: result.weaponIndex,
        name: weaponOptions.find(option => option.weaponIndex === result.weaponIndex)?.name ?? result.weaponName,
        weapon: weaponOptions.find(option => option.weaponIndex === result.weaponIndex)?.weapon,
        targetIds: structuredResult.weapons
          .filter(candidate => candidate.weaponIndex === result.weaponIndex)
          .map(candidate => candidate.targetUnitId)
          .sort((a, b) => targetOrderValue(a) - targetOrderValue(b)),
      }))
    : [];
  const effectiveWeaponOptions = hasStructuredResult && resultSection === 'attacker'
    ? resultWeaponOptions
    : weaponOptions;
  const availableWeapons = weaponOptions
    .filter(option => option.weaponIndex >= 0)
    .map(weaponForOption)
    .filter((weapon): weapon is BattleUnit['profile']['weapons'][number] => !!weapon);
  const displayedWeaponOptions = effectiveWeaponOptions;
  const selectableWeaponOptions = effectiveWeaponOptions.filter(option => option.weaponIndex >= 0);
  const defaultWeaponIndex = (selectableWeaponOptions[0] ?? effectiveWeaponOptions[0])?.weaponIndex;
  const displayedWeaponIndex = defaultWeaponIndex === undefined
    ? selectedWeaponIndex
    : selectedWeaponIndex === 'all'
      || !effectiveWeaponOptions.some(option => String(option.weaponIndex) === selectedWeaponIndex)
      ? String(defaultWeaponIndex)
      : selectedWeaponIndex;
  const activeWeaponOptions = displayedWeaponIndex === 'all'
    ? []
    : selectableWeaponOptions.filter(option => String(option.weaponIndex) === displayedWeaponIndex);
  const assignedCountForWeapon = (option: PlayShootingWeaponOption) => Object.values(
    shootingAttackAllocations[String(option.weaponIndex)] ?? {},
  ).reduce((total, models) => total + (Number(models) || 0), 0);
  // Once exact LOS checks have completed, only models that can actually
  // participate are allocatable. Keep the denominator and allocation caps in
  // sync with the resolver instead of showing (for example) 4/5 when the
  // fifth model is out of LOS.
  const modelCountForWeapon = (option: PlayShootingWeaponOption) => {
    const exactModelCount = combatMode === 'ranged' ? exactModelCountForWeapon(option) : null;
    return exactModelCount
      ?? weaponModelCountFor?.(option.weaponIndex)
      ?? option.modelCount
      ?? playShootingWeaponModelCount(shooter, option.sourceWeaponIndex ?? option.weaponIndex);
  };
  const resolutionQueue = buildShootingAttackAllocations(shootingAttackAllocations, shootingResolutionOrder)
    .map(allocation => {
      const option = weaponOptions.find(candidate => candidate.weaponIndex === allocation.weaponIndex);
      const target = resultTargetPool.find(candidate => candidate.id === allocation.targetUnitId);
      return option && target
        ? { ...allocation, option, target, modelCount: allocation.modelCount ?? modelCountForWeapon(option) }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const declarationActionLabel = resolvePendingDamage
    ? pendingDamageActionLabel
    : actionLabel;
  const displayedWeapons = resultSection === 'attacker' && hasStructuredResult && resultWeapons.length
    ? resultWeapons
    : availableWeapons.length
      ? availableWeapons
      : refWeapons;
  const resultWeaponTargets = Array.from(new Set((structuredResult?.weapons ?? []).map(result => result.weaponIndex)))
    .flatMap(weaponIndex => (structuredResult?.weapons ?? [])
      .filter(result => result.weaponIndex === weaponIndex)
      .sort((a, b) => targetOrderValue(a.targetUnitId) - targetOrderValue(b.targetUnitId))
      .flatMap(result => {
        const option = weaponOptions.find(candidate => candidate.weaponIndex === result.weaponIndex);
        const weapon = option ? weaponForOption(option) : shooter.profile.weapons[result.weaponIndex];
        const target = resultTargetPool.find(candidate => candidate.id === result.targetUnitId);
        return weapon && target ? [{ weapon, target, weaponIndex: result.weaponIndex }] : [];
      }));
  const displayedWeaponTargets = resultSection === 'attacker' || resultSection === 'defender'
    ? hasStructuredResult && resultWeaponTargets.length > 0
      ? resultWeaponTargets
      : effectiveWeaponOptions.flatMap(option => {
        const weapon = weaponForOption(option);
        if (!weapon) return [];
        const targetIds = hasStructuredResult
          ? option.targetIds.filter(targetId => (shootingAttackAllocations[String(option.weaponIndex)]?.[targetId] ?? 0) > 0)
          : option.targetIds;
        return targetIds
          .map(targetId => targets.find(target => target.id === targetId))
          .filter((target): target is BattleUnit => !!target)
          .map(target => ({ weapon, target, weaponIndex: option.weaponIndex }));
      })
    : effectiveWeaponOptions.flatMap(option => {
      const weapon = weaponForOption(option);
      if (!weapon) return [];
      const allocatedTargetIds = option.targetIds.filter(targetId => (shootingAttackAllocations[String(option.weaponIndex)]?.[targetId] ?? 0) > 0);
      return allocatedTargetIds
        .map(targetId => targets.find(target => target.id === targetId))
        .filter((target): target is BattleUnit => !!target)
        .map(target => ({ weapon, target, weaponIndex: option.weaponIndex }));
    });
  const weaponResultSummaries = isAttackerResultReview && combatMode === 'ranged'
    ? resultWeaponOptions.map(option => {
      const weaponResults = (structuredResult?.weapons ?? []).filter(result => result.weaponIndex === option.weaponIndex);
      return {
        weaponIndex: option.weaponIndex,
        name: option.name,
        hits: weaponResults.reduce((total, result) => total + result.hits, 0),
        wounds: weaponResults.reduce((total, result) => total + result.wounds, 0),
      };
    })
    : [];
  const blockedTargetNames = combatMode === 'ranged'
    ? targets
      .filter(target => shootingTargetVisibility?.get(target.id)?.status === 'blocked')
      .map(target => target.profile.name)
    : [];

  return (
    <CombatDeclarationPanel
      unit={shooter}
      popup={popup}
      title={title}
      actionLabel={declarationActionLabel}
      actionDisabled={!canResolve}
      onAction={onResolve}
      status={shooter.activated ? 'done' : shooter.firedWeaponIndices?.length ? `${shooter.firedWeaponIndices.length} fired` : undefined}
      weaponOptions={displayedWeaponOptions}
      selectedWeaponIndex={displayedWeaponIndex}
      weaponSuffix={option => {
        if (option.weaponIndex < 0) return '';
        const result = isAttackerResultReview
          ? weaponResultSummaries.find(candidate => candidate.weaponIndex === option.weaponIndex)
          : undefined;
        if (result) {
          const selected = displayedWeaponIndex === String(option.weaponIndex);
          return (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0, fontSize: 13, fontWeight: 900, lineHeight: 1.1, whiteSpace: 'nowrap' }}>
              <Box component="span" sx={{ color: selected ? 'inherit' : uiTokens.color.combat.hit }}>Hits {result.hits}</Box>
              <Box component="span" sx={{ color: selected ? 'inherit' : uiTokens.color.combat.damage }}>Wounds {result.wounds}</Box>
            </Box>
          );
        }
        return ` · ${assignedCountForWeapon(option)}/${modelCountForWeapon(option)}`;
      }}
      disabled={!isAttackerResultReview && (shootingLocked || shooter.activated)}
      onWeaponChange={onWeaponChange}
      warning={optionsPending ? 'Checking melee options…' : warning}
      weaponSelectorOrientation="vertical"
    >
      {firingDeckOptions.length > 0 && onFiringDeckSelect && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="caption">Firing Deck: select up to {firingDeckCapacity} embarked model{firingDeckCapacity === 1 ? '' : 's'}.</Typography>
          {firingDeckOptions.map(option => {
            const key = `${option.passengerRosterId}:${option.modelIndex}:${option.weaponIndex}`;
            const modelPrefix = `${option.passengerRosterId}:${option.modelIndex}:`;
            const selected = firingDeckKeys.includes(key);
            const anotherForModel = firingDeckKeys.some(candidate => candidate.startsWith(modelPrefix) && candidate !== key);
            return (
                          <Button key={key} size="small" variant={selected ? 'contained' : 'outlined'} disabled={allocationsReadOnly || !selected && (anotherForModel || firingDeckKeys.length >= firingDeckCapacity)} onClick={() => setFiringDeckKeys(current => selected ? current.filter(candidate => candidate !== key) : [...current, key])}>
                {option.passengerName ?? option.passengerRosterId} model {option.modelIndex + 1}: {option.weaponName ?? `weapon ${option.weaponIndex + 1}`}
              </Button>
            );
          })}
          <Button size="small" color="secondary" variant="contained" disabled={allocationsReadOnly} onClick={() => onFiringDeckSelect(firingDeckOptions.filter(option => firingDeckKeys.includes(`${option.passengerRosterId}:${option.modelIndex}:${option.weaponIndex}`)))}>
            Confirm Firing Deck
          </Button>
        </Box>
      )}
      {blockedTargetNames.length > 0 && !hasStructuredResult && (
        <Typography variant="caption" sx={{ color: uiTokens.color.status.danger, fontWeight: 700 }}>
          Blocked by LOS: {blockedTargetNames.join(', ')}
        </Typography>
      )}
      <Box sx={{ display: 'none' }} aria-hidden>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={panelTitleSx}>{title}</Typography>
          <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shooter.profile.name}{shooter.activated ? ' — done' : (shooter.firedWeaponIndices?.length ? ` — ${shooter.firedWeaponIndices.length} fired` : '')}
          </Typography>
          {(shooter.firedWeaponIndices?.length ?? 0) > 0 && !shooter.activated && (
            <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.quiet, fontStyle: 'italic', fontSize: 10 }}>
              Already fired: {(shooter.firedWeaponIndices ?? []).map(i => shooter.profile.weapons[i]?.name).filter(Boolean).join(', ')}
            </Typography>
          )}
        </Box>
        <Button
          size="small"
          variant="contained"
          onClick={onResolve}
          disabled={!canResolve}
        >
          {declarationActionLabel}
        </Button>
      </Box>

      {(!shootingLocked && !shooter.activated || hasStructuredResult && resultSection === 'attacker') && effectiveWeaponOptions.some(option => option.weaponIndex >= 0) && (
        <Box sx={{ display: 'grid', gap: 0.75, p: 1, border: `1px solid ${uiTokens.border.control}`, borderRadius: uiTokens.radius.control }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
            {hasStructuredResult && resultSection === 'attacker'
              ? 'Attack results'
              : 'Configure weapon allocations'}
          </Typography>
          {activeWeaponOptions.map(option => {
            const weapon = weaponForOption(option);
            if (!weapon) return null;
            const weaponTargets = shootingAttackAllocations[String(option.weaponIndex)] ?? {};
            const weaponModelCount = modelCountForWeapon(option);
            const orderedTargetIds = option.targetIds
              .map((targetId, index) => {
                const visibility = combatMode === 'ranged' && option.weaponIndex >= 0
                  ? shootingTargetVisibility?.get(targetId)
                  : undefined;
                const modelCount = visibility?.weaponModelIndexes[option.weaponIndex]?.length ?? 0;
                const rank = visibility?.status === 'visible' && modelCount > 0
                  ? 0 // targetable
                  : visibility && visibility.status !== 'checking'
                    ? 1 // blocked or no firing models
                    : 2; // queued/checking (or non-ranged)
                return { targetId, index, rank };
              })
              .sort((left, right) => left.rank - right.rank || left.index - right.index)
              .map(({ targetId }) => targetId);
            return (
              <Box key={option.weaponIndex} sx={{ display: 'grid', gap: 0.4 }}>
                <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700 }}>
                  {option.name} — {Object.values(weaponTargets).reduce((total, models) => total + (Number(models) || 0), 0)}/{weaponModelCount} assigned
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${combatMode === 'melee' ? 2 : 3}, 1fr)`, border: `1px solid ${uiTokens.border.statCard}`, borderRadius: uiTokens.radius.statCard, overflow: 'hidden', background: uiTokens.surface.statCard }}>
                  {combatMode === 'ranged' && (
                    <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                      <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>Range</Typography>
                      <Typography variant="caption" sx={{ color: uiTokens.color.combat.hit, fontWeight: 900, fontSize: 15, lineHeight: 1.1 }}>{weapon.range}&quot;</Typography>
                    </Box>
                  )}
                  <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>Attacks</Typography>
                    <Typography variant="caption" sx={{ color: uiTokens.color.combat.attacks, fontWeight: 900, fontSize: 15, lineHeight: 1.1 }}>{weapon.attacks}</Typography>
                  </Box>
                  <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>Dmg</Typography>
                    <Typography variant="caption" sx={{ color: uiTokens.color.combat.damage, fontWeight: 900, fontSize: 15, lineHeight: 1.1 }}>{weapon.damage}</Typography>
                  </Box>
                </Box>
                {option.targetIds.length === 0 && (
                  <Typography variant="caption" role="alert" sx={{ ...warningTextSx, fontStyle: 'italic', py: 0.5 }}>
                    No eligible targets for this weapon.
                  </Typography>
                )}
                <Box sx={option.targetIds.length > 3 ? { maxHeight: 'min(360px, 45vh)', overflowY: 'auto', display: 'grid', gap: 0.6, pr: 0.5 } : { display: 'grid', gap: 0.6 }}>
                {orderedTargetIds.map(targetId => {
                  const target = resultTargetPool.find(candidate => candidate.id === targetId);
                  const targetDistance = target ? targetDistances?.get(target.id) : undefined;
                  const targetVisibility = combatMode === 'ranged'
                    ? shootingTargetVisibility?.get(targetId)
                    : undefined;
                  const targetChecking = targetVisibility?.status === 'checking';
                  const targetBlocked = targetVisibility?.status === 'blocked';
                  // targetIds comes from the core shooting-rule query. It is
                  // distinct from per-model LOS, so do not describe a rules
                  // rejection (such as Blast into an engaged unit) as "no
                  // firing models".
                  const targetAllowedByRules = option.targetIds.includes(targetId);
                  const targetWeaponModelCount = targetVisibility?.weaponModelIndexes[option.weaponIndex]?.length ?? 0;
                  const targetNoFiringModels = combatMode === 'ranged'
                    && targetAllowedByRules
                    && targetVisibility?.status === 'visible'
                    && option.weaponIndex >= 0
                    && targetWeaponModelCount === 0;
                  const targetUnavailable = !targetAllowedByRules || targetBlocked || targetNoFiringModels;
                  const targetUnchecked = combatMode === 'ranged' && !targetVisibility;
                  const targetPending = targetUnchecked || targetChecking;
                  // Keep unresolved checks visually neutral. A target is only
                  // marked green/red once the exact model LOS query completes.
                  const targetCanFire = combatMode === 'ranged'
                    && targetVisibility?.status === 'visible'
                    && targetWeaponModelCount > 0;
                  const targetCannotFire = combatMode === 'ranged'
                    && !targetPending
                    && (!targetAllowedByRules || targetBlocked || targetNoFiringModels);
                  const allocatedElsewhere = Object.entries(weaponTargets)
                    .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
                    .reduce((total, [, models]) => total + (Number(models) || 0), 0);
                  const allocationCount = Number(weaponTargets[targetId] ?? 0);
                  const allocationMax = targetAllocationCap
                    ? targetAllocationCap(option.weaponIndex, targetId, allocatedElsewhere, weaponModelCount)
                    : Math.max(0, weaponModelCount - allocatedElsewhere);
                  const targetHitPreviewForAllocation = target
                    ? hitPreviewForTargetAndWeapon(target.id, option.weaponIndex)
                    : null;
                  const targetCoverStatusForAllocation = combatMode === 'ranged' && target
                    ? targetHitPreviewForAllocation?.coverStatus ?? coverStatusForTargetAndWeapon(target.id, option.weaponIndex)
                    : 'none';
                  const targetInCoverForAllocation = targetCoverStatusForAllocation === 'all';
                  const allocationWound = target ? calcWoundTarget(weapon.strength, target.profile.toughness) : null;
                  const allocationSave = target ? calcEffectiveSave(target.profile.save, weapon.ap, target.profile.invulnSave) : null;
                  const allocationCoverBonus = targetHitPreviewForAllocation
                    ? targetHitPreviewForAllocation.commonCoverSaveModifier ?? 0
                    : target && coverSaveEnabled && targetInCoverForAllocation && target.profile.save <= 6 ? 1 : 0;
                  const allocationHitLabel = targetUnavailable ? '—' : hitPreviewTargetLabel(targetHitPreviewForAllocation);
                  const allocationNormalSaveWithCover = target ? target.profile.save + Math.abs(weapon.ap) - allocationCoverBonus : null;
                  const allocationSaveWithCover = allocationSave === null || allocationNormalSaveWithCover === null
                    ? null
                    : Math.min(allocationNormalSaveWithCover, target?.profile.invulnSave ?? 7);
                  const allocationUsesInvuln = !!target?.profile.invulnSave && allocationSaveWithCover === target.profile.invulnSave && target.profile.invulnSave < (allocationNormalSaveWithCover ?? 7);
                  const allocationFeelNoPain = target ? bestFeelNoPain(target) : null;
                  const allocationWoundColor = allocationWound === null ? uiTokens.color.text.muted : calcWoundTargetColor(allocationWound);
                  const allocationSaveColor = allocationSaveWithCover !== null && allocationSaveWithCover > 6
                    ? uiTokens.color.combat.noSave
                    : uiTokens.color.combat.save;
                  const allocatedModelCount = Number(weaponTargets[targetId] ?? 0);
                  const averageAttacks = averageCharacteristic(weapon.attacks);
                  const averageDamage = averageCharacteristic(weapon.damage);
                  const hitChance = targetHitPreviewForAllocation?.hitProbability
                    ?? (allocationHit === null ? 0 : Math.max(0, (7 - allocationHit) / 6));
                  const feelNoPainDamageChance = allocationFeelNoPain === null ? 1 : Math.max(0, (allocationFeelNoPain - 1) / 6);
                  // An unallocated target has no useful casualty estimate yet.
                  // Avoid building the model-group breakdown and tooltip until
                  // the player assigns at least one model to this target.
                  const targetModelGroups = allocatedModelCount > 0 && target
                    ? cachedCombatEstimateGroups(target)
                    : [];
                  const defaultTargetModelGroup = targetModelGroups.length > 0
                    ? targetModelGroups.reduce((best, group) => group.modelCount > best.modelCount ? group : best)
                    : null;
                  const modelGroupEstimates = targetModelGroups.map(group => {
                    const groupWoundTarget = calcWoundTarget(weapon.strength, group.toughness);
                    const groupWoundChance = Math.max(0, (7 - groupWoundTarget) / 6);
                    const groupNormalSaveWithCover = group.save + Math.abs(weapon.ap) - allocationCoverBonus;
                    const groupSaveWithCover = Math.min(groupNormalSaveWithCover, target?.profile.invulnSave ?? 7);
                    const groupSaveFailureChance = groupSaveWithCover > 6
                      ? 1
                      : Math.max(0, (groupSaveWithCover - 1) / 6);
                    const expectedAttacks = averageAttacks === null
                      ? null
                      : allocatedModelCount * averageAttacks;
                    const expectedHits = expectedAttacks === null
                      ? null
                      : expectedAttacks * hitChance;
                    const expectedWounds = expectedHits === null
                      ? null
                      : expectedHits * groupWoundChance;
                    const expectedFailedSaves = expectedWounds === null
                      ? null
                      : expectedWounds * groupSaveFailureChance;
                    const expectedUnsavedPackets = averageAttacks === null
                      ? null
                      : expectedFailedSaves === null
                        ? null
                        : expectedFailedSaves * feelNoPainDamageChance;
                    const expectedDamage = expectedUnsavedPackets === null || averageDamage === null
                      ? null
                      : expectedUnsavedPackets * averageDamage;
                    const estimate = expectedUnsavedPackets === null || averageDamage === null
                      ? null
                      : estimateSequentialModelEquivalentLosses({
                        modelCount: group.modelCount,
                        woundsPerModel: group.wounds,
                        currentWounds: group.currentWounds,
                        expectedUnsavedPackets,
                        averageDamagePerPacket: averageDamage,
                      });
                    const usesInvulnerableSave = target?.profile.invulnSave !== undefined
                      && target.profile.invulnSave < groupNormalSaveWithCover;
                    return {
                      group,
                      estimate,
                      calculation: {
                        expectedAttacks,
                        expectedHits,
                        expectedWounds,
                        expectedFailedSaves,
                        expectedUnsavedPackets,
                        expectedDamage,
                        groupWoundTarget,
                        groupWoundChance,
                        groupNormalSaveWithCover,
                        groupSaveWithCover,
                        groupSaveFailureChance,
                        usesInvulnerableSave,
                      },
                    };
                  });
                  const defaultModelGroupEstimate = defaultTargetModelGroup
                    ? modelGroupEstimates.find(({ group }) => group === defaultTargetModelGroup)
                    : undefined;
                  const estimatedModelsLost = defaultModelGroupEstimate?.estimate?.modelEquivalentLosses ?? null;
                  const estimateTooltip = targetModelGroups.length > 0
                    ? (
                      <Box sx={{ whiteSpace: 'pre-line', maxWidth: 440, fontSize: 12, lineHeight: 1.35 }}>
                        {[
                          'Estimate uses average attacks/damage; normal damage does not spill over.',
                          ...modelGroupEstimates.flatMap(({ group, estimate, calculation }) => {
                            const saveLabel = calculation.groupSaveWithCover > 6
                              ? 'none'
                              : `${calculation.groupSaveWithCover}+`;
                            const savePath = calculation.usesInvulnerableSave && target?.profile.invulnSave !== undefined
                              ? `armor ${calculation.groupNormalSaveWithCover}+ → ${target.profile.invulnSave}+ invulnerable`
                              : `armor ${calculation.groupNormalSaveWithCover}+`;
                            const feelNoPainLabel = allocationFeelNoPain === null
                              ? `none (${formatEstimateChance(feelNoPainDamageChance)} damage passes)`
                              : `${allocationFeelNoPain}+ (${formatEstimateChance(feelNoPainDamageChance)} damage passes)`;
                            const groupLines = [
                              `${group.name} (${group.modelCount} models, ${group.wounds}W${group.currentWounds !== undefined ? `; one at ${group.currentWounds}W` : ''})`,
                              `  Allocation: ${allocatedModelCount} firing model${allocatedModelCount === 1 ? '' : 's'}`,
                              `  Attacks: ${allocatedModelCount} × ${formatEstimateValue(averageAttacks)} = ${formatEstimateValue(calculation.expectedAttacks)}`,
                              `  Hits: ${formatEstimateValue(calculation.expectedAttacks)} × ${formatEstimateChance(hitChance)} (${allocationHitLabel}) = ${formatEstimateValue(calculation.expectedHits)}`,
                              `  Wounds: ${formatEstimateValue(calculation.expectedHits)} × ${formatEstimateChance(calculation.groupWoundChance)} (${calculation.groupWoundTarget}+) = ${formatEstimateValue(calculation.expectedWounds)}`,
                              `  Saves: ${formatEstimateValue(calculation.expectedWounds)} × ${formatEstimateChance(calculation.groupSaveFailureChance)} fail (${savePath}; final ${saveLabel}) = ${formatEstimateValue(calculation.expectedFailedSaves)} failed saves`,
                              `  FNP: ${feelNoPainLabel}`,
                              `  Unsaved packets: ${formatEstimateValue(calculation.expectedFailedSaves)} × ${formatEstimateChance(feelNoPainDamageChance)} = ${formatEstimateValue(calculation.expectedUnsavedPackets)}`,
                              `  Damage: ${formatEstimateValue(calculation.expectedUnsavedPackets)} × ${formatEstimateValue(averageDamage)} average damage = ${formatEstimateValue(calculation.expectedDamage)}`,
                            ];
                            if (estimate) {
                              groupLines.push(`  Sequential result: ~${estimate.modelEquivalentLosses.toFixed(1)} model-equivalents (${estimate.fullModelsLost} full + ${estimate.partialModelEquivalent.toFixed(1)} partial)`);
                            } else {
                              groupLines.push('  Sequential result: unavailable');
                            }
                            return groupLines;
                          }),
                          'The main estimate uses the largest remaining model group. Actual dice and defender allocation may differ.',
                        ].join('\n')}
                      </Box>
                    )
                    : allocatedModelCount > 0
                      ? 'Estimated model-equivalent casualties are unavailable.'
                      : 'Assign at least one model to see an estimate.';
                  return (
                    <Box
                      key={`${option.weaponIndex}:${targetId}`}
                      title={targetCanFire ? 'Targetable with this weapon' : targetCannotFire ? 'Cannot target with this weapon' : undefined}
                      sx={{
                        display: 'grid',
                        gap: 0.25,
                        p: 0.5,
                        borderRadius: uiTokens.radius.control,
                        border: targetCanFire
                          ? '1px solid rgba(112, 215, 140, 0.72)'
                          : targetCannotFire
                            ? '1px solid rgba(255, 111, 111, 0.72)'
                            : `1px solid ${uiTokens.border.control}`,
                        backgroundColor: targetCanFire
                          ? 'rgba(44, 120, 69, 0.16)'
                          : targetCannotFire
                            ? 'rgba(130, 38, 45, 0.16)'
                            : 'rgba(255, 255, 255, 0.015)',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 0.75 }}>
                        <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700, overflowWrap: 'anywhere', minWidth: 0 }}>
                          {target?.profile.name ?? targetId}
                        </Typography>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                          {combatMode === 'ranged' && (
                            <Button
                              size="small"
                              variant={selectedTargetId === targetId ? 'contained' : 'outlined'}
                              aria-label={`Select ${target?.profile.name ?? targetId} for preview`}
                              onClick={() => onTargetChange(targetId)}
                              sx={{ minWidth: 48, px: 0.75, py: 0.1, fontSize: 10, lineHeight: 1.35 }}
                            >
                              Select
                            </Button>
                          )}
                          {targetPending && (
                            <CircularProgress
                              size={11}
                              thickness={5}
                              role="progressbar"
                              aria-label={targetChecking ? 'Checking line of sight' : 'Queued for line of sight check'}
                              sx={{
                                flexShrink: 0,
                                color: targetChecking ? uiTokens.color.status.warning : uiTokens.color.text.muted,
                              }}
                            />
                          )}
                          {targetUnchecked && (
                            <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
                              Queued for LOS…
                            </Typography>
                          )}
                          {targetChecking && (
                            <Typography variant="caption" sx={{ color: uiTokens.color.status.warning, fontWeight: 700 }}>
                              Checking LOS…
                            </Typography>
                          )}
                          {targetBlocked && (
                            <Typography variant="caption" sx={{ color: uiTokens.color.status.danger, fontWeight: 700 }}>
                              Blocked
                            </Typography>
                          )}
                          {!targetAllowedByRules && (
                            <Typography variant="caption" sx={{ color: uiTokens.color.status.danger, fontWeight: 700 }}>
                              Not a legal target for this weapon
                            </Typography>
                          )}
                          {targetNoFiringModels && (
                            <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
                              No firing models
                            </Typography>
                          )}
                          {targetVisibility?.status === 'visible' && !targetNoFiringModels && (
                            <Typography variant="caption" sx={{ color: uiTokens.color.status.success, fontWeight: 700 }}>
                              {targetWeaponModelCount} in LOS
                            </Typography>
                          )}
                          <TargetDistanceMarker distance={targetDistance} />
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
                      <Box sx={{ minWidth: 120, flex: '0 0 120px', display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          aria-label={`Decrease allocation to ${target?.profile.name ?? targetId}`}
                          disabled={allocationsReadOnly || targetPending || targetUnavailable || allocationCount <= 0}
                          onClick={() => onShootingAttackAllocationChange(option.weaponIndex, targetId, allocationCount - 1)}
                          sx={{ minWidth: 26, width: 26, height: 32, px: 0, lineHeight: 1, fontSize: 16 }}
                        >
                          −
                        </Button>
                        <TextField
                          size="small"
                          type="number"
                          hiddenLabel
                          value={allocationCount}
                          disabled={allocationsReadOnly || targetPending || targetUnavailable}
                          sx={{ flex: 1, '& input::-webkit-inner-spin-button': { appearance: 'none', margin: 0 } }}
                          slotProps={{ htmlInput: { min: 0, max: allocationMax, step: 1 } }}
                          onChange={event => onShootingAttackAllocationChange(option.weaponIndex, targetId, Math.max(0, Math.min(allocationMax, Math.floor(Number(event.target.value) || 0))))}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          aria-label={`Increase allocation to ${target?.profile.name ?? targetId}`}
                          disabled={allocationsReadOnly || targetPending || targetUnavailable || allocationCount >= allocationMax}
                          onClick={() => onShootingAttackAllocationChange(option.weaponIndex, targetId, allocationCount + 1)}
                          sx={{ minWidth: 26, width: 26, height: 32, px: 0, lineHeight: 1, fontSize: 16 }}
                        >
                          +
                        </Button>
                      </Box>
                      {target && (
                        <Box sx={{ flex: 1, minWidth: 0, border: `1px solid ${uiTokens.border.statCard}`, borderRadius: uiTokens.radius.statCard, overflow: 'hidden', background: uiTokens.surface.statCard }}>
                          <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${allocationFeelNoPain === null ? 4 : 5}, minmax(0, 1fr))`, height: '100%' }}>
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>Hit</Typography>
                              <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{hitCalculationTooltip({
                                combatMode,
                                weaponSkill: weapon.skill,
                                preview: targetHitPreviewForAllocation,
                              })}</Box>}>
                                <Typography variant="caption" sx={{ color: uiTokens.color.combat.hit, fontWeight: 900, fontSize: 14, lineHeight: 1.1, cursor: 'help' }}>{allocationHitLabel}</Typography>
                              </Tooltip>
                            </Box>
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>Wound</Typography>
                              <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{woundCalculationTooltip(weapon.strength, target.profile.toughness)}</Box>}>
                                <Typography variant="caption" sx={{ color: allocationWoundColor, fontWeight: 900, fontSize: 14, lineHeight: 1.1, cursor: 'help' }}>{allocationWound}+</Typography>
                              </Tooltip>
                            </Box>
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center' }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>Save</Typography>
                              <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{saveCalculationTooltip({
                                baseSave: target.profile.save,
                                ap: weapon.ap,
                                coverBonus: allocationCoverBonus,
                                effectiveSave: allocationSaveWithCover ?? 7,
                                invulnerableSave: target.profile.invulnSave,
                                usesInvulnerable: allocationUsesInvuln,
                              })}</Box>}>
                                <Typography variant="caption" sx={{ color: allocationSaveColor, fontWeight: 900, fontSize: 14, lineHeight: 1.1, cursor: 'help' }}>{allocationSaveWithCover !== null && allocationSaveWithCover > 6 ? '—' : `${allocationSaveWithCover}+`}</Typography>
                              </Tooltip>
                            </Box>
                          {allocationFeelNoPain !== null && (
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderLeft: `1px solid ${uiTokens.border.statDivider}` }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11 }}>FNP</Typography>
                              <Typography variant="caption" sx={{ color: uiTokens.color.combat.save, fontWeight: 900, fontSize: 14, lineHeight: 1.1 }}>{allocationFeelNoPain}+</Typography>
                            </Box>
                          )}
                          <Tooltip title={estimateTooltip}>
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderLeft: `1px solid ${uiTokens.border.statDivider}`, cursor: 'help', minWidth: 0 }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Est.</Typography>
                              <Typography variant="caption" sx={{ color: estimatedModelsLost === null ? uiTokens.color.text.muted : uiTokens.color.status.warning, fontWeight: 900, fontSize: 14, lineHeight: 1.1 }}>
                                {estimatedModelsLost === null ? '—' : `~${estimatedModelsLost.toFixed(1)}`}
                              </Typography>
                            </Box>
                          </Tooltip>
                          </Box>
                        </Box>
                      )}
                      </Box>
                      {resultSection === 'attacker' && hasStructuredResult && (
                        <ShootingTargetDice result={structuredResult} weaponIndex={option.weaponIndex} targetId={targetId} />
                      )}
                    </Box>
                  );
                })}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {!hasStructuredResult && !shootingLocked && combatMode === 'ranged' && resolutionQueue.length > 1 && (
        <Box sx={{ display: 'grid', gap: 0.45, p: 1, border: `1px solid ${uiTokens.border.warning}`, borderRadius: uiTokens.radius.control, background: uiTokens.surface.pendingHud }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800 }}>
            Resolve in this order
          </Typography>
          <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingMuted, lineHeight: 1.2 }}>
            Damage from each entry is allocated in this sequence.
          </Typography>
          {resolutionQueue.map((entry, index) => (
            <Box key={`${entry.weaponIndex}:${entry.targetUnitId}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 900, minWidth: 16 }}>
                {index + 1}.
              </Typography>
              <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.option.name} → {entry.target.profile.name} ({entry.modelCount} model{entry.modelCount === 1 ? '' : 's'})
              </Typography>
              <Button
                size="small"
                aria-label={`Move ${entry.option.name} against ${entry.target.profile.name} earlier`}
                disabled={index === 0 || !onShootingResolutionOrderMove}
                onClick={() => onShootingResolutionOrderMove?.(entry.weaponIndex, entry.targetUnitId, -1)}
                sx={{ minWidth: 26, px: 0.25, lineHeight: 1 }}
              >↑</Button>
              <Button
                size="small"
                aria-label={`Move ${entry.option.name} against ${entry.target.profile.name} later`}
                disabled={index === resolutionQueue.length - 1 || !onShootingResolutionOrderMove}
                onClick={() => onShootingResolutionOrderMove?.(entry.weaponIndex, entry.targetUnitId, 1)}
                sx={{ minWidth: 26, px: 0.25, lineHeight: 1 }}
              >↓</Button>
            </Box>
          ))}
        </Box>
      )}

      {shootingLocked && resultSection !== 'attacker' && !hasStructuredResult ? (
        <Typography variant="caption" sx={warningTextSx}>
          {pendingDamageLabel
            ? `Allocate ${pendingDamageLabel} before selecting another shooter or target.`
            : 'Allocate pending damage to defender models before selecting another shooter or target.'}
        </Typography>
      ) : completedWithoutPendingDamage && !hasStructuredResult ? (
        <Typography variant="caption" sx={disabledTextSx}>No unsaved damage — no model allocation or Resolve step is required.</Typography>
      ) : combatMode === 'ranged' && shooter.movementAction === 'advanced' && !hasStructuredResult ? (
        <Typography variant="caption" sx={weaponOptions.length ? warningTextSx : disabledTextSx}>
          {weaponOptions.length
            ? 'Advanced — Assault weapons can fire this phase.'
            : 'Advanced — only weapons with Assault can fire this phase.'}
        </Typography>
      ) : noAttackSelected && !hasStructuredResult ? (
        <Typography variant="caption" sx={disabledTextSx}>This unit can be selected to {combatMode === 'melee' ? 'fight' : 'shoot'}, but will make no attacks.</Typography>
      ) : !weaponOptions.length && !displayedWeapons.length && !hasStructuredResult ? (
        <Typography variant="caption" sx={disabledTextSx}>{combatMode === 'melee' ? PLAY_PANEL_MESSAGES.noMeleeWeapons : PLAY_PANEL_MESSAGES.noRangedWeapons}</Typography>
      ) : !targets.length && !displayedWeapons.length && !hasStructuredResult ? (
        <Typography variant="caption" sx={disabledTextSx}>{combatMode === 'melee' ? PLAY_PANEL_MESSAGES.noFightTargets : PLAY_PANEL_MESSAGES.noValidTargets}</Typography>
      ) : hasStructuredResult && resultSection !== 'attacker' && displayedWeaponTargets.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: displayedWeaponTargets.length > 3 ? 310 : undefined, overflowY: displayedWeaponTargets.length > 3 ? 'auto' : undefined, paddingRight: displayedWeaponTargets.length > 3 ? 4 : undefined }}>
          {displayedWeaponTargets.map(({ weapon, target, weaponIndex }, i) => {
            const targetDistance = targetDistances?.get(target.id);
            const targetHitPreviewForStats = hitPreviewForTargetAndWeapon(target.id, weaponIndex);
            const targetCoverStatusForStats = combatMode === 'ranged'
              ? targetHitPreviewForStats?.coverStatus ?? coverStatusForTargetAndWeapon(target.id, weaponIndex)
              : 'none';
            const targetInCoverForStats = targetCoverStatusForStats === 'all';
            const wt = calcWoundTarget(weapon.strength, target.profile.toughness);
            const sv = calcEffectiveSave(target.profile.save, weapon.ap, target.profile.invulnSave);
            const usedInvuln = target.profile.invulnSave !== undefined && sv === target.profile.invulnSave;
            const noSave = sv > 6;
            const wtColor = calcWoundTargetColor(wt);
            const coverBonus = targetHitPreviewForStats
              ? targetHitPreviewForStats.commonCoverSaveModifier ?? 0
              : coverSaveEnabled && targetInCoverForStats && (target.profile.save <= 6) ? 1 : 0;
            const hitTargetLabel = hitPreviewTargetLabel(targetHitPreviewForStats);
            const svWithCover = sv - coverBonus;
            const noSaveWithCover = svWithCover > 6;
            return (
              <div key={i} style={{ background: uiTokens.surface.statCard, border: `1px solid ${uiTokens.border.statCard}`, borderRadius: uiTokens.radius.statCard, overflow: 'hidden' }}>
                {/* Weapon name */}
                <div style={{
                  padding: '4px 8px', borderBottom: `1px solid ${uiTokens.border.statCard}`,
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, fontWeight: 700, color: uiTokens.color.combat.weaponName }}>
                    <span>{weapon.name} → {target.profile.name}</span>
                    <TargetDistanceMarker distance={targetDistance} />
                  </span>
                </div>
                {/* Weapon stats remain visible alongside the resolved dice. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
                  {/* Range */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle }}>Range</div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: uiTokens.color.combat.hit, lineHeight: 1.1 }}>{weapon.range}&quot;</div>
                  </div>
                  {/* Attacks */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle }}>Attacks</div>
                    <Tooltip title="Attacks characteristic for each model assigned to this target">
                      <div style={{ fontSize: 13, fontWeight: 900, color: uiTokens.color.combat.attacks, lineHeight: 1.1, cursor: 'help' }}>{weapon.attacks}</div>
                    </Tooltip>
                  </div>
                  {/* Hit */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle }}>Hit</div>
                    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{hitCalculationTooltip({
                      combatMode,
                      weaponSkill: weapon.skill,
                      preview: targetHitPreviewForStats,
                    })}</Box>}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: uiTokens.color.combat.hit, lineHeight: 1.1, cursor: 'help' }}>{hitTargetLabel}</div>
                    </Tooltip>
                    {targetCoverStatusForStats === 'all' && !coverSaveEnabled && !targetHitPreviewForStats?.autoHits && (
                      <div style={{ fontSize: 9, color: uiTokens.color.status.warning, marginTop: 3 }}>cover -1 hit</div>
                    )}
                  </div>
                  {/* Wound */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle }}>Wound</div>
                    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{woundCalculationTooltip(weapon.strength, target.profile.toughness)}</Box>}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: wtColor, lineHeight: 1.1, cursor: 'help' }}>{wt}+</div>
                    </Tooltip>
                  </div>
                  {/* Save */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle }}>Save</div>
                    {coverBonus > 0 ? (
                      <>
                        <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{saveCalculationTooltip({
                          baseSave: target.profile.save,
                          ap: weapon.ap,
                          coverBonus,
                          effectiveSave: svWithCover,
                          invulnerableSave: target.profile.invulnSave,
                          usesInvulnerable: usedInvuln,
                        })}</Box>}>
                          <div style={{ fontSize: 13, fontWeight: 900, lineHeight: 1.1, color: uiTokens.color.combat.cover, cursor: 'help' }}>
                            {noSaveWithCover ? '—' : `${svWithCover}+`}
                          </div>
                        </Tooltip>
                        <div style={{ fontSize: 9, marginTop: 3, color: uiTokens.color.combat.coverMuted }}>
                          ⛨ cover (+{coverBonus} save)
                        </div>
                        <div style={{ fontSize: 9, color: uiTokens.color.text.subtle }}>
                          base {noSave ? 'no save' : `${sv}+`} · AP{weapon.ap}
                        </div>
                      </>
                    ) : (
                      <>
                        <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{saveCalculationTooltip({
                          baseSave: target.profile.save,
                          ap: weapon.ap,
                          coverBonus: 0,
                          effectiveSave: sv,
                          invulnerableSave: target.profile.invulnSave,
                          usesInvulnerable: usedInvuln,
                        })}</Box>}>
                          <div style={{ fontSize: 13, fontWeight: 900, lineHeight: 1.1, color: noSave ? uiTokens.color.combat.noSave : uiTokens.color.combat.save, cursor: 'help' }}>
                            {noSave ? '—' : `${sv}+`}
                          </div>
                        </Tooltip>
                        <div style={{ fontSize: 9, marginTop: 3, color: weapon.ap < 0 ? uiTokens.color.combat.apWarning : uiTokens.color.text.subtle }}>
                          AP{weapon.ap}
                        </div>
                        {targetInCoverForStats && coverSaveEnabled && (
                          <div style={{ fontSize: 9, color: uiTokens.color.text.quiet, marginTop: 2 }}>
                            ⛨ cover (no save to improve)
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {/* Damage */}
                  <div style={{ padding: '4px 3px', textAlign: 'center' }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle }}>Dmg</div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: uiTokens.color.combat.damage, lineHeight: 1.1 }}>{weapon.damage}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {resultSection !== 'attacker' && (
        <StructuredShootingResultSummary result={structuredResult} section={resultSection} />
      )}
    </CombatDeclarationPanel>
  );
}

/** Shooting owns its declaration controller; this wrapper prevents callers
 * from selecting melee behavior through the shared presentation component. */
export function ShootingCombatPanel(props: Omit<React.ComponentProps<typeof CombatPanel>, 'combatMode'>) {
  return <CombatPanel {...props} combatMode="ranged" />;
}

/** Fight owns its declaration controller; its rule state never flows through
 * the Shooting controller. */
export function FightCombatPanel(props: Omit<React.ComponentProps<typeof CombatPanel>, 'combatMode'>) {
  return <CombatPanel {...props} combatMode="melee" />;
}
