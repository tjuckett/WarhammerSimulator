import type { MissionLayout } from '../types/missionLayout';

/** Standard objective placements in each board's native inch coordinates. */
export const STANDARD_MISSION_LAYOUTS: MissionLayout[] = [
  {
    id: 'strike-force-cross',
    name: 'Strike Force Cross',
    boardFormat: 'strike-force',
    description: 'Five objectives in the standard centre-and-corners pattern.',
    objectives: [
      { x: 30, y: 22 },
      { x: 15, y: 11 },
      { x: 45, y: 11 },
      { x: 15, y: 33 },
      { x: 45, y: 33 },
    ],
  },
  {
    id: 'incursion-diamond',
    name: 'Incursion Diamond',
    boardFormat: 'incursion',
    description: 'Four objectives arranged as a diamond on the 44-inch square board.',
    objectives: [
      { x: 11, y: 11 },
      { x: 33, y: 11 },
      { x: 11, y: 33 },
      { x: 33, y: 33 },
    ],
  },
  {
    id: 'combat-patrol-diamond',
    name: 'Combat Patrol Diamond',
    boardFormat: 'combat-patrol',
    description: 'Four objectives arranged as a diamond on the 30-by-22-inch board.',
    objectives: [
      { x: 7.5, y: 5.5 },
      { x: 22.5, y: 5.5 },
      { x: 7.5, y: 16.5 },
      { x: 22.5, y: 16.5 },
    ],
  },
];

export function missionLayoutForBoardFormat(boardFormat: string): MissionLayout {
  return STANDARD_MISSION_LAYOUTS.find(layout => layout.boardFormat === boardFormat)
    ?? STANDARD_MISSION_LAYOUTS[0];
}
