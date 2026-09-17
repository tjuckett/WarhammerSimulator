import test from 'node:test';
import assert from 'node:assert/strict';
import { eleventhLayoutIdsForDispositions } from '../src/engine/missions';
import { TERRAIN_LAYOUTS } from '../src/engine/terrain';
import compactLayouts from '../src/data/terrainLayouts/11e/terrain-layouts.json';
import { TERRAIN_SHAPE_TEMPLATES } from '../src/data/terrainShapes';

test('the normalized Assets vs Assets pilot replaces the matching 11e template', () => {
  const layoutId = '11e-priority-targets-vs-priority-targets-a';
  const layout = TERRAIN_LAYOUTS.find(candidate => candidate.id === layoutId);

  assert.ok(layout);
  assert.equal(layout.name, 'Assets vs Assets 01');
  assert.equal(layout.terrain.length, 16);
  assert.equal(layout.terrain.filter(terrain => terrain.type === 'ruin').length, 16);
  assert.ok(layout.terrain.every(terrain => (terrain.polygonPoints?.length ?? 0) >= 3));
  assert.equal(layout.terrain.reduce((total, terrain) => total + terrain.features.length, 0), 70);
  assert.ok(layout.terrain.flatMap(terrain => terrain.features).every(feature =>
    feature.blocksLOS && feature.blocksMovement && feature.featureHeight === 'tall'));
  const compactLayout = compactLayouts.layouts.find(candidate => candidate.id === layoutId);
  assert.ok(compactLayout);
  assert.equal(compactLayout.coordinateSystem, 'board-center');
  assert.equal(compactLayout.terrainAnchor, 'lower-left');
  assert.equal(compactLayout.terrainInstances[0].x, 0);
  assert.equal(compactLayout.terrainInstances[0].y, -3);
  assert.equal(layout.terrain[0].rotationDeg, -compactLayout.terrainInstances[0].rotationDeg);
  assert.deepEqual(
    eleventhLayoutIdsForDispositions(['priority-targets', 'priority-targets'])[0],
    layoutId,
  );
});

test('all 45 external 11e layouts use reusable terrain shape instances', () => {
  const expectedIds = compactLayouts.layouts.map(layout => layout.id);
  const layouts = expectedIds.map(id => TERRAIN_LAYOUTS.find(layout => layout.id === id));

  assert.equal(compactLayouts.layouts.length, 45);
  assert.ok(TERRAIN_SHAPE_TEMPLATES.length > 0);
  assert.ok(compactLayouts.layouts.every(layout => !('terrain' in layout)));
  assert.ok(compactLayouts.layouts.every(layout => layout.terrainInstances.length === 16));
  assert.ok(compactLayouts.layouts.every(layout => layout.terrainInstances.every(instance =>
    TERRAIN_SHAPE_TEMPLATES.some(shape => shape.id === instance.shapeId))));
  const layoutsWithSourceDeploymentZones = compactLayouts.layouts.filter(layout => layout.deploymentZoneId);
  assert.equal(layoutsWithSourceDeploymentZones.length, 45);
  assert.ok(layoutsWithSourceDeploymentZones.every(layout => typeof layout.deploymentZoneId === 'string'));
  assert.ok(new Set(layoutsWithSourceDeploymentZones.map(layout => layout.deploymentZoneId)).size > 1);
  assert.equal(layouts.filter(Boolean).length, expectedIds.length);
  assert.ok(layouts.every(layout => layout?.terrain.length === 16));
  assert.ok(layouts.every(layout => (layout?.terrain.reduce((total, terrain) => total + terrain.features.length, 0) ?? 0) > 0));
  assert.ok(layoutsWithSourceDeploymentZones.every(source =>
    TERRAIN_LAYOUTS.find(layout => layout.id === source.id)?.deploymentZones?.id === source.deploymentZoneId));
});
