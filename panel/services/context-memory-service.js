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
    const store = await ensureDb();
    const text = toSafeText(doc?.text || '', 4200);
    if (!text) {
      return null;
    }

    const embedding = await embeddingClient.embedText(text);
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
    return hits.filter((item) => Number(item.score || 0) >= similarity);
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
      user_name: toSafeText(patch.user_name || patch.userName || current.user_name, 80),
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
    const doc = buildNavigationDoc(tabContext);
    if (!doc) {
      return null;
    }

    return upsertDocument(doc);
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
    ingestTabContext,
    ingestHistoryEntries,
    rememberChatTurn,
    extractInsights,
    readIdentityProfile,
    syncIdentityProfile
  };
}
