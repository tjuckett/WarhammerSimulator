# 16 Actions

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 16.01 Performing Actions

## Implementation Notes

- Action start, cancellation by movement, shooting/charging restrictions, and end-of-turn completion are represented.
- Mission-action definitions are transcribed in mission data, but many action-marker clauses still resolve as unsupported until marker placement/removal state is modeled.

## TODO

- Add mission action state tracking for cleanse/plunder, secure asset, vanguard, booby trap, decoy, consecrate, triangulate, surveil, extract/sensor sweep/sabotage, operation markers, trapped terrain markers, and marker removal.
- Add tests for each mission action, cancellation path, marker lifecycle, and scoring clause that depends on action completion.
