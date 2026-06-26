# 11th Edition Core Rules Audit

Date: 2026-06-24

## Source Status

- Local source available: `rules/Warhammer_11th_Core_Rules_Preview.pdf`.
- Local extracted text available: `.tmp-rules-pages/page-13.txt` and `.tmp-rules-pages/page-14.txt`.
- Local event companion source available: `rules/eng_12-06_warhammer40000_event_companion.pdf`.
- Final full 11th Edition core rulebook text is not currently present in the repo.
- Web search did not find an official final 11th Edition core rules PDF. Treat final wording confirmation as blocked until an official final source is available.

## Confirmed Against Available Preview Text

### Movement Phase Structure

Status: implemented.

Preview source covers:
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

Preview source covers:
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

Preview source covers:
- Models move up to their Move characteristic.
- Normal moves cannot move within Engagement Range of enemy models.

Implementation notes:
- Normal movement allowance is enforced.
- Normal moves cannot end within Engagement Range.
- Movement phase advance catches illegal final positions.

### Advance Move

Status: implemented.

Preview source covers:
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

Preview source covers:
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

## Implemented From Available 11th Preview/Event Companion Work

These systems are implemented from the locally available preview/event-companion work, but still need final official wording confirmation.

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

## Final Wording Confirmation Still Needed

Blocked until the final full 11th Edition core rules source is available.

- Command phase and Battle-shock final timing.
- Shooting phase final target eligibility, cover, LOS, and weapon keyword changes.
- Charge phase final timing and Heroic Intervention wording.
- Fight phase final activation order and Counteroffensive wording.
- Final Command Re-roll wording and eligible reroll types.
- Final Rapid Ingress placement timing and restrictions.
- Final Fire Overwatch/Snap Shooting timing, target limits, and hit restrictions.
- Final Smokescreen benefit wording.
- Final Explosives and Crushing Impact wording.
- Final Aircraft rules.
- Final transport, embark, disembark, emergency disembark, and reserves wording.
- Final terrain rules, including terrain footprints, walls/features, Hidden units if present in final text, cover, and LOS.
- Final objective-control rules.

## Mission Rules Status

Not part of core rules, but relevant to 11th completion.

- 24 primary mission names are known and tracked.
- Exact primary mission scoring text is missing.
- Known 11th primary missions deliberately do not award fallback VP until source text is transcribed.
- 45 Event Companion terrain layouts remain manual data-entry work.

## Audit Conclusion

The available local preview text confirms the movement-phase implementation at a high level, including model-level movement, Normal Move, Advance, Fall Back, and Desperate Escape behavior. The remaining 11th core rules are implemented as preview-derived or 10th-compatible behavior where source text is missing.

Do not mark the 11th core rules as final-complete until the final full 11th Edition core rules are added to `rules/` and the final wording confirmation checklist above is completed.
