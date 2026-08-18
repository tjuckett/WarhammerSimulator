# 11 Charge Phase

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 11.00 Charge Phase
- 11.01 Start Of Charge Phase
- 11.02 Charge Step
  - 11.02.01 Failed Charges
- 11.03 End Of Charge Phase
- 11.04 Charge Move

## Implementation Notes

- Charge phase gating and target option selection are implemented.
- Successful charge moves and failed charge activation are represented.
- Charge restrictions after Advance, Fall Back, Reinforcements, and actions are covered.
- Aircraft restrictions and Heroic Intervention hooks exist.
- Charge resolution rejects a move that would end in engagement with an undeclared enemy unit; attached components of the declared target remain valid declared targets.
- Play charge actions and the UI can serialize multiple declared targets and require engagement with each one.
- Heroic Intervention's Into the Fray surcharge is recorded consistently in command points and the battle log.

## TODO

- Re-audit exact charge timing and Heroic Intervention wording.
- Legal-action generation enumerates singleton and multi-target combinations; final charge success still depends on the rolled movement and resulting geometry.

