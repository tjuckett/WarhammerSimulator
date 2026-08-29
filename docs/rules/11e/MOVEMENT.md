# 11th Edition Movement Rules

Movement owns unit selection, move-type selection, movement interaction,
placement validation, and movement completion. Shared geometry provides
distance, paths, footprints, terrain, collision, setup, and coherency
mechanics; each move type owns its own engagement and endpoint rules.

## Moving Units

Each move type defines its own eligibility, maximum distance or setup distance,
and required conditions. When moving a unit, move one or more of its models one
at a time. A model may be moved in a straight line and/or rotated as many times
as desired during that unit's move.

Unless otherwise stated, each model:

- May move through friendly models.
- May move through any space its base can fit through.
- May not move its base through enemy models.
- May not move its base across the battlefield edge.
- Must satisfy all conditions stated under While Moving for the selected move
  type.

Specific rules such as FLYING movement can override these defaults for the
specific move being resolved.

## Monsters, Vehicles, and FRAME Models

### Moving MONSTER/VEHICLE Models

Each time a unit makes a Normal or Advance Move, MONSTER/VEHICLE models in that
unit may be moved through friendly and enemy models. They may not be moved
through other MONSTER/VEHICLE models. This exception is scoped to Normal and
Advance Moves and does not automatically apply to Fall Back, Charge, Pile In,
Consolidation, or other move types.

### FRAME

Some models do not have a base. Models with the FRAME keyword use the closest
point on the model when a rule refers to that model's position or when measuring
distances to or from it, unless the rule states otherwise. The measurement point
does not have to be a base.

When rotating a FRAME model without a base as part of a move, rotate it any
amount around its central axis while keeping it upright.

### Setting Up a Unit

Whenever a rule instructs a unit to be set up, place all of its models on the
battlefield so that:

- The unit is in coherency.
- The unit is unengaged.
- All other requirements and restrictions of the rule are satisfied.

If all models cannot be set up legally, remove the unit from the battlefield
and return it to its original position, such as Strategic Reserves or inside a
Transport. This is different from an Emergency Disembark model that cannot be
placed, which is destroyed under that specific rule. A move-specific rule may
explicitly override the default unengaged requirement, such as Combat
Disembark.

### Moving a Model in a Straight Line

Move the model horizontally across the battlefield. Measure from the same point
on its base at the start and end of that movement, then add that distance to any
other distance the model has moved since its unit began the current move. The
total cannot exceed the selected move type's maximum distance.

### Rotating a Model

Rotate the model any amount around the centre of its base while keeping it
upright. Rotation does not count toward the distance moved.

### Ending a Move

After all models the player wants to move have been set up or moved, validate
the complete unit. If the unit is on the battlefield, it must be in coherency;
no model may be on another model or partway through a terrain surface such as a
wall or ceiling; and all After Moving conditions for the move type must be met.

If any required condition fails, the unit cannot make that move and every model
is returned to its position at the start of that move. Otherwise, resolve the
move type's additional After Moving rules and end the move.

The UI may preserve the attempted path and typed validation errors as
interaction state so it can show an invalid-move popup and offer Retry. The
authoritative BattleState must still restore the unit's start-of-move positions
and movement allowances when the move fails; the attempted invalid placement is
never committed as legal game state.

## Move Units workflow

1. Select one friendly unit not yet selected to move.
2. Create a unit-level checkpoint and lock that unit as active.
3. Show the movement popup with eligible move types.
4. Resolve the selected move type.
5. Complete the entire unit before selecting another unit.

The popup includes Normal Move, Advance, Fall Back, and Remain Stationary when
eligible. Disembark appears only for a Transport with eligible passengers.
Ingress is a separate Strategic Reserves arrival flow for units entering from
off the battlefield.

## Move types

- Remain Stationary: any unit; no model moves or rotates, and start/end move
  triggers do not occur.
- Normal Move: battlefield and unengaged; maximum distance is M; ends
  unengaged.
- Advance Move: battlefield and unengaged; M plus 1D6; ends unengaged and cannot
  Charge or start an action for the rest of the turn.
