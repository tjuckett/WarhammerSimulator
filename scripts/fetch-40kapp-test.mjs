import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--headed') {
    args.set('headed', true);
    continue;
  }
  if (argument.startsWith('--')) {
    args.set(argument.slice(2), process.argv[index + 1]);
    index += 1;
  }
}

const targetUrl = args.get('url') ?? 'https://www.40k.app/factions/orks/units/boss-snikrot';
const outputStem = path.resolve(
  repoRoot,
  args.get('output') ?? '.tmp/40kapp-fetch/output/boss-snikrot',
);
const profileDir = path.resolve(
  repoRoot,
  args.get('profile') ?? '.tmp/40kapp-fetch/profile',
);

const playwrightPackage =
  process.env.PLAYWRIGHT_CORE_PATH ??
  path.join(repoRoot, '.tmp', '40kapp-fetch', 'node_modules', 'playwright-core', 'index.mjs');

if (!existsSync(playwrightPackage)) {
  throw new Error(
    `playwright-core was not found at ${playwrightPackage}. ` +
      'Install it in a temporary location or set PLAYWRIGHT_CORE_PATH.',
  );
}

const { chromium } = await import(pathToFileURL(playwrightPackage).href);

function browserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) {
    throw new Error('Could not find Chrome or Edge. Set CHROME_PATH to the browser executable.');
  }
  return executable;
}

await fs.mkdir(path.dirname(outputStem), { recursive: true });
await fs.mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: browserExecutable(),
  headless: !args.get('headed'),
  viewport: { width: 1440, height: 1000 },
  locale: 'en-US',
  serviceWorkers: 'allow',
});

const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(30_000);

let navigationResponse;
let bodyText = '';
let title = '';
let status = null;
let retryAfter = null;
let errorMessage = null;

async function readBodyText() {
  try {
    return await page.locator('body').innerText();
  } catch {
    return '';
  }
}

async function waitForDatasheet(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    bodyText = await readBodyText();
    if (/Boss Snikrot|Datasheet/i.test(bodyText)) {
      return true;
    }
    await page.waitForTimeout(1_000);
  }
  return false;
}

try {
  navigationResponse = await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  status = navigationResponse?.status() ?? null;
  retryAfter = navigationResponse?.headers()['retry-after'] ?? null;

  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  title = await page.title();
  bodyText = await readBodyText();

  const blocked = status === 403 || status === 429;
  if (blocked && args.get('headed')) {
    const waitMs = Number(args.get('manual-wait-ms') ?? 120_000);
    console.log(
      `Browser checkpoint detected. Complete it in the open browser; ` +
        `the script will wait up to ${Math.round(waitMs / 1_000)} seconds.`,
    );

    let found = await waitForDatasheet(waitMs);
    if (!found) {
      console.log('Refreshing once after the manual wait, then checking again.');
      const retryResponse = await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      }).catch(() => null);
      if (retryResponse) {
        status = retryResponse.status();
        retryAfter = retryResponse.headers()['retry-after'] ?? null;
      }
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      found = await waitForDatasheet(15_000);
    }

    if (!found) {
      throw new Error(`The browser checkpoint was not cleared within ${Math.round(waitMs / 1_000)} seconds.`);
    }
  }

  if ((status === 403 || status === 429) && !/Boss Snikrot|Datasheet/i.test(bodyText)) {
    const suffix = retryAfter ? ` Retry-After: ${retryAfter}` : '';
    throw new Error(`The site returned HTTP ${status}.${suffix}`);
  }

  if (!/Boss Snikrot|Datasheet/i.test(bodyText)) {
    throw new Error('The page loaded, but expected datasheet content was not found.');
  }
} catch (error) {
  errorMessage = error instanceof Error ? error.message : String(error);
  bodyText = await readBodyText();
}

const html = await page.content().catch(() => '');
const metadata = {
  url: targetUrl,
  title,
  status,
  retryAfter,
  capturedAt: new Date().toISOString(),
  success: !errorMessage,
  error: errorMessage,
};

await fs.writeFile(`${outputStem}.html`, html, 'utf8');
await fs.writeFile(`${outputStem}.txt`, bodyText, 'utf8');
await fs.writeFile(`${outputStem}.json`, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

await context.close();

console.log(JSON.stringify({
  ...metadata,
  output: `${outputStem}.{html,txt,json}`,
}, null, 2));

if (errorMessage) {
  process.exitCode = status === 429 ? 2 : 1;
}
