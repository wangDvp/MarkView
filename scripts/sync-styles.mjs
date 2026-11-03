// Sync the packaged Shadow DOM stylesheet without rebuilding vendor dependencies.
// Usage: node scripts/sync-styles.mjs
import { readFile, writeFile } from 'node:fs/promises';

const css = await readFile(new URL('../preview.css', import.meta.url), 'utf8');
await writeFile(
  new URL('../lib/content-styles.js', import.meta.url),
  `/* Generated from preview.css by scripts/build.mjs. Do not edit. */\nglobalThis.MDP_CSS = ${JSON.stringify(css)};\n`,
);
console.log('Synced lib/content-styles.js');
