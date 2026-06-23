import type { Terrain, TerrainFeature, TerrainLayout } from '../types/battle';
import type { DeploymentZoneSet } from './deploymentZoneTypes';

export interface TerrainFeatureSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  featureHeight: TerrainFeature['featureHeight'];
  blocksLOS?: boolean;
  blocksMovement?: boolean;
  difficult?: boolean;
  color?: string;
  shape?: 'block' | 'wall';
  name?: string;
}

export interface TerrainSpec {
  kind: Terrain['type'] | 'crate';
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  polygonPoints?: Array<{ x: number; y: number }>;
  name?: string;
  providesCover?: boolean;
  difficult?: boolean;
  color?: string;
  objectiveRole?: Terrain['objectiveRole'];
  featureHeight?: TerrainFeature['featureHeight'];
  featureShape?: 'l' | 'block' | 'none';
  features?: TerrainFeatureSpec[];
}

export interface TerrainLayoutSpec {
  id: string;
  name: string;
  description: string;
  deploymentZones?: DeploymentZoneSet;
  terrain: TerrainSpec[];
}

export type TerrainLayoutData = TerrainLayoutSpec | TerrainLayout;

export interface TerrainLayoutPack {
  version?: number;
  exportedAt?: string;
  layouts: TerrainLayoutData[];
}
