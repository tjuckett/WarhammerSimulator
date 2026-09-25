import {
  timelineForScenario,
  type PracticeCheckpointKind,
  type PracticeScenario,
} from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioRepository } from '@warhammer-simulator/core/practice/scenarioRepository';
import type { PracticeScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import { battleRound } from '@warhammer-simulator/core/engine/battleRound';
import {
  PRACTICE_TIMELINE_VERSION,
  type PracticeTimeline,
  type PracticeTimelineEntry,
} from '@warhammer-simulator/core/practice/timeline';
import { prisma } from '../db';

type StoredCheckpointKind = 'MANUAL' | 'AUTO_PHASE';

// A practice save can replace a large, snapshot-backed timeline. Keep that
// one atomic write alive long enough for PostgreSQL to finish the bulk insert.
const PRACTICE_SAVE_TRANSACTION_TIMEOUT_MS = 120_000;

const CHECKPOINT_KIND_TO_DB = {
  'auto-phase': 'AUTO_PHASE',
  play: 'MANUAL',
} satisfies Record<PracticeCheckpointKind, StoredCheckpointKind>;

const CHECKPOINT_KIND_FROM_DB = {
  AUTO_PHASE: 'auto-phase',
  MANUAL: 'play',
} satisfies Record<StoredCheckpointKind, PracticeCheckpointKind>;

type StoredCheckpoint = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  gameId: string;
  branchId: string;
  parentCheckpointId: string | null;
  kind: StoredCheckpointKind;
  sequence: number;
  timelineCursor: number;
  state: unknown;
  metadata: unknown;
  game: {
    ruleset: unknown;
    setup: unknown;
  };
};

type StoredTimelineEntry = {
  id: string;
  index: number;
  action: unknown;
  stateBefore: unknown;
  stateAfter: unknown;
  note: string | null;
  createdAt: Date;
};

function databaseTimelineEntryId(branchId: string, index: number): string {
  // Timeline entry ids are generated in the browser and can be reused when a
  // checkpoint is restored or branched. Prisma's entry id is global, so make
  // the persisted key stable per branch and position instead.
  return `timeline-entry:${branchId}:${index}`;
}

function checkpointKindToDb(kind: PracticeScenario['metadata']['checkpointKind']): StoredCheckpointKind {
  return CHECKPOINT_KIND_TO_DB[kind ?? 'play'];
}

