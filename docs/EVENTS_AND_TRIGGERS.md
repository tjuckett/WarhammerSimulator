# Events, Triggers, and Reactions

Abilities, army rules, Stratagems, missions, and special responses use a typed
event-driven system. A rule registers a trigger definition with explicit phase,
step, timing, condition, owner, and effect/choice.

The active player owns the phase workflow, but either player may own a legal
reaction during that phase. Opponent reactions can pause the active step and
return control after resolution.

```text
Typed event occurs
  -> registry finds matching phase/step triggers
    -> owning step resolves automatic effects or exposes a choice
      -> typed effects/events update BattleState
```

This includes:

- Battle-shock requests created by the Command Battle-shock step or abilities at
  any timing.
- Emergency Disembark requests created when a Transport is destroyed.
- Surge Move requests created by the rule granting the move.
- Army rules such as Waaagh! during their specified Command timing.
- Stratagems and abilities used during an opponent's turn when permitted.

## Rapid Ingress Stratagem

```text
When:
  - End of your opponent's Movement phase.

Target:
  - One friendly unit in Strategic Reserves.
  - Aircraft cannot be targeted.

Effect:
  - The target unit makes an Ingress Move.

Restriction:
  - This Stratagem cannot be used during the First Battle Round.
```

Rapid Ingress is an opponent-turn Stratagem reaction. The Stratagem system
validates its timing, target, and Battle Round restriction, then creates a typed
Ingress Move request for the Movement/Reserves rules to resolve. It must not
open a Movement popup directly or bypass Ingress validation.

The registry routes and matches triggers; it does not advance phases, render
popups, or resolve choices. The owning phase step controls completion and UI.
Triggers must have stable identities and be safe under replay and undo.

Logs are projections for display/audit only. Trigger matching and game state may
never be inferred from log text.

See [PHASE_SEPARATION.md](./PHASE_SEPARATION.md) for ownership rules.
