import type { Terrain, TerrainFeature, TerrainLayout, TerritoryZoneSet } from '../types/battle';
import type { DeploymentZoneSet } from './deploymentZoneTypes';

export interface TerrainFeatureSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  featureHeight: TerrainFeature['featureHeight'];
  category?: NonNullable<TerrainFeature['category']>;
  blocksLOS?: boolean;
  blocksMovement?: boolean;
  difficult?: boolean;
  color?: string;
  shape?: 'block' | 'wall';
  name?: string;
}

export interface TerrainSpec {
  templateId?: string;
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
  objectiveGroupId?: Terrain['objectiveGroupId'];
  featureHeight?: TerrainFeature['featureHeight'];
  featureShape?: 'l' | 'block' | 'none';
  features?: TerrainFeatureSpec[];
}

export interface TerrainLayoutSpec {
  id: string;
  name: string;
  description: string;
  /**
   * Layout interchange coordinates. When set to `board-center`, terrain and
   * feature x/y values are their centers measured from the center of the
   * battlefield. Older files omit this and retain top-left coordinates.
   */
  coordinateSystem?: 'board-center';
  /** Whether each x/y identifies its geometric center, local origin, or lower-left pivot. */
  terrainAnchor?: 'center' | 'local-origin' | 'lower-left';
  boardWidth?: number;
  boardHeight?: number;
  /** Reference to a shared deployment-zone preset. */
  deploymentZoneId?: string;
  deploymentZones?: DeploymentZoneSet;
  territoryZones?: TerritoryZoneSet;
  terrain?: TerrainSpec[];
  terrainInstances?: TerrainShapeInstance[];
}

/** Reusable local geometry; layouts place these by origin and rotation. */
export interface TerrainShapeTemplate extends Omit<TerrainSpec, 'x' | 'y' | 'rotationDeg'> {
  id: string;
}

export interface TerrainShapeInstance {
  id?: string;
  shapeId: string;
  x: number;
  y: number;
  rotationDeg: number;
  objectiveRole?: Terrain['objectiveRole'];
  objectiveGroupId?: Terrain['objectiveGroupId'];
}

export type TerrainLayoutData = TerrainLayoutSpec | TerrainLayout;

export interface TerrainLayoutPack {
  version?: number;
  exportedAt?: string;
  layouts: TerrainLayoutData[];
}
