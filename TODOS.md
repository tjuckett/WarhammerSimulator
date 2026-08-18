# Warhammer Simulator — TODOs

## Architecture and Feature Roadmap Handoff - 2026-07-02

Use this section as the current high-level pickup order before starting large new feature work. The goal is to keep the repo easy to continue from another computer and avoid adding Army Builder or remaining 11th Edition rules work through oversized React components or scattered core logic.

### Recommended Order
- [x] Run an architecture pass before adding new feature surface area.
  - Review `apps/web/src/App.tsx`, `apps/web/src/components/ArmyPanel.tsx`, and shared rule modules in `packages/simulator-core`.
  - Identify oversized modules, mixed responsibilities, duplicated army editing logic, and React UI code that should call focused core helpers instead.
  - Produced checked-in architecture notes in `docs/architecture.md` with current boundaries, target boundaries, diagrams, and a prioritized refactor list.
  - Next after this task: do the smallest refactor pass that unlocks the next rules/UI work without changing behavior.
- [x] Do a small refactor pass from the architecture notes.
  - Prefer extracting stable boundaries over redesigning everything at once.
  - Likely candidates: app mode shell/layout, army editing helpers, game session save/load state, battle phase controls, and rules-event tracking helpers.
  - Rename new target APIs away from "practice" language; use game/session wording for user-facing concepts and new controllers.
  - Preserve persistence seams for database-backed game sessions, saved armies, custom terrain layouts, users/sharing, and future AI memory.
  - Preserve AI seams for human-vs-human, human-vs-AI, and AI-vs-AI by routing decisions through legal `GameAction` choices and serializable battle observations.
  - Review large hook return objects as each area is touched. Keep controller APIs when they represent a clear boundary, but group or split returns that expose too many raw setters or unrelated responsibilities.
  - Completed first slice: extracted `AppMode` and `ModeChooserDialog` into `apps/web/src/modes`.
  - Completed second slice: extracted setup/header controls into `AppHeader` in `apps/web/src/modes`.
  - Completed third slice: extracted checkpoint load/delete confirmation dialogs into `GameSessionCheckpointDialogs` in `apps/web/src/gameSession`.
  - Completed fourth slice: added `gameSessionRepository` as the new app-facing save/load boundary over the current practice scenario repository.
  - Completed fifth slice: extracted saved scenario summaries and storage health into `useGameSessionStorage`.
  - Completed sixth slice: extracted active game/checkpoint selection and pending checkpoint dialogs state into `useGameSessionSelection`.
  - Completed seventh slice: extracted checkpoint labels, sequencing, descendant lookup, and phase labels into `gameSession/checkpointHelpers`.
  - Completed eighth slice: replaced checkpoint-kind string branching with typed label maps in `checkpointHelpers`.
  - Completed ninth slice: reused typed checkpoint-kind maps in the save/load panel and Prisma checkpoint kind conversion.
  - Completed tenth slice: extracted checkpoint save/load/delete handlers and modal state into `useGameSessionController`.
  - Completed eleventh slice: extracted timeline state/ref and reset/start/record/undo/redo/seek operations into `useGameSessionTimeline`.
  - Completed twelfth slice: extracted loaded timeline setup derivation into `restoreTimelineSetup`.
  - Completed thirteenth slice: consolidated repeated battle/play UI reset logic into local reset helpers in `App`.
  - Completed fourteenth slice: extracted battle setup state, derived setup values, randomization, and setup validation into `useBattleSetupControls`.
  - Completed fifteenth slice: extracted terrain localStorage, import parsing, export serialization, and terrain mat template typing into `terrainStorage`.
  - Completed sixteenth slice: extracted terrain editor state, terrain layout save/import/export actions, and terrain mat template actions into `useTerrainLayouts`.
  - Completed seventeenth slice: extracted pure terrain editing geometry helpers into `terrainEditing` for reuse by `App` and terrain hooks.
  - Completed eighteenth slice: extracted stateful terrain edit actions into `useTerrainEditing`.
  - Completed nineteenth slice: grouped terrain hook return APIs into layout, editor, alignment, template, and action domains.
  - Completed twentieth slice: grouped `useBattleSetupControls` return API into selection, derived setup data, and actions.
  - Completed twenty-first slice: grouped game session selection, timeline, and controller hook return APIs by state, refs, modal/status data, pending data, and actions.
  - Completed twenty-second slice: extracted play UI selection, targeting, tactics, feedback, inspection state, and shooter refs into `usePlayUiState`.
  - Completed twenty-third slice: extracted play undo stack and pending move/rotation refs into `usePlayUndoState`.
  - Completed twenty-fourth slice: extracted pure play selection normalization and inspection lookup helpers into `playSelectionHelpers`.
  - Completed twenty-fifth slice: extracted play display math, pending-damage labels, dice parsing, stratagem follow-up labels, and ability option helpers into `playUiHelpers`.
  - Completed twenty-sixth slice: extracted play phase panels and the pending-damage HUD into `PlayPanels`.
  - Completed twenty-seventh slice: added shared UI tokens and adopted them in `PlayPanels` for panel chrome, status text, and combat stat colors.
  - Completed twenty-eighth slice: extracted shared play model edit gates and selection transforms into `playMovementHelpers`.
  - Completed twenty-ninth slice: added shared battle phase and movement-step constants in simulator-core and adopted them in phase progression/edit helpers.
  - Completed thirtieth slice: extracted play deployment/reinforcement/reserve placement validation and placement action creation into `playDeploymentHelpers`.
  - Completed thirty-first slice: added constants for unit deployment modes and play deployment selection kinds, then adopted them in deployment helpers and touched App wiring.
  - Completed thirty-second slice: adopted shared unit deployment mode constants in `ArmyPanel` and simulator transport/reinforcement checks.
  - Completed thirty-third slice: extracted play movement unit action resolution for advance, fall back, complete movement, embark, and disembark into `playMovementActions`.
  - Completed thirty-fourth slice: added shared movement game action type constants and adopted them in movement action creation, replay, touched-unit checks, and timeline labels.
  - Completed thirty-fifth slice: expanded shared game action type constants across all current play/simulation actions and adopted them in core replay, action creation, pending-action checks, deployment/movement helpers, and timeline labels.
  - Completed thirty-sixth slice: renamed the save/load UI component boundary from practice wording to game-session wording while keeping core storage/API compatibility names for a later migration slice.
  - Completed thirty-seventh slice: renamed app-facing game-session controller/timeline/storage aliases away from practice wording while keeping underlying core practice imports as compatibility aliases.
  - Completed thirty-eighth slice: extracted destroyed-unit mission event recording and turn lifecycle state into `engine/missionEvents` as the focused boundary for remaining 11th mission tracking.
  - Completed thirty-ninth slice: added start-of-turn mission snapshots for objective owners and stable battlefield unit/model positions, shared by manual and simulated turns.
  - Completed fortieth slice: used the start-of-turn objective snapshot to implement Determined Acquisition scoring for newly controlled non-home objectives.
  - Completed forty-first slice: captured per-unit start-of-turn objective proximity and used it for Extract Relic and Secure Asset destroyed-enemy scoring.
  - Completed forty-second slice: recorded destroying-unit identity and kill-time objective proximity, completing Purge and Secure event scoring.
  - Completed forty-third slice: captured per-unit start-of-turn terrain-area membership and implemented Search and Scour destruction scoring.
  - Completed forty-fourth slice: added whole-unit table-quarter presence with centre exclusion and completed Reconnaissance Sweep event scoring.
  - Completed forty-fifth slice: audited the remaining UI-heavy components and adopted shared tokens for repeated panel chrome, text hierarchy, selection, status, and combat colors while keeping canvas and one-off semantic colors local.
  - Verify with root `npm run build` and relevant simulator-core tests.
  - Next after this task: resume 11th Edition rules implementation on cleaner core/UI boundaries.
