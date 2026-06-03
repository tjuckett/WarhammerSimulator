import type { Position } from '@warhammer-simulator/core/types/battle';

export interface ObjectiveMarkerSet {
  id: string;
  deployment: string;
  description: string;
  objectives: Position[];
}
