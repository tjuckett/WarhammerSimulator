# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Local dev setup (first time)
npm install
npm run setup:local          # starts Docker Postgres + runs Prisma migration

# Development
npm run dev --workspace @warhammer-simulator/web   # Next.js dev server

# Build / lint / test (from repo root)
npm run build                # Next.js production build
npm run lint                 # ESLint on web app
npm run test                 # Compile + run simulator-core tests

# Typecheck simulator-core only
npm run typecheck --workspace @warhammer-simulator/core

# Database
npm run db:migrate           # create + apply a new migration
npm run db:push              # sync schema without migration file
npm run db:generate          # regenerate Prisma client
npm run db:studio            # open Prisma Studio
```

Running a single test is not supported by the test setup — the only test file is `packages/simulator-core/test/scenarioStorage.test.js` and the whole suite runs via `npm run test`.

## Architecture

This is an **npm workspaces monorepo** with two packages:

- **`packages/simulator-core`** (`@warhammer-simulator/core`) — pure TypeScript rules engine, zero React dependencies. Exports subpaths: `./types/*`, `./engine/*`, `./data/*`, `./parsers/*`, `./practice/*`.
- **`apps/web`** (`@warhammer-simulator/web`) — Next.js 16 + React 19 front-end that imports from `@warhammer-simulator/core`. The simulator UI runs **client-side only** (no SSR); `app/page.tsx` wraps `<App>` with `dynamic(..., { ssr: false })`.

### simulator-core engine

`src/engine/simulator.ts` (~1650 lines) is the main battle engine. All battle state is represented as a plain `BattleState` object (immutable-style — functions return new state). Key exported functions:

- `createBattleState` / `createDeploymentState` — initialize
- `placeNextUnit` / `placePlayUnit` — deployment (auto AI / manual)
- `simulateNextPhase` — advances through phases automatically
- `movePlayModels`, `rotatePlayModels`, `removePlayModels` — manual model control
- `battleCoherencyIssues`, `modelIndicesWithCoherencyIssues` — coherency validation

Battle phases in order: `deployment` → `setup` → `command` → `movement` → `shooting` → `charge` → `fight` → `battle-shock` → `end`. Each round loops from `command` onward.

Other engine modules:
- `rulesEngine.ts` — edition abstraction; 10th edition is live, 11th is a stub. **Don't add rules without sourcing them from the PDF in `rules/`.**
- `movement.ts` — `normalMoveAllowance` / `advanceAllowance`
- `coherency.ts` — unit coherency checks
- `terrainGeometry.ts` — LOS, cover, intersection maths
- `deploymentBrain.ts` — UCB1-based AI strategy for automated deployment
- `battleshock.ts` — morale/leadership effects

### Key types (`src/types/`)

`BattleState` — the entire game state:
- `phase: Phase` — current game phase
- `units: BattleUnit[]` — all deployed units
- `unplacedUnits: [UnitProfile[], UnitProfile[]]` — units yet to deploy
- `terrain: Terrain[]` — mats and features
- `objectives: Position[]`
- `scores: [number, number]`

`BattleUnit` — a unit on the table:
- `modelPositions: Position[]` — per-model coordinates (inches)
- `remainingModels`, `woundsOnLeadModel`
- `movementAction?: MovementAction` — `'remainedStationary' | 'normalMove' | 'advanced' | 'fellBack'`
- `movementAllowanceRemainingByModel?: number[]`
- `inCombat`, `battleshocked`, `charged`, `activated`, `destroyed`

### Web app (`apps/web/src/`)

`App.tsx` (~2300 lines) owns all top-level state. Three modes:
- `'editor'` — terrain layout editor
- `'simulation'` — automated AI battle
- `'play'` — manual/assisted play mode

Components:
- `Battlefield.tsx` — `<canvas>` renderer + click-to-select models
- `ArmyPanel.tsx` — unit roster and selection
- `BattleLog.tsx` — scrollable event log
- `UnitStatsPanel.tsx` — unit profile inspector
- `PracticeSaveLoadPanel.tsx` — checkpoint/branch save-load

### Persistence

Practice scenarios are saved via `apps/web/src/practice/apiPracticeScenarioRepository.ts`, which calls `/api/practice/scenarios` and falls back to `localStorage` if the API is unavailable. The server side uses Prisma + PostgreSQL (`apps/web/src/server/practice/prismaPracticeScenarioRepository.ts`).

API routes live under `apps/web/src/app/api/practice/`.

### Deployment

Docker multi-stage build (`Dockerfile`); requires `libcairo2` etc. for the `canvas` native dependency. CI (`.github/workflows/build-test-publish.yml`) publishes `timjuckett/warhammer-simulator` to Docker Hub on pushes to `main`.

The `simulator/` folder at the repo root is a **stale legacy directory** — ignore it for new work.
