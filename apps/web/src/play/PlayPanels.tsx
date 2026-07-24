import { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { StratagemDefinition } from '@warhammer-simulator/core/types/stratagem';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import type { PlayChargeTargetOption, PlayFightWeaponOption, PlayShootingWeaponOption } from '@warhammer-simulator/core/engine/simulator';
import {
  abilityOptionKey,
  abilityTimingLabel,
  calcEffectiveSave,
  calcWoundTarget,
  calcWoundTargetColor,
  parseDiceInput,
  pendingDamageLabel,
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

export function PendingDamageAllocationHud({ unit }: { unit: BattleUnit }) {
  const label = pendingDamageLabel(unit);
  if (!label) return null;
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
      <Typography variant="caption" sx={{ color: uiTokens.color.status.pending, fontWeight: 800, textTransform: 'uppercase', lineHeight: 1 }}>
        {PLAY_PANEL_LABELS.pendingDamage}
      </Typography>
      <Typography variant="body2" sx={{ color: uiTokens.color.status.pendingText, fontWeight: 800, lineHeight: 1.15 }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ color: uiTokens.color.status.pendingMuted, lineHeight: 1.2 }}>
        {forcedModel}
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

export function PlayShootingPanel({
  shooter,
  title = PLAY_PANEL_LABELS.shooting,
  actionLabel = PLAY_PANEL_LABELS.resolve,
  targets,
  selectedTarget,
  targetIsValid,
  damageAllocationLocked,
  pendingDamageLabel,
  weaponOptions,
  selectedTargetId,
  selectedWeaponIndex,
  coverUnitIds,
  onTargetChange,
  onWeaponChange,
  onResolve,
}: {
  shooter: BattleUnit | null;
  title?: string;
  actionLabel?: string;
  targets: BattleUnit[];
  selectedTarget: BattleUnit | null;
  targetIsValid: boolean;
  damageAllocationLocked: boolean;
  pendingDamageLabel?: string | null;
  weaponOptions: PlayShootingWeaponOption[];
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  coverUnitIds?: Set<string>;
  onTargetChange: (value: string) => void;
  onWeaponChange: (value: 'all' | string) => void;
  onResolve: () => void;
}) {
  if (!shooter) {
    return (
      <Box sx={playPanelSx}>
        <Typography variant="subtitle2" sx={panelTitleSx}>{title}</Typography>
        <Typography variant="body2" sx={mutedTextSx}>{PLAY_PANEL_MESSAGES.selectActiveUnit}</Typography>
      </Box>
    );
  }

  const shootingLocked = damageAllocationLocked;
  const noAttackSelected = selectedWeaponIndex !== 'all'
    && weaponOptions.some(option => String(option.weaponIndex) === selectedWeaponIndex && option.weaponIndex < 0);
  const canResolve = !shootingLocked
    && !shooter.activated
    && (
      noAttackSelected
      || (weaponOptions.some(option => option.targetIds.length > 0) && !!selectedTarget && targetIsValid)
    );
  const targetInCover = !!(selectedTarget && coverUnitIds?.has(selectedTarget.id));

  const refWeapons = selectedTarget && targetIsValid
    ? (selectedWeaponIndex === 'all'
        ? weaponOptions.filter(o => o.targetIds.includes(selectedTargetId))
        : weaponOptions.filter(o => String(o.weaponIndex) === selectedWeaponIndex && o.targetIds.includes(selectedTargetId))
      ).map(o => shooter.profile.weapons[o.weaponIndex]).filter(Boolean)
    : [];

  return (
    <Box sx={playPanelSx}>
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
          {actionLabel}
        </Button>
      </Box>

      <FormControl size="small" fullWidth disabled={shootingLocked || !weaponOptions.length || shooter.activated}>
        <InputLabel id="play-shooting-weapon-label">{PLAY_PANEL_LABELS.weapon}</InputLabel>
        <Select
          labelId="play-shooting-weapon-label"
          label={PLAY_PANEL_LABELS.weapon}
          value={selectedWeaponIndex}
          onChange={(event: SelectChangeEvent) => onWeaponChange(event.target.value as 'all' | string)}
        >
          {weaponOptions.map(option => (
            <MenuItem key={option.weaponIndex} value={String(option.weaponIndex)}>
              {option.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth disabled={shootingLocked || noAttackSelected || !targets.length || shooter.activated}>
        <InputLabel id="play-shooting-target-label">{PLAY_PANEL_LABELS.target}</InputLabel>
        <Select
          labelId="play-shooting-target-label"
          label={PLAY_PANEL_LABELS.target}
          value={selectedTargetId}
          onChange={(event: SelectChangeEvent) => onTargetChange(event.target.value)}
        >
          {selectedTarget && !targetIsValid && (
            <MenuItem value={selectedTarget.id} disabled>
              {selectedTarget.profile.name} (not targetable)
            </MenuItem>
          )}
          {targets.map(target => (
            <MenuItem key={target.id} value={target.id}>
              {target.profile.name} ({target.remainingModels} model{target.remainingModels === 1 ? '' : 's'}, {target.woundsOnLeadModel}W lead)
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {shootingLocked ? (
        <Typography variant="caption" sx={warningTextSx}>
          {pendingDamageLabel
            ? `Allocate ${pendingDamageLabel} before selecting another shooter or target.`
            : 'Allocate pending damage to defender models before selecting another shooter or target.'}
        </Typography>
      ) : noAttackSelected ? (
        <Typography variant="caption" sx={disabledTextSx}>This unit can be selected to shoot, but will make no attacks.</Typography>
      ) : !weaponOptions.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noRangedWeapons}</Typography>
      ) : !targets.length ? (
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noValidTargets}</Typography>
      ) : refWeapons.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {refWeapons.map((weapon, i) => {
            const wt = calcWoundTarget(weapon.strength, selectedTarget!.profile.toughness);
            const sv = calcEffectiveSave(selectedTarget!.profile.save, weapon.ap, selectedTarget!.profile.invulnSave);
            const usedInvuln = selectedTarget!.profile.invulnSave !== undefined && sv === selectedTarget!.profile.invulnSave;
            const noSave = sv > 6;
            const wtColor = calcWoundTargetColor(wt);
            const coverBonus = targetInCover && (selectedTarget!.profile.save <= 6) ? 1 : 0;
            const svWithCover = sv - coverBonus;
            const noSaveWithCover = svWithCover > 6;
            return (
              <div key={i} style={{ background: uiTokens.surface.statCard, border: `1px solid ${uiTokens.border.statCard}`, borderRadius: uiTokens.radius.statCard, overflow: 'hidden' }}>
                {/* Weapon name */}
                <div style={{
                  padding: '5px 10px', borderBottom: `1px solid ${uiTokens.border.statCard}`,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: uiTokens.color.combat.weaponName }}>{weapon.name}</span>
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
                    <div style={{ fontSize: 22, fontWeight: 800, color: uiTokens.color.combat.hit, lineHeight: 1 }}>{weapon.skill}+</div>
                  </div>
                  {/* Wound */}
                  <div style={{ padding: '8px 4px', textAlign: 'center', borderRight: `1px solid ${uiTokens.border.statDivider}` }}>
                    <div style={{ fontSize: 8, color: uiTokens.color.text.subtle, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Wound</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: wtColor, lineHeight: 1 }}>{wt}+</div>
                    <div style={{ fontSize: 9, color: uiTokens.color.text.quiet, marginTop: 3 }}>S{weapon.strength} v T{selectedTarget!.profile.toughness}</div>
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
                        {targetInCover && (
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
    </Box>
  );
}

export function PlayChargePanel({
  charger,
  targets,
  selectedTargetId,
  options,
  onTargetChange,
  onResolve,
}: {
  charger: BattleUnit | null;
  targets: BattleUnit[];
  selectedTargetId: string;
  options: PlayChargeTargetOption[];
  onTargetChange: (value: string) => void;
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
  const selectedOption = options.find(option => option.targetId === selectedTargetId) ?? null;
  const canResolve = !!selectedOption && !charger.activated;
  return (
    <Box sx={playPanelSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={panelTitleSx}>{PLAY_PANEL_LABELS.charge}</Typography>
          <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {charger.profile.name}{charger.activated ? ' - done' : ''}
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<CasinoOutlinedIcon />} disabled={!canResolve} onClick={onResolve}>
          {PLAY_PANEL_LABELS.roll}
        </Button>
      </Box>
      <FormControl size="small" fullWidth disabled={!targets.length || charger.activated}>
        <InputLabel id="play-charge-target-label">{PLAY_PANEL_LABELS.target}</InputLabel>
        <Select
          labelId="play-charge-target-label"
          label={PLAY_PANEL_LABELS.target}
          value={selectedTargetId}
          onChange={(event: SelectChangeEvent) => onTargetChange(event.target.value)}
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
        <Typography variant="caption" sx={disabledTextSx}>{PLAY_PANEL_MESSAGES.noChargeTargets}</Typography>
      )}
    </Box>
  );
}

export function PlayFightPanel({
  fighter,
  actionLabel = PLAY_PANEL_LABELS.resolve,
  targets,
  selectedTarget,
  selectedTargetId,
  selectedWeaponIndex,
  weaponOptions,
  damageAllocationLocked,
  pendingDamageLabel,
  onTargetChange,
  onWeaponChange,
  onResolve,
}: {
  fighter: BattleUnit | null;
  actionLabel?: string;
  targets: BattleUnit[];
  selectedTarget: BattleUnit | null;
  selectedTargetId: string;
  selectedWeaponIndex: 'all' | string;
  weaponOptions: PlayFightWeaponOption[];
  damageAllocationLocked: boolean;
  pendingDamageLabel?: string | null;
  onTargetChange: (value: string) => void;
  onWeaponChange: (value: 'all' | string) => void;
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
  const canResolve = !damageAllocationLocked
    && !fighter.activated
    && !!selectedTarget
    && selectedOptions.some(option => option.targetIds.includes(selectedTargetId));
  return (
    <Box sx={playPanelSx}>
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
  onStratagemChange,
  onAbilityChange,
  onUseStratagem,
  onUseAbility,
  onStartAction,
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
  onStratagemChange: (value: string) => void;
  onAbilityChange: (value: string) => void;
  onUseStratagem: (stratagemId: string) => void;
  onUseAbility: () => void;
  onStartAction: () => void;
  onResolveCommandReroll: (originalRolls: number[], label: string) => void;
}) {
  const cp = commandPoints(state);
  const selectedAbility = abilities.find(option => abilityOptionKey(option) === selectedAbilityKey) ?? null;
  const pendingFollowUps = stratagemFollowUpLabels(state);
  const [commandRerollInput, setCommandRerollInput] = useState('');
  const commandRerollRolls = parseDiceInput(commandRerollInput);

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
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 0.75, alignItems: 'center' }}>
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
                onResolveCommandReroll(commandRerollRolls, 'roll');
                setCommandRerollInput('');
              }}
            >
              {PLAY_PANEL_LABELS.resolve}
            </Button>
          </Box>
        )}
        {stratagems.map(stratagem => (
          <Button
            key={stratagem.id}
            size="small"
            variant={stratagem.id === selectedStratagemId ? 'contained' : 'outlined'}
            onMouseEnter={() => onStratagemChange(stratagem.id)}
            onFocus={() => onStratagemChange(stratagem.id)}
            onClick={() => onUseStratagem(stratagem.id)}
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

