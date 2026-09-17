import type { Terrain, TerrainFeature, TerrainLayout } from '../types/battle';
import { clone } from './clone';
import { DEFAULT_TERRAIN_LAYOUT_PACK } from '../data/terrainLayouts';
import { deploymentZoneSetForId } from '../data/deploymentZones';
import { TERRAIN_SHAPE_TEMPLATES } from '../data/terrainShapes';
import type { TerrainLayoutData, TerrainShapeInstance, TerrainSpec } from '../data/terrainLayoutTypes';

const DEFAULT_LAYOUT_BOARD_WIDTH = 60;
const DEFAULT_LAYOUT_BOARD_HEIGHT = 44;

let _id = 0;
function tid(): string { return `t${++_id}`; }
function fid(parentId: string, index: number): string { return `${parentId}-f${index + 1}`; }

function colorFor(spec: TerrainSpec): string {
  if (spec.kind === 'obstacle') return 'rgba(140,120,95,0.9)';
  if (spec.kind === 'area') return spec.name === 'Rubble' ? 'rgba(90,75,60,0.6)' : 'rgba(25,85,30,0.75)';
  if (spec.kind === 'crate') return 'rgba(160,120,40,0.9)';
  return 'rgba(110,85,60,0.85)';
}

function terrainFromSpec(spec: TerrainSpec): Terrain {
  const type = spec.kind === 'crate' ? 'obstacle' : spec.kind;
  const id = tid();
  const terrain: Terrain = {
    id,
    templateId: spec.templateId,
    name: spec.name ?? (type === 'ruin' ? 'Ruins' : type),
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    rotationDeg: spec.rotationDeg,
    polygonPoints: spec.polygonPoints,
    type,
    providesCover: spec.providesCover ?? (type !== 'area' || spec.name !== 'Rubble'),
    difficult: spec.difficult ?? type === 'area',
    color: spec.color ?? colorFor(spec),
    objectiveRole: spec.objectiveRole,
    objectiveGroupId: spec.objectiveGroupId,
    features: [],
  };
  terrain.features = featuresFromSpec(terrain, spec);
  return terrain;
}

function isRuntimeTerrainLayout(layout: TerrainLayoutData | TerrainLayout): layout is TerrainLayout {
  return Array.isArray(layout.terrain) && layout.terrain.every(terrain => 'type' in terrain && 'providesCover' in terrain && 'features' in terrain);
}

const terrainShapeById = new Map(TERRAIN_SHAPE_TEMPLATES.map(shape => [shape.id, shape]));

