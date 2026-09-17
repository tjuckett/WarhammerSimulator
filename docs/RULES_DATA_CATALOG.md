# Rules Data Catalog and Declarative Effects Plan

Status: design plus initial runtime foundation and an Ork catalog pilot. The
registry/materializer, generic Army Builder wargear editor, current
11th-edition sample rosters, and normalized JSON entries are now live in
`packages/simulator-core`; broad faction coverage and additional typed effects
remain planned.

This document records the design decisions for storing units, army rules,
detachments, Stratagems, and their executable effects. It is intended to keep
the data model consistent while the simulator grows from imported/sample armies
to complete faction catalogs.

## Goals

- Keep official rules data separate from simulator runtime state.
- Store read-mostly catalog data as reviewable, versioned JSON.
- Avoid duplicating shared units across Space Marine chapters or other factions.
- Let the same event/effect runtime handle unit abilities, army rules,
  detachments, and Stratagems.
- Preserve deterministic battles, replays, undo/redo, and saved games when
  catalog data changes.
- Keep source references and raw rule text for audit, while requiring typed
  data/effects for behavior.
- Exclude Legends datasheets from the normal catalog unless explicitly enabled.

## Decisions

### JSON is the canonical catalog format

The initial canonical catalog will live in the repository as JSON under
`packages/simulator-core/src/data`. Git provides reviewable history, diffs, and
rollback. The app can bundle the data for offline use or serve the same files
through a read-only endpoint later.

A database is not needed for canonical rules data at the current scale. The
catalog is read frequently but updated comparatively rarely, and a database
would add migrations, deployment, administration, and update-pipeline work
without solving an immediate problem.

The database remains appropriate for user-owned data:

- saved armies and Army Builder edits;
- saved battles, timelines, and replays;
- user-created terrain and missions;
- sharing, ownership, and multiplayer session data.

If catalog updates eventually need to arrive without an app deployment, the
versioned JSON can be published as static files or through a read-only API. A
database should be reconsidered only if administrators need online editing,
user-submitted corrections, complex cross-version search, or a server-managed
catalog workflow.

### Source references are not runtime rules data

The captured PDF and Wahapedia reference documents remain source/audit material.
They should not be parsed by the simulator at runtime, and rule behavior should
never be inferred from log text or an arbitrary prose match.

The intended pipeline is:

```text
Source capture (PDF/HTML/reference Markdown)
        -> normalized and reviewed catalog JSON
        -> typed catalog loader and resolver
        -> army selections and resolved UnitProfiles
        -> BattleState and runtime effects
```

The normalized Markdown is useful for comparison and review. The JSON catalog
is the executable data boundary.

### Separate definitions, selections, profiles, and runtime state

The simulator should keep these concepts distinct:

| Layer | Meaning | Example lifetime |
| --- | --- | --- |
| `UnitDefinition` | Complete catalog entry: stats, options, points, bases, source, and rule references | Versioned catalog |
| `ArmySelection` | What a player chose from that definition | Army list |
| `UnitProfile` | Resolved playable profile after choices and faction context are applied | Saved army/battle snapshot |
| `BattleUnit` | Runtime state such as position, wounds, activation, and temporary effects | Current battle |

The existing `UnitProfile` and `ImportedArmy` types are closest to the resolved
army/battle layers and should remain portable. They should not be overloaded to
be the complete global catalog format.

The current `ArmyCatalog` attached to a BattleScribe/NewRecruit import is useful
for imported roster constraints and validation. It is not the same thing as a
global catalog shared by every army and should remain a separate concept.

The core data flow should become:

```text
FactionCatalog + UnitDefinition
        -> UnitSelection
        -> materializeUnit(selection, armyContext)
        -> UnitProfile
        -> BattleUnit
```

## Catalog concepts

The eventual core types should include the following concepts. Exact field
names can be finalized during implementation.

### `CatalogManifest`

The manifest identifies the catalog package and its revision.

It should contain:

- catalog ID;
- game edition;
- catalog revision;
- schema version;
- source capture dates and URLs;
- source revision or hash when available;
- parser/normalizer version;
- available factions and their data files;
- review status.

`schemaVersion` describes the shape of the JSON. `catalogRevision` describes
the rules/data snapshot. They must not be conflated.

### `CatalogReference`

