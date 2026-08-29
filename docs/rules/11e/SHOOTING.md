# Shooting

## Shooting phase

The active player shoots with their eligible units one at a time, using the
shooting sequence, until all units they choose to shoot with have been
selected and their attacks have been resolved.

A unit is eligible to shoot if it is on the battlefield and has not already
been selected to shoot this phase.

An action also affects shooting: a unit performing an action is not eligible
to shoot until the end of the turn, except for TITANIC units.

### Shooting sequence

1. **Select Unit** — Select one friendly unit that is eligible to shoot. That
   unit is selected to shoot.
2. **Select Shooting Type** — Select one shooting type that unit is eligible
   to make and resolve it with that unit. The shooting type can be:
   - Normal shooting.
   - Assault shooting.
   - Close-quarters shooting.
   - Indirect shooting.

Unit-selection eligibility and shooting-type eligibility are separate checks.
Selecting a unit does not by itself guarantee that every shooting type or
weapon is available to it.

## Normal shooting

**Eligible if:** Your unit is unengaged and did not make an Advance move this
turn.

**Effect:** Your unit shoots as described in Making Attacks.

**After shooting:** Until the end of the phase, your unit is not eligible to
start an action.

## Assault shooting

**Eligible if:** All of the following apply:

- The unit is unengaged.
- The unit made an Advance move this turn.
- The unit has one or more Assault weapons.

**Effect:** The unit shoots as described in Making Attacks.

**While shooting:** Only Assault weapons can be selected to make attacks.

**After shooting:** Until the end of the phase, the unit is not eligible to
start an action.

## Close-quarters shooting

**Eligible if:** All of the following apply:

- The unit is engaged.
- The unit did not make an Advance move this turn.
- The unit has one or more Close-Quarters weapons, or is a Monster/Vehicle
  unit.

**Effect:** The unit shoots as described in Making Attacks.

**While shooting:** Models can target enemy units their unit is engaged with.

- **Monster/Vehicle models:** Each attack suffers -1 to its hit roll unless it
  is made with a Close-Quarters weapon against a unit the attacking unit is
  engaged with. Blast weapons still cannot target a unit the attacking unit
  is engaged with.
- **Other models:** Only Close-Quarters weapons can be selected, and targets
  must be enemy units engaged with the attacking unit.

**After shooting:** Until the end of the phase, the unit is not eligible to
start an action.

## Indirect shooting

**Eligible if:** All of the following apply:

- The unit is unengaged.
- The unit did not make an Advance move this turn.
- The unit has one or more Indirect Fire weapons.

**Effect:** The unit shoots as described in Making Attacks.

Indirect Shooting does not limit the unit to using only Indirect Fire
weapons. Its Indirect Fire weapons may target units that are not visible,
while its other weapons can still target valid visible units.

**While shooting:**

- Indirect Fire weapons can target units that are not visible to the attacking
  model.
- The target has the benefit of cover against each Indirect Fire attack.
- Hit rolls made with Indirect Fire weapons cannot be re-rolled.
- An unmodified hit roll of 1–5 fails. If the unit remained stationary this
  turn and the target is visible to one or more friendly units, an unmodified
  hit roll of 1–3 fails instead.

**After shooting:** Until the end of the phase, the unit is not eligible to
start an action.

## Shooting at engaged Monsters and Vehicles

Engaged enemy Monster/Vehicle units can be selected as targets of ranged
attacks.

Each ranged attack targeting an engaged Monster/Vehicle suffers -1 to its hit
roll, except when it is made with a Close-Quarters weapon by a model in a unit
engaged with that target.

## Terrain and visibility interaction

Shooting uses the shared terrain and visibility rules when validating targets
and resolving attacks. A ranged weapon normally requires visibility to the
target, subject to Hidden, Obscuring, and Solid terrain rules. Indirect Fire
weapons use their specific visibility exception. Benefit of Cover is evaluated
for each attack, including the automatic cover granted by Indirect Fire.

## Phase ownership

The phase is divided into these isolated steps:

1. Start of Shooting phase.
2. Shoot.
3. End of Shooting phase.

Start- and end-of-phase rules are resolved through the event system owned by
the corresponding shooting phase step. The Shoot step owns unit selection,
shooting-type selection, attack resolution, completion, and its legal actions.

### Shooting event windows

The Shooting phase exposes typed event windows for rules that trigger during
the phase:

- `PhaseStarted` at the start of the Shooting phase.
- `StepStarted` when the Shooting step begins.
- `AttackResolved` when shooting attacks resolve.
- `PhaseCompleted` at the end of the Shooting phase.

Abilities, mission rules, and Stratagems register against these events and
create typed pending requests when player input is required. The event data
and pending requests are simulation state, so undo and replay restore them
without reading log text.

## Current implementation boundary

`shootingPhaseRules.ts` owns normal Shooting-step unit selection and weapon/
target option generation. Shared combat mechanics such as line of sight,
weapon profiles, hit rolls, wound rolls, saves, damage, and mortal wounds
remain reusable engine mechanics. Out-of-phase shooting reactions such as
Overwatch remain separate from the normal Shooting step.
