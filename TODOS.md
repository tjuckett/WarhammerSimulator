# Warhammer Simulator — TODOs

## Current Rules Handoff - 2026-06-06

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

### Next Rules Feature
- [ ] Continue extracting 10th edition Core Rules from `rules/Warhammer_10th_Core_Rules.pdf`.
- [ ] Review one rule at a time with the user before implementing it.
- [ ] Next likely rule area: finish Movement phase constraints around model movement.
- [ ] Add model coherency enforcement after every move:
  - Units of 2-5 models: each model must be within 2" horizontally and 5" vertically of at least one other model in the unit.
  - Units of 6+ models: each model must be within range of at least two other models in the unit.
  - Single-model units are always coherent.
- [ ] Add engagement range restrictions for movement:
  - Models generally cannot move within Engagement Range of enemy models unless charging, piling in, consolidating, or otherwise allowed.
  - Engagement Range is 1" horizontally and 5" vertically.
- [ ] Add Remaining Stationary as an explicit manual movement action.
- [ ] Add UI affordance for ending a unit's movement once the player is done, while still allowing a partially moved model to keep moving before switching units.
- [ ] Decide whether switching to another unit locks the previous unit's remaining movement for the phase.

### Rule Architecture Notes
- [ ] Keep phase logic structured as ordered phase steps, not one large phase function.
- [ ] Prefer core rule functions in `packages/simulator-core`; React should call/import those through `@warhammer-simulator/core`.
- [ ] Keep edition-specific behavior behind the rules engine so 10th and 11th can share common concepts but diverge cleanly.
- [ ] Treat 11th edition as a separate ruleset placeholder until rules are actually available; do not guess 11th rules from 10th.
- [ ] Shared concepts likely worth keeping edition-neutral: battle rounds, active army, phase/step cursor, unit/model positions, dice helpers, objective ownership scaffolding.

### Known Rules/UI Followups
- [ ] Review whether "practice game" naming should be changed to a more future-proof term before multiplayer features are added.
- [ ] Improve movement action placement/UI if Advance/Fall Back still feel disconnected from selected unit actions.
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
- [ ] **Model-level positions** — replace the single `Position` on `BattleUnit` with a `modelPositions: Position[]` array (one entry per remaining model); the unit's effective position for range/LOS checks becomes the centroid or the closest model
- [ ] **Individual model movement** — during the Movement phase, move each model up to `profile.move` inches toward the unit's destination, subject to:
  - No model may end its move within 1" of an enemy model (engagement range)
  - Each model must end within coherency of at least one friendly model in the same unit (see below)
- [ ] **Coherency rules** — after every model move, enforce:
  - Units of 1–5 models: every model within 2" of at least one other model in the unit
  - Units of 6+ models: every model within 2" of at least 2 other models in the unit
  - Any model that would break coherency must stop at the last legal position
- [ ] **Model rendering** — draw individual model circles for each model in a unit instead of one scaled circle; arrange them in a tight cluster formation around the unit's lead position; health bar stays at the unit level

### Terrain — Mat & Feature System
The current `Terrain` type is a single rectangle that either blocks LOS or doesn't. Real 40K terrain has two distinct layers:
- **Terrain mat** — the base footprint; a unit *on* the mat is "within" that terrain piece and eligible for cover. Units can always move onto the mat itself.
- **Terrain features** — physical objects *on* the mat (walls, pillars, rubble piles, crashed vehicles, etc.) that block movement and LOS independently.

- [ ] **`TerrainFeature` type** — add to `battle.ts` alongside `Terrain`:
  ```ts
  interface TerrainFeature {
    id: string;
    x: number; y: number;       // position within the mat (absolute board inches)
    width: number; height: number;
    featureHeight: 'low' | 'mid' | 'tall'; // low ≤1", mid ≤3", tall >3"
    blocksLOS: boolean;          // true for walls/tall objects
    blocksMovement: boolean;     // true for solid objects; false for low rubble infantry can clamber
    difficult: boolean;          // costs double movement to traverse (e.g. dense rubble)
  }
  ```
  Add `features: TerrainFeature[]` to the existing `Terrain` type (mat = the existing rect, features = objects on it).

- [ ] **Collision detection for movement** — when computing a model's move path, check each segment against all `blocksMovement` features:
  - Use segment-vs-AABB intersection; if blocked, try skirting left/right by the model's base width
  - If no clear path exists within the move allowance, the model stops at the closest reachable point
  - Store this as a pure function `findReachablePosition(from, to, maxInches, features, unitKeywords): Position` in `engine/terrain.ts`

- [ ] **Keyword movement interactions** — consult the moving unit's keywords before applying feature collision:
  - **FLY**: ignore all `blocksMovement` features entirely; fly straight-line over everything
  - **Infantry** inside **Area terrain (ruin)**: treat `blocksMovement = false` for all features within that mat (infantry move freely through ruin walls); features still block LOS from outside
  - **Infantry** vs low obstacles (`featureHeight === 'low'`): may clamber over; costs 2" of movement (model moves as if the feature were difficult ground its full width)
  - **Vehicle / Monster** (no FLY): cannot enter a mat typed `'ruin'` at all; treat the entire mat rect as impassable; must path around the outside edge
  - **Titanic**: treat all terrain mats as impassable; always move around the outside

- [ ] **LOS per-feature blocking** — replace the current centre-of-mat LOS check in `hasLOS` / `isObscured` with per-feature checks:
  - Trace a ray from attacker to defender; a `blocksLOS` feature whose rectangle intersects that ray blocks LOS entirely (no shot)
  - A feature that intersects the ray but `!blocksLOS` (e.g. low rubble) still counts for `isObscured` → grants cover if target is within a mat
  - A unit completely behind a tall feature relative to the attacker cannot be targeted at all

- [ ] **Cover eligibility rework** — a unit receives cover if **both** conditions are true:
  1. At least one model is within a terrain mat (`providesCover === true`)
  2. At least one feature on that mat is between the attacker and that model (i.e. the feature intersects the LOS ray, even if the shot still has LOS through a gap)
  This replaces the current blanket infantry-only cover bonus.

- [ ] **Render terrain features** — in `Battlefield.tsx`, after drawing the mat rect, draw each `TerrainFeature` as a darker filled rect with a stroke; use distinct fills by height: low = dark brown, mid = dark grey, tall = near-black with slight opacity. Label only the mat, not individual features.

- [ ] **Update terrain layout definitions** — for each of the 5 named layouts in `engine/terrain.ts`, add `features` arrays to existing terrain pieces. Start with 2–4 features per piece (e.g. a ruin mat gets 3–4 wall segments, an obstacle mat gets 1–2 solid blocks). Use the existing mat dimensions as the bounding box; features should sit inside or on the edge of the mat.

### Other
- [ ] **Unit abilities** — execute abilities defined on unit profiles during simulation
  - Reanimation Protocols (Necrons): roll to bring back destroyed models at end of phase
  - Waaagh! (Orks): one-use buff to charge/fight
- [ ] **Assault keyword** — currently on Gauss Reapers but unhandled in `modifyAttackCount`
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
