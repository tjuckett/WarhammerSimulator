# 11th Edition Aircraft Rules

Aircraft rules are cross-phase rules. They are documented separately so their
exceptions can be applied by the owning phase without becoming global movement
or combat predicates.

## Deployment

During Declare Battle Formations, all Aircraft units must be placed in Strategic
Reserves.

## Movement

- Aircraft units are eligible only to make an Ingress Move. They are not
  eligible to make any other type of move.
- At the end of the opponent's turn, all Aircraft units in your army that are on
  the battlefield must be placed in Strategic Reserves.
- Whenever a unit makes any type of move, its models may move through Aircraft
  models.
- During Pile In, Consolidation, or Surge Move, unless the moving unit can FLY,
  ignore Aircraft units when selecting enemy units and determining the closest
  enemy unit.
- Being engaged solely with one or more Aircraft units does not prevent a unit
  from being eligible to make a Normal or Advance Move.

The Movement and Fight steps must apply these as separate rules: passing through
Aircraft is a movement-path permission, while ignoring Aircraft for Pile In,
Consolidation, and Surge targeting is an enemy-selection/closest-target rule.

## Shooting

Plunging Fire has no effect on attacks made by, or targeting, Aircraft units.

## Charging and Fighting

- Aircraft units are not eligible to declare a Charge.
- Aircraft units can make melee attacks only when targeting FLYING units.
- Only FLYING units can select Aircraft units as Charge targets.
- Only FLYING models can make melee attacks that target Aircraft units.

Aircraft restrictions are evaluated by the owning phase. The rules engine must
not use a single global `isAircraft` rule to decide all movement, shooting,
Charge, and Fight behavior.
