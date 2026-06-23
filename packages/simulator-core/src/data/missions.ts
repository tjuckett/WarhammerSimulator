export interface TournamentMissionSpec {
  code: string;
  primaryMission: string;
  deployment: string;
  terrainLayoutIds: string[];
}

export type EleventhForceDispositionId =
  | 'take-and-hold'
  | 'disruption'
  | 'purge-the-foe'
  | 'priority-targets'
  | 'reconnaissance';

export interface EleventhForceDispositionSpec {
  id: EleventhForceDispositionId;
  name: string;
}

export interface EleventhMissionMatchupSpec {
  forceDispositions: [EleventhForceDispositionId, EleventhForceDispositionId];
  primaryMissions: [string, string];
  layoutIds: [string, string, string];
}

const layouts = (ids: number[]) => ids.map(id => `layout-${id}`);

export const CHAPTER_APPROVED_MISSION_POOL: TournamentMissionSpec[] = [
  { code: 'A', primaryMission: 'Take and Hold', deployment: 'Tipping Point', terrainLayoutIds: layouts([1, 2, 4, 6, 7, 8]) },
  { code: 'B', primaryMission: 'Supply Drop', deployment: 'Tipping Point', terrainLayoutIds: layouts([1, 2, 4, 6, 7, 8]) },
  { code: 'C', primaryMission: 'Linchpin', deployment: 'Tipping Point', terrainLayoutIds: layouts([1, 2, 4, 6, 7, 8]) },
  { code: 'D', primaryMission: 'Scorched Earth', deployment: 'Tipping Point', terrainLayoutIds: layouts([1, 2, 4, 6, 7, 8]) },
  { code: 'E', primaryMission: 'Take and Hold', deployment: 'Hammer and Anvil', terrainLayoutIds: layouts([1, 7, 8]) },
  { code: 'F', primaryMission: 'Hidden Supplies', deployment: 'Hammer and Anvil', terrainLayoutIds: layouts([1, 7, 8]) },
  { code: 'G', primaryMission: 'Purge the Foe', deployment: 'Hammer and Anvil', terrainLayoutIds: layouts([1, 7, 8]) },
  { code: 'H', primaryMission: 'Supply Drop', deployment: 'Hammer and Anvil', terrainLayoutIds: layouts([1, 7, 8]) },
  { code: 'I', primaryMission: 'Hidden Supplies', deployment: 'Search and Destroy', terrainLayoutIds: layouts([1, 2, 3, 4, 6]) },
  { code: 'J', primaryMission: 'Linchpin', deployment: 'Search and Destroy', terrainLayoutIds: layouts([1, 2, 3, 4, 6]) },
  { code: 'K', primaryMission: 'Scorched Earth', deployment: 'Search and Destroy', terrainLayoutIds: layouts([1, 2, 3, 4, 6]) },
  { code: 'L', primaryMission: 'Take and Hold', deployment: 'Search and Destroy', terrainLayoutIds: layouts([1, 2, 3, 4, 6]) },
  { code: 'M', primaryMission: 'Purge the Foe', deployment: 'Crucible of Battle', terrainLayoutIds: layouts([1, 2, 4, 6, 8]) },
  { code: 'N', primaryMission: 'Hidden Supplies', deployment: 'Crucible of Battle', terrainLayoutIds: layouts([1, 2, 4, 6, 8]) },
  { code: 'O', primaryMission: 'Terraform', deployment: 'Crucible of Battle', terrainLayoutIds: layouts([1, 2, 4, 6, 8]) },
  { code: 'P', primaryMission: 'Scorched Earth', deployment: 'Crucible of Battle', terrainLayoutIds: layouts([1, 2, 4, 6, 8]) },
  { code: 'Q', primaryMission: 'Supply Drop', deployment: 'Sweeping Engagement', terrainLayoutIds: layouts([3, 5]) },
  { code: 'R', primaryMission: 'Terraform', deployment: 'Sweeping Engagement', terrainLayoutIds: layouts([3, 5]) },
  { code: 'S', primaryMission: 'Linchpin', deployment: 'Dawn of War', terrainLayoutIds: layouts([5]) },
  { code: 'T', primaryMission: 'Purge the Foe', deployment: 'Dawn of War', terrainLayoutIds: layouts([5]) },
];

