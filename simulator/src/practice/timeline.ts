import type { BattleState } from '../types/battle';
import type { RulesetMetadata } from '../engine/rulesEngine';
import { applyGameAction, type GameAction, type GameActionContext } from './actions';

export const PRACTICE_TIMELINE_VERSION = 1;

export interface PracticeTimelineMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  ruleset: RulesetMetadata;
  tags: string[];
  notes?: string;
}

export interface PracticeTimelineEntry {
  id: string;
  action: GameAction;
  createdAt: string;
  stateBefore: BattleState;
  stateAfter: BattleState;
  note?: string;
}

export interface PracticeTimeline {
  version: typeof PRACTICE_TIMELINE_VERSION;
  metadata: PracticeTimelineMetadata;
  initialState: BattleState;
  entries: PracticeTimelineEntry[];
  cursor: number;
}

export interface TimelineStateResult {
  timeline: PracticeTimeline;
  state: BattleState;
}

export interface CreatePracticeTimelineOptions {
  id?: string;
  title?: string;
  createdAt?: string;
  tags?: string[];
  notes?: string;
}

export interface AppendTimelineActionOptions {
  id?: string;
  createdAt?: string;
  note?: string;
}

export interface AppendResolvedTimelineActionOptions extends AppendTimelineActionOptions {
  stateBefore: BattleState;
  stateAfter: BattleState;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function updateMetadata(
  metadata: PracticeTimelineMetadata,
  updatedAt: string,
): PracticeTimelineMetadata {
  return { ...metadata, updatedAt };
}

export function createPracticeTimeline(
  initialState: BattleState,
  options: CreatePracticeTimelineOptions = {},
): PracticeTimeline {
  const createdAt = options.createdAt ?? nowIso();
  return {
    version: PRACTICE_TIMELINE_VERSION,
    metadata: {
      id: options.id ?? makeId('timeline'),
      title: options.title ?? 'Untitled practice timeline',
      createdAt,
      updatedAt: createdAt,
      ruleset: clone(initialState.ruleset),
      tags: options.tags ?? [],
      notes: options.notes,
    },
    initialState: clone(initialState),
    entries: [],
    cursor: 0,
  };
}

export function currentTimelineState(timeline: PracticeTimeline): BattleState {
  if (timeline.cursor <= 0) return clone(timeline.initialState);
  const entry = timeline.entries[Math.min(timeline.cursor, timeline.entries.length) - 1];
  return clone(entry?.stateAfter ?? timeline.initialState);
}

export function appendTimelineAction(
  timeline: PracticeTimeline,
  currentState: BattleState,
  action: GameAction,
  context: GameActionContext,
  options: AppendTimelineActionOptions = {},
): TimelineStateResult {
  const createdAt = options.createdAt ?? nowIso();
  const stateBefore = clone(currentState);
  const stateAfter = applyGameAction(currentState, action, context);
  const entry: PracticeTimelineEntry = {
    id: options.id ?? makeId('entry'),
    action: {
      ...clone(action),
      createdAt: action.createdAt ?? createdAt,
    },
    createdAt,
    stateBefore,
    stateAfter: clone(stateAfter),
    note: options.note,
  };
  const entries = [
    ...timeline.entries.slice(0, timeline.cursor),
    entry,
  ];

  return {
    timeline: {
      ...timeline,
      metadata: updateMetadata(timeline.metadata, createdAt),
      entries,
      cursor: entries.length,
    },
    state: clone(stateAfter),
  };
}

export function appendResolvedTimelineAction(
  timeline: PracticeTimeline,
  action: GameAction,
  options: AppendResolvedTimelineActionOptions,
): PracticeTimeline {
  const createdAt = options.createdAt ?? nowIso();
  const entry: PracticeTimelineEntry = {
    id: options.id ?? makeId('entry'),
    action: {
      ...clone(action),
      createdAt: action.createdAt ?? createdAt,
    },
    createdAt,
    stateBefore: clone(options.stateBefore),
    stateAfter: clone(options.stateAfter),
    note: options.note,
  };
  const entries = [
    ...timeline.entries.slice(0, timeline.cursor),
    entry,
  ];

  return {
    ...timeline,
    metadata: updateMetadata(timeline.metadata, createdAt),
    entries,
    cursor: entries.length,
  };
}

export function undoTimeline(timeline: PracticeTimeline): TimelineStateResult {
  if (timeline.cursor <= 0) {
    return { timeline, state: clone(timeline.initialState) };
  }

  const entry = timeline.entries[timeline.cursor - 1];
  return {
    timeline: {
      ...timeline,
      cursor: timeline.cursor - 1,
    },
    state: clone(entry.stateBefore),
  };
}

export function redoTimeline(timeline: PracticeTimeline): TimelineStateResult {
  if (timeline.cursor >= timeline.entries.length) {
    return { timeline, state: currentTimelineState(timeline) };
  }

  const entry = timeline.entries[timeline.cursor];
  return {
    timeline: {
      ...timeline,
      cursor: timeline.cursor + 1,
    },
    state: clone(entry.stateAfter),
  };
}

export function seekTimeline(
  timeline: PracticeTimeline,
  cursor: number,
): TimelineStateResult {
  const nextCursor = Math.max(0, Math.min(cursor, timeline.entries.length));
  if (nextCursor === 0) {
    return {
      timeline: { ...timeline, cursor: nextCursor },
      state: clone(timeline.initialState),
    };
  }

  return {
    timeline: { ...timeline, cursor: nextCursor },
    state: clone(timeline.entries[nextCursor - 1].stateAfter),
  };
}

export function replayTimeline(
  timeline: PracticeTimeline,
  context: GameActionContext,
  preferSnapshots = true,
): BattleState {
  let state = clone(timeline.initialState);
  const entries = timeline.entries.slice(0, timeline.cursor);

  for (const entry of entries) {
    state = preferSnapshots
      ? clone(entry.stateAfter)
      : applyGameAction(state, entry.action, context);
  }

  return state;
}
