# 10 Shooting Phase

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 10.00 Shooting Phase
- 10.01 Start Of Shooting Phase
- 10.02 Shoot Step
- 10.03 End of Shooting Phase
- 10.04 Normal Shooting
- 10.05 Assault Shooting
- 10.06 Close-Quarters Shooting
- 10.07 Indirect Shooting

## Implementation Notes

- Shooting phase gating and active-player shoot selection are implemented.
- Normal, Assault, Close-Quarters/engaged vehicle-style shooting, and Indirect behavior are represented.
- LOS/range target validity, cover, Heavy, Hazardous, and selected weapon activation semantics are covered by tests.
- Shooting target UI distinguishes visible, out-of-range, and no-ranged-weapon target states.

## TODO

- Re-audit target eligibility, cover, LOS, and weapon keyword changes.
- Expand tests for terrain/cover combinations and engaged shooting.

