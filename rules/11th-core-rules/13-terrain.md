# 13 Terrain

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 13.01 Placing Terrain
- 13.02 Terrain Categories
  - 13.02.01 Creating Your Own Battlefield
- 13.03 Exposed Terrain
- 13.04 Light Terrain
- 13.05 Dense Terrain
- 13.06 Terrain And Movement
  - 13.06.01 Solid Terrain and Movement
- 13.07 Terrain And Visibility
- 13.08 Benefit Of Cover
- 13.09 Hidden
  - 13.09.01 Hidden and the First Turn
- 13.10 Obscuring
- 13.11 Solid
  - 13.11.01 Gone to Ground

## Implementation Notes

- Terrain placement data, cover behavior, movement blocking, feature/wall collision, LOS blocking, Hidden/Obscuring/Solid-style visibility hooks, and Benefit of Cover interactions are represented.
- Terrain layouts load from JSON through the shared registry.
- `11e-event-layouts.json` currently contains 45 layout entries, but they still need exact validation/finalization against the Event Companion source.

## TODO

- Validate and finalize the 45 11th Event Companion terrain layouts already present in `11e-event-layouts.json`.
- Replace any mirrored-half/template placeholder descriptions or coordinates with exact full-layout data where needed.
- Re-audit terrain footprints, walls/features, Hidden units, cover, LOS, and Gone to Ground behavior.
- Keep walls in saved terrain mat templates where needed.
