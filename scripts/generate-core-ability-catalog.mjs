import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourcePath = path.join(repoRoot, 'docs', 'core-rules', 'wahapedia', 'core-rules.md');
const outputPath = path.join(repoRoot, 'packages', 'simulator-core', 'src', 'data', 'catalogs', '11e', 'coreAbilities.json');

const source = await fs.readFile(sourcePath, 'utf8');
const start = source.indexOf('## Core Abilities 24');
const end = source.indexOf('\n## Muster Armies', start);
if (start < 0 || end < 0) throw new Error('could not find the 11th-edition Core Abilities section');

const markerPattern = /^(?<first>[^#\n]+?)\s*24\.\d{2}(?:\s*\/\s*(?<second>[^#\n]+?)\s*24\.\d{2})?\s*$/;
const ignoredMarkers = new Set(['SCOUT MOVE']);
const lines = source.slice(start, end).split(/\r?\n/);
const entries = [];
let current = null;

function cleanName(value) {
  return value
    .replace(/^\[|\]$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase());
}

function finish() {
  if (!current) return;
  const description = current.body
    .join('\n')
    .replace(/\n*SEE ALSO(?:\n- [^\n]*)*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (description) {
    for (const name of current.names) entries.push({ name, description });
  }
  current = null;
}

for (const line of lines) {
  const marker = line.match(markerPattern);
  if (marker && !ignoredMarkers.has(marker.groups.first.trim())) {
    finish();
    current = {
      names: [cleanName(marker.groups.first), ...(marker.groups.second ? [cleanName(marker.groups.second)] : [])],
      body: [],
    };
    continue;
  }
  if (!current || line.startsWith('#') || line.startsWith('<a id=')) continue;
  current.body.push(line);
}
finish();

const byName = Object.fromEntries(entries.map(entry => [entry.name, entry.description]));
await fs.writeFile(outputPath, `${JSON.stringify({ edition: '11e', source: 'docs/core-rules/wahapedia/core-rules.md', abilities: byName }, null, 2)}\n`, 'utf8');
console.log(`[core-abilities] wrote ${entries.length} ability definitions to ${path.relative(repoRoot, outputPath)}`);
