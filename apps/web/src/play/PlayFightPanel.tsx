import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { PlayFightWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import { sanitizeMeleeAttackAllocation } from './playUiHelpers';
import { PLAY_PANEL_LABELS, PLAY_PANEL_MESSAGES, disabledTextSx, mutedTextSx, panelTitleSx, playPanelSx, popupPanelSx, warningTextSx } from './playPanelShared';
import { uiTokens } from '../theme/uiTokens';

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
                  {option.name}{fixedAttacks !== null ? ` â€” ${fixedAttacks} attacks` : ' â€” variable attacks'}
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

