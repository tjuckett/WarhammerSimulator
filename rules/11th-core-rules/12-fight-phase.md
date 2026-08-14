# 12 Fight Phase

Source: https://gdmissions.app/11th/rules/core-rules

## Indexed Entries

- 12.00 Fight Phase
- 12.01 Start Of Fight Phase
- 12.02 Pile In Step
- 12.03 Pile-In Move
- 12.04 Fight Step
  - 12.04.01 Eligible to fight, but unable to fight
- 12.05 Normal Fight
- 12.06 Overrun Fight
- 12.07 Consolidate Step
- 12.08 Consolidation Move
- 12.09 End Of Fight Phase

## Implementation Notes

- Fight priority, charged/Fights First ordering, selected melee weapons, split melee attacks, pile-in, consolidation, no-melee attack resolution, and fight damage allocation are covered.
- Core 12.04–12.08 was re-audited against the full local core rules PDF (`../eng_01-06_warhammer40k_new40k_core_rules-was6fbu1ix-hfewhmxyiy.pdf`, pp. 38, 40–42; FAQ p. 88).
- The simulator records which units were engaged at the start of the Fight step. An otherwise eligible unit can select the named Overrun fight type when it is currently unengaged, or when it began the Fight step unengaged and became engaged during the phase.
- Overrun selection allows one additional pile-in before attacks. It does not replace the ordinary pile-in step, does not bypass Fights First priority, and does not prevent the unit from consolidating after every eligible fight has resolved.
- Manual actions, simulation sequencing, replay, and saved scenarios preserve the Fight-step snapshot and Overrun selection/move state.

## TODO

- Re-audit Counteroffensive interaction with fight order.

