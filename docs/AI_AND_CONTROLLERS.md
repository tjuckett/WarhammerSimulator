# AI and Controller Architecture

The rules engine must be controller-agnostic. Human UI and AI must use the
same typed legal-action and action-application interfaces.

```text
BattleState
  -> active phase/step
    -> typed legal actions
      -> human controller or AI controller
        -> validated action
          -> new BattleState and typed events
```

Required modes:

- Human vs human.
- Human vs AI, where the AI controls the opposing side.
- AI vs AI, with accelerated execution and no UI wait states.
- Suggestion mode, where an AI evaluates legal actions without mutating state.

AI controllers must not click UI controls, inspect popup text, or parse logs.
They receive the in-memory typed state, ruleset, legal actions, pending choices,
and typed results. The UI is one controller and renderer; it is not the rules
engine.

## Model-level interaction boundary

The simulation stores each model's position and rotation independently. AI
controllers should therefore issue model-level movement and rotation actions
one model at a time, reading the current `BattleState` between actions. This
keeps AI decisions based on the latest typed state and avoids requiring an AI
to solve a multi-model gesture against a stale snapshot.

The UI may provide grouped model selection, multi-model dragging, grouped
rotation, formation previews, and other interaction conveniences. Those are
presentation/controller behavior only. The UI may expand a grouped gesture
into a sequence of validated model-level state changes before committing the
result. Batch-capable core helpers may exist for this translation or for rules
that inherently affect a formation, but they must not make grouped UI input a
requirement for AI, simulation, replay, or suggestion controllers.

Controller decisions, random inputs, events, and results must be deterministic
and replayable from the same state and seed. Undo must work equally for human
and AI actions.

See [PHASE_SEPARATION.md](./PHASE_SEPARATION.md) for phase ownership and
[UNDO_AND_TIMELINE.md](./UNDO_AND_TIMELINE.md) for state restoration.
