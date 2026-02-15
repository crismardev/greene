import {
  buildDefaultChatSystemPrompt,
  DEFAULT_ASSISTANT_LANGUAGE
} from './services/prompt-service.js';
import { marked } from '../node_modules/marked/lib/marked.esm.js';
import { setStatus } from './services/status-service.js';
import { createPanelStorageService } from './services/panel-storage-service.js';
import { createOllamaService } from './services/ollama-service.js';
import { createAiProviderService, AI_PROVIDER_IDS } from './services/ai-provider-service.js';
import { createPinCryptoService } from './services/pin-crypto-service.js';
import { createSettingsScreenController } from './screens/settings-screen.js';
import { createTabContextService } from './services/tab-context-service.js';
import { createContextMemoryService } from './services/context-memory-service.js';
import { createPostgresService } from './services/postgres-service.js';
import { buildTabSummaryPrompt, toJsonTabRecord } from './services/site-context/generic-site-context.js';
import {
  buildWhatsappMetaLabel,
  buildWhatsappReplyPrompt,
  DEFAULT_WHATSAPP_REPLY_PROMPT_BASE,
  buildWhatsappSignalKey,
  getWhatsappChatKey,
  hasWhatsappConversationHistory,
  isWhatsappContext
} from './services/site-context/whatsapp-site-context.js';