function rotate(point: { x: number; y: number }, degrees: number) {
  const radians = degrees * Math.PI / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function terrainSpecFromInstance(instance: TerrainShapeInstance): TerrainSpec {
  const shape = terrainShapeById.get(instance.shapeId);
  if (!shape) throw new Error(`Unknown terrain shape: ${instance.shapeId}`);
  const rotationDeg = instance.rotationDeg;
  return {
    ...shape,
    templateId: shape.id,
    x: instance.x,
    y: instance.y,
    rotationDeg,
    objectiveRole: instance.objectiveRole,
    objectiveGroupId: instance.objectiveGroupId,
    features: shape.features?.map(feature => {
      const position = rotate({ x: feature.x, y: feature.y }, rotationDeg);
      return { ...feature, x: position.x + instance.x, y: position.y + instance.y, rotationDeg: (feature.rotationDeg ?? 0) + rotationDeg };
    }),
  };
}

function cloneDeploymentZones(zones: NonNullable<TerrainLayout['deploymentZones']>): NonNullable<TerrainLayout['deploymentZones']> {
  return clone(zones);
}

export function terrainLayoutFromData(layout: TerrainLayoutData | TerrainLayout): TerrainLayout {
  if (isRuntimeTerrainLayout(layout)) {
    return {
      ...layout,
      terrain: layout.terrain.map(terrain => ({
        ...terrain,
        features: terrain.features.map(feature => ({
          ...feature,
          category: feature.category ?? inferFeatureCategory(terrain, feature.featureHeight),
        })),
      })),
    };
  }
  const boardWidth = layout.boardWidth ?? DEFAULT_LAYOUT_BOARD_WIDTH;
  const boardHeight = layout.boardHeight ?? DEFAULT_LAYOUT_BOARD_HEIGHT;
  const sourceTerrain = layout.terrain ?? layout.terrainInstances?.map(terrainSpecFromInstance) ?? [];
  const terrainSpecs = layout.coordinateSystem === 'board-center'
    ? sourceTerrain.map(spec => centeredTerrainSpecToRuntime(
      spec,
      boardWidth,
      boardHeight,
      layout.terrainAnchor ?? 'center',
    ))
    : sourceTerrain;
  const deploymentZones = deploymentZoneSetForId(layout.deploymentZoneId) ?? layout.deploymentZones;
  return {
    id: layout.id,
    name: layout.name,
    description: layout.description,
    deploymentZoneId: layout.deploymentZoneId,
    deploymentZones: deploymentZones ? cloneDeploymentZones(deploymentZones) : undefined,
    territoryZones: layout.territoryZones,
    terrain: terrainSpecs.map(terrainFromSpec),
  };
}

/** Materialize one reusable shape at a board-centred lower-left origin. */
export function terrainFromShapeInstance(
  instance: TerrainShapeInstance,
  boardWidth = DEFAULT_LAYOUT_BOARD_WIDTH,
  boardHeight = DEFAULT_LAYOUT_BOARD_HEIGHT,
): Terrain {
  const layout = terrainLayoutFromData({
    id: '__terrain-shape-preview__',
    name: 'Terrain shape preview',
    description: '',
    coordinateSystem: 'board-center',
    terrainAnchor: 'lower-left',
    boardWidth,
    boardHeight,
    terrainInstances: [instance],
  });
  const terrain = layout.terrain[0];
  if (!terrain) throw new Error(`Unable to materialize terrain shape: ${instance.shapeId}`);
  return terrain;
}

function rotatedHalfSize(width: number, height: number, rotationDeg = 0) {
  const radians = rotationDeg * Math.PI / 180;
  return {
    x: width / 2 * Math.cos(radians) - height / 2 * Math.sin(radians),
    y: width / 2 * Math.sin(radians) + height / 2 * Math.cos(radians),
  };
}

function centeredShapeToRuntime(
  shape: { x: number; y: number; width: number; height: number; rotationDeg?: number },
  boardWidth: number,
  boardHeight: number,
  anchor: 'center' | 'local-origin' | 'lower-left',
) {
  if (anchor === 'lower-left') {
    const runtimeRotation = -(shape.rotationDeg ?? 0);
    const lowerLeftOffset = rotatedHalfSize(-shape.width, shape.height, runtimeRotation);
    const centerX = boardWidth / 2 + shape.x - lowerLeftOffset.x;
    const centerY = boardHeight / 2 - shape.y - lowerLeftOffset.y;
    return {
      x: centerX - shape.width / 2,
      y: centerY - shape.height / 2,
      rotationDeg: runtimeRotation,
    };
  }
  const offset = anchor === 'local-origin'
    ? rotatedHalfSize(shape.width, shape.height, shape.rotationDeg)
    : { x: 0, y: 0 };
  return {
    x: shape.x + boardWidth / 2 + offset.x - shape.width / 2,
    y: shape.y + boardHeight / 2 + offset.y - shape.height / 2,
    rotationDeg: shape.rotationDeg,
  };
}

function centeredTerrainSpecToRuntime(
  spec: TerrainSpec,
  boardWidth: number,
  boardHeight: number,
  anchor: 'center' | 'local-origin' | 'lower-left',
): TerrainSpec {
  const position = centeredShapeToRuntime(spec, boardWidth, boardHeight, anchor);
  return {
    ...spec,
    ...position,
    polygonPoints: anchor === 'lower-left'
      ? spec.polygonPoints?.map(point => ({ ...point, y: spec.height - point.y }))
      : spec.polygonPoints,
    features: spec.features?.map(feature => ({
      ...feature,
      ...centeredShapeToRuntime(feature, boardWidth, boardHeight, anchor),
    })),
  };
}

function featureFromSpec(parent: Terrain, spec: NonNullable<TerrainSpec['features']>[number], index: number): TerrainFeature {
  const blocksLOS = spec.blocksLOS ?? spec.featureHeight !== 'low';
  const blocksMovement = spec.blocksMovement ?? spec.featureHeight !== 'low';
  return {
    id: fid(parent.id, index),
    name: spec.name ?? `${parent.name} feature`,
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    rotationDeg: spec.rotationDeg ?? parent.rotationDeg,
    featureHeight: spec.featureHeight,
    category: spec.category ?? inferFeatureCategory(parent, spec.featureHeight),
    blocksLOS,
    blocksMovement,
    difficult: spec.difficult ?? (spec.featureHeight === 'low' || spec.featureHeight === 'mid'),
    color: spec.color ?? featureColor(spec.featureHeight, spec.category ?? inferFeatureCategory(parent, spec.featureHeight)),
  };
}

function inferFeatureCategory(parent: Terrain, featureHeight: TerrainFeature['featureHeight']): NonNullable<TerrainFeature['category']> {
  return parent.type === 'ruin' && featureHeight !== 'low' ? 'dense' : 'light';
}

function featuresFromSpec(parent: Terrain, spec: TerrainSpec): TerrainFeature[] {
  if (spec.featureShape === 'none') return [];
  if (spec.features?.length) return spec.features.map((feature, i) => featureFromSpec(parent, feature, i));
  if (parent.type !== 'ruin' && parent.type !== 'obstacle' && spec.kind !== 'crate') return [];

  const featureHeight = spec.featureHeight ?? inferFeatureHeight(spec);
  if (spec.featureShape === 'block' || spec.kind === 'crate') {
    return [featureFromSpec(parent, {
      x: parent.x + parent.width * 0.15,
      y: parent.y + parent.height * 0.15,
      width: parent.width * 0.7,
      height: parent.height * 0.7,
      rotationDeg: parent.rotationDeg,
      featureHeight,
      name: `${parent.name} block`,
    }, 0)];
  }

  const thickness = 0.5;
  const inset = 0.45;
  return [
    featureFromSpec(parent, {
      x: parent.x + inset,
      y: parent.y + inset,
      width: Math.max(thickness, parent.width - inset * 2),
      height: thickness,
      rotationDeg: parent.rotationDeg,
      featureHeight,
      name: `${parent.name} wall`,
    }, 0),
    featureFromSpec(parent, {
      x: parent.x + inset,
      y: parent.y + inset,
      width: thickness,
      height: Math.max(thickness, parent.height * 0.65),
      rotationDeg: parent.rotationDeg,
      featureHeight,
      name: `${parent.name} return wall`,
    }, 1),
  ];
}

function inferFeatureHeight(spec: TerrainSpec): TerrainFeature['featureHeight'] {
  // Obstacles and crates are solid objects — always tall enough to block LOS.
  if (spec.kind === 'obstacle' || spec.kind === 'crate') return 'tall';
  return Math.min(spec.width, spec.height) <= 4 && Math.max(spec.width, spec.height) <= 6
    ? 'low'
    : 'tall';
}

export function featureColor(
  _height: TerrainFeature['featureHeight'],
  category: TerrainFeature['category'] = 'dense',
): string {
  return category === 'light'
    ? 'rgba(165,125,20,0.96)'
    : 'rgba(25,105,50,0.96)';
}

export const TERRAIN_LAYOUTS: TerrainLayout[] = DEFAULT_TERRAIN_LAYOUT_PACK.layouts.map(terrainLayoutFromData);

function ruin(x: number, y: number, w: number, h: number, rotationDeg = 0, name = 'Ruins'): Terrain {
  return terrainFromSpec({ kind: 'ruin', x, y, width: w, height: h, rotationDeg, name });
}

function wall(x: number, y: number, w: number, h: number, rotationDeg = 0, name = 'Wall'): Terrain {
  return terrainFromSpec({ kind: 'obstacle', x, y, width: w, height: h, rotationDeg, name });
}

function forest(x: number, y: number, w: number, h: number, rotationDeg = 0, name = 'Forest'): Terrain {
  return terrainFromSpec({ kind: 'area', x, y, width: w, height: h, rotationDeg, name });
}

function rubble(x: number, y: number, w: number, h: number, rotationDeg = 0, name = 'Rubble'): Terrain {
  return terrainFromSpec({ kind: 'area', x, y, width: w, height: h, rotationDeg, name });
}

function crate(x: number, y: number, name = 'Crates'): Terrain {
  return terrainFromSpec({ kind: 'crate', x, y, width: 2.5, height: 2, name });
}

function keepGeneratedTerrainOnBoard(terrain: Terrain): Terrain {
  const boardWidth = 60;
  const boardHeight = 44;
  const rotation = (terrain.rotationDeg ?? 0) * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(rotation)) * terrain.width
    + Math.abs(Math.sin(rotation)) * terrain.height) / 2;
  const halfHeight = (Math.abs(Math.sin(rotation)) * terrain.width
    + Math.abs(Math.cos(rotation)) * terrain.height) / 2;
  const centreX = Math.max(halfWidth, Math.min(boardWidth - halfWidth, terrain.x + terrain.width / 2));
  const centreY = Math.max(halfHeight, Math.min(boardHeight - halfHeight, terrain.y + terrain.height / 2));
  const dx = centreX - (terrain.x + terrain.width / 2);
  const dy = centreY - (terrain.y + terrain.height / 2);
  return {
    ...terrain,
    x: terrain.x + dx,
    y: terrain.y + dy,
    features: terrain.features.map(feature => ({
      ...feature,
      x: feature.x + dx,
      y: feature.y + dy,
    })),
  };
}

