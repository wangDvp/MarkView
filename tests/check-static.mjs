// Usage: npm run check
// Read-only: syntax, runtime asset references and generated stylesheet consistency.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
for (const entry of manifest.content_scripts) {
  for (const script of entry.js) assert.ok(fs.existsSync(path.join(root, script)), script);
  assert.ok(entry.js.indexOf('document-editor.js') < entry.js.indexOf('content.js'));
  assert.ok(entry.js.indexOf('document-export.js') < entry.js.indexOf('content.js'));
}
assert.deepEqual(manifest.permissions, ['storage', 'nativeMessaging']);
assert.ok(fs.existsSync(path.join(root, 'native-bridge.js')));
for (const entry of manifest.web_accessible_resources || []) {
  for (const resource of entry.resources) assert.ok(fs.existsSync(path.join(root, resource)), resource);
}
const context = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'lib/content-styles.js'), 'utf8'), context);
assert.equal(context.globalThis.MDP_CSS, fs.readFileSync(path.join(root, 'preview.css'), 'utf8'));
for (const script of ['background.js', 'native-bridge.js', 'native-file.js', 'content.js', 'preview.js', 'document-editor.js', 'document-export.js', 'pdf-export.js', 'pdf-content.js']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, script)], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
console.log('PASS syntax, content-script references, permissions and generated stylesheet consistency');
