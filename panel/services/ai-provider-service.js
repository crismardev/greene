export const AI_PROVIDER_IDS = Object.freeze({
  OLLAMA: 'ollama',
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  OPENAI_COMPATIBLE: 'openai_compatible'
});

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGES_ENDPOINT = 'https://api.openai.com/v1/images/generations';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const PROVIDER_METADATA = Object.freeze({
  [AI_PROVIDER_IDS.OLLAMA]: {
    label: 'Ollama (Local)',
    requiresApiKey: false
  },
  [AI_PROVIDER_IDS.OPENAI]: {
    label: 'OpenAI',
    requiresApiKey: true
  },
  [AI_PROVIDER_IDS.ANTHROPIC]: {
    label: 'Anthropic',
    requiresApiKey: true
  },
  [AI_PROVIDER_IDS.GEMINI]: {
    label: 'Google Gemini',
    requiresApiKey: true
  },
  [AI_PROVIDER_IDS.OPENAI_COMPATIBLE]: {
    label: 'OpenAI Compatible',
    requiresApiKey: true
  }
});

function parseJsonSafe(response) {
  return response
    .json()
    .then((payload) => payload)
    .catch(() => null);
}

function normalizeProviderId(providerId) {
  const value = String(providerId || '')
    .trim()
    .toLowerCase();

  if (value === AI_PROVIDER_IDS.OPENAI || value === 'open-ai') {
    return AI_PROVIDER_IDS.OPENAI;
  }

  if (value === AI_PROVIDER_IDS.ANTHROPIC) {
    return AI_PROVIDER_IDS.ANTHROPIC;
  }

  if (value === AI_PROVIDER_IDS.GEMINI || value === 'google' || value === 'google-gemini') {
    return AI_PROVIDER_IDS.GEMINI;
  }

  if (value === AI_PROVIDER_IDS.OPENAI_COMPATIBLE || value === 'openai-compatible' || value === 'third-party') {
    return AI_PROVIDER_IDS.OPENAI_COMPATIBLE;
  }

  return AI_PROVIDER_IDS.OLLAMA;
}

function getProviderMetadata(providerId) {
  const provider = normalizeProviderId(providerId);
  return PROVIDER_METADATA[provider] || PROVIDER_METADATA[AI_PROVIDER_IDS.OLLAMA];
}

function requiresApiKey(providerId) {
  return getProviderMetadata(providerId).requiresApiKey === true;
}

function collectTextParts(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (part && typeof part === 'object') {
        return String(part.text || part.value || '');
      }

      return '';
    })
    .join('');
}

function toChatMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = message?.role === 'system' || message?.role === 'assistant' ? message.role : 'user';
      const content = String(message?.content || '').trim();
      if (!content) {
        return null;
      }

      return {
        role,
        content
      };
    })
    .filter(Boolean);
}

async function consumeSse(responseBody, onPayload) {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventLines = [];

  const flushEvent = () => {
    if (!eventLines.length) {
      return;
    }

    const data = eventLines.join('\n').trim();
    eventLines = [];

    if (!data || data === '[DONE]') {
      return;
    }

    onPayload(JSON.parse(data));
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const lineRaw of lines) {
      const line = lineRaw.trim();

      if (!line) {
        flushEvent();
        continue;
      }

      if (line.startsWith('data:')) {
        eventLines.push(line.slice(5).trim());
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim().startsWith('data:')) {
    eventLines.push(buffer.trim().slice(5).trim());
  }

  flushEvent();
}

function extractOpenAiError(payload, status) {
  const detail =
    payload?.error?.message || payload?.message || payload?.detail || (Number.isFinite(status) ? `HTTP ${status}` : 'Request error');
  return String(detail || 'OpenAI error');
}

async function streamOpenAiLikeChat({
  endpoint,
  model,
  apiKey,
  temperature,
  messages,
  onChunk,
  providerLabel,
  extraHeaders
}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(extraHeaders || {})
  };

  const payload = {
    model,
    messages,
    temperature,
    stream: true
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorPayload = await parseJsonSafe(response);
    throw new Error(`${providerLabel} error: ${extractOpenAiError(errorPayload, response.status)}`);
  }

  let text = '';

  if (response.body) {
    await consumeSse(response.body, (chunkPayload) => {
      if (chunkPayload?.error) {
        throw new Error(`${providerLabel} error: ${extractOpenAiError(chunkPayload, response.status)}`);
      }

      const delta = chunkPayload?.choices?.[0]?.delta;
      const chunkText = collectTextParts(delta?.content || chunkPayload?.choices?.[0]?.text);
      if (!chunkText) {
        return;
      }

      text += chunkText;
      onChunk(chunkText);
    });
  }

  if (text.trim()) {
    return text;
  }

  const fallbackResponse = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      stream: false
    })
  });

  const fallbackPayload = await parseJsonSafe(fallbackResponse);

  if (!fallbackResponse.ok) {
    throw new Error(`${providerLabel} error: ${extractOpenAiError(fallbackPayload, fallbackResponse.status)}`);
  }

  const fallbackText = collectTextParts(fallbackPayload?.choices?.[0]?.message?.content || fallbackPayload?.choices?.[0]?.text);
  if (!fallbackText.trim()) {
    throw new Error(`${providerLabel} no devolvio contenido.`);
  }

  onChunk(fallbackText);
  return fallbackText;
}