- Fall Back Move: engaged units; maximum distance M. Ordered Retreat is available
  when not Battle-shocked. Desperate Escape is mandatory when Battle-shocked,
  requires a Hazard roll per model, permits crossing enemy models, and ends with
  the unit unengaged. The unit cannot shoot, Charge, or start an action for the
  rest of the turn.
- Embark: once the First Battle Round has started, a friendly unit may embark
  within a friendly Transport after making a Normal, Advance, or Fall Back Move
  if every model is within 3" of the Transport, the unit was not set up on the
  battlefield this turn, the Transport's datasheet allows the unit to embark,
  and the Transport has sufficient remaining capacity for every model. Remove
  the unit from the battlefield and record it as embarked within that Transport.
- Disembark Move: only eligible units embarked in a battlefield Transport;
  Rapid/Tactical setup distance is 3" and Combat is 6". Rapid is mandatory after
  a Transport Normal or Ingress Move; Tactical follows with a Normal or Advance
  Move; Combat requests shared Hazard Rolls, may allow engagement with units engaging
  the Transport, makes the unit Battle-shocked, and prevents Charge.
- Ingress Move: Strategic Reserves units, excluding passengers in Transports
  that are themselves in Strategic Reserves; set up within 6" of battlefield
  edges and more than 8" horizontally from enemies, with the pre-Third Battle
  Round deployment-zone restriction.

### Deep Strike

When a unit makes an Ingress Move, if every model in that unit has Deep Strike,
the unit may be set up anywhere on the battlefield that is more than 8"
horizontally from every enemy unit. This overrides the ordinary battlefield-edge
and opponent-deployment-zone placement restrictions for that Ingress Move.

Deep Strike is checked for the complete unit. A unit cannot use the override if
even one model lacks the ability.

Rapid Ingress is documented as a Stratagem in
[EVENTS_AND_TRIGGERS.md](../../EVENTS_AND_TRIGGERS.md). It creates an Ingress
Move request at the end of the opponent's Movement phase rather than appearing
as a normal Move Units option.

## Scouts

Scouts are resolved during the Resolve Pre-battle Abilities step. The ability
takes the form Scouts X". If every model in a unit has the ability, choose one
of the following:

- If the unit is in Strategic Reserves, set it up anywhere wholly within your
  deployment zone.
- If the unit is wholly within your deployment zone, it can make a Scout Move.
- If the unit is embarked within a Dedicated Transport that is wholly within
  your deployment zone, and every model embarked within that Transport has
  Scouts, the Dedicated Transport can make a Scout Move.

### Scout Move

```text
Maximum distance:
  - The X" value in Scouts X".

Eligible if:
  - It is the Resolve Pre-battle Abilities step.
  - The unit is wholly within your deployment zone.

Effect:
  - The unit moves as described in the shared Moving rules.

After moving:
  - The unit must be more than 8" horizontally from every enemy unit.
```

The pre-battle ability step owns Scouts eligibility and the choice between
Strategic Reserves setup and Scout Move. The movement validator owns the Scout
Move geometry and final placement; Scout Move does not become a normal Move
Units selection.

## Arriving from Strategic Reserves

To arrive on the battlefield, each Strategic Reserves unit must make an Ingress
Move. Unless otherwise stated, a Strategic Reserves unit can make that Ingress
Move only from the Second Battle Round onward.

The Ingress Move is a placement action, not ordinary model movement. Its 6"
edge distance, more-than-8" horizontal enemy distance, pre-Third Battle Round
deployment-zone restriction, and post-arrival move restriction all apply.

At the end of the Third Battle Round, unless otherwise stated, Strategic
Reserves units that have not made one or more Ingress Moves are destroyed. This
does not apply to:

- Units embarked within Transports that have made an Ingress Move during the
  battle.
- Repositioned Units.

