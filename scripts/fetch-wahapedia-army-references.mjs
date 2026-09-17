import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const origin = 'https://wahapedia.ru';
const editionPath = '/wh40k11ed';
const outputDir = path.join(repoRoot, 'docs', 'army-references', 'wahapedia');
const cacheDir = path.join(repoRoot, '.tmp', 'wahapedia-army-reference-cache', '11e');
const localSitemapPath = path.join(repoRoot, '.tmp', 'wahapedia-11e-sitemap.xml');
const captureDate = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const keepCache = args.includes('--keep-cache');
const skipIndex = args.includes('--no-index');
const parsedDelayMs = Number(readOption('--delay-ms', '4500'));
const delayMs = Number.isFinite(parsedDelayMs) ? Math.max(0, parsedDelayMs) : 4500;
const requestedFactions = readOption('--factions', '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function log(message) {
  console.log(`[wahapedia] ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchGet(url, cachePath, label) {
  if (!refresh && await exists(cachePath)) {
    log(`cache hit: ${label}`);
    return fs.readFile(cachePath, 'utf8');
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      log(`GET ${label} (attempt ${attempt}/3)`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'user-agent': 'WarhammerSimulator-reference-export/1.0 (GET-only; sequential; cached)',
        },
      });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      if (!body.toLowerCase().includes('<html')) {
        throw new Error('response did not look like an HTML page');
      }

      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, body, 'utf8');
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        const backoff = Math.min(60000, 15000 * 2 ** (attempt - 1));
        log(`${label} failed: ${error.message}; backing off ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
  }

  throw new Error(`${label} failed after retries: ${lastError?.message ?? 'unknown error'}`);
}

