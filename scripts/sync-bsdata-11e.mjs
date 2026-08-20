import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const owner = 'BSData';
const repository = 'wh40k-11e';
const branch = 'main';
const outputDirectory = join(process.cwd(), 'lists', 'bsdata-11e');

const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/contents?ref=${branch}`, {
  headers: { 'User-Agent': 'warhammer-simulator-data-sync' },
});
if (!response.ok) throw new Error(`Unable to list BSData files: ${response.status} ${response.statusText}`);

const files = await response.json();
const catalogs = files
  .filter(file => file.type === 'file' && file.name.endsWith('.json'))
  .sort((a, b) => a.name.localeCompare(b.name));
if (!catalogs.length) throw new Error('The BSData repository did not return any JSON catalogues.');

await mkdir(outputDirectory, { recursive: true });
const mergedEntries = new Map();
for (const file of catalogs) {
  const catalogResponse = await fetch(file.download_url, {
    headers: { 'User-Agent': 'warhammer-simulator-data-sync' },
  });
  if (!catalogResponse.ok) throw new Error(`Unable to download ${file.name}: ${catalogResponse.status}`);
  const contents = await catalogResponse.arrayBuffer();
  await writeFile(join(outputDirectory, file.name), contents);
  const catalogue = JSON.parse(new TextDecoder().decode(contents)).catalogue;
  for (const entry of catalogue?.sharedSelectionEntries ?? []) {
    if (entry.id && !mergedEntries.has(entry.id)) mergedEntries.set(entry.id, entry);
  }
  console.log(`Downloaded ${file.name}`);
}

await writeFile(join(outputDirectory, 'all-11e.json'), JSON.stringify({
  catalogue: {
    name: 'Warhammer 40,000 11th Edition - All Public Catalogues',
    sharedSelectionEntries: [...mergedEntries.values()],
  },
}, null, 2));
console.log(`Downloaded ${catalogs.length} BSData 11th-edition catalogues to ${outputDirectory}`);
console.log(`Wrote merged catalogue with ${mergedEntries.size} shared entries.`);
