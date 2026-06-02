import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , pdfPathArg, outDirArg] = process.argv;

if (!pdfPathArg || !outDirArg) {
  console.error('Usage: node scripts/extract-base-size-guide.mjs <pdf> <out-dir>');
  process.exit(1);
}

const PAGE_GROUPS = [
  { faction: 'Adepta Sororitas', file: 'adepta-sororitas.json', pages: [14] },
  { faction: 'Adeptus Custodes', file: 'adeptus-custodes.json', pages: [15] },
  { faction: 'Adeptus Mechanicus', file: 'adeptus-mechanicus.json', pages: [16] },
  { faction: 'Adeptus Titanicus', file: 'adeptus-titanicus.json', pages: [17] },
  { faction: 'Aeldari', file: 'aeldari.json', pages: [18, 19] },
  { faction: 'Astra Militarum', file: 'astra-militarum.json', pages: [20, 21] },
  { faction: 'Black Templars', file: 'black-templars.json', pages: [22] },
  { faction: 'Blood Angels', file: 'blood-angels.json', pages: [23] },
  { faction: 'Chaos Daemons', file: 'chaos-daemons.json', pages: [24, 25] },
  { faction: 'Chaos Knights', file: 'chaos-knights.json', pages: [26] },
  { faction: 'Chaos Space Marines', file: 'chaos-space-marines.json', pages: [27, 28] },
  { faction: 'Dark Angels', file: 'dark-angels.json', pages: [29] },
  { faction: 'Death Guard', file: 'death-guard.json', pages: [30] },
  { faction: 'Deathwatch', file: 'deathwatch.json', pages: [31] },
  { faction: 'Drukhari', file: 'drukhari.json', pages: [32] },
  { faction: "Emperor's Children", file: 'emperors-children.json', pages: [33] },
  { faction: 'Genestealer Cults', file: 'genestealer-cults.json', pages: [34] },
  { faction: 'Grey Knights', file: 'grey-knights.json', pages: [35] },
  { faction: 'Imperial Agents', file: 'imperial-agents.json', pages: [36] },
  { faction: 'Imperial Knights', file: 'imperial-knights.json', pages: [37] },
  { faction: 'Leagues of Votann', file: 'leagues-of-votann.json', pages: [38] },
  { faction: 'Necrons', file: 'necrons.json', pages: [39, 40] },
  { faction: 'Orks', file: 'orks.json', pages: [41, 42] },
  { faction: 'Space Marines', file: 'space-marines.json', pages: [43, 44, 45] },
  { faction: 'Space Wolves', file: 'space-wolves.json', pages: [46] },
  { faction: "T'au Empire", file: 'tau-empire.json', pages: [47, 48] },
  { faction: 'Thousand Sons', file: 'thousand-sons.json', pages: [49] },
  { faction: 'Tyranids', file: 'tyranids.json', pages: [50, 51] },
  { faction: 'World Eaters', file: 'world-eaters.json', pages: [52] },
];

const SKIP_LINES = new Set([
  'UNIT',
  'BASE SIZE',
  'IMPERIAL ARMOUR',
  'DAEMONS',
]);

function normalizeLine(line) {
  return line
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isSkipLine(line, faction, pageNumber) {
  if (!line) return true;
  if (line === String(pageNumber)) return true;
  if (SKIP_LINES.has(line.toUpperCase())) return true;
  if (line.toUpperCase() === faction.toUpperCase()) return true;
  return false;
}

function keyForUnit(unitName) {
  return unitName
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function baseFromText(baseText) {
  const text = baseText.trim();
  const oval = text.match(/^([\d.]+)x([\d.]+)mm Oval Base$/i);
  if (oval) {
    return {
      shape: 'oval',
      widthMm: Number(oval[1]),
      lengthMm: Number(oval[2]),
      label: 'Oval Base',
    };
  }

  const round = text.match(/^([\d.]+)mm$/i);
  if (round) {
    return { shape: 'round', diameterMm: Number(round[1]) };
  }

  if (/^Hull$/i.test(text)) {
    return { shape: 'hull', widthMm: 0, lengthMm: 0, label: 'Hull' };
  }

  return { shape: 'other', label: text };
}

async function pageLines(pdf, pageNumber, faction) {
  const page = await pdf.getPage(pageNumber);
  const text = await page.getTextContent();
  return text.items
    .map(item => normalizeLine(item.str))
    .filter(line => !isSkipLine(line, faction, pageNumber));
}

async function main() {
  const pdfjsLib = await import(pathToFileURL(path.resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const pdfPath = path.resolve(pdfPathArg);
  const outDir = path.resolve(outDirArg);
  await fs.mkdir(outDir, { recursive: true });

  const data = new Uint8Array(await fs.readFile(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;

  for (const group of PAGE_GROUPS) {
    const lines = [];
    for (const page of group.pages) lines.push(...await pageLines(pdf, page, group.faction));

    const units = {};
    for (let index = 0; index < lines.length; index += 2) {
      const unit = lines[index];
      const base = lines[index + 1];
      if (!unit || !base) continue;
      units[keyForUnit(unit)] = { base: baseFromText(base) };
    }

    const output = {
      faction: group.faction,
      source: {
        title: 'Chapter Approved Tournament Companion - Base Size Guide',
        lastUpdated: 'June 2025',
        pages: group.pages,
      },
      units,
    };
    await fs.writeFile(path.join(outDir, group.file), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`${group.file}: ${Object.keys(units).length} units`);
  }
}

await main();
