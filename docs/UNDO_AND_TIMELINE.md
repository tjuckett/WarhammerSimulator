# Undo and Timeline Requirements

Undo restores the complete typed interaction, not just model positions or the
displayed log.

Each undoable action must restore:

- BattleState and phase/step progress.
- Events, trigger registration/activation/consumption, and stable identities.
- Dice inputs/results and pending requests.
- Unit, model, transport, objective, and restriction state.
- Popup state: selected units/models, popup mode, targets, allocations, current
  choice, and player priority.
- AI or human controller action context.

For unit-level movement, capture a checkpoint before the first model moves. If
the final unit validation fails, keep the unit locked and show its error popup.
`Retry` is a UI label for the normal Undo action: restore the checkpoint and
reopen the same interaction.

After restoration, the owning phase step revalidates the interaction state and
regenerates its popup view model. Valid restored popups return immediately;
invalid state is cleared or replaced. Recovery must not require deselecting and
reselecting a unit.

Never reconstruct state by deleting log entries or parsing log text. Restoring
the same checkpoint and replaying the same action with the same random input
must produce the same result.

See [PHASE_SEPARATION.md](./PHASE_SEPARATION.md) for phase ownership.