Saved armies and battles should identify the catalog snapshot used to create
them:

```json
{
  "catalogId": "warhammer-40k",
  "edition": "11e",
  "catalogRevision": "2026-08-29.1"
}
```

### `FactionCatalog`

A faction catalog defines the army context and references available content.
It should contain:

- faction ID and display name;
- optional parent/base catalog;
- unit references and exclusions;
- army-rule references;
- detachment references;
- faction or chapter overlays;
- roster construction constraints;
- source/provenance metadata.

### `UnitDefinition`

A unit definition should contain, as applicable:

- stable canonical ID;
- display name, aliases, and external source IDs;
- battlefield role and unit keywords;
- model composition and model stat profiles;
- weapon profiles and weapon options;
- legal model-count ranges;
- wargear and configuration options;
- points by legal configuration;
- model base geometry;
- transport, Leader, and Support metadata;
- rule references and retained raw rule text;
- damaged profiles and movement overrides;
- status such as `current`, `legend`, or `retired`;
- source and review metadata;
- implementation status for behavior that is not yet supported.

Base sizes should ultimately live with the unit definition. The existing
base-size data can be used as migration input and a temporary fallback, but
there should not be two competing sources of truth long term.

### `UnitSelection`

An army list should store the choices made by the player, rather than editing a
global unit definition. A selection may include:

- canonical unit ID;
- army-list instance ID;
- model count;
- selected wargear and options;
- enhancements;
- attached Leader or Support relationships;
- transport assignment;
- deployment/reserve assignment;
- explicit user overrides, when supported.

User overrides must be stored on the selection or saved army. They must never
mutate the canonical catalog JSON.

### Generic wargear editing

The Army Builder uses one faction-independent editor for `WargearChoice` data.
The editor supports complete model loadouts, count-limited choices, shared
choice limits, unit upgrades, and replacement slots that preserve the model's
other weapons. This UI and schema are reusable for every faction.

The legal choices still belong in each unit definition: model composition,
replacement slots, maximum quantities, and model-count increments differ by
datasheet. Adding another faction should add catalog JSON and source-specific
normalization, not another React editor.

## Shared units and Space Marine chapters

Units should be owned by a canonical unit library, not duplicated in every
playable faction file. This is especially important for Space Marines, where
many chapters share the same datasheets.

Use a namespace based on the unit family rather than assuming the playable
faction owns the unit:

```text
adeptus-astartes.intercessor-squad
adeptus-astartes.redemptor-dreadnought
blood-angels.chapter-specific-unit
dark-angels.chapter-specific-unit
```

A chapter or subfaction catalog can reference shared units:

```json
{
  "id": "blood-angels",
  "baseCatalogId": "space-marines",
  "unitRefs": [
    "adeptus-astartes.intercessor-squad",
    "adeptus-astartes.redemptor-dreadnought"
  ],
  "excludedUnitRefs": [],
  "ruleRefs": [
    "blood-angels.faction-rule"
  ]
}
```

The army context should retain the selected identity separately:

```json
{
  "factionId": "space-marines",
  "chapterId": "blood-angels",
  "detachmentId": "..."
}
```

When a unit is materialized, the resolver should:

1. Load the canonical shared unit definition.
2. Check availability and chapter exclusions.
3. Apply the effective faction/chapter keywords.
4. Apply chapter and detachment overlays.
5. Apply the player's model, wargear, and enhancement choices.
6. Produce the final `UnitProfile`.

Small contextual differences can be represented as overlays:

- extra faction keywords;
- faction or chapter rules;
- different points;
- availability restrictions;
- detachment modifications.

If two entries are materially different datasheets, they should have separate
canonical IDs. Do not create a deep inheritance tree or merge entries based
only on matching names. Match imported sources using stable external IDs where
possible, then aliases/names as fallbacks, and warn when profiles disagree.

The same reference model applies to shared detachments, shared rules, and
common Stratagems.

## Proposed catalog layout

The initial layout should favor a small number of understandable files while
allowing shared unit libraries:

```text
packages/simulator-core/src/data/catalogs/11e/
  manifest.json
  units/
    orks.json
    adeptus-astartes.json
    ...
  factions/
    orks.json
    space-marines.json
    blood-angels.json
    ...
  rules/
    core.json
    orks.json
    adeptus-astartes.json
    ...
  detachments/
    orks.json
    space-marines.json
    ...
```

