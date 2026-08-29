# Phase Separation Architecture

## Purpose

This document defines the boundary between battle phases. It is the working
architecture for future refactors and phase-rule changes.

## Documentation map

This document is the architecture and ownership index. Detailed specifications
are maintained separately:

- [11e/TURN_AND_PHASES.md](./rules/11e/TURN_AND_PHASES.md) — turn and phase step rules.
- [11e/MOVEMENT.md](./rules/11e/MOVEMENT.md) — Movement rules and interaction behavior.
- [AI_AND_CONTROLLERS.md](./AI_AND_CONTROLLERS.md) — human, AI, and AI-vs-AI control.
- [EVENTS_AND_TRIGGERS.md](./EVENTS_AND_TRIGGERS.md) — event-driven rules and reactions.
- [UNDO_AND_TIMELINE.md](./UNDO_AND_TIMELINE.md) — undo, replay, checkpoints, and popup state.

## Battle Round versus Player Turn

The seven documented turn phases belong to the Player Turns portion of a
larger Battle Round state machine. A Battle Round is resolved in this order:

Deployment is resolved before the first Battle Round and is a separate
pre-battle workflow. It establishes battlefield positions, Strategic Reserves,
Transport passengers, pre-battle abilities, and the first-player context; it
does not count as a Player Turn phase.

Deployment order is determined by a D6 roll; the winner chooses who deploys
first. Players alternate deploying units and deciding reserve/Transport state,
with the remaining player continuing alone if the other has no units left. Once
deployment is complete, the players roll for the first turn; the winner must go
first. Scouts and other Pre-battle Abilities resolve after that roll and before
the first Battle Round begins.

```text
Battle Round
  1. Start of Battle Round
  2. Player Turns
       - Start of Turn
       - Command
       - Movement
       - Shooting
       - Charge
       - Fight
       - End of Turn
  3. End of Battle Round
```

Battle-round state owns rules that occur before both player turns, rules that
advance or identify the current player turn, and rules that occur after both
player turns. A player-turn phase must not absorb Start-of-Battle-Round or
End-of-Battle-Round logic merely because it is the first or last phase it sees.

Battle Round boundary steps:

- Start of Battle Round: resolve rules triggered at the start of the Battle
  Round before progressing to Player Turns.
- End of Battle Round: first resolve non-mission rules triggered at the end of
  the Battle Round, then both players consult their mission and resolve any
  mission aspects triggered at that point.
- After End of Battle Round resolution, the Battle Round ends. Unless the
  mission says the battle has ended, begin the next Battle Round. The mission
  determines how many Battle Rounds the battle lasts.

The central rule is:

> A phase owns its eligibility, sequencing, substeps, completion rules, and UI
> action visibility. Shared code may provide reusable mechanics or presentation,
> but it must not decide when another phase's actions or popups appear.

## Rules edition policy

This rewrite targets 11th edition only. Older-edition behavior is out of scope
and must not constrain the new phase workflow, popup contracts, AI actions, or
state-machine design. Any legacy compatibility that remains in the current
code is migration residue, not a requirement for the target architecture.

The engine should keep a future edition boundary so a later edition can be
introduced without replacing the UI or controller layer:

```text
Shared engine interfaces
  -> versioned edition ruleset
    -> phase handlers and rule definitions
      -> typed state/actions/events/results
        -> human UI or AI controller
```

When 12th edition becomes available, it should be added as a new versioned
ruleset with explicit differences in phase timing, eligibility, effects, and
data definitions. Edition-specific behavior belongs behind `RulesEdition` or
equivalent rule providers; the UI must not branch on edition-specific rule
text, and the AI must consume the versioned legal-action interface. State and
timeline serialization should carry a ruleset identifier and schema version so
11th-edition battles remain replayable and future migrations are explicit.

## Phase objects without classes

The phase boundary does not require class-based object-oriented code. A phase may
be represented by a typed plain object returned from a factory function, or by a
set of typed pure functions composed into that object:

```ts
type FightPhase = {
  getPopupState(selection: Selection): FightPopupState | null;
  getLegalActions(): GameAction[];
  applyAction(action: GameAction): BattleState;
  isComplete(): boolean;
};

function createFightPhase(state: BattleState, rules: RulesEdition): FightPhase {
  return {
    getPopupState: selection => getFightPopupState(state, rules, selection),
    getLegalActions: () => getFightLegalActions(state, rules),
    applyAction: action => applyFightAction(state, rules, action),
    isComplete: () => isFightComplete(state, rules),
  };
}
```

The returned value is an object even though no class is used. The factory may
close over immutable state and rules, while action functions return a new
`BattleState` rather than mutating the phase object. This matches the existing
functional style of simulator-core and keeps phase behavior easy to test.

## Step-level isolation

Each phase is itself a sequence of independently owned steps. The canonical
high-level step lists are:

```text
Start of Turn step
  1. Start of Turn

Command phase
  1. Start of Command phase
  2. Gain Command points
  3. Battle-shock
  4. Command abilities
  5. End of Command phase

Movement phase
  1. Start of Movement phase
  2. Move Units
  3. End of Movement phase

Shooting phase
  1. Start of Shooting phase
  2. Shoot
  3. End of Shooting phase

Charge phase
  1. Start of Charge phase
  2. Charge
  3. End of Charge phase

Fight phase
  1. Start of Fight phase
  2. Pile In
  3. Fight
  4. Consolidate
  5. End of Fight phase

End of Turn step
  1. End of Turn
```

The Command phase owns the Battle-shock step, but Battle-shock resolution is a
shared event-driven mechanic. Abilities and other rules may create a
Battle-shock request from any phase or step. Start of Turn and End of Turn are
their own top-level turn-boundary phases/steps and must have isolated state and
completion logic. The current code contains legacy `BattleState.phase` values
for `battle-shock` and `end`; those should be migrated to the appropriate
Command or End of Turn boundary rather than used to introduce shared popup or
eligibility logic.

Emergency Disembark and Surge Move follow the same event-driven pattern. A
Transport-destroyed event or granting rule creates a typed pending movement
request, and the current phase/step resolves that request. Neither response is
a normal Movement-phase move selection.

These are phase-owned step sequences, not one shared universal step machine.
The rules-required details remain nested inside the owning step. Examples:

- Movement contains its Reinforcements/Move Units substeps where required.
- Pile In contains player ordering and per-unit Pile In actions.
- Fight contains Fights First priority, normal fight selection, attack
  resolution, damage allocation, and Fight-on-Death opportunities.
- Consolidate contains per-unit Consolidation and newly engaged enemy fight
  opportunities.
- Start and End steps contain timing effects specific to their own phase.

Those nested details do not become shared eligibility checks. They remain
internal to their parent phase step.

The same structure applies to every phase, but each phase has its own ordered
step list. A step is not merely a label. It owns:

- Its entry and exit behavior
- Its eligibility checks
- Its legal actions
- Its pending selections and results
- Its popup/action state
- Its completion predicate
- Its transition to the next step

Steps must not inspect or reuse another step's popup predicates, pending action
state, or completion checks. A step may consume a typed result or state produced
by an earlier step, but it must not silently take ownership of that step's rules.

For example:

```ts
type PhaseStep<TStepId extends string> = {
  id: TStepId;
  enter(state: BattleState): BattleState;
  getPopupState(selection: Selection): PopupState | null;
  getLegalActions(): GameAction[];
  applyAction(action: GameAction): BattleState;
  isComplete(): boolean;
  exit(state: BattleState): BattleState;
};

type CommandStepId =
  | 'start-command'
  | 'gain-command-points'
  | 'battle-shock'
  | 'command-abilities'
  | 'end-command';
```

