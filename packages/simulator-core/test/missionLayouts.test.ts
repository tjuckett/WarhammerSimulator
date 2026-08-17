import test from 'node:test';
import assert from 'node:assert/strict';
import { missionLayoutForBoardFormat } from '../src/data/missionLayouts';
import { objectivesForDeployment } from '../src/engine/missions';

test('standard mission layouts provide board-native objective counts', () => {
  const strikeForce = missionLayoutForBoardFormat('strike-force');
  const incursion = missionLayoutForBoardFormat('incursion');
  const combatPatrol = missionLayoutForBoardFormat('combat-patrol');

  assert.equal(strikeForce.objectives.length, 5);
  assert.equal(incursion.objectives.length, 4);
  assert.equal(combatPatrol.objectives.length, 4);
  assert.deepEqual(objectivesForDeployment('Default', 'strike-force'), strikeForce.objectives);
  assert.deepEqual(objectivesForDeployment('Dawn of War', 'incursion'), incursion.objectives);
  assert.deepEqual(objectivesForDeployment('Dawn of War', 'combat-patrol'), combatPatrol.objectives);
});
