# Terrain layout sources

The JSON files in this directory are preserved source exports from the external terrain-layout format. They remain the authoritative record for ruin parts, roofs, and 3D placement metadata.

The simulator's layout interchange format uses `coordinateSystem: "board-center"` and `terrainAnchor: "lower-left"`. Terrain `x` and `y` identify the lower-left outline pivot measured from the center of the battlefield, with positive Y upward, matching the source export. The runtime converts these values at its boundary for canvas drawing and game geometry. Older layout files without the markers remain compatible with the legacy top-left format.

Generate a normalized layout with:

```text
node scripts/normalize-terrain-layout.mjs <source.json> <output.json> <layout-id>
```

All 18 source files currently in this folder are normalized under `packages/simulator-core/src/data/terrainLayouts/11e/` and replace their matching 11th-edition templates. The imported layouts preserve the source footprints, outlines, and wall paths. Part-level roofs and vertical 3D placement remain in the original source until the terrain model supports multi-level geometry.
