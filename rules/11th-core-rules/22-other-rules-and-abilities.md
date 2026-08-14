# 22 Other Rules And Abilities

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 22.01 Aura Abilities
- 22.02 Faction Abilities
- 22.03 Psychic Abilities
- 22.04 Wargear Abilities
- 22.05 Plunging Fire

## Implementation Notes

- Audited against the full local official 11th Core PDF, sections 22.01-22.05, plus the Core 23.03 Aircraft exception.
- Imported rules can now carry typed `Aura`/`Psychic` tags, faction/wargear categories, an explicit Aura range, and an original roster-model bearer index. Existing text-only imports still recognize printed `[Aura]`, `(Aura)`, `[Psychic]`, and `(Psychic)` tags.
- Aura queries include the source's own attached unit, allow different Auras to overlap, deduplicate repeated instances of the same named Aura, and stop a source while it is destroyed, embarked, in reserves, or after its named bearer is destroyed. They expose range/source facts only: friendly/enemy scope and the actual effect remain source-defined and are not inferred from prose.
- Faction helpers enforce the army-faction-to-unit-faction-keyword gate, with an explicit typed escape hatch for rules that state otherwise.
- Damage caused by a typed Psychic ability can carry serialized `psychic` attack provenance through pending allocation and model/unit destruction facts.
- Unit-level Wargear remains active with the unit; bearer-indexed Wargear expires when that original roster model is destroyed. No untranscribed item effect is invented.
- Plunging Fire is resolved per attacking model. A visible target must contain a ground-level model, and the attacker must either be on a terrain section at least 3" high or be `TOWERING` and within 12". It improves Ballistic Skill by 1 rather than adding a Hit modifier, and Core 23.03 suppresses it for attacks made by or targeting `AIRCRAFT`.

## Datasheet-dependent follow-up

- Import each ability's effect and target scope as typed data before executing it. Core 22 classifies those effects but does not define a universal Aura, faction, Psychic, or Wargear payload.
- Continue datasheet/character ability support under the existing datasheet-source TODO.