function toAnthropicMessages(messages) {
  return messages
    .filter((item) => item.role !== 'system')
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: [
        {
          type: 'text',
          text: item.content
        }
      ]
    }));
}

function toAnthropicSystemPrompt(messages) {
  const systemLines = messages.filter((item) => item.role === 'system').map((item) => item.content.trim()).filter(Boolean);
  return systemLines.join('\n\n');
}

function extractAnthropicError(payload, status) {
  const detail =
    payload?.error?.message || payload?.message || payload?.detail || (Number.isFinite(status) ? `HTTP ${status}` : 'Request error');
  return String(detail || 'Anthropic error');
}

async function streamAnthropicChat({ model, apiKey, temperature, messages, onChunk }) {
  const anthropicMessages = toAnthropicMessages(messages);
  if (!anthropicMessages.length) {
    anthropicMessages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Hola'
        }
      ]
    });
  }

  const systemPrompt = toAnthropicSystemPrompt(messages);
  const basePayload = {
    model,
    max_tokens: 1024,
    temperature,
    messages: anthropicMessages
  };

  if (systemPrompt) {
    basePayload.system = systemPrompt;
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true'
  };

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...basePayload,
      stream: true
    })
  });

  if (!response.ok) {
    const errorPayload = await parseJsonSafe(response);
    throw new Error(`Anthropic error: ${extractAnthropicError(errorPayload, response.status)}`);
  }

  let text = '';

  if (response.body) {
    await consumeSse(response.body, (chunkPayload) => {
      if (chunkPayload?.type === 'error') {
        throw new Error(`Anthropic error: ${extractAnthropicError(chunkPayload, response.status)}`);
      }

      const chunkText = String(chunkPayload?.delta?.text || chunkPayload?.content_block?.text || '');
      if (!chunkText) {
        return;
      }

      text += chunkText;
      onChunk(chunkText);
    });
  }

  if (text.trim()) {
    return text;
  }

  const fallbackResponse = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...basePayload,
      stream: false
    })
  });

  const fallbackPayload = await parseJsonSafe(fallbackResponse);

  if (!fallbackResponse.ok) {
    throw new Error(`Anthropic error: ${extractAnthropicError(fallbackPayload, fallbackResponse.status)}`);
  }

  const fallbackText = (Array.isArray(fallbackPayload?.content) ? fallbackPayload.content : [])
    .map((item) => String(item?.text || ''))
    .join('');

  if (!fallbackText.trim()) {
    throw new Error('Anthropic no devolvio contenido.');
  }

  onChunk(fallbackText);
  return fallbackText;
}

function toGeminiPayload(messages, temperature) {
  const contents = [];
  const systemParts = [];

  for (const message of messages) {
    const text = String(message.content || '').trim();
    if (!text) {
      continue;
    }

    if (message.role === 'system') {
      systemParts.push({ text });
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }]
    });
  }

  if (!contents.length) {
    contents.push({
      role: 'user',
      parts: [{ text: 'Hola' }]
    });
  }

  const payload = {
    contents,
    generationConfig: {
      temperature
    }
  };

  if (systemParts.length) {
    payload.systemInstruction = { parts: systemParts };
  }

  return payload;
}

function extractGeminiText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parts = [];

  for (const candidate of candidates) {
    const blocks = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of blocks) {
      const text = String(part?.text || '');
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join('');
}

function extractGeminiError(payload, status) {
  const detail =
    payload?.error?.message || payload?.message || payload?.detail || (Number.isFinite(status) ? `HTTP ${status}` : 'Request error');
  return String(detail || 'Gemini error');
}

