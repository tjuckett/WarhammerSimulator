import { useState } from 'react';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import type { BattleState, BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { CommandRerollRollType, HeroicInterventionMode, StratagemDefinition } from '@warhammer-simulator/core/types/stratagem';
import { commandPoints } from '@warhammer-simulator/core/engine/commandPoints';
import { battleUnitsBaseEdgeDistance } from '@warhammer-simulator/core/engine/simulator';
import { explosivesTargetAllowed } from '@warhammer-simulator/core/engine/stratagems';
import { rulesEditionForRuleset } from '@warhammer-simulator/core/engine/rulesEngine';
import { abilityOptionKey, abilityTimingLabel, parseDiceInput, stratagemFollowUpLabels, type AbilityOption } from './playUiHelpers';
import { PLAY_PANEL_LABELS, PLAY_PANEL_MESSAGES, disabledTextSx, panelTitleSx, playPanelSx, warningTextSx } from './playPanelShared';
import { uiTokens } from '../theme/uiTokens';

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

