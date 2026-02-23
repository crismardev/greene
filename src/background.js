(() => {
  'use strict';

  importScripts('background/background-browser-actions-controller.js');
  importScripts('background/background-smtp-bridge-service.js');

  const MESSAGE_TYPES = Object.freeze({
    GET_TAB_CONTEXT: 'GREENE_GET_TAB_CONTEXT',
    TAB_CONTEXT_PUSH: 'GREENE_TAB_CONTEXT_PUSH',
    GET_TAB_CONTEXT_SNAPSHOT: 'GREENE_GET_TAB_CONTEXT_SNAPSHOT',
    TAB_CONTEXT_UPDATED: 'GREENE_TAB_CONTEXT_UPDATED',
    SITE_ACTION_IN_TAB: 'GREENE_SITE_ACTION_IN_TAB',
    SITE_ACTION: 'GREENE_SITE_ACTION',
    BROWSER_ACTION: 'GREENE_BROWSER_ACTION',
    LOCATION_CONTEXT_UPDATE: 'GREENE_LOCATION_CONTEXT_UPDATE',
    SMTP_SEND: 'GREENE_SMTP_SEND',
    NATIVE_HOST_PING: 'GREENE_NATIVE_HOST_PING'
  });

  const EXTERNAL_MESSAGE_TYPES = Object.freeze({
    OPEN_WHATSAPP: 'OPEN_WHATSAPP',
    OPEN_URL: 'OPEN_URL',
    LIST_TABS: 'LIST_TABS',
    FOCUS_TAB: 'FOCUS_TAB',
    CLOSE_TAB: 'CLOSE_TAB',
    GET_RECENT_HISTORY: 'GET_RECENT_HISTORY',
    CLOSE_NON_PRODUCTIVITY_TABS: 'CLOSE_NON_PRODUCTIVITY_TABS',
    WHATSAPP_GET_INBOX: 'WHATSAPP_GET_INBOX',
    WHATSAPP_OPEN_CHAT: 'WHATSAPP_OPEN_CHAT',
    WHATSAPP_SEND_MESSAGE: 'WHATSAPP_SEND_MESSAGE',
    WHATSAPP_OPEN_CHAT_AND_SEND_MESSAGE: 'WHATSAPP_OPEN_CHAT_AND_SEND_MESSAGE',
    HELP: 'HELP'
  });
  const EXTERNAL_MESSAGE_TYPE_SET = new Set(Object.values(EXTERNAL_MESSAGE_TYPES));

  const LOG_PREFIX = '[greene/background]';
  const WHATSAPP_WEB_BASE_URL = 'https://web.whatsapp.com/';
  const WHATSAPP_WEB_MATCH_PATTERN = 'https://web.whatsapp.com/*';
  const tabContextState = new Map();
  const tabTemporalState = new Map();
  const recentHistoryByUrl = new Map();
  const HISTORY_CACHE_LIMIT = 240;
  const INITIAL_CONTEXT_SYNC_STORAGE_KEY = 'greene_initial_context_sync_v1';
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
  const SMTP_HTTP_AGENT_FALLBACK_ENDPOINTS = Object.freeze([
    'http://127.0.0.1:4395/smtp/send',
    'http://localhost:4395/smtp/send'
  ]);
  const DEFAULT_SMTP_NATIVE_HOST_NAME = 'com.greene.smtp_bridge';
  const LOCAL_CONNECTOR_PING_ALARM_NAME = 'greene_local_connector_ping';
  const LOCAL_CONNECTOR_PING_PERIOD_MINUTES = 3;
  const whatsappContextLogByTab = new Map();
  let runtimeContextState = {
    updatedAt: 0,
    reason: 'init',
    permissions: {
      microphone: 'prompt',
      location: 'prompt'
    },
    maps: {
      hasApiKey: false,
      nearbyType: 'restaurant'
    },
    location: null,
    nearbyPlaces: []
  };
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

  function normalizePermissionState(value) {
    const token = String(value || '')
      .trim()
      .toLowerCase();
    if (token === 'granted' || token === 'denied' || token === 'prompt') {
      return token;
    }
    return 'prompt';
  }

  function normalizeRuntimeContextPayload(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const permissions = source.permissions && typeof source.permissions === 'object' ? source.permissions : {};
    const maps = source.maps && typeof source.maps === 'object' ? source.maps : {};
    const location = source.location && typeof source.location === 'object' ? source.location : null;
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    const safeLocation =
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? {
            latitude,
            longitude,
            accuracy: Math.max(0, Number(location?.accuracy) || 0),
            capturedAt: Math.max(0, Number(location?.capturedAt) || 0)
          }
        : null;
    const nearbyPlaces = (Array.isArray(source.nearbyPlaces) ? source.nearbyPlaces : [])
      .slice(0, 12)
      .map((item) => {
        const entry = item && typeof item === 'object' ? item : {};
        const name = toSafeText(entry.name || '', 140);
        if (!name) {
          return null;
        }
        return {
          name,
          address: toSafeText(entry.address || '', 220),
          rating: Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : 0,
          userRatingCount: Math.max(0, Number(entry.userRatingCount) || 0),
          primaryType: toSafeText(entry.primaryType || '', 80)
        };
      })
      .filter(Boolean);

    return {
      reason: toSafeText(source.reason || 'panel_sync', 80) || 'panel_sync',
      updatedAt: Math.max(0, Number(source.updatedAt) || Date.now()),
      permissions: {
        microphone: normalizePermissionState(permissions.microphone),
        location: normalizePermissionState(permissions.location)
      },
      maps: {
        hasApiKey: Boolean(maps.hasApiKey),
        nearbyType: toSafeText(maps.nearbyType || 'restaurant', 40) || 'restaurant'
      },
      location: safeLocation,
      nearbyPlaces
    };
  }

  function parseSafeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }

    try {
      return new URL(raw);
    } catch (_) {
      return null;
    }
  }

  const smtpBridgeService = self.GreeneBackgroundSmtpBridge.createBackgroundSmtpBridgeService({
    defaultSmtpNativeHostName: DEFAULT_SMTP_NATIVE_HOST_NAME,
    logDebug,
    logWarn,
    parseSafeUrl,
    smtpHttpAgentFallbackEndpoints: SMTP_HTTP_AGENT_FALLBACK_ENDPOINTS,
    toSafeText
  });

  async function pingLocalConnector(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const reason = toSafeText(safeOptions.reason || 'auto_ping', 80) || 'auto_ping';
    const nativeHostName =
      toSafeText(safeOptions.nativeHostName || DEFAULT_SMTP_NATIVE_HOST_NAME, 180) || DEFAULT_SMTP_NATIVE_HOST_NAME;

    try {
      const result = await smtpBridgeService.runNativeHostPing({
        nativeHostName
      });
      logDebug('local_connector_ping:ok', {
        reason,
        hostName: toSafeText(result?.hostName || nativeHostName, 180),
        version: toSafeText(result?.version || '', 60)
      });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error en ping automatico de conector local.';
      logWarn('local_connector_ping:error', {
        reason,
        nativeHostName,
        error: toSafeText(errorMessage, 220)
      });
      return null;
    }
  }

  function scheduleLocalConnectorPing() {
    if (!chrome.alarms || typeof chrome.alarms.create !== 'function') {
      return;
    }

    try {
      chrome.alarms.create(LOCAL_CONNECTOR_PING_ALARM_NAME, {
        periodInMinutes: LOCAL_CONNECTOR_PING_PERIOD_MINUTES
      });
      logDebug('local_connector_ping:schedule', {
        alarm: LOCAL_CONNECTOR_PING_ALARM_NAME,
        periodMinutes: LOCAL_CONNECTOR_PING_PERIOD_MINUTES
      });
    } catch (error) {
      logWarn('local_connector_ping:schedule_error', {
        error: error instanceof Error ? error.message : String(error || '')
      });
    }
  }

  function isRetoolHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'retool.com' || host.endsWith('.retool.com');
  }

  function isTrustedRetoolSender(sender) {
    const sourceUrl =
      String(sender?.origin || '').trim() ||
      String(sender?.url || '').trim() ||
      (sender?.tab && typeof sender.tab.url === 'string' ? String(sender.tab.url || '').trim() : '');
    const parsed = parseSafeUrl(sourceUrl);
    if (!parsed) {
      return false;
    }

    return parsed.protocol === 'https:' && isRetoolHost(parsed.hostname);
  }

  function isExternalMessageType(value) {
    const type = String(value || '')
      .trim()
      .toUpperCase();
    return Boolean(type) && EXTERNAL_MESSAGE_TYPE_SET.has(type);
  }

  function toSafePhone(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    const digits = raw.replace(/[^\d+]/g, '');
    if (!digits) {
      return '';
    }

    const normalized = digits.startsWith('+') ? `+${digits.slice(1).replace(/[^\d]/g, '')}` : digits.replace(/[^\d]/g, '');
    const withoutPlus = normalized.replace(/^\+/, '');

    if (!withoutPlus || withoutPlus.length < 7) {
      return '';
    }

    return `+${withoutPlus.slice(0, 24)}`;
  }

  function getWhatsappPhoneArg(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const candidates = [
      safeArgs.phone,
      safeArgs.to,
      safeArgs.number,
      safeArgs.chatPhone,
      safeArgs.telefono,
      safeArgs.tel,
      safeArgs.mobile,
      safeArgs.movil,
      safeArgs.cel,
      safeArgs.whatsapp,
      safeArgs.whatsappNumber,
      safeArgs.contactPhone,
      safeArgs.contact_phone
    ];

    for (const value of candidates) {
      const normalized = toSafePhone(value || '');
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  function hasWhatsappLookupArgs(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    if (getWhatsappPhoneArg(safeArgs)) {
      return true;
    }

    const chatIndex = Number(safeArgs.chatIndex);
    if (Number.isInteger(chatIndex) && chatIndex >= 1) {
      return true;
    }

    const scalarFields = [
      safeArgs.query,
      safeArgs.name,
      safeArgs.chat,
      safeArgs.title,
      safeArgs.search,
      safeArgs.contact,
      safeArgs.recipient,
      safeArgs.destinatario,
      safeArgs.person,
      safeArgs.persona,
      safeArgs.client,
      safeArgs.cliente
    ];
    if (scalarFields.some((item) => String(item || '').trim())) {
      return true;
    }

    return Array.isArray(safeArgs.queries) && safeArgs.queries.some((item) => String(item || '').trim());
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

  function isWhatsappWebUrl(url) {
    return /^https:\/\/web\.whatsapp\.com(\/|$)/i.test(String(url || '').trim());
  }

  function buildWhatsappSendUrl(phone, text) {
    const safePhone = toSafePhone(phone).replace(/^\+/, '');
    const safeText = toSafeText(text || '', 4000);
    const params = new URLSearchParams();

    if (safePhone) {
      params.set('phone', safePhone);
    }

    if (safeText) {
      params.set('text', safeText);
    }

    const query = params.toString();
    return query ? `${WHATSAPP_WEB_BASE_URL}send?${query}` : WHATSAPP_WEB_BASE_URL;
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

  function createTab(createProperties = {}) {
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

  function updateTab(tabId, updateProperties = {}) {
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

  function normalizeExternalTab(tab) {
    return {
      id: Number(tab?.id) || -1,
      windowId: Number(tab?.windowId) || -1,
      index: Number(tab?.index) || 0,
      active: Boolean(tab?.active),
      pinned: Boolean(tab?.pinned),
      title: toSafeText(tab?.title || '', 220),
      url: toSafeUrl(tab?.url || ''),
      site: detectSiteByUrl(tab?.url || '')
    };
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

  function cleanupTabState(tabId) {
    if (typeof tabId !== 'number' || tabId < 0) {
      return;
    }

    tabContextState.delete(tabId);
    tabTemporalState.delete(tabId);
    whatsappContextLogByTab.delete(tabId);
  }

  const browserActionsController = self.GreeneBackgroundBrowserActions.createBackgroundBrowserActionsController({
    logDebug,
    logWarn,
    clamp,
    toSafeText,
    toSafeUrl,
    detectSiteByUrl,
    parseTimestamp,
    normalizeHistoryRecord,
    upsertHistoryRecord,
    queryHistory,
    buildHistoryRangeArgs,
    summarizeHistoryRecords,
    toIsoTimestamp,
    getTabById,
    cleanupTabState,
    setActiveTab,
    syncActiveTabFromWindow,
    getActiveTabId: () => activeTabId,
    limits: {
      extendedHistoryMinResults: EXTENDED_HISTORY_MIN_RESULTS,
      extendedHistoryMaxResults: EXTENDED_HISTORY_MAX_RESULTS,
      extendedHistoryMinDays: EXTENDED_HISTORY_MIN_DAYS,
      extendedHistoryMaxDays: EXTENDED_HISTORY_MAX_DAYS,
      oldestHistoryDefaultChunk: OLDEST_HISTORY_DEFAULT_CHUNK,
      oldestHistoryMaxChunk: OLDEST_HISTORY_MAX_CHUNK,
      oldestHistoryDefaultChunks: OLDEST_HISTORY_DEFAULT_CHUNKS,
      oldestHistoryMaxChunks: OLDEST_HISTORY_MAX_CHUNKS
    }
  });

  async function runBrowserAction(action, args = {}) {
    return browserActionsController.run(action, args);
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

    const runtimeContext = runtimeContextState && typeof runtimeContextState === 'object' ? runtimeContextState : {};
    const runtimeLocation = runtimeContext.location && typeof runtimeContext.location === 'object' ? runtimeContext.location : null;

    return {
      reason,
      activeTabId,
      history: buildRecentHistory(60),
      runtimeContext: {
        reason: toSafeText(runtimeContext.reason || '', 80),
        updatedAt: Math.max(0, Number(runtimeContext.updatedAt) || 0),
        permissions: {
          microphone: normalizePermissionState(runtimeContext?.permissions?.microphone),
          location: normalizePermissionState(runtimeContext?.permissions?.location)
        },
        maps: {
          hasApiKey: Boolean(runtimeContext?.maps?.hasApiKey),
          nearbyType: toSafeText(runtimeContext?.maps?.nearbyType || 'restaurant', 40) || 'restaurant'
        },
        location: runtimeLocation
          ? {
              latitude: Number(runtimeLocation.latitude) || 0,
              longitude: Number(runtimeLocation.longitude) || 0,
              accuracy: Math.max(0, Number(runtimeLocation.accuracy) || 0),
              capturedAt: Math.max(0, Number(runtimeLocation.capturedAt) || 0)
            }
          : null,
        nearbyPlaces: (Array.isArray(runtimeContext.nearbyPlaces) ? runtimeContext.nearbyPlaces : []).slice(0, 12)
      },
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

  function runSiteActionInTab(tabId, site, action, args = {}) {
    return new Promise((resolve) => {
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
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'No se pudo ejecutar accion.' });
            return;
          }

          resolve(response || { ok: false, error: 'Sin respuesta del content script.' });
        }
      );
    });
  }

  async function resolveWhatsappTab(tabIdCandidate = -1) {
    const directTabId = Number(tabIdCandidate);
    if (Number.isFinite(directTabId) && directTabId >= 0) {
      const direct = await getTabById(directTabId);
      if (direct && isWhatsappWebUrl(direct.url || '')) {
        return direct;
      }
    }

    const knownWhatsappTabs = Array.from(tabContextState.values())
      .filter((tab) => tab && tab.site === 'whatsapp' && Number.isFinite(tab.tabId) && tab.tabId >= 0)
      .sort((a, b) => {
        if (a.tabId === activeTabId) {
          return -1;
        }
        if (b.tabId === activeTabId) {
          return 1;
        }
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });

    for (const knownTab of knownWhatsappTabs) {
      const tab = await getTabById(knownTab.tabId);
      if (tab && isWhatsappWebUrl(tab.url || '')) {
        return tab;
      }
    }

    const queried = await queryTabs({ url: WHATSAPP_WEB_MATCH_PATTERN });
    if (!queried.length) {
      return null;
    }

    return queried.find((tab) => tab.active) || queried[0] || null;
  }

  function getExternalMessageArgs(message = {}) {
    const safeMessage = message && typeof message === 'object' ? message : {};
    const directArgs = {
      ...safeMessage
    };

    delete directArgs.type;
    delete directArgs.requestId;

    const nestedArgs = safeMessage.args && typeof safeMessage.args === 'object' ? safeMessage.args : {};
    return {
      ...directArgs,
      ...nestedArgs
    };
  }

  function buildExternalEnvelope(type, payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const ok = safePayload.ok === true || safePayload.success === true;

    return {
      ...safePayload,
      ok,
      success: ok,
      type
    };
  }

  function buildExternalHelpPayload() {
    return buildExternalEnvelope(EXTERNAL_MESSAGE_TYPES.HELP, {
      ok: true,
      result: {
        tools: [
          {
            type: EXTERNAL_MESSAGE_TYPES.OPEN_WHATSAPP,
            args: ['phone', 'text', 'reuseExistingTab?', 'tabId?', 'active?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.OPEN_URL,
            args: ['url', 'reuseExistingTab?', 'active?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.LIST_TABS,
            args: []
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.FOCUS_TAB,
            args: ['tabId? | urlContains? | titleContains?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.CLOSE_TAB,
            args: ['tabId? | url? | urlContains? | titleContains? | preventActive?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.GET_RECENT_HISTORY,
            args: ['days?', 'limit?', 'text?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.CLOSE_NON_PRODUCTIVITY_TABS,
            args: ['dryRun?', 'keepPinned?', 'keepActive?', 'onlyCurrentWindow?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.WHATSAPP_GET_INBOX,
            args: ['tabId?', 'limit?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.WHATSAPP_OPEN_CHAT,
            args: ['tabId?', 'query? | name? | chat? | phone? | chatIndex?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.WHATSAPP_SEND_MESSAGE,
            args: ['tabId?', 'text', 'query? | name? | chat? | phone?']
          },
          {
            type: EXTERNAL_MESSAGE_TYPES.WHATSAPP_OPEN_CHAT_AND_SEND_MESSAGE,
            args: ['tabId?', 'query? | name? | chat? | phone?', 'text']
          }
        ]
      }
    });
  }

  async function runExternalBrowserAction(type, action, rawArgs, options = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const shouldBroadcast = options.broadcast === true;
    const result = await runBrowserAction(action, args);
    if (shouldBroadcast && result?.ok === true) {
      broadcastSnapshot('external_browser_action');
    }

    return buildExternalEnvelope(type, result || { ok: false, error: 'Sin respuesta de browser action.' });
  }

  async function handleExternalOpenWhatsapp(rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const url = buildWhatsappSendUrl(getWhatsappPhoneArg(args), args.text || args.message || '');
    const requestedTabId = Number(args.tabId);
    const active = args.active !== false;
    const reuseExistingTab = args.reuseExistingTab !== false && args.forceNewTab !== true && args.newTab !== true;

    let tab = null;
    let reused = false;

    if (reuseExistingTab) {
      const knownTab = await resolveWhatsappTab(Number.isFinite(requestedTabId) ? requestedTabId : -1);
      if (knownTab && typeof knownTab.id === 'number') {
        tab = await updateTab(knownTab.id, { url, active });
        reused = true;
      }
    }

    if (!tab) {
      tab = await createTab({ url, active });
    }

    if (tab && typeof tab.id === 'number') {
      if (tab.active) {
        setActiveTab(tab.id);
      }
      requestContextFromTab(tab.id, reused ? 'external_open_whatsapp_update' : 'external_open_whatsapp_create');
      broadcastSnapshot('external_open_whatsapp');
    }

    return buildExternalEnvelope(EXTERNAL_MESSAGE_TYPES.OPEN_WHATSAPP, {
      ok: true,
      result: {
        reused,
        url,
        tab: normalizeExternalTab(tab)
      }
    });
  }

  async function handleExternalOpenUrl(rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const url = toSafeUrl(args.url || args.href || args.targetUrl);
    if (!url) {
      return buildExternalEnvelope(EXTERNAL_MESSAGE_TYPES.OPEN_URL, {
        ok: false,
        error: 'URL invalida. Usa http(s)://...'
      });
    }

    const active = args.active !== false;
    const reuseExistingTab = args.reuseExistingTab === true;
    let tab = null;
    let reused = false;

    if (reuseExistingTab) {
      const tabs = await queryTabs({});
      const matched = tabs.find((item) => toSafeUrl(item?.url || '') === url) || null;
      if (matched && typeof matched.id === 'number') {
        tab = await updateTab(matched.id, { url, active });
        reused = true;
      }
    }

    if (!tab) {
      tab = await createTab({ url, active });
    }

    if (tab && typeof tab.id === 'number') {
      if (tab.active) {
        setActiveTab(tab.id);
      }
      requestContextFromTab(tab.id, reused ? 'external_open_url_update' : 'external_open_url_create');
      broadcastSnapshot('external_open_url');
    }

    return buildExternalEnvelope(EXTERNAL_MESSAGE_TYPES.OPEN_URL, {
      ok: true,
      result: {
        reused,
        url,
        tab: normalizeExternalTab(tab)
      }
    });
  }

  async function runExternalWhatsappAction(type, action, rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const requestedTabId = Number(args.tabId);
    const routeSendThroughOpen = action === 'sendMessage' && hasWhatsappLookupArgs(args);
    const requestedAction = routeSendThroughOpen ? 'openChatAndSendMessage' : action;
    const targetTab = await resolveWhatsappTab(Number.isFinite(requestedTabId) ? requestedTabId : -1);

    if (!targetTab || typeof targetTab.id !== 'number') {
      return buildExternalEnvelope(type, {
        ok: false,
        error: 'No hay tab de WhatsApp disponible. Abre WhatsApp Web o usa OPEN_WHATSAPP primero.'
      });
    }

    const actionArgs = {
      ...args
    };
    delete actionArgs.tabId;
    if (!actionArgs.text && typeof actionArgs.message === 'string') {
      actionArgs.text = actionArgs.message;
    }

    const response = await runSiteActionInTab(targetTab.id, 'whatsapp', requestedAction, actionArgs);
    if (response?.ok === true) {
      requestContextFromTab(targetTab.id, 'external_whatsapp_action');
      broadcastSnapshot('external_whatsapp_action');
    }

    let resultPayload = response?.result;
    if (resultPayload && typeof resultPayload === 'object' && !Array.isArray(resultPayload)) {
      resultPayload = {
        ...resultPayload,
        tabId: targetTab.id,
        requestedAction: action,
        executedAction: requestedAction
      };
    } else {
      resultPayload = {
        tabId: targetTab.id,
        requestedAction: action,
        executedAction: requestedAction,
        value: resultPayload
      };
    }

    return buildExternalEnvelope(type, {
      ok: response?.ok === true,
      result: resultPayload,
      error: response?.error || ''
    });
  }

  async function runExternalMessage(message, sender) {
    const safeMessage = message && typeof message === 'object' ? message : {};
    const rawType = String(safeMessage.type || '').trim();
    const type = rawType.toUpperCase();
    const args = getExternalMessageArgs(safeMessage);

    const senderMeta = {
      id: toSafeText(sender?.id || '', 80),
      origin: toSafeText(sender?.origin || '', 160),
      url: toSafeText(sender?.url || '', 220)
    };

    if (!type) {
      logWarn('onMessageExternal:invalid', {
        sender: senderMeta,
        reason: 'missing_type'
      });
      return buildExternalEnvelope('', {
        ok: false,
        error: 'type requerido. Usa HELP para ver tools disponibles.'
      });
    }

    logDebug('onMessageExternal:received', {
      type,
      sender: senderMeta,
      args
    });

    if (type === EXTERNAL_MESSAGE_TYPES.HELP) {
      return buildExternalHelpPayload();
    }

    if (type === EXTERNAL_MESSAGE_TYPES.OPEN_WHATSAPP) {
      return handleExternalOpenWhatsapp(args);
    }

    if (type === EXTERNAL_MESSAGE_TYPES.OPEN_URL) {
      return handleExternalOpenUrl(args);
    }

    if (type === EXTERNAL_MESSAGE_TYPES.LIST_TABS) {
      return runExternalBrowserAction(type, 'listTabs', args, { broadcast: false });
    }

    if (type === EXTERNAL_MESSAGE_TYPES.FOCUS_TAB) {
      return runExternalBrowserAction(type, 'focusTab', args, { broadcast: true });
    }

    if (type === EXTERNAL_MESSAGE_TYPES.CLOSE_TAB) {
      return runExternalBrowserAction(type, 'closeTab', args, { broadcast: true });
    }

    if (type === EXTERNAL_MESSAGE_TYPES.GET_RECENT_HISTORY) {
      return runExternalBrowserAction(type, 'getRecentHistory', args, { broadcast: false });
    }

    if (type === EXTERNAL_MESSAGE_TYPES.CLOSE_NON_PRODUCTIVITY_TABS) {
      return runExternalBrowserAction(type, 'closeNonProductivityTabs', args, { broadcast: true });
    }

    if (type === EXTERNAL_MESSAGE_TYPES.WHATSAPP_GET_INBOX) {
      return runExternalWhatsappAction(type, 'getInbox', args);
    }

    if (type === EXTERNAL_MESSAGE_TYPES.WHATSAPP_OPEN_CHAT) {
      return runExternalWhatsappAction(type, 'openChat', args);
    }

    if (type === EXTERNAL_MESSAGE_TYPES.WHATSAPP_SEND_MESSAGE) {
      return runExternalWhatsappAction(type, 'sendMessage', args);
    }

    if (type === EXTERNAL_MESSAGE_TYPES.WHATSAPP_OPEN_CHAT_AND_SEND_MESSAGE) {
      return runExternalWhatsappAction(type, 'openChatAndSendMessage', args);
    }

    return buildExternalEnvelope(type, {
      ok: false,
      error: `Tool externa no soportada: ${type}. Usa HELP para listado.`
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
      cleanupTabState(tabId);
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
    void pingLocalConnector({
      reason: 'installed'
    });
    scheduleLocalConnectorPing();

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
    void pingLocalConnector({
      reason: 'startup'
    });
    scheduleLocalConnectorPing();
  });

  if (chrome.alarms && chrome.alarms.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      const alarmName = String(alarm?.name || '').trim();
      if (alarmName !== LOCAL_CONNECTOR_PING_ALARM_NAME) {
        return;
      }

      void pingLocalConnector({
        reason: 'alarm'
      });
    });
  }

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
    cleanupTabState(tabId);
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

    if (message.type === MESSAGE_TYPES.NATIVE_HOST_PING) {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const nativeHostName = toSafeText(payload.nativeHostName || DEFAULT_SMTP_NATIVE_HOST_NAME, 180);
      logDebug('onMessage:NATIVE_HOST_PING:received', {
        senderTabId: Number(sender?.tab?.id) || -1,
        nativeHostName
      });

      Promise.resolve(smtpBridgeService.runNativeHostPing(payload))
        .then((result) => {
          sendResponse({
            ok: true,
            result
          });
        })
        .catch((error) => {
          const messageText = error instanceof Error ? error.message : 'Error ejecutando ping de Native Host.';
          logWarn('onMessage:NATIVE_HOST_PING:error', {
            nativeHostName,
            error: messageText
          });
          sendResponse({
            ok: false,
            error: messageText
          });
        });

      return true;
    }

    if (message.type === MESSAGE_TYPES.SMTP_SEND) {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const requestSummary = smtpBridgeService.buildSmtpBridgeLogSummary(payload);

      logDebug('onMessage:SMTP_SEND:received', {
        senderTabId: Number(sender?.tab?.id) || -1,
        request: requestSummary
      });

      Promise.resolve(smtpBridgeService.runSmtpBridgeSend(payload))
        .then((result) => {
          logDebug('onMessage:SMTP_SEND:resolved', {
            request: requestSummary
          });
          sendResponse({
            ok: true,
            result: result && typeof result === 'object' ? result : { ok: true }
          });
        })
        .catch((error) => {
          const messageText = error instanceof Error ? error.message : 'Error ejecutando SMTP bridge.';
          logWarn('onMessage:SMTP_SEND:error', {
            request: requestSummary,
            error: messageText
          });
          sendResponse({
            ok: false,
            error: messageText
          });
        });

      return true;
    }

    if (message.type === MESSAGE_TYPES.LOCATION_CONTEXT_UPDATE) {
      runtimeContextState = normalizeRuntimeContextPayload(message.payload);
      logDebug('runtime_context:update', {
        senderTabId: Number(sender?.tab?.id) || -1,
        reason: runtimeContextState.reason,
        hasLocation: Boolean(runtimeContextState.location),
        nearbyPlaces: Array.isArray(runtimeContextState.nearbyPlaces) ? runtimeContextState.nearbyPlaces.length : 0
      });
      broadcastSnapshot('runtime_context_update');
      sendResponse({
        ok: true,
        runtimeContext: runtimeContextState
      });
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
            cleanupTabState(tabId);
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

      runSiteActionInTab(tabId, site, action, args).then((response) => {
        sendResponse(response || { ok: false, error: 'Sin respuesta del content script.' });
      });

      return true;
    }

    if (isExternalMessageType(message.type) && isTrustedRetoolSender(sender)) {
      Promise.resolve(runExternalMessage(message, sender))
        .then((response) => {
          sendResponse(response || buildExternalEnvelope('', { ok: false, error: 'Sin respuesta.' }));
        })
        .catch((error) => {
          const messageText = error instanceof Error ? error.message : 'Error ejecutando tool puente Retool.';
          logWarn('onMessage:retool_bridge:error', {
            type: String(message?.type || '').trim(),
            error: messageText
          });
          sendResponse({
            ok: false,
            success: false,
            type: String(message?.type || '').trim().toUpperCase(),
            error: messageText
          });
        });

      return true;
    }

    return false;
  });

  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      sendResponse({
        ok: false,
        success: false,
        error: 'Payload invalido.'
      });
      return false;
    }

    Promise.resolve(runExternalMessage(message, sender))
      .then((response) => {
        sendResponse(response || buildExternalEnvelope('', { ok: false, error: 'Sin respuesta.' }));
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : 'Error ejecutando tool externa.';
        logWarn('onMessageExternal:error', {
          type: String(message?.type || '').trim(),
          error: messageText
        });
        sendResponse({
          ok: false,
          success: false,
          type: String(message?.type || '').trim().toUpperCase(),
          error: messageText
        });
      });

    return true;
  });

  enablePanelOnActionClick();
  refreshAllTabs('boot');
  void pingLocalConnector({
    reason: 'boot'
  });
  scheduleLocalConnectorPing();
  logDebug('Servicio de tabs/contexto inicializado.');
})();
