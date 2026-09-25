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
  selectedUnitId,
  canRerollUnitId,
  onSelect,
  onRoll,
  onResolveCommandReroll,
  popup = false,
}: {
  armyName: string;
  eligibleUnits: BattleShockEligibleUnit[];
  results: BattleShockResult[];
  pendingUnitId?: string;
  selectedUnitId?: string;
  canRerollUnitId?: string;
  onSelect: (unitId: string) => void;
  onRoll: (unitId: string) => void;
  onResolveCommandReroll?: (unitId: string, dice: [number, number]) => void;
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
            const isSelected = selectedUnitId === unit.unitId;
            const isHighlighted = isSelected || (!selectedUnitId && isPending);
            return (
              <Box
                key={unit.unitId}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(unit.unitId)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(unit.unitId);
                  }
                }}
                sx={{
                  display: 'grid',
                  gap: 0.25,
                  p: 0.7,
                  cursor: 'pointer',
                  border: `1px solid ${isHighlighted ? uiTokens.border.warning : uiTokens.border.subtle}`,
                  background: isHighlighted
                    ? 'rgba(255, 190, 85, 0.12)'
                    : uiTokens.surface.panel,
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
                    <Button size="small" variant={isHighlighted ? 'contained' : 'outlined'} onClick={() => onRoll(unit.unitId)}>
                      Roll 2D6
                    </Button>
                  )}
                </Box>
                <Typography variant="caption" sx={mutedTextSx}>
                  {unit.reasons.map(reason => reasonLabels[reason]).join(' · ')} · Leadership {unit.leadership}+
                </Typography>
                {result && (
                  <>
                    <Typography variant="caption" sx={{ color: result.passed ? uiTokens.color.status.success : uiTokens.color.status.warning }}>
                      {resultLabel(result)}
                    </Typography>
                    {result.dice && onResolveCommandReroll && canRerollUnitId === unit.unitId && (
                      <Box sx={{ display: 'flex', gap: 0.35, alignItems: 'center' }}>
                        <Typography variant="caption" sx={{ color: uiTokens.color.combat.hit, fontWeight: 800 }}>
                          Command Re-roll: click either die to reroll both.
                        </Typography>
                        {result.dice.map((die, index) => (
                          <Button
                            key={`${unit.unitId}-battleshock-die-${index}`}
                            size="small"
                            variant="text"
                            title="Click either die to Command Re-roll both Leadership dice"
                            onClick={() => onResolveCommandReroll(unit.unitId, result.dice!)}
                            sx={{ minWidth: 22, width: 22, height: 22, p: 0, border: `1px solid ${uiTokens.color.combat.hit}`, borderRadius: 1, color: uiTokens.color.combat.hit, fontWeight: 800, lineHeight: 1, '&:hover': { background: 'rgba(93, 173, 226, 0.24)' } }}
                          >{die}</Button>
                        ))}
                      </Box>
                    )}
                  </>
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
