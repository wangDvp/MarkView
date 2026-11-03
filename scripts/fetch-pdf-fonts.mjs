// Download pinned OFL font assets; no system font installation or remote runtime requests.
// Usage: node scripts/fetch-pdf-fonts.mjs (writes fonts/ and the distributed font license).
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const revision = 'f8d157532fbfaeda587e826d4cd5b21a49186f7c';
const origin = `https://raw.githubusercontent.com/notofonts/noto-cjk/${revision}/Sans/`;
await mkdir(new URL('../fonts/', import.meta.url), { recursive: true });
const assets = [
  ['SubsetOTF/SC/NotoSansSC-Regular.otf', '../fonts/NotoSansSC-Regular.otf'],
  ['SubsetOTF/SC/NotoSansSC-Bold.otf', '../fonts/NotoSansSC-Bold.otf'],
  ['LICENSE', '../licenses/NotoSansSC-LICENSE.txt'],
];
for (const [source, target] of assets) {
  const response = await fetch(new URL(source, origin), { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Font asset download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 12 * 1024 * 1024) throw new Error('Unexpected font asset size');
  await writeFile(new URL(target, import.meta.url), buffer);
  console.log(`${target}: ${buffer.length} bytes; sha256 ${createHash('sha256').update(buffer).digest('hex')}`);
}