A phase factory composes its own steps:

```ts
function createCommandPhase(state: BattleState, rules: RulesEdition) {
  const steps = createCommandSteps(state, rules);
  return {
    steps,
    currentStep: steps.find(step => step.id === state.commandStep),
    advance: () => advanceCommandStep(state, rules),
  };
}
```

The phase transition system may move from one step object to the next, and typed
state/results may be passed between steps. That transfer is an explicit data
boundary; it is not permission for the receiving step to run the sending step's
checks.

## Reuse versus rewrite decision

The current repository should use a staged rewrite of orchestration, not a
blanket rewrite of the simulator. The existing rules and geometry are valuable
and already have broad test coverage, while the workflow boundary is too
centralized to refactor safely one condition at a time.

Reuse and protect:

- Army/data parsers and ruleset data.
- Typed `BattleState`, unit/model profiles, terrain, objectives, and mission
  data.
- Dice, geometry, terrain measurements, base footprints, line of sight,
  coherency, damage, and other phase-neutral mechanics.
- Existing movement pathing and combat calculations after their inputs and
  outputs are given explicit boundaries.
- The typed `GameAction` union, timeline snapshots, replay/undo foundations,
  legal-action concepts, and controller interfaces.
- Existing scenario and rules tests, expanding them around each new phase step.

Refactor or replace in stages:

- The large `simulator.ts` facade should become phase-specific modules with a
  small compatibility facade during migration.
- The large `manualCombat.ts` and `interactiveMovement.ts` files should be
  split by phase step and rule responsibility, while retaining their tested
  low-level calculations.
- The current phase state machine should be replaced with the documented
  Start of Turn, Command, Movement, Shooting, Charge, Fight, and End of Turn
  step workflow. Legacy Battle-shock and End phase values should be migrated.
- `applyGameAction` should remain the single action boundary initially, then
  delegate to phase-owned action handlers instead of containing one growing
  cross-phase dispatcher.
- The large React `App.tsx` and UI hooks should become a thin session/controller
  layer. Phase-owned selectors and popup view models should move toward core
  phase services so AI can use them without React.
- Popup-local UI state that affects legality or undo should move into typed
  phase interaction state. Pure visual preferences may remain in React.

This approach preserves working rules while replacing the parts most likely to
cause cross-phase popup and eligibility bugs. A full rewrite is justified only
for a specific workflow module after its replacement has equivalent typed
actions, undo behavior, replay behavior, and regression tests.

## Player and AI control

The rules engine must be player-agnostic. A phase step exposes typed legal
actions, pending choices, and resulting state transitions; it must not assume
that the action came from a human UI.

Each side is assigned a controller:

```ts
type PlayerController =
  | { kind: 'human' }
  | { kind: 'ai'; policyId: string; difficulty?: string };

type GameMode =
  | 'human-vs-human'
  | 'human-vs-ai'
  | 'ai-vs-ai';
```

The same phase workflow and validation must support all modes:

- Human vs AI: the user controls one side and an AI controller selects actions
  for the opponent.
- AI vs AI: both sides use controllers and the simulation can run at an
  accelerated pace without rendering or waiting for UI input.
- Human assistance: an AI can inspect the current typed state and legal actions
  and return suggestions without applying an action.

AI control must use the same `getLegalActions`, typed popup/pending-action state,
and `applyAction` interfaces exposed to the UI. The AI must not call UI handlers,
inspect popup text, parse logs, or bypass phase validation. This keeps human and
AI play subject to identical rules and makes AI-vs-AI results useful for
training, evaluation, regression tests, and balance experiments.

The simulation runner should support configurable pacing and output modes:

- Interactive mode pauses for human controllers and renders phase-owned UI.
- Fast mode resolves AI choices immediately and minimizes presentation work.
- Suggestion mode evaluates legal actions and returns recommendations,
  explanations, and optional outcome scores without mutating the battle state.

Controller decisions, random inputs, trigger resolutions, and resulting typed
events must remain deterministic/replayable when supplied the same seed and
state. Undo and replay must work regardless of whether the last action came
from a human controller or an AI controller.

This structure is specifically intended to make popup bugs traceable:

```text
current phase
  -> current step
    -> step-owned eligibility
      -> step-owned popup state
        -> shared presentation component
```

There should be no global popup predicate that combines actions from multiple
steps or phases.

## Authoritative step lists

The existing rules documents provide a useful starting point for identifying
steps, but the implementation needs an explicit ordered step list for each phase.
The desired lists should be confirmed against the authoritative rules source,
especially where player choices, interrupts, or optional actions affect when a
step is considered complete.

Once confirmed, each list should become a typed phase definition and should be
used by the state machine, legal-action generation, manual play UI, simulation,
replay, and tests.

## Phase specification format

Before refactoring a phase, document its behavior using the same structure:

```text
Phase: <name>

Entry conditions:
  - What starts this phase?
  - Which player/side owns it?
  - What state is initialized or cleared?

Steps, in order:
  1. <step name>
     - Entry behavior:
     - Eligible units/actions:
     - Player choices:
     - Pending state/results:
     - Popup/action state:
     - Completion condition:
     - Exit behavior:

  2. <step name>
     ...

Phase completion:
  - Conditions that allow the phase to end:
  - Conditions that block advancement:
  - State passed to the next phase:

Cross-boundary data:
  - Typed state/results/events received:
  - Typed state/results/events emitted:

Isolation rules:
  - Checks owned exclusively by this phase:
  - Shared services used without importing another phase's workflow:
```

Each phase specification should also define its UI contract independently:

```ts
type PhasePopupState = {
  phase: Phase;
  step: string;
  selectedUnitId: string | null;
  availableActions: GameAction[];
  pendingAction?: PendingAction;
  message?: string;
  presentation: {
    component: 'combat-panel' | 'movement-popup' | 'phase-popup';
    anchor: 'unit' | 'model' | 'screen' | 'objective';
    size: 'compact' | 'standard' | 'wide' | 'custom';
  };
};
```

Popup sizing and layout are chosen by the owning phase step based on the
content. There is no single popup size shared across all phases. Fight and
Shooting continue to use the reusable `CombatPanel` presentation, while
Movement, Charge, Command, and other steps may use appropriately sized,
phase-specific popups. Shared shells and styling helpers may be reused, but
they must not impose one universal size or decide when a popup is visible.

## Specification workflow

The phase specifications will be completed in conversation, one phase at a
time. The user-provided rules and intended simulator behavior are authoritative;
existing code is evidence of current behavior, not the desired specification.

For each phase, first agree on the ordered steps and rules. Only after that
should implementation work begin. Refactor work must link its code changes back
to the relevant phase and step in this document.

## Start of Turn specification

Current scope is intentionally minimal because missions and abilities are not
implemented yet.

```text
Phase: Start of Turn

Steps:
  1. Resolve start-of-turn rules
     - Resolve rules that trigger at the start of the turn.
     - No mission or ability-specific behavior is defined yet.
     - No phase from the current turn may run its own start-of-turn checks here.
     - The step completes after all currently implemented start-of-turn rules
       have resolved.

Phase completion:
  - The Start of Turn rules window has been resolved.
  - Advance to the Command phase.
```

Future mission and ability behavior must be added to this phase's step through
typed effects/actions. It must not be implemented as a global start-of-turn
check shared by every phase.

## Command phase specification

The Command phase is owned by the active player, with some steps deliberately
resolving effects for both players.

