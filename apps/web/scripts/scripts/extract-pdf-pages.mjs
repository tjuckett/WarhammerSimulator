import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from 'canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const [, , pdfPathArg, outDirArg, ...pageArgs] = process.argv;

if (!pdfPathArg || !outDirArg || pageArgs.length === 0) {
  console.error('Usage: node scripts/extract-pdf-pages.mjs <pdf> <out-dir> <page...>');
  process.exit(1);
}

const pdfPath = path.resolve(pdfPathArg);
const outDir = path.resolve(outDirArg);
const pages = pageArgs.map(Number).filter(Number.isFinite);

await fs.mkdir(outDir, { recursive: true });

const data = new Uint8Array(await fs.readFile(pdfPath));
const pdf = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;

for (const pageNumber of pages) {
  const page = await pdf.getPage(pageNumber);
  const text = await page.getTextContent();
  const textPath = path.join(outDir, `page-${pageNumber}.txt`);
  await fs.writeFile(textPath, text.items.map(item => item.str).join('\n'), 'utf8');

  const viewport = page.getViewport({ scale: 2.5 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  const pngPath = path.join(outDir, `page-${pageNumber}.png`);
  const clip = context.clip.bind(context);
  context.clip = (ruleOrPath, rule) => {
    if (ruleOrPath == null) {
      return clip();
    }
    if (rule == null) {
      return clip(ruleOrPath);
    }
    return clip(ruleOrPath, rule);
  };

  try {
    await page.render({ canvasContext: context, viewport }).promise;
    await fs.writeFile(pngPath, canvas.toBuffer('image/png'));
    console.log(`Rendered page ${pageNumber} -> ${pngPath}`);
  } catch (error) {
    console.warn(`Text extracted for page ${pageNumber}, but rendering failed: ${error.message}`);
  }
}
