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
for (const file of catalogs) {
  const catalogResponse = await fetch(file.download_url, {
    headers: { 'User-Agent': 'warhammer-simulator-data-sync' },
  });
  if (!catalogResponse.ok) throw new Error(`Unable to download ${file.name}: ${catalogResponse.status}`);
  await writeFile(join(outputDirectory, file.name), await catalogResponse.arrayBuffer());
  console.log(`Downloaded ${file.name}`);
}

console.log(`Downloaded ${catalogs.length} BSData 11th-edition catalogues to ${outputDirectory}`);
