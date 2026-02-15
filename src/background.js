(() => {
  'use strict';

  const MESSAGE_TYPES = Object.freeze({
    GET_TAB_CONTEXT: 'GREENSTUDIO_GET_TAB_CONTEXT',
    TAB_CONTEXT_PUSH: 'GREENSTUDIO_TAB_CONTEXT_PUSH',
    GET_TAB_CONTEXT_SNAPSHOT: 'GREENSTUDIO_GET_TAB_CONTEXT_SNAPSHOT',
    TAB_CONTEXT_UPDATED: 'GREENSTUDIO_TAB_CONTEXT_UPDATED',
    SITE_ACTION_IN_TAB: 'GREENSTUDIO_SITE_ACTION_IN_TAB',
    SITE_ACTION: 'GREENSTUDIO_SITE_ACTION'
  });

  const LOG_PREFIX = '[greenstudio-ext/background]';
  const tabContextState = new Map();
  let activeTabId = -1;

  function logDebug(message, payload) {
    if (payload === undefined) {
      console.debug(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.debug(`${LOG_PREFIX} ${message}`, payload);
  }

  async function enablePanelOnActionClick() {
    if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) {
      return;
    }

    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn(`${LOG_PREFIX} No se pudo activar side panel al hacer click.`, error);
    }
  }

  function toSafeText(value, limit = 1200) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return '';
    }

    return text.slice(0, limit);
  }

  function detectSiteByUrl(url) {
    const safeUrl = String(url || '').toLowerCase();

    if (safeUrl.includes('web.whatsapp.com')) {
      return 'whatsapp';
    }

    return 'generic';
  }

  function normalizeContext(tab, context = {}) {
    const safeTab = tab && typeof tab === 'object' ? tab : {};
    const safeContext = context && typeof context === 'object' ? context : {};

    const url = String(safeContext.url || safeTab.url || '');
    const title = toSafeText(safeContext.title || safeTab.title || '');
    const description = toSafeText(safeContext.description || '', 360);
    const textExcerpt = toSafeText(safeContext.textExcerpt || safeContext.text || '', 2000);
    const site =
      typeof safeContext.site === 'string' && safeContext.site.trim()
        ? safeContext.site.trim().toLowerCase()
        : detectSiteByUrl(url);

    const details = safeContext.details && typeof safeContext.details === 'object' ? safeContext.details : {};

    return {
      tabId: typeof safeTab.id === 'number' ? safeTab.id : typeof safeContext.tabId === 'number' ? safeContext.tabId : -1,
      url,
      title,
      description,
      textExcerpt,
      site,
      details,
      updatedAt: Date.now()
    };
  }

  function buildSnapshot(reason = 'update') {
    const tabs = Array.from(tabContextState.values())
      .filter((item) => item && typeof item.tabId === 'number' && item.tabId >= 0)
      .sort((a, b) => a.tabId - b.tabId);

    return {
      reason,
      activeTabId,
      tabs,
      updatedAt: Date.now()
    };
  }

  function broadcastSnapshot(reason = 'update') {
    const payload = {
      type: MESSAGE_TYPES.TAB_CONTEXT_UPDATED,
      snapshot: buildSnapshot(reason)
    };

    try {
      chrome.runtime.sendMessage(payload, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // Ignore when there are no listeners alive.
    }
  }

  async function getTabById(tabId) {
    if (typeof tabId !== 'number' || tabId < 0) {
      return null;
    }

    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resolve(null);
          return;
        }

        resolve(tab);
      });
    });
  }

  function upsertContextFromTab(tab, context, reason = 'update') {
    if (!tab || typeof tab.id !== 'number') {
      return;
    }

    const normalized = normalizeContext(tab, context);
    if (normalized.tabId < 0) {
      return;
    }

    tabContextState.set(normalized.tabId, normalized);

    if (activeTabId === -1 && tab.active) {
      activeTabId = normalized.tabId;
    }

    broadcastSnapshot(reason);
  }

  async function upsertFallbackContext(tabId, reason = 'fallback') {
    const tab = await getTabById(tabId);
    if (!tab || typeof tab.id !== 'number') {
      return;
    }

    upsertContextFromTab(
      tab,
      {
        tabId,
        url: tab.url || '',
        title: tab.title || '',
        description: '',
        textExcerpt: '',
        site: detectSiteByUrl(tab.url || ''),
        details: {}
      },
      reason
    );
  }

  async function requestContextFromTab(tabId, reason = 'refresh') {
    if (typeof tabId !== 'number' || tabId < 0) {
      return;
    }

    const tab = await getTabById(tabId);
    if (!tab) {
      tabContextState.delete(tabId);
      broadcastSnapshot('tab_removed');
      return;
    }

    chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.GET_TAB_CONTEXT, reason }, (response) => {
      if (chrome.runtime.lastError || !response || response.ok !== true || !response.context) {
        upsertFallbackContext(tabId, `${reason}_fallback`);
        return;
      }

      upsertContextFromTab(tab, response.context, reason);
    });
  }

  async function refreshAllTabs(reason = 'refresh_all') {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError || !Array.isArray(tabs)) {
        return;
      }

      for (const tab of tabs) {
        if (!tab || typeof tab.id !== 'number') {
          continue;
        }

        if (tab.active && tab.highlighted) {
          activeTabId = tab.id;
        }

        requestContextFromTab(tab.id, reason);
      }
    });
  }

  function syncActiveTabFromWindow() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        return;
      }

      activeTabId = tab.id;
      requestContextFromTab(tab.id, 'active_window_changed');
    });
  }

  chrome.runtime.onInstalled.addListener(() => {
    enablePanelOnActionClick();
    refreshAllTabs('installed');
  });

  chrome.runtime.onStartup.addListener(() => {
    enablePanelOnActionClick();
    refreshAllTabs('startup');
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    activeTabId = activeInfo && typeof activeInfo.tabId === 'number' ? activeInfo.tabId : -1;
    if (activeTabId >= 0) {
      requestContextFromTab(activeTabId, 'tab_activated');
      broadcastSnapshot('tab_activated');
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (typeof tabId !== 'number') {
      return;
    }

    const shouldRefresh =
      changeInfo.status === 'complete' ||
      typeof changeInfo.title === 'string' ||
      typeof changeInfo.url === 'string';

    if (!shouldRefresh) {
      return;
    }

    if (tab && tab.active) {
      activeTabId = tabId;
    }

    requestContextFromTab(tabId, 'tab_updated');
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabContextState.delete(tabId);
    if (activeTabId === tabId) {
      activeTabId = -1;
      syncActiveTabFromWindow();
    }

    broadcastSnapshot('tab_removed');
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (!tab || typeof tab.id !== 'number') {
      return;
    }

    requestContextFromTab(tab.id, 'tab_created');
  });

  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        return;
      }

      syncActiveTabFromWindow();
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (message.type === MESSAGE_TYPES.TAB_CONTEXT_PUSH) {
      const senderTab = sender && sender.tab;
      if (!senderTab || typeof senderTab.id !== 'number') {
        return false;
      }

      if (senderTab.active) {
        activeTabId = senderTab.id;
      }

      upsertContextFromTab(senderTab, message.context || {}, message.reason || 'context_push');
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_TAB_CONTEXT_SNAPSHOT) {
      chrome.tabs.query({}, (tabs) => {
        const known = new Set();

        for (const tab of tabs || []) {
          if (!tab || typeof tab.id !== 'number') {
            continue;
          }

          known.add(tab.id);

          if (!tabContextState.has(tab.id)) {
            upsertContextFromTab(
              tab,
              {
                tabId: tab.id,
                url: tab.url || '',
                title: tab.title || '',
                description: '',
                textExcerpt: '',
                site: detectSiteByUrl(tab.url || ''),
                details: {}
              },
              'snapshot_seed'
            );
          }

          requestContextFromTab(tab.id, 'snapshot_refresh');

          if (tab.active && tab.highlighted) {
            activeTabId = tab.id;
          }
        }

        for (const tabId of tabContextState.keys()) {
          if (!known.has(tabId)) {
            tabContextState.delete(tabId);
          }
        }

        sendResponse({ ok: true, snapshot: buildSnapshot('snapshot_request') });
      });

      return true;
    }

    if (message.type === MESSAGE_TYPES.SITE_ACTION_IN_TAB) {
      const tabId = Number(message.tabId);
      const action = typeof message.action === 'string' ? message.action : '';
      const site = typeof message.site === 'string' ? message.site : '';
      const args = message.args && typeof message.args === 'object' ? message.args : {};

      if (!Number.isFinite(tabId) || tabId < 0 || !action) {
        sendResponse({ ok: false, error: 'tabId/action invalidos.' });
        return false;
      }

      chrome.tabs.sendMessage(
        tabId,
        {
          type: MESSAGE_TYPES.SITE_ACTION,
          action,
          site,
          args
        },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message || 'No se pudo ejecutar accion.' });
            return;
          }

          sendResponse(response || { ok: false, error: 'Sin respuesta del content script.' });
        }
      );

      return true;
    }

    return false;
  });

  enablePanelOnActionClick();
  refreshAllTabs('boot');
  logDebug('Servicio de tabs/contexto inicializado.');
})();
