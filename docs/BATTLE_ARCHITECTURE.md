# Battle Engine Architecture

Last updated: 2026-08-23

This document describes the current battle-engine boundaries and the target architecture for completing the phase state machine and centralizing combat. It supplements [`architecture.md`](./architecture.md), which covers the wider web application.

## Design principles

- `packages/simulator-core` owns rules, state, typed actions, typed results, and typed events.
- React owns presentation, selection state, and user input. It does not implement game rules.
- `BattleState` is the serialized source of truth.
- `BattleState.log` is presentation/audit history only. Game logic must never parse log messages.
- Phases own timing, legal actions, interrupts, and completion. Shared rule services own reusable resolution.
- Prefer composition and interfaces over class inheritance. The current code has no class-inheritance hierarchy.

## Current architecture

```mermaid
flowchart TD
  App[React App] --> Controllers[Play action controllers]
  Controllers --> CoreActions[Simulator-core actions]
  CoreActions --> Simulator[simulator.ts]

  State[BattleState] *-- Units[BattleUnit[]]
  State *-- Events[BattleEvent[]]
  State *-- Logs[LogEntry[]]
  State --> Graph[battleStateMachine]
  State --> Rules[RulesEdition]

  Simulator --> Graph
  Simulator --> Combat[Shared attack helpers]
  Simulator --> Terrain[Terrain and geometry]
  Simulator --> Missions[Mission scoring]
  Simulator --> Abilities[unitAbilities.ts]
  Simulator --> Stratagems[stratagems.ts]
  Combat --> Dice[Dice helpers]
  Combat --> Rules
  Combat --> Events
  Events --> LogUI[Battle log projection]
```

The current system has a typed phase enum, movement substeps, typed shooting/charge results, typed battle events, stratagem services, and unit-ability services. Manual play advances normal phase boundaries through `battleStateMachine.ts`; simulation also uses its shared phase-entry invariant. `legalActions.ts` now exposes an active-phase handler registry and one `phaseCanAdvance` completion predicate, which both legal action generation and manual stepping consume. `simulator.ts` still coordinates most phase behavior, so phase-specific simulation orchestration and interrupt ownership remain to be extracted.

## Target battle architecture

```mermaid
flowchart TD
  Engine[Battle Engine] --> Machine[Turn State Machine]
  Engine --> EventCollector[Battle Event Collector]
  Engine --> Rules[Rules Engine]

  Machine *-- Round[Battle Round]
  Round *-- PhaseState[Active Phase State]
  PhaseState --> Command[Command Phase Handler]
  PhaseState --> Movement[Movement Phase Handler]
  PhaseState --> Shooting[Shooting Phase Handler]
  PhaseState --> Charge[Charge Phase Handler]
  PhaseState --> Fight[Fight Phase Handler]

  Command ..|> PhaseHandler[PhaseHandler interface]
  Movement ..|> PhaseHandler
  Shooting ..|> PhaseHandler
  Charge ..|> PhaseHandler
  Fight ..|> PhaseHandler

  Shooting --> Combat[Combat Resolver]
  Charge --> Combat
  Fight --> Combat
  Overwatch[Overwatch interrupt] --> Combat
  FightDeath[Fight-on-death interrupt] --> Combat

  Combat --> Dice[Dice Service]
  Combat --> Hit[Hit Resolver]
  Combat --> Wound[Wound Resolver]
  Combat --> Saves[Save and FNP Resolver]
  Combat --> Damage[Damage Allocator]
  Combat --> EventCollector

  EventCollector *-- Event[BattleEvent]
  Event --> Results[Typed combat results]
  Event --> Projection[Log projection]

  Command --> Stratagems[Stratagem Service]
  Movement --> Stratagems
  Shooting --> Stratagems
  Charge --> Stratagems
  Fight --> Stratagems
  Command --> Abilities[Unit Ability Service]
  Movement --> Abilities
  Shooting --> Abilities
  Charge --> Abilities
  Fight --> Abilities
  Stratagems --> Effects[Typed Effect Resolver]
  Abilities --> Effects
  Effects --> Combat
  Effects --> MovementRules[Movement and position services]
  Effects --> Missions[Mission and objective services]
  Effects --> EventCollector
```

## Phase ownership

Each phase handler should implement the same contract:

