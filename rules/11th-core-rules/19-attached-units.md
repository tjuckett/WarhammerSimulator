# 19 Attached Units

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 19.01 Forming Attached Units
  - 19.01.01 Attached Units After Their Bodyguard Unit is Destroyed
- 19.02 Attacking Attached Units
- 19.03 Keywords In Attached Units
- 19.04 Abilities In Attached Units
  - 19.04.01 Only In Death Does Duty End

## Implementation Notes

- Imported Leader choices form a stable rules unit while retaining component/model IDs for tabletop editing and replay compatibility.
- The live attachment supplies one target, combined starting/remaining strength, the highest surviving Bodyguard Toughness (or highest surviving Leader/Support Toughness), unit-level keywords, and modeled unit abilities.
- Ordinary attacks allocate to the Bodyguard component while it survives; Precision can select a visible Character component. Range and visibility can be established to any live component.
- A destroyed Bodyguard does not generically split the unit in 11th edition. Surviving Leader/Support components remain attached, including through save/replay. FAQ 19.01.01 only governs datasheet rules that explicitly create separate units.
- Per-model destruction facts retain their source component and use the combined starting strength. A unit-destruction fact is emitted once, when the final model that started in the attachment is destroyed, so mission destruction effects do not count Bodyguard and Leader separately.
- Shared passive hooks currently consumed by the engine include Anti keyword matching, Stealth, Feel No Pain, Fights First, Blast model count, Battle-shock/half-strength, and defensive Toughness. The source component stops contributing after it is destroyed; a surviving Leader's own `while leading` rule remains available.
- Attached components resolve as one uninterrupted Fight activation. The serialized component cursor preserves manual, simulation, replay, and save ordering while leaving stable component weapon/model controls intact.

## Source-dependent limits

- Imported data identifies Leader attachments but does not distinguish Leader from Support or transcribe each datasheet's permitted Bodyguard list and exceptional separation rule. The simulator therefore preserves explicit imported choices and does not invent attachment eligibility or detachments.
- Arbitrary datasheet abilities still need typed scope/effect data before they can be applied generically. Single-model effects are not shared. Known unit-level passive hooks are shared as listed above.
- If an ability source is destroyed by an attack, Core 19.04 keeps that ability until the attacking unit finishes all attacks. Deferred manual casualty allocation already keeps sources present through the attack packet; richer cross-packet timing needs typed ability/effect data and remains part of datasheet ability support.