- [ ] Resume and finish the remaining 11th Edition rules work.
  - Prioritize mission/event state tracking, automatic secondary scoring, primary scoring tests, scoring log explanations, and remaining core rule audit items listed below.
  - Keep edition-specific behavior behind `RulesEdition` or focused simulator-core helpers.
  - Next after this task: build Army Builder mode using the cleaned-up army editing and import/export boundaries.
- [x] Add a dedicated Army Builder mode.
  - Add a fourth app mode for army/list management with no battlefield canvas.
  - Top bar should show army-focused controls instead of play controls: army slot, army type/faction, saved army dropdown, New, Save, Import JSON, and Export JSON.
  - Main layout should be three focused columns: available unit library on the left, current army selection in the middle, selected unit stats/options on the right.
  - Reuse existing army capabilities: model count, leader attachment, transport/deployment setup, model loadouts, BattleScribe JSON import, local save, and JSON export.
  - Design the save/load path around an army repository so local storage can be replaced or backed by Postgres without changing the builder UI.
  - Start with available units from sample/imported armies, then add a real unit catalog/source later if needed.
  - Next after this task: decide whether full roster validation and complete faction catalog data belong in app data, imported BattleScribe data, or a separate catalog package.
- [x] Add player/AI controller architecture.
  - Progress: core seat/observation/action boundary now validates intended actions through legal-action generation, `/api/practice/scenarios/[id]/actions` applies remote intended actions authoritatively through `GameAction`, AI-selected turns use the same action path, and database-backed per-scenario seat grants now authenticate remote action requests; account/provider authentication remains a later integration.
  - Model each side as a player seat controlled by a local human, remote human, or AI policy.
  - Ensure local play, network play, human-vs-AI, AI-vs-AI simulation, replay, and saved sessions all use the same core `GameAction` execution path.
  - Remote players should send intended actions to an authoritative server; they should not send mutated `BattleState`.
  - Keep AI policy decisions behind legal action generation and battle observation helpers.
  - Next after this task: add simple heuristic AI actions before considering learned or external model-backed policies.
