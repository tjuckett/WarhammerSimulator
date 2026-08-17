# 15 Stratagems

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 15.01 Using Stratagems
  - 15.01.01 Modifying CP Cost
  - 15.01.02 Affected By A Stratagem
  - 15.01.03 Stratagem Definitions
- 15.02 Command Re-Roll
- 15.03 Epic Challenge
- 15.04 Insane Bravery
- 15.05 Crushing Impact
- 15.06 Explosives
- 15.07 Rapid Ingress
- 15.08 Fire Overwatch
- 15.09 Snap Shooting
- 15.10 Smokescreen
- 15.11 Heroic Intervention
- 15.12 Counteroffensive

## Implementation Notes

- Core stratagem definitions, CP spending, timing/target restrictions, once-per-phase/battle limits, affected-target restrictions, and current effects are represented.
- Rapid Ingress also enforces its final restriction against use during the first battle round.
- Crushing Impact selects an explicit engaged enemy after the charge, rolls up to six dice from the charging unit's Toughness, deals mortal wounds on 5+, and applies one mortal wound back for each unmodified 1.
- Explosives selects an explicit EXPLOSIVES/GRENADES model and a visible unengaged enemy target within 8 inches; both selections are carried through legal, replay, and manual-play paths.
- Fire Overwatch is restricted to the opponent's Reinforcements/end-of-Movement step, and snap shooting requires the recorded Fire Overwatch use.
- Smokescreen grants Benefit of Cover to the Smoke unit and to units screened by it for the rest of the Shooting phase; it does not add a separate hit modifier.
- Heroic Intervention records the selected Leap to Defend or Into the Fray mode; Into the Fray costs an additional CP, limits targets to 6 inches, caps the charge roll at 6, and intervention charges do not receive Charge bonuses.
- Command Re-roll records the eligible roll type and rerolls one die, except that Charge rolls are rerolled in full; practice replay carries that type through the action.
- Epic Challenge records the selected Character model and applies temporary melee Precision, including model-constrained damage allocation, through replayable legal actions and the play UI.
- Command Re-roll, Rapid Ingress, Heroic Intervention, and Counteroffensive have resolution/test coverage.
- Tactics panel exposes direct stratagem action buttons and pending follow-up labels for key flows; Command Re-roll has a simple UI resolution path.

## TODO

- Audit each core stratagem against final wording.
- Improve UI prompts where pending stratagem resolution still requires manual inputs, especially non-reroll follow-ups.
- Confirm CP-cost modification behavior when source text/data needs it.
