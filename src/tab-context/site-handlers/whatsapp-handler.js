(() => {
  'use strict';

  // Browser-side automation pack aligned with common operations from whatsapp-web.js / Baileys.
  const REGISTRY_KEY = 'GreenStudioSiteHandlers';
  const LOG_PREFIX = '[greenstudio-ext/whatsapp-handler]';
  const ENABLE_SCRAPE_DEBUG_LOGS = true;
  const CONTEXT_LOG_MIN_INTERVAL_MS = 1800;
  const CHAT_SYNC_STORAGE_KEY = 'greenstudio_whatsapp_sync_state_v1';
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

  function summarizeMessageForLog(item, index) {
    return {
      idx: index,
      id: toSafeText(item?.id || '', 96),
      role: item?.role === 'me' ? 'me' : 'contact',
      timestamp: toSafeText(item?.timestamp || '', 72),
      chars: String(item?.text || '').length,
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

  function buildMessageTextByKind(row, kind, defaultText) {
    const baseText = toSafeText(defaultText || '', 800);
    if (kind === 'audio') {
      const duration = toSafeText(row?.querySelector('.x1fesggd')?.textContent || '', 30);
      return duration ? `Mensaje de voz (${duration})` : 'Mensaje de voz';
    }

    if (kind === 'sticker') {
      return '[Sticker]';
    }

    if (kind === 'image') {
      return baseText || '[Imagen]';
    }

    if (kind === 'document') {
      const fileName = toSafeText(row?.querySelector('.x13faqbe._ao3e')?.textContent || '', 120);
      return fileName ? `Documento: ${fileName}` : baseText || 'Documento adjunto';
    }

    if (kind === 'video') {
      return baseText || '[Video]';
    }

    if (kind === 'media_caption') {
      return baseText || '[Contenido multimedia]';
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
        const text = buildMessageTextByKind(row, contentKind, baseText);
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
          timestamp
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

  function getInboxList(options = {}) {
    const limit = Math.max(1, Number(options.limit) || 40);
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

        return {
          id: `${index}-${title}`,
          title,
          phone: extractPhoneCandidate(title),
          preview
        };
      })
      .filter(Boolean);

    if (parsed.length <= limit) {
      return parsed;
    }

    return parsed.slice(0, limit);
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

  function insertTextIntoComposer(editor, message) {
    if (!editor) {
      return {
        inserted: false,
        mode: 'editor_missing'
      };
    }

    const safeMessage = String(message || '');
    editor.focus();

    try {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
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
    if (currentComposerText !== toSafeText(safeMessage, 2200)) {
      editor.textContent = safeMessage;
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: safeMessage,
          inputType: 'insertText'
        })
      );
      mode = insertedByExec ? 'execCommand+inputFallback' : 'inputFallback';
    } else {
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

  async function sendMessageToCurrentChat(text) {
    const message = String(text || '').trim();
    if (!message) {
      return {
        ok: false,
        error: 'Texto vacio.'
      };
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

    const editor = getComposerEditor();
    if (!editor) {
      return {
        ok: false,
        error: 'No se encontro el input de mensaje.'
      };
    }

    const composeResult = insertTextIntoComposer(editor, message);

    const sendButton = getSendButton();
    const sendButtonDisabled = Boolean(sendButton?.disabled);
    let dispatchMethod = 'enter_key';
    if (sendButton && !sendButtonDisabled) {
      dispatchMethod = 'send_button';
      sendButton.click();
    } else {
      dispatchComposerEnter(editor);
    }

    const confirmedInTimeline = await waitForOutgoingEcho(message, 2600, 180);
    if (confirmedInTimeline) {
      lastSentFingerprint = fingerprint;
      lastSentAt = Date.now();
    }

    logDebug('send_message:dispatch_result', {
      chatKey: toSafeText(chatKey, 180),
      composeMode: composeResult.mode,
      dispatchMethod,
      sendButtonFound: Boolean(sendButton),
      sendButtonDisabled,
      confirmedInTimeline
    });

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

  function collectContext(options = {}) {
    const textLimit = Math.max(300, Number(options.textLimit) || 1800);
    const messages = getConversationMessages({ limit: 80 });
    const inbox = getInboxList({ limit: 40 });
    const chatTitle = getCurrentChatTitle();
    const chatPhone = getCurrentChatPhone();
    const channelId = buildChatChannelId({ chatPhone, chatTitle, messages });
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
    const chatKey = context.details?.currentChat?.key || '';
    const messageTail = Array.isArray(context.details?.messages)
      ? context.details.messages
          .slice(-3)
          .map((item) => `${item.role}:${item.text}`)
          .join('|')
      : '';

    return `${chatKey}::${messageTail}`;
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
      const phone = getCurrentChatPhone();
      const key = phone || title || '';
      const channelId = buildChatChannelId({
        chatPhone: phone,
        chatTitle: title,
        messages: getConversationMessages({ limit: 6 })
      });
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
      return sendMessageToCurrentChat(args.text || '');
    }

    if (action === 'getAutomationPack') {
      const messages = getConversationMessages({ limit: Number(args.messageLimit) || 80 });
      const title = getCurrentChatTitle();
      const phone = getCurrentChatPhone();
      return {
        ok: true,
        result: {
          myNumber: getMyNumber(),
          currentChat: {
            title,
            phone,
            key: phone || title || '',
            channelId: buildChatChannelId({
              chatPhone: phone,
              chatTitle: title,
              messages
            })
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
