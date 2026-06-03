import type { Terrain, TerrainFeature, TerrainLayout } from '../types/battle';
import { DEFAULT_TERRAIN_LAYOUT_PACK } from '../data/terrainLayouts';
import type { TerrainLayoutData, TerrainSpec } from '../data/terrainLayoutTypes';

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
    name: spec.name ?? (type === 'ruin' ? 'Ruins' : type),
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    rotationDeg: spec.rotationDeg,
    type,
    providesCover: spec.providesCover ?? (type !== 'area' || spec.name !== 'Rubble'),
    difficult: spec.difficult ?? type === 'area',
    color: spec.color ?? colorFor(spec),
    features: [],
  };
  terrain.features = featuresFromSpec(terrain, spec);
  return terrain;
}

function isRuntimeTerrainLayout(layout: TerrainLayoutData | TerrainLayout): layout is TerrainLayout {
  return layout.terrain.every(terrain => 'type' in terrain && 'providesCover' in terrain && 'features' in terrain);
}

export function terrainLayoutFromData(layout: TerrainLayoutData | TerrainLayout): TerrainLayout {
  if (isRuntimeTerrainLayout(layout)) return layout;
  return {
    id: layout.id,
    name: layout.name,
    description: layout.description,
    terrain: layout.terrain.map(terrainFromSpec),
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
    blocksLOS,
    blocksMovement,
    difficult: spec.difficult ?? (spec.featureHeight === 'low' || spec.featureHeight === 'mid'),
    color: spec.color ?? featureColor(spec.featureHeight),
  };
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
  return Math.min(spec.width, spec.height) <= 4 && Math.max(spec.width, spec.height) <= 6
    ? 'low'
    : 'tall';
}

export function featureColor(height: TerrainFeature['featureHeight']): string {
  if (height === 'low') return 'rgba(5,65,95,0.95)';
  if (height === 'mid') return 'rgba(70,70,70,0.95)';
  return 'rgba(20,20,20,0.9)';
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
    terrain,
  };
}