async function streamGeminiChat({ model, apiKey, temperature, messages, onChunk }) {
  const payload = toGeminiPayload(messages, temperature);
  const streamEndpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(streamEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorPayload = await parseJsonSafe(response);
    throw new Error(`Gemini error: ${extractGeminiError(errorPayload, response.status)}`);
  }

  let text = '';

  if (response.body) {
    await consumeSse(response.body, (chunkPayload) => {
      if (chunkPayload?.error) {
        throw new Error(`Gemini error: ${extractGeminiError(chunkPayload, response.status)}`);
      }

      const chunkText = extractGeminiText(chunkPayload);
      if (!chunkText) {
        return;
      }

      text += chunkText;
      onChunk(chunkText);
    });
  }

  if (text.trim()) {
    return text;
  }

  const fallbackEndpoint = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fallbackResponse = await fetch(fallbackEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const fallbackPayload = await parseJsonSafe(fallbackResponse);

  if (!fallbackResponse.ok) {
    throw new Error(`Gemini error: ${extractGeminiError(fallbackPayload, fallbackResponse.status)}`);
  }

  const fallbackText = extractGeminiText(fallbackPayload);
  if (!fallbackText.trim()) {
    throw new Error('Gemini no devolvio contenido.');
  }

  onChunk(fallbackText);
  return fallbackText;
}

function resolveOpenAiCompatibleEndpoint(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) {
    throw new Error('Debes configurar una Base URL para provider OpenAI Compatible.');
  }

  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('La Base URL debe iniciar con http:// o https://.');
  }

  const clean = raw.replace(/\/+$/, '');

  if (/\/chat\/completions$/i.test(clean)) {
    return clean;
  }

  if (/\/v1$/i.test(clean)) {
    return `${clean}/chat/completions`;
  }

  return `${clean}/v1/chat/completions`;
}

function resolveOpenAiCompatibleImageEndpoint(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) {
    throw new Error('Debes configurar una Base URL para provider OpenAI Compatible.');
  }

  if (!/^https?:\/\//i.test(raw)) {
    throw new Error('La Base URL debe iniciar con http:// o https://.');
  }

  const clean = raw.replace(/\/+$/, '');

  if (/\/images\/generations$/i.test(clean)) {
    return clean;
  }

  if (/\/v1$/i.test(clean)) {
    return `${clean}/images/generations`;
  }

  return `${clean}/v1/images/generations`;
}

async function generateOpenAiLikeImage({
  endpoint,
  model,
  apiKey,
  prompt,
  providerLabel,
  size = '1024x1024'
}) {
  const safePrompt = String(prompt || '').trim();
  if (!safePrompt) {
    throw new Error('Prompt vacio para generar imagen.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt: safePrompt,
      size,
      n: 1
    })
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(`${providerLabel} image error: ${extractOpenAiError(payload, response.status)}`);
  }

  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  const imageUrl = String(first?.url || '').trim();
  const b64 = String(first?.b64_json || '').trim();
  const revisedPrompt = String(first?.revised_prompt || '').trim();

  if (!imageUrl && !b64) {
    throw new Error(`${providerLabel} no devolvio imagen.`);
  }

  return {
    imageUrl,
    imageDataUrl: b64 ? `data:image/png;base64,${b64}` : '',
    revisedPrompt
  };
}

function resolveImageModelName(model) {
  const token = String(model || '')
    .trim()
    .toLowerCase();
  if (!token) {
    return 'gpt-image-1';
  }

  if (token.includes('image') || token.includes('dall-e') || token.includes('dalle')) {
    return String(model || '').trim();
  }

  return 'gpt-image-1';
}

