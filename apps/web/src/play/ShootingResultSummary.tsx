import { Box, Typography } from '@mui/material';
import type { ShootingResolution } from '@warhammer-simulator/core/types/battle';
import { uiTokens } from '../theme/uiTokens';

type ResultSection = 'attacker' | 'defender' | 'all';

function groupVisible(kind: string, section: ResultSection): boolean {
  if (section === 'all') return true;
  if (section === 'attacker') return kind === 'hit' || kind === 'wound';
  return kind === 'save' || kind === 'feel-no-pain' || kind === 'damage';
}

function labelForKind(kind: string): string {
  return kind === 'feel-no-pain' ? 'Feel No Pain' : `${kind[0].toUpperCase()}${kind.slice(1)} rolls`;
}

export function ShootingResultSummary({ result, section = 'all' }: { result?: ShootingResolution | null; section?: ResultSection }) {
  if (!result?.weapons.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.5, pt: 0.75, pb: 0.5, mb: 0.5, borderTop: `1px solid ${uiTokens.border.control}` }}>
      <Typography variant="caption" sx={{ color: uiTokens.color.text.secondary, fontWeight: 800 }}>Latest shooting result</Typography>
      {result.weapons.map(weapon => (
        <Box key={`${weapon.weaponIndex}-${weapon.targetUnitId}`} sx={{ display: 'grid', gap: 0.35 }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 800 }}>
            {weapon.weaponName} → {weapon.targetUnitName}
          </Typography>
          {weapon.groups.filter(group => groupVisible(group.kind, section)).map((group, index) => {
            const successCount = group.kind === 'save'
              ? group.rolls.length - (group.successes ?? 0)
              : group.successes;
            return (
              <Box key={`${group.kind}-${index}`} sx={{ display: 'flex', gap: 0.6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ color: uiTokens.color.text.muted }}>
                  {labelForKind(group.kind)}{group.noSave ? ' — no save possible' : ''}
                  {successCount !== undefined && ` — ${group.rolls.length} rolls — ${successCount} ${group.kind === 'hit' ? 'hit' : group.kind === 'wound' ? 'wound' : group.kind === 'save' ? 'failed save' : 'result'}${successCount === 1 ? '' : 's'}`}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
                  {group.rolls.map((roll, rollIndex) => {
                    const success = group.target !== undefined && roll >= group.target;
                    const critical = group.kind !== 'save' && group.kind !== 'feel-no-pain' && roll === 6;
                    return <Box key={`${roll}-${rollIndex}`} sx={{ minWidth: 18, px: 0.35, border: `1px solid ${critical ? '#7040a0' : success ? '#2a5c2a' : '#3a1818'}`, borderRadius: 0.75, background: critical ? '#241238' : success ? '#0d260d' : '#1a0d0d', color: critical ? '#d5a6ff' : success ? '#78d786' : '#664444', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>{roll}</Box>;
                  })}
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
