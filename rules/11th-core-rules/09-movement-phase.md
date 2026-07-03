# 09 Movement Phase

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 09.00 Movement Phase
- 09.01 Start Of Movement Phase
- 09.02 Move Units Step
  - 09.02.01 Selecting Units To Move
  - 09.02.02 Selecting Modes
  - 09.02.03 Reinforcements Step
- 09.03 End Of Movement Phase
- 09.04 Remain Stationary
- 09.05 Normal Move
- 09.06 Advance Move
- 09.07 Fall-Back Move

## Implementation Notes

- Move Units and Reinforcements steps are modeled.
- Normal, Advance, Fall Back, and Remain Stationary mode eligibility is covered.
- Advance and Fall Back restrictions persist into later phases.
- Desperate Escape tests are covered.
- Movement cannot advance with illegal positions or incoherent active units.

## TODO

- Confirm final Reinforcements-step wording and edge cases.
- Continue tests around movement legality, terrain collision, and coherency.

