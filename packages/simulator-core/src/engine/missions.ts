import type { BattleSetup, Position } from '../types/battle';
import { CHAPTER_APPROVED_MISSION_POOL, ELEVENTH_EVENT_MISSION_MATCHUPS, ELEVENTH_FORCE_DISPOSITIONS, type EleventhForceDispositionId as DataEleventhForceDispositionId, type EleventhForceDispositionSpec, type EleventhMissionMatchupSpec, type TournamentMissionSpec } from '../data/missions';
import { DEFAULT_OBJECTIVE_MARKERS, OBJECTIVE_MARKER_SETS } from '../data/objectiveMarkers';
import { missionLayoutForBoardFormat } from '../data/missionLayouts';
import type { BoardFormat } from '../types/battle';

export type TournamentMission = TournamentMissionSpec;
export type EleventhForceDispositionId = DataEleventhForceDispositionId;
export type EleventhForceDisposition = EleventhForceDispositionSpec;
export type EleventhMissionMatchup = EleventhMissionMatchupSpec;
export type EleventhForceDispositionPair = [EleventhForceDispositionId, EleventhForceDispositionId];

export const TOURNAMENT_MISSIONS: TournamentMission[] = CHAPTER_APPROVED_MISSION_POOL;
export const ELEVENTH_EDITION_FORCE_DISPOSITIONS: EleventhForceDisposition[] = ELEVENTH_FORCE_DISPOSITIONS;
export const ELEVENTH_EDITION_MISSION_MATCHUPS: EleventhMissionMatchup[] = ELEVENTH_EVENT_MISSION_MATCHUPS;

export const PRIMARY_MISSIONS = Array.from(new Set(
  TOURNAMENT_MISSIONS.map(mission => mission.primaryMission),
));

export const DEPLOYMENTS = Array.from(new Set(
  TOURNAMENT_MISSIONS.map(mission => mission.deployment),
));

export const DEFAULT_OBJECTIVES: Position[] = DEFAULT_OBJECTIVE_MARKERS.objectives;

export function objectivesForDeployment(
  deployment: string,
  boardFormat: BoardFormat['id'] = 'strike-force',
): Position[] {
  if (boardFormat !== 'strike-force') {
    return missionLayoutForBoardFormat(boardFormat).objectives.map(position => ({ ...position }));
  }
  return (
    OBJECTIVE_MARKER_SETS.find(markerSet => markerSet.deployment === deployment)?.objectives
    ?? DEFAULT_OBJECTIVES
  );
}

export function setupLabel(mission: TournamentMission, terrainLayoutName: string): BattleSetup {
  return {
    missionCode: mission.code,
    primaryMission: mission.primaryMission,
    deployment: mission.deployment,
    terrainLayout: terrainLayoutName,
  };
}

export function eleventhForceDispositionForId(id: EleventhForceDispositionId): EleventhForceDisposition {
  return ELEVENTH_EDITION_FORCE_DISPOSITIONS.find(disposition => disposition.id === id)
    ?? ELEVENTH_EDITION_FORCE_DISPOSITIONS[0];
}

export function eleventhForceDispositionIdForValue(value: string): EleventhForceDispositionId {
  return ELEVENTH_EDITION_FORCE_DISPOSITIONS.find(disposition =>
    disposition.id === value || disposition.name === value
  )?.id ?? ELEVENTH_EDITION_FORCE_DISPOSITIONS[0].id;
}

export function eleventhMatchupForDispositions(
  forceDispositions: EleventhForceDispositionPair,
): EleventhMissionMatchup {
  const left = forceDispositions[0];
  const right = forceDispositions[1];
  const direct = ELEVENTH_EDITION_MISSION_MATCHUPS.find(matchup =>
    matchup.forceDispositions[0] === left && matchup.forceDispositions[1] === right
  );
  if (direct) return direct;

  const reverse = ELEVENTH_EDITION_MISSION_MATCHUPS.find(matchup =>
    matchup.forceDispositions[0] === right && matchup.forceDispositions[1] === left
  );
  if (reverse) {
    return {
      forceDispositions: [left, right],
      primaryMissions: [reverse.primaryMissions[1], reverse.primaryMissions[0]],
      layoutIds: reverse.layoutIds,
    };
  }

  return ELEVENTH_EDITION_MISSION_MATCHUPS[0];
}

export function eleventhPrimaryMissionsForDispositions(forceDispositions: EleventhForceDispositionPair): [string, string] {
  return eleventhMatchupForDispositions(forceDispositions).primaryMissions;
}

export function eleventhLayoutIdsForDispositions(forceDispositions: EleventhForceDispositionPair): [string, string, string] {
  return eleventhMatchupForDispositions(forceDispositions).layoutIds;
}

export function eleventhSetupLabel(
  mission: TournamentMission,
  terrainLayoutName: string,
  forceDispositions: EleventhForceDispositionPair,
): BattleSetup {
  const primaryMissions = eleventhPrimaryMissionsForDispositions(forceDispositions);
  return {
    missionCode: `11E-${mission.code}`,
    primaryMission: `${primaryMissions[0]} / ${primaryMissions[1]}`,
    primaryMissions,
    forceDispositions,
    deployment: 'Layout Defined',
    terrainLayout: terrainLayoutName,
  };
}

export function missionsForPrimary(primaryMission: string): TournamentMission[] {
  return TOURNAMENT_MISSIONS.filter(mission => mission.primaryMission === primaryMission);
}

export function deploymentsForPrimary(primaryMission: string): string[] {
  return Array.from(new Set(missionsForPrimary(primaryMission).map(mission => mission.deployment)));
}

export function missionForSelection(primaryMission: string, deployment: string): TournamentMission {
  return (
    TOURNAMENT_MISSIONS.find(mission => mission.primaryMission === primaryMission && mission.deployment === deployment)
    ?? missionsForPrimary(primaryMission)[0]
    ?? TOURNAMENT_MISSIONS[0]
  );
}

export function randomMissionSet(): TournamentMission {
  return TOURNAMENT_MISSIONS[Math.floor(Math.random() * TOURNAMENT_MISSIONS.length)];
}
