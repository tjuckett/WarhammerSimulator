import type { BattleSetup, BattleState } from '../types/battle';
import { battleRound } from '../engine/battleRound';
import type { RulesetMetadata } from '../engine/rulesEngine';
import { clone } from '../engine/clone';
import { createPracticeTimeline, currentTimelineState, type PracticeTimeline } from './timeline';

export const PRACTICE_SCENARIO_VERSION = 1;
export type PracticeCheckpointKind = 'play' | 'auto-phase';

const LEGACY_PLAY_CHECKPOINT_KIND = 'man' + 'ual';

export function normalizePracticeCheckpointKind(
  kind: PracticeCheckpointKind | string | undefined,
): PracticeCheckpointKind | undefined {
  if (kind === LEGACY_PLAY_CHECKPOINT_KIND) return 'play';
  return kind === 'play' || kind === 'auto-phase' ? kind : undefined;
}

export interface PracticeScenarioMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  ruleset: RulesetMetadata;
  setup?: BattleSetup;
  tags: string[];
  notes?: string;
  gameId?: string;
  branchId?: string;
  parentCheckpointId?: string;
  checkpointKind?: PracticeCheckpointKind;
  checkpointLabel?: string;
  sequence?: number;
  timelineCursor?: number;
  /** Legacy fork metadata kept so older local saves still load. */
  parentScenarioId?: string;
  forkedFromTimelineEntryId?: string;
}

export interface PracticeScenario {
  version: typeof PRACTICE_SCENARIO_VERSION;
  metadata: PracticeScenarioMetadata;
  initialState: BattleState;
  timeline: PracticeTimeline;
}

export interface CreatePracticeScenarioOptions {
  id?: string;
  name?: string;
  createdAt?: string;
  tags?: string[];
  notes?: string;
  gameId?: string;
  branchId?: string;
  parentCheckpointId?: string;
  checkpointKind?: PracticeCheckpointKind;
  checkpointLabel?: string;
  sequence?: number;
  timelineCursor?: number;
  parentScenarioId?: string;
  forkedFromTimelineEntryId?: string;
}

const PRACTICE_PHASE_ORDER: Record<string, number> = {
  setup: 0,
  deployment: 1,
  command: 2,
  movement: 3,
  shooting: 4,
  charge: 5,
  fight: 6,
  end: 7,
};

function battleProgress(state: BattleState): [number, number] {
  return [battleRound(state), PRACTICE_PHASE_ORDER[state.phase] ?? -1];
}

function compareBattleProgress(left: BattleState, right: BattleState): number {
  const [leftRound, leftPhase] = battleProgress(left);
  const [rightRound, rightPhase] = battleProgress(right);
  return leftRound - rightRound || leftPhase - rightPhase;
}

/**
 * Return the state that a saved scenario represents right now.
 *
 * Checkpoints persist a snapshot in `initialState` so they can still be
 * loaded when their optional branch-history record is unavailable (for
 * example after browser storage cleanup). Ordinary scenarios continue to
 * derive their state from the timeline.
 */
export function currentScenarioState(scenario: PracticeScenario): BattleState {
  if (!normalizePracticeCheckpointKind(scenario.metadata.checkpointKind)) {
    return currentTimelineState(scenario.timeline);
  }

  const timeline = timelineForScenario(scenario);
  if (timeline.cursor <= 0) return clone(scenario.initialState);
  const historyState = currentTimelineState(timeline);
  // Older checkpoints could contain a deployment snapshot while their branch
  // history still had the real current phase. Recover that case, but keep the
  // saved snapshot authoritative when it is at least as far into the battle;
  // new saves capture it directly from the live React state.
  return compareBattleProgress(historyState, scenario.initialState) > 0
    ? historyState
    : clone(scenario.initialState);
}

/**
 * Keep a loaded checkpoint usable when its optional timeline history is
 * incomplete. The saved snapshot remains authoritative; the missing history
 * is rebased away so the next action does not undo back to deployment.
 */
