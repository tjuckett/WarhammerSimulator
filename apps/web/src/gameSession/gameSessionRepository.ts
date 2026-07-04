import {
  apiPracticeScenarioRepository as apiGameSessionRepository,
  practiceStorageHealth as gameSessionApiStorageHealth,
  type PracticeStorageHealth,
} from '../practice/apiPracticeScenarioRepository';

export type GameSessionStorageHealth = PracticeStorageHealth;

export const gameSessionRepository = apiGameSessionRepository;
export const gameSessionStorageHealth = gameSessionApiStorageHealth;
