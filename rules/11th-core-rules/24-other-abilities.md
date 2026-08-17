# 24 Other Abilities

Audited against the local official 11th Edition Core Rules, section 24, and its current FAQ.

- Cleave adds its printed value per complete five models in the sole selected target when attack dice are gathered. It does not apply when that weapon splits attacks.
- Deadly Demise is queued per destroyed model, after casualty position facts are captured. Transport passengers emergency-disembark before the queued 6" mortal-wound event resolves, and every affected unit rolls its damage expression separately.
- Deep Strike and Infiltrators require every model in the rules-unit to have the ability. Their 11th Edition exclusion is strictly more than 8" horizontally, measured footprint-to-footprint; Infiltrators also checks the enemy deployment zone and deployed enemy units.
- A fighting model uses one ordinary melee profile and every Extra Attacks profile it carries. Lance improves wound rolls only after that rules-unit charged this turn.
- Firing Deck records the selected embarked model and non-One Shot weapon, temporarily adds those attacks to the Transport, and prevents the selected model's embarked unit from separately shooting that turn. The selection is a serialized action.
- Hover removes the 2" Take to the Skies cost; it does not grant FLY by itself.
- Scouts is a serialized pre-battle Normal move using the lowest value in the unit, restricted to units wholly in their own deployment zone and ending more than 8" horizontally from enemies. A unit cannot repeat it or carry the state into the first Command phase.
- Super-heavy Walker ignores non-TITANIC models and terrain sections represented as 4"-or-lower features while moving, but still obeys end-position restrictions. MOBILE is an explicit serialized declaration and its post-move D6 can Battle-shock the unit.
- Leader and Support use the Core 19 attached-unit implementation.
- Damaged has no universal payload. The importer only creates a typed threshold for explicit hit-roll and Objective Control penalties found on that datasheet; other datasheet-specific effects fail closed.

Source-dependent limits:

- Scouts deployment from Strategic Reserves and Dedicated Transport inheritance need the corresponding reserve/passenger formation represented in battle state. No unrepresented passenger or datasheet state is inferred.
- Super-heavy Walker uses the terrain feature-height categories already stored by the editor. MOBILE's dense-terrain exception is applied to represented ruin/area geometry; unsupported datasheet terrain tags remain inert.