Faction files should primarily describe availability, rules, detachments, and
overlays. Unit definitions should live in the unit library files. If a file
becomes difficult to review, a unit library can later be split into one JSON
file per unit without changing the public catalog types.

The catalog should initially contain the current supported data. Historical
versions can remain available through Git history. If the server later needs to
serve multiple revisions directly, they can be placed under versioned folders
without changing the runtime model.

## Rules, abilities, and Stratagems

Unit abilities, army rules, detachment rules, mission rules, and Stratagems
should all use the same typed event/effect runtime described in
[`EVENTS_AND_TRIGGERS.md`](./EVENTS_AND_TRIGGERS.md).

The catalog declares which rules apply. The rule/effect definitions describe
what those rules do.

```json
{
  "id": "adeptus-astartes.intercessor-squad",
  "ruleRefs": [
    "core.stealth",
    "space-marines.unit-rule"
  ],
  "rawRules": []
}
```

Raw text is retained for display and audit. It is not executable behavior.
Unsupported behavior must be explicit and fail closed until a typed effect is
implemented.

### Rule behavior categories

The effect runtime needs to distinguish at least these lifetimes:

- **Derived/always-on:** calculated from current state, such as a keyword,
  stat modifier, or aura. Prefer querying these rather than storing redundant
  mutable state.
- **Immediate/one-off:** resolves once in response to an event, such as a reroll
  or damage result modification.
- **Active/persistent:** creates a serialized effect instance with source,
  target, start time, duration, and expiration condition.
- **Usage-limited:** records uses in a typed usage ledger, such as once per
  phase, once per round, or once per battle.
- **Pending choice:** creates a typed interaction when a player must choose a
  target, option, allocation, or response.
- **Aura/conditional:** queries relationships and conditions at the time an
  affected action is evaluated, with explicit range and scope rules.

This lets the same runtime support a unit ability that is always active, a
temporary detachment bonus, a one-use ability, or a reaction that pauses the
battle for a player choice.

### `StratagemDefinition`

Stratagems are player-triggered rules, not unit definitions. A Stratagem entry
should contain:

- stable ID and display name;
- edition, faction, detachment, or core scope;
- category, when applicable;
- Command point cost;
- explicit timing window and phase/step;
- active player or opposing-player ownership;
- eligibility conditions;
- target schema and target restrictions;
- effects or pending choices;
- usage limits and same-target restrictions;
- source and review metadata.

Conceptually:

```json
{
  "id": "orks.stratagem.example",
  "name": "Example Stratagem",
  "scope": "faction",
  "cpCost": 1,
  "timing": {
    "phase": "movement",
    "window": "after-selecting-unit"
  },
  "eligibility": [],
  "targets": {
    "type": "friendly-unit"
  },
  "effects": [],
  "usageLimit": "once-per-phase"
}
```

The runtime flow is:

```text
Typed battle event
  -> find Stratagems valid in this timing window
  -> validate player, CP, eligibility, and targets
  -> dispatch a typed UseStratagem action
  -> spend CP and record usage
  -> resolve immediate effects or create active/pending effects
```

Stratagem use must be represented in typed state so it is undoable,
replayable, saveable, and available to AI controllers. The UI should display
legal Stratagem actions returned by core rather than reconstructing availability
from log text.

The existing core Stratagem work and `Rapid Ingress` timing should be migrated
into this catalog/effect boundary rather than creating separate faction-specific
execution paths.

### Initial runtime foundation

The first implementation adds a JSON-safe `RuleEffect` vocabulary and uses it
for the currently modeled unit abilities and core Stratagems. It supports
army-ability activation, wound restoration, reserve movement, Battle-shock
clearing, command-reroll tokens, typed event requests, event-backed combat
windows, unit flags, forced Fight selection, mortal-wound rolls, and timed
active modifiers. `BattleState.activeRuleEffects` stores timed modifiers with
their source, target, creation context, and duration; expired effects remain
serializable but are ignored by the active-effect queries.

Stratagem target/model/secondary-target selection and phase-step restrictions
are also declared in `StratagemDefinition` metadata. This keeps the existing
human/AI/replay action path intact while allowing future catalog entries to
use new IDs without adding an executor branch for each entry. Legacy imported
rules without typed effects still use the existing compatibility behavior and
remain display/audit data until normalized.

