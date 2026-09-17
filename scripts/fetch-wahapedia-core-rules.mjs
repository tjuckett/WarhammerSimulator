import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const origin = 'https://wahapedia.ru';
const editionPath = '/wh40k11ed';
const pagePath = '/the-rules/core-rules/';
const sourceUrl = `${origin}${editionPath}${pagePath}`;
const outputDir = path.join(repoRoot, 'docs', 'core-rules', 'wahapedia');
const cacheDir = path.join(repoRoot, '.tmp', 'wahapedia-core-rules-cache', '11e');
const cachePath = path.join(cacheDir, 'core-rules.html');
const captureDate = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const keepCache = args.includes('--keep-cache');
const inputPath = readOption('--input', '');

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function log(message) {
  console.log(`[wahapedia-core] ${message}`);
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

async function fetchPage() {
  if (!refresh && await exists(cachePath)) {
    log('cache hit: core rules');
    return fs.readFile(cachePath, 'utf8');
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      log(`GET core rules (attempt ${attempt}/3)`);
      const response = await fetch(sourceUrl, {
        method: 'GET',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'user-agent': 'WarhammerSimulator-reference-export/1.0 (GET-only; cached)',
        },
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (!body.toLowerCase().includes('<html')) throw new Error('response did not look like an HTML page');
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachePath, body, 'utf8');
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        const backoff = Math.min(60000, 15000 * 2 ** (attempt - 1));
        log(`core rules failed: ${error.message}; backing off ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
  }
  throw new Error(`core rules failed after retries: ${lastError?.message ?? 'unknown error'}`);
}

function neutralizeScripts(html) {
  return html
    .replace(/<script\b/gi, '<x-script')
    .replace(/<\/script\s*>/gi, '</x-script>');
}

function escapeTableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractMarkdown(html) {
  const playwrightPath = path.join(repoRoot, '.tmp', '40kapp-fetch', 'node_modules', 'playwright-core', 'index.mjs');
  if (!await exists(playwrightPath)) throw new Error(`missing local Playwright dependency: ${playwrightPath}`);
  const { chromium } = await import(pathToFileURL(playwrightPath).href);
  const browser = await chromium.launch({ headless: true, executablePath: findBrowserPath() });
  const page = await browser.newPage();
  try {
    await page.setContent(neutralizeScripts(html), { waitUntil: 'domcontentloaded', timeout: 240000 });
    return await page.evaluate(() => {
      const root = (document.querySelector('#wahMainContent') || document.body).cloneNode(true);
      const removeSelectors = [
        'x-script',
        'style',
        '.tooltip_templates',
        '.noprint',
        '.page_breaker_ads',
        '.page_ads_wrapper',
        '.btnFaqErrataToggle',
      ];

      root.querySelectorAll(removeSelectors.join(',')).forEach((node) => node.remove());
      root.querySelectorAll('.NavColumns3').forEach((node) => {
        const container = node.closest('.frameDark') || node.parentElement;
        container?.remove();
      });
      root.querySelectorAll('.contents_header').forEach((node) => node.remove());

      const blockTags = new Set([
        'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CENTER', 'DD', 'DIV', 'DL', 'DT',
        'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'HR', 'MAIN', 'NAV', 'P', 'PRE',
        'SECTION', 'TABLE', 'TEMPLATE', 'UL', 'OL',
      ]);

      function inlineText(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const element = node;
        if (element.tagName === 'BR') return '\n';
        if (element.tagName === 'IMG') return '';
        return [...element.childNodes].map(inlineText).join('');
      }

      function normalizeSourceText(value) {
        return String(value ?? '')
          .replaceAll('â€™', "'")
          .replaceAll('â€˜', "'")
          .replaceAll('â€œ', '"')
          .replaceAll('â€', '"')
          .replaceAll('â€“', '-')
          .replaceAll('â€”', '-')
          .replaceAll('â€‘', '-')
          .replaceAll('âˆ’', '-')
          .replaceAll('â€¦', '...')
          .replaceAll('Â°', '°')
          .replaceAll('Â', '');
      }

      function cleanInline(node) {
        return normalizeSourceText(inlineText(node))
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]*\n[ \t]*/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/([A-Za-z)])(\d{2}(?:\.\d{2}){1,2})\b/g, '$1 $2')
          .trim();
      }

      function directTableRows(table) {
        return [...table.children].flatMap((child) => child.tagName === 'TBODY' || child.tagName === 'THEAD' || child.tagName === 'TFOOT'
          ? [...child.children]
          : [child]).filter((row) => row.tagName === 'TR');
      }

      function escapeCell(value) {
        return normalizeSourceText(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
      }

      function renderTable(table) {
        const rows = directTableRows(table).map((row) => [...row.children]
          .filter((cell) => cell.tagName === 'TH' || cell.tagName === 'TD')
          .map((cell) => cleanInline(cell))
          .filter((_, index, cells) => index < cells.length));
        if (!rows.length || !rows.some((row) => row.length)) return [];
        const width = Math.max(...rows.map((row) => row.length));
        const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => escapeCell(row[index] || '')));
        const lines = [
          `| ${normalized[0].join(' | ')} |`,
          `| ${normalized[0].map(() => '---').join(' | ')} |`,
          ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
        ];
        return [...lines, ''];
      }

      function renderList(list, depth = 0) {
        const lines = [];
        const ordered = list.tagName === 'OL';
        let itemNumber = 1;
        for (const item of [...list.children].filter((child) => child.tagName === 'LI')) {
          const nested = [];
          const content = [];
          for (const child of item.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
            else content.push(child);
          }
          const text = normalizeSourceText(content.map(inlineText).join(''))
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]*\n[ \t]*/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .trim();
          if (text) {
            const marker = ordered ? `${itemNumber}.` : '-';
            lines.push(`${'  '.repeat(depth)}${marker} ${text}`);
          }
          itemNumber += 1;
          nested.forEach((child) => lines.push(...renderList(child, depth + 1)));
        }
        return [...lines, ''];
      }

      function renderBlocks(node) {
        const lines = [];
        let inline = '';
        const flushInline = () => {
          const text = normalizeSourceText(inline).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
          if (text) lines.push(text);
          inline = '';
        };

        for (const child of node.childNodes || []) {
          if (child.nodeType === Node.TEXT_NODE) {
            inline += child.nodeValue || '';
            continue;
          }
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          const element = child;
          if (/^H[1-6]$/.test(element.tagName)) continue;
          if (element.tagName === 'TABLE') {
            flushInline();
            lines.push(...renderTable(element));
          } else if (element.tagName === 'UL' || element.tagName === 'OL') {
            flushInline();
            lines.push(...renderList(element));
          } else if (element.tagName === 'HR') {
            flushInline();
            lines.push('---', '');
          } else if (blockTags.has(element.tagName)) {
            flushInline();
            lines.push(...renderBlocks(element));
          } else {
            inline += inlineText(element);
          }
        }
        flushInline();
        return lines;
      }

      const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,.str11Name')];
      const sections = [];
      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const nextHeading = headings[index + 1];
        const level = /^H[1-6]$/.test(heading.tagName) ? Number(heading.tagName.slice(1)) : 3;
        const range = document.createRange();
        range.setStartAfter(heading);
        if (nextHeading) range.setEndBefore(nextHeading);
        else range.setEnd(root, root.childNodes.length);
        const holder = document.createElement('div');
        holder.appendChild(range.cloneContents());
        sections.push({
          level,
          title: cleanInline(heading),
          body: renderBlocks(holder),
        });
      }

      return {
        title: cleanInline(document.querySelector('h1.page_header') || document.querySelector('h1')) || 'Core Rules',
        sections,
      };
    });
  } finally {
    await browser.close();
  }
}

function renderReference(parsed) {
  const output = [
    `# ${parsed.title} -- Wahapedia reference`,
    '',
    '## Scope',
    '',
    '- Edition: Warhammer 40,000 11th edition.',
    `- Captured: ${captureDate}.`,
    `- Source: [Wahapedia Core Rules](${sourceUrl}).`,
    '- This is a normalized text reference generated from the source page. Images, navigation, advertisements, and hidden tooltip templates are omitted; rule headings, lists, tables, examples, FAQ content, and errata are retained.',
    '- The source page is the authority. This file is a handoff reference for implementation and auditing, not a replacement for the published rules.',
    '',
    '## Section index',
    '',
  ];

  const anchors = parsed.sections.map((section, index) => {
    const titleAnchor = section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    return `source-section-${index + 1}-${titleAnchor}`;
  });
  parsed.sections.forEach((section, index) => {
    output.push(`${index + 1}. [${section.title}](#${anchors[index]})`);
  });
  output.push('', '## Source text', '');

  parsed.sections.forEach((section, index) => {
    const level = Math.max(2, Math.min(6, section.level));
    output.push(`<a id="${anchors[index]}"></a>`, `${'#'.repeat(level)} ${section.title}`, '');
    output.push(...section.body, '');
  });

  return `${normalizeMarkdown(output.join('\n'))}\n`;
}

function renderIndex() {
  return `# Wahapedia 11th-edition core rules\n\n- [Core Rules reference](core-rules.md)\n\nCaptured: ${captureDate}.\n\nSource: [Wahapedia Core Rules](${sourceUrl}).\n\nThe collector uses a sequential GET request with a local HTML cache. It does not submit forms or make POST, PUT, PATCH, or DELETE requests. Run \`node scripts/fetch-wahapedia-core-rules.mjs --refresh\` to refresh the source snapshot.\n`;
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

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  const html = inputPath
    ? await fs.readFile(path.resolve(repoRoot, inputPath), 'utf8')
    : await fetchPage();
  log(inputPath ? `using local input: ${inputPath}` : 'using downloaded source');
  const parsed = await extractMarkdown(html);
  await fs.writeFile(path.join(outputDir, 'core-rules.md'), renderReference(parsed), 'utf8');
  await fs.writeFile(path.join(outputDir, 'INDEX.md'), renderIndex(), 'utf8');
  log(`wrote ${parsed.sections.length} source sections to docs/core-rules/wahapedia/core-rules.md`);
  if (!keepCache && !inputPath && await exists(cachePath)) {
    await fs.rm(cachePath, { force: true });
    log('successful pass complete; temporary HTML cache removed');
  }
}

main().catch((error) => {
  console.error(`[wahapedia-core] fatal: ${error.stack || error.message}`);
  process.exitCode = 1;
});
