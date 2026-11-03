import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libDir = path.join(root, 'lib');

await mkdir(libDir, { recursive: true });

await import('./build-pdf.mjs');

await build({
  entryPoints: [path.join(root, 'src/vendor.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110'],
  outfile: path.join(libDir, 'markdown-vendor.js'),
  legalComments: 'eof',
  banner: {
    js: '/* Bundled Markdown renderer: marked, DOMPurify, highlight.js. See THIRD-PARTY-NOTICES.md. */',
  },
});

const css = await readFile(path.join(root, 'preview.css'), 'utf8');
await writeFile(
  path.join(libDir, 'content-styles.js'),
  `/* Generated from preview.css by scripts/build.mjs. Do not edit. */\nglobalThis.MDP_CSS = ${JSON.stringify(css)};\n`,
);

const vendor = await readFile(path.join(libDir, 'markdown-vendor.js'));
const styles = await readFile(path.join(libDir, 'content-styles.js'));
console.log(
  `built lib/markdown-vendor.js (${(vendor.length / 1024).toFixed(0)} KiB), ` +
    `lib/content-styles.js (${(styles.length / 1024).toFixed(0)} KiB)`,
);
