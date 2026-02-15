(() => {
  'use strict';

  const MESSAGE_TYPES = Object.freeze({
    GET_TAB_CONTEXT: 'GREENSTUDIO_GET_TAB_CONTEXT',
    TAB_CONTEXT_PUSH: 'GREENSTUDIO_TAB_CONTEXT_PUSH',
    GET_TAB_CONTEXT_SNAPSHOT: 'GREENSTUDIO_GET_TAB_CONTEXT_SNAPSHOT',
    TAB_CONTEXT_UPDATED: 'GREENSTUDIO_TAB_CONTEXT_UPDATED',
    SITE_ACTION_IN_TAB: 'GREENSTUDIO_SITE_ACTION_IN_TAB',
    SITE_ACTION: 'GREENSTUDIO_SITE_ACTION',
    BROWSER_ACTION: 'GREENSTUDIO_BROWSER_ACTION'
  });

  const LOG_PREFIX = '[greenstudio-ext/background]';
  const tabContextState = new Map();
  const tabTemporalState = new Map();
  const recentHistoryByUrl = new Map();
  const HISTORY_CACHE_LIMIT = 240;
  const INITIAL_CONTEXT_SYNC_STORAGE_KEY = 'greenstudio_initial_context_sync_v1';
  const INITIAL_CONTEXT_SYNC_VERSION = 1;
  const EXTENDED_HISTORY_MIN_RESULTS = 20;
  const EXTENDED_HISTORY_MAX_RESULTS = 600;
  const EXTENDED_HISTORY_MIN_DAYS = 1;
  const EXTENDED_HISTORY_MAX_DAYS = 365;
  const HISTORY_RANGE_DEFAULT_LIMIT = 220;
  const HISTORY_RANGE_MAX_LIMIT = 1200;
  const OLDEST_HISTORY_DEFAULT_CHUNK = 320;
  const OLDEST_HISTORY_MAX_CHUNK = 800;
  const OLDEST_HISTORY_DEFAULT_CHUNKS = 10;
  const OLDEST_HISTORY_MAX_CHUNKS = 30;
  const whatsappContextLogByTab = new Map();
  let activeTabId = -1;

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

  function logWhatsappContextSnapshot(context, reason = 'update') {
    const safeContext = context && typeof context === 'object' ? context : {};
    const site = String(safeContext.site || '').toLowerCase();
    if (site !== 'whatsapp') {
      return;
    }

    const tabId = Number(safeContext.tabId);
    if (!Number.isFinite(tabId) || tabId < 0) {
      return;
    }

    const details = safeContext.details && typeof safeContext.details === 'object' ? safeContext.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const messages = Array.isArray(details.messages) ? details.messages : [];
    const chatKey = toSafeText(currentChat.key || currentChat.phone || currentChat.title || '', 180);
    if (!chatKey) {
      return;
    }

    const previous = whatsappContextLogByTab.get(tabId);
    const now = Date.now();

    if (previous && previous.chatKey === chatKey) {
      return;
    }

    whatsappContextLogByTab.set(tabId, {
      chatKey,
      at: now
    });

    logDebug('whatsapp_context:upsert', {
      reason,
      tabId,
      url: toSafeText(safeContext.url || '', 220),
      chat: {
        title: toSafeText(currentChat.title || '', 120),
        phone: toSafeText(currentChat.phone || '', 42),
        key: chatKey
      },
      messageCount: messages.length,
      messageTail: messages.slice(-4).map((item) => ({
        role: item?.role === 'me' ? 'me' : 'contact',
        timestamp: toSafeText(item?.timestamp || '', 80),
        text: toSafeText(item?.text || '', 160)
      }))
    });
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toSafeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (!/^https?:\/\//i.test(raw)) {
      return '';
    }

    return raw.slice(0, 1200);
  }

  function ensureTabTemporal(tabId) {
    if (typeof tabId !== 'number' || tabId < 0) {
      return null;
    }

    const now = Date.now();
    const known = tabTemporalState.get(tabId);

    if (known) {
      return known;
    }

    const created = {
      tabId,
      url: '',
      visitStartedAt: now,
      lastSeenAt: now,
      activeSince: null,
      accumulatedActiveMs: 0
    };

    tabTemporalState.set(tabId, created);
    return created;
  }

  function getTabTemporalPayload(tabId, url, capturedAt = Date.now()) {
    const state = ensureTabTemporal(tabId);
    if (!state) {
      return {
        visitStartedAt: capturedAt,
        lastSeenAt: capturedAt,
        activeDurationMs: 0,
        dwellTimeMs: 0
      };
    }

    if (url && state.url !== url) {
      state.url = url;
      state.visitStartedAt = capturedAt;
      state.accumulatedActiveMs = 0;
      state.activeSince = tabId === activeTabId ? capturedAt : null;
    }

    state.lastSeenAt = capturedAt;

    const activeDelta = state.activeSince ? Math.max(0, capturedAt - state.activeSince) : 0;
    const activeDurationMs = state.accumulatedActiveMs + activeDelta;
    const dwellTimeMs = Math.max(0, capturedAt - state.visitStartedAt);

    return {
      visitStartedAt: state.visitStartedAt,
      lastSeenAt: state.lastSeenAt,
      activeDurationMs,
      dwellTimeMs
    };
  }

  function pauseTabActiveSession(tabId, now = Date.now()) {
    const state = ensureTabTemporal(tabId);
    if (!state || !state.activeSince) {
      return;
    }

    state.accumulatedActiveMs += Math.max(0, now - state.activeSince);
    state.activeSince = null;
    state.lastSeenAt = now;
  }

  function resumeTabActiveSession(tabId, now = Date.now()) {
    const state = ensureTabTemporal(tabId);
    if (!state) {
      return;
    }

    if (!state.activeSince) {
      state.activeSince = now;
    }

    state.lastSeenAt = now;
  }

  function setActiveTab(tabId) {
    const nextTabId = typeof tabId === 'number' && tabId >= 0 ? tabId : -1;
    const now = Date.now();

    if (activeTabId !== nextTabId && activeTabId >= 0) {
      pauseTabActiveSession(activeTabId, now);
    }

    activeTabId = nextTabId;

    if (activeTabId >= 0) {
      resumeTabActiveSession(activeTabId, now);
    }
  }

  function computeImportanceScore(temporal) {
    const activeMs = Number(temporal?.activeDurationMs) || 0;
    const dwellMs = Number(temporal?.dwellTimeMs) || 0;
    const activeScore = clamp(activeMs / 180000, 0, 1);
    const dwellScore = clamp(dwellMs / 300000, 0, 1);
    return Number((activeScore * 0.7 + dwellScore * 0.3).toFixed(3));
  }

  function trimHistoryCache() {
    if (recentHistoryByUrl.size <= HISTORY_CACHE_LIMIT) {
      return;
    }

    const sorted = Array.from(recentHistoryByUrl.values()).sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
    recentHistoryByUrl.clear();

    for (const item of sorted.slice(0, HISTORY_CACHE_LIMIT)) {
      recentHistoryByUrl.set(item.url, item);
    }
  }

  function upsertHistoryRecord(entry) {
    const url = toSafeUrl(entry?.url);
    if (!url) {
      return;
    }

    const lastVisitTime = Number(entry?.lastVisitTime) || Date.now();
    const visitCount = Number(entry?.visitCount) || 1;
    const typedCount = Number(entry?.typedCount) || 0;
    const title = toSafeText(entry?.title || '', 240);

    const previous = recentHistoryByUrl.get(url);
    const next = {
      url,
      title: title || previous?.title || '',
      lastVisitTime: Math.max(lastVisitTime, previous?.lastVisitTime || 0),
      visitCount: Math.max(visitCount, previous?.visitCount || 0),
      typedCount: Math.max(typedCount, previous?.typedCount || 0)
    };

    recentHistoryByUrl.set(url, next);
    trimHistoryCache();
  }

  function getHistoryPayload(url) {
    const safeUrl = toSafeUrl(url);
    if (!safeUrl) {
      return null;
    }

    const item = recentHistoryByUrl.get(safeUrl);
    if (!item) {
      return null;
    }

    return {
      url: item.url,
      title: item.title,
      lastVisitTime: item.lastVisitTime,
      visitCount: item.visitCount,
      typedCount: item.typedCount
    };
  }

  function buildRecentHistory(limit = 40) {
    return Array.from(recentHistoryByUrl.values())
      .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
      .slice(0, limit)
      .map((item) => ({
        url: item.url,
        title: item.title,
        lastVisitTime: item.lastVisitTime,
        visitCount: item.visitCount,
        typedCount: item.typedCount
      }));
  }

  function normalizeHistoryRecord(entry) {
    const url = toSafeUrl(entry?.url);
    if (!url) {
      return null;
    }

    return {
      url,
      title: toSafeText(entry?.title || '', 240),
      lastVisitTime: Math.max(0, Number(entry?.lastVisitTime) || 0),
      visitCount: Math.max(0, Number(entry?.visitCount) || 0),
      typedCount: Math.max(0, Number(entry?.typedCount) || 0)
    };
  }

  function parseTimestamp(value) {
    if (Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }

    const raw = String(value || '').trim();
    if (!raw) {
      return 0;
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }

    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }

    return 0;
  }

  function startOfLocalDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function endOfLocalDay(timestamp) {
    const date = new Date(timestamp);
    date.setHours(23, 59, 59, 999);
    return date.getTime();
  }

  function startOfLocalWeekMonday(timestamp) {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay();
    const diff = (day + 6) % 7;
    date.setDate(date.getDate() - diff);
    return date.getTime();
  }

  function buildPresetHistoryRange(preset, now = Date.now()) {
    const key = String(preset || '').trim().toLowerCase();
    if (!key) {
      return null;
    }

    if (key === 'today') {
      return {
        startTime: startOfLocalDay(now),
        endTime: now
      };
    }

    if (key === 'yesterday') {
      const dayStart = startOfLocalDay(now);
      const previousDay = dayStart - 24 * 60 * 60 * 1000;
      return {
        startTime: startOfLocalDay(previousDay),
        endTime: endOfLocalDay(previousDay)
      };
    }

    if (key === 'this_week') {
      return {
        startTime: startOfLocalWeekMonday(now),
        endTime: now
      };
    }

    if (key === 'last_week') {
      const thisWeekStart = startOfLocalWeekMonday(now);
      const previousWeekEnd = thisWeekStart - 1;
      const previousWeekStart = startOfLocalWeekMonday(previousWeekEnd);
      return {
        startTime: previousWeekStart,
        endTime: previousWeekEnd
      };
    }

    if (key === 'last_friday_afternoon') {
      const anchor = new Date(now);
      anchor.setHours(0, 0, 0, 0);
      const day = anchor.getDay();
      let daysSinceFriday = (day + 2) % 7;
      if (daysSinceFriday === 0) {
        daysSinceFriday = 7;
      }

      anchor.setDate(anchor.getDate() - daysSinceFriday);
      const start = new Date(anchor);
      start.setHours(12, 0, 0, 0);
      const end = new Date(anchor);
      end.setHours(18, 59, 59, 999);
      return {
        startTime: start.getTime(),
        endTime: end.getTime()
      };
    }

    return null;
  }

  function toIsoTimestamp(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return '';
    }

    try {
      return new Date(value).toISOString();
    } catch (_) {
      return '';
    }
  }

  function getHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function summarizeHistoryRecords(records) {
    const list = Array.isArray(records) ? records : [];
    if (!list.length) {
      return {
        count: 0,
        firstVisitAt: 0,
        lastVisitAt: 0,
        firstVisitIso: '',
        lastVisitIso: '',
        topDomains: []
      };
    }

    let firstVisitAt = Number.MAX_SAFE_INTEGER;
    let lastVisitAt = 0;
    const domainCounts = new Map();

    for (const item of list) {
      const ts = Number(item?.lastVisitTime) || 0;
      if (ts > 0 && ts < firstVisitAt) {
        firstVisitAt = ts;
      }
      if (ts > lastVisitAt) {
        lastVisitAt = ts;
      }

      const domain = getHostname(item?.url || '');
      if (!domain) {
        continue;
      }

      const known = domainCounts.get(domain) || 0;
      domainCounts.set(domain, known + 1);
    }

    const topDomains = Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([domain, count]) => ({
        domain,
        count
      }));

    if (firstVisitAt === Number.MAX_SAFE_INTEGER) {
      firstVisitAt = 0;
    }

    return {
      count: list.length,
      firstVisitAt,
      lastVisitAt,
      firstVisitIso: toIsoTimestamp(firstVisitAt),
      lastVisitIso: toIsoTimestamp(lastVisitAt),
      topDomains
    };
  }

  function buildHistoryRangeArgs(rawArgs = {}) {
    const safeArgs = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const now = Date.now();
    const limit = Math.round(clamp(Number(safeArgs.limit) || HISTORY_RANGE_DEFAULT_LIMIT, 1, HISTORY_RANGE_MAX_LIMIT));
    const text = toSafeText(safeArgs.text || '', 120);
    const sort = String(safeArgs.sort || '').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const days = Math.round(clamp(Number(safeArgs.days) || 0, 0, EXTENDED_HISTORY_MAX_DAYS));
    const preset = toSafeText(safeArgs.preset || '', 60).toLowerCase();
    const startCandidate =
      parseTimestamp(safeArgs.startTime || safeArgs.start || safeArgs.from || safeArgs.startISO || safeArgs.startDate) || 0;
    const endCandidate =
      parseTimestamp(safeArgs.endTime || safeArgs.end || safeArgs.to || safeArgs.endISO || safeArgs.endDate) || 0;

    let startTime = startCandidate;
    let endTime = endCandidate;

    if (!startTime && !endTime && preset) {
      const presetRange = buildPresetHistoryRange(preset, now);
      if (presetRange) {
        startTime = presetRange.startTime;
        endTime = presetRange.endTime;
      }
    }

    if (!startTime && !endTime && days > 0) {
      endTime = now;
      startTime = now - days * 24 * 60 * 60 * 1000;
    }

    if (!startTime) {
      startTime = now - 24 * 60 * 60 * 1000;
    }
    if (!endTime) {
      endTime = now;
    }

    if (endTime < startTime) {
      const temp = startTime;
      startTime = endTime;
      endTime = temp;
    }

    return {
      text,
      sort,
      limit,
      days,
      preset,
      startTime,
      endTime
    };
  }

  function queryHistory(query = {}) {
    return new Promise((resolve) => {
      if (!chrome.history || typeof chrome.history.search !== 'function') {
        resolve([]);
        return;
      }

      chrome.history.search(query, (items) => {
        if (chrome.runtime.lastError || !Array.isArray(items)) {
          resolve([]);
          return;
        }

        resolve(items);
      });
    });
  }

  function writeChromeLocal(patch) {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.local) {
        resolve(false);
        return;
      }

      chrome.storage.local.set(patch, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  function queryTabs(queryInfo = {}) {
    return new Promise((resolve) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError || !Array.isArray(tabs)) {
          resolve([]);
          return;
        }

        resolve(tabs);
      });
    });
  }

  function createTab(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          reject(new Error(chrome.runtime.lastError?.message || 'No se pudo abrir la pestana.'));
          return;
        }

        resolve(tab);
      });
    });
  }

  function removeTabs(tabIds) {
    const ids = (Array.isArray(tabIds) ? tabIds : [tabIds]).map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.remove(ids, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'No se pudo cerrar la pestana.'));
          return;
        }
        resolve(true);
      });
    });
  }

  function updateTab(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, updateProperties, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          reject(new Error(chrome.runtime.lastError?.message || 'No se pudo actualizar la pestana.'));
          return;
        }

        resolve(tab);
      });
    });
  }

  function normalizeTabForTool(tab) {
    return {
      id: Number(tab?.id) || -1,
      index: Number(tab?.index) || 0,
      windowId: Number(tab?.windowId) || -1,
      active: Boolean(tab?.active),
      pinned: Boolean(tab?.pinned),
      title: toSafeText(tab?.title || '', 220),
      url: toSafeUrl(tab?.url || ''),
      site: detectSiteByUrl(tab?.url || ''),
      lastAccessed: Number(tab?.lastAccessed) || 0
    };
  }

  function summarizeTabsForLogs(tabs, limit = 20) {
    return (Array.isArray(tabs) ? tabs : []).slice(0, limit).map((tab) => ({
      id: Number(tab?.id) || -1,
      active: Boolean(tab?.active),
      pinned: Boolean(tab?.pinned),
      title: toSafeText(tab?.title || '', 120),
      url: toSafeText(tab?.url || '', 160)
    }));
  }

  function isProductivityTab(tab) {
    if (!tab) {
      return false;
    }

    if (tab.pinned) {
      return true;
    }

    const url = String(tab.url || '').toLowerCase();
    const title = String(tab.title || '').toLowerCase();
    const productivityHostHints = [
      'notion.so',
      'calendar.google.com',
      'docs.google.com',
      'sheets.google.com',
      'slides.google.com',
      'drive.google.com',
      'github.com',
      'gitlab.com',
      'linear.app',
      'jira',
      'retool.com',
      'figma.com',
      'slack.com',
      'clickup.com',
      'asana.com',
      'trello.com'
    ];
    const productivityTitleHints = [
      'dashboard',
      'admin',
      'project',
      'workspace',
      'kanban',
      'sprint',
      'issue',
      'task',
      'documentacion',
      'docs'
    ];

    if (productivityHostHints.some((hint) => url.includes(hint))) {
      return true;
    }

    if (productivityTitleHints.some((hint) => title.includes(hint))) {
      return true;
    }

    return false;
  }

  async function runBrowserAction(action, args = {}) {
    const safeAction = String(action || '').trim();
    const safeArgs = args && typeof args === 'object' ? args : {};
    const requestId = `browser-action-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

    logDebug(`runBrowserAction:start:${safeAction}`, {
      requestId,
      action: safeAction,
      args: safeArgs
    });

    if (safeAction === 'listTabs') {
      const tabs = await queryTabs({});
      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        tabCount: tabs.length
      });
      return {
        ok: true,
        result: tabs.map(normalizeTabForTool)
      };
    }

    if (safeAction === 'getRecentHistory') {
      const limit = Math.round(
        clamp(Number(safeArgs.limit) || 260, EXTENDED_HISTORY_MIN_RESULTS, EXTENDED_HISTORY_MAX_RESULTS)
      );
      const days = Math.round(clamp(Number(safeArgs.days) || 45, EXTENDED_HISTORY_MIN_DAYS, EXTENDED_HISTORY_MAX_DAYS));
      const text = toSafeText(safeArgs.text || '', 120);
      const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const historyItems = await queryHistory({
        text,
        maxResults: limit,
        startTime
      });
      const records = [];

      for (const entry of historyItems) {
        const normalized = normalizeHistoryRecord(entry);
        if (!normalized) {
          continue;
        }

        records.push(normalized);
        upsertHistoryRecord(normalized);
      }

      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        count: records.length,
        days,
        limit
      });

      return {
        ok: true,
        result: {
          items: records,
          days,
          limit,
          text
        }
      };
    }

    if (safeAction === 'queryHistoryRange') {
      const range = buildHistoryRangeArgs(safeArgs);
      const historyItems = await queryHistory({
        text: range.text,
        maxResults: range.limit,
        startTime: range.startTime,
        endTime: range.endTime
      });
      const records = [];

      for (const entry of historyItems) {
        const normalized = normalizeHistoryRecord(entry);
        if (!normalized) {
          continue;
        }

        records.push(normalized);
        upsertHistoryRecord(normalized);
      }

      records.sort((a, b) =>
        range.sort === 'asc' ? (a.lastVisitTime || 0) - (b.lastVisitTime || 0) : (b.lastVisitTime || 0) - (a.lastVisitTime || 0)
      );

      const summary = summarizeHistoryRecords(records);

      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        count: records.length,
        range
      });

      return {
        ok: true,
        result: {
          items: records,
          range: {
            ...range,
            startIso: toIsoTimestamp(range.startTime),
            endIso: toIsoTimestamp(range.endTime)
          },
          summary
        }
      };
    }

    if (safeAction === 'getOldestHistoryVisit') {
      const text = toSafeText(safeArgs.text || '', 120);
      const chunkSize = Math.round(clamp(Number(safeArgs.chunkSize) || OLDEST_HISTORY_DEFAULT_CHUNK, 40, OLDEST_HISTORY_MAX_CHUNK));
      const maxChunks = Math.round(clamp(Number(safeArgs.maxChunks) || OLDEST_HISTORY_DEFAULT_CHUNKS, 1, OLDEST_HISTORY_MAX_CHUNKS));
      const rangeStart = Math.max(0, parseTimestamp(safeArgs.startTime || safeArgs.start || safeArgs.startISO || 0));
      let endTime = Math.max(0, parseTimestamp(safeArgs.endTime || safeArgs.end || safeArgs.endISO || Date.now()));
      if (!endTime) {
        endTime = Date.now();
      }

      let oldest = null;
      let scannedItems = 0;
      let chunksUsed = 0;

      for (let chunkIndex = 0; chunkIndex < maxChunks; chunkIndex += 1) {
        const items = await queryHistory({
          text,
          maxResults: chunkSize,
          startTime: rangeStart,
          endTime
        });

        if (!Array.isArray(items) || !items.length) {
          break;
        }

        chunksUsed += 1;
        const normalizedChunk = [];

        for (const entry of items) {
          const normalized = normalizeHistoryRecord(entry);
          if (!normalized) {
            continue;
          }

          normalizedChunk.push(normalized);
          upsertHistoryRecord(normalized);

          if (!oldest || normalized.lastVisitTime < oldest.lastVisitTime) {
            oldest = normalized;
          }
        }

        scannedItems += normalizedChunk.length;
        if (!normalizedChunk.length) {
          break;
        }

        const minTimestamp = normalizedChunk.reduce((lowest, item) => {
          const ts = Number(item.lastVisitTime) || 0;
          if (!lowest || (ts > 0 && ts < lowest)) {
            return ts;
          }
          return lowest;
        }, 0);

        if (!minTimestamp || minTimestamp <= rangeStart || normalizedChunk.length < chunkSize) {
          break;
        }

        endTime = minTimestamp - 1;
      }

      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        found: Boolean(oldest),
        scannedItems,
        chunksUsed
      });

      return {
        ok: true,
        result: {
          oldest,
          scannedItems,
          chunksUsed,
          approximate: chunksUsed >= maxChunks,
          rangeStart,
          rangeStartIso: toIsoTimestamp(rangeStart),
          endTime,
          endIso: toIsoTimestamp(endTime)
        }
      };
    }

    if (safeAction === 'openNewTab') {
      const targetUrl = toSafeUrl(safeArgs.url);
      const createOptions = {
        active: safeArgs.active !== false
      };

      if (targetUrl) {
        createOptions.url = targetUrl;
      }

      const tab = await createTab(createOptions);
      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        openedTab: normalizeTabForTool(tab)
      });
      return {
        ok: true,
        result: normalizeTabForTool(tab)
      };
    }

    if (safeAction === 'focusTab') {
      const tabId = Number(safeArgs.tabId);
      let selected = null;

      if (Number.isFinite(tabId) && tabId >= 0) {
        selected = await getTabById(tabId);
      }

      if (!selected) {
        const tabs = await queryTabs({});
        const urlContains = String(safeArgs.urlContains || '').toLowerCase();
        const titleContains = String(safeArgs.titleContains || '').toLowerCase();

        selected =
          tabs.find((tab) => {
            const title = String(tab.title || '').toLowerCase();
            const url = String(tab.url || '').toLowerCase();
            const byUrl = urlContains ? url.includes(urlContains) : true;
            const byTitle = titleContains ? title.includes(titleContains) : true;
            return byUrl && byTitle;
          }) || null;
      }

      if (!selected || typeof selected.id !== 'number') {
        logWarn(`runBrowserAction:fail:${safeAction}`, {
          requestId,
          reason: 'No tab matched for focus.',
          args: safeArgs,
          tabs: summarizeTabsForLogs(await queryTabs({}), 30)
        });
        return { ok: false, error: 'No se encontro pestana para enfocar.' };
      }

      const updated = await updateTab(selected.id, { active: true });
      setActiveTab(updated.id);
      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        focusedTab: normalizeTabForTool(updated)
      });
      return {
        ok: true,
        result: normalizeTabForTool(updated)
      };
    }

    if (safeAction === 'closeTab') {
      const tabId = Number(safeArgs.tabId);
      const tabs = await queryTabs({});
      let targetTab = null;

      if (Number.isFinite(tabId) && tabId >= 0) {
        targetTab = tabs.find((tab) => tab.id === tabId) || null;
      }

      if (!targetTab) {
        const urlContains = String(safeArgs.urlContains || '').toLowerCase();
        const titleContains = String(safeArgs.titleContains || '').toLowerCase();
        const exactUrl = toSafeUrl(safeArgs.url);
        const closeQuery = String(safeArgs.query || '').toLowerCase().trim();

        targetTab =
          tabs.find((tab) => {
            const title = String(tab.title || '').toLowerCase();
            const url = String(tab.url || '').toLowerCase();
            const byExactUrl = exactUrl ? url === exactUrl.toLowerCase() : true;
            const byUrl = urlContains ? url.includes(urlContains) : true;
            const byTitle = titleContains ? title.includes(titleContains) : true;
            const byQuery = closeQuery ? title.includes(closeQuery) || url.includes(closeQuery) : true;
            return byExactUrl && byUrl && byTitle && byQuery;
          }) || null;

        logDebug('runBrowserAction:closeTab:search', {
          requestId,
          criteria: {
            tabId: Number.isFinite(tabId) ? tabId : null,
            exactUrl: exactUrl || '',
            urlContains,
            titleContains,
            query: closeQuery
          },
          tabCount: tabs.length,
          tabs: summarizeTabsForLogs(tabs, 30)
        });
      }

      if (!targetTab || typeof targetTab.id !== 'number') {
        logWarn(`runBrowserAction:fail:${safeAction}`, {
          requestId,
          reason: 'No tab matched for close.',
          args: safeArgs,
          tabs: summarizeTabsForLogs(tabs, 30)
        });
        return { ok: false, error: 'No se encontro pestana para cerrar.' };
      }

      if (safeArgs.preventActive === true && targetTab.active) {
        logWarn(`runBrowserAction:fail:${safeAction}`, {
          requestId,
          reason: 'Target tab active and preventActive=true.',
          targetTab: normalizeTabForTool(targetTab)
        });
        return { ok: false, error: 'La pestana objetivo esta activa y preventActive=true.' };
      }

      await removeTabs(targetTab.id);
      tabContextState.delete(targetTab.id);
      tabTemporalState.delete(targetTab.id);
      whatsappContextLogByTab.delete(targetTab.id);
      if (activeTabId === targetTab.id) {
        setActiveTab(-1);
        syncActiveTabFromWindow();
      }

      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        closedTab: normalizeTabForTool(targetTab)
      });

      return {
        ok: true,
        result: normalizeTabForTool(targetTab)
      };
    }

    if (safeAction === 'closeNonProductivityTabs') {
      const keepActive = safeArgs.keepActive !== false;
      const keepPinned = safeArgs.keepPinned !== false;
      const dryRun = safeArgs.dryRun === true;
      const onlyCurrentWindow = safeArgs.onlyCurrentWindow !== false;

      const tabs = await queryTabs(onlyCurrentWindow ? { currentWindow: true } : {});
      const candidates = tabs.filter((tab) => {
        if (keepActive && tab.active) {
          return false;
        }
        if (keepPinned && tab.pinned) {
          return false;
        }
        return !isProductivityTab(tab);
      });

      if (!candidates.length) {
        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          closed: 0,
          reason: 'No candidate tabs for closure.'
        });
        return {
          ok: true,
          result: {
            closed: 0,
            tabs: []
          }
        };
      }

      if (!dryRun) {
        await removeTabs(candidates.map((tab) => tab.id));
        for (const tab of candidates) {
          tabContextState.delete(tab.id);
          tabTemporalState.delete(tab.id);
          whatsappContextLogByTab.delete(tab.id);
        }
      }

      logDebug(`runBrowserAction:done:${safeAction}`, {
        requestId,
        closed: dryRun ? 0 : candidates.length,
        dryRun,
        tabs: candidates.map(normalizeTabForTool)
      });
      return {
        ok: true,
        result: {
          closed: dryRun ? 0 : candidates.length,
          dryRun,
          tabs: candidates.map(normalizeTabForTool)
        }
      };
    }

    logWarn(`runBrowserAction:fail:${safeAction}`, {
      requestId,
      reason: 'Unsupported browser action.'
    });
    return {
      ok: false,
      error: `Accion de browser no soportada: ${safeAction || 'unknown'}`
    };
  }

  function normalizeContext(tab, context = {}) {
    const safeTab = tab && typeof tab === 'object' ? tab : {};
    const safeContext = context && typeof context === 'object' ? context : {};

    const tabId =
      typeof safeTab.id === 'number' ? safeTab.id : typeof safeContext.tabId === 'number' ? safeContext.tabId : -1;
    const url = String(safeContext.url || safeTab.url || '');
    const title = toSafeText(safeContext.title || safeTab.title || '');
    const description = toSafeText(safeContext.description || '', 360);
    const textExcerpt = toSafeText(safeContext.textExcerpt || safeContext.text || '', 2000);
    const site =
      typeof safeContext.site === 'string' && safeContext.site.trim()
        ? safeContext.site.trim().toLowerCase()
        : detectSiteByUrl(url);

    const baseDetails = safeContext.details && typeof safeContext.details === 'object' ? safeContext.details : {};
    const temporal = getTabTemporalPayload(tabId, url, Date.now());
    const history = getHistoryPayload(url);
    const importanceScore = computeImportanceScore(temporal);
    const details = {
      ...baseDetails,
      temporal,
      history,
      importanceScore
    };

    return {
      tabId,
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
      history: buildRecentHistory(60),
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

    logWhatsappContextSnapshot(normalized, reason);
    tabContextState.set(normalized.tabId, normalized);

    if (activeTabId === -1 && tab.active) {
      setActiveTab(normalized.tabId);
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
      tabTemporalState.delete(tabId);
      whatsappContextLogByTab.delete(tabId);
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

      let nextActive = -1;

      for (const tab of tabs) {
        if (!tab || typeof tab.id !== 'number') {
          continue;
        }

        if (tab.active && tab.highlighted) {
          nextActive = tab.id;
        }

        requestContextFromTab(tab.id, reason);
      }

      setActiveTab(nextActive);
    });
  }

  function syncActiveTabFromWindow() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        setActiveTab(-1);
        return;
      }

      setActiveTab(tab.id);
      requestContextFromTab(tab.id, 'active_window_changed');
    });
  }

  chrome.runtime.onInstalled.addListener((details) => {
    enablePanelOnActionClick();
    refreshAllTabs('installed');

    const reason = typeof details?.reason === 'string' ? details.reason : 'install';
    if (reason === 'install') {
      const now = Date.now();
      void writeChromeLocal({
        [INITIAL_CONTEXT_SYNC_STORAGE_KEY]: {
          version: INITIAL_CONTEXT_SYNC_VERSION,
          status: 'pending',
          reason,
          startedAt: 0,
          completedAt: 0,
          updatedAt: now,
          error: '',
          sourceCounts: {
            tabs: 0,
            history: 0,
            chat: 0,
            profile: 0,
            facts: 0
          }
        }
      });
    }
  });

  chrome.runtime.onStartup.addListener(() => {
    enablePanelOnActionClick();
    refreshAllTabs('startup');
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    const nextTabId = activeInfo && typeof activeInfo.tabId === 'number' ? activeInfo.tabId : -1;
    setActiveTab(nextTabId);
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
      setActiveTab(tabId);
    }

    if (typeof changeInfo.url === 'string') {
      const temporal = ensureTabTemporal(tabId);
      if (temporal) {
        temporal.url = changeInfo.url;
        temporal.visitStartedAt = Date.now();
        temporal.accumulatedActiveMs = 0;
        temporal.activeSince = tab && tab.active ? Date.now() : null;
      }
    }

    requestContextFromTab(tabId, 'tab_updated');
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    pauseTabActiveSession(tabId, Date.now());
    tabContextState.delete(tabId);
    tabTemporalState.delete(tabId);
    whatsappContextLogByTab.delete(tabId);
    if (activeTabId === tabId) {
      setActiveTab(-1);
      syncActiveTabFromWindow();
    }

    broadcastSnapshot('tab_removed');
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (!tab || typeof tab.id !== 'number') {
      return;
    }

    ensureTabTemporal(tab.id);
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

  if (chrome.history && chrome.history.onVisited) {
    chrome.history.onVisited.addListener((entry) => {
      upsertHistoryRecord(entry);
      broadcastSnapshot('history_visited');
    });

    if (chrome.history.onVisitRemoved) {
      chrome.history.onVisitRemoved.addListener((entry) => {
        if (entry && entry.allHistory) {
          recentHistoryByUrl.clear();
          broadcastSnapshot('history_cleared');
          return;
        }

        const removedUrls = Array.isArray(entry?.urls) ? entry.urls : [];
        for (const url of removedUrls) {
          const safe = toSafeUrl(url);
          if (safe) {
            recentHistoryByUrl.delete(safe);
          }
        }

        broadcastSnapshot('history_pruned');
      });
    }

    chrome.history.search(
      {
        text: '',
        maxResults: HISTORY_CACHE_LIMIT,
        startTime: Date.now() - 1000 * 60 * 60 * 24 * 14
      },
      (items) => {
        if (chrome.runtime.lastError || !Array.isArray(items)) {
          return;
        }

        for (const item of items) {
          upsertHistoryRecord(item);
        }

        broadcastSnapshot('history_bootstrap');
      }
    );
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
        setActiveTab(senderTab.id);
      }

      upsertContextFromTab(senderTab, message.context || {}, message.reason || 'context_push');
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_TAB_CONTEXT_SNAPSHOT) {
      chrome.tabs.query({}, (tabs) => {
        const known = new Set();
        let nextActive = -1;

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
            nextActive = tab.id;
          }
        }

        setActiveTab(nextActive);

        for (const tabId of tabContextState.keys()) {
          if (!known.has(tabId)) {
            tabContextState.delete(tabId);
            tabTemporalState.delete(tabId);
            whatsappContextLogByTab.delete(tabId);
          }
        }

        sendResponse({ ok: true, snapshot: buildSnapshot('snapshot_request') });
      });

      return true;
    }

    if (message.type === MESSAGE_TYPES.BROWSER_ACTION) {
      const action = typeof message.action === 'string' ? message.action : '';
      const args = message.args && typeof message.args === 'object' ? message.args : {};
      const requestMeta = {
        senderTabId: Number(sender?.tab?.id) || -1,
        action,
        args
      };

      logDebug('onMessage:BROWSER_ACTION:received', requestMeta);

      if (!action) {
        logWarn('onMessage:BROWSER_ACTION:invalid', requestMeta);
        sendResponse({ ok: false, error: 'Accion de browser requerida.' });
        return false;
      }

      Promise.resolve(runBrowserAction(action, args))
        .then((result) => {
          logDebug('onMessage:BROWSER_ACTION:resolved', {
            ...requestMeta,
            result
          });
          sendResponse(result || { ok: false, error: 'Sin respuesta de browser action.' });
          broadcastSnapshot('browser_action');
        })
        .catch((error) => {
          logWarn('onMessage:BROWSER_ACTION:error', {
            ...requestMeta,
            error: error instanceof Error ? error.message : String(error || '')
          });
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Error ejecutando browser action.'
          });
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
