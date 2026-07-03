# 07 The Battle Round

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 07.00 The Battle Round
- 07.01 Start Of Battle Round
- 07.02 Player Turns
  - 07.02.01 Out Of Phase Rules
  - 07.02.02 Battle Round/Turn/Phase Definitions
- 07.03 End Of Battle Round

## Implementation Notes

- Setup starts player turns in Command.
- Active/opponent player tracking is preserved.
- Battle rounds advance after both player turns.
- Battle ends after the final round.
- Out-of-phase snap shooting does not consume normal Shooting phase weapon state.

## TODO

- Re-audit out-of-phase rules with final wording.
- Keep phase/step state structured in core.

