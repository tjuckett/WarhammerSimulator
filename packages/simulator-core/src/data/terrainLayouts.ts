import layout1 from './terrainLayouts/10e/layout-1.json';
import layout2 from './terrainLayouts/10e/layout-2.json';
import layout3 from './terrainLayouts/10e/layout-3.json';
import layout4 from './terrainLayouts/10e/layout-4.json';
import layout5 from './terrainLayouts/10e/layout-5.json';
import layout6 from './terrainLayouts/10e/layout-6.json';
import layout7 from './terrainLayouts/10e/layout-7.json';
import layout8 from './terrainLayouts/10e/layout-8.json';
import eleventhLayouts from './terrainLayouts/11e/terrain-layouts.json';
import type { TerrainLayoutPack } from './terrainLayoutTypes';

const bundledLayoutData = [
  layout1,
  layout2,
  layout3,
  layout4,
  layout5,
  layout6,
  layout7,
  layout8,
  ...eleventhLayouts.layouts,
];

// The raw files in docs/terrain-layouts remain the source record. The active
// 11e catalog stores terrain as instances of the shared shape library.

export const DEFAULT_TERRAIN_LAYOUT_PACK = {
  version: 1,
  layouts: bundledLayoutData,
} as TerrainLayoutPack;