- [x] Add AI army generation architecture.
  - Completed: deterministic balanced/aggressive/objective generation ranks imported or sample units, records editable explanations, heuristic scores, and scenario-candidate evaluations in the normal Army Builder save/export path, and compares candidates in an opponent-aware mission heuristic matrix exposed through the Builder. A catalog-backed points/faction/model-count/copy-limit validation contract is ready for authoritative data; official catalog data and full mission simulation remain separate source-dependent work.
  - Support AI-created armies through the same Army Builder and saved-army repository path as human-created armies.
  - Start from imported/sample army data and simple role/package swaps before requiring a full faction catalog.
  - Evaluate candidate lists with heuristics first, then small mission/opponent scenario matrices.
  - Save explanations with generated armies so the user can understand the list plan and edit it.
  - Next after this task: define the army catalog and roster validation source of truth.

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
- [x] 11th Core 04.01.05 Selected to Attack, 04.02 Select Targets, and 04.03 Resolve Attacks: selected shoot/fight units resolve weapon-scoped attacks, invalid/unviable selected targets do not consume unresolved weapons, ranged weapons remain single-target per selected weapon, melee split attacks are supported in core, and shot/fought/finished activation semantics are covered by attack-made tests.
- [x] 11th Core 05 Attack Sequence: hit rolls, critical hit/wound hooks, wound rolls including mixed-profile highest toughness, save rolls including impossible saves, normal/devastating/mortal damage application, current allocation group, damaged-model continuation, no normal damage carry-over, and destroyed unit/model removal are covered by core attack tests.
- [x] 11th Core 06 Other Concepts: visibility uses model edge-to-edge LOS, visible-unit targeting is covered for shooting and snap shooting, mortal-style damage can carry over through deferred allocation, normal damage does not carry over, and Hazardous tests run after shooting/fight weapon sequences for participating models.
- [x] 11th Core 07 The Battle Round: setup starts player turns in Command, active/opponent player tracking is preserved, battle rounds advance after both player turns, the battle ends after the final round, Movement has move/reinforcements steps, and out-of-phase snap shooting does not consume normal Shooting phase weapon state.
- [x] 11th Core 08 Command Phase: Command starts reset active-player turn state, both players gain core CP, Battle-shock tests run for below-half-strength active units, healthy units clear Battle-shock, Insane Bravery is covered as the core Battle-shock auto-pass stratagem, command-phase abilities are timing-gated, and Command-end transition advances to Movement after primary scoring.
- [x] 11th Core 09 Movement Phase: Move Units and Reinforcements steps are modeled, Normal/Advance/Fall Back/Remain Stationary mode eligibility is covered, Advance and Fall Back restrictions persist into later phases, Desperate Escape tests are covered, and Movement cannot advance with illegal positions or incoherent active units.
- [x] 11th Core 10 Shooting Phase: Shooting phase gating, active-player Shoot step selection, normal/Assault/Close-Quarters/Indirect shooting, LOS/range target validity, cover, Heavy, Hazardous, and selected weapon activation semantics are covered by core shooting tests.
- [x] 11th Core 11 Charge Phase: Charge phase gating, target option selection, successful charge moves, failed charge activation, charge restrictions after Advance/Fall Back/Reinforcements/actions, Aircraft restrictions, and Heroic Intervention hooks are covered.
- [x] 11th Core 12 Fight Phase: Fight phase activation priority, charged/Fights First ordering, selected melee weapons, split melee attacks, pile-in before fighting, consolidation after fighting, no-melee attack resolution, and fight damage allocation are covered.
- [x] 11th Core 13 Terrain: terrain placement data, exposed/light/dense-style cover behavior, movement blocking, feature/wall collision, LOS blocking, Hidden/Obscuring/Solid-style visibility hooks, and Benefit of Cover interactions are covered by terrain geometry and shooting tests.
- [x] 11th Core 14 Objectives: terrain objective areas, objective roles, level of control by model OC in terrain, Battle-shock OC suppression, and 11th mission scoring over terrain objectives are implemented and covered.
- [x] 11th Core 15 Stratagems: core stratagem definitions, CP spending, timing/target restrictions, once-per-phase/battle limits, affected-target restrictions, and implemented effects for current 11th core stratagems are covered.
- [x] 11th Core 16 Actions: action start/cancel/complete state, action restrictions on shooting and charging, and end-of-turn completion are covered.
- [x] 11th Core 17 Monsters and Vehicles: movement exceptions, frame/base range handling, close-quarters/Big Guns shooting behavior, Blast restrictions, and engaged target restrictions are covered.
- [x] 11th Core 18 Transports: capacity, embark, disembark before transport movement, destroyed transport emergency disembark, passenger restrictions, and emergency Battle-shock reset are covered.
- [x] 11th Core 20 Strategic Reserves: reserves placement, Reinforcements step placement, more-than-9-inch enemy restriction, Rapid Ingress, Aircraft reserve return, and reinforcement charge restrictions are covered.
- [x] 11th Core 23 Aircraft: Aircraft deployment/movement, battlefield-edge Strategic Reserves exit, return placement, shooting/charge/fight restrictions, Fly interactions, and Aircraft engagement exceptions are covered.
- [x] 11th Core 24 partial abilities: Anti, Assault, Blast, Devastating Wounds, Feel No Pain, Fights First, Hazardous, Heavy, Ignores Cover, Indirect Fire, Lethal Hits, Lone Operative, Melta, One Shot, Pistol/Sidearm, Precision, Rapid Fire, Stealth, Sustained Hits, Torrent, and Twin-linked have core behavior covered.
- [x] Damage allocation was reset to defender-choice flow: remove destroyed models first, assign remaining wounds, damaged models must keep taking damage until destroyed, and non-mortal damage does not spill over.
- [x] Shooting LOS/range target UI supports visible, out-of-range, and no-ranged-weapon target states.
- [x] AI-prep data helpers exist: legal action generation and battle observation summaries.
- [x] Imported datasheet abilities/rules can affect core passive rules for Stealth shooting modifiers, Fights First fight priority, Feel No Pain damage prevention, Lone Operative targeting, and stratagem keyword restrictions.

