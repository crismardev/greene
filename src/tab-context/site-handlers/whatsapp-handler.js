(() => {
  'use strict';

  // Browser-side automation pack aligned with common operations from whatsapp-web.js / Baileys.
  const REGISTRY_KEY = 'GreeneSiteHandlers';
  const LOG_PREFIX = '[greene/whatsapp-handler]';
  const ENABLE_SCRAPE_DEBUG_LOGS = true;
  const CONTEXT_LOG_MIN_INTERVAL_MS = 1800;
  const CHAT_SYNC_STORAGE_KEY = 'greene_whatsapp_sync_state_v1';
  const CHAT_SYNC_VERSION = 1;
  const CHAT_SYNC_MAX_CHATS = 120;
  const CHAT_SYNC_MAX_MESSAGE_IDS = 180;
  const USER_MESSAGE_CONTAINER_SELECTOR =
    '#main div.x3psx0u.x12xbjc7.x1c1uobl.xrmvbpv.xh8yej3.xquzyny.xvc5jky.x11t971q';
  const contextLogState = {
    signature: '',
    at: 0
  };
  const observedChatState = {
    key: '',
    channelId: '',
    lastMessageId: '',
    at: 0
  };
  let chatSyncStoreCache = null;

  function getRegistry() {
    if (!window[REGISTRY_KEY]) {
      window[REGISTRY_KEY] = [];
    }

    return window[REGISTRY_KEY];
  }

  function logDebug(message, payload) {
    if (payload === undefined) {
      console.debug(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.debug(`${LOG_PREFIX} ${message}`, payload);
  }

  function shouldEmitLog(state, signature, minIntervalMs) {
    const safeState = state && typeof state === 'object' ? state : null;
    if (!safeState) {
      return true;
    }

    const now = Date.now();
    if (safeState.signature === signature && now - safeState.at < minIntervalMs) {
      return false;
    }

    safeState.signature = signature;
    safeState.at = now;
    return true;
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

  function toChannelToken(value, limit = 180) {
    const normalized = toSafeText(value || '', limit)
      .toLowerCase()
      .replace(/[^a-z0-9@._:+-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return normalized;
  }

  function compactUniqueTail(values, limit = 120) {
    const source = Array.isArray(values) ? values : [];
    const unique = [];
    const seen = new Set();

    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index];
      const token = toSafeText(item || '', 220);
      if (!token || seen.has(token)) {
        continue;
      }

      seen.add(token);
      unique.push(token);
      if (unique.length >= limit) {
        break;
      }
    }

    return unique.reverse();
  }

  function normalizePhone(value) {
    const source = String(value || '').trim();
    if (!source) {
      return '';
    }

    const plus = source.startsWith('+');
    const digits = source.replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    return `${plus ? '+' : ''}${digits}`;
  }

  function extractPhoneCandidate(value) {
    const source = String(value || '');
    if (!source) {
      return '';
    }

    const fromWid = source.match(/([0-9]{7,})@/);
    if (fromWid && fromWid[1]) {
      return normalizePhone(fromWid[1]);
    }

    const common = source.match(/(\+?[0-9][0-9\s().-]{6,}[0-9])/);
    if (common && common[1]) {
      return normalizePhone(common[1]);
    }

    return '';
  }

  function parseStorageCandidate(raw) {
    if (raw === null || raw === undefined) {
      return '';
    }

    if (typeof raw === 'string') {
      const direct = extractPhoneCandidate(raw);
      if (direct) {
        return direct;
      }

      try {
        const parsed = JSON.parse(raw);
        return parseStorageCandidate(parsed);
      } catch (_) {
        return '';
      }
    }

    if (typeof raw === 'object') {
      const priorityFields = ['user', 'wid', 'id', 'me', 'phone', 'jid', 'serialized'];
      for (const field of priorityFields) {
        if (!Object.prototype.hasOwnProperty.call(raw, field)) {
          continue;
        }

        const candidate = parseStorageCandidate(raw[field]);
        if (candidate) {
          return candidate;
        }
      }

      for (const key of Object.keys(raw)) {
        const candidate = parseStorageCandidate(raw[key]);
        if (candidate) {
          return candidate;
        }
      }
    }

    return '';
  }

  function getMyNumber() {
    const localStorageKeys = ['last-wid-md', 'last-wid', 'lastKnownPhone'];

    for (const key of localStorageKeys) {
      let raw = '';

      try {
        raw = localStorage.getItem(key);
      } catch (_) {
        raw = '';
      }

      const candidate = parseStorageCandidate(raw);
      if (candidate) {
        return candidate;
      }
    }

    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || (!key.includes('wid') && !key.includes('phone'))) {
          continue;
        }

        const raw = localStorage.getItem(key);
        const candidate = parseStorageCandidate(raw);
        if (candidate) {
          return candidate;
        }
      }
    } catch (_) {
      // Ignore localStorage access issues.
    }

    return '';
  }

  function getCurrentChatTitle() {
    const selectors = [
      '[data-testid="conversation-info-header-chat-title"]',
      'header [role="button"] span[dir="auto"]',
      'header span[title]'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      const value = node.getAttribute('title') || node.textContent || '';
      const safe = toSafeText(value, 240);
      if (safe) {
        return safe;
      }
    }

    return '';
  }

  function getCurrentChatPhone() {
    const searchParams = new URLSearchParams(location.search);
    const fromSearch = normalizePhone(searchParams.get('phone'));
    if (fromSearch) {
      return fromSearch;
    }

    const title = getCurrentChatTitle();
    const fromTitle = extractPhoneCandidate(title);
    if (fromTitle) {
      return fromTitle;
    }

    const breadcrumb = document.querySelector('[data-testid="chatlist-header"]');
    const fromBreadcrumb = extractPhoneCandidate(breadcrumb?.textContent || '');
    if (fromBreadcrumb) {
      return fromBreadcrumb;
    }

    return '';
  }

  function parseMessageTimestamp(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
      return '';
    }

    return raw.slice(0, 96);
  }

  function parsePrePlainMetadata(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
      return {
        time: '',
        author: ''
      };
    }

    const match = raw.match(/\[(.*?)\]\s*(.*?):/);
    if (!match) {
      return {
        time: '',
        author: ''
      };
    }

    return {
      time: toSafeText(match[1] || '', 64),
      author: toSafeText(match[2] || '', 120)
    };
  }

  function toStableHash(value) {
    const source = String(value || '');
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16);
  }

  function buildStableMessageId({ row, index, role, prePlain, timestamp, text, kind }) {
    const direct = row?.getAttribute?.('data-id') || row?.querySelector?.('[data-id]')?.getAttribute?.('data-id') || '';
    const safeDirect = toSafeText(direct, 120);
    if (safeDirect) {
      return safeDirect;
    }

    const base = [role, timestamp, prePlain, kind, text]
      .map((item) => toSafeText(item || '', 220))
      .join('|');
    return `msg-${toStableHash(base)}-${Number(index) || 0}`;
  }

  function extractChannelFromMessageId(messageId) {
    const source = String(messageId || '').trim();
    if (!source) {
      return '';
    }

    const widMatch = source.match(/([0-9]{7,}@[a-z.]+)/i);
    if (widMatch && widMatch[1]) {
      return toChannelToken(widMatch[1], 120);
    }

    return '';
  }

  function buildChatChannelId({ chatPhone, chatTitle, messages }) {
    const list = Array.isArray(messages) ? messages : [];
    const lastMessage = list.length ? list[list.length - 1] : null;
    const fromMessageId = extractChannelFromMessageId(lastMessage?.id || '');
    if (fromMessageId) {
      return `whatsapp:${fromMessageId}`;
    }

    const normalizedPhone = normalizePhone(chatPhone || '');
    if (normalizedPhone) {
      return `whatsapp:${normalizedPhone}`;
    }

    const titleToken = toChannelToken(chatTitle || '', 96);
    if (titleToken) {
      return `whatsapp:title:${titleToken}`;
    }

    return '';
  }

  function extractPhoneFromChatChannelId(channelId) {
    const source = String(channelId || '').trim();
    if (!source) {
      return '';
    }

    const directWid = source.match(/(?:whatsapp:)?([0-9]{7,})@c\.us/i);
    if (directWid && directWid[1]) {
      return normalizePhone(directWid[1]);
    }

    const fallbackWid = source.match(/([0-9]{7,})@/);
    if (fallbackWid && fallbackWid[1]) {
      return normalizePhone(fallbackWid[1]);
    }

    return '';
  }

  function normalizeChatSyncEntry(rawEntry) {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const channelId = toSafeText(entry.channelId || '', 220);
    if (!channelId) {
      return null;
    }

    return {
      channelId,
      chatKey: toSafeText(entry.chatKey || '', 220),
      title: toSafeText(entry.title || '', 220),
      phone: normalizePhone(entry.phone || ''),
      lastMessageId: toSafeText(entry.lastMessageId || '', 220),
      messageIds: compactUniqueTail(entry.messageIds || [], CHAT_SYNC_MAX_MESSAGE_IDS),
      updatedAt: Math.max(0, Number(entry.updatedAt) || 0)
    };
  }

  function getChatSyncStore() {
    if (chatSyncStoreCache && chatSyncStoreCache.byChannel instanceof Map) {
      return chatSyncStoreCache;
    }

    const store = {
      byChannel: new Map()
    };

    try {
      const raw = localStorage.getItem(CHAT_SYNC_STORAGE_KEY);
      if (!raw) {
        chatSyncStoreCache = store;
        return store;
      }

      const parsed = JSON.parse(raw);
      const chats = Array.isArray(parsed?.chats) ? parsed.chats : [];
      for (const item of chats) {
        const normalized = normalizeChatSyncEntry(item);
        if (!normalized) {
          continue;
        }

        store.byChannel.set(normalized.channelId, normalized);
        if (store.byChannel.size >= CHAT_SYNC_MAX_CHATS) {
          break;
        }
      }
    } catch (_) {
      // Ignore malformed sync snapshots.
    }

    chatSyncStoreCache = store;
    return store;
  }

  function persistChatSyncStore(store) {
    if (!store || !(store.byChannel instanceof Map)) {
      return;
    }

    const entries = Array.from(store.byChannel.values())
      .filter(Boolean)
      .sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0))
      .slice(0, CHAT_SYNC_MAX_CHATS)
      .map((item) => ({
        channelId: toSafeText(item?.channelId || '', 220),
        chatKey: toSafeText(item?.chatKey || '', 220),
        title: toSafeText(item?.title || '', 220),
        phone: normalizePhone(item?.phone || ''),
        lastMessageId: toSafeText(item?.lastMessageId || '', 220),
        messageIds: compactUniqueTail(item?.messageIds || [], CHAT_SYNC_MAX_MESSAGE_IDS),
        updatedAt: Math.max(0, Number(item?.updatedAt) || Date.now())
      }))
      .filter((item) => item.channelId);

    store.byChannel = new Map(entries.map((item) => [item.channelId, item]));

    try {
      localStorage.setItem(
        CHAT_SYNC_STORAGE_KEY,
        JSON.stringify({
          version: CHAT_SYNC_VERSION,
          updatedAt: Date.now(),
          chats: entries
        })
      );
    } catch (_) {
      // Ignore localStorage write issues.
    }
  }

  function updateChatSyncState({ channelId, chatKey, title, phone, messages }) {
    const safeChannelId = toSafeText(channelId || '', 220);
    const safeChatKey = toSafeText(chatKey || '', 220);
    const safeTitle = toSafeText(title || '', 220);
    const safePhone = normalizePhone(phone || '');
    const list = Array.isArray(messages) ? messages : [];
    const visibleMessageIds = compactUniqueTail(
      list.map((item) => item?.id || ''),
      CHAT_SYNC_MAX_MESSAGE_IDS
    );
    const lastVisibleMessageId = visibleMessageIds.length ? visibleMessageIds[visibleMessageIds.length - 1] : '';

    if (!safeChannelId) {
      return {
        channelId: '',
        knownLastMessageId: '',
        lastVisibleMessageId,
        isLastMessageSynced: false,
        missingMessageCount: visibleMessageIds.length,
        missingMessageIds: visibleMessageIds.slice(-12),
        knownMessageCount: 0
      };
    }

    const store = getChatSyncStore();
    const knownEntry = normalizeChatSyncEntry(store.byChannel.get(safeChannelId)) || {
      channelId: safeChannelId,
      chatKey: '',
      title: '',
      phone: '',
      lastMessageId: '',
      messageIds: [],
      updatedAt: 0
    };
    const knownSet = new Set(knownEntry.messageIds);
    const missingMessageIds = visibleMessageIds.filter((messageId) => !knownSet.has(messageId));
    const mergedMessageIds = compactUniqueTail(
      [...knownEntry.messageIds, ...visibleMessageIds],
      CHAT_SYNC_MAX_MESSAGE_IDS
    );
    const isLastMessageSynced = Boolean(lastVisibleMessageId && knownSet.has(lastVisibleMessageId));
    const hasStateChanges =
      missingMessageIds.length > 0 ||
      safeChatKey !== knownEntry.chatKey ||
      safeTitle !== knownEntry.title ||
      safePhone !== knownEntry.phone ||
      lastVisibleMessageId !== knownEntry.lastMessageId ||
      mergedMessageIds.length !== knownEntry.messageIds.length;

    if (hasStateChanges) {
      store.byChannel.set(safeChannelId, {
        channelId: safeChannelId,
        chatKey: safeChatKey,
        title: safeTitle,
        phone: safePhone,
        lastMessageId: lastVisibleMessageId || knownEntry.lastMessageId || '',
        messageIds: mergedMessageIds,
        updatedAt: Date.now()
      });
      persistChatSyncStore(store);
    }

    return {
      channelId: safeChannelId,
      knownLastMessageId: knownEntry.lastMessageId || '',
      lastVisibleMessageId,
      isLastMessageSynced,
      missingMessageCount: missingMessageIds.length,
      missingMessageIds: missingMessageIds.slice(-12),
      knownMessageCount: mergedMessageIds.length
    };
  }

  function trackObservedChat(chatKey, channelId, lastMessageId) {
    const safeChatKey = toSafeText(chatKey || channelId || '', 220);
    const safeChannelId = toSafeText(channelId || '', 220);
    const safeLastMessageId = toSafeText(lastMessageId || '', 220);
    const previous = {
      key: observedChatState.key,
      channelId: observedChatState.channelId,
      lastMessageId: observedChatState.lastMessageId,
      at: observedChatState.at
    };

    const changed = Boolean(safeChatKey && safeChatKey !== observedChatState.key);
    if (changed) {
      observedChatState.key = safeChatKey;
      observedChatState.channelId = safeChannelId;
      observedChatState.lastMessageId = safeLastMessageId;
      observedChatState.at = Date.now();
    } else if (safeChatKey) {
      observedChatState.channelId = safeChannelId || observedChatState.channelId;
      observedChatState.lastMessageId = safeLastMessageId || observedChatState.lastMessageId;
    }

    return {
      changed,
      previous
    };
  }

  function getFallbackMessageTime(row) {
    if (!row) {
      return '';
    }

    const selectors = ['.x1rg5ohu.x16dsc37 span', '[data-testid="msg-meta"] span', 'time'];
    for (const selector of selectors) {
      const value = toSafeText(row.querySelector(selector)?.textContent || '', 40);
      if (value) {
        return value;
      }
    }

    return '';
  }

  function collectMessageRows() {
    const rowsByDataTestId = Array.from(document.querySelectorAll('div[data-testid="msg-container"]'));
    const rowsByRoleMain = Array.from(document.querySelectorAll('#main div[role="row"]'));
    const userContainer = document.querySelector(USER_MESSAGE_CONTAINER_SELECTOR);
    const rowsByUserContainer = userContainer ? Array.from(userContainer.querySelectorAll('div[role="row"]')) : [];

    if (rowsByUserContainer.length) {
      return {
        rows: rowsByUserContainer,
        source: 'user_container_role_row',
        userContainerFound: true,
        counts: {
          byDataTestId: rowsByDataTestId.length,
          byRoleMain: rowsByRoleMain.length,
          byUserContainer: rowsByUserContainer.length
        }
      };
    }

    if (rowsByRoleMain.length) {
      return {
        rows: rowsByRoleMain,
        source: 'main_role_row',
        userContainerFound: Boolean(userContainer),
        counts: {
          byDataTestId: rowsByDataTestId.length,
          byRoleMain: rowsByRoleMain.length,
          byUserContainer: rowsByUserContainer.length
        }
      };
    }

    return {
      rows: rowsByDataTestId,
      source: 'data_testid_msg_container',
      userContainerFound: Boolean(userContainer),
      counts: {
        byDataTestId: rowsByDataTestId.length,
        byRoleMain: rowsByRoleMain.length,
        byUserContainer: rowsByUserContainer.length
      }
    };
  }

  function detectMessageContentKind(row, text) {
    if (!row) {
      return 'unknown';
    }

    if (row.querySelector('[data-icon="audio-play"], [data-icon="ptt-status"]')) {
      return 'audio';
    }

    const stickerNode = row.querySelector('img[alt*="Sticker"], img[alt*="sticker"]');
    if (stickerNode && row.querySelector('canvas')) {
      return 'sticker';
    }

    if (row.querySelector('img[src^="blob:"]') && !row.querySelector('canvas')) {
      return 'image';
    }

    if (
      row.querySelector('[data-icon="document-SVG-icon"], [data-icon="document"]') ||
      row.querySelector('[title*="Download"], [title*="Descargar"]')
    ) {
      return 'document';
    }

    if (row.querySelector('video')) {
      return 'video';
    }

    if (row.querySelector('[data-testid="media-caption"]')) {
      return 'media_caption';
    }

    return text ? 'text' : 'empty';
  }

  function createEmptyMessageEnrichment() {
    return {
      transcript: '',
      ocrText: '',
      mediaCaption: '',
      imageAlt: '',
      fileName: '',
      audioDuration: ''
    };
  }

  function collectTextValuesFromNode(node, limit = 260) {
    if (!node || typeof node !== 'object') {
      return [];
    }

    const rawValues = [
      node.getAttribute?.('aria-label') || '',
      node.getAttribute?.('title') || '',
      node.getAttribute?.('alt') || '',
      node.textContent || ''
    ];

    const unique = [];
    const seen = new Set();
    for (const value of rawValues) {
      const token = toSafeText(value, limit);
      if (!token || seen.has(token)) {
        continue;
      }
      seen.add(token);
      unique.push(token);
    }

    return unique;
  }

  function collectCandidateTextsFromRow(row, selectors, options = {}) {
    if (!row) {
      return [];
    }

    const list = Array.isArray(selectors) ? selectors : [];
    const limit = Math.max(20, Number(options.limit) || 260);
    const maxItems = Math.max(1, Number(options.maxItems) || 8);
    const unique = [];
    const seen = new Set();

    for (const selector of list) {
      if (!selector) {
        continue;
      }

      const nodes = row.querySelectorAll(selector);
      for (const node of nodes) {
        const values = collectTextValuesFromNode(node, limit);
        for (const value of values) {
          const normalized = value.toLowerCase();
          if (seen.has(normalized)) {
            continue;
          }

          seen.add(normalized);
          unique.push(value);
          if (unique.length >= maxItems) {
            return unique;
          }
        }
      }
    }

    return unique;
  }

  function isLikelyUiNoiseText(value) {
    const text = toSafeText(value || '', 320).toLowerCase();
    if (!text) {
      return true;
    }

    const blockedTokens = [
      'mensaje de voz',
      'voice message',
      'play',
      'pause',
      'reproducir',
      'pausar',
      'download',
      'descargar',
      'audio-play',
      'audio',
      'reenviado',
      'forwarded'
    ];

    return blockedTokens.some((token) => text === token || text.startsWith(`${token} `));
  }

  function extractMessageEnrichmentByKind(row, kind, baseText = '') {
    const enrichment = createEmptyMessageEnrichment();
    if (!row) {
      return enrichment;
    }

    const mediaCaption = toSafeText(row.querySelector('[data-testid="media-caption"]')?.textContent || '', 320);
    if (mediaCaption) {
      enrichment.mediaCaption = mediaCaption;
    }

    if (kind === 'audio') {
      const duration = toSafeText(row.querySelector('.x1fesggd')?.textContent || '', 30);
      if (duration) {
        enrichment.audioDuration = duration;
      }

      const transcriptCandidates = collectCandidateTextsFromRow(
        row,
        [
          '[data-testid*="transcription"]',
          '[data-testid*="audio-transcription"]',
          '[aria-label*="transcrip"]',
          '[aria-label*="transcript"]',
          'div.copyable-text span.selectable-text',
          'span.selectable-text span'
        ],
        { limit: 320, maxItems: 8 }
      );

      const baseCandidate = toSafeText(baseText, 320);
      if (baseCandidate) {
        transcriptCandidates.unshift(baseCandidate);
      }

      const transcript = transcriptCandidates
        .map((item) => toSafeText(item, 320))
        .filter((item) => item && !isLikelyUiNoiseText(item) && item !== mediaCaption && item !== duration)
        .join(' ')
        .trim();

      if (transcript) {
        enrichment.transcript = toSafeText(transcript, 480);
      }
    }

    if (kind === 'image' || kind === 'video' || kind === 'media_caption') {
      const ocrCandidates = collectCandidateTextsFromRow(
        row,
        [
          'img[alt]',
          'img[title]',
          'img[aria-label]',
          '[role="img"][aria-label]',
          '[aria-label*="image"]',
          '[aria-label*="imagen"]',
          '[data-testid="media-caption"]'
        ],
        { limit: 320, maxItems: 8 }
      ).filter((item) => !isLikelyUiNoiseText(item));

      if (ocrCandidates.length) {
        enrichment.imageAlt = toSafeText(ocrCandidates[0], 220);
        enrichment.ocrText = toSafeText(ocrCandidates.join(' | '), 560);
      }
    }

    if (kind === 'document') {
      const fileName = toSafeText(row.querySelector('.x13faqbe._ao3e')?.textContent || '', 140);
      if (fileName) {
        enrichment.fileName = fileName;
      }
    }

    return enrichment;
  }

  function summarizeMessageForLog(item, index) {
    return {
      idx: index,
      id: toSafeText(item?.id || '', 96),
      role: item?.role === 'me' ? 'me' : 'contact',
      kind: toSafeText(item?.kind || '', 24),
      timestamp: toSafeText(item?.timestamp || '', 72),
      chars: String(item?.text || '').length,
      transcriptChars: String(item?.enriched?.transcript || '').length,
      ocrChars: String(item?.enriched?.ocrText || '').length,
      preview: toSafeText(item?.text || '', 140)
    };
  }

  function getMessageText(row) {
    if (!row) {
      return '';
    }

    const chunks = [];
    const textNodes = row.querySelectorAll(
      [
        'span.selectable-text span',
        'div.copyable-text span.selectable-text',
        'div.copyable-text span[dir="auto"]',
        'div.copyable-text span[dir="ltr"]',
        'span.copyable-text',
        'span[dir="auto"]'
      ].join(', ')
    );

    for (const node of textNodes) {
      const value = toSafeText(node.textContent || '', 380);
      if (value) {
        chunks.push(value);
      }
    }

    if (!chunks.length) {
      const captionNode = row.querySelector('[data-testid="media-caption"]');
      const mediaCaption = toSafeText(captionNode?.textContent || '', 280);
      if (mediaCaption) {
        chunks.push(mediaCaption);
      }
    }

    const unique = Array.from(new Set(chunks));
    return unique.join(' ').trim();
  }

  function isLikelyConversationMessageRow(row) {
    if (!row) {
      return false;
    }

    if (row.classList.contains('message-in') || row.classList.contains('message-out')) {
      return true;
    }

    return Boolean(
      row.querySelector(
        [
          '.message-in',
          '.message-out',
          '.copyable-text',
          '[data-pre-plain-text]',
          'span.selectable-text',
          '[data-testid="media-caption"]',
          '[data-icon="audio-play"]',
          '[data-icon="ptt-status"]',
          '[data-icon="document-SVG-icon"]',
          'img[src^="blob:"]',
          'video'
        ].join(', ')
      )
    );
  }

  function buildMessageTextByKind(row, kind, defaultText, enrichment = {}) {
    const safeEnrichment = enrichment && typeof enrichment === 'object' ? enrichment : createEmptyMessageEnrichment();
    const baseText = toSafeText(defaultText || '', 800);
    if (kind === 'audio') {
      const duration = toSafeText(safeEnrichment.audioDuration || row?.querySelector('.x1fesggd')?.textContent || '', 30);
      const transcript = toSafeText(safeEnrichment.transcript || '', 320);
      if (transcript) {
        return duration ? `Mensaje de voz (${duration}) - ${transcript}` : `Mensaje de voz - ${transcript}`;
      }

      return duration ? `Mensaje de voz (${duration})` : 'Mensaje de voz';
    }

    if (kind === 'sticker') {
      return '[Sticker]';
    }

    if (kind === 'image') {
      const ocrText = toSafeText(safeEnrichment.ocrText || safeEnrichment.mediaCaption || '', 360);
      if (ocrText && !baseText) {
        return `[Imagen] ${ocrText}`;
      }
      return baseText || '[Imagen]';
    }

    if (kind === 'document') {
      const fileName = toSafeText(
        safeEnrichment.fileName || row?.querySelector('.x13faqbe._ao3e')?.textContent || '',
        120
      );
      return fileName ? `Documento: ${fileName}` : baseText || 'Documento adjunto';
    }

    if (kind === 'video') {
      const mediaCaption = toSafeText(safeEnrichment.mediaCaption || safeEnrichment.ocrText || '', 260);
      return baseText || (mediaCaption ? `[Video] ${mediaCaption}` : '[Video]');
    }

    if (kind === 'media_caption') {
      const mediaCaption = toSafeText(safeEnrichment.mediaCaption || safeEnrichment.ocrText || '', 260);
      return baseText || mediaCaption || '[Contenido multimedia]';
    }

    return baseText;
  }

  function getConversationMessages(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 80);
    const rowSelection = collectMessageRows();
    const rows = Array.isArray(rowSelection.rows) ? rowSelection.rows : [];

    const parsed = rows
      .map((row, index) => {
        const likelyMessage = isLikelyConversationMessageRow(row);
        const prePlain =
          row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') ||
          row.querySelector('.copyable-text')?.getAttribute('data-pre-plain-text') ||
          '';
        const prePlainMeta = parsePrePlainMetadata(prePlain);
        const role = row.classList.contains('message-out') || row.querySelector('.message-out') ? 'me' : 'contact';
        const baseText = getMessageText(row);
        const contentKind = detectMessageContentKind(row, baseText);
        const enrichment = extractMessageEnrichmentByKind(row, contentKind, baseText);
        const text = buildMessageTextByKind(row, contentKind, baseText, enrichment);
        const timestamp = prePlainMeta.time || getFallbackMessageTime(row) || parseMessageTimestamp(prePlain);
        const id = buildStableMessageId({
          row,
          index,
          role,
          prePlain,
          timestamp,
          text,
          kind: contentKind
        });

        if (!text) {
          return null;
        }

        if (!likelyMessage && contentKind === 'empty') {
          return null;
        }

        return {
          id,
          role,
          text: toSafeText(text, 800),
          timestamp,
          kind: contentKind,
          enriched: {
            transcript: toSafeText(enrichment.transcript || '', 480),
            ocrText: toSafeText(enrichment.ocrText || '', 560),
            mediaCaption: toSafeText(enrichment.mediaCaption || '', 320),
            imageAlt: toSafeText(enrichment.imageAlt || '', 220),
            fileName: toSafeText(enrichment.fileName || '', 140),
            audioDuration: toSafeText(enrichment.audioDuration || '', 30)
          }
        };
      })
      .filter(Boolean);

    return parsed.length <= limit ? parsed : parsed.slice(parsed.length - limit);
  }

  function logContextSnapshot(context, reason, options = {}) {
    if (!ENABLE_SCRAPE_DEBUG_LOGS) {
      return;
    }

    if (!options.chatChanged) {
      return;
    }

    const safeContext = context && typeof context === 'object' ? context : {};
    const details = safeContext.details && typeof safeContext.details === 'object' ? safeContext.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const sync = details.sync && typeof details.sync === 'object' ? details.sync : {};
    const messages = Array.isArray(details.messages) ? details.messages : [];
    const inbox = Array.isArray(details.inbox) ? details.inbox : [];
    const previousChatKey = toSafeText(options.previousChatKey || '', 220);
    const currentChatKey = toSafeText(currentChat.key || currentChat.phone || currentChat.title || '', 220);
    const signature = `${previousChatKey}=>${currentChatKey}::${toSafeText(sync.lastVisibleMessageId || '', 160)}`;

    if (!shouldEmitLog(contextLogState, signature, CONTEXT_LOG_MIN_INTERVAL_MS)) {
      return;
    }

    logDebug('chat_change:detected', {
      reason: String(reason || ''),
      fromChatKey: previousChatKey,
      toChatKey: currentChatKey,
      chatTitle: toSafeText(currentChat.title || '', 180),
      chatPhone: toSafeText(currentChat.phone || '', 42),
      chatKey: toSafeText(currentChat.key || '', 180),
      channelId: toSafeText(currentChat.channelId || '', 220),
      knownLastMessageId: toSafeText(sync.knownLastMessageId || '', 220),
      lastVisibleMessageId: toSafeText(sync.lastVisibleMessageId || '', 220),
      isLastMessageSynced: Boolean(sync.isLastMessageSynced),
      missingMessageCount: Math.max(0, Number(sync.missingMessageCount) || 0),
      missingMessageIds: Array.isArray(sync.missingMessageIds) ? sync.missingMessageIds.slice(-6) : [],
      myNumber: toSafeText(details.myNumber || '', 42),
      messageCount: messages.length,
      inboxCount: inbox.length,
      messageTail: messages.slice(-4).map((item, index) => summarizeMessageForLog(item, index))
    });

    if (messages.length) {
      console.table(messages.slice(-8).map((item, index) => summarizeMessageForLog(item, index)));
    }
  }

  let lastSentFingerprint = '';
  let lastSentAt = 0;
  const SEND_DEDUPE_WINDOW_MS = 6000;

  function buildOutgoingFingerprint(text) {
    const normalizedText = toSafeText(text || '', 1200).toLowerCase();
    const chatKey = getCurrentChatPhone() || getCurrentChatTitle() || location.href;
    return `${String(chatKey || '').toLowerCase()}::${normalizedText}`;
  }

  function hasRecentOutgoingMessage(text) {
    const normalizedText = toSafeText(text || '', 1200).toLowerCase();
    if (!normalizedText) {
      return false;
    }

    const tail = getConversationMessages({ limit: 10 }).slice(-6);
    return tail.some((item) => item && item.role === 'me' && toSafeText(item.text || '', 1200).toLowerCase() === normalizedText);
  }

  function normalizeLookupToken(value) {
    const source = toSafeText(value || '', 320).toLowerCase();
    if (!source) {
      return '';
    }

    return source
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeDigitsToken(value) {
    const source = String(value || '')
      .trim()
      .replace(/\D/g, '');
    return source || '';
  }

  function matchesPhoneDigits(leftValue, rightValue) {
    const left = normalizeDigitsToken(leftValue);
    const right = normalizeDigitsToken(rightValue);
    if (!left || !right) {
      return false;
    }

    return left === right || left.endsWith(right) || right.endsWith(left);
  }

  function getRequestedPhoneFromArgs(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const candidates = [
      safeArgs.phone,
      safeArgs.chatPhone,
      safeArgs.to,
      safeArgs.number,
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
      const phone = normalizePhone(value || '');
      if (phone) {
        return phone;
      }
    }

    return '';
  }

  function getRequestedPhoneDigitsFromArgs(args = {}) {
    return normalizeDigitsToken(getRequestedPhoneFromArgs(args));
  }

  function getCurrentChatPhoneForVerification() {
    const direct = getCurrentChatPhone();
    if (direct) {
      return direct;
    }

    const title = getCurrentChatTitle();
    const messages = getConversationMessages({ limit: 6 });
    const channelId = buildChatChannelId({
      chatPhone: '',
      chatTitle: title,
      messages
    });
    return extractPhoneFromChatChannelId(channelId);
  }

  async function waitForCurrentChatPhoneMatch(expectedPhoneDigits, timeoutMs = 2200, intervalMs = 90) {
    const expectedDigits = normalizeDigitsToken(expectedPhoneDigits);
    if (!expectedDigits) {
      return {
        ok: true,
        expectedPhoneDigits: '',
        currentPhone: '',
        currentPhoneDigits: ''
      };
    }

    const deadline = Date.now() + Math.max(400, Number(timeoutMs) || 2200);
    const waitMs = Math.max(50, Number(intervalMs) || 90);
    let currentPhone = '';
    let currentDigits = '';

    while (Date.now() < deadline) {
      currentPhone = getCurrentChatPhoneForVerification();
      currentDigits = normalizeDigitsToken(currentPhone);
      if (matchesPhoneDigits(expectedDigits, currentDigits)) {
        return {
          ok: true,
          expectedPhoneDigits: expectedDigits,
          currentPhone: normalizePhone(currentPhone || '') || currentPhone,
          currentPhoneDigits: currentDigits
        };
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, waitMs);
      });
    }

    currentPhone = getCurrentChatPhoneForVerification();
    currentDigits = normalizeDigitsToken(currentPhone);
    return {
      ok: matchesPhoneDigits(expectedDigits, currentDigits),
      expectedPhoneDigits: expectedDigits,
      currentPhone: normalizePhone(currentPhone || '') || currentPhone,
      currentPhoneDigits: currentDigits
    };
  }

  function toStringArray(value, limit = 24) {
    if (Array.isArray(value)) {
      return value
        .map((item) => toSafeText(item || '', 220))
        .filter(Boolean)
        .slice(0, limit);
    }

    const token = toSafeText(value || '', 220);
    return token ? [token] : [];
  }

  function inferInboxItemKind(item, title = '', phone = '') {
    const safeTitle = normalizeLookupToken(title);
    const safePhone = normalizeDigitsToken(phone);
    const rowText = normalizeLookupToken(item?.getAttribute?.('aria-label') || item?.textContent || '');

    const hasGroupIcon = Boolean(
      item?.querySelector?.(
        'span[data-icon*="group"], [data-testid*="group"], [aria-label*="group"], [aria-label*="grupo"]'
      )
    );
    const hasPersonIcon = Boolean(
      item?.querySelector?.(
        'span[data-icon*="default-user"], span[data-icon*="person"], [data-testid*="default-user"], [data-testid*="person"]'
      )
    );

    if (hasGroupIcon) {
      return 'group';
    }

    if (safePhone) {
      return 'contact';
    }

    if (hasPersonIcon) {
      return 'contact';
    }

    if (/\bgrupo\b|\bgroup\b/.test(safeTitle) || /\bgrupo\b|\bgroup\b/.test(rowText)) {
      return 'group';
    }

    return 'unknown';
  }

  function getInboxEntries(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 40);
    const includeNode = Boolean(options.includeNode);
    const items = Array.from(document.querySelectorAll('#pane-side [role="listitem"]'));

    const parsed = items
      .map((item, index) => {
        const titleNode = item.querySelector('span[title]');
        const title = toSafeText(titleNode?.getAttribute('title') || titleNode?.textContent || '', 180);

        if (!title) {
          return null;
        }

        const previewCandidates = item.querySelectorAll('div[dir="ltr"], span[dir="auto"]');
        let preview = '';

        for (const node of previewCandidates) {
          const value = toSafeText(node.textContent || '', 220);
          if (value && value !== title) {
            preview = value;
            break;
          }
        }

        const phone = extractPhoneCandidate(title);
        const kind = inferInboxItemKind(item, title, phone);
        const normalizedTitle = normalizeLookupToken(title);
        const normalizedPreview = normalizeLookupToken(preview);
        const phoneDigits = normalizeDigitsToken(phone);
        const searchHaystack = [normalizedTitle, normalizedPreview, phoneDigits].filter(Boolean).join(' ');

        return {
          id: `${index}-${title}`,
          rank: index,
          title,
          phone,
          preview,
          kind,
          isGroup: kind === 'group',
          normalizedTitle,
          normalizedPreview,
          phoneDigits,
          searchHaystack,
          row: includeNode ? item : null
        };
      })
      .filter(Boolean);

    if (parsed.length <= limit) {
      return parsed;
    }

    return parsed.slice(0, limit);
  }

  function getInboxList(options = {}) {
    return getInboxEntries({
      limit: Math.max(1, Number(options.limit) || 40),
      includeNode: false
    }).map((entry) => ({
      id: entry.id,
      rank: entry.rank,
      title: entry.title,
      phone: entry.phone,
      preview: entry.preview,
      kind: entry.kind,
      isGroup: entry.isGroup
    }));
  }

  function getSendButton() {
    const selectors = [
      'footer button[data-testid="compose-btn-send"]',
      'footer button[data-testid="send"]',
      'footer button[aria-label="Send"]',
      'footer button[aria-label="Enviar"]'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) {
        return button;
      }
    }

    const icon = document.querySelector('footer span[data-icon="send"]');
    return icon ? icon.closest('button') : null;
  }

  function getComposerEditor() {
    const selectors = [
      'footer div[contenteditable="true"][role="textbox"]',
      'footer div[contenteditable="true"][data-tab]'
    ];

    for (const selector of selectors) {
      const editor = document.querySelector(selector);
      if (editor) {
        return editor;
      }
    }

    return null;
  }

  function dispatchComposerInput(editor, inputType = 'insertText', data = null) {
    if (!editor) {
      return;
    }

    try {
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data,
          inputType
        })
      );
      return;
    } catch (_) {
      // Ignore when InputEvent constructor is not available.
    }

    editor.dispatchEvent(
      new Event('input', {
        bubbles: true,
        cancelable: true
      })
    );
  }

  function insertTextIntoComposer(editor, message) {
    if (!editor) {
      return {
        inserted: false,
        mode: 'editor_missing'
      };
    }

    const safeMessage = String(message || '');
    const targetComposerText = toSafeText(safeMessage, 2200);
    const initialComposerText = toSafeText(editor.textContent || '', 2200);
    if (targetComposerText && initialComposerText === targetComposerText) {
      return {
        inserted: true,
        mode: 'already_present'
      };
    }

    editor.focus();

    try {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (_) {
      // Ignore selection API errors.
    }

    let mode = 'execCommand';
    let insertedByExec = false;

    try {
      insertedByExec = Boolean(document.execCommand('insertText', false, safeMessage));
    } catch (_) {
      insertedByExec = false;
    }

    const currentComposerText = toSafeText(editor.textContent || '', 2200);
    if (currentComposerText !== targetComposerText) {
      editor.textContent = safeMessage;
      dispatchComposerInput(editor, 'insertReplacementText', null);
      mode = insertedByExec ? 'execCommand+replaceFallback' : 'replaceFallback';
    } else {
      if (!insertedByExec) {
        dispatchComposerInput(editor, 'insertText', null);
      }
      mode = insertedByExec ? 'execCommand' : 'selectionInsert';
    }

    editor.dispatchEvent(new Event('change', { bubbles: true }));

    return {
      inserted: true,
      mode
    };
  }

  function dispatchComposerEnter(editor) {
    if (!editor) {
      return;
    }

    const payload = {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      which: 13,
      keyCode: 13
    };

    editor.dispatchEvent(new KeyboardEvent('keydown', payload));
    editor.dispatchEvent(new KeyboardEvent('keypress', payload));
    editor.dispatchEvent(new KeyboardEvent('keyup', payload));
  }

  async function waitForReadySendButton(timeoutMs = 900, intervalMs = 60) {
    const deadline = Date.now() + Math.max(120, Number(timeoutMs) || 900);
    const waitMs = Math.max(30, Number(intervalMs) || 60);

    while (Date.now() < deadline) {
      const button = getSendButton();
      if (button && !button.disabled) {
        return button;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, waitMs);
      });
    }

    const finalButton = getSendButton();
    if (finalButton && !finalButton.disabled) {
      return finalButton;
    }

    return null;
  }

  async function waitForComposerEditor(timeoutMs = 1200, intervalMs = 60) {
    const deadline = Date.now() + Math.max(200, Number(timeoutMs) || 1200);
    const waitMs = Math.max(30, Number(intervalMs) || 60);

    while (Date.now() < deadline) {
      const editor = getComposerEditor();
      if (editor) {
        return editor;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, waitMs);
      });
    }

    return getComposerEditor();
  }

  function composerContainsText(editor, text) {
    if (!editor) {
      return false;
    }

    const normalizedComposer = toSafeText(editor.textContent || '', 1200).toLowerCase();
    const normalizedText = toSafeText(text || '', 1200).toLowerCase();
    return Boolean(normalizedText) && normalizedComposer === normalizedText;
  }

  async function waitForOutgoingEcho(text, timeoutMs = 2600, intervalMs = 180) {
    const deadline = Date.now() + Math.max(300, Number(timeoutMs) || 2600);
    const waitMs = Math.max(60, Number(intervalMs) || 180);

    while (Date.now() < deadline) {
      if (hasRecentOutgoingMessage(text)) {
        return true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, waitMs);
      });
    }

    return hasRecentOutgoingMessage(text);
  }

  async function sendMessageToCurrentChat(text, options = {}) {
    const message = String(text || '').trim();
    if (!message) {
      return {
        ok: false,
        error: 'Texto vacio.'
      };
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const expectedPhoneDigits = normalizeDigitsToken(safeOptions.expectedPhone || safeOptions.phone || '');
    if (expectedPhoneDigits) {
      const targetCheck = await waitForCurrentChatPhoneMatch(expectedPhoneDigits, Number(safeOptions.verifyTimeoutMs) || 2400, 90);
      if (!targetCheck.ok) {
        const currentChatTitle = getCurrentChatTitle();
        return {
          ok: false,
          error: 'El chat activo no coincide con el numero solicitado. Se cancelo el envio.',
          result: {
            sent: false,
            confirmed: false,
            expectedPhoneDigits,
            currentPhoneDigits: targetCheck.currentPhoneDigits || '',
            currentPhone: toSafeText(targetCheck.currentPhone || '', 48),
            currentChatTitle: toSafeText(currentChatTitle || '', 180),
            reason: targetCheck.currentPhoneDigits ? 'phone_mismatch' : 'phone_not_detected'
          }
        };
      }
    }

    const now = Date.now();
    const fingerprint = buildOutgoingFingerprint(message);
    const chatKey = getCurrentChatPhone() || getCurrentChatTitle() || location.href;
    logDebug('send_message:start', {
      chatKey: toSafeText(chatKey, 180),
      chars: message.length,
      preview: toSafeText(message, 180)
    });

    if (fingerprint && lastSentFingerprint === fingerprint && now - lastSentAt < SEND_DEDUPE_WINDOW_MS) {
      logDebug('send_message:blocked_duplicate_window', {
        chatKey: toSafeText(chatKey, 180),
        windowMs: SEND_DEDUPE_WINDOW_MS
      });
      return {
        ok: true,
        result: {
          sent: false,
          duplicatePrevented: true,
          text: message
        }
      };
    }

    if (hasRecentOutgoingMessage(message)) {
      lastSentFingerprint = fingerprint;
      lastSentAt = now;
      logDebug('send_message:already_present_in_chat', {
        chatKey: toSafeText(chatKey, 180)
      });
      return {
        ok: true,
        result: {
          sent: false,
          duplicatePrevented: true,
          alreadyInChat: true,
          text: message
        }
      };
    }

    const editor = await waitForComposerEditor(1700, 70);
    if (!editor) {
      return {
        ok: false,
        error: 'No se encontro el input de mensaje.'
      };
    }

    const composeResult = insertTextIntoComposer(editor, message);

    const initialSendButton = getSendButton();
    const initialSendButtonDisabled = Boolean(initialSendButton?.disabled);
    let sendButtonUsed = null;
    let dispatchMethod = 'enter_key';
    const readySendButton = await waitForReadySendButton(950, 70);
    if (readySendButton) {
      dispatchMethod = 'send_button';
      sendButtonUsed = readySendButton;
      readySendButton.click();
    } else {
      dispatchComposerEnter(editor);
      const fallbackButton = await waitForReadySendButton(550, 70);
      if (fallbackButton) {
        dispatchMethod = 'enter_then_send_button';
        sendButtonUsed = fallbackButton;
        fallbackButton.click();
      }
    }

    const confirmedInTimeline = await waitForOutgoingEcho(message, 2600, 180);
    const composerStillHasMessage = composerContainsText(editor, message);
    if (confirmedInTimeline) {
      lastSentFingerprint = fingerprint;
      lastSentAt = Date.now();
    }

    const sendButtonAfterDispatch = getSendButton();
    const sendButtonDisabled = Boolean(sendButtonAfterDispatch?.disabled);

    logDebug('send_message:dispatch_result', {
      chatKey: toSafeText(chatKey, 180),
      composeMode: composeResult.mode,
      dispatchMethod,
      sendButtonFound: Boolean(initialSendButton),
      sendButtonUsed: Boolean(sendButtonUsed),
      sendButtonInitiallyDisabled: initialSendButtonDisabled,
      sendButtonDisabled,
      composerStillHasMessage,
      confirmedInTimeline
    });

    if (!confirmedInTimeline && composerStillHasMessage) {
      return {
        ok: false,
        error: 'No se pudo enviar automaticamente. El mensaje quedo escrito en el chat.',
        result: {
          sent: false,
          confirmed: false,
          dispatchMethod,
          composeMode: composeResult.mode,
          sendButtonDisabled,
          text: message
        }
      };
    }

    return {
      ok: true,
      result: {
        sent: true,
        confirmed: confirmedInTimeline,
        dispatchMethod,
        composeMode: composeResult.mode,
        sendButtonDisabled,
        text: message
      }
    };
  }

  function isNodeVisible(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (!style) {
      return true;
    }

    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }

    return true;
  }

  function dispatchLeftClick(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
    const payload = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: 1,
      clientX,
      clientY
    };

    node.dispatchEvent(new MouseEvent('mouseover', payload));
    node.dispatchEvent(new MouseEvent('mousemove', payload));
    node.dispatchEvent(new MouseEvent('mousedown', payload));
    node.dispatchEvent(new MouseEvent('mouseup', payload));
    node.dispatchEvent(new MouseEvent('click', payload));
    return true;
  }

  function dispatchContextMenu(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
    const payload = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 2,
      buttons: 2,
      clientX,
      clientY
    };

    node.dispatchEvent(new MouseEvent('mousedown', payload));
    node.dispatchEvent(new MouseEvent('mouseup', payload));
    node.dispatchEvent(new MouseEvent('contextmenu', payload));
    return true;
  }

  function sanitizeInboxEntry(entry) {
    const source = entry && typeof entry === 'object' ? entry : {};
    return {
      id: toSafeText(source.id || '', 120),
      rank: Math.max(0, Number(source.rank) || 0),
      title: toSafeText(source.title || '', 180),
      phone: toSafeText(source.phone || '', 48),
      preview: toSafeText(source.preview || '', 220),
      kind: toSafeText(source.kind || 'unknown', 24) || 'unknown',
      isGroup: Boolean(source.kind === 'group')
    };
  }

  function getOpenChatQueries(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const set = new Set();
    const add = (value) => {
      const token = toSafeText(value || '', 220);
      if (!token) {
        return;
      }
      set.add(token);
    };

    add(safeArgs.query);
    add(safeArgs.chat);
    add(safeArgs.name);
    add(safeArgs.title);
    add(safeArgs.search);
    add(safeArgs.contact);
    add(safeArgs.recipient);
    add(safeArgs.destinatario);
    add(safeArgs.person);
    add(safeArgs.persona);
    add(safeArgs.client);
    add(safeArgs.cliente);
    for (const item of toStringArray(safeArgs.queries, 20)) {
      add(item);
    }

    return Array.from(set);
  }

  function buildOpenChatDiagnostics(entries, args = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const safeArgs = args && typeof args === 'object' ? args : {};
    const chatIndex = Math.round(Number(safeArgs.chatIndex));
    const searchLimit = Math.max(20, Math.min(260, Number(safeArgs.searchLimit) || 120));
    return {
      searchLimit,
      inboxCount: list.length,
      requestedChatIndex: Number.isFinite(chatIndex) ? chatIndex : -1,
      queries: getOpenChatQueries(safeArgs),
      phoneDigits: getRequestedPhoneDigitsFromArgs(safeArgs),
      candidates: list.slice(0, 12).map((item) => sanitizeInboxEntry(item))
    };
  }

  function scoreInboxEntryForQuery(entry, query, phoneDigits, options = {}) {
    const safeEntry = entry && typeof entry === 'object' ? entry : {};
    const normalizedQuery = normalizeLookupToken(query);
    const normalizedPhone = normalizeDigitsToken(phoneDigits);
    const normalizedTitle = String(safeEntry.normalizedTitle || '');
    const searchHaystack = String(safeEntry.searchHaystack || '');
    const entryPhone = String(safeEntry.phoneDigits || '');
    const preferGroups = Boolean(options.preferGroups);
    const preferContacts = Boolean(options.preferContacts);
    let score = 0;
    let matched = false;

    if (normalizedQuery) {
      const queryTokens = normalizedQuery.split(' ').filter(Boolean);
      const exactMatch = normalizedTitle === normalizedQuery;
      const startsWith = !exactMatch && normalizedTitle.startsWith(normalizedQuery);
      const includesQuery = !exactMatch && !startsWith && searchHaystack.includes(normalizedQuery);
      const matchedTokens = queryTokens.filter((token) => searchHaystack.includes(token)).length;

      if (exactMatch) {
        score += 240;
        matched = true;
      } else if (startsWith) {
        score += 170;
        matched = true;
      } else if (includesQuery) {
        score += 120;
        matched = true;
      } else if (matchedTokens > 0) {
        score += matchedTokens * 45;
        matched = true;
      }
    }

    if (normalizedPhone) {
      if (entryPhone && normalizedPhone === entryPhone) {
        score += 260;
        matched = true;
      } else if (entryPhone && (entryPhone.endsWith(normalizedPhone) || normalizedPhone.endsWith(entryPhone))) {
        score += 180;
        matched = true;
      }
    }

    if (!normalizedQuery && !normalizedPhone) {
      score += 20;
      matched = true;
    }

    if (preferGroups) {
      score += safeEntry.kind === 'group' ? 26 : safeEntry.kind === 'unknown' ? -8 : -18;
    }

    if (preferContacts) {
      score += safeEntry.kind === 'contact' ? 26 : safeEntry.kind === 'unknown' ? -8 : -18;
    }

    const rankBonus = Math.max(0, 18 - Math.max(0, Number(safeEntry.rank) || 0));
    score += rankBonus;

    return {
      matched,
      score
    };
  }

  function pickInboxEntry(entries, args = {}) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      return null;
    }

    const safeArgs = args && typeof args === 'object' ? args : {};
    const chatIndex = Math.round(Number(safeArgs.chatIndex));
    if (Number.isFinite(chatIndex) && chatIndex >= 1 && chatIndex <= list.length) {
      return list[chatIndex - 1];
    }

    const phoneDigits = getRequestedPhoneDigitsFromArgs(safeArgs);
    const queries = getOpenChatQueries(safeArgs);
    const preferToken = normalizeLookupToken(safeArgs.prefer || safeArgs.scope || '');
    const preferGroups = Boolean(safeArgs.preferGroups || preferToken === 'groups' || preferToken === 'group');
    const preferContacts = Boolean(safeArgs.preferContacts || preferToken === 'contacts' || preferToken === 'contact');
    let best = null;

    for (const entry of list) {
      let entryMatched = false;
      let entryScore = -Infinity;

      if (!queries.length) {
        const scored = scoreInboxEntryForQuery(entry, '', phoneDigits, { preferGroups, preferContacts });
        entryMatched = scored.matched;
        entryScore = scored.score;
      } else {
        for (const query of queries) {
          const scored = scoreInboxEntryForQuery(entry, query, phoneDigits, { preferGroups, preferContacts });
          if (!scored.matched) {
            continue;
          }

          entryMatched = true;
          if (scored.score > entryScore) {
            entryScore = scored.score;
          }
        }
      }

      if (!entryMatched) {
        continue;
      }

      if (!best || entryScore > best.score) {
        best = {
          entry,
          score: entryScore
        };
      }
    }

    return best ? best.entry : null;
  }

  async function waitForChatOpen(entry, timeoutMs = 1900, intervalMs = 90) {
    const deadline = Date.now() + Math.max(300, Number(timeoutMs) || 1900);
    const waitMs = Math.max(40, Number(intervalMs) || 90);
    const safeEntry = entry && typeof entry === 'object' ? entry : {};
    const expectedTitle = String(safeEntry.normalizedTitle || normalizeLookupToken(safeEntry.title || ''));
    const expectedPhone = String(safeEntry.phoneDigits || normalizeDigitsToken(safeEntry.phone || ''));

    while (Date.now() < deadline) {
      const currentTitle = normalizeLookupToken(getCurrentChatTitle());
      const currentPhone = normalizeDigitsToken(getCurrentChatPhoneForVerification());
      const phoneMatch = matchesPhoneDigits(expectedPhone, currentPhone);
      const titleMatch = Boolean(
        expectedTitle &&
          currentTitle &&
          (expectedTitle === currentTitle || expectedTitle.includes(currentTitle) || currentTitle.includes(expectedTitle))
      );

      if (phoneMatch || titleMatch) {
        return true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, waitMs);
      });
    }

    return false;
  }

  async function openChatByQuery(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const searchLimit = Math.max(20, Math.min(260, Number(safeArgs.searchLimit) || 120));
    const requestedPhoneDigits = getRequestedPhoneDigitsFromArgs(safeArgs);
    const entries = getInboxEntries({ limit: searchLimit, includeNode: true });
    const diagnostics = buildOpenChatDiagnostics(entries, safeArgs);
    if (!entries.length) {
      return {
        ok: false,
        error: 'No se pudo leer la lista de chats en WhatsApp.',
        result: diagnostics
      };
    }

    const selected = pickInboxEntry(entries, safeArgs);
    if (!selected || !selected.row) {
      return {
        ok: false,
        error: 'No se encontro un chat que coincida con la busqueda.',
        result: {
          ...diagnostics,
          selected: null,
          available: diagnostics.candidates
        }
      };
    }

    const selectedPhoneDigits = normalizeDigitsToken(selected.phoneDigits || selected.phone || '');
    if (requestedPhoneDigits && selectedPhoneDigits && !matchesPhoneDigits(requestedPhoneDigits, selectedPhoneDigits)) {
      return {
        ok: false,
        error: 'El chat seleccionado no coincide con el numero solicitado.',
        result: {
          ...diagnostics,
          selected: sanitizeInboxEntry(selected),
          requestedPhoneDigits,
          selectedPhoneDigits
        }
      };
    }

    selected.row.scrollIntoView({ block: 'center', inline: 'nearest' });
    const clicked = dispatchLeftClick(selected.row);
    if (!clicked) {
      return {
        ok: false,
        error: 'No se pudo abrir el chat seleccionado.',
        result: {
          ...diagnostics,
          selected: sanitizeInboxEntry(selected)
        }
      };
    }

    const confirmed = await waitForChatOpen(selected, Number(safeArgs.timeoutMs) || 2100, 90);
    return {
      ok: true,
      result: {
        opened: true,
        confirmed,
        selected: sanitizeInboxEntry(selected),
        query: getOpenChatQueries(safeArgs),
        diagnostics
      }
    };
  }

  function getInboxRowMenuButton(row) {
    if (!row) {
      return null;
    }

    const selectors = [
      'button[aria-label="Menu"]',
      'button[aria-label="Menú"]',
      'button[aria-label="Más opciones"]',
      'button[aria-label="More options"]',
      '[data-testid="chatlist-item-menu"]',
      'span[data-icon="down-context"]'
    ];

    for (const selector of selectors) {
      const node = row.querySelector(selector);
      if (!node) {
        continue;
      }

      if (node.matches('button')) {
        return node;
      }

      const button = node.closest('button');
      if (button) {
        return button;
      }

      return node;
    }

    return null;
  }

  function getMenuActionLabel(node) {
    if (!node) {
      return '';
    }

    const pieces = [
      node.getAttribute?.('aria-label') || '',
      node.getAttribute?.('title') || '',
      node.textContent || ''
    ]
      .map((value) => normalizeLookupToken(value))
      .filter(Boolean);

    return pieces.join(' ').trim();
  }

  function isArchiveActionLabel(value) {
    const label = normalizeLookupToken(value || '');
    if (!label) {
      return false;
    }

    if (label.includes('desarchivar') || label.includes('unarchive')) {
      return false;
    }

    return label.includes('archivar') || label.includes('archive');
  }

  function isUnarchiveActionLabel(value) {
    const label = normalizeLookupToken(value || '');
    if (!label) {
      return false;
    }

    return label.includes('desarchivar') || label.includes('unarchive');
  }

  function getVisibleMenuActionNodes() {
    const selectors = [
      'div[role="menu"] [role="button"]',
      'div[role="menu"] button',
      'div[role="menu"] [tabindex]',
      '[data-animate-dropdown] [role="button"]',
      '[data-animate-dropdown] button',
      '[data-testid*="menu"] [role="button"]',
      '[data-testid*="menu"] button',
      '[data-testid*="menu"] [tabindex]'
    ];

    const unique = new Set();
    const result = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof Element) || unique.has(node) || !isNodeVisible(node)) {
          continue;
        }

        const hasMenuParent = Boolean(node.closest('div[role="menu"], [data-animate-dropdown], [data-testid*="menu"]'));
        if (!hasMenuParent) {
          continue;
        }

        const label = getMenuActionLabel(node);
        if (!label) {
          continue;
        }

        unique.add(node);
        result.push(node);
      }
    }

    return result;
  }

  function findVisibleMenuActionNode(matcher) {
    const test = typeof matcher === 'function' ? matcher : null;
    if (!test) {
      return null;
    }

    const nodes = getVisibleMenuActionNodes();
    for (const node of nodes) {
      const label = getMenuActionLabel(node);
      if (!label) {
        continue;
      }

      if (test(label, node)) {
        return node;
      }
    }

    return null;
  }

  async function waitForMenuActionNode(matcher, timeoutMs = 900, intervalMs = 70) {
    const deadline = Date.now() + Math.max(150, Number(timeoutMs) || 900);
    const waitMs = Math.max(30, Number(intervalMs) || 70);

    while (Date.now() < deadline) {
      const node = findVisibleMenuActionNode(matcher);
      if (node) {
        return node;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, waitMs);
      });
    }

    return findVisibleMenuActionNode(matcher);
  }

  function closeOpenMenus() {
    const payload = {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
      code: 'Escape',
      which: 27,
      keyCode: 27
    };
    document.dispatchEvent(new KeyboardEvent('keydown', payload));
    document.dispatchEvent(new KeyboardEvent('keyup', payload));
  }

  async function openInboxEntryMenu(entry) {
    const row = entry?.row;
    if (!row) {
      return false;
    }

    const button = getInboxRowMenuButton(row);
    if (button) {
      dispatchLeftClick(button);
      const foundAfterButton = await waitForMenuActionNode((label) => Boolean(label), 700, 70);
      if (foundAfterButton) {
        return true;
      }
    }

    dispatchContextMenu(row);
    const foundAfterContextMenu = await waitForMenuActionNode((label) => Boolean(label), 900, 70);
    return Boolean(foundAfterContextMenu);
  }

  async function archiveInboxEntry(entry) {
    const menuOpened = await openInboxEntryMenu(entry);
    if (!menuOpened) {
      return {
        ok: false,
        archived: false,
        alreadyArchived: false,
        error: 'No se pudo abrir el menu del chat.'
      };
    }

    const archiveAction = await waitForMenuActionNode((label) => isArchiveActionLabel(label), 800, 70);
    if (!archiveAction) {
      const alreadyArchived = Boolean(findVisibleMenuActionNode((label) => isUnarchiveActionLabel(label)));
      closeOpenMenus();
      return {
        ok: alreadyArchived,
        archived: false,
        alreadyArchived,
        error: alreadyArchived ? '' : 'No se encontro la opcion de archivar para este chat.'
      };
    }

    dispatchLeftClick(archiveAction);
    await new Promise((resolve) => {
      window.setTimeout(resolve, 130);
    });

    return {
      ok: true,
      archived: true,
      alreadyArchived: false,
      error: ''
    };
  }

  function normalizeArchiveScope(value) {
    const token = normalizeLookupToken(value || '');
    if (!token) {
      return 'all';
    }

    if (token === 'groups' || token === 'group' || token === 'grupos' || token === 'grupo') {
      return 'groups';
    }

    if (token === 'contacts' || token === 'contact' || token === 'personas' || token === 'persona') {
      return 'contacts';
    }

    return 'all';
  }

  function entryMatchesQuery(entry, query) {
    const safeEntry = entry && typeof entry === 'object' ? entry : {};
    const normalizedQuery = normalizeLookupToken(query || '');
    const queryDigits = normalizeDigitsToken(query || '');
    const haystack = String(safeEntry.searchHaystack || '');
    const phoneDigits = String(safeEntry.phoneDigits || '');

    if (!normalizedQuery && !queryDigits) {
      return false;
    }

    if (normalizedQuery && haystack.includes(normalizedQuery)) {
      return true;
    }

    if (queryDigits && phoneDigits && (phoneDigits.endsWith(queryDigits) || queryDigits.endsWith(phoneDigits))) {
      return true;
    }

    return false;
  }

  function filterEntriesForArchive(entries, args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const scope = normalizeArchiveScope(safeArgs.scope || safeArgs.target || '');
    const includeUnknownAsGroups = Boolean(safeArgs.includeUnknownAsGroups);
    const queries = toStringArray(safeArgs.queries, 30);
    if (!queries.length) {
      const singleQuery = toSafeText(safeArgs.query || safeArgs.search || safeArgs.chat || '', 220);
      if (singleQuery) {
        queries.push(singleQuery);
      }
    }

    return (Array.isArray(entries) ? entries : []).filter((entry) => {
      if (!entry || !entry.row) {
        return false;
      }

      if (scope === 'groups') {
        const isGroup = entry.kind === 'group' || (includeUnknownAsGroups && entry.kind === 'unknown');
        if (!isGroup) {
          return false;
        }
      } else if (scope === 'contacts' && entry.kind !== 'contact') {
        return false;
      }

      if (!queries.length) {
        return true;
      }

      return queries.some((query) => entryMatchesQuery(entry, query));
    });
  }

  async function archiveChatsFromInbox(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const searchLimit = Math.max(20, Math.min(260, Number(safeArgs.searchLimit) || 160));
    const scope = normalizeArchiveScope(safeArgs.scope || safeArgs.target || '');
    const dryRun = Boolean(safeArgs.dryRun);
    const entries = getInboxEntries({ limit: searchLimit, includeNode: true });
    const filtered = filterEntriesForArchive(entries, safeArgs);
    const maxItems = Math.max(1, Math.min(80, Number(safeArgs.limit) || filtered.length || 1));
    const selected = filtered.slice(0, maxItems);

    if (!selected.length) {
      return {
        ok: false,
        error: 'No se encontraron chats que coincidan con el filtro para archivar.',
        result: {
          scope,
          candidates: entries.slice(0, 16).map((item) => sanitizeInboxEntry(item))
        }
      };
    }

    if (dryRun) {
      return {
        ok: true,
        result: {
          scope,
          dryRun: true,
          matched: filtered.length,
          selected: selected.length,
          chats: selected.map((item) => sanitizeInboxEntry(item))
        }
      };
    }

    const results = [];
    let archivedCount = 0;
    let alreadyArchivedCount = 0;
    let failedCount = 0;

    for (const entry of selected) {
      const archiveResult = await archiveInboxEntry(entry);
      if (archiveResult.archived) {
        archivedCount += 1;
      } else if (archiveResult.alreadyArchived) {
        alreadyArchivedCount += 1;
      } else if (!archiveResult.ok) {
        failedCount += 1;
      }

      results.push({
        ...sanitizeInboxEntry(entry),
        ok: Boolean(archiveResult.ok),
        archived: Boolean(archiveResult.archived),
        alreadyArchived: Boolean(archiveResult.alreadyArchived),
        error: toSafeText(archiveResult.error || '', 220)
      });
    }

    return {
      ok: failedCount < selected.length,
      result: {
        scope,
        dryRun: false,
        requested: maxItems,
        matched: filtered.length,
        processed: selected.length,
        archivedCount,
        alreadyArchivedCount,
        failedCount,
        chats: results
      }
    };
  }

  async function openChatAndSendMessage(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const text = String(safeArgs.text || safeArgs.message || '').trim().slice(0, 1800);
    const requestedPhoneDigits = getRequestedPhoneDigitsFromArgs(safeArgs);
    if (!text) {
      return {
        ok: false,
        error: 'Texto requerido para enviar mensaje.'
      };
    }

    const opened = await openChatByQuery(safeArgs);
    if (!opened || opened.ok !== true) {
      return opened || { ok: false, error: 'No se pudo abrir el chat para enviar mensaje.' };
    }

    if (opened.result?.confirmed === false) {
      return {
        ok: false,
        error: 'No se pudo confirmar la apertura del chat objetivo.',
        result: {
          openChat: opened.result
        }
      };
    }

    const sent = await sendMessageToCurrentChat(text, {
      expectedPhone: requestedPhoneDigits,
      verifyTimeoutMs: Number(safeArgs.verifyTimeoutMs) || 2400
    });
    return {
      ...sent,
      result: {
        ...(sent?.result && typeof sent.result === 'object' ? sent.result : {}),
        openChat: opened.result
      }
    };
  }

  function collectContext(options = {}) {
    const textLimit = Math.max(300, Number(options.textLimit) || 1800);
    const messages = getConversationMessages({ limit: 80 });
    const inbox = getInboxList({ limit: 40 });
    const chatTitle = getCurrentChatTitle();
    const rawChatPhone = getCurrentChatPhone();
    const channelId = buildChatChannelId({ chatPhone: rawChatPhone, chatTitle, messages });
    const channelPhone = extractPhoneFromChatChannelId(channelId);
    const chatPhone = rawChatPhone || channelPhone;
    const chatKey = chatPhone || chatTitle || channelId || '';
    const lastMessageId = toSafeText(messages.length ? messages[messages.length - 1]?.id || '' : '', 220);
    const chatTracking = trackObservedChat(chatKey, channelId, lastMessageId);
    const syncState = updateChatSyncState({
      channelId,
      chatKey,
      title: chatTitle,
      phone: chatPhone,
      messages
    });
    const sync = {
      ...syncState,
      syncRequired: Boolean(syncState.missingMessageCount > 0 || !syncState.isLastMessageSynced)
    };

    const messageExcerpt = messages
      .slice(-10)
      .map((item) => `${item.role === 'me' ? 'Yo' : 'Contacto'}: ${item.text}`)
      .join('\n');

    const context = {
      site: 'whatsapp',
      url: location.href,
      title: toSafeText(document.title || '', 280),
      description: 'WhatsApp Web conversation context',
      textExcerpt: toSafeText(messageExcerpt, textLimit),
      details: {
        myNumber: getMyNumber(),
        currentChat: {
          title: chatTitle,
          phone: chatPhone,
          key: chatKey,
          channelId,
          lastMessageId
        },
        messages,
        inbox,
        sync
      }
    };

    logContextSnapshot(context, options.reason || 'collect', {
      chatChanged: chatTracking.changed,
      previousChatKey: chatTracking.previous.key || ''
    });
    return context;
  }

  function buildContextSignature() {
    const context = collectContext({ textLimit: 800 });
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const sync = details.sync && typeof details.sync === 'object' ? details.sync : {};
    const messages = Array.isArray(details.messages) ? details.messages : [];
    const chatKey = toSafeText(currentChat.key || currentChat.channelId || '', 220);
    const firstMessageId = toSafeText(messages[0]?.id || '', 220);
    const lastMessageId = toSafeText(messages.length ? messages[messages.length - 1]?.id || '' : '', 220);
    const messageTail = messages.length
      ? messages
          .slice(-3)
          .map((item) => `${item.id || ''}:${item.role}:${item.kind || ''}:${item.text || ''}`)
          .join('|')
      : '';
    const knownMessageCount = Math.max(0, Number(sync.knownMessageCount) || 0);
    const missingMessageCount = Math.max(0, Number(sync.missingMessageCount) || 0);
    const lastVisibleMessageId = toSafeText(sync.lastVisibleMessageId || '', 220);

    return [
      chatKey,
      `count:${messages.length}`,
      `known:${knownMessageCount}`,
      `missing:${missingMessageCount}`,
      `first:${firstMessageId}`,
      `last:${lastMessageId}`,
      `visible:${lastVisibleMessageId}`,
      `tail:${messageTail}`
    ].join('::');
  }

  function observeContextChanges(onChange) {
    if (typeof onChange !== 'function') {
      return () => {};
    }

    let lastSignature = buildContextSignature();
    let timer = 0;

    const emitIfChanged = (reason) => {
      const next = buildContextSignature();
      if (next === lastSignature) {
        return;
      }

      lastSignature = next;
      onChange(reason);
    };

    const schedule = (reason) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        emitIfChanged(reason);
      }, 220);
    };

    const observer = new MutationObserver(() => {
      schedule('whatsapp_mutation');
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    const onHashChange = () => schedule('whatsapp_hashchange');
    const onVisibilityChange = () => schedule('whatsapp_visibility');

    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const poll = window.setInterval(() => {
      emitIfChanged('whatsapp_poll');
    }, 1600);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      observer.disconnect();
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  async function runAction(action, args = {}) {
    if (action === 'getMyNumber') {
      return {
        ok: true,
        result: getMyNumber()
      };
    }

    if (action === 'getCurrentChat') {
      const title = getCurrentChatTitle();
      const channelId = buildChatChannelId({
        chatPhone: getCurrentChatPhone(),
        chatTitle: title,
        messages: getConversationMessages({ limit: 6 })
      });
      const phone = getCurrentChatPhone() || extractPhoneFromChatChannelId(channelId);
      const key = phone || title || channelId || '';
      return {
        ok: true,
        result: {
          title,
          phone,
          key,
          channelId
        }
      };
    }

    if (action === 'readMessages' || action === 'getListMessages') {
      return {
        ok: true,
        result: getConversationMessages({ limit: Number(args.limit) || 80 })
      };
    }

    if (action === 'getInbox' || action === 'getListInbox') {
      return {
        ok: true,
        result: getInboxList({ limit: Number(args.limit) || 40 })
      };
    }

    if (action === 'sendMessage') {
      return sendMessageToCurrentChat(args.text || args.message || '', {
        expectedPhone: getRequestedPhoneDigitsFromArgs(args),
        verifyTimeoutMs: Number(args.verifyTimeoutMs) || 2400
      });
    }

    if (action === 'openChat' || action === 'openChatByQuery') {
      return openChatByQuery(args);
    }

    if (action === 'openChatAndSendMessage' || action === 'openAndSendMessage') {
      return openChatAndSendMessage(args);
    }

    if (action === 'archiveChats' || action === 'archiveListChats' || action === 'archiveGroups') {
      const archiveArgs = {
        ...args
      };

      if (action === 'archiveGroups' && !archiveArgs.scope) {
        archiveArgs.scope = 'groups';
      }

      return archiveChatsFromInbox(archiveArgs);
    }

    if (action === 'getAutomationPack') {
      const messages = getConversationMessages({ limit: Number(args.messageLimit) || 80 });
      const title = getCurrentChatTitle();
      const rawPhone = getCurrentChatPhone();
      const channelId = buildChatChannelId({
        chatPhone: rawPhone,
        chatTitle: title,
        messages
      });
      const phone = rawPhone || extractPhoneFromChatChannelId(channelId);
      return {
        ok: true,
        result: {
          myNumber: getMyNumber(),
          currentChat: {
            title,
            phone,
            key: phone || title || channelId || '',
            channelId
          },
          messages,
          inbox: getInboxList({ limit: Number(args.inboxLimit) || 40 })
        }
      };
    }

    return {
      ok: false,
      error: `Accion no soportada en WhatsApp: ${action || 'unknown'}`
    };
  }

  const handler = {
    site: 'whatsapp',
    priority: 100,
    matches() {
      return location.hostname === 'web.whatsapp.com';
    },
    collectContext,
    observeContextChanges,
    runAction
  };

  const registry = getRegistry();
  if (!registry.some((item) => item && item.site === handler.site)) {
    registry.push(handler);
  }
})();
