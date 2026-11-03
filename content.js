/* In-page Markdown preview overlay. Runs only on URLs that look like Markdown files. */
(function () {
  'use strict';

  if (globalThis.__mdpContentInstalled) return;
  globalThis.__mdpContentInstalled = true;

  const API = globalThis.MDPReview;
  const CSS = globalThis.MDP_CSS;
  if (!API || !CSS) {
    console.error('[Markdown Preview] renderer assets are missing');
    return;
  }

  const HOST_ID = '__mdp_overlay__';
  const IS_FILE_MARKDOWN =
    location.protocol === 'file:' && /\.(md|markdown)$/i.test(location.pathname);
  const BOOT_TIMEOUT_MS = 4000;
  const ICONS = {
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    theme:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    error:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h4"/></svg>',
  };

  const OVERLAY_CSS = `
    :host {
      all: initial;
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      display: block;
      z-index: 2147483647;
      color-scheme: light dark;
    }
    .mdp-overlay { width: 100%; height: 100%; }
    .mdp-overlay .mdp-stage { overscroll-behavior: contain; }
  `;

  const SHELL = `
    <div class="mdp-app mdp-overlay" data-theme="auto" role="dialog" aria-modal="true" aria-label="Markdown 预览" tabindex="-1">
      <header class="mdp-toolbar">
        <div class="mdp-brand">
          <span class="mdp-logo" aria-hidden="true">M</span>
          <div class="mdp-heading">
            <h1 class="mdp-filename" data-mdp="filename"></h1>
            <p class="mdp-meta" data-mdp="meta">Markdown 预览</p>
          </div>
        </div>
        <div class="mdp-actions">
          <button type="button" class="mdp-icon-btn" data-mdp="theme" title="主题：跟随系统" aria-label="切换主题">${ICONS.theme}</button>
          <button type="button" class="mdp-icon-btn" data-mdp="close" title="关闭预览 (Esc)" aria-label="关闭预览">${ICONS.close}</button>
        </div>
      </header>
      <main class="mdp-stage" tabindex="0">
        <div class="mdp-doc">
          <div class="mdp-warning" data-mdp="warning" hidden></div>
          <div class="mdp-doc-body" data-mdp="body"></div>
        </div>
      </main>
    </div>
  `;

  let ui = null;
  let opening = false;
  let autoPreviewStarted = false;
  let bootVisibility = null;
  let bootTimer = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'MD_NATIVE_CONTEXT') {
      sendResponse({ url: location.href });
      return false;
    }
    if (!message || message.type !== 'MD_TOGGLE') return false;
    sendResponse({ handled: true });
    toggle();
    return false;
  });

  async function toggle() {
    if (opening) return;
    if (ui) {
      closeOverlay();
      return;
    }
    opening = true;
    try {
      await openOverlay();
    } catch (error) {
      console.error('[Markdown Preview] failed to open overlay', error);
    } finally {
      opening = false;
    }
  }

  async function openOverlay() {
    if (ui) return;
    const state = createUi();
    ui = state;

    try {
      const theme = await API.loadTheme();
      if (ui !== state) return;
      applyTheme(state, theme);
      state.filenameEl.textContent = fileNameFromLocation();
      state.metaEl.textContent = '正在读取…';
      showLoading(state);
      setVisible(state);
      await beginLoad(state);
    } catch (error) {
      if (ui !== state) return;
      setVisible(state);
      showError(state, toPreviewError(error));
    }
  }

  function createUi() {
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-mdp-overlay', '');
    for (const [property, value] of Object.entries({
      position: 'fixed',
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
      width: 'auto',
      height: 'auto',
      margin: '0',
      padding: '0',
      border: '0',
      display: 'block',
      'z-index': '2147483647',
      background: 'transparent',
      'pointer-events': 'auto',
      visibility: 'hidden',
    })) {
      host.style.setProperty(property, value, 'important');
    }

    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${CSS}\n${OVERLAY_CSS}`);
    shadow.adoptedStyleSheets = [sheet];
    shadow.innerHTML = SHELL;

    const app = shadow.querySelector('.mdp-app');
    const filenameEl = shadow.querySelector('[data-mdp="filename"]');
    const metaEl = shadow.querySelector('[data-mdp="meta"]');
    const warningEl = shadow.querySelector('[data-mdp="warning"]');
    const bodyEl = shadow.querySelector('[data-mdp="body"]');
    const stage = shadow.querySelector('.mdp-stage');
    const themeButton = shadow.querySelector('[data-mdp="theme"]');
    const closeButton = shadow.querySelector('[data-mdp="close"]');

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const htmlOverflow = document.documentElement.style.overflow;

    const state = {
      host,
      shadow,
      app,
      filenameEl,
      metaEl,
      warningEl,
      bodyEl,
      stage,
      themeButton,
      theme: 'auto',
      loadToken: 0,
      previousFocus,
      htmlOverflow,
      onKeyDown: null,
      onStorage: null,
    };

    state.editor = globalThis.MDPEditor.attach({
      app, stage, content: bodyEl,
      actions: shadow.querySelector('.mdp-actions'),
      onName(name) { filenameEl.textContent = name; },
    });

    state.onKeyDown = (event) => handleKeyDown(event, state);
    state.onStorage = (changes, areaName) => {
      if (areaName !== 'local' || !changes.mdTheme) return;
      if (ui !== state) return;
      applyTheme(state, changes.mdTheme.newValue);
    };

    document.addEventListener('keydown', state.onKeyDown, true);
    chrome.storage.onChanged.addListener(state.onStorage);
    closeButton.addEventListener('click', closeOverlay);
    themeButton.addEventListener('click', () => cycleTheme(state));

    document.documentElement.style.overflow = 'hidden';
    (document.documentElement || document.body).appendChild(host);
    return state;
  }

  function setVisible(state) {
    state.host.style.setProperty('visibility', 'visible', 'important');
    revealRawPage();
    state.app.focus({ preventScroll: true });
  }

  function closeOverlay() {
    const state = ui;
    if (!state) return;
    if (!state.editor.canLeave()) return;
    ui = null;
    state.editor.destroy();
    state.loadToken += 1;
    document.removeEventListener('keydown', state.onKeyDown, true);
    try {
      chrome.storage.onChanged.removeListener(state.onStorage);
    } catch {
      /* storage may be unavailable */
    }
    revealRawPage();
    document.documentElement.style.overflow = state.htmlOverflow;
    state.host.remove();

    const previous = state.previousFocus;
    if (previous && previous.isConnected && typeof previous.focus === 'function') {
      try {
        previous.focus({ preventScroll: true });
      } catch {
        /* the page may have removed the element */
      }
    }
  }

  function handleKeyDown(event, state) {
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      closeOverlay();
      return;
    }
    if (event.key === 'Tab') trapFocus(event, state);
  }

  function trapFocus(event, state) {
    const focusables = [...state.shadow.querySelectorAll(
      'button:not([disabled]), textarea, a[href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = state.shadow.activeElement;

    if (!active) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && (active === first || active === state.app)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function applyTheme(state, theme) {
    const normalized = API.normalizeTheme(theme);
    state.theme = normalized;
    state.app.dataset.theme = normalized;
    const label = API.themeLabel(normalized);
    state.themeButton.title = `主题：${label}（点击切换）`;
    state.themeButton.setAttribute('aria-label', `切换主题，当前${label}`);
  }

  function cycleTheme(state) {
    const next = API.nextTheme(state.theme);
    applyTheme(state, next);
    API.saveTheme(next);
  }

  async function beginLoad(state) {
    const loadToken = ++state.loadToken;
    state.metaEl.textContent = '正在读取…';
    showLoading(state);

    // Local file pages are initialized at document_start; wait for the text
    // viewer's <pre> to exist before falling back to page text.
    await waitForDomReady();
    if (ui !== state || state.loadToken !== loadToken) return;

    let source;
    try {
      source = await loadSource();
    } catch (error) {
      if (ui !== state || state.loadToken !== loadToken) return;
      showError(state, toPreviewError(error));
      return;
    }
    if (ui !== state || state.loadToken !== loadToken) return;

    if (!source.text.trim()) {
      showError(state, new API.PreviewError('empty', '文件为空'));
      return;
    }

    state.filenameEl.textContent = fileNameFromLocation();
    state.metaEl.textContent = metaText(source);
    state.warningEl.hidden = !source.lossy;
    state.warningEl.textContent = source.lossy ? '文件编码可能不是 UTF-8，部分字符可能显示异常。' : '';

    try {
      API.renderInto(state.bodyEl, source.text, { baseUrl: document.baseURI || location.href });
      state.editor.setDocument({
        text: source.text, name: fileNameFromLocation(), encoding: source.encoding, sourceUrl: location.href,
        nativeFile: IS_FILE_MARKDOWN ? globalThis.MDPNativeFile.create(source.sourceDigest, source.textDigest) : null,
        options: { baseUrl: document.baseURI || location.href },
      });
    } catch (error) {
      showError(state, toPreviewError(error));
      return;
    }

    state.stage.scrollTop = 0;
    state.stage.focus({ preventScroll: true });
  }

  async function loadSource() {
    let fetchError = null;
    try {
      const response = await fetch(location.href, { cache: 'no-store', credentials: 'same-origin' });
      if (response.ok) {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('text/html')) {
          const declaredLength = response.headers.get('content-length');
          if (declaredLength !== null && Number(declaredLength) > API.MAX_FILE_BYTES) {
            throw new API.PreviewError(
              'too-large',
              `文件大小 ${API.formatBytes(Number(declaredLength))}，超过 ${API.formatBytes(API.MAX_FILE_BYTES)} 的预览上限`,
            );
          }
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > API.MAX_FILE_BYTES) {
            throw new API.PreviewError(
              'too-large',
              `文件大小 ${API.formatBytes(buffer.byteLength)}，超过 ${API.formatBytes(API.MAX_FILE_BYTES)} 的预览上限`,
            );
          }
          const decoded = API.decodeBuffer(buffer);
          decoded.bytes = buffer.byteLength;
          if (IS_FILE_MARKDOWN) decoded.sourceDigest = await globalThis.MDPNativeFile.digest(buffer);
          if (decoded.text.trim()) return decoded;
        }
      }
    } catch (error) {
      if (error instanceof API.PreviewError) throw error;
      fetchError = error;
    }

    const contentType = (document.contentType || '').toLowerCase();
    if (contentType === '' || /^text\/(plain|markdown|x-markdown)/.test(contentType)) {
      const pre = document.querySelector('pre');
      const text = pre && typeof pre.textContent === 'string' ? pre.textContent : document.body ? document.body.innerText : '';
      if (text && text.trim()) {
        const bytes = new Blob([text]).size;
        if (bytes > API.MAX_FILE_BYTES) {
          throw new API.PreviewError(
            'too-large',
            `文件大小 ${API.formatBytes(bytes)}，超过 ${API.formatBytes(API.MAX_FILE_BYTES)} 的预览上限`,
          );
        }
        const textDigest = IS_FILE_MARKDOWN
          ? await globalThis.MDPNativeFile.digest(new TextEncoder().encode(text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n')))
          : undefined;
        return { text, bytes, encoding: '页面文本', lossy: false, textDigest };
      }
      throw new API.PreviewError('empty', '文件为空');
    }

    throw new API.PreviewError(
      'source-failed',
      '无法读取此页面的 Markdown 源内容',
      fetchError && fetchError.message ? String(fetchError.message) : '',
    );
  }

  function metaText(source) {
    const parts = [];
    if (source.bytes) parts.push(API.formatBytes(source.bytes));
    if (source.encoding) parts.push(source.encoding);
    return parts.join(' · ') || 'Markdown';
  }

  function fileNameFromLocation() {
    try {
      const path = decodeURIComponent(location.pathname);
      const name = path.split('/').filter(Boolean).pop();
      return name || 'Markdown 预览';
    } catch {
      return 'Markdown 预览';
    }
  }

  function showLoading(state) {
    state.warningEl.hidden = true;
    const wrapper = document.createElement('div');
    wrapper.className = 'mdp-loading';
    const spinner = document.createElement('span');
    spinner.className = 'mdp-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.textContent = '正在读取 Markdown…';
    wrapper.append(spinner, text);
    state.bodyEl.replaceChildren(wrapper);
  }

  function showError(state, error) {
    const code = error && error.code ? error.code : 'unknown';
    let title = '无法预览 Markdown';
    let description = (error && error.message) || '发生未知错误';

    if (code === 'empty') {
      title = '文件为空';
      description = '这个 Markdown 文件没有可显示的内容。';
    } else if (code === 'too-large') {
      title = '文件过大';
    } else if (code === 'binary') {
      title = '不是文本文件';
    } else if (code === 'source-failed') {
      description = '浏览器阻止了读取此页面的源文件。你可以关闭预览，然后点击扩展图标选择本地文件。';
    }

    state.metaEl.textContent = '预览失败';
    state.warningEl.hidden = true;

    const actions = [
      { label: '重试', variant: 'primary', onClick: () => retry(state) },
      { label: '关闭预览', onClick: closeOverlay },
    ];
    if (code === 'source-failed') {
      actions.splice(1, 0, {
        label: '打开文件选择器',
        onClick: async () => {
          try {
            await chrome.runtime.sendMessage({ type: 'MD_OPEN_PREVIEW' });
            closeOverlay();
          } catch (messageError) {
            console.warn('[Markdown Preview] cannot open preview tab', messageError);
          }
        },
      });
    }

    renderStateCard(state, {
      icon: ICONS.error,
      title,
      description,
      detail: error && error.detail ? error.detail : '',
      actions,
    });
  }

  function retry(state) {
    if (ui !== state) return;
    beginLoad(state).catch((error) => {
      if (ui === state) showError(state, toPreviewError(error));
    });
  }

  function renderStateCard(state, { icon, title, description, detail, actions }) {
    const card = document.createElement('div');
    card.className = 'mdp-state-card';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'mdp-state-icon';
    iconWrap.innerHTML = icon;

    const heading = document.createElement('h2');
    heading.textContent = title;

    const paragraph = document.createElement('p');
    paragraph.textContent = description;

    card.append(iconWrap, heading, paragraph);

    if (detail) {
      const detailEl = document.createElement('p');
      detailEl.className = 'mdp-state-detail';
      detailEl.textContent = detail;
      card.appendChild(detailEl);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'mdp-state-actions';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mdp-btn${action.variant === 'primary' ? ' mdp-btn-primary' : ''}`;
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      actionRow.appendChild(button);
    }
    card.appendChild(actionRow);

    state.bodyEl.replaceChildren(card);
  }

  function waitForDomReady() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise((resolve) => {
      let timer = null;
      const finish = () => {
        clearTimeout(timer);
        document.removeEventListener('DOMContentLoaded', finish);
        resolve();
      };
      timer = setTimeout(finish, 10000);
      document.addEventListener('DOMContentLoaded', finish, { once: true });
    });
  }

  function hideRawPage() {
    if (bootVisibility) return;
    const root = document.documentElement;
    if (!root) return;
    bootVisibility = {
      value: root.style.getPropertyValue('visibility'),
      priority: root.style.getPropertyPriority('visibility'),
    };
    root.style.setProperty('visibility', 'hidden', 'important');
    clearTimeout(bootTimer);
    bootTimer = setTimeout(revealRawPage, BOOT_TIMEOUT_MS);
  }

  function revealRawPage() {
    clearTimeout(bootTimer);
    bootTimer = null;
    const saved = bootVisibility;
    bootVisibility = null;
    if (!saved) return;
    const root = document.documentElement;
    if (!root) return;
    if (saved.value) {
      root.style.setProperty('visibility', saved.value, saved.priority);
    } else {
      root.style.removeProperty('visibility');
    }
  }

  function startAutoPreview() {
    if (autoPreviewStarted) return;
    autoPreviewStarted = true;

    const boot = () => {
      hideRawPage();
      openOverlay().catch((error) => {
        console.error('[Markdown Preview] auto preview failed', error);
        revealRawPage();
      });
    };

    if (document.documentElement) {
      boot();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      observer.disconnect();
      boot();
    });
    observer.observe(document, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      revealRawPage();
    }, BOOT_TIMEOUT_MS);
  }

  function toPreviewError(error) {
    if (error instanceof API.PreviewError) return error;
    return new API.PreviewError('unknown', (error && error.message) || '预览失败');
  }

  if (IS_FILE_MARKDOWN) startAutoPreview();
})();
