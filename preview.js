/* Standalone picker/preview page. */
(function () {
  'use strict';

  if (globalThis.__mdpPreviewPage) return;
  globalThis.__mdpPreviewPage = true;

  const API = globalThis.MDPReview;
  if (!API) {
    document.body.textContent = '预览组件加载失败，请重新加载扩展。';
    return;
  }

  const ICON_ERROR =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 13h6M9 17h4"/></svg>';

  const byId = (id) => document.getElementById(id);
  const els = {
    app: byId('app'),
    fileName: byId('fileName'),
    fileMeta: byId('fileMeta'),
    themeBtn: byId('themeBtn'),
    reselectBtn: byId('reselectBtn'),
    closeBtn: byId('closeBtn'),
    stage: byId('stage'),
    dropzone: byId('dropzone'),
    pickBtn: byId('pickBtn'),
    fileInput: byId('fileInput'),
    shortcutRow: byId('shortcutRow'),
    shortcutText: byId('shortcutText'),
    shortcutSettings: byId('shortcutSettings'),
    doc: byId('doc'),
    warning: byId('warning'),
    content: byId('content'),
    statePanel: byId('statePanel'),
    dragOverlay: byId('dragOverlay'),
    toast: byId('toast'),
  };

  const state = {
    theme: 'auto',
    urls: [],
    loadToken: 0,
    docOpen: false,
    currentName: '',
    toastTimer: null,
    dragDepth: 0,
    tabId: null,
  };

  const editor = globalThis.MDPEditor.attach({
    app: els.app, stage: els.stage, content: els.content,
    actions: els.app.querySelector('.mdp-actions'),
    onName(name) {
      setHeader(name, '本地文件');
      document.title = `${name} · Markdown 预览`;
    },
  });

  bind();
  initTheme();
  initShortcut();
  announceReady();

  function bind() {
    els.pickBtn.addEventListener('click', openPicker);
    els.reselectBtn.addEventListener('click', openPicker);
    els.themeBtn.addEventListener('click', cycleTheme);
    els.closeBtn.addEventListener('click', closePreview);
    els.shortcutSettings.addEventListener('click', openShortcuts);

    els.fileInput.addEventListener('change', () => {
      const files = [...els.fileInput.files];
      els.fileInput.value = '';
      if (files.length) handleFiles(files);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (!els.dragOverlay.hidden) {
        resetDrag();
        return;
      }
      event.preventDefault();
      closePreview();
    });

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    document.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget) resetDrag();
    });

    els.content.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target ? target.closest('a[href]') : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return;
      event.preventDefault();
      toast('相对链接在独立预览页中不可用，请在原页面中按 Ctrl+M 预览。');
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.mdTheme) return;
      state.theme = API.normalizeTheme(changes.mdTheme.newValue);
      applyTheme();
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'MD_REQUEST_CLOSE_PREVIEW' || message.tabId !== state.tabId) return false;
      sendResponse({ handled: true });
      closePreview();
      return false;
    });
  }

  function announceReady() {
    try {
      const request = chrome.tabs.getCurrent().then((tab) => {
        state.tabId = tab?.id ?? null;
        return chrome.runtime.sendMessage({ type: 'MD_PREVIEW_TAB_READY' });
      });
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch {
      /* the service worker is not required for local rendering */
    }
  }

  async function initTheme() {
    state.theme = await API.loadTheme();
    applyTheme();
  }

  function applyTheme() {
    els.app.dataset.theme = state.theme;
    const label = API.themeLabel(state.theme);
    els.themeBtn.title = `主题：${label}（点击切换）`;
    els.themeBtn.setAttribute('aria-label', `切换主题，当前${label}`);
  }

  function cycleTheme() {
    state.theme = API.nextTheme(state.theme);
    applyTheme();
    API.saveTheme(state.theme);
  }

  async function initShortcut() {
    try {
      const commands = await chrome.commands.getAll();
      const command = commands.find((item) => item.name === 'toggle-preview');
      const shortcut = command && command.shortcut ? command.shortcut : '';
      if (shortcut) {
        els.shortcutText.textContent = `快捷键 ${prettyShortcut(shortcut)}`;
      } else {
        els.shortcutRow.classList.add('is-warning');
        els.shortcutText.textContent = '快捷键未绑定（可能与 Chrome 或其他扩展冲突）';
      }
    } catch {
      /* keep the default Ctrl+M hint */
    }
  }

  function prettyShortcut(shortcut) {
    const labels = {
      MacCtrl: 'Ctrl',
      Ctrl: 'Ctrl',
      Alt: 'Alt',
      Option: '⌥',
      Shift: 'Shift',
      Command: '⌘',
      MacCommand: '⌘',
    };
    return String(shortcut)
      .split('+')
      .map((part) => labels[part] || part)
      .join('+');
  }

  async function openShortcuts() {
    let response = null;
    try {
      response = await chrome.runtime.sendMessage({ type: 'MD_OPEN_SHORTCUTS' });
    } catch {
      response = null;
    }
    if (!response || !response.ok) {
      toast('请在地址栏打开 chrome://extensions/shortcuts 设置快捷键');
    }
  }

  async function closePreview() {
    if (!editor.canLeave()) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'MD_CLOSE_SELF' });
      if (response && response.ok) return;
    } catch {
      /* fall back to window.close below */
    }
    window.close();
    setTimeout(() => toast('无法自动关闭标签页，请手动关闭'), 300);
  }

  async function openPicker() {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: 'Markdown 与图片', accept: {
            'text/markdown': ['.md', '.markdown'],
            'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico'],
          } }],
        });
        const files = await Promise.all(handles.map((handle) => handle.getFile()));
        const index = files.findIndex((file) => API.isMarkdownFile(file));
        await handleFiles(files, index >= 0 ? handles[index] : null);
      } catch (error) {
        if (error?.name !== 'AbortError') toast('无法选择文件，请重试，或拖入 Markdown 文件。');
      }
      return;
    }
    els.fileInput.value = '';
    els.fileInput.click();
  }

  function onDragEnter(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    state.dragDepth += 1;
    els.dragOverlay.hidden = false;
  }

  function onDragOver(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    els.dragOverlay.hidden = false;
  }

  function onDragLeave(event) {
    if (!isFileDrag(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) els.dragOverlay.hidden = true;
  }

  async function onDrop(event) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    resetDrag();
    const files = event.dataTransfer ? [...event.dataTransfer.files] : [];
    if (!files.length) {
      toast('未检测到文件');
      return;
    }
    // Request handles during the drop event, before yielding to the event loop.
    const handles = [...(event.dataTransfer?.items || [])].map((item) =>
      item.kind === 'file' && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(() => null) : null,
    );
    const resolved = await Promise.all(handles);
    const markdownFile = files.find((file) => API.isMarkdownFile(file));
    const handle = resolved.find((item) => item?.kind === 'file' && item.name === markdownFile?.name);
    handleFiles(files, handle || null);
  }

  function resetDrag() {
    state.dragDepth = 0;
    els.dragOverlay.hidden = true;
  }

  function isFileDrag(event) {
    const transfer = event.dataTransfer;
    return Boolean(transfer) && [...transfer.types].includes('Files');
  }

  async function handleFiles(fileList, handle = null) {
    const files = [...fileList];
    if (!files.length) {
      toast('未检测到文件');
      return;
    }

    const markdownFiles = files.filter((file) => API.isMarkdownFile(file));
    if (markdownFiles.length === 0) {
      if (state.docOpen) {
        toast('仅支持 .md 或 .markdown 文件');
        return;
      }
      const names = files
        .slice(0, 2)
        .map((file) => file.name)
        .filter(Boolean)
        .join('、');
      showErrorState(
        new API.PreviewError(
          'type',
          `仅支持 .md 或 .markdown 文件${names ? `，当前选择：${names}` : ''}`,
        ),
        { name: files[0].name || '未知文件' },
      );
      return;
    }

    if (markdownFiles.length > 1) {
      toast('一次只能预览一个 Markdown 文件');
      return;
    }

    if (!editor.canLeave()) return;
    editor.reset();

    const markdownFile = markdownFiles[0];
    const previousUrls = state.urls;
    const resources = buildResourceMap(files, markdownFile);
    const loadToken = ++state.loadToken;

    state.docOpen = false;
    setHeader(markdownFile.name, '读取中…');
    showLoading();

    let decoded;
    try {
      decoded = await API.readFile(markdownFile);
    } catch (error) {
      if (loadToken !== state.loadToken) {
        revokeUrls(resources.urls);
        return;
      }
      revokeUrls(resources.urls);
      showErrorState(error, { name: markdownFile.name });
      return;
    }

    if (loadToken !== state.loadToken) {
      revokeUrls(resources.urls);
      return;
    }

    if (!decoded.text.trim()) {
      revokeUrls(resources.urls);
      showErrorState(new API.PreviewError('empty', '文件为空'), { name: markdownFile.name });
      return;
    }

    try {
      API.renderInto(els.content, decoded.text, { resolveResource: resources.resolve });
    } catch (error) {
      if (loadToken !== state.loadToken) {
        revokeUrls(resources.urls);
        return;
      }
      revokeUrls(resources.urls);
      showErrorState(error, { name: markdownFile.name });
      return;
    }

    if (loadToken !== state.loadToken) {
      revokeUrls(resources.urls);
      return;
    }

    revokeUrls(previousUrls);
    state.urls = resources.urls;
    state.docOpen = true;
    state.currentName = markdownFile.name;
    editor.setDocument({
      text: decoded.text, name: markdownFile.name, handle, file: markdownFile, encoding: decoded.encoding,
      options: { resolveResource: resources.resolve },
    });

    els.warning.hidden = !decoded.lossy;
    els.warning.textContent = decoded.lossy ? '文件编码可能不是 UTF-8，部分字符可能显示异常。' : '';
    setHeader(markdownFile.name, metaText(decoded));
    document.title = `${markdownFile.name} · Markdown 预览`;

    els.dropzone.hidden = true;
    els.statePanel.hidden = true;
    els.doc.hidden = false;
    els.stage.scrollTop = 0;
    els.stage.focus({ preventScroll: true });
  }

  function metaText(decoded) {
    const parts = [];
    if (decoded.bytes) parts.push(API.formatBytes(decoded.bytes));
    if (decoded.encoding) parts.push(decoded.encoding);
    return parts.join(' · ') || 'Markdown';
  }

  function setHeader(name, meta) {
    const displayName = name || 'Markdown 预览';
    state.currentName = displayName;
    els.fileName.textContent = displayName;
    els.fileName.title = displayName;
    els.fileMeta.textContent = meta || '本地渲染 · 不上传';
  }

  function showLoading() {
    els.dropzone.hidden = true;
    els.doc.hidden = true;
    els.statePanel.hidden = false;
    els.warning.hidden = true;

    const wrapper = document.createElement('div');
    wrapper.className = 'mdp-loading';
    const spinner = document.createElement('span');
    spinner.className = 'mdp-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.textContent = '正在读取 Markdown…';
    wrapper.append(spinner, text);
    els.statePanel.replaceChildren(wrapper);
    els.stage.scrollTop = 0;
  }

  function showErrorState(error, options = {}) {
    editor.reset();
    state.docOpen = false;
    revokeUrls(state.urls);
    state.urls = [];

    const name = options.name || state.currentName || 'Markdown 预览';
    setHeader(name, '无法预览');
    document.title = '预览失败 · Markdown 预览';
    els.dropzone.hidden = true;
    els.doc.hidden = true;
    els.statePanel.hidden = false;
    els.warning.hidden = true;

    const described = describeError(error);
    renderStatePanel({
      title: described.title,
      description: described.description,
      detail: error && error.detail ? error.detail : '',
      actions: [
        { label: '重新选择文件', variant: 'primary', onClick: openPicker },
        { label: '关闭预览', onClick: closePreview },
      ],
    });
    els.stage.scrollTop = 0;
    els.statePanel.focus({ preventScroll: true });
  }

  function describeError(error) {
    const code = error && error.code;
    if (code === 'empty') {
      return { title: '文件为空', description: '这个 Markdown 文件没有可显示的内容。' };
    }
    if (code === 'too-large') {
      return { title: '文件过大', description: (error && error.message) || '文件超过预览上限。' };
    }
    if (code === 'binary') {
      return { title: '不是文本文件', description: (error && error.message) || '文件内容不是文本。' };
    }
    if (code === 'type') {
      return { title: '不支持的文件类型', description: (error && error.message) || '请选择 Markdown 文件。' };
    }
    if (code === 'read-failed') {
      return { title: '读取文件失败', description: (error && error.message) || '浏览器无法读取该文件。' };
    }
    if (code === 'parse-failed' || code === 'sanitize-failed' || code === 'render-failed') {
      return { title: 'Markdown 解析失败', description: (error && error.message) || '无法渲染此 Markdown。' };
    }
    return { title: '无法预览 Markdown', description: (error && error.message) || '发生未知错误。' };
  }

  function renderStatePanel({ title, description, detail, actions }) {
    const card = document.createElement('div');
    card.className = 'mdp-state-card';

    const icon = document.createElement('div');
    icon.className = 'mdp-state-icon';
    icon.innerHTML = ICON_ERROR;

    const heading = document.createElement('h2');
    heading.textContent = title;

    const paragraph = document.createElement('p');
    paragraph.textContent = description;

    card.append(icon, heading, paragraph);

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

    els.statePanel.replaceChildren(card);
  }

  function buildResourceMap(files, markdownFile) {
    const urls = [];
    const exact = new Map();
    const basenames = new Map();
    const markdownPath = normalizePath(markdownFile.webkitRelativePath || markdownFile.name);
    const markdownDir = markdownPath.includes('/')
      ? markdownPath.slice(0, markdownPath.lastIndexOf('/') + 1)
      : '';

    for (const file of files) {
      if (file === markdownFile || !isImageFile(file)) continue;
      const url = URL.createObjectURL(file);
      urls.push(url);
      const relative = normalizePath(file.webkitRelativePath || file.name);
      addCandidate(exact, relative, url);
      if (markdownDir && relative.startsWith(markdownDir)) {
        addCandidate(exact, relative.slice(markdownDir.length), url);
      }
      addCandidate(basenames, relative.split('/').pop(), url);
    }

    return {
      urls,
      resolve(source) {
        if (!source || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(source)) return null;
        let path = source.split(/[?#]/)[0];
        try {
          path = decodeURIComponent(path);
        } catch {
          /* keep the raw path */
        }
        path = normalizePath(path);
        if (!path) return null;
        const exactMatch = exact.get(path);
        if (exactMatch) return exactMatch;
        const nameMatch = basenames.get(path.split('/').pop());
        return nameMatch || null;
      },
    };
  }

  function addCandidate(map, key, url) {
    const normalized = normalizePath(key);
    if (!normalized) return;
    if (!map.has(normalized)) {
      map.set(normalized, url);
    } else if (map.get(normalized) !== url) {
      map.set(normalized, null);
    }
  }

  function normalizePath(input) {
    const parts = [];
    for (const segment of String(input || '').replace(/\\/g, '/').split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        parts.pop();
        continue;
      }
      parts.push(segment);
    }
    return parts.join('/');
  }

  function isImageFile(file) {
    const type = String(file.type || '').toLowerCase();
    return type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(file.name || '');
  }

  function revokeUrls(urls) {
    for (const url of urls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
    }
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      els.toast.classList.remove('is-visible');
      state.toastTimer = null;
    }, 2800);
  }
})();
