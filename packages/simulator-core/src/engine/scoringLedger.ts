import type {
  BattleState,
  PrimaryMissionScoringRecord,
  ScoringLedgerEntry,
  SecondaryMissionScoringRecord,
  Side,
} from '../types/battle';
import { BATTLE_EVENT_TYPE, recordBattleEvent } from './battleEvents';
import { battleRound } from './battleRound';

export type ScoringTrack = ScoringLedgerEntry['track'];

export interface ScoringLedgerRequest {
  id: string;
  track: ScoringTrack;
  sourceId?: string;
  side: Side;
  missionName: string;
  requestedVp: number;
  status: Exclude<ScoringLedgerEntry['status'], 'capped'>;
  detail: string;
  roundCap?: number;
  battleCap?: number;
  sourceCap?: number;
  sourceCapLabel?: string;
  /** Use the scoring window's round when end-of-battle evaluation occurs after turn rollover. */
  battleRound?: number;
}

function legacyLedgerEntries(state: BattleState): ScoringLedgerEntry[] {
  const primary = state.missionState?.primaryMissionScoringRecords ?? [];
  const secondary = state.missionState?.secondaryMissionScoringRecords ?? [];
  return [
    ...primary.map(record => ({
      ...record,
      track: 'primary' as const,
    })),
    ...secondary.map(record => ({
      ...record,
      track: 'secondary' as const,
      sourceId: record.activationId,
    })),
  ];
}

export function scoringLedgerEntries(state: BattleState): ScoringLedgerEntry[] {
  return state.missionState?.scoringLedger ?? legacyLedgerEntries(state);
}

export function applyScoringLedger(state: BattleState, request: ScoringLedgerRequest): ScoringLedgerEntry | null {
  state.missionState ??= {};
  let ledger = state.missionState.scoringLedger ?? legacyLedgerEntries(state);
  state.missionState.scoringLedger = ledger;
  const sourceRecords = request.track === 'primary'
    ? state.missionState.primaryMissionScoringRecords ?? []
    : state.missionState.secondaryMissionScoringRecords ?? [];
  const previous = ledger.find(entry => entry.track === request.track && entry.id === request.id);
  if (previous) {
    // Detailed records are the user-visible audit trail. If a caller explicitly
    // resets one (for example when branching a scenario), permit reevaluation
    // instead of leaving an orphaned ledger entry to suppress it.
    if (sourceRecords.some(record => record.id === request.id)) return null;
    ledger = ledger.filter(entry => entry !== previous);
    state.missionState.scoringLedger = ledger;
  }

  const scoringRound = request.battleRound ?? battleRound(state);
  const requestedVp = request.status === 'awarded' ? Math.max(0, request.requestedVp) : 0;
  const entriesForTrack = ledger.filter(entry => entry.track === request.track && entry.side === request.side);
  const roundAwarded = entriesForTrack
    .filter(entry => entry.battleRound === scoringRound)
    .reduce((total, entry) => total + entry.vp, 0);
  const battleAwarded = entriesForTrack.reduce((total, entry) => total + entry.vp, 0);
  const sourceAwarded = request.sourceId
    ? entriesForTrack.filter(entry => entry.sourceId === request.sourceId).reduce((total, entry) => total + entry.vp, 0)
    : 0;
  const limits = [
    request.roundCap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, request.roundCap - roundAwarded),
    request.battleCap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, request.battleCap - battleAwarded),
    request.sourceCap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, request.sourceCap - sourceAwarded),
  ];
  const vp = Math.min(requestedVp, ...limits);
  const capReasons = requestedVp > vp ? [
    ...(request.roundCap !== undefined && limits[0] < requestedVp ? [`${request.roundCap}VP battle-round ${request.track} limit`] : []),
    ...(request.battleCap !== undefined && limits[1] < requestedVp ? [`${request.battleCap}VP battle ${request.track} limit`] : []),
    ...(request.sourceCap !== undefined && limits[2] < requestedVp
      ? [request.sourceCapLabel ?? `${request.sourceCap}VP source limit`]
      : []),
  ] : [];
  const status = requestedVp > 0 && (vp === 0 || (request.track === 'primary' && vp < requestedVp))
    ? 'capped'
    : request.status;
  if (vp > 0) state.scores[request.side] += vp;
  const entry: ScoringLedgerEntry = {
    id: request.id,
    track: request.track,
    ...(request.sourceId ? { sourceId: request.sourceId } : {}),
    side: request.side,
    missionName: request.missionName,
    requestedVp,
    vp,
    status,
    detail: request.detail,
    ...(capReasons.length ? { capReasons } : {}),
    battleRound: scoringRound,
    turn: state.turn,
    activeSide: state.activeArmy,
    phase: state.phase,
    scoreAfter: state.scores[request.side],
  };
  state.missionState.scoringLedger = [...ledger, entry];
  recordBattleEvent(state, {
    type: BATTLE_EVENT_TYPE.ScoringApplied,
    side: request.side,
    source: request.missionName,
    data: { ...entry },
  });
  return entry;
}

export function primaryRecordFromLedger(
  entry: ScoringLedgerEntry,
  details: Pick<PrimaryMissionScoringRecord, 'clauseIds' | 'timing' | 'clauseDetails' | 'unsupportedReasons'>,
): PrimaryMissionScoringRecord {
  return {
    ...entry,
    clauseIds: details.clauseIds,
    timing: details.timing,
    clauseDetails: details.clauseDetails,
    unsupportedReasons: details.unsupportedReasons,
    capDetail: entry.capReasons?.length
      ? `Requested ${entry.requestedVp}VP; awarded ${entry.vp}VP due to the ${entry.capReasons.join(', ')}.`
      : `Requested and awarded ${entry.vp}VP.`,
  };
}

export function secondaryRecordFromLedger(
  entry: ScoringLedgerEntry,
  details: Pick<SecondaryMissionScoringRecord, 'activationId' | 'clauseIds'>,
): SecondaryMissionScoringRecord {
  return {
    ...entry,
    activationId: details.activationId,
    clauseIds: details.clauseIds,
  };
}
