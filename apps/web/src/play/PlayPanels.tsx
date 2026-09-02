import { type ReactNode, useState } from 'react';
import { Box, Button, TextField, Tooltip, Typography } from '@mui/material';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { CommandRerollRollType, HeroicInterventionMode, StratagemDefinition } from '@warhammer-simulator/core/types/stratagem';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { estimateSequentialModelEquivalentLosses, modelGroupsForCombatEstimate } from '@warhammer-simulator/core/engine/combatEstimation';
import { battleUnitsBaseEdgeDistance, playShootingWeaponModelCount, type CombatHitPreview, type FiringDeckSelection, type PlayChargeTargetOption, type PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
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
  });
  return lines.join('\n');
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
        LOS {distance.toFixed(1)}&quot;
      </Typography>
    </Tooltip>
  );
}

export function PendingDamageAllocationHud({ unit, result, shooter, targetIds = [], selectedTargetId, onTargetSelect }: { unit: BattleUnit; result?: import('@warhammer-simulator/core/types/battle').ShootingResolution | null; shooter?: BattleUnit | null; targetIds?: string[]; selectedTargetId?: string; onTargetSelect?: (targetId: string) => void }) {
  const label = pendingDamageLabel(unit);
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
  const weaponResult = result?.weapons.find(candidate => candidate.weaponIndex === weaponIndex && candidate.targetUnitId === targetId);
  if (!weaponResult) return null;
  const groups = weaponResult.groups.filter(group => group.kind === 'hit' || group.kind === 'wound');
  if (!groups.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.25, mt: 0.25, pl: 0.5 }}>
      {groups.map((group, groupIndex) => {
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
              {orderedDice(group.rolls).map((roll, rollIndex) => {
                const success = group.target !== undefined && roll >= group.target;
                const critical = roll === 6;
                return (
                  <Box key={`${roll}-${rollIndex}`} sx={{ minWidth: 18, px: 0.35, border: `1px solid ${critical ? '#7040a0' : success ? '#2a5c2a' : '#3a1818'}`, borderRadius: 0.75, background: critical ? '#241238' : success ? '#0d260d' : '#1a0d0d', color: critical ? '#d5a6ff' : success ? '#78d786' : '#664444', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
                    {roll}
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function CombatPanel({
  shooter,
  popup = false,
  structuredResult = null,
  resultSection = 'all',
  title = PLAY_PANEL_LABELS.shooting,
  actionLabel = 'Shoot',
  pendingDamageActionLabel = 'Resolve',
  combatMode = 'ranged',
  warning,
  targets,
  resultTargets = [],
  selectedTarget,
  targetIsValid,
  coverSaveEnabled = true,
  damageAllocationLocked,
  pendingDamageLabel,
  weaponOptions,
  shootingAttackAllocations = {},
  selectedTargetId,
  selectedWeaponIndex,
  combatHitPreviews,
  targetDistances,
  onTargetChange,
  onWeaponChange,
  onShootingAttackAllocationChange = () => undefined,
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
  targets: BattleUnit[];
  resultTargets?: BattleUnit[];
  selectedTarget: BattleUnit | null;
  targetIsValid: boolean;
  coverSaveEnabled?: boolean;
  damageAllocationLocked: boolean;
  pendingDamageLabel?: string | null;
  weaponOptions: PlayShootingWeaponOption[];
  shootingAttackAllocations?: Record<string, Record<string, number>>;
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  combatHitPreviews?: Map<string, Map<number, CombatHitPreview>>;
  targetDistances?: ReadonlyMap<string, number>;
  onTargetChange: (value: string) => void;
  onWeaponChange: (value: 'all' | string) => void;
  onShootingAttackAllocationChange?: (weaponIndex: number, targetId: string, attacks: number) => void;
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
  const canResolve = resolvePendingDamage || completedWithoutPendingDamage || (!shootingLocked
    && !shooter.activated
    && weaponOptions.length > 0
    && weaponOptions.every(option => option.weaponIndex < 0 || (
      Object.values(shootingAttackAllocations[String(option.weaponIndex)] ?? {}).reduce((total, models) => total + (Number(models) || 0), 0)
      === (weaponModelCountFor?.(option.weaponIndex)
        ?? option.modelCount
        ?? playShootingWeaponModelCount(shooter, option.weaponIndex))
    )));
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
      ).map(o => shooter.profile.weapons[o.weaponIndex]).filter(Boolean)
    : [];
  const resultWeaponIndices = new Set(structuredResult?.weapons.map(result => result.weaponIndex) ?? []);
  const resultWeapons = shooter.profile.weapons.filter((_, index) => resultWeaponIndices.has(index));
  const resultTargetPool = [...targets, ...resultTargets].filter((unit, index, all) => all.findIndex(candidate => candidate.id === unit.id && candidate.side === unit.side) === index);
  const targetOrder = new Map(resultTargetPool.map((target, index) => [target.id, index]));
  const targetOrderValue = (targetId: string) => targetOrder.get(targetId) ?? Number.MAX_SAFE_INTEGER;
  const resultWeaponOptions: PlayShootingWeaponOption[] = structuredResult?.weapons
    ? Array.from(new Map(structuredResult.weapons.map(result => [result.weaponIndex, result])).values())
      .map(result => ({
        weaponIndex: result.weaponIndex,
        name: result.weaponName,
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
    .map(option => shooter.profile.weapons[option.weaponIndex])
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
  const modelCountForWeapon = (option: PlayShootingWeaponOption) => weaponModelCountFor?.(option.weaponIndex)
    ?? option.modelCount
    ?? playShootingWeaponModelCount(shooter, option.weaponIndex);
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
        const weapon = shooter.profile.weapons[result.weaponIndex];
        const target = resultTargetPool.find(candidate => candidate.id === result.targetUnitId);
        return weapon && target ? [{ weapon, target }] : [];
      }));
  const displayedWeaponTargets = resultSection === 'attacker' || resultSection === 'defender'
    ? hasStructuredResult && resultWeaponTargets.length > 0
      ? resultWeaponTargets
      : displayedWeapons.flatMap(weapon => {
        const weaponIndex = shooter.profile.weapons.indexOf(weapon);
        const option = effectiveWeaponOptions.find(candidate => candidate.weaponIndex === weaponIndex);
        const targetIds = hasStructuredResult
          ? option?.targetIds.filter(targetId => (shootingAttackAllocations[String(weaponIndex)]?.[targetId] ?? 0) > 0) ?? []
          : option?.targetIds ?? [];
        return targetIds
          .map(targetId => targets.find(target => target.id === targetId))
          .filter((target): target is BattleUnit => !!target)
          .map(target => ({ weapon, target }));
      })
    : displayedWeapons.flatMap(weapon => {
      const weaponIndex = shooter.profile.weapons.indexOf(weapon);
        const option = effectiveWeaponOptions.find(candidate => candidate.weaponIndex === weaponIndex);
      const allocatedTargetIds = option?.targetIds.filter(targetId => (shootingAttackAllocations[String(weaponIndex)]?.[targetId] ?? 0) > 0) ?? [];
      return allocatedTargetIds
        .map(targetId => targets.find(target => target.id === targetId))
        .filter((target): target is BattleUnit => !!target)
        .map(target => ({ weapon, target }));
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
      warning={warning}
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
            const weapon = shooter.profile.weapons[option.weaponIndex];
            const weaponTargets = shootingAttackAllocations[String(option.weaponIndex)] ?? {};
            const weaponModelCount = modelCountForWeapon(option);
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
                {option.targetIds.map(targetId => {
                  const target = resultTargetPool.find(candidate => candidate.id === targetId);
                  const targetDistance = target ? targetDistances?.get(target.id) : undefined;
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
                  const allocationHit = targetHitPreviewForAllocation
                    ? targetHitPreviewForAllocation.commonHitTarget ?? null
                    : weapon ? Math.min(6, weapon.skill + (targetInCoverForAllocation && !coverSaveEnabled ? 1 : 0)) : null;
                  const allocationHitLabel = targetHitPreviewForAllocation
                    ? targetHitPreviewForAllocation.autoHits
                      ? 'Auto'
                      : targetHitPreviewForAllocation.hitTargetVaries
                        ? 'Varies'
                        : targetHitPreviewForAllocation.commonHitTarget === undefined
                          ? '—'
                          : targetHitPreviewForAllocation.commonHitTarget > 6
                            ? '6*'
                            : `${targetHitPreviewForAllocation.commonHitTarget}+`
                    : allocationHit === null ? '—' : `${allocationHit}+`;
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
                  const targetModelGroups = target ? modelGroupsForCombatEstimate(target) : [];
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
                    : 'Estimated model-equivalent casualties are unavailable.';
                  return (
                    <Box key={`${option.weaponIndex}:${targetId}`} sx={{ display: 'grid', gap: 0.25 }}>
                      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 0.75 }}>
                        <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700, overflowWrap: 'anywhere', minWidth: 0 }}>
                          {target?.profile.name ?? targetId}
                        </Typography>
                        <TargetDistanceMarker distance={targetDistance} />
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
                      <Box sx={{ minWidth: 120, flex: '0 0 120px', display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          aria-label={`Decrease allocation to ${target?.profile.name ?? targetId}`}
                          disabled={allocationsReadOnly || allocationCount <= 0}
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
                          disabled={allocationsReadOnly}
                          sx={{ flex: 1, '& input::-webkit-inner-spin-button': { appearance: 'none', margin: 0 } }}
                          slotProps={{ htmlInput: { min: 0, max: allocationMax, step: 1 } }}
                          onChange={event => onShootingAttackAllocationChange(option.weaponIndex, targetId, Math.max(0, Math.min(allocationMax, Math.floor(Number(event.target.value) || 0))))}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          aria-label={`Increase allocation to ${target?.profile.name ?? targetId}`}
                          disabled={allocationsReadOnly || allocationCount >= allocationMax}
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
          {displayedWeaponTargets.map(({ weapon, target }, i) => {
            const targetDistance = targetDistances?.get(target.id);
            const targetHitPreviewForStats = hitPreviewForTargetAndWeapon(target.id, shooter.profile.weapons.indexOf(weapon));
            const targetCoverStatusForStats = combatMode === 'ranged'
              ? targetHitPreviewForStats?.coverStatus ?? coverStatusForTargetAndWeapon(target.id, shooter.profile.weapons.indexOf(weapon))
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
            const hitTarget = targetHitPreviewForStats
              ? targetHitPreviewForStats.commonHitTarget ?? null
              : Math.min(6, weapon.skill + (targetInCoverForStats && !coverSaveEnabled ? 1 : 0));
            const hitTargetLabel = targetHitPreviewForStats
              ? targetHitPreviewForStats.autoHits
                ? 'Auto'
                : targetHitPreviewForStats.hitTargetVaries
                  ? 'Varies'
                  : targetHitPreviewForStats.commonHitTarget === undefined
                    ? '—'
                    : targetHitPreviewForStats.commonHitTarget > 6
                      ? '6*'
                      : `${targetHitPreviewForStats.commonHitTarget}+`
              : hitTarget === null ? '—' : `${hitTarget}+`;
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
