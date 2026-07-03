# 04 Making Attacks

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 04.00 Making Attacks
- 04.01 Select Weapons
  - 04.01.01 Models Without Ranged/Melee Weapons
  - 04.01.02 Sidearms
  - 04.01.03 Multiple Weapon Profiles
  - 04.01.04 Attack Characteristics and Abilities
  - 04.01.05 Selected to Attack
- 04.02 Select Targets
  - 04.02.01 Selecting Targets
  - 04.02.02 Against An Attack
  - 04.02.03 Single Target
- 04.03 Resolve Attacks
  - 04.03.01 Identical Attacks
  - 04.03.02 Splitting Melee Attacks
  - 04.03.03 Target No Longer Eligible Or Viable
  - 04.03.04 Shot
  - 04.03.05 Fought
  - 04.03.06 Finished Making Its Attacks

## Implementation Notes

- Models without matching weapons can be selected, resolve no attacks, and count as activated.
- Sidearms/Pistols are handled separately from other ranged weapons.
- Alternate weapon profiles can be grouped so only one profile is used.
- Weapon-scoped modifiers and abilities stay with the selected attack sequence.
- Core supports melee split attacks and invalid/unviable target handling; current app controls still mostly use single-target fight flow.

## TODO

- Add UI controls for declaring split melee attack counts across multiple engaged targets.
- Re-audit invalid/unviable target and activation-consumption behavior against final source wording.
