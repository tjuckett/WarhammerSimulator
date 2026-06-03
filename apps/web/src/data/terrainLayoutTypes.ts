import type { Terrain, TerrainFeature, TerrainLayout } from '@warhammer-simulator/core/types/battle';

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
  name?: string;
  providesCover?: boolean;
  difficult?: boolean;
  color?: string;
  featureHeight?: TerrainFeature['featureHeight'];
  featureShape?: 'l' | 'block' | 'none';
  features?: TerrainFeatureSpec[];
}

export interface TerrainLayoutSpec {
  id: string;
  name: string;
  description: string;
  terrain: TerrainSpec[];
}

export type TerrainLayoutData = TerrainLayoutSpec | TerrainLayout;

export interface TerrainLayoutPack {
  version?: number;
  exportedAt?: string;
  layouts: TerrainLayoutData[];
}
