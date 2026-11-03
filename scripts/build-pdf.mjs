// Build only the lazily loaded PDF dependency. Usage: node scripts/build-pdf.mjs
import { build } from 'esbuild';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('../src/pdf-vendor.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../lib/pdf-vendor.js', import.meta.url)),
  bundle: true, minify: true, format: 'esm', platform: 'browser',
  target: ['chrome123'], legalComments: 'eof',
  banner: { js: '/* pdfmake 0.3.11 browser bundle. See THIRD-PARTY-NOTICES.md and licenses/. */' },
});
await copyFile(new URL('../node_modules/pdfmake/LICENSE', import.meta.url), new URL('../licenses/pdfmake-LICENSE.txt', import.meta.url));
await copyFile(new URL('../node_modules/pdfmake/src/3rd-party/svg-to-pdfkit/LICENSE', import.meta.url), new URL('../licenses/svg-to-pdfkit-LICENSE.txt', import.meta.url));
const source = await readFile(new URL('../node_modules/pdfmake/build/pdfmake.js', import.meta.url), 'utf8');
const notices = [...new Set((source.match(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*/gm) || [])
  .filter((comment) => /copyright|@license/i.test(comment)))];
await writeFile(new URL('../licenses/pdf-vendor-NOTICES.txt', import.meta.url),
  `Copyright and license notices from the upstream pdfmake 0.3.11 browser bundle.\n\n${notices.join('\n\n')}\n`);
console.log('Built lib/pdf-vendor.js');
