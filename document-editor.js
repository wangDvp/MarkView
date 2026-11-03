/* Shared local editor for the standalone page and the Shadow DOM preview. */
(function () {
  'use strict';

  const API = globalThis.MDPReview;

  function attach({ app, stage, content, actions, onName = () => {} }) {
    const controls = document.createElement('div');
    controls.className = 'mdp-document-actions';
    const buttons = {};
    for (const [key, label] of Object.entries({
      edit: '编辑', save: '保存', saveAs: '另存为', word: '下载 Word', pdf: '下载 PDF',
    })) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mdp-btn';
      button.dataset.action = key;
      button.textContent = label;
      controls.append(button);
      buttons[key] = button;
    }
    actions.prepend(controls);

    const pane = document.createElement('section');
    pane.className = 'mdp-editor-pane';
    pane.hidden = true;
    const label = document.createElement('label');
    label.textContent = 'Markdown 源码';
    const textarea = document.createElement('textarea');
    textarea.className = 'mdp-editor';
    textarea.setAttribute('aria-label', 'Markdown 源码');
    textarea.spellcheck = false;
    label.append(textarea);
    pane.append(label);
    stage.prepend(pane);

    const status = document.createElement('span');
    status.className = 'mdp-save-status';
    status.setAttribute('role', 'status');
    controls.prepend(status);
    const notice = document.createElement('div');
    notice.className = 'mdp-editor-notice';
    notice.setAttribute('role', 'status');
    notice.hidden = true;
    app.append(notice);

    let current = null;
    let editing = false;
    let authorizing = false;
    let saving = false;
    let exporting = false;
    let renderTimer;
    let noticeTimer;

    const text = () => textarea.value;
    const dirty = () => Boolean(current && text() !== current.savedText);

    function notify(message) {
      notice.textContent = message;
      notice.hidden = false;
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { notice.hidden = true; }, 7000);
    }

    function update() {
      controls.hidden = !current;
      buttons.edit.textContent = authorizing ? (current?.nativeFile ? '连接中…' : '授权中…') : editing ? '纯预览' : '编辑';
      buttons.edit.disabled = authorizing;
      buttons.edit.title = current?.nativeFile ? '编辑当前本地文件，保存时通过本地助手直接写回' : current?.localFile && !current.writeAuthorized
        ? '首次编辑需选择并授权正在预览的原文件，之后保存直接写回'
        : '切换编辑与纯预览';
      buttons.edit.setAttribute('aria-pressed', String(editing));
      status.textContent = dirty() ? '未保存' : '已保存';
      status.classList.toggle('is-dirty', dirty());
      buttons.save.disabled = !current || saving || authorizing;
      buttons.saveAs.disabled = !current || saving || authorizing;
      buttons.word.disabled = !current || exporting || authorizing;
      buttons.pdf.disabled = !current || exporting || authorizing;
      buttons.pdf.textContent = exporting === 'pdf' ? '生成 PDF…' : '下载 PDF';
      buttons.save.textContent = saving ? '保存中…' : '保存';
      buttons.save.title = current?.nativeFile ? '按当前文件路径直接保存（Ctrl/⌘+S）' : current?.handle
        ? '保存到当前文件（Ctrl/⌘+S）'
        : '首次编辑时授权原文件，保存直接写回；选择新位置请用“另存为”';
      pane.hidden = !current || !editing;
      app.classList.toggle('mdp-is-editing', Boolean(current && editing));
    }

    function render() {
      clearTimeout(renderTimer);
      if (!current) return false;
      try {
        API.renderInto(content, text(), current.options);
        textarea.removeAttribute('aria-invalid');
        return true;
      } catch {
        textarea.setAttribute('aria-invalid', 'true');
        notify('预览更新失败，请检查内容；编辑内容仍保留，可继续修改或保存。');
        return false;
      }
    }

    textarea.addEventListener('input', () => {
      update();
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 180);
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.shiftKey) return;
      event.preventDefault();
      textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    async function authorizeOriginal(target) {
      if (target.writeAuthorized) return true;
      if (authorizing || current !== target) return false;
      authorizing = true;
      update();
      try {
        if (target.nativeFile) {
          const metadata = await target.nativeFile.prepare();
          if (current !== target) return false;
          if (['UTF-8', 'UTF-16 LE', 'UTF-16 BE'].includes(metadata.encoding)) target.encoding = metadata.encoding;
          if (['\n', '\r\n'].includes(metadata.eol)) target.eol = metadata.eol;
          if (typeof metadata.bom === 'boolean') target.bom = metadata.bom;
          target.writeAuthorized = true;
          return true;
        }
        let handle = target.handle;
        const selectingOriginal = !handle;
        if (!handle) {
          if (typeof window.showOpenFilePicker !== 'function') {
            notify('当前页面无法授权原文件。请通过扩展的“选择文件”打开原文件后编辑。');
            return false;
          }
          notify(`请选择正在预览的原文件“${target.name}”，以授权写回。`);
          [handle] = await window.showOpenFilePicker({
            multiple: false,
            excludeAcceptAllOption: true,
            types: [{ description: `授权原文件：${target.name}`, accept: { 'text/markdown': ['.md', '.markdown'] } }],
          });
        }
        if (!handle || current !== target) return false;
        const file = await handle.getFile();
        if (selectingOriginal) {
          if (file.name.normalize('NFC') !== target.name.normalize('NFC')) {
            notify('所选文件名与当前预览不一致，请选择正在预览的原文件。');
            return false;
          }
          const decoded = await API.readFile(file);
          if (decoded.text.replace(/\r\n?/g, '\n') !== target.savedText) {
            notify('所选文件内容与当前预览不一致，可能选错文件或原文件已修改。请确认原文件并刷新预览。');
            return false;
          }
        } else if (target.version && (file.lastModified !== target.version.lastModified || file.size !== target.version.size)) {
          notify('原文件已被其他程序修改，请重新打开后编辑，或另存为保留当前内容。');
          return false;
        }
        const permission = { mode: 'readwrite' };
        if (typeof handle.queryPermission === 'function' &&
            await handle.queryPermission(permission) !== 'granted' &&
            await handle.requestPermission(permission) !== 'granted') {
          notify('未获得原文件写入权限，仍保留当前预览。请重新点击“编辑”授权。');
          return false;
        }
        if (current !== target) return false;
        target.handle = handle;
        target.version = { lastModified: file.lastModified, size: file.size };
        target.writeAuthorized = true;
        notify('已授权原文件；点击“保存”将直接写回。');
        return true;
      } catch (error) {
        if (error?.name !== 'AbortError') notify(error.userMessage || '原文件授权失败，请检查文件访问权限后重试；当前内容仍保留。');
        return false;
      } finally {
        authorizing = false;
        update();
      }
    }

    buttons.edit.addEventListener('click', async () => {
      const target = current;
      if (!target || authorizing) return;
      if (!editing && target.localFile && !await authorizeOriginal(target)) return;
      if (current !== target) return;
      editing = !editing;
      render();
      update();
      if (editing) textarea.focus();
    });

    async function save(saveAs = false) {
      if (!current || saving || authorizing) return;
      const target = current;
      const snapshot = text();
      saving = true;
      update();
      let writable;
      try {
        if (!saveAs && target.localFile && !await authorizeOriginal(target)) return;
        const data = encode(snapshot, target);
        if (data.size > API.MAX_FILE_BYTES) {
          notify('内容超过 5 MB，请缩小后保存。');
          return;
        }
        if (!saveAs && target.nativeFile && !target.handle) {
          await target.nativeFile.save(data);
          if (current === target) target.savedText = snapshot;
          notify('已保存到原文件。');
          return;
        }
        let handle = saveAs ? null : target.handle;
        if (!handle) {
          if (typeof window.showSaveFilePicker !== 'function') {
            if (!saveAs) {
              notify('当前页面不支持写回文件。请在扩展的独立预览页打开本地文件，或使用“另存为”下载副本。');
              return;
            }
            globalThis.MDPExport.download(data, target.name);
            notify('已发起 Markdown 副本下载。');
            return;
          }
          handle = await window.showSaveFilePicker({
            suggestedName: target.name,
            types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown'] } }],
          });
        }
        if (!saveAs && handle === target.handle && target.version) {
          const latest = await handle.getFile();
          if (latest.lastModified !== target.version.lastModified || latest.size !== target.version.size) {
            notify('原文件已被其他程序修改。请重新打开文件，或使用“另存为”保留当前编辑内容。');
            return;
          }
        }
        // Snapshot before writing; a concurrent edit must remain marked unsaved.
        writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        writable = null;
        if (current === target) {
          target.handle = handle;
          target.nativeFile = null;
          target.localFile = true;
          target.writeAuthorized = true;
          target.savedText = snapshot;
          target.name = handle.name;
          const file = await handle.getFile().catch(() => null);
          target.version = file ? { lastModified: file.lastModified, size: file.size } : null;
          onName(handle.name);
        }
        notify('已保存到文件。');
      } catch (error) {
        if (writable) await writable.abort().catch(() => {});
        if (error?.name !== 'AbortError') notify(error.userMessage || '保存失败，请检查文件写入权限后重试；编辑内容仍保留。');
      } finally {
        saving = false;
        update();
      }
    }

    buttons.save.addEventListener('click', () => save());
    buttons.saveAs.addEventListener('click', () => save(true));

    async function exportDocument(type) {
      if (!current || exporting || !render()) return;
      exporting = type;
      update();
      try {
        const article = content.querySelector('.mdp-markdown');
        if (type === 'word') {
          const result = await globalThis.MDPExport.word(article, current.name, current.options);
          notify(result.missingImages ? 'Word 已发起下载；无法读取的图片已保留替代说明。' : 'Word 已发起下载。');
        } else {
          const result = await globalThis.MDPExport.pdf({ article, name: current.name, options: current.options });
          notify(result.missingImages ? 'PDF 已发起下载；无法读取的图片已保留替代说明。' : 'PDF 已发起下载。');
        }
      } catch {
        notify('导出失败，请重试；编辑内容仍保留。');
      } finally {
        exporting = false;
        update();
      }
    }
    buttons.word.addEventListener('click', () => exportDocument('word'));
    buttons.pdf.addEventListener('click', () => exportDocument('pdf'));

    function canLeave() {
      if (authorizing || saving || exporting) {
        notify('正在授权、保存或导出，请稍候。');
        return false;
      }
      return !dirty() || window.confirm('有未保存的修改，确定放弃这些修改吗？');
    }

    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !event.isComposing && current) {
        event.preventDefault();
        event.stopPropagation();
        save(event.shiftKey);
      }
    };
    const onBeforeUnload = (event) => {
      if (!dirty() && !saving) return;
      event.preventDefault();
      event.returnValue = '';
    };
    app.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);

    function reset() {
      clearTimeout(renderTimer);
      current = null;
      editing = false;
      textarea.value = '';
      update();
    }
    reset();

    return {
      canLeave,
      reset,
      setDocument({ text: source, name, options = {}, handle = null, file = null, sourceUrl = '', nativeFile = null, encoding = 'UTF-8' }) {
        textarea.value = source;
        textarea.setSelectionRange(0, 0);
        textarea.scrollTop = 0;
        current = {
          name, options, handle, encoding, nativeFile,
          localFile: Boolean(file || sourceUrl.startsWith('file:')),
          writeAuthorized: false,
          version: handle && file ? { lastModified: file.lastModified, size: file.size } : null,
          savedText: textarea.value,
          eol: source.includes('\r\n') ? '\r\n' : '\n',
          bom: source.charCodeAt(0) === 0xfeff,
        };
        editing = false;
        update();
      },
      destroy() {
        clearTimeout(renderTimer);
        clearTimeout(noticeTimer);
        window.removeEventListener('beforeunload', onBeforeUnload);
        app.removeEventListener('keydown', onKeyDown);
      },
    };
  }

  function encode(text, { encoding, eol, bom }) {
    const normalized = text.replace(/\r\n?/g, '\n').replace(/\n/g, eol);
    if (/^UTF-16/.test(encoding)) {
      const bytes = new Uint8Array(2 + normalized.length * 2);
      const view = new DataView(bytes.buffer);
      const littleEndian = encoding !== 'UTF-16 BE';
      view.setUint16(0, 0xfeff, littleEndian);
      for (let index = 0; index < normalized.length; index++) {
        view.setUint16(2 + index * 2, normalized.charCodeAt(index), littleEndian);
      }
      return new Blob([bytes], { type: 'text/markdown' });
    }
    return new Blob([bom && !normalized.startsWith('\ufeff') ? '\ufeff' : '', normalized], { type: 'text/markdown;charset=utf-8' });
  }

  globalThis.MDPEditor = Object.freeze({ attach });
})();
