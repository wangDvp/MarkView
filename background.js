/* Service worker: routes the Ctrl+M command to the active tab or the standalone picker. */
'use strict';

importScripts('native-bridge.js');

const PREVIEW_PAGE = 'preview.html';
const SESSION_KEY = 'previewTabId';
const TOGGLE_COMMAND = 'toggle-preview';

chrome.action.onClicked.addListener(() => {
  openPreviewTab().catch(logError);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== TOGGLE_COMMAND) return;
  togglePreview().catch(logError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => {
      try {
        sendResponse(response);
      } catch {
        /* the sender tab may already be closed */
      }
    })
    .catch((error) => {
      try {
        sendResponse({ ok: false, error: String((error && error.message) || error) });
      } catch {
        /* the sender tab may already be closed */
      }
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetPreviewTab(tabId).catch(logError);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove(SESSION_KEY).catch(() => {});
});

async function handleMessage(message, sender) {
  const type = message && message.type;

  if (type === 'MD_NATIVE_PREPARE' || type === 'MD_NATIVE_SAVE') {
    return globalThis.MDPNativeBridge.handle(message, sender);
  }

  if (type === 'MD_PREVIEW_TAB_READY') {
    if (sender.tab && sender.tab.id != null) {
      await chrome.storage.session.set({ [SESSION_KEY]: sender.tab.id });
    }
    return { ok: true };
  }

  if (type === 'MD_OPEN_PREVIEW') {
    await openPreviewTab();
    return { ok: true };
  }

  if (type === 'MD_CLOSE_SELF') {
    if (!sender.tab || sender.tab.id == null) return { ok: false };
    const tabId = sender.tab.id;
    await forgetPreviewTab(tabId);
    await chrome.tabs.remove(tabId);
    return { ok: true };
  }

  if (type === 'MD_OPEN_SHORTCUTS') {
    try {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  return { ok: false, error: 'unknown-message' };
}

async function togglePreview() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return;

  const previewTabId = await getPreviewTabId();
  if (previewTabId === tab.id) {
    // Let the page protect unsaved edits, including closes triggered by Ctrl+M.
    try {
      const response = await chrome.runtime.sendMessage({ type: 'MD_REQUEST_CLOSE_PREVIEW', tabId: tab.id });
      if (response?.handled) return;
    } catch { /* A broken preview page can still be closed. */ }
    await forgetPreviewTab(tab.id);
    await chrome.tabs.remove(tab.id);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'MD_TOGGLE' }, { frameId: 0 });
    if (response && response.handled) return;
  } catch {
    /* No content script in this tab (chrome://, download page, non-Markdown page...). */
  }

  await openPreviewTab();
}

async function openPreviewTab() {
  const existing = await getPreviewTabId();
  if (existing != null) {
    try {
      const tab = await chrome.tabs.update(existing, { active: true });
      if (tab && tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return;
    } catch {
      await chrome.storage.session.remove(SESSION_KEY).catch(() => {});
    }
  }

  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(PREVIEW_PAGE) });
  if (tab && tab.id != null) {
    await chrome.storage.session.set({ [SESSION_KEY]: tab.id });
  }
}

async function getPreviewTabId() {
  let stored;
  try {
    stored = await chrome.storage.session.get(SESSION_KEY);
  } catch {
    return null;
  }
  const tabId = stored && stored[SESSION_KEY];
  if (typeof tabId !== 'number') return null;

  try {
    await chrome.tabs.get(tabId);
    return tabId;
  } catch {
    await chrome.storage.session.remove(SESSION_KEY).catch(() => {});
    return null;
  }
}

async function forgetPreviewTab(tabId) {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    if (stored && stored[SESSION_KEY] === tabId) {
      await chrome.storage.session.remove(SESSION_KEY);
    }
  } catch {
    /* session storage is best-effort */
  }
}

function logError(error) {
  console.warn('[Markdown Preview]', error);
}
