import type { BoardFormat, Position } from './battle';

export interface MissionLayout {
  id: string;
  name: string;
  boardFormat: BoardFormat['id'];
  description: string;
  objectives: Position[];
}
