export function createPanelStorageService({
  defaultSettings,
  panelSettingsDefaults,
  chatDb,
  maxChatHistoryMessages,
  maxWhatsappChatMessages = 640
}) {
  let settings = { ...defaultSettings };
  let panelSettingsCache = { ...panelSettingsDefaults };
  let chatDbPromise = null;

  function toSafeText(value, limit = 1200) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return '';
    }

    return text.slice(0, limit);
  }

  function normalizeImageDataUrl(value, maxLength = 8 * 1024 * 1024) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
      return '';
    }

    const compact = raw.replace(/\s+/g, '');
    if (!compact.toLowerCase().startsWith('data:image/')) {
      return '';
    }

    if (compact.length > Math.max(1024, Number(maxLength) || 8 * 1024 * 1024)) {
      return '';
    }

    return compact;
  }

  function toChatToken(value, limit = 200) {
    const normalized = toSafeText(value || '', limit)
      .toLowerCase()
      .replace(/[^a-z0-9@._:+-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return normalized;
  }

  function compactUniqueTail(values, limit = 320) {
    const source = Array.isArray(values) ? values : [];
    const unique = [];
    const seen = new Set();

    for (let index = source.length - 1; index >= 0; index -= 1) {
      const token = toSafeText(source[index] || '', 220);
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

  function normalizeWhatsappRole(value) {
    return value === 'me' || value === 'user' ? 'me' : 'contact';
  }

  function normalizeWhatsappKind(value) {
    const allowed = new Set(['text', 'audio', 'image', 'video', 'document', 'media_caption', 'sticker', 'unknown', 'empty']);
    const token = toSafeText(value || '', 32).toLowerCase();
    return allowed.has(token) ? token : 'text';
  }

  function pickBetterValue(incomingValue, currentValue, limit = 1200) {
    const incoming = toSafeText(incomingValue, limit);
    const current = toSafeText(currentValue, limit);

    if (!current) {
      return incoming;
    }
    if (!incoming) {
      return current;
    }

    if (incoming.length > current.length + 8) {
      return incoming;
    }

    const incomingWords = incoming.split(' ').length;
    const currentWords = current.split(' ').length;
    if (incomingWords > currentWords + 2) {
      return incoming;
    }

    return current;
  }

  function normalizeWhatsappMessage(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const enriched = record.enriched && typeof record.enriched === 'object' ? record.enriched : {};
    const id = toSafeText(record.id || '', 220);
    if (!id) {
      return null;
    }

    const role = normalizeWhatsappRole(record.role);
    const kind = normalizeWhatsappKind(record.kind);
    const transcript = toSafeText(record.transcript || enriched.transcript || '', 560);
    const ocrText = toSafeText(record.ocrText || enriched.ocrText || '', 620);
    const mediaCaption = toSafeText(record.mediaCaption || enriched.mediaCaption || '', 360);
    const imageAlt = toSafeText(record.imageAlt || enriched.imageAlt || '', 220);
    const fileName = toSafeText(record.fileName || enriched.fileName || '', 160);
    const audioDuration = toSafeText(record.audioDuration || enriched.audioDuration || '', 40);
    const timestamp = toSafeText(record.timestamp || '', 80);
    let text = toSafeText(record.text || '', 1200);

    if (!text) {
      text = pickBetterValue(transcript, text, 1200);
      text = pickBetterValue(ocrText, text, 1200);
      text = pickBetterValue(mediaCaption, text, 1200);
      if (!text && kind === 'audio') {
        text = audioDuration ? `Mensaje de voz (${audioDuration})` : 'Mensaje de voz';
      } else if (!text && kind === 'image') {
        text = '[Imagen]';
      } else if (!text && kind === 'video') {
        text = '[Video]';
      } else if (!text && kind === 'document') {
        text = fileName ? `Documento: ${fileName}` : 'Documento adjunto';
      }
    }

    if (!text) {
      return null;
    }

    const createdAt = Math.max(0, Number(record.createdAt) || 0);
    const firstSeenAt = Math.max(0, Number(record.firstSeenAt) || createdAt || Date.now());
    const lastSeenAt = Math.max(firstSeenAt, Number(record.lastSeenAt) || Date.now());

    return {
      id,
      role,
      kind,
      text,
      timestamp,
      transcript,
      ocrText,
      mediaCaption,
      imageAlt,
      fileName,
      audioDuration,
      firstSeenAt,
      lastSeenAt
    };
  }

  function mergeWhatsappMessage(current, incoming, observedAt = Date.now()) {
    const known = normalizeWhatsappMessage(current);
    const next = normalizeWhatsappMessage(incoming);
    if (!next && !known) {
      return null;
    }

    if (!known) {
      return {
        ...next,
        firstSeenAt: Math.max(0, Number(next.firstSeenAt) || observedAt),
        lastSeenAt: Math.max(observedAt, Number(next.lastSeenAt) || observedAt)
      };
    }

    if (!next) {
      return {
        ...known,
        lastSeenAt: Math.max(known.lastSeenAt || 0, observedAt)
      };
    }

    return {
      id: known.id,
      role: next.role || known.role,
      kind: next.kind && next.kind !== 'text' ? next.kind : known.kind || next.kind,
      text: pickBetterValue(next.text, known.text, 1200),
      timestamp: pickBetterValue(next.timestamp, known.timestamp, 80),
      transcript: pickBetterValue(next.transcript, known.transcript, 560),
      ocrText: pickBetterValue(next.ocrText, known.ocrText, 620),
      mediaCaption: pickBetterValue(next.mediaCaption, known.mediaCaption, 360),
      imageAlt: pickBetterValue(next.imageAlt, known.imageAlt, 220),
      fileName: pickBetterValue(next.fileName, known.fileName, 160),
      audioDuration: pickBetterValue(next.audioDuration, known.audioDuration, 40),
      firstSeenAt: Math.max(0, Number(known.firstSeenAt) || Number(next.firstSeenAt) || observedAt),
      lastSeenAt: Math.max(Number(known.lastSeenAt) || 0, Number(next.lastSeenAt) || 0, observedAt)
    };
  }

  function buildWhatsappStoreKey(value) {
    const token = toChatToken(value || '', 220);
    return token ? `wa-chat:${token}` : '';
  }

  function buildWhatsappStoreKeys(meta) {
    const source = meta && typeof meta === 'object' ? meta : {};
    const candidates = [source.channelId, source.chatKey, source.phone, source.title];
    const keys = candidates.map((value) => buildWhatsappStoreKey(value)).filter(Boolean);
    return compactUniqueTail(keys, 6);
  }

  function extractWhatsappChatMeta(tabContext) {
    const tab = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = tab.details && typeof tab.details === 'object' ? tab.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};

    const channelId = toSafeText(currentChat.channelId || '', 220);
    const chatKey = toSafeText(currentChat.key || currentChat.phone || currentChat.title || '', 220);
    const title = toSafeText(currentChat.title || '', 220);
    const phone = toSafeText(currentChat.phone || '', 60);
    const messages = Array.isArray(details.messages) ? details.messages : [];

    if (!channelId && !chatKey && !title && !phone) {
      return null;
    }

    const storeKeys = buildWhatsappStoreKeys({
      channelId,
      chatKey,
      title,
      phone
    });
    const storeKey = storeKeys[0] || '';

    if (!storeKey) {
      return null;
    }

    return {
      storeKey,
      storeKeys,
      channelId,
      chatKey,
      title,
      phone,
      messages
    };
  }

  function normalizeWhatsappChatRecord(rawRecord, fallbackKey = '') {
    const record = rawRecord && typeof rawRecord === 'object' ? rawRecord : {};
    const key = toSafeText(record.key || fallbackKey || '', 220);
    if (!key) {
      return null;
    }

    const rawMessages = Array.isArray(record.messages) ? record.messages : [];
    const messages = rawMessages
      .map((item) => normalizeWhatsappMessage(item))
      .filter(Boolean)
      .sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0))
      .slice(-Math.max(80, Number(maxWhatsappChatMessages) || 640));
    const knownIds = new Set(messages.map((item) => item.id));
    const orderedMessageIds = compactUniqueTail(record.orderedMessageIds || record.messageIds || [], maxWhatsappChatMessages).filter(
      (id) => knownIds.has(id)
    );

    return {
      key,
      channelId: toSafeText(record.channelId || '', 220),
      chatKey: toSafeText(record.chatKey || '', 220),
      title: toSafeText(record.title || '', 220),
      phone: toSafeText(record.phone || '', 60),
      lastMessageId: toSafeText(record.lastMessageId || '', 220),
      orderedMessageIds,
      messages,
      updatedAt: Math.max(0, Number(record.updatedAt) || 0)
    };
  }

  function orderWhatsappMessages(record, limit = 120) {
    const chat = normalizeWhatsappChatRecord(record);
    if (!chat) {
      return [];
    }

    const byId = new Map(chat.messages.map((item) => [item.id, item]));
    const ordered = [];
    const seen = new Set();

    for (const id of chat.orderedMessageIds) {
      const message = byId.get(id);
      if (!message || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ordered.push(message);
    }

    const remaining = chat.messages
      .filter((item) => item && !seen.has(item.id))
      .sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0));

    const merged = [...ordered, ...remaining];
    const safeLimit = Math.max(1, Math.min(Math.max(80, Number(maxWhatsappChatMessages) || 640), Number(limit) || 120));
    return merged.slice(-safeLimit);
  }

  function normalizeMessage(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : '';
    if (!role) {
      return null;
    }

    const content = typeof record.content === 'string' ? record.content.trim() : '';

    const id =
      typeof record.id === 'string' && record.id
        ? record.id
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const createdAt = Number(record.createdAt);
    const contextUsed = Array.isArray(record.context_used)
      ? record.context_used
      : Array.isArray(record.contextUsed)
        ? record.contextUsed
        : [];
    const extractedFacts = Array.isArray(record.extracted_facts)
      ? record.extracted_facts
      : Array.isArray(record.extractedFacts)
        ? record.extractedFacts
        : [];
    const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];
    const attachments = rawAttachments
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const id = toSafeText(source.id || `attachment-${index}`, 120);
        const name = toSafeText(source.name || source.fileName || 'archivo', 160);
        const mimeType = toSafeText(source.mimeType || source.type || 'application/octet-stream', 120).toLowerCase();
        const kindRaw = toSafeText(source.kind || '', 24).toLowerCase();
        const kind = kindRaw === 'image' || kindRaw === 'text' ? kindRaw : mimeType.startsWith('image/') ? 'image' : 'file';
        const sizeBytes = Math.max(0, Number(source.sizeBytes || source.size) || 0);
        const textExcerpt = String(source.textExcerpt || source.summary || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1400);

        if (!id || !name) {
          return null;
        }

        return {
          id,
          name,
          mimeType,
          kind,
          sizeBytes,
          textExcerpt
        };
      })
      .filter(Boolean)
      .slice(0, 12);
    const rawGeneratedImages = Array.isArray(record.generated_images)
      ? record.generated_images
      : Array.isArray(record.generatedImages)
        ? record.generatedImages
        : [];
    const generatedImages = rawGeneratedImages
      .map((item) => {
        const source = item && typeof item === 'object' ? item : {};
        const url = toSafeText(source.url || '', 1200);
        const dataUrl = normalizeImageDataUrl(source.dataUrl || source.data_url || '');
        if (!url && !dataUrl) {
          return null;
        }
        const width = Math.max(0, Number(source.width || source.imageWidth) || 0);
        const height = Math.max(0, Number(source.height || source.imageHeight) || 0);
        return {
          url,
          dataUrl,
          alt: toSafeText(source.alt || 'Generated image', 220),
          width,
          height
        };
      })
      .filter(Boolean)
      .slice(0, 4);

    if (!content && !attachments.length && !generatedImages.length) {
      return null;
    }

    return {
      id,
      role,
      content,
      tool: typeof record.tool === 'string' ? record.tool : 'chat',
      context_used: contextUsed
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 12),
      extracted_facts: extractedFacts
        .map((item) => {
          if (typeof item === 'string') {
            const text = item.trim();
            return text ? { type: 'user_fact', text } : null;
          }

          if (!item || typeof item !== 'object') {
            return null;
          }

          const type = String(item.type || 'user_fact').trim() || 'user_fact';
          const text = String(item.text || '').trim();
          if (!text) {
            return null;
          }

          return { type, text };
        })
        .filter(Boolean)
        .slice(0, 8),
      attachments,
      generated_images: generatedImages,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
    };
  }

  function hasDbStore(db, storeName) {
    return Boolean(db && db.objectStoreNames && db.objectStoreNames.contains(storeName));
  }

  function getChatDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.resolve(null);
    }

    if (!chatDbPromise) {
      chatDbPromise = new Promise((resolve) => {
        const request = indexedDB.open(chatDb.NAME, chatDb.VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(chatDb.CHAT_STORE)) {
            db.createObjectStore(chatDb.CHAT_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(chatDb.SETTINGS_STORE)) {
            db.createObjectStore(chatDb.SETTINGS_STORE, { keyPath: 'key' });
          }
          if (chatDb.WHATSAPP_STORE && !db.objectStoreNames.contains(chatDb.WHATSAPP_STORE)) {
            db.createObjectStore(chatDb.WHATSAPP_STORE, { keyPath: 'key' });
          }
          if (chatDb.SECRET_STORE && !db.objectStoreNames.contains(chatDb.SECRET_STORE)) {
            db.createObjectStore(chatDb.SECRET_STORE, { keyPath: 'key' });
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
          };
          resolve(db);
        };

        request.onerror = () => {
          resolve(null);
        };
      });
    }

    return chatDbPromise;
  }

  function getSettings() {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve({ ...defaultSettings });
        return;
      }

      chrome.storage.sync.get(defaultSettings, (items) => {
        if (chrome.runtime.lastError) {
          resolve({ ...defaultSettings });
          return;
        }

        settings = { ...defaultSettings, ...items };
        resolve({ ...settings });
      });
    });
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };

    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve(true);
        return;
      }

      chrome.storage.sync.set(patch, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  async function readChatHistory() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, chatDb.CHAT_STORE)) {
      return [];
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.CHAT_STORE, 'readonly');
      } catch {
        resolve([]);
        return;
      }

      const store = tx.objectStore(chatDb.CHAT_STORE);
      const req = store.get(chatDb.CHAT_KEY);

      req.onsuccess = () => {
        const raw = req.result && Array.isArray(req.result.messages) ? req.result.messages : [];
        const normalized = raw.map(normalizeMessage).filter(Boolean).slice(-maxChatHistoryMessages);
        resolve(normalized);
      };

      req.onerror = () => {
        resolve([]);
      };
    });
  }

  async function saveChatHistory(messages) {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, chatDb.CHAT_STORE)) {
      return false;
    }

    const payload = {
      key: chatDb.CHAT_KEY,
      messages: (Array.isArray(messages) ? messages : []).slice(-maxChatHistoryMessages),
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.CHAT_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.CHAT_STORE).put(payload);
    });
  }

  async function syncWhatsappTabContext(tabContext, options = {}) {
    const meta = extractWhatsappChatMeta(tabContext);
    if (!meta) {
      return {
        ok: false,
        synced: false,
        reason: 'missing_chat_meta',
        key: '',
        messagesUpserted: 0,
        totalMessages: 0
      };
    }

    const db = await getChatDatabase();
    const messageLimit = Math.max(
      80,
      Math.min(2000, Number(options.messageLimit) || Number(maxWhatsappChatMessages) || 640)
    );
    const incomingMessages = (Array.isArray(meta.messages) ? meta.messages : [])
      .map((item) => normalizeWhatsappMessage(item))
      .filter(Boolean)
      .slice(-messageLimit);

    if (!db || !chatDb.WHATSAPP_STORE || !hasDbStore(db, chatDb.WHATSAPP_STORE)) {
      return {
        ok: false,
        synced: false,
        reason: 'store_unavailable',
        key: meta.storeKey,
        messagesUpserted: incomingMessages.length,
        totalMessages: incomingMessages.length
      };
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.WHATSAPP_STORE, 'readwrite');
      } catch {
        resolve({
          ok: false,
          synced: false,
          reason: 'transaction_unavailable',
          key: meta.storeKey,
          messagesUpserted: incomingMessages.length,
          totalMessages: incomingMessages.length
        });
        return;
      }

      const store = tx.objectStore(chatDb.WHATSAPP_STORE);
      const req = store.get(meta.storeKey);
      let settled = false;
      let result = {
        ok: false,
        synced: false,
        reason: 'not_committed',
        key: meta.storeKey,
        messagesUpserted: 0,
        totalMessages: 0
      };

      const finish = (payload) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(payload);
      };

      req.onerror = () => {
        result = {
          ok: false,
          synced: false,
          reason: 'read_failed',
          key: meta.storeKey,
          messagesUpserted: incomingMessages.length,
          totalMessages: 0
        };
      };

      req.onsuccess = () => {
        const observedAt = Date.now();
        const existingRecord = normalizeWhatsappChatRecord(req.result, meta.storeKey) || {
          key: meta.storeKey,
          channelId: '',
          chatKey: '',
          title: '',
          phone: '',
          lastMessageId: '',
          orderedMessageIds: [],
          messages: [],
          updatedAt: 0
        };
        const byId = new Map(existingRecord.messages.map((item) => [item.id, item]));
        const orderedIncomingIds = [];

        for (const incoming of incomingMessages) {
          orderedIncomingIds.push(incoming.id);
          const merged = mergeWhatsappMessage(byId.get(incoming.id), incoming, observedAt);
          if (merged) {
            byId.set(incoming.id, merged);
          }
        }

        let mergedMessages = Array.from(byId.values())
          .filter(Boolean)
          .sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0));

        if (mergedMessages.length > messageLimit) {
          mergedMessages = mergedMessages.slice(mergedMessages.length - messageLimit);
        }

        const keepIds = new Set(mergedMessages.map((item) => item.id));
        const mergedOrderedIds = compactUniqueTail(
          [...existingRecord.orderedMessageIds, ...orderedIncomingIds],
          messageLimit
        ).filter((id) => keepIds.has(id));
        const orderedMessageIds = mergedOrderedIds.length ? mergedOrderedIds : mergedMessages.map((item) => item.id);
        const lastMessageId = orderedMessageIds.length ? orderedMessageIds[orderedMessageIds.length - 1] : '';

        const payload = {
          key: meta.storeKey,
          channelId: meta.channelId || existingRecord.channelId || '',
          chatKey: meta.chatKey || existingRecord.chatKey || '',
          title: meta.title || existingRecord.title || '',
          phone: meta.phone || existingRecord.phone || '',
          lastMessageId,
          orderedMessageIds,
          messages: mergedMessages,
          updatedAt: observedAt
        };

        try {
          store.put(payload);
          result = {
            ok: true,
            synced: true,
            reason: 'ok',
            key: meta.storeKey,
            channelId: payload.channelId,
            chatKey: payload.chatKey,
            title: payload.title,
            phone: payload.phone,
            lastMessageId: payload.lastMessageId,
            messagesUpserted: incomingMessages.length,
            totalMessages: mergedMessages.length
          };
        } catch {
          result = {
            ok: false,
            synced: false,
            reason: 'write_failed',
            key: meta.storeKey,
            channelId: payload.channelId,
            chatKey: payload.chatKey,
            title: payload.title,
            phone: payload.phone,
            lastMessageId: payload.lastMessageId,
            messagesUpserted: incomingMessages.length,
            totalMessages: mergedMessages.length
          };
          finish(result);
        }
      };

      tx.oncomplete = () => {
        finish(result);
      };
      tx.onerror = () => {
        finish({
          ...result,
          ok: false,
          synced: false,
          reason: result.reason === 'ok' ? 'transaction_failed' : result.reason || 'transaction_failed'
        });
      };
    });
  }

  async function readWhatsappChatHistory(tabContext, options = {}) {
    const meta = extractWhatsappChatMeta(tabContext);
    const emptyResult = {
      found: false,
      key: '',
      channelId: '',
      chatKey: '',
      title: '',
      phone: '',
      lastMessageId: '',
      updatedAt: 0,
      messages: []
    };

    if (!meta) {
      return emptyResult;
    }

    const db = await getChatDatabase();
    const limit = Math.max(1, Math.min(2000, Number(options.limit) || Number(maxWhatsappChatMessages) || 640));
    const keys = Array.isArray(meta.storeKeys) && meta.storeKeys.length ? meta.storeKeys : [meta.storeKey];

    if (!db || !chatDb.WHATSAPP_STORE || !hasDbStore(db, chatDb.WHATSAPP_STORE)) {
      return {
        ...emptyResult,
        key: meta.storeKey,
        channelId: meta.channelId,
        chatKey: meta.chatKey,
        title: meta.title,
        phone: meta.phone
      };
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.WHATSAPP_STORE, 'readonly');
      } catch {
        resolve({
          ...emptyResult,
          key: meta.storeKey,
          channelId: meta.channelId,
          chatKey: meta.chatKey,
          title: meta.title,
          phone: meta.phone
        });
        return;
      }

      const store = tx.objectStore(chatDb.WHATSAPP_STORE);
      let settled = false;

      const finish = (payload) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(payload);
      };

      const readAt = (index) => {
        if (index >= keys.length) {
          finish({
            ...emptyResult,
            key: meta.storeKey,
            channelId: meta.channelId,
            chatKey: meta.chatKey,
            title: meta.title,
            phone: meta.phone
          });
          return;
        }

        const key = keys[index];
        const req = store.get(key);
        req.onerror = () => {
          readAt(index + 1);
        };
        req.onsuccess = () => {
          const record = normalizeWhatsappChatRecord(req.result, key);
          if (!record) {
            readAt(index + 1);
            return;
          }

          finish({
            found: true,
            key: record.key,
            channelId: record.channelId || meta.channelId || '',
            chatKey: record.chatKey || meta.chatKey || '',
            title: record.title || meta.title || '',
            phone: record.phone || meta.phone || '',
            lastMessageId: record.lastMessageId || '',
            updatedAt: Math.max(0, Number(record.updatedAt) || 0),
            messages: orderWhatsappMessages(record, limit)
          });
        };
      };

      readAt(0);

      tx.onerror = () => {
        finish({
          ...emptyResult,
          key: meta.storeKey,
          channelId: meta.channelId,
          chatKey: meta.chatKey,
          title: meta.title,
          phone: meta.phone
        });
      };
    });
  }

  async function listWhatsappChatHistories(options = {}) {
    const db = await getChatDatabase();
    const messageLimit = Math.max(1, Math.min(2000, Number(options.messageLimit) || Number(maxWhatsappChatMessages) || 640));
    const chatLimit = Math.max(1, Math.min(500, Number(options.chatLimit) || 120));

    if (!db || !chatDb.WHATSAPP_STORE || !hasDbStore(db, chatDb.WHATSAPP_STORE)) {
      return [];
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.WHATSAPP_STORE, 'readonly');
      } catch {
        resolve([]);
        return;
      }

      const store = tx.objectStore(chatDb.WHATSAPP_STORE);
      const rows = [];
      let settled = false;

      const finish = (payload) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(payload);
      };

      let cursorRequest;
      try {
        cursorRequest = store.openCursor();
      } catch {
        finish([]);
        return;
      }

      cursorRequest.onerror = () => {
        finish([]);
      };

      cursorRequest.onsuccess = (event) => {
        const cursor = event?.target?.result;
        if (!cursor) {
          return;
        }

        const record = normalizeWhatsappChatRecord(cursor.value, String(cursor.key || ''));
        if (record) {
          rows.push(record);
        }
        cursor.continue();
      };

      tx.oncomplete = () => {
        const result = rows
          .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
          .slice(0, chatLimit)
          .map((record) => ({
            found: true,
            key: record.key,
            channelId: record.channelId || '',
            chatKey: record.chatKey || '',
            title: record.title || '',
            phone: record.phone || '',
            lastMessageId: record.lastMessageId || '',
            updatedAt: Math.max(0, Number(record.updatedAt) || 0),
            messages: orderWhatsappMessages(record, messageLimit)
          }))
          .filter((item) => Array.isArray(item.messages) && item.messages.length);

        finish(result);
      };

      tx.onerror = () => {
        finish([]);
      };
    });
  }

  async function readPanelSettings() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, chatDb.SETTINGS_STORE)) {
      panelSettingsCache = { ...panelSettingsDefaults };
      return { ...panelSettingsCache };
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SETTINGS_STORE, 'readonly');
      } catch {
        panelSettingsCache = { ...panelSettingsDefaults };
        resolve({ ...panelSettingsCache });
        return;
      }

      const store = tx.objectStore(chatDb.SETTINGS_STORE);
      const req = store.get(chatDb.SETTINGS_KEY);

      req.onsuccess = () => {
        const value = req.result && typeof req.result.value === 'object' ? req.result.value : {};
        panelSettingsCache = { ...panelSettingsDefaults, ...value };
        resolve({ ...panelSettingsCache });
      };

      req.onerror = () => {
        panelSettingsCache = { ...panelSettingsDefaults };
        resolve({ ...panelSettingsCache });
      };
    });
  }

  async function savePanelSettings(nextSettings) {
    const db = await getChatDatabase();
    panelSettingsCache = { ...panelSettingsCache, ...nextSettings };

    if (!db || !hasDbStore(db, chatDb.SETTINGS_STORE)) {
      return true;
    }

    const payload = {
      key: chatDb.SETTINGS_KEY,
      value: panelSettingsCache,
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SETTINGS_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.SETTINGS_STORE).put(payload);
    });
  }

  async function readSecret(secretKey) {
    const key = String(secretKey || '').trim();
    if (!key) {
      return null;
    }

    const db = await getChatDatabase();
    if (!db || !chatDb.SECRET_STORE || !hasDbStore(db, chatDb.SECRET_STORE)) {
      return null;
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SECRET_STORE, 'readonly');
      } catch {
        resolve(null);
        return;
      }

      const req = tx.objectStore(chatDb.SECRET_STORE).get(key);

      req.onsuccess = () => {
        const value = req.result && typeof req.result.value === 'object' ? req.result.value : null;
        resolve(value ? { ...value } : null);
      };

      req.onerror = () => {
        resolve(null);
      };
    });
  }

  async function saveSecret(secretKey, value) {
    const key = String(secretKey || '').trim();
    if (!key) {
      return false;
    }

    const db = await getChatDatabase();
    if (!db || !chatDb.SECRET_STORE || !hasDbStore(db, chatDb.SECRET_STORE)) {
      return false;
    }

    const payload = {
      key,
      value: value && typeof value === 'object' ? { ...value } : {},
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SECRET_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.SECRET_STORE).put(payload);
    });
  }

  async function deleteSecret(secretKey) {
    const key = String(secretKey || '').trim();
    if (!key) {
      return false;
    }

    const db = await getChatDatabase();
    if (!db || !chatDb.SECRET_STORE || !hasDbStore(db, chatDb.SECRET_STORE)) {
      return false;
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(chatDb.SECRET_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(chatDb.SECRET_STORE).delete(key);
    });
  }

  return {
    getSettings,
    saveSettings,
    readChatHistory,
    saveChatHistory,
    syncWhatsappTabContext,
    readWhatsappChatHistory,
    listWhatsappChatHistories,
    readPanelSettings,
    savePanelSettings,
    readSecret,
    saveSecret,
    deleteSecret
  };
}
