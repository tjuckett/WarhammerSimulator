# 14 Objectives

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 14.01 Terrain Objectives
  - 14.01.01 Objectives Not Within A Terrain Area
- 14.02 Level Of Control
- 14.03 Secured Objectives

## Implementation Notes

- 11th terrain objective areas, objective roles, level of control by model OC in terrain, Battle-shock OC suppression, and 11th mission scoring over terrain objectives are implemented.
- Objective marker roles can be tagged as home, no man's land, central, or either player's expansion objective in terrain layouts.
- Primary and secondary mission definitions are transcribed in `packages/simulator-core/src/data/missionRules.ts`; objective control, mission actions and markers, destroyed-unit events, condemned-unit selection, and battlefield exits support the implemented primary mission clauses.

## TODO

- Re-check exact Secured Objectives wording before adding sticky-control behavior.
- Encode each layout's territory boundary geometry so territory-dependent mission clauses do not rely on deployment-zone approximations.
- Complete the remaining mission action and secondary-mission state tracking.
- Add tests for every implemented 11th primary and secondary mission scoring rule.
