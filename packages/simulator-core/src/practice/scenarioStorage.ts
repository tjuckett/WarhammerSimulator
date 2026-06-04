import type { BattleSetup } from '../types/battle';
import type { RulesetMetadata } from '../engine/rulesEngine';
import { type PracticeCheckpointKind, type PracticeScenario } from './scenarios';
import { currentTimelineState, type PracticeTimeline } from './timeline';
import type { PracticeScenarioRepository } from './scenarioRepository';

export const PRACTICE_SCENARIO_STORAGE_KEY = 'warhammer-practice-scenarios-v1';
export const PRACTICE_BRANCH_TIMELINE_STORAGE_KEY = 'warhammer-practice-branch-timelines-v1';

export interface PracticeScenarioSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  ruleset: RulesetMetadata;
  setup?: BattleSetup;
  steps: number;
  cursor: number;
  gameId?: string;
  branchId?: string;
  parentCheckpointId?: string;
  checkpointKind?: PracticeCheckpointKind;
  checkpointLabel?: string;
  sequence?: number;
}

interface PracticeScenarioLibrary {
  version: 1;
  scenarios: PracticeScenario[];
}

interface PracticeBranchTimelineLibrary {
  version: 1;
  timelines: Record<string, PracticeTimeline>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function emptyLibrary(): PracticeScenarioLibrary {
  return { version: 1, scenarios: [] };
}

function emptyTimelineLibrary(): PracticeBranchTimelineLibrary {
  return { version: 1, timelines: {} };
}

export function isPracticeScenario(value: unknown): value is PracticeScenario {
  if (!value || typeof value !== 'object') return false;
  const scenario = value as Partial<PracticeScenario>;
  return scenario.version === 1
    && !!scenario.metadata
    && typeof scenario.metadata.id === 'string'
    && typeof scenario.metadata.name === 'string'
    && !!scenario.initialState
    && !!scenario.timeline
    && Array.isArray(scenario.timeline.entries);
}

function isPracticeTimeline(value: unknown): value is PracticeTimeline {
  if (!value || typeof value !== 'object') return false;
  const timeline = value as Partial<PracticeTimeline>;
  return timeline.version === 1
    && !!timeline.metadata
    && typeof timeline.metadata.id === 'string'
    && typeof timeline.metadata.title === 'string'
    && !!timeline.initialState
    && Array.isArray(timeline.entries)
    && typeof timeline.cursor === 'number';
}

function readLibrary(): PracticeScenarioLibrary {
  try {
    const raw = localStorage.getItem(PRACTICE_SCENARIO_STORAGE_KEY);
    if (!raw) return emptyLibrary();
    const parsed = JSON.parse(raw) as Partial<PracticeScenarioLibrary>;
    if (parsed.version !== 1 || !Array.isArray(parsed.scenarios)) return emptyLibrary();
    return {
      version: 1,
      scenarios: parsed.scenarios.filter(isPracticeScenario),
    };
  } catch {
    return emptyLibrary();
  }
}

function readTimelineLibrary(): PracticeBranchTimelineLibrary {
  try {
    const raw = localStorage.getItem(PRACTICE_BRANCH_TIMELINE_STORAGE_KEY);
    if (!raw) return emptyTimelineLibrary();
    const parsed = JSON.parse(raw) as Partial<PracticeBranchTimelineLibrary>;
    if (parsed.version !== 1 || !parsed.timelines || typeof parsed.timelines !== 'object') {
      return emptyTimelineLibrary();
    }
    const timelines = Object.fromEntries(
      Object.entries(parsed.timelines).filter(([, timeline]) => isPracticeTimeline(timeline)),
    );
    return { version: 1, timelines };
  } catch {
    return emptyTimelineLibrary();
  }
}

function writeLibrary(library: PracticeScenarioLibrary): void {
  localStorage.setItem(PRACTICE_SCENARIO_STORAGE_KEY, JSON.stringify(library));
}

function writeTimelineLibrary(library: PracticeBranchTimelineLibrary): void {
  localStorage.setItem(PRACTICE_BRANCH_TIMELINE_STORAGE_KEY, JSON.stringify(library));
}

function saveBranchTimelineForScenario(scenario: PracticeScenario): void {
  const branchId = scenario.metadata.branchId;
  if (!scenario.metadata.checkpointKind || !branchId) return;
  const library = readTimelineLibrary();
  const existingTimeline = library.timelines[branchId];
  if (existingTimeline && scenario.timeline.entries.length < existingTimeline.entries.length) return;
  writeTimelineLibrary({
    version: 1,
    timelines: {
      ...library.timelines,
      [branchId]: clone(scenario.timeline),
    },
  });
}

function timelineForCheckpoint(scenario: PracticeScenario): PracticeTimeline {
  const branchId = scenario.metadata.branchId;
  const cursor = scenario.metadata.timelineCursor ?? scenario.timeline.cursor;
  if (scenario.metadata.checkpointKind && branchId) {
    const branchTimeline = readTimelineLibrary().timelines[branchId];
    if (branchTimeline) {
      const nextCursor = Math.max(0, Math.min(cursor, branchTimeline.entries.length));
      return {
        ...clone(branchTimeline),
        entries: clone(branchTimeline.entries.slice(0, nextCursor)),
        cursor: nextCursor,
      };
    }
  }
  return clone(scenario.timeline);
}

function scenarioWithStoredTimeline(scenario: PracticeScenario): PracticeScenario {
  return {
    ...scenario,
    timeline: timelineForCheckpoint(scenario),
  };
}

function compactScenarioForStorage(scenario: PracticeScenario): PracticeScenario {
  if (!scenario.metadata.checkpointKind || scenario.timeline.entries.length === 0) return scenario;
  const state = currentTimelineState(scenario.timeline);
  return {
    ...scenario,
    metadata: {
      ...scenario.metadata,
      timelineCursor: scenario.metadata.timelineCursor ?? scenario.timeline.cursor,
    },
    initialState: clone(state),
    timeline: {
      ...scenario.timeline,
      initialState: clone(state),
      entries: [],
      cursor: 0,
    },
  };
}

export function scenarioSummary(scenario: PracticeScenario): PracticeScenarioSummary {
  const parentCheckpointId = scenario.metadata.parentCheckpointId ?? scenario.metadata.parentScenarioId;
  const timelineCursor = scenario.metadata.timelineCursor ?? scenario.timeline.cursor;
  const timelineSteps = scenario.metadata.checkpointKind
    ? timelineCursor
    : scenario.timeline.entries.length;
  return {
    id: scenario.metadata.id,
    name: scenario.metadata.name,
    createdAt: scenario.metadata.createdAt,
    updatedAt: scenario.metadata.updatedAt,
    ruleset: clone(scenario.metadata.ruleset),
    setup: scenario.metadata.setup ? clone(scenario.metadata.setup) : undefined,
    steps: timelineSteps,
    cursor: timelineCursor,
    gameId: scenario.metadata.gameId ?? scenario.timeline.metadata.id,
    branchId: scenario.metadata.branchId,
    parentCheckpointId,
    checkpointKind: scenario.metadata.checkpointKind,
    checkpointLabel: scenario.metadata.checkpointLabel,
    sequence: scenario.metadata.sequence,
  };
}

export function loadPracticeScenarioSummaries(): PracticeScenarioSummary[] {
  return readLibrary()
    .scenarios
    .map(scenarioSummary)
    .sort((a, b) => {
      const gameCompare = (a.gameId ?? a.id).localeCompare(b.gameId ?? b.id);
      if (gameCompare !== 0) return gameCompare;
      const sequenceCompare = (a.sequence ?? 0) - (b.sequence ?? 0);
      if (sequenceCompare !== 0) return sequenceCompare;
      return a.createdAt.localeCompare(b.createdAt);
    });
}

export function loadPracticeScenario(id: string): PracticeScenario | null {
  const scenario = readLibrary().scenarios.find(candidate => candidate.metadata.id === id);
  return scenario ? scenarioWithStoredTimeline(clone(scenario)) : null;
}

export function savePracticeScenario(scenario: PracticeScenario): PracticeScenarioSummary[] {
  const library = readLibrary();
  saveBranchTimelineForScenario(scenario);
  const nextScenario = compactScenarioForStorage(clone(scenario));
  const scenarios = [
    nextScenario,
    ...library.scenarios
      .filter(candidate => candidate.metadata.id !== nextScenario.metadata.id)
      .map(compactScenarioForStorage),
  ];
  writeLibrary({ version: 1, scenarios });
  return loadPracticeScenarioSummaries();
}

export function deletePracticeScenario(id: string): PracticeScenarioSummary[] {
  return deletePracticeScenarios([id]);
}

export function deletePracticeScenarios(ids: string[]): PracticeScenarioSummary[] {
  const idSet = new Set(ids);
  const library = readLibrary();
  const scenarios = library.scenarios.filter(candidate => !idSet.has(candidate.metadata.id));
  writeLibrary({ version: 1, scenarios });
  const branchIds = new Set(scenarios.map(scenario => scenario.metadata.branchId).filter(Boolean));
  const timelineLibrary = readTimelineLibrary();
  const timelines = Object.fromEntries(
    Object.entries(timelineLibrary.timelines).filter(([branchId]) => branchIds.has(branchId)),
  );
  writeTimelineLibrary({ version: 1, timelines });
  return loadPracticeScenarioSummaries();
}

export const localPracticeScenarioRepository: PracticeScenarioRepository = {
  listSummaries: async () => loadPracticeScenarioSummaries(),
  loadScenario: async id => loadPracticeScenario(id),
  saveScenario: async scenario => savePracticeScenario(scenario),
  deleteScenarios: async ids => deletePracticeScenarios(ids),
};