```ts
interface PhaseHandler {
  phase: Phase;
  getLegalActions(state: BattleState): GameAction[];
  applyAction(state: BattleState, action: GameAction): PhaseResult;
  isComplete(state: BattleState): boolean;
  enter(state: BattleState): void;
  exit(state: BattleState): void;
}
```

The handlers are composed by the state machine; they should not inherit from one another.

`BATTLE_PHASE_STATE_HANDLERS` owns phase-entry cursor invariants, while `PHASE_LEGAL_ACTION_HANDLERS` owns the legal actions and interrupts exposed during each active phase. Full-phase simulation and unit-step simulation share one orchestrator, so they enter the same phase state and execute the same end-of-phase/turn boundary work; they differ only in whether that orchestrator automatically resolves the eligible units.

| Handler | Owns |
| --- | --- |
| `CommandPhaseHandler` | Command points, Battle-shock timing, command abilities, command-end scoring, and Command completion |
| `MovementPhaseHandler` | Move Units and Reinforcements substeps, movement declarations, reserves, transports, actions, and movement completion |
| `ShootingPhaseHandler` | Shooting declarations, weapon/target locking, shooting interrupts, and shooting completion |
| `ChargePhaseHandler` | Charge declarations, charge rolls, charge movement, Heroic Intervention, and charge completion |
| `FightPhaseHandler` | Fight priority, pile-in, melee declarations, Fight on Death, damage allocation, consolidation, and Fight completion |

Fight should have an explicit nested state rather than relying only on unit flags:

```ts
type FightSubstate =
  | 'select-activation'
  | 'pile-in'
  | 'declare-attacks'
  | 'resolve-attacks'
  | 'allocate-damage'
  | 'consolidate'
  | 'complete';
```

The Fight handler owns that sequence, while the Combat Resolver owns only the attack sequence inside `resolve-attacks` and the shared damage services used by `allocate-damage`.

The current `battleStateMachine.ts` provides the transition graph, movement substeps, round boundary, five-round limit, and phase-entry cursor resets. The remaining state-machine work is moving the phase-specific legal-action and completion logic into these handlers.

## Stratagems and unit abilities

Stratagems and unique unit abilities are cross-phase rule services. They should not be subclasses of every phase.

```mermaid
flowchart LR
  Phase[Phase Handler] --> Window[Timing Window]
  Window --> Stratagem[Stratagem Service]
  Window --> Ability[Unit Ability Service]
  Stratagem --> Eligibility[Eligibility and legal-action checks]
  Ability --> Eligibility
  Stratagem --> Effect[Typed Effect Resolver]
  Ability --> Effect
  Effect --> Combat[Combat Resolver]
  Effect --> Movement[Movement / position services]
  Effect --> Mission[Mission / objective services]
  Effect --> Events[BattleEvent Collector]
```

The rule flow is:

```text
Phase handler:       Is this timing window open?
Stratagem/ability:   Is this use legal, and what effect does it grant?
Effect resolver:     How does that typed effect change state?
Combat resolver:     How do attacks, saves, and damage resolve?
```

Examples:

- Fire Overwatch is validated by the Stratagem Service and resolved through the Combat Resolver.
- Command Re-roll modifies a pending typed roll through the Stratagem Service.
- Smokescreen grants a typed defensive effect consumed by targeting/combat rules.
- Deadly Demise is an ability-triggered effect that uses the shared mortal-wound/damage path.
- Lance, Cleave, and Fights First are ability-derived modifiers consumed by the relevant phase/combat handler.
- A unit movement ability is validated by the Ability Service and applied through movement services.

## Combat centralization

Combat should be one reusable sequence, regardless of whether it was started by Shooting, Fight, Overwatch, or Fight on Death:

```mermaid
flowchart LR
  Declaration[Weapon / target declaration] --> Attacks[Attack pool]
  Attacks --> Dice[Roll attacks]
  Dice --> Hit[Resolve hits]
  Hit --> Wound[Resolve wounds]
  Wound --> Saves[Resolve saves / FNP]
  Saves --> Damage[Allocate damage]
  Damage --> Result[Typed CombatResult]
  Result --> Events[Typed BattleEvent]
```

Phase handlers should own declaration, eligibility, and sequencing. The shared Combat Resolver should own:

- Attack counts and weapon pools
- Dice rolls
- Hit modifiers and critical hits
- Wound thresholds and critical wounds
- Saves, invulnerable saves, cover, and Feel No Pain
- Mortal and devastating wounds
- Damage rolls
- Pending damage and casualty allocation
- Typed intermediate and final results

