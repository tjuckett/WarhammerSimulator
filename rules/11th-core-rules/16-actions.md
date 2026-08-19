# 16 Actions

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 16.01 Performing Actions

## Implementation Notes

- Action start, cancellation by movement, shooting/charging restrictions, and end-of-turn completion are represented.
- Mission-action definitions are transcribed in mission data. Persistent operation marker placement is represented for implemented objective and terrain actions, Sensor Sweep can remove a selected marker after its unit controls a central objective through the end of the turn, Surveil the Foe immediately records eligible visible targets, and Death Trap immediately places Booby Trap markers in eligible terrain areas.

## TODO

- [x] The currently modeled Cleanse and Plunder action state is complete: eligibility, unique target tracking, cancellation, end-of-turn completion, replay/save persistence, and dependent scoring are covered in simulator-core tests.
- Remaining mission-action work is limited to any newly sourced action definitions and exact layout-dependent behavior; do not infer those without authoritative mission data.
