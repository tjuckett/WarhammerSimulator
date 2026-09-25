import { Box, Typography } from '@mui/material';
import type { BattleState, Side } from '@warhammer-simulator/core/types/battle';
import { eleventhPrimaryMissionRuleForName } from '@warhammer-simulator/core/data/missionRules';
import { uiTokens } from '../theme/uiTokens';

function primaryMissionNames(state: BattleState): [string, string] {
  if (state.setup?.primaryMissions) return state.setup.primaryMissions;
  const fallback = state.setup?.primaryMission ?? 'Primary mission';
  const names = fallback.split(/\s+\/\s+/).filter(Boolean);
  return [names[0] ?? fallback, names[1] ?? names[0] ?? fallback];
}

function primaryVp(state: BattleState, side: Side): number {
  return (state.missionState?.primaryMissionScoringRecords ?? [])
    .filter(record => record.side === side)
    .reduce((total, record) => total + record.vp, 0);
}

function timingLabel(timing?: string): string {
  if (timing === 'end-command-phase') return 'End of Command phase';
  if (timing === 'end-turn') return 'End of turn';
  if (timing === 'end-battle') return 'End of battle';
  return 'Scoring window';
}

function sideLabel(side: Side): string {
  return side === 0 ? 'Blue' : 'Red';
}

function MissionCard({ state, side, missionName }: { state: BattleState; side: Side; missionName: string }) {
  const rule = state.ruleset.edition === '11e'
    ? eleventhPrimaryMissionRuleForName(missionName)
    : null;
  const records = (state.missionState?.primaryMissionScoringRecords ?? [])
    .filter(record => record.side === side)
    .slice(-4)
    .reverse();
  const accent = side === 0 ? '#77b9ff' : '#ff8b8b';

  return (
    <Box sx={{
      border: `1px solid ${accent}66`,
      borderRadius: 1,
      p: 0.85,
      display: 'grid',
      gap: 0.55,
      minWidth: 0,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'baseline' }}>
        <Typography variant="caption" sx={{ color: accent, fontWeight: 900, minWidth: 0 }}>
          {sideLabel(side)}: {missionName}
        </Typography>
        <Typography variant="caption" sx={{ color: uiTokens.color.status.success, fontWeight: 900, whiteSpace: 'nowrap' }}>
          {primaryVp(state, side)} VP
        </Typography>
      </Box>

      {rule?.scoring?.length ? (
        <details>
          <summary style={{ cursor: 'pointer', color: uiTokens.color.text.muted, fontSize: 11 }}>
            View scoring rules ({rule.scoring.length})
          </summary>
          <Box sx={{ display: 'grid', gap: 0.45, mt: 0.6 }}>
            {rule.scoring.map(clause => (
              <Box key={clause.id} sx={{ borderLeft: `2px solid ${accent}66`, pl: 0.65 }}>
                <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.subtle, fontWeight: 800 }}>
                  {timingLabel(clause.timing)} · {clause.vp} VP
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', color: uiTokens.color.text.muted, lineHeight: 1.25 }}>
                  {clause.sourceText}
                </Typography>
              </Box>
            ))}
          </Box>
        </details>
      ) : (
        <Typography variant="caption" sx={{ color: uiTokens.color.text.muted }}>
          The mission name is tracked, but its scoring text is not available in the current catalog.
        </Typography>
      )}

      {records.length > 0 && (
        <Box sx={{ display: 'grid', gap: 0.25, borderTop: `1px solid ${uiTokens.border.statDivider}`, pt: 0.5 }}>
          <Typography variant="caption" sx={{ color: uiTokens.color.text.subtle, fontWeight: 800 }}>
            Scoring history
          </Typography>
          {records.map(record => (
            <Typography key={record.id} variant="caption" sx={{ color: uiTokens.color.text.muted, lineHeight: 1.2 }}>
              Round {record.battleRound}: {record.vp > 0 ? `+${record.vp}` : '0'} VP · {record.status.replace('-', ' ')}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function PrimaryMissionPanel({ state }: { state: BattleState }) {
  if (!state.setup) return null;
  const [blueMission, redMission] = primaryMissionNames(state);

  return (
    <Box
      component="section"
      aria-label="Primary missions"
      sx={{
        flex: '0 0 auto',
        maxHeight: 'min(42vh, 440px)',
        overflowY: 'auto',
        p: 1,
        borderBottom: `1px solid ${uiTokens.border.subtle}`,
        background: uiTokens.surface.panel,
        display: 'grid',
        gap: 0.7,
      }}
    >
      <Typography variant="subtitle2" sx={{ color: uiTokens.color.text.primary, fontWeight: 900 }}>
        Primary Missions
      </Typography>
      <MissionCard state={state} side={0} missionName={blueMission} />
      <MissionCard state={state} side={1} missionName={redMission} />
    </Box>
  );
}