`resolveCombatAttacks` is the current shared combat boundary. Shooting, split melee, normal melee, automated melee, and Fight on Death use it, and it emits typed `AttackResolved` events for every resolved weapon attack. `damageResolution.ts` now owns deterministic save, Feel No Pain, and damage/spillover outcomes; both immediate damage and defender-selected allocation emit typed `DamageApplied` events. The remaining work is moving resolver orchestration and its focused helpers from `simulator.ts` while preserving the public contract.

## Events and logs

`BattleEvent` is the machine-readable event boundary. It stores phase context and typed data such as dice, targets, modifiers, outcomes, and pending damage.

```mermaid
flowchart LR
  Action[GameAction] --> Rules[Rules / phase handler]
  Rules --> Event[BattleEvent]
  Event --> State[BattleState.events]
  Event --> Result[Typed action/combat result]
  Event --> Log[Display/audit LogEntry]
```

`LogEntry.message` may be formatted for humans, but it is never an input to rules logic. New UI features should consume typed results or events directly.

## Mission scoring and VP state

Scoring is separated from combat and treated as its own rules subsystem. It tracks primary records, secondary cards and records, objective ownership, secured objectives, mission events, and VP caps. `scoringLedger.ts` is the sole score-mutation boundary for primary and secondary awards: it applies caps and idempotency, records typed `ScoringApplied` events, and updates the score projection while the primary/secondary record types remain the detailed UI audit trail.

```mermaid
flowchart TD
  Phase[Phase Handler] --> Window[Scoring Window]
  Window --> MissionEngine[Mission Scoring Engine]

  MissionEngine --> Primary[Primary Mission Rules]
  MissionEngine --> Secondary[Secondary Mission Rules]
  MissionEngine --> Objective[Objective Control Snapshot]
  MissionEngine --> Ledger[Scoring Ledger]

  Ledger *-- Record[Scoring Record]
  Ledger --> Delta[Score Delta]
  Ledger --> ScoreProjection[BattleState score projection]
  Ledger --> ScoringEvents[Typed Scoring Events]
  ScoringEvents --> LogProjection[Scoring log projection]
  ScoringEvents --> ScoreUI[Score timeline / UI]
```

The implemented flow is:

```ts
const result = evaluatePrimaryScoring(state, side, rules);
// Pure evaluation; no state mutation.

const applied = applyScoringResult(state, result);
// One mutation boundary for score, caps, records, and events.
```

Recommended scoring boundaries:

| Component | Responsibility |
| --- | --- |
| `ObjectiveControlService` | Calculate current and secured objective ownership |
| `MissionSnapshotService` | Capture start-of-turn and end-of-phase facts |
| `PrimaryMissionRules` | Evaluate primary scoring clauses |
| `SecondaryMissionRules` | Evaluate secondary card clauses |
| `ScoringLedger` | Enforce caps, idempotency, score deltas, and records |
| `MissionEventService` | Record destruction, actions, positions, and other scoring facts |
| `ScoringEventProjection` | Turn typed scoring events into readable logs and UI data |

Primary and secondary rule evaluation should remain separate because their cards, timing, and selection rules differ. They should share the ledger, record shape conventions, VP-cap enforcement, event collection, and score projection.

## Full game flow

This is the target end-to-end flow. It shows the relationship between setup, the round/phase state machine, timing windows, shared combat, scoring, events, persistence, replay, and controllers.

