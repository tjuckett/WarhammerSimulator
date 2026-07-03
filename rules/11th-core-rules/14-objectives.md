# 14 Objectives

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 14.01 Terrain Objectives
  - 14.01.01 Objectives Not Within A Terrain Area
- 14.02 Level Of Control
- 14.03 Secured Objectives

## Implementation Notes

- 11th terrain objective areas, objective roles, level of control by model OC in terrain, Battle-shock OC suppression, and 11th mission scoring over terrain objectives are implemented.
- Objective marker roles can be tagged as home or no man's land in terrain layouts.
- Primary and secondary mission definitions are transcribed in `packages/simulator-core/src/data/missionRules.ts`; simple current-turn destroyed-enemy-unit clauses are implemented, but many clauses still resolve as unsupported until broader event/action state tracking exists.

## TODO

- Re-check exact Secured Objectives wording before adding sticky-control behavior.
- Add expansion objective roles required by remaining primary and secondary mission state tracking.
- Add state tracking/scoring for start-of-turn objective control/proximity, per-unit destroyed enemy scoring, table-quarter presence, territory/deployment-zone geometry, and mission markers.
- Add tests for every implemented 11th primary and secondary mission scoring rule.
