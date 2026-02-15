const MESSAGE_TYPES = Object.freeze({
  GET_TAB_CONTEXT_SNAPSHOT: 'GREENSTUDIO_GET_TAB_CONTEXT_SNAPSHOT',
  TAB_CONTEXT_UPDATED: 'GREENSTUDIO_TAB_CONTEXT_UPDATED',
  SITE_ACTION_IN_TAB: 'GREENSTUDIO_SITE_ACTION_IN_TAB'
});

function toNumber(value, fallback = -1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTabRecord(item) {
  const tab = item && typeof item === 'object' ? item : {};

  return {
    tabId: toNumber(tab.tabId, -1),
    site: String(tab.site || 'generic'),
    url: String(tab.url || ''),
    title: String(tab.title || ''),
    description: String(tab.description || ''),
    textExcerpt: String(tab.textExcerpt || ''),
    details: tab.details && typeof tab.details === 'object' ? tab.details : {},
    updatedAt: toNumber(tab.updatedAt, Date.now())
  };
}

function normalizeSnapshot(rawSnapshot) {
  const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
  const tabs = Array.isArray(snapshot.tabs) ? snapshot.tabs.map(normalizeTabRecord).filter((item) => item.tabId >= 0) : [];

  return {
    reason: String(snapshot.reason || 'snapshot'),
    activeTabId: toNumber(snapshot.activeTabId, -1),
    updatedAt: toNumber(snapshot.updatedAt, Date.now()),
    tabs
  };
}

export function createTabContextService({ onSnapshot }) {
  let started = false;
  let runtimeListener = null;

  function emitSnapshot(snapshot) {
    if (typeof onSnapshot === 'function') {
      onSnapshot(snapshot);
    }
  }

  function requestSnapshot() {
    return new Promise((resolve) => {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        const empty = normalizeSnapshot({});
        emitSnapshot(empty);
        resolve(empty);
        return;
      }

      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_TAB_CONTEXT_SNAPSHOT }, (response) => {
        if (chrome.runtime.lastError || !response || response.ok !== true) {
          const empty = normalizeSnapshot({ reason: 'snapshot_error' });
          emitSnapshot(empty);
          resolve(empty);
          return;
        }

        const snapshot = normalizeSnapshot(response.snapshot);
        emitSnapshot(snapshot);
        resolve(snapshot);
      });
    });
  }

  function runSiteActionInTab(tabId, site, action, args = {}) {
    return new Promise((resolve) => {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: 'chrome.runtime no disponible.' });
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: MESSAGE_TYPES.SITE_ACTION_IN_TAB,
          tabId,
          site,
          action,
          args
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'No se pudo ejecutar accion.' });
            return;
          }

          resolve(response || { ok: false, error: 'Sin respuesta del background.' });
        }
      );
    });
  }

  function start() {
    if (started) {
      return requestSnapshot();
    }

    started = true;
    runtimeListener = (message) => {
      if (!message || message.type !== MESSAGE_TYPES.TAB_CONTEXT_UPDATED) {
        return;
      }

      emitSnapshot(normalizeSnapshot(message.snapshot));
    };

    chrome.runtime.onMessage.addListener(runtimeListener);

    return requestSnapshot();
  }

  function stop() {
    if (!started) {
      return;
    }

    started = false;

    if (runtimeListener) {
      chrome.runtime.onMessage.removeListener(runtimeListener);
      runtimeListener = null;
    }
  }

  return {
    start,
    stop,
    requestSnapshot,
    runSiteActionInTab
  };
}
