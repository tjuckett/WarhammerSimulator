import type { PracticeScenario } from '@warhammer-simulator/core/practice/scenarios';
import type { PracticeScenarioRepository } from '@warhammer-simulator/core/practice/scenarioRepository';
import type { PracticeScenarioSummary } from '@warhammer-simulator/core/practice/scenarioStorage';
import type { BattleState } from '@warhammer-simulator/core/types/battle';
import { battleRound } from '@warhammer-simulator/core/engine/battleRound';
import {
  currentTimelineState,
  PRACTICE_TIMELINE_VERSION,
  type PracticeTimeline,
  type PracticeTimelineEntry,
} from '@warhammer-simulator/core/practice/timeline';
import { prisma } from '../db';

type StoredCheckpointKind = 'MANUAL' | 'AUTO_PHASE';

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

function checkpointKindToDb(kind: PracticeScenario['metadata']['checkpointKind']): StoredCheckpointKind {
  return kind === 'auto-phase' ? 'AUTO_PHASE' : 'MANUAL';
}

function checkpointKindFromDb(kind: StoredCheckpointKind): PracticeScenario['metadata']['checkpointKind'] {
  return kind === 'AUTO_PHASE' ? 'auto-phase' : 'play';
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

  return {
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
        branch: {
          select: {
            initialState: true,
            timelineMetadata: true,
            timelineEntries: { orderBy: { index: 'asc' } },
          },
        },
      },
    });
    return checkpoint ? scenarioFromCheckpoint(checkpoint) : null;
  },

  async saveScenario(scenario: PracticeScenario) {
    const gameId = scenario.metadata.gameId ?? scenario.timeline.metadata.id;
    const branchId = scenario.metadata.branchId ?? scenario.timeline.metadata.id;
    const sequence = scenario.metadata.sequence ?? 1;
    const timelineCursor = scenario.metadata.timelineCursor ?? scenario.timeline.cursor;
    const checkpointState = currentTimelineState(scenario.timeline);
    const now = new Date(scenario.metadata.updatedAt);

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

      await tx.practiceTimelineEntry.deleteMany({ where: { branchId } });
      if (scenario.timeline.entries.length) {
        await tx.practiceTimelineEntry.createMany({
          data: scenario.timeline.entries.map((entry, index) => ({
            id: entry.id,
            branchId,
            index,
            action: entry.action,
            stateBefore: entry.stateBefore,
            stateAfter: entry.stateAfter,
            note: entry.note,
            createdAt: new Date(entry.createdAt),
          })),
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
          metadata: metadataValue(scenario),
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
          metadata: metadataValue(scenario),
          updatedAt: now,
        },
      });
    });

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