export function timelineForScenario(scenario: PracticeScenario): PracticeTimeline {
  const timeline = clone(scenario.timeline);
  if (!normalizePracticeCheckpointKind(scenario.metadata.checkpointKind)) return timeline;
  const expectedCursor = Math.max(0, scenario.metadata.timelineCursor ?? timeline.cursor);
  const hasCompleteHistory = timeline.entries.length >= expectedCursor
    && timeline.cursor <= timeline.entries.length;
  if (hasCompleteHistory) {
    const historyState = currentTimelineState(timeline);
    // A just-created checkpoint can have a newer live snapshot than the
    // timeline ref during the same React turn. Rebase in that direction; for
    // legacy saves, preserve complete history when it is ahead of deployment.
    const progressComparison = compareBattleProgress(scenario.initialState, historyState);
    if (progressComparison < 0) return timeline;
    if (progressComparison === 0 && JSON.stringify(scenario.initialState) === JSON.stringify(historyState)) {
      return timeline;
    }
  }
  return {
    ...timeline,
    initialState: clone(scenario.initialState),
    entries: [],
    cursor: 0,
    metadata: {
      ...timeline.metadata,
      rewoundFromCursor: undefined,
    },
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

export function createPracticeScenario(
  initialState: BattleState,
  options: CreatePracticeScenarioOptions = {},
): PracticeScenario {
  const createdAt = options.createdAt ?? nowIso();
  const scenarioId = options.id ?? makeId('scenario');
  const name = options.name ?? initialState.setup?.primaryMission ?? 'Untitled practice scenario';
  const timeline = createPracticeTimeline(initialState, {
    id: makeId('timeline'),
    title: name,
    createdAt,
    tags: options.tags,
    notes: options.notes,
  });
  const gameId = options.gameId ?? timeline.metadata.id;

  return {
    version: PRACTICE_SCENARIO_VERSION,
    metadata: {
      id: scenarioId,
      name,
      createdAt,
      updatedAt: createdAt,
      ruleset: clone(initialState.ruleset),
      setup: initialState.setup ? clone(initialState.setup) : undefined,
      tags: options.tags ?? [],
      notes: options.notes,
      gameId,
      branchId: options.branchId,
      parentCheckpointId: options.parentCheckpointId,
      checkpointKind: options.checkpointKind,
      checkpointLabel: options.checkpointLabel,
      sequence: options.sequence,
      timelineCursor: options.timelineCursor,
      parentScenarioId: options.parentScenarioId,
      forkedFromTimelineEntryId: options.forkedFromTimelineEntryId,
    },
    initialState: clone(initialState),
    timeline,
  };
}

export function scenarioFromTimeline(
  timeline: PracticeTimeline,
  options: CreatePracticeScenarioOptions = {},
): PracticeScenario {
  const createdAt = options.createdAt ?? nowIso();
  const name = options.name ?? timeline.metadata.title;
  const gameId = options.gameId ?? timeline.metadata.id;
  const checkpointKind = normalizePracticeCheckpointKind(options.checkpointKind);
  const savedState = checkpointKind ? currentTimelineState(timeline) : timeline.initialState;
  return {
    version: PRACTICE_SCENARIO_VERSION,
    metadata: {
      id: options.id ?? makeId('scenario'),
      name,
      createdAt,
      updatedAt: createdAt,
      ruleset: clone(timeline.metadata.ruleset),
      setup: timeline.initialState.setup ? clone(timeline.initialState.setup) : undefined,
      tags: options.tags ?? timeline.metadata.tags,
      notes: options.notes ?? timeline.metadata.notes,
      gameId,
      branchId: options.branchId,
      parentCheckpointId: options.parentCheckpointId,
      checkpointKind,
      checkpointLabel: options.checkpointLabel,
      sequence: options.sequence,
      timelineCursor: options.timelineCursor ?? timeline.cursor,
      parentScenarioId: options.parentScenarioId,
      forkedFromTimelineEntryId: options.forkedFromTimelineEntryId,
    },
    initialState: clone(savedState),
    timeline: clone(timeline),
  };
}

export function renameScenario(
  scenario: PracticeScenario,
  name: string,
  updatedAt = nowIso(),
): PracticeScenario {
  return {
    ...scenario,
    metadata: {
      ...scenario.metadata,
      name,
      updatedAt,
    },
    timeline: {
      ...scenario.timeline,
      metadata: {
        ...scenario.timeline.metadata,
        title: name,
        updatedAt,
      },
    },
  };
}