export function initPanelApp() {
  'use strict';

  const cfg = window.GreenStudioToolsConfig;
  if (!cfg) {
    return;
  }

  const LOG_PREFIX = '[greenstudio-ext/panel]';

  const { TOOL_KEYS, PREFERENCE_KEYS, DEFAULT_SETTINGS, APPLY_MESSAGE_TYPE } = cfg;

  const TOOL_SEQUENCE = Object.freeze(['image', 'retool']);
  const SETTINGS_PAGES = Object.freeze({
    HOME: 'home',
    USER: 'user',
    ASSISTANT: 'assistant',
    AI_MODELS: 'ai_models',
    CRM_ERP_DATABASE: 'crm_erp_database',
    TABS: 'tabs',
    SYSTEM_VARIABLES: 'system_variables'
  });
  const PIN_MODAL_MODES = Object.freeze({
    SETUP: 'setup',
    UNLOCK: 'unlock'
  });
  const SECRET_KEY_PREFIX = 'ai-key::';
  const PIN_UNLOCK_SESSION_STORAGE_KEY = 'greenstudio_pin_unlock_session_v1';
  const PIN_UNLOCK_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
  const SCREEN_INDEX = Object.freeze({
    onboarding: 0,
    home: 1,
    tools: 2,
    settings: 3
  });
  const DEFAULT_CHAT_SYSTEM_PROMPT = buildDefaultChatSystemPrompt(DEFAULT_ASSISTANT_LANGUAGE);
  const DEFAULT_WRITE_EMAIL_SYSTEM_PROMPT = [
    'Eres un asistente para redactar emails claros y accionables.',
    'Siempre responde con un correo listo para enviar en formato:',
    'Asunto: ...',
    '',
    'Cuerpo:',
    '...',
    'Si faltan datos, usa placeholders cortos entre corchetes.'
  ].join('\n');
  const CHAT_TOOLS = Object.freeze({
    chat: {
      label: 'Chat',
      systemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT
    },
    write_email: {
      label: 'Write an email',
      systemPrompt: DEFAULT_WRITE_EMAIL_SYSTEM_PROMPT
    }
  });

  const BRAND_EMOTION_FILES = Object.freeze({
    neutral: 'assets/greene-eyes/eyes_neutral.svg',
    angry: 'assets/greene-eyes/eyes_angry.svg',
    anxious: 'assets/greene-eyes/eyes_asiety.svg',
    confused: 'assets/greene-eyes/eyes_confused.svg',
    excited: 'assets/greene-eyes/eyes_exited.svg',
    intrigued: 'assets/greene-eyes/eyes_intrigated.svg',
    disappointed: 'assets/greene-eyes/eyes_deceptioned.svg',
    wtf: 'assets/greene-eyes/eyes_wtf.svg'
  });

  const BRAND_EMOTION_ALIASES = Object.freeze({
    neutral: 'neutral',
    calm: 'neutral',
    angry: 'angry',
    enojo: 'angry',
    enojado: 'angry',
    anxious: 'anxious',
    anxiety: 'anxious',
    ansioso: 'anxious',
    asiety: 'anxious',
    confused: 'confused',
    confusion: 'confused',
    confundido: 'confused',
    excited: 'excited',
    exited: 'excited',
    emocionado: 'excited',
    intrigued: 'intrigued',
    intrigue: 'intrigued',
    intrigated: 'intrigued',
    disappointed: 'disappointed',
    deceptioned: 'disappointed',
    decepcionado: 'disappointed',
    wtf: 'wtf'
  });

  const BRAND_EMOTION_NAMES = Object.freeze(Object.keys(BRAND_EMOTION_FILES));
  const BRAND_EMOTION_POINT_COUNT = 72;
  const BRAND_EMOTION_MORPH_DURATION = 420;

  const DEFAULT_CHAT_TOOL = 'chat';
  const MAX_CHAT_INPUT_ROWS = 8;
  const MAX_CHAT_CONTEXT_MESSAGES = 20;
  const MAX_CHAT_HISTORY_MESSAGES = 160;
  const MAX_CHAT_HISTORY_STORAGE_LIMIT = 600;
  const MAX_LOCAL_TOOL_CALLS = 3;
  const MAX_IMAGE_FILES = 10;
  const MAX_TABS_FOR_AI_SUMMARY = 20;
  const TAB_SUMMARY_MAX_CHARS = 160;
  const INCREMENTAL_HISTORY_INGEST_LIMIT = 80;
  const MAX_WHATSAPP_PERSISTED_MESSAGES = 640;
  const MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT = 2000;
  const WHATSAPP_SUGGESTION_HISTORY_LIMIT = 120;

  const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';
  const DEFAULT_PRIMARY_MODEL_ID = 'model-local-ollama';
  const LOCAL_MODEL_KEEP_ALIVE = '20m';
  const OLLAMA_CHAT_ENDPOINTS = Object.freeze([
    'http://localhost:11434/api/chat',
    'http://127.0.0.1:11434/api/chat'
  ]);
  const OLLAMA_GENERATE_ENDPOINTS = Object.freeze([
    'http://localhost:11434/api/generate',
    'http://127.0.0.1:11434/api/generate'
  ]);
  const OLLAMA_TAGS_ENDPOINTS = Object.freeze([
    'http://localhost:11434/api/tags',
    'http://127.0.0.1:11434/api/tags'
  ]);

  const CHAT_DB = Object.freeze({
    NAME: 'greenstudio-chat-db',
    VERSION: 5,
    CHAT_STORE: 'chat_state',
    CHAT_KEY: 'home_history',
    SETTINGS_STORE: 'panel_settings',
    SETTINGS_KEY: 'panel',
    WHATSAPP_STORE: 'whatsapp_chat_state',
    SECRET_STORE: 'panel_secrets'
  });
  const INITIAL_CONTEXT_SYNC_STORAGE_KEY = 'greenstudio_initial_context_sync_v1';
  const INITIAL_CONTEXT_SYNC_VERSION = 1;
  const INITIAL_CONTEXT_SYNC_STALE_MS = 1000 * 60 * 12;
  const INITIAL_CONTEXT_SYNC_HISTORY_LIMIT = 320;
  const INITIAL_CONTEXT_SYNC_HISTORY_DAYS = 45;
  const INITIAL_CONTEXT_SYNC_CHAT_LIMIT = 140;
  const SYSTEM_VARIABLE_SCOPE_ORDER = Object.freeze([
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
  ]);
  const SYSTEM_VARIABLE_SCOPE_LABELS = Object.freeze({
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
  });
  const SYSTEM_VARIABLE_DEFINITIONS = Object.freeze([
    {
      id: 'prompts.assistantSystem',
      scope: 'prompts',
      key: 'panelSettings.systemPrompt',
      label: 'Assistant system prompt',
      type: 'prompt',
      target: 'systemPrompt',
      defaultValue: DEFAULT_CHAT_SYSTEM_PROMPT,
      required: true,
      description: 'Prompt principal del chat para la tool "Chat".'
    },
    {
      id: 'prompts.whatsappSuggestionBase',
      scope: 'prompts',
      key: 'prompts.whatsappSuggestionBase',
      label: 'WhatsApp suggestion base prompt',
      type: 'prompt',
      defaultValue: DEFAULT_WHATSAPP_REPLY_PROMPT_BASE,
      required: true,
      description: 'Bloque base que define como redactar sugerencias automaticas para WhatsApp.'
    },
    {
      id: 'prompts.writeEmailSystem',
      scope: 'prompts',
      key: 'prompts.writeEmailSystem',
      label: 'Write email system prompt',
      type: 'prompt',
      defaultValue: DEFAULT_WRITE_EMAIL_SYSTEM_PROMPT,
      required: true,
      description: 'Prompt usado por la tool "Write an email".'
    },
    {
      id: 'chat.maxContextMessages',
      scope: 'chat',
      key: 'MAX_CHAT_CONTEXT_MESSAGES',
      type: 'number',
      defaultValue: MAX_CHAT_CONTEXT_MESSAGES,
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
      defaultValue: MAX_CHAT_HISTORY_MESSAGES,
      min: 40,
      max: MAX_CHAT_HISTORY_STORAGE_LIMIT,
      step: 1,
      description: 'Cantidad maxima de mensajes persistidos en historial local.'
    },
    {
      id: 'chat.maxLocalToolCalls',
      scope: 'chat',
      key: 'MAX_LOCAL_TOOL_CALLS',
      type: 'number',
      defaultValue: MAX_LOCAL_TOOL_CALLS,
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
      defaultValue: MAX_TABS_FOR_AI_SUMMARY,
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
      defaultValue: TAB_SUMMARY_MAX_CHARS,
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
      defaultValue: INCREMENTAL_HISTORY_INGEST_LIMIT,
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
      defaultValue: INITIAL_CONTEXT_SYNC_HISTORY_LIMIT,
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
      defaultValue: INITIAL_CONTEXT_SYNC_HISTORY_DAYS,
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
      defaultValue: INITIAL_CONTEXT_SYNC_CHAT_LIMIT,
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
      defaultValue: INITIAL_CONTEXT_SYNC_STALE_MS,
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
      defaultValue: MAX_WHATSAPP_PERSISTED_MESSAGES,
      min: 80,
      max: MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT,
      step: 1,
      description: 'Mensajes maximos por chat en almacenamiento local de WhatsApp.'
    },
    {
      id: 'whatsapp.suggestionHistoryLimit',
      scope: 'whatsapp',
      key: 'WHATSAPP_SUGGESTION_HISTORY_LIMIT',
      type: 'number',
      defaultValue: WHATSAPP_SUGGESTION_HISTORY_LIMIT,
      min: 12,
      max: 300,
      step: 1,
      description: 'Cantidad de mensajes que alimentan el prompt de sugerencias de WhatsApp.'
    }
  ]);
  const SYSTEM_VARIABLE_DEFAULTS = Object.freeze(
    SYSTEM_VARIABLE_DEFINITIONS.reduce((acc, definition) => {
      if (!definition.target) {
        acc[definition.id] = definition.defaultValue;
      }
      return acc;
    }, {})
  );
  const SYSTEM_VARIABLE_DEFINITION_BY_ID = Object.freeze(
    SYSTEM_VARIABLE_DEFINITIONS.reduce((acc, definition) => {
      acc[definition.id] = definition;
      return acc;
    }, {})
  );

  function createPreloadedModelProfiles() {
    const now = Date.now();
    return [
      {
        id: DEFAULT_PRIMARY_MODEL_ID,
        name: 'Local Ollama',
        provider: AI_PROVIDER_IDS.OLLAMA,
        model: DEFAULT_OLLAMA_MODEL,
        baseUrl: '',
        hasApiKey: false,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'model-openai-main',
        name: 'OpenAI',
        provider: AI_PROVIDER_IDS.OPENAI,
        model: 'gpt-4o-mini',
        baseUrl: '',
        hasApiKey: false,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'model-anthropic-main',
        name: 'Anthropic',
        provider: AI_PROVIDER_IDS.ANTHROPIC,
        model: 'claude-3-5-sonnet-latest',
        baseUrl: '',
        hasApiKey: false,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'model-gemini-main',
        name: 'Gemini',
        provider: AI_PROVIDER_IDS.GEMINI,
        model: 'gemini-2.0-flash',
        baseUrl: '',
        hasApiKey: false,
        createdAt: now,
        updatedAt: now
      }
    ];
  }

  const PANEL_SETTINGS_DEFAULTS = Object.freeze({
    displayName: '',
    birthday: '',
    language: DEFAULT_ASSISTANT_LANGUAGE,
    onboardingDone: false,
    systemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT,
    systemVariables: { ...SYSTEM_VARIABLE_DEFAULTS },
    defaultModel: DEFAULT_OLLAMA_MODEL,
    aiModelProfiles: createPreloadedModelProfiles(),
    primaryModelProfileId: DEFAULT_PRIMARY_MODEL_ID,
    securityConfig: null,
    crmErpDatabaseUrl: '',
    crmErpDatabaseSchemaSnapshot: null
  });

  const ALLOWED_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpg',
    'image/jpeg',
    'image/gif',
    'image/bmp'
  ]);

  const app = document.getElementById('app');
  const stageTrack = document.getElementById('stageTrack');
  const brandHomeBtn = document.getElementById('brandHomeBtn');
  const toolsScreen = document.getElementById('toolsScreen');
  const openToolsBtn = document.getElementById('openToolsBtn');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const goHomeBtn = document.getElementById('goHomeBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const settingsSectionBackBtn = document.getElementById('settingsSectionBackBtn');
  const settingsShell = document.getElementById('settingsShell');
  const settingsPages = Array.from(document.querySelectorAll('.settings-page'));
  const settingsNavItems = Array.from(document.querySelectorAll('[data-settings-target]'));
  const toolTabs = Array.from(document.querySelectorAll('.tool-tab'));

  const brandEmotion = document.getElementById('brandEmotion');
  const brandEmotionSvg = document.getElementById('brandEmotionSvg');
  const brandEmotionEyeRight = document.getElementById('brandEmotionEyeRight');
  const brandEmotionEyeLeft = document.getElementById('brandEmotionEyeLeft');
  const onboardingEmotion = document.getElementById('onboardingEmotion');
  const onboardingEmotionSvg = document.getElementById('onboardingEmotionSvg');
  const onboardingEmotionEyeRight = document.getElementById('onboardingEmotionEyeRight');
  const onboardingEmotionEyeLeft = document.getElementById('onboardingEmotionEyeLeft');

  const chatBody = document.getElementById('chatBody');
  const chatMessagesEl = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatStatus = document.getElementById('chatStatus');
  const chatResetBtn = document.getElementById('chatResetBtn');
  const chatToolPicker = document.getElementById('chatToolPicker');
  const chatToolBtn = document.getElementById('chatToolBtn');
  const chatToolMenu = document.getElementById('chatToolMenu');
  const chatToolLabel = document.getElementById('chatToolLabel');
  const chatToolOptions = Array.from(document.querySelectorAll('[data-chat-tool]'));
  const chatModelSelect = document.getElementById('chatModelSelect');
  const whatsappSuggestionCard = document.getElementById('whatsappSuggestionCard');
  const whatsappSuggestionMeta = document.getElementById('whatsappSuggestionMeta');
  const whatsappSuggestionText = document.getElementById('whatsappSuggestionText');
  const whatsappSuggestionStatus = document.getElementById('whatsappSuggestionStatus');
  const whatsappSuggestionRunBtn = document.getElementById('whatsappSuggestionRunBtn');
  const whatsappSuggestionRefreshBtn = document.getElementById('whatsappSuggestionRefreshBtn');
  const whatsappSuggestionCloseBtn = document.getElementById('whatsappSuggestionCloseBtn');

  const imageInput = document.getElementById('imageInput');
  const imagePickBtn = document.getElementById('imagePickBtn');
  const imageDropzone = document.getElementById('imageDropzone');
  const imageQuality = document.getElementById('imageQuality');
  const imageQualityValue = document.getElementById('imageQualityValue');
  const imageClearBtn = document.getElementById('imageClearBtn');
  const imageQueueList = document.getElementById('imageQueueList');
  const imageStatus = document.getElementById('imageStatus');
  const dropOverlay = document.getElementById('dropOverlay');

  const retoolToggle = document.getElementById('retoolToggle');
  const applyRetoolBtn = document.getElementById('applyRetoolBtn');
  const retoolStatus = document.getElementById('retoolStatus');
  const onboardingNameInput = document.getElementById('onboardingNameInput');
  const onboardingContinueBtn = document.getElementById('onboardingContinueBtn');
  const onboardingStatus = document.getElementById('onboardingStatus');
  const settingsNameInput = document.getElementById('settingsNameInput');
  const settingsBirthdayInput = document.getElementById('settingsBirthdayInput');
  const settingsThemeModeSelect = document.getElementById('settingsThemeModeSelect');
  const settingsLanguageSelect = document.getElementById('settingsLanguageSelect');
  const settingsSystemPrompt = document.getElementById('settingsSystemPrompt');
  const settingsUserSaveBtn = document.getElementById('settingsUserSaveBtn');
  const settingsUserStatus = document.getElementById('settingsUserStatus');
  const settingsAssistantSaveBtn = document.getElementById('settingsAssistantSaveBtn');
  const settingsAssistantStatus = document.getElementById('settingsAssistantStatus');
  const aiPrimaryModelSelect = document.getElementById('aiPrimaryModelSelect');
  const settingsAddModelBtn = document.getElementById('settingsAddModelBtn');
  const settingsRefreshLocalModelsBtn = document.getElementById('settingsRefreshLocalModelsBtn');
  const aiModelsAccessWall = document.getElementById('aiModelsAccessWall');
  const aiModelsAccessCopy = document.getElementById('aiModelsAccessCopy');
  const aiModelsAccessActionBtn = document.getElementById('aiModelsAccessActionBtn');
  const aiModelsProtectedContent = document.getElementById('aiModelsProtectedContent');
  const aiModelsList = document.getElementById('aiModelsList');
  const aiModelsStatus = document.getElementById('aiModelsStatus');
  const settingsPinStatus = document.getElementById('settingsPinStatus');
  const settingsSetupPinBtn = document.getElementById('settingsSetupPinBtn');
  const settingsUnlockPinBtn = document.getElementById('settingsUnlockPinBtn');
  const settingsLockPinBtn = document.getElementById('settingsLockPinBtn');
  const settingsCrmErpDbUrlInput = document.getElementById('settingsCrmErpDbUrlInput');
  const settingsCrmErpDbSaveBtn = document.getElementById('settingsCrmErpDbSaveBtn');
  const settingsCrmErpDbAnalyzeBtn = document.getElementById('settingsCrmErpDbAnalyzeBtn');
  const settingsCrmErpDbStatus = document.getElementById('settingsCrmErpDbStatus');
  const settingsCrmErpDbSchemaSummary = document.getElementById('settingsCrmErpDbSchemaSummary');
  const tabsContextJson = document.getElementById('tabsContextJson');
  const systemVariablesList = document.getElementById('systemVariablesList');
  const systemVariablesSaveBtn = document.getElementById('systemVariablesSaveBtn');
  const systemVariablesResetBtn = document.getElementById('systemVariablesResetBtn');
  const systemVariablesStatus = document.getElementById('systemVariablesStatus');
  const modelConfigModal = document.getElementById('modelConfigModal');
  const modelConfigTitle = document.getElementById('modelConfigTitle');
  const modelProviderSelect = document.getElementById('modelProviderSelect');
  const modelDisplayNameInput = document.getElementById('modelDisplayNameInput');
  const modelIdInput = document.getElementById('modelIdInput');
  const modelBaseUrlField = document.getElementById('modelBaseUrlField');
  const modelBaseUrlInput = document.getElementById('modelBaseUrlInput');
  const modelApiKeyField = document.getElementById('modelApiKeyField');
  const modelApiKeyInput = document.getElementById('modelApiKeyInput');
  const modelConfigCloseBtn = document.getElementById('modelConfigCloseBtn');
  const modelConfigSaveBtn = document.getElementById('modelConfigSaveBtn');
  const modelConfigCancelBtn = document.getElementById('modelConfigCancelBtn');
  const modelConfigClearKeyBtn = document.getElementById('modelConfigClearKeyBtn');
  const modelConfigStatus = document.getElementById('modelConfigStatus');
  const pinModal = document.getElementById('pinModal');
  const pinModalTitle = document.getElementById('pinModalTitle');
  const pinModalCopy = document.getElementById('pinModalCopy');
  const pinInput = document.getElementById('pinInput');
  const pinDigitInputs = Array.from(document.querySelectorAll('input[data-pin-target="pin"]'));
  const pinConfirmField = document.getElementById('pinConfirmField');
  const pinConfirmInput = document.getElementById('pinConfirmInput');
  const pinConfirmDigitInputs = Array.from(document.querySelectorAll('input[data-pin-target="confirm"]'));
  const pinModalCloseBtn = document.getElementById('pinModalCloseBtn');
  const pinModalSaveBtn = document.getElementById('pinModalSaveBtn');
  const pinModalCancelBtn = document.getElementById('pinModalCancelBtn');
  const pinModalStatus = document.getElementById('pinModalStatus');

  let settings = { ...DEFAULT_SETTINGS };
  let imageQueue = [];
  let isConvertingImages = false;
  let pendingAutoProcess = false;
  let dragDepth = 0;
  let themeMode = DEFAULT_SETTINGS[PREFERENCE_KEYS.UI_THEME_MODE] || 'system';

  let chatHistory = [];
  let selectedChatTool = DEFAULT_CHAT_TOOL;
  let panelSettings = {
    ...PANEL_SETTINGS_DEFAULTS,
    aiModelProfiles: createPreloadedModelProfiles()
  };
  let currentChatModelProfileId = PANEL_SETTINGS_DEFAULTS.primaryModelProfileId;
  let localOllamaModels = [];
  let modelModalState = { mode: 'add', profileId: '' };
  let pinModalMode = PIN_MODAL_MODES.SETUP;
  let unlockedPin = '';
  let unlockedPinExpiresAt = 0;
  let pinModalRequest = null;
  let isGeneratingChat = false;
  let pendingChatRenderRaf = 0;
  let modelWarmupPromise = null;
  let brandEmotionLibrary = Object.create(null);
  let currentBrandEmotion = '';
  let brandEmotionMorphToken = 0;
  let brandEmotionMetricsPath = null;
  let randomEmotionTimer = 0;
  let randomEmotionEnabled = false;
  let stageResizeObserver = null;
  let settingsScreenController = null;
  let settingsScreenState = null;
  let tabContextSnapshot = { activeTabId: -1, tabs: [], history: [], updatedAt: Date.now(), reason: 'init' };
  let tabSummaryByKey = new Map();
  let tabSummaryQueue = [];
  let tabSummaryQueueRunning = false;
  let whatsappSuggestionState = {
    tabId: -1,
    chatKey: '',
    signalKey: '',
    text: '',
    loading: false
  };
  let whatsappSuggestionToken = 0;
  let whatsappSuggestionDismissedSignalKey = '';
  let whatsappSuggestionExecutionInFlight = false;
  let contextIngestionPromise = Promise.resolve();
  let whatsappHistorySyncPromise = Promise.resolve();
  let initialContextSyncPromise = null;

  const prefersDarkMedia =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const storageService = createPanelStorageService({
    defaultSettings: DEFAULT_SETTINGS,
    panelSettingsDefaults: PANEL_SETTINGS_DEFAULTS,
    chatDb: CHAT_DB,
    maxChatHistoryMessages: MAX_CHAT_HISTORY_STORAGE_LIMIT,
    maxWhatsappChatMessages: MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT
  });
  const ollamaService = createOllamaService({
    defaultModel: DEFAULT_OLLAMA_MODEL,
    localKeepAlive: LOCAL_MODEL_KEEP_ALIVE,
    chatEndpoints: OLLAMA_CHAT_ENDPOINTS,
    generateEndpoints: OLLAMA_GENERATE_ENDPOINTS,
    tagsEndpoints: OLLAMA_TAGS_ENDPOINTS
  });
  const aiProviderService = createAiProviderService({
    ollamaService,
    defaultOllamaModel: DEFAULT_OLLAMA_MODEL,
    localKeepAlive: LOCAL_MODEL_KEEP_ALIVE
  });
  const pinCryptoService = createPinCryptoService();
  const postgresService = createPostgresService();
  const tabContextService = createTabContextService({
    onSnapshot: handleTabContextSnapshot
  });
  const contextMemoryService = createContextMemoryService();
  marked.setOptions({
    gfm: true,
    breaks: true
  });

  function logDebug(message, payload) {
    if (payload === undefined) {
      console.debug(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.debug(`${LOG_PREFIX} ${message}`, payload);
  }

  function logWarn(message, payload) {
    if (payload === undefined) {
      console.warn(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.warn(`${LOG_PREFIX} ${message}`, payload);
  }

  function toSafeLogText(value, limit = 180) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return '';
    }
    return text.slice(0, limit);
  }

  function formatSystemVariableValue(value) {
    if (value === null || value === undefined) {
      return 'null';
    }

    if (typeof value === 'string') {
      return value || '""';
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  function coerceSystemVariableValue(definition, rawValue) {
    const meta = definition && typeof definition === 'object' ? definition : {};
    const type = String(meta.type || 'string');

    if (type === 'number') {
      const fallbackValue = Number(meta.defaultValue);
      const fallback = Number.isFinite(fallbackValue) ? fallbackValue : 0;
      let numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) {
        numeric = fallback;
      }

      if (Number.isFinite(meta.min)) {
        numeric = Math.max(meta.min, numeric);
      }

      if (Number.isFinite(meta.max)) {
        numeric = Math.min(meta.max, numeric);
      }

      const fallbackIsInteger = Number.isInteger(fallback);
      if (fallbackIsInteger || Number.isInteger(meta.step || 1)) {
        numeric = Math.round(numeric);
      }

      return numeric;
    }

    const text = String(rawValue || '').trim();
    if (meta.required && !text) {
      return String(meta.defaultValue || '').trim();
    }

    if (type === 'prompt') {
      return text || String(meta.defaultValue || '').trim();
    }

    return text;
  }

  function normalizeSystemVariables(storedValues) {
    const source = storedValues && typeof storedValues === 'object' ? storedValues : {};
    const normalized = {};

    for (const definition of SYSTEM_VARIABLE_DEFINITIONS) {
      if (definition.target) {
        continue;
      }

      const hasValue = Object.prototype.hasOwnProperty.call(source, definition.id);
      const value = hasValue ? source[definition.id] : definition.defaultValue;
      normalized[definition.id] = coerceSystemVariableValue(definition, value);
    }

    return normalized;
  }

  function getSystemVariableDefinition(variableId) {
    const key = String(variableId || '').trim();
    return key ? SYSTEM_VARIABLE_DEFINITION_BY_ID[key] || null : null;
  }

  function getSystemVariableValue(variableId) {
    const definition = getSystemVariableDefinition(variableId);
    if (!definition) {
      return null;
    }

    if (definition.target === 'systemPrompt') {
      return coerceSystemVariableValue(definition, panelSettings.systemPrompt);
    }

    const source = panelSettings?.systemVariables && typeof panelSettings.systemVariables === 'object' ? panelSettings.systemVariables : {};
    const hasValue = Object.prototype.hasOwnProperty.call(source, definition.id);
    const value = hasValue ? source[definition.id] : definition.defaultValue;
    return coerceSystemVariableValue(definition, value);
  }

  function getSystemVariableNumber(variableId, fallbackValue) {
    const resolved = Number(getSystemVariableValue(variableId));
    if (Number.isFinite(resolved)) {
      return resolved;
    }
    const fallback = Number(fallbackValue);
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function getSystemVariablePrompt(variableId, fallbackValue = '') {
    const resolved = String(getSystemVariableValue(variableId) || '').trim();
    if (resolved) {
      return resolved;
    }
    return String(fallbackValue || '').trim();
  }

  function getSystemVariableScopeLabel(scopeId) {
    const scope = String(scopeId || '').trim();
    if (!scope) {
      return 'Sistema';
    }
    return SYSTEM_VARIABLE_SCOPE_LABELS[scope] || scope;
  }

  function getActiveChatSystemPrompt() {
    const languageAwareDefault = buildDefaultChatSystemPrompt(panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE);
    return getSystemVariablePrompt('prompts.assistantSystem', languageAwareDefault);
  }

  function getWriteEmailSystemPrompt() {
    return getSystemVariablePrompt('prompts.writeEmailSystem', DEFAULT_WRITE_EMAIL_SYSTEM_PROMPT);
  }

  function getWhatsappSuggestionBasePrompt() {
    return getSystemVariablePrompt('prompts.whatsappSuggestionBase', DEFAULT_WHATSAPP_REPLY_PROMPT_BASE);
  }

  function sanitizeSensitiveMessage(message) {
    const text = String(message || '').trim();
    if (!text) {
      return '';
    }

    return text.replace(/(postgres(?:ql)?:\/\/[^:@\s/]+:)[^@\s/]+@/gi, '$1***@');
  }

  function normalizeCrmErpDatabaseSnapshot(rawSnapshot) {
    const source = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : null;
    if (!source) {
      return null;
    }

    const rawTables = Array.isArray(source.tables) ? source.tables : [];
    const tables = rawTables
      .map((table) => {
        const item = table && typeof table === 'object' ? table : {};
        const schema = String(item.schema || '').trim().slice(0, 120);
        const name = String(item.name || '').trim().slice(0, 120);
        if (!schema || !name) {
          return null;
        }

        const rawColumns = Array.isArray(item.columns) ? item.columns : [];
        const columns = rawColumns
          .map((column) => {
            const columnItem = column && typeof column === 'object' ? column : {};
            const columnName = String(columnItem.name || '').trim().slice(0, 120);
            if (!columnName) {
              return null;
            }

            const enumSource = Array.isArray(columnItem.enumOptions)
              ? columnItem.enumOptions
              : Array.isArray(columnItem.enum_options)
                ? columnItem.enum_options
                : [];
            const enumOptions = enumSource
              .map((option) => String(option || '').trim().slice(0, 120))
              .filter(Boolean)
              .slice(0, 80);

            const foreignKeyRaw =
              columnItem.foreignKey && typeof columnItem.foreignKey === 'object'
                ? columnItem.foreignKey
                : columnItem.foreign_key && typeof columnItem.foreign_key === 'object'
                  ? columnItem.foreign_key
                  : null;

            const foreignKey =
              foreignKeyRaw && (foreignKeyRaw.targetTable || foreignKeyRaw.target_table)
                ? {
                    targetSchema: String(
                      foreignKeyRaw.targetSchema || foreignKeyRaw.target_schema || ''
                    )
                      .trim()
                      .slice(0, 120),
                    targetTable: String(
                      foreignKeyRaw.targetTable || foreignKeyRaw.target_table || ''
                    )
                      .trim()
                      .slice(0, 120),
                    targetColumn: String(
                      foreignKeyRaw.targetColumn || foreignKeyRaw.target_column || ''
                    )
                      .trim()
                      .slice(0, 120)
                  }
                : null;

            return {
              name: columnName,
              type: String(columnItem.type || '').trim().slice(0, 80) || 'text',
              udtName: String(columnItem.udtName || columnItem.udt_name || '')
                .trim()
                .slice(0, 80),
              nullable:
                columnItem.nullable === true ||
                String(columnItem.nullable || '').trim().toUpperCase() === 'YES',
              defaultValue: String(columnItem.defaultValue || columnItem.default || '')
                .trim()
                .slice(0, 280),
              ordinal: Math.max(
                0,
                Number(columnItem.ordinal) || Number(columnItem.ordinal_position) || 0
              ),
              isPrimaryKey:
                columnItem.isPrimaryKey === true || columnItem.is_primary_key === true,
              isList:
                columnItem.isList === true ||
                String(columnItem.is_list || '').trim().toUpperCase() === 'YES',
              enumOptions,
              foreignKey
            };
          })
          .filter(Boolean)
          .sort((left, right) => left.ordinal - right.ordinal)
          .slice(0, 220);

        return {
          schema,
          name,
          qualifiedName: `${schema}.${name}`,
          tableType: String(item.tableType || '').trim().slice(0, 40) || 'BASE TABLE',
          estimatedRows: Number.isFinite(Number(item.estimatedRows)) ? Math.max(0, Math.round(Number(item.estimatedRows))) : null,
          columns
        };
      })
      .filter(Boolean)
      .slice(0, 500)
      .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName));

    if (!tables.length) {
      return null;
    }

    const schemaCount = new Map();
    for (const table of tables) {
      const count = schemaCount.get(table.schema) || 0;
      schemaCount.set(table.schema, count + 1);
    }

    const schemas = Array.from(schemaCount.entries())
      .map(([name, tableCount]) => ({ name, tableCount }))
      .sort((left, right) => left.name.localeCompare(right.name));

    return {
      analyzedAt: Math.max(0, Number(source.analyzedAt) || Date.now()),
      tableCount: tables.length,
      schemas,
      tables
    };
  }

  function getCrmErpDatabaseConnectionUrl() {
    return postgresService.normalizeConnectionUrl(panelSettings.crmErpDatabaseUrl || '');
  }

  function getCrmErpDatabaseSchemaSnapshot() {
    return normalizeCrmErpDatabaseSnapshot(panelSettings.crmErpDatabaseSchemaSnapshot);
  }

  function formatDateTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return '';
    }

    try {
      return new Date(timestamp).toLocaleString();
    } catch (_) {
      return '';
    }
  }

  function buildCrmErpSchemaSummary(snapshot, options = {}) {
    const safeSnapshot = normalizeCrmErpDatabaseSnapshot(snapshot);
    if (!safeSnapshot) {
      return 'Sin analisis de esquema todavia. Ejecuta "Analizar esquema".';
    }

    const tableLimit = Math.max(1, Math.min(80, Number(options.tableLimit) || 30));
    const columnLimit = Math.max(1, Math.min(24, Number(options.columnLimit) || 10));
    const rows = safeSnapshot.tables.slice(0, tableLimit);
    const lines = [];
    const analyzedAtLabel = formatDateTime(safeSnapshot.analyzedAt);

    lines.push(`Analisis: ${analyzedAtLabel || 'sin fecha'}`);
    lines.push(
      `Esquemas: ${
        safeSnapshot.schemas.map((schema) => `${schema.name} (${schema.tableCount})`).join(', ') || 'N/A'
      }`
    );
    lines.push(`Tablas detectadas: ${safeSnapshot.tableCount}`);
    lines.push('');
    lines.push('Detalle de tablas:');

    rows.forEach((table, index) => {
      const tableType = table.tableType === 'VIEW' ? 'view' : 'table';
      const rowHint = Number.isFinite(Number(table.estimatedRows)) ? ` ~${Number(table.estimatedRows)} rows` : '';
      lines.push(`${index + 1}. ${table.qualifiedName} [${tableType}]${rowHint}`);

      const columnTokens = table.columns.slice(0, columnLimit).map((column) => {
        const listTag = column.isList ? '[]' : '';
        const pkTag = column.isPrimaryKey ? ' pk' : '';
        const nullableTag = column.nullable ? ' null' : ' not-null';
        const enumOptions = Array.isArray(column.enumOptions) ? column.enumOptions : [];
        const enumPreview = enumOptions.slice(0, 3).join('/');
        const enumTag = enumOptions.length
          ? ` enum(${enumPreview}${enumOptions.length > 3 ? ',...' : ''})`
          : '';
        const fk = column.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
        const fkTargetTable = String(fk?.targetTable || '').trim();
        const fkTargetColumn = String(fk?.targetColumn || '').trim();
        const fkTargetSchema = String(fk?.targetSchema || '').trim();
        const fkTag =
          fkTargetTable && fkTargetColumn
            ? ` fk(${fkTargetSchema ? `${fkTargetSchema}.` : ''}${fkTargetTable}.${fkTargetColumn})`
            : '';

        return `${column.name}:${column.type}${listTag}${pkTag}${nullableTag}${enumTag}${fkTag}`;
      });

      lines.push(`   ${columnTokens.join(' | ')}`);
    });

    if (safeSnapshot.tables.length > rows.length) {
      lines.push('');
      lines.push(`... y ${safeSnapshot.tables.length - rows.length} tablas mas.`);
    }

    return lines.join('\n');
  }

  function renderCrmErpDatabaseSettings(options = {}) {
    const syncInput = options.syncInput !== false;
    const connectionUrl = getCrmErpDatabaseConnectionUrl();
    const snapshot = getCrmErpDatabaseSchemaSnapshot();

    if (syncInput && settingsCrmErpDbUrlInput) {
      settingsCrmErpDbUrlInput.value = connectionUrl;
    }

    if (settingsCrmErpDbSchemaSummary) {
      if (!connectionUrl) {
        settingsCrmErpDbSchemaSummary.textContent =
          'Configura una URL PostgreSQL para habilitar tools de base de datos en el chat.';
      } else {
        settingsCrmErpDbSchemaSummary.textContent = buildCrmErpSchemaSummary(snapshot, {
          tableLimit: 40,
          columnLimit: 10
        });
      }
    }
  }

  async function saveCrmErpDatabaseSettingsFromScreen(options = {}) {
    const analyzeAfterSave = options.analyzeAfterSave === true;
    const inputValue = String(settingsCrmErpDbUrlInput?.value || '').trim();

    if (!inputValue) {
      const ok = await savePanelSettings({
        crmErpDatabaseUrl: '',
        crmErpDatabaseSchemaSnapshot: null
      });

      if (!ok) {
        setStatus(settingsCrmErpDbStatus, 'No se pudo limpiar la configuracion de base de datos.', true);
        return false;
      }

      renderCrmErpDatabaseSettings({ syncInput: true });
      setStatus(settingsCrmErpDbStatus, 'Integracion CRM/ERP desactivada.');
      return true;
    }

    const normalizedUrl = postgresService.normalizeConnectionUrl(inputValue);
    if (!normalizedUrl) {
      setStatus(settingsCrmErpDbStatus, 'URL PostgreSQL invalida. Usa formato postgresql://user:pass@host/db', true);
      settingsCrmErpDbUrlInput?.focus();
      return false;
    }

    const previousUrl = getCrmErpDatabaseConnectionUrl();
    const hasConnectionChanged = previousUrl !== normalizedUrl;
    const patch = {
      crmErpDatabaseUrl: normalizedUrl
    };
    if (hasConnectionChanged) {
      patch.crmErpDatabaseSchemaSnapshot = null;
    }

    const ok = await savePanelSettings(patch);
    if (!ok) {
      setStatus(settingsCrmErpDbStatus, 'No se pudo guardar la URL de PostgreSQL.', true);
      return false;
    }

    renderCrmErpDatabaseSettings({ syncInput: true });
    setStatus(settingsCrmErpDbStatus, 'URL guardada.');

    if (analyzeAfterSave) {
      try {
        await analyzeCrmErpDatabaseSchema({
          connectionUrl: normalizedUrl,
          statusTarget: settingsCrmErpDbStatus,
          silent: false
        });
      } catch (_) {
        return false;
      }
    }

    return true;
  }

  async function analyzeCrmErpDatabaseSchema(options = {}) {
    const silent = options.silent === true;
    const statusTarget = options.statusTarget || settingsCrmErpDbStatus;
    const rawConnectionUrl =
      String(options.connectionUrl || '').trim() ||
      String(settingsCrmErpDbUrlInput?.value || '').trim() ||
      getCrmErpDatabaseConnectionUrl();
    const connectionUrl = postgresService.normalizeConnectionUrl(rawConnectionUrl);

    if (!connectionUrl) {
      if (!silent && statusTarget) {
        setStatus(statusTarget, 'Configura primero una URL PostgreSQL valida.', true);
      }
      throw new Error('URL PostgreSQL invalida.');
    }

    if (!silent && statusTarget) {
      setStatus(statusTarget, 'Analizando esquemas y tablas...', false, { loading: true });
    }

    try {
      const rawSnapshot = await postgresService.inspectSchema(connectionUrl);
      const snapshot = normalizeCrmErpDatabaseSnapshot(rawSnapshot);
      if (!snapshot) {
        throw new Error('No se detectaron tablas en la base de datos.');
      }

      const ok = await savePanelSettings({
        crmErpDatabaseUrl: connectionUrl,
        crmErpDatabaseSchemaSnapshot: snapshot
      });
      if (!ok) {
        throw new Error('No se pudo guardar el analisis de esquema.');
      }

      renderCrmErpDatabaseSettings({ syncInput: true });
      if (!silent && statusTarget) {
        setStatus(statusTarget, `Analisis completo: ${snapshot.tableCount} tablas detectadas.`);
      }

      return snapshot;
    } catch (error) {
      const message = sanitizeSensitiveMessage(error instanceof Error ? error.message : 'No se pudo analizar la base de datos.');
      if (!silent && statusTarget) {
        setStatus(statusTarget, message, true);
      }
      throw new Error(message);
    }
  }

  function normalizePinDigits(value, max = 4) {
    return String(value || '')
      .replace(/\D/g, '')
      .slice(0, Math.max(0, Number(max) || 4));
  }

  function readPinDigits(inputs) {
    return (Array.isArray(inputs) ? inputs : [])
      .map((item) => normalizePinDigits(item?.value || '', 1))
      .join('');
  }

  function setPinDigits(inputs, value) {
    const safeInputs = Array.isArray(inputs) ? inputs : [];
    const digits = normalizePinDigits(value, safeInputs.length || 4).split('');
    safeInputs.forEach((input, index) => {
      if (!input) {
        return;
      }
      input.value = digits[index] || '';
    });
  }

  function syncPinHiddenInputs() {
    if (pinInput) {
      pinInput.value = readPinDigits(pinDigitInputs);
    }
    if (pinConfirmInput) {
      pinConfirmInput.value = readPinDigits(pinConfirmDigitInputs);
    }
  }

  function fillPinDigitsFrom(inputs, startIndex, text) {
    const safeInputs = Array.isArray(inputs) ? inputs : [];
    const digits = normalizePinDigits(text, safeInputs.length);
    if (!digits || !safeInputs.length) {
      return;
    }

    let cursor = Math.max(0, Number(startIndex) || 0);
    for (const digit of digits) {
      if (cursor >= safeInputs.length) {
        break;
      }
      const target = safeInputs[cursor];
      if (target && !target.disabled) {
        target.value = digit;
      }
      cursor += 1;
    }

    const focusIndex = Math.min(cursor, safeInputs.length - 1);
    const focusTarget = safeInputs[focusIndex];
    focusTarget?.focus();
    focusTarget?.select?.();
  }

  function clearPinInputs() {
    setPinDigits(pinDigitInputs, '');
    setPinDigits(pinConfirmDigitInputs, '');
    syncPinHiddenInputs();
  }

  function focusPinFirstDigit() {
    const first = pinDigitInputs.find((item) => item && !item.disabled) || null;
    first?.focus();
    first?.select?.();
  }

  function wirePinDigitGroup(inputs) {
    const safeInputs = Array.isArray(inputs) ? inputs : [];
    if (!safeInputs.length) {
      return;
    }

    safeInputs.forEach((input, index) => {
      if (!input) {
        return;
      }

      input.addEventListener('input', (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }

        const raw = String(target.value || '');
        const digits = normalizePinDigits(raw, safeInputs.length);
        if (!digits) {
          target.value = '';
          syncPinHiddenInputs();
          return;
        }

        if (digits.length > 1) {
          fillPinDigitsFrom(safeInputs, index, digits);
          syncPinHiddenInputs();
          return;
        }

        target.value = digits;
        const next = safeInputs[index + 1];
        next?.focus();
        next?.select?.();
        syncPinHiddenInputs();
      });

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace') {
          const hasValue = Boolean(normalizePinDigits(input.value || '', 1));
          if (hasValue) {
            input.value = '';
            syncPinHiddenInputs();
            event.preventDefault();
            return;
          }

          const previous = safeInputs[index - 1];
          if (previous) {
            previous.value = '';
            previous.focus();
            previous.select?.();
            syncPinHiddenInputs();
            event.preventDefault();
          }
          return;
        }

        if (event.key === 'ArrowLeft') {
          const previous = safeInputs[index - 1];
          if (previous) {
            previous.focus();
            previous.select?.();
            event.preventDefault();
          }
          return;
        }

        if (event.key === 'ArrowRight') {
          const next = safeInputs[index + 1];
          if (next) {
            next.focus();
            next.select?.();
            event.preventDefault();
          }
          return;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          savePinFromModal();
          return;
        }

        if (event.key.length === 1 && /\D/.test(event.key)) {
          event.preventDefault();
        }
      });

      input.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text') || '';
        if (!text) {
          return;
        }
        event.preventDefault();
        fillPinDigitsFrom(safeInputs, index, text);
        syncPinHiddenInputs();
      });
    });
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

  function readChromeSession(defaultValue) {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.session) {
        resolve(defaultValue);
        return;
      }

      chrome.storage.session.get(defaultValue, (items) => {
        if (chrome.runtime.lastError) {
          resolve(defaultValue);
          return;
        }

        resolve(items);
      });
    });
  }

  function writeChromeSession(patch) {
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.session) {
        resolve(false);
        return;
      }

      chrome.storage.session.set(patch, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  function removeChromeSession(keys) {
    const list = (Array.isArray(keys) ? keys : [keys]).map((item) => String(item || '').trim()).filter(Boolean);
    if (!list.length) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.session) {
        resolve(false);
        return;
      }

      chrome.storage.session.remove(list, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  function normalizeInitialContextSyncState(rawState) {
    const state = rawState && typeof rawState === 'object' ? rawState : {};
    const sourceCounts = state.sourceCounts && typeof state.sourceCounts === 'object' ? state.sourceCounts : {};
    const status = String(state.status || '').toLowerCase();
    const validStatus = ['pending', 'running', 'done', 'failed'].includes(status) ? status : 'pending';

    return {
      version: Number(state.version) || INITIAL_CONTEXT_SYNC_VERSION,
      status: validStatus,
      reason: String(state.reason || ''),
      startedAt: Math.max(0, Number(state.startedAt) || 0),
      completedAt: Math.max(0, Number(state.completedAt) || 0),
      updatedAt: Math.max(0, Number(state.updatedAt) || 0),
      error: String(state.error || ''),
      sourceCounts: {
        tabs: Math.max(0, Number(sourceCounts.tabs) || 0),
        history: Math.max(0, Number(sourceCounts.history) || 0),
        chat: Math.max(0, Number(sourceCounts.chat) || 0),
        profile: Math.max(0, Number(sourceCounts.profile) || 0),
        facts: Math.max(0, Number(sourceCounts.facts) || 0)
      }
    };
  }

  async function readInitialContextSyncState() {
    const payload = await readChromeLocal({
      [INITIAL_CONTEXT_SYNC_STORAGE_KEY]: null
    });
    return normalizeInitialContextSyncState(payload?.[INITIAL_CONTEXT_SYNC_STORAGE_KEY]);
  }

  async function writeInitialContextSyncState(patch = {}) {
    const current = await readInitialContextSyncState();
    const safePatch = patch && typeof patch === 'object' ? patch : {};
    const sourceCountsPatch =
      safePatch.sourceCounts && typeof safePatch.sourceCounts === 'object' ? safePatch.sourceCounts : {};
    const next = normalizeInitialContextSyncState({
      ...current,
      ...safePatch,
      version: INITIAL_CONTEXT_SYNC_VERSION,
      sourceCounts: {
        ...current.sourceCounts,
        ...sourceCountsPatch
      },
      updatedAt: Date.now()
    });

    await writeChromeLocal({
      [INITIAL_CONTEXT_SYNC_STORAGE_KEY]: next
    });

    return next;
  }

  function shouldRunInitialContextSync(state) {
    const current = normalizeInitialContextSyncState(state);
    if (current.version !== INITIAL_CONTEXT_SYNC_VERSION) {
      return true;
    }

    if (current.status === 'done') {
      return false;
    }

    if (
      current.status === 'running' &&
      Date.now() - current.startedAt < getSystemVariableNumber('bootstrap.initialContextSyncStaleMs', INITIAL_CONTEXT_SYNC_STALE_MS)
    ) {
      return false;
    }

    return true;
  }

  function focusChatInput() {
    try {
      chatInput.focus({ preventScroll: true });
    } catch (_) {
      chatInput.focus();
    }
  }

  function shouldAutofocusChatInput() {
    return app && app.dataset.screen === 'home' && !isGeneratingChat;
  }

  function requestChatAutofocus(attempts = 8, delayMs = 80) {
    let attempt = 0;

    const run = () => {
      if (!shouldAutofocusChatInput()) {
        return;
      }

      if (!document.hasFocus()) {
        attempt += 1;
        if (attempt < attempts) {
          window.setTimeout(run, delayMs);
        }
        return;
      }

      focusChatInput();
      if (document.activeElement === chatInput) {
        return;
      }

      attempt += 1;
      if (attempt < attempts) {
        window.setTimeout(run, delayMs);
      }
    };

    run();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) {
      return `${Math.max(0, Math.round(bytes || 0))} B`;
    }

    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = units[0];

    for (let i = 1; i < units.length && value >= 1024; i += 1) {
      value /= 1024;
      unit = units[i];
    }

    return `${value.toFixed(1)} ${unit}`;
  }

  function revokeObjectUrl(url) {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  function getAssetUrl(path) {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(path);
    }

    return `../${path}`;
  }

  function parseNumericAttr(value, fallback) {
    if (value === null || value === undefined || String(value).trim() === '') {
      return fallback;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeEmotionName(value) {
    const key = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z_]/g, '');

    return BRAND_EMOTION_ALIASES[key] || '';
  }

  function extractEmotionFromText(text) {
    const safeText = typeof text === 'string' ? text.trim() : '';
    if (!safeText) {
      return '';
    }

    const startMatch = safeText.match(/^\[?\s*(?:emotion|emocion)\s*[:=]\s*([a-z_]+)\s*\]?/i);
    if (startMatch) {
      return normalizeEmotionName(startMatch[1]);
    }

    const endMatch = safeText.match(/\[?\s*(?:emotion|emocion)\s*[:=]\s*([a-z_]+)\s*\]?\s*$/i);
    if (endMatch) {
      return normalizeEmotionName(endMatch[1]);
    }

    return '';
  }

  function stripEmotionTag(text) {
    const raw = typeof text === 'string' ? text : '';
    if (!raw) {
      return '';
    }

    const withoutStart = raw.replace(/^\s*\[?\s*(?:emotion|emocion)\s*[:=]\s*[a-z_]+\s*\]?\s*/i, '');
    const withoutEnd = withoutStart.replace(/\s*\[?\s*(?:emotion|emocion)\s*[:=]\s*[a-z_]+\s*\]?\s*$/i, '');
    return withoutEnd.trim();
  }

  function escapeHtml(text) {
    const raw = String(text || '');
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeMarkdownHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    const blockedTags = new Set([
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'base',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'option'
    ]);

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    const toRemove = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const tag = String(node.tagName || '').toLowerCase();

      if (blockedTags.has(tag)) {
        toRemove.push(node);
        continue;
      }

      const attributes = Array.from(node.attributes || []);
      for (const attribute of attributes) {
        const name = String(attribute.name || '').toLowerCase();
        const value = String(attribute.value || '');

        if (name.startsWith('on') || name === 'srcdoc') {
          node.removeAttribute(attribute.name);
          continue;
        }

        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) {
          node.removeAttribute(attribute.name);
          continue;
        }
      }

      if (tag === 'a') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }

    for (const node of toRemove) {
      node.remove();
    }

    return doc.body.innerHTML;
  }

  function renderMarkdownInto(element, markdownText) {
    const safeTarget = element;
    const source = String(markdownText || '').trim();

    if (!safeTarget) {
      return;
    }

    if (!source) {
      safeTarget.textContent = '';
      return;
    }

    try {
      const rawHtml = marked.parse(source);
      safeTarget.innerHTML = sanitizeMarkdownHtml(rawHtml);
    } catch (_) {
      safeTarget.innerHTML = `<p>${escapeHtml(source)}</p>`;
    }
  }

  function ensureBrandEmotionMetricsPath() {
    if (brandEmotionMetricsPath) {
      return brandEmotionMetricsPath;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.opacity = '0';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'hidden';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(path);
    document.body.appendChild(svg);

    brandEmotionMetricsPath = path;
    return brandEmotionMetricsPath;
  }

  function samplePathPoints(pathData, pointCount = BRAND_EMOTION_POINT_COUNT) {
    const points = [];
    const safePointCount = Math.max(8, pointCount);
    const metricsPath = ensureBrandEmotionMetricsPath();
    metricsPath.setAttribute('d', pathData);

    let totalLength = 0;
    try {
      totalLength = metricsPath.getTotalLength();
    } catch (_) {
      return points;
    }

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return points;
    }

    for (let i = 0; i < safePointCount; i += 1) {
      const ratio = safePointCount === 1 ? 0 : i / (safePointCount - 1);
      const point = metricsPath.getPointAtLength(totalLength * ratio);
      points.push([point.x, point.y]);
    }

    return points;
  }

  function pointsToClosedPath(points) {
    if (!Array.isArray(points) || !points.length) {
      return '';
    }

    const [firstX, firstY] = points[0];
    const parts = [`M${firstX.toFixed(2)} ${firstY.toFixed(2)}`];

    for (let i = 1; i < points.length; i += 1) {
      const [x, y] = points[i];
      parts.push(`L${x.toFixed(2)} ${y.toFixed(2)}`);
    }

    parts.push('Z');
    return parts.join(' ');
  }

  function easeInOutSine(value) {
    return -(Math.cos(Math.PI * value) - 1) / 2;
  }

  function interpolatePathPoints(fromPoints, toPoints, progress) {
    if (!Array.isArray(fromPoints) || !Array.isArray(toPoints) || !fromPoints.length || !toPoints.length) {
      return [];
    }

    if (fromPoints.length !== toPoints.length) {
      return toPoints;
    }

    const out = [];
    for (let i = 0; i < fromPoints.length; i += 1) {
      const from = fromPoints[i];
      const to = toPoints[i];
      out.push([from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]);
    }

    return out;
  }

  function setEmotionPathStyle(pathEl, shape) {
    if (!pathEl || !shape) {
      return;
    }

    pathEl.setAttribute('fill', shape.fill);
    pathEl.setAttribute('stroke', shape.stroke);
    pathEl.setAttribute('fill-opacity', String(shape.fillOpacity));
    pathEl.setAttribute('stroke-opacity', String(shape.strokeOpacity));
    pathEl.setAttribute('stroke-width', String(shape.strokeWidth));
  }

  function parseEmotionShape(pathNode) {
    const pathData = pathNode ? pathNode.getAttribute('d') || '' : '';
    if (!pathData) {
      return null;
    }

    const points = samplePathPoints(pathData, BRAND_EMOTION_POINT_COUNT);
    if (points.length < 8) {
      return null;
    }

    return {
      pathData,
      points,
      morphPathData: pointsToClosedPath(points),
      fill: pathNode.getAttribute('fill') || '#ffffff',
      stroke: pathNode.getAttribute('stroke') || '#3c3c4a',
      fillOpacity: clamp(parseNumericAttr(pathNode.getAttribute('fill-opacity'), 1), 0.08, 1),
      strokeOpacity: clamp(parseNumericAttr(pathNode.getAttribute('stroke-opacity'), 1), 0.08, 1),
      strokeWidth: Math.max(0.8, parseNumericAttr(pathNode.getAttribute('stroke-width'), 3))
    };
  }

  function parseEmotionSvg(source) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(source, 'image/svg+xml');

    if (doc.querySelector('parsererror')) {
      return null;
    }

    const svgNode = doc.querySelector('svg');
    if (!svgNode) {
      return null;
    }

    const paths = Array.from(svgNode.querySelectorAll('path'));
    if (paths.length < 2) {
      return null;
    }

    const right = parseEmotionShape(paths[0]);
    const left = parseEmotionShape(paths[1]);
    if (!right || !left) {
      return null;
    }

    return {
      viewBox: svgNode.getAttribute('viewBox') || '0 0 67 47',
      right,
      left
    };
  }

  async function loadEmotionAsset(emotionName, assetPath) {
    const url = getAssetUrl(assetPath);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo cargar ${assetPath}.`);
    }

    const markup = await response.text();
    const parsed = parseEmotionSvg(markup);
    if (!parsed) {
      throw new Error(`SVG invalido para la emocion ${emotionName}.`);
    }

    return {
      name: emotionName,
      ...parsed
    };
  }

  function resolveRenderableEmotionName(name) {
    const normalized = normalizeEmotionName(name);
    if (normalized && brandEmotionLibrary[normalized]) {
      return normalized;
    }

    if (brandEmotionLibrary.neutral) {
      return 'neutral';
    }

    const available = Object.keys(brandEmotionLibrary);
    return available.length ? available[0] : '';
  }

  function getEmotionTargets() {
    const targets = [];

    if (brandEmotionEyeRight && brandEmotionEyeLeft) {
      targets.push({
        container: brandEmotion,
        svg: brandEmotionSvg,
        rightPath: brandEmotionEyeRight,
        leftPath: brandEmotionEyeLeft
      });
    }

    if (onboardingEmotionEyeRight && onboardingEmotionEyeLeft) {
      targets.push({
        container: onboardingEmotion,
        svg: onboardingEmotionSvg,
        rightPath: onboardingEmotionEyeRight,
        leftPath: onboardingEmotionEyeLeft
      });
    }

    return targets;
  }

  function pickRandomEmotion(excluded = '') {
    const source = Object.keys(brandEmotionLibrary).length ? Object.keys(brandEmotionLibrary) : BRAND_EMOTION_NAMES;
    const pool = source.filter((name) => name !== excluded);
    const names = pool.length ? pool : source;

    if (!names.length) {
      return 'neutral';
    }

    return names[Math.floor(Math.random() * names.length)];
  }

  function clearRandomEmotionTimer() {
    if (randomEmotionTimer) {
      window.clearTimeout(randomEmotionTimer);
      randomEmotionTimer = 0;
    }
  }

  function scheduleRandomEmotionTick() {
    if (!randomEmotionEnabled) {
      return;
    }

    clearRandomEmotionTimer();
    const delay = 1200 + Math.floor(Math.random() * 1600);

    randomEmotionTimer = window.setTimeout(() => {
      if (!randomEmotionEnabled) {
        return;
      }

      setBrandEmotion(pickRandomEmotion(currentBrandEmotion), { preserveRandom: true });
      scheduleRandomEmotionTick();
    }, delay);
  }

  function startRandomEmotionCycle(options = {}) {
    const immediate = options.immediate !== false;
    if (!Object.keys(brandEmotionLibrary).length) {
      return;
    }

    randomEmotionEnabled = true;
    clearRandomEmotionTimer();

    if (immediate) {
      setBrandEmotion(pickRandomEmotion(currentBrandEmotion), { preserveRandom: true });
    }

    scheduleRandomEmotionTick();
  }

  function stopRandomEmotionCycle() {
    randomEmotionEnabled = false;
    clearRandomEmotionTimer();
  }

  function setBrandEmotion(emotionName, options = {}) {
    const immediate = Boolean(options.immediate);
    const preserveRandom = Boolean(options.preserveRandom);
    const resolvedName = resolveRenderableEmotionName(emotionName);
    const targets = getEmotionTargets();
    if (!resolvedName || !targets.length) {
      return;
    }

    if (!preserveRandom) {
      stopRandomEmotionCycle();
    }

    const target = brandEmotionLibrary[resolvedName];
    const from = currentBrandEmotion ? brandEmotionLibrary[currentBrandEmotion] : null;

    for (const targetRef of targets) {
      if (targetRef.container) {
        targetRef.container.setAttribute('aria-label', `Greene emotion ${resolvedName}`);
        targetRef.container.dataset.emotion = resolvedName;
      }

      setEmotionPathStyle(targetRef.rightPath, target.right);
      setEmotionPathStyle(targetRef.leftPath, target.left);
    }

    if (immediate || !from || !from.right || !from.left || resolvedName === currentBrandEmotion) {
      for (const targetRef of targets) {
        targetRef.rightPath.setAttribute('d', target.right.morphPathData || target.right.pathData);
        targetRef.leftPath.setAttribute('d', target.left.morphPathData || target.left.pathData);
      }
      currentBrandEmotion = resolvedName;
      return;
    }

    const morphToken = ++brandEmotionMorphToken;
    const startAt = performance.now();

    const morphFrame = (now) => {
      if (morphToken !== brandEmotionMorphToken) {
        return;
      }

      const progress = Math.min(1, (now - startAt) / BRAND_EMOTION_MORPH_DURATION);
      const eased = easeInOutSine(progress);

      const nextRightPoints = interpolatePathPoints(from.right.points, target.right.points, eased);
      const nextLeftPoints = interpolatePathPoints(from.left.points, target.left.points, eased);

      const nextRightPath = nextRightPoints.length ? pointsToClosedPath(nextRightPoints) : '';
      const nextLeftPath = nextLeftPoints.length ? pointsToClosedPath(nextLeftPoints) : '';

      if (nextRightPath || nextLeftPath) {
        for (const targetRef of targets) {
          if (nextRightPath) {
            targetRef.rightPath.setAttribute('d', nextRightPath);
          }
          if (nextLeftPath) {
            targetRef.leftPath.setAttribute('d', nextLeftPath);
          }
        }
      }

      if (progress < 1) {
        requestAnimationFrame(morphFrame);
        return;
      }

      for (const targetRef of targets) {
        targetRef.rightPath.setAttribute('d', target.right.morphPathData || target.right.pathData);
        targetRef.leftPath.setAttribute('d', target.left.morphPathData || target.left.pathData);
      }
    };

    requestAnimationFrame(morphFrame);
    currentBrandEmotion = resolvedName;
  }

  function extractEmotionFromAssistantMessage(message) {
    const emotionFromMessage = extractEmotionFromText(message);
    if (emotionFromMessage) {
      return emotionFromMessage;
    }

    return '';
  }

  async function hydrateBrandEmotions() {
    if (!getEmotionTargets().length) {
      return;
    }

    const loadedEntries = await Promise.all(
      BRAND_EMOTION_NAMES.map(async (emotionName) => {
        const assetPath = BRAND_EMOTION_FILES[emotionName];

        try {
          return await loadEmotionAsset(emotionName, assetPath);
        } catch (_) {
          return null;
        }
      })
    );

    const nextLibrary = Object.create(null);
    for (const item of loadedEntries) {
      if (!item) {
        continue;
      }
      nextLibrary[item.name] = item;
    }

    if (!Object.keys(nextLibrary).length) {
      return;
    }

    brandEmotionLibrary = nextLibrary;

    const baseViewBox =
      brandEmotionLibrary.neutral?.viewBox ||
      brandEmotionLibrary[Object.keys(brandEmotionLibrary)[0]]?.viewBox ||
      '0 0 67 47';

    for (const targetRef of getEmotionTargets()) {
      if (targetRef.svg) {
        targetRef.svg.setAttribute('viewBox', baseViewBox);
      }
    }

    const randomEmotion = pickRandomEmotion();
    setBrandEmotion(randomEmotion, { immediate: true, preserveRandom: true });
    startRandomEmotionCycle({ immediate: false });
  }

  function getSettings() {
    return storageService.getSettings();
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    return storageService.saveSettings(patch);
  }

  function setScreen(screen) {
    const safeScreen = Object.prototype.hasOwnProperty.call(SCREEN_INDEX, screen) ? screen : 'home';

    if (app) {
      app.dataset.screen = safeScreen;
    }

    if (stageTrack) {
      const viewport = stageTrack.parentElement;
      const viewportWidth = viewport ? viewport.clientWidth : 0;
      const offset = viewportWidth > 0 ? SCREEN_INDEX[safeScreen] * viewportWidth * -1 : 0;
      stageTrack.style.setProperty('--stage-offset-x', `${offset}px`);
    }

    if (safeScreen !== 'tools') {
      setDropUi(false);
    }
  }

  function setStageTransitionEnabled(enabled) {
    if (!stageTrack) {
      return;
    }

    if (enabled) {
      stageTrack.style.removeProperty('transition');
      return;
    }

    stageTrack.style.setProperty('transition', 'none');
  }

  function realignStageToScreen(screenName = '') {
    const fromDom = app && app.dataset ? app.dataset.screen : '';
    const candidate = Object.prototype.hasOwnProperty.call(SCREEN_INDEX, screenName)
      ? screenName
      : Object.prototype.hasOwnProperty.call(SCREEN_INDEX, fromDom)
        ? fromDom
        : 'onboarding';

    setStageTransitionEnabled(false);
    setScreen(candidate);

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setStageTransitionEnabled(true);
      });
      return;
    }

    setStageTransitionEnabled(true);
  }

  function observeStageSizeChanges() {
    if (!stageTrack || typeof ResizeObserver !== 'function' || stageResizeObserver) {
      return;
    }

    const viewport = stageTrack.parentElement;
    if (!viewport) {
      return;
    }

    stageResizeObserver = new ResizeObserver(() => {
      const current = app && app.dataset ? app.dataset.screen : '';
      setScreen(current || 'onboarding');
    });

    stageResizeObserver.observe(viewport);
  }

  function setActiveTool(toolName) {
    const index = TOOL_SEQUENCE.indexOf(toolName);
    const safeIndex = index === -1 ? 0 : index;
    const safeTool = TOOL_SEQUENCE[safeIndex];

    toolsScreen.dataset.tool = safeTool;
    toolsScreen.style.setProperty('--tool-index', String(safeIndex));
    toolsScreen.style.setProperty('--tool-count', String(TOOL_SEQUENCE.length));

    for (const tab of toolTabs) {
      tab.classList.toggle('is-active', tab.dataset.toolTarget === safeTool);
    }

    if (safeTool !== 'image') {
      setDropUi(false);
    } else if (dragDepth > 0) {
      setDropUi(true);
    }
  }

  function openTools(toolName = 'image') {
    setActiveTool(toolName);
    setScreen('tools');
  }

  function openSettings() {
    populateSettingsForm();
    setSettingsPage(SETTINGS_PAGES.HOME);
    renderAiModelsSettings();
    renderCrmErpDatabaseSettings({ syncInput: true });
    renderSystemVariables();
    setStatus(systemVariablesStatus, '');
    setScreen('settings');
  }

  function normalizeModelName(value) {
    const modelName = String(value || '').trim();
    return modelName;
  }

  function normalizePanelModelSettings(sourceSettings = {}) {
    const next = sourceSettings && typeof sourceSettings === 'object' ? { ...sourceSettings } : {};
    const legacyDefaultModel = normalizeModelName(next.defaultModel) || DEFAULT_OLLAMA_MODEL;
    const hasStoredProfiles = Array.isArray(next.aiModelProfiles) && next.aiModelProfiles.length > 0;

    const incomingProfiles = hasStoredProfiles ? next.aiModelProfiles : createPreloadedModelProfiles();
    const normalizedProfiles = incomingProfiles.map((item, index) => aiProviderService.normalizeProfile(item, index));
    const preloaded = createPreloadedModelProfiles();

    for (const profile of preloaded) {
      const exists = normalizedProfiles.some((item) => item.provider === profile.provider);
      if (!exists) {
        normalizedProfiles.push(aiProviderService.normalizeProfile(profile, normalizedProfiles.length));
      }
    }

    const localIndex = normalizedProfiles.findIndex((item) => item.provider === AI_PROVIDER_IDS.OLLAMA);
    if (localIndex >= 0) {
      normalizedProfiles[localIndex] = {
        ...normalizedProfiles[localIndex],
        model: hasStoredProfiles ? normalizedProfiles[localIndex].model : legacyDefaultModel || normalizedProfiles[localIndex].model,
        updatedAt: Date.now()
      };
    } else {
      normalizedProfiles.unshift(
        aiProviderService.normalizeProfile(
          {
            id: DEFAULT_PRIMARY_MODEL_ID,
            name: 'Local Ollama',
            provider: AI_PROVIDER_IDS.OLLAMA,
            model: hasStoredProfiles ? DEFAULT_OLLAMA_MODEL : legacyDefaultModel,
            baseUrl: '',
            hasApiKey: false
          },
          0
        )
      );
    }

    const primaryCandidate = String(next.primaryModelProfileId || '').trim();
    const resolvedPrimary = normalizedProfiles.some((item) => item.id === primaryCandidate)
      ? primaryCandidate
      : normalizedProfiles[0]?.id || DEFAULT_PRIMARY_MODEL_ID;

    const resolvedPrimaryProfile = normalizedProfiles.find((item) => item.id === resolvedPrimary) || normalizedProfiles[0] || null;

    next.aiModelProfiles = normalizedProfiles;
    next.primaryModelProfileId = resolvedPrimary;
    next.defaultModel = resolvedPrimaryProfile ? resolvedPrimaryProfile.model : legacyDefaultModel;
    next.securityConfig = pinCryptoService.isConfigured(next.securityConfig) ? next.securityConfig : null;
    next.systemVariables = normalizeSystemVariables(next.systemVariables);
    next.crmErpDatabaseUrl = postgresService.normalizeConnectionUrl(next.crmErpDatabaseUrl || '');
    next.crmErpDatabaseSchemaSnapshot = normalizeCrmErpDatabaseSnapshot(next.crmErpDatabaseSchemaSnapshot);
    return next;
  }

  function normalizeSettingsPage(value) {
    const page = String(value || '').trim();
    return Object.values(SETTINGS_PAGES).includes(page) ? page : SETTINGS_PAGES.HOME;
  }

  function setSettingsPage(nextPage) {
    const safePage = normalizeSettingsPage(nextPage);
    if (settingsShell) {
      settingsShell.dataset.settingsPage = safePage;
    }

    for (const pageNode of settingsPages) {
      pageNode.classList.toggle('is-active', pageNode.dataset.settingsPage === safePage);
    }

    if (settingsSectionBackBtn) {
      settingsSectionBackBtn.hidden = safePage === SETTINGS_PAGES.HOME;
    }

    if (safePage === SETTINGS_PAGES.AI_MODELS) {
      renderAiModelsSettings();
      if (isAiModelsAccessLocked()) {
        aiModelsAccessActionBtn?.focus();
      }
    }

    if (safePage === SETTINGS_PAGES.CRM_ERP_DATABASE) {
      renderCrmErpDatabaseSettings({ syncInput: true });
    }

    if (safePage === SETTINGS_PAGES.SYSTEM_VARIABLES) {
      renderSystemVariables();
    }
  }

  function getModelProfiles() {
    const rawList = Array.isArray(panelSettings.aiModelProfiles) ? panelSettings.aiModelProfiles : [];
    return rawList.map((item, index) => aiProviderService.normalizeProfile(item, index));
  }

  function setModelProfiles(nextProfiles) {
    const normalized = (Array.isArray(nextProfiles) ? nextProfiles : []).map((item, index) =>
      aiProviderService.normalizeProfile(item, index)
    );
    panelSettings.aiModelProfiles = normalized;
    if (settingsScreenState) {
      settingsScreenState.panelSettings = {
        ...settingsScreenState.panelSettings,
        aiModelProfiles: normalized
      };
    }
  }

  function getPrimaryProfileId() {
    const storedId = String(panelSettings.primaryModelProfileId || '').trim();
    return storedId || DEFAULT_PRIMARY_MODEL_ID;
  }

  function getModelProfileById(profileId) {
    const safeId = String(profileId || '').trim();
    return getModelProfiles().find((item) => item.id === safeId) || null;
  }

  function getActiveModelProfile() {
    const fromState = getModelProfileById(currentChatModelProfileId);
    if (fromState) {
      return fromState;
    }

    const fromPrimary = getModelProfileById(getPrimaryProfileId());
    if (fromPrimary) {
      return fromPrimary;
    }

    const first = getModelProfiles()[0];
    return first || null;
  }

  function getActiveModel() {
    const profile = getActiveModelProfile();
    return profile ? profile.model : DEFAULT_OLLAMA_MODEL;
  }

  function getModelProfileLabel(profile) {
    const safeProfile = aiProviderService.normalizeProfile(profile);
    const providerMeta = aiProviderService.getProviderMetadata(safeProfile.provider);
    return `${safeProfile.name} (${providerMeta.label} · ${safeProfile.model})`;
  }

  function profileCanBeUsed(profile) {
    const safeProfile = aiProviderService.normalizeProfile(profile);
    if (!aiProviderService.requiresApiKey(safeProfile.provider)) {
      return true;
    }

    if (!safeProfile.hasApiKey || !isPinConfigured()) {
      return false;
    }

    return true;
  }

  function getProviderDefaultModel(providerId) {
    const provider = aiProviderService.normalizeProviderId(providerId);

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

    return localOllamaModels[0] || DEFAULT_OLLAMA_MODEL;
  }

  function resolvePrimaryProfileId() {
    const profiles = getModelProfiles();
    if (!profiles.length) {
      return '';
    }

    const preferred = getPrimaryProfileId();
    const preferredProfile = profiles.find((item) => item.id === preferred);
    if (preferredProfile) {
      return preferredProfile.id;
    }

    return profiles[0].id;
  }

  function resolveUsableProfileId() {
    const profiles = getModelProfiles();
    if (!profiles.length) {
      return '';
    }

    const firstReady = profiles.find((item) => profileCanBeUsed(item));
    return firstReady ? firstReady.id : resolvePrimaryProfileId();
  }

  function resolveModelProfileForInference() {
    const activeProfile = getActiveModelProfile();
    if (activeProfile && profileCanBeUsed(activeProfile)) {
      return activeProfile;
    }

    const fallbackId = resolveUsableProfileId();
    return getModelProfileById(fallbackId);
  }

  function syncModelSelectors() {
    const profiles = getModelProfiles();
    const resolvedPrimary = resolvePrimaryProfileId();

    if (!profiles.length) {
      currentChatModelProfileId = '';
    } else if (!profiles.some((item) => item.id === currentChatModelProfileId)) {
      currentChatModelProfileId = resolvedPrimary;
    }

    if (chatModelSelect) {
      chatModelSelect.textContent = '';

      for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = getModelProfileLabel(profile);
        option.disabled = !profileCanBeUsed(profile) && profile.id !== currentChatModelProfileId;
        chatModelSelect.appendChild(option);
      }

      const selectedId = profiles.some((item) => item.id === currentChatModelProfileId)
        ? currentChatModelProfileId
        : resolvedPrimary;
      chatModelSelect.value = selectedId;
      currentChatModelProfileId = selectedId;
    }

    if (aiPrimaryModelSelect) {
      aiPrimaryModelSelect.textContent = '';

      for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = getModelProfileLabel(profile);
        option.disabled = !profileCanBeUsed(profile) && profile.id !== resolvedPrimary;
        aiPrimaryModelSelect.appendChild(option);
      }

      aiPrimaryModelSelect.value = resolvedPrimary;
    }
  }

  function getSecurityConfig() {
    return panelSettings.securityConfig && typeof panelSettings.securityConfig === 'object'
      ? panelSettings.securityConfig
      : null;
  }

  function isPinConfigured() {
    return pinCryptoService.isConfigured(getSecurityConfig());
  }

  function normalizePinUnlockSession(rawValue) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const pin = String(raw.pin || '').trim();
    const expiresAt = Math.max(0, Number(raw.expiresAt) || 0);

    if (!/^\d{4}$/.test(pin) || !expiresAt) {
      return null;
    }

    return {
      pin,
      expiresAt
    };
  }

  async function readPinUnlockSession() {
    const payload = await readChromeSession({
      [PIN_UNLOCK_SESSION_STORAGE_KEY]: null
    });
    return normalizePinUnlockSession(payload?.[PIN_UNLOCK_SESSION_STORAGE_KEY]);
  }

  async function writePinUnlockSession(pin, expiresAt) {
    const safePin = pinCryptoService.validatePin(pin);
    const safeExpiresAt = Math.max(Date.now() + 60000, Number(expiresAt) || 0);

    return writeChromeSession({
      [PIN_UNLOCK_SESSION_STORAGE_KEY]: {
        pin: safePin,
        expiresAt: safeExpiresAt,
        updatedAt: Date.now()
      }
    });
  }

  async function clearPinUnlockSession() {
    await removeChromeSession(PIN_UNLOCK_SESSION_STORAGE_KEY);
  }

  async function setPinUnlockedSession(pin, ttlMs = PIN_UNLOCK_SESSION_TTL_MS) {
    const safePin = pinCryptoService.validatePin(pin);
    const safeTtl = Math.max(60000, Number(ttlMs) || PIN_UNLOCK_SESSION_TTL_MS);
    const expiresAt = Date.now() + safeTtl;

    unlockedPin = safePin;
    unlockedPinExpiresAt = expiresAt;
    await writePinUnlockSession(safePin, expiresAt);
  }

  async function hydratePinUnlockSession() {
    if (!isPinConfigured()) {
      resetPinSession();
      return false;
    }

    const persistedSession = await readPinUnlockSession();
    if (!persistedSession) {
      unlockedPin = '';
      unlockedPinExpiresAt = 0;
      return false;
    }

    if (persistedSession.expiresAt <= Date.now()) {
      resetPinSession();
      return false;
    }

    const isValid = await pinCryptoService.verifyPin(persistedSession.pin, getSecurityConfig());
    if (!isValid) {
      resetPinSession();
      return false;
    }

    unlockedPin = persistedSession.pin;
    unlockedPinExpiresAt = persistedSession.expiresAt;
    return true;
  }

  function isPinUnlocked() {
    if (!isPinConfigured() || !unlockedPin) {
      return false;
    }

    if (unlockedPinExpiresAt > 0 && Date.now() > unlockedPinExpiresAt) {
      resetPinSession();
      return false;
    }

    return true;
  }

  function resetPinSession(options = {}) {
    const clearPersisted = options.clearPersisted !== false;
    unlockedPin = '';
    unlockedPinExpiresAt = 0;

    if (clearPersisted) {
      void clearPinUnlockSession();
    }
  }

  function getAiModelsAccessMode() {
    if (!isPinConfigured()) {
      return PIN_MODAL_MODES.SETUP;
    }

    if (!isPinUnlocked()) {
      return PIN_MODAL_MODES.UNLOCK;
    }

    return '';
  }

  function isAiModelsAccessLocked() {
    return Boolean(getAiModelsAccessMode());
  }

  function renderAiModelsAccessWall() {
    const mode = getAiModelsAccessMode();
    const isLocked = Boolean(mode);

    if (aiModelsAccessWall) {
      aiModelsAccessWall.hidden = !isLocked;
    }
    if (aiModelsProtectedContent) {
      aiModelsProtectedContent.hidden = isLocked;
    }

    if (!isLocked) {
      return;
    }

    if (aiModelsAccessCopy) {
      aiModelsAccessCopy.textContent =
        mode === PIN_MODAL_MODES.SETUP
          ? 'Configura un PIN de 4 digitos para proteger API keys y habilitar AI Models.'
          : 'Ingresa tu PIN para desbloquear el acceso a AI Models y usar API keys.';
    }
    if (aiModelsAccessActionBtn) {
      aiModelsAccessActionBtn.textContent = mode === PIN_MODAL_MODES.SETUP ? 'Configurar PIN' : 'Desbloquear PIN';
    }
  }

  function renderPinStatus() {
    if (!settingsPinStatus) {
      return;
    }

    if (!isPinConfigured()) {
      settingsPinStatus.textContent = 'PIN no configurado. Recomendado para cifrar API keys.';
    } else if (isPinUnlocked()) {
      settingsPinStatus.textContent = 'PIN configurado y desbloqueado.';
    } else {
      settingsPinStatus.textContent = 'PIN configurado. Bloqueado para proteger API keys.';
    }

    if (settingsSetupPinBtn) {
      settingsSetupPinBtn.textContent = isPinConfigured() ? 'Reconfigurar PIN' : 'Configurar PIN';
    }
    if (settingsUnlockPinBtn) {
      settingsUnlockPinBtn.disabled = !isPinConfigured() || isPinUnlocked();
    }
    if (settingsLockPinBtn) {
      settingsLockPinBtn.disabled = !isPinUnlocked();
    }
  }

  function renderAiModelsSettings() {
    syncModelSelectors();
    renderPinStatus();
    renderAiModelsAccessWall();

    if (!aiModelsList) {
      return;
    }

    if (isAiModelsAccessLocked()) {
      aiModelsList.textContent = '';
      return;
    }

    const profiles = getModelProfiles();
    const primaryId = resolvePrimaryProfileId();
    aiModelsList.textContent = '';

    if (!profiles.length) {
      const item = document.createElement('li');
      item.className = 'ai-model-item';
      item.textContent = 'No hay modelos configurados.';
      aiModelsList.appendChild(item);
      return;
    }

    for (const profile of profiles) {
      const providerMeta = aiProviderService.getProviderMetadata(profile.provider);
      const isPrimary = profile.id === primaryId;
      const keyState = aiProviderService.requiresApiKey(profile.provider)
        ? profile.hasApiKey
          ? 'API key configurada'
          : 'API key pendiente'
        : 'Modelo local (sin API key)';

      const item = document.createElement('li');
      item.className = 'ai-model-item';
      item.dataset.profileId = profile.id;

      const head = document.createElement('div');
      head.className = 'ai-model-item__head';

      const title = document.createElement('strong');
      title.className = 'ai-model-item__title';
      title.textContent = profile.name;

      const primaryBadge = document.createElement('span');
      primaryBadge.className = 'ai-model-item__primary';
      primaryBadge.textContent = isPrimary ? 'Principal' : 'Disponible';

      head.append(title, primaryBadge);

      const meta = document.createElement('p');
      meta.className = 'ai-model-item__meta';
      meta.textContent = `${providerMeta.label} · ${profile.model} · ${keyState}`;

      const actions = document.createElement('div');
      actions.className = 'ai-model-item__actions';

      const primaryButton = document.createElement('button');
      primaryButton.className = 'ai-model-item__btn';
      primaryButton.type = 'button';
      primaryButton.dataset.modelAction = 'set-primary';
      primaryButton.textContent = isPrimary ? 'Usando ahora' : 'Usar como principal';
      primaryButton.disabled = isPrimary || !profileCanBeUsed(profile);

      actions.appendChild(primaryButton);

      if (aiProviderService.requiresApiKey(profile.provider)) {
        const editButton = document.createElement('button');
        editButton.className = 'ai-model-item__btn';
        editButton.type = 'button';
        editButton.dataset.modelAction = 'edit-key';
        editButton.textContent = 'Editar API key';
        actions.appendChild(editButton);
      }

      item.append(head, meta, actions);
      aiModelsList.appendChild(item);
    }
  }

  function updateModelModalProviderUi() {
    const provider = aiProviderService.normalizeProviderId(modelProviderSelect?.value || AI_PROVIDER_IDS.OPENAI);
    const needsApiKey = aiProviderService.requiresApiKey(provider);
    const isCompatible = provider === AI_PROVIDER_IDS.OPENAI_COMPATIBLE;
    const editMode = modelModalState.mode === 'edit';

    if (modelBaseUrlField) {
      modelBaseUrlField.hidden = !isCompatible;
    }
    if (modelApiKeyField) {
      modelApiKeyField.hidden = !needsApiKey;
    }

    if (modelProviderSelect) {
      modelProviderSelect.disabled = editMode;
    }
    if (modelDisplayNameInput) {
      modelDisplayNameInput.disabled = editMode;
    }
    if (modelIdInput) {
      modelIdInput.disabled = editMode;
    }
    if (modelBaseUrlInput) {
      modelBaseUrlInput.disabled = editMode || !isCompatible;
    }

    if (modelConfigClearKeyBtn) {
      const profile = getModelProfileById(modelModalState.profileId);
      modelConfigClearKeyBtn.hidden = !(editMode && profile && profile.hasApiKey);
    }

    if (!editMode) {
      if (modelIdInput && !String(modelIdInput.value || '').trim()) {
        modelIdInput.value = getProviderDefaultModel(provider);
      }

      if (modelDisplayNameInput && !String(modelDisplayNameInput.value || '').trim()) {
        modelDisplayNameInput.value = aiProviderService.getProviderMetadata(provider).label;
      }
    }
  }

  function openModelConfigModal(mode = 'add', profileId = '') {
    modelModalState = {
      mode: mode === 'edit' ? 'edit' : 'add',
      profileId: String(profileId || '').trim()
    };

    setStatus(modelConfigStatus, '');

    if (modelModalState.mode === 'edit') {
      const profile = getModelProfileById(modelModalState.profileId);
      if (!profile) {
        setStatus(aiModelsStatus, 'No se encontro el modelo para editar.', true);
        return;
      }

      if (modelConfigTitle) {
        modelConfigTitle.textContent = 'Editar API key';
      }
      if (modelConfigSaveBtn) {
        modelConfigSaveBtn.textContent = 'Guardar API key';
      }

      if (modelProviderSelect) {
        modelProviderSelect.value = profile.provider;
      }
      if (modelDisplayNameInput) {
        modelDisplayNameInput.value = profile.name;
      }
      if (modelIdInput) {
        modelIdInput.value = profile.model;
      }
      if (modelBaseUrlInput) {
        modelBaseUrlInput.value = profile.baseUrl || '';
      }
      if (modelApiKeyInput) {
        modelApiKeyInput.value = '';
      }
    } else {
      if (modelConfigTitle) {
        modelConfigTitle.textContent = 'Agregar modelo';
      }
      if (modelConfigSaveBtn) {
        modelConfigSaveBtn.textContent = 'Agregar modelo';
      }
      if (modelProviderSelect) {
        modelProviderSelect.value = AI_PROVIDER_IDS.OPENAI;
      }
      if (modelDisplayNameInput) {
        modelDisplayNameInput.value = '';
      }
      if (modelIdInput) {
        modelIdInput.value = '';
      }
      if (modelBaseUrlInput) {
        modelBaseUrlInput.value = '';
      }
      if (modelApiKeyInput) {
        modelApiKeyInput.value = '';
      }
    }

    updateModelModalProviderUi();
    if (modelConfigModal) {
      modelConfigModal.hidden = false;
    }

    if (modelModalState.mode === 'edit') {
      modelApiKeyInput?.focus();
    } else {
      modelProviderSelect?.focus();
    }
  }

  function closeModelConfigModal() {
    if (modelConfigModal) {
      modelConfigModal.hidden = true;
    }
    setStatus(modelConfigStatus, '');
  }

  async function saveModelFromModal() {
    const provider = aiProviderService.normalizeProviderId(modelProviderSelect?.value || AI_PROVIDER_IDS.OPENAI);
    const needsApiKey = aiProviderService.requiresApiKey(provider);
    const modelName = normalizeModelName(modelIdInput?.value || '');
    const displayName = String(modelDisplayNameInput?.value || '').trim();
    const baseUrl = String(modelBaseUrlInput?.value || '').trim();
    const apiKey = String(modelApiKeyInput?.value || '').trim();

    if (modelModalState.mode === 'edit') {
      const profile = getModelProfileById(modelModalState.profileId);
      if (!profile) {
        setStatus(modelConfigStatus, 'Modelo no encontrado.', true);
        return;
      }

      if (!apiKey) {
        setStatus(modelConfigStatus, 'Escribe una API key nueva.', true);
        modelApiKeyInput?.focus();
        return;
      }

      try {
        await saveApiKeyForProfile(profile.id, apiKey, { statusTarget: modelConfigStatus });
        renderAiModelsSettings();
        closeModelConfigModal();
        setStatus(aiModelsStatus, `API key actualizada para ${profile.name}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo guardar API key.';
        setStatus(modelConfigStatus, message, true);
      }
      return;
    }

    if (!modelName) {
      setStatus(modelConfigStatus, 'El Model ID es obligatorio.', true);
      modelIdInput?.focus();
      return;
    }

    if (provider === AI_PROVIDER_IDS.OPENAI_COMPATIBLE && !baseUrl) {
      setStatus(modelConfigStatus, 'La Base URL es obligatoria para OpenAI Compatible.', true);
      modelBaseUrlInput?.focus();
      return;
    }

    if (needsApiKey && apiKey) {
      const pinReady = await ensurePinAccess({
        allowSetup: true,
        statusTarget: modelConfigStatus
      });
      if (!pinReady) {
        return;
      }
    }

    const providerMeta = aiProviderService.getProviderMetadata(provider);
    const duplicated = getModelProfiles().some(
      (item) => item.provider === provider && item.model === modelName && String(item.baseUrl || '') === baseUrl
    );
    if (duplicated) {
      setStatus(modelConfigStatus, 'Ese modelo ya existe en la lista.', true);
      return;
    }

    const now = Date.now();
    const profileId = aiProviderService.buildModelProfileId();
    const profile = aiProviderService.normalizeProfile(
      {
        id: profileId,
        name: displayName || `${providerMeta.label} ${modelName}`,
        provider,
        model: modelName,
        baseUrl,
        hasApiKey: false,
        createdAt: now,
        updatedAt: now
      },
      getModelProfiles().length
    );

    const profiles = getModelProfiles();
    profiles.push(profile);
    const ok = await persistModelProfiles(profiles);
    if (!ok) {
      setStatus(modelConfigStatus, 'No se pudo guardar el modelo.', true);
      return;
    }

    if (needsApiKey && apiKey) {
      try {
        await saveApiKeyForProfile(profile.id, apiKey, { statusTarget: modelConfigStatus });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo guardar API key.';
        setStatus(modelConfigStatus, message, true);
        return;
      }
    }

    if (!panelSettings.primaryModelProfileId) {
      await updatePrimaryModel(profile.id);
    } else {
      syncModelSelectors();
      renderAiModelsSettings();
    }

    closeModelConfigModal();
    setStatus(aiModelsStatus, `Modelo ${profile.name} agregado.`);
  }

  async function clearApiKeyFromModal() {
    const profile = getModelProfileById(modelModalState.profileId);
    if (!profile) {
      return;
    }

    const ok = await clearApiKeyForProfile(profile.id);
    if (!ok) {
      setStatus(modelConfigStatus, 'No se pudo eliminar API key.', true);
      return;
    }

    const fallbackPrimary = resolveUsableProfileId();
    if (fallbackPrimary && fallbackPrimary !== getPrimaryProfileId()) {
      await updatePrimaryModel(fallbackPrimary);
    } else {
      renderAiModelsSettings();
    }

    closeModelConfigModal();
    setStatus(aiModelsStatus, `API key eliminada para ${profile.name}.`);
  }

  function resolvePinModalRequest(granted) {
    if (!pinModalRequest) {
      return;
    }

    const resolver = pinModalRequest.resolve;
    pinModalRequest = null;
    resolver(Boolean(granted));
  }

  function requestPinModal(mode) {
    const targetMode = mode === PIN_MODAL_MODES.SETUP ? PIN_MODAL_MODES.SETUP : PIN_MODAL_MODES.UNLOCK;
    if (targetMode === PIN_MODAL_MODES.UNLOCK && isPinUnlocked()) {
      return Promise.resolve(true);
    }

    if (pinModalRequest) {
      if (pinModalMode !== targetMode) {
        openPinModal(targetMode);
      }
      return pinModalRequest.promise;
    }

    let resolver = () => {};
    const promise = new Promise((resolve) => {
      resolver = resolve;
    });
    pinModalRequest = {
      mode: targetMode,
      promise,
      resolve: resolver
    };

    openPinModal(targetMode);
    return promise;
  }

  async function ensurePinAccess(options = {}) {
    const allowSetup = options.allowSetup === true;
    const statusTarget = options.statusTarget || null;

    if (isPinUnlocked()) {
      return true;
    }

    if (!isPinConfigured()) {
      if (!allowSetup) {
        if (statusTarget) {
          setStatus(statusTarget, 'Configura un PIN de seguridad para continuar.', true);
        }
        return false;
      }

      const setupReady = await requestPinModal(PIN_MODAL_MODES.SETUP);
      if (!setupReady || !isPinUnlocked()) {
        if (statusTarget) {
          setStatus(statusTarget, 'Se requiere PIN para continuar.', true);
        }
        return false;
      }

      return true;
    }

    const unlocked = await requestPinModal(PIN_MODAL_MODES.UNLOCK);
    if (!unlocked || !isPinUnlocked()) {
      if (statusTarget) {
        setStatus(statusTarget, 'Se requiere PIN para continuar.', true);
      }
      return false;
    }

    return true;
  }

  function openPinModal(mode = PIN_MODAL_MODES.SETUP) {
    pinModalMode = mode === PIN_MODAL_MODES.UNLOCK ? PIN_MODAL_MODES.UNLOCK : PIN_MODAL_MODES.SETUP;
    const unlockMode = pinModalMode === PIN_MODAL_MODES.UNLOCK;

    if (unlockMode) {
      if (pinModalTitle) {
        pinModalTitle.textContent = 'Desbloquear PIN';
      }
      if (pinModalCopy) {
        pinModalCopy.textContent = 'Ingresa tu PIN para descifrar API keys y usar modelos externos.';
      }
      if (pinModalSaveBtn) {
        pinModalSaveBtn.textContent = 'Desbloquear';
      }
    } else {
      if (pinModalTitle) {
        pinModalTitle.textContent = isPinConfigured() ? 'Reconfigurar PIN' : 'Configurar PIN';
      }
      if (pinModalCopy) {
        pinModalCopy.textContent =
          'El PIN (4 digitos) se usa para cifrar API keys sensibles en IndexedDB y proteger acceso local.';
      }
      if (pinModalSaveBtn) {
        pinModalSaveBtn.textContent = isPinConfigured() ? 'Cambiar PIN' : 'Guardar PIN';
      }
    }

    if (pinConfirmField) {
      pinConfirmField.hidden = unlockMode;
      pinConfirmField.style.display = unlockMode ? 'none' : '';
      pinConfirmField.setAttribute('aria-hidden', unlockMode ? 'true' : 'false');
    }

    pinConfirmDigitInputs.forEach((input) => {
      if (!input) {
        return;
      }
      input.disabled = unlockMode;
      input.tabIndex = unlockMode ? -1 : 0;
    });

    if (pinInput) {
      pinInput.value = '';
    }
    if (pinConfirmInput) {
      pinConfirmInput.value = '';
    }
    clearPinInputs();
    setStatus(pinModalStatus, '');

    if (pinModal) {
      pinModal.hidden = false;
    }

    focusPinFirstDigit();
  }

  function closePinModal(options = {}) {
    const keepRequest = options.keepRequest === true;
    if (pinModal) {
      pinModal.hidden = true;
    }
    setStatus(pinModalStatus, '');

    if (!keepRequest) {
      resolvePinModalRequest(false);
    }
  }

  async function rotateEncryptedApiKeys({ oldPin, oldConfig, newPin, newConfig }) {
    const profiles = getModelProfiles().filter(
      (item) => aiProviderService.requiresApiKey(item.provider) && item.hasApiKey === true
    );

    const plainByProfile = new Map();
    for (const profile of profiles) {
      const payload = await readSecret(buildProfileSecretKey(profile.id));
      if (!payload) {
        continue;
      }

      const plain = await pinCryptoService.decryptSecret(oldPin, oldConfig, payload);
      plainByProfile.set(profile.id, plain);
    }

    for (const [profileId, plainText] of plainByProfile.entries()) {
      const encrypted = await pinCryptoService.encryptSecret(newPin, newConfig, plainText);
      await saveSecret(buildProfileSecretKey(profileId), encrypted);
    }
  }

  async function savePinFromModal() {
    syncPinHiddenInputs();
    const pin = readPinDigits(pinDigitInputs);

    try {
      pinCryptoService.validatePin(pin);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PIN invalido.';
      setStatus(pinModalStatus, message, true);
      return;
    }

    if (pinModalMode === PIN_MODAL_MODES.UNLOCK) {
      const config = getSecurityConfig();
      const isValid = await pinCryptoService.verifyPin(pin, config);
      if (!isValid) {
        setStatus(pinModalStatus, 'PIN incorrecto.', true);
        return;
      }

      await setPinUnlockedSession(pin);
      syncModelSelectors();
      renderAiModelsSettings();
      renderPinStatus();
      resolvePinModalRequest(true);
      closePinModal({ keepRequest: true });
      setStatus(aiModelsStatus, 'PIN desbloqueado. Ya puedes usar modelos externos.');
      return;
    }

    const confirmPin = readPinDigits(pinConfirmDigitInputs);
    if (pin !== confirmPin) {
      setStatus(pinModalStatus, 'El PIN y la confirmacion no coinciden.', true);
      return;
    }

    const oldConfig = getSecurityConfig();
    const hadPin = isPinConfigured();
    const oldPin = unlockedPin;

    if (hadPin && !isPinUnlocked()) {
      setStatus(pinModalStatus, 'Desbloquea tu PIN actual antes de cambiarlo.', true);
      return;
    }

    try {
      const newConfig = await pinCryptoService.createSecurityConfig(pin);
      const ok = await savePanelSettings({ securityConfig: newConfig });
      if (!ok) {
        setStatus(pinModalStatus, 'No se pudo guardar la configuracion del PIN.', true);
        return;
      }

      await setPinUnlockedSession(pin);

      if (hadPin && oldConfig) {
        await rotateEncryptedApiKeys({ oldPin, oldConfig, newPin: pin, newConfig });
      }
      syncModelSelectors();
      renderAiModelsSettings();
      renderPinStatus();
      resolvePinModalRequest(true);
      closePinModal({ keepRequest: true });
      setStatus(aiModelsStatus, hadPin ? 'PIN actualizado.' : 'PIN configurado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo configurar el PIN.';
      setStatus(pinModalStatus, message, true);
    }
  }

  function applyPanelSettingsToUi() {
    if (!settingsScreenController || !settingsScreenState) {
      return;
    }

    settingsScreenController.applyPanelSettingsToUi();
    panelSettings = { ...settingsScreenState.panelSettings };
    currentChatModelProfileId = resolvePrimaryProfileId();
    syncModelSelectors();
    renderPinStatus();
    renderCrmErpDatabaseSettings({ syncInput: true });
  }

  function populateSettingsForm() {
    settingsScreenController?.populateSettingsForm();
    syncModelSelectors();
    renderPinStatus();
    renderCrmErpDatabaseSettings({ syncInput: true });
    setStatus(settingsCrmErpDbStatus, '');
  }

  function isOnboardingComplete() {
    return settingsScreenController ? settingsScreenController.isOnboardingComplete() : panelSettings.onboardingDone === true;
  }

  function resolveHomeOrOnboardingScreen() {
    return settingsScreenController
      ? settingsScreenController.resolveHomeOrOnboardingScreen()
      : isOnboardingComplete()
        ? 'home'
        : 'onboarding';
  }

  function goToPrimaryScreen() {
    const nextScreen = resolveHomeOrOnboardingScreen();
    setScreen(nextScreen);

    if (nextScreen === 'home') {
      requestChatAutofocus(8, 80);
      return;
    }

    onboardingNameInput?.focus();
  }

  async function refreshLocalModels(options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) {
      setStatus(aiModelsStatus, 'Consultando Ollama local...', false, { loading: true });
    }

    const activeProfile = getModelProfiles().find((item) => item.provider === AI_PROVIDER_IDS.OLLAMA) || null;
    const referenceModel = activeProfile ? activeProfile.model : DEFAULT_OLLAMA_MODEL;

    try {
      localOllamaModels = await aiProviderService.fetchLocalModels(referenceModel);
      if (!silent) {
        setStatus(aiModelsStatus, `Modelos locales detectados: ${localOllamaModels.length}.`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar modelos locales.';
      if (!silent) {
        setStatus(aiModelsStatus, message, true);
      }
      return false;
    }
  }

  async function updatePrimaryModel(profileId) {
    const safeId = String(profileId || '').trim();
    if (!safeId) {
      return;
    }

    const profile = getModelProfileById(safeId);
    if (!profile) {
      return;
    }

    if (!profileCanBeUsed(profile)) {
      setStatus(aiModelsStatus, 'Completa API key del modelo antes de usarlo como principal.', true);
      syncModelSelectors();
      return;
    }

    currentChatModelProfileId = safeId;
    const ok = await savePanelSettings({
      primaryModelProfileId: safeId,
      defaultModel: profile.model
    });

    if (!ok) {
      setStatus(aiModelsStatus, 'No se pudo guardar el modelo principal.', true);
      return;
    }

    syncModelSelectors();
    renderAiModelsSettings();
    setStatus(chatStatus, `Modelo activo: ${profile.model}.`);
    warmupPrimaryModel();
  }

  function warmupPrimaryModel() {
    if (modelWarmupPromise) {
      return modelWarmupPromise;
    }

    modelWarmupPromise = (async () => {
      const profile = getActiveModelProfile();
      if (!profile) {
        return false;
      }

      if (profile.provider !== AI_PROVIDER_IDS.OLLAMA) {
        return true;
      }

      try {
        await aiProviderService.warmupProfile(profile);
        if (!isGeneratingChat && !chatHistory.length) {
          setStatus(chatStatus, `Modelo local listo: ${profile.model}.`);
        }
        return true;
      } catch (error) {
        if (isGeneratingChat) {
          return false;
        }

        const message = error instanceof Error ? error.message : 'No se pudo precargar el modelo local.';
        if (!chatHistory.length) {
          setStatus(chatStatus, message, true);
        }
        return false;
      } finally {
        modelWarmupPromise = null;
      }
    })();

    return modelWarmupPromise;
  }

  async function readChatHistory() {
    return storageService.readChatHistory();
  }

  async function saveChatHistory() {
    return storageService.saveChatHistory(chatHistory);
  }

  async function syncWhatsappChatContext(tabContext, options = {}) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return {
        ok: false,
        synced: false,
        reason: 'not_whatsapp',
        messagesUpserted: 0,
        totalMessages: 0
      };
    }

    return storageService.syncWhatsappTabContext(tabContext, options);
  }

  async function readWhatsappChatHistory(tabContext, options = {}) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return {
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
    }

    return storageService.readWhatsappChatHistory(tabContext, options);
  }

  async function readPanelSettings() {
    return storageService.readPanelSettings();
  }

  async function savePanelSettings(nextSettings) {
    const patch = nextSettings && typeof nextSettings === 'object' ? nextSettings : {};
    if (settingsScreenState) {
      settingsScreenState.panelSettings = { ...settingsScreenState.panelSettings, ...patch };
      panelSettings = { ...settingsScreenState.panelSettings };
    } else {
      panelSettings = { ...panelSettings, ...patch };
    }

    if (!panelSettings.systemPrompt || !String(panelSettings.systemPrompt || '').trim()) {
      panelSettings.systemPrompt = buildDefaultChatSystemPrompt(panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE);
    }

    panelSettings.systemVariables = normalizeSystemVariables(panelSettings.systemVariables);
    panelSettings.crmErpDatabaseUrl = postgresService.normalizeConnectionUrl(panelSettings.crmErpDatabaseUrl || '');
    panelSettings.crmErpDatabaseSchemaSnapshot = normalizeCrmErpDatabaseSnapshot(panelSettings.crmErpDatabaseSchemaSnapshot);

    if (settingsScreenState) {
      settingsScreenState.panelSettings = {
        ...settingsScreenState.panelSettings,
        systemPrompt: panelSettings.systemPrompt,
        systemVariables: { ...panelSettings.systemVariables },
        crmErpDatabaseUrl: panelSettings.crmErpDatabaseUrl,
        crmErpDatabaseSchemaSnapshot: panelSettings.crmErpDatabaseSchemaSnapshot
      };
    }
    return storageService.savePanelSettings(panelSettings);
  }

  async function readSecret(secretKey) {
    return storageService.readSecret(secretKey);
  }

  async function saveSecret(secretKey, value) {
    return storageService.saveSecret(secretKey, value);
  }

  async function deleteSecret(secretKey) {
    return storageService.deleteSecret(secretKey);
  }

  function buildProfileSecretKey(profileId) {
    return `${SECRET_KEY_PREFIX}${String(profileId || '').trim()}`;
  }

  async function persistModelProfiles(nextProfiles) {
    const normalized = (Array.isArray(nextProfiles) ? nextProfiles : []).map((item, index) =>
      aiProviderService.normalizeProfile(item, index)
    );
    setModelProfiles(normalized);
    return savePanelSettings({ aiModelProfiles: normalized });
  }

  async function patchModelProfile(profileId, patch) {
    const safeId = String(profileId || '').trim();
    const profiles = getModelProfiles();
    const index = profiles.findIndex((item) => item.id === safeId);
    if (index === -1) {
      return false;
    }

    profiles[index] = {
      ...profiles[index],
      ...(patch && typeof patch === 'object' ? patch : {}),
      updatedAt: Date.now()
    };

    return persistModelProfiles(profiles);
  }

  async function saveApiKeyForProfile(profileId, apiKey, options = {}) {
    const statusTarget = options?.statusTarget || null;
    const profile = getModelProfileById(profileId);
    if (!profile) {
      throw new Error('Modelo no encontrado.');
    }

    if (!aiProviderService.requiresApiKey(profile.provider)) {
      return true;
    }

    const pinReady = await ensurePinAccess({
      allowSetup: true,
      statusTarget
    });
    if (!pinReady) {
      throw new Error('Operacion cancelada. Se requiere PIN para guardar API keys.');
    }

    const token = String(apiKey || '').trim();
    if (!token) {
      throw new Error('La API key no puede estar vacia.');
    }

    const encrypted = await pinCryptoService.encryptSecret(unlockedPin, getSecurityConfig(), token);
    const secretKey = buildProfileSecretKey(profile.id);
    const saved = await saveSecret(secretKey, encrypted);
    if (!saved) {
      throw new Error('No se pudo guardar la API key cifrada.');
    }

    const ok = await patchModelProfile(profile.id, { hasApiKey: true });
    if (!ok) {
      throw new Error('No se pudo actualizar el estado del modelo.');
    }

    return true;
  }

  async function clearApiKeyForProfile(profileId) {
    const profile = getModelProfileById(profileId);
    if (!profile) {
      return false;
    }

    const secretKey = buildProfileSecretKey(profile.id);
    await deleteSecret(secretKey);
    return patchModelProfile(profile.id, { hasApiKey: false });
  }

  async function getApiKeyForProfile(profile, options = {}) {
    const statusTarget = options?.statusTarget || null;
    const safeProfile = aiProviderService.normalizeProfile(profile);

    if (!aiProviderService.requiresApiKey(safeProfile.provider)) {
      return '';
    }

    if (!safeProfile.hasApiKey) {
      throw new Error(`Falta API key para ${safeProfile.name}.`);
    }

    if (!isPinConfigured()) {
      throw new Error('Configura un PIN de seguridad para usar API keys.');
    }

    const pinReady = await ensurePinAccess({
      allowSetup: false,
      statusTarget
    });
    if (!pinReady) {
      throw new Error('Operacion cancelada. Se requiere PIN para usar API keys.');
    }

    const payload = await readSecret(buildProfileSecretKey(safeProfile.id));
    if (!payload) {
      throw new Error(`No se encontro API key para ${safeProfile.name}.`);
    }

    return pinCryptoService.decryptSecret(unlockedPin, getSecurityConfig(), payload);
  }

  function setChatTool(toolName) {
    selectedChatTool = CHAT_TOOLS[toolName] ? toolName : DEFAULT_CHAT_TOOL;
    chatToolLabel.textContent = CHAT_TOOLS[selectedChatTool].label;

    for (const option of chatToolOptions) {
      const isActive = option.dataset.chatTool === selectedChatTool;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  }

  function getResolvedTheme(mode) {
    if (mode === 'dark' || mode === 'light') {
      return mode;
    }

    if (prefersDarkMedia) {
      return prefersDarkMedia.matches ? 'dark' : 'light';
    }

    return 'dark';
  }

  function getThemeLabel(mode) {
    if (mode === 'dark') {
      return 'Oscuro';
    }

    if (mode === 'light') {
      return 'Claro';
    }

    return 'Sistema';
  }

  function normalizeThemeMode(mode) {
    const raw = String(mode || '')
      .trim()
      .toLowerCase();

    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw;
    }

    return 'system';
  }

  function applyTheme(mode) {
    const safeMode = normalizeThemeMode(mode);
    const resolvedMode = getResolvedTheme(safeMode);

    themeMode = safeMode;
    document.documentElement.dataset.theme = resolvedMode;
  }

  async function setThemeMode(nextMode, options = {}) {
    const silent = Boolean(options.silent);
    const safeMode = normalizeThemeMode(nextMode);
    applyTheme(safeMode);

    const ok = await saveSettings({ [PREFERENCE_KEYS.UI_THEME_MODE]: safeMode });
    if (!ok && !silent) {
      setStatus(settingsUserStatus, 'No se pudo guardar apariencia.', true);
      return false;
    }

    if (!silent) {
      setStatus(settingsUserStatus, `Apariencia: ${getThemeLabel(safeMode)}.`);
    }

    return ok;
  }

  function openToolMenu() {
    if (!chatToolMenu || !chatToolBtn) {
      return;
    }
    chatToolMenu.hidden = false;
    chatToolBtn.setAttribute('aria-expanded', 'true');
  }

  function closeToolMenu() {
    if (!chatToolMenu || !chatToolBtn) {
      return;
    }
    chatToolMenu.hidden = true;
    chatToolBtn.setAttribute('aria-expanded', 'false');
  }

  function updateChatInputSize() {
    chatInput.style.height = 'auto';

    const computed = window.getComputedStyle(chatInput);
    const lineHeight = parseFloat(computed.lineHeight) || 20;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;
    const maxHeight = lineHeight * MAX_CHAT_INPUT_ROWS + paddingTop + paddingBottom;

    const next = Math.min(chatInput.scrollHeight, maxHeight);
    const minimum = lineHeight + paddingTop + paddingBottom;

    chatInput.style.height = `${Math.max(next, minimum)}px`;
    chatInput.style.overflowY = chatInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function createChatMessageNode(message) {
    const article = document.createElement('article');
    article.className = `chat-message chat-message--${message.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    const visibleText = message.role === 'assistant' ? stripEmotionTag(message.content) : message.content;

    if (message.role === 'assistant' && message.pending && !visibleText) {
      const loader = document.createElement('span');
      loader.className = 'chat-inline-loader chat-inline-loader--solo';
      loader.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'sr-only';
      label.textContent = 'Generando respuesta';

      bubble.append(loader, label);
    } else {
      if (message.role === 'assistant') {
        renderMarkdownInto(bubble, visibleText || message.content);
      } else {
        bubble.textContent = visibleText || message.content;
      }
    }

    article.appendChild(bubble);

    return article;
  }

  function scrollChatToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function renderChatMessages() {
    const nearBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 70;
    chatMessagesEl.textContent = '';

    if (!chatHistory.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.textContent = 'Escribe un mensaje para chatear. Enter envia, Shift+Enter agrega salto de linea.';
      chatMessagesEl.appendChild(empty);
      return;
    }

    for (const message of chatHistory) {
      chatMessagesEl.appendChild(createChatMessageNode(message));
    }

    if (nearBottom) {
      scrollChatToBottom();
    }
  }

  function scheduleChatRender() {
    if (pendingChatRenderRaf) {
      return;
    }

    pendingChatRenderRaf = requestAnimationFrame(() => {
      pendingChatRenderRaf = 0;
      renderChatMessages();
      scrollChatToBottom();
    });
  }

  async function pushChatMessage(role, content, options = {}) {
    const text = content.trim();
    if (!text) {
      return;
    }

    const contextUsedRaw = Array.isArray(options.context_used)
      ? options.context_used
      : Array.isArray(options.contextUsed)
        ? options.contextUsed
        : [];
    const extractedFactsRaw = Array.isArray(options.extracted_facts)
      ? options.extracted_facts
      : Array.isArray(options.extractedFacts)
        ? options.extractedFacts
        : [];

    const contextUsed = contextUsedRaw
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 12);

    const extractedFacts = extractedFactsRaw
      .map((item) => {
        if (typeof item === 'string') {
          const textValue = item.trim();
          return textValue ? { type: 'user_fact', text: textValue } : null;
        }

        if (!item || typeof item !== 'object') {
          return null;
        }

        const type = String(item.type || 'user_fact').trim() || 'user_fact';
        const textValue = String(item.text || '').trim();
        if (!textValue) {
          return null;
        }

        return {
          type,
          text: textValue
        };
      })
      .filter(Boolean)
      .slice(0, 8);

    const messageRecord = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content: text,
      tool: selectedChatTool,
      context_used: contextUsed,
      extracted_facts: extractedFacts,
      createdAt: Date.now()
    };

    chatHistory.push(messageRecord);

    const maxHistoryMessages = getSystemVariableNumber('chat.maxHistoryMessages', MAX_CHAT_HISTORY_MESSAGES);
    if (chatHistory.length > maxHistoryMessages) {
      chatHistory = chatHistory.slice(-maxHistoryMessages);
    }

    renderChatMessages();
    scrollChatToBottom();
    await saveChatHistory();
    return messageRecord;
  }

  async function resetChatHistory() {
    chatHistory = [];
    renderChatMessages();
    await saveChatHistory();
    setStatus(chatStatus, 'Historial limpiado.');
    startRandomEmotionCycle({ immediate: true });
  }

  function buildActiveTabsSystemContext(limit = 10) {
    const tabs = Array.isArray(tabContextSnapshot?.tabs) ? tabContextSnapshot.tabs : [];
    const trimmed = tabs.slice(0, limit);

    if (!trimmed.length) {
      return 'Navegacion activa (tabs abiertas): sin tabs detectadas.';
    }

    const lines = trimmed.map((tab, index) => {
      const tabId = Number(tab?.tabId) || -1;
      const site = String(tab?.site || 'generic');
      const title = String(tab?.title || 'Sin titulo').replace(/\s+/g, ' ').trim().slice(0, 120);
      const url = String(tab?.url || '').slice(0, 160);
      const marker = tabId === tabContextSnapshot.activeTabId ? ' (activa)' : '';
      return `${index + 1}. [tabId:${tabId}] ${title}${marker} | site:${site} | ${url}`;
    });

    return `Navegacion activa (tabs abiertas):\n${lines.join('\n')}`;
  }

  function buildRecentHistorySystemContext(limit = 10) {
    const history = Array.isArray(tabContextSnapshot?.history) ? tabContextSnapshot.history : [];
    const trimmed = history.slice(0, limit);

    if (!trimmed.length) {
      return 'Navegacion reciente (historial): sin registros.';
    }

    const lines = trimmed.map((item, index) => {
      const title = String(item?.title || item?.url || 'Sin titulo').replace(/\s+/g, ' ').trim().slice(0, 110);
      const url = String(item?.url || '').slice(0, 150);
      const visits = Math.max(0, Number(item?.visitCount) || 0);
      return `${index + 1}. ${title} | visitas:${visits} | ${url}`;
    });

    return `Navegacion reciente (historial):\n${lines.join('\n')}`;
  }

  function normalizeWhatsappInboxKind(value) {
    const token = String(value || '')
      .trim()
      .toLowerCase();

    if (token === 'group' || token === 'groups' || token === 'grupo' || token === 'grupos') {
      return 'group';
    }

    if (token === 'contact' || token === 'contacts' || token === 'persona' || token === 'personas') {
      return 'contact';
    }

    return 'unknown';
  }

  function getPreferredWhatsappTab(args = {}) {
    const tabs = Array.isArray(tabContextSnapshot?.tabs) ? tabContextSnapshot.tabs : [];
    const requestedTabId = Number(args?.tabId);
    if (Number.isFinite(requestedTabId) && requestedTabId >= 0) {
      const requested = tabs.find((tab) => tab?.tabId === requestedTabId);
      if (requested && isWhatsappContext(requested)) {
        return requested;
      }
    }

    const activeTab = getActiveTabContext();
    if (activeTab && isWhatsappContext(activeTab)) {
      return activeTab;
    }

    return tabs.find((tab) => isWhatsappContext(tab)) || null;
  }

  function buildWhatsappToolsSystemContext(limit = 24) {
    const whatsappTab = getPreferredWhatsappTab();
    if (!whatsappTab) {
      return 'Contexto WhatsApp: no hay tab de WhatsApp disponible para ejecutar tools whatsapp.*.';
    }

    const details = whatsappTab.details && typeof whatsappTab.details === 'object' ? whatsappTab.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const inbox = Array.isArray(details.inbox) ? details.inbox : [];
    const safeLimit = Math.max(4, Math.min(60, Number(limit) || 24));
    const listedChats = inbox.slice(0, safeLimit);
    const lines = listedChats.map((item, index) => {
      const title = String(item?.title || '').replace(/\s+/g, ' ').trim().slice(0, 110) || 'Sin titulo';
      const phone = String(item?.phone || '').trim().slice(0, 40);
      const preview = String(item?.preview || '').replace(/\s+/g, ' ').trim().slice(0, 110);
      const kind = normalizeWhatsappInboxKind(item?.kind || (item?.isGroup ? 'group' : ''));
      const kindLabel = kind === 'group' ? 'group' : kind === 'contact' ? 'contact' : 'unknown';
      const phonePart = phone ? ` | phone:${phone}` : '';
      const previewPart = preview ? ` | preview:${preview}` : '';
      return `${index + 1}. ${title} | kind:${kindLabel}${phonePart}${previewPart}`;
    });

    return [
      `Contexto WhatsApp activo: tabId ${Number(whatsappTab.tabId) || -1}.`,
      `Chat actual: ${buildWhatsappMetaLabel(whatsappTab)}.`,
      'Inbox disponible para decidir acciones (ej. archivar grupos):',
      lines.length ? lines.join('\n') : 'Sin chats en inbox detectados.'
    ].join('\n');
  }

  function buildCrmErpDatabaseToolsContext() {
    const connectionUrl = getCrmErpDatabaseConnectionUrl();
    if (!connectionUrl) {
      return 'Contexto DB CRM/ERP: no configurado. El usuario debe cargar la URL en Settings > CRM/ERP Database.';
    }

    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    if (!snapshot) {
      return [
        'Contexto DB CRM/ERP: conexion configurada, pero no hay analisis de esquema guardado.',
        'Primero ejecuta db.refreshSchema para inspeccionar tablas/columnas.'
      ].join('\n');
    }

    const summary = buildCrmErpSchemaSummary(snapshot, {
      tableLimit: 18,
      columnLimit: 8
    });

    return ['Contexto DB CRM/ERP disponible para tools db.*:', summary].join('\n');
  }

  function buildLocalToolSystemPrompt() {
    const hasWhatsappTab = Boolean(getPreferredWhatsappTab());
    const hasCrmErpDbConnection = Boolean(getCrmErpDatabaseConnectionUrl());
    return [
      'Eres un agente de productividad que opera en el navegador del usuario.',
      'Responde SIEMPRE en Markdown claro.',
      'Si necesitas ejecutar acciones locales del navegador, responde SOLO con un bloque ```tool JSON``` sin texto adicional.',
      'Formato exacto del bloque tool:',
      '```tool',
      '{"tool":"browser.<accion>|whatsapp.<accion>|db.<accion>","args":{...}}',
      '```',
      'Puedes devolver un objeto o un array de objetos tool para encadenar acciones.',
      'Tools disponibles:',
      '- browser.listTabs',
      '- browser.getRecentHistory (args: days, limit, text)',
      '- browser.queryHistoryRange (args: preset=today|yesterday|this_week|last_week|last_friday_afternoon o startISO/endISO/startTime/endTime, days, text, limit, sort)',
      '- browser.getOldestHistoryVisit (args: text, chunkSize, maxChunks)',
      '- browser.openNewTab (args: url, active)',
      '- browser.focusTab (args: tabId o urlContains/titleContains)',
      '- browser.closeTab (args: tabId o url/urlContains/titleContains, preventActive)',
      '- browser.closeNonProductivityTabs (args: dryRun, keepPinned, keepActive, onlyCurrentWindow)',
      ...(hasWhatsappTab
        ? [
            '- whatsapp.getInbox (args: limit)',
            '- whatsapp.openChat (args: query|name|chat|phone|chatIndex, tabId opcional)',
            '- whatsapp.sendMessage (args: text, tabId opcional; envia al chat abierto)',
            '- whatsapp.openChatAndSendMessage (args: query|name|chat|phone + text)',
            '- whatsapp.archiveChats (args: scope=groups|contacts|all, queries, limit, dryRun)',
            '- whatsapp.archiveGroups (alias rapido para scope=groups)'
          ]
        : ['- whatsapp.* requiere tener una tab de WhatsApp abierta.']),
      ...(hasCrmErpDbConnection
        ? [
            '- db.refreshSchema (sin args; inspecciona esquemas/tablas/columnas disponibles)',
            '- db.queryRead (args: sql, params opcional array, maxRows opcional; solo SELECT/CTE/SHOW/EXPLAIN)',
            '- db.queryWrite (args: sql, params opcional array, maxRows opcional; solo INSERT/UPDATE/DELETE)'
          ]
        : ['- db.* requiere configurar la URL de PostgreSQL en Settings > CRM/ERP Database.']),
      'Para preguntas de tiempo (hoy, ayer, semana pasada, viernes por la tarde, visita mas antigua), usa primero tools de historial.',
      'Si el usuario pide acciones en WhatsApp, usa whatsapp.* y prioriza dryRun cuando la accion sea masiva.',
      'Para preguntas de CRM/ERP, usa db.refreshSchema si falta contexto y luego db.queryRead/db.queryWrite segun corresponda.',
      'En db.queryRead agrega LIMIT razonable (<= 100) para evitar respuestas gigantes.',
      'No inventes tools fuera de esta lista.',
      buildActiveTabsSystemContext(),
      buildRecentHistorySystemContext(),
      buildWhatsappToolsSystemContext(),
      buildCrmErpDatabaseToolsContext()
    ].join('\n');
  }

  function shouldForceHistoryToolForQuery(query) {
    const text = String(query || '').toLowerCase();
    if (!text) {
      return false;
    }

    return /(historial|visita|naveg|hoy|ayer|semana pasada|viernes|mes pasado|mas antigu|oldest|today|yesterday|last week)/.test(
      text
    );
  }

  function normalizeLocalToolCall(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const inputTool = String(source.tool || source.action || '').trim();
    const aliases = {
      'browser.list_tabs': 'browser.listTabs',
      'browser.listTabs': 'browser.listTabs',
      'browser.get_recent_history': 'browser.getRecentHistory',
      'browser.getRecentHistory': 'browser.getRecentHistory',
      'browser.query_history_range': 'browser.queryHistoryRange',
      'browser.history_range': 'browser.queryHistoryRange',
      'browser.query_history_by_date_range': 'browser.queryHistoryRange',
      'browser.queryHistoryByDateRange': 'browser.queryHistoryRange',
      'browser.historyByRange': 'browser.queryHistoryRange',
      'browser.queryHistoryRange': 'browser.queryHistoryRange',
      'browser.get_oldest_history_visit': 'browser.getOldestHistoryVisit',
      'browser.oldest_history_visit': 'browser.getOldestHistoryVisit',
      'browser.getOldestHistoryVisit': 'browser.getOldestHistoryVisit',
      'browser.open_new_tab': 'browser.openNewTab',
      'browser.openTab': 'browser.openNewTab',
      'browser.openNewTab': 'browser.openNewTab',
      'browser.focus_tab': 'browser.focusTab',
      'browser.focusTab': 'browser.focusTab',
      'browser.close_tab': 'browser.closeTab',
      'browser.closeTab': 'browser.closeTab',
      'browser.close_non_productivity_tabs': 'browser.closeNonProductivityTabs',
      'browser.closeNonProductivityTabs': 'browser.closeNonProductivityTabs',
      'whatsapp.get_inbox': 'whatsapp.getInbox',
      'whatsapp.getListInbox': 'whatsapp.getInbox',
      'whatsapp.getInbox': 'whatsapp.getInbox',
      'whatsapp.open_chat': 'whatsapp.openChat',
      'whatsapp.openChatByQuery': 'whatsapp.openChat',
      'whatsapp.openChat': 'whatsapp.openChat',
      'whatsapp.send_message': 'whatsapp.sendMessage',
      'whatsapp.sendText': 'whatsapp.sendMessage',
      'whatsapp.sendMessage': 'whatsapp.sendMessage',
      'whatsapp.open_chat_and_send_message': 'whatsapp.openChatAndSendMessage',
      'whatsapp.openAndSendMessage': 'whatsapp.openChatAndSendMessage',
      'whatsapp.openChatAndSendMessage': 'whatsapp.openChatAndSendMessage',
      'whatsapp.archive_chats': 'whatsapp.archiveChats',
      'whatsapp.archiveListChats': 'whatsapp.archiveChats',
      'whatsapp.archiveChats': 'whatsapp.archiveChats',
      'whatsapp.archive_groups': 'whatsapp.archiveGroups',
      'whatsapp.archiveGroups': 'whatsapp.archiveGroups',
      'db.refresh_schema': 'db.refreshSchema',
      'db.inspect_schema': 'db.refreshSchema',
      'db.describeSchema': 'db.refreshSchema',
      'db.refreshSchema': 'db.refreshSchema',
      'db.query_read': 'db.queryRead',
      'db.read_query': 'db.queryRead',
      'db.readQuery': 'db.queryRead',
      'db.queryRead': 'db.queryRead',
      'db.query_write': 'db.queryWrite',
      'db.write_query': 'db.queryWrite',
      'db.writeQuery': 'db.queryWrite',
      'db.queryWrite': 'db.queryWrite'
    };
    const tool = aliases[inputTool] || '';
    const args = source.args && typeof source.args === 'object' ? source.args : {};

    if (!tool) {
      return null;
    }

    return { tool, args };
  }

  function extractToolCallsFromText(text) {
    const source = String(text || '');
    if (!source) {
      logDebug('extractToolCallsFromText:empty');
      return [];
    }

    const calls = [];
    const blockRegex = /```(?:tool|json)\s*([\s\S]*?)```/gi;
    const xmlRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
    const chunks = [];

    let match = null;
    while ((match = blockRegex.exec(source))) {
      if (match[1]) {
        chunks.push(match[1].trim());
      }
    }

    while ((match = xmlRegex.exec(source))) {
      if (match[1]) {
        chunks.push(match[1].trim());
      }
    }

    for (const chunk of chunks) {
      if (!chunk) {
        continue;
      }

      const normalizedChunk = chunk.replace(/^json\s*/i, '').trim();

      try {
        const parsed = JSON.parse(normalizedChunk);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const normalized = normalizeLocalToolCall(item);
          if (normalized) {
            calls.push(normalized);
          }
        }
      } catch (_) {
        // Ignore invalid blocks.
        logWarn('extractToolCallsFromText:invalid_block', {
          chunk: normalizedChunk.slice(0, 360)
        });
      }

      const maxLocalToolCalls = getSystemVariableNumber('chat.maxLocalToolCalls', MAX_LOCAL_TOOL_CALLS);
      if (calls.length >= maxLocalToolCalls) {
        break;
      }
    }

    const parsed = calls.slice(0, getSystemVariableNumber('chat.maxLocalToolCalls', MAX_LOCAL_TOOL_CALLS));
    logDebug('extractToolCallsFromText:parsed', {
      parsedCount: parsed.length,
      parsed
    });
    return parsed;
  }

  async function executeLocalToolCalls(toolCalls) {
    const calls = Array.isArray(toolCalls)
      ? toolCalls.slice(0, getSystemVariableNumber('chat.maxLocalToolCalls', MAX_LOCAL_TOOL_CALLS))
      : [];
    const results = [];

    logDebug('executeLocalToolCalls:start', {
      callCount: calls.length,
      calls
    });

    for (const call of calls) {
      const tool = String(call?.tool || '').trim();
      const args = call?.args && typeof call.args === 'object' ? call.args : {};
      const isBrowserTool = tool.startsWith('browser.');
      const isWhatsappTool = tool.startsWith('whatsapp.');
      const isDbTool = tool.startsWith('db.');

      if (!isBrowserTool && !isWhatsappTool && !isDbTool) {
        results.push({
          tool,
          ok: false,
          error: 'Tool invalida.'
        });
        continue;
      }

      try {
        if (isBrowserTool) {
          const browserAction = tool.replace(/^browser\./, '');
          logDebug('executeLocalToolCalls:invoke', {
            tool,
            browserAction,
            args
          });

          const response = await tabContextService.runBrowserAction(browserAction, args);
          results.push({
            tool,
            ok: response?.ok === true,
            result: response?.result,
            error: response?.error || ''
          });
          logDebug('executeLocalToolCalls:result', {
            tool,
            response
          });
          continue;
        }

        if (isDbTool) {
          const dbAction = tool.replace(/^db\./, '');
          const connectionUrl = getCrmErpDatabaseConnectionUrl();
          if (!connectionUrl) {
            results.push({
              tool,
              ok: false,
              error: 'No hay URL PostgreSQL configurada en Settings > CRM/ERP Database.'
            });
            continue;
          }

          if (dbAction === 'refreshSchema') {
            const snapshot = await analyzeCrmErpDatabaseSchema({
              connectionUrl,
              silent: true
            });

            results.push({
              tool,
              ok: true,
              result: {
                analyzedAt: snapshot?.analyzedAt || Date.now(),
                schemaCount: Array.isArray(snapshot?.schemas) ? snapshot.schemas.length : 0,
                tableCount: Number(snapshot?.tableCount) || (Array.isArray(snapshot?.tables) ? snapshot.tables.length : 0)
              }
            });
            continue;
          }

          const sqlText = String(args.sql || args.query || '').trim();
          const params = Array.isArray(args.params) ? args.params : [];
          const maxRows = Number(args.maxRows ?? args.limit);

          if (!sqlText) {
            results.push({
              tool,
              ok: false,
              error: 'Falta SQL en args.sql.'
            });
            continue;
          }

          if (dbAction === 'queryRead') {
            const dbResult = await postgresService.queryRead(connectionUrl, sqlText, params, {
              maxRows
            });
            results.push({
              tool,
              ok: true,
              result: dbResult
            });
            continue;
          }

          if (dbAction === 'queryWrite') {
            const dbResult = await postgresService.queryWrite(connectionUrl, sqlText, params, {
              maxRows
            });
            results.push({
              tool,
              ok: true,
              result: dbResult
            });
            continue;
          }

          results.push({
            tool,
            ok: false,
            error: 'Accion db.* no soportada.'
          });
          continue;
        }

        const whatsappAction = tool.replace(/^whatsapp\./, '');
        const targetTab = getPreferredWhatsappTab(args);
        if (!targetTab || !isWhatsappContext(targetTab)) {
          results.push({
            tool,
            ok: false,
            error: 'No hay tab de WhatsApp disponible para ejecutar la tool.',
            result: {
              requestedTabId: Number(args?.tabId) || -1
            }
          });
          continue;
        }

        const siteArgs = {
          ...args
        };
        delete siteArgs.tabId;

        logDebug('executeLocalToolCalls:invoke', {
          tool,
          whatsappAction,
          tabId: Number(targetTab.tabId) || -1,
          args: siteArgs
        });

        const response = await tabContextService.runSiteActionInTab(
          Number(targetTab.tabId) || -1,
          'whatsapp',
          whatsappAction,
          siteArgs
        );

        results.push({
          tool,
          ok: response?.ok === true,
          result: {
            ...(response?.result && typeof response.result === 'object' ? response.result : {}),
            tabId: Number(targetTab.tabId) || -1
          },
          error: response?.error || ''
        });
        logDebug('executeLocalToolCalls:result', {
          tool,
          response
        });

        if (response?.ok === true) {
          await tabContextService.requestSnapshot();
        }
      } catch (error) {
        const message = sanitizeSensitiveMessage(error instanceof Error ? error.message : 'Error ejecutando tool local.');
        results.push({
          tool,
          ok: false,
          error: message
        });
        logWarn('executeLocalToolCalls:error', {
          tool,
          error: message
        });
      }
    }

    logDebug('executeLocalToolCalls:done', {
      resultCount: results.length,
      results
    });
    return results;
  }

  function buildToolResultsFollowupPrompt(toolResults) {
    return [
      'Resultado de tools locales ejecutadas:',
      '```json',
      JSON.stringify(Array.isArray(toolResults) ? toolResults : [], null, 2),
      '```',
      'Con este resultado, responde al usuario en Markdown.',
      'No repitas ni vuelvas a invocar tools si ya se ejecutaron correctamente.'
    ].join('\n');
  }

  async function buildChatConversation(userQuery) {
    const systemPrompt =
      selectedChatTool === 'chat'
        ? getActiveChatSystemPrompt()
        : selectedChatTool === 'write_email'
          ? getWriteEmailSystemPrompt()
          : CHAT_TOOLS[selectedChatTool].systemPrompt;
    let dynamicSystemPrompt = systemPrompt;
    let contextUsed = [];
    const localToolPrompt = selectedChatTool === 'chat' ? buildLocalToolSystemPrompt() : '';
    const forceHistoryTools = selectedChatTool === 'chat' && shouldForceHistoryToolForQuery(userQuery);
    const historyToolDirective = forceHistoryTools
      ? 'La consulta del usuario parece temporal sobre historial. Debes ejecutar una tool de historial antes de responder.'
      : '';

    try {
      const identityPayload = await contextMemoryService.buildDynamicIdentityHeader(userQuery, {
        user_name: panelSettings.displayName || ''
      });
      const contextHeader = String(identityPayload?.header || '').trim();
      const contextHits = Array.isArray(identityPayload?.contextHits) ? identityPayload.contextHits : [];
      contextUsed = contextHits.map((item) => String(item?.id || '').trim()).filter(Boolean);

      dynamicSystemPrompt = [contextHeader, localToolPrompt, historyToolDirective, systemPrompt]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    } catch (_) {
      dynamicSystemPrompt = [localToolPrompt, historyToolDirective, systemPrompt].filter(Boolean).join('\n\n').trim();
    }

    const context = chatHistory
      .slice(-getSystemVariableNumber('chat.maxContextMessages', MAX_CHAT_CONTEXT_MESSAGES))
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

    return {
      messages: [{ role: 'system', content: dynamicSystemPrompt }, ...context],
      contextUsed
    };
  }

  async function streamChatResponse(userQuery, onChunk, options = {}) {
    const temperature = Number(settings[PREFERENCE_KEYS.AI_TEMPERATURE] ?? DEFAULT_SETTINGS[PREFERENCE_KEYS.AI_TEMPERATURE]);
    const safeTemp = Number.isFinite(temperature) ? temperature : DEFAULT_SETTINGS[PREFERENCE_KEYS.AI_TEMPERATURE];
    const conversation = await buildChatConversation(userQuery);
    const additionalMessages = Array.isArray(options.additionalMessages)
      ? options.additionalMessages
          .map((item) => {
            const role = item?.role === 'assistant' || item?.role === 'system' ? item.role : 'user';
            const content = String(item?.content || '').trim();
            if (!content) {
              return null;
            }

            return { role, content };
          })
          .filter(Boolean)
      : [];
    const messages = [...(Array.isArray(conversation?.messages) ? conversation.messages : []), ...additionalMessages];
    const contextUsed = Array.isArray(conversation?.contextUsed) ? conversation.contextUsed : [];
    const activeProfile = getActiveModelProfile();

    if (!activeProfile) {
      throw new Error('No hay modelo configurado.');
    }

    const apiKey = await getApiKeyForProfile(activeProfile, { statusTarget: chatStatus });

    const handleChunk = (chunk) => {
      if (!chunk) {
        return;
      }

      onChunk(chunk);
    };

    const output = await aiProviderService.streamWithProfile({
      profile: activeProfile,
      messages,
      temperature: safeTemp,
      apiKey,
      onChunk: handleChunk
    });

    return {
      output,
      contextUsed
    };
  }

  async function sendChatMessage() {
    if (isGeneratingChat) {
      return;
    }

    const content = chatInput.value.trim();
    if (!content) {
      return;
    }

    closeToolMenu();
    isGeneratingChat = true;
    chatSendBtn.disabled = true;
    chatResetBtn.disabled = true;
    let assistantMessage = null;

    try {
      const activeProfile = getActiveModelProfile();
      const activeModel = activeProfile ? `${activeProfile.name} · ${activeProfile.model}` : getActiveModel();
      const userMessage = await pushChatMessage('user', content);
      chatInput.value = '';
      updateChatInputSize();
      setStatus(chatStatus, `Conectando con ${activeModel}...`, false, { loading: true });
      stopRandomEmotionCycle();
      setBrandEmotion('intrigued');

      assistantMessage = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role: 'assistant',
        content: '',
        pending: true,
        tool: selectedChatTool,
        context_used: [],
        extracted_facts: [],
        createdAt: Date.now()
      };
      chatHistory.push(assistantMessage);
      renderChatMessages();
      scrollChatToBottom();

      const streamPayload = await streamChatResponse(content, (chunk) => {
        if (!assistantMessage || !chunk) {
          return;
        }

        assistantMessage.pending = false;
        assistantMessage.content += chunk;
        setStatus(chatStatus, 'Escribiendo respuesta...', false, { loading: true });
        scheduleChatRender();
      });

      const output = String(streamPayload?.output || '').trim();
      const contextUsed = Array.isArray(streamPayload?.contextUsed)
        ? streamPayload.contextUsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
        : [];
      const detectedToolCalls = selectedChatTool === 'chat' ? extractToolCallsFromText(output) : [];
      let finalAssistantOutput = output;

      logDebug('sendChatMessage:model_output', {
        tool: selectedChatTool,
        outputPreview: output.slice(0, 600),
        outputLength: output.length,
        detectedToolCalls
      });

      assistantMessage.context_used = contextUsed;
      if (userMessage && Array.isArray(userMessage.context_used)) {
        userMessage.context_used = contextUsed;
      }

      if (detectedToolCalls.length) {
        setStatus(chatStatus, 'Ejecutando acciones locales del navegador...', false, { loading: true });
        assistantMessage.pending = true;
        assistantMessage.content = 'Ejecutando tools locales...';
        scheduleChatRender();

        const toolResults = await executeLocalToolCalls(detectedToolCalls);
        const followupPrompt = buildToolResultsFollowupPrompt(toolResults);

        logDebug('sendChatMessage:tool_results', {
          toolResults
        });

        assistantMessage.content = '';
        assistantMessage.pending = true;
        scheduleChatRender();

        const finalStream = await streamChatResponse(
          content,
          (chunk) => {
            if (!assistantMessage || !chunk) {
              return;
            }

            assistantMessage.pending = false;
            assistantMessage.content += chunk;
            setStatus(chatStatus, 'Generando respuesta final...', false, { loading: true });
            scheduleChatRender();
          },
          {
            additionalMessages: [
              { role: 'assistant', content: output },
              { role: 'user', content: followupPrompt }
            ]
          }
        );

        const fallbackFromTools = [
          '### Resultado de acciones locales',
          '',
          '```json',
          JSON.stringify(toolResults, null, 2),
          '```'
        ].join('\n');

        finalAssistantOutput = String(finalStream?.output || '').trim() || fallbackFromTools;
        logDebug('sendChatMessage:final_after_tools', {
          outputPreview: finalAssistantOutput.slice(0, 600),
          outputLength: finalAssistantOutput.length
        });
      }

      assistantMessage.pending = false;
      assistantMessage.content = assistantMessage.content.trim() || finalAssistantOutput.trim();
      if (!assistantMessage.content) {
        throw new Error('El provider no devolvio contenido.');
      }

      const turnMemory = await contextMemoryService.rememberChatTurn({
        userMessage: content,
        assistantMessage: assistantMessage.content,
        contextUsed
      });
      assistantMessage.extracted_facts = Array.isArray(turnMemory?.extracted_facts) ? turnMemory.extracted_facts : [];
      if (userMessage && Array.isArray(userMessage.extracted_facts) && assistantMessage.extracted_facts.length) {
        userMessage.extracted_facts = assistantMessage.extracted_facts;
      }

      const parsedEmotion = extractEmotionFromText(assistantMessage.content);
      if (parsedEmotion) {
        setBrandEmotion(parsedEmotion);
      } else {
        startRandomEmotionCycle({ immediate: true });
      }

      renderChatMessages();
      scrollChatToBottom();
      await saveChatHistory();
      setStatus(chatStatus, `Respuesta generada con ${activeModel}.`);
    } catch (error) {
      if (assistantMessage && !assistantMessage.content.trim()) {
        chatHistory = chatHistory.filter((msg) => msg.id !== assistantMessage.id);
        renderChatMessages();
      } else if (assistantMessage && assistantMessage.content.trim()) {
        await saveChatHistory();
      }

      const message = error instanceof Error ? error.message : 'Error inesperado al generar la respuesta.';
      setStatus(chatStatus, message, true);
      setBrandEmotion('disappointed');
      window.setTimeout(() => {
        if (!isGeneratingChat) {
          startRandomEmotionCycle({ immediate: false });
        }
      }, 1200);
    } finally {
      isGeneratingChat = false;
      chatSendBtn.disabled = false;
      chatResetBtn.disabled = false;
      requestChatAutofocus(6, 60);
    }
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

  function getTabSummaryKey(tabContext) {
    const tabId = Number(tabContext?.tabId) || -1;
    const site = String(tabContext?.site || 'generic');
    const url = String(tabContext?.url || '');
    const title = String(tabContext?.title || '');
    const description = String(tabContext?.description || '');
    const excerpt = String(tabContext?.textExcerpt || '').slice(0, 620);
    const payload = `${site}|${url}|${title}|${description}|${excerpt}`;
    return `${tabId}:${hashText(payload)}`;
  }

  function getTabSummary(tabContext) {
    const key = getTabSummaryKey(tabContext);
    return tabSummaryByKey.get(key) || '';
  }

  function trimTabSummaryCache() {
    const keepKeys = new Set(tabContextSnapshot.tabs.map((item) => getTabSummaryKey(item)));
    for (const key of tabSummaryByKey.keys()) {
      if (!keepKeys.has(key)) {
        tabSummaryByKey.delete(key);
      }
    }
  }

  function buildSystemVariableEntries() {
    const editable = SYSTEM_VARIABLE_DEFINITIONS.map((definition) => ({
      ...definition,
      editable: true,
      value: getSystemVariableValue(definition.id)
    }));

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const locale = navigator.language || 'n/a';
    const memoryConfig =
      typeof contextMemoryService.getConfigSnapshot === 'function' ? contextMemoryService.getConfigSnapshot() : {};

    const readonly = [
      {
        scope: 'ai',
        key: 'DEFAULT_OLLAMA_MODEL',
        type: 'readonly',
        editable: false,
        value: DEFAULT_OLLAMA_MODEL,
        description: 'Modelo local por defecto para perfiles Ollama.'
      },
      {
        scope: 'ai',
        key: 'LOCAL_MODEL_KEEP_ALIVE',
        type: 'readonly',
        editable: false,
        value: LOCAL_MODEL_KEEP_ALIVE,
        description: 'Tiempo keep-alive del modelo local.'
      },
      {
        scope: 'storage',
        key: 'CHAT_DB',
        type: 'readonly',
        editable: false,
        value: CHAT_DB,
        description: 'Configuracion de stores IndexedDB para chat/panel/secrets.'
      },
      {
        scope: 'runtime',
        key: 'panelSettings.language',
        type: 'readonly',
        editable: false,
        value: panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE,
        description: 'Idioma actual configurado del assistant.'
      },
      {
        scope: 'runtime',
        key: 'panelSettings.displayName',
        type: 'readonly',
        editable: false,
        value: panelSettings.displayName || '',
        description: 'Nombre local del usuario en onboarding/settings.'
      },
      {
        scope: 'runtime',
        key: 'panelSettings.crmErpDatabase.connected',
        type: 'readonly',
        editable: false,
        value: Boolean(getCrmErpDatabaseConnectionUrl()),
        description: 'Indica si hay una URL de PostgreSQL configurada para CRM/ERP.'
      },
      {
        scope: 'runtime',
        key: 'panelSettings.crmErpDatabase.lastAnalyzedAt',
        type: 'readonly',
        editable: false,
        value: getCrmErpDatabaseSchemaSnapshot()?.analyzedAt || 0,
        description: 'Timestamp del ultimo analisis de esquema CRM/ERP.'
      },
      {
        scope: 'runtime',
        key: 'themeMode',
        type: 'readonly',
        editable: false,
        value: themeMode,
        description: 'Tema visual activo en la UI.'
      },
      {
        scope: 'runtime',
        key: 'navigator.language',
        type: 'readonly',
        editable: false,
        value: locale,
        description: 'Locale principal del navegador.'
      },
      {
        scope: 'runtime',
        key: 'Intl.timeZone',
        type: 'readonly',
        editable: false,
        value: timezone,
        description: 'Zona horaria local detectada.'
      },
      {
        scope: 'memory',
        key: 'contextMemory.config',
        type: 'readonly',
        editable: false,
        value: memoryConfig,
        description: 'Configuracion interna del motor vectorial local.'
      }
    ];

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS || {})) {
      readonly.push({
        scope: 'defaults',
        key: `DEFAULT_SETTINGS.${key}`,
        type: 'readonly',
        editable: false,
        value,
        description: 'Default de preferencias almacenadas en chrome.storage.sync.'
      });
    }

    return [...editable, ...readonly];
  }

  function groupSystemVariableEntries(entries) {
    const groups = new Map();
    const list = Array.isArray(entries) ? entries : [];

    for (const entry of list) {
      const scope = String(entry?.scope || 'system');
      const known = groups.get(scope);
      if (known) {
        known.push(entry);
      } else {
        groups.set(scope, [entry]);
      }
    }

    const discoveredScopes = Array.from(groups.keys()).filter((scope) => !SYSTEM_VARIABLE_SCOPE_ORDER.includes(scope));
    const orderedScopes = [...SYSTEM_VARIABLE_SCOPE_ORDER, ...discoveredScopes];

    return orderedScopes
      .filter((scope) => groups.has(scope))
      .map((scope) => ({
        scope,
        label: getSystemVariableScopeLabel(scope),
        entries: groups.get(scope) || []
      }));
  }

  function parseSystemVariableInput(definition, inputElement) {
    const meta = definition && typeof definition === 'object' ? definition : {};
    const element = inputElement instanceof HTMLInputElement || inputElement instanceof HTMLTextAreaElement ? inputElement : null;
    const rawValue = element ? element.value : '';
    const text = String(rawValue || '').trim();

    if (meta.type === 'number') {
      if (!text) {
        return {
          ok: false,
          error: `El valor de ${meta.key || meta.id || 'la variable'} no puede estar vacio.`,
          field: element
        };
      }

      const numeric = Number(text);
      if (!Number.isFinite(numeric)) {
        return {
          ok: false,
          error: `El valor de ${meta.key || meta.id || 'la variable'} debe ser numerico.`,
          field: element
        };
      }
    }

    if (meta.required && !text) {
      return {
        ok: false,
        error: `El valor de ${meta.key || meta.id || 'la variable'} no puede estar vacio.`,
        field: element
      };
    }

    return {
      ok: true,
      value: coerceSystemVariableValue(meta, rawValue),
      field: element
    };
  }

  function collectSystemVariableFormValues() {
    const sourceSystemVars =
      panelSettings?.systemVariables && typeof panelSettings.systemVariables === 'object' ? panelSettings.systemVariables : {};
    const nextSystemVariables = normalizeSystemVariables(sourceSystemVars);
    let nextSystemPrompt = String(panelSettings.systemPrompt || '').trim() || DEFAULT_CHAT_SYSTEM_PROMPT;

    for (const definition of SYSTEM_VARIABLE_DEFINITIONS) {
      const field = systemVariablesList?.querySelector(`[data-system-variable-id="${definition.id}"]`) || null;
      if (!field) {
        continue;
      }

      const parsed = parseSystemVariableInput(definition, field);
      if (!parsed.ok) {
        return parsed;
      }

      if (definition.target === 'systemPrompt') {
        nextSystemPrompt = String(parsed.value || '').trim() || DEFAULT_CHAT_SYSTEM_PROMPT;
      } else {
        nextSystemVariables[definition.id] = parsed.value;
      }
    }

    return {
      ok: true,
      value: {
        systemPrompt: nextSystemPrompt,
        systemVariables: normalizeSystemVariables(nextSystemVariables)
      }
    };
  }

  async function saveSystemVariablesFromScreen() {
    const parsed = collectSystemVariableFormValues();
    if (!parsed.ok) {
      setStatus(systemVariablesStatus, parsed.error || 'No se pudieron validar las variables.', true);
      parsed.field?.focus();
      return;
    }

    const nextSettings = parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
    const ok = await savePanelSettings(nextSettings);
    if (!ok) {
      setStatus(systemVariablesStatus, 'No se pudieron guardar las system variables.', true);
      return;
    }

    settingsScreenController?.applyPanelSettingsToUi();
    renderSystemVariables();
    setStatus(systemVariablesStatus, 'System variables guardadas.');
    setStatus(chatStatus, 'System variables actualizadas.');
  }

  async function resetSystemVariablesToDefaults() {
    const defaultPrompt = buildDefaultChatSystemPrompt(panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE);
    const ok = await savePanelSettings({
      systemPrompt: defaultPrompt,
      systemVariables: normalizeSystemVariables(SYSTEM_VARIABLE_DEFAULTS)
    });

    if (!ok) {
      setStatus(systemVariablesStatus, 'No se pudieron restaurar defaults.', true);
      return;
    }

    settingsScreenController?.applyPanelSettingsToUi();
    renderSystemVariables();
    setStatus(systemVariablesStatus, 'System variables restauradas a defaults.');
    setStatus(chatStatus, 'System variables restauradas.');
  }

  function renderSystemVariables() {
    if (!systemVariablesList) {
      return;
    }

    const groupedEntries = groupSystemVariableEntries(buildSystemVariableEntries());
    systemVariablesList.textContent = '';

    for (const group of groupedEntries) {
      const section = document.createElement('section');
      section.className = 'system-var-group';

      const head = document.createElement('header');
      head.className = 'system-var-group__head';

      const title = document.createElement('h4');
      title.className = 'system-var-group__title';
      title.textContent = group.label;

      const count = document.createElement('span');
      count.className = 'system-var-group__count';
      count.textContent = `${group.entries.length} vars`;

      head.appendChild(title);
      head.appendChild(count);
      section.appendChild(head);

      for (const entry of group.entries) {
        const card = document.createElement('article');
        card.className = 'system-var-item';

        const cardHead = document.createElement('div');
        cardHead.className = 'system-var-item__head';

        const key = document.createElement('p');
        key.className = 'system-var-item__key';
        key.textContent = String(entry.key || entry.id || '');

        const type = document.createElement('span');
        type.className = 'system-var-item__type';
        type.textContent = entry.editable ? String(entry.type || 'text') : 'solo lectura';

        cardHead.appendChild(key);
        cardHead.appendChild(type);

        const valueWrap = document.createElement('div');
        valueWrap.className = 'system-var-item__value-wrap';

        if (entry.editable) {
          if (entry.type === 'prompt') {
            const textarea = document.createElement('textarea');
            textarea.className = 'system-var-item__textarea';
            textarea.rows = 8;
            textarea.dataset.systemVariableId = String(entry.id || '');
            textarea.value = String(entry.value || '');
            valueWrap.appendChild(textarea);
          } else {
            const input = document.createElement('input');
            input.className = 'system-var-item__input';
            input.type = entry.type === 'number' ? 'number' : 'text';
            input.dataset.systemVariableId = String(entry.id || '');
            input.value = String(entry.value ?? '');
            if (entry.type === 'number') {
              if (Number.isFinite(entry.min)) {
                input.min = String(entry.min);
              }
              if (Number.isFinite(entry.max)) {
                input.max = String(entry.max);
              }
              if (Number.isFinite(entry.step)) {
                input.step = String(entry.step);
              }
            }
            valueWrap.appendChild(input);
          }
        } else {
          const value = document.createElement('pre');
          value.className = 'system-var-item__value';
          value.textContent = formatSystemVariableValue(entry.value);
          valueWrap.appendChild(value);
        }

        const description = document.createElement('p');
        description.className = 'system-var-item__desc';
        description.textContent = String(entry.description || '');

        card.appendChild(cardHead);
        card.appendChild(valueWrap);
        card.appendChild(description);
        section.appendChild(card);
      }

      systemVariablesList.appendChild(section);
    }
  }

  function renderTabsContextJson() {
    if (!tabsContextJson) {
      return;
    }

    const tabsPayload = tabContextSnapshot.tabs.map((tab) => toJsonTabRecord(tab, getTabSummary(tab)));
    const payload = {
      activeTabId: tabContextSnapshot.activeTabId,
      reason: tabContextSnapshot.reason,
      updatedAt: tabContextSnapshot.updatedAt,
      history: Array.isArray(tabContextSnapshot.history) ? tabContextSnapshot.history : [],
      tabs: tabsPayload
    };

    tabsContextJson.textContent = JSON.stringify(payload, null, 2);
  }

  async function generateWithActiveModel(prompt, options = {}) {
    const temperature = Number.isFinite(options.temperature) ? options.temperature : 0.2;
    const profile = options.profile || getActiveModelProfile();
    if (!profile) {
      throw new Error('No hay modelo configurado.');
    }

    const apiKey = await getApiKeyForProfile(profile, {
      statusTarget: options.statusTarget || null
    });
    let output = '';

    await aiProviderService.streamWithProfile({
      profile,
      messages: [{ role: 'user', content: String(prompt || '') }],
      temperature,
      apiKey,
      onChunk: (chunk) => {
        output += chunk || '';
      }
    });

    return output.trim();
  }

  function enqueueTabSummary(tabContext) {
    if (!tabContext || typeof tabContext.tabId !== 'number' || tabContext.tabId < 0) {
      return;
    }

    if (isWhatsappContext(tabContext)) {
      return;
    }

    const key = getTabSummaryKey(tabContext);
    if (!key || tabSummaryByKey.has(key) || tabSummaryQueue.some((item) => item.key === key)) {
      return;
    }

    tabSummaryQueue.push({ key, tabContext });
    processTabSummaryQueue();
  }

  async function processTabSummaryQueue() {
    if (tabSummaryQueueRunning) {
      return;
    }

    tabSummaryQueueRunning = true;

    while (tabSummaryQueue.length) {
      const next = tabSummaryQueue.shift();
      if (!next || !next.tabContext) {
        continue;
      }

      try {
        const prompt = buildTabSummaryPrompt(next.tabContext);
        const response = await generateWithActiveModel(prompt, { temperature: 0.15 });
        const summary = response
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, getSystemVariableNumber('context.tabSummaryMaxChars', TAB_SUMMARY_MAX_CHARS));

        tabSummaryByKey.set(next.key, summary);
      } catch (_) {
        tabSummaryByKey.set(next.key, '');
      }

      renderTabsContextJson();
    }

    tabSummaryQueueRunning = false;
  }

  function getActiveTabContext() {
    return tabContextSnapshot.tabs.find((item) => item.tabId === tabContextSnapshot.activeTabId) || null;
  }

  function mergeWhatsappContextWithHistory(tabContext, historyPayload) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const history = historyPayload && typeof historyPayload === 'object' ? historyPayload : {};
    const messages = Array.isArray(history.messages) ? history.messages : [];

    if (!messages.length) {
      return context;
    }

    const mergedCurrentChat = {
      ...currentChat,
      channelId: String(currentChat.channelId || history.channelId || '').trim(),
      key: String(currentChat.key || history.chatKey || currentChat.phone || currentChat.title || '').trim(),
      title: String(currentChat.title || history.title || '').trim(),
      phone: String(currentChat.phone || history.phone || '').trim(),
      lastMessageId: String(history.lastMessageId || currentChat.lastMessageId || '').trim()
    };
    const nextSync = details.sync && typeof details.sync === 'object' ? { ...details.sync } : {};

    if (!nextSync.lastVisibleMessageId && mergedCurrentChat.lastMessageId) {
      nextSync.lastVisibleMessageId = mergedCurrentChat.lastMessageId;
    }

    return {
      ...context,
      details: {
        ...details,
        currentChat: mergedCurrentChat,
        messages,
        sync: {
          ...nextSync,
          dbMessageCount: messages.length,
          dbUpdatedAt: Math.max(0, Number(history.updatedAt) || 0)
        },
        whatsappHistory: {
          found: Boolean(history.found),
          key: String(history.key || ''),
          updatedAt: Math.max(0, Number(history.updatedAt) || 0),
          messageCount: messages.length
        }
      }
    };
  }

  async function buildWhatsappSuggestionContext(tabContext) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return tabContext;
    }

    const syncResult = await syncWhatsappChatContext(tabContext, {
      messageLimit: getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)
    });
    const historyPayload = await readWhatsappChatHistory(tabContext, {
      limit: getSystemVariableNumber('whatsapp.suggestionHistoryLimit', WHATSAPP_SUGGESTION_HISTORY_LIMIT)
    });
    const mergedContext = mergeWhatsappContextWithHistory(tabContext, historyPayload);

    logDebug('whatsapp_history:sync', {
      tabId: Number(tabContext.tabId) || -1,
      chatKey: toSafeLogText(getWhatsappChatKey(tabContext), 160),
      syncResult: {
        ok: Boolean(syncResult?.ok),
        reason: toSafeLogText(syncResult?.reason || '', 40),
        upserted: Math.max(0, Number(syncResult?.messagesUpserted) || 0),
        total: Math.max(0, Number(syncResult?.totalMessages) || 0)
      },
      db: {
        found: Boolean(historyPayload?.found),
        key: toSafeLogText(historyPayload?.key || '', 120),
        messages: Math.max(0, Number(historyPayload?.messages?.length) || 0),
        updatedAt: Math.max(0, Number(historyPayload?.updatedAt) || 0)
      }
    });

    return mergedContext;
  }

  function summarizeWhatsappSuggestionContext(tabContext, tailLimit = 6) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const messages = Array.isArray(details.messages) ? details.messages : [];

    return {
      tabId: Number(context.tabId) || -1,
      chatKey: toSafeLogText(currentChat.key || getWhatsappChatKey(context), 160),
      chatTitle: toSafeLogText(currentChat.title || '', 120),
      chatPhone: toSafeLogText(currentChat.phone || '', 42),
      messageCount: messages.length,
      messageTail: messages.slice(-tailLimit).map((item) => ({
        id: toSafeLogText(item?.id || '', 120),
        role: item?.role === 'me' ? 'me' : 'contact',
        kind: toSafeLogText(item?.kind || '', 24),
        timestamp: toSafeLogText(item?.timestamp || '', 80),
        text: toSafeLogText(item?.text || '', 160),
        transcript: toSafeLogText(item?.transcript || item?.enriched?.transcript || '', 120),
        ocrText: toSafeLogText(item?.ocrText || item?.enriched?.ocrText || '', 120)
      }))
    };
  }

  function hideWhatsappSuggestion() {
    whatsappSuggestionToken += 1;
    whatsappSuggestionState = {
      tabId: -1,
      chatKey: '',
      signalKey: '',
      text: '',
      loading: false
    };

    if (whatsappSuggestionCard) {
      whatsappSuggestionCard.hidden = true;
    }

    if (whatsappSuggestionMeta) {
      whatsappSuggestionMeta.textContent = '';
    }

    if (whatsappSuggestionText) {
      whatsappSuggestionText.textContent = '';
    }

    if (whatsappSuggestionRunBtn) {
      whatsappSuggestionRunBtn.disabled = true;
    }

    if (whatsappSuggestionRefreshBtn) {
      whatsappSuggestionRefreshBtn.disabled = true;
    }

    setStatus(whatsappSuggestionStatus, '');
  }

  function dismissWhatsappSuggestion() {
    whatsappSuggestionDismissedSignalKey = whatsappSuggestionState.signalKey || '';
    hideWhatsappSuggestion();
  }

  function setWhatsappSuggestionLoading(tabContext) {
    if (whatsappSuggestionCard) {
      whatsappSuggestionCard.hidden = false;
    }

    if (whatsappSuggestionMeta) {
      whatsappSuggestionMeta.textContent = buildWhatsappMetaLabel(tabContext);
    }

    if (whatsappSuggestionText) {
      whatsappSuggestionText.textContent = '';
    }

    if (whatsappSuggestionRunBtn) {
      whatsappSuggestionRunBtn.disabled = true;
    }

    if (whatsappSuggestionRefreshBtn) {
      whatsappSuggestionRefreshBtn.disabled = true;
    }

    setStatus(whatsappSuggestionStatus, 'Generando sugerencia...', false, { loading: true });
  }

  function setWhatsappSuggestionResult(tabContext, suggestion) {
    const text = String(suggestion || '').trim();

    if (!text) {
      hideWhatsappSuggestion();
      return;
    }

    if (whatsappSuggestionCard) {
      whatsappSuggestionCard.hidden = false;
    }

    if (whatsappSuggestionMeta) {
      whatsappSuggestionMeta.textContent = buildWhatsappMetaLabel(tabContext);
    }

    if (whatsappSuggestionText) {
      whatsappSuggestionText.textContent = text;
    }

    if (whatsappSuggestionRunBtn) {
      whatsappSuggestionRunBtn.disabled = false;
    }

    if (whatsappSuggestionRefreshBtn) {
      whatsappSuggestionRefreshBtn.disabled = false;
    }

    setStatus(whatsappSuggestionStatus, 'Sugerencia lista.');
  }

  async function generateWhatsappSuggestion(tabContext, options = {}) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      hideWhatsappSuggestion();
      return;
    }

    const force = Boolean(options.force);
    let suggestionContext = tabContext;

    try {
      suggestionContext = await buildWhatsappSuggestionContext(tabContext);
    } catch (error) {
      logWarn('whatsapp_history:context_build_error', {
        tabId: Number(tabContext.tabId) || -1,
        chatKey: toSafeLogText(getWhatsappChatKey(tabContext), 160),
        error: error instanceof Error ? error.message : String(error || '')
      });
      suggestionContext = tabContext;
    }

    const chatKey = getWhatsappChatKey(suggestionContext);
    const signalKey = buildWhatsappSignalKey(suggestionContext);
    const contextSummary = summarizeWhatsappSuggestionContext(suggestionContext);

    logDebug('whatsapp_suggestion:start', {
      ...contextSummary,
      force,
      signalKey: toSafeLogText(signalKey, 220),
      dismissedSignalKey: toSafeLogText(whatsappSuggestionDismissedSignalKey, 220)
    });

    if (!signalKey || signalKey === '::') {
      logWarn('whatsapp_suggestion:skip_no_signal', {
        ...contextSummary,
        signalKey: toSafeLogText(signalKey, 120)
      });
      hideWhatsappSuggestion();
      return;
    }

    if (!hasWhatsappConversationHistory(suggestionContext, 1)) {
      logDebug('whatsapp_suggestion:skip_no_messages', {
        ...contextSummary,
        signalKey: toSafeLogText(signalKey, 220)
      });
      hideWhatsappSuggestion();
      return;
    }

    if (!force && whatsappSuggestionDismissedSignalKey && whatsappSuggestionDismissedSignalKey === signalKey) {
      logDebug('whatsapp_suggestion:skip_dismissed', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220)
      });
      hideWhatsappSuggestion();
      return;
    }

    if (!force && whatsappSuggestionState.signalKey === signalKey && whatsappSuggestionState.text) {
      logDebug('whatsapp_suggestion:reuse_cached', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220),
        suggestionChars: whatsappSuggestionState.text.length
      });
      setWhatsappSuggestionResult(suggestionContext, whatsappSuggestionState.text);
      return;
    }

    whatsappSuggestionDismissedSignalKey = '';
    const token = ++whatsappSuggestionToken;
    whatsappSuggestionState = {
      tabId: tabContext.tabId,
      chatKey,
      signalKey,
      text: whatsappSuggestionState.text,
      loading: true
    };

    setWhatsappSuggestionLoading(suggestionContext);
    const startedAt = Date.now();

    try {
      const prompt = buildWhatsappReplyPrompt(suggestionContext, {
        basePrompt: getWhatsappSuggestionBasePrompt()
      });
      const profileForSuggestion = resolveModelProfileForInference();
      if (!profileForSuggestion) {
        throw new Error('No hay modelo disponible para sugerencias.');
      }

      logDebug('whatsapp_suggestion:model_start', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220),
        promptChars: prompt.length,
        promptPreview: toSafeLogText(prompt, 280),
        profile: {
          id: toSafeLogText(profileForSuggestion.id || '', 80),
          provider: toSafeLogText(profileForSuggestion.provider || '', 40),
          model: toSafeLogText(profileForSuggestion.model || '', 80)
        }
      });

      const suggestionRaw = await generateWithActiveModel(prompt, {
        temperature: 0.35,
        profile: profileForSuggestion,
        statusTarget: whatsappSuggestionStatus
      });
      const suggestion = suggestionRaw
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);

      logDebug('whatsapp_suggestion:model_done', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220),
        elapsedMs: Date.now() - startedAt,
        rawChars: suggestionRaw.length,
        suggestionChars: suggestion.length,
        suggestionPreview: toSafeLogText(suggestion, 200)
      });

      if (token !== whatsappSuggestionToken) {
        logDebug('whatsapp_suggestion:ignored_outdated_token', {
          token,
          currentToken: whatsappSuggestionToken,
          tabId: contextSummary.tabId,
          chatKey: contextSummary.chatKey
        });
        return;
      }

      if (!suggestion) {
        throw new Error('No se genero sugerencia para este chat.');
      }

      whatsappSuggestionState = {
        tabId: tabContext.tabId,
        chatKey,
        signalKey,
        text: suggestion,
        loading: false
      };

      setWhatsappSuggestionResult(suggestionContext, suggestion);
    } catch (error) {
      if (token !== whatsappSuggestionToken) {
        return;
      }

      logWarn('whatsapp_suggestion:error', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220),
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error || '')
      });

      whatsappSuggestionState = {
        tabId: tabContext.tabId,
        chatKey,
        signalKey,
        text: '',
        loading: false
      };

      if (whatsappSuggestionCard) {
        whatsappSuggestionCard.hidden = false;
      }

      if (whatsappSuggestionMeta) {
        whatsappSuggestionMeta.textContent = buildWhatsappMetaLabel(suggestionContext);
      }

      if (whatsappSuggestionText) {
        whatsappSuggestionText.textContent = '';
      }

      if (whatsappSuggestionRunBtn) {
        whatsappSuggestionRunBtn.disabled = true;
      }

      if (whatsappSuggestionRefreshBtn) {
        whatsappSuggestionRefreshBtn.disabled = false;
      }

      const message = error instanceof Error ? error.message : 'No se pudo generar sugerencia.';
      setStatus(whatsappSuggestionStatus, message, true);
    }
  }

  async function executeWhatsappSuggestion() {
    if (whatsappSuggestionExecutionInFlight) {
      return;
    }

    if (!whatsappSuggestionState.text || whatsappSuggestionState.tabId < 0) {
      return;
    }

    whatsappSuggestionExecutionInFlight = true;

    if (whatsappSuggestionRunBtn) {
      whatsappSuggestionRunBtn.disabled = true;
    }

    if (whatsappSuggestionRefreshBtn) {
      whatsappSuggestionRefreshBtn.disabled = true;
    }

    setStatus(whatsappSuggestionStatus, 'Enviando mensaje...', false, { loading: true });

    try {
      const response = await tabContextService.runSiteActionInTab(
        whatsappSuggestionState.tabId,
        'whatsapp',
        'sendMessage',
        { text: whatsappSuggestionState.text }
      );

      if (!response || response.ok !== true) {
        const message = response?.error || 'No se pudo enviar mensaje en WhatsApp.';
        setStatus(whatsappSuggestionStatus, message, true);
        return;
      }

      const confirmed = response?.result?.confirmed !== false;
      const dispatchMethod = String(response?.result?.dispatchMethod || '').trim();
      if (confirmed) {
        setStatus(whatsappSuggestionStatus, 'Mensaje enviado.');
      } else {
        setStatus(
          whatsappSuggestionStatus,
          `Mensaje despachado (${dispatchMethod || 'sin confirmacion de metodo'}), esperando confirmacion en chat.`
        );
      }

      window.setTimeout(() => {
        tabContextService.requestSnapshot();
      }, 350);
    } finally {
      whatsappSuggestionExecutionInFlight = false;
      if (whatsappSuggestionRunBtn) {
        whatsappSuggestionRunBtn.disabled = false;
      }
      if (whatsappSuggestionRefreshBtn) {
        whatsappSuggestionRefreshBtn.disabled = false;
      }
    }
  }

  function queueContextIngestion(snapshot, options = {}) {
    const tabsLimit = Math.max(
      1,
      Math.min(120, Number(options.tabsLimit) || getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY))
    );
    const historyLimit = Math.max(
      1,
      Math.min(
        getSystemVariableNumber('bootstrap.initialContextSyncHistoryLimit', INITIAL_CONTEXT_SYNC_HISTORY_LIMIT),
        Number(options.historyLimit) ||
          getSystemVariableNumber('context.incrementalHistoryIngestLimit', INCREMENTAL_HISTORY_INGEST_LIMIT)
      )
    );
    const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs.slice(0, tabsLimit) : [];
    const historyItems = Array.isArray(snapshot?.history) ? snapshot.history.slice(0, historyLimit) : [];

    contextIngestionPromise = contextIngestionPromise
      .catch(() => {})
      .then(async () => {
        for (const tab of tabs) {
          try {
            await contextMemoryService.ingestTabContext(tab);
          } catch (_) {
            // Ignore ingestion failures per tab.
          }
        }

        if (historyItems.length) {
          try {
            await contextMemoryService.ingestHistoryEntries(historyItems);
          } catch (_) {
            // Ignore history ingestion failures.
          }
        }
      });
  }

  function queueWhatsappHistorySync(snapshot, options = {}) {
    const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
    const whatsappTabs = tabs.filter((tab) => isWhatsappContext(tab));
    const messageLimit = Math.max(
      80,
      Math.min(
        MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT,
        Number(options.messageLimit) ||
          Number(getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)) ||
          MAX_WHATSAPP_PERSISTED_MESSAGES
      )
    );

    if (!whatsappTabs.length) {
      return whatsappHistorySyncPromise;
    }

    whatsappHistorySyncPromise = whatsappHistorySyncPromise
      .catch(() => {})
      .then(async () => {
        for (const tab of whatsappTabs) {
          try {
            await syncWhatsappChatContext(tab, {
              messageLimit
            });
          } catch (_) {
            // Ignore whatsapp chat sync failures per tab.
          }
        }
      });

    return whatsappHistorySyncPromise;
  }

  function normalizeHistoryEntryForSync(item) {
    const entry = item && typeof item === 'object' ? item : {};
    const url = String(entry.url || '').trim();
    if (!url) {
      return null;
    }

    return {
      url,
      title: String(entry.title || '').trim().slice(0, 240),
      lastVisitTime: Math.max(0, Number(entry.lastVisitTime) || 0),
      visitCount: Math.max(0, Number(entry.visitCount) || 0),
      typedCount: Math.max(0, Number(entry.typedCount) || 0)
    };
  }

  function mergeHistoryForInitialSync(...historyGroups) {
    const byUrl = new Map();

    for (const group of historyGroups) {
      const list = Array.isArray(group) ? group : [];
      for (const item of list) {
        const normalized = normalizeHistoryEntryForSync(item);
        if (!normalized) {
          continue;
        }

        const known = byUrl.get(normalized.url);
        if (!known) {
          byUrl.set(normalized.url, normalized);
          continue;
        }

        byUrl.set(normalized.url, {
          url: normalized.url,
          title: normalized.title || known.title || '',
          lastVisitTime: Math.max(known.lastVisitTime || 0, normalized.lastVisitTime || 0),
          visitCount: Math.max(known.visitCount || 0, normalized.visitCount || 0),
          typedCount: Math.max(known.typedCount || 0, normalized.typedCount || 0)
        });
      }
    }

    return Array.from(byUrl.values())
      .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
      .slice(0, getSystemVariableNumber('bootstrap.initialContextSyncHistoryLimit', INITIAL_CONTEXT_SYNC_HISTORY_LIMIT));
  }

  async function requestExtendedHistoryForInitialSync() {
    try {
      const response = await tabContextService.runBrowserAction('getRecentHistory', {
        limit: getSystemVariableNumber('bootstrap.initialContextSyncHistoryLimit', INITIAL_CONTEXT_SYNC_HISTORY_LIMIT),
        days: getSystemVariableNumber('bootstrap.initialContextSyncHistoryDays', INITIAL_CONTEXT_SYNC_HISTORY_DAYS)
      });

      if (!response || response.ok !== true) {
        logWarn('initial_context_sync:history_unavailable', {
          response
        });
        return [];
      }

      const result = response.result && typeof response.result === 'object' ? response.result : {};
      const items = Array.isArray(result.items) ? result.items : [];
      return items.map(normalizeHistoryEntryForSync).filter(Boolean);
    } catch (error) {
      logWarn('initial_context_sync:history_fetch_error', {
        error: error instanceof Error ? error.message : String(error || '')
      });
      return [];
    }
  }

  async function runInitialContextBootstrap() {
    if (initialContextSyncPromise) {
      return initialContextSyncPromise;
    }

    initialContextSyncPromise = (async () => {
      const currentState = await readInitialContextSyncState();
      if (!shouldRunInitialContextSync(currentState)) {
        logDebug('initial_context_sync:skip', currentState);
        return currentState;
      }

      await writeInitialContextSyncState({
        status: 'running',
        reason: currentState.reason || 'panel_open',
        startedAt: Date.now(),
        completedAt: 0,
        error: '',
        sourceCounts: {
          tabs: 0,
          history: 0,
          chat: 0,
          profile: 0,
          facts: 0
        }
      });

      try {
        await contextMemoryService.warmupEmbeddings();
        const snapshot = await tabContextService.requestSnapshot();
        const tabs = Array.isArray(snapshot?.tabs)
          ? snapshot.tabs.slice(0, getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY))
          : [];
        const baseHistory = Array.isArray(snapshot?.history) ? snapshot.history : [];
        const extendedHistory = await requestExtendedHistoryForInitialSync();
        const mergedHistory = mergeHistoryForInitialSync(extendedHistory, baseHistory);

        queueContextIngestion(
          {
            tabs,
            history: mergedHistory
          },
          {
            tabsLimit: getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY),
            historyLimit: getSystemVariableNumber('bootstrap.initialContextSyncHistoryLimit', INITIAL_CONTEXT_SYNC_HISTORY_LIMIT)
          }
        );
        await contextIngestionPromise;

        const chatSeed = chatHistory.length ? chatHistory : await readChatHistory();
        const chatIngestion = await contextMemoryService.ingestChatHistory(chatSeed, {
          limit: getSystemVariableNumber('bootstrap.initialContextSyncChatLimit', INITIAL_CONTEXT_SYNC_CHAT_LIMIT)
        });
        const profileIngestedId = await contextMemoryService.ingestUserProfile({
          user_name: panelSettings.displayName || '',
          displayName: panelSettings.displayName || '',
          birthday: panelSettings.birthday || '',
          language: panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE
        });
        const sourceCounts = {
          tabs: tabs.length,
          history: mergedHistory.length,
          chat: Math.max(0, Number(chatIngestion?.ingestedMessages) || 0),
          profile: profileIngestedId ? 1 : 0,
          facts: Math.max(0, Number(chatIngestion?.ingestedFacts) || 0)
        };
        const completedState = await writeInitialContextSyncState({
          status: 'done',
          completedAt: Date.now(),
          error: '',
          sourceCounts
        });

        logDebug('initial_context_sync:done', {
          sourceCounts
        });

        return completedState;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'initial_context_sync_failed';
        const failedState = await writeInitialContextSyncState({
          status: 'failed',
          error: message
        });

        logWarn('initial_context_sync:failed', {
          error: message
        });

        return failedState;
      } finally {
        initialContextSyncPromise = null;
      }
    })();

    return initialContextSyncPromise;
  }

  function handleTabContextSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return;
    }

    const tabs = Array.isArray(snapshot.tabs) ? snapshot.tabs : [];
    const history = Array.isArray(snapshot.history) ? snapshot.history : [];
    tabContextSnapshot = {
      activeTabId: typeof snapshot.activeTabId === 'number' ? snapshot.activeTabId : -1,
      reason: String(snapshot.reason || 'snapshot'),
      updatedAt: Number(snapshot.updatedAt) || Date.now(),
      history,
      tabs
    };

    trimTabSummaryCache();

    const tabsForSummary = tabs.slice(0, getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY));
    for (const tab of tabsForSummary) {
      enqueueTabSummary(tab);
    }

    queueContextIngestion(tabContextSnapshot);
    queueWhatsappHistorySync(tabContextSnapshot);

    renderTabsContextJson();

    const activeTab = getActiveTabContext();
    if (!activeTab || !isWhatsappContext(activeTab)) {
      hideWhatsappSuggestion();
      return;
    }

    generateWhatsappSuggestion(activeTab, { force: false });
  }

  function updateImageQualityLabel(value) {
    const numericValue = Number(value);
    const min = Number(imageQuality.min) || 0;
    const max = Number(imageQuality.max) || 1;
    const clamped = Number.isFinite(numericValue) ? Math.min(max, Math.max(min, numericValue)) : min;
    const percent = max > min ? ((clamped - min) / (max - min)) * 100 : 0;

    imageQualityValue.textContent = clamped.toFixed(2);
    imageQuality.style.setProperty('--quality-percent', `${percent.toFixed(2)}%`);
  }

  function getWebpFilename(file) {
    const cleanName = file.name.replace(/\.[^.]+$/, '');
    return `${cleanName || 'image'}.webp`;
  }

  function isSupportedImage(file) {
    if (ALLOWED_IMAGE_TYPES.has(file.type)) {
      return true;
    }

    return /\.(png|jpe?g|gif|bmp)$/i.test(file.name || '');
  }

  function imageFingerprint(file) {
    return `${file.name}::${file.size}::${file.lastModified}`;
  }

  function createQueueItem(file) {
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      fingerprint: imageFingerprint(file),
      file,
      sourceUrl: URL.createObjectURL(file),
      outputUrl: '',
      outputBlob: null,
      status: 'pending',
      note: 'Pendiente',
      beforeBytes: file.size,
      afterBytes: 0,
      width: 0,
      height: 0
    };
  }

  function releaseQueueItem(item) {
    revokeObjectUrl(item.sourceUrl);
    revokeObjectUrl(item.outputUrl);
    item.outputBlob = null;
  }

  function clearQueueOutputs() {
    for (const item of imageQueue) {
      revokeObjectUrl(item.outputUrl);
      item.outputUrl = '';
      item.outputBlob = null;
      item.afterBytes = 0;
      item.width = 0;
      item.height = 0;
      item.status = 'pending';
      item.note = 'Pendiente';
    }
  }

  function clearImageQueue() {
    for (const item of imageQueue) {
      releaseQueueItem(item);
    }

    imageQueue = [];
    pendingAutoProcess = false;
    renderImageQueue();
    setStatus(imageStatus, 'Lista limpiada.');
  }

  function getItemMetaLine(item) {
    if (item.status === 'processing') {
      return { text: 'Procesando...', className: '' };
    }

    if (item.status === 'error') {
      return { text: item.note || 'Error al convertir.', className: 'image-item__meta--error' };
    }

    if (item.status === 'done') {
      return { text: item.note || 'Convertida.', className: 'image-item__meta--done' };
    }

    return { text: `${formatBytes(item.beforeBytes)} • Pendiente`, className: '' };
  }

  function createDownloadIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const pathA = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathA.setAttribute('d', 'M12 4v10');
    pathA.setAttribute('fill', 'none');
    pathA.setAttribute('stroke', 'currentColor');
    pathA.setAttribute('stroke-width', '1.9');
    pathA.setAttribute('stroke-linecap', 'round');

    const pathB = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathB.setAttribute('d', 'M8 10l4 4 4-4');
    pathB.setAttribute('fill', 'none');
    pathB.setAttribute('stroke', 'currentColor');
    pathB.setAttribute('stroke-width', '1.9');
    pathB.setAttribute('stroke-linecap', 'round');
    pathB.setAttribute('stroke-linejoin', 'round');

    const pathC = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathC.setAttribute('d', 'M5 18h14');
    pathC.setAttribute('fill', 'none');
    pathC.setAttribute('stroke', 'currentColor');
    pathC.setAttribute('stroke-width', '1.9');
    pathC.setAttribute('stroke-linecap', 'round');

    svg.append(pathA, pathB, pathC);
    return svg;
  }

  function createCopyIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const pathA = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathA.setAttribute('d', 'M9 9.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-8z');
    pathA.setAttribute('fill', 'none');
    pathA.setAttribute('stroke', 'currentColor');
    pathA.setAttribute('stroke-width', '1.8');
    pathA.setAttribute('stroke-linejoin', 'round');

    const pathB = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathB.setAttribute('d', 'M6 15.5h-.7A2.3 2.3 0 0 1 3 13.2V5.3A2.3 2.3 0 0 1 5.3 3h7.9a2.3 2.3 0 0 1 2.3 2.3V6');
    pathB.setAttribute('fill', 'none');
    pathB.setAttribute('stroke', 'currentColor');
    pathB.setAttribute('stroke-width', '1.8');
    pathB.setAttribute('stroke-linecap', 'round');
    pathB.setAttribute('stroke-linejoin', 'round');

    svg.append(pathA, pathB);
    return svg;
  }

  function renderImageQueue() {
    imageQueueList.textContent = '';

    if (!imageQueue.length) {
      const empty = document.createElement('li');
      empty.className = 'image-queue__empty';
      empty.textContent = 'No hay imagenes cargadas. Arrastra archivos o pulsa "Agregar imagenes".';
      imageQueueList.appendChild(empty);
      return;
    }

    for (const item of imageQueue) {
      const row = document.createElement('li');
      row.className = 'image-item';

      const main = document.createElement('div');
      main.className = 'image-item__main';

      const thumb = document.createElement('img');
      thumb.className = 'image-item__thumb';
      thumb.src = item.sourceUrl;
      thumb.alt = item.file.name;

      const text = document.createElement('div');
      text.className = 'image-item__text';

      const name = document.createElement('p');
      name.className = 'image-item__name';
      name.textContent = item.file.name;

      const meta = document.createElement('p');
      meta.className = 'image-item__meta';
      const metaLine = getItemMetaLine(item);
      if (metaLine.className) {
        meta.classList.add(metaLine.className);
      }
      meta.textContent = metaLine.text;

      text.append(name, meta);
      main.append(thumb, text);

      const actions = document.createElement('div');
      actions.className = 'image-item__actions';

      if (item.status === 'done' && item.outputUrl) {
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'image-copy-btn';
        copyBtn.dataset.copyId = item.id;
        copyBtn.title = 'Copiar imagen';
        copyBtn.setAttribute('aria-label', `Copiar ${item.file.name} al portapapeles`);
        copyBtn.appendChild(createCopyIcon());
        actions.appendChild(copyBtn);

        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'image-download-btn';
        downloadBtn.dataset.downloadId = item.id;
        downloadBtn.title = 'Descargar WebP';
        downloadBtn.setAttribute('aria-label', `Descargar ${getWebpFilename(item.file)}`);
        downloadBtn.appendChild(createDownloadIcon());
        actions.appendChild(downloadBtn);
      }

      row.append(main, actions);
      imageQueueList.appendChild(row);
    }
  }

  function summarizeImageImport(result) {
    const chunks = [];

    if (result.added > 0) {
      chunks.push(`Agregadas ${result.added} imagenes.`);
    }

    if (result.duplicates > 0) {
      chunks.push(`${result.duplicates} duplicadas omitidas.`);
    }

    if (result.unsupported > 0) {
      chunks.push(`${result.unsupported} no soportadas.`);
    }

    if (result.overflow > 0) {
      chunks.push(`Limite maximo: ${MAX_IMAGE_FILES}. ${result.overflow} omitidas.`);
    }

    return chunks.join(' ');
  }

  function addImageFiles(rawFiles) {
    const files = Array.from(rawFiles || []).filter((file) => file instanceof File);
    if (!files.length) {
      return;
    }

    const seen = new Set(imageQueue.map((item) => item.fingerprint));
    const result = {
      added: 0,
      duplicates: 0,
      unsupported: 0,
      overflow: 0
    };

    for (const file of files) {
      if (!isSupportedImage(file)) {
        result.unsupported += 1;
        continue;
      }

      const fingerprint = imageFingerprint(file);
      if (seen.has(fingerprint)) {
        result.duplicates += 1;
        continue;
      }

      if (imageQueue.length >= MAX_IMAGE_FILES) {
        result.overflow += 1;
        continue;
      }

      const item = createQueueItem(file);
      imageQueue.push(item);
      seen.add(fingerprint);
      result.added += 1;
    }

    renderImageQueue();

    const message = summarizeImageImport(result) || 'No se agregaron imagenes.';
    setStatus(imageStatus, message, result.added === 0);

    if (result.added > 0) {
      requestAutoProcess();
    }
  }

  function handleImageFileChange() {
    addImageFiles(imageInput.files);
    imageInput.value = '';
  }

  function triggerDownloadForItem(itemId) {
    const item = imageQueue.find((entry) => entry.id === itemId);
    if (!item || !item.outputUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = item.outputUrl;
    link.download = getWebpFilename(item.file);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function canWriteImageToClipboard() {
    return Boolean(
      navigator.clipboard &&
        typeof navigator.clipboard.write === 'function' &&
        typeof window.ClipboardItem === 'function'
    );
  }

  async function convertBlobToPng(blob) {
    const image = await decodeImage(blob);
    const width = image.width;
    const height = image.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo preparar la imagen para copiar.');
    }

    ctx.drawImage(image, 0, 0, width, height);
    if (typeof image.close === 'function') {
      image.close();
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
          return;
        }
        reject(new Error('No se pudo convertir la imagen para portapapeles.'));
      }, 'image/png');
    });
  }

  async function writeBlobToImageClipboard(blob) {
    if (!canWriteImageToClipboard()) {
      throw new Error('Copiar imagen no esta soportado en este contexto del navegador.');
    }

    const primaryType = blob.type || 'image/webp';
    const attempts = [primaryType];
    if (!attempts.includes('image/png')) {
      attempts.push('image/png');
    }

    let lastError = null;

    for (const type of attempts) {
      try {
        const payload = type === 'image/png' && blob.type !== 'image/png' ? await convertBlobToPng(blob) : blob;
        const item = new window.ClipboardItem({ [type]: payload });
        await navigator.clipboard.write([item]);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error('No se pudo copiar la imagen al portapapeles.');
  }

  async function copyImageForItem(itemId, triggerButton) {
    const item = imageQueue.find((entry) => entry.id === itemId);
    if (!item || !item.outputBlob) {
      setStatus(imageStatus, 'No hay imagen procesada para copiar.', true);
      return;
    }

    if (triggerButton) {
      triggerButton.disabled = true;
    }

    try {
      await writeBlobToImageClipboard(item.outputBlob);
      setStatus(imageStatus, `Imagen copiada: ${item.file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo copiar la imagen.';
      setStatus(imageStatus, message, true);
    } finally {
      if (triggerButton) {
        triggerButton.disabled = false;
      }
    }
  }

  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file);
    }

    const fallbackUrl = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(fallbackUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(fallbackUrl);
        reject(new Error('No se pudo decodificar la imagen.'));
      };
      img.src = fallbackUrl;
    });
  }

  async function convertImageToWebp(file, quality) {
    const image = await decodeImage(file);
    const width = image.width;
    const height = image.height;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo abrir el contexto de canvas.');
    }

    ctx.drawImage(image, 0, 0, width, height);

    if (typeof image.close === 'function') {
      image.close();
    }

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
            return;
          }
          reject(new Error('No se pudo generar el archivo WebP.'));
        },
        'image/webp',
        quality
      );
    });

    return {
      blob,
      width,
      height,
      beforeBytes: file.size,
      afterBytes: blob.size,
      isGif: (file.type || '').toLowerCase() === 'image/gif'
    };
  }

  function canShowImageDropOverlay() {
    return app && app.dataset.screen === 'tools' && toolsScreen.dataset.tool === 'image';
  }

  function setDropUi(isActive) {
    const visible = Boolean(isActive && canShowImageDropOverlay());

    if (dropOverlay) {
      dropOverlay.classList.toggle('is-visible', visible);
    }

    imageDropzone.classList.toggle('is-drag-over', visible);
  }

  function hasFilesDataTransfer(event) {
    const dt = event.dataTransfer;
    if (!dt || !dt.types) {
      return false;
    }

    return Array.from(dt.types).includes('Files');
  }

  function requestAutoProcess() {
    if (isConvertingImages) {
      pendingAutoProcess = true;
      return;
    }

    convertImageQueue();
  }

  async function convertImageQueue() {
    if (isConvertingImages) {
      return;
    }

    const targets = imageQueue.filter((item) => item.status === 'pending' || item.status === 'error');
    if (!targets.length) {
      setStatus(imageStatus, 'No hay imagenes pendientes por procesar.');
      return;
    }

    const quality = Number(imageQuality.value);
    const safeQuality = Number.isFinite(quality)
      ? quality
      : Number(DEFAULT_SETTINGS[PREFERENCE_KEYS.IMAGE_QUALITY]) || 0.9;

    isConvertingImages = true;
    imageClearBtn.disabled = true;

    await saveSettings({ [PREFERENCE_KEYS.IMAGE_QUALITY]: safeQuality });

    let converted = 0;
    let failed = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const item = targets[index];
      item.status = 'processing';
      item.note = 'Procesando...';
      renderImageQueue();
      setStatus(imageStatus, `Procesando ${index + 1}/${targets.length}...`);

      try {
        const result = await convertImageToWebp(item.file, safeQuality);

        revokeObjectUrl(item.outputUrl);
        item.outputUrl = URL.createObjectURL(result.blob);
        item.outputBlob = result.blob;
        item.status = 'done';
        item.width = result.width;
        item.height = result.height;
        item.beforeBytes = result.beforeBytes;
        item.afterBytes = result.afterBytes;

        const delta = result.beforeBytes > 0 ? ((result.beforeBytes - result.afterBytes) / result.beforeBytes) * 100 : 0;
        let note = `${result.width}x${result.height} • ${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)} (${delta.toFixed(1)}%)`;
        if (result.isGif) {
          note += ' • GIF: primer frame';
        }

        item.note = note;
        converted += 1;
      } catch (error) {
        item.status = 'error';
        item.note = error instanceof Error ? error.message : 'No se pudo convertir la imagen.';
        failed += 1;
      }

      renderImageQueue();
    }

    const summary = [`Procesadas: ${converted}`];
    if (failed) {
      summary.push(`Errores: ${failed}`);
    }

    setStatus(imageStatus, summary.join(' | '), failed > 0 && converted === 0);

    isConvertingImages = false;
    imageClearBtn.disabled = false;

    if (pendingAutoProcess) {
      pendingAutoProcess = false;
      convertImageQueue();
    }
  }

  function applyInActiveTab() {
    if (!chrome.tabs || !chrome.tabs.query) {
      setStatus(retoolStatus, 'API de tabs no disponible en este contexto.', true);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        setStatus(retoolStatus, 'No se encontro pestana activa.', true);
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: APPLY_MESSAGE_TYPE }, () => {
        if (chrome.runtime.lastError) {
          setStatus(retoolStatus, 'La pestana activa no es compatible (abre una app de Retool).', true);
          return;
        }

        setStatus(retoolStatus, 'Tool aplicada en la pestana activa.');
      });
    });
  }

  async function hydrateSettings() {
    settings = await getSettings();

    const quality = Number(settings[PREFERENCE_KEYS.IMAGE_QUALITY] ?? DEFAULT_SETTINGS[PREFERENCE_KEYS.IMAGE_QUALITY]);
    imageQuality.value = Number.isFinite(quality)
      ? String(quality)
      : String(DEFAULT_SETTINGS[PREFERENCE_KEYS.IMAGE_QUALITY]);
    updateImageQualityLabel(imageQuality.value);

    retoolToggle.checked = Boolean(settings[TOOL_KEYS.RETOOL_LAYOUT_CLEANUP]);

    const storedTheme =
      typeof settings[PREFERENCE_KEYS.UI_THEME_MODE] === 'string'
        ? settings[PREFERENCE_KEYS.UI_THEME_MODE]
        : DEFAULT_SETTINGS[PREFERENCE_KEYS.UI_THEME_MODE];
    applyTheme(storedTheme);
  }

  async function hydratePanelSettings() {
    if (!settingsScreenController) {
      return;
    }

    await settingsScreenController.hydratePanelSettings();
    panelSettings = { ...settingsScreenController.getPanelSettings() };
    if (settingsScreenState) {
      settingsScreenState.panelSettings = { ...panelSettings };
    }

    await hydratePinUnlockSession();
    currentChatModelProfileId = resolvePrimaryProfileId();
    syncModelSelectors();
    renderAiModelsSettings();
    renderPinStatus();
    renderCrmErpDatabaseSettings({ syncInput: true });
    await contextMemoryService.syncIdentityProfile({
      user_name: panelSettings.displayName || ''
    });
  }

  async function handleOnboardingContinue() {
    if (!settingsScreenController) {
      return;
    }

    await settingsScreenController.handleOnboardingContinue({
      setScreen,
      requestChatAutofocus
    });
    panelSettings = { ...settingsScreenController.getPanelSettings() };
    currentChatModelProfileId = resolvePrimaryProfileId();
    await contextMemoryService.syncIdentityProfile({
      user_name: panelSettings.displayName || ''
    });
  }

  async function saveUserSettingsScreen() {
    if (!settingsScreenController) {
      return;
    }

    await settingsScreenController.saveUserSettings();
    panelSettings = { ...settingsScreenController.getPanelSettings() };
    await contextMemoryService.syncIdentityProfile({
      user_name: panelSettings.displayName || ''
    });
  }

  async function saveAssistantSettingsScreen() {
    if (!settingsScreenController) {
      return;
    }

    await settingsScreenController.saveAssistantSettings();
    panelSettings = { ...settingsScreenController.getPanelSettings() };
  }

  async function hydrateChatHistory() {
    chatHistory = await readChatHistory();
    const maxHistoryMessages = getSystemVariableNumber('chat.maxHistoryMessages', MAX_CHAT_HISTORY_MESSAGES);
    if (chatHistory.length > maxHistoryMessages) {
      chatHistory = chatHistory.slice(-maxHistoryMessages);
      await saveChatHistory();
    }
    renderChatMessages();
    scrollChatToBottom();

    const latestAssistant = [...chatHistory].reverse().find((msg) => msg.role === 'assistant');
    if (latestAssistant) {
      const restoredEmotion = extractEmotionFromAssistantMessage(latestAssistant.content);
      if (restoredEmotion) {
        setBrandEmotion(restoredEmotion, { immediate: true });
      } else {
        startRandomEmotionCycle({ immediate: false });
      }
    } else {
      startRandomEmotionCycle({ immediate: false });
    }
  }

  function wireEvents() {
    wirePinDigitGroup(pinDigitInputs);
    wirePinDigitGroup(pinConfirmDigitInputs);
    syncPinHiddenInputs();

    brandHomeBtn?.addEventListener('click', () => {
      goToPrimaryScreen();
    });

    openToolsBtn?.addEventListener('click', () => {
      openTools('image');
    });

    openSettingsBtn?.addEventListener('click', () => {
      openSettings();
    });

    goHomeBtn?.addEventListener('click', () => {
      goToPrimaryScreen();
    });

    closeSettingsBtn?.addEventListener('click', () => {
      goToPrimaryScreen();
    });

    onboardingContinueBtn?.addEventListener('click', () => {
      handleOnboardingContinue();
    });

    onboardingNameInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      handleOnboardingContinue();
    });

    settingsSectionBackBtn?.addEventListener('click', () => {
      setSettingsPage(SETTINGS_PAGES.HOME);
    });

    for (const item of settingsNavItems) {
      item.addEventListener('click', () => {
        setSettingsPage(item.dataset.settingsTarget || SETTINGS_PAGES.HOME);
      });
    }

    settingsUserSaveBtn?.addEventListener('click', () => {
      saveUserSettingsScreen();
    });

    settingsAssistantSaveBtn?.addEventListener('click', () => {
      saveAssistantSettingsScreen();
    });

    settingsCrmErpDbSaveBtn?.addEventListener('click', () => {
      void saveCrmErpDatabaseSettingsFromScreen({ analyzeAfterSave: false });
    });

    settingsCrmErpDbAnalyzeBtn?.addEventListener('click', () => {
      void saveCrmErpDatabaseSettingsFromScreen({ analyzeAfterSave: true });
    });

    settingsCrmErpDbUrlInput?.addEventListener('input', () => {
      setStatus(settingsCrmErpDbStatus, '');
    });

    settingsCrmErpDbUrlInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      void saveCrmErpDatabaseSettingsFromScreen({ analyzeAfterSave: false });
    });

    systemVariablesSaveBtn?.addEventListener('click', () => {
      saveSystemVariablesFromScreen();
    });

    systemVariablesResetBtn?.addEventListener('click', () => {
      resetSystemVariablesToDefaults();
    });

    systemVariablesList?.addEventListener('input', () => {
      setStatus(systemVariablesStatus, '');
    });

    chatModelSelect?.addEventListener('change', () => {
      updatePrimaryModel(chatModelSelect.value);
    });

    aiPrimaryModelSelect?.addEventListener('change', () => {
      updatePrimaryModel(aiPrimaryModelSelect.value);
    });

    settingsAddModelBtn?.addEventListener('click', () => {
      openModelConfigModal('add');
    });

    settingsRefreshLocalModelsBtn?.addEventListener('click', () => {
      refreshLocalModels({ silent: false });
    });

    aiModelsAccessActionBtn?.addEventListener('click', () => {
      const mode = getAiModelsAccessMode();
      if (!mode) {
        return;
      }

      openPinModal(mode);
    });

    aiModelsList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-model-action]');
      if (!button) {
        return;
      }

      const row = button.closest('[data-profile-id]');
      const profileId = row?.dataset.profileId || '';
      if (!profileId) {
        return;
      }

      const action = button.dataset.modelAction;
      if (action === 'set-primary') {
        updatePrimaryModel(profileId);
        return;
      }

      if (action === 'edit-key') {
        openModelConfigModal('edit', profileId);
      }
    });

    settingsSetupPinBtn?.addEventListener('click', () => {
      if (isPinConfigured() && !isPinUnlocked()) {
        openPinModal(PIN_MODAL_MODES.UNLOCK);
        return;
      }

      openPinModal(PIN_MODAL_MODES.SETUP);
    });

    settingsUnlockPinBtn?.addEventListener('click', () => {
      openPinModal(PIN_MODAL_MODES.UNLOCK);
    });

    settingsLockPinBtn?.addEventListener('click', () => {
      resetPinSession();
      syncModelSelectors();
      renderAiModelsSettings();
      renderPinStatus();
      setStatus(aiModelsStatus, 'PIN bloqueado.');
    });

    modelProviderSelect?.addEventListener('change', () => {
      updateModelModalProviderUi();
    });

    modelConfigCloseBtn?.addEventListener('click', () => {
      closeModelConfigModal();
    });

    modelConfigCancelBtn?.addEventListener('click', () => {
      closeModelConfigModal();
    });

    modelConfigSaveBtn?.addEventListener('click', () => {
      saveModelFromModal();
    });

    modelConfigClearKeyBtn?.addEventListener('click', () => {
      clearApiKeyFromModal();
    });

    modelConfigModal?.addEventListener('click', (event) => {
      if (event.target === modelConfigModal) {
        closeModelConfigModal();
      }
    });

    pinModalCloseBtn?.addEventListener('click', () => {
      closePinModal();
    });

    pinModalCancelBtn?.addEventListener('click', () => {
      closePinModal();
    });

    pinModalSaveBtn?.addEventListener('click', () => {
      savePinFromModal();
    });

    pinModal?.addEventListener('click', (event) => {
      if (event.target === pinModal) {
        closePinModal();
      }
    });

    settingsLanguageSelect?.addEventListener('change', () => {
      settingsScreenController?.handleLanguageChange();
    });

    settingsThemeModeSelect?.addEventListener('change', () => {
      void setThemeMode(settingsThemeModeSelect.value, { silent: false });
    });

    for (const tab of toolTabs) {
      tab.addEventListener('click', () => {
        setActiveTool(tab.dataset.toolTarget || 'image');
      });
    }

    if (prefersDarkMedia) {
      const onSystemThemeChange = () => {
        if (themeMode === 'system') {
          applyTheme('system');
        }
      };

      if (typeof prefersDarkMedia.addEventListener === 'function') {
        prefersDarkMedia.addEventListener('change', onSystemThemeChange);
      } else if (typeof prefersDarkMedia.addListener === 'function') {
        prefersDarkMedia.addListener(onSystemThemeChange);
      }
    }

    chatToolBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (chatToolMenu.hidden) {
        openToolMenu();
        return;
      }

      closeToolMenu();
    });

    chatToolMenu?.addEventListener('click', (event) => {
      event.stopPropagation();
      const option = event.target.closest('[data-chat-tool]');
      if (!option) {
        return;
      }

      setChatTool(option.dataset.chatTool || DEFAULT_CHAT_TOOL);
      closeToolMenu();
      requestChatAutofocus(6, 60);
    });

    document.addEventListener('click', (event) => {
      if (!chatToolPicker || !chatToolPicker.contains(event.target)) {
        closeToolMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeToolMenu();
        closeModelConfigModal();
        closePinModal();
      }
    });

    chatResetBtn?.addEventListener('click', () => {
      resetChatHistory();
    });

    chatInput?.addEventListener('input', () => {
      updateChatInputSize();
    });

    chatInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      sendChatMessage();
    });

    chatSendBtn?.addEventListener('click', () => {
      sendChatMessage();
    });

    whatsappSuggestionRunBtn?.addEventListener('click', () => {
      executeWhatsappSuggestion();
    });

    whatsappSuggestionCloseBtn?.addEventListener('click', () => {
      dismissWhatsappSuggestion();
    });

    whatsappSuggestionRefreshBtn?.addEventListener('click', () => {
      const activeTab = getActiveTabContext();
      if (!activeTab || !isWhatsappContext(activeTab)) {
        return;
      }

      generateWhatsappSuggestion(activeTab, { force: true });
    });

    imagePickBtn?.addEventListener('click', () => {
      imageInput.click();
    });

    imageDropzone?.addEventListener('click', (event) => {
      if (event.target.closest('#imagePickBtn')) {
        return;
      }

      imageInput.click();
    });

    imageDropzone?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      imageInput.click();
    });

    imageInput?.addEventListener('change', () => {
      handleImageFileChange();
    });

    imageQuality?.addEventListener('input', () => {
      updateImageQualityLabel(imageQuality.value);
    });

    imageQuality?.addEventListener('change', async () => {
      const nextQuality = Number(imageQuality.value);
      await saveSettings({ [PREFERENCE_KEYS.IMAGE_QUALITY]: nextQuality });
      clearQueueOutputs();
      renderImageQueue();
      if (imageQueue.length) {
        setStatus(imageStatus, 'Calidad actualizada. Reprocesando...');
        requestAutoProcess();
      }
    });

    imageClearBtn?.addEventListener('click', () => {
      clearImageQueue();
    });

    imageQueueList?.addEventListener('click', (event) => {
      const copyButton = event.target.closest('[data-copy-id]');
      if (copyButton) {
        copyImageForItem(copyButton.dataset.copyId || '', copyButton);
        return;
      }

      const downloadButton = event.target.closest('[data-download-id]');
      if (!downloadButton) {
        return;
      }

      triggerDownloadForItem(downloadButton.dataset.downloadId || '');
    });

    document.addEventListener('dragenter', (event) => {
      if (!hasFilesDataTransfer(event)) {
        return;
      }

      event.preventDefault();
      dragDepth += 1;
      setDropUi(true);
    });

    document.addEventListener('dragover', (event) => {
      if (!hasFilesDataTransfer(event)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });

    document.addEventListener('dragleave', (event) => {
      if (!hasFilesDataTransfer(event)) {
        return;
      }

      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        setDropUi(false);
      }
    });

    document.addEventListener('drop', (event) => {
      if (!hasFilesDataTransfer(event)) {
        return;
      }

      event.preventDefault();
      dragDepth = 0;
      setDropUi(false);
      openTools('image');
      addImageFiles(event.dataTransfer ? event.dataTransfer.files : []);
    });

    retoolToggle?.addEventListener('change', async () => {
      const ok = await saveSettings({ [TOOL_KEYS.RETOOL_LAYOUT_CLEANUP]: retoolToggle.checked });
      if (!ok) {
        setStatus(retoolStatus, 'No se pudo guardar la configuracion de Retool Cleanup.', true);
        return;
      }

      setStatus(retoolStatus, `Retool Cleanup ${retoolToggle.checked ? 'activada' : 'desactivada'}.`);
    });

    applyRetoolBtn?.addEventListener('click', () => {
      applyInActiveTab();
    });

    window.addEventListener('beforeunload', () => {
      tabContextService.stop();
      void contextMemoryService.shutdown();
      stopRandomEmotionCycle();
      for (const item of imageQueue) {
        releaseQueueItem(item);
      }

      if (stageResizeObserver) {
        stageResizeObserver.disconnect();
        stageResizeObserver = null;
      }
    });

    window.addEventListener('resize', () => {
      realignStageToScreen();
    });

    window.addEventListener('focus', () => {
      requestChatAutofocus(8, 70);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestChatAutofocus(8, 70);
      }
    });
  }

  async function init() {
    settingsScreenState = {
      panelSettings: { ...panelSettings }
    };
    settingsScreenController = createSettingsScreenController({
      elements: {
        onboardingNameInput,
        onboardingStatus,
        settingsNameInput,
        settingsBirthdayInput,
        settingsThemeModeSelect,
        settingsLanguageSelect,
        settingsSystemPrompt,
        settingsUserStatus,
        settingsAssistantStatus,
        chatStatus
      },
      state: settingsScreenState,
      defaults: {
        panelSettingsDefaults: PANEL_SETTINGS_DEFAULTS
      },
      storage: {
        readPanelSettings,
        savePanelSettings
      },
      setStatus,
      getThemeMode: () => themeMode,
      setThemeMode,
      onAfterHydrate: normalizePanelModelSettings
    });

    setStageTransitionEnabled(false);
    wireEvents();
    observeStageSizeChanges();
    setChatTool(DEFAULT_CHAT_TOOL);
    closeToolMenu();
    updateChatInputSize();
    renderImageQueue();
    hideWhatsappSuggestion();
    renderTabsContextJson();

    await contextMemoryService.init();
    await tabContextService.start();

    await hydrateSettings();
    await hydratePanelSettings();
    void runInitialContextBootstrap();
    setActiveTool('image');
    const initialScreen = resolveHomeOrOnboardingScreen();
    setScreen(initialScreen);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        setScreen(initialScreen);
        requestAnimationFrame(() => {
          setStageTransitionEnabled(true);
        });
      });
    } else {
      setStageTransitionEnabled(true);
    }

    await hydrateBrandEmotions();
    await hydrateChatHistory();
    await refreshLocalModels({ silent: true });
    syncModelSelectors();
    renderAiModelsSettings();

    const activeProfile = getActiveModelProfile();
    if (!chatHistory.length && activeProfile && activeProfile.provider === AI_PROVIDER_IDS.OLLAMA) {
      setStatus(chatStatus, `Precargando ${activeProfile.model}...`, false, { loading: true });
      warmupPrimaryModel();
    } else if (!chatHistory.length && activeProfile) {
      setStatus(chatStatus, `Modelo principal: ${activeProfile.name} (${activeProfile.model}).`);
    }

    if (initialScreen === 'home') {
      requestChatAutofocus(10, 80);
    } else {
      onboardingNameInput?.focus();
    }
  }

  init();
}
