# Warhammer Simulator — TODOs

## Current Rules Handoff - 2026-06-12

Use this section as the next-session pickup point for the rules implementation work.

### Recently Completed
- [x] Manual battle flow uses battle rounds 1-5 with named turn phases: Command, Movement, Shooting, Charge, Fight.
- [x] Battle-shock is modeled as a check inside the Command phase, not as its own standalone phase.
- [x] Command phase has ordered internal work started: command point gain first, then Battle-shock checks/effects.
- [x] Battle-shock effects started: failed units have OC affected and are treated as Battle-shocked until reset.
- [x] Movement action state added for normal move, Advance, Fall Back, and remaining movement allowance.
- [x] Advance restrictions added: a unit cannot Advance after it has already moved.
- [x] Fall Back restrictions started: units that Fall Back are restricted from normal shooting/charging.
- [x] Per-model movement tracking started: each model can spend part of its movement and continue moving until its allowance is used.
- [x] Movement override support started on unit profiles, including move modifiers and auto-6 Advance style behavior.
- [x] Canvas movement HUD added for selected models to show remaining movement on the board.
- [x] `BattleUnit` now carries `modelPositions` as the source of truth; `position` is the centroid for range/LOS checks.
- [x] Manual play supports selecting, dragging, box-selecting, rotating, and completing individual models.
- [x] Starting movement with another unit locks the prior moved unit for the phase.
- [x] Added explicit `remainedStationary` movement action; unmoved units are marked stationary when the phase advances.
- [x] Added Movement Done UI/action to lock a moved unit.
- [x] Added coherency utilities and UI warnings for out-of-coherency models.
- [x] Movement phase cannot advance while active-army models are out of coherency.
- [x] Movement phase cannot advance while active-army models are in illegal final movement positions, including overlapping bases, battlefield-edge crossings, enemy-model path crossings, blocking terrain crossings, or Monster/Vehicle movement over friendly Monster/Vehicle models.
- [x] Pivot/rotation distance is counted for non-round model footprints using the furthest-moving point of the base.
- [x] Aircraft Movement phase rules started: Aircraft cannot Advance/Fall Back/Remain Stationary, can make Normal moves while engaged, must move straight forward at least 20", can pivot up to 90 degrees for free, can leave the battlefield into Strategic Reserves, and other units can move over enemy Aircraft.
- [x] Added engagement-range checks for normal/Advance movement ending positions.
- [x] Added terrain mat/feature data types and runtime conversion.
- [x] Added terrain feature drawing and feature editing/selection in the battlefield/editor.
- [x] Added per-feature LOS blocking in terrain geometry.
- [x] Added movement collision/pathing support for terrain and models when collision mode is enabled.
- [x] Added movement keyword handling for Fly, Infantry in ruins/low obstacles, Vehicle/Monster in ruins, and Titanic terrain blocking.
- [x] Added Assault weapon behavior so Advanced units can shoot Assault weapons only.
- [x] Added tests for the new movement, coherency, terrain collision, Remained Stationary, Assault, and related shooting rules.

### Next Rules Feature
- [ ] Continue extracting 10th edition Core Rules from `rules/Warhammer_10th_Core_Rules.pdf`.
- [ ] Review one rule at a time with the user before implementing it.
- [ ] Next likely rule area: tighten Movement phase legality around terrain/collision/coherency now that model-level movement exists.
- [x] Coherency enforcement policy implemented: allow temporary incoherency during movement editing, but block Movement phase advance until all active-army units are coherent.
- [ ] Move or expose `findReachablePosition` from `simulator.ts` if other engine modules need it; it currently exists as an internal helper, not in `engine/terrain.ts`.
- [ ] Add/confirm full 10th-edition vertical coherency rules. Current implementation uses base radius + 2" horizontal-style distance and does not model vertical position.
- [ ] Review collision mode UX: normal dragging can ignore terrain/model collision, while collision mode applies the legality/pathing checks.
- [x] Reviewed terrain LOS/cover behavior against the 10th Core Rules PDF and separated ruin footprints, obstacle mats, woods cover, and feature/wall blocking.
- [ ] Continue extracting any remaining terrain edge cases for units starting inside terrain.
- [x] Vertical movement/climbing implemented: model positions support height, vertical movement spends movement allowance, coherency/engagement/range account for vertical separation, and elevated models show height badges on the canvas.
- [x] Aircraft return-from-Strategic-Reserves UX implemented: off-board Aircraft appear in the Staged panel during Reinforcements and can return within 6" of a battlefield edge, more than 9" from enemies, marked as arrived from Reinforcements.
- [x] Aircraft charge/fight restrictions implemented: Aircraft cannot declare charges; only Fly units can charge Aircraft; only Fly units can fight Aircraft; Aircraft can only fight Fly units.

