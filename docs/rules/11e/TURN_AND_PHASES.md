# 11th Edition Turn and Phase Rules

This is the canonical rules reference for the documented turn sequence. The
implementation target is 11th edition only; future editions must enter through
a versioned ruleset boundary.

## Pre-battle deployment workflow

Deployment is a pre-battle workflow. It is not one of the seven Player Turn
phases and does not run inside the Battle Round loop. The battle cannot enter
Start of Battle Round until the deployment workflow is complete.

The target boundary is:

```text
Pre-battle setup
  -> Determine deployment order
  -> Declare Battle Formations
  -> Alternate deploying units and recording reserve/Transport state
  -> Roll for the first turn
  -> Resolve Scouts and other Pre-battle Abilities
  -> Start of Battle Round
```

### Deployment order

Both players roll a D6. The winner chooses which player deploys first.

### Deploying units

Players then alternate deploying units into their starting zones. During this
process they decide which units are placed in Strategic Reserves and which units
are embarked within Transports. If one player has no remaining units to deploy,
the other player continues deploying their remaining units until deployment is
complete.

### Determining the first turn

After all units are deployed, both players roll to determine who takes the first
turn. The winner must take the first turn; they do not choose which player goes
first.

### Pre-battle abilities

After the first player is determined, resolve Scouts and other Pre-battle
Abilities. Each substep has its own eligibility, pending choices, popup state,
completion, and undo boundary.

The exact ordering and player alternation inside deployment will be added as
the authoritative deployment rules are documented. No Player Turn phase should
be used as a shortcut for unresolved pre-battle work.

## Battle Round sequence

Each Battle Round is resolved in this order:

1. Start of Battle Round.
2. Player Turns.
3. End of Battle Round.

The seven phases below are the phases within each Player Turn. Battle-round
state is an outer workflow and must remain separate from player-turn phase
state.

## Player roles

At any given time, one player is the active player and their opponent is the
opposing player. Whenever one becomes active, the other becomes opposing. These
roles can change during a Battle Round and are not permanently tied to a side.

While neither player has a turn, such as at the start or end of a Battle Round,
the player who takes the first turn in that Battle Round is the active player.

While a player has a turn, that player is normally active. There are important
unit-resolution exceptions:

- When a unit is selected to move, that unit's controlling player is active until
  the move ends.
- When a unit is selected to shoot, that unit's controlling player is active
  until its attacks are resolved.
- When a unit is selected to fight, that unit's controlling player is active
  until its attacks are resolved.

The opposing player may still receive a legal reaction, use a Stratagem, or
resolve an army rule during the active player's turn when the timing rules
permit it.

The role state must therefore include both the turn owner and the current active
player context. A simple opposing-player derivation remains valid:

```ts
const activePlayer = state.currentActivePlayer ?? state.activeArmy;
const opposingPlayer = activePlayer === 0 ? 1 : 0;
```

An interrupt's responding player is not necessarily the current active player.
The owning Player Turn and phase remain unchanged while this temporary active
player context is used, and control returns to the appropriate active context
after the unit move or attacks resolve.

### Start of Battle Round

Resolve rules triggered at the start of the Battle Round before progressing to
Player Turns. This is an event-driven timing window owned by Battle Round state.

### End of Battle Round

Resolve rules triggered at the end of the Battle Round in this order:

1. Resolve non-mission rules triggered at this point.
2. Both players consult their mission and resolve any mission aspects triggered
   at this point.

The Battle Round then ends. Unless the battle has ended, the next Battle Round
starts. The mission determines how many Battle Rounds are resolved before the
battle ends, so battle length must come from typed mission state rather than a
hard-coded phase assumption.

## Turn sequence

1. Start of Turn
2. Command
3. Movement
4. Shooting
5. Charge
6. Fight
7. End of Turn

## Step ownership

- Start of Turn: resolve rules triggered at the start of the turn.
- Command: Start of Command, Gain Core CP, Battle-shock, Command abilities,
  End of Command.
- Movement: Start of Movement, Move Units, End of Movement.
- Shooting: Start of Shooting, Shoot, End of Shooting.
- Charge: Start of Charge, Charge, End of Charge.
- Fight: Start of Fight, Pile In, Fight, Consolidate, End of Fight.
- End of Turn: resolve non-mission end rules first, then mission rules.

Each step owns its eligibility, legal actions, pending state, popup visibility,
and completion. Events may register and resolve within the same step. The
active player owns the workflow, but opponent reactions may be legal when their
rules permit them.

Detailed phase rules and implementation boundaries are maintained in
[PHASE_SEPARATION.md](../../PHASE_SEPARATION.md). Detailed Movement rules are
in [MOVEMENT.md](./MOVEMENT.md). Cross-phase Aircraft exceptions are in
[AIRCRAFT.md](./AIRCRAFT.md), and coherency rules are in
[COHERENCY.md](./COHERENCY.md). Terrain rules are in [TERRAIN.md](./TERRAIN.md).
