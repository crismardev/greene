const PIN_VERIFIER_TEXT = 'greene-pin-verifier-v1';
const DEFAULT_ITERATIONS = 210000;

function toBase64(bytes) {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function fromBase64(value) {
  const text = String(value || '').trim();
  if (!text) {
    return new Uint8Array();
  }

  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function normalizePin(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '');
}

function normalizeSecurityConfig(config) {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const iterations = Number(config.iterations);
  const safeIterations = Number.isFinite(iterations) && iterations >= 10000 ? Math.floor(iterations) : DEFAULT_ITERATIONS;
  const saltB64 = String(config.saltB64 || '').trim();
  const verifierIvB64 = String(config.verifierIvB64 || '').trim();
  const verifierCipherB64 = String(config.verifierCipherB64 || '').trim();

  if (!saltB64 || !verifierIvB64 || !verifierCipherB64) {
    return null;
  }

  return {
    version: 1,
    iterations: safeIterations,
    saltB64,
    verifierIvB64,
    verifierCipherB64
  };
}

async function deriveAesKey(pin, saltBytes, iterations) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptWithKey(cryptoKey, plainText) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoder.encode(String(plainText || '')));

  return {
    version: 1,
    ivB64: toBase64(iv),
    cipherB64: toBase64(new Uint8Array(cipherBuffer))
  };
}

async function decryptWithKey(cryptoKey, payload) {
  const decoder = new TextDecoder();
  const iv = fromBase64(payload?.ivB64);
  const cipherBytes = fromBase64(payload?.cipherB64);

  if (iv.length !== 12 || !cipherBytes.length) {
    throw new Error('Payload cifrado invalido.');
  }

  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipherBytes);
  return decoder.decode(plainBuffer);
}

export function createPinCryptoService(options = {}) {
  const configuredIterations = Number(options.iterations);
  const iterations = Number.isFinite(configuredIterations) && configuredIterations >= 10000
    ? Math.floor(configuredIterations)
    : DEFAULT_ITERATIONS;

  function validatePin(pin) {
    const normalizedPin = normalizePin(pin);
    if (!/^\d{4}$/.test(normalizedPin)) {
      throw new Error('El PIN debe tener exactamente 4 digitos.');
    }

    return normalizedPin;
  }

  function isConfigured(config) {
    return Boolean(normalizeSecurityConfig(config));
  }

  async function createSecurityConfig(pin) {
    const safePin = validatePin(pin);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveAesKey(safePin, salt, iterations);
    const verifierPayload = await encryptWithKey(key, PIN_VERIFIER_TEXT);

    return {
      version: 1,
      iterations,
      saltB64: toBase64(salt),
      verifierIvB64: verifierPayload.ivB64,
      verifierCipherB64: verifierPayload.cipherB64,
      createdAt: Date.now()
    };
  }

  async function verifyPin(pin, securityConfig) {
    const safePin = validatePin(pin);
    const config = normalizeSecurityConfig(securityConfig);
    if (!config) {
      throw new Error('No hay PIN configurado.');
    }

    try {
      const salt = fromBase64(config.saltB64);
      const key = await deriveAesKey(safePin, salt, config.iterations);
      const plain = await decryptWithKey(key, {
        ivB64: config.verifierIvB64,
        cipherB64: config.verifierCipherB64
      });
      return plain === PIN_VERIFIER_TEXT;
    } catch (_) {
      return false;
    }
  }

  async function encryptSecret(pin, securityConfig, plainText) {
    const safePin = validatePin(pin);
    const config = normalizeSecurityConfig(securityConfig);
    if (!config) {
      throw new Error('No hay PIN configurado.');
    }

    const salt = fromBase64(config.saltB64);
    const key = await deriveAesKey(safePin, salt, config.iterations);
    return encryptWithKey(key, String(plainText || ''));
  }

  async function decryptSecret(pin, securityConfig, payload) {
    const safePin = validatePin(pin);
    const config = normalizeSecurityConfig(securityConfig);
    if (!config) {
      throw new Error('No hay PIN configurado.');
    }

    try {
      const salt = fromBase64(config.saltB64);
      const key = await deriveAesKey(safePin, salt, config.iterations);
      return await decryptWithKey(key, payload);
    } catch (_) {
      throw new Error('No se pudo descifrar. Verifica el PIN.');
    }
  }

  return {
    isConfigured,
    validatePin,
    createSecurityConfig,
    verifyPin,
    encryptSecret,
    decryptSecret
  };
}
