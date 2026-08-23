# Maintainability boundaries

## Non-negotiable data rule

Log entries are presentation history only. Game rules and UI state must never be reconstructed by searching or parsing log messages. Dice, targets, modifiers, outcomes, pending allocations, and failure reasons belong in typed state or typed action results.

## Current architectural hotspots

| Area | Current issue | Target boundary |
| --- | --- | --- |
| `apps/web/src/App.tsx` | Combines page composition, play-phase selectors, action orchestration, undo coordination, persistence, and keyboard handling. | Keep page composition here; move play selectors/actions into phase-focused hooks and keep persistence in `gameSession/`. |
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

1. Finish replacing shooting-result log parsing with `ShootingResolution` data.
2. Split `PlayPanels.tsx` by phase and move shared combat result rendering into a small component.
3. Extract play-phase selectors and action callbacks from `App.tsx` into `usePlayPhaseState` and phase action modules.
4. Split `simulator.ts` only after action contracts are typed and covered by core tests; preserve its public exports through a barrel module during migration.

This sequence keeps the UI/core boundary explicit and avoids a broad, behavior-changing rewrite.