### Manual Data Work
- [ ] Validate and finalize the 45 11th Event Companion terrain layouts already present in `11e-event-layouts.json`.
  - Owner: Tim/manual editor work.
  - Replace any mirrored-half/template placeholder descriptions or coordinates with exact full-layout data where needed.
  - Keep walls in the saved terrain mat templates where needed.
  - Use objective role tagging for home, central, and player expansion objectives.
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
- [x] Add state tracking for unsupported mission event clauses: remaining objective actions and territory geometry. Objective owners, objective proximity, terrain-area membership, table-quarter presence, destroying-unit kill-time proximity, completed mission actions, persistent objective/terrain operation markers, central/expansion objective roles, condemned-unit selections, battlefield exits, completion-time objective proximity, and explicit per-side territory polygons are tracked.
  - [x] Implemented the first mission-operation vertical slice: Gather Intel units can complete Extract Intelligence on different non-home objectives, completed actions place persistent operation markers, manual play and legal-action generation use the mission action, and end-turn/end-battle clauses score from that state.
  - [x] Reused the mission-operation framework for Triangulation: eligible units can Triangulate different non-home objectives, manual play and legal actions expose the mission action, and one/two/three-plus marker tiers score non-cumulatively.
  - [x] Implemented current Consecrate state exactly: each friendly unit that destroyed an enemy can make one replayable end-turn selection of a different non-home objective in range, placing a persistent operation marker; one-to-two/three-plus marker tiers score exclusively, and consecrating the enemy home objective awards its end-battle bonus.
  - [x] Reused the mission-operation framework for Vital Link: eligible units can Maintain Control on different central objectives, manual play and legal actions expose the mission action, and markers add VP only while their central objective is controlled.
  - [x] Reused the mission-operation framework for Secure Asset: eligible units can secure a non-home objective, manual play and legal actions expose the mission action, and completed actions award the fixed end-turn VP without placing persistent markers.
  - [x] Reused the mission-operation framework for Smoke and Mirrors: eligible units can turn different non-home objectives into decoys, manual play and legal actions expose the mission action, persistent decoys score each turn, and four decoys award the end-battle bonus.
  - [x] Reused the mission-operation framework for Sabotage: eligible units can sabotage different non-home objectives, concurrent actions reserve their targets, manual play and legal actions expose the mission action, and completion snapshots all nearby objectives so the exact opponent-territory bonus survives replay and persistence.
  - [x] Added terrain-target mission actions for Vanguard Operation: eligible units can operate from enemy-free terrain areas overlapping explicit opponent territory, completion revalidates the area, manual play and legal actions expose the mission action, and completed operations score automatically.
  - [x] Enabled Unstoppable Force's newly controlled objective clause using the existing start-of-turn objective ownership snapshot.
  - [x] Implemented Punishment condemned-unit selection: eligible enemies are derived from objective range and previous-turn destroyers, manual/replay/legal-action paths preserve the selection, battlefield exits are tracked across destruction, embarkation, and Aircraft reserve movement, and the 5VP clause scores at the end of either player's turn.
  - [x] Added Sensor Sweep for Extract Relic and Locate and Deny: eligible units start once per turn from a central objective while multiple operation markers remain, completion requires controlling that objective, the selected marker is removed, and replay/UI/legal-action paths preserve the target. Extract Relic's isolated-marker clauses and Locate and Deny's no-enemy-marker end-battle clause now score from persistent marker state.
  - [x] Added Surveil the Foe: eligible units can immediately surveil unsurveyed visible enemies within 18" during the Shooting phase, unlimited uses can select additional targets, marked objectives protect surveilled units from the scoring clause, and friendly units ending moves within objective range remove opposing operation markers there.
  - [x] Added Death Trap's Booby Trap action: eligible units immediately trap different terrain areas during the Shooting phase, terrain operation markers persist, exact per-trap objective bonuses score, destroyed enemies are matched against their start-of-turn trapped-terrain occupancy, and isolated friendly markers score at battle end.
  - [x] Added central and player expansion objective tags to terrain editing/rendering and used them to score Delaying Action's central-plus-expansion clause.
  - [x] Audited all 25 primary definitions and scorers. The last territory-dependent clauses are exact when setup supplies territory polygons: Determined Acquisition counts each controlled objective in opponent territory, Search and Scour uses whole-unit footprint containment at battle end, Sabotage uses completion-time objective proximity, and Vanguard Operation accepts terrain areas that overlap opponent territory. Missing geometry fails closed without substituting home-objective roles; the 45 event-layout territory boundaries remain part of the manual layout-transcription TODO above.
- [x] Find or transcribe source text for all 25 unique 11th primary missions.
- [x] Implement exact scoring for all 25 unique 11th primary missions once source text is available. All 25 cards were re-audited against the current GDM images; Delaying Action and Consecrate were corrected to their current text/event trigger, role-dependent clauses now require explicit objective tags, and territory-dependent clauses fail closed when a layout has not yet supplied its explicit region polygons. Primary awards use a serialized idempotence ledger with the published 15VP per battle round and 45VP battle caps.
- [x] Add tests for every implemented 11th primary mission scoring rule. A data-driven coverage matrix now maps all 127 scoring clause IDs across the 25 missions to positive, condition/tier-negative, wrong-timing, and applicable wrong-round assertions; the matrix also tracks the existing global round/battle cap, idempotence, replay/save, and end-battle manual/simulation lifecycle coverage.
- [x] Update primary scoring logs/UI so they explain why each player scored VP for their own mission. Primary evaluation records now serialize their scoring window, clause explanations, cap detail, and unsupported reasons; manual play, replay/save, and simulation render one deterministic core-formatted log per real scoring window with player/side, mission, requested versus awarded VP, status, and resulting score. Windows with no active clauses remain silent.
- [x] Add UI controls for declaring split melee attack counts across multiple engaged targets. The Fight panel keeps the single-target flow when only one target is legal, and for one selected fixed-Attacks melee profile at a time exposes editable per-target allocations with running totals, clear/reset controls, and core validation. Split declarations are serialized on the existing fight action for deterministic undo/replay. The current core split path does not accept the `'all'`/multiple-profile selection; variable-Attacks profiles also continue through normal single-target resolution because their attack total is not known before rolling.
- [ ] Add Fight On Death support once datasheet/stratagem timing data exists; this needs an interrupt-style destroyed-unit fight window rather than immediate removal only.
- [x] Add destroyed model/unit last-position tracking; destroyed units now retain their last formation and centroid positions for later rule or mission measurements.
- [ ] Add exact 11th command abilities once datasheet/ability source data exists; core currently supports command-phase timing but does not invent generic ability effects.
- [x] Re-checked 11th Core 12.04–12.08 and implemented named Overrun Fight state: an explicit serialized Fight-step engagement snapshot, exact current/start-of-step eligibility, fight-type selection, one optional additional pile-in, global Fights First gating, consolidation only after all eligible fights, UI controls, simulation sequencing, replay/save, and focused clause tests. Legacy saves without a Fight-step marker remain compatible as already inside the Fight step.
- [x] Re-checked 11th Core 14.02–14.03 and implemented Secured Objectives: serialized secured owners retain control through tied or empty OC, clear only when the opponent has greater OC at an end-of-phase/turn check, display on the battlefield, replay/save through an explicit granting-rule action seam, and feed the same rules-defined ownership into mission snapshots and scoring.
- [x] Implement exact generic 11th Core 19 Attached Units behavior: imported components retain a stable combined rules-unit identity; targeting/range, Bodyguard-first Toughness, Precision allocation choice, unit keywords, scope-safe modeled unit passives, combined strength/Battle-shock, uninterrupted Shooting/Fight activations, grouped actions and activation flags, and final-model-only unit destruction facts persist through replay/save. Per current FAQ 19.01.01, Bodyguard loss does not generically detach Leaders/Support; exceptional datasheet splits and effects whose imported text does not establish unit scope fail closed under the existing datasheet-support TODO.
- [x] Implement exact generic 11th Core 21 Flying and Surging: Take to the Skies is an explicit serialized pre-move declaration with the -2" maximum-distance cost, FLY-model-only vertical/path benefits, and normal end-position restrictions across manual/simulation movement and charges. Surge Moves use a replayable granting-rule seam, exact Core eligibility/closest-target/end-position/per-phase locks, UI resolution, and replay/save state without inventing datasheet triggers, rolls, or optionality.
- [x] Implement exact generic 11th Core 22 Other Rules and Abilities: typed Aura/Psychic and faction/wargear classifications preserve source/bearer scope; Aura range queries implement self-range, overlap, same-Aura deduplication, and source expiry; faction abilities enforce the army-faction gate; Psychic wound loss carries serialized psychic-attack provenance; and Plunging Fire resolves its visible-ground-target, elevated-section/TOWERING, per-model Ballistic Skill, and AIRCRAFT exclusions. Datasheet-specific payloads remain fail-closed until imported as typed effects rather than inferred from prose.
- [x] Add/finalize remaining 11th Core 24 abilities: exact generic Cleave, per-model Deadly Demise, Deep Strike/Infiltrators 8" horizontal setup, Extra Attacks, Firing Deck selection/locking, Hover, Lance, Scouts pre-battle moves, and Super-heavy Walker/MOBILE now use serialized core state/actions; Leader/Support reuse Core 19. Damaged effects execute only from an explicitly imported typed threshold/payload rather than inventing a universal datasheet effect. Source-dependent reserve/passenger formations and untyped datasheet effects fail closed and are documented in `rules/11th-core-rules/24-other-abilities.md`.
- [ ] Add/finalize 11th Core 25 Muster Armies in the army-builder/import layer: current core can use imported rosters, but full faction, battle size, roster construction, and validation rules need official source/data.
  - Progress: portable roster validation now rejects malformed army metadata, optional saves, roster IDs, deployment modes, transport capacities, per-model weapon loadout references, model stat profiles, model-base geometry, movement overrides, damaged profiles, weapon profiles, rule text, keyword lists, ambiguous deployment/attachment relationships, and malformed catalog/options containers or IDs; catalog-backed points, faction limits, battle sizes, and official construction constraints remain source-dependent.
