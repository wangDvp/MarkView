// Run: node tests/native/bridge.mjs
// Worker API contract/security tests; native IO is covered separately by Python and browser checks.
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const code = fs.readFileSync(new URL('../../native-bridge.js', import.meta.url), 'utf8');
const id = 'abcdefghijklmnopabcdefghijklmnop';
const url = 'file:///tmp/viewed.md';
function setup(overrides = {}) {
  const calls = [];
  const chrome = {
    runtime: {
      id,
      async sendNativeMessage(host, payload) {
        calls.push({ host, payload });
        return payload.op === 'open' ? { ok: true, token: 'signed-native-token', digest: 'a'.repeat(64) } : { ok: true, digest: 'b'.repeat(64) };
      },
    },
    tabs: { async sendMessage(tabId, message, options) { assert.equal(options.documentId, 'live-document'); return { url: overrides.liveUrl || url }; } },
  };
  const context = { chrome, URL, setTimeout, clearTimeout };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { calls, bridge: context.MDPNativeBridge };
}
const sender = { id, frameId: 0, documentId: 'live-document', tab: { id: 1 }, url };
const message = { type: 'MD_NATIVE_SAVE', expectedDigest: 'a'.repeat(64), content: 'IyBzYXZlZA==', url: 'file:///tmp/forged.md' };
for (const bad of [{ ...sender, id: 'a'.repeat(32) }, { ...sender, frameId: 1 }, { ...sender, url: 'https://example.com/file.md' }, { ...sender, documentId: null }]) {
  const { calls, bridge } = setup();
  assert.equal((await bridge.handle(message, bad)).ok, false);
  assert.equal(calls.length, 0);
}
{
  const { calls, bridge } = setup({ liveUrl: 'file:///tmp/navigated.md' });
  assert.equal((await bridge.handle(message, sender)).ok, false);
  assert.equal(calls.length, 0);
}
{
  const { calls, bridge } = setup();
  const result = await bridge.handle(message, sender);
  assert.equal(result.ok, true);
  assert.equal(result.token, undefined, 'Native capability never reaches content scripts');
  assert.equal(calls[0].payload.url, url, 'Caller supplied target path is ignored');
  assert.equal(calls[1].payload.token, 'signed-native-token');
  assert.equal(calls[1].payload.url, undefined);
}
{
  const { calls, bridge } = setup();
  assert.equal((await bridge.handle({ ...message, content: '!' }, sender)).ok, false);
  assert.equal(calls.length, 0);
}
console.log('PASS native bridge sender/frame/document validation, target derivation and capability isolation');
