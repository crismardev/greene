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
const IDENTITY_STORAGE_KEY = 'greene_identity_profile';
const USER_BEHAVIOR_PROFILE_STORAGE_KEY = 'greene_behavior_profile';
const USER_BEHAVIOR_PROFILE_VERSION = 1;
const USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT = 480;
const USER_BEHAVIOR_PROFILE_MAX_ITEMS_LIMIT = 3000;
const USER_BEHAVIOR_HEADER_ITEMS_LIMIT = 3;
const IDB_NAME = 'greene-context-vector-db';
const IDB_VERSION = 1;
const IDB_STORE = 'vector_store';
const IDB_KEY = 'orama_state_v1';
const EMBEDDING_WARMUP_TEXT = 'greene bootstrap warmup';
const WHATSAPP_MESSAGE_DOC_LIMIT = 28;
const WHATSAPP_CONTACT_DOC_LIMIT = 36;
const USER_BEHAVIOR_PROFILE_DOC_ID = 'profile:user_behavior';
const RELATION_ROLE_KEYWORDS = Object.freeze([
  'cliente principal',
  'cliente',
  'clienta',
  'socio',
  'socia',
  'partner',
  'manager',
  'jefe',
  'jefa',
  'colega',
  'mentor',
  'mentora',
  'amigo',
  'amiga',
  'wife',
  'husband',
  'novia',
  'novio',
  'hermano',
  'hermana',
  'padre',
  'madre',
  'cto',
  'ceo',
  'lead',
  'developer'
]);

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

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const RELATION_ROLE_PATTERN = RELATION_ROLE_KEYWORDS.map((item) => escapeRegex(item))
  .sort((left, right) => right.length - left.length)
  .join('|');

function toMemoryKey(value, limit = 160) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@._:/+-]+/g, ' ')
    .trim()
    .slice(0, Math.max(16, Number(limit) || 160));
}

function toHostname(url) {
  const raw = toSafeText(url || '', 1200);
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    return toSafeText(parsed.hostname.replace(/^www\./i, '').toLowerCase(), 140);
  } catch (_) {
    return '';
  }
}

function resolveUserBehaviorLimit(value) {
  return Math.max(
    120,
    Math.min(USER_BEHAVIOR_PROFILE_MAX_ITEMS_LIMIT, Number(value) || USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT)
  );
}

function resolveUserBehaviorCategoryLimits(maxItems = USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT) {
  const total = resolveUserBehaviorLimit(maxItems);
  const minimums = {
    relations: 24,
    contacts: 24,
    sites: 32,
    preferences: 16
  };

  const limits = {
    relations: Math.max(minimums.relations, Math.round(total * 0.24)),
    contacts: Math.max(minimums.contacts, Math.round(total * 0.24)),
    sites: Math.max(minimums.sites, Math.round(total * 0.34)),
    preferences: Math.max(minimums.preferences, Math.round(total * 0.18))
  };

  let sum = limits.relations + limits.contacts + limits.sites + limits.preferences;
  if (sum > total) {
    for (const key of ['sites', 'contacts', 'relations', 'preferences']) {
      while (sum > total && limits[key] > minimums[key]) {
        limits[key] -= 1;
        sum -= 1;
      }
      if (sum <= total) {
        break;
      }
    }
  }

  if (sum < total) {
    limits.preferences += total - sum;
  }

  return {
    total,
    ...limits
  };
}

function normalizeBehaviorRole(value, limit = 80) {
  return toSafeText(String(value || '').replace(/\s+/g, ' '), Math.max(24, Number(limit) || 80));
}

function normalizeBehaviorEntry(rawEntry, options = {}) {
  const raw = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
  const labelLimit = Math.max(40, Math.min(320, Number(options.labelLimit) || 220));
  const roleLimit = Math.max(16, Math.min(120, Number(options.roleLimit) || 80));
  const labelCandidate = toSafeText(
    raw.label || raw.name || raw.text || raw.host || raw.value || raw.domain || '',
    labelLimit
  );
  const keyCandidate = toSafeText(raw.key || raw.id || raw.slug || labelCandidate, 160);
  const key = toMemoryKey(keyCandidate, 160);
  const label = labelCandidate || toSafeText(keyCandidate, labelLimit);
  if (!key || !label) {
    return null;
  }

  const count = Math.max(1, Number(raw.count || raw.weight || raw.visits || raw.valueCount || 1) || 1);
  const lastSeenAt = Math.max(
    0,
    Number(raw.lastSeenAt || raw.updatedAt || raw.timestamp || raw.lastVisitTime || Date.now()) || Date.now()
  );
  const role =
    options.allowRole === false
      ? ''
      : normalizeBehaviorRole(raw.role || raw.relationship || raw.title || raw.relation || '', roleLimit);

  return {
    key,
    label,
    role,
    count,
    lastSeenAt
  };
}

