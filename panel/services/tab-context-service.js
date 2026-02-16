const MESSAGE_TYPES = Object.freeze({
  GET_TAB_CONTEXT_SNAPSHOT: 'GREENSTUDIO_GET_TAB_CONTEXT_SNAPSHOT',
  TAB_CONTEXT_UPDATED: 'GREENSTUDIO_TAB_CONTEXT_UPDATED',
  SITE_ACTION_IN_TAB: 'GREENSTUDIO_SITE_ACTION_IN_TAB',
  BROWSER_ACTION: 'GREENSTUDIO_BROWSER_ACTION'
});

const LOG_PREFIX = '[greenstudio-ext/tab-context-service]';

function logDebug(message, payload) {
  if (payload === undefined) {
    console.debug(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.debug(`${LOG_PREFIX} ${message}`, payload);
}

function logWarn(message, payload) {
  if (payload === undefined) {
    console.warn(`${LOG_PREFIX} ${message}`);
    return;
  }

  console.warn(`${LOG_PREFIX} ${message}`, payload);
}

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
  const runtimeContext = snapshot.runtimeContext && typeof snapshot.runtimeContext === 'object' ? snapshot.runtimeContext : {};
  const runtimeLocation = runtimeContext.location && typeof runtimeContext.location === 'object' ? runtimeContext.location : null;
  const history = Array.isArray(snapshot.history)
    ? snapshot.history
        .map((item) => {
          const entry = item && typeof item === 'object' ? item : {};
          return {
            url: String(entry.url || ''),
            title: String(entry.title || ''),
            lastVisitTime: toNumber(entry.lastVisitTime, 0),
            visitCount: toNumber(entry.visitCount, 0),
            typedCount: toNumber(entry.typedCount, 0)
          };
        })
        .filter((item) => item.url)
    : [];

  return {
    reason: String(snapshot.reason || 'snapshot'),
    activeTabId: toNumber(snapshot.activeTabId, -1),
    updatedAt: toNumber(snapshot.updatedAt, Date.now()),
    runtimeContext: {
      reason: String(runtimeContext.reason || ''),
      updatedAt: toNumber(runtimeContext.updatedAt, 0),
      permissions: runtimeContext.permissions && typeof runtimeContext.permissions === 'object' ? runtimeContext.permissions : {},
      maps: runtimeContext.maps && typeof runtimeContext.maps === 'object' ? runtimeContext.maps : {},
      location:
        runtimeLocation && Number.isFinite(Number(runtimeLocation.latitude)) && Number.isFinite(Number(runtimeLocation.longitude))
          ? {
              latitude: Number(runtimeLocation.latitude),
              longitude: Number(runtimeLocation.longitude),
              accuracy: Math.max(0, Number(runtimeLocation.accuracy) || 0),
              capturedAt: toNumber(runtimeLocation.capturedAt, 0)
            }
          : null,
      nearbyPlaces: Array.isArray(runtimeContext.nearbyPlaces) ? runtimeContext.nearbyPlaces : []
    },
    history,
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

  function runBrowserAction(action, args = {}) {
    return new Promise((resolve) => {
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        logWarn('runBrowserAction:runtime_unavailable', { action, args });
        resolve({ ok: false, error: 'chrome.runtime no disponible.' });
        return;
      }

      logDebug('runBrowserAction:send', { action, args });

      chrome.runtime.sendMessage(
        {
          type: MESSAGE_TYPES.BROWSER_ACTION,
          action,
          args
        },
        (response) => {
          if (chrome.runtime.lastError) {
            logWarn('runBrowserAction:runtime_error', {
              action,
              args,
              error: chrome.runtime.lastError.message || 'runtime_error'
            });
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'No se pudo ejecutar browser action.' });
            return;
          }

          logDebug('runBrowserAction:response', { action, args, response });
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
    runSiteActionInTab,
    runBrowserAction
  };
}
