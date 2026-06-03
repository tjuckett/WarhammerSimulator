# Practice Layer

Stage 1 keeps the hosted-app future available by making practice state portable before
the app moves to Next.js or a backend.

## Boundaries

- `actions.ts` defines serializable player/simulator actions.
- `timeline.ts` records an initial `BattleState`, action entries, snapshots, and a cursor.
- `scenarios.ts` wraps a timeline with saved-practice metadata.
- `scenarioStorage.ts` is the temporary browser-local persistence adapter.

The practice layer should stay free of React imports. UI code can create, save, load,
seek, and checkpoint timelines, but it should not define the persistence format.

## Ruleset Handling

Saved timelines and scenarios carry `RulesetMetadata`. When a scenario is loaded or a
simulation phase advances, the app resolves rules from the saved state rather than the
current header selection. This keeps old practice reps stable when 11th Edition or
future dataslate behavior diverges from 10th Edition.

## Replay Model

Timeline entries store both the action and exact `stateBefore` / `stateAfter`
snapshots. Snapshots make rewind exact today, including random dice results. Actions
remain available for later server sync, replay comparison, or authoritative validation.

## Before Stage 2

The app is ready to move toward a Next.js shell once these remain true:

- `BattleState` carries ruleset and objective-control metadata.
- Practice actions, timelines, scenarios, and storage are serializable.
- Local checkpoint save, load, branch, seek, undo, and redo work without React-owned
  format assumptions.
- Edition-specific behavior is resolved from the scenario state, not global UI state.

## Checkpoint Model

Manual saves and automatic phase saves are stored as checkpoints for one game. Each
checkpoint may point to a parent checkpoint, so loading an earlier checkpoint and
continuing creates a new chain without deleting the original chain.

Checkpoint records stay compact in localStorage. A branch timeline is stored once per
branch, and each checkpoint remembers its cursor so loading a save restores the board
state and the visible action timeline together.