function factionRootsFromSitemap(xml) {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
  const roots = new Map();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const editionIndex = segments.indexOf('wh40k11ed');
      if (editionIndex < 0 || segments[editionIndex + 1] !== 'factions') continue;
      const faction = segments[editionIndex + 2];
      if (!faction || segments.length !== editionIndex + 3) continue;
      roots.set(faction.toLowerCase(), `${origin}${editionPath}/factions/${faction}`);
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return [...roots.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function neutralizeScripts(html) {
  return html
    .replace(/<script\b/gi, '<x-script')
    .replace(/<\/script\s*>/gi, '</x-script>');
}

function escapeCell(value) {
  return ascii(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function ascii(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‑−]/g, '-')
    .replace(/⌀/g, 'diameter ')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function headingCase(value) {
  return ascii(value)
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function anchorFor(value) {
  return ascii(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatBase(value) {
  const text = ascii(value);
  return text || '--';
}

function formatItems(items, indent = '') {
  const output = [];
  for (const item of items ?? []) {
    const lines = ascii(item).split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const first = lines.shift().replace(/^[-*]\s+/, '');
    output.push(`${indent}- ${first}`);
    for (const line of lines) {
      if (line.startsWith('- ')) output.push(`${indent}  ${line}`);
      else output.push(`${indent}  ${line}`);
    }
  }
  return output;
}

function renderRuleBlocks(blocks, indent = '') {
  const output = [];
  for (const block of blocks ?? []) {
    if (block.title) output.push(`${indent}### ${ascii(block.title)}`);
    output.push(...formatItems([block.text], indent));
    if (output.length && output[output.length - 1] !== '') output.push('');
  }
  return output;
}

function renderUnit(unit, factionSlug) {
  const output = [];
  output.push(`### ${ascii(unit.name)}`);
  output.push(`- **Role:** ${ascii(unit.role || 'Unknown')}`);
  output.push(`- **Wahapedia slug:** [${ascii(unit.slug)}](${unit.url})`);
  output.push(`- **Source label:** ${ascii(unit.sourceLabel || 'Faction Pack')}`);
  output.push(`- **Base size(s) shown:** ${unit.baseSizes.length ? unit.baseSizes.map(formatBase).join('; ') : '--'}`);
  output.push('');

  output.push('#### Profiles');
  output.push('| Model | Base | M | T | Sv | W | Ld | OC | Invulnerable save |');
  output.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const profile of unit.profiles) {
    output.push(`| ${escapeCell(profile.model)} | ${escapeCell(profile.base)} | ${escapeCell(profile.stats.M)} | ${escapeCell(profile.stats.T)} | ${escapeCell(profile.stats.SV)} | ${escapeCell(profile.stats.W)} | ${escapeCell(profile.stats.LD)} | ${escapeCell(profile.stats.OC)} | ${escapeCell(profile.invulnerable)} |`);
  }
  if (!unit.profiles.length) output.push('| -- | -- | -- | -- | -- | -- | -- | -- | -- |');
  output.push('');

  output.push('#### Weapons');
  output.push('| Type | Applies to | Weapon | Weapon keywords | Range | A | BS/WS | S | AP | D |');
  output.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|');
  for (const weapon of unit.weapons) {
    output.push(`| ${escapeCell(weapon.type)} | -- | ${escapeCell(weapon.name)} | ${escapeCell(weapon.keywords || '--')} | ${escapeCell(weapon.range)} | ${escapeCell(weapon.attacks)} | ${escapeCell(weapon.skill)} | ${escapeCell(weapon.strength)} | ${escapeCell(weapon.ap)} | ${escapeCell(weapon.damage)} |`);
  }
  if (!unit.weapons.length) output.push('| -- | -- | -- | -- | -- | -- | -- | -- | -- | -- |');
  output.push('');

  for (const section of unit.sections) {
    const normalizedHeading = ascii(section.heading).toUpperCase();
    if (normalizedHeading === 'STRATAGEMS' || normalizedHeading === 'DETACHMENT ABILITY') continue;
    if (!section.items.length) continue;
    const heading = normalizedHeading === 'ABILITIES' ? 'Abilities' : headingCase(section.heading);
    output.push(`#### ${heading}`);
    if (normalizedHeading === 'ABILITIES') output.push('**ABILITIES:**');
    output.push(...formatItems(section.items));
    output.push('');
  }

  if (unit.featureEnhancements.length) {
    output.push('#### Enhancements');
    for (const enhancement of unit.featureEnhancements) {
      const points = enhancement.points ? ` ${ascii(enhancement.points)} pts` : '';
      output.push(`- ${ascii(enhancement.name)}${points}`);
    }
    output.push('');
  }

  output.push('#### Points');
  if (unit.costs.length) {
    for (const cost of unit.costs) {
      output.push(`- ${ascii(cost.group)}: ${ascii(cost.label)} -- **${ascii(cost.points)} pts**`);
    }
  } else {
    output.push('- --');
  }
  output.push('');

  output.push('#### Keywords');
  if (unit.unitKeywords) output.push(`- **Unit:** ${ascii(unit.unitKeywords)}`);
  if (unit.factionKeywords) output.push(`- **Faction keywords:** ${ascii(unit.factionKeywords)}`);
  if (!unit.unitKeywords && !unit.factionKeywords) output.push('- --');
  output.push('');

  return output;
}

function renderFaction(faction, root, datasheets) {
  const output = [];
  const displayName = ascii(faction.name);
  const rootUrl = faction.rootUrl;
  const dataUrl = `${rootUrl}/datasheets.html`;
  const units = datasheets.units;

  output.push(`# ${displayName} -- Wahapedia reference`);
  output.push('');
  output.push('## Scope');
  output.push('');
  output.push(`- Edition: Warhammer 40,000 11th edition.`);
  output.push(`- Captured: ${captureDate}.`);
  output.push(`- Sources: [faction rules](${rootUrl}/), [datasheets](${dataUrl}).`);
  output.push('- Main one-level faction page only; subfaction pages, Crusade, Boarding Actions, and FAQ/errata history are not expanded here.');
  output.push('- Legends datasheets are excluded. Forge World datasheets remain when they are non-Legends entries on the faction datasheet page.');
  output.push(`- Coverage: ${datasheets.currentCount} current datasheets (${datasheets.forgeWorldCount} Forge World); ${datasheets.legendaryCount} Legends datasheets excluded.`);
  output.push('');

  output.push('## Unit index');
  output.push('');
  const grouped = new Map();
  for (const unit of units) {
    const role = unit.role || 'Unknown';
    if (!grouped.has(role)) grouped.set(role, []);
    grouped.get(role).push(unit);
  }
  for (const [role, roleUnits] of grouped) {
    output.push(`### ${ascii(role)}`);
    output.push('');
    output.push(roleUnits.map((unit) => `[${ascii(unit.name)}](#${anchorFor(unit.name)})`).join(' / '));
    output.push('');
  }

  output.push('## Army rule');
  output.push('');
  if (root.armyRules.length) output.push(...renderRuleBlocks(root.armyRules));
  else output.push('- No matched-play army rule block was found by the exporter.');
  output.push('');

  output.push('## Datasheets');
  output.push('');
  for (const unit of units) output.push(...renderUnit(unit, faction.slug));

  output.push('## Detachments');
  output.push('');
  for (const detachment of root.detachments) {
    const points = detachment.dp ? ` (${ascii(detachment.dp)} DP)` : '';
    output.push(`### ${ascii(detachment.name)}${points}`);
    if (detachment.rules.length) {
      for (const rule of detachment.rules) {
        output.push(`#### Detachment rule -- ${ascii(rule.title)}`);
        output.push(...formatItems([rule.text]));
      }
      output.push('');
    }
    if (detachment.enhancements.length) {
      output.push('#### Enhancements');
      for (const enhancement of detachment.enhancements) {
        output.push(`- ${ascii(enhancement.name)}${enhancement.points ? ` ${ascii(enhancement.points)} pts` : ''}`);
        if (enhancement.text) output.push(...formatItems([enhancement.text]));
      }
      output.push('');
    }
    if (detachment.stratagems.length) {
      output.push('#### Stratagems');
      for (const stratagem of detachment.stratagems) {
        output.push(`- ${ascii(stratagem.name)}`);
        if (stratagem.cp) output.push(`- ${ascii(stratagem.cp)}`);
        if (stratagem.type) output.push(`- ${ascii(stratagem.type)}`);
        if (stratagem.text) output.push(...formatItems([stratagem.text]));
      }
      output.push('');
    }
  }

  output.push('## Extraction audit');
  output.push('');
  output.push(`- Datasheet blocks found: ${datasheets.totalCount}.`);
  output.push(`- Current units written: ${datasheets.currentCount}.`);
  output.push(`- Legends blocks skipped: ${datasheets.legendaryCount}.`);
  output.push(`- Units without a role in the page index: ${datasheets.missingRoleCount}.`);
  output.push(`- Units without a profile table: ${datasheets.missingProfileCount}.`);
  output.push(`- Detachments written: ${root.detachments.length}.`);
  output.push('');

  return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function renderIndex(entries) {
  const output = [
    '# Wahapedia 11th-edition army references',
    '',
    `Captured: ${captureDate}.`,
    '',
    'These files are normalized handoff references for later simulator integration. They cover the main faction pages listed in Wahapedia\'s published 11th-edition sitemap. Legends datasheets and FAQ/errata history are omitted; current page text is treated as the active rule text.',
    '',
    '| Faction | Reference | Current datasheets | Forge World | Legends excluded | Detachments | Status |',
    '|---|---|---:|---:|---:|---:|---|',
  ];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    output.push(`| ${escapeCell(entry.name)} | [${entry.file}](${entry.file}) | ${entry.currentCount ?? '--'} | ${entry.forgeWorldCount ?? '--'} | ${entry.legendaryCount ?? '--'} | ${entry.detachmentCount ?? '--'} | ${escapeCell(entry.status)} |`);
  }
  output.push('');
  output.push('The collector uses sequential GET requests with local caching and backoff. It does not submit forms or make POST, PUT, PATCH, or DELETE requests.');
  output.push('');
  return output.join('\n');
}

async function parseRootPage(page, html, slug, rootUrl) {
  await page.setContent(neutralizeScripts(html), { waitUntil: 'domcontentloaded', timeout: 180000 });
  return page.evaluate(({ slug: factionSlug, root }) => {
    const removeSelectors = 'script,style,.tooltip_templates,.noprint,.ShowFluff,.legend2,.faqErrataColumns,.faqErrataStrat,.faqErrataSpoiler,.faq';

    function normalize(value) {
      return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\u200b/g, '')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function walk(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const element = node;
      if (element.matches(removeSelectors)) return '';
      if (element.tagName === 'BR') return '\n';
      const content = [...element.childNodes].map(walk).join('');
      if (element.tagName === 'LI') return `\n- ${content}\n`;
      if (['DIV', 'P', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) return `\n${content}\n`;
      return content;
    }

    function clean(node) {
      return normalize(walk(node));
    }

    function isFaq(node) {
      return Boolean(node?.closest('.faqErrataColumns,.faqErrataStrat,.faqErrataSpoiler,.faq'));
    }

    function headingWithoutPoints(node) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('.dpPts').forEach((child) => child.remove());
      return clean(clone);
    }

    function bodyWithoutHeading(block, heading) {
      const clone = block.cloneNode(true);
      clone.querySelectorAll('h2,h3,h4,a[name]').forEach((child) => child.remove());
      if (heading?.id) clone.querySelectorAll(`#${CSS.escape(heading.id)}`).forEach((child) => child.remove());
      return clean(clone);
    }

    function ruleBlocks(container) {
      if (!container) return [];
      return [...container.querySelectorAll('h3[class*="dsColorGrad"]')]
        .filter((heading) => !isFaq(heading) && heading.textContent.trim().toUpperCase() !== 'KEYWORDS')
        .map((heading) => {
          const block = heading.closest('.BreakInsideAvoid') || heading.parentElement;
          return { title: clean(heading), text: bodyWithoutHeading(block, heading) };
        })
        .filter((block) => block.title && block.text);
    }

    function siblingHeadingRules(armyHeading) {
      if (!armyHeading) return [];
      const detachmentSection = [...main.children].find((child) =>
        child.classList.contains('clFl') && child.querySelector('h2.outline_header'),
      );
      const headings = [...main.querySelectorAll('h2')]
        .filter((heading) => heading !== armyHeading && !isFaq(heading))
        .filter((heading) => !detachmentSection || Boolean(heading.compareDocumentPosition(detachmentSection) & Node.DOCUMENT_POSITION_FOLLOWING))
        .filter((heading) => Boolean(armyHeading.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING));
      const results = [];
      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const nextHeading = headings[index + 1];
        const range = document.createRange();
        range.setStartAfter(heading);
        if (nextHeading) range.setEndBefore(nextHeading);
        else if (detachmentSection) range.setEndBefore(detachmentSection);
        else continue;
        const wrapper = document.createElement('div');
        wrapper.append(range.cloneContents());
        const text = clean(wrapper);
        if (clean(heading) && text) results.push({ title: clean(heading), text });
      }
      return results;
    }

    function h2ByText(container, pattern) {
      return [...container.querySelectorAll('h2')].find((heading) => !isFaq(heading) && pattern.test(clean(heading)));
    }

    function before(first, second) {
      if (!first || !second || first === second) return true;
      return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    function parseEnhancements(section) {
      const header = h2ByText(section, /^Enhancements$/i);
      if (!header) return [];
      const parent = header.closest('.BreakInsideAvoid') || header.parentElement;
      const results = [];
      for (const entry of parent.querySelectorAll('.EnhancementsPts')) {
        const li = entry.querySelector('li');
        const spans = li ? [...li.children].filter((child) => child.tagName !== 'BR') : [];
        const name = spans[0] ? clean(spans[0]) : clean(li || entry);
        const points = spans[1] ? clean(spans[1]).replace(/\s*pts?$/i, '') : '';
        const wrapper = entry.closest('.BreakInsideAvoid') || entry.parentElement;
        const text = [...wrapper.querySelectorAll('p')]
          .filter((paragraph) => !paragraph.matches('.ShowFluff,.legend2'))
          .map(clean)
          .filter(Boolean)
          .join('\n');
        if (name && !results.some((item) => item.name === name && item.points === points)) results.push({ name, points, text });
      }
      return results;
    }

    function parseStratagems(section) {
      return [...section.querySelectorAll('.str11Wrap')]
        .filter((stratagem) => !isFaq(stratagem))
        .map((stratagem) => {
          const body = stratagem.querySelector('.str11Text') || stratagem.querySelector('.str11TextWrap');
          const clone = body?.cloneNode(true);
          clone?.querySelectorAll('.str11Type,.ShowFluff,.legend2').forEach((child) => child.remove());
          return {
            name: clean(stratagem.querySelector('.str11Name')),
            cp: clean(stratagem.querySelector('.str11CP')),
            type: clean(stratagem.querySelector('.str11Type')),
            text: clone ? clean(clone) : '',
          };
        })
        .filter((stratagem) => stratagem.name);
    }

    const main = document.querySelector('#wahMainContent') || document.body;
    const name = clean(document.querySelector('h1.page_header')) || factionSlug;
    const armyHeading = main.querySelector('h2#Army-Rules') || [...main.querySelectorAll('h2')].find((heading) => heading.id === 'Army-Rules');
    const armyContainer = armyHeading?.nextElementSibling;
    const armyRules = ruleBlocks(armyContainer).length ? ruleBlocks(armyContainer) : siblingHeadingRules(armyHeading);
    const detachments = [];

    for (const section of [...main.children]) {
      if (!section.classList.contains('clFl') || section.classList.contains('sCrusadeRules') || section.classList.contains('sShowBoardingActions')) continue;
      const heading = [...section.children].find((child) => child.matches?.('h2.outline_header'));
      if (!heading) continue;
      const detachment = {
        name: headingWithoutPoints(heading),
        dp: clean(heading.querySelector('.dpPts')).replace(/[^0-9]/g, ''),
        rules: [],
        enhancements: parseEnhancements(section),
        stratagems: parseStratagems(section),
      };
      const detachmentHeader = h2ByText(section, /^Detachment Rules?$/i);
      const enhancementHeader = h2ByText(section, /^Enhancements$/i);
      const stratagemHeader = h2ByText(section, /^Stratagems$/i);
      const candidates = [...section.querySelectorAll('h3[class*="dsColorGrad"]')]
        .filter((candidate) => !isFaq(candidate) && before(detachmentHeader || candidate, candidate))
        .filter((candidate) => before(candidate, enhancementHeader || stratagemHeader));
      for (const candidate of candidates) {
        const block = candidate.closest('.BreakInsideAvoid') || candidate.parentElement;
        const text = bodyWithoutHeading(block, candidate);
        if (text) detachment.rules.push({ title: clean(candidate), text });
      }
      detachments.push(detachment);
    }

    return { slug: factionSlug, name, root, armyRules, detachments };
  }, { slug, root: rootUrl });
}

async function parseDatasheetPage(page, html, slug, rootUrl) {
  await page.setContent(neutralizeScripts(html), { waitUntil: 'domcontentloaded', timeout: 240000 });
  return page.evaluate(({ factionSlug, root }) => {
    const removeSelectors = 'script,style,.tooltip_templates,.noprint,.ShowFluff,.legend2,.faqErrataColumns,.faqErrataStrat,.faqErrataSpoiler,.faq';
    const canonicalStats = ['M', 'T', 'SV', 'W', 'LD', 'OC'];

    function normalize(value) {
      return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\u200b/g, '')
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function walk(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const element = node;
      if (element.matches(removeSelectors)) return '';
      if (element.tagName === 'BR') return '\n';
      const content = [...element.childNodes].map(walk).join('');
      if (element.tagName === 'LI') return `\n- ${content}\n`;
      if (['DIV', 'P', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) return `\n${content}\n`;
      return content;
    }

    function clean(node) {
      return normalize(walk(node));
    }

    function noKeywords(node) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('.kwbw').forEach((child) => child.remove());
      return clean(clone);
    }

    function sourceLabel(block) {
      if (block.classList.contains('sLegendary')) return 'Warhammer Legends';
      if (block.classList.contains('sForgeWorld')) return 'Forge World';
      return [...block.querySelectorAll('img[title]')]
        .map((image) => image.title)
        .find((title) => /Faction Pack/i.test(title)) || 'Faction Pack';
    }

    function unitHeader(block) {
      const header = block.querySelector('.dsH2Header');
      const directName = [...header?.children || []].find((child) => child.tagName === 'DIV' && !child.classList.contains('dsIconsWide'));
      const name = clean(directName || header);
      const bases = [...header?.querySelectorAll('.dsModelBase2,.dsModelBase') || []].map(clean).filter(Boolean);
      return { name, bases };
    }

    function parseProfiles(block, name) {
      const banner = block.querySelector('.dsBannerWrap');
      if (!banner) return [];
      const entries = [];
      let current;
      for (const child of banner.children) {
        if (child.classList.contains('dsProfileBaseWrap')) {
          const profile = child.querySelector('.dsProfileWrap');
          const values = [...profile?.querySelectorAll('.dsCharWrap') || []].map((wrap) => ({
            label: clean(wrap.querySelector('.dsCharName')),
            value: clean(wrap.querySelector('.dsCharValue') || wrap),
          }));
          const model = clean(child.querySelector('.dsModelName')) || name;
          const base = clean(child.querySelector('.dsModelBase'));
          current = { model, base, values, stats: {}, invulnerable: '--' };
          entries.push(current);
        } else if (child.classList.contains('dsInvulWrap') && current) {
          current.invulnerable = clean(child.querySelector('.dsCharInvulValue') || child) || '--';
        }
      }
      const labels = entries.flatMap((entry) => entry.values.map((value) => value.label)).filter(Boolean);
      const statLabels = [...new Set(labels)].length >= 3 ? [...new Set(labels)] : canonicalStats;
      for (const entry of entries) {
        entry.values.forEach((value, index) => {
          const label = value.label || statLabels[index] || canonicalStats[index];
          entry.stats[label] = value.value || '--';
        });
        delete entry.values;
      }
      return entries;
    }

    function parseWeapons(block) {
      const weapons = [];
      for (const table of block.querySelectorAll('.wTable')) {
        let type = '';
        for (const row of table.querySelectorAll('tr')) {
          const header = row.querySelector('.wTable_WEAPON');
          if (header) {
            type = clean(header).toLowerCase().startsWith('ranged') ? 'ranged' : 'melee';
            continue;
          }
          const weaponCell = row.querySelector('td.wTable2_short');
          if (!weaponCell || !type) continue;
          const cells = [...row.children].filter((child) => child.tagName === 'TD');
          const index = cells.indexOf(weaponCell);
          if (index < 0) continue;
          const values = cells.slice(index + 1).map(clean);
          const keywordParts = [...weaponCell.querySelectorAll('.kwbw')].map(clean).filter(Boolean);
          weapons.push({
            type,
            name: noKeywords(weaponCell),
            keywords: keywordParts.join(' '),
            range: values[0] || '--',
            attacks: values[1] || '--',
            skill: values[2] || '--',
            strength: values[3] || '--',
            ap: values[4] || '--',
            damage: values[5] || '--',
          });
        }
      }
      return weapons;
    }

    function parseCosts(right) {
      const costs = [];
      const costTables = [...new Set(
        [...right?.querySelectorAll('.dsUnitCostHeader') || []]
          .map((header) => header.closest('table'))
          .filter(Boolean),
      )];
      for (const costTable of costTables) {
        let group = 'Unit cost';
        for (const row of costTable?.querySelectorAll('tr') || []) {
          const cells = [...row.children].filter((child) => child.tagName === 'TD');
          if (!cells.length || cells[0].classList.contains('dsUnitCostHeader')) {
            if (cells[0]?.classList.contains('dsUnitCostHeader')) group = clean(cells[0]);
            continue;
          }
          if (cells.length >= 2) costs.push({ group, label: clean(cells[0]), points: clean(cells[1].querySelector('.PriceTag') || cells[1]) });
        }
      }
      return costs;
    }

    function parseSections(right) {
      if (!right) return { sections: [], costs: [] };
      const sections = [];
      const costs = parseCosts(right);
      let current;
      for (const child of right.children) {
        if (child.classList.contains('dsHeader')) {
          current = { heading: clean(child), items: [] };
          sections.push(current);
        } else if (child.classList.contains('dsAbility') && current && !child.querySelector('.dsUnitCostHeader')) {
          const text = clean(child);
          if (text) current.items.push(text);
        }
      }
      return { sections: sections.filter((section) => section.items.length), costs };
    }

    function parseFeatureEnhancements(block) {
      const feature = block.querySelector('.ShowDatasheetFeatures');
      if (!feature) return [];
      const results = [];
      for (const header of [...feature.querySelectorAll('.dsHeader')].filter((node) => clean(node).toUpperCase() === 'ENHANCEMENTS')) {
        const parent = header.parentElement;
        for (const wrap of parent?.querySelectorAll('.s10EnhWrap') || []) {
          const first = wrap.children[0];
          const name = clean(first);
          const points = clean(wrap.querySelector('.PriceTag')).replace(/\s*pts?$/i, '');
          if (name && !results.some((item) => item.name === name && item.points === points)) results.push({ name, points });
        }
      }
      return results;
    }

    function parseKeywords(block) {
      const container = block.querySelector('.ds2colKW');
      const columns = [...container?.children || []].filter((child) => child.tagName === 'DIV');
      return { unit: clean(columns[0]), faction: clean(columns[1]) };
    }

    function indexEntries() {
      const entries = new Map();
      const pattern = new RegExp(`/wh40k11ed/factions/${factionSlug}/(?:datasheets\\.html#)?([^/#?]+)$`, 'i');
      for (const anchor of document.querySelectorAll('a.cnClr')) {
        if (anchor.closest('.datasheet')) continue;
        const href = anchor.getAttribute('href') || '';
        const match = href.match(pattern);
        if (!match) continue;
        const item = anchor.closest('.clFl');
        const entry = {
          slug: match[1],
          name: clean(anchor),
          role: clean(anchor.closest('.kwVisChk')?.querySelector('.BatRole')),
          legendary: Boolean(item?.classList.contains('sLegendary')),
          forgeWorld: Boolean(item?.classList.contains('sForgeWorld')),
        };
        const score = (entry.legendary ? 2 : 0) + (entry.role ? 0 : 1);
        const previous = entries.get(entry.slug);
        if (!previous || score < previous.score) entries.set(entry.slug, { ...entry, score });
      }
      return entries;
    }

    function inferRole(block) {
      const keywords = clean(block.querySelector('.ds2colKW') || block).toUpperCase();
      const is = (keyword) => new RegExp(`\\b${keyword}\\b`).test(keywords);
      if (is('EPIC HERO')) {
        if (is('MONSTER')) return 'Monster Epic Hero';
        if (is('MOUNTED')) return 'Mounted Epic Hero';
        if (is('VEHICLE')) return 'Vehicle Epic Hero';
        return 'Infantry Epic Hero';
      }
      if (is('CHARACTER')) {
        if (is('MONSTER')) return 'Monster Character';
        if (is('MOUNTED')) return 'Mounted Character';
        if (is('VEHICLE')) return 'Vehicle Character';
        return 'Infantry Character';
      }
      for (const role of ['Battleline', 'Dedicated Transports', 'Aircraft', 'Artillery', 'Beast', 'Infantry', 'Monster', 'Mounted', 'Titanic', 'Transport', 'Vehicle', 'Walker', 'Fortifications']) {
        if (is(role.toUpperCase())) return role;
      }
      return '';
    }

    const entries = indexEntries();
    const units = [];
    const blocks = [...document.querySelectorAll('.datasheet')];
    let legendaryCount = 0;
    let forgeWorldCount = 0;
    let missingRoleCount = 0;
    let missingProfileCount = 0;

    for (const block of blocks) {
      const { name, bases } = unitHeader(block);
      if (!name) continue;
      if (block.classList.contains('sLegendary')) {
        legendaryCount += 1;
        continue;
      }
      if (block.classList.contains('sForgeWorld')) forgeWorldCount += 1;
      const matched = [...entries.values()].find((entry) => entry.name.toLowerCase() === name.toLowerCase()) || {};
      const role = matched.role || inferRole(block);
      const profile = parseProfiles(block, name);
      if (!role) missingRoleCount += 1;
      if (!profile.length) missingProfileCount += 1;
      const mainColumns = block.querySelector('.ds2col');
      const right = [...mainColumns?.children || []].find((child) => String(child.className).includes('dsRight'));
      const sectionData = parseSections(right);
      const keywordData = parseKeywords(block);
      const allBases = [...new Set([...bases, ...profile.map((item) => item.base).filter(Boolean)])];
      units.push({
        name,
        slug: matched.slug || name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        url: `${root}/${matched.slug || name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        role: role || 'Unknown',
        sourceLabel: sourceLabel(block),
        baseSizes: allBases,
        profiles: profile.map((item, index) => ({
          model: item.model,
          base: item.base || bases[index] || bases[0] || '--',
          stats: item.stats,
          invulnerable: item.invulnerable,
        })),
        weapons: parseWeapons(block),
        sections: sectionData.sections,
        costs: sectionData.costs,
        featureEnhancements: parseFeatureEnhancements(block),
        unitKeywords: keywordData.unit,
        factionKeywords: keywordData.faction,
      });
    }

    return {
      slug: factionSlug,
      units,
      totalCount: blocks.length,
      currentCount: units.length,
      legendaryCount,
      forgeWorldCount,
      missingRoleCount,
      missingProfileCount,
    };
  }, { factionSlug: slug, root: rootUrl });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });

  let sitemap;
  if (!refresh && await exists(localSitemapPath)) {
    sitemap = await fs.readFile(localSitemapPath, 'utf8');
  } else {
    sitemap = await fetchGet(`${origin}${editionPath}/SiteMap.xml`, localSitemapPath, '11th-edition sitemap');
  }

  let factions = factionRootsFromSitemap(sitemap);
  if (requestedFactions.length) {
    factions = factions.filter(([slug]) => requestedFactions.includes(slug));
    const found = new Set(factions.map(([slug]) => slug));
    for (const requested of requestedFactions) {
      if (!found.has(requested)) log(`requested faction not in sitemap: ${requested}`);
    }
  }
  if (!factions.length) throw new Error('no faction roots selected');

  const playwrightPath = path.join(repoRoot, '.tmp', '40kapp-fetch', 'node_modules', 'playwright-core', 'index.mjs');
  if (!await exists(playwrightPath)) throw new Error(`missing local Playwright dependency: ${playwrightPath}`);
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  const browser = await chromium.launch({ headless: true, executablePath: findBrowserPath() });
  const page = await browser.newPage();
  const audit = [];

  log(`selected ${factions.length} main faction pages; delay=${delayMs}ms; GET-only`);
  for (let index = 0; index < factions.length; index += 1) {
    const [slug, rootUrl] = factions[index];
    const rootCache = path.join(cacheDir, `${slug}-rules.html`);
    const dataCache = path.join(cacheDir, `${slug}-datasheets.html`);
    const file = `${slug}.md`;
    log(`[${index + 1}/${factions.length}] ${slug}`);
    try {
      const rootHtml = await fetchGet(`${rootUrl}/`, rootCache, `${slug} rules`);
      await sleep(delayMs);
      const dataHtml = await fetchGet(`${rootUrl}/datasheets.html`, dataCache, `${slug} datasheets`);
      await sleep(delayMs);
      const root = await parseRootPage(page, rootHtml, slug, rootUrl);
      const datasheets = await parseDatasheetPage(page, dataHtml, slug, rootUrl);
      const markdown = renderFaction({ slug, name: root.name || slug, rootUrl }, root, datasheets);
      await fs.writeFile(path.join(outputDir, file), markdown, 'utf8');
      audit.push({ name: root.name || slug, file, currentCount: datasheets.currentCount, forgeWorldCount: datasheets.forgeWorldCount, legendaryCount: datasheets.legendaryCount, detachmentCount: root.detachments.length, status: 'written' });
      log(`${slug}: wrote ${datasheets.currentCount} current datasheets and ${root.detachments.length} detachments`);
    } catch (error) {
      audit.push({ name: slug, file, status: `failed: ${error.message}` });
      log(`${slug}: FAILED - ${error.message}`);
    }
  }

  await browser.close();
  if (!skipIndex) await fs.writeFile(path.join(outputDir, 'INDEX.md'), renderIndex(audit), 'utf8');
  if (!keepCache) {
    // Keep the cache on interrupted runs; clean it only after the complete pass.
    if (audit.length === factions.length && audit.every((entry) => entry.status === 'written')) {
      await fs.rm(cacheDir, { recursive: true, force: true });
      log('complete pass succeeded; temporary HTML cache removed');
    }
  }
  const failures = audit.filter((entry) => entry.status !== 'written');
  if (failures.length) process.exitCode = 1;
}

function findBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const browserPath = candidates.find((candidate) => existsSync(candidate));
  if (!browserPath) throw new Error('could not find Chrome or Edge; set a local browser path in findBrowserPath()');
  return browserPath;
}

main().catch((error) => {
  console.error(`[wahapedia] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