- [x] Create a secondary mission definition table keyed by 11th secondary mission name.
- [x] Transcribe and add data-driven definitions for the first five secondary missions: A Grievous Blow, A Tempting Target, Assassination, Beacon, and Behind Enemy Lines.
- [x] Transcribe and add data-driven definitions for the second five secondary missions: Bring It Down, Burden of Trust, Centre Ground, Cleanse, and Defend Stronghold.
- [x] Transcribe and add data-driven definitions for the third five secondary missions: Display of Might, Engage on All Fronts, Forward Position, No Prisoners, and Outflank.
- [x] Transcribe and add data-driven definitions for the final three secondary missions: Overwhelming Force, Plunder, and Secure No Man's Land.
- [x] Find or transcribe source text for all 18 11th secondary missions.
- [x] Add secondary mission state tracking: active fixed/tactical cards, when-drawn selections, tempting target objective, beacon unit, guarded objective/unit selections, destroyed-unit/model events, character destruction, starting strength, wounds characteristic, cleanse/plunder action state, centre proximity, table-quarter presence, battlefield-edge proximity, no-man's-land/territory/deployment-zone geometry, expansion objective roles, terrain-area action markers, and whole-unit containment. Start-of-turn objective proximity facts are captured for future Overwhelming Force scoring. Layouts without explicit territory/setup geometry fail closed instead of guessing.
  - Completed first slice: added serializable per-player fixed/tactical secondary state, ordered draw piles, active/discarded cards, generic when-drawn selections, and deterministic configure/draw/discard/select game actions for save and replay paths.
  - Completed second slice: added typed replayable selections and battlefield/objective validation for A Tempting Target, Beacon, and Burden of Trust.
  - Completed third slice: destruction events now retain per-model Character/Wounds facts and unit starting strength in per-turn and battle-long state across combat, casualty allocation, coherency removal, emergency disembarkation, and Desperate Escape paths.
  - Completed fourth slice: Cleanse and Plunder now use replayable unit actions with objective/terrain targets, end-of-turn eligibility cancellation, per-turn completion events, and battle-long serialized completion facts. Plunder accepts only terrain whose explicit role proves it is outside the acting player's territory.
  - Completed fifth slice: added footprint-aware helpers for known deployment zones, deployment-derived No Man's Land, battlefield centre/edges, opposite edges, table quarters, whole-unit region/terrain containment, explicit friendly/enemy territory roles, and per-player expansion objectives. Existing historical start-of-turn objective facts already cover the only current secondary clause that needs past geometry, so no redundant geometry snapshot was added. Layout-defined territory boundaries remain outstanding where setup data does not identify them.
