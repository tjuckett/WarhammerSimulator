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

## TODO

- Re-audit exact charge timing and Heroic Intervention wording.
- Full multi-target declaration and selection remains to be added; the current action flow supports one declared target and fail-closes undeclared engagements.

