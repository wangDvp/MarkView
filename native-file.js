/* Per-preview native save adapter. File paths are derived by the worker from sender.url. */
(function () {
  'use strict';
  const MESSAGES = {
    'native-unavailable': '本地保存助手未连接。请安装助手并重新加载扩展；当前内容仍保留。',
    conflict: '原文件已被其他程序修改，请重新打开文件，或使用“另存为”保留当前编辑内容。',
    denied: '系统拒绝访问原文件或所在文件夹。请检查文件是否只读，以及 macOS“隐私与安全性 → 文件和文件夹”中“MarkView 本地保存助手”的权限，然后重试；当前内容仍保留。',
    busy: '原文件正在被其他保存操作使用，请稍后重试。',
    'too-large': '文件或编辑内容超过 5 MB，无法保存。',
    'source-unverified': '无法核对原文件内容，请刷新预览后重试；当前内容仍保留。',
    timeout: '未能确认保存结果，请核对原文件后重试；当前编辑内容仍保留。',
  };

  async function digest(buffer) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function create(initialDigest, expectedTextDigest) {
    let expectedDigest = initialDigest;
    async function send(type, extra = {}) {
      let response;
      try { response = await chrome.runtime.sendMessage({ type, expectedDigest, expectedTextDigest, ...extra }); }
      catch { response = { ok: false, code: 'native-unavailable' }; }
      if (!response?.ok || !/^[a-f0-9]{64}$/.test(response.digest || '')) {
        const error = new Error('native-save-failed');
        error.userMessage = MESSAGES[response?.code] || '本地文件保存未完成，请检查文件状态后重试；当前内容仍保留。';
        throw error;
      }
      expectedDigest = response.digest;
      return response;
    }
    return Object.freeze({
      prepare: () => send('MD_NATIVE_PREPARE'),
      async save(blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
        }
        await send('MD_NATIVE_SAVE', { content: btoa(binary) });
      },
    });
  }
  globalThis.MDPNativeFile = Object.freeze({ create, digest });
})();
