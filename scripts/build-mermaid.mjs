// Rebuild only Mermaid and the licenses of packages included in its bundle.
// Usage: node scripts/build-mermaid.mjs
import { build } from 'esbuild';
import { readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/mermaid-vendor.js'], outfile: 'lib/mermaid-vendor.js',
  bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['chrome123'],
  legalComments: 'eof', metafile: true,
  banner: { js: '/* Mermaid 12.3.0 offline bundle. See THIRD-PARTY-NOTICES.md and licenses/. */' },
});
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  let directory = path.dirname(path.resolve(root, input));
  while (directory !== root && directory !== path.dirname(directory)) {
    try {
      const info = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (info.name) { packages.set(directory, info); break; }
    } catch { /* Continue to the package root. */ }
    directory = path.dirname(directory);
  }
}
const notices = [];
for (const [directory, info] of [...packages].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
  const files = (await readdir(directory)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
  const texts = [];
  for (const file of files.sort()) texts.push(`${file}\n${await readFile(path.join(directory, file), 'utf8')}`);
  if (!texts.length) throw new Error(`Missing upstream license text: ${info.name}`);
  notices.push(`${info.name} ${info.version} (${info.license || 'see license text'})\n${texts.join('\n\n')}`);
}
await copyFile(path.join(root, 'node_modules/mermaid/LICENSE'), path.join(root, 'licenses/mermaid-LICENSE.txt'));
await writeFile(path.join(root, 'licenses/mermaid-vendor-NOTICES.txt'),
  `Licenses of packages included by scripts/build-mermaid.mjs.\n\n${notices.join('\n\n' + '='.repeat(72) + '\n\n')}\n`);
console.log(`Built lib/mermaid-vendor.js; retained licenses for ${packages.size} packages`);
