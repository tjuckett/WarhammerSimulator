import type { PracticeScenario } from './scenarios';
import type { PracticeScenarioSummary } from './scenarioStorage';

export interface PracticeScenarioRepository {
  listSummaries(): Promise<PracticeScenarioSummary[]>;
  loadScenario(id: string): Promise<PracticeScenario | null>;
  saveScenario(scenario: PracticeScenario): Promise<PracticeScenarioSummary[]>;
  deleteScenarios(ids: string[]): Promise<PracticeScenarioSummary[]>;
}