### Initial catalog registry and Ork pilot

The catalog boundary is implemented in [`types/catalog.ts`](../packages/simulator-core/src/types/catalog.ts)
and [`engine/catalog.ts`](../packages/simulator-core/src/engine/catalog.ts).
`CatalogRegistry` validates IDs and references, applies the default Legends
exclusion policy, resolves shared/base faction references, looks up aliases,
materializes a `UnitSelection` into an immutable-copy `UnitProfile`, and can
merge catalog-provided executable abilities/Stratagems into an existing
`RulesEdition`.

The first JSON snapshot is under
`packages/simulator-core/src/data/catalogs/11e/`:

- all 58 current non-Legends Ork units are normalized and selectable;
- 32 Ork datasheets with wargear options now expose structured choices to the
  generic Army Builder editor, including count limits and Deff Dread's
  independently replaceable weapon slots;
- stats, weapons, model loadouts, model bases, composition, points, transport
  data, Leader relationships, aliases, raw wording, source metadata, and
  machine-readable wargear choices are retained;
- Waaagh!, Kunnin' Infiltrator, and Grot Riggers use the shared typed effect
  runtime;
- War Horde, its detachment rule, and six Stratagem entries are retained as
  queryable source data, but remain explicitly unsupported for execution until
  the required effect vocabulary exists;
- the manifest records all 58 current source datasheets and 30 excluded Legends
  datasheets; executable behavior for many raw datasheet abilities remains
  explicitly partial.

The bundled Ork and Necron sample armies now use the captured 11th-edition
datasheet values, explicit model bases, model-level loadouts where required,
and source rule text. The Army Builder adds the normalized Ork catalog slice
when the selected army faction is `Orks`; sample and imported units remain
available as fallback sources.

Use `loadOrkCatalog()` for the pilot registry and
`rulesEditionWithCatalog(rules, catalog, { factionId: 'orks' })` when a battle
should use the catalog's executable definitions. The materializer uses the
existing base-size map only as a compatibility fallback and reports a warning;
new normalized entries should put their geometry directly in the unit JSON.

## Versioning and update policy

Catalog data is expected to change whenever new faction packs, points updates,
FAQs, errata, or datasheet revisions arrive. The update cadence may be every
few months or more frequently, so updates must be cheap and auditable.

Each catalog snapshot should record:

- edition;
- catalog revision;
- source URL and capture date;
- source revision/hash when available;
- parser/normalizer version;
- review status;
- changed source sections or entries.

Rules data should be updated by creating a new catalog revision rather than
silently changing the meaning of an existing revision.

For new armies and battles:

- use the current catalog revision;
- record the revision in the army/battle metadata;
- resolve and store the resulting `UnitProfile`.

For saved battles and replays:

- retain the catalog reference;
- retain resolved unit profiles;
- retain the rule/effect snapshot or enough versioned data to reproduce the
  battle exactly;
- never require a future catalog update to reinterpret an old battle silently.

For ordinary saved army editing, the army can be offered a migration when its
catalog revision is old. Migration should use stable IDs, aliases, and explicit
change notices. It should never silently replace a removed or materially
changed unit.

### Update workflow

1. Capture the new source reference.
2. Run a source comparison against the previous reference.
3. Review changed units, rules, points, options, and detachments.
4. Update the normalized catalog JSON and provenance metadata.
5. Add or update focused tests for behavior changes.
6. Bump the catalog revision.
7. Run catalog validation, core tests, and the web build when catalog imports
   are affected.

The source-refresh tooling should report additions, removals, and changes. It
should not automatically turn arbitrary prose into executable effects.

## Integration with the current project

- Keep `ImportedArmy` as the portable resolved army shape used by Play,
  Simulation, save/load, and export.
- Keep `ArmyCatalog` for catalog data discovered from an imported roster and
  roster validation until the canonical catalog is integrated.
- Add a catalog registry/loader in simulator-core so Army Builder can request a
  faction catalog directly.
- Update Army Builder's available-unit library to use the registry, with
  imported catalogs remaining a fallback during migration.
- Map BattleScribe/NewRecruit external IDs to canonical IDs before materializing
  units; preserve unmatched source data and show warnings.