```text
Phase: Command

1. Start of Command phase
   - Open the Command / start-of-phase timing window.
   - Query the event/trigger registry for rules registered for this window.
   - Resolve matching automatic triggers and expose any required choices.
   - Complete after all triggers for this window are resolved.

2. Gain Core CP
   - Both players gain 1 Command point.
   - This is its own step and timing window.
   - Rules triggered by gaining Core CP resolve here, not in Start of Command
     or Command abilities.
   - Complete after both players have gained the point and related triggers
     have resolved.

3. Battle-shock
   - Evaluate the active player's army and register a Battle-shock request for
     each unit that meets either condition:
       - The unit is currently Battle-shocked.
       - The unit is at or below half-strength.
   - Resolve those requests through the shared, typed Battle-shock mechanic.
   - If a unit was Battle-shocked at the start of this step and succeeds on its
     Battle-shock roll, it is no longer Battle-shocked.
   - Battle-shock rolls and their results are typed state/results, not log text.
   - Rules triggered by Battle-shock rolls resolve through the current timing
     window, with this step owning the Command-phase requests and completion.
   - Complete after all requests, rolls, effects, and choices are resolved.

4. Command abilities
   - Open the Command-phase ability timing window.
   - Resolve rules triggered in the Command phase except rules specifically
     triggered at the start or end of the phase, by gaining Core CP, or by
     Battle-shock rolls.
   - Army rules with Command-phase timing are registered in this window as
     typed triggers. For example, the Ork Waaagh! rule can be exposed here for
     its required player choice and resolution.
   - Ability, army-rule, and eligible Stratagem choices and effects belong to
     this step.
   - Complete after all required triggers, effects, and choices are resolved.

5. End of Command phase
   - Open the Command / end-of-phase timing window.
   - First resolve rules triggered at this point other than mission rules.
   - Then both players consult their mission.
   - If one or both players achieved mission aspects triggered at this point,
     resolve those mission rules now.
   - Mission resolution occurs after non-mission end-of-phase rules.
   - Complete after both players' applicable mission rules and all resulting
     choices/effects are resolved.

Phase completion:
   - All five Command steps are complete.
   - Advance to the Movement phase.
```

Command timing windows are distinct even when the same ability or mission
service evaluates them:

```text
start-of-command
gain-core-cp
battle-shock-roll
command-abilities
end-of-command-non-mission
end-of-command-mission
```

No Command step may resolve a trigger belonging to another Command timing
window merely because the source rule is generally described as a Command-phase
rule.

Abilities, army rules, and stratagems may register trigger definitions for
these windows. Registration is explicit and does not transfer ownership of the
phase step:
Registration is explicit and does not transfer ownership of the phase step:

```ts
abilityRegistry.register({
  id: 'example-command-ability',
  source: 'ability',
  phase: 'command',
  step: 'command-abilities',
  timing: 'before-actions',
  matches: (state, event) => /* typed condition */ true,
  createTrigger: (state, event) => /* typed effect or choice */ trigger,
});

stratagemRegistry.register({
  id: 'example-end-command-stratagem',
  source: 'stratagem',
  phase: 'command',
  step: 'end-of-command',
  timing: 'on-enter',
  matches: (state, event) => /* typed condition */ true,
  createTrigger: (state, event) => /* typed effect or choice */ trigger,
});
```

Passive abilities can be registered when the battle state is created or when
the relevant rule becomes active. A stratagem normally becomes eligible only
after its player legally uses it; that use creates or activates the appropriate
typed trigger definition and records the use in state/events. The Command phase
still queries and resolves the resulting trigger at the correct Command step.

This distinction applies to every phase:

```text
Rule source registers/activates a trigger definition
  -> phase step opens its timing window
      -> that step queries matching ability/army-rule/stratagem/mission triggers
      -> that step resolves the trigger or exposes its choice
```

Army-rule trigger definitions should include the army or faction source, the
exact phase and step timing, any once-per-battle or player eligibility
condition, and the typed effect or choice to resolve. A phase must query and
resolve only triggers belonging to its current timing window; it must not search
for army-rule text globally or infer timing from log messages.

No ability, army rule, stratagem, or mission may directly open a popup, advance
a phase, or resolve an action belonging to another phase.

## Same-phase registration and resolution

A trigger does not need to be registered before its phase begins. A rule may
become active and trigger during the same phase and step. This is expected for
combat abilities and other effects created by an action being resolved.

```text
Fight step action resolves
  -> combat ability becomes active
    -> ability registers a Fight / after-action trigger
      -> Fight step queries the registry again
        -> trigger resolves immediately or becomes a Fight-owned choice
```

The registry therefore needs to support registration during an open timing
window. The phase step should evaluate triggers until the current window is
settled, while preventing duplicate resolution through stable trigger identity.

Registration, triggering, and resolution remain separate concepts:

- **Registration**: the rule definition becomes available to the registry.
- **Triggering**: the definition's typed condition matches the current state or
  event in its declared window.
- **Resolution**: the owning phase applies the typed effect or exposes the
  phase-owned choice.

An ability can complete all three in one phase or step without bypassing the
phase boundary.

## Movement phase specification

The Movement phase is owned by the active player. Its rules are divided into
three isolated steps:

```text
Phase: Movement

1. Start of Movement phase
   - Open the Movement / start-of-phase timing window.
   - Query and resolve rules triggered at the start of the Movement phase.
   - Complete after all matching triggers and choices are resolved.

2. Move Units
   - The active player moves units one at a time.
   - Continue until all of the active player's units have been selected to move
     and those moves have ended.

   Internal Move Units sequence for each unit:

   a. Select Unit
      - Select one friendly unit that has not been selected to move this phase.
      - The unit may be on the battlefield, in Strategic Reserves, or embarked
        within a Transport.
      - The selected unit becomes the active movement unit.

   b. Start Unit Move
      - Create a unit-level movement checkpoint containing every model's
        position, rotation, movement allowance, and relevant movement state.
      - Mark this unit as the active movement unit and lock selection to it
        until its move is finalized.
      - Open the Movement-owned start-move popup for this unit, anchored to the
        unit and sized for movement controls.
      - The popup includes these options when the unit is eligible: Normal Move,
        Advance, Fall Back, and Remain Stationary.
      - Selecting Advance performs the Advance roll, updates the unit's movement
        allowance and restrictions, and continues into model movement.
      - Disembark appears only when the selected unit is a Transport with one or
        more eligible units embarked within it. It opens the passenger selection
        and disembark workflow rather than moving the Transport itself.
      - Ingress is not shown in this popup. It is a separate Strategic Reserves
        placement flow for units arriving from off the battlefield.
      - The popup remains the source of truth for the active unit and its
        checkpoint; it is not reconstructed from log text.

   c. Select Move Type
      - Select one move type the unit is eligible to make.
      - Resolve that move type with the selected unit.
      - Available move types include:
          - Remain stationary
          - Normal move
          - Advance move
          - Fall-back move
          - Disembark move
          - Ingress move
        - Additional move types may be provided by other rules.
      - Resolve move-specific triggers and choices within the Move Units step.
      - The unit's move must end before another unit is selected.

   - Complete after every eligible active-player unit has been selected to move
     and each selected move has ended.

3. End of Movement phase
   - Open the Movement / end-of-phase timing window.
   - Query and resolve rules triggered at the end of the Movement phase.
   - Complete after all matching triggers and choices are resolved.

Phase completion:
   - All three Movement steps are complete.
   - Advance to the Shooting phase.
```

The Move Units step owns movement selection and movement popup state. A move
type may use shared geometry, terrain, transport, reserve, or coherency
services, but those services do not decide which Movement popup is visible.

