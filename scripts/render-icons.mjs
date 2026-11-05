// Renders icons/icon-{16,32,48,128}.png from the SVG sources with Playwright's bundled Chromium.
// 16px uses the hand-tuned icons/icon-16.svg; the other sizes scale icons/icon.svg.
//
// Playwright is not a dependency of this project. Point PLAYWRIGHT_FROM at any folder whose
// node_modules has playwright or @playwright/test (defaults to this project):
//   PLAYWRIGHT_FROM=~/WebstormProjects/PINS node scripts/render-icons.mjs
// Don't use a system Chrome channel: headless system Chrome hangs while your own Chrome is open.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(projectRoot, 'icons');
const require = createRequire(join(resolve(process.env.PLAYWRIGHT_FROM ?? projectRoot), 'package.json'));

function loadChromium() {
  for (const name of ['playwright', '@playwright/test']) {
    try {
      return require(name).chromium;
    } catch {
      // try the next package name
    }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_FROM to a folder that has it installed.');
}

const large = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');
const small = readFileSync(join(iconsDir, 'icon-16.svg'), 'utf8');

const browser = await loadChromium().launch();
try {
  for (const n of [16, 32, 48, 128]) {
    const svg = (n === 16 ? small : large).replace(/width="\d+" height="\d+"/, `width="${n}" height="${n}"`);
    const page = await browser.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: join(iconsDir, `icon-${n}.png`), omitBackground: true });
    await page.close();
    console.log(`icons/icon-${n}.png`);
  }
} finally {
  await browser.close();
}
