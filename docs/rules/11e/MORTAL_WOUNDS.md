# 11th Edition Mortal Wounds

Mortal Wounds are a shared damage-resolution mechanic used by attacks, Hazard
Rolls, and other rules in any phase.

## Resolving Mortal Wounds

Each time a unit suffers one or more Mortal Wounds, its controlling player
resolves the following sequence once for each Mortal Wound, stopping if all
Mortal Wounds have been inflicted or the unit is destroyed:

1. Select a model using the first applicable instruction:
   - Select a non-CHARACTER model that has lost one or more wounds.
   - Otherwise select a non-CHARACTER model.
   - Otherwise select a CHARACTER model that has lost one or more wounds.
   - Otherwise select a CHARACTER model.
2. The selected model loses 1 wound. If its remaining wounds reach 0, it is
   destroyed.

Model selection and wound allocation are typed pending state when player choice
is required. The owning phase or event controls timing, while this shared
mechanic controls the selection priority and damage result.

## Mortal Wounds and normal damage

When resolving attack dice that inflict both Mortal Wounds and normal damage,
resolve all normal damage first, then resolve all Mortal Wounds.

Mortal Wound resolution must emit typed damage/destruction events and preserve
their source and cause for rules, Undo, replay, and mission effects. The UI and
AI consume the same legal model-selection actions; neither uses log text as
game state.

See [HAZARD_ROLLS.md](./HAZARD_ROLLS.md) for the Hazard Roll source of Mortal
Wounds.
