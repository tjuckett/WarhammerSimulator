import { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Tooltip, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { CommandRerollRollType, HeroicInterventionMode, StratagemDefinition } from '@warhammer-simulator/core/types/stratagem';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { battleUnitsBaseEdgeDistance, playShootingWeaponModelCount, type FiringDeckSelection, type PlayChargeTargetOption, type PlayFightWeaponOption, type PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import { explosivesTargetAllowed } from '@warhammer-simulator/core/engine/stratagems';
import { rulesEditionForRuleset, weaponHasKeyword } from '@warhammer-simulator/core/engine/rulesEngine';
import {
  abilityOptionKey,
  abilityTimingLabel,
  calcEffectiveSave,
  calcWoundTarget,
  calcWoundTargetColor,
  parseDiceInput,
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
export { PlayTacticsPanel } from './PlayTacticsPanel';
export { PlayChargePanel } from './PlayChargePanel';
export { PlayFightPanel } from './PlayFightPanel';

export function PendingDamageAllocationHud({ unit, result }: { unit: BattleUnit; result?: import('@warhammer-simulator/core/types/battle').ShootingResolution | null }) {
  const label = pendingDamageLabel(unit);
  if (!label) return null;
  const damageByWeapon = new Map<string, number[]>();
  for (const allocation of unit.pendingDamageAllocations ?? []) {
    const weapon = allocation.source ?? 'Unattributed attack';
    damageByWeapon.set(weapon, [...(damageByWeapon.get(weapon) ?? []), allocation.damage]);
  }
  const forcedModel = unit.woundedModelIndex !== undefined
    ? `Model ${unit.woundedModelIndex + 1} is already wounded and must take this.`
    : 'Click a defender model to apply it.';

  return (
    <Box sx={{
      minWidth: 210,
      maxWidth: 280,
      p: 1,
      border: `1px solid ${uiTokens.border.warning}`,
      background: uiTokens.surface.pendingHud,
      boxShadow: uiTokens.shadow.pendingHud,
      display: 'grid',
      gap: 0.35,
    }}>
      <StructuredShootingResultSummary result={result} section="defender" />
      <Typography variant="caption" sx={{ color: uiTokens.color.status.pending, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 }}>
        Damage to apply
      </Typography>
      {[...damageByWeapon.entries()].map(([weapon, damages]) => (
        <Box key={weapon} sx={{ display: 'grid', gap: 0.25 }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800, lineHeight: 1.15 }}>
            {weapon}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.4, flexWrap: 'wrap' }}>
            {damages.map((damage, index) => (
              <Box key={`${weapon}-${index}`} sx={{ minWidth: 25, height: 25, px: 0.45, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${uiTokens.color.combat.damage}`, borderRadius: 0.75, background: 'rgba(155, 143, 212, 0.18)', color: uiTokens.color.combat.damage, fontWeight: 900, fontSize: 13 }}>
                {damage}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
      {!damageByWeapon.size && (
        <Typography variant="body2" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800, lineHeight: 1.15 }}>
          {label}
        </Typography>
      )}
      <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingMuted, lineHeight: 1.2 }}>
        {forcedModel} Each hit's damage applies to one model; excess damage does not carry over.
      </Typography>
    </Box>
  );
}
/* Legacy log-derived shooting result code removed from runtime.

    const weaponMatch = normalizedMessage.match(/^.+?\s+(.+?)\s+[—-]\s+\d+\s+model/);
    if (weaponMatch) currentWeapon = weaponMatch[1].trim();
    // legacy parser removed
    const group = normalizedMessage.startsWith('Hit rolls')
      ? 'Hit rolls'
      : normalizedMessage.startsWith('Wound rolls') || normalizedMessage.startsWith('Twin-linked wound rerolls')
        ? 'Wound rolls'
      : normalizedMessage.startsWith('Save rolls')
          ? 'Save rolls'
          : normalizedMessage.startsWith('Feel No Pain')
            ? 'Feel No Pain'
            : normalizedMessage.startsWith('Damage roll') ? 'Damage rolls' : null;
    const isAttackerGroup = group === 'Hit rolls' || group === 'Wound rolls';
    const isDefenderGroup = group === 'Save rolls' || group === 'Feel No Pain' || group === 'Damage rolls';
    if (section !== 'attacker' && normalizedMessage.startsWith('No save possible')) {
      const key = `${currentWeapon}::Save rolls`;
      groups.set(key, groups.get(key) ?? []);
      noSave.add(key);
      continue;
    }
    if ((section === 'attacker' && !isAttackerGroup) || (section === 'defender' && !isDefenderGroup)) continue;
    if (group) {
      const key = `${currentWeapon}::${group}`;
      if (rolls.length) groups.set(key, [...(groups.get(key) ?? []), ...rolls]);
      targets.set(key, normalizedMessage.match(/(?:^|[(,\s])(\d+)\+/)?.[1]);
      const resultCount = normalizedMessage.match(/\]\s*(?:→|->)\s*(\d+)\s+(hits|wounds|saved|ignored)/)?.[1];
      if (resultCount) successes.set(key, (successes.get(key) ?? 0) + Number(resultCount));
      if (group === 'Wound rolls' && resultCount) addWoundSummary(Number(resultCount));
    }
  }
  return {
    groups: [...groups.entries()].map(([key, rolls]) => {
      const [weaponName, label] = key.split('::');
      return {
        label: weaponName ? `${weaponName} · ${label}` : label,
        baseLabel: label,
        target: targets.get(key),
        rolls: [...rolls].sort((a, b) => b - a),
        successCount: successes.get(key),
        noSave: noSave.has(key),
      };
    }).filter(group => group.rolls.length || group.noSave),
    woundSummary: [...woundSummary.entries()].map(([target, byAp]) => ({
      target,
      entries: [...byAp.entries()].map(([ap, wounds]) => ({ ap, wounds })),
    })),
  };
}

function ShootingResultSummary({ entries, section = 'all', weaponNames = [] }: { entries: LogEntry[]; section?: 'attacker' | 'defender' | 'all'; weaponNames?: string[] }) {
  if (!entries.length) return null;
  const result = shootingResultSummary(entries, section, weaponNames);
  if (!result.groups.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.5, pt: 0.75, pb: 0.5, mb: 0.5, borderTop: `1px solid ${uiTokens.border.control}` }}>
      <Typography variant="caption" sx={{ color: uiTokens.color.text.secondary, fontWeight: 800 }}>Latest shooting result</Typography>
      {result.groups.map(group => (
        <Box key={group.label} sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, width: '100%' }}>
            {group.label}
            {group.noSave ? ' - No save possible' : null}
            {group.successCount !== undefined && ` - ${group.rolls.length} roll${group.rolls.length === 1 ? '' : 's'} - ${group.successCount} ${group.baseLabel === 'Hit rolls' ? 'hit' : group.baseLabel === 'Wound rolls' ? 'wound' : group.baseLabel === 'Save rolls' ? 'saved' : group.baseLabel === 'Damage rolls' ? 'damage' : 'ignored'}${group.successCount === 1 ? '' : 's'}`}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
            {group.rolls.map((roll, index) => {
              const target = Number(group.target ?? 7);
              const success = roll >= target;
              const critical = group.baseLabel !== 'Save rolls' && group.baseLabel !== 'Feel No Pain' && roll === 6;
              return (
                <Box key={`${group.label}-${index}`} sx={{
                  minWidth: 18,
                  px: 0.35,
                  border: `1px solid ${critical ? '#7040a0' : success ? '#2a5c2a' : group.baseLabel === 'Save rolls' ? '#6b3800' : '#3a1818'}`,
                  borderRadius: 0.75,
                  background: critical ? '#241238' : success ? '#0d260d' : group.baseLabel === 'Save rolls' ? '#2a1500' : '#1a0d0d',
                  color: critical ? '#d5a6ff' : success ? '#78d786' : group.baseLabel === 'Save rolls' || group.baseLabel === 'Feel No Pain' ? '#d07030' : group.baseLabel === 'Damage rolls' ? uiTokens.color.combat.damage : '#664444',
                  textAlign: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                }}>{roll}</Box>
              );
            })}
          </Box>
        </Box>
      ))}
      {section !== 'defender' && result.woundSummary.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.35, mt: 0.5, p: 0.75, border: `1px solid ${uiTokens.border.warning}`, borderRadius: uiTokens.radius.control, background: uiTokens.surface.pendingHud }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.status.warning, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Wounds before saves</Typography>
          {result.woundSummary.map(summary => (
            <Typography key={summary.target} variant="body2" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 900, lineHeight: 1.25 }}>
              {summary.target} — {summary.entries.map(entry => `${entry.ap}: ${entry.wounds} wound${entry.wounds === 1 ? '' : 's'}`).join('; ')}
            </Typography>
          ))}
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, lineHeight: 1.2 }}>
            Resolve appears only for wounds that fail their saves or have no save possible.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

*/

export function PlayShootingPanel({
  shooter,
  popup = false,
  structuredResult = null,
  resultSection = 'all',
  title = PLAY_PANEL_LABELS.shooting,
  actionLabel = 'Shoot',
  targets,
  selectedTarget,
  targetIsValid,
  coverSaveEnabled = true,
  damageAllocationLocked,
  pendingDamageLabel,
  weaponOptions,
  shootingAttackAllocations = {},
  selectedTargetId,
  selectedWeaponIndex,
  coverUnitIds,
  onTargetChange,
  onWeaponChange,
  onShootingAttackAllocationChange = () => undefined,
  firingDeckOptions = [],
  firingDeckCapacity = 0,
  onFiringDeckSelect,
  onResolve,
}: {
  shooter: BattleUnit | null;
  popup?: boolean;
  structuredResult?: import('@warhammer-simulator/core/types/battle').ShootingResolution | null;
  resultSection?: 'attacker' | 'defender' | 'all';
  title?: string;
  actionLabel?: string;
  targets: BattleUnit[];
  selectedTarget: BattleUnit | null;
  targetIsValid: boolean;
  coverSaveEnabled?: boolean;
  damageAllocationLocked: boolean;
  pendingDamageLabel?: string | null;
  weaponOptions: PlayShootingWeaponOption[];
  shootingAttackAllocations?: Record<string, Record<string, number>>;
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  coverUnitIds?: Set<string>;
  onTargetChange: (value: string) => void;
  onWeaponChange: (value: 'all' | string) => void;
  onShootingAttackAllocationChange?: (weaponIndex: number, targetId: string, attacks: number) => void;
  firingDeckOptions?: FiringDeckSelection[];
  firingDeckCapacity?: number;
  onFiringDeckSelect?: (selections: FiringDeckSelection[]) => void;
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
  const resolvePendingDamage = shootingLocked && hasStructuredResult;
  const completedWithoutPendingDamage = hasStructuredResult && !shootingLocked;
  const noAttackSelected = selectedWeaponIndex !== 'all'
    && weaponOptions.some(option => String(option.weaponIndex) === selectedWeaponIndex && option.weaponIndex < 0);
  const canResolve = resolvePendingDamage || completedWithoutPendingDamage || (!shootingLocked
    && !shooter.activated
    && weaponOptions.length > 0
    && weaponOptions.every(option => option.weaponIndex < 0 || (
      Object.values(shootingAttackAllocations[String(option.weaponIndex)] ?? {}).reduce((total, models) => total + (Number(models) || 0), 0)
      === playShootingWeaponModelCount(shooter, option.weaponIndex)
    )));
  const targetInCover = !!(selectedTarget && coverUnitIds?.has(selectedTarget.id));

  const refWeapons = selectedTarget && targetIsValid
    ? (selectedWeaponIndex === 'all'
        ? weaponOptions.filter(o => o.targetIds.includes(selectedTargetId))
        : weaponOptions.filter(o => String(o.weaponIndex) === selectedWeaponIndex && o.targetIds.includes(selectedTargetId))
      ).map(o => shooter.profile.weapons[o.weaponIndex]).filter(Boolean)
    : [];
  const resultWeaponIndices = new Set(structuredResult?.weapons.map(result => result.weaponIndex) ?? []);
  const resultWeapons = shooter.profile.weapons.filter((_, index) => resultWeaponIndices.has(index));
  const availableWeapons = weaponOptions
    .filter(option => option.weaponIndex >= 0)
    .map(option => shooter.profile.weapons[option.weaponIndex])
    .filter((weapon): weapon is BattleUnit['profile']['weapons'][number] => !!weapon);
  const displayedWeaponOptions = weaponOptions;
  const displayedWeaponIndex = selectedWeaponIndex;
  const displayedWeapons = resultSection === 'attacker' && hasStructuredResult && resultWeapons.length
    ? resultWeapons
    : availableWeapons.length
      ? availableWeapons
      : refWeapons;
  const resultWeaponTargets = (structuredResult?.weapons ?? []).flatMap(result => {
    const weapon = shooter.profile.weapons[result.weaponIndex];
    const target = targets.find(candidate => candidate.id === result.targetUnitId);
    return weapon && target ? [{ weapon, target }] : [];
  });
  const displayedWeaponTargets = resultSection === 'attacker' || resultSection === 'defender'
    ? hasStructuredResult && resultWeaponTargets.length > 0
      ? resultWeaponTargets
      : displayedWeapons.flatMap(weapon => {
        const weaponIndex = shooter.profile.weapons.indexOf(weapon);
        const option = weaponOptions.find(candidate => candidate.weaponIndex === weaponIndex);
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
      const option = weaponOptions.find(candidate => candidate.weaponIndex === weaponIndex);
      const allocatedTargetIds = option?.targetIds.filter(targetId => (shootingAttackAllocations[String(weaponIndex)]?.[targetId] ?? 0) > 0) ?? [];
      return allocatedTargetIds
        .map(targetId => targets.find(target => target.id === targetId))
        .filter((target): target is BattleUnit => !!target)
        .map(target => ({ weapon, target }));
    });

  return (
    <Box sx={popup ? popupPanelSx : playPanelSx}>
      {firingDeckOptions.length > 0 && onFiringDeckSelect && (
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography variant="caption">Firing Deck: select up to {firingDeckCapacity} embarked model{firingDeckCapacity === 1 ? '' : 's'}.</Typography>
          {firingDeckOptions.map(option => {
            const key = `${option.passengerRosterId}:${option.modelIndex}:${option.weaponIndex}`;
            const modelPrefix = `${option.passengerRosterId}:${option.modelIndex}:`;
            const selected = firingDeckKeys.includes(key);
            const anotherForModel = firingDeckKeys.some(candidate => candidate.startsWith(modelPrefix) && candidate !== key);
            return (
              <Button key={key} size="small" variant={selected ? 'contained' : 'outlined'} disabled={!selected && (anotherForModel || firingDeckKeys.length >= firingDeckCapacity)} onClick={() => setFiringDeckKeys(current => selected ? current.filter(candidate => candidate !== key) : [...current, key])}>
                {option.passengerName ?? option.passengerRosterId} model {option.modelIndex + 1}: {option.weaponName ?? `weapon ${option.weaponIndex + 1}`}
              </Button>
            );
          })}
          <Button size="small" color="secondary" variant="contained" onClick={() => onFiringDeckSelect(firingDeckOptions.filter(option => firingDeckKeys.includes(`${option.passengerRosterId}:${option.modelIndex}:${option.weaponIndex}`)))}>
            Confirm Firing Deck
          </Button>
        </Box>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
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
          startIcon={<CasinoOutlinedIcon />}
          onClick={onResolve}
          disabled={!canResolve}
        >
          {resolvePendingDamage ? 'Resolve' : actionLabel}
        </Button>
      </Box>

      <FormControl size="small" fullWidth disabled={shootingLocked || !weaponOptions.length || shooter.activated}>
        <InputLabel id="play-shooting-weapon-label">{PLAY_PANEL_LABELS.weapon}</InputLabel>
        <Select
          labelId="play-shooting-weapon-label"
          label={PLAY_PANEL_LABELS.weapon}
          value={displayedWeaponIndex}
          onChange={(event: SelectChangeEvent) => onWeaponChange(event.target.value as 'all' | string)}
        >
          <MenuItem value="all">All eligible ranged weapons</MenuItem>
          {displayedWeaponOptions.map(option => (
            <MenuItem key={option.weaponIndex} value={String(option.weaponIndex)}>
              {option.name} ({shooter.profile.weapons[option.weaponIndex]?.range ?? 0}&quot;)
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {!shootingLocked && !shooter.activated && weaponOptions.some(option => option.weaponIndex >= 0) && (
        <Box sx={{ display: 'grid', gap: 0.75, p: 1, border: `1px solid ${uiTokens.border.control}`, borderRadius: uiTokens.radius.control }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
            Lock every ranged weapon target before rolling
          </Typography>
          {weaponOptions.filter(option => option.weaponIndex >= 0).map(option => {
            const weapon = shooter.profile.weapons[option.weaponIndex];
            const weaponTargets = shootingAttackAllocations[String(option.weaponIndex)] ?? {};
            const weaponModelCount = weapon ? playShootingWeaponModelCount(shooter, option.weaponIndex) : 0;
            return (
              <Box key={option.weaponIndex} sx={{ display: 'grid', gap: 0.4 }}>
                <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700 }}>
                  {option.name} — {Object.values(weaponTargets).reduce((total, models) => total + (Number(models) || 0), 0)}/{weaponModelCount} assigned
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: `1px solid ${uiTokens.border.statCard}`, borderRadius: uiTokens.radius.statCard, overflow: 'hidden', background: uiTokens.surface.statCard }}>
                  <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>Range</Typography>
                    <Typography variant="caption" sx={{ color: uiTokens.color.combat.hit, fontWeight: 900 }}>{weapon.range}&quot;</Typography>
                  </Box>
                  <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>Attacks</Typography>
                    <Typography variant="caption" sx={{ color: uiTokens.color.combat.attacks, fontWeight: 900 }}>{weapon.attacks}</Typography>
                  </Box>
                  <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>Dmg</Typography>
                    <Typography variant="caption" sx={{ color: uiTokens.color.combat.damage, fontWeight: 900 }}>{weapon.damage}</Typography>
                  </Box>
                </Box>
                <Box sx={option.targetIds.length > 3 ? { maxHeight: 210, overflowY: 'auto', display: 'grid', gap: 0.6, pr: 0.5 } : { display: 'grid', gap: 0.6 }}>
                {option.targetIds.map(targetId => {
                  const target = targets.find(candidate => candidate.id === targetId);
                  const allocatedElsewhere = Object.entries(weaponTargets)
                    .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
                    .reduce((total, [, models]) => total + (Number(models) || 0), 0);
                  const allocationCount = Number(weaponTargets[targetId] ?? 0);
                  const allocationMax = Math.max(0, weaponModelCount - allocatedElsewhere);
                  const targetInCoverForAllocation = !!target && coverUnitIds?.has(target.id);
                  const allocationWound = target ? calcWoundTarget(weapon.strength, target.profile.toughness) : null;
                  const allocationSave = target ? calcEffectiveSave(target.profile.save, weapon.ap, target.profile.invulnSave) : null;
                  const allocationCoverBonus = target && coverSaveEnabled && targetInCoverForAllocation && target.profile.save <= 6 ? 1 : 0;
                  const allocationHit = weapon ? Math.min(6, weapon.skill + (targetInCoverForAllocation && !coverSaveEnabled ? 1 : 0)) : null;
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
                  const hitChance = allocationHit === null ? 0 : Math.max(0, (7 - allocationHit) / 6);
                  const woundChance = allocationWound === null ? 0 : Math.max(0, (7 - allocationWound) / 6);
                  const saveFailureChance = allocationSaveWithCover === null || allocationSaveWithCover > 6
                    ? 1
                    : Math.max(0, (allocationSaveWithCover - 1) / 6);
                  const feelNoPainDamageChance = allocationFeelNoPain === null ? 1 : Math.max(0, (allocationFeelNoPain - 1) / 6);
                  const targetModelWounds = target?.profile.wounds ?? 1;
                  const damageCanCarryOver = weapon ? weaponHasKeyword(weapon, 'Devastating Wounds') : false;
                  const expectedDamagePerUnsavedAttack = averageDamage === null
                    ? null
                    : (damageCanCarryOver ? averageDamage : Math.min(averageDamage, targetModelWounds));
                  const expectedDamage = averageAttacks !== null && averageDamage !== null
                    ? allocatedModelCount * averageAttacks * hitChance * woundChance * saveFailureChance * feelNoPainDamageChance * (expectedDamagePerUnsavedAttack ?? averageDamage)
                    : null;
                  const estimatedModelsLost = expectedDamage !== null && target
                    ? Math.min(target.remainingModels, expectedDamage / Math.max(1, targetModelWounds))
                    : null;
                  return (
                    <Box key={`${option.weaponIndex}:${targetId}`} sx={{ display: 'grid', gap: 0.25 }}>
                      <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700, overflowWrap: 'anywhere' }}>
                        {target?.profile.name ?? targetId}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'stretch' }}>
                      <Box sx={{ minWidth: 120, flex: '0 0 120px', display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          aria-label={`Decrease allocation to ${target?.profile.name ?? targetId}`}
                          disabled={allocationCount <= 0}
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
                          sx={{ flex: 1, '& input::-webkit-inner-spin-button': { appearance: 'none', margin: 0 } }}
                          slotProps={{ htmlInput: { min: 0, max: allocationMax, step: 1 } }}
                          onChange={event => onShootingAttackAllocationChange(option.weaponIndex, targetId, Math.max(0, Math.min(allocationMax, Math.floor(Number(event.target.value) || 0))))}
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          aria-label={`Increase allocation to ${target?.profile.name ?? targetId}`}
                          disabled={allocationCount >= allocationMax}
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
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>Hit</Typography>
                              <Typography variant="caption" sx={{ color: uiTokens.color.combat.hit, fontWeight: 900 }}>{allocationHit}+</Typography>
                            </Box>
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>Wound</Typography>
                              <Typography variant="caption" sx={{ color: allocationWoundColor, fontWeight: 900 }}>{allocationWound}+</Typography>
                            </Box>
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center' }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>Save{allocationUsesInvuln ? ' (inv)' : ''}</Typography>
                              <Typography variant="caption" sx={{ color: allocationSaveColor, fontWeight: 900 }}>{allocationSaveWithCover !== null && allocationSaveWithCover > 6 ? '—' : `${allocationSaveWithCover}+`}</Typography>
                            </Box>
                          {allocationFeelNoPain !== null && (
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderLeft: `1px solid ${uiTokens.border.statDivider}` }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9 }}>FNP</Typography>
                              <Typography variant="caption" sx={{ color: uiTokens.color.combat.save, fontWeight: 900 }}>{allocationFeelNoPain}+</Typography>
                            </Box>
                          )}
                          <Tooltip title="Approximate expected model losses. Normal weapon damage is capped at the target model's wounds because excess damage does not spill over; mortal-wound damage can carry over. Actual dice results may vary.">
                            <Box sx={{ px: 0.35, py: 0.45, textAlign: 'center', borderLeft: `1px solid ${uiTokens.border.statDivider}`, cursor: 'help', minWidth: 0 }}>
                              <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Est.</Typography>
                              <Typography variant="caption" sx={{ color: estimatedModelsLost === null ? uiTokens.color.text.muted : uiTokens.color.status.warning, fontWeight: 900 }}>
                                {estimatedModelsLost === null ? '—' : `~${estimatedModelsLost.toFixed(1)}`}
                              </Typography>
                            </Box>
                          </Tooltip>
                          </Box>
                        </Box>
                      )}
                      </Box>
                    </Box>
                  );
                })}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {shootingLocked && resultSection !== 'attacker' ? (
        <Typography variant="caption" sx={warningTextSx}>
          {pendingDamageLabel
            ? `Allocate ${pendingDamageLabel} before selecting another shooter or target.`
            : 'Allocate pending damage to defender models before selecting another shooter or target.'}
        </Typography>
      ) : completedWithoutPendingDamage ? (
        <Typography variant="caption" sx={disabledTextSx}>No unsaved damage — no model allocation or Resolve step is required.</Typography>
      ) : shooter.movementAction === 'advanced' ? (
        <Typography variant="caption" sx={weaponOptions.length ? warningTextSx : disabledTextSx}>
          {weaponOptions.length
            ? 'Advanced — Assault weapons can fire this phase.'
            : 'Advanced — only weapons with Assault can fire this phase.'}
        </Typography>
      ) : noAttackSelected ? (
        <Typography variant="caption" sx={disabledTextSx}>This unit can be selected to shoot, but will make no attacks.</Typography>
      ) : !weaponOptions.length && !displayedWeapons.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noRangedWeapons}</Typography>
      ) : !targets.length && !displayedWeapons.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noValidTargets}</Typography>
      ) : hasStructuredResult && displayedWeaponTargets.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: displayedWeaponTargets.length > 3 ? 310 : undefined, overflowY: displayedWeaponTargets.length > 3 ? 'auto' : undefined, paddingRight: displayedWeaponTargets.length > 3 ? 4 : undefined }}>
          {displayedWeaponTargets.map(({ weapon, target }, i) => {
            const targetInCoverForStats = !!coverUnitIds?.has(target.id);
            const wt = calcWoundTarget(weapon.strength, target.profile.toughness);
            const sv = calcEffectiveSave(target.profile.save, weapon.ap, target.profile.invulnSave);
            const usedInvuln = target.profile.invulnSave !== undefined && sv === target.profile.invulnSave;
            const noSave = sv > 6;
            const wtColor = calcWoundTargetColor(wt);
            const coverBonus = coverSaveEnabled && targetInCoverForStats && (target.profile.save <= 6) ? 1 : 0;
            const hitTarget = Math.min(6, weapon.skill + (targetInCoverForStats && !coverSaveEnabled ? 1 : 0));
            const svWithCover = sv - coverBonus;
            const noSaveWithCover = svWithCover > 6;
            return (
              <div key={i} style={{ background: uiTokens.surface.statCard, border: `1px solid ${uiTokens.border.statCard}`, borderRadius: uiTokens.radius.statCard, overflow: 'hidden' }}>
                {/* Weapon name */}
                <div style={{
                  padding: '5px 10px', borderBottom: `1px solid ${uiTokens.border.statCard}`,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: uiTokens.color.combat.weaponName }}>{weapon.name} → {target.profile.name}</span>
                </div>
                {/* Threshold grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr' }}>
                  {/* Attacks */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Attacks</div>
                    <Tooltip title="Attacks characteristic for each model assigned to this target">
                      <div style={{ fontSize: 22, fontWeight: 800, color: uiTokens.color.combat.attacks, lineHeight: 1, cursor: 'help' }}>{weapon.attacks}</div>
                    </Tooltip>
                  </div>
                  {/* Hit */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Hit</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: uiTokens.color.combat.hit, lineHeight: 1 }}>{hitTarget}+</div>
                    {targetInCoverForStats && !coverSaveEnabled && (
                      <div style={{ fontSize: 9, color: uiTokens.color.status.warning, marginTop: 3 }}>cover -1 hit</div>
                    )}
                  </div>
                  {/* Wound */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Wound</div>
                    <Tooltip title={`Strength ${weapon.strength} versus Toughness ${target.profile.toughness}`}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: wtColor, lineHeight: 1, cursor: 'help' }}>{wt}+</div>
                    </Tooltip>
                  </div>
                  {/* Save */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Save</div>
                    {coverBonus > 0 ? (
                      <>
                        <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: uiTokens.color.combat.cover }}>
                          {noSaveWithCover ? '—' : `${svWithCover}+`}
                        </div>
                        <div style={{ fontSize: 9, marginTop: 3, color: uiTokens.color.combat.coverMuted }}>
                          ⛨ cover (+{coverBonus} save)
                        </div>
                        <div style={{ fontSize: 9, color: uiTokens.color.text.subtle }}>
                          base {noSave ? 'no save' : `${sv}+`} · AP{weapon.ap}{usedInvuln ? ' ★inv' : ''}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: noSave ? uiTokens.color.combat.noSave : uiTokens.color.combat.save }}>
                          {noSave ? '—' : `${sv}+`}
                        </div>
                        <div style={{ fontSize: 9, marginTop: 3, color: weapon.ap < 0 ? uiTokens.color.combat.apWarning : uiTokens.color.text.subtle }}>
                          AP{weapon.ap}{usedInvuln ? ' ★inv' : ''}
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
                  <div style={{ padding: '8px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Dmg</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: uiTokens.color.combat.damage, lineHeight: 1 }}>{weapon.damage}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <StructuredShootingResultSummary result={structuredResult} section={resultSection} />
    </Box>
  );
}
