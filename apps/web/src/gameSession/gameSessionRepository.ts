import {
  apiPracticeScenarioRepository,
  practiceStorageHealth,
  type PracticeStorageHealth,
} from '../practice/apiPracticeScenarioRepository';

export type GameSessionStorageHealth = PracticeStorageHealth;

export const gameSessionRepository = apiPracticeScenarioRepository;
export const gameSessionStorageHealth = practiceStorageHealth;
