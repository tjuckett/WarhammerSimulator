import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const [inputArgument, outputArgument, layoutIdArgument] = process.argv.slice(2);

if (!inputArgument || !outputArgument || !layoutIdArgument) {
  throw new Error('Usage: node scripts/normalize-terrain-layout.mjs <source.json> <output.json> <layout-id>');
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const source = JSON.parse(await readFile(inputPath, 'utf8'));

const BOARD_WIDTH = 60;
const BOARD_HEIGHT = 44;
const VALID_TERRAIN_KINDS = new Set(['ruin', 'obstacle', 'area', 'impassable']);

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function pointKey(point) {
  return `${point.x}:${point.y}`;
}

function normalizedPolygon(points) {
  const normalized = [];
  for (const point of points ?? []) {
    const next = { x: round(point.x), y: round(point.y) };
    if (!normalized.length || pointKey(normalized[normalized.length - 1]) !== pointKey(next)) {
      normalized.push(next);
    }
  }
  if (normalized.length > 1 && pointKey(normalized[0]) === pointKey(normalized[normalized.length - 1])) {
    normalized.pop();
  }
  return normalized;
}

function terrainColor(kind) {
  if (kind === 'obstacle') return 'rgba(140,120,95,0.9)';
  if (kind === 'area') return 'rgba(25,85,30,0.75)';
  if (kind === 'impassable') return 'rgba(90,70,70,0.9)';
  return 'rgba(110,85,60,0.85)';
}

function rotate(point, degrees) {
  const radians = degrees * Math.PI / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;
}

function sourceWallFeatures(ruin) {
  const parentOrigin = ruin.footprint.origin;
  const parentRotation = Number(ruin.footprint.rotationDeg ?? 0);
  const features = [];

  for (const part of ruin.ruinParts ?? []) {
    const partOrigin = part.origin ?? { x: 0, y: 0 };
    const partRotation = Number(part.rotationDeg ?? 0);
    for (const wall of part.walls ?? []) {
      const points = wall.points ?? [];
      const thickness = Number(wall.thicknessIn ?? 0.5);
      const closed = points.length > 2 && samePoint(points[0], points[points.length - 1]);
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const localStart = add(partOrigin, rotate(start, partRotation));
        const localEnd = add(partOrigin, rotate(end, partRotation));
        const worldStart = add(parentOrigin, rotate(localStart, parentRotation));
        const worldEnd = add(parentOrigin, rotate(localEnd, parentRotation));
        const dx = worldEnd.x - worldStart.x;
        const dy = worldEnd.y - worldStart.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) continue;
        const rotationDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        const direction = { x: dx / length, y: dy / length };
        const joinsAtStart = index > 0 || closed;
        const joinsAtEnd = index + 2 < points.length || closed;
        // The source wall path is center-aligned. Store the lower-left pivot
        // of a thin rectangular segment in the same Cartesian convention as
        // the parent footprint. Extend only joined ends by half its thickness
        // so corners connect while free endpoints remain flush.
        const normal = { x: -Math.sin(rotationDeg * Math.PI / 180), y: Math.cos(rotationDeg * Math.PI / 180) };
        const extendedStart = {
          x: worldStart.x - direction.x * (joinsAtStart ? thickness / 2 : 0),
          y: worldStart.y - direction.y * (joinsAtStart ? thickness / 2 : 0),
        };
        features.push({
          x: round(extendedStart.x - normal.x * thickness / 2),
          y: round(extendedStart.y - normal.y * thickness / 2),
          width: round(length + (joinsAtStart ? thickness / 2 : 0) + (joinsAtEnd ? thickness / 2 : 0)),
          height: round(thickness),
          rotationDeg: round(rotationDeg),
          featureHeight: 'tall',
          category: part.material === 'light' ? 'light' : 'dense',
          blocksLOS: true,
          blocksMovement: true,
          difficult: false,
          name: `${part.name ?? ruin.name ?? 'Ruin'} wall ${features.length + 1}`,
        });
      }
    }
  }
  return features;
}

function normalizeRuin(ruin) {
  const footprint = ruin.footprint;
  if (!footprint?.origin || !Number.isFinite(footprint.widthIn) || !Number.isFinite(footprint.heightIn)) {
    throw new Error(`Ruin ${ruin.name ?? ruin.id ?? '<unnamed>'} has no usable footprint.`);
  }

  const kind = VALID_TERRAIN_KINDS.has(ruin.terrainKind) ? ruin.terrainKind : 'ruin';
  const width = Number(footprint.widthIn);
  const height = Number(footprint.heightIn);
  const polygonPoints = normalizedPolygon(ruin.outline?.points);
  const features = sourceWallFeatures(ruin);

  return {
    templateId: ruin.templateId ?? ruin.name,
    kind,
    // Preserve the source convention: x/y are the lower-left outline pivot
    // measured from the center of the battlefield, with positive Y upward.
    x: round(Number(footprint.origin.x)),
    y: round(Number(footprint.origin.y)),
    width: round(width),
    height: round(height),
    rotationDeg: round(Number(footprint.rotationDeg ?? 0)),
    ...(polygonPoints.length >= 3 ? { polygonPoints } : {}),
    name: ruin.name ?? `External ${kind}`,
    providesCover: kind !== 'area',
    difficult: kind === 'area',
    color: terrainColor(kind),
    ...(features.length ? { features } : { featureShape: 'none' }),
  };
}

if (!Array.isArray(source.ruins) || source.ruins.length === 0) {
  throw new Error('The source file does not contain any ruins.');
}

const normalized = {
  id: layoutIdArgument,
  name: source.terrainLayoutName ?? basename(inputPath, '.json'),
  coordinateSystem: 'board-center',
  terrainAnchor: 'lower-left',
  boardWidth: BOARD_WIDTH,
  boardHeight: BOARD_HEIGHT,
  description: [
    `Normalized from ${basename(inputPath)} (${source.presetId ?? 'external'} source).`,
    'The raw source remains authoritative for ruin parts, roofs, and 3D placement metadata; this pilot maps top-level footprints into the current 2D terrain model.',
  ].join(' '),
  terrain: source.ruins.map(normalizeRuin),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(normalized, null, 2)}\n`);
console.log(`Normalized ${source.ruins.length} terrain pieces from ${inputPath} to ${outputPath}.`);