function sortBehaviorEntries(left, right) {
  const leftCount = Number(left?.count) || 0;
  const rightCount = Number(right?.count) || 0;
  if (leftCount !== rightCount) {
    return rightCount - leftCount;
  }

  const leftSeen = Number(left?.lastSeenAt) || 0;
  const rightSeen = Number(right?.lastSeenAt) || 0;
  if (leftSeen !== rightSeen) {
    return rightSeen - leftSeen;
  }

  return String(left?.label || '').localeCompare(String(right?.label || ''));
}

function mergeBehaviorEntries(currentEntries, incomingEntries, limit = 120, options = {}) {
  const safeLimit = Math.max(1, Math.min(3000, Number(limit) || 120));
  const mode = options.countMode === 'max' ? 'max' : 'sum';
  const byKey = new Map();
  const seed = Array.isArray(currentEntries) ? currentEntries : [];
  const incoming = Array.isArray(incomingEntries) ? incomingEntries : [];

  for (const item of seed) {
    const normalized = normalizeBehaviorEntry(item, options);
    if (!normalized) {
      continue;
    }
    byKey.set(normalized.key, normalized);
  }

  for (const item of incoming) {
    const normalized = normalizeBehaviorEntry(item, options);
    if (!normalized) {
      continue;
    }

    const known = byKey.get(normalized.key);
    if (!known) {
      byKey.set(normalized.key, normalized);
      continue;
    }

    const nextCount = mode === 'max' ? Math.max(known.count, normalized.count) : known.count + normalized.count;
    byKey.set(normalized.key, {
      ...known,
      label: normalized.label.length > known.label.length ? normalized.label : known.label,
      role: normalized.role || known.role,
      count: nextCount,
      lastSeenAt: Math.max(known.lastSeenAt || 0, normalized.lastSeenAt || 0)
    });
  }

  return Array.from(byKey.values()).sort(sortBehaviorEntries).slice(0, safeLimit);
}

function buildUserBehaviorProfileDefaults(maxItems = USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT) {
  const safeMax = resolveUserBehaviorLimit(maxItems);
  return {
    version: USER_BEHAVIOR_PROFILE_VERSION,
    maxItems: safeMax,
    updatedAt: 0,
    relations: [],
    contacts: [],
    sites: [],
    preferences: []
  };
}

function normalizeUserBehaviorProfile(rawProfile, maxItems = USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT) {
  const raw = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const limits = resolveUserBehaviorCategoryLimits(
    Number(raw.maxItems) > 0 ? Number(raw.maxItems) : maxItems
  );

  return {
    version: USER_BEHAVIOR_PROFILE_VERSION,
    maxItems: limits.total,
    updatedAt: Math.max(0, Number(raw.updatedAt) || 0),
    relations: mergeBehaviorEntries([], raw.relations, limits.relations, {
      countMode: 'max',
      labelLimit: 220,
      roleLimit: 80
    }),
    contacts: mergeBehaviorEntries([], raw.contacts, limits.contacts, {
      countMode: 'max',
      labelLimit: 220,
      allowRole: false
    }),
    sites: mergeBehaviorEntries([], raw.sites, limits.sites, {
      countMode: 'max',
      labelLimit: 180,
      allowRole: false
    }),
    preferences: mergeBehaviorEntries([], raw.preferences, limits.preferences, {
      countMode: 'max',
      labelLimit: 260,
      allowRole: false
    })
  };
}

function collectTopBehaviorDescriptors(entries, maxItems = 3, formatter) {
  const source = Array.isArray(entries) ? entries : [];
  const safeMax = Math.max(1, Math.min(8, Number(maxItems) || 3));
  return source
    .slice(0, safeMax)
    .map((item) => {
      if (typeof formatter === 'function') {
        return formatter(item);
      }
      return `${item?.label || ''} (${Math.max(0, Number(item?.count) || 0)})`;
    })
    .filter(Boolean);
}

