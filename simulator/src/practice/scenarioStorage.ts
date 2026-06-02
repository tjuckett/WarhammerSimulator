import type { BattleSetup } from '../types/battle';
import type { RulesetMetadata } from '../engine/rulesEngine';
import { scenarioFromTimeline, type PracticeScenario } from './scenarios';
import type { PracticeTimeline } from './timeline';

export const PRACTICE_SCENARIO_STORAGE_KEY = 'warhammer-practice-scenarios-v1';

export interface PracticeScenarioSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  ruleset: RulesetMetadata;
  setup?: BattleSetup;
  steps: number;
  cursor: number;
}

interface PracticeScenarioLibrary {
  version: 1;
  scenarios: PracticeScenario[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function emptyLibrary(): PracticeScenarioLibrary {
  return { version: 1, scenarios: [] };
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

export function isPracticeTimeline(value: unknown): value is PracticeTimeline {
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

export function scenarioFromPracticeArtifact(value: unknown): PracticeScenario | null {
  if (isPracticeScenario(value)) return clone(value);
  if (isPracticeTimeline(value)) return scenarioFromTimeline(value);
  return null;
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

function writeLibrary(library: PracticeScenarioLibrary): void {
  localStorage.setItem(PRACTICE_SCENARIO_STORAGE_KEY, JSON.stringify(library));
}

export function scenarioSummary(scenario: PracticeScenario): PracticeScenarioSummary {
  return {
    id: scenario.metadata.id,
    name: scenario.metadata.name,
    createdAt: scenario.metadata.createdAt,
    updatedAt: scenario.metadata.updatedAt,
    ruleset: clone(scenario.metadata.ruleset),
    setup: scenario.metadata.setup ? clone(scenario.metadata.setup) : undefined,
    steps: scenario.timeline.entries.length,
    cursor: scenario.timeline.cursor,
  };
}

export function loadPracticeScenarioSummaries(): PracticeScenarioSummary[] {
  return readLibrary()
    .scenarios
    .map(scenarioSummary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadPracticeScenario(id: string): PracticeScenario | null {
  const scenario = readLibrary().scenarios.find(candidate => candidate.metadata.id === id);
  return scenario ? clone(scenario) : null;
}

export function savePracticeScenario(scenario: PracticeScenario): PracticeScenarioSummary[] {
  const library = readLibrary();
  const nextScenario = clone(scenario);
  const scenarios = [
    nextScenario,
    ...library.scenarios.filter(candidate => candidate.metadata.id !== nextScenario.metadata.id),
  ];
  writeLibrary({ version: 1, scenarios });
  return loadPracticeScenarioSummaries();
}

export function savePracticeArtifact(value: unknown): {
  scenario: PracticeScenario;
  summaries: PracticeScenarioSummary[];
} | null {
  const scenario = scenarioFromPracticeArtifact(value);
  if (!scenario) return null;
  return {
    scenario,
    summaries: savePracticeScenario(scenario),
  };
}

export function deletePracticeScenario(id: string): PracticeScenarioSummary[] {
  const library = readLibrary();
  writeLibrary({
    version: 1,
    scenarios: library.scenarios.filter(candidate => candidate.metadata.id !== id),
  });
  return loadPracticeScenarioSummaries();
}
