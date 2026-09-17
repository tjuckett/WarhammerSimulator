import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('packages/simulator-core/src/data/terrainLayouts/11e');
const input = JSON.parse(await readFile(resolve(root, 'terrain-layouts.json'), 'utf8'));

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function rotate(point, degrees) {
  const radians = degrees * Math.PI / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function localizeFeature(feature, terrain) {
  const relative = { x: feature.x - terrain.x, y: feature.y - terrain.y };
  const local = rotate(relative, -(terrain.rotationDeg ?? 0));
  return {
    width: feature.width,
    height: feature.height,
    x: round(local.x),
    y: round(local.y),
    rotationDeg: round((feature.rotationDeg ?? 0) - (terrain.rotationDeg ?? 0)),
    featureHeight: feature.featureHeight,
    category: feature.category,
    blocksLOS: feature.blocksLOS,
    blocksMovement: feature.blocksMovement,
    difficult: feature.difficult,
  };
}

function deploymentZoneIdFor(layout) {
  if (layout.deploymentZoneId) return layout.deploymentZoneId;
  // The source's non-empty polygon pair exactly matches the shared Tipping
  // Point preset after converting from its board-centre coordinate system.
  // Earlier source exports omit zone polygons, so use the same documented
  // standard preset rather than leaving those layouts unconfigured.
  return 'tipping-point';
}

const existingShapePack = JSON.parse(await readFile(resolve(root, 'terrain-shapes.json'), 'utf8'));
const shapes = new Map(existingShapePack.shapes.map(shape => [shape.id, shape]));
const compactLayouts = await Promise.all(input.layouts.map(async layout => {
  if (Array.isArray(layout.terrainInstances) && !Array.isArray(layout.terrain)) return layout;
  const deploymentZoneId = deploymentZoneIdFor(layout);
  return {
    ...layout,
    ...(deploymentZoneId ? { deploymentZoneId } : {}),
    terrainInstances: layout.terrain.map(terrain => {
    const shape = {
      templateId: terrain.templateId ?? terrain.name,
      kind: terrain.kind,
      width: terrain.width,
      height: terrain.height,
      polygonPoints: terrain.polygonPoints,
      name: terrain.name,
      providesCover: terrain.providesCover,
      difficult: terrain.difficult,
      color: terrain.color,
      featureShape: terrain.featureShape,
      features: terrain.features?.map(feature => localizeFeature(feature, terrain)),
    };
    const fingerprint = createHash('sha1').update(JSON.stringify({
      templateId: shape.templateId,
      kind: shape.kind,
      width: shape.width,
      height: shape.height,
      polygonPoints: shape.polygonPoints,
      name: shape.name,
      providesCover: shape.providesCover,
      difficult: shape.difficult,
      color: shape.color,
      featureShape: shape.featureShape,
      features: shape.features,
    })).digest('hex').slice(0, 10);
    const id = `${shape.templateId}-${fingerprint}`;
    if (!shapes.has(id)) shapes.set(id, { id, ...shape });
    return {
      id: terrain.id,
      shapeId: id,
      x: terrain.x,
      y: terrain.y,
      rotationDeg: terrain.rotationDeg ?? 0,
      objectiveRole: terrain.objectiveRole,
      objectiveGroupId: terrain.objectiveGroupId,
    };
    }),
    terrain: undefined,
  };
}));

for (const layout of compactLayouts) delete layout.terrain;

await writeFile(resolve(root, 'terrain-shapes.json'), `${JSON.stringify({ version: 1, shapes: [...shapes.values()] }, null, 2)}\n`);
await writeFile(resolve(root, 'terrain-layouts.json'), `${JSON.stringify({ version: 1, layouts: compactLayouts }, null, 2)}\n`);
console.log(`Compacted ${input.layouts.length} layouts into ${shapes.size} reusable terrain shapes.`);
