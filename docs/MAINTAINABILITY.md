# Maintainability boundaries

## Non-negotiable data rule

Log entries are presentation history only. Game rules and UI state must never be reconstructed by searching or parsing log messages. Dice, targets, modifiers, outcomes, pending allocations, and failure reasons belong in typed state or typed action results.

## Current architectural hotspots

| Area | Current issue | Target boundary |
| --- | --- | --- |
| `apps/web/src/App.tsx` | Combines page composition, play-phase action orchestration, undo coordination, persistence, and keyboard handling. | Keep page composition here; selectors and the major movement, shooting, charge, fight, deployment, and model-selection actions now live in focused modules; keep persistence in `gameSession/`. |
| `apps/web/src/play/PlayPanels.tsx` | Combines five phase panels, shared combat formatting, allocation controls, and result rendering. | Split into `ShootingPanel`, `ChargePanel`, `FightPanel`, `TacticsPanel`, and shared combat-display components. |
| `packages/simulator-core/src/engine/simulator.ts` | Combines state cloning, movement, shooting, charge, fight, abilities, phase simulation, and presentation logging. | Split by domain while keeping a small action/state orchestration layer. |
| `BattleState.log` | Used as both history and an accidental event bus. | Keep it append-only for display/audit; add typed fields/results for transient and inspectable gameplay state. |

## Refactoring rules

1. A module over 500 lines requires a clear reason to remain together and a proposed extraction seam.
2. UI components receive typed results and callbacks; they do not import or interpret log text.
3. Core action functions return or store structured results when the UI needs dice or intermediate outcomes.
4. Geometry and rule predicates remain pure and should not mutate `BattleState`.
5. State mutation belongs at action boundaries; rendering code should derive display-only values.
6. New phase behavior should be added to the phase module, not to the root app component.

## Safe extraction order

1. Remove the remaining dead compatibility code from `PlayPanels.tsx` after confirming no consumers depend on it.
2. Finish moving the remaining tactics and mission callbacks from `App.tsx` if a narrow dependency boundary is available.
3. Split `simulator.ts` only after action contracts are typed and covered by core tests; preserve its public exports through a barrel module during migration.

This sequence keeps the UI/core boundary explicit and avoids a broad, behavior-changing rewrite.

## Completed follow-up slices

- Typed combat result state replaced runtime shooting/charge result reconstruction from log text.
- Play panels were split into tactics, shooting, charge, and fight modules with shared presentation helpers.
- Play target selectors, attack allocation transformations, pending-damage lookup, and undo snapshots were extracted from `App.tsx`.
- Army editing helpers, model loadouts, battlefield unit lists, static army editing, deployment lists, and grouping logic were extracted from `ArmyPanel.tsx`.
- `usePlayPhaseSelectors` now owns shooting, overwatch, charge, and fight derived state.
- Movement resolution callbacks now live in the typed `playMovementController` boundary.
- Deployment selection, model selection, charge/fight resolution, and the obsolete log-parsing result dialog were cleaned up or moved behind focused boundaries.
- Typed `BattleEvent` records now capture phase transitions, attack results, charge dice, and deferred damage without reconstructing gameplay from log text.
- `battleStateMachine` now owns the shared round/phase graph, movement substeps, player-turn transitions, five-round limit, and end-of-battle boundary used by manual and simulated advancement.

## Remaining migration boundary

The remaining App work is mostly tactics, mission, and setup orchestration. The simulator engine can now be split incrementally by domain using the typed event and phase-transition boundaries; avoid moving mechanically related ranges until each extracted domain has focused action/result contracts.
