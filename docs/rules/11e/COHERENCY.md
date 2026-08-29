# 11th Edition Coherency Rules

Coherency is a shared battlefield rule used by setup, Movement, Pile In,
Consolidation, Disembark, and any other rule that moves or removes models. It
is not owned exclusively by the Movement phase.

## Setup requirement

Whenever a rule instructs a unit to be set up, all models must be placed so the
unit is in coherency, unengaged, and satisfies every other requirement or
restriction of that setup rule. If all models cannot be legally set up, the
unit is removed from the battlefield and returned to its original position,
such as Strategic Reserves or a Transport. A specific rule can override the
default unengaged requirement.

## Coherency requirement

A unit containing more than one model must be set up and end every kind of move
in coherency.

A unit is in coherency only when both conditions apply to every model in that
unit:

- The model is within 2" horizontally and 5" vertically of at least one other
  model in the same unit.
- The model is within 9" horizontally and 5" vertically of every other model
  in the same unit.

The validator must evaluate every model against both conditions. It must not
only check the unit centroid, the nearest pair, or the model currently being
dragged.

During multi-model interaction, a phase may highlight temporary coherency
violations without blocking an individual model action. The authoritative check
occurs at that phase step's defined unit-level finalization boundary. If the
final check fails, the owning step applies the relevant move-failure behavior,
including restoring its checkpoint when required.

## Regaining Coherency

At the End of Turn step of each player's turn, if one or more units on the
battlefield are not in coherency, the controlling player must remove models from
those units one at a time until each unit is back in coherency.

Models removed this way are destroyed, but they do not trigger rules that apply
when a model is destroyed. This is a distinct typed removal cause and must not
be treated as an ordinary destruction event.

End of Turn owns the removal sequence and its choices. The shared coherency
validator determines whether the unit has regained coherency, while the shared
event system suppresses destruction triggers for these specific removals.
