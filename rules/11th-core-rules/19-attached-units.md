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
- Shared passive hooks currently consumed by the engine include Anti keyword matching, explicitly unit-scoped Stealth, Feel No Pain and Fights First rules, Blast model count, Battle-shock/half-strength, and defensive Toughness. Core 19.04 sharing is scope-sensitive: wording that affects `this unit` or `models in that unit` applies across the attachment, while `this model`/bearer-only effects remain on their source component. The source component stops contributing after it is destroyed; a surviving Leader's own `while leading` rule remains available.
- Attached components resolve as one uninterrupted Shooting activation. Manual play serializes the active attachment and locks the first selected target for the remaining component weapon controls, preventing result-dependent target changes; simulation snapshots all component weapon/target declarations before resolving any attacks.
- Actions use combined eligibility and geometry, are copied to every live component for replay/save, cancel as a group when any component performs a cancelling move, and emit one completion fact. Advance and charge activation/state flags are also shared across the rules unit.
- Attached components resolve as one uninterrupted Fight activation. The serialized component cursor preserves manual, simulation, replay, and save ordering while leaving stable component weapon/model controls intact.

## Source-dependent limits

- Imported data identifies Leader attachments but does not distinguish Leader from Support or transcribe each datasheet's permitted Bodyguard list and exceptional separation rule. The simulator therefore preserves explicit imported choices and does not invent attachment eligibility or detachments.
- Arbitrary datasheet abilities still need typed scope/effect data before they can be applied generically. Text matching is deliberately fail-closed: single-model/bearer effects are not shared, and imported wording that does not establish unit/model-in-unit scope remains local. Known unit-level passive hooks are shared as listed above.
- Manual attached-unit Shooting currently supports one common declared target through the existing component weapon controls. The simulation path can snapshot multiple targets up front; a future declaration UI would be needed to expose that wider choice manually without allowing attacks already resolved to influence later declarations.
- The existing tabletop editor still stores movement geometry per imported component so users can position every model in the combined unit. Group completion, Advance and charge-used flags are shared, but charge/fallback translation retains the simulator's existing simplified formation movement rather than attempting to infer datasheet-specific model placement.
- If an ability source is destroyed by an attack, Core 19.04 keeps that ability until the attacking unit finishes all attacks. Deferred manual casualty allocation already keeps sources present through the attack packet; richer cross-packet timing needs typed ability/effect data and remains part of datasheet ability support.

