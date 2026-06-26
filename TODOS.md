# Warhammer Simulator — TODOs

## 11th Edition Rules Handoff - 2026-06-23

Use this section as the current pickup point for 11th Edition work. Older sections below are historical and may include stale wording.

### Implemented So Far
- [x] 11th Edition ruleset is selectable independently from 10th Edition.
- [x] 11th rules metadata tracks `edition: 11e`, `rulesVersion: preview-core`, and compatibility fallback to 10th.
- [x] 11th setup supports per-player Force Dispositions instead of one shared deployment type.
- [x] Force Disposition combinations map to the correct paired primary mission names.
- [x] Each 11th Force Disposition matchup exposes three associated terrain layout choices.
- [x] 11th terrain layouts load from JSON files through the shared terrain layout registry.
- [x] Terrain objective control is implemented for 11th: models control objective terrain areas instead of fixed marker radii.
- [x] Objective marker roles can be tagged as home or no man's land in terrain layouts.
- [x] Actions are implemented at the core level: units can start actions, actions block shooting/charging, movement cancels actions, and actions can complete at end of turn.
- [x] Snap shooting is implemented for 11th preview behavior: one visible target within 24 inches, hits only on 6s.
- [x] 11th core stratagem list is present: Command Re-roll, Epic Challenge, Insane Bravery, Explosives, Crushing Impact, Rapid Ingress, Fire Overwatch, Smokescreen, Heroic Intervention, Counteroffensive.
- [x] 11th core stratagem targeting restrictions are partially implemented, including once-per-phase, once-per-battle, per-target limits, keyword restrictions, reserves restrictions, engagement restrictions, and CP spending.
- [x] Implemented effects for Insane Bravery, Explosives, Crushing Impact, Smokescreen, Fire Overwatch/Snap Shooting, Counteroffensive, and Epic Challenge targeting.
- [x] Aircraft rules are implemented for movement, Strategic Reserves exit/return, charge restrictions, and fight restrictions.
- [x] Vertical movement is implemented: model heights, vertical movement allowance, vertical coherency, vertical engagement, and vertical range.
- [x] Movement coherency policy is implemented: temporary incoherency during movement is allowed, but Movement phase cannot advance until active-army units are coherent.
- [x] Shooting, charge, and fight phase mechanics are implemented mostly through shared 10th-compatible behavior.
- [x] 11th Core 04.01.01 Models Without Ranged/Melee Weapons: units can be selected to shoot/fight with no matching weapons, resolve no attacks, and count as activated.
- [x] 11th Core 04.01.02 Sidearms: sidearm/Pistol weapons can be selected separately, but cannot be mixed with other ranged weapons during the same shooting activation.
- [x] 11th Core 04.01.03 Multiple Weapon Profiles: weapon data can mark alternate profiles with `profileGroup`; shooting/fighting resolves only one profile per group.
- [x] 11th Core 04.01.04 Attack Characteristics and Abilities: attacks resolve from the selected weapon/profile only, with weapon-scoped modifiers and abilities staying on that attack sequence.
- [x] Damage allocation was reset to defender-choice flow: remove destroyed models first, assign remaining wounds, damaged models must keep taking damage until destroyed, and non-mortal damage does not spill over.
- [x] Shooting LOS/range target UI supports visible, out-of-range, and no-ranged-weapon target states.
- [x] AI-prep data helpers exist: legal action generation and battle observation summaries.
- [x] Imported datasheet abilities/rules can affect core passive rules for Stealth shooting modifiers, Fights First fight priority, Feel No Pain damage prevention, Lone Operative targeting, and stratagem keyword restrictions.

### Manual Data Work
- [ ] Finish manually transcribing the 45 11th Event Companion terrain layouts.
  - Owner: Tim/manual editor work.
  - Keep walls in the saved terrain mat templates where needed.
  - Use objective role tagging for home/no man's land objectives.
  - Use deployment zone polygons/triangles and center exclusions where required by the layout.

