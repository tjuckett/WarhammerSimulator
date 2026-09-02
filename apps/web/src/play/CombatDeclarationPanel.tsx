import { Alert, Box, Button, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import { CombatPopupShell } from './CombatPopupShell';
import { PLAY_PANEL_LABELS } from './playPanelShared';
import { uiTokens } from '../theme/uiTokens';

type WeaponOption = { weaponIndex: number; name: string };

/** Shared declaration frame for Shooting and Fight. Phase panels provide only their allocation body. */
export function CombatDeclarationPanel({
  unit,
  popup,
  title,
  status,
  actionLabel,
  actionDisabled,
  onAction,
  weaponOptions,
  selectedWeaponIndex,
  weaponSuffix,
  disabled,
  onWeaponChange,
  warning,
  weaponSelectorOrientation = 'horizontal',
  children,
}: {
  unit: BattleUnit;
  popup?: boolean;
  title: string;
  status?: string;
  actionLabel: string;
  actionDisabled: boolean;
  onAction: () => void;
  weaponOptions: WeaponOption[];
  selectedWeaponIndex: 'all' | string;
  weaponSuffix?: (option: WeaponOption) => ReactNode;
  disabled: boolean;
  onWeaponChange: (value: 'all' | string) => void;
  warning?: ReactNode;
  weaponSelectorOrientation?: 'horizontal' | 'vertical';
  children: ReactNode;
}) {
  return (
    <CombatPopupShell
      unit={unit}
      popup={popup}
      title={title}
      status={status}
      actionLabel={actionLabel}
      actionDisabled={actionDisabled}
      onAction={onAction}
    >
      {warning && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{
            py: 0.1,
            px: 1,
            alignItems: 'center',
            backgroundColor: 'rgba(55, 43, 12, 0.94)',
            borderColor: 'rgba(255, 190, 75, 0.9)',
            color: '#ffcf66',
            '& .MuiAlert-icon': { color: '#ffcf66', py: 0.25 },
            '& .MuiAlert-message': { py: 0.35, fontSize: 11, fontWeight: 700 },
          }}
        >
          {warning}
        </Alert>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, mb: 0.35 }}>
          {PLAY_PANEL_LABELS.weapon}
        </Typography>
        <Box
          role="tablist"
          aria-label={`${title} weapon selector`}
          aria-orientation={weaponSelectorOrientation}
          sx={{
            display: 'flex',
            flexDirection: weaponSelectorOrientation === 'vertical' ? 'column' : 'row',
            alignItems: weaponSelectorOrientation === 'vertical' ? 'stretch' : 'flex-start',
            gap: 0.5,
            minWidth: 0,
            overflowX: weaponSelectorOrientation === 'vertical' ? 'visible' : 'auto',
            pb: 0.35,
            scrollbarWidth: 'thin',
            scrollbarColor: '#333 #111',
            '&::-webkit-scrollbar': { width: 6, height: 6 },
            '&::-webkit-scrollbar-track': { background: '#111' },
            '&::-webkit-scrollbar-thumb': { background: '#333', borderRadius: '3px' },
            '&::-webkit-scrollbar-thumb:hover': { background: '#444' },
          }}
        >
          {weaponOptions.map(option => {
            const value = String(option.weaponIndex);
            const selected = selectedWeaponIndex === value;
            return (
              <Button
                key={option.weaponIndex}
                role="tab"
                aria-selected={selected}
                size="small"
                variant={selected ? 'contained' : 'outlined'}
                disabled={disabled}
                onClick={() => onWeaponChange(value)}
                sx={{
                  flex: '0 0 auto',
                  width: weaponSelectorOrientation === 'vertical' ? '100%' : 'auto',
                  minHeight: weaponSelectorOrientation === 'vertical' ? 36 : 31,
                  px: 1,
                  justifyContent: weaponSelectorOrientation === 'vertical' ? 'flex-start' : 'center',
                  whiteSpace: 'nowrap',
                  textTransform: 'none',
                }}
              >
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, width: '100%', minWidth: 0 }}>
                  <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {option.name}
                  </Box>
                  {weaponSuffix?.(option)}
                </Box>
              </Button>
            );
          })}
        </Box>
      </Box>
      {children}
    </CombatPopupShell>
  );
}