### Disembark interaction workflow

Disembark uses a placement workflow rather than ordinary model movement:

```text
Select Transport
  -> open a Transport-anchored passenger popup
  -> show each embarked unit and its model count
  -> select one passenger unit to disembark
  -> lock the Transport/passenger interaction to that unit
  -> select the required disembark mode
  -> show the unit's models as draggable placement items
  -> drag each model onto the battlefield
  -> validate each endpoint against the setup distance
  -> validate the complete unit's coherency
  -> complete disembark and unlock the Transport
```

The passenger popup is owned by the Movement / Disembark workflow and is sized
for the number of embarked units it displays. Selecting a passenger creates the
unit-level disembark interaction state and prevents selecting another unit or
moving the Transport until every model in that passenger unit has been placed
and the disembark action is complete.

Disembark placement itself does not use a per-model drag-distance allowance and
does not require the models to follow an ordinary movement path. However, the
passenger unit's movement opportunity must be consumed when the rules require
it—for example, when the Transport has already moved, disembarking consumes the
unit's normal movement rather than allowing a separate later move. This must be
recorded as typed movement state, not inferred from the Transport's log.

Each model may be placed anywhere that satisfies the selected mode's setup
distance and other mode-specific setup rules. The model's placement is
validated when it is released, and the entire unit's coherency is checked only
when all models have been placed. An invalid final coherency result keeps the
disembark interaction locked and can be retried through the unit-level Undo
checkpoint.

## Shooting phase specification

The Shooting phase is owned by the active player. Its rules are divided into
three isolated steps:

```text
Phase: Shooting

1. Start of Shooting phase
   - Open the Shooting / start-of-phase timing window.
   - Query and resolve rules triggered at the start of the Shooting phase.
   - Complete after all matching triggers and choices are resolved.

2. Shoot
   - The active player shoots with eligible units one at a time.
   - Continue until all units the active player chooses to shoot with have been
     selected to shoot and their attacks have been resolved.
   - A unit is eligible to shoot if it is on the battlefield and has not already
     been selected to shoot this phase.

   Internal Shoot sequence for each unit:

   a. Select Unit
      - Select one friendly unit that is eligible to shoot.
      - The unit becomes the active shooting unit.

   b. Select Shooting Type
      - Select one shooting type the unit is eligible to make.
      - Resolve that shooting type with the selected unit.
      - Available shooting types include:
          - Normal shooting
          - Assault shooting
          - Close-quarters shooting
          - Indirect shooting
        - Additional shooting types may be provided by other rules.
      - Resolve shooting-specific triggers, attacks, results, damage choices,
        and other pending effects within the Shoot step.
      - The selected unit's attacks must be resolved before another unit is
        selected.

   - Complete after all units the active player chooses to shoot with have been
     selected and their attacks have been resolved.

3. End of Shooting phase
   - Open the Shooting / end-of-phase timing window.
   - Query and resolve rules triggered at the end of the Shooting phase.
   - Complete after all matching triggers and choices are resolved.

Phase completion:
   - All three Shooting steps are complete.
   - Advance to the Charge phase.
```

The Shoot step owns shooter selection, shooting-type selection, target and
weapon choices, and shooting popup state. It may use shared combat, dice,
terrain, line-of-sight, and damage services, but those services do not decide
which Shooting popup is visible.

## Charge phase specification

The Charge phase is owned by the active player. Its rules are divided into
three isolated steps:

```text
Phase: Charge

1. Start of Charge phase
   - Open the Charge / start-of-phase timing window.
   - Query and resolve rules triggered at the start of the Charge phase.
   - Complete after all matching triggers and choices are resolved.

2. Charge
   - The active player resolves charges with eligible units one at a time.
   - Continue until all units the active player chooses to charge with have
     declared a charge and those charges have been resolved.

   Internal Charge sequence for each unit:

   a. Declare Charge
      - Select one friendly unit that has not declared a charge this phase and
        is eligible to declare a charge.
      - A unit is eligible if it is on the battlefield, unless another rule
        states otherwise.
       - A unit is not eligible when any of these restrictions apply:
         - It is not within 12 inches of one or more enemy units.
         - It is engaged.
         - It made an Advance or Fall Back move this turn.
         - It made a Rapid, Combat, or Emergency Disembark this turn.
       - Tactical Disembark does not itself prevent a Charge. The unit may
         make a Normal Move after Tactical Disembark and then declare a Charge;
         choosing an Advance Move still applies the normal Advance restriction.
      - Resolve declaration-specific triggers and choices.

   b. Make Charge Roll
      - Roll 2D6.
      - The result is the maximum distance for the charge move.
      - Resolve charge-roll triggers and effects.

   c. Attempt Charge
      - If it is possible to make a charge move and the player still wants to,
        make the charge move with the unit.
      - Otherwise, the unit does not make a charge move.
      - In either case, the charge is then resolved.
      - Resolve charge movement, charge results, and any resulting triggers or
        pending choices before another unit is selected.

   - Complete after all units the active player chooses to charge with have
     declared and resolved their charges.

3. End of Charge phase
   - Open the Charge / end-of-phase timing window.
   - Query and resolve rules triggered at the end of the Charge phase.
   - Complete after all matching triggers and choices are resolved.

Phase completion:
   - All three Charge steps are complete.
   - Advance to the Fight phase.
```

The Charge step owns charger selection, charge declaration, charge-roll state,
charge movement, and charge popup state. It may use shared geometry, movement,
dice, terrain, and event services, but those services do not decide which
Charge popup is visible.

## Fight phase specification

The Fight phase contains five isolated steps. The Fight step has its own
priority substates, and Consolidation is a hard boundary after which no further
normal fights may begin.

```text
Phase: Fight

1. Start of Fight phase
   - Open the Fight / start-of-phase timing window.
   - Query and resolve rules triggered at the start of the Fight phase.
   - Complete after all matching triggers and choices are resolved.

2. Pile In
   - Both players make Pile In moves with eligible units they choose to move.
   - The player whose turn it is resolves all of their chosen moves first.
   - The opponent then resolves all of their chosen moves.
   - Each unit may make no more than one Pile In move during this step.
   - The Pile In step owns its own eligibility, movement rules, popup state,
     and completion checks.

3. Fight
   - A unit is eligible to fight if it has not already been selected to fight
     this phase and at least one of these conditions applies:
       - It is engaged, or was engaged at the start of the Fight step.
       - It made a charge move this turn.
   - Continue until all eligible units have been selected to fight and their
     attacks have been resolved.

   Internal Fight sequence:

   a. Resolve Fights First Combats
      - Starting with the player whose turn it is, players alternate selecting
        one friendly Fights First unit that is eligible to fight.
      - If the current player cannot select one:
          - If no Fights First units remain eligible, move to Resolve Remaining
            Combats, where this player selects next.
          - Otherwise, the other player selects next.

   b. Resolve Remaining Combats
      - Starting with the player who moved onto this substep, players alternate
        selecting one friendly unit eligible to fight.
      - If the current player cannot select one:
          - If no eligible units remain, the Fight step ends.
          - Otherwise, the other player selects next.
      - After resolving a fight, if one or more Fights First units become newly
        eligible, return to Resolve Fights First Combats.

   c. When a unit is selected to fight
      - Select one fight type that unit is eligible to make.
      - Resolve that fight type with the selected unit.
      - Fight types and their detailed rules are specified separately.

   - The Fight step owns Fights First priority, remaining-combat priority,
     eligible-fighter selection, fight-type selection, attack resolution,
     damage choices, and Fight popup state.

4. Consolidate
   - Once the Fight step has ended, no further normal fights may begin.
   - Both players make Consolidation moves with eligible units they choose to
     move.
   - The player whose turn it is resolves all of their chosen moves first.
   - The opponent then resolves all of their chosen moves.
   - Each unit may make no more than one Consolidation move during this step.
   - Engaging Consolidation may create a typed opportunity for an enemy unit to
     fight, according to the Consolidation rules. That reaction is resolved as
     a Fight-owned interrupt without reopening normal Fight selection.
   - The Consolidation step owns its eligibility, movement rules, popup state,
     reaction-fight handling, and completion checks.

5. End of Fight phase
   - Open the Fight / end-of-phase timing window.
   - Query and resolve rules triggered at the end of the Fight phase.
   - Complete after all matching triggers and choices are resolved.

Phase completion:
   - All five Fight steps are complete.
   - Advance to the End of Turn step.
```