function checkpointKindFromDb(kind: StoredCheckpointKind): PracticeScenario['metadata']['checkpointKind'] {
  return CHECKPOINT_KIND_FROM_DB[kind];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function metadataValue(scenario: PracticeScenario) {
  return {
    tags: scenario.metadata.tags,
    notes: scenario.metadata.notes,
    checkpointLabel: scenario.metadata.checkpointLabel,
    parentScenarioId: scenario.metadata.parentScenarioId,
    forkedFromTimelineEntryId: scenario.metadata.forkedFromTimelineEntryId,
  };
}

function summaryFromCheckpoint(checkpoint: StoredCheckpoint): PracticeScenarioSummary {
  const kind = checkpointKindFromDb(checkpoint.kind);
  const metadata = checkpoint.metadata as Partial<PracticeScenario['metadata']> | null;
  const savedState = checkpoint.state as BattleState;
  return {
    id: checkpoint.id,
    name: checkpoint.name,
    createdAt: checkpoint.createdAt.toISOString(),
    updatedAt: checkpoint.updatedAt.toISOString(),
    ruleset: clone(checkpoint.game.ruleset),
    setup: checkpoint.game.setup ? clone(checkpoint.game.setup) : undefined,
    steps: checkpoint.timelineCursor,
    cursor: checkpoint.timelineCursor,
    gameId: checkpoint.gameId,
    branchId: checkpoint.branchId,
    parentCheckpointId: checkpoint.parentCheckpointId ?? undefined,
    checkpointKind: kind,
    checkpointLabel: metadata?.checkpointLabel ?? checkpoint.name,
    sequence: checkpoint.sequence,
    savedBattleRound: battleRound(savedState),
    savedPhase: savedState.phase,
    savedActiveArmy: savedState.activeArmy,
    savedActiveArmyName: savedState.armies[savedState.activeArmy]?.name,
    savedScores: clone(savedState.scores),
    savedCommandPoints: savedState.commandPoints ? clone(savedState.commandPoints) : undefined,
  };
}

function timelineEntryFromDb(entry: StoredTimelineEntry): PracticeTimelineEntry {
  return {
    id: entry.id,
    action: clone(entry.action),
    createdAt: entry.createdAt.toISOString(),
    stateBefore: clone(entry.stateBefore),
    stateAfter: clone(entry.stateAfter),
    note: entry.note ?? undefined,
  };
}

function scenarioFromCheckpoint(
  checkpoint: StoredCheckpoint & {
    branch: {
      initialState: unknown;
      timelineMetadata: unknown;
      timelineEntries: StoredTimelineEntry[];
    };
  },
): PracticeScenario {
  const kind = checkpointKindFromDb(checkpoint.kind);
  const metadata = checkpoint.metadata as Partial<PracticeScenario['metadata']> | null;
  const timelineMetadata = checkpoint.branch.timelineMetadata as PracticeTimeline['metadata'];
  const entries = checkpoint.branch.timelineEntries
    .sort((a, b) => a.index - b.index)
    .slice(0, checkpoint.timelineCursor)
    .map(timelineEntryFromDb);

  const scenario: PracticeScenario = {
    version: 1,
    metadata: {
      id: checkpoint.id,
      name: checkpoint.name,
      createdAt: checkpoint.createdAt.toISOString(),
      updatedAt: checkpoint.updatedAt.toISOString(),
      ruleset: clone(checkpoint.game.ruleset),
      setup: checkpoint.game.setup ? clone(checkpoint.game.setup) : undefined,
      tags: metadata?.tags ?? [],
      notes: metadata?.notes,
      gameId: checkpoint.gameId,
      branchId: checkpoint.branchId,
      parentCheckpointId: checkpoint.parentCheckpointId ?? undefined,
      checkpointKind: kind,
      checkpointLabel: metadata?.checkpointLabel ?? checkpoint.name,
      sequence: checkpoint.sequence,
      timelineCursor: checkpoint.timelineCursor,
      parentScenarioId: metadata?.parentScenarioId,
      forkedFromTimelineEntryId: metadata?.forkedFromTimelineEntryId,
    },
    initialState: clone(checkpoint.state),
    timeline: {
      version: PRACTICE_TIMELINE_VERSION,
      metadata: timelineMetadata,
      initialState: clone(checkpoint.branch.initialState),
      entries,
      cursor: checkpoint.timelineCursor,
    },
  };
  return {
    ...scenario,
    timeline: timelineForScenario(scenario),
  };
}

export const prismaPracticeScenarioRepository: PracticeScenarioRepository = {
  async listSummaries() {
    const checkpoints = await prisma.practiceCheckpoint.findMany({
      include: { game: { select: { ruleset: true, setup: true } } },
      orderBy: [
        { gameId: 'asc' },
        { sequence: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    return checkpoints.map(summaryFromCheckpoint);
  },

  async loadScenario(id: string) {
    const checkpoint = await prisma.practiceCheckpoint.findUnique({
      where: { id },
      include: {
        game: { select: { ruleset: true, setup: true } },
      },
    });
    if (!checkpoint) return null;
    const branch = await prisma.practiceBranch.findUnique({
      where: { id: checkpoint.branchId },
      select: {
        initialState: true,
        timelineMetadata: true,
      },
    });
    if (!branch) return null;
    // A checkpoint already stores its authoritative current BattleState.
    // Timeline rows each carry before/after board snapshots, so returning a
    // long branch here can turn a resume into a multi-megabyte download and
    // hundreds of JSON clones. Omit optional history on the hot load path;
    // `timelineForScenario` rebases the resumed checkpoint onto its snapshot.
    return scenarioFromCheckpoint({ ...checkpoint, branch: { ...branch, timelineEntries: [] } });
  },

  async saveScenario(scenario: PracticeScenario, timelineEntryStartIndex = 0) {
    const gameId = scenario.metadata.gameId ?? scenario.timeline.metadata.id;
    const branchId = scenario.metadata.branchId ?? scenario.timeline.metadata.id;
    const sequence = scenario.metadata.sequence ?? 1;
    const timelineCursor = scenario.metadata.timelineCursor ?? scenario.timeline.cursor;
    // The controller places the authoritative live snapshot in initialState
    // before saving. The load path uses currentScenarioState separately to
    // recover older checkpoints whose snapshot was stuck at deployment.
    const checkpointState = scenario.initialState;
    const now = new Date(scenario.metadata.updatedAt);
    const checkpointMetadata = metadataValue(scenario);
    const entryStartIndex = Math.max(0, Math.min(timelineEntryStartIndex, timelineCursor));
    const timelineEntryData = scenario.timeline.entries.map((entry, offset) => ({
      id: databaseTimelineEntryId(branchId, entryStartIndex + offset),
      branchId,
      index: entryStartIndex + offset,
      action: entry.action,
      stateBefore: entry.stateBefore,
      stateAfter: entry.stateAfter,
      note: entry.note,
      createdAt: new Date(entry.createdAt),
    }));

    await prisma.$transaction(async tx => {
      await tx.practiceGame.upsert({
        where: { id: gameId },
        create: {
          id: gameId,
          name: scenario.timeline.metadata.title,
          ruleset: scenario.metadata.ruleset,
          setup: scenario.metadata.setup ?? undefined,
          createdAt: new Date(scenario.metadata.createdAt),
          updatedAt: now,
        },
        update: {
          name: scenario.timeline.metadata.title,
          ruleset: scenario.metadata.ruleset,
          setup: scenario.metadata.setup ?? undefined,
          updatedAt: now,
        },
      });

      await tx.practiceBranch.upsert({
        where: { id: branchId },
        create: {
          id: branchId,
          gameId,
          parentCheckpointId: scenario.metadata.parentCheckpointId,
          name: scenario.timeline.metadata.title,
          initialState: scenario.timeline.initialState,
          timelineMetadata: scenario.timeline.metadata,
          createdAt: new Date(scenario.metadata.createdAt),
          updatedAt: now,
        },
        update: {
          parentCheckpointId: scenario.metadata.parentCheckpointId,
          name: scenario.timeline.metadata.title,
          initialState: scenario.timeline.initialState,
          timelineMetadata: scenario.timeline.metadata,
          updatedAt: now,
        },
      });

      // Entries before the supplied start are already persisted immutable
      // history. Replacing only the tail avoids rewriting every full board
      // snapshot on every autosave.
      await tx.practiceTimelineEntry.deleteMany({
        where: { branchId, index: { gte: entryStartIndex } },
      });
      if (timelineEntryData.length) {
        await tx.practiceTimelineEntry.createMany({
          data: timelineEntryData,
        });
      }

      await tx.practiceCheckpoint.upsert({
        where: { id: scenario.metadata.id },
        create: {
          id: scenario.metadata.id,
          gameId,
          branchId,
          parentCheckpointId: scenario.metadata.parentCheckpointId,
          kind: checkpointKindToDb(scenario.metadata.checkpointKind),
          name: scenario.metadata.name,
          sequence,
          timelineCursor,
          state: checkpointState,
          metadata: checkpointMetadata,
          createdAt: new Date(scenario.metadata.createdAt),
          updatedAt: now,
        },
        update: {
          gameId,
          branchId,
          parentCheckpointId: scenario.metadata.parentCheckpointId,
          kind: checkpointKindToDb(scenario.metadata.checkpointKind),
          name: scenario.metadata.name,
          sequence,
          timelineCursor,
          state: checkpointState,
          metadata: checkpointMetadata,
          updatedAt: now,
        },
      });
    }, { maxWait: 10_000, timeout: PRACTICE_SAVE_TRANSACTION_TIMEOUT_MS });

    return this.listSummaries();
  },

  async deleteScenarios(ids: string[]) {
    await prisma.$transaction(async tx => {
      const checkpoints = await tx.practiceCheckpoint.findMany({
        where: { id: { in: ids } },
        select: { branchId: true, gameId: true },
      });
      const branchIds = [...new Set(checkpoints.map(checkpoint => checkpoint.branchId))];
      const gameIds = [...new Set(checkpoints.map(checkpoint => checkpoint.gameId))];

      await tx.practiceCheckpoint.deleteMany({
        where: { id: { in: ids } },
      });

      if (branchIds.length) {
        await tx.practiceBranch.deleteMany({
          where: {
            id: { in: branchIds },
            checkpoints: { none: {} },
          },
        });
      }

      if (gameIds.length) {
        await tx.practiceBranch.deleteMany({
          where: {
            gameId: { in: gameIds },
            checkpoints: { none: {} },
          },
        });

        await tx.practiceGame.deleteMany({
          where: {
            id: { in: gameIds },
            branches: { none: {} },
            checkpoints: { none: {} },
          },
        });
      }
    });

    return this.listSummaries();
  },
};
