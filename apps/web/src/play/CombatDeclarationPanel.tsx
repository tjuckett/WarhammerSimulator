import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import type { ReactNode } from 'react';
import type { BattleUnit } from '@warhammer-simulator/core/types/battle';
import { CombatPopupShell } from './CombatPopupShell';
import { PLAY_PANEL_LABELS } from './playPanelShared';

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
  allWeaponsLabel,
  weaponSuffix,
  disabled,
  onWeaponChange,
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
  allWeaponsLabel: string;
  weaponSuffix?: (option: WeaponOption) => ReactNode;
  disabled: boolean;
  onWeaponChange: (value: 'all' | string) => void;
  children: ReactNode;
}) {
  const labelId = `play-${title.toLowerCase().replace(/\s+/g, '-')}-weapon-label`;
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
      <FormControl size="small" fullWidth disabled={disabled || !weaponOptions.length}>
        <InputLabel id={labelId}>{PLAY_PANEL_LABELS.weapon}</InputLabel>
        <Select
          labelId={labelId}
          label={PLAY_PANEL_LABELS.weapon}
          value={selectedWeaponIndex}
          onChange={(event: SelectChangeEvent) => onWeaponChange(event.target.value as 'all' | string)}
        >
          <MenuItem value="all">{allWeaponsLabel}</MenuItem>
          {weaponOptions.map(option => (
            <MenuItem key={option.weaponIndex} value={String(option.weaponIndex)}>
              {option.name}{weaponSuffix?.(option)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {children}
    </CombatPopupShell>
  );
}