export function generateRandomLayout(): TerrainLayout {
  const savedId = _id;
  _id = 2000;

  const terrain: Terrain[] = [];

  const centralCount = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < centralCount; i++) {
    terrain.push(ruin(
      22 + Math.random() * 16,
      10 + Math.random() * 24,
      4 + Math.random() * 5,
      4 + Math.random() * 5,
      (Math.random() - 0.5) * 60,
    ));
  }

  const flankFeatures: Array<() => Terrain> = [
    () => ruin(7 + Math.random() * 4, 4 + Math.random() * 36, 4 + Math.random() * 4, 4 + Math.random() * 4),
    () => ruin(49 + Math.random() * 4, 4 + Math.random() * 36, 4 + Math.random() * 4, 4 + Math.random() * 4),
    () => forest(6 + Math.random() * 6, 4 + Math.random() * 36, 4 + Math.random() * 5, 4 + Math.random() * 5),
    () => forest(48 + Math.random() * 6, 4 + Math.random() * 36, 4 + Math.random() * 5, 4 + Math.random() * 5),
  ];
  flankFeatures.forEach(fn => terrain.push(fn()));

  const midCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < midCount; i++) {
    if (Math.random() > 0.4) {
      terrain.push(wall(12 + Math.random() * 36, 8 + Math.random() * 28, 3 + Math.random() * 4, 1.5));
    } else {
      terrain.push(rubble(12 + Math.random() * 36, 8 + Math.random() * 28, 4 + Math.random() * 4, 3 + Math.random() * 3));
    }
  }

  terrain.push(crate(29 + Math.random() * 2, 21 + Math.random() * 2));

  _id = savedId;
  return {
    id: 'random',
    name: 'Random Layout',
    description: 'Procedurally generated terrain - different every time',
    terrain: terrain.map(keepGeneratedTerrainOnBoard),
  };
}
