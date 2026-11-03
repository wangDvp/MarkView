/* Shared Markdown renderer used by the in-page overlay and preview.html. */
(function () {
  'use strict';

  const vendor = globalThis.MDPreviewVendor;
  if (!vendor) {
    console.error('[Markdown Preview] vendor bundle is missing');
    return;
  }

  const { marked, DOMPurify, hljs } = vendor;

  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MAX_MARKDOWN_CHARS = 5 * 1024 * 1024;
  const MAX_HIGHLIGHT_CHARS = 200 * 1024;
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };

  marked.setOptions({ gfm: true, breaks: false });

  class PreviewError extends Error {
    constructor(code, message, detail = '') {
      super(message);
      this.name = 'PreviewError';
      this.code = code;
      this.detail = detail;
    }
  }

  const SANITIZE_CONFIG = {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['input'],
    ADD_ATTR: ['align', 'checked', 'disabled', 'type'],
    FORBID_TAGS: [
      'style',
      'form',
      'textarea',
      'select',
      'option',
      'button',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'base',
      'audio',
      'video',
      'source',
      'track',
      'frame',
      'frameset',
    ],
    FORBID_ATTR: ['style', 'srcset', 'ping', 'action', 'formaction'],
    ALLOW_DATA_ATTR: false,
  };

  const LANGUAGE_LABELS = {
    bash: 'Bash',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    css: 'CSS',
    diff: 'Diff',
    dockerfile: 'Dockerfile',
    go: 'Go',
    graphql: 'GraphQL',
    html: 'HTML',
    ini: 'INI',
    java: 'Java',
    javascript: 'JavaScript',
    js: 'JavaScript',
    json: 'JSON',
    kotlin: 'Kotlin',
    less: 'Less',
    lua: 'Lua',
    makefile: 'Makefile',
    markdown: 'Markdown',
    md: 'Markdown',
    nginx: 'Nginx',
    objectivec: 'Objective-C',
    perl: 'Perl',
    php: 'PHP',
    plaintext: '纯文本',
    powershell: 'PowerShell',
    properties: 'Properties',
    protobuf: 'Protobuf',
    python: 'Python',
    py: 'Python',
    r: 'R',
    ruby: 'Ruby',
    rust: 'Rust',
    scss: 'SCSS',
    sh: 'Shell',
    shell: 'Shell',
    sql: 'SQL',
    swift: 'Swift',
    text: '纯文本',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML',
    zsh: 'Shell',
  };

  function isMarkdownFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    const type = String(file.type || '').toLowerCase();
    return name.endsWith('.md') || name.endsWith('.markdown') || type === 'text/markdown';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function normalizeTheme(theme) {
    return THEMES.includes(theme) ? theme : 'auto';
  }

  function nextTheme(theme) {
    const index = THEMES.indexOf(normalizeTheme(theme));
    return THEMES[(index + 1) % THEMES.length];
  }

  function themeLabel(theme) {
    return THEME_LABELS[normalizeTheme(theme)];
  }

  async function loadTheme() {
    try {
      const stored = await chrome.storage.local.get('mdTheme');
      return normalizeTheme(stored && stored.mdTheme);
    } catch {
      return 'auto';
    }
  }

  async function saveTheme(theme) {
    try {
      await chrome.storage.local.set({ mdTheme: normalizeTheme(theme) });
    } catch {
      /* storage is optional for rendering */
    }
  }

  function decodeBytes(bytes, label) {
    return new TextDecoder(label).decode(bytes);
  }

  function decodeBuffer(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const byteLength = bytes.byteLength;

    if (byteLength === 0) {
      return { text: '', encoding: 'UTF-8', bytes: 0, lossy: false };
    }

    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: decodeBytes(bytes.subarray(3), 'utf-8'), encoding: 'UTF-8', bytes: byteLength, lossy: false };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: decodeBytes(bytes.subarray(2), 'utf-16le'), encoding: 'UTF-16 LE', bytes: byteLength, lossy: false };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: decodeBytes(bytes.subarray(2), 'utf-16be'), encoding: 'UTF-16 BE', bytes: byteLength, lossy: false };
    }

    // UTF-16 without a BOM: lots of NUL bytes on one side of each code unit.
    const sampleEnd = Math.min(byteLength, 4096);
    let zerosEven = 0;
    let zerosOdd = 0;
    for (let i = 0; i + 1 < sampleEnd; i += 2) {
      if (bytes[i] === 0) zerosEven += 1;
      if (bytes[i + 1] === 0) zerosOdd += 1;
    }
    const pairs = Math.floor(sampleEnd / 2);
    if (pairs > 16) {
      if (zerosOdd > pairs * 0.6 && zerosEven < pairs * 0.1) {
        return { text: decodeBytes(bytes, 'utf-16le'), encoding: 'UTF-16 LE', bytes: byteLength, lossy: false };
      }
      if (zerosEven > pairs * 0.6 && zerosOdd < pairs * 0.1) {
        return { text: decodeBytes(bytes, 'utf-16be'), encoding: 'UTF-16 BE', bytes: byteLength, lossy: false };
      }
    }

    let nulBytes = 0;
    for (let i = 0; i < sampleEnd; i += 1) {
      if (bytes[i] === 0) nulBytes += 1;
    }
    if (nulBytes > sampleEnd * 0.1) {
      throw new PreviewError('binary', '文件包含大量空字节，可能不是文本文件');
    }

    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { text, encoding: 'UTF-8', bytes: byteLength, lossy: false };
    } catch {
      const text = new TextDecoder('utf-8').decode(bytes);
      return { text, encoding: '非 UTF-8', bytes: byteLength, lossy: true };
    }
  }

  async function readFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new PreviewError('invalid-file', '无法读取该文件');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new PreviewError(
        'too-large',
        `文件大小 ${formatBytes(file.size)}，超过 ${formatBytes(MAX_FILE_BYTES)} 的预览上限`,
      );
    }

    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (error) {
      throw new PreviewError('read-failed', '读取文件失败', error && error.message ? error.message : String(error));
    }

    const decoded = decodeBuffer(buffer);
    decoded.filename = file.name || '';
    return decoded;
  }

  function mergeRel(value, tokens) {
    const parts = new Set(String(value || '').split(/\s+/).filter(Boolean));
    for (const token of tokens) parts.add(token);
    return [...parts].join(' ');
  }

  function isRelativeUrl(url) {
    return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
  }

  function normalizeFragment(fragment) {
    for (const input of fragment.querySelectorAll('input')) {
      const type = String(input.getAttribute('type') || '').toLowerCase();
      if (type !== 'checkbox') {
        input.remove();
        continue;
      }
      input.setAttribute('type', 'checkbox');
      input.setAttribute('disabled', '');
      input.setAttribute('tabindex', '-1');
      input.removeAttribute('name');
      input.removeAttribute('value');
      input.removeAttribute('form');
      input.removeAttribute('id');
    }
  }

  function enhance(root, options) {
    const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '';
    const resolveResource = typeof options.resolveResource === 'function' ? options.resolveResource : null;

    for (const link of root.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', mergeRel(link.getAttribute('rel'), ['noopener', 'noreferrer']));
      }
    }

    for (const image of root.querySelectorAll('img[src]')) {
      const originalSrc = image.getAttribute('src');
      if (!originalSrc) continue;

      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
      image.setAttribute('referrerpolicy', 'no-referrer');
      image.removeAttribute('src');

      let resolved = null;
      if (resolveResource) {
        try {
          resolved = resolveResource(originalSrc);
        } catch {
          resolved = null;
        }
      }
      if (!resolved && baseUrl && isRelativeUrl(originalSrc)) {
        try {
          resolved = new URL(originalSrc, baseUrl).href;
        } catch {
          resolved = null;
        }
      }
      if (!resolved) resolved = originalSrc;

      image.addEventListener(
        'error',
        () => {
          image.classList.add('mdp-img-broken');
          if (!image.alt) image.alt = originalSrc;
          image.title = '图片无法加载';
        },
        { once: true },
      );
      image.setAttribute('src', resolved);
    }

    for (const table of root.querySelectorAll('table')) {
      if (table.parentElement && table.parentElement.classList.contains('mdp-table-wrap')) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'mdp-table-wrap';
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    }

    for (const item of root.querySelectorAll('li')) {
      const checkbox = item.querySelector(':scope > input[type="checkbox"]');
      if (!checkbox) continue;
      item.classList.add('mdp-task');
      if (!item.querySelector(':scope > .mdp-task-box')) {
        checkbox.classList.add('mdp-task-input');
        const box = document.createElement('span');
        box.className = checkbox.checked ? 'mdp-task-box is-checked' : 'mdp-task-box';
        box.setAttribute('aria-hidden', 'true');
        checkbox.before(box);
      }
    }

    for (const pre of root.querySelectorAll('pre')) {
      enhanceCodeBlock(pre);
    }
  }

  function displayLanguage(language) {
    if (!language) return '代码';
    return LANGUAGE_LABELS[language] || language;
  }

  function enhanceCodeBlock(pre) {
    if (pre.parentElement && pre.parentElement.classList.contains('mdp-code')) return;
    const code = pre.querySelector(':scope > code');
    if (!code) return;

    const raw = code.textContent;
    const classMatch = /(?:^|\s)language-([^\s]+)/.exec(code.className);
    const language = classMatch ? classMatch[1].toLowerCase() : '';

    if (language && raw.length <= MAX_HIGHLIGHT_CHARS && hljs.getLanguage(language)) {
      try {
        code.innerHTML = hljs.highlight(raw, { language, ignoreIllegals: true }).value;
        code.classList.add('hljs');
      } catch {
        /* keep the plain escaped source */
      }
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'mdp-code';

    const head = document.createElement('div');
    head.className = 'mdp-code-head';

    const label = document.createElement('span');
    label.className = 'mdp-code-lang';
    label.textContent = displayLanguage(language);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mdp-copy-btn';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');

    let resetTimer = null;
    button.addEventListener('click', async () => {
      const ok = await copyText(raw);
      button.textContent = ok ? '已复制' : '复制失败';
      button.classList.toggle('is-copied', ok);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        button.textContent = '复制';
        button.classList.remove('is-copied');
        resetTimer = null;
      }, 1600);
    });

    head.append(label, button);
    pre.replaceWith(wrapper);
    wrapper.append(head, pre);
  }

  async function copyText(text) {
    if (navigator.clipboard && globalThis.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        /* fall through to execCommand */
      }
    }

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-10000px';
    area.style.opacity = '0';
    (document.body || document.documentElement).appendChild(area);

    const selection = document.getSelection();
    const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    let ok = false;
    try {
      area.select();
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();

    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    return ok;
  }

  function renderInto(container, markdown, options = {}) {
    if (!container) throw new PreviewError('invalid-argument', '预览容器不存在');
    if (typeof markdown !== 'string') throw new PreviewError('invalid-argument', 'Markdown 内容无效');
    if (markdown.length > MAX_MARKDOWN_CHARS) {
      throw new PreviewError('too-large', 'Markdown 内容过大，无法预览');
    }

    let html;
    try {
      html = marked.parse(markdown, { gfm: true, breaks: false, async: false });
    } catch (error) {
      throw new PreviewError('parse-failed', 'Markdown 解析失败', error && error.message ? error.message : '');
    }

    let sanitized;
    try {
      sanitized = DOMPurify.sanitize(String(html), SANITIZE_CONFIG);
    } catch (error) {
      throw new PreviewError('sanitize-failed', 'Markdown 内容安全处理失败', error && error.message ? error.message : '');
    }

    const template = document.createElement('template');
    try {
      template.innerHTML = sanitized;
    } catch (error) {
      throw new PreviewError('render-failed', '无法写入预览内容', error && error.message ? error.message : '');
    }

    const fragment = template.content;
    normalizeFragment(fragment);

    const article = document.createElement('article');
    article.className = 'mdp-markdown';
    article.appendChild(fragment);
    container.replaceChildren(article);
    enhance(article, options);
    return article;
  }

  globalThis.MDPReview = Object.freeze({
    MAX_FILE_BYTES,
    PreviewError,
    decodeBuffer,
    readFile,
    renderInto,
    isMarkdownFile,
    formatBytes,
    normalizeTheme,
    nextTheme,
    themeLabel,
    loadTheme,
    saveTheme,
  });
})();
