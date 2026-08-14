import type { TerrainFeatureSpec, TerrainLayoutData, TerrainSpec } from '@warhammer-simulator/core/data/terrainLayoutTypes';
import { terrainLayoutFromData } from '@warhammer-simulator/core/engine/terrain';
import type { Terrain, TerrainLayout } from '@warhammer-simulator/core/types/battle';

const CUSTOM_TERRAIN_KEY = 'warhammer-custom-terrain-layouts';
const TERRAIN_MAT_TEMPLATE_KEY = 'warhammer-terrain-mat-templates';

export type TerrainMatTemplate = {
  id: string;
  name: string;
  terrain: Terrain;
};

export function loadCustomTerrainLayouts(): Record<string, TerrainLayout> {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_TERRAIN_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveCustomTerrainLayouts(layouts: Record<string, TerrainLayout>) {
  localStorage.setItem(CUSTOM_TERRAIN_KEY, JSON.stringify(layouts));
}

export function loadTerrainMatTemplates(): Record<string, TerrainMatTemplate> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TERRAIN_MAT_TEMPLATE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveTerrainMatTemplates(templates: Record<string, TerrainMatTemplate>) {
  localStorage.setItem(TERRAIN_MAT_TEMPLATE_KEY, JSON.stringify(templates));
}

function isTerrainLayoutData(value: unknown): value is TerrainLayoutData {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Partial<TerrainLayoutData>;
  return typeof layout.id === 'string'
    && typeof layout.name === 'string'
    && typeof layout.description === 'string'
    && Array.isArray(layout.terrain);
}

export function readImportedTerrainLayouts(value: unknown): TerrainLayout[] {
  if (Array.isArray(value)) return value.filter(isTerrainLayoutData).map(terrainLayoutFromData);
  if (isTerrainLayoutData(value)) return [terrainLayoutFromData(value)];
  if (value && typeof value === 'object' && Array.isArray((value as { layouts?: unknown }).layouts)) {
    return (value as { layouts: unknown[] }).layouts.filter(isTerrainLayoutData).map(terrainLayoutFromData);
  }
  return [];
}

export function terrainLayoutToData(layout: TerrainLayout): TerrainLayoutData {
  return {
    id: layout.id,
    name: layout.name,
    description: layout.description,
    deploymentZones: layout.deploymentZones,
    territoryZones: layout.territoryZones,
    terrain: layout.terrain.map((terrain): TerrainSpec => ({
      kind: terrain.type,
      x: terrain.x,
      y: terrain.y,
      width: terrain.width,
      height: terrain.height,
      rotationDeg: terrain.rotationDeg ?? 0,
      polygonPoints: terrain.polygonPoints,
      name: terrain.name,
      providesCover: terrain.providesCover,
      difficult: terrain.difficult,
      color: terrain.color,
      objectiveRole: terrain.objectiveRole,
      ...(terrain.features.length
        ? {
          features: terrain.features.map((feature): TerrainFeatureSpec => ({
            x: feature.x,
            y: feature.y,
            width: feature.width,
            height: feature.height,
            rotationDeg: feature.rotationDeg ?? 0,
            featureHeight: feature.featureHeight,
            blocksLOS: feature.blocksLOS,
            blocksMovement: feature.blocksMovement,
            difficult: feature.difficult,
            color: feature.color,
            name: feature.name,
          })),
        }
        : { featureShape: 'none' }),
    })),
  };
}
