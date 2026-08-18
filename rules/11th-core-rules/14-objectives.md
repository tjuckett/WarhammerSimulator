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
- Core 14.02–14.03 was re-audited against the full local core rules PDF (`../eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf`, p. 52; FAQ p. 88 has no additional Secured Objectives ruling).
- Secured ownership is serialized separately from current OC totals. It retains the securing army's control through ties, including 0–0, and is removed only when the opponent has the greater level of control at an end-of-phase or end-of-turn check.
- The core rules define the effect but do not grant securing by themselves. `SecureObjective` is an explicit replayable action seam for a datasheet or mission rule that grants it; it is not offered as a generic legal action.
- Mission start-of-turn snapshots and scoring use the resulting rules-defined objective owner, so secured ownership is not merely a battlefield display annotation.

## TODO

- Encode each layout's territory boundary geometry so territory-dependent mission clauses do not rely on deployment-zone approximations.
- Cleanse, Plunder, and the currently sourced secondary-mission state paths are implemented and covered by simulator-core tests; newly sourced mission actions remain an explicit follow-up.
- The primary clause coverage harness and focused secondary/action tests cover the currently implemented source-backed scoring rules. Source-dependent or layout-dependent cases remain fail-closed.
