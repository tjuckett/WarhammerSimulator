import type { BattleSetup, Position } from '../types/battle';
import { CHAPTER_APPROVED_MISSION_POOL, type TournamentMissionSpec } from '../data/missions';
import { DEFAULT_OBJECTIVE_MARKERS, OBJECTIVE_MARKER_SETS } from '../data/objectiveMarkers';

export type TournamentMission = TournamentMissionSpec;

export const TOURNAMENT_MISSIONS: TournamentMission[] = CHAPTER_APPROVED_MISSION_POOL;

export const PRIMARY_MISSIONS = Array.from(new Set(
  TOURNAMENT_MISSIONS.map(mission => mission.primaryMission),
));

export const DEPLOYMENTS = Array.from(new Set(
  TOURNAMENT_MISSIONS.map(mission => mission.deployment),
));

export const DEFAULT_OBJECTIVES: Position[] = DEFAULT_OBJECTIVE_MARKERS.objectives;

export function objectivesForDeployment(deployment: string): Position[] {
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