- [x] Implement automatic scoring for all 18 11th secondary missions once the required state tracking exists. Clauses that depend on unavailable layout/setup geometry produce serialized unsupported records and award no VP rather than guessing.
  - Completed first slice: added a serializable, idempotent scoring ledger and lifecycle integration for A Grievous Blow, A Tempting Target, Assassination, Beacon, and Behind Enemy Lines, including fixed/tactical timing, per-card caps, replay/save stability, and explicit unsupported results when layout territory is unknown.
  - Completed second slice: added fixed/tactical Bring It Down, guarded-objective Burden of Trust, exclusive-tier Centre Ground, completed-action Cleanse, and base-plus-cumulative-bonus Defend Stronghold scoring, including manual-play lifecycle logs and fail-closed objective/setup geometry.
  - Completed final slice: added Display of Might, Engage on All Fronts, Forward Position, No Prisoners, Outflank, Overwhelming Force, Plunder, and Secure No Man's Land with exact owner/opponent/either-turn timing, exclusive tiers, current printed caps, eligibility/geometry filters, objective roles/control, start-of-turn proximity, completed actions, lifecycle logs, idempotence, replay, and save persistence.
  - Corrective source audit: first-ten OR/exclusive/cumulative markers now match the published Chapter Approved 2026–27 card data, fixed destruction cards score at end of turn, and the ledger centrally enforces 15 secondary VP per battle round, 45 per battle, and 20 per Fixed card while retaining requested versus awarded VP.
- [x] Audit each 11th core stratagem against final wording once the final 11th rules are available.
  - Progress: Epic Challenge now records a selected Character model, grants that model temporary melee Precision during the Fight phase, constrains damage allocation to that model, and carries the selection through legal/practice/UI actions.
  - Progress: Command Re-roll now accepts only the final eligible roll categories and rerolls one die, except that Charge rolls are rerolled in full; the practice/UI path records the selected roll type.
  - Progress: Rapid Ingress now enforces the final first-battle-round restriction in both legal availability and direct action application.
  - Progress: Crushing Impact now requires an explicit engaged enemy target, rolls up to six dice from the charging unit's Toughness, deals mortal wounds on 5+, and returns mortal wounds on unmodified 1s through replay/legal actions.
  - Progress: Explosives now selects an explicit throwing model and visible unengaged enemy target within 8 inches, with both selections preserved through legal/practice/UI actions.
  - Progress: Fire Overwatch is now restricted to the opponent's Reinforcements/end-of-Movement step, and snap shooting requires the recorded Fire Overwatch use.
  - Progress: Smokescreen now grants only Benefit of Cover, including to units screened by the Smoke unit, without inventing a separate hit penalty.
  - Progress: Heroic Intervention now records Leap to Defend or Into the Fray, applies the latter's +1CP cost, 6-inch target restriction and capped charge roll, and suppresses Charge bonuses for the resulting intervention charge.
  - Progress: Counteroffensive now requires the post-enemy-attack Fight timing and serializes one forced next-fight unit while granting Fights First for the phase.
  - Progress: Counteroffensive eligibility now follows the no-melee-unit Fight selection rule, so an engaged unit may be forced to fight and make no attacks.