function buildUserBehaviorHeaderSummary(profile, maxItemsPerSection = USER_BEHAVIOR_HEADER_ITEMS_LIMIT) {
  const safe = normalizeUserBehaviorProfile(profile, profile?.maxItems || USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT);
  const totalItems =
    safe.relations.length + safe.contacts.length + safe.sites.length + safe.preferences.length;
  if (!totalItems) {
    return 'Perfil conductual local: aun sin datos suficientes.';
  }

  const relations = collectTopBehaviorDescriptors(safe.relations, maxItemsPerSection, (item) => {
    const role = toSafeText(item?.role || '', 60);
    return role ? `${item?.label || ''} [${role}] (${item?.count || 0})` : `${item?.label || ''} (${item?.count || 0})`;
  });
  const contacts = collectTopBehaviorDescriptors(safe.contacts, maxItemsPerSection);
  const sites = collectTopBehaviorDescriptors(safe.sites, maxItemsPerSection);
  const preferences = collectTopBehaviorDescriptors(safe.preferences, maxItemsPerSection, (item) => item?.label || '');

  return [
    `Perfil conductual local: relaciones=${safe.relations.length}, contactos=${safe.contacts.length}, sitios=${safe.sites.length}, preferencias=${safe.preferences.length}.`,
    relations.length ? `Relaciones cercanas: ${relations.join(' | ')}` : '',
    contacts.length ? `Contactos frecuentes: ${contacts.join(' | ')}` : '',
    sites.length ? `Sitios frecuentes: ${sites.join(' | ')}` : '',
    preferences.length ? `Preferencias: ${preferences.join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function buildUserBehaviorProfileDoc(profile) {
  const safe = normalizeUserBehaviorProfile(profile, profile?.maxItems || USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT);
  const totalItems =
    safe.relations.length + safe.contacts.length + safe.sites.length + safe.preferences.length;
  if (!totalItems) {
    return null;
  }

  const relationLines = safe.relations
    .slice(0, 14)
    .map((item, index) => `${index + 1}. ${item.label}${item.role ? ` [${item.role}]` : ''} (${item.count})`);
  const contactLines = safe.contacts
    .slice(0, 14)
    .map((item, index) => `${index + 1}. ${item.label} (${item.count})`);
  const siteLines = safe.sites
    .slice(0, 16)
    .map((item, index) => `${index + 1}. ${item.label} (${item.count})`);
  const preferenceLines = safe.preferences
    .slice(0, 14)
    .map((item, index) => `${index + 1}. ${item.label} (${item.count})`);

  const lines = [
    'Perfil conductual local autogenerado.',
    `Limite configurado: ${safe.maxItems} items agregados.`,
    relationLines.length ? `Relaciones cercanas:\n${relationLines.join('\n')}` : '',
    contactLines.length ? `Contactos frecuentes:\n${contactLines.join('\n')}` : '',
    siteLines.length ? `Sitios frecuentes:\n${siteLines.join('\n')}` : '',
    preferenceLines.length ? `Preferencias detectadas:\n${preferenceLines.join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  const entities = normalizeArray(
    [
      ...safe.relations.slice(0, 5).map((item) => item.label),
      ...safe.contacts.slice(0, 5).map((item) => item.label),
      ...safe.sites.slice(0, 5).map((item) => item.label)
    ],
    12
  );

  return {
    id: USER_BEHAVIOR_PROFILE_DOC_ID,
    text: lines,
    source: 'profile',
    category: 'identity',
    topic: 'user_behavior_profile',
    tag: 'profile_behavior',
    url: '',
    site: 'profile',
    author: 'user',
    timestamp: Math.max(0, Number(safe.updatedAt) || Date.now()),
    durationMs: 0,
    importanceScore: 0.93,
    entities,
    metadata: {
      url: '',
      source: 'profile',
      category: 'identity',
      importance_score: 0.93,
      entities
    }
  };
}

function buildRelationSignalsFromText(text, timestamp = Date.now()) {
  const safeText = toSafeText(text || '', 3200);
  if (!safeText) {
    return [];
  }

  const namePattern = "[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'\\-]{1,30}(?:\\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'\\-]{1,30}){0,2}";
  const signals = [];
  const patternA = new RegExp(
    `\\b(${namePattern})\\s+(?:es|is)\\s+(?:mi\\s+|my\\s+)?(${RELATION_ROLE_PATTERN})\\b`,
    'gi'
  );
  const patternB = new RegExp(
    `\\b(?:mi|my)\\s+(${RELATION_ROLE_PATTERN})\\s+(?:es|is|se llama|called)\\s+(${namePattern})\\b`,
    'gi'
  );

  for (const match of safeText.matchAll(patternA)) {
    const name = toSafeText(match[1] || '', 160);
    const role = normalizeBehaviorRole(match[2] || '', 80);
    if (!name) {
      continue;
    }
    signals.push({
      key: toMemoryKey(name, 160),
      label: name,
      role,
      count: 2,
      lastSeenAt: timestamp
    });
  }

  for (const match of safeText.matchAll(patternB)) {
    const role = normalizeBehaviorRole(match[1] || '', 80);
    const name = toSafeText(match[2] || '', 160);
    if (!name) {
      continue;
    }
    signals.push({
      key: toMemoryKey(name, 160),
      label: name,
      role,
      count: 2,
      lastSeenAt: timestamp
    });
  }

  const clientColon = /(?:cliente principal|main client)\s*[:=-]\s*([^,\n.]+)/gi;
  for (const match of safeText.matchAll(clientColon)) {
    const name = toSafeText(match[1] || '', 160);
    if (!name) {
      continue;
    }
    signals.push({
      key: toMemoryKey(name, 160),
      label: name,
      role: 'cliente principal',
      count: 3,
      lastSeenAt: timestamp
    });
  }

  return mergeBehaviorEntries([], signals, 36, {
    countMode: 'max',
    labelLimit: 220,
    roleLimit: 80
  });
}

function buildPreferenceSignalsFromText(text, timestamp = Date.now()) {
  const safeText = toSafeText(text || '', 3200);
  if (!safeText) {
    return [];
  }

  const lines = safeText
    .split(/[\n.!?]+/)
    .map((item) => toSafeText(item, 240))
    .filter(Boolean);
  const tokens = ['me gusta', 'prefiero', 'no me gusta', 'odio', 'i like', 'i prefer', 'i hate'];
  const signals = [];

  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (!tokens.some((token) => normalized.includes(token))) {
      continue;
    }

    signals.push({
      key: toMemoryKey(line, 180),
      label: line,
      count: 1,
      lastSeenAt: timestamp
    });
  }

  return mergeBehaviorEntries([], signals, 36, {
    countMode: 'max',
    labelLimit: 260,
    allowRole: false
  });
}

function buildBehaviorSignalsFromFacts(rawFacts, timestamp = Date.now()) {
  const facts = Array.isArray(rawFacts) ? rawFacts : [];
  const relationSignals = [];
  const preferenceSignals = [];

  for (const fact of facts) {
    const type = toSafeText(fact?.type || 'user_fact', 40).toLowerCase();
    const text = toSafeText(fact?.text || '', 320);
    if (!text) {
      continue;
    }

    if (type === 'client') {
      const name = toSafeText(text.replace(/^cliente principal:\s*/i, ''), 160);
      if (name) {
        relationSignals.push({
          key: toMemoryKey(name, 160),
          label: name,
          role: 'cliente principal',
          count: 3,
          lastSeenAt: timestamp
        });
      }
    }

    if (type === 'preference') {
      preferenceSignals.push({
        key: toMemoryKey(text, 180),
        label: text,
        count: 2,
        lastSeenAt: timestamp
      });
    }

    relationSignals.push(...buildRelationSignalsFromText(text, timestamp));
    preferenceSignals.push(...buildPreferenceSignalsFromText(text, timestamp));
  }

  return {
    relations: mergeBehaviorEntries([], relationSignals, 40, {
      countMode: 'sum',
      labelLimit: 220,
      roleLimit: 80
    }),
    preferences: mergeBehaviorEntries([], preferenceSignals, 40, {
      countMode: 'sum',
      labelLimit: 260,
      allowRole: false
    })
  };
}

function buildBehaviorSignalsFromTabContext(activeTab, historyEntries = [], timestamp = Date.now()) {
  const tab = activeTab && typeof activeTab === 'object' ? activeTab : {};
  const tabDetails = tab.details && typeof tab.details === 'object' ? tab.details : {};
  const tabCurrentChat = tabDetails.currentChat && typeof tabDetails.currentChat === 'object' ? tabDetails.currentChat : {};
  const relationSignals = [];
  const contactSignals = [];
  const activeSiteSignals = [];
  const observedSiteSignals = [];
  const tabTimestamp = Math.max(0, Number(tab.updatedAt) || timestamp);

  const activeHost = toHostname(tab.url || '');
  if (activeHost) {
    activeSiteSignals.push({
      key: toMemoryKey(activeHost, 160),
      label: activeHost,
      count: 1,
      lastSeenAt: tabTimestamp
    });
  }

  if (String(tab.site || '').toLowerCase() === 'whatsapp') {
    const contactLabel = toSafeText(
      tabCurrentChat.title || tabCurrentChat.phone || tabCurrentChat.key || tabCurrentChat.channelId || '',
      220
    );
    const contactKey = toMemoryKey(
      tabCurrentChat.channelId || tabCurrentChat.phone || tabCurrentChat.key || contactLabel,
      160
    );

    if (contactLabel && contactKey) {
      contactSignals.push({
        key: contactKey,
        label: contactLabel,
        count: 1,
        lastSeenAt: tabTimestamp
      });

      if (!/\b(group|grupo)\b/i.test(contactLabel)) {
        relationSignals.push({
          key: toMemoryKey(contactLabel, 160),
          label: contactLabel,
          role: 'contacto whatsapp',
          count: 1,
          lastSeenAt: tabTimestamp
        });
      }
    }
  }

  const history = Array.isArray(historyEntries) ? historyEntries.slice(0, 80) : [];
  for (const item of history) {
    const host = toHostname(item?.url || '');
    if (!host) {
      continue;
    }

    const visitCount = Math.max(0, Number(item?.visitCount) || 0);
    const typedCount = Math.max(0, Number(item?.typedCount) || 0);
    const weight = Math.max(1, Math.min(220, visitCount + typedCount + 1));
    observedSiteSignals.push({
      key: toMemoryKey(host, 160),
      label: host,
      count: weight,
      lastSeenAt: Math.max(0, Number(item?.lastVisitTime) || timestamp)
    });
  }

  return {
    relations: mergeBehaviorEntries([], relationSignals, 24, {
      countMode: 'sum',
      labelLimit: 220,
      roleLimit: 80
    }),
    contacts: mergeBehaviorEntries([], contactSignals, 24, {
      countMode: 'sum',
      labelLimit: 220,
      allowRole: false
    }),
    sitesActive: mergeBehaviorEntries([], activeSiteSignals, 16, {
      countMode: 'sum',
      labelLimit: 180,
      allowRole: false
    }),
    sitesObserved: mergeBehaviorEntries([], observedSiteSignals, 120, {
      countMode: 'max',
      labelLimit: 180,
      allowRole: false
    })
  };
}

function normalizeWhatsappMessages(rawMessages, limit = WHATSAPP_MESSAGE_DOC_LIMIT) {
  const source = Array.isArray(rawMessages) ? rawMessages : [];
  const safeLimit = Math.max(1, Math.min(120, Number(limit) || WHATSAPP_MESSAGE_DOC_LIMIT));
  const trimmed = source.slice(-safeLimit);

  return trimmed
    .map((item, index) => {
      const role = item?.role === 'me' ? 'me' : 'contact';
      const enriched = item?.enriched && typeof item.enriched === 'object' ? item.enriched : {};
      const transcript = toSafeText(item?.transcript || enriched.transcript || '', 520);
      const ocrText = toSafeText(item?.ocrText || enriched.ocrText || '', 520);
      const mediaCaption = toSafeText(item?.mediaCaption || enriched.mediaCaption || '', 320);
      const kind = toSafeText(item?.kind || '', 24).toLowerCase() || 'text';
      const text = toSafeText(item?.text || transcript || ocrText || mediaCaption || '', 820);
      const id = toSafeText(item?.id || `row-${index}`, 220);
      if (!text || !id) {
        return null;
      }

      return {
        id,
        role,
        text,
        timestampLabel: toSafeText(item?.timestamp || '', 80),
        kind,
        transcript,
        ocrText,
        mediaCaption
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
      item.kind ? `Tipo: ${item.kind}` : '',
      `${item.role === 'me' ? 'Yo' : 'Contacto'}: ${item.text}`,
      item.transcript ? `Transcripcion: ${item.transcript}` : '',
      item.ocrText ? `OCR/Descripcion visual: ${item.ocrText}` : '',
      item.mediaCaption ? `Caption: ${item.mediaCaption}` : '',
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
      entities: normalizeArray([chatTitle, chatPhone, item.id, item.kind, item.text, item.transcript, item.ocrText], 10),
      metadata: {
        url,
        source: 'whatsapp',
        category: 'messaging',
        importance_score: importanceScore,
        entities: normalizeArray([chatTitle, chatPhone, item.id, item.kind, item.text, item.transcript, item.ocrText], 10)
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

  async function readUserBehaviorProfile(maxItems = USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT) {
    const defaults = buildUserBehaviorProfileDefaults(maxItems);
    const payload = await readChromeLocal({
      [USER_BEHAVIOR_PROFILE_STORAGE_KEY]: defaults
    });
    const stored =
      payload && payload[USER_BEHAVIOR_PROFILE_STORAGE_KEY] && typeof payload[USER_BEHAVIOR_PROFILE_STORAGE_KEY] === 'object'
        ? payload[USER_BEHAVIOR_PROFILE_STORAGE_KEY]
        : defaults;
    return normalizeUserBehaviorProfile(stored, defaults.maxItems);
  }

  async function writeUserBehaviorProfile(profile) {
    const normalized = normalizeUserBehaviorProfile(profile, profile?.maxItems || USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT);
    await writeChromeLocal({
      [USER_BEHAVIOR_PROFILE_STORAGE_KEY]: normalized
    });
    return normalized;
  }

  async function updateUserBehaviorProfileMemory({
    userText = '',
    extractedFacts = [],
    profileContext = {},
    maxItems = USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT
  } = {}) {
    const limits = resolveUserBehaviorCategoryLimits(maxItems);
    const current = await readUserBehaviorProfile(limits.total);
    const timestamp = Date.now();
    const textSignals = buildRelationSignalsFromText(userText, timestamp);
    const preferenceSignals = buildPreferenceSignalsFromText(userText, timestamp);
    const factSignals = buildBehaviorSignalsFromFacts(extractedFacts, timestamp);
    const tabSignals = buildBehaviorSignalsFromTabContext(
      profileContext?.activeTab || null,
      profileContext?.historyEntries || [],
      timestamp
    );

    let nextSites = mergeBehaviorEntries(current.sites, tabSignals.sitesObserved, limits.sites, {
      countMode: 'max',
      labelLimit: 180,
      allowRole: false
    });
    nextSites = mergeBehaviorEntries(nextSites, tabSignals.sitesActive, limits.sites, {
      countMode: 'sum',
      labelLimit: 180,
      allowRole: false
    });

    const next = normalizeUserBehaviorProfile(
      {
        ...current,
        maxItems: limits.total,
        updatedAt: timestamp,
        relations: mergeBehaviorEntries(
          mergeBehaviorEntries(current.relations, textSignals, limits.relations, {
            countMode: 'sum',
            labelLimit: 220,
            roleLimit: 80
          }),
          [...factSignals.relations, ...tabSignals.relations],
          limits.relations,
          {
            countMode: 'sum',
            labelLimit: 220,
            roleLimit: 80
          }
        ),
        contacts: mergeBehaviorEntries(current.contacts, tabSignals.contacts, limits.contacts, {
          countMode: 'sum',
          labelLimit: 220,
          allowRole: false
        }),
        sites: nextSites,
        preferences: mergeBehaviorEntries(
          mergeBehaviorEntries(current.preferences, preferenceSignals, limits.preferences, {
            countMode: 'sum',
            labelLimit: 260,
            allowRole: false
          }),
          factSignals.preferences,
          limits.preferences,
          {
            countMode: 'sum',
            labelLimit: 260,
            allowRole: false
          }
        )
      },
      limits.total
    );

    await writeUserBehaviorProfile(next);
    const profileDoc = buildUserBehaviorProfileDoc(next);
    if (profileDoc) {
      await upsertDocument(profileDoc);
    }

    return next;
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

function normalizeWhatsappHistoryMessage(record, index = 0) {
  const item = record && typeof record === 'object' ? record : {};
  const role = item.role === 'me' || item.role === 'user' ? 'me' : 'contact';
  const kind = toSafeText(item.kind || '', 24).toLowerCase() || 'text';
  const id = toSafeText(item.id || `msg-${index + 1}`, 220);
  if (!id) {
    return null;
  }

  const transcript = toSafeText(item.transcript || item.enriched?.transcript || '', 520);
  const ocrText = toSafeText(item.ocrText || item.enriched?.ocrText || '', 520);
  const mediaCaption = toSafeText(item.mediaCaption || item.enriched?.mediaCaption || '', 320);
  const text = toSafeText(item.text || transcript || ocrText || mediaCaption || '', 920);
  if (!text) {
    return null;
  }

  const firstSeenAt = Math.max(0, Number(item.firstSeenAt || item.createdAt) || 0);
  const lastSeenAt = Math.max(firstSeenAt, Number(item.lastSeenAt || item.updatedAt) || 0);

  return {
    id,
    role,
    kind,
    text,
    timestampLabel: toSafeText(item.timestamp || '', 80),
    transcript,
    ocrText,
    mediaCaption,
    firstSeenAt,
    lastSeenAt
  };
}

function normalizeWhatsappHistoryPayload(rawPayload, messageLimit = 640) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  const key = toSafeText(
    payload.key || payload.channelId || payload.chatKey || payload.phone || payload.title || '',
    220
  );
  if (!key) {
    return null;
  }

  const limit = Math.max(1, Math.min(2000, Number(messageLimit) || 640));
  const messages = (Array.isArray(payload.messages) ? payload.messages : [])
    .map((item, index) => normalizeWhatsappHistoryMessage(item, index))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTs = Math.max(0, Number(left.lastSeenAt || left.firstSeenAt) || 0);
      const rightTs = Math.max(0, Number(right.lastSeenAt || right.firstSeenAt) || 0);
      return leftTs - rightTs;
    })
    .slice(-limit);

  if (!messages.length) {
    return null;
  }

  return {
    key,
    channelId: toSafeText(payload.channelId || '', 220),
    chatKey: toSafeText(payload.chatKey || '', 220),
    title: toSafeText(payload.title || '', 220),
    phone: toSafeText(payload.phone || '', 80),
    lastMessageId: toSafeText(payload.lastMessageId || '', 220),
    updatedAt: Math.max(0, Number(payload.updatedAt) || 0),
    messages
  };
}

function buildWhatsappHistorySummaryDoc(history) {
  const safe = history && typeof history === 'object' ? history : {};
  const chatIdentity = toSafeText(
    safe.key || safe.channelId || safe.chatKey || safe.phone || safe.title || 'wa_chat',
    220
  );
  const chatTitle = toSafeText(safe.title || '', 220);
  const chatPhone = toSafeText(safe.phone || '', 80);
  const channelId = toSafeText(safe.channelId || safe.chatKey || '', 220);
  const messages = Array.isArray(safe.messages) ? safe.messages : [];
  const total = messages.length;
  const lastMessage = total ? messages[total - 1] : null;
  const lastContact = messages
    .slice()
    .reverse()
    .find((item) => item?.role === 'contact');
  const contactSamples = messages
    .filter((item) => item?.role === 'contact')
    .slice(-4)
    .map((item) => toSafeText(item.text || '', 180))
    .filter(Boolean);

  const summary = [
    'Historial persistido de WhatsApp.',
    `Chat: ${chatTitle || chatPhone || chatIdentity}`,
    channelId ? `Canal: ${channelId}` : '',
    chatPhone ? `Telefono: ${chatPhone}` : '',
    `Mensajes persistidos: ${total}`,
    lastContact ? `Ultimo mensaje del contacto: ${toSafeText(lastContact.text, 280)}` : '',
    lastMessage ? `Ultimo mensaje general: ${toSafeText(lastMessage.text, 220)}` : '',
    contactSamples.length ? `Muestra de mensajes del contacto: ${contactSamples.join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const timestamp = Math.max(
    0,
    Number(safe.updatedAt) || Number(lastMessage?.lastSeenAt || lastMessage?.firstSeenAt) || Date.now()
  );
  const entities = normalizeArray(
    [chatTitle, chatPhone, channelId, safe.key, safe.lastMessageId, ...contactSamples],
    12
  );

  return {
    id: `wa-history-chat:${hashText(chatIdentity)}`,
    text: summary,
    source: 'whatsapp',
    category: 'messaging',
    topic: 'wa_history_chat',
    tag: 'wa_history',
    url: '',
    site: 'whatsapp',
    author: chatTitle || chatPhone || 'contact',
    timestamp,
    durationMs: 0,
    importanceScore: 0.82,
    entities,
    metadata: {
      url: '',
      source: 'whatsapp',
      category: 'messaging',
      importance_score: 0.82,
      entities
    }
  };
}

function buildWhatsappHistoryMessageDoc(history, message, index = 0) {
  const safeHistory = history && typeof history === 'object' ? history : {};
  const item = message && typeof message === 'object' ? message : {};
  const chatIdentity = toSafeText(
    safeHistory.key || safeHistory.channelId || safeHistory.chatKey || safeHistory.phone || safeHistory.title || '',
    220
  );
  if (!chatIdentity) {
    return null;
  }

  const messageId = toSafeText(item.id || '', 220);
  const text = toSafeText(item.text || '', 920);
  if (!messageId || !text) {
    return null;
  }

  const chatTitle = toSafeText(safeHistory.title || '', 220);
  const chatPhone = toSafeText(safeHistory.phone || '', 80);
  const channelId = toSafeText(safeHistory.channelId || safeHistory.chatKey || '', 220);
  const role = item.role === 'me' ? 'me' : 'contact';
  const kind = toSafeText(item.kind || 'text', 24).toLowerCase() || 'text';
  const transcript = toSafeText(item.transcript || '', 520);
  const ocrText = toSafeText(item.ocrText || '', 520);
  const mediaCaption = toSafeText(item.mediaCaption || '', 320);
  const timestamp = Math.max(
    0,
    Number(item.lastSeenAt || item.firstSeenAt) || Number(safeHistory.updatedAt) || Date.now()
  );

  const body = [
    'Historial de mensaje de WhatsApp.',
    `Chat: ${chatTitle || chatPhone || chatIdentity}`,
    channelId ? `Canal: ${channelId}` : '',
    chatPhone ? `Telefono: ${chatPhone}` : '',
    `Rol: ${role === 'me' ? 'yo' : 'contacto'}`,
    `Tipo: ${kind}`,
    item.timestampLabel ? `Hora UI: ${toSafeText(item.timestampLabel, 80)}` : '',
    `Contenido: ${text}`,
    transcript ? `Transcripcion: ${transcript}` : '',
    ocrText ? `OCR/Descripcion visual: ${ocrText}` : '',
    mediaCaption ? `Caption: ${mediaCaption}` : '',
    `Message ID: ${messageId}`
  ]
    .filter(Boolean)
    .join('\n');
  const entities = normalizeArray(
    [chatTitle, chatPhone, channelId, messageId, kind, text, transcript, ocrText, mediaCaption],
    12
  );
  const fingerprint = `${chatIdentity}|${messageId}|${index}`;
  const importanceScore = role === 'contact' ? 0.69 : 0.54;

  return {
    id: `wa-history-msg:${hashText(fingerprint)}`,
    text: body,
    source: 'whatsapp',
    category: 'messaging',
    topic: 'wa_history_message',
    tag: 'wa_history',
    url: '',
    site: 'whatsapp',
    author: role === 'me' ? 'me' : chatTitle || chatPhone || 'contact',
    timestamp,
    durationMs: 0,
    importanceScore,
    entities,
    metadata: {
      url: '',
      source: 'whatsapp',
      category: 'messaging',
      importance_score: importanceScore,
      entities
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
    const behaviorProfile = await readUserBehaviorProfile();
    const contextHits = await queryLocalContext(query, {
      similarity: MODEL_SIMILARITY_THRESHOLD,
      limit: DEFAULT_TOP_K
    });

    const contextSummary = buildContextPromptLines(contextHits);
    const behaviorSummary = buildUserBehaviorHeaderSummary(behaviorProfile, USER_BEHAVIOR_HEADER_ITEMS_LIMIT);
    const header = [
      'Actua como un asistente personal.',
      `Datos del usuario actual: Nombre: ${identity.user_name || 'N/A'}, Maquina: ${identity.os || 'N/A'}, Ubicacion: ${identity.current_timezone || 'N/A'}.`,
      `Especificaciones locales: ${identity.machine_specs || 'N/A'}.`,
      behaviorSummary,
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

  async function ingestWhatsappChatHistory(payload, options = {}) {
    const source = Array.isArray(payload) ? payload : payload ? [payload] : [];
    if (!source.length) {
      return {
        ingestedChats: 0,
        ingestedMessages: 0,
        ids: []
      };
    }

    const chatLimit = Math.max(1, Math.min(320, Number(options.chatLimit) || source.length));
    const messageLimit = Math.max(1, Math.min(2000, Number(options.messageLimit || options.limit) || 640));
    const histories = source
      .map((item) => normalizeWhatsappHistoryPayload(item, messageLimit))
      .filter(Boolean)
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, chatLimit);
    if (!histories.length) {
      return {
        ingestedChats: 0,
        ingestedMessages: 0,
        ids: []
      };
    }

    const ids = [];
    let ingestedChats = 0;
    let ingestedMessages = 0;

    for (const history of histories) {
      const summaryDoc = buildWhatsappHistorySummaryDoc(history);
      const summaryId = await upsertDocument(summaryDoc);
      if (summaryId) {
        ids.push(summaryId);
        ingestedChats += 1;
      }

      const messages = Array.isArray(history.messages) ? history.messages.slice(-messageLimit) : [];
      for (let index = 0; index < messages.length; index += 1) {
        const messageDoc = buildWhatsappHistoryMessageDoc(history, messages[index], index);
        if (!messageDoc) {
          continue;
        }

        const messageId = await upsertDocument(messageDoc);
        if (messageId) {
          ids.push(messageId);
          ingestedMessages += 1;
        }
      }
    }

    return {
      ingestedChats,
      ingestedMessages,
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

  async function rememberChatTurn({
    userMessage,
    assistantMessage,
    contextUsed = [],
    profileContext = {},
    memoryLimits = {}
  }) {
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

    let behaviorProfile = null;
    try {
      behaviorProfile = await updateUserBehaviorProfileMemory({
        userText,
        extractedFacts,
        profileContext,
        maxItems: resolveUserBehaviorLimit(memoryLimits?.maxProfileItems)
      });
    } catch (_) {
      // Keep turn memory resilient if behavior profiling fails.
    }

    return {
      context_used: normalizeArray(contextUsed, 12),
      extracted_facts: extractedFacts,
      turn_ids: turnIds,
      profile_summary: behaviorProfile
        ? {
            updatedAt: behaviorProfile.updatedAt,
            relations: behaviorProfile.relations.length,
            contacts: behaviorProfile.contacts.length,
            sites: behaviorProfile.sites.length,
            preferences: behaviorProfile.preferences.length,
            maxItems: behaviorProfile.maxItems
          }
        : null
    };
  }

  async function init() {
    await ensureDb();
    await syncIdentityProfile({});
    try {
      const behaviorProfile = await readUserBehaviorProfile();
      const profileDoc = buildUserBehaviorProfileDoc(behaviorProfile);
      if (profileDoc) {
        await upsertDocument(profileDoc);
      }
    } catch (_) {
      // Ignore behavior profile init failures.
    }
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
      userBehaviorProfileStorageKey: USER_BEHAVIOR_PROFILE_STORAGE_KEY,
      userBehaviorProfileVersion: USER_BEHAVIOR_PROFILE_VERSION,
      userBehaviorProfileMaxItemsDefault: USER_BEHAVIOR_PROFILE_MAX_ITEMS_DEFAULT,
      userBehaviorProfileMaxItemsLimit: USER_BEHAVIOR_PROFILE_MAX_ITEMS_LIMIT,
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
    ingestWhatsappChatHistory,
    ingestUserProfile,
    rememberChatTurn,
    extractInsights,
    readIdentityProfile,
    syncIdentityProfile
  };
}
