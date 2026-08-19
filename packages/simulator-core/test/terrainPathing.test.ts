import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleUnit, Terrain } from '../src/types/battle';
import { findReachablePosition } from '../src/engine/simulator';
import { generateRandomLayout, terrainLayoutFromData } from '../src/engine/terrain';
import { terrainCorners } from '../src/engine/terrainGeometry';

test('terrain pathing helper is reusable and respects movement distance', () => {
  const unit = {
    id: 'pathing-unit',
    position: { x: 5, y: 5 },
    modelPositions: [{ x: 5, y: 5 }],
    profile: { keywords: [] },
  } as unknown as BattleUnit;
  const destination = findReachablePosition(unit, { x: 20, y: 5 }, 6, [], 0);

  assert.equal(destination.x, 11);
  assert.equal(destination.y, 5);
});

test('terrain pathing permits a unit already inside blocking terrain to exit', () => {
  const unit = {
    id: 'pathing-unit',
    position: { x: 6.5, y: 5 },
    modelPositions: [{ x: 6.5, y: 5 }],
    profile: { keywords: [] },
  } as unknown as BattleUnit;
  const terrain: Terrain[] = [{
    id: 'blocking-mat',
    name: 'Blocking mat',
    x: 6,
    y: 4,
    width: 2,
    height: 2,
    type: 'impassable',
    providesCover: false,
    difficult: false,
    color: '#222',
    features: [],
  }];
  const destination = findReachablePosition(unit, { x: 20, y: 5 }, 6, terrain, 0);

  assert.equal(destination.x, 12.5);
  assert.equal(destination.y, 5);
});

test('terrain conversion preserves explicit light and dense feature categories', () => {
  const layout = terrainLayoutFromData({
    id: 'categories',
    name: 'Categories',
    description: 'category test',
    terrain: [{
      kind: 'ruin', x: 0, y: 0, width: 10, height: 10,
      features: [
        { x: 1, y: 1, width: 1, height: 1, featureHeight: 'low', category: 'light' },
        { x: 2, y: 2, width: 1, height: 1, featureHeight: 'tall', category: 'dense' },
      ],
    }],
  });

  assert.deepEqual(layout.terrain[0].features.map(feature => feature.category), ['light', 'dense']);
});

test('random terrain layout keeps rotated mats and features within the Strike Force board', () => {
  const layout = generateRandomLayout();
  const points = layout.terrain.flatMap(terrain => [
    ...terrainCorners(terrain),
    ...terrain.features.flatMap(feature => terrainCorners(feature)),
  ]);

  assert.ok(points.length > 0);
  assert.ok(points.every(point => point.x >= -0.0001 && point.x <= 60.0001
    && point.y >= -0.0001 && point.y <= 44.0001));
});
