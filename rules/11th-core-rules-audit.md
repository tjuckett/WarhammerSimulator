# 11th Edition Core Rules Audit

Date: 2026-08-17

## Source Status

- Final local source available: `rules/eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf`.
- The older copy `rules/Warhammer_11th_Core_Rules_Preview.pdf` is retained as a historical reference.
- Local extracted text available: `.tmp-rules-pages/page-13.txt` and `.tmp-rules-pages/page-14.txt`.
- Local event companion source available: `rules/eng_12-06_warhammer40000_event_companion.pdf`.
- The final source is tracked, so final-wording work is actionable; the complete shared-rules re-audit remains open in `TODOS.md`.

## Confirmed Movement Implementation

### Movement Phase Structure

Status: implemented.

The final source covers:
- Movement phase has Move Units and Reinforcements steps.
- Units outside Engagement Range can Normal Move, Advance, or Remain Stationary.
- Units within Engagement Range can Remain Stationary or Fall Back.
- After all unit movement, the phase progresses to Reinforcements.

Implementation notes:
- Play phase supports Move Units and Reinforcements movement steps.
- Unmoved active units can be marked Remained Stationary before advancing to Reinforcements.
- Movement phase advance is blocked by final-position legality and coherency issues.

Primary files:
- `packages/simulator-core/src/engine/simulator.ts`
- `packages/simulator-core/test/scenarioStorage.test.ts`

### Model-Level Movement

Status: implemented.

The final source covers:
- Player chooses the order to move models.
- A moved model can pivot and/or change position along a path.
- Base path cannot cross enemy models or battlefield edge.
- Friendly models can be moved over, but models cannot end on top of another model.
- Monster and Vehicle models cannot move over friendly Monster or Vehicle models.
- Movement distance uses the part of the base that moved furthest.

Implementation notes:
- Model-level position editing exists.
- Movement allowance is tracked per model.
- Non-round pivot distance uses the furthest-moving point of the base.
- Phase advance catches enemy-model crossings, battlefield-edge crossings, base overlaps, and Monster/Vehicle over friendly Monster/Vehicle movement.

Primary files:
- `packages/simulator-core/src/engine/simulator.ts`
- `packages/simulator-core/src/engine/baseSizes.ts`
- `packages/simulator-core/test/scenarioStorage.test.ts`

### Normal Move

Status: implemented.

The final source covers:
- Models move up to their Move characteristic.
- Normal moves cannot move within Engagement Range of enemy models.

Implementation notes:
- Normal movement allowance is enforced.
- Normal moves cannot end within Engagement Range.
- Movement phase advance catches illegal final positions.

### Advance Move

Status: implemented.

The final source covers:
- Advance roll is one D6.
- Each model can move up to Move plus the Advance roll.
- Advance moves cannot move within Engagement Range.
- Units that Advance cannot shoot or charge that turn.

Implementation notes:
- Advance allowance uses D6 and tracks advanced movement state.
- Advanced units are blocked from non-Assault shooting and charging.
- Advance movement cannot end within Engagement Range.

### Fall Back Move and Desperate Escape

Status: implemented.

The final source covers:
- Falling Back models move up to Move.
- They can move within Engagement Range during the move but cannot end within Engagement Range.
- Units that Fell Back cannot shoot or declare a charge that turn.
- Falling Back over enemy models requires Desperate Escape tests, excluding Titanic and Fly.
- Battle-shocked units selected to Fall Back test every model.
- Desperate Escape destroys one model on a 1-2.

Implementation notes:
- Fall Back movement is available to engaged units.
- Fall Back blocks shooting and charging.
- Crossing enemy models triggers Desperate Escape tests.
- Battle-shocked Fall Back tests all models.

## Implemented Core Areas

These systems have source-backed implementations and regression coverage. The remaining cross-edition audit is tracked separately rather than being implied complete by this list.

- 11th ruleset selection and metadata.
- Per-player Force Disposition setup.
- Force Disposition matchup to paired primary mission names.
- Three terrain layout choices per Force Disposition matchup.
- Terrain objective control model for 11th.
- Action support: start action, action blocks shooting/charging, movement cancels action, end-of-turn completion.
- Snap Shooting support: one visible target within 24 inches, unmodified 6s to hit.
- Core stratagem list and targeting/effects:
  - Command Re-roll
  - Epic Challenge
  - Insane Bravery
  - Explosives
  - Crushing Impact
  - Rapid Ingress
  - Fire Overwatch
  - Smokescreen
  - Heroic Intervention
  - Counteroffensive
- Aircraft movement, Strategic Reserves return, charge restrictions, and fight restrictions.
- Vertical movement, vertical coherency, vertical engagement, and vertical range.

## Open Final-Source Implementation Work

The source is available, but these areas still require a complete audit, additional implementation, or source-dependent data before they can be marked final-complete:

- Complete shared 10th-compatible movement, shooting, charge, fight, Battle-shock, objective, reserves, transport, terrain, aircraft, and vertical re-audit.
- Datasheet-specific command abilities, Fight On Death, and typed faction/character effects when authoritative data is available.
- Full Core 25 Muster Armies catalog, points, faction limits, battle-size validation, and roster construction data.
- Allocation-group distinctions that cannot be represented by the current imported per-unit model data.

## Mission Rules Status

Not part of core rules, but relevant to 11th completion.

- 25 primary mission names are known and tracked.
- Exact scoring is implemented from the current mission data with explicit fail-closed behavior for missing layout geometry.
- 45 Event Companion terrain layouts remain manual data-entry work.

## Audit Conclusion

The final core source is now present and the movement implementation, core stratagems, mission systems, transports, aircraft, vertical rules, and supported generic abilities have corresponding code and tests. The remaining cross-edition audit and source-dependent construction/datasheet work remain intentionally open.

Do not mark the 11th core rules as final-complete until the open implementation work above and the matching TODO entries are completed.
