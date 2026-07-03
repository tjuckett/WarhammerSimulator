# 01 Core Concepts

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 01.01 Armies
  - 01.01.01 You
- 01.02 Units and Models
  - 01.02.01 Starting Strength and Half-Strength
  - 01.02.02 Persisting Rules Effects
  - 01.02.03 Revived and Adding Models to a Unit
  - 01.02.04 Not On The Battlefield
  - 01.02.05 Other Model / Unit
  - 01.02.06 Splitting Units
  - 01.02.07 Describing Units
  - 01.02.08 A (Unit/Model/Object)
  - 01.02.09 Tokens
  - 01.02.10 Adding a new unit to your army
  - 01.02.11 All Types of Model
- 01.03 Active Player and Opposing Player
  - 01.03.01 Player's Rules
  - 01.03.02 Rules Sequencing
- 01.04 Measuring Distances
  - 01.04.01 Within / Wholly Within
  - 01.04.02 Closest Or Nearest Model/Unit
  - 01.04.03 As Close As Possible
  - 01.04.04 Base Contact or Base to Base Contact
- 01.05 Dice
  - 01.05.01 Automatically Successful/Passes/Hits/Wounds
  - 01.05.02 Re-rolls
  - 01.05.03 Modifying Dice Rolls
  - 01.05.04 Ignoring Roll Modifiers
  - 01.05.05 Roll Off
  - 01.05.06 Doubles Or Triples
  - 01.05.07 Highest or Lowest Dice Result
  - 01.05.08 Treated As, Set To (Dice Roll)
- 01.06 Leadership Rolls
  - 01.06.01 Leadership Test
- 01.07 Battle-shock Rolls
  - 01.07.01 Battlefield Morale
  - 01.07.02 Battle-shock Test

## Implementation Notes

- Battle state already tracks units, models, active player, player turns, battle rounds, dice helpers, and destroyed/off-board state.
- Starting-strength and below-half-strength concepts are used by Battle-shock and scoring.
- Model/unit distance utilities exist, including vertical range in the current 11th work.

## TODO

- Re-audit all generic definitions against final source wording.
- Confirm revived/added model semantics where faction abilities require exact behavior.
- Expand tests for generic dice modifier and reroll interactions as new rules use them.