export const ELEVENTH_FORCE_DISPOSITIONS: EleventhForceDispositionSpec[] = [
  { id: 'take-and-hold', name: 'Take & Hold' },
  { id: 'purge-the-foe', name: 'Purge The Foe' },
  { id: 'disruption', name: 'Disruption' },
  { id: 'reconnaissance', name: 'Reconnaissance' },
  { id: 'priority-targets', name: 'Priority Assets' },
];

function eleventhLayoutIds(a: EleventhForceDispositionId, b: EleventhForceDispositionId): [string, string, string] {
  const base = `11e-${a}-vs-${b}`;
  return [`${base}-a`, `${base}-b`, `${base}-c`];
}

export const ELEVENTH_EVENT_MISSION_MATCHUPS: EleventhMissionMatchupSpec[] = [
  { forceDispositions: ['take-and-hold', 'take-and-hold'], primaryMissions: ['Battlefield Dominance', 'Battlefield Dominance'], layoutIds: eleventhLayoutIds('take-and-hold', 'take-and-hold') },
  { forceDispositions: ['take-and-hold', 'purge-the-foe'], primaryMissions: ['Immovable Object', 'Unstoppable Force'], layoutIds: eleventhLayoutIds('take-and-hold', 'purge-the-foe') },
  { forceDispositions: ['take-and-hold', 'disruption'], primaryMissions: ['Determined Acquisition', 'Death Trap'], layoutIds: eleventhLayoutIds('take-and-hold', 'disruption') },
  { forceDispositions: ['take-and-hold', 'reconnaissance'], primaryMissions: ['Purge and Secure', 'Reconnaissance Sweep'], layoutIds: eleventhLayoutIds('take-and-hold', 'reconnaissance') },
  { forceDispositions: ['take-and-hold', 'priority-targets'], primaryMissions: ['Inescapable Dominion', 'Secure Asset'], layoutIds: eleventhLayoutIds('take-and-hold', 'priority-targets') },
  { forceDispositions: ['purge-the-foe', 'purge-the-foe'], primaryMissions: ['Meatgrinder', 'Meatgrinder'], layoutIds: eleventhLayoutIds('purge-the-foe', 'purge-the-foe') },
  { forceDispositions: ['purge-the-foe', 'disruption'], primaryMissions: ['Punishment', 'Delaying Action'], layoutIds: eleventhLayoutIds('purge-the-foe', 'disruption') },
  { forceDispositions: ['purge-the-foe', 'reconnaissance'], primaryMissions: ['Consecrate', 'Triangulation'], layoutIds: eleventhLayoutIds('purge-the-foe', 'reconnaissance') },
  { forceDispositions: ['purge-the-foe', 'priority-targets'], primaryMissions: ["Destroyer's Wrath", 'Vital Link'], layoutIds: eleventhLayoutIds('purge-the-foe', 'priority-targets') },
  { forceDispositions: ['disruption', 'disruption'], primaryMissions: ['Outmanoeuvre', 'Outmanoeuvre'], layoutIds: eleventhLayoutIds('disruption', 'disruption') },
  { forceDispositions: ['disruption', 'reconnaissance'], primaryMissions: ['Smoke and Mirrors', 'Surveil the Foe'], layoutIds: eleventhLayoutIds('disruption', 'reconnaissance') },
  { forceDispositions: ['disruption', 'priority-targets'], primaryMissions: ['Locate and Deny', 'Extract Relic'], layoutIds: eleventhLayoutIds('disruption', 'priority-targets') },
  { forceDispositions: ['reconnaissance', 'reconnaissance'], primaryMissions: ['Gather Intel', 'Gather Intel'], layoutIds: eleventhLayoutIds('reconnaissance', 'reconnaissance') },
  { forceDispositions: ['reconnaissance', 'priority-targets'], primaryMissions: ['Search and Scour', 'Vanguard Operation'], layoutIds: eleventhLayoutIds('reconnaissance', 'priority-targets') },
  { forceDispositions: ['priority-targets', 'priority-targets'], primaryMissions: ['Sabotage', 'Sabotage'], layoutIds: eleventhLayoutIds('priority-targets', 'priority-targets') },
];