The detailed Pile In and Consolidation movement rules remain pending separate
subsections. They must define their own eligibility, model movement, locked
models, target/objective selection, completion, and event timing without
borrowing popup predicates from the other Fight steps.

## End of Turn specification

The End of Turn phase is a separate top-level turn-boundary phase. Its current
specified behavior has two ordered timing windows:

```text
Phase: End of Turn

1. End-of-turn rules
   - Open the End of Turn / non-mission timing window.
   - Resolve rules triggered at the end of the turn other than mission rules.
   - Complete after all matching non-mission triggers and choices are resolved.

2. End-of-turn mission rules
   - Both players consult their mission.
   - If one or both players have achieved mission aspects triggered at this
     point, resolve those mission rules now.
   - Mission rules resolve after the non-mission end-of-turn rules.
   - Complete after all applicable mission rules and resulting choices/effects
     are resolved.

Phase completion:
   - Both End of Turn steps are complete.
   - Apply only the explicitly specified turn transition/cleanup state.
   - Advance to the next Start of Turn step.
```

The End of Turn phase owns its own trigger windows, mission timing, cleanup
decisions, and completion state. It must not reuse the End of Command or End of
Fight popup predicates.

### Shared movement contract

The shared Moving and Set Up mechanics provide geometry only: distance
measurement, model paths, rotation, collision, terrain, coherency, and legal
placement. They must not apply one universal engagement rule.

Movement must also distinguish between path permissions and end-position
permissions. Terrain and collision are evaluated per model, because unit
keywords or other rules may allow a model to move through a terrain feature
while still forbidding it from ending there. A model without that permission
must be blocked by the relevant terrain or collision rule. These permissions
are typed movement capabilities supplied by the unit/model rules and consumed
by the movement validator; they are not global exceptions for the entire unit.

The same distinction applies to other models. A model may pass through another
model during a drag when its movement rules permit it, but it cannot release in
an invalid intersection with another model. Models whose rules do not permit
passing through models must be blocked along the path. Walls, terrain, enemy
models, and other obstacles therefore require two separate checks:

- Path check: whether this model may travel through the obstacle while moving.
- Endpoint check: whether the model's final footprint intersects or violates
  the obstacle after the drag is released.

The endpoint check always applies unless the specific rules explicitly allow an
exception. These checks are per model and must use the model's movement
capabilities and the active move type.

Unit coherency is a separate shared battlefield invariant. It is not owned by
Movement alone and must be checked after any state change that can affect model
relationships, including casualties or removals, movement, Pile In,
Consolidation, Disembark, and other repositioning effects. The owning phase step
decides when the check blocks completion or requires a choice, but the coherency
validator is phase-neutral and must be available to every phase.

For model-by-model movement, coherency is advisory until the entire unit's move
is finalized:

- At the beginning of a unit-level move, capture a typed checkpoint containing
  the complete state of every model in that unit, its movement allowances, and
  the relevant phase-step interaction state.
- During individual model drags, identify and highlight models that are
  temporarily out of coherency, but do not prevent the current model from being
  moved solely for that reason.
- When the unit's movement is finalized, run the authoritative coherency check
  against the complete unit.
- If the final unit is incoherent, keep the unit in an invalid interaction
  state, show the validation popup, and prevent another model or unit from being
  selected.
- `Retry` uses the normal Undo operation to restore the unit-level checkpoint,
  including every model position and movement allowance, then reopens the same
  unit for movement.

The checkpoint is unit-level rather than model-level so the behavior remains
correct for units of different sizes and for moves where several models have
already been repositioned before the coherency failure is discovered. Other
phase steps that reposition multiple models may use the same transaction
pattern, with their own appropriate finalization boundary.

### Movement interaction modes

The movement UI supports two collision-preview modes. Both modes use the same
movement allowance, move-type restrictions, engagement rules, and final
validation.

```text
Default mode
  - Allow the dragged model to pass visually through terrain and models.
  - Track the complete drag path and any obstacles crossed.
  - On release, validate the path and endpoint against the model's capabilities
    and the active move type.
- If invalid, keep the unit/model interaction unresolved and prevent moving
    another model or unit until the player undoes the invalid move and retries.
  - Show a Movement-owned validation popup anchored beside the affected model.
    The popup displays the typed validation errors and provides a `Retry` action
    that dispatches the normal Undo operation.

Shift collision mode
  - While Shift is held, collide the dragged model with terrain and other units.
  - Shift may be pressed or released during the drag.
  - Collision preview changes immediately without changing the movement budget.
```

In both modes:

- The model cannot be dragged beyond its legal remaining movement distance.
- The movement cap is calculated from typed starting position and committed
  movement, not from the visual preview alone.
- Where the active move type requires stopping at engagement, the preview must
  stop the model at the first legal engagement boundary and may not allow it to
  continue past that boundary.
- Where the active move type permits entering or passing through engagement,
  the move-type rules determine the applicable behavior.
- Movement rings remain visible and continue to show the model's movement
  allowance, remaining distance, and other relevant movement boundaries.

Collision mode is a presentation and interaction aid; it never replaces the
release-time rules validator. The default mode must not silently accept an
illegal wall or model crossing, and Shift mode must not make a legal move
illegal merely because the preview is more restrictive than the rules.

The invalid-move popup is part of the Movement step's interaction state, not a
global error popup. Undo restores the pre-drag model position, movement budget,
selection, movement rings, and popup context so the same model is immediately
ready for another attempt.

The interactive movement contract is:

```text
Select unit
  -> lock that unit as the active moving unit
  -> drag one model from its original position
  -> compare the dragged position to that model's starting position
  -> validate path, endpoint, terrain, collision, coherency, and move type
  -> on release, subtract the measured distance from that model's remaining move
  -> allow the same model to continue later with its remaining distance
  -> complete every model in the unit
  -> unlock the unit and allow the next unit to be selected
```

Dragging is measured from the model's position at the start of the unit's move,
rather than repeatedly measuring only from the previous drag release. This lets
the model move around within its remaining allowance instead of restricting it
to a chain of short straight-line segments. The distance used is committed on
release, and the model's remaining distance is preserved in typed state so
later movement cannot exceed the move allowance.
Once any model in a unit has started moving, that unit remains locked as the
active unit until the unit's move is completed. The player cannot move another
unit and return to the first unit during the same Move Units sequence.

Each movement-owning step specifies the unit's allowed engagement transition:

```text
Before movement -> While moving -> After movement
       |                |                |
   eligibility     path/model rules   end-state rules
```