### Rule Architecture Notes
- [x] Prefer core rule functions in `packages/simulator-core`; React should call/import those through `@warhammer-simulator/core`.
- [ ] Keep phase logic structured as ordered phase steps, not one large phase function.
- [ ] Keep edition-specific behavior behind the rules engine so 10th and 11th can share common concepts but diverge cleanly. Some play helpers still default directly to `rules40K10th`; audit as rulesets diverge.
- [ ] Treat 11th edition as a separate ruleset placeholder until rules are actually available; do not guess 11th rules from 10th.
- [ ] Shared concepts likely worth keeping edition-neutral: battle rounds, active army, phase/step cursor, unit/model positions, dice helpers, objective ownership scaffolding.

### Known Rules/UI Followups
- [ ] Review whether "practice game" naming should be changed to a more future-proof term before multiplayer features are added.
- [ ] Improve selected-model action placement/UI if Advance/Fall Back/Movement Done still feel disconnected from selected unit actions.
- [ ] Add tests when each rule is implemented in `packages/simulator-core/test/`.
- [ ] Re-run `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run lint`, and root `npm run build` after frontend/rules changes.

## Done
- [x] 10th edition combat engine (hit/wound/save/damage)
- [x] Weapon keywords: Torrent, Rapid Fire, Blast, Sustained Hits, Devastating Wounds, Lethal Hits, Deadly Demise
- [x] Movement, Shooting, Charge, Fight, Battle-shock phases
- [x] 5-named terrain layouts + random generator with LOS/cover
- [x] Edition switcher (10th live, 11th stub)
- [x] BattleScribe JSON importer
- [x] Objective scoring — OC contest per objective after battle-shock, VP accumulate, score decides winner at end of 5 turns

## Up Next

### Deployment
- [x] **Deployment zones** — units now placed with 2D layout within the 12" deployment zone; melee-only units push to front, ranged-only pull back
- [x] **Deployment strategies** — three named strategies per army (Balanced / Refused Flank / Objective Push); selector in each army panel, disabled once battle starts
- [x] **Deployment order** — alternating drops (one unit per side at a time); Step Drop / Auto Deploy buttons; reactive brain scores each placement against opponent's existing units; UCB1 strategy selection learns across games via localStorage

### Maps & Board Sizes
- [ ] **Multiple board formats** — add a `BoardFormat` type with dimensions and default deployment depth; support the three standard sizes:
  - Combat Patrol: 22"×30", 6" deployment zones
  - Incursion: 44"×44", 9" deployment zones
  - Strike Force: 44"×60" (current), 12" deployment zones ← default
- [ ] **Mission-specific objective layouts** — each format should ship with 1–2 standard objective placements (e.g. the 5-objective cross for Strike Force, 4-objective diamond for Incursion); wire into `TerrainLayout` or a new `MissionLayout` type alongside terrain
- [ ] **Board format selector** — add a "Format" dropdown in the header next to Edition and Terrain; adjusts `BOARD_W`/`BOARD_H` constants and re-positions objectives on battle start

