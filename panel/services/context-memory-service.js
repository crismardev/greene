import {
  create,
  load,
  save,
  searchVector,
  upsert
} from '../../node_modules/@orama/orama/dist/browser/index.js';

const VECTOR_SIZE = 384;
const WORKER_PATH = 'panel/workers/embedding-worker.js';
const MODEL_SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_TOP_K = 5;
const IDENTITY_STORAGE_KEY = 'greenstudio_identity_profile';
const IDB_NAME = 'greenstudio-context-vector-db';
const IDB_VERSION = 1;
const IDB_STORE = 'vector_store';
const IDB_KEY = 'orama_state_v1';
const EMBEDDING_WARMUP_TEXT = 'greenstudio bootstrap warmup';
const WHATSAPP_MESSAGE_DOC_LIMIT = 28;
const WHATSAPP_CONTACT_DOC_LIMIT = 36;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function toSafeText(value, limit = 2000) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, limit);
}

function normalizeArray(values, limit = 8) {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = [];
  for (const item of values) {
    const token = toSafeText(item, 120);
    if (!token) {
      continue;
    }

    if (!unique.includes(token)) {
      unique.push(token);
    }

    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function hashText(value) {
  const text = String(value || '');
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function buildFallbackVector(text) {
  const safe = toSafeText(text, 4096);
  const values = new Array(VECTOR_SIZE).fill(0);

  if (!safe) {
    return values;
  }

  for (let index = 0; index < safe.length; index += 1) {
    const code = safe.charCodeAt(index);
    const bucket = index % VECTOR_SIZE;
    values[bucket] += ((code % 131) + 1) / 131;
  }

  let norm = 0;
  for (const value of values) {
    norm += value * value;
  }

  if (!norm) {
    return values;
  }

  const scale = 1 / Math.sqrt(norm);
  return values.map((value) => Number((value * scale).toFixed(8)));
}

function normalizeVector(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value.length === 'number'
      ? Array.from(value)
      : [];

  if (!source.length) {
    return null;
  }

  const vector = source.slice(0, VECTOR_SIZE);
  while (vector.length < VECTOR_SIZE) {
    vector.push(0);
  }

  let norm = 0;
  for (const item of vector) {
    norm += item * item;
  }

  if (!norm) {
    return vector;
  }

  const scale = 1 / Math.sqrt(norm);
  return vector.map((item) => Number((item * scale).toFixed(8)));
}

function extractEntities(text, url = '', limit = 10) {
  const fromText = String(text || '');
  const candidates = fromText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];

  try {
    const parsed = new URL(url);
    const hostToken = parsed.hostname.replace(/^www\./i, '').split('.').filter(Boolean)[0] || '';
    if (hostToken) {
      candidates.unshift(hostToken);
    }
  } catch (_) {
    // Ignore invalid URLs.
  }

  return normalizeArray(candidates, limit);
}

function detectCategory(text, url, site) {
  const haystack = `${String(text || '')} ${String(url || '')} ${String(site || '')}`.toLowerCase();

  if (haystack.includes('whatsapp')) {
    return 'messaging';
  }
  if (haystack.includes('github') || haystack.includes('gitlab') || haystack.includes('stack overflow')) {
    return 'development';
  }
  if (haystack.includes('notion') || haystack.includes('docs') || haystack.includes('documentation')) {
    return 'documentation';
  }
  if (haystack.includes('calendar') || haystack.includes('meeting') || haystack.includes('reunion')) {
    return 'meetings';
  }
  if (haystack.includes('youtube') || haystack.includes('tweet') || haystack.includes('x.com')) {
    return 'social';
  }

  return String(site || 'general').toLowerCase() || 'general';
}

function normalizeWhatsappMessages(rawMessages, limit = WHATSAPP_MESSAGE_DOC_LIMIT) {
  const source = Array.isArray(rawMessages) ? rawMessages : [];
  const safeLimit = Math.max(1, Math.min(120, Number(limit) || WHATSAPP_MESSAGE_DOC_LIMIT));
  const trimmed = source.slice(-safeLimit);

  return trimmed
    .map((item, index) => {
      const role = item?.role === 'me' ? 'me' : 'contact';
      const text = toSafeText(item?.text || '', 820);
      const id = toSafeText(item?.id || `row-${index}`, 220);
      if (!text || !id) {
        return null;
      }

      return {
        id,
        role,
        text,
        timestampLabel: toSafeText(item?.timestamp || '', 80)
      };
    })
    .filter(Boolean);
}

function buildWhatsappDocs(tabContext) {
  const tab = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const site = String(tab.site || '').toLowerCase();
  if (site !== 'whatsapp') {
    return [];
  }

  const details = tab.details && typeof tab.details === 'object' ? tab.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
  const sync = details.sync && typeof details.sync === 'object' ? details.sync : {};
  const channelId = toSafeText(currentChat.channelId || currentChat.key || currentChat.phone || currentChat.title || '', 220);
  const chatKey = toSafeText(currentChat.key || '', 220) || channelId;
  const chatTitle = toSafeText(currentChat.title || '', 200);
  const chatPhone = toSafeText(currentChat.phone || '', 80);
  const messages = normalizeWhatsappMessages(details.messages || [], WHATSAPP_MESSAGE_DOC_LIMIT);
  const inbox = Array.isArray(details.inbox) ? details.inbox.slice(0, WHATSAPP_CONTACT_DOC_LIMIT) : [];
  const updatedAt = Number(tab.updatedAt) || Date.now();
  const url = toSafeText(tab.url || '', 900);
  const docs = [];

  if (chatKey) {
    const lastMessage = messages.length ? messages[messages.length - 1] : null;
    const summary = [
      'WhatsApp chat activo.',
      `Canal: ${channelId || chatKey}`,
      chatTitle ? `Contacto: ${chatTitle}` : '',
      chatPhone ? `Telefono: ${chatPhone}` : '',
      lastMessage ? `Ultimo mensaje (${lastMessage.role === 'me' ? 'yo' : 'contacto'}): ${lastMessage.text}` : '',
      sync?.lastVisibleMessageId ? `Ultimo Message ID visible: ${toSafeText(sync.lastVisibleMessageId, 220)}` : '',
      typeof sync?.missingMessageCount === 'number' ? `Mensajes sin sincronizar: ${Math.max(0, sync.missingMessageCount)}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    docs.push({
      id: `wa-chat:${hashText(channelId || chatKey)}`,
      text: summary,
      source: 'whatsapp',
      category: 'messaging',
      topic: 'wa_chat_active',
      tag: 'wa_chat',
      url,
      site: 'whatsapp',
      author: chatTitle || chatPhone || 'contact',
      timestamp: updatedAt,
      durationMs: 0,
      importanceScore: 0.72,
      entities: normalizeArray([chatTitle, chatPhone, channelId, chatKey], 10),
      metadata: {
        url,
        source: 'whatsapp',
        category: 'messaging',
        importance_score: 0.72,
        entities: normalizeArray([chatTitle, chatPhone, channelId, chatKey], 10)
      }
    });
  }

  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    const messageText = [
      'WhatsApp mensaje.',
      channelId ? `Canal: ${channelId}` : '',
      chatTitle ? `Chat: ${chatTitle}` : '',
      chatPhone ? `Telefono: ${chatPhone}` : '',
      item.timestampLabel ? `Hora UI: ${item.timestampLabel}` : '',
      `${item.role === 'me' ? 'Yo' : 'Contacto'}: ${item.text}`,
      `Message ID: ${item.id}`
    ]
      .filter(Boolean)
      .join('\n');
    const docFingerprint = `${channelId || chatKey}|${item.id}|${index}`;
    const importanceScore = item.role === 'me' ? 0.5 : 0.62;

    docs.push({
      id: `wa-msg:${hashText(docFingerprint)}`,
      text: messageText,
      source: 'whatsapp',
      category: 'messaging',
      topic: 'wa_message',
      tag: 'wa_message',
      url,
      site: 'whatsapp',
      author: item.role === 'me' ? 'me' : chatTitle || 'contact',
      timestamp: updatedAt + index,
      durationMs: 0,
      importanceScore,
      entities: normalizeArray([chatTitle, chatPhone, item.id, item.text], 10),
      metadata: {
        url,
        source: 'whatsapp',
        category: 'messaging',
        importance_score: importanceScore,
        entities: normalizeArray([chatTitle, chatPhone, item.id, item.text], 10)
      }
    });
  }

  for (let index = 0; index < inbox.length; index += 1) {
    const item = inbox[index] && typeof inbox[index] === 'object' ? inbox[index] : {};
    const title = toSafeText(item.title || '', 200);
    const phone = toSafeText(item.phone || '', 80);
    const preview = toSafeText(item.preview || '', 260);
    if (!title && !phone) {
      continue;
    }

    const contactKey = phone || title;
    const contactText = [
      'WhatsApp contacto en inbox.',
      channelId ? `Canal activo: ${channelId}` : '',
      `Contacto: ${title || phone}`,
      phone ? `Telefono: ${phone}` : '',
      preview ? `Ultimo preview: ${preview}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    docs.push({
      id: `wa-contact:${hashText(contactKey)}`,
      text: contactText,
      source: 'whatsapp',
      category: 'messaging',
      topic: 'wa_contact',
      tag: 'wa_contact',
      url,
      site: 'whatsapp',
      author: title || 'contact',
      timestamp: updatedAt + index,
      durationMs: 0,
      importanceScore: 0.58,
      entities: normalizeArray([title, phone, preview], 8),
      metadata: {
        url,
        source: 'whatsapp',
        category: 'messaging',
        importance_score: 0.58,
        entities: normalizeArray([title, phone, preview], 8)
      }
    });
  }

  return docs;
}

function openPersistenceDb() {
  if (!('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'key' });
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

class EmbeddingWorkerClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
    this.enabled = typeof Worker === 'function';
  }

  ensureWorker() {
    if (!this.enabled || this.worker) {
      return;
    }

    const workerUrl =
      typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function'
        ? chrome.runtime.getURL(WORKER_PATH)
        : '../workers/embedding-worker.js';

    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.addEventListener('message', (event) => {
      const payload = event?.data && typeof event.data === 'object' ? event.data : {};
      const ticket = this.pending.get(payload.id);
      if (!ticket) {
        return;
      }

      this.pending.delete(payload.id);
      if (payload.ok) {
        ticket.resolve(payload);
      } else {
        ticket.reject(new Error(payload.error || 'Embedding worker error.'));
      }
    });

    this.worker.addEventListener('error', () => {
      for (const ticket of this.pending.values()) {
        ticket.reject(new Error('Embedding worker crashed.'));
      }
      this.pending.clear();
      this.worker = null;
    });
  }

  request(type, payload = {}) {
    this.ensureWorker();
    if (!this.worker) {
      return Promise.reject(new Error('Worker unavailable.'));
    }

    this.sequence += 1;
    const id = `job-${Date.now()}-${this.sequence}`;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        id,
        type,
        ...payload
      });
    });
  }

  async embedText(text) {
    const safe = toSafeText(text, 4096);
    if (!safe) {
      return buildFallbackVector('');
    }

    if (!this.enabled) {
      return buildFallbackVector(safe);
    }

    try {
      const response = await this.request('embed', { text: safe });
      return normalizeVector(response.vector) || buildFallbackVector(safe);
    } catch (_) {
      return buildFallbackVector(safe);
    }
  }

  async embedMany(texts) {
    const list = Array.isArray(texts) ? texts.map((item) => toSafeText(item, 4096)) : [];
    if (!list.length) {
      return [];
    }

    if (!this.enabled) {
      return list.map((item) => buildFallbackVector(item));
    }

    try {
      const response = await this.request('embed_many', { texts: list });
      return (Array.isArray(response.vectors) ? response.vectors : []).map((vector, index) => {
        const normalized = normalizeVector(vector);
        return normalized || buildFallbackVector(list[index]);
      });
    } catch (_) {
      return list.map((item) => buildFallbackVector(item));
    }
  }

  shutdown() {
    if (!this.worker) {
      return;
    }

    this.worker.terminate();
    this.worker = null;

    for (const ticket of this.pending.values()) {
      ticket.reject(new Error('Embedding worker was terminated.'));
    }
    this.pending.clear();
  }
}