### Remaining 11th Rules TODOs
- [x] Create a mission scoring definition table keyed by 11th primary mission name.
- [x] Stop known 11th primary missions from awarding generic fallback VP while scoring text is missing.
- [x] Show an unsupported-scoring warning during manual play when a known 11th primary mission has no transcribed scoring text.
- [x] Transcribe and add data-driven scoring for the five Take and Hold 11th primary missions: Battlefield Dominance, Determined Acquisition, Immovable Object, Inescapable Dominion, and Purge and Secure.
- [x] Transcribe and add data-driven scoring for the five Purge the Foe 11th primary missions: Consecrate, Destroyer's Wrath, Meatgrinder, Punishment, and Unstoppable Force.
- [x] Transcribe and add data-driven scoring for the five Reconnaissance 11th primary missions: Gather Intel, Reconnaissance Sweep, Search and Scour, Surveil the Foe, and Triangulation.
- [x] Transcribe and add data-driven scoring for the five Priority Assets 11th primary missions: Extract Relic, Sabotage, Secure Asset, Vanguard Operation, and Vital Link.
- [x] Transcribe and add data-driven scoring for the five Disruption 11th primary missions: Death Trap, Delaying Action, Locate and Deny, Outmanoeuvre, and Smoke and Mirrors.
- [ ] Add state tracking for unsupported mission event clauses: objectives controlled at start of turn, destroyed enemy units this turn, objective proximity at turn start / kill source, terrain-area occupancy at turn start, table-quarter occupancy, operation markers, objective actions, consecrated/triangulated/surveilled/extracted/sensor sweep/sabotage/secure asset/vanguard/booby trap/decoy markers, territory geometry, expansion objective roles, and condemned enemy units leaving the battlefield.
- [x] Find or transcribe source text for all 25 unique 11th primary missions.
- [ ] Implement exact scoring for all 25 unique 11th primary missions once source text is available. All mission texts are transcribed; event clauses need the state tracking above.
- [ ] Add tests for every implemented 11th primary mission scoring rule.
- [ ] Update primary scoring logs/UI so they explain why each player scored VP for their own mission.
- [x] Create a secondary mission definition table keyed by 11th secondary mission name.
- [x] Transcribe and add data-driven definitions for the first five secondary missions: A Grievous Blow, A Tempting Target, Assassination, Beacon, and Behind Enemy Lines.
- [x] Transcribe and add data-driven definitions for the second five secondary missions: Bring It Down, Burden of Trust, Centre Ground, Cleanse, and Defend Stronghold.
- [x] Transcribe and add data-driven definitions for the third five secondary missions: Display of Might, Engage on All Fronts, Forward Position, No Prisoners, and Outflank.
- [x] Transcribe and add data-driven definitions for the final three secondary missions: Overwhelming Force, Plunder, and Secure No Man's Land.
- [x] Find or transcribe source text for all 18 11th secondary missions.
- [ ] Add secondary mission state tracking: active fixed/tactical cards, when-drawn selections, tempting target objective, beacon unit, guarded objective/unit selections, destroyed-unit/model events, character destruction, starting strength, wounds characteristic, cleanse/plunder action state, centre proximity, table-quarter presence, battlefield-edge proximity, no-man's-land/territory/deployment-zone geometry, expansion objective roles, start-of-turn objective proximity, terrain-area action markers, and whole-unit containment.
- [ ] Implement automatic scoring for 11th secondary missions once the required state tracking exists.
- [ ] Audit each 11th core stratagem against final wording once the final 11th rules are available.
- [x] Implement Command Re-roll pending reroll/resolution support. UI can now wire a prompt to `resolveCommandReroll`; current support records the pending token, rerolls matching dice, logs the result, and supports practice replay.
- [x] Implement Rapid Ingress resolution flow: target validation marks a non-Aircraft Strategic Reserve unit so it can be placed during the opponent Movement/Reinforcements step.
- [x] Implement Heroic Intervention resolution flow: target validation marks an eligible defender so it can declare and resolve a Heroic Intervention charge during the opponent Charge phase.
- [x] Start stratagem UI cleanup: Tactics panel now shows direct stratagem action buttons and pending follow-up labels for Command Re-roll, Rapid Ingress, and Heroic Intervention.
- [x] Add simple Command Re-roll UI resolution: pending reroll accepts original D6 values, resolves through core rules, logs the new roll, and records practice replay.
- [x] Create 11th core audit from available local preview/event-companion sources. See `rules/11th-core-rules-audit.md`.
- [ ] Add the final full 11th Edition core rules source to `rules/` when available.
- [ ] Re-audit shared 10th-compatible movement, shooting, charge, fight, Battle-shock, objective control, reserves, transports, terrain, aircraft, and vertical rules against the final full 11th wording.
- [ ] Remove or narrow the 11th preview notice once final 11th rules are fully modeled.
- [ ] Keep edition-specific differences behind `RulesEdition` or focused helper functions instead of branching in React UI where possible.
- [ ] Continue datasheet/character ability support beyond the first passive hooks: Leader aura/attached-unit modifiers, Precision interactions beyond targeting, and faction-specific abilities as source text/data becomes available.

### 11th Primary Missions To Implement
- [x] Battlefield Dominance
- [x] Consecrate
- [x] Death Trap
- [x] Delaying Action
- [x] Determined Acquisition
- [x] Destroyer's Wrath
- [x] Extract Relic
- [x] Gather Intel
- [x] Immovable Object
- [x] Inescapable Dominion
- [x] Locate and Deny
- [x] Meatgrinder
- [x] Outmanoeuvre
- [x] Punishment
- [x] Purge and Secure
- [x] Reconnaissance Sweep
- [x] Sabotage
- [x] Search and Scour
- [x] Secure Asset
- [x] Smoke and Mirrors
- [x] Surveil the Foe
- [x] Triangulation
- [x] Unstoppable Force
- [x] Vanguard Operation
- [x] Vital Link

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
- [ ] **Secondary objectives** — fixed/tactical secondary definitions have started; scoring still needs active-card state and event/geometry tracking.
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