function buildModelProfileId() {
  return `model-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createAiProviderService({
  ollamaService,
  defaultOllamaModel,
  localKeepAlive
}) {
  function getProviderFallbackModel(provider) {
    if (provider === AI_PROVIDER_IDS.OPENAI) {
      return 'gpt-4o-mini';
    }
    if (provider === AI_PROVIDER_IDS.ANTHROPIC) {
      return 'claude-3-5-sonnet-latest';
    }
    if (provider === AI_PROVIDER_IDS.GEMINI) {
      return 'gemini-2.0-flash';
    }
    if (provider === AI_PROVIDER_IDS.OPENAI_COMPATIBLE) {
      return 'gpt-4o-mini';
    }

    return defaultOllamaModel;
  }

  function createDefaultProfiles() {
    return [
      {
        id: 'model-local-ollama',
        name: 'Local Ollama',
        provider: AI_PROVIDER_IDS.OLLAMA,
        model: defaultOllamaModel,
        baseUrl: '',
        hasApiKey: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'model-openai-main',
        name: 'OpenAI',
        provider: AI_PROVIDER_IDS.OPENAI,
        model: 'gpt-4o-mini',
        baseUrl: '',
        hasApiKey: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'model-anthropic-main',
        name: 'Anthropic',
        provider: AI_PROVIDER_IDS.ANTHROPIC,
        model: 'claude-3-5-sonnet-latest',
        baseUrl: '',
        hasApiKey: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'model-gemini-main',
        name: 'Gemini',
        provider: AI_PROVIDER_IDS.GEMINI,
        model: 'gemini-2.0-flash',
        baseUrl: '',
        hasApiKey: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
  }

  function normalizeProfile(rawProfile, fallbackIndex = 0) {
    const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
    const provider = normalizeProviderId(source.provider);
    const model = String(source.model || '').trim() || getProviderFallbackModel(provider);
    const name = String(source.name || '').trim() || `${getProviderMetadata(provider).label} ${model}`;

    return {
      id: String(source.id || '').trim() || `${provider}-${fallbackIndex}-${Math.random().toString(16).slice(2, 8)}`,
      name,
      provider,
      model,
      baseUrl: String(source.baseUrl || '').trim(),
      hasApiKey: Boolean(source.hasApiKey),
      createdAt: Number(source.createdAt) || Date.now(),
      updatedAt: Number(source.updatedAt) || Date.now()
    };
  }

  async function streamWithProfile({ profile, messages, temperature, apiKey, onChunk }) {
    const safeProfile = normalizeProfile(profile);
    const safeMessages = toChatMessages(messages);
    const safeTemperature = Number.isFinite(temperature) ? temperature : 0.7;

    if (!safeMessages.length) {
      throw new Error('No hay mensajes para enviar al modelo.');
    }

    if (safeProfile.provider === AI_PROVIDER_IDS.OLLAMA) {
      try {
        return await ollamaService.streamWithOllamaChat(safeProfile.model, safeMessages, safeTemperature, onChunk);
      } catch (error) {
        const fallbackPrompt = ollamaService.buildFallbackPrompt(safeMessages);
        return ollamaService.streamWithOllamaPrompt(safeProfile.model, fallbackPrompt, safeTemperature, onChunk);
      }
    }

    if (!apiKey) {
      throw new Error(`Falta API key para ${getProviderMetadata(safeProfile.provider).label}.`);
    }

    if (safeProfile.provider === AI_PROVIDER_IDS.OPENAI) {
      return streamOpenAiLikeChat({
        endpoint: OPENAI_ENDPOINT,
        model: safeProfile.model,
        apiKey,
        temperature: safeTemperature,
        messages: safeMessages,
        onChunk,
        providerLabel: 'OpenAI'
      });
    }

    if (safeProfile.provider === AI_PROVIDER_IDS.ANTHROPIC) {
      return streamAnthropicChat({
        model: safeProfile.model,
        apiKey,
        temperature: safeTemperature,
        messages: safeMessages,
        onChunk
      });
    }

    if (safeProfile.provider === AI_PROVIDER_IDS.GEMINI) {
      return streamGeminiChat({
        model: safeProfile.model,
        apiKey,
        temperature: safeTemperature,
        messages: safeMessages,
        onChunk
      });
    }

    const endpoint = resolveOpenAiCompatibleEndpoint(safeProfile.baseUrl);
    return streamOpenAiLikeChat({
      endpoint,
      model: safeProfile.model,
      apiKey,
      temperature: safeTemperature,
      messages: safeMessages,
      onChunk,
      providerLabel: 'OpenAI Compatible'
    });
  }

  async function warmupProfile(profile) {
    const safeProfile = normalizeProfile(profile);
    if (safeProfile.provider !== AI_PROVIDER_IDS.OLLAMA) {
      return true;
    }

    await ollamaService.warmupLocalModelRequest(safeProfile.model, localKeepAlive);
    return true;
  }

  async function fetchLocalModels(activeModel = defaultOllamaModel) {
    return ollamaService.fetchAvailableModelsFromOllama(activeModel || defaultOllamaModel);
  }

  async function generateImageWithProfile({ profile, prompt, apiKey, size = '1024x1024' }) {
    const safeProfile = normalizeProfile(profile);
    if (!apiKey) {
      throw new Error(`Falta API key para ${getProviderMetadata(safeProfile.provider).label}.`);
    }

    if (safeProfile.provider === AI_PROVIDER_IDS.OPENAI) {
      return generateOpenAiLikeImage({
        endpoint: OPENAI_IMAGES_ENDPOINT,
        model: resolveImageModelName(safeProfile.model),
        apiKey,
        prompt,
        providerLabel: 'OpenAI',
        size
      });
    }

    if (safeProfile.provider === AI_PROVIDER_IDS.OPENAI_COMPATIBLE) {
      return generateOpenAiLikeImage({
        endpoint: resolveOpenAiCompatibleImageEndpoint(safeProfile.baseUrl),
        model: resolveImageModelName(safeProfile.model),
        apiKey,
        prompt,
        providerLabel: 'OpenAI Compatible',
        size
      });
    }

    throw new Error('Generacion de imagen soportada solo en OpenAI/OpenAI-compatible.');
  }

  return {
    AI_PROVIDER_IDS,
    buildModelProfileId,
    createDefaultProfiles,
    normalizeProviderId,
    getProviderMetadata,
    normalizeProfile,
    requiresApiKey,
    streamWithProfile,
    generateImageWithProfile,
    warmupProfile,
    fetchLocalModels
  };
}
