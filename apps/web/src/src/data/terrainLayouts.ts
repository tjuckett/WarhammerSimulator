import layout1 from './terrainLayouts/layout-1.json';
import layout2 from './terrainLayouts/layout-2.json';
import layout3 from './terrainLayouts/layout-3.json';
import layout4 from './terrainLayouts/layout-4.json';
import layout5 from './terrainLayouts/layout-5.json';
import layout6 from './terrainLayouts/layout-6.json';
import layout7 from './terrainLayouts/layout-7.json';
import layout8 from './terrainLayouts/layout-8.json';
import type { TerrainLayoutPack } from './terrainLayoutTypes';

export const DEFAULT_TERRAIN_LAYOUT_PACK = {
  version: 1,
  layouts: [layout1, layout2, layout3, layout4, layout5, layout6, layout7, layout8],
} as TerrainLayoutPack;
