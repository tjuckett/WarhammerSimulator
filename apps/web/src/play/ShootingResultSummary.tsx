import { Box, Typography } from '@mui/material';
import type { PendingCombatResolution, ShootingResolution, ShootingRollGroup } from '@warhammer-simulator/core/types/battle';
import { combatResolutionGroupMatchesStage } from '@warhammer-simulator/core/engine/combatResolutionCursor';
import { uiTokens } from '../theme/uiTokens';

type ResultSection = 'attacker' | 'defender' | 'all';

function groupVisible(kind: ShootingRollGroup['kind'], section: ResultSection, stage?: PendingCombatResolution['stage']): boolean {
  if (stage) {
    if (stage === 'damage' && kind === 'feel-no-pain') return true;
    return combatResolutionGroupMatchesStage({ kind, rolls: [] }, stage);
  }
  if (section === 'all') return true;
  if (section === 'attacker') return kind === 'hit' || kind === 'wound';
  return kind === 'save' || kind === 'feel-no-pain';
}

function labelForKind(kind: string): string {
  return kind === 'feel-no-pain' ? 'Feel No Pain' : `${kind[0].toUpperCase()}${kind.slice(1)} rolls`;
}

export function ShootingResultSummary({ result, section = 'all', stage }: { result?: ShootingResolution | null; section?: ResultSection; stage?: PendingCombatResolution['stage'] }) {
  if (!result?.weapons.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.5, pt: 0.75, pb: 0.5, mb: 0.5, borderTop: `1px solid ${uiTokens.border.control}` }}>
      <Typography variant="caption" sx={{ color: uiTokens.color.text.secondary, fontWeight: 800 }}>Latest shooting result</Typography>
      {result.weapons.map(weapon => (
        <Box key={`${weapon.weaponIndex}-${weapon.targetUnitId}`} sx={{ display: 'grid', gap: 0.35 }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.muted, fontWeight: 800 }}>
            {weapon.weaponName} → {weapon.targetUnitName}
            {(() => {
              const saveGroup = weapon.groups.find(group => group.kind === 'save');
              return saveGroup && !saveGroup.noSave && saveGroup.target !== undefined && saveGroup.target <= 6
                ? ` — ${saveGroup.target}+ save`
                : '';
            })()}
          </Typography>
          {weapon.groups.filter(group => groupVisible(group.kind, section, stage)).map((group, index) => {
            const successCount = group.kind === 'save'
              ? group.noSave ? undefined : group.rolls.length - (group.successes ?? 0)
              : (group.successes ?? (group.target !== undefined
                ? group.rolls.filter(roll => roll >= group.target).length
                : undefined));
            return (
              <Box key={`${group.kind}-${index}`} sx={{ display: 'grid', gap: 0.35 }}>
                <Typography variant="caption" sx={{ color: uiTokens.color.text.muted }}>
                  {labelForKind(group.kind)}{group.noSave ? ' — no save possible' : ''}
                  {successCount !== undefined && ` — ${group.rolls.length} rolls — ${successCount} ${group.kind === 'hit' ? 'hit' : group.kind === 'wound' ? 'wound' : group.kind === 'save' ? 'failed save' : 'result'}${successCount === 1 ? '' : 's'}`}
                  {group.kind === 'hit' && (group.bonusHits ?? 0) > 0 ? ` (+${group.bonusHits} Sustained Hits)` : ''}
                  {group.kind === 'hit' && (group.autoSuccesses ?? 0) > 0 ? ` (${group.autoSuccesses} auto-hit${group.autoSuccesses === 1 ? '' : 's'})` : ''}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
                  {(group.kind === 'damage'
                    ? group.rolls.map((roll, originalIndex) => ({ roll, originalIndex }))
                    : group.rolls.map((roll, originalIndex) => ({ roll, originalIndex })).sort((left, right) => right.roll - left.roll))
                    .filter(({ roll }) => Number.isFinite(roll))
                    .map(({ roll, originalIndex }) => {
                    const success = group.target !== undefined && roll >= group.target;
                    const critical = group.kind !== 'save' && group.kind !== 'feel-no-pain' && roll === 6;
                    const rerolled = group.rerolledRollIndices?.includes(originalIndex) ?? false;
                    return <Box key={`${roll}-${originalIndex}`} title={rerolled ? 'Rerolled by Command Re-roll' : undefined} sx={{ minWidth: 18, px: 0.35, border: `2px solid ${rerolled ? '#ffd166' : critical ? '#7040a0' : success ? '#2a5c2a' : '#3a1818'}`, borderRadius: 0.75, background: rerolled ? 'rgba(255, 209, 102, 0.3)' : critical ? '#241238' : success ? '#0d260d' : '#1a0d0d', color: rerolled ? '#ffe7a3' : critical ? '#d5a6ff' : success ? '#78d786' : '#664444', boxShadow: rerolled ? '0 0 0 2px rgba(255, 209, 102, 0.22)' : 'none', textAlign: 'center', fontSize: 11, fontWeight: 700 }}>{roll}</Box>;
                   })}
                  {(group.autoSuccesses ?? 0) > 0 && (
                    <Box title="Auto-hit: no hit die was rolled" sx={{ minWidth: 18, px: 0.35, border: '2px solid #2a5c2a', borderRadius: 0.75, background: '#0d260d', color: '#78d786', textAlign: 'center', fontSize: 10, fontWeight: 800 }}>
                      Auto-hit
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
