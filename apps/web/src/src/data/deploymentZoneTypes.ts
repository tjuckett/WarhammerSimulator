import type { Position } from '../types/battle';

export type DeploymentZoneShape =
  | { type: 'rect'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'triangle'; points: [Position, Position, Position] }
  | {
      type: 'rectWithCircleCut';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      cutoutCenter: Position;
      cutoutRadius: number;
    };

export interface DeploymentZoneSide {
  name: string;
  role: 'defender' | 'attacker';
  shapes: DeploymentZoneShape[];
}

export interface DeploymentZoneSet {
  id: string;
  deployment: string;
  description: string;
  axis: 'x' | 'y' | 'diagonal';
  sides: [DeploymentZoneSide, DeploymentZoneSide];
}