For example, a Normal Move requires the unit to start and end unengaged, while
a Charge may end engaged. Fall Back may begin engaged but must end unengaged,
and Desperate Escape changes which enemy models can be crossed. Pile In and
Consolidation can have their own conditional movement into engagement. These
exceptions belong to the owning move type or Fight substep, not to a shared
`isEngaged` check inside the movement geometry service.

## Movement move types

Move types are owned by the Movement phase's Select Move Type substep. Each move
type has its own eligibility, movement effect, trigger behavior, and completion
rules.

### Remain Stationary

```text
Maximum distance: —

Eligible if:
  - Any unit.

Effect:
  - No models are moved.
  - No models are rotated.
  - The unit remains in its current position and orientation.

Triggers:
  - A unit that remains stationary does not trigger rules that trigger when a
    unit starts a move.
  - A unit that remains stationary does not trigger rules that trigger when a
    unit ends a move.

Completion:
  - Resolve the stationary choice immediately.
  - The Move Units step may select the next unit.
```

### Normal Move

```text
Maximum distance:
  - The unit's M characteristic.

Eligible if:
  - The unit is on the battlefield.
  - The unit is unengaged before moving.

Effect:
  - The unit moves as described in the shared Moving rules.

After moving:
  - The unit must be unengaged.

Completion:
  - The move cannot be completed until the unit satisfies the unengaged
    requirement.
  - After completion, the Move Units step may select the next unit.
```

The Movement phase owns the Normal Move eligibility and completion checks. The
shared Moving rules provide movement geometry and collision/coherency mechanics,
but do not determine whether another move type is available.

### Advance Move

```text
Maximum distance:
  - The unit's M characteristic plus its Advance roll.

Eligible if:
  - The unit is on the battlefield.
  - The unit is unengaged before moving.

Before moving:
  - Make an Advance roll by rolling 1D6.
  - Add the result to the unit's M characteristic to determine maximum distance.

Effect:
  - The unit moves as described in the shared Moving rules.

After moving:
  - The unit must be unengaged.
  - Until the end of the turn, unless otherwise stated, the unit is not eligible
    to declare a charge.
  - Until the end of the turn, unless otherwise stated, the unit is not eligible
    to start an action.

Completion:
  - The move cannot be completed until the unit satisfies the unengaged
    requirement.
  - After completion, the Move Units step may select the next unit.
```

The Advance roll is typed pending state owned by the Advance Move choice. The
Movement phase resolves the roll and applies the resulting restrictions; other
phases consume those restrictions when checking Charge or action eligibility.

### Fall Back Move

```text
Maximum distance:
  - The unit's M characteristic.

Eligible if:
  - The unit is engaged.

Before moving:
  - Select Fall Back mode:
      - Ordered Retreat: available if the unit is not Battle-shocked.
      - Desperate Escape: otherwise mandatory. Make a Hazard roll for each
        model in the unit.

Effect:
  - The unit moves as described in the shared Moving rules.

While moving:
  - Desperate Escape: each model that is moved may move through enemy models.

After moving:
  - The unit must be unengaged.
  - Until the end of the turn, unless otherwise stated, the unit is not eligible
    to shoot, declare a charge, or start an action.
  - Desperate Escape: if the unit is not Battle-shocked, make a Battle-shock
    roll for the unit.

Completion:
  - The move cannot be completed until the unit satisfies the unengaged
    requirement.
  - Required Hazard rolls and the Desperate Escape Battle-shock roll must be
    resolved in their owning movement workflow.
  - After completion, the Move Units step may select the next unit.
```

Fall Back mode, Hazard rolls, and the resulting turn restrictions are owned
by the Movement phase. The Shooting, Charge, and Action phases only consume the
typed restrictions when determining their own eligibility.

### Disembark Move

```text
Set-up distance:
  - Rapid Disembark: 3 inches.
  - Tactical Disembark: 3 inches.
  - Combat Disembark: 6 inches.

Eligible if all of the following apply:
  - The unit is embarked within a Transport on the battlefield.
  - The unit did not embark within that Transport this phase.
  - The Transport has not made an Advance or Fall Back move this phase.

Effect:
  - Set up the unit as described in the shared Set Up rules.

Before moving:
  - Select Disembark mode:
      - Rapid Disembark: mandatory if the Transport made a Normal or Ingress
        move this phase.
      - Tactical Disembark: available if the Transport remained stationary or
        has not yet been selected to move this phase, and the unit can be set up
        using the Tactical requirements.
      - Combat Disembark: mandatory otherwise. Make a Hazard roll for each
        model in the unit.

While moving:
  - Set up each model wholly within the selected mode's set-up distance of the
    Transport.
  - Rapid Disembark after an Ingress move: each model must follow the same
    movement restrictions the Transport followed for that Ingress move.
  - Combat Disembark: models may be set up engaged with enemy units that the
    Transport is engaged with.

After moving:
  - Rapid Disembark: until the end of the turn, the unit is not eligible to
    declare a charge.
  - Tactical Disembark: select the unit to make a Normal or Advance Move. A
    Tactical Disembark followed by a Normal Move still permits the unit to
    declare a Charge; an Advance Move applies the normal Advance restriction.
  - Combat Disembark: the unit becomes Battle-shocked and is not eligible to
    declare a charge until the end of the turn.

Completion:
  - The unit cannot complete the Disembark Move until every model has been
    legally set up and any required Hazard rolls have been resolved.
  - Tactical Disembark continues directly into a Normal or Advance Move choice.
  - After the resulting move is complete, the Move Units step may select the
    next unit.
```

Transport state, disembark-mode eligibility, setup distance, Hazard rolls, and
post-disembark restrictions are owned by the Movement phase. The shared Set Up
and Moving rules provide geometry and placement mechanics only; Charge consumes
the typed charge restriction without reimplementing Disembark logic.

### Emergency Disembark

Emergency Disembark is not a selectable move type in the Movement phase. It is
a transport-destruction response triggered when a Transport is destroyed.

```text
Set-up distance:
  - 6 inches.

Eligible if:
  - The unit is embarked within a Transport that was just destroyed.

Effect:
  - Set up the unit as described in the shared Set Up rules.

Before moving:
  - Make a Hazard roll for each model in the unit.

While moving:
  - Set up each model wholly within 6 inches of the destroyed Transport and as
    close as possible to it.
  - Each model that cannot be set up in this way is destroyed.

After moving:
  - The unit becomes Battle-shocked.
  - Until the end of the turn, the unit is not eligible to declare a charge.

Completion:
  - Resolve all Hazard rolls.
  - Set up or destroy every model.
  - Apply Battle-shock and the charge restriction before the destruction
    response is complete.
```

The Transport-destroyed event registers a typed pending Emergency Disembark
resolution for each affected embarked unit. The phase step in which the
destruction occurred owns resolving that response before it can complete. The
rule is separate from ordinary Disembark Move eligibility and does not depend
on the Movement phase.

### Ingress Move

```text
Set-up distance:
  - 6 inches.

Eligible if:
  - The unit is in Strategic Reserves.
  - The unit is not embarked within a Transport that is itself in Strategic
    Reserves.

Effect:
  - Set up the unit as described in the shared Set Up rules.

While moving:
  - Set up the unit wholly within 6 inches of one or more battlefield edges.
  - Set up the unit more than 8 inches horizontally from every enemy unit.
  - Before the Third Battle Round, no model may be set up within the opponent's
    deployment zone.

After moving:
  - Unless otherwise stated, until the start of the next Charge phase, the unit
    is not eligible to make any other type of move.

Strategic Reserves end-of-round rule:
  - At the end of the Third Battle Round, unless otherwise stated, each
    Strategic Reserves unit that has not made one or more Ingress Moves is
    destroyed.
  - Exceptions:
      - Units embarked within Transports that have made an Ingress Move during
        the battle.
      - Repositioned units.

Completion:
  - The unit cannot complete the Ingress Move until all placement restrictions
    are satisfied and the unit has been set up.
  - Apply the typed restriction on other move types until the start of the next
    Charge phase.
```

