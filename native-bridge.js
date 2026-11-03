/* Native Messaging access is restricted to a live top-level local Markdown tab. */
(function () {
  'use strict';
  const HOST = 'com.markview.local_save';
  const MAX_BASE64 = 4 * Math.ceil((5 * 1024 * 1024) / 3);
  const DIGEST = /^[a-f0-9]{64}$/;

  function sourceUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'file:' || !['', 'localhost'].includes(url.hostname) ||
        !/\.(md|markdown)$/i.test(url.pathname)) throw new Error('source-denied');
    url.search = '';
    url.hash = '';
    return url.href;
  }

  async function liveSource(sender) {
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.documentId ||
        !Number.isInteger(sender.tab?.id)) throw new Error('source-denied');
    const url = sourceUrl(sender.url);
    const response = await chrome.tabs.sendMessage(sender.tab.id, { type: 'MD_NATIVE_CONTEXT' }, { documentId: sender.documentId });
    if (!response || sourceUrl(response.url) !== url) throw new Error('source-denied');
    return url;
  }

  async function request(payload) {
    let timer;
    try {
      return await Promise.race([
        chrome.runtime.sendNativeMessage(HOST, payload),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 25000); }),
      ]);
    } catch (error) {
      if (error?.message === 'timeout') throw error;
      throw new Error('native-unavailable');
    } finally { clearTimeout(timer); }
  }

  async function handle(message, sender) {
    try {
      const url = await liveSource(sender);
      const saving = message.type === 'MD_NATIVE_SAVE';
      if (!DIGEST.test(message.expectedDigest || '') && (saving || !DIGEST.test(message.expectedTextDigest || ''))) {
        return { ok: false, code: 'source-unverified' };
      }
      if (saving && (typeof message.content !== 'string' || message.content.length > MAX_BASE64 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(message.content))) return { ok: false, code: 'invalid-request' };
      const opened = await request({ op: 'open', url, expectedDigest: message.expectedDigest, expectedTextDigest: message.expectedTextDigest });
      if (!opened?.ok) return { ok: false, code: opened?.code || 'io-failed' };
      if (!saving) return { ok: true, digest: opened.digest, encoding: opened.encoding, eol: opened.eol, bom: opened.bom };
      // The tab must still contain the same document when the write is submitted.
      if (await liveSource(sender) !== url) return { ok: false, code: 'source-denied' };
      const saved = await request({ op: 'save', token: opened.token, content: message.content });
      return saved?.ok ? { ok: true, digest: saved.digest } : { ok: false, code: saved?.code || 'io-failed' };
    } catch (error) {
      const code = ['source-denied', 'timeout', 'native-unavailable'].includes(error?.message) ? error.message : 'source-denied';
      return { ok: false, code };
    }
  }
  globalThis.MDPNativeBridge = Object.freeze({ handle });
})();
