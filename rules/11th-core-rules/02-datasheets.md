# 02 Datasheets

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 02.01 Datasheet Name
  - 02.01.01 Datasheet Name and Keywords
- 02.02 Profiles
  - 02.02.01 Modifiers
  - 02.02.02 Ignore Modifiers
  - 02.02.03 Random Characteristics
  - 02.02.04 Healing Or Regaining Lost Wounds
  - 02.02.05 Full Wounds Remaining
  - 02.02.06 Characteristic Modifiers & Modified Characteristics
- 02.03 Abilities
  - 02.03.01 Rules With Multiple Conditions And Effects
- 02.04 Weapons
  - 02.04.01 Weapons With No Strength
- 02.05 Keywords
  - 02.05.01 Using Keywords & Mixed Keywords in Units
- 02.06 Unit Composition And Other Rules
  - 02.06.01 Bearer
  - 02.06.02 Unit's Equipment
- 02.07 Wargear options

## Implementation Notes

- Imported army/unit/weapon profiles are used by the simulator core.
- Weapon keyword parsing and profile grouping are represented in core combat.
- Some passive datasheet rules are wired: Stealth, Fights First, Feel No Pain, Lone Operative, Precision targeting, and stratagem keyword restrictions.

## TODO

- Add exact command/faction/datasheet ability effects only when source text or structured data exists.
- Improve attached-unit and leader/bodyguard ability sharing once exact wording and data model needs are confirmed.
- Add roster construction validation in the import/army-builder layer.

