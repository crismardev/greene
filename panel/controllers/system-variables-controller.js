export function createSystemVariablesController(options = {}) {
  const cfg = options && typeof options === 'object' ? options : {}

  const scopeOrder = Object.freeze([
    'prompts',
    'chat',
    'context',
    'bootstrap',
    'whatsapp',
    'ai',
    'memory',
    'runtime',
    'storage',
    'defaults'
  ])

  const scopeLabels = Object.freeze({
    prompts: 'Prompts',
    chat: 'Chat',
    context: 'Contexto',
    bootstrap: 'Bootstrap',
    whatsapp: 'WhatsApp',
    ai: 'AI',
    memory: 'Memoria',
    runtime: 'Runtime',
    storage: 'Storage',
    defaults: 'Defaults'
  })

  const definitions = Object.freeze([
    {
      id: 'prompts.assistantSystem',
      scope: 'prompts',
      key: 'panelSettings.systemPrompt',
      label: 'Assistant system prompt',
      type: 'prompt',
      target: 'systemPrompt',
      defaultValue: String(cfg.defaultChatSystemPrompt || ''),
      required: true,
      description: 'Prompt principal del chat para la tool "Chat".'
    },
    {
      id: 'prompts.whatsappSuggestionBase',
      scope: 'prompts',
      key: 'prompts.whatsappSuggestionBase',
      label: 'WhatsApp suggestion base prompt',
      type: 'prompt',
      defaultValue: String(cfg.defaultWhatsappSuggestionBasePrompt || ''),
      required: true,
      description: 'Bloque base que define como redactar sugerencias automaticas para WhatsApp.'
    },
    {
      id: 'prompts.writeEmailSystem',
      scope: 'prompts',
      key: 'prompts.writeEmailSystem',
      label: 'Write email system prompt',
      type: 'prompt',
      defaultValue: String(cfg.defaultWriteEmailSystemPrompt || ''),
      required: true,
      description: 'Prompt usado por la tool "Write an email".'
    },
    {
      id: 'chat.maxContextMessages',
      scope: 'chat',
      key: 'MAX_CHAT_CONTEXT_MESSAGES',
      type: 'number',
      defaultValue: Number(cfg.maxChatContextMessages) || 20,
      min: 1,
      max: 60,
      step: 1,
      description: 'Cantidad de mensajes previos usados para construir el prompt de chat.'
    },
    {
      id: 'chat.maxHistoryMessages',
      scope: 'chat',
      key: 'MAX_CHAT_HISTORY_MESSAGES',
      type: 'number',
      defaultValue: Number(cfg.maxChatHistoryMessages) || 160,
      min: 40,
      max: Number(cfg.maxChatHistoryStorageLimit) || 600,
      step: 1,
      description: 'Cantidad maxima de mensajes persistidos en historial local.'
    },
    {
      id: 'chat.maxLocalToolCalls',
      scope: 'chat',
      key: 'MAX_LOCAL_TOOL_CALLS',
      type: 'number',
      defaultValue: Number(cfg.maxLocalToolCalls) || 3,
      min: 1,
      max: 8,
      step: 1,
      description: 'Numero maximo de tools locales permitidas por respuesta.'
    },
    {
      id: 'context.maxTabsForAiSummary',
      scope: 'context',
      key: 'MAX_TABS_FOR_AI_SUMMARY',
      type: 'number',
      defaultValue: Number(cfg.maxTabsForAiSummary) || 20,
      min: 1,
      max: 120,
      step: 1,
      description: 'Tabs maximas consideradas para resumen e ingesta de contexto.'
    },
    {
      id: 'context.tabSummaryMaxChars',
      scope: 'context',
      key: 'TAB_SUMMARY_MAX_CHARS',
      type: 'number',
      defaultValue: Number(cfg.tabSummaryMaxChars) || 160,
      min: 80,
      max: 800,
      step: 1,
      description: 'Longitud maxima por resumen de tab.'
    },
    {
      id: 'context.incrementalHistoryIngestLimit',
      scope: 'context',
      key: 'INCREMENTAL_HISTORY_INGEST_LIMIT',
      type: 'number',
      defaultValue: Number(cfg.incrementalHistoryIngestLimit) || 80,
      min: 20,
      max: 1200,
      step: 1,
      description: 'Registros de historial usados por ingesta incremental en snapshots.'
    },
    {
      id: 'bootstrap.initialContextSyncHistoryLimit',
      scope: 'bootstrap',
      key: 'INITIAL_CONTEXT_SYNC_HISTORY_LIMIT',
      type: 'number',
      defaultValue: Number(cfg.initialContextSyncHistoryLimit) || 320,
      min: 80,
      max: 1200,
      step: 1,
      description: 'Limite de historial para sincronizacion inicial.'
    },
    {
      id: 'bootstrap.initialContextSyncHistoryDays',
      scope: 'bootstrap',
      key: 'INITIAL_CONTEXT_SYNC_HISTORY_DAYS',
      type: 'number',
      defaultValue: Number(cfg.initialContextSyncHistoryDays) || 45,
      min: 1,
      max: 365,
      step: 1,
      description: 'Dias de historial consultados en bootstrap inicial.'
    },
    {
      id: 'bootstrap.initialContextSyncChatLimit',
      scope: 'bootstrap',
      key: 'INITIAL_CONTEXT_SYNC_CHAT_LIMIT',
      type: 'number',
      defaultValue: Number(cfg.initialContextSyncChatLimit) || 140,
      min: 40,
      max: 500,
      step: 1,
      description: 'Mensajes de chat historico considerados en bootstrap inicial.'
    },
    {
      id: 'bootstrap.initialContextSyncStaleMs',
      scope: 'bootstrap',
      key: 'INITIAL_CONTEXT_SYNC_STALE_MS',
      type: 'number',
      defaultValue: Number(cfg.initialContextSyncStaleMs) || 1000 * 60 * 12,
      min: 1000,
      max: 1000 * 60 * 60 * 12,
      step: 1000,
      description: 'TTL para considerar stale una sincronizacion inicial en estado running.'
    },
    {
      id: 'whatsapp.maxPersistedMessages',
      scope: 'whatsapp',
      key: 'MAX_WHATSAPP_PERSISTED_MESSAGES',
      type: 'number',
      defaultValue: Number(cfg.maxWhatsappPersistedMessages) || 640,
      min: 80,
      max: Number(cfg.maxWhatsappPersistedMessagesStorageLimit) || 2000,
      step: 1,
      description: 'Mensajes maximos por chat en almacenamiento local de WhatsApp.'
    },
    {
      id: 'whatsapp.suggestionHistoryLimit',
      scope: 'whatsapp',
      key: 'WHATSAPP_SUGGESTION_HISTORY_LIMIT',
      type: 'number',
      defaultValue: Number(cfg.whatsappSuggestionHistoryLimit) || 120,
      min: 12,
      max: 300,
      step: 1,
      description: 'Cantidad de mensajes que alimentan el prompt de sugerencias de WhatsApp.'
    },
    {
      id: 'memory.userProfileMaxItems',
      scope: 'memory',
      key: 'MEMORY_USER_PROFILE_MAX_ITEMS',
      type: 'number',
      defaultValue: Number(cfg.memoryUserProfileMaxItems) || 480,
      min: 120,
      max: Number(cfg.memoryUserProfileMaxItemsStorageLimit) || 3000,
      step: 10,
      description: 'Maximo de items agregados en perfil conductual local (relaciones, contactos, sitios, preferencias).'
    }
  ])

  const defaults = Object.freeze(
    definitions.reduce((acc, definition) => {
      if (!definition.target) {
        acc[definition.id] = definition.defaultValue
      }
      return acc
    }, {})
  )

  const definitionById = Object.freeze(
    definitions.reduce((acc, definition) => {
      acc[definition.id] = definition
      return acc
    }, {})
  )

  function formatValue(value) {
    if (value === null || value === undefined) {
      return 'null'
    }

    if (typeof value === 'string') {
      return value || '""'
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value)
    }

    if (typeof value === 'object') {
      return JSON.stringify(value)
    }

    return String(value)
  }

  function coerceValue(definition, rawValue) {
    const meta = definition && typeof definition === 'object' ? definition : {}
    const type = String(meta.type || 'string')

    if (type === 'number') {
      const fallbackValue = Number(meta.defaultValue)
      const fallback = Number.isFinite(fallbackValue) ? fallbackValue : 0
      let numeric = Number(rawValue)
      if (!Number.isFinite(numeric)) {
        numeric = fallback
      }

      if (Number.isFinite(meta.min)) {
        numeric = Math.max(meta.min, numeric)
      }

      if (Number.isFinite(meta.max)) {
        numeric = Math.min(meta.max, numeric)
      }

      const fallbackIsInteger = Number.isInteger(fallback)
      if (fallbackIsInteger || Number.isInteger(meta.step || 1)) {
        numeric = Math.round(numeric)
      }

      return numeric
    }

    const text = String(rawValue || '').trim()
    if (meta.required && !text) {
      return String(meta.defaultValue || '').trim()
    }

    if (type === 'prompt') {
      return text || String(meta.defaultValue || '').trim()
    }

    return text
  }

  function normalizeValues(storedValues) {
    const source = storedValues && typeof storedValues === 'object' ? storedValues : {}
    const normalized = {}

    for (const definition of definitions) {
      if (definition.target) {
        continue
      }

      const hasValue = Object.prototype.hasOwnProperty.call(source, definition.id)
      const value = hasValue ? source[definition.id] : definition.defaultValue
      normalized[definition.id] = coerceValue(definition, value)
    }

    return normalized
  }

  function getDefinition(variableId) {
    const key = String(variableId || '').trim()
    return key ? definitionById[key] || null : null
  }

  function getScopeLabel(scopeId) {
    const scope = String(scopeId || '').trim()
    if (!scope) {
      return 'Sistema'
    }

    return scopeLabels[scope] || scope
  }

  return {
    scopeOrder,
    scopeLabels,
    definitions,
    defaults,
    definitionById,
    formatValue,
    coerceValue,
    normalizeValues,
    getDefinition,
    getScopeLabel
  }
}
