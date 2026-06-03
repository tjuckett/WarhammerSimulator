import type { Position } from '../types/battle';

export interface ObjectiveMarkerSet {
  id: string;
  deployment: string;
  description: string;
  objectives: Position[];
}
