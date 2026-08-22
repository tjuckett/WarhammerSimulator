import { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { LogEntry } from '@warhammer-simulator/core/types/battle';
import type { CommandRerollRollType, HeroicInterventionMode, StratagemDefinition } from '@warhammer-simulator/core/types/stratagem';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { battleUnitsBaseEdgeDistance, playShootingWeaponModelCount, type FiringDeckSelection, type PlayChargeTargetOption, type PlayFightWeaponOption, type PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import { explosivesTargetAllowed } from '@warhammer-simulator/core/engine/stratagems';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
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

const PLAY_PANEL_LABELS = {
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

const PLAY_PANEL_MESSAGES = {
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

const panelTitleSx = { fontWeight: 800, color: uiTokens.color.text.primary };
const mutedTextSx = { color: uiTokens.color.text.muted };
const disabledTextSx = { color: uiTokens.color.text.disabled };
const warningTextSx = { color: uiTokens.color.status.warning };

export function PendingDamageAllocationHud({ unit, resultEntries = [], weaponNames = [] }: { unit: BattleUnit; resultEntries?: LogEntry[]; weaponNames?: string[] }) {
  const label = pendingDamageLabel(unit);
  if (!label) return null;
  const damageByWeapon = new Map<string, { hits: number; damage: number }>();
  for (const allocation of unit.pendingDamageAllocations ?? []) {
    const weapon = allocation.source ?? 'Unattributed attack';
    const current = damageByWeapon.get(weapon) ?? { hits: 0, damage: 0 };
    current.hits += 1;
    current.damage += allocation.damage;
    damageByWeapon.set(weapon, current);
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
      <ShootingResultSummary entries={resultEntries} section="defender" weaponNames={weaponNames} />
      <Typography variant="caption" sx={{ color: uiTokens.color.status.pending, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 }}>
        Damage to apply
      </Typography>
      {[...damageByWeapon.entries()].map(([weapon, summary]) => (
        <Typography key={weapon} variant="body2" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800, lineHeight: 1.15 }}>
          {weapon}: {summary.hits} hit{summary.hits === 1 ? '' : 's'} × {summary.damage} damage
        </Typography>
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

const playPanelSx = {
  border: `1px solid ${uiTokens.border.subtle}`,
  borderRadius: uiTokens.radius.panel,
  background: uiTokens.surface.panel,
  padding: 1.25,
  display: 'grid',
  gap: 1,
};

const popupPanelSx = {
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  padding: 0,
  boxShadow: 'none',
  display: 'grid',
  gap: 1,
};

function shootingResultSummary(entries: LogEntry[], section: 'attacker' | 'defender' | 'all' = 'all', weaponNames: string[] = []) {
  const groups = new Map<string, number[]>();
  const successes = new Map<string, number>();
  const targets = new Map<string, string | undefined>();
  const noSave = new Set<string>();
  const woundSummary = new Map<string, Map<string, number>>();
  let currentWeapon = '';
  let currentTarget = '';
  let currentAp: string | null = null;
  const addWoundSummary = (count: number) => {
    if (!count || !currentTarget) return;
    const byAp = woundSummary.get(currentTarget) ?? new Map<string, number>();
    const apLabel = currentAp === null ? 'AP unknown' : `AP${Number(currentAp) > 0 ? '+' : ''}${currentAp}`;
    byAp.set(apLabel, (byAp.get(apLabel) ?? 0) + count);
    woundSummary.set(currentTarget, byAp);
  };
  for (const entry of entries) {
    const message = entry.message;
    const normalizedMessage = message.trim();
    const weaponFromHeader = normalizedMessage.includes('attacks vs')
      ? weaponNames.find(name => normalizedMessage.includes(name))
      : undefined;
    if (weaponFromHeader) currentWeapon = weaponFromHeader;
    const targetFromHeader = normalizedMessage.match(/attacks vs\s+(.+)$/)?.[1];
    if (targetFromHeader) currentTarget = targetFromHeader.trim();
    const apFromStats = normalizedMessage.match(/\bap=(-?\d+)/)?.[1];
    if (apFromStats) currentAp = apFromStats;
    const lethalWounds = normalizedMessage.match(/^Lethal Hits:\s*(\d+)/)?.[1];
    const devastatingWounds = normalizedMessage.match(/^Devastating Wounds:\s*(\d+) wound/)?.[1];
    addWoundSummary(Number(lethalWounds ?? devastatingWounds ?? 0));
    const weaponMatch = normalizedMessage.match(/^.+?\s+(.+?)\s+[—-]\s+\d+\s+model/);
    if (weaponMatch) currentWeapon = weaponMatch[1].trim();
    const rolls = message.match(/\[([^\]]*)\]/)?.[1]
      ?.split(',').map(value => Number(value.trim())).filter(Number.isFinite) ?? [];
    const group = normalizedMessage.startsWith('Hit rolls')
      ? 'Hit rolls'
      : normalizedMessage.startsWith('Wound rolls') || normalizedMessage.startsWith('Twin-linked wound rerolls')
        ? 'Wound rolls'
        : normalizedMessage.startsWith('Save rolls')
          ? 'Save rolls'
          : normalizedMessage.startsWith('Feel No Pain') ? 'Feel No Pain' : null;
    const isAttackerGroup = group === 'Hit rolls' || group === 'Wound rolls';
    const isDefenderGroup = group === 'Save rolls' || group === 'Feel No Pain';
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
            {group.successCount !== undefined && ` - ${group.rolls.length} roll${group.rolls.length === 1 ? '' : 's'} - ${group.successCount} ${group.baseLabel === 'Hit rolls' ? 'hit' : group.baseLabel === 'Wound rolls' ? 'wound' : group.baseLabel === 'Save rolls' ? 'saved' : 'ignored'}${group.successCount === 1 ? '' : 's'}`}
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
                  color: critical ? '#d5a6ff' : success ? '#78d786' : group.baseLabel === 'Save rolls' || group.baseLabel === 'Feel No Pain' ? '#d07030' : '#664444',
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
          <Typography variant="caption" sx={{ color: uiTokens.color.status.warning, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Wounds by target</Typography>
          {result.woundSummary.map(summary => (
            <Typography key={summary.target} variant="body2" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 900, lineHeight: 1.25 }}>
              {summary.target} — {summary.entries.map(entry => `${entry.ap}: ${entry.wounds} wound${entry.wounds === 1 ? '' : 's'}`).join('; ')}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function PlayShootingPanel({
  shooter,
  popup = false,
  resultEntries = [],
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
  resultEntries?: LogEntry[];
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
  const resolvePendingDamage = shootingLocked && resultEntries.length > 0;
  const noAttackSelected = selectedWeaponIndex !== 'all'
    && weaponOptions.some(option => String(option.weaponIndex) === selectedWeaponIndex && option.weaponIndex < 0);
  const canResolve = resolvePendingDamage || (!shootingLocked
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
  const resultWeapon = resultEntries
    .map(entry => shooter.profile.weapons.find(weapon => entry.message.includes(weapon.name)))
    .find((weapon): weapon is BattleUnit['profile']['weapons'][number] => !!weapon);
  const resultWeapons = shooter.profile.weapons.filter(weapon => resultEntries.some(entry => entry.message.includes(weapon.name)));
  const allocatedWeapons = weaponOptions
    .filter(option => option.weaponIndex >= 0 && Object.values(shootingAttackAllocations[String(option.weaponIndex)] ?? {}).some(value => value > 0))
    .map(option => shooter.profile.weapons[option.weaponIndex])
    .filter((weapon): weapon is BattleUnit['profile']['weapons'][number] => !!weapon);
  const resultWeaponIndex = resultWeapon ? shooter.profile.weapons.indexOf(resultWeapon) : -1;
  const displayedWeaponOptions = resultWeapon && resultWeaponIndex >= 0 && !weaponOptions.some(option => option.weaponIndex === resultWeaponIndex)
    ? [{ weaponIndex: resultWeaponIndex, name: resultWeapon.name, targetIds: [] }, ...weaponOptions]
    : weaponOptions;
  const displayedWeaponIndex = resultWeaponIndex >= 0 && resultSection === 'attacker'
    ? String(resultWeaponIndex)
    : selectedWeaponIndex;
  const displayedWeapons = !selectedTarget
    ? []
    : resultSection === 'attacker' && resultWeapons.length
      ? resultWeapons
      : allocatedWeapons.length
        ? allocatedWeapons
        : refWeapons.length || !resultWeapon
          ? refWeapons
        : [resultWeapon];
  const resultWeaponTargets = resultEntries.flatMap(entry => {
    const targetName = entry.message.trim().match(/attacks vs\s+(.+)$/)?.[1]?.trim();
    if (!targetName) return [];
    const weapon = shooter.profile.weapons.find(candidate => entry.message.includes(candidate.name));
    const target = targets.find(candidate => targetName === candidate.profile.name || targetName.endsWith(candidate.profile.name));
    return weapon && target ? [{ weapon, target }] : [];
  });
  const displayedWeaponTargets = resultSection === 'attacker' || resultSection === 'defender'
    ? resultWeaponTargets.length > 0
      ? resultWeaponTargets
      : displayedWeapons.flatMap(weapon => selectedTarget ? [{ weapon, target: selectedTarget }] : [])
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
                  {option.name} — {Object.values(weaponTargets).reduce((total, models) => total + (Number(models) || 0), 0)}/{weaponModelCount} model{weaponModelCount === 1 ? '' : 's'} assigned
                </Typography>
                {option.targetIds.map(targetId => {
                  const target = targets.find(candidate => candidate.id === targetId);
                  const allocatedElsewhere = Object.entries(weaponTargets)
                    .filter(([allocatedTargetId]) => allocatedTargetId !== targetId)
                    .reduce((total, [, models]) => total + (Number(models) || 0), 0);
                  return (
                    <TextField
                      key={`${option.weaponIndex}:${targetId}`}
                      size="small"
                      type="number"
                      label={`${target?.profile.name ?? targetId} models`}
                      value={weaponTargets[targetId] ?? 0}
                      slotProps={{ htmlInput: { min: 0, max: Math.max(0, weaponModelCount - allocatedElsewhere), step: 1 } }}
                      onChange={event => onShootingAttackAllocationChange(option.weaponIndex, targetId, Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                    />
                  );
                })}
              </Box>
            );
          })}
          <Typography variant="caption" sx={{ color: uiTokens.color.text.quiet }}>
            Allocate each model&apos;s weapon to one target before rolling. The weapon&apos;s attacks are rolled afterward; alternate weapon profiles remain one selectable loadout.
          </Typography>
        </Box>
      )}

      {shootingLocked && resultSection !== 'attacker' ? (
        <Typography variant="caption" sx={warningTextSx}>
          {pendingDamageLabel
            ? `Allocate ${pendingDamageLabel} before selecting another shooter or target.`
            : 'Allocate pending damage to defender models before selecting another shooter or target.'}
        </Typography>
      ) : noAttackSelected ? (
        <Typography variant="caption" sx={disabledTextSx}>This unit can be selected to shoot, but will make no attacks.</Typography>
      ) : !weaponOptions.length && !displayedWeapons.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noRangedWeapons}</Typography>
      ) : !targets.length && !displayedWeapons.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noValidTargets}</Typography>
      ) : displayedWeaponTargets.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                    <div style={{ fontSize: 22, fontWeight: 800, color: uiTokens.color.combat.attacks, lineHeight: 1 }}>{weapon.attacks}</div>
                    <div style={{ fontSize: 9, color: uiTokens.color.text.quiet, marginTop: 3 }}>per model</div>
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
                    <div style={{ fontSize: 22, fontWeight: 800, color: wtColor, lineHeight: 1 }}>{wt}+</div>
                    <div style={{ fontSize: 9, color: uiTokens.color.text.quiet, marginTop: 3 }}>S{weapon.strength} v T{target.profile.toughness}</div>
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
      <ShootingResultSummary entries={resultEntries} section={resultSection} weaponNames={shooter.profile.weapons.map(weapon => weapon.name)} />
    </Box>
  );
}

export function PlayChargePanel({
  charger,
  targets,
  selectedTargetIds,
  options,
  chargeRolled,
  resultMessage,
  onTargetChange,
  onRoll,
  onResolve,
}: {
  charger: BattleUnit | null;
  targets: BattleUnit[];
  selectedTargetIds: string[];
  options: PlayChargeTargetOption[];
  chargeRolled: boolean;
  resultMessage: string | null;
  onTargetChange: (values: string[]) => void;
  onRoll: () => void;
  onResolve: () => void;
}) {
  if (!charger) {
    return (
      <Box sx={playPanelSx}>
        <Typography variant="subtitle2" sx={panelTitleSx}>{PLAY_PANEL_LABELS.charge}</Typography>
        <Typography variant="body2" sx={mutedTextSx}>{PLAY_PANEL_MESSAGES.selectActiveUnit}</Typography>
      </Box>
    );
  }
  const canResolve = selectedTargetIds.length > 0
    && selectedTargetIds.every(targetId => options.some(option => option.targetId === targetId));
  return (
    <Box sx={playPanelSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={panelTitleSx}>{PLAY_PANEL_LABELS.charge}</Typography>
          <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {charger.profile.name}{charger.activated ? ' - done' : ''}
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<CasinoOutlinedIcon />} disabled={chargeRolled ? !canResolve : false} onClick={chargeRolled ? onResolve : onRoll}>
          {chargeRolled ? PLAY_PANEL_LABELS.resolve : PLAY_PANEL_LABELS.roll}
        </Button>
      </Box>
      {resultMessage && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: uiTokens.color.status.warning }}>
          {resultMessage}
        </Typography>
      )}
      <FormControl size="small" fullWidth disabled={!chargeRolled || !targets.length}>
        <InputLabel id="play-charge-target-label">{PLAY_PANEL_LABELS.target}</InputLabel>
        <Select
          labelId="play-charge-target-label"
          label={PLAY_PANEL_LABELS.target}
          multiple
          value={selectedTargetIds}
          onChange={(event: SelectChangeEvent<string[]>) => onTargetChange(event.target.value as string[])}
          renderValue={(selected) => (selected as string[])
            .map(targetId => targets.find(target => target.id === targetId)?.profile.name ?? targetId)
            .join(', ')}
        >
          {targets.map(target => {
            const needed = options.find(option => option.targetId === target.id)?.needed ?? 0;
            return (
              <MenuItem key={target.id} value={target.id}>
                {target.profile.name} ({needed.toFixed(1)}&quot; needed)
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>
      {!options.length && (
        <Typography variant="caption" sx={disabledTextSx}>{chargeRolled ? PLAY_PANEL_MESSAGES.noChargeTargets : 'Roll the charge to see reachable targets.'}</Typography>
      )}
    </Box>
  );
}

export function PlayFightPanel({
  fighter,
  popup = false,
  actionLabel = PLAY_PANEL_LABELS.resolve,
  targets,
  selectedTarget,
  selectedTargetId,
  selectedWeaponIndex,
  weaponOptions,
  fixedAttackCount,
  attackSplits,
  attackAllocations = {},
  damageAllocationLocked,
  pendingDamageLabel,
  onTargetChange,
  onWeaponChange,
  onAttackSplitChange,
  onAttackAllocationChange = () => undefined,
  onClearAttackSplits,
  onResolve,
}: {
  fighter: BattleUnit | null;
  popup?: boolean;
  actionLabel?: string;
  targets: BattleUnit[];
  selectedTarget: BattleUnit | null;
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  weaponOptions: PlayFightWeaponOption[];
  fixedAttackCount: number | null;
  attackSplits: Record<string, number>;
  attackAllocations?: Record<string, Record<string, number>>;
  damageAllocationLocked: boolean;
  pendingDamageLabel?: string | null;
  onTargetChange: (value: string) => void;
  onWeaponChange: (value: 'all' | string) => void;
  onAttackSplitChange: (targetId: string, attacks: number) => void;
  onAttackAllocationChange?: (weaponIndex: number, targetId: string, attacks: number) => void;
  onClearAttackSplits: () => void;
  onResolve: () => void;
}) {
  if (!fighter) {
    return (
      <Box sx={playPanelSx}>
        <Typography variant="subtitle2" sx={panelTitleSx}>{PLAY_PANEL_LABELS.fight}</Typography>
        <Typography variant="body2" sx={mutedTextSx}>{PLAY_PANEL_MESSAGES.selectEligibleUnit}</Typography>
      </Box>
    );
  }
  const selectedOptions = selectedWeaponIndex === 'all'
    ? weaponOptions
    : weaponOptions.filter(option => String(option.weaponIndex) === selectedWeaponIndex);
  const allocationFor = (targetId: string) => sanitizeMeleeAttackAllocation(attackSplits[targetId] ?? 0);
  const allocatedAttacks = targets.reduce((total, target) => total + allocationFor(target.id), 0);
  const hasAttackSplits = allocatedAttacks > 0;
  const hasAttackAllocations = Object.values(attackAllocations).some(targets => Object.values(targets).some(attacks => attacks > 0));
  const splitAllocationValid = fixedAttackCount !== null
    && allocatedAttacks === fixedAttackCount
    && targets.every(target => Number.isInteger(allocationFor(target.id)));
  const canResolve = !damageAllocationLocked
    && !fighter.activated
    && (hasAttackAllocations
      ? true
      : hasAttackSplits
        ? splitAllocationValid
        : !!selectedTarget && selectedOptions.some(option => option.targetIds.includes(selectedTargetId)));
  return (
    <Box sx={popup ? popupPanelSx : playPanelSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={panelTitleSx}>{PLAY_PANEL_LABELS.fight}</Typography>
          <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fighter.profile.name}{fighter.activated ? ' - done' : ''}
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<CasinoOutlinedIcon />} disabled={!canResolve} onClick={onResolve}>
          {actionLabel}
        </Button>
      </Box>
      <FormControl size="small" fullWidth disabled={damageAllocationLocked || !weaponOptions.length || fighter.activated}>
        <InputLabel id="play-fight-weapon-label">{PLAY_PANEL_LABELS.weapon}</InputLabel>
        <Select
          labelId="play-fight-weapon-label"
          label={PLAY_PANEL_LABELS.weapon}
          value={selectedWeaponIndex}
          onChange={(event: SelectChangeEvent) => onWeaponChange(event.target.value as 'all' | string)}
        >
          <MenuItem value="all">All eligible melee weapons</MenuItem>
          {weaponOptions.map(option => (
            <MenuItem key={option.weaponIndex} value={String(option.weaponIndex)}>{option.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth disabled={damageAllocationLocked || !targets.length || fighter.activated}>
        <InputLabel id="play-fight-target-label">{PLAY_PANEL_LABELS.target}</InputLabel>
        <Select
          labelId="play-fight-target-label"
          label={PLAY_PANEL_LABELS.target}
          value={selectedTargetId}
          onChange={(event: SelectChangeEvent) => onTargetChange(event.target.value)}
        >
          {targets.map(target => (
            <MenuItem key={target.id} value={target.id}>
              {target.profile.name} ({target.remainingModels} model{target.remainingModels === 1 ? '' : 's'})
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {!damageAllocationLocked && !fighter.activated && weaponOptions.some(option => option.weaponIndex >= 0) && (
        <Box sx={{ display: 'grid', gap: 0.75, p: 1, border: `1px solid ${uiTokens.border.control}`, borderRadius: uiTokens.radius.control }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 700 }}>
            Lock every melee weapon target before rolling
          </Typography>
          {weaponOptions.filter(option => option.weaponIndex >= 0).map(option => {
            const weapon = fighter.profile.weapons[option.weaponIndex];
            const allocations = attackAllocations[String(option.weaponIndex)] ?? {};
            const fixedAttacks = weapon && /^\d+$/.test(String(weapon.attacks).trim())
              ? Number(weapon.attacks) * fighter.remainingModels
              : null;
            return (
              <Box key={option.weaponIndex} sx={{ display: 'grid', gap: 0.4 }}>
                <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 700 }}>
                  {option.name}{fixedAttacks !== null ? ` — ${fixedAttacks} attacks` : ' — variable attacks'}
                </Typography>
                {option.targetIds.map(targetId => {
                  const target = targets.find(candidate => candidate.id === targetId);
                  return (
                    <TextField
                      key={`${option.weaponIndex}:${targetId}`}
                      size="small"
                      type="number"
                      label={target?.profile.name ?? targetId}
                      value={allocations[targetId] ?? 0}
                      slotProps={{ htmlInput: { min: 0, max: fixedAttacks ?? undefined, step: 1 } }}
                      onChange={event => onAttackAllocationChange(option.weaponIndex, targetId, Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                    />
                  );
                })}
              </Box>
            );
          })}
          <Typography variant="caption" sx={{ color: uiTokens.color.text.quiet }}>
            Set attacks to zero for alternate profiles or targets that should not receive that weapon.
          </Typography>
        </Box>
      )}
      {targets.length > 1 && fixedAttackCount !== null && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, p: 1, border: `1px solid ${uiTokens.border.control}`, borderRadius: uiTokens.radius.control }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" sx={{ color: uiTokens.color.text.muted }}>
              Split {selectedOptions[0]?.name ?? 'this profile'} attacks: {allocatedAttacks}/{fixedAttackCount} allocated
            </Typography>
            <Button size="small" disabled={!hasAttackSplits} onClick={onClearAttackSplits}>Clear</Button>
          </Box>
          {targets.map(target => (
            <TextField
              key={target.id}
              size="small"
              type="number"
              label={target.profile.name}
              value={allocationFor(target.id)}
              disabled={damageAllocationLocked || fighter.activated}
              slotProps={{ htmlInput: { min: 0, max: fixedAttackCount, step: 1 } }}
              onChange={event => {
                const attacks = Number(event.target.value);
                onAttackSplitChange(target.id, sanitizeMeleeAttackAllocation(attacks));
              }}
            />
          ))}
          {hasAttackSplits && !splitAllocationValid && (
            <Typography variant="caption" sx={warningTextSx}>Allocate exactly {fixedAttackCount} attacks across the engaged targets.</Typography>
          )}
        </Box>
      )}
      {targets.length > 1 && fixedAttackCount === null && selectedWeaponIndex !== 'all' && (
        <Typography variant="caption" sx={disabledTextSx}>Split allocation is available for weapons with a fixed Attacks characteristic.</Typography>
      )}
      {damageAllocationLocked ? (
        <Typography variant="caption" sx={warningTextSx}>
          {pendingDamageLabel ? `Allocate ${pendingDamageLabel} before fighting again.` : 'Allocate pending damage before fighting again.'}
        </Typography>
      ) : !weaponOptions.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noMeleeWeapons}</Typography>
      ) : !targets.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noFightTargets}</Typography>
      ) : null}
    </Box>
  );
}

export function PlayTacticsPanel({
  state,
  selectedUnit,
  stratagems,
  abilities,
  selectedStratagemId,
  selectedAbilityKey,
  canStartAction,
  actionName,
  canToggleCondemnedUnit,
  selectedUnitIsCondemned,
  onStratagemChange,
  onAbilityChange,
  onUseStratagem,
  onUseAbility,
  onStartAction,
  onToggleCondemnedUnit,
  onResolveCommandReroll,
}: {
  state: BattleState;
  selectedUnit: BattleUnit | null;
  stratagems: StratagemDefinition[];
  abilities: AbilityOption[];
  selectedStratagemId: string;
  selectedAbilityKey: string;
  canStartAction: boolean;
  actionName: string;
  canToggleCondemnedUnit: boolean;
  selectedUnitIsCondemned: boolean;
  onStratagemChange: (value: string) => void;
  onAbilityChange: (value: string) => void;
  onUseStratagem: (stratagemId: string, targetModelIndex?: number, secondaryTargetUnitId?: string, sourceModelIndex?: number, heroicInterventionMode?: HeroicInterventionMode) => void;
  onUseAbility: () => void;
  onStartAction: () => void;
  onToggleCondemnedUnit: () => void;
  onResolveCommandReroll: (originalRolls: number[], label: string, rollType: CommandRerollRollType) => void;
}) {
  const cp = commandPoints(state);
  const selectedAbility = abilities.find(option => abilityOptionKey(option) === selectedAbilityKey) ?? null;
  const pendingFollowUps = stratagemFollowUpLabels(state);
  const [commandRerollInput, setCommandRerollInput] = useState('');
  const [commandRerollRollType, setCommandRerollRollType] = useState<CommandRerollRollType>('hit');
  const [epicChallengeModelIndex, setEpicChallengeModelIndex] = useState(0);
  const [crushingImpactTargetId, setCrushingImpactTargetId] = useState('');
  const [explosivesSourceModelIndex, setExplosivesSourceModelIndex] = useState(0);
  const [explosivesTargetId, setExplosivesTargetId] = useState('');
  const [heroicInterventionMode, setHeroicInterventionMode] = useState<HeroicInterventionMode>('leap-to-defend');
  const commandRerollRolls = parseDiceInput(commandRerollInput);
  const selectedEpicChallengeModelIndex = selectedUnit?.modelPositions.length
    ? Math.min(epicChallengeModelIndex, selectedUnit.modelPositions.length - 1)
    : 0;
  const rules = rulesEditionForRuleset(state.ruleset);
  const selectedExplosivesSourceModelIndex = selectedUnit?.modelPositions.length
    ? Math.min(explosivesSourceModelIndex, selectedUnit.modelPositions.length - 1)
    : 0;

  return (
    <Box sx={playPanelSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={panelTitleSx}>{PLAY_PANEL_LABELS.tactics}</Typography>
          <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted }}>
            CP {cp[0]}-{cp[1]}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gap: 0.75 }}>
        <Typography variant="caption" sx={{ color: uiTokens.color.text.primary, fontWeight: 800 }}>{PLAY_PANEL_LABELS.stratagems}</Typography>
        {pendingFollowUps.map(label => (
          <Typography key={label} variant="caption" sx={warningTextSx}>
            {label}
          </Typography>
        ))}
        {state.pendingCommandReroll && (
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 0.75, alignItems: 'center' }}>
            <Select
              size="small"
              value={commandRerollRollType}
              onChange={event => setCommandRerollRollType(event.target.value as CommandRerollRollType)}
              aria-label="Command Re-roll type"
            >
              {['advance', 'charge', 'damage', 'hazard', 'hit', 'save', 'wound', 'attacks'].map(type => (
                <MenuItem key={type} value={type}>{type === 'attacks' ? 'attacks roll' : `${type} roll`}</MenuItem>
              ))}
            </Select>
            <TextField
              size="small"
              label="Original roll"
              placeholder="6 or 1,2"
              value={commandRerollInput}
              onChange={event => setCommandRerollInput(event.target.value)}
              error={commandRerollInput.trim().length > 0 && commandRerollRolls.length === 0}
              helperText="D6 values"
            />
            <Button
              size="small"
              variant="contained"
              disabled={!commandRerollRolls.length}
              onClick={() => {
                onResolveCommandReroll(commandRerollRolls, `${commandRerollRollType} roll`, commandRerollRollType);
                setCommandRerollInput('');
              }}
            >
              {PLAY_PANEL_LABELS.resolve}
            </Button>
          </Box>
        )}
        {selectedUnit && stratagems.some(stratagem => stratagem.id === 'epic-challenge') && (
          <Select
            size="small"
            value={selectedEpicChallengeModelIndex}
            onChange={event => setEpicChallengeModelIndex(Number(event.target.value))}
            aria-label="Epic Challenge model"
          >
            {selectedUnit.modelPositions.map((_, modelIndex) => (
              <MenuItem key={modelIndex} value={modelIndex}>Epic Challenge: model {modelIndex + 1}</MenuItem>
            ))}
          </Select>
        )}
        {selectedUnit && stratagems.some(stratagem => stratagem.id === 'crushing-impact') && (
          <Select
            size="small"
            value={crushingImpactTargetId}
            onChange={event => setCrushingImpactTargetId(event.target.value)}
            displayEmpty
            aria-label="Crushing Impact target"
          >
            <MenuItem value="">Select Crushing Impact target</MenuItem>
            {state.units
              .filter(unit => unit.side !== selectedUnit.side && !unit.destroyed && !unit.embarkedInUnitId && !unit.inStrategicReserves)
              .sort((left, right) => battleUnitsBaseEdgeDistance(selectedUnit, left) - battleUnitsBaseEdgeDistance(selectedUnit, right))
              .map(unit => (
                <MenuItem key={unit.id} value={unit.id}>Crushing Impact: {unit.profile.name}</MenuItem>
              ))}
          </Select>
        )}
        {selectedUnit && stratagems.some(stratagem => stratagem.id === 'explosives') && (
          <>
            <Select
              size="small"
              value={selectedExplosivesSourceModelIndex}
              onChange={event => setExplosivesSourceModelIndex(Number(event.target.value))}
              aria-label="Explosives source model"
            >
              {selectedUnit.modelPositions.map((_, modelIndex) => (
                <MenuItem key={modelIndex} value={modelIndex}>Explosives from model {modelIndex + 1}</MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={explosivesTargetId}
              onChange={event => setExplosivesTargetId(event.target.value)}
              displayEmpty
              aria-label="Explosives target"
            >
              <MenuItem value="">Select Explosives target</MenuItem>
              {state.units
                .filter(unit => !unit.destroyed && explosivesTargetAllowed(state, selectedUnit, unit, selectedExplosivesSourceModelIndex, rules))
                .map(unit => <MenuItem key={unit.id} value={unit.id}>Explosives: {unit.profile.name}</MenuItem>)}
            </Select>
          </>
        )}
        {selectedUnit && stratagems.some(stratagem => stratagem.id === 'heroic-intervention') && (
          <Select
            size="small"
            value={heroicInterventionMode}
            onChange={event => setHeroicInterventionMode(event.target.value as HeroicInterventionMode)}
            aria-label="Heroic Intervention mode"
          >
            <MenuItem value="leap-to-defend">Heroic Intervention: Leap to Defend (1CP)</MenuItem>
            <MenuItem value="into-the-fray" disabled={cp[selectedUnit.side] < 2}>Heroic Intervention: Into the Fray (2CP)</MenuItem>
          </Select>
        )}
        {stratagems.map(stratagem => (
          <Button
            key={stratagem.id}
            size="small"
            variant={stratagem.id === selectedStratagemId ? 'contained' : 'outlined'}
            onMouseEnter={() => onStratagemChange(stratagem.id)}
            onFocus={() => onStratagemChange(stratagem.id)}
            disabled={(stratagem.id === 'crushing-impact' && !crushingImpactTargetId) || (stratagem.id === 'explosives' && !explosivesTargetId) || (stratagem.id === 'heroic-intervention' && heroicInterventionMode === 'into-the-fray' && cp[selectedUnit?.side ?? 0] < 2)}
            onClick={() => onUseStratagem(
              stratagem.id,
              stratagem.id === 'epic-challenge' ? selectedEpicChallengeModelIndex : undefined,
              stratagem.id === 'crushing-impact' ? crushingImpactTargetId : undefined,
              stratagem.id === 'explosives' ? selectedExplosivesSourceModelIndex : undefined,
              stratagem.id === 'heroic-intervention' ? heroicInterventionMode : undefined,
            )}
            title={stratagem.description}
            sx={{ justifyContent: 'space-between', textTransform: 'none' }}
          >
            <span>{stratagem.name}</span>
            <span>{stratagem.cost}CP</span>
          </Button>
        ))}
        {!stratagems.length && (
          <Typography variant="caption" sx={disabledTextSx}>
            {PLAY_PANEL_MESSAGES.noStratagems}
          </Typography>
        )}
      </Box>

      <FormControl size="small" fullWidth disabled={!selectedUnit || !abilities.length}>
        <InputLabel id="play-ability-label">{PLAY_PANEL_LABELS.ability}</InputLabel>
        <Select
          labelId="play-ability-label"
          label={PLAY_PANEL_LABELS.ability}
          value={selectedAbilityKey}
          onChange={(event: SelectChangeEvent) => onAbilityChange(event.target.value)}
        >
          {abilities.map(option => (
            <MenuItem key={abilityOptionKey(option)} value={abilityOptionKey(option)}>
              {option.ability.name} ({abilityTimingLabel(option.timing)})
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Button size="small" variant="outlined" disabled={!selectedAbility} onClick={onUseAbility}>
        {PLAY_PANEL_LABELS.useAbility}
      </Button>

      <Button size="small" variant="outlined" disabled={!canStartAction} onClick={onStartAction}>
        {actionName === 'Action' ? PLAY_PANEL_LABELS.startAction : `Start ${actionName}`}
      </Button>
      {canToggleCondemnedUnit && (
        <Button size="small" variant={selectedUnitIsCondemned ? 'contained' : 'outlined'} onClick={onToggleCondemnedUnit}>
          {selectedUnitIsCondemned ? 'Remove Condemnation' : 'Condemn Selected Enemy'}
        </Button>
      )}
      {selectedUnit?.performingAction && (
        <Typography variant="caption" sx={{ color: uiTokens.color.status.success }}>
          Performing {selectedUnit.performingAction.name}
        </Typography>
      )}

      {!stratagems.length && !abilities.length && !canStartAction && !selectedUnit?.performingAction && (
        <Typography variant="caption" sx={disabledTextSx}>
          {PLAY_PANEL_MESSAGES.noTactics}
        </Typography>
      )}
    </Box>
  );
}

