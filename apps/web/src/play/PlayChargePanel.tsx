import { Box, Button, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import type { PlayChargeTargetOption } from '@warhammer-simulator/core/engine/simulator';
import { PLAY_PANEL_LABELS, PLAY_PANEL_MESSAGES, disabledTextSx, mutedTextSx, panelTitleSx, playPanelSx } from './playPanelShared';
import { uiTokens } from '../theme/uiTokens';

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
