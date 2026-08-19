# 05 Attack Sequence

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 05.00 Attack Sequence
- 05.01 Hit Rolls
  - 05.01.01 Critical Hits and Critical Wounds
- 05.02 Wound Rolls
  - 05.02.01 Multiple Toughness Characteristics
- 05.03 Save Rolls
  - 05.03.01 Saving Throw
- 05.04 Inflict Damage
  - 05.04.01 Current Allocation Group
  - 05.04.02 Modifying Damage
  - 05.04.03 Suffers Damage
  - 05.04.04 Destroyed
  - 05.04.05 Fight On Death
  - 05.04.06 Measuring To A Destroyed Model Or Unit

## Implementation Notes

- Hit, wound, save, normal damage, devastating/mortal-style damage, damaged model continuation, and destroyed unit/model removal are represented.
- Mixed-profile highest toughness and impossible-save behavior are covered in core tests.
- Defender-choice damage allocation is the current flow.

## TODO

- Add Fight On Death support once timing/source data exists.
- Destroyed model/unit last-position tracking is implemented and covered; it preserves the final formation and centroid for sourced post-destruction measurements.
- Re-audit damage modifiers and allocation against final wording.

