import type { TerrainFeatureSpec, TerrainLayoutData, TerrainSpec } from '@warhammer-simulator/core/data/terrainLayoutTypes';
import { deploymentZoneSetForId } from '@warhammer-simulator/core/data/deploymentZones';
import { terrainLayoutFromData } from '@warhammer-simulator/core/engine/terrain';
import type { Terrain, TerrainLayout } from '@warhammer-simulator/core/types/battle';

const EXPORTED_BOARD_WIDTH = 60;
const EXPORTED_BOARD_HEIGHT = 44;

function lowerLeftOriginForShape(shape: { x: number; y: number; width: number; height: number; rotationDeg?: number }) {
  const radians = (shape.rotationDeg ?? 0) * Math.PI / 180;
  const lowerLeftOffsetX = -shape.width / 2 * Math.cos(radians) - shape.height / 2 * Math.sin(radians);
  const lowerLeftOffsetY = -shape.width / 2 * Math.sin(radians) + shape.height / 2 * Math.cos(radians);
  return {
    x: shape.x + shape.width / 2 + lowerLeftOffsetX - EXPORTED_BOARD_WIDTH / 2,
    y: EXPORTED_BOARD_HEIGHT / 2 - (shape.y + shape.height / 2 + lowerLeftOffsetY),
  };
}

const CUSTOM_TERRAIN_KEY = 'warhammer-custom-terrain-layouts';
const TERRAIN_MAT_TEMPLATE_KEY = 'warhammer-terrain-mat-templates';

export type TerrainMatTemplate = {
  id: string;
  name: string;
  terrain: Terrain;
};

export function loadCustomTerrainLayouts(): Record<string, TerrainLayout> {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_TERRAIN_KEY) ?? '{}') as Record<string, TerrainLayout>;
    return Object.fromEntries(Object.entries(parsed).map(([id, layout]) => [id, terrainLayoutFromData(layout)]));
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
    && (Array.isArray(layout.terrain) || Array.isArray(layout.terrainInstances));
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
  const deploymentZoneId = layout.deploymentZoneId
    ?? (deploymentZoneSetForId(layout.deploymentZones?.id) ? layout.deploymentZones?.id : undefined);
  return {
    id: layout.id,
    name: layout.name,
    description: layout.description,
    coordinateSystem: 'board-center',
    terrainAnchor: 'lower-left',
    boardWidth: EXPORTED_BOARD_WIDTH,
    boardHeight: EXPORTED_BOARD_HEIGHT,
    ...(deploymentZoneId ? { deploymentZoneId } : { deploymentZones: layout.deploymentZones }),
    territoryZones: layout.territoryZones,
    terrain: layout.terrain.map((terrain): TerrainSpec => ({
      kind: terrain.type,
      ...lowerLeftOriginForShape(terrain),
      width: terrain.width,
      height: terrain.height,
      rotationDeg: -(terrain.rotationDeg ?? 0),
      polygonPoints: terrain.polygonPoints?.map(point => ({ ...point, y: terrain.height - point.y })),
      name: terrain.name,
      providesCover: terrain.providesCover,
      difficult: terrain.difficult,
      color: terrain.color,
      objectiveRole: terrain.objectiveRole,
      objectiveGroupId: terrain.objectiveGroupId,
      ...(terrain.features.length
        ? {
          features: terrain.features.map((feature): TerrainFeatureSpec => ({
            ...lowerLeftOriginForShape(feature),
            width: feature.width,
            height: feature.height,
            rotationDeg: -(feature.rotationDeg ?? 0),
            featureHeight: feature.featureHeight,
            category: feature.category,
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
