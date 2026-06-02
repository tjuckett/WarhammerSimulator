import type { BattleSetup, BattleState } from '../types/battle';
import type { RulesetMetadata } from '../engine/rulesEngine';
import {
  createPracticeTimeline,
  currentTimelineState,
  type PracticeTimeline,
} from './timeline';

export const PRACTICE_SCENARIO_VERSION = 1;

export interface PracticeScenarioMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  ruleset: RulesetMetadata;
  setup?: BattleSetup;
  tags: string[];
  notes?: string;
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
  parentScenarioId?: string;
  forkedFromTimelineEntryId?: string;
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
      parentScenarioId: options.parentScenarioId,
      forkedFromTimelineEntryId: options.forkedFromTimelineEntryId,
    },
    initialState: clone(timeline.initialState),
    timeline: clone(timeline),
  };
}

export function forkScenarioAtCursor(
  scenario: PracticeScenario,
  options: CreatePracticeScenarioOptions = {},
): PracticeScenario {
  const forkState = currentTimelineState(scenario.timeline);
  const previousEntry = scenario.timeline.cursor > 0
    ? scenario.timeline.entries[scenario.timeline.cursor - 1]
    : undefined;

  return createPracticeScenario(forkState, {
    name: options.name ?? `${scenario.metadata.name} fork`,
    tags: options.tags ?? scenario.metadata.tags,
    notes: options.notes,
    parentScenarioId: scenario.metadata.id,
    forkedFromTimelineEntryId: previousEntry?.id,
    ...options,
  });
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
