import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const sourcePath = resolve(root, 'docs/army-references/wahapedia/orks.md');
const rulesPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/rules/orks.json');
const factionPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/factions/orks.json');
const manifestPath = resolve(root, 'packages/simulator-core/src/data/catalogs/11e/manifest.json');
const source = await readFile(sourcePath, 'utf8');
const capturedAt = source.match(/^- Captured:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? new Date().toISOString().slice(0, 10);

const FORCE_DISPOSITIONS_BY_DETACHMENT = {
  'orks.detachment.war-horde': ['take-and-hold', 'purge-the-foe'],
  'orks.detachment.green-tide': ['take-and-hold'],
  'orks.detachment.bully-boyz': ['purge-the-foe'],
  'orks.detachment.runt-swarm': ['priority-targets'],
  'orks.detachment.shoota-boyz': ['purge-the-foe'],
  'orks.detachment.taktikal-brigade': ['take-and-hold'],
  'orks.detachment.wreckas': ['priority-targets'],
  'orks.detachment.da-big-hunt': ['purge-the-foe'],
  'orks.detachment.madcap-meks': ['disruption'],
  'orks.detachment.dread-mob': ['purge-the-foe'],
  'orks.detachment.blitz-brigade': ['take-and-hold'],
  'orks.detachment.kult-of-speed': ['reconnaissance'],
  'orks.detachment.flyboyz': ['reconnaissance'],
  'orks.detachment.brute-bosses': ['purge-the-foe'],
  'orks.detachment.wurrband': ['disruption'],
};

function slug(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function blockBetween(text, start, endPattern) {
  const rest = text.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

function prose(block) {
  return block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceInfo(section) {
  return [{
    title: `Wahapedia Orks ${section}`,
    url: 'https://wahapedia.ru/wh40k11ed/factions/orks/',
    capturedAt,
    section,
  }];
}

function ruleSelectionMetadata(name) {
  return /\s*UPGRADE$/i.test(name) ? { maximumSelections: 3 } : {};
}

function baseRule(id, name, kind, description, section, extra = {}) {
  return {
    id,
    name,
    kind,
    status: 'current',
    implementationStatus: 'display-only',
    description,
    ...extra,
    sources: sourceInfo(section),
  };
}

function parseArmyRules() {
  const bodyStart = source.indexOf('## Army rule');
  const body = blockBetween(source, bodyStart, /^## Datasheets/m);
  const sections = [...body.matchAll(/^### (.+?)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)];
  return sections.map(([, name, text]) => {
    const rule = baseRule(
      `orks.army-rule.${slug(name)}`,
      name.trim(),
      'army-rule',
      prose(text),
      name.trim(),
    );
    if (name.trim() === 'Waaagh!') {
      rule.implementationStatus = 'partial';
      rule.runtime = {
        ability: {
          timing: 'command-phase',
          target: 'none',
          oncePerBattle: true,
          armyWideOncePerBattle: true,
          effects: [{ type: 'activate-army-ability', abilityId: 'waaagh' }],
        },
      };
      rule.notes = ['Runtime activation is implemented; the refreshed riled-up effects remain source-scoped work.'];
    }
    return rule;
  });
}

function detachmentSections() {
  const start = source.indexOf('## Detachments');
  const body = source.slice(start);
  return [...body.matchAll(/^### (.+?) \((\d+) DP\)\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)]
    .map(([, name, points, text]) => ({ name: name.trim(), points: Number(points), text }));
}

function parseEnhancements(text, detachmentId, detachmentName) {
  const heading = text.indexOf('#### Enhancements');
  if (heading < 0) return [];
  const block = blockBetween(text, heading + '#### Enhancements'.length, /^#### /m);
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const choices = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^- (.+?)\s+(\d+) pts$/);
    if (!match) continue;
    const details = [];
    for (let cursor = index + 1; cursor < lines.length && !/^- .+\s+\d+ pts$/.test(lines[cursor]); cursor += 1) details.push(lines[cursor]);
    choices.push(baseRule(
      `${detachmentId}.enhancement.${slug(match[1])}`,
      match[1].trim(),
      'wargear',
      `${match[2]} pts. ${prose(details.join('\n'))}`.trim(),
      `${detachmentName} enhancements`,
      { detachmentId, ...ruleSelectionMetadata(match[1].trim()) },
    ));
  }
  return choices;
}

function parseStratagems(text, detachmentId, detachmentName) {
  const heading = text.indexOf('#### Stratagems');
  if (heading < 0) return [];
  const block = blockBetween(text, heading + '#### Stratagems'.length, /^(?:#### |### )/m);
  const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const nameMatch = lines[index].match(/^- ([A-Z0-9][A-Z0-9 '!?.-]*)$/);
    if (!nameMatch || !/^- \d+CP$/.test(lines[index + 1] ?? '')) continue;
    const name = nameMatch[1].trim();
    const cp = lines[index + 1].slice(2).trim();
    const category = lines[index + 2]?.replace(/^-\s*/, '').trim() ?? `${detachmentName} Stratagem`;
    const details = [];
    let cursor = index + 3;
    for (; cursor < lines.length; cursor += 1) {
      if (/^- [A-Z0-9][A-Z0-9 '!?.-]*$/.test(lines[cursor]) && /^- \d+CP$/.test(lines[cursor + 1] ?? '')) break;
      details.push(lines[cursor]);
    }
    entries.push(baseRule(
      `${detachmentId}.stratagem.${slug(name)}`,
      name,
      'stratagem',
      `${cp}. ${category}. ${prose(details.join('\n'))}`.trim(),
      `${detachmentName} - ${name}`,
      {
        status: 'unsupported',
        detachmentId,
        notes: ['Stored as source data until its effect is represented by the shared typed ability system.'],
      },
    ));
    index = cursor - 1;
  }
  return entries;
}

const detachments = detachmentSections();
const rules = [
  ...parseArmyRules(),
  ...detachments.flatMap(detachment => {
    const detachmentId = `orks.detachment.${slug(detachment.name)}`;
    const ruleMatch = detachment.text.match(/#### Detachment rule -- (.+?)\r?\n([\s\S]*?)(?=^#### |$(?![\s\S]))/m);
    const rule = ruleMatch
      ? baseRule(
        detachmentId,
        `${detachment.name} - ${ruleMatch[1].trim()}`,
        'detachment-rule',
        prose(ruleMatch[2]),
        detachment.name,
        {
          detachmentId,
          forceDispositions: FORCE_DISPOSITIONS_BY_DETACHMENT[detachmentId] ?? [],
          notes: [`Detachment cost: ${detachment.points} DP.`],
        },
      )
      : null;
    return [
      ...(rule ? [rule] : []),
      ...parseEnhancements(detachment.text, detachmentId, detachment.name),
      ...parseStratagems(detachment.text, detachmentId, detachment.name),
    ];
  }),
];

const faction = JSON.parse(await readFile(factionPath, 'utf8'));
faction.detachmentRefs = detachments.map(detachment => `orks.detachment.${slug(detachment.name)}`);
faction.ruleRefs = rules.filter(rule => rule.kind === 'army-rule').map(rule => rule.id);
faction.sources = (faction.sources ?? []).map(entry => ({ ...entry, capturedAt }));
await writeFile(factionPath, `${JSON.stringify(faction, null, 2)}\n`);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.catalogRevision = `${capturedAt}.1`;
manifest.sources = (manifest.sources ?? []).map(entry => ({ ...entry, capturedAt }));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(rulesPath, `${JSON.stringify({ factionId: 'orks', rules }, null, 2)}\n`);
console.log(`Normalized ${detachments.length} Ork detachments and ${rules.length} source rules.`);
