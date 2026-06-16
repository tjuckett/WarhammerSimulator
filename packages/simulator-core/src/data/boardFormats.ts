import type { BoardFormat, Position } from '../types/battle';

export const BOARD_FORMATS: BoardFormat[] = [
  { id: 'combat-patrol', name: 'Combat Patrol', width: 30, height: 22, deploymentDepth: 6 },
  { id: 'incursion', name: 'Incursion', width: 44, height: 44, deploymentDepth: 9 },
  { id: 'strike-force', name: 'Strike Force', width: 60, height: 44, deploymentDepth: 12 },
];

export const DEFAULT_BOARD_FORMAT = BOARD_FORMATS[2];

export function boardFormatForId(id?: string | null): BoardFormat {
  return BOARD_FORMATS.find(format => format.id === id) ?? DEFAULT_BOARD_FORMAT;
}

export function boardFormatForState(state?: { board?: BoardFormat; setup?: { boardFormat?: string } } | null): BoardFormat {
  return state?.board ?? boardFormatForId(state?.setup?.boardFormat);
}

export function scalePositionForBoard(position: Position, board: BoardFormat): Position {
  const sx = board.width / DEFAULT_BOARD_FORMAT.width;
  const sy = board.height / DEFAULT_BOARD_FORMAT.height;
  return {
    ...position,
    x: position.x * sx,
    y: position.y * sy,
  };
}

export function scalePositionsForBoard(positions: Position[], board: BoardFormat): Position[] {
  if (board.id === DEFAULT_BOARD_FORMAT.id) return positions.map(position => ({ ...position }));
  return positions.map(position => scalePositionForBoard(position, board));
}
