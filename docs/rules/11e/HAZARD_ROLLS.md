# 11th Edition Hazard Rolls

Hazard Rolls are a shared resolution mechanic. They are not owned by the
Movement phase and may be requested by any phase, ability, army rule,
Stratagem, or event-driven response when its rules require them.

The requesting phase or event owns:

- When the Hazard Roll is required.
- Which models or units roll.
- Any modifiers or special conditions.
- How failures and successes affect the game.
- When the owning step or event response is complete.

The shared Hazard Roll service owns the D6 resolution and typed result:

- A result of 1-2 fails and causes the unit to suffer 1 Mortal Wound.
- If every model in the unit is a MONSTER/VEHICLE model, a failed roll causes
  3 Mortal Wounds instead.
- If more than one Hazard Roll is required for a unit, resolve all those rolls
  simultaneously.

The service must return results that can be stored in `BattleState`, replayed,
and restored by Undo. The UI may display the roll, but no rule may inspect log
text to determine the result. Mortal Wounds are then resolved by the shared
[Mortal Wounds](./MORTAL_WOUNDS.md) mechanic.

Movement currently requests Hazard Rolls for Desperate Escape, Combat
Disembark, and Emergency Disembark. Other rules may request them in Shooting,
Fight, or any other timing window.

See [PHASE_SEPARATION.md](../../PHASE_SEPARATION.md) for shared-service and
phase-ownership boundaries.
