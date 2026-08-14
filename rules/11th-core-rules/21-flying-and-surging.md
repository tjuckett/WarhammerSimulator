# 21 Flying and Surging

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 21.01 Surge Moves
- 21.02 Surge Move
- 21.03 Flying Models

## Implementation Notes

- Core 21.02 Surge eligibility is validated only after a granting rule supplies a trigger: the unit must be unengaged, not Battle-shocked, and must not have moved in the current phase. The granting action stores the source and already-resolved maximum distance; Core itself does not prescribe a roll or make the move optional.
- A triggered Surge blocks phase advancement until resolved. The active player selects among the closest eligible enemy units (with the Core 23 Aircraft exception), the unit moves toward that target, cannot end engaged with another enemy, retains coherency, cancels an incompatible action, and is locked from moving again that phase. Trigger and resolution are deterministic GameActions and persist through replay/save.
- Core 21.03 Fly is an explicit `Take to the Skies` declaration before a Normal, Advance, Fall-back, or Charge move, not an always-on path exemption. The declaration subtracts 2" from every component's maximum distance; FLY models ignore vertical distance and may pass through every model and terrain feature, but still cannot end overlapping models or blocking terrain and must obey the move's engagement/end conditions.
- Manual play exposes Take to the Skies and any pending Surge target. Simulation conservatively declares Take to the Skies for eligible FLY movement/charges; datasheet-specific Surge triggers are not invented.

## Source-dependent limits

- Datasheet rules determine whether a Surge trigger is mandatory or optional and how its maximum distance is generated. Those rules should dispatch `GrantSurgeMove` with the resolved distance and source text; Core 21 only defines the legal effect.
- The simulator's automatic Surge resolver preserves its current formation geometry and follows the closest legal route represented by existing terrain movement helpers. Datasheet effects that alter a Surge move require typed ability support.

