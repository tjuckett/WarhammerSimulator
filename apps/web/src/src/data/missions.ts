export interface TournamentMissionSpec {
  code: string;
  primaryMission: string;
  deployment: string;
  terrainLayoutIds: string[];
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