function readChromeLocal(defaultValue) {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.local) {
      resolve(defaultValue);
      return;
    }

    chrome.storage.local.get(defaultValue, (items) => {
      if (chrome.runtime.lastError) {
        resolve(defaultValue);
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

function buildIdentityDefaults() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const hardware = Number.isFinite(navigator.hardwareConcurrency) ? `${navigator.hardwareConcurrency} cores` : 'n/a';
  const memory = Number.isFinite(navigator.deviceMemory) ? `${navigator.deviceMemory}GB RAM` : 'RAM n/a';
  const os = String(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || 'unknown');

  return {
    user_name: '',
    machine_specs: `${hardware}, ${memory}`,
    os: toSafeText(os, 80),
    current_timezone: toSafeText(timezone, 80)
  };
}

function buildContextPromptLines(results) {
  if (!Array.isArray(results) || !results.length) {
    return 'Sin contexto local relevante para esta consulta.';
  }

  return results
    .map((item, index) => {
      const document = item?.document && typeof item.document === 'object' ? item.document : {};
      const text = toSafeText(document.text || '', 260);
      const url = toSafeText(document.url || document.metadata?.url || '', 220);
      const source = toSafeText(document.source || document.metadata?.source || '', 40);
      const score = Number(item?.score || 0).toFixed(3);
      const label = `${index + 1}. [${source || 'unknown'} | sim:${score}]`;
      const descriptor = `${text}${url ? ` (URL: ${url})` : ''}`.trim();
      return `${label} ${descriptor}`.trim();
    })
    .join('\n');
}

export function createContextMemoryService() {
  const embeddingClient = new EmbeddingWorkerClient();
  let db = null;
  let idb = null;
  let initPromise = null;
  let persistTimer = 0;
  const lastContentHashById = new Map();

  async function ensureDb() {
    if (db) {
      return db;
    }

    if (!initPromise) {
      initPromise = (async () => {
        db = await create({
          schema: {
            id: 'string',
            text: 'string',
            embedding: 'vector[384]',
            source: 'string',
            category: 'string',
            tag: 'string',
            topic: 'string',
            url: 'string',
            site: 'string',
            author: 'string',
            timestamp: 'number',
            durationMs: 'number',
            importanceScore: 'number',
            entities: 'string[]',
            metadata: {
              url: 'string',
              source: 'string',
              category: 'string',
              importance_score: 'number',
              entities: 'string[]'
            }
          }
        });

        idb = await openPersistenceDb();
        if (!idb) {
          return db;
        }

        await new Promise((resolve) => {
          let tx;
          try {
            tx = idb.transaction(IDB_STORE, 'readonly');
          } catch (_) {
            resolve();
            return;
          }

          const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
          req.onsuccess = () => {
            const raw = req.result && typeof req.result.raw === 'object' ? req.result.raw : null;
            if (raw) {
              try {
                load(db, raw);
              } catch (_) {
                // Ignore corrupted snapshots.
              }
            }
            resolve();
          };
          req.onerror = () => resolve();
        });

        return db;
      })();
    }

    return initPromise;
  }

  async function persistNow() {
    if (!db || !idb) {
      return false;
    }

    const raw = save(db);

    return new Promise((resolve) => {
      let tx;
      try {
        tx = idb.transaction(IDB_STORE, 'readwrite');
      } catch (_) {
        resolve(false);
        return;
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(IDB_STORE).put({
        key: IDB_KEY,
        raw,
        updatedAt: Date.now()
      });
    });
  }

  function schedulePersist() {
    if (persistTimer) {
      return;
    }

    persistTimer = window.setTimeout(async () => {
      persistTimer = 0;
      await persistNow();
    }, 280);
  }

  async function upsertDocument(doc) {
    const text = toSafeText(doc?.text || '', 4200);
    if (!text) {
      return null;
    }

    const entities = normalizeArray(doc?.entities || doc?.metadata?.entities || [], 12);
    const importanceScore = clamp(Number(doc?.importanceScore || doc?.metadata?.importance_score || 0), 0, 1);
    const timestamp = Number(doc?.timestamp) || Date.now();
    const durationMs = Math.max(0, Number(doc?.durationMs) || 0);
    const source = toSafeText(doc?.source || doc?.metadata?.source || 'browser', 40).toLowerCase() || 'browser';
    const category = toSafeText(doc?.category || doc?.metadata?.category || 'general', 80).toLowerCase() || 'general';
    const url = toSafeText(doc?.url || doc?.metadata?.url || '', 900);
    const id = toSafeText(doc?.id || `${source}:${hashText(`${url}|${category}|${text.slice(0, 480)}`)}`, 180);
    const topic = toSafeText(doc?.topic || category, 80);
    const tag = toSafeText(doc?.tag || '', 80);
    const site = toSafeText(doc?.site || '', 80);
    const author = toSafeText(doc?.author || '', 160);
    const contentHash = hashText(`${text}|${source}|${category}|${url}|${site}|${author}`);

    if (lastContentHashById.get(id) === contentHash) {
      return id;
    }

    const store = await ensureDb();
    const embedding = await embeddingClient.embedText(text);

    await upsert(store, {
      id,
      text,
      embedding,
      source,
      category,
      tag,
      topic,
      url,
      site,
      author,
      timestamp,
      durationMs,
      importanceScore,
      entities,
      metadata: {
        url,
        source,
        category,
        importance_score: importanceScore,
        entities
      }
    });

    lastContentHashById.set(id, contentHash);
    if (lastContentHashById.size > 800) {
      const oldestKey = lastContentHashById.keys().next().value;
      if (oldestKey) {
        lastContentHashById.delete(oldestKey);
      }
    }

    schedulePersist();
    return id;
  }

  function buildNavigationDoc(tabContext) {
    const tab = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = tab.details && typeof tab.details === 'object' ? tab.details : {};
    const temporal = details.temporal && typeof details.temporal === 'object' ? details.temporal : {};

    const url = toSafeText(tab.url || '', 900);
    const title = toSafeText(tab.title || '', 240);
    const description = toSafeText(tab.description || '', 420);
    const excerpt = toSafeText(tab.textExcerpt || '', 2800);
    const text = [title, description, excerpt].filter(Boolean).join('\n\n');
    if (!text) {
      return null;
    }

    const source = String(tab.site || '').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'browser';
    const category = detectCategory(text, url, tab.site || source);
    const entities = normalizeArray(details.entities, 12);
    const extractedEntities = entities.length ? entities : extractEntities(text, url, 12);
    const dwellTimeMs = Number(temporal.activeDurationMs || temporal.dwellTimeMs || 0);
    const importanceScore = clamp(Number(details.importanceScore) || Math.min(1, dwellTimeMs / 180000), 0, 1);
    const updatedAt = Number(tab.updatedAt) || Date.now();
    const fingerprint = `${url}|${title}|${excerpt.slice(0, 620)}`;

    return {
      id: `nav:${hashText(fingerprint)}`,
      text,
      source,
      category,
      topic: category,
      tag: 'navigation',
      url,
      site: toSafeText(tab.site || '', 40),
      author: toSafeText(details.author || '', 140),
      timestamp: updatedAt,
      durationMs: Math.max(0, dwellTimeMs),
      importanceScore,
      entities: extractedEntities,
      metadata: {
        url,
        source,
        category,
        importance_score: importanceScore,
        entities: extractedEntities
      }
    };
  }

  function buildHistoryDoc(entry) {
    const item = entry && typeof entry === 'object' ? entry : {};
    const url = toSafeText(item.url || '', 900);
    if (!url) {
      return null;
    }

    const title = toSafeText(item.title || '', 240);
    const visits = Math.max(0, Number(item.visitCount) || 0);
    const typed = Math.max(0, Number(item.typedCount) || 0);
    const text = `Historial de navegacion: ${title || url}\nURL: ${url}\nVisitas: ${visits}\nTyped: ${typed}`;
    const category = detectCategory(text, url, 'history');
    const importanceScore = clamp(Math.min(1, visits / 20 + typed / 10), 0, 1);
    const entities = extractEntities(title || url, url, 8);

    return {
      id: `history:${hashText(url)}`,
      text,
      source: 'browser',
      category,
      topic: category,
      tag: 'history',
      url,
      site: 'history',
      author: '',
      timestamp: Number(item.lastVisitTime) || Date.now(),
      durationMs: 0,
      importanceScore,
      entities,
      metadata: {
        url,
        source: 'browser',
        category,
        importance_score: importanceScore,
        entities
      }
    };
  }

  function normalizeExtractedFacts(rawFacts, limit = 12) {
    if (!Array.isArray(rawFacts)) {
      return [];
    }

    const compact = [];
    const seen = new Set();

    for (const item of rawFacts) {
      let type = 'user_fact';
      let text = '';

      if (typeof item === 'string') {
        text = toSafeText(item, 320);
      } else if (item && typeof item === 'object') {
        type = toSafeText(item.type || 'user_fact', 40).toLowerCase() || 'user_fact';
        text = toSafeText(item.text || '', 320);
      }

      if (!text) {
        continue;
      }

      const key = `${type}:${text}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      compact.push({ type, text });
      if (compact.length >= limit) {
        break;
      }
    }

    return compact;
  }

  function buildChatHistoryDoc(record, index = 0) {
    const item = record && typeof record === 'object' ? record : {};
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    const content = toSafeText(item.content || '', 3200);
    if (!content) {
      return null;
    }

    const createdAt = Number(item.createdAt) || Date.now();
    const contextUsed = normalizeArray(item.context_used || item.contextUsed || [], 12);
    const extractedFacts = normalizeExtractedFacts(item.extracted_facts || item.extractedFacts || [], 10);
    const contextLine = contextUsed.length ? `Context IDs: ${contextUsed.join(', ')}` : '';
    const factsLine = extractedFacts.length ? `Facts: ${extractedFacts.map((fact) => fact.text).join(' | ')}` : '';
    const text = [
      `Historial de chat (${role}):`,
      content,
      contextLine,
      factsLine
    ]
      .filter(Boolean)
      .join('\n');
    const baseId = toSafeText(item.id || '', 180) || hashText(`${role}|${content}|${createdAt}|${index}`);
    const sourceTool = toSafeText(item.tool || 'chat', 40).toLowerCase() || 'chat';

    return {
      id: `chat-history:${baseId}`,
      text,
      source: 'chat',
      category: 'conversation',
      topic: sourceTool,
      tag: 'chat_history',
      url: '',
      site: 'chat',
      author: role,
      timestamp: createdAt,
      durationMs: 0,
      importanceScore: role === 'user' ? 0.55 : 0.45,
      entities: extractEntities(content, '', 8),
      metadata: {
        url: '',
        source: 'chat',
        category: 'conversation',
        importance_score: role === 'user' ? 0.55 : 0.45,
        entities: extractEntities(content, '', 8)
      }
    };
  }

  function buildFactDoc(fact, originId = '', index = 0) {
    const normalized = fact && typeof fact === 'object' ? fact : {};
    const type = toSafeText(normalized.type || 'user_fact', 40).toLowerCase() || 'user_fact';
    const text = toSafeText(normalized.text || '', 360);
    if (!text) {
      return null;
    }

    const fingerprint = `${originId}|${type}|${text}|${index}`;
    return {
      id: `fact-history:${hashText(fingerprint)}`,
      text,
      source: 'chat',
      category: 'user_fact',
      topic: type,
      tag: 'chat_fact',
      url: '',
      site: 'chat',
      author: 'user',
      timestamp: Date.now(),
      durationMs: 0,
      importanceScore: 0.88,
      entities: extractEntities(text, '', 6),
      metadata: {
        url: '',
        source: 'chat',
        category: 'user_fact',
        importance_score: 0.88,
        entities: extractEntities(text, '', 6)
      }
    };
  }

  function buildUserProfileDoc(identity, profilePatch = {}) {
    const baseIdentity = identity && typeof identity === 'object' ? identity : {};
    const patch = profilePatch && typeof profilePatch === 'object' ? profilePatch : {};
    const userName = toSafeText(
      patch.user_name || patch.userName || patch.displayName || baseIdentity.user_name || '',
      80
    );
    const machine = toSafeText(patch.machine_specs || patch.machineSpecs || baseIdentity.machine_specs || '', 120);
    const os = toSafeText(patch.os || baseIdentity.os || '', 80);
    const timezone = toSafeText(patch.current_timezone || patch.timezone || baseIdentity.current_timezone || '', 80);
    const language = toSafeText(patch.language || '', 40);
    const birthday = toSafeText(patch.birthday || '', 40);
    const tags = normalizeArray(patch.tags || patch.interests || [], 10);
    const profileLines = [
      'Perfil del usuario local.',
      userName ? `Nombre: ${userName}` : '',
      birthday ? `Cumpleanos: ${birthday}` : '',
      language ? `Idioma preferido: ${language}` : '',
      machine ? `Machine specs: ${machine}` : '',
      os ? `Sistema operativo: ${os}` : '',
      timezone ? `Zona horaria: ${timezone}` : '',
      tags.length ? `Intereses: ${tags.join(', ')}` : ''
    ].filter(Boolean);
    const text = profileLines.join('\n');
    if (!text) {
      return null;
    }

    const entities = normalizeArray([userName, language, timezone, ...tags], 10);
    return {
      id: 'profile:user',
      text,
      source: 'profile',
      category: 'identity',
      topic: 'user_profile',
      tag: 'profile',
      url: '',
      site: 'profile',
      author: 'user',
      timestamp: Date.now(),
      durationMs: 0,
      importanceScore: 0.95,
      entities,
      metadata: {
        url: '',
        source: 'profile',
        category: 'identity',
        importance_score: 0.95,
        entities
      }
    };
  }

  function extractInsights(userMessage, aiResponse = '') {
    const text = `${String(userMessage || '').trim()}\n${String(aiResponse || '').trim()}`.trim();
    if (!text) {
      return [];
    }

    const facts = [];
    const lines = text.split(/\n+/).map((item) => item.trim()).filter(Boolean);

    for (const line of lines) {
      let matched = false;

      const remember = line.match(/(?:recu[eé]rdame(?:\s+que)?|remember(?:\s+that)?)[\s,:-]+(.+)/i);
      if (remember && remember[1]) {
        facts.push({
          type: 'memory',
          text: toSafeText(remember[1], 260)
        });
        continue;
      }

      const mainClient = line.match(/(?:mi cliente principal es|my main client is)\s+(.+)/i);
      if (mainClient && mainClient[1]) {
        facts.push({
          type: 'client',
          text: `Cliente principal: ${toSafeText(mainClient[1], 220)}`
        });
        continue;
      }

      const activeProject = line.match(/(?:estoy trabajando en(?: el)? proyecto|i am working on(?: project)?)\s+(.+)/i);
      if (activeProject && activeProject[1]) {
        facts.push({
          type: 'project',
          text: `Proyecto activo: ${toSafeText(activeProject[1], 220)}`
        });
        continue;
      }

      for (const token of ['odio', 'i hate', 'prefiero', 'i prefer', 'me gusta', 'i like']) {
        if (!line.toLowerCase().includes(token)) {
          continue;
        }

        matched = true;
        facts.push({
          type: 'preference',
          text: toSafeText(line, 260)
        });
        break;
      }

      if (!matched && /^mi /i.test(line)) {
        facts.push({
          type: 'user_fact',
          text: toSafeText(line, 240)
        });
      }
    }

    const seen = new Set();
    const compact = [];

    for (const fact of facts) {
      const key = `${fact.type}:${fact.text}`.toLowerCase();
      if (!fact.text || seen.has(key)) {
        continue;
      }
      seen.add(key);
      compact.push(fact);
      if (compact.length >= 8) {
        break;
      }
    }

    return compact;
  }

  async function queryLocalContext(query, options = {}) {
    const safeQuery = toSafeText(query, 2400);
    if (!safeQuery) {
      return [];
    }

    const similarity = clamp(Number(options.similarity), 0, 1) || MODEL_SIMILARITY_THRESHOLD;
    const topK = Math.max(1, Math.min(12, Number(options.limit) || DEFAULT_TOP_K));
    const startTime = Math.max(0, Number(options.startTime || options.from || 0) || 0);
    const rawEndTime = Number(options.endTime || options.to || 0);
    const endTime = Number.isFinite(rawEndTime) && rawEndTime > 0 ? rawEndTime : Number.MAX_SAFE_INTEGER;
    const sourceFilterInput = Array.isArray(options.sources)
      ? options.sources
      : options.source
        ? [options.source]
        : [];
    const sourceFilter = normalizeArray(sourceFilterInput, 6).map((item) => item.toLowerCase());
    const vector = await embeddingClient.embedText(safeQuery);
    const store = await ensureDb();

    const result = await searchVector(store, {
      mode: 'vector',
      vector: {
        value: vector,
        property: 'embedding'
      },
      similarity,
      limit: topK,
      includeVectors: false
    });

    const hits = Array.isArray(result?.hits) ? result.hits : [];
    return hits.filter((item) => {
      const score = Number(item.score || 0);
      if (score < similarity) {
        return false;
      }

      const document = item?.document && typeof item.document === 'object' ? item.document : {};
      const timestamp = Math.max(0, Number(document.timestamp) || 0);
      if (timestamp && (timestamp < startTime || timestamp > endTime)) {
        return false;
      }

      if (sourceFilter.length) {
        const source = toSafeText(document.source || '', 40).toLowerCase();
        if (!sourceFilter.includes(source)) {
          return false;
        }
      }

      return true;
    });
  }

  async function readIdentityProfile() {
    const defaults = buildIdentityDefaults();
    const payload = await readChromeLocal({
      [IDENTITY_STORAGE_KEY]: defaults,
      user_name: defaults.user_name,
      machine_specs: defaults.machine_specs,
      os: defaults.os,
      current_timezone: defaults.current_timezone
    });
    const stored = payload && payload[IDENTITY_STORAGE_KEY] && typeof payload[IDENTITY_STORAGE_KEY] === 'object'
      ? payload[IDENTITY_STORAGE_KEY]
      : defaults;
    const merged = {
      ...defaults,
      user_name: toSafeText(payload?.user_name || stored.user_name || defaults.user_name, 80),
      machine_specs: toSafeText(payload?.machine_specs || stored.machine_specs || defaults.machine_specs, 120),
      os: toSafeText(payload?.os || stored.os || defaults.os, 80),
      current_timezone: toSafeText(
        payload?.current_timezone || stored.current_timezone || defaults.current_timezone,
        80
      )
    };

    return {
      user_name: merged.user_name,
      machine_specs: merged.machine_specs,
      os: merged.os,
      current_timezone: merged.current_timezone
    };
  }

  async function syncIdentityProfile(patch = {}) {
    const current = await readIdentityProfile();
    const next = {
      ...current,
      user_name: toSafeText(patch.user_name || patch.userName || patch.displayName || current.user_name, 80),
      machine_specs: toSafeText(patch.machine_specs || patch.machineSpecs || current.machine_specs, 120),
      os: toSafeText(patch.os || current.os, 80),
      current_timezone: toSafeText(patch.current_timezone || patch.timezone || current.current_timezone, 80)
    };

    await writeChromeLocal({
      [IDENTITY_STORAGE_KEY]: next,
      user_name: next.user_name,
      machine_specs: next.machine_specs,
      os: next.os,
      current_timezone: next.current_timezone
    });

    return next;
  }

  async function buildDynamicIdentityHeader(query, identityPatch = {}) {
    const identity = await syncIdentityProfile(identityPatch);
    const contextHits = await queryLocalContext(query, {
      similarity: MODEL_SIMILARITY_THRESHOLD,
      limit: DEFAULT_TOP_K
    });

    const contextSummary = buildContextPromptLines(contextHits);
    const header = [
      'Actua como un asistente personal.',
      `Datos del usuario actual: Nombre: ${identity.user_name || 'N/A'}, Maquina: ${identity.os || 'N/A'}, Ubicacion: ${identity.current_timezone || 'N/A'}.`,
      `Especificaciones locales: ${identity.machine_specs || 'N/A'}.`,
      `Contexto de navegacion reciente: ${contextSummary}`
    ].join('\n');

    return {
      header,
      identity,
      contextHits
    };
  }

  async function ingestTabContext(tabContext) {
    const docs = [];
    const navigationDoc = buildNavigationDoc(tabContext);
    if (navigationDoc) {
      docs.push(navigationDoc);
    }

    const whatsappDocs = buildWhatsappDocs(tabContext);
    if (whatsappDocs.length) {
      docs.push(...whatsappDocs);
    }

    if (!docs.length) {
      return null;
    }

    const insertedIds = [];
    for (const doc of docs) {
      const id = await upsertDocument(doc);
      if (id) {
        insertedIds.push(id);
      }
    }

    if (!insertedIds.length) {
      return null;
    }

    return insertedIds.length === 1 ? insertedIds[0] : insertedIds;
  }

  async function ingestHistoryEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      return [];
    }

    const inserted = [];
    for (const item of list) {
      const doc = buildHistoryDoc(item);
      if (!doc) {
        continue;
      }

      const id = await upsertDocument(doc);
      if (id) {
        inserted.push(id);
      }
    }

    return inserted;
  }

  async function ingestChatHistory(messages, options = {}) {
    const list = Array.isArray(messages) ? messages : [];
    if (!list.length) {
      return {
        ingestedMessages: 0,
        ingestedFacts: 0,
        ids: []
      };
    }

    const limit = Math.max(1, Math.min(320, Number(options.limit) || 140));
    const trimmed = list.slice(-limit);
    const ids = [];
    let ingestedFacts = 0;

    for (let index = 0; index < trimmed.length; index += 1) {
      const record = trimmed[index];
      const chatDoc = buildChatHistoryDoc(record, index);
      if (!chatDoc) {
        continue;
      }

      const chatId = await upsertDocument(chatDoc);
      if (!chatId) {
        continue;
      }

      ids.push(chatId);

      const rawFacts = normalizeExtractedFacts(record?.extracted_facts || record?.extractedFacts || [], 10);
      for (let factIndex = 0; factIndex < rawFacts.length; factIndex += 1) {
        const factDoc = buildFactDoc(rawFacts[factIndex], chatId, factIndex);
        if (!factDoc) {
          continue;
        }

        const factId = await upsertDocument(factDoc);
        if (factId) {
          ingestedFacts += 1;
        }
      }
    }

    return {
      ingestedMessages: ids.length,
      ingestedFacts,
      ids
    };
  }

  async function ingestUserProfile(profile = {}) {
    const identity = await syncIdentityProfile(profile);
    const doc = buildUserProfileDoc(identity, profile);
    if (!doc) {
      return null;
    }

    return upsertDocument(doc);
  }

  async function rememberChatTurn({ userMessage, assistantMessage, contextUsed = [] }) {
    const userText = toSafeText(userMessage || '', 2400);
    const aiText = toSafeText(assistantMessage || '', 3200);

    const turnIds = [];

    if (userText) {
      const userId = await upsertDocument({
        id: `chat-user:${Date.now()}:${hashText(userText.slice(0, 300))}`,
        text: userText,
        source: 'chat',
        category: 'conversation',
        topic: 'conversation',
        tag: 'chat_turn',
        url: '',
        site: 'chat',
        author: 'user',
        timestamp: Date.now(),
        durationMs: 0,
        importanceScore: 0.4,
        entities: extractEntities(userText, '', 6),
        metadata: {
          url: '',
          source: 'chat',
          category: 'conversation',
          importance_score: 0.4,
          entities: extractEntities(userText, '', 6)
        }
      });

      if (userId) {
        turnIds.push(userId);
      }
    }

    if (aiText) {
      const aiId = await upsertDocument({
        id: `chat-assistant:${Date.now()}:${hashText(aiText.slice(0, 300))}`,
        text: aiText,
        source: 'chat',
        category: 'conversation',
        topic: 'conversation',
        tag: 'chat_turn',
        url: '',
        site: 'chat',
        author: 'assistant',
        timestamp: Date.now(),
        durationMs: 0,
        importanceScore: 0.35,
        entities: extractEntities(aiText, '', 6),
        metadata: {
          url: '',
          source: 'chat',
          category: 'conversation',
          importance_score: 0.35,
          entities: extractEntities(aiText, '', 6)
        }
      });

      if (aiId) {
        turnIds.push(aiId);
      }
    }

    const extractedFacts = extractInsights(userText, aiText);
    for (const fact of extractedFacts) {
      await upsertDocument({
        id: `fact:${Date.now()}:${hashText(`${fact.type}|${fact.text}`)}`,
        text: fact.text,
        source: 'chat',
        category: 'user_fact',
        topic: fact.type,
        tag: 'user_fact',
        url: '',
        site: 'chat',
        author: 'user',
        timestamp: Date.now(),
        durationMs: 0,
        importanceScore: 0.9,
        entities: extractEntities(fact.text, '', 6),
        metadata: {
          url: '',
          source: 'chat',
          category: 'user_fact',
          importance_score: 0.9,
          entities: extractEntities(fact.text, '', 6)
        }
      });
    }

    return {
      context_used: normalizeArray(contextUsed, 12),
      extracted_facts: extractedFacts,
      turn_ids: turnIds
    };
  }

  async function init() {
    await ensureDb();
    await syncIdentityProfile({});
    return true;
  }

  async function warmupEmbeddings() {
    await ensureDb();
    try {
      await embeddingClient.embedText(EMBEDDING_WARMUP_TEXT);
      return true;
    } catch (_) {
      return false;
    }
  }

  function getConfigSnapshot() {
    return {
      vectorSize: VECTOR_SIZE,
      modelSimilarityThreshold: MODEL_SIMILARITY_THRESHOLD,
      defaultTopK: DEFAULT_TOP_K,
      workerPath: WORKER_PATH,
      identityStorageKey: IDENTITY_STORAGE_KEY,
      idbName: IDB_NAME,
      idbVersion: IDB_VERSION,
      idbStore: IDB_STORE,
      idbKey: IDB_KEY
    };
  }

  async function shutdown() {
    if (persistTimer) {
      window.clearTimeout(persistTimer);
      persistTimer = 0;
    }

    await persistNow();
    embeddingClient.shutdown();
  }

  return {
    init,
    shutdown,
    queryLocalContext,
    buildDynamicIdentityHeader,
    warmupEmbeddings,
    getConfigSnapshot,
    ingestTabContext,
    ingestHistoryEntries,
    ingestChatHistory,
    ingestUserProfile,
    rememberChatTurn,
    extractInsights,
    readIdentityProfile,
    syncIdentityProfile
  };
}