Emergency Disembark is a Transport-destroyed event response: 6" setup, Hazard
Roll per model, closest-possible placement, destroy models that cannot be set
up, then Battle-shock the unit and prevent Charge. Surge Move is a rule-triggered
response with the granting rule's distance; it targets the closest enemy unit,
must engage it if possible, and cannot engage another enemy unit.

## Interaction and validation

Default drag mode permits visual passage through terrain and models, but tracks
the path and validates it on release. Shift collision mode blocks terrain/model
collisions during the drag and may be toggled while dragging. Both modes cap
movement by typed remaining distance and apply move-type engagement stops.

Models may temporarily be out of coherency while a unit is being moved. They
are highlighted but not blocked. Coherency is authoritative only when the
entire unit is finalized. If invalid, the unit remains locked and the Movement
popup beside the affected unit/model shows errors; Retry calls Undo to restore
the unit checkpoint.

Disembark uses model placement rather than ordinary movement distance. A
Transport popup lists passenger units and model counts. After selecting a
passenger, its models are draggable placement items; each endpoint must satisfy
the mode's setup distance, and coherency is checked after all models are placed.

Hazard Rolls are shared resolution mechanics. Movement supplies the requests for
Desperate Escape, Combat Disembark, and Emergency Disembark, while other phases
or rules may request Hazard Rolls for their own effects. The requesting phase or
event owns timing and consequences; the shared Hazard Roll service owns dice
input and typed results.

Strategic Reserves selection occurs before battle during Declare Battle
Formations. Fortifications are excluded, and the combined reserve value cannot
exceed 50% of the battle-size points limit, including passengers in reserve
Transports.

## Repositioned Units

Some rules remove a unit from the battlefield and place it in Strategic Reserves
during the battle. These are Repositioned Units. In addition to the rule that
allows the repositioning and any arrival restrictions, the following apply:

- If repositioning occurs in the Movement phase, the rule may be used on a unit
  that has already moved that phase.
- If a Repositioned Unit is set up in the same turn in which it made an Advance,
  Fall Back, or Disembark Move, it retains that move history for the turn.
- Effects with a specified duration or specified circumstances continue while
  those conditions remain applicable, even while the unit is off the
  battlefield.

Effects must be classified by their typed condition when the unit returns. For
example, an aura requiring the unit to be within range is reevaluated at the
new position, while Battle-shock persists if its duration/condition still
applies when the unit makes an Ingress Move.

Repositioning and later arrival must therefore preserve typed movement history,
status effects, and Strategic Reserves identity. They must not reset or infer
those values from the movement log.

## Flying Models

Models with the FLY keyword, and units containing such models, can FLY. Each
time a FLYING unit is selected to make a Normal, Advance, Fall Back, or Charge
Move, before any model in that unit moves, the active player may declare that
the unit will take to the skies.

While resolving a move declared as taking to the skies:

- Subtract 2" from the move's maximum distance.
- Ignore all vertical distance when determining how far each FLYING model has
  moved.
- Each FLYING model may move through all types of model, including enemy models
  and MONSTER/VEHICLE models.
- Each FLYING model may move horizontally and vertically through all categories
  of terrain feature.

Taking to the skies is a typed declaration attached to the specific move. The
Movement or Charge step applies the adjusted distance and path permissions; it
must not globally change the model's collision or distance behavior for later
moves.

See [PHASE_SEPARATION.md](../../PHASE_SEPARATION.md) for the full architecture,
undo, popup, and cross-phase ownership rules.

## Movement UI TODOs

- Design the Embark interaction popup and determine whether it belongs in the
  Start Unit Move popup, a Transport-anchored popup, or a separate placement
  interaction.
- Define how the UI displays eligible Transports, capacity, and datasheet
  restrictions without moving those rules into React.
- Define Undo and popup restoration behavior for an Embark action.

Aircraft rules that cross Deployment, Movement, Shooting, Charge, and Fight are
maintained in [AIRCRAFT.md](./AIRCRAFT.md). Cross-phase coherency rules are
maintained in [COHERENCY.md](./COHERENCY.md). Terrain placement and category
rules are maintained in [TERRAIN.md](./TERRAIN.md).