- [x] Implement Command Re-roll pending reroll/resolution support. UI can now wire a prompt to `resolveCommandReroll`; current support records the pending token, rerolls matching dice, logs the result, and supports practice replay.
- [x] Implement Rapid Ingress resolution flow: target validation marks a non-Aircraft Strategic Reserve unit so it can be placed during the opponent Movement/Reinforcements step.
- [x] Implement Heroic Intervention resolution flow: target validation marks an eligible defender so it can declare and resolve a Heroic Intervention charge during the opponent Charge phase.
- [x] Start stratagem UI cleanup: Tactics panel now shows direct stratagem action buttons and pending follow-up labels for Command Re-roll, Rapid Ingress, and Heroic Intervention.
- [x] Add simple Command Re-roll UI resolution: pending reroll accepts original D6 values, resolves through core rules, logs the new roll, and records practice replay.
- [x] Create 11th core audit from available local preview/event-companion sources. See `rules/11th-core-rules-audit.md`.
- [x] Add the final full 11th Edition core rules source to `rules/`. The official June 2026 Core Rules PDF is tracked as `rules/eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf`.
- [ ] Re-audit shared 10th-compatible movement, shooting, charge, fight, Battle-shock, objective control, reserves, transports, terrain, aircraft, and vertical rules against the final full 11th wording.
  - Progress: the first final-source movement audit slice now applies 11th Core 03.03's 9-inch every-model coherency limit while preserving the 2-inch neighbor and 5-inch vertical requirements; regression coverage distinguishes 10th and 11th behavior.
  - Progress: 11th Core 10.04-10.07 now prevents a unit from starting an action after any shooting activation, including a partially resolved activation with remaining weapons.
  - Progress: 11th Hidden now remains a target-eligibility restriction for Indirect Fire; Indirect can bypass ordinary blocked LOS but not Hidden detection limits.
  - Progress: final Core 10.07 now applies 11th Indirect Fire's unmodified 6+ hit gate, the stationary-plus-friendly-visibility 4+ exception, and automatic Benefit of Cover; 10th retains its legacy Indirect -1 to Hit behavior.
  - Progress: 11th Core 10.06/17.03 now recognizes Close-Quarters shooting: engaged non-Monster/Vehicle units can select only Close-Quarters weapons against engaged enemies, while Close-Quarters attacks avoid the engaged-target hit penalty.
  - Progress: the final-source attack audit now has matching Fight-panel coverage for fixed-Attacks melee split declarations, including serialized undo/replay; variable-Attacks and multi-profile split cases remain fail-closed.
  - Progress: 11th Core 18.04 Tactical Disembark now remains available when a transport has been explicitly marked stationary.
  - Progress: 11th Core 09.07 now applies the required post-move Battle-shock roll when a non-shocked unit uses Desperate Escape.
  - Progress: 11th Core 18.04 Combat Disembark now supports 6-inch setup, hazard rolls, Battle-shock, and the end-of-turn charge restriction through the practice/UI action path.
  - Progress: 11th Core 18.04 Rapid Disembark now works after a completed Normal/Ingress move, prevents a second move, and preserves the end-of-turn charge restriction through replayable actions.
  - Progress: Rapid Disembark is also available during the Reinforcements step when the transport arrived via Ingress; ordinary disembark remains restricted to the Movement Units step.
  - Progress: final Core 05.04.02 damage handling now clamps weapon damage to the minimum characteristic value of 1 before allocation, with regression coverage.
  - Progress: final Core 18.04 now selects Tactical versus Combat Disembark per passenger based on whether a valid 3-inch non-engaged setup exists; stale/replayed Combat flags are revalidated, while Rapid Disembark remains tied to Normal/Ingress movement.
  - Progress: final Core 23.02 now applies the Aircraft-only Engagement Range exception to automatic movement as well as manual legality, so non-Aircraft units are not incorrectly locked in place.
  - Progress: final Core 08.03 now retests already Battle-shocked units even after they recover above half-strength, and treats exact half-strength as eligible; a unit clears Battle-shock only when that single command-step roll succeeds.
  - Progress: charge/stratagem proximity and engagement checks now use model base-edge distance consistently, including Heroic Intervention boundary coverage.
  - Progress: final Core 23.01-23.02 and 20.04 Aircraft handling now stages 11th Aircraft in Strategic Reserves, permits ingress-only return from the battlefield edge, returns opponent Aircraft to reserves at turn end, and keeps legacy 20-inch Aircraft movement isolated to 10th Edition.
  - Progress: final Core 20.02 repositioned-unit coverage now verifies that Aircraft retain ongoing Battle-shock state when removed to Strategic Reserves; unmodeled datasheet-specific repositioning rules remain source-dependent.
  - Progress: final Core 13.09 Hidden now tracks current/previous-turn ranged attacks and limits quiet Infantry/Beasts/Swarm visibility to the 15-inch detection range; Core 13.11.01 Gone to Ground reduces that detection range to 12 inches behind an intervening tall blocking feature. Terrain features now carry explicit light/dense categories with deterministic inference for legacy layouts; exact source tagging for imported Event Companion layouts remains open.
  - Progress: charge resolution and legal-action generation now support serialized singleton and multi-target declarations, require engagement with every declared target, and fail closed for undeclared enemies.
  - Progress: Heroic Intervention's Into the Fray surcharge is now reflected in both command-point state and the serialized battle log.
  - Progress: Rapid Ingress availability and direct use are now restricted to the opponent's Movement/Reinforcements step, matching the modeled end-of-Movement placement flow; impossible-placement and large-model setup coverage is covered by focused placement tests.
  - Progress: 11th `[CLOSE-QUARTERS]` ingress now lets Strategic Reserve units whose every model carries a Close-Quarters weapon set up outside the normal six-inch edge band and inside the opponent deployment zone, while retaining the more-than-8-inch enemy restriction.
  - Progress: final Core 15.08 Fire Overwatch now permits an already activated 11th-edition unit to use remaining eligible weapons, matching its explicit unengaged/non-TITANIC target restriction; 10th-edition normal eligibility remains unchanged.
  - Progress: final Core 15.04 Insane Bravery now records the current Command-phase Battle-shock eligibility window and rejects healthy units outside that test.
  - Progress: final Core 15.06 Crushing Impact now records an engaged source model and uses that model's Toughness for the mortal-wound roll, including mixed-model profiles.
  - Progress: final Core 15.05 Explosives now rejects partially resolved Shooting activations, matching the requirement that the target be eligible to shoot before the stratagem is used.
  - Progress: final Core 15.03 Epic Challenge now requires the Fight step to have begun before its selected Character model can gain Precision.
  - Progress: final Core 15.12 Counteroffensive now requires the active Fight step and waits until any attached enemy fight activation has fully resolved before opening the response window.
- [x] Narrow the 11th preview notice while final-source implementation remains partial.
  - Progress: the ruleset and UI now present 11th Edition as source-audited and partial; stable preview-era metadata IDs remain only for saved-game compatibility, and the complete final-source re-audit remains tracked separately above.
- [x] Keep edition-specific differences behind `RulesEdition` or focused helper functions instead of branching in React UI where possible.
  - Progress: pile-in and consolidation availability, plus Fight-step start/end gating, now rely on focused core rules helpers rather than duplicating edition checks in React; phase-specific labels remain presentation concerns.
  - Progress: shared disembark-mode resolution now owns 11th Combat/Rapid Disembark flags in simulator-core and is reused by legal actions and the play UI, including Reinforcements-step Rapid Disembark.
  - Progress: edition-specific Reinforcements enemy-distance thresholds now come from `RulesEdition.reinforcementRange()` instead of duplicated simulator branches.
  - Progress: the remaining Aircraft movement legality edition check now reuses the focused `aircraftCanMakeNormalMove` helper; React edition branches remain presentation/setup selection concerns.
- [ ] Continue datasheet/character ability support beyond the first passive hooks: Leader aura/attached-unit modifiers, Precision interactions beyond targeting, and faction-specific abilities as source text/data becomes available.
  - Progress: structured Aura range/eligibility and attached-unit/Precision foundations are implemented; effect execution remains fail-closed until imported source data provides typed modifiers.
  - Progress: the generic 11th Core 24 abilities that can be represented without faction data are implemented and regression-tested, including Cleave, Deadly Demise, Deep Strike, Extra Attacks, Firing Deck, Hover, Infiltrators, Lance, Scouts, Super-heavy Walker, and Damaged.

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
- [x] Next likely rule area: tighten Movement phase legality around terrain/collision/coherency now that model-level movement exists. Movement legality, terrain pathing, collision UX, and coherency gating are implemented and tested.
- [x] Coherency enforcement policy implemented: allow temporary incoherency during movement editing, but block Movement phase advance until all active-army units are coherent.
- [x] Move or expose `findReachablePosition` from `simulator.ts` for reuse/testing; it is now an exported simulator-core pathing helper.
- [x] Add/confirm full 10th-edition vertical coherency rules. Model height, vertical separation, and the 5" vertical coherency limit are implemented and covered by simulator-core tests.
- [x] Review collision mode UX: normal dragging may ignore terrain/model collision, while holding Shift visibly enables collision-aware preview and commits the same collision mode on pointer-up.
- [x] Reviewed terrain LOS/cover behavior against the 10th Core Rules PDF and separated ruin footprints, obstacle mats, woods cover, and feature/wall blocking.
- [x] Handle terrain movement edge cases for units starting inside blocking terrain; path checks now allow exiting while still blocking entry and traversal.
- [x] Vertical movement/climbing implemented: model positions support height, vertical movement spends movement allowance, coherency/engagement/range account for vertical separation, and elevated models show height badges on the canvas.
- [x] Aircraft return-from-Strategic-Reserves UX implemented: off-board Aircraft appear in the Staged panel during Reinforcements and can return within 6" of a battlefield edge, more than 9" from enemies, marked as arrived from Reinforcements.
- [x] Aircraft charge/fight restrictions implemented: Aircraft cannot declare charges; only Fly units can charge Aircraft; only Fly units can fight Aircraft; Aircraft can only fight Fly units.