The Movement phase owns Ingress Move placement and its immediate movement
restriction. Battle-round cleanup owns the end-of-Third-Battle-Round Strategic
Reserves destruction check; it must inspect typed reserve state rather than
Movement logs or popup history.

### Placing Units in Strategic Reserves

Strategic Reserves selection occurs before the battle during the Declare Battle
Formations step. It is owned by pre-battle setup/deployment, not by the
Movement phase.

```text
Eligibility:
  - Select one or more friendly units to place in Strategic Reserves.
  - Fortifications cannot be selected.

Placement:
  - Do not set selected units up on the battlefield during deployment.
  - Place them to one side as Strategic Reserves units.

Points limit:
  - Unless otherwise stated, the combined points value of all Strategic
    Reserves units cannot exceed 50% of the battle-size points limit.
  - Include units embarked within Transports that are themselves placed in
    Strategic Reserves when calculating this total.
```

The setup workflow owns the reserve declaration and points validation. The
Movement phase owns later Ingress Move resolution, while the battle-round
cleanup rule owns the end-of-Third-Battle-Round fate of reserve units that have
not arrived.

### Surge Move

Surge Move is an additional move type granted by another rule. It is resolved
when that rule's trigger occurs and is not a selectable move type in the normal
Movement phase sequence.

```text
Maximum distance:
  - The distance stated by the rule allowing the Surge Move.

Eligible if all of the following apply:
  - The rule allowing the Surge Move has been triggered.
  - The unit is not Battle-shocked.
  - The unit is unengaged.
  - The unit has not moved this phase.

Effect:
  - The unit moves as described in the shared Moving rules.

Before moving:
  - Select the closest enemy unit as the Surge target.

While moving:
  - Each model must end its move engaged with the Surge target if possible.
  - Each model that cannot end its move engaged with the Surge target must end
    its move as close as possible to the Surge target.

After moving:
  - The unit cannot be engaged with any enemy unit that was not the Surge target.
  - The unit cannot move again this phase.

Completion:
  - The triggered rule, Surge target, model movement, and post-move restrictions
    must all be resolved before the Surge Move response completes.
```

The triggering rule owns when Surge Move becomes available and supplies its
maximum distance. The movement response owns Surge eligibility, target
selection, placement validation, and completion. It must use typed movement
state to determine whether the unit has already moved this phase.

## Ability, army-rule, and mission timing triggers

Abilities, army rules, and Stratagems may react during specific phases and
steps, including during the opponent's turn. They must not own the phase
workflow or popup visibility. The phase step owns a typed timing window. Rule
services evaluate that window and return typed triggers, effects, or choices.

```ts
type TimingWindow = {
  phase: Phase;
  step: string;
  activePlayer: PlayerId;
  side?: Side;
  event?: BattleEvent;
};

type PhaseTrigger = {
  id: string;
  source: 'ability' | 'army-rule' | 'mission' | 'stratagem';
  owner: PlayerId;
  timing: TimingWindow;
  kind: 'automatic' | 'player-choice' | 'opponent-choice';
  description: string;
  choices?: TriggerChoice[];
};

type PhaseStepResult = {
  state: BattleState;
  triggers: PhaseTrigger[];
  events: BattleEvent[];
};
```

The flow is:

```text
Phase step opens timing window
  -> ability/army-rule/mission/stratagem services evaluate the window
    -> typed triggers are returned
      -> phase resolves automatic effects or exposes choices
        -> phase step continues after triggers are resolved
```

Example:

```ts
function resolveStartOfTurnStep(state: BattleState, rules: RulesEdition): PhaseStepResult {
  const window = { phase: 'start-of-turn', step: 'start-of-turn' };
  const triggers = [
    ...abilityService.triggersFor(window, state, rules),
    ...missionService.triggersFor(window, state, rules),
  ];

  return resolveAutomaticTriggersOrPause(state, triggers);
}
```

The phase remains responsible for deciding whether the step is complete and
whether the player must choose something. The ability and mission services only
answer questions such as:

- Does this rule trigger in this timing window?
- What typed effect does it produce?
- Does it require a player choice?
- What targets or choices are legal?

They do not advance the phase, render a popup, or inspect another phase's
eligibility state.

## Trigger ownership rules

1. A trigger is evaluated only in the phase/step timing window where it belongs.
2. Automatic triggers resolve before the step can complete.
3. Choice triggers become pending typed state owned by the current phase step.
4. The phase step exposes the choice through its own popup state.
5. Resolving a trigger emits typed effects/events and returns control to the
   owning phase step.
6. Triggers must be idempotent or have explicit once-per-window identity so
   replay and undo do not resolve them twice.
7. Mission, ability, army-rule, and Stratagem services may be shared across
   phases, but their trigger evaluation receives an explicit `TimingWindow` and
   never infers timing from log text or global popup state.
8. The active player owns the phase workflow, but the trigger owner may be
   either player. Opponent reactions are legal only when their rule's timing,
   condition, and response eligibility match the current window.
9. A trigger that belongs to the opponent may pause the active phase step for
   an opponent choice; resolving that choice returns control to the active
   phase step.

## Event-driven trigger registry

The trigger system is event-driven. Abilities, army rules, missions, and
Stratagems register
typed trigger definitions with the battle's trigger registry. They do not run
their own phase loops or mutate the phase directly.

```ts
type TriggerDefinition = {
  id: string;
  source: 'ability' | 'army-rule' | 'mission' | 'stratagem';
  owner: PlayerId;
  phase: Phase;
  step: string;
  timing: 'on-enter' | 'before-actions' | 'after-action' | 'on-exit';
  matches(state: BattleState, event?: BattleEvent): boolean;
  createTrigger(state: BattleState, event?: BattleEvent): PhaseTrigger;
};

type TriggerRegistry = {
  register(definition: TriggerDefinition): void;
  triggersFor(window: TimingWindow, state: BattleState, event?: BattleEvent): PhaseTrigger[];
};
```

The lifecycle is:

```text
Battle setup / rule activation
  -> register trigger definitions

Phase enters a step or emits a typed event
  -> active phase queries registry for matching definitions
    -> registry returns typed triggers for this phase and step
      -> phase resolves automatic triggers or exposes choices
        -> resolved effects emit typed events and update BattleState
```

For example, a mission may register a trigger for `fight / after-action`, while
an ability registers one for `command / on-enter`. The Fight phase never needs
to know the mission's internal rule text; it only receives the triggers matching
its current timing window. Conversely, the Command phase never evaluates Fight
triggers.

The registry is a routing and matching service, not a second phase engine:

- It filters definitions by explicit phase, step, and timing.
- It evaluates the definition's typed state/event predicate.
- It creates typed trigger records.
- It does not advance phases, render UI, or resolve player choices.

The owning phase step consumes the returned records, resolves their effects, and
decides when it can continue. Pending choices belong to the owning step and are
represented in that step's popup state.

This also supports replay and undo. Registration should be deterministic, and
each trigger should have a stable identity such as:

```text
<battle event id>:<trigger definition id>:<subject id>:<window>
```

The identity prevents the same trigger from resolving twice when a state is
replayed or an action is undone and re-applied.

### Undo requirements for events

