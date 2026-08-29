# 11th Edition Terrain Rules

Terrain is shared battlefield state used by setup, Movement, Shooting,
visibility, and missions.

## Placing Terrain

Before the battle, place terrain features using one or more of these methods:

- Place a well-defined boundary, such as a base or mat, in each terrain
  location, then place one or more terrain features wholly within that boundary.
- Place one terrain feature directly on the battlefield.
- Place two or more terrain features directly on the battlefield so that
  together they define an area's boundary.

The battlefield area occupied by a boundary or terrain feature is a terrain
area. A mission's deployment map may define each terrain area's location and
dimensions. Otherwise, the players must agree on them before the battle.

## Terrain Categories

Each terrain feature belongs to a terrain category that can affect movement and
visibility. A terrain area may contain features belonging to different
categories.

- Exposed: offers scant protection and can be traversed without hindrance.
  Examples include craters, razorwire, and scattered debris.
- Light: can provide cover but does not slow an advance or offer lasting
  defence. Examples include barricades, low walls, and statuary.
- Dense: can obstruct even large war machines and shelter squads from enemy
  sight. Examples include buildings, ruins, armoured containers, and woods.

A mission's deployment map may define which categories should be present within
each terrain area. Meeting those requirements is intended to provide the best
gaming experience.

The category description alone does not replace the specific movement,
visibility, or attack rules that apply to a terrain feature. Those rules remain
owned by the relevant phase or shared validator.

## Terrain and Movement

### Moving Through Terrain

Models can move through terrain features according to their category:

- Exposed and Light: all models can move horizontally and vertically through
  these terrain features.
- Dense:
  - INFANTRY, BEASTS, SWARM, and MOBILE models can move horizontally through
    Dense terrain features.
  - INFANTRY, BEASTS, and SWARM models can move vertically through Dense terrain
    features.
  - Other models can move horizontally through Dense terrain only when every
    section of that terrain feature through which the model's base would move is
    2" or less in height.
  - If a section is higher than 2", an otherwise eligible model must move
    vertically to ascend or descend that section. It cannot move through
    ceilings or floors while doing so, and it cannot end that move on a
    non-ground-level surface of that terrain feature.

### Moving Vertically

Models may move vertically to ascend or descend terrain features. While doing
so:

- The model must remain within ½" horizontally of that terrain feature.
- Add vertical distance moved up and vertical distance moved down to the other
  distance that model has moved since its unit began the move.

### Setting Up or Ending a Move on Terrain

Models can be set up or end a move on the ground level of terrain features. They
can be set up or end a move on an elevated surface only if all of the following
apply:

- The model has at least one of these keywords: INFANTRY, BEASTS, SWARM, FLY, or
  MONSTER.
- The model is stable after the move.
- No part of the model's base overhangs the outer edge of that surface.

The movement validator must evaluate terrain traversal, vertical distance, and
final surface placement separately for each model and its keywords.

## Terrain and Visibility

Terrain can affect visibility through Benefit of Cover, Hidden, Obscuring, and
Solid rules. Visibility geometry is shared; the owning phase applies the
resulting attack or targeting consequences.

### Benefit of Cover

Each time a ranged attack targets a unit, the unit has Benefit of Cover if every
model in that unit satisfies at least one of these conditions:

- The model has the INFANTRY, BEASTS, or SWARM keyword and is within a terrain
  area.
- The model is not fully visible to the attacking model because of one or more
  intervening terrain features or obscuring terrain areas.

Each time a ranged attack targets a unit with Benefit of Cover, worsen the BS
characteristic of that attack by 1.

### Hidden

A model is Hidden when all of the following apply:

- It has the INFANTRY, BEASTS, or SWARM keyword and is within a terrain area
  containing one or more Dense terrain features.
- Its unit did not make one or more ranged attacks during this turn or the
  previous turn.

A Hidden model is visible to enemy models only when they are within its
detection range. Unless otherwise stated, detection range is 15".

### Obscuring

Terrain areas containing one or more Light or Dense terrain features are
Obscuring terrain areas. If every line of sight between two models crosses one
or more Obscuring terrain areas, excluding areas that one or both models are
within, those models are not visible to each other.

### Solid

Dense terrain features have Solid. Line of sight cannot be drawn across any
enclosed gap in the surface of a Solid terrain feature that is 3" or less from
ground level. This applies regardless of small openings or gaps unless a
mission adjusts the height at which Solid takes effect.

Shooting consumes the typed visibility result when determining legal targets and
attack modifiers. Terrain visibility must not be reconstructed from log text or
from a UI line-of-sight display.
