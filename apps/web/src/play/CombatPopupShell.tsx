import type { ReactNode } from 'react';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import { Box, Button, Typography } from '@mui/material';
import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import { uiTokens } from '../theme/uiTokens';
import { panelTitleSx, playPanelSx, popupPanelSx } from './playPanelShared';

/** Shared unit-anchored declaration shell for ranged and melee attacks. */
export function CombatPopupShell({
  unit,
  popup = false,
  title,
  actionLabel,
  actionDisabled,
  onAction,
  status,
  children,
}: {
  unit: BattleUnit;
  popup?: boolean;
  title: string;
  actionLabel: string;
  actionDisabled: boolean;
  onAction: () => void;
  status?: string;
  children: ReactNode;
}) {
  return (
    <Box sx={popup ? popupPanelSx : playPanelSx}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={panelTitleSx}>{title}</Typography>
          <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {unit.profile.name}{status ? ` — ${status}` : ''}
          </Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<CasinoOutlinedIcon />} onClick={onAction} disabled={actionDisabled}>
          {actionLabel}
        </Button>
      </Box>
      {children}
    </Box>
  );
}
