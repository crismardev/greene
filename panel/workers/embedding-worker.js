import { env, pipeline } from '../../node_modules/@xenova/transformers/dist/transformers.min.js';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const VECTOR_SIZE = 384;
const MAX_CHARS = 4096;

let extractorPromise = null;

function toSafeText(value, limit = MAX_CHARS) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, limit);
}

function normalizeVector(input) {
  const values = Array.isArray(input)
    ? input
    : input && typeof input.length === 'number'
      ? Array.from(input)
      : [];

  if (!values.length) {
    return null;
  }

  const trimmed = values.slice(0, VECTOR_SIZE);
  while (trimmed.length < VECTOR_SIZE) {
    trimmed.push(0);
  }

  let norm = 0;
  for (const value of trimmed) {
    norm += value * value;
  }

  if (!norm) {
    return trimmed;
  }

  const scale = 1 / Math.sqrt(norm);
  return trimmed.map((value) => Number((value * scale).toFixed(8)));
}

function buildFallbackVector(text) {
  const safe = toSafeText(text, MAX_CHARS);
  const values = new Array(VECTOR_SIZE).fill(0);

  if (!safe) {
    return values;
  }

  for (let index = 0; index < safe.length; index += 1) {
    const code = safe.charCodeAt(index);
    const bucket = index % VECTOR_SIZE;
    values[bucket] += ((code % 131) + 1) / 131;
  }

  return normalizeVector(values) || values;
}

function configureTransformerEnv() {
  try {
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.numThreads = 1;

    const wasmBase =
      typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function'
        ? chrome.runtime.getURL('node_modules/@xenova/transformers/dist/')
        : '../../node_modules/@xenova/transformers/dist/';

    env.backends.onnx.wasm.wasmPaths = wasmBase;
  } catch (_) {
    // Ignore runtime-level config errors and let pipeline fallback.
  }
}

async function getExtractor() {
  if (!extractorPromise) {
    configureTransformerEnv();
    extractorPromise = pipeline('feature-extraction', MODEL_ID, { quantized: true });
  }

  return extractorPromise;
}

async function embedOne(text) {
  const safeText = toSafeText(text);
  if (!safeText) {
    return buildFallbackVector('');
  }

  try {
    const extractor = await getExtractor();
    const output = await extractor(safeText, {
      pooling: 'mean',
      normalize: true
    });
    const vector = normalizeVector(output?.data || output?.tolist?.()?.[0] || []);
    return vector || buildFallbackVector(safeText);
  } catch (_) {
    return buildFallbackVector(safeText);
  }
}

async function embedMany(texts) {
  const list = Array.isArray(texts) ? texts : [];
  const vectors = [];

  for (const item of list) {
    vectors.push(await embedOne(item));
  }

  return vectors;
}

self.addEventListener('message', async (event) => {
  const payload = event?.data && typeof event.data === 'object' ? event.data : {};
  const id = payload.id;
  const type = String(payload.type || '').trim();

  if (!id || !type) {
    return;
  }

  try {
    if (type === 'ping') {
      self.postMessage({
        id,
        ok: true,
        ready: true
      });
      return;
    }

    if (type === 'embed') {
      const vector = await embedOne(payload.text || '');
      self.postMessage({
        id,
        ok: true,
        vector
      });
      return;
    }

    if (type === 'embed_many') {
      const vectors = await embedMany(payload.texts || []);
      self.postMessage({
        id,
        ok: true,
        vectors
      });
      return;
    }

    self.postMessage({
      id,
      ok: false,
      error: 'Unsupported worker message type.'
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Embedding worker failed.'
    });
  }
});