### Unit & Model Movement
- [x] **Model-level positions** - `BattleUnit.modelPositions` is now the source of truth; `position` is the centroid for range/LOS checks.
- [x] **Individual model movement** - manual play can move individual models with per-model movement allowance.
- [x] **Engagement range movement checks** - normal and Advance movement cannot end within enemy Engagement Range.
- [x] **Coherency detection** - out-of-coherency models are highlighted and block phase advance.
- [x] **Coherency enforcement policy** - implemented: temporary incoherency is allowed during movement editing, but Movement phase advance is blocked until all active-army units are coherent.
- [x] **Movement final-position legality** - temporary free dragging is allowed, but Movement Done/phase advance is blocked by illegal final positions and illegal movement paths.
- [x] **Pivot/rotation movement cost** - non-round bases spend movement based on the furthest-moving point of the footprint.
- [x] **Vertical coherency** - implemented with 2" horizontal coherency plus 5" vertical coherency now that model height is tracked.
- [x] **Model rendering** - battlefield rendering uses individual model footprints instead of one scaled unit circle.

### Terrain - Mat & Feature System
The current runtime now has both terrain mats and terrain features. Continue sourcing exact 10th-edition terrain behavior from the PDF before tightening rules.

- [x] **`TerrainFeature` type** - added to `battle.ts`; `Terrain` now carries `features`.
- [x] **Terrain feature rendering/editing** - battlefield and terrain editor can select, move, rotate, and draw features.
- [x] **Runtime terrain layout conversion** - terrain layout specs generate feature arrays for runtime layouts.
- [x] **Movement collision/pathing** - terrain and model collision support exists, including a pathing helper internal to `simulator.ts`.
- [x] **Keyword movement interactions** - Fly, Infantry, Vehicle, Monster, and Titanic interactions are represented in collision checks.
- [x] **LOS per-feature blocking** - feature-level `blocksLOS` is used by LOS geometry.
- [x] **Cover eligibility verification** - reviewed against the 10th Core Rules PDF; ruins, woods, obstacle mats, and blocking features now have separate LOS/cover behavior.
- [ ] **Terrain pathing extraction** - decide whether `findReachablePosition` should move from `simulator.ts` to `engine/terrain.ts` for reuse/testing.
- [ ] **Terrain tuning** - tune generated feature placement and colors once the rules behavior is stable.

### Other
- [ ] **Unit abilities** — execute abilities defined on unit profiles during simulation
  - Reanimation Protocols (Necrons): roll to bring back destroyed models at end of phase
  - Waaagh! (Orks): one-use buff to charge/fight
- [x] **Assault keyword** - Advanced units can shoot Assault weapons but not other ranged weapons.
- [ ] **11th edition rules** — stub in place, fill in when the core rulebook drops (update `rulesEngine.ts → rules40K11th`)
- [ ] **Secondary objectives** — fixed/tactical secondaries on top of primary VP
- [ ] **Morale/flee** — units that fail battle-shock should have a chance to flee (lose models), not just lose OC
- [ ] **Stratagems / command points** — basic CP economy and a few key stratagems per faction
- [ ] **Better AI movement** — units should consider objective control in their movement decisions (not just rush nearest enemy)
- [ ] **Import real army lists** — test the BattleScribe parser against actual exported lists from `lists/` folder

### Simulation Step Granularity
Currently the simulator runs an entire player turn (all phases) as one atomic step. Need finer control:

- [ ] **Phase-step mode** — "Step Phase" button advances one phase at a time (Movement → Shooting → Charge → Fight → Battle-shock → Objectives) for the active player, then hands off to the opponent. Requires splitting `simulatePlayerTurn` into individual phase functions that can be called one at a time and persisted back to `BattleState` (add a `pendingPhaseIndex` field or similar cursor).
- [ ] **Unit-step mode** — within a phase, "Step Unit" button activates one unit at a time. Requires tracking which units in the current phase have already activated (`BattleUnit.activated` is already present, just unused). UI should highlight the next unit to act.
- [ ] **Step-granularity selector** — add a control (e.g. segmented button: "Unit | Phase | Turn") that switches between the three modes; Auto Run respects the same granularity setting.
- [ ] **Active unit highlight** — when in unit-step mode, draw a pulsing ring or bright outline around the unit currently being activated on the Battlefield canvas.