```mermaid
flowchart TD
  Start[Create or load BattleState] --> Setup[Battle Setup]
  Setup --> ValidateRoster[Validate armies and deployment]
  ValidateRoster --> Deploy[Deployment Phase]
  Deploy --> DeployComplete{Deployment legal and complete?}
  DeployComplete -- No --> Deploy
  DeployComplete -- Yes --> RoundStart[Start Battle Round]

  RoundStart --> PlayerTurn[Active Player Turn]
  PlayerTurn --> Command[Command Phase]
  Command --> CommandWindow[Command abilities and stratagem window]
  CommandWindow --> BattleShock[Battle-shock and Command effects]
  BattleShock --> PrimaryCommand[Primary scoring window]

  PrimaryCommand --> Movement[Movement Phase]
  Movement --> MoveUnits[Move Units Step]
  MoveUnits --> MovementActions[Movement actions, transports, reserves, abilities]
  MovementActions --> MoveComplete{Move Units complete and legal?}
  MoveComplete -- No --> MoveUnits
  MoveComplete -- Yes --> Reinforcements[Reinforcements Step]
  Reinforcements --> ReinforcementActions[Ingress, reserves, transport arrivals, stratagems]
  ReinforcementActions --> Shooting[Shooting Phase]

  Shooting --> ShootingWindow[Shooting declarations and weapon target locking]
  ShootingWindow --> ShootingInterrupts[Overwatch and other interrupts]
  ShootingInterrupts --> Combat[Shared Combat Resolver]
  Combat --> ShootingResults[Typed attack results and pending damage]
  ShootingResults --> DamageAllocation[Save, Feel No Pain, damage allocation]
  DamageAllocation --> ShootingComplete{All shooting activations complete?}
  ShootingComplete -- No --> ShootingWindow
  ShootingComplete -- Yes --> Charge[Charge Phase]

  Charge --> ChargeWindow[Charge declarations and charge rolls]
  ChargeWindow --> ChargeInterrupts[Heroic Intervention and charge effects]
  ChargeInterrupts --> ChargeMovement[Charge movement]
  ChargeMovement --> ChargeComplete{All charges resolved?}
  ChargeComplete -- No --> ChargeWindow
  ChargeComplete -- Yes --> Fight[Fight Phase]

  Fight --> FightPriority[Fight priority and activation selection]
  FightPriority --> PileIn[Pile-in substate]
  PileIn --> DeclareFight[Declare melee targets and weapons]
  DeclareFight --> FightInterrupts[Fight on Death, Counter-offensive, abilities]
  FightInterrupts --> Combat
  DamageAllocation --> Consolidation[Consolidation substate]
  Consolidation --> FightComplete{All fight activations complete?}
  FightComplete -- No --> FightPriority
  FightComplete -- Yes --> EndTurn[End-of-turn effects]

  EndTurn --> Secondary[Secondary mission scoring]
  Secondary --> PrimaryTurn[Primary mission scoring]
  PrimaryTurn --> ScoreLedger[Apply Scoring Ledger]
  ScoreLedger --> MissionEvents[Record mission events and typed scoring events]
  MissionEvents --> WinnerCheck{Battle ended?}

  WinnerCheck -- No --> NextPlayer{Both players completed the round?}
  NextPlayer -- No --> PlayerTurn
  NextPlayer -- Yes --> RoundLimit{Five-round limit reached?}
  RoundLimit -- No --> RoundStart
  RoundLimit -- Yes --> EndBattle[End Battle scoring and winner]
  WinnerCheck -- Yes --> EndBattle

  Combat --> Events[BattleEvent Collector]
  MovementActions --> Events
  ChargeMovement --> Events
  FightInterrupts --> Events
  CommandWindow --> Events
  ScoreLedger --> Events

  Events --> StateProjection[Persist typed state/results]
  StateProjection --> Save[Save / checkpoint / replay]
  StateProjection --> UI[Update UI and battlefield]
  StateProjection --> AI[AI observation and legal actions]
  Events --> LogProjection[Human-readable log projection]
```

The same state transitions and typed actions should drive:

- Local human play
- Human versus AI
- AI versus AI simulation
- Replay and undo
- Checkpoints and database persistence
- Score history and UI explanations

No branch should use formatted log text as a substitute for state, action results, or scoring records.

## Inheritance and dependency conventions

Legend:

- `*--`: composition or ownership
- `-->`: dependency or service use
- `..|>`: interface implementation
- `--|>`: class inheritance

There are currently no required `--|>` inheritance links. The recommended `<|..`/`..|>` relationships are phase handlers implementing `PhaseHandler`. Shared services should be composed into handlers rather than inherited from a large base class.

## Migration order

1. Finish the phase-handler contract and move phase legal-action/completion logic out of `simulator.ts`.
2. Extract the shared Combat Resolver from shooting/fight orchestration.
3. Route Overwatch and Fight on Death through the same Combat Resolver.
4. Move stratagem and ability effects behind timing-window and typed-effect contracts.
5. Keep mission, terrain, movement, and objective services pure where possible.
6. Split `simulator.ts` only after each extracted domain has typed actions, results, events, and focused tests.

Each step should preserve the public simulator-core exports and be verified with the core tests plus the root production build.
