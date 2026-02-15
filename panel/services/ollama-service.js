export function createOllamaService({
  defaultModel,
  localKeepAlive,
  chatEndpoints,
  generateEndpoints,
  tagsEndpoints
}) {
  function parseJsonSafe(response) {
    return response
      .json()
      .then((payload) => payload)
      .catch(() => null);
  }

  function buildFallbackPrompt(messages) {
    const lines = [];

    for (const message of messages) {
      const roleLabel =
        message.role === 'system' ? 'System' : message.role === 'assistant' ? 'Assistant' : 'User';

      lines.push(`${roleLabel}: ${message.content}`);
    }

    lines.push('Assistant:');
    return lines.join('\n\n');
  }

  function extractOllamaDetail(payload, statusCode, modelName = defaultModel) {
    const rawDetail = (payload && (payload.error || payload.message || payload.detail)) || `HTTP ${statusCode}`;
    const detail = String(rawDetail);
    const safeModel = modelName || defaultModel;

    if (detail.includes('not found') && detail.includes('model')) {
      return `Modelo local "${safeModel}" no encontrado. Ejecuta \`ollama pull ${safeModel}\` y vuelve a intentar.`;
    }

    return detail;
  }

  function parseOllamaStreamLine(rawLine) {
    const line = rawLine.trim();
    if (!line) {
      return null;
    }

    const cleanLine = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (!cleanLine || cleanLine === '[DONE]') {
      return null;
    }

    return JSON.parse(cleanLine);
  }

  async function consumeNdjsonStream(body, onPayload) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() || '';

      for (const rawLine of parts) {
        const payload = parseOllamaStreamLine(rawLine);
        if (payload) {
          onPayload(payload);
        }
      }
    }

    buffer += decoder.decode();
    const tailPayload = parseOllamaStreamLine(buffer);
    if (tailPayload) {
      onPayload(tailPayload);
    }
  }

  async function streamWithEndpointList({ endpoints, bodyPayload, onChunk, payloadTextGetter, model }) {
    let lastDetail = '';

    for (const endpoint of endpoints) {
      let response;

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(bodyPayload)
        });
      } catch (_) {
        continue;
      }

      if (!response.ok) {
        const payload = await parseJsonSafe(response);
        if (response.status === 403) {
          throw new Error(
            'Ollama rechazo el origen de la extension (403). Reinicia Ollama con OLLAMA_ORIGINS="chrome-extension://*".'
          );
        }

        lastDetail = extractOllamaDetail(payload, response.status, model);
        continue;
      }

      let text = '';

      if (response.body) {
        await consumeNdjsonStream(response.body, (payload) => {
          if (payload && payload.error) {
            throw new Error(extractOllamaDetail(payload, response.status, model));
          }

          const chunk = payloadTextGetter(payload);
          if (!chunk) {
            return;
          }

          text += chunk;
          onChunk(chunk);
        });
      } else {
        const payload = await parseJsonSafe(response);
        const chunk = payloadTextGetter(payload);
        if (chunk) {
          text += chunk;
          onChunk(chunk);
        }
      }

      if (text.trim()) {
        return text;
      }

      lastDetail = 'Ollama no devolvio texto para la respuesta.';
    }

    if (lastDetail) {
      throw new Error(`Ollama error: ${lastDetail}`);
    }

    throw new Error(
      'No se pudo conectar con Ollama en localhost:11434. Inicia Ollama con `ollama serve` o abre la app Ollama.'
    );
  }

  async function streamWithOllamaChat(model, messages, temperature, onChunk) {
    return streamWithEndpointList({
      endpoints: chatEndpoints,
      model,
      onChunk,
      bodyPayload: {
        model,
        stream: true,
        options: {
          temperature
        },
        messages
      },
      payloadTextGetter: (payload) => (typeof payload?.message?.content === 'string' ? payload.message.content : '')
    });
  }

  async function streamWithOllamaPrompt(model, prompt, temperature, onChunk) {
    return streamWithEndpointList({
      endpoints: generateEndpoints,
      model,
      onChunk,
      bodyPayload: {
        model,
        prompt,
        stream: true,
        options: {
          temperature
        }
      },
      payloadTextGetter: (payload) => (typeof payload?.response === 'string' ? payload.response : '')
    });
  }

  async function warmupLocalModelRequest(model) {
    let lastDetail = '';

    for (const endpoint of generateEndpoints) {
      let response;

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            prompt: 'ping',
            stream: false,
            keep_alive: localKeepAlive,
            options: {
              temperature: 0,
              num_predict: 1
            }
          })
        });
      } catch (_) {
        continue;
      }

      const payload = await parseJsonSafe(response);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(
            'Ollama rechazo el origen de la extension (403). Reinicia Ollama con OLLAMA_ORIGINS="chrome-extension://*".'
          );
        }

        lastDetail = extractOllamaDetail(payload, response.status, model);
        continue;
      }

      if (payload && payload.error) {
        lastDetail = extractOllamaDetail(payload, response.status, model);
        continue;
      }

      return true;
    }

    if (lastDetail) {
      throw new Error(`Ollama error: ${lastDetail}`);
    }

    throw new Error(
      'No se pudo conectar con Ollama para precarga. Inicia Ollama con `ollama serve` o abre la app Ollama.'
    );
  }

  async function fetchAvailableModelsFromOllama(modelName = defaultModel) {
    let lastDetail = '';

    for (const endpoint of tagsEndpoints) {
      let response;

      try {
        response = await fetch(endpoint);
      } catch (_) {
        continue;
      }

      const payload = await parseJsonSafe(response);

      if (!response.ok) {
        lastDetail = extractOllamaDetail(payload, response.status, modelName);
        continue;
      }

      const modelsRaw = Array.isArray(payload?.models) ? payload.models : [];
      const names = modelsRaw
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return '';
          }

          return String(item.name || item.model || '').trim();
        })
        .filter(Boolean);

      if (names.length) {
        return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
      }

      lastDetail = 'Ollama no devolvio modelos en /api/tags.';
    }

    throw new Error(lastDetail || 'No se pudo cargar /api/tags desde Ollama.');
  }

  return {
    buildFallbackPrompt,
    fetchAvailableModelsFromOllama,
    streamWithOllamaChat,
    streamWithOllamaPrompt,
    warmupLocalModelRequest
  };
}
