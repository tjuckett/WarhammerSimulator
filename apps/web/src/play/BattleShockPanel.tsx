import { Box, Button, Typography } from '@mui/material';
import type {
  BattleShockEligibleUnit,
  BattleShockResult,
} from '@warhammer-simulator/core/types/battle';
import { uiTokens } from '../theme/uiTokens';
import {
  disabledTextSx,
  mutedTextSx,
  panelTitleSx,
  popupPanelSx,
  playPanelSx,
} from './playPanelShared';

const reasonLabels: Record<BattleShockEligibleUnit['reasons'][number], string> = {
  'already-battleshocked': 'Already Battle-shocked',
  'at-or-below-half-strength': 'At or below half-strength',
};

function resultLabel(result: BattleShockResult): string {
  if (result.automaticallyPassed) return 'Automatically passed (Insane Bravery)';
  if (!result.dice || result.total === undefined) return result.passed ? 'Passed' : 'Failed';
  return `Rolled ${result.dice[0]} + ${result.dice[1]} = ${result.total} (${result.passed ? 'passed' : 'failed'})`;
}

export function BattleShockPanel({
  armyName,
  eligibleUnits,
  results,
  pendingUnitId,
  onRoll,
  popup = false,
}: {
  armyName: string;
  eligibleUnits: BattleShockEligibleUnit[];
  results: BattleShockResult[];
  pendingUnitId?: string;
  onRoll: (unitId: string) => void;
  popup?: boolean;
}) {
  const resultByUnitId = new Map(results.map(result => [result.unitId, result]));
  const allResolved = eligibleUnits.every(unit => resultByUnitId.has(unit.unitId));

  return (
    <Box sx={popup ? popupPanelSx : playPanelSx}>
      <Typography variant="subtitle2" sx={panelTitleSx}>Battle-shock</Typography>
      <Typography variant="body2" sx={mutedTextSx}>
        {eligibleUnits.length
          ? `${armyName} must resolve one Battle-shock roll for each eligible unit.`
          : 'No units are currently eligible for a Battle-shock roll.'}
      </Typography>
      {eligibleUnits.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.7 }}>
          {eligibleUnits.map(unit => {
            const result = resultByUnitId.get(unit.unitId);
            const isPending = pendingUnitId === unit.unitId && !result;
            return (
              <Box
                key={unit.unitId}
                sx={{
                  display: 'grid',
                  gap: 0.25,
                  p: 0.7,
                  border: `1px solid ${isPending ? uiTokens.border.warning : uiTokens.border.subtle}`,
                  background: isPending ? 'rgba(255, 190, 85, 0.12)' : uiTokens.surface.panel,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: uiTokens.color.text.primary }}>
                    {unit.unitName}
                  </Typography>
                  {result ? (
                    <Typography
                      variant="caption"
                      sx={{
                        color: result.passed ? uiTokens.color.status.success : uiTokens.color.status.warning,
                        fontWeight: 800,
                        textTransform: 'uppercase',
                      }}
                    >
                      {result.passed ? 'Passed' : 'Failed'}
                    </Typography>
                  ) : (
                    <Button size="small" variant={isPending ? 'contained' : 'outlined'} onClick={() => onRoll(unit.unitId)}>
                      Roll 2D6
                    </Button>
                  )}
                </Box>
                <Typography variant="caption" sx={mutedTextSx}>
                  {unit.reasons.map(reason => reasonLabels[reason]).join(' · ')} · Leadership {unit.leadership}+
                </Typography>
                {result && (
                  <Typography variant="caption" sx={{ color: result.passed ? uiTokens.color.status.success : uiTokens.color.status.warning }}>
                    {resultLabel(result)}
                  </Typography>
                )}
                {!result && !isPending && (
                  <Typography variant="caption" sx={disabledTextSx}>
                    Awaiting roll
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {allResolved && eligibleUnits.length > 0 && (
        <Typography variant="caption" sx={{ color: uiTokens.color.status.success, fontWeight: 700 }}>
          All Battle-shock rolls are resolved. Continue to the next Command phase step.
        </Typography>
      )}
    </Box>
  );
}