### Rule Architecture Notes
- [x] Prefer core rule functions in `packages/simulator-core`; React should call/import those through `@warhammer-simulator/core`.
- [x] Keep phase logic structured as ordered phase steps, not one large phase function.
  - Completed: unit/phase stepping is exposed, and the atomic simulator delegates Command, Movement, Shooting, Charge, and Fight setup/resolution to named core phase helpers while retaining the atomic convenience API.
- [x] Keep edition-specific behavior behind the rules engine so 10th and 11th can share common concepts but diverge cleanly. Stateful play helpers now derive rules from `BattleState`; state-less battle/deployment constructors retain explicit 10th-edition defaults.
  - Progress: interactive movement, transport disembark, model-drag legality, mission-action completion, Command-phase coherency, legal-action generation, the core action gate, generic action start, shooting action helpers, Charge/Fight action helpers, and movement-action helpers all resolve rules from the battle state's ruleset.
- [x] Treat 11th edition as a separate ruleset with source-backed behavior; do not guess unsupported 11th rules from 10th. Remaining unmodeled mechanics stay explicit fail-closed/source-dependent TODOs.
- [ ] Shared concepts likely worth keeping edition-neutral: battle rounds, active army, phase/step cursor, unit/model positions, dice helpers, objective ownership scaffolding.

### Known Rules/UI Followups
- [x] Review whether "practice game" naming should be changed to a more future-proof term before multiplayer features are added. Decision: use game/session language going forward; existing `practice` code paths can be migrated in a focused rename later.
- [x] Improve selected-model action placement/UI — the action HUD now stays within the scrollable board bounds and repositions after viewport resize.
- [ ] Add tests when each rule is implemented in `packages/simulator-core/test/`.
  - Progress: the edition-boundary audit now has regression coverage proving Take to the Skies resolves omitted rules from an 11th-edition BattleState.
- [x] Re-run `npx tsc -p apps/web/tsconfig.json --noEmit`, `npm run lint`, and root `npm run build` after frontend/rules changes. Latest verification passes with zero TypeScript, lint, or build errors/warnings.

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
- [x] **Multiple board formats** — `BoardFormat` now carries dimensions and default deployment depth for the three standard sizes:
  - Combat Patrol: 22"×30", 6" deployment zones
  - Incursion: 44"×44", 9" deployment zones
  - Strike Force: 44"×60" (current), 12" deployment zones ← default
- [x] **Mission-specific objective layouts** — added typed board-native Strike Force cross, Incursion diamond, and Combat Patrol diamond layouts and routed battle setup through them
- [x] **Board format selector** — the header exposes a Format dropdown, board state uses the selected dimensions, and objectives are scaled when setup changes.

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
- [x] **Terrain pathing extraction** - expose `findReachablePosition` as a reusable simulator-core helper and cover its movement-distance contract with a focused test.
- [ ] **Terrain tuning** - tune generated feature placement and colors once the rules behavior is stable.

### Other
- [x] **Unit abilities** — simulation now resolves modeled end-of-command-phase abilities through the shared ability framework, with once-per-turn guards and fail-closed unsupported effects
  - Reanimation Protocols (Necrons): roll to bring back destroyed models at end of phase
  - Waaagh! (Orks): one-use buff to charge/fight
- [x] **Assault keyword** - Advanced units can shoot Assault weapons but not other ranged weapons.
- [x] **11th edition rules** — the 11th preview ruleset, mission scoring, terrain objective control, phases, stratagems, movement, combat, and supported core abilities are implemented behind `rulesEngine.ts → rules40K11th`; final-source audit work remains tracked above.
- [x] **Secondary objectives** — fixed/tactical state, supporting events/geometry, central VP limits, and automatic scoring are implemented for all 18 cards; layout-dependent clauses fail closed when explicit setup geometry is unavailable.
- [x] **Morale/flee** — no separate post-test flee mechanic is present in the current 10th/11th Core Rules; Battle-shock and Desperate Escape are modeled instead.
- [x] **Stratagems / command points** — the core CP economy and current 11th core stratagem framework/effects are implemented; final wording and faction-specific data remain tracked above.
- [x] **Better AI movement** — simulation movement now weighs objective ownership, objective distance, and unit OC before selecting the nearest enemy target
- [x] **Import real army lists** — regression coverage now parses the three exported rosters in `lists/` and verifies non-empty usable units and unique roster IDs

### Simulation Step Granularity
The simulator now supports turn-, phase-, and unit-granularity stepping with a persisted simulation cursor:

- [x] **Phase-step mode** — the Step control advances one phase at a time through the persisted simulation cursor and hands off to the opponent at the turn boundary.
- [x] **Unit-step mode** — the Step control activates one unit at a time within the current phase and tracks the active unit through the simulation cursor.
- [x] **Step-granularity selector** — the Unit | Phase | Turn selector switches both manual stepping and Auto Run behavior.
- [x] **Active unit highlight** — unit-step mode draws the active unit highlight on the Battlefield canvas.
