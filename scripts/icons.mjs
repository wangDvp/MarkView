import puppeteer from 'puppeteer-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const chromePath =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'icons');

await mkdir(iconsDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(iconsDir, 'icon.svg')}`);
  await page.screenshot({ path: path.join(iconsDir, 'icon512.png'), omitBackground: true });
} finally {
  await browser.close();
}

for (const size of [16, 32, 48, 128]) {
  await execFileAsync('sips', [
    '-z',
    String(size),
    String(size),
    path.join(iconsDir, 'icon512.png'),
    '--out',
    path.join(iconsDir, `icon${size}.png`),
  ]);
}

console.log('icons written: icon16.png, icon32.png, icon48.png, icon128.png, icon512.png');