- Move base sizes into unit definitions over time and retain a compatibility
  fallback for older saved armies.
- Keep all catalog and rules behavior in simulator-core. React should request
  legal choices and display typed results.
- Keep saved-army repositories responsible for user armies, not canonical rule
  ownership.
- Keep event provenance and typed results in state. Logs remain display history
  only.

## Implementation plan and todos

### Catalog foundation

- [x] Define `CatalogManifest`, `CatalogReference`, `FactionCatalog`,
  `UnitDefinition`, and `UnitSelection` types.
- [x] Define stable ID and namespace conventions for units, rules, factions,
  chapters, detachments, and Stratagems.
- [x] Add a catalog registry/loader with edition and revision checks.
- [x] Add runtime catalog validation for required fields, duplicate IDs,
  dangling references, and unsupported statuses.
- [x] Add a clear default policy that excludes Legends datasheets.

### Unit data

- [x] Convert the Ork reference into a pilot normalized catalog.
- [x] Include stats, weapons, options, points, base sizes, transport/Leader
  metadata, raw rules, typed rule references, and source provenance for the
  current Ork catalog.
- [x] Add one generic data-driven wargear editor for complete loadouts, unit
  upgrades, quantity limits, and replacement slots.
- [x] Migrate existing base-size data into the pilot unit definitions.
- [ ] Add shared-unit references and chapter overlays using Space Marines as the
  first cross-faction test case.
- [ ] Add external source ID and alias mapping for BattleScribe/NewRecruit and
  Wahapedia references.
- [x] Make Army Builder load catalog units directly while preserving imported
  roster fallback behavior.
- [ ] Expand catalog-backed roster validation to cover faction, detachment,
  points, copies, Battleline, transports, Leaders, enhancements, and reserves.
- [ ] Convert additional factions after the Ork and shared Space Marine pilots
  validate the model.

### Rules and Stratagems

- [ ] Define `RuleDefinition`, `StratagemDefinition`, condition, target, effect,
  duration, and usage-ledger contracts.
- [x] Add the initial JSON-safe `RuleEffect` and timed active-effect contracts;
  expand the vocabulary as catalog rules are normalized.
- [x] Connect catalog rule references to the existing event/trigger registry
  for the first typed unit abilities.
- [ ] Implement immediate, active, persistent, always-on, aura, conditional,
  usage-limited, and pending-choice effects through shared typed mechanisms.
- [ ] Move core Stratagem definitions into the catalog/effect boundary.
- [x] Add the first faction/detachment Stratagem source catalog without adding
  per-Stratagem execution code; typed execution remains pending.
- [ ] Expose legal Stratagem and ability choices through the same action path
  used by human play, AI, replay, save/load, and undo.
- [ ] Store CP payment, usage restrictions, event provenance, and resolved
  effects in typed state.
- [ ] Keep unsupported or ambiguous wording explicit and fail closed.

### Revisions and verification

- [ ] Add catalog revision metadata and source provenance to saved armies and
  battle snapshots.
- [ ] Add migration behavior for old army catalog revisions.
- [ ] Add source-refresh comparison output for changed entries.
- [ ] Add fixture tests for shared units, overlays, exclusions, points/options,
  and external-ID mapping.
- [ ] Add deterministic tests proving Stratagems and effects survive undo/redo,
  save/load, replay, and AI action selection.
- [ ] Document which catalog entries are fully implemented, partially
  implemented, unsupported, or display-only.

## Non-goals for the first implementation

- Do not add a database solely to store official unit or Stratagem definitions.
- Do not duplicate shared units in every chapter catalog.
- Do not execute arbitrary rule prose or scrape websites during a battle.
- Do not require every catalog entry to have executable behavior before the
  catalog can display it; unsupported behavior must instead be marked and fail
  closed.
- Do not preserve old battle behavior by silently loading the newest rules.

## Related documents

- [`EVENTS_AND_TRIGGERS.md`](./EVENTS_AND_TRIGGERS.md)
- [`BATTLE_ARCHITECTURE.md`](./BATTLE_ARCHITECTURE.md)
- [`army-references/wahapedia/INDEX.md`](./army-references/wahapedia/INDEX.md)
- [`../packages/simulator-core/src/types/army.ts`](../packages/simulator-core/src/types/army.ts)
- [`../TODOS.md`](../TODOS.md)
