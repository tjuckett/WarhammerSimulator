# 16 Actions

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 16.01 Performing Actions

## Implementation Notes

- Action start, cancellation by movement, shooting/charging restrictions, and end-of-turn completion are represented.
- Mission-action definitions are transcribed in mission data. Persistent operation marker placement is represented for implemented objective actions, Sensor Sweep can remove a selected marker after its unit controls a central objective through the end of the turn, and Surveil the Foe immediately records eligible visible targets.

## TODO

- Add remaining mission action state tracking for cleanse/plunder, booby trap, and trapped terrain markers.
- Add tests for each mission action, cancellation path, marker lifecycle, and scoring clause that depends on action completion.