Undo must rewind the complete typed battle timeline, not only model positions or
the displayed log. Every event-driven action must be reversible as one logical
transaction, including:

- The event that caused the trigger.
- Trigger registration, activation, consumption, and stable identity state.
- Pending player choices and which player currently has priority.
- Dice rolls and their recorded results.
- Effects applied to units, models, transports, objectives, and restrictions.
- Phase-step progress and completion state.
- Requests created by Battle-shock, Emergency Disembark, Surge Move, army
  rules, abilities, missions, or Stratagems.
- Phase-owned interaction state used to render popups, including selected
  units/models, popup mode, pending targets, allocations, and the current
  action/choice.

Undo should restore the previous typed state/checkpoint or apply a complete
typed inverse transaction. It must not delete only log entries or reconstruct
state by parsing log text. Replaying the same action after undo must produce the
same deterministic result when the same random input is restored, and trigger
identity must prevent duplicate effects while allowing the undone trigger to be
created again legitimately.

After restoring a checkpoint, the owning phase step must revalidate its restored
interaction state against the restored battle state and regenerate its popup
view model. If the selection or pending action is still legal, the same popup
should return immediately. If it is no longer legal, the step must clear or
replace that interaction state with a valid typed state. Popup correctness must
not depend on the user deselecting and reselecting a unit.

Shared React components receive the phase-owned state and callbacks:

```tsx
const fightPhase = createFightPhase(state, rules);
const popup = fightPhase.getPopupState(selection);

return popup
  ? <CombatPanel mode="fight" {...popup} />
  : null;
```

`CombatPanel` is therefore a reusable presentation component, not the owner of
Fight or Shooting eligibility. Each phase creates/configures its own panel
instance from its own popup state.

## Phase ownership

Each phase is an independent workflow:

| Phase | Owns |
| --- | --- |
| Command | Command points, command abilities, the Command-phase Battle-shock step, command scoring, completion |
| Movement | Movement declarations, movement substeps, reserves, transports, actions, movement completion |
| Shooting | Shooter selection, target selection, weapon selection, shooting resolution, damage follow-up, completion |
| Charge | Charge eligibility, target declaration, charge rolls, charge movement, Heroic Intervention, completion |
| Fight | Fights First, fight selection, Pile In, melee declaration, melee resolution, damage follow-up, Consolidation, completion |
| End | End-of-turn effects, scoring, cleanup, round/turn transition |

A phase must not use another phase's UI eligibility predicate to decide whether
its own popup or action is visible.

## Shared code

Shared code is allowed when it is phase-neutral:

- Geometry, base measurements, terrain, objectives, and coherency
- Dice and generic combat resolution
- Shared Hazard Roll resolution; the owning phase or event supplies the request
  and applies the typed result
- Saves, damage application, casualty allocation, and typed events
- Typed Battle-shock requests and resolution; phases only create requests for
  their own timing windows and consume the resulting typed state
- Typed event-driven movement requests such as Emergency Disembark and Surge
  Move; the triggering rule supplies the event and the movement response owns
  its rule-specific resolution
- Attached-unit relationships
- Stratagem and ability infrastructure
- Undo, timeline, persistence, and replay infrastructure
- Presentational React components such as buttons, popup shells, and combat panels

Shared code must expose mechanics or presentation. It must not own phase-specific
eligibility or popup visibility.

## Popup and action ownership

There must not be one global action predicate such as:

```ts
hasSelectedModelActions()
```

that combines Movement, Charge, Shooting, Fight, and Consolidation visibility.

Instead, each phase derives its own action model:

```ts
type MovementPopupState = {
  unitId: string;
  canMove: boolean;
  canAdvance: boolean;
  canFallBack: boolean;
  canComplete: boolean;
};

type ChargePopupState = {
  unitId: string;
  canRoll: boolean;
  canComplete: boolean;
};

type ShootingPopupState = {
  unitId: string;
  canShoot: boolean;
  canResolve: boolean;
};

type FightPopupState = {
  unitId: string;
  substep: 'pile-in' | 'fight' | 'consolidation';
  canPileIn: boolean;
  canFight: boolean;
  canConsolidate: boolean;
  canComplete: boolean;
};
```

These models may use shared presentation components, but their predicates must
be calculated by the owning phase. A shared `CombatPanel` is acceptable as a
visual component; it is not a global combat workflow. Shooting and Fight each
create/configure their own panel instance with their own eligibility and action
callbacks.

For example:

```tsx
// Shooting phase owns this decision.
return shootingPopupState?.canShoot
  ? <CombatPanel mode="shooting" {...shootingPopupState} />
  : null;

// Fight phase owns this separate decision.
return fightPopupState?.canFight
  ? <CombatPanel mode="fight" {...fightPopupState} />
  : null;
```

The popup shell, button styling, combat-result formatting, and layout helpers can
be shared. The decision to render the panel cannot be shared across phases.

## Selection ownership

Selection has two different concepts and must not conflate them:

1. **Phase-ready unit selection**: a typed phase result identifying units that
   may act now.
2. **Model editing selection**: the models currently selected for dragging or
   movement editing.

Selecting a phase-ready unit must be sufficient to show that phase's unit action
controls. A model-drag selection is not allowed to be a hidden prerequisite for
the unit popup.

The battlefield may render shared highlights, but the active phase supplies the
ready-unit set and the click handler must use that same set to select the unit.

## State ownership

`BattleState` remains the serialized source of truth, but phase-specific state
should be grouped and reset by its owning phase. For example, Fight state should
be represented as a Fight workflow/substate rather than inferred from unrelated
unit flags or generic popup state.

Cross-phase fields must have explicit lifecycle rules. Fields such as `charged`,
`activated`, `inCombat`, and movement history require documented ownership,
write points, and reset points so a later phase cannot accidentally reinterpret
stale data.

## Target module structure

The target structure is:

```text
packages/simulator-core/src/phases/
  commandPhase.ts
  movementPhase.ts
  shootingPhase.ts
  chargePhase.ts
  fightPhase.ts
  battleShockPhase.ts
  endPhase.ts

packages/simulator-core/src/services/
  geometry.ts
  combatResolver.ts
  damageResolver.ts
  terrain.ts
  objectives.ts
  abilities.ts
  events.ts

apps/web/src/play/phases/
  MovementPhaseView.tsx
  ShootingPhaseView.tsx
  ChargePhaseView.tsx
  FightPhaseView.tsx

apps/web/src/play/shared/
  CombatPanel.tsx
  PopupShell.tsx
  ResultSummary.tsx
```

The existing public exports may remain temporarily backed by `simulator.ts`
while behavior is moved into phase modules. Refactors must preserve typed action
and result contracts while reducing the central coordinator.

## Refactor rules

1. Do not add a phase-specific eligibility check to a shared popup predicate.
2. Do not make a phase popup depend on another phase's selection state.
3. Do not use log text to determine phase state or popup visibility.
4. Keep shared components presentational and callback-driven.
5. Keep phase actions and completion checks in the owning phase module.
6. Use typed state/results/events for communication between phases and UI.
7. When extracting code, preserve the public simulator-core API through adapters
   until callers have migrated.

## First migration target

The first migration target is the Fight UI workflow because it currently shares
popup visibility and selection state with Movement, Charge, and Shooting.

The first concrete extraction should:

- Create a Fight-specific popup/action state selector.
- Make Pile In, Fight, and Consolidation visibility depend only on Fight state.
- Keep `CombatPanel` as a reusable presentational component.
- Remove Fight-specific conditions from the global action-visibility chain.
- Add focused tests for each Fight substep and for phase isolation.
