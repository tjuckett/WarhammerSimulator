# 03 Moving

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 03.01 Moving Units
  - 03.01.01 Different Move Characteristics
  - 03.01.02 Moving Over Or Through Models
  - 03.01.03 Random Movement
  - 03.01.04 When Moving Up To
- 03.02 Set Up
  - 03.02.01 If You Cannot Set Up a Unit
  - 03.02.02 Setting Up Large Models
  - 03.02.03 Redeployments
- 03.03 Coherency
  - 03.03.01 What Is Coherency
- 03.04 Engagement
  - 03.04.01 What Is Engagement

## Implementation Notes

- Model-level movement, movement allowance, pivot cost for non-round bases, final-position legality, and coherency checks are implemented.
- Movement path checks cover battlefield edge, enemy model crossing, base overlap, and selected monster/vehicle restrictions.
- Vertical movement, vertical coherency, vertical range, and vertical engagement are represented.

## TODO

- Re-audit exact final movement wording.
- Confirm random movement and redeployment edge cases.
- Keep reusable terrain/pathing helpers in core rather than UI code.

