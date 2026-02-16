import {
  buildDefaultChatSystemPrompt,
  DEFAULT_ASSISTANT_LANGUAGE,
  normalizeAssistantLanguage
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
import { createBrandEmotionController } from './controllers/brand-emotion-controller.js';
import { createSystemVariablesController } from './controllers/system-variables-controller.js';
import { createDynamicUiSortShowController } from './controllers/dynamic-ui-sort-show-controller.js';
import { buildTabSummaryPrompt, toJsonTabRecord } from './services/site-context/generic-site-context.js';
import {
  buildWhatsappMetaLabel,
  buildWhatsappReplyPrompt,
  DEFAULT_WHATSAPP_REPLY_PROMPT_BASE,
  buildWhatsappSignalKey,
  getWhatsappChatKey,
  hasWhatsappConversationHistory,
  isWhatsappContext,
  resolveWhatsappPromptTarget
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
    SYSTEM_VARIABLES: 'system_variables',
    APPS_INTEGRATIONS: 'apps_integrations'
  });
  const SETTINGS_PAGE_TITLES = Object.freeze({
    [SETTINGS_PAGES.HOME]: 'Settings',
    [SETTINGS_PAGES.USER]: 'User',
    [SETTINGS_PAGES.ASSISTANT]: 'Assistant',
    [SETTINGS_PAGES.AI_MODELS]: 'AI Models',
    [SETTINGS_PAGES.CRM_ERP_DATABASE]: 'CRM/ERP Database',
    [SETTINGS_PAGES.TABS]: 'Tabs',
    [SETTINGS_PAGES.SYSTEM_VARIABLES]: 'System Variables',
    [SETTINGS_PAGES.APPS_INTEGRATIONS]: 'Apps & Integrations'
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
  const STAGE_SCREEN_COUNT = Object.keys(SCREEN_INDEX).length;
  const BACKGROUND_RUNTIME_CONTEXT_UPDATE_TYPE = 'GREENSTUDIO_LOCATION_CONTEXT_UPDATE';
  const DEFAULT_CHAT_SYSTEM_PROMPT = buildDefaultChatSystemPrompt(DEFAULT_ASSISTANT_LANGUAGE);
  const DEFAULT_ASSISTANT_DISPLAY_NAME = 'Grenne';
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
    },
    create_image: {
      label: 'Create image',
      systemPrompt: 'Eres un asistente para generar imagenes con prompts claros.'
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
    wtf: 'assets/greene-eyes/eyes_wtf.svg',
    closed: 'assets/greene-eyes/eyes_closed.svg'
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
    wtf: 'wtf',
    closed: 'closed',
    close: 'closed',
    blink: 'closed',
    parpadeo: 'closed'
  });

  const BRAND_EMOTION_POINT_COUNT = 72;
  const BRAND_EMOTION_MORPH_DURATION = 420;

  const DEFAULT_CHAT_TOOL = 'chat';
  const MAX_CHAT_INPUT_ROWS = 8;
  const MAX_CHAT_CONTEXT_MESSAGES = 20;
  const MAX_CHAT_HISTORY_MESSAGES = 160;
  const MAX_CHAT_HISTORY_STORAGE_LIMIT = 600;
  const MAX_LOCAL_TOOL_CALLS = 3;
  const MAX_CHAT_ATTACHMENTS_PER_TURN = 8;
  const MAX_CHAT_ATTACHMENT_TEXT_CHARS = 3200;
  const MAX_IMAGE_FILES = 10;
  const MAX_TABS_FOR_AI_SUMMARY = 20;
  const TAB_SUMMARY_MAX_CHARS = 160;
  const INCREMENTAL_HISTORY_INGEST_LIMIT = 80;
  const MAX_WHATSAPP_PERSISTED_MESSAGES = 640;
  const MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT = 2000;
  const WHATSAPP_SUGGESTION_HISTORY_LIMIT = 120;
  const MAX_WHATSAPP_PROMPT_ENTRIES = 320;
  const MAX_WHATSAPP_PROMPT_CHARS = 1800;

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
  const systemVariablesController = createSystemVariablesController({
    defaultChatSystemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT,
    defaultWhatsappSuggestionBasePrompt: DEFAULT_WHATSAPP_REPLY_PROMPT_BASE,
    defaultWriteEmailSystemPrompt: DEFAULT_WRITE_EMAIL_SYSTEM_PROMPT,
    maxChatContextMessages: MAX_CHAT_CONTEXT_MESSAGES,
    maxChatHistoryMessages: MAX_CHAT_HISTORY_MESSAGES,
    maxChatHistoryStorageLimit: MAX_CHAT_HISTORY_STORAGE_LIMIT,
    maxLocalToolCalls: MAX_LOCAL_TOOL_CALLS,
    maxTabsForAiSummary: MAX_TABS_FOR_AI_SUMMARY,
    tabSummaryMaxChars: TAB_SUMMARY_MAX_CHARS,
    incrementalHistoryIngestLimit: INCREMENTAL_HISTORY_INGEST_LIMIT,
    initialContextSyncHistoryLimit: INITIAL_CONTEXT_SYNC_HISTORY_LIMIT,
    initialContextSyncHistoryDays: INITIAL_CONTEXT_SYNC_HISTORY_DAYS,
    initialContextSyncChatLimit: INITIAL_CONTEXT_SYNC_CHAT_LIMIT,
    initialContextSyncStaleMs: INITIAL_CONTEXT_SYNC_STALE_MS,
    maxWhatsappPersistedMessages: MAX_WHATSAPP_PERSISTED_MESSAGES,
    maxWhatsappPersistedMessagesStorageLimit: MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT,
    whatsappSuggestionHistoryLimit: WHATSAPP_SUGGESTION_HISTORY_LIMIT
  });
  const SYSTEM_VARIABLE_SCOPE_ORDER = systemVariablesController.scopeOrder;
  const SYSTEM_VARIABLE_DEFINITIONS = systemVariablesController.definitions;
  const SYSTEM_VARIABLE_DEFAULTS = systemVariablesController.defaults;

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

  function createDefaultIntegrationsConfig() {
    return {
      smtp: {
        relayUrl: '',
        host: '',
        port: 587,
        secure: 'auto',
        username: '',
        password: '',
        from: ''
      },
      maps: {
        apiKey: '',
        nearbyType: 'restaurant',
        lastKnownLocation: null,
        nearbyPlaces: []
      },
      permissions: {
        microphone: 'prompt',
        location: 'prompt'
      },
      customTools: []
    };
  }

  const PANEL_SETTINGS_DEFAULTS = Object.freeze({
    assistantName: DEFAULT_ASSISTANT_DISPLAY_NAME,
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
    crmErpDatabaseSchemaSnapshot: null,
    crmErpDatabaseMeProfile: null,
    whatsappConversationPrompts: {},
    integrations: createDefaultIntegrationsConfig()
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
  const brandRoleLabel = document.getElementById('brandRoleLabel');
  const brandNameText = document.getElementById('brandNameText');
  const toolsScreen = document.getElementById('toolsScreen');
  const openToolsBtn = document.getElementById('openToolsBtn');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const goHomeBtn = document.getElementById('goHomeBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const settingsTitle = document.getElementById('settingsTitle');
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
  const chatAttachmentInput = document.getElementById('chatAttachmentInput');
  const chatAttachmentsBar = document.getElementById('chatAttachmentsBar');
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatStatus = document.getElementById('chatStatus');
  const chatResetBtn = document.getElementById('chatResetBtn');
  const chatToolPicker = document.getElementById('chatToolPicker');
  const chatToolBtn = document.getElementById('chatToolBtn');
  const chatToolMenu = document.getElementById('chatToolMenu');
  const chatToolLabel = document.getElementById('chatToolLabel');
  const chatToolOptions = Array.from(document.querySelectorAll('[data-chat-tool]'));
  const chatModelSelect = document.getElementById('chatModelSelect');
  const whatsappSuggestionStatus = document.getElementById('whatsappSuggestionStatus');
  const dynamicSuggestionsArea = document.getElementById('dynamicSuggestionsArea');
  const dynamicSuggestionsList = document.getElementById('dynamicSuggestionsList');
  const dynamicRelationsArea = document.getElementById('dynamicRelationsArea');
  const dynamicRelationsList = document.getElementById('dynamicRelationsList');
  const dynamicUiToast = document.getElementById('dynamicUiToast');
  const dynamicRelationsDetailScreen = document.getElementById('dynamicRelationsDetailScreen');
  const dynamicRelationsDetailBackBtn = document.getElementById('dynamicRelationsDetailBackBtn');
  const dynamicRelationsDetailTitle = document.getElementById('dynamicRelationsDetailTitle');
  const dynamicRelationsDetailMeta = document.getElementById('dynamicRelationsDetailMeta');
  const dynamicRelationsDetailBody = document.getElementById('dynamicRelationsDetailBody');
  const dynamicRelationsDetailStatus = document.getElementById('dynamicRelationsDetailStatus');

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
  const onboardingAssistantNameInput = document.getElementById('onboardingAssistantNameInput');
  const onboardingNameInput = document.getElementById('onboardingNameInput');
  const onboardingContinueBtn = document.getElementById('onboardingContinueBtn');
  const onboardingStatus = document.getElementById('onboardingStatus');
  const settingsNameInput = document.getElementById('settingsNameInput');
  const settingsBirthdayInput = document.getElementById('settingsBirthdayInput');
  const settingsThemeModeSelect = document.getElementById('settingsThemeModeSelect');
  const settingsLanguageSelect = document.getElementById('settingsLanguageSelect');
  const settingsSystemPrompt = document.getElementById('settingsSystemPrompt');
  const settingsUserStatus = document.getElementById('settingsUserStatus');
  const settingsAssistantStatus = document.getElementById('settingsAssistantStatus');
  const settingsWhatsappPromptChatLabel = document.getElementById('settingsWhatsappPromptChatLabel');
  const settingsWhatsappPromptChatKey = document.getElementById('settingsWhatsappPromptChatKey');
  const settingsWhatsappPromptInput = document.getElementById('settingsWhatsappPromptInput');
  const settingsWhatsappPromptClearBtn = document.getElementById('settingsWhatsappPromptClearBtn');
  const settingsWhatsappPromptStatus = document.getElementById('settingsWhatsappPromptStatus');
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
  const settingsCrmErpDbAnalyzeBtn = document.getElementById('settingsCrmErpDbAnalyzeBtn');
  const settingsCrmErpDbStatus = document.getElementById('settingsCrmErpDbStatus');
  const settingsCrmErpMeTableSelect = document.getElementById('settingsCrmErpMeTableSelect');
  const settingsCrmErpMeIdColumnSelect = document.getElementById('settingsCrmErpMeIdColumnSelect');
  const settingsCrmErpMeUserIdInput = document.getElementById('settingsCrmErpMeUserIdInput');
  const settingsCrmErpMeClearBtn = document.getElementById('settingsCrmErpMeClearBtn');
  const settingsCrmErpMeStatus = document.getElementById('settingsCrmErpMeStatus');
  const settingsCrmErpDbSchemaSummary = document.getElementById('settingsCrmErpDbSchemaSummary');
  const settingsIntegrationsSaveBtn = document.getElementById('settingsIntegrationsSaveBtn');
  const settingsIntegrationsStatus = document.getElementById('settingsIntegrationsStatus');
  const settingsSmtpRelayUrlInput = document.getElementById('settingsSmtpRelayUrlInput');
  const settingsSmtpHostInput = document.getElementById('settingsSmtpHostInput');
  const settingsSmtpPortInput = document.getElementById('settingsSmtpPortInput');
  const settingsSmtpSecureSelect = document.getElementById('settingsSmtpSecureSelect');
  const settingsSmtpUsernameInput = document.getElementById('settingsSmtpUsernameInput');
  const settingsSmtpPasswordInput = document.getElementById('settingsSmtpPasswordInput');
  const settingsSmtpFromInput = document.getElementById('settingsSmtpFromInput');
  const settingsMapsApiKeyInput = document.getElementById('settingsMapsApiKeyInput');
  const settingsMapsNearbyTypeSelect = document.getElementById('settingsMapsNearbyTypeSelect');
  const settingsPermissionMicBtn = document.getElementById('settingsPermissionMicBtn');
  const settingsPermissionLocationBtn = document.getElementById('settingsPermissionLocationBtn');
  const settingsMapsNearbyRefreshBtn = document.getElementById('settingsMapsNearbyRefreshBtn');
  const settingsLocationMeta = document.getElementById('settingsLocationMeta');
  const settingsCustomToolsSchemaInput = document.getElementById('settingsCustomToolsSchemaInput');
  const tabsContextJson = document.getElementById('tabsContextJson');
  const systemVariablesList = document.getElementById('systemVariablesList');
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
  const brandEmotionController = createBrandEmotionController({
    assetsByEmotion: BRAND_EMOTION_FILES,
    aliasesByEmotion: BRAND_EMOTION_ALIASES,
    pointCount: BRAND_EMOTION_POINT_COUNT,
    morphDurationMs: BRAND_EMOTION_MORPH_DURATION,
    blinkEmotion: 'closed',
    blinkIntervalMinMs: 2400,
    blinkIntervalMaxMs: 5600,
    blinkCloseDurationMinMs: 72,
    blinkCloseDurationMaxMs: 148,
    blinkDoubleChance: 0.2,
    lookMaxOffsetPx: 2.6,
    lookLerp: 0.24,
    targets: [
      {
        container: brandEmotion,
        svg: brandEmotionSvg,
        rightPath: brandEmotionEyeRight,
        leftPath: brandEmotionEyeLeft
      },
      {
        container: onboardingEmotion,
        svg: onboardingEmotionSvg,
        rightPath: onboardingEmotionEyeRight,
        leftPath: onboardingEmotionEyeLeft
      }
    ]
  });
  const dynamicUiSortShowController = createDynamicUiSortShowController();

  let settings = { ...DEFAULT_SETTINGS };
  let imageQueue = [];
  let isConvertingImages = false;
  let pendingAutoProcess = false;
  let dragDepth = 0;
  let themeMode = DEFAULT_SETTINGS[PREFERENCE_KEYS.UI_THEME_MODE] || 'system';

  let chatHistory = [];
  let selectedChatTool = DEFAULT_CHAT_TOOL;
  let pendingConversationAttachments = [];
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
  let stageResizeObserver = null;
  let settingsScreenController = null;
  let settingsScreenState = null;
  let tabContextSnapshot = { activeTabId: -1, tabs: [], history: [], runtimeContext: {}, updatedAt: Date.now(), reason: 'init' };
  let tabSummaryByKey = new Map();
  let tabSummaryQueue = [];
  let tabSummaryQueueRunning = false;
  let whatsappSuggestionState = {
    tabId: -1,
    chatKey: '',
    signalKey: '',
    promptSignature: '',
    text: '',
    loading: false
  };
  let whatsappSuggestionToken = 0;
  let whatsappSuggestionDismissedSignalKey = '';
  let whatsappSuggestionExecutionInFlight = false;
  let whatsappSuggestionUiStatus = {
    message: '',
    isError: false,
    loading: false
  };
  let whatsappPromptEditorTarget = null;
  let whatsappPromptAutosaveTimer = 0;
  let whatsappPromptAutosaveToken = 0;
  let userSettingsAutosaveTimer = 0;
  let userSettingsAutosaveToken = 0;
  let assistantSettingsAutosaveTimer = 0;
  let assistantSettingsAutosaveToken = 0;
  let crmDbSettingsAutosaveTimer = 0;
  let crmDbSettingsAutosaveToken = 0;
  let crmMeSettingsAutosaveTimer = 0;
  let crmMeSettingsAutosaveToken = 0;
  let systemVariablesAutosaveTimer = 0;
  let systemVariablesAutosaveToken = 0;
  let integrationsAutosaveTimer = 0;
  let integrationsAutosaveToken = 0;
  let dynamicContextSignals = {
    phones: [],
    emails: []
  };
  let dynamicRelationsContextState = {
    signalKey: '',
    loading: false,
    cards: [],
    message: '',
    isError: false
  };
  let dynamicRelationCardIndex = new Map();
  let dynamicSuggestionIndex = new Map();
  let dynamicRelationsFetchToken = 0;
  let dynamicRelationsDetailState = {
    open: false,
    loading: false,
    cardId: '',
    groups: [],
    message: '',
    isError: false
  };
  let dynamicContextMetaLogKey = '';
  let dynamicSuggestionRenderIds = new Set();
  let dynamicRelationRenderIds = new Set();
  let dynamicUiToastHideTimer = 0;
  let dynamicUiToastKey = '';
  let contextIngestionPromise = Promise.resolve();
  let whatsappHistorySyncPromise = Promise.resolve();
  let whatsappHistoryVectorFingerprintByKey = new Map();
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
    return systemVariablesController.formatValue(value);
  }

  function coerceSystemVariableValue(definition, rawValue) {
    return systemVariablesController.coerceValue(definition, rawValue);
  }

  function normalizeSystemVariables(storedValues) {
    return systemVariablesController.normalizeValues(storedValues);
  }

  function getSystemVariableDefinition(variableId) {
    return systemVariablesController.getDefinition(variableId);
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
    return systemVariablesController.getScopeLabel(scopeId);
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

  function createEmptyWhatsappPromptTarget() {
    return {
      promptKey: '',
      promptKeys: [],
      label: '',
      type: 'unknown',
      isGroup: false,
      channelId: '',
      chatKey: '',
      title: '',
      phone: ''
    };
  }

  function normalizeWhatsappPromptStoreKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .slice(0, 260);
  }

  function normalizeWhatsappPromptTarget(rawTarget) {
    const source = rawTarget && typeof rawTarget === 'object' ? rawTarget : {};
    const rawPromptKeys = Array.isArray(source.promptKeys) ? source.promptKeys : [];
    const promptKeys = [];
    const seen = new Set();

    for (const candidate of [source.promptKey, ...rawPromptKeys]) {
      const key = normalizeWhatsappPromptStoreKey(candidate);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      promptKeys.push(key);
    }

    const primaryKey = promptKeys[0] || '';
    const rawType = String(source.type || '').trim().toLowerCase();
    const type = rawType === 'group' || rawType === 'direct' ? rawType : 'unknown';

    return {
      promptKey: primaryKey,
      promptKeys,
      label: String(source.label || '').trim().slice(0, 180),
      type,
      isGroup: type === 'group' || source.isGroup === true,
      channelId: String(source.channelId || '').trim().slice(0, 220),
      chatKey: String(source.chatKey || '').trim().slice(0, 220),
      title: String(source.title || '').trim().slice(0, 180),
      phone: String(source.phone || '').trim().slice(0, 80)
    };
  }

  function resolveWhatsappPromptTargetForContext(tabContext) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return createEmptyWhatsappPromptTarget();
    }

    return normalizeWhatsappPromptTarget(resolveWhatsappPromptTarget(tabContext));
  }

  function normalizeWhatsappConversationPromptEntry(rawEntry, fallbackKey = '') {
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const key = normalizeWhatsappPromptStoreKey(entry.key || fallbackKey || '');
    const prompt = String(entry.prompt || '')
      .trim()
      .slice(0, MAX_WHATSAPP_PROMPT_CHARS);

    if (!key || !prompt) {
      return null;
    }

    const rawType = String(entry.type || '').trim().toLowerCase();
    const type = rawType === 'group' || rawType === 'direct' ? rawType : 'unknown';

    return {
      key,
      prompt,
      label: String(entry.label || '').trim().slice(0, 180),
      type,
      isGroup: type === 'group' || entry.isGroup === true,
      channelId: String(entry.channelId || '').trim().slice(0, 220),
      chatKey: String(entry.chatKey || '').trim().slice(0, 220),
      title: String(entry.title || '').trim().slice(0, 180),
      phone: String(entry.phone || '').trim().slice(0, 80),
      updatedAt: Math.max(0, Number(entry.updatedAt) || Date.now())
    };
  }

  function normalizeWhatsappConversationPrompts(rawPrompts) {
    const rows = [];

    if (Array.isArray(rawPrompts)) {
      for (const item of rawPrompts) {
        rows.push(normalizeWhatsappConversationPromptEntry(item, item?.key || ''));
      }
    } else if (rawPrompts && typeof rawPrompts === 'object') {
      for (const [key, value] of Object.entries(rawPrompts)) {
        rows.push(normalizeWhatsappConversationPromptEntry(value, key));
      }
    }

    const normalizedRows = rows
      .filter(Boolean)
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, MAX_WHATSAPP_PROMPT_ENTRIES);

    const normalized = {};
    for (const item of normalizedRows) {
      normalized[item.key] = item;
    }
    return normalized;
  }

  function getWhatsappConversationPromptsMap() {
    return normalizeWhatsappConversationPrompts(panelSettings.whatsappConversationPrompts);
  }

  function findWhatsappConversationPromptEntryByTarget(target) {
    const safeTarget = normalizeWhatsappPromptTarget(target);
    if (!safeTarget.promptKey) {
      return {
        target: safeTarget,
        entry: null,
        key: ''
      };
    }

    const prompts = getWhatsappConversationPromptsMap();
    for (const key of safeTarget.promptKeys) {
      const entry = prompts[key];
      if (!entry || !entry.prompt) {
        continue;
      }

      return {
        target: safeTarget,
        entry,
        key
      };
    }

    const targetMatchTokens = new Set(
      [
        safeTarget.channelId,
        safeTarget.phone,
        safeTarget.chatKey,
        safeTarget.title
      ]
        .map((value) => normalizeWhatsappPromptStoreKey(value))
        .filter(Boolean)
    );

    if (targetMatchTokens.size > 0) {
      for (const [entryKey, entry] of Object.entries(prompts)) {
        const safeEntry = entry && typeof entry === 'object' ? entry : {};
        const prompt = String(safeEntry.prompt || '').trim();
        if (!prompt) {
          continue;
        }
        const entryTokens = [
          safeEntry.channelId,
          safeEntry.phone,
          safeEntry.chatKey,
          safeEntry.title
        ]
          .map((value) => normalizeWhatsappPromptStoreKey(value))
          .filter(Boolean);

        if (!entryTokens.some((token) => targetMatchTokens.has(token))) {
          continue;
        }

        return {
          target: safeTarget,
          entry: safeEntry,
          key: String(entryKey || '').trim()
        };
      }
    }

    return {
      target: safeTarget,
      entry: null,
      key: ''
    };
  }

  function resolveWhatsappConversationPromptForSuggestion(tabContext) {
    const lookup = findWhatsappConversationPromptEntryByTarget(resolveWhatsappPromptTargetForContext(tabContext));
    return String(lookup.entry?.prompt || '')
      .trim()
      .slice(0, MAX_WHATSAPP_PROMPT_CHARS);
  }

  function buildWhatsappSuggestionPromptSignature(basePrompt, chatPrompt) {
    const safeBasePrompt = String(basePrompt || '').trim().slice(0, 3200);
    const safeChatPrompt = String(chatPrompt || '').trim().slice(0, 3200);
    return `${safeBasePrompt.length}:${safeBasePrompt}::${safeChatPrompt.length}:${safeChatPrompt}`;
  }

  function toWhatsappPromptTargetKeySet(target) {
    const safeTarget = normalizeWhatsappPromptTarget(target);
    const keys = safeTarget.promptKeys.length ? safeTarget.promptKeys : [safeTarget.promptKey];
    return new Set(keys.map((item) => normalizeWhatsappPromptStoreKey(item)).filter(Boolean));
  }

  function isWhatsappPromptTargetActiveInTab(target, tabContext) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return false;
    }

    const targetKeys = toWhatsappPromptTargetKeySet(target);
    if (!targetKeys.size) {
      return false;
    }

    const activeTarget = resolveWhatsappPromptTargetForContext(tabContext);
    const activeKeys = toWhatsappPromptTargetKeySet(activeTarget);
    if (!activeKeys.size) {
      return false;
    }

    for (const key of targetKeys) {
      if (activeKeys.has(key)) {
        return true;
      }
    }

    return false;
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

  function splitQualifiedTableName(value) {
    const token = String(value || '').trim();
    if (!token) {
      return { schema: '', table: '', qualifiedName: '' };
    }

    const parts = token.split('.');
    if (parts.length < 2) {
      return { schema: '', table: token, qualifiedName: token };
    }

    const table = String(parts.pop() || '').trim();
    const schema = String(parts.join('.') || '').trim();
    return {
      schema,
      table,
      qualifiedName: schema && table ? `${schema}.${table}` : token
    };
  }

  function findTableByQualifiedName(snapshot, qualifiedName) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    const token = String(qualifiedName || '').trim().toLowerCase();
    if (!safeSnapshot || !token) {
      return null;
    }
    const tables = Array.isArray(safeSnapshot.tables) ? safeSnapshot.tables : [];
    return (
      tables.find((table) => String(table?.qualifiedName || '').trim().toLowerCase() === token) || null
    );
  }

  function normalizeCrmErpMeProfile(rawProfile, snapshot = null) {
    const source = rawProfile && typeof rawProfile === 'object' ? rawProfile : null;
    if (!source) {
      return null;
    }

    const tableQualifiedName = String(
      source.tableQualifiedName || source.table || source.qualifiedTable || ''
    )
      .trim()
      .slice(0, 240);
    const idColumn = String(source.idColumn || source.id_column || source.userIdColumn || '')
      .trim()
      .slice(0, 120);
    const userId = String(source.userId || source.user_id || '')
      .trim()
      .slice(0, 220);

    if (!tableQualifiedName && !idColumn && !userId) {
      return null;
    }

    const normalized = {
      tableQualifiedName,
      idColumn,
      userId
    };

    if (!snapshot) {
      return normalized;
    }

    const table = findTableByQualifiedName(snapshot, normalized.tableQualifiedName);
    if (!table) {
      return normalized;
    }

    const columns = Array.isArray(table.columns) ? table.columns : [];
    const hasStoredIdColumn = columns.some(
      (column) =>
        String(column?.name || '').trim().toLowerCase() ===
        String(normalized.idColumn || '').trim().toLowerCase()
    );
    if (!hasStoredIdColumn) {
      const preferredIdColumn =
        columns.find((column) => column?.isPrimaryKey === true && String(column?.name || '').trim()) ||
        columns.find((column) => isLikelyIdColumnName(column?.name)) ||
        null;
      normalized.idColumn = String(preferredIdColumn?.name || normalized.idColumn || '')
        .trim()
        .slice(0, 120);
    }

    return normalized;
  }

  function normalizeIntegrationPermissionState(value) {
    const token = String(value || '')
      .trim()
      .toLowerCase();
    if (token === 'granted' || token === 'denied' || token === 'prompt') {
      return token;
    }
    return 'prompt';
  }

  function normalizeCustomIntegrationToolEntry(rawTool) {
    const source = rawTool && typeof rawTool === 'object' ? rawTool : {};
    const name = String(source.name || source.id || '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80);
    const endpoint = String(source.endpoint || source.url || '').trim().slice(0, 500);
    if (!name || !endpoint) {
      return null;
    }

    const methodRaw = String(source.method || 'POST').trim().toUpperCase();
    const method = methodRaw === 'GET' || methodRaw === 'PUT' || methodRaw === 'PATCH' || methodRaw === 'DELETE' ? methodRaw : 'POST';
    const description = String(source.description || '')
      .trim()
      .slice(0, 320);
    const headers =
      source.headers && typeof source.headers === 'object' && !Array.isArray(source.headers) ? source.headers : {};
    const inputSchema =
      source.input_schema && typeof source.input_schema === 'object' && !Array.isArray(source.input_schema)
        ? source.input_schema
        : source.inputSchema && typeof source.inputSchema === 'object' && !Array.isArray(source.inputSchema)
          ? source.inputSchema
          : {
              type: 'object',
              properties: {}
            };

    return {
      name,
      description,
      endpoint,
      method,
      headers,
      input_schema: inputSchema
    };
  }

  function normalizeCustomIntegrationTools(rawTools) {
    const source = Array.isArray(rawTools) ? rawTools : [];
    const normalized = [];
    const seen = new Set();

    for (const item of source) {
      const safeTool = normalizeCustomIntegrationToolEntry(item);
      if (!safeTool || seen.has(safeTool.name)) {
        continue;
      }

      seen.add(safeTool.name);
      normalized.push(safeTool);
      if (normalized.length >= 80) {
        break;
      }
    }

    return normalized;
  }

  function normalizeIntegrationsConfig(rawConfig) {
    const defaults = createDefaultIntegrationsConfig();
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const rawSmtp = source.smtp && typeof source.smtp === 'object' ? source.smtp : {};
    const rawMaps = source.maps && typeof source.maps === 'object' ? source.maps : {};
    const rawPermissions = source.permissions && typeof source.permissions === 'object' ? source.permissions : {};
    const rawLocation = rawMaps.lastKnownLocation && typeof rawMaps.lastKnownLocation === 'object' ? rawMaps.lastKnownLocation : null;
    const rawNearbyPlaces = Array.isArray(rawMaps.nearbyPlaces) ? rawMaps.nearbyPlaces : [];

    return {
      smtp: {
        relayUrl: String(rawSmtp.relayUrl || '').trim().slice(0, 500),
        host: String(rawSmtp.host || '').trim().slice(0, 200),
        port: Math.max(1, Math.min(65535, Number(rawSmtp.port) || defaults.smtp.port)),
        secure: ['auto', 'true', 'false'].includes(String(rawSmtp.secure || '').trim()) ? String(rawSmtp.secure || '').trim() : 'auto',
        username: String(rawSmtp.username || '').trim().slice(0, 220),
        password: String(rawSmtp.password || '').trim().slice(0, 220),
        from: String(rawSmtp.from || '').trim().slice(0, 220)
      },
      maps: {
        apiKey: String(rawMaps.apiKey || '').trim().slice(0, 240),
        nearbyType: String(rawMaps.nearbyType || defaults.maps.nearbyType)
          .trim()
          .toLowerCase()
          .slice(0, 60),
        lastKnownLocation:
          rawLocation && Number.isFinite(Number(rawLocation.latitude)) && Number.isFinite(Number(rawLocation.longitude))
            ? {
                latitude: Number(rawLocation.latitude),
                longitude: Number(rawLocation.longitude),
                accuracy: Math.max(0, Number(rawLocation.accuracy) || 0),
                capturedAt: Math.max(0, Number(rawLocation.capturedAt) || Date.now())
              }
            : null,
        nearbyPlaces: rawNearbyPlaces
          .map((item) => {
            const sourceItem = item && typeof item === 'object' ? item : {};
            const name = String(sourceItem.name || '').trim().slice(0, 140);
            const address = String(sourceItem.address || '').trim().slice(0, 220);
            if (!name) {
              return null;
            }
            return {
              name,
              address,
              rating: Number.isFinite(Number(sourceItem.rating)) ? Number(sourceItem.rating) : 0,
              userRatingCount: Math.max(0, Number(sourceItem.userRatingCount) || 0),
              primaryType: String(sourceItem.primaryType || '').trim().slice(0, 80)
            };
          })
          .filter(Boolean)
          .slice(0, 24)
      },
      permissions: {
        microphone: normalizeIntegrationPermissionState(rawPermissions.microphone),
        location: normalizeIntegrationPermissionState(rawPermissions.location)
      },
      customTools: normalizeCustomIntegrationTools(source.customTools)
    };
  }

  function getIntegrationsConfig() {
    return normalizeIntegrationsConfig(panelSettings.integrations);
  }

  function isCrmErpMeProfileComplete(profile) {
    const safe = profile && typeof profile === 'object' ? profile : null;
    return Boolean(
      safe &&
        String(safe.tableQualifiedName || '').trim() &&
        String(safe.idColumn || '').trim() &&
        String(safe.userId || '').trim()
    );
  }

  function getCrmErpDatabaseConnectionUrl() {
    return postgresService.normalizeConnectionUrl(panelSettings.crmErpDatabaseUrl || '');
  }

  function getCrmErpDatabaseSchemaSnapshot() {
    return normalizeCrmErpDatabaseSnapshot(panelSettings.crmErpDatabaseSchemaSnapshot);
  }

  function getCrmErpDatabaseMeProfile() {
    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    return normalizeCrmErpMeProfile(panelSettings.crmErpDatabaseMeProfile, snapshot);
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

  function setSelectOptions(select, options = [], selectedValue = '') {
    if (!select) {
      return '';
    }

    const entries = Array.isArray(options) ? options : [];
    select.textContent = '';
    for (const optionModel of entries) {
      const option = document.createElement('option');
      option.value = String(optionModel?.value || '');
      option.textContent = String(optionModel?.label || option.value || 'N/A');
      select.appendChild(option);
    }

    const preferred = String(selectedValue || '').trim();
    if (preferred && entries.some((item) => String(item?.value || '').trim() === preferred)) {
      select.value = preferred;
      return preferred;
    }

    const fallback = String(entries[0]?.value || '').trim();
    select.value = fallback;
    return fallback;
  }

  function isLikelyUserTableName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(user|owner|employee|staff|agent|seller|sales|advisor|member|assignee|representative)/.test(
      token
    );
  }

  function buildCrmErpMeTableOptions(snapshot, currentQualifiedName = '') {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
    const output = [];
    const currentToken = String(currentQualifiedName || '').trim().toLowerCase();

    for (const table of tables) {
      const qualifiedName = String(table?.qualifiedName || '').trim();
      if (!qualifiedName) {
        continue;
      }

      const columns = Array.isArray(table?.columns) ? table.columns : [];
      const hasId = columns.some((column) => isLikelyIdColumnName(column?.name) || column?.isPrimaryKey === true);
      if (!hasId) {
        continue;
      }

      let score = 0;
      if (isLikelyUserTableName(table?.name)) {
        score += 36;
      }
      if (columns.some((column) => isEmailColumnName(column?.name))) {
        score += 10;
      }
      if (columns.some((column) => isLabelColumnName(column?.name))) {
        score += 8;
      }
      if (columns.some((column) => column?.isPrimaryKey === true)) {
        score += 8;
      }
      if (String(qualifiedName).toLowerCase() === currentToken) {
        score += 25;
      }
      if (score <= 0) {
        continue;
      }

      output.push({
        value: qualifiedName,
        label: qualifiedName,
        score
      });
    }

    output.sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
    return output.slice(0, 80).map((item) => ({ value: item.value, label: item.label }));
  }

  function buildCrmErpMeIdColumnOptions(snapshot, tableQualifiedName = '') {
    const table = findTableByQualifiedName(snapshot, tableQualifiedName);
    if (!table) {
      return [];
    }

    const columns = Array.isArray(table.columns) ? table.columns : [];
    const idColumns = columns.filter((column) => column?.isPrimaryKey === true || isLikelyIdColumnName(column?.name));
    const preferred = idColumns.length ? idColumns : columns.slice(0, 30);
    return preferred
      .map((column) => {
        const name = String(column?.name || '').trim();
        if (!name) {
          return null;
        }
        return {
          value: name,
          label: name
        };
      })
      .filter(Boolean)
      .slice(0, 40);
  }

  function syncCrmErpMeIdColumnOptions(options = {}) {
    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    const selectedTable = String(
      options.tableQualifiedName || settingsCrmErpMeTableSelect?.value || ''
    ).trim();
    const selectedIdColumn = String(
      options.selectedIdColumn || settingsCrmErpMeIdColumnSelect?.value || ''
    ).trim();
    const idOptions = buildCrmErpMeIdColumnOptions(snapshot, selectedTable);
    return setSelectOptions(settingsCrmErpMeIdColumnSelect, idOptions, selectedIdColumn);
  }

  function renderCrmErpMeProfileSettings(options = {}) {
    const syncInput = options.syncInput !== false;
    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    const connectionUrl = getCrmErpDatabaseConnectionUrl();
    const profile = getCrmErpDatabaseMeProfile();
    const profileTable = String(profile?.tableQualifiedName || '').trim();
    const profileIdColumn = String(profile?.idColumn || '').trim();
    const profileUserId = String(profile?.userId || '').trim();
    const hasSchema = Boolean(snapshot);
    const hasDb = Boolean(connectionUrl);

    const tableOptions = buildCrmErpMeTableOptions(snapshot, profileTable);
    const selectedTable = setSelectOptions(settingsCrmErpMeTableSelect, tableOptions, profileTable);
    const selectedIdColumn = syncCrmErpMeIdColumnOptions({
      tableQualifiedName: selectedTable,
      selectedIdColumn: profileIdColumn
    });

    if (syncInput && settingsCrmErpMeUserIdInput) {
      settingsCrmErpMeUserIdInput.value = profileUserId;
    }

    const disabled = !hasDb || !hasSchema;
    if (settingsCrmErpMeTableSelect) {
      settingsCrmErpMeTableSelect.disabled = disabled || tableOptions.length === 0;
    }
    if (settingsCrmErpMeIdColumnSelect) {
      settingsCrmErpMeIdColumnSelect.disabled = disabled || !selectedIdColumn;
    }
    if (settingsCrmErpMeUserIdInput) {
      settingsCrmErpMeUserIdInput.disabled = disabled;
    }
    if (settingsCrmErpMeClearBtn) {
      settingsCrmErpMeClearBtn.disabled = !hasDb;
    }
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

    renderCrmErpMeProfileSettings({
      syncInput: options.syncProfileInput !== false
    });
  }

  function buildLocationMetaText(location, nearbyPlaces = []) {
    const safeLocation = location && typeof location === 'object' ? location : null;
    if (!safeLocation) {
      return 'Ubicacion: no disponible.';
    }

    const latitude = Number(safeLocation.latitude);
    const longitude = Number(safeLocation.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return 'Ubicacion: no disponible.';
    }

    const accuracy = Math.max(0, Number(safeLocation.accuracy) || 0);
    const capturedAt = formatDateTime(Number(safeLocation.capturedAt) || 0);
    const places = (Array.isArray(nearbyPlaces) ? nearbyPlaces : [])
      .slice(0, 4)
      .map((item) => String(item?.name || '').trim())
      .filter(Boolean);
    const placesToken = places.length ? ` | nearby: ${places.join(', ')}` : '';
    const accuracyToken = accuracy > 0 ? ` ±${Math.round(accuracy)}m` : '';
    const timeToken = capturedAt ? ` @ ${capturedAt}` : '';

    return `Ubicacion: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}${accuracyToken}${timeToken}${placesToken}`;
  }

  function buildRuntimeLocationContextPayload(integrations, options = {}) {
    const safeIntegrations = normalizeIntegrationsConfig(integrations);
    const maps = safeIntegrations.maps || {};
    const permissions = safeIntegrations.permissions || {};
    const storedLocation = maps.lastKnownLocation && typeof maps.lastKnownLocation === 'object' ? maps.lastKnownLocation : null;
    const latitude = Number(storedLocation?.latitude);
    const longitude = Number(storedLocation?.longitude);
    const location =
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? {
            latitude,
            longitude,
            accuracy: Math.max(0, Number(storedLocation?.accuracy) || 0),
            capturedAt: Math.max(0, Number(storedLocation?.capturedAt) || 0)
          }
        : null;
    const nearbyPlaces = (Array.isArray(maps.nearbyPlaces) ? maps.nearbyPlaces : [])
      .slice(0, 10)
      .map((item) => {
        const entry = item && typeof item === 'object' ? item : {};
        const name = String(entry.name || '').trim().slice(0, 140);
        if (!name) {
          return null;
        }
        return {
          name,
          address: String(entry.address || '').trim().slice(0, 220),
          rating: Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : 0,
          userRatingCount: Math.max(0, Number(entry.userRatingCount) || 0),
          primaryType: String(entry.primaryType || '').trim().slice(0, 80)
        };
      })
      .filter(Boolean);

    return {
      reason: String(options.reason || 'panel_sync').trim().slice(0, 80),
      updatedAt: Date.now(),
      permissions: {
        microphone: normalizeIntegrationPermissionState(permissions.microphone),
        location: normalizeIntegrationPermissionState(permissions.location)
      },
      maps: {
        hasApiKey: Boolean(String(maps.apiKey || '').trim()),
        nearbyType: String(maps.nearbyType || 'restaurant').trim().slice(0, 40)
      },
      location,
      nearbyPlaces
    };
  }

  function syncLocationContextToBackground(integrations, options = {}) {
    if (!chrome?.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return false;
    }

    const payload = buildRuntimeLocationContextPayload(integrations, options);
    try {
      chrome.runtime.sendMessage(
        {
          type: BACKGROUND_RUNTIME_CONTEXT_UPDATE_TYPE,
          payload
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function parseCustomToolsSchemaText(rawText) {
    const source = String(rawText || '').trim();
    if (!source) {
      return {
        ok: true,
        tools: []
      };
    }

    try {
      const parsed = JSON.parse(source);
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          error: 'El schema de tools debe ser un array JSON.'
        };
      }

      return {
        ok: true,
        tools: normalizeCustomIntegrationTools(parsed)
      };
    } catch (_) {
      return {
        ok: false,
        error: 'JSON invalido en Custom Tools Schema.'
      };
    }
  }

  function buildCustomToolsSchemaText(tools) {
    const safeTools = normalizeCustomIntegrationTools(tools);
    if (!safeTools.length) {
      return '[]';
    }

    return JSON.stringify(safeTools, null, 2);
  }

  function renderAppsIntegrationsSettings(options = {}) {
    const syncInput = options.syncInput !== false;
    const integrations = getIntegrationsConfig();
    const smtp = integrations.smtp || {};
    const maps = integrations.maps || {};

    if (syncInput) {
      if (settingsSmtpRelayUrlInput) {
        settingsSmtpRelayUrlInput.value = String(smtp.relayUrl || '');
      }
      if (settingsSmtpHostInput) {
        settingsSmtpHostInput.value = String(smtp.host || '');
      }
      if (settingsSmtpPortInput) {
        settingsSmtpPortInput.value = String(smtp.port || 587);
      }
      if (settingsSmtpSecureSelect) {
        settingsSmtpSecureSelect.value = ['auto', 'true', 'false'].includes(String(smtp.secure || ''))
          ? String(smtp.secure || 'auto')
          : 'auto';
      }
      if (settingsSmtpUsernameInput) {
        settingsSmtpUsernameInput.value = String(smtp.username || '');
      }
      if (settingsSmtpPasswordInput) {
        settingsSmtpPasswordInput.value = String(smtp.password || '');
      }
      if (settingsSmtpFromInput) {
        settingsSmtpFromInput.value = String(smtp.from || '');
      }
      if (settingsMapsApiKeyInput) {
        settingsMapsApiKeyInput.value = String(maps.apiKey || '');
      }
      if (settingsMapsNearbyTypeSelect) {
        settingsMapsNearbyTypeSelect.value = String(maps.nearbyType || 'restaurant') || 'restaurant';
      }
      if (settingsCustomToolsSchemaInput) {
        settingsCustomToolsSchemaInput.value = buildCustomToolsSchemaText(integrations.customTools);
      }
    }

    if (settingsLocationMeta) {
      settingsLocationMeta.textContent = buildLocationMetaText(maps.lastKnownLocation, maps.nearbyPlaces);
    }
  }

  function collectAppsIntegrationsSettingsFromScreen() {
    const parsedTools = parseCustomToolsSchemaText(settingsCustomToolsSchemaInput?.value || '');
    if (!parsedTools.ok) {
      return {
        ok: false,
        error: parsedTools.error || 'Custom tools invalidos.'
      };
    }

    const nextIntegrations = normalizeIntegrationsConfig({
      ...getIntegrationsConfig(),
      smtp: {
        relayUrl: String(settingsSmtpRelayUrlInput?.value || ''),
        host: String(settingsSmtpHostInput?.value || ''),
        port: Number(settingsSmtpPortInput?.value || 587),
        secure: String(settingsSmtpSecureSelect?.value || 'auto'),
        username: String(settingsSmtpUsernameInput?.value || ''),
        password: String(settingsSmtpPasswordInput?.value || ''),
        from: String(settingsSmtpFromInput?.value || '')
      },
      maps: {
        ...getIntegrationsConfig().maps,
        apiKey: String(settingsMapsApiKeyInput?.value || ''),
        nearbyType: String(settingsMapsNearbyTypeSelect?.value || 'restaurant')
      },
      customTools: parsedTools.tools
    });

    return {
      ok: true,
      integrations: nextIntegrations
    };
  }

  async function saveAppsIntegrationsFromScreen(options = {}) {
    const autosave = options.autosave === true;
    const parsed = collectAppsIntegrationsSettingsFromScreen();
    if (!parsed.ok) {
      setStatus(settingsIntegrationsStatus, parsed.error || 'No se pudieron validar integraciones.', true);
      return false;
    }

    const ok = await savePanelSettings({
      integrations: parsed.integrations
    });
    if (!ok) {
      setStatus(settingsIntegrationsStatus, 'No se pudieron guardar integraciones.', true);
      return false;
    }

    if (!autosave) {
      renderAppsIntegrationsSettings({ syncInput: false });
    }
    setStatus(settingsIntegrationsStatus, autosave ? 'Integraciones guardadas (auto).' : 'Integraciones guardadas.');
    return true;
  }

  async function fetchNearbyPlacesForLocation(location, options = {}) {
    const safeLocation = location && typeof location === 'object' ? location : null;
    const latitude = Number(safeLocation?.latitude);
    const longitude = Number(safeLocation?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('No hay coordenadas validas para buscar lugares cercanos.');
    }

    const integrations = getIntegrationsConfig();
    const mapsApiKey = String(integrations.maps?.apiKey || '').trim();
    if (!mapsApiKey) {
      throw new Error('Configura Maps API Key para consultar lugares cercanos.');
    }

    const nearbyType = String(options.nearbyType || integrations.maps?.nearbyType || 'restaurant')
      .trim()
      .toLowerCase();
    const radiusMeters = Math.max(100, Math.min(50000, Number(options.radiusMeters) || 1500));
    const maxResultCount = Math.max(1, Math.min(20, Number(options.maxResultCount) || 6));

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsApiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryType'
      },
      body: JSON.stringify({
        includedTypes: [nearbyType],
        maxResultCount,
        locationRestriction: {
          circle: {
            center: {
              latitude,
              longitude
            },
            radius: radiusMeters
          }
        }
      })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const errorText = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`).trim();
      throw new Error(`Maps error: ${errorText}`);
    }

    const places = (Array.isArray(payload?.places) ? payload.places : [])
      .map((item) => {
        const name = String(item?.displayName?.text || '').trim().slice(0, 140);
        if (!name) {
          return null;
        }
        return {
          name,
          address: String(item?.formattedAddress || '').trim().slice(0, 220),
          rating: Number.isFinite(Number(item?.rating)) ? Number(item.rating) : 0,
          userRatingCount: Math.max(0, Number(item?.userRatingCount) || 0),
          primaryType: String(item?.primaryType || '').trim().slice(0, 80)
        };
      })
      .filter(Boolean)
      .slice(0, maxResultCount);

    return places;
  }

  async function requestLocationPermissionAndSync(options = {}) {
    if (!navigator.geolocation) {
      setStatus(settingsIntegrationsStatus, 'Geolocalizacion no soportada en este navegador.', true);
      return false;
    }

    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (value) => resolve(value),
        (error) => reject(error),
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: 12000
        }
      );
    });

    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('No se pudo obtener coordenadas validas.');
    }

    const nextLocation = {
      latitude,
      longitude,
      accuracy: Math.max(0, Number(position?.coords?.accuracy) || 0),
      capturedAt: Date.now()
    };
    const integrations = getIntegrationsConfig();
    let nearbyPlaces = integrations.maps?.nearbyPlaces || [];

    if (options.refreshNearby === true) {
      try {
        nearbyPlaces = await fetchNearbyPlacesForLocation(nextLocation, {
          nearbyType: integrations.maps?.nearbyType || 'restaurant'
        });
      } catch (error) {
        setStatus(settingsIntegrationsStatus, error instanceof Error ? error.message : 'No se pudo actualizar nearby places.', true);
      }
    }

    const nextIntegrations = normalizeIntegrationsConfig({
      ...integrations,
      maps: {
        ...integrations.maps,
        lastKnownLocation: nextLocation,
        nearbyPlaces
      },
      permissions: {
        ...integrations.permissions,
        location: 'granted'
      }
    });

    const ok = await savePanelSettings({ integrations: nextIntegrations });
    if (!ok) {
      throw new Error('No se pudo guardar ubicacion.');
    }

    renderAppsIntegrationsSettings({ syncInput: false });
    setStatus(settingsIntegrationsStatus, 'Ubicacion actualizada.');
    return true;
  }

  async function requestMicrophonePermissionAndSync() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStatus(settingsIntegrationsStatus, 'Microfono no soportado en este navegador.', true);
      return false;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      const tracks = Array.isArray(stream?.getTracks?.()) ? stream.getTracks() : [];
      for (const track of tracks) {
        track.stop();
      }
    } catch (_) {
      // Ignore cleanup issues.
    }

    const integrations = getIntegrationsConfig();
    const nextIntegrations = normalizeIntegrationsConfig({
      ...integrations,
      permissions: {
        ...integrations.permissions,
        microphone: 'granted'
      }
    });

    const ok = await savePanelSettings({ integrations: nextIntegrations });
    if (!ok) {
      throw new Error('No se pudo guardar estado de microfono.');
    }

    renderAppsIntegrationsSettings({ syncInput: false });
    setStatus(settingsIntegrationsStatus, 'Permiso de microfono concedido.');
    return true;
  }

  async function refreshNearbyPlacesFromStoredLocation() {
    const integrations = getIntegrationsConfig();
    const location = resolveLocationFromArgs({});
    if (!location) {
      throw new Error('No hay ubicacion guardada. Usa "Pedir ubicacion".');
    }

    const places = await fetchNearbyPlacesForLocation(location, {
      nearbyType: integrations.maps?.nearbyType || 'restaurant'
    });
    const nextIntegrations = normalizeIntegrationsConfig({
      ...integrations,
      maps: {
        ...integrations.maps,
        lastKnownLocation: {
          ...(integrations.maps?.lastKnownLocation || {}),
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          capturedAt: Date.now()
        },
        nearbyPlaces: places
      }
    });

    const ok = await savePanelSettings({ integrations: nextIntegrations });
    if (!ok) {
      throw new Error('No se pudieron guardar nearby places.');
    }

    renderAppsIntegrationsSettings({ syncInput: false });
    return places;
  }

  function getWhatsappPromptTargetLabel(target) {
    const safeTarget = normalizeWhatsappPromptTarget(target);
    if (!safeTarget.promptKey) {
      return 'Chat objetivo: ninguno seleccionado.';
    }

    const typeLabel = safeTarget.isGroup ? 'Grupo' : safeTarget.type === 'direct' ? 'Chat' : 'Chat';
    const label = safeTarget.label || safeTarget.title || safeTarget.phone || safeTarget.chatKey || safeTarget.promptKey;
    return `${typeLabel}: ${label}`;
  }

  function isAssistantSettingsPageVisible() {
    const currentScreen = String(app?.dataset?.screen || '').trim();
    if (currentScreen !== 'settings') {
      return false;
    }

    const currentSettingsPage = normalizeSettingsPage(settingsShell?.dataset?.settingsPage || SETTINGS_PAGES.HOME);
    return currentSettingsPage === SETTINGS_PAGES.ASSISTANT;
  }

  function clearWhatsappPromptAutosaveTimer() {
    if (whatsappPromptAutosaveTimer) {
      window.clearTimeout(whatsappPromptAutosaveTimer);
      whatsappPromptAutosaveTimer = 0;
    }
  }

  function setWhatsappPromptEditorTarget(target, options = {}) {
    const safeTarget = normalizeWhatsappPromptTarget(target);
    const hasTarget = Boolean(safeTarget.promptKey);
    whatsappPromptEditorTarget = hasTarget ? safeTarget : null;

    const lookup = hasTarget ? findWhatsappConversationPromptEntryByTarget(safeTarget) : null;
    const savedPrompt = String(lookup?.entry?.prompt || '')
      .trim()
      .slice(0, MAX_WHATSAPP_PROMPT_CHARS);
    const shouldKeepInput = options.keepInput === true;

    if (settingsWhatsappPromptChatLabel) {
      settingsWhatsappPromptChatLabel.textContent = getWhatsappPromptTargetLabel(safeTarget);
    }

    if (settingsWhatsappPromptChatKey) {
      settingsWhatsappPromptChatKey.textContent = hasTarget ? `Key: ${safeTarget.promptKey}` : 'Key: -';
    }

    if (settingsWhatsappPromptInput) {
      if (!shouldKeepInput) {
        settingsWhatsappPromptInput.value = savedPrompt;
      }
      settingsWhatsappPromptInput.disabled = !hasTarget;
    }

    if (settingsWhatsappPromptClearBtn) {
      settingsWhatsappPromptClearBtn.disabled = !hasTarget;
    }

    if (options.clearStatus !== false) {
      setStatus(settingsWhatsappPromptStatus, '');
    }
  }

  function hydrateWhatsappPromptEditorFromActiveChat(options = {}) {
    const previousTarget = normalizeWhatsappPromptTarget(whatsappPromptEditorTarget);
    const previousKey = previousTarget.promptKey;
    const whatsappTab = getPreferredWhatsappTab();
    const target = resolveWhatsappPromptTargetForContext(whatsappTab);
    const currentKey = target.promptKey;
    const sameTarget = Boolean(previousKey && currentKey && previousKey === currentKey);
    const keepCurrentTarget = options.keepCurrentTarget === true && sameTarget;
    const nextTarget = keepCurrentTarget ? previousTarget : target;

    const keepInput = options.keepInput === true || sameTarget;
    setWhatsappPromptEditorTarget(nextTarget, {
      keepInput,
      clearStatus: options.clearStatus
    });

    if (!currentKey && options.silentNoTarget !== true) {
      setStatus(settingsWhatsappPromptStatus, 'Abre un chat de WhatsApp para editar su prompt.', true);
    }

    if (options.announceChange === true && previousKey && currentKey && previousKey !== currentKey) {
      const label = String(target.label || target.title || target.phone || target.chatKey || currentKey)
        .trim()
        .slice(0, 160);
      setStatus(settingsWhatsappPromptStatus, `Chat activo detectado: ${label}.`);
    }

    return target;
  }

  async function persistWhatsappPromptForTarget(target, promptText, options = {}) {
    const safeTarget = normalizeWhatsappPromptTarget(target);
    const safePrompt = String(promptText || '')
      .trim()
      .slice(0, MAX_WHATSAPP_PROMPT_CHARS);

    if (!safeTarget.promptKey) {
      return {
        ok: false,
        error: 'missing_chat_target',
        action: 'none'
      };
    }
    const nextPrompts = getWhatsappConversationPromptsMap();
    const targetKeys = safeTarget.promptKeys.length ? safeTarget.promptKeys : [safeTarget.promptKey];
    for (const key of targetKeys) {
      delete nextPrompts[normalizeWhatsappPromptStoreKey(key)];
    }

    let action = 'cleared';
    if (safePrompt) {
      nextPrompts[safeTarget.promptKey] = {
        key: safeTarget.promptKey,
        prompt: safePrompt,
        label: String(safeTarget.label || '').trim().slice(0, 180),
        type: safeTarget.type,
        isGroup: safeTarget.isGroup === true,
        channelId: String(safeTarget.channelId || '').trim().slice(0, 220),
        chatKey: String(safeTarget.chatKey || '').trim().slice(0, 220),
        title: String(safeTarget.title || '').trim().slice(0, 180),
        phone: String(safeTarget.phone || '').trim().slice(0, 80),
        updatedAt: Date.now()
      };
      action = 'saved';
    }

    const ok = await savePanelSettings({
      whatsappConversationPrompts: nextPrompts
    });
    if (!ok) {
      return {
        ok: false,
        error: 'save_failed',
        action
      };
    }

    const editorKey = normalizeWhatsappPromptStoreKey(whatsappPromptEditorTarget?.promptKey || '');
    if (editorKey && editorKey === safeTarget.promptKey) {
      setWhatsappPromptEditorTarget(safeTarget, {
        keepInput: true,
        clearStatus: false
      });

      if (options.syncInputValue === true && settingsWhatsappPromptInput) {
        settingsWhatsappPromptInput.value = safePrompt;
      }
    }

    if (options.updateChatStatus === true) {
      if (action === 'saved') {
        setStatus(chatStatus, 'Prompt WhatsApp por chat actualizado.');
      } else {
        setStatus(chatStatus, 'Prompt WhatsApp del chat limpiado.');
      }
    }

    if (options.refreshSuggestion !== false) {
      const activeWhatsappTab = getPreferredWhatsappTab();
      if (isWhatsappPromptTargetActiveInTab(safeTarget, activeWhatsappTab)) {
        void generateWhatsappSuggestion(activeWhatsappTab, { force: true });
      }
    }

    return {
      ok: true,
      action,
      prompt: safePrompt,
      target: safeTarget
    };
  }

  function scheduleWhatsappPromptAutosave(options = {}) {
    const target =
      whatsappPromptEditorTarget && whatsappPromptEditorTarget.promptKey
        ? normalizeWhatsappPromptTarget(whatsappPromptEditorTarget)
        : resolveWhatsappPromptTargetForContext(getPreferredWhatsappTab());

    if (!target.promptKey) {
      setStatus(settingsWhatsappPromptStatus, 'No hay chat activo de WhatsApp para guardar prompt.', true);
      return;
    }

    if (!settingsWhatsappPromptInput) {
      return;
    }

    const draftPrompt = String(settingsWhatsappPromptInput.value || '').slice(0, MAX_WHATSAPP_PROMPT_CHARS);
    if (draftPrompt !== settingsWhatsappPromptInput.value) {
      settingsWhatsappPromptInput.value = draftPrompt;
    }

    const targetLabel = String(target.label || target.title || target.phone || target.chatKey || target.promptKey)
      .trim()
      .slice(0, 100);

    clearWhatsappPromptAutosaveTimer();
    const token = ++whatsappPromptAutosaveToken;
    setStatus(settingsWhatsappPromptStatus, `Guardado en vivo pendiente (${targetLabel || 'chat activo'})...`);

    whatsappPromptAutosaveTimer = window.setTimeout(async () => {
      whatsappPromptAutosaveTimer = 0;
      setStatus(settingsWhatsappPromptStatus, 'Guardando prompt...', false, { loading: true });

      const result = await persistWhatsappPromptForTarget(target, draftPrompt, {
        syncInputValue: true,
        updateChatStatus: false
      });

      if (token !== whatsappPromptAutosaveToken) {
        return;
      }

      if (!result.ok) {
        setStatus(settingsWhatsappPromptStatus, 'No se pudo guardar el prompt del chat.', true);
        return;
      }

      if (result.action === 'saved') {
        setStatus(settingsWhatsappPromptStatus, `Prompt guardado automaticamente (${targetLabel || 'chat activo'}).`);
      } else {
        setStatus(settingsWhatsappPromptStatus, `Prompt eliminado automaticamente (${targetLabel || 'chat activo'}).`);
      }
    }, Math.max(120, Number(options.delayMs) || 420));
  }

  async function clearWhatsappPromptForSelectedChat() {
    clearWhatsappPromptAutosaveTimer();
    whatsappPromptAutosaveToken += 1;

    const target =
      whatsappPromptEditorTarget && whatsappPromptEditorTarget.promptKey
        ? normalizeWhatsappPromptTarget(whatsappPromptEditorTarget)
        : hydrateWhatsappPromptEditorFromActiveChat({
            keepCurrentTarget: false,
            clearStatus: false,
            silentNoTarget: true
          });

    if (!target.promptKey) {
      setStatus(settingsWhatsappPromptStatus, 'No hay chat activo de WhatsApp para limpiar prompt.', true);
      return false;
    }

    const result = await persistWhatsappPromptForTarget(target, '', {
      syncInputValue: true,
      updateChatStatus: false
    });
    if (!result.ok) {
      setStatus(settingsWhatsappPromptStatus, 'No se pudo limpiar el prompt del chat.', true);
      return false;
    }

    if (settingsWhatsappPromptInput) {
      settingsWhatsappPromptInput.value = '';
    }

    setWhatsappPromptEditorTarget(target, {
      keepInput: true,
      clearStatus: false
    });
    setStatus(settingsWhatsappPromptStatus, 'Prompt del chat eliminado.');
    setStatus(chatStatus, 'Prompt WhatsApp del chat limpiado.');
    return true;
  }

  async function saveCrmErpMeProfileFromScreen() {
    const connectionUrl = getCrmErpDatabaseConnectionUrl();
    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    if (!connectionUrl || !snapshot) {
      setStatus(settingsCrmErpMeStatus, 'Analiza primero el esquema para configurar tu user DB.', true);
      return false;
    }

    const tableQualifiedName = String(settingsCrmErpMeTableSelect?.value || '').trim();
    const idColumn = String(settingsCrmErpMeIdColumnSelect?.value || '').trim();
    const userId = String(settingsCrmErpMeUserIdInput?.value || '').trim();

    if (!tableQualifiedName || !idColumn || !userId) {
      setStatus(settingsCrmErpMeStatus, 'Selecciona tabla, columna ID y tu user ID.', true);
      return false;
    }

    const table = findTableByQualifiedName(snapshot, tableQualifiedName);
    if (!table) {
      setStatus(settingsCrmErpMeStatus, 'La tabla seleccionada ya no existe en el esquema.', true);
      return false;
    }
    const hasIdColumn = (Array.isArray(table.columns) ? table.columns : []).some(
      (column) => String(column?.name || '').trim().toLowerCase() === idColumn.toLowerCase()
    );
    if (!hasIdColumn) {
      setStatus(settingsCrmErpMeStatus, 'La columna ID seleccionada no existe en esa tabla.', true);
      return false;
    }

    const profile = normalizeCrmErpMeProfile(
      {
        tableQualifiedName,
        idColumn,
        userId
      },
      snapshot
    );

    const ok = await savePanelSettings({
      crmErpDatabaseMeProfile: profile
    });
    if (!ok) {
      setStatus(settingsCrmErpMeStatus, 'No se pudo guardar tu perfil DB.', true);
      return false;
    }

    renderCrmErpDatabaseSettings({ syncInput: false, syncProfileInput: true });
    setStatus(settingsCrmErpMeStatus, 'Perfil DB guardado.');
    void refreshDynamicRelationsContext(getActiveTabContext(), dynamicContextSignals, { force: true });
    return true;
  }

  async function clearCrmErpMeProfileFromScreen() {
    const ok = await savePanelSettings({
      crmErpDatabaseMeProfile: null
    });
    if (!ok) {
      setStatus(settingsCrmErpMeStatus, 'No se pudo limpiar el perfil DB.', true);
      return false;
    }

    renderCrmErpDatabaseSettings({ syncInput: false, syncProfileInput: true });
    setStatus(settingsCrmErpMeStatus, 'Perfil DB limpiado.');
    void refreshDynamicRelationsContext(getActiveTabContext(), dynamicContextSignals, { force: true });
    return true;
  }

  async function saveCrmErpDatabaseSettingsFromScreen(options = {}) {
    const analyzeAfterSave = options.analyzeAfterSave === true;
    const inputValue = String(settingsCrmErpDbUrlInput?.value || '').trim();

    if (!inputValue) {
      const ok = await savePanelSettings({
        crmErpDatabaseUrl: '',
        crmErpDatabaseSchemaSnapshot: null,
        crmErpDatabaseMeProfile: null
      });

      if (!ok) {
        setStatus(settingsCrmErpDbStatus, 'No se pudo limpiar la configuracion de base de datos.', true);
        return false;
      }

      renderCrmErpDatabaseSettings({ syncInput: true });
      setStatus(settingsCrmErpDbStatus, 'Integracion CRM/ERP desactivada.');
      setStatus(settingsCrmErpMeStatus, '');
      void refreshDynamicRelationsContext(getActiveTabContext(), dynamicContextSignals, { force: true });
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
      patch.crmErpDatabaseMeProfile = null;
    }

    const ok = await savePanelSettings(patch);
    if (!ok) {
      setStatus(settingsCrmErpDbStatus, 'No se pudo guardar la URL de PostgreSQL.', true);
      return false;
    }

    renderCrmErpDatabaseSettings({ syncInput: true });
    setStatus(settingsCrmErpDbStatus, 'URL guardada.');
    if (hasConnectionChanged) {
      setStatus(settingsCrmErpMeStatus, 'Perfil DB limpiado por cambio de conexion.');
    }
    void refreshDynamicRelationsContext(getActiveTabContext(), dynamicContextSignals, { force: true });

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
      void refreshDynamicRelationsContext(getActiveTabContext(), dynamicContextSignals, { force: true });

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
        whatsappChats: Math.max(0, Number(sourceCounts.whatsappChats) || 0),
        whatsappMessages: Math.max(0, Number(sourceCounts.whatsappMessages) || 0),
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

  function extractEmotionFromText(text) {
    return brandEmotionController.extractEmotionFromText(text);
  }

  function stripEmotionTag(text) {
    return brandEmotionController.stripEmotionTag(text);
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

  function startRandomEmotionCycle(options = {}) {
    brandEmotionController.startRandomCycle(options);
  }

  function stopRandomEmotionCycle() {
    brandEmotionController.stopRandomCycle();
  }

  function setBrandEmotion(emotionName, options = {}) {
    brandEmotionController.setEmotion(emotionName, options);
  }

  function blinkBrandEmotion(options = {}) {
    return brandEmotionController.blink(options);
  }

  function startRandomBlinkCycle(options = {}) {
    brandEmotionController.startBlinkCycle(options);
  }

  function setBrandEmotionLookVector(normalizedX, normalizedY, options = {}) {
    brandEmotionController.setLookVector(normalizedX, normalizedY, options);
  }

  function resetBrandEmotionLookVector(options = {}) {
    brandEmotionController.resetLookVector(options);
  }

  function extractEmotionFromAssistantMessage(message) {
    return brandEmotionController.extractEmotionFromAssistantMessage(message);
  }

  async function hydrateBrandEmotions() {
    await brandEmotionController.hydrate();
    startRandomBlinkCycle({ immediate: false });
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
      stageTrack.style.setProperty('--stage-index', String(SCREEN_INDEX[safeScreen]));
      stageTrack.style.setProperty('--stage-count', String(STAGE_SCREEN_COUNT));
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

  function scheduleStageStabilization(screenName = '') {
    const fromDom = app && app.dataset ? app.dataset.screen : '';
    const safeScreen = Object.prototype.hasOwnProperty.call(SCREEN_INDEX, screenName)
      ? screenName
      : Object.prototype.hasOwnProperty.call(SCREEN_INDEX, fromDom)
        ? fromDom
        : 'onboarding';

    realignStageToScreen(safeScreen);

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        realignStageToScreen(safeScreen);
        requestAnimationFrame(() => {
          realignStageToScreen(safeScreen);
        });
      });
    }

    window.setTimeout(() => {
      realignStageToScreen(safeScreen);
    }, 120);
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
      realignStageToScreen(current || 'onboarding');
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
    renderAppsIntegrationsSettings({ syncInput: true });
    renderSystemVariables();
    hydrateWhatsappPromptEditorFromActiveChat({
      keepCurrentTarget: false,
      clearStatus: true,
      silentNoTarget: true
    });
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
    next.assistantName = normalizeAssistantDisplayName(next.assistantName) || DEFAULT_ASSISTANT_DISPLAY_NAME;
    next.securityConfig = pinCryptoService.isConfigured(next.securityConfig) ? next.securityConfig : null;
    next.systemVariables = normalizeSystemVariables(next.systemVariables);
    next.crmErpDatabaseUrl = postgresService.normalizeConnectionUrl(next.crmErpDatabaseUrl || '');
    next.crmErpDatabaseSchemaSnapshot = normalizeCrmErpDatabaseSnapshot(next.crmErpDatabaseSchemaSnapshot);
    next.crmErpDatabaseMeProfile = normalizeCrmErpMeProfile(
      next.crmErpDatabaseMeProfile,
      next.crmErpDatabaseSchemaSnapshot
    );
    next.whatsappConversationPrompts = normalizeWhatsappConversationPrompts(next.whatsappConversationPrompts);
    next.integrations = normalizeIntegrationsConfig(next.integrations);
    return next;
  }

  function normalizeSettingsPage(value) {
    const page = String(value || '').trim();
    return Object.values(SETTINGS_PAGES).includes(page) ? page : SETTINGS_PAGES.HOME;
  }

  function getSettingsPageTitle(page) {
    const safePage = normalizeSettingsPage(page);
    return SETTINGS_PAGE_TITLES[safePage] || SETTINGS_PAGE_TITLES[SETTINGS_PAGES.HOME];
  }

  function getCurrentSettingsPage() {
    return normalizeSettingsPage(settingsShell?.dataset?.settingsPage || SETTINGS_PAGES.HOME);
  }

  function syncSettingsHeaderState(page) {
    const safePage = normalizeSettingsPage(page);
    const isHomePage = safePage === SETTINGS_PAGES.HOME;
    const title = isHomePage ? SETTINGS_PAGE_TITLES[SETTINGS_PAGES.HOME] : `Settings / ${getSettingsPageTitle(safePage)}`;

    if (settingsTitle) {
      settingsTitle.textContent = title;
    }

    if (closeSettingsBtn) {
      closeSettingsBtn.setAttribute('aria-label', isHomePage ? 'Volver al chat' : 'Volver a Settings');
      closeSettingsBtn.setAttribute('title', isHomePage ? 'Volver al chat' : 'Volver a Settings');
    }
  }

  function setSettingsPage(nextPage) {
    const safePage = normalizeSettingsPage(nextPage);
    if (settingsShell) {
      settingsShell.dataset.settingsPage = safePage;
    }

    for (const pageNode of settingsPages) {
      pageNode.classList.toggle('is-active', pageNode.dataset.settingsPage === safePage);
    }
    syncSettingsHeaderState(safePage);

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

    if (safePage === SETTINGS_PAGES.APPS_INTEGRATIONS) {
      renderAppsIntegrationsSettings({ syncInput: true });
    }

    if (safePage === SETTINGS_PAGES.ASSISTANT) {
      hydrateWhatsappPromptEditorFromActiveChat({
        keepCurrentTarget: true,
        clearStatus: false,
        silentNoTarget: true
      });
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
    renderAppsIntegrationsSettings({ syncInput: true });
    renderAssistantBranding();
  }

  function populateSettingsForm() {
    settingsScreenController?.populateSettingsForm();
    syncModelSelectors();
    renderPinStatus();
    renderCrmErpDatabaseSettings({ syncInput: true });
    renderAppsIntegrationsSettings({ syncInput: true });
    setStatus(settingsCrmErpDbStatus, '');
    setStatus(settingsCrmErpMeStatus, '');
    setStatus(settingsIntegrationsStatus, '');
    renderAssistantBranding();
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

    onboardingAssistantNameInput?.focus();
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
    const payload = chatHistory.map((item) => {
      const source = item && typeof item === 'object' ? item : {};
      const generatedImages = Array.isArray(source.generated_images)
        ? source.generated_images
            .map((image) => {
              const imageUrl = String(image?.url || '').trim();
              if (!imageUrl) {
                return null;
              }
              return {
                url: imageUrl,
                alt: String(image?.alt || '').trim().slice(0, 220)
              };
            })
            .filter(Boolean)
            .slice(0, 4)
        : [];

      return {
        ...source,
        pending: false,
        generated_images: generatedImages
      };
    });

    return storageService.saveChatHistory(payload);
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

  async function readAllWhatsappChatHistories(options = {}) {
    if (typeof storageService.listWhatsappChatHistories !== 'function') {
      return [];
    }

    return storageService.listWhatsappChatHistories(options);
  }

  async function readPanelSettings() {
    return storageService.readPanelSettings();
  }

  async function savePanelSettings(nextSettings) {
    const patch = nextSettings && typeof nextSettings === 'object' ? nextSettings : {};
    const previousIntegrationsToken = JSON.stringify(normalizeIntegrationsConfig(panelSettings.integrations));
    if (settingsScreenState) {
      settingsScreenState.panelSettings = { ...settingsScreenState.panelSettings, ...patch };
      panelSettings = { ...settingsScreenState.panelSettings };
    } else {
      panelSettings = { ...panelSettings, ...patch };
    }

    if (!panelSettings.systemPrompt || !String(panelSettings.systemPrompt || '').trim()) {
      panelSettings.systemPrompt = buildDefaultChatSystemPrompt(panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE);
    }

    panelSettings.assistantName = normalizeAssistantDisplayName(panelSettings.assistantName) || DEFAULT_ASSISTANT_DISPLAY_NAME;
    panelSettings.systemVariables = normalizeSystemVariables(panelSettings.systemVariables);
    panelSettings.crmErpDatabaseUrl = postgresService.normalizeConnectionUrl(panelSettings.crmErpDatabaseUrl || '');
    panelSettings.crmErpDatabaseSchemaSnapshot = normalizeCrmErpDatabaseSnapshot(panelSettings.crmErpDatabaseSchemaSnapshot);
    panelSettings.crmErpDatabaseMeProfile = normalizeCrmErpMeProfile(
      panelSettings.crmErpDatabaseMeProfile,
      panelSettings.crmErpDatabaseSchemaSnapshot
    );
    panelSettings.whatsappConversationPrompts = normalizeWhatsappConversationPrompts(panelSettings.whatsappConversationPrompts);
    panelSettings.integrations = normalizeIntegrationsConfig(panelSettings.integrations);

    if (settingsScreenState) {
      settingsScreenState.panelSettings = {
        ...settingsScreenState.panelSettings,
        assistantName: panelSettings.assistantName,
        systemPrompt: panelSettings.systemPrompt,
        systemVariables: { ...panelSettings.systemVariables },
        crmErpDatabaseUrl: panelSettings.crmErpDatabaseUrl,
        crmErpDatabaseSchemaSnapshot: panelSettings.crmErpDatabaseSchemaSnapshot,
        crmErpDatabaseMeProfile: panelSettings.crmErpDatabaseMeProfile,
        whatsappConversationPrompts: { ...panelSettings.whatsappConversationPrompts },
        integrations: normalizeIntegrationsConfig(panelSettings.integrations)
      };
    }
    const saved = await storageService.savePanelSettings(panelSettings);
    if (!saved) {
      return false;
    }

    const currentIntegrationsToken = JSON.stringify(panelSettings.integrations);
    if (currentIntegrationsToken !== previousIntegrationsToken) {
      syncLocationContextToBackground(panelSettings.integrations, {
        reason: 'panel_settings_save'
      });
    }
    renderAssistantBranding();

    return true;
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

  function normalizeAttachmentMimeType(file) {
    const mime = String(file?.type || '').trim().toLowerCase();
    if (mime) {
      return mime;
    }
    return 'application/octet-stream';
  }

  function normalizeAttachmentKind(file) {
    const mimeType = normalizeAttachmentMimeType(file);
    if (mimeType.startsWith('image/')) {
      return 'image';
    }
    if (
      mimeType.startsWith('text/') ||
      mimeType.includes('json') ||
      mimeType.includes('xml') ||
      mimeType.includes('csv') ||
      mimeType.includes('yaml')
    ) {
      return 'text';
    }
    return 'file';
  }

  function sanitizeAttachmentText(value, maxChars = MAX_CHAT_ATTACHMENT_TEXT_CHARS) {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .trim()
      .slice(0, Math.max(200, Number(maxChars) || MAX_CHAT_ATTACHMENT_TEXT_CHARS));
  }

  function buildAttachmentFingerprint(file) {
    return `${String(file?.name || '').trim()}::${Math.max(0, Number(file?.size) || 0)}::${Math.max(
      0,
      Number(file?.lastModified) || 0
    )}`;
  }

  function fileToText(file, maxChars = MAX_CHAT_ATTACHMENT_TEXT_CHARS) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        resolve(sanitizeAttachmentText(text, maxChars));
      };
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
      reader.readAsText(file);
    });
  }

  function readImageSize(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const width = Math.max(0, Number(image.naturalWidth) || 0);
        const height = Math.max(0, Number(image.naturalHeight) || 0);
        URL.revokeObjectURL(url);
        resolve({ width, height });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      image.src = url;
    });
  }

  async function buildChatAttachmentDraft(file, index = 0) {
    const safeFile = file instanceof File ? file : null;
    if (!safeFile) {
      return null;
    }

    const name = String(safeFile.name || '').trim().slice(0, 180);
    if (!name) {
      return null;
    }

    const mimeType = normalizeAttachmentMimeType(safeFile);
    const kind = normalizeAttachmentKind(safeFile);
    const sizeBytes = Math.max(0, Number(safeFile.size) || 0);
    const fingerprint = buildAttachmentFingerprint(safeFile);
    const id = `${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`;
    let textExcerpt = '';
    let imageWidth = 0;
    let imageHeight = 0;

    if (kind === 'text') {
      try {
        textExcerpt = await fileToText(safeFile);
      } catch (_) {
        textExcerpt = '';
      }
    } else if (kind === 'image') {
      const dimensions = await readImageSize(safeFile);
      imageWidth = dimensions.width;
      imageHeight = dimensions.height;
    }

    return {
      id,
      fingerprint,
      name,
      mimeType,
      kind,
      sizeBytes,
      textExcerpt,
      imageWidth,
      imageHeight
    };
  }

  function renderPendingConversationAttachments() {
    if (!chatAttachmentsBar) {
      return;
    }

    if (!pendingConversationAttachments.length) {
      chatAttachmentsBar.hidden = true;
      chatAttachmentsBar.textContent = '';
      return;
    }

    chatAttachmentsBar.hidden = false;
    chatAttachmentsBar.textContent = '';

    for (const attachment of pendingConversationAttachments) {
      const chip = document.createElement('span');
      chip.className = 'chat-attachment-chip';
      chip.dataset.attachmentId = String(attachment.id || '');

      const name = document.createElement('span');
      name.className = 'chat-attachment-chip__name';
      const kindLabel = attachment.kind === 'image' ? 'img' : attachment.kind === 'text' ? 'txt' : 'file';
      name.textContent = `[${kindLabel}] ${attachment.name} • ${formatBytes(attachment.sizeBytes)}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'chat-attachment-chip__remove';
      removeBtn.type = 'button';
      removeBtn.dataset.attachmentRemove = String(attachment.id || '');
      removeBtn.setAttribute('aria-label', `Quitar ${attachment.name}`);
      removeBtn.textContent = '×';

      chip.append(name, removeBtn);
      chatAttachmentsBar.appendChild(chip);
    }
  }

  function clearPendingConversationAttachments() {
    pendingConversationAttachments = [];
    renderPendingConversationAttachments();
    if (chatAttachmentInput) {
      chatAttachmentInput.value = '';
    }
  }

  function removePendingConversationAttachment(attachmentId) {
    const token = String(attachmentId || '').trim();
    if (!token) {
      return;
    }

    pendingConversationAttachments = pendingConversationAttachments.filter((item) => String(item?.id || '') !== token);
    renderPendingConversationAttachments();
  }

  async function queueChatAttachmentsFromFiles(fileList) {
    const sourceFiles = Array.from(fileList || []).filter((item) => item instanceof File);
    if (!sourceFiles.length) {
      return;
    }

    const existingFingerprints = new Set(
      pendingConversationAttachments.map((item) => String(item?.fingerprint || '').trim()).filter(Boolean)
    );
    let added = 0;

    for (let index = 0; index < sourceFiles.length; index += 1) {
      const file = sourceFiles[index];
      const fingerprint = buildAttachmentFingerprint(file);
      if (!fingerprint || existingFingerprints.has(fingerprint)) {
        continue;
      }

      if (pendingConversationAttachments.length >= MAX_CHAT_ATTACHMENTS_PER_TURN) {
        break;
      }

      const draft = await buildChatAttachmentDraft(file, index);
      if (!draft) {
        continue;
      }

      existingFingerprints.add(fingerprint);
      pendingConversationAttachments.push(draft);
      added += 1;
    }

    renderPendingConversationAttachments();

    if (added > 0) {
      setStatus(chatStatus, `${added} adjunto(s) listos para enviar.`);
    } else {
      setStatus(chatStatus, 'No se agregaron nuevos adjuntos.');
    }
  }

  function buildAttachmentsPromptBlock(attachments) {
    const source = Array.isArray(attachments) ? attachments : [];
    if (!source.length) {
      return '';
    }

    const lines = ['Adjuntos del usuario:'];
    for (const attachment of source.slice(0, MAX_CHAT_ATTACHMENTS_PER_TURN)) {
      const base = `- ${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.sizeBytes)})`;
      if (attachment.kind === 'image') {
        const dimensions =
          attachment.imageWidth > 0 && attachment.imageHeight > 0 ? ` ${attachment.imageWidth}x${attachment.imageHeight}` : '';
        lines.push(`${base}${dimensions}`);
        continue;
      }

      if (attachment.textExcerpt) {
        lines.push(`${base}\n  Contenido resumido: ${attachment.textExcerpt.slice(0, MAX_CHAT_ATTACHMENT_TEXT_CHARS)}`);
        continue;
      }

      lines.push(base);
    }

    return lines.join('\n');
  }

  function buildChatMessageContentForModel(message) {
    const baseContent = String(message?.content || '').trim();
    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    if (!attachments.length) {
      return baseContent;
    }

    const attachmentsBlock = buildAttachmentsPromptBlock(attachments);
    if (!attachmentsBlock) {
      return baseContent;
    }

    return [baseContent, attachmentsBlock].filter(Boolean).join('\n\n');
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

  function normalizeAssistantDisplayName(value) {
    return String(value || '')
      .trim()
      .slice(0, 80);
  }

  function getResolvedAssistantDisplayName() {
    return normalizeAssistantDisplayName(panelSettings.assistantName) || DEFAULT_ASSISTANT_DISPLAY_NAME;
  }

  function renderAssistantBranding() {
    const assistantName = getResolvedAssistantDisplayName();
    if (brandNameText) {
      brandNameText.textContent = assistantName;
    }
    if (brandRoleLabel) {
      brandRoleLabel.textContent = 'assistant';
    }
    document.title = assistantName;
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

    const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
    if (attachments.length) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-message-attachments';

      for (const attachment of attachments.slice(0, MAX_CHAT_ATTACHMENTS_PER_TURN)) {
        const item = document.createElement('div');
        item.className = 'chat-message-attachment';
        const label = attachment.kind === 'image' ? 'Imagen' : attachment.kind === 'text' ? 'Texto' : 'Archivo';
        const name = String(attachment.name || 'adjunto').trim();
        const metaParts = [`${label}`, formatBytes(Math.max(0, Number(attachment.sizeBytes) || 0))];
        if (attachment.kind === 'image' && Number(attachment.imageWidth) > 0 && Number(attachment.imageHeight) > 0) {
          metaParts.push(`${attachment.imageWidth}x${attachment.imageHeight}`);
        }
        item.innerHTML = `<strong>${escapeHtml(name)}</strong><br><span>${escapeHtml(metaParts.join(' • '))}</span>`;
        wrap.appendChild(item);
      }

      article.appendChild(wrap);
    }

    const generatedImages = Array.isArray(message?.generated_images) ? message.generated_images : [];
    if (generatedImages.length) {
      const imageWrap = document.createElement('div');
      imageWrap.className = 'chat-generated-images';

      for (const image of generatedImages.slice(0, 4)) {
        const src = String(image?.url || image?.dataUrl || '').trim();
        if (!src) {
          continue;
        }
        const img = document.createElement('img');
        img.src = src;
        img.alt = String(image?.alt || 'Generated image').trim() || 'Generated image';
        img.loading = 'lazy';
        imageWrap.appendChild(img);
      }

      if (imageWrap.childElementCount > 0) {
        article.appendChild(imageWrap);
      }
    }

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
    const attachmentsRaw = Array.isArray(options.attachments) ? options.attachments : [];
    const attachments = attachmentsRaw
      .map((item, index) => {
        const source = item && typeof item === 'object' ? item : {};
        const name = String(source.name || '').trim().slice(0, 180);
        const mimeType = String(source.mimeType || normalizeAttachmentMimeType(source)).trim().slice(0, 120);
        if (!name || !mimeType) {
          return null;
        }

        const kindToken = String(source.kind || '').trim().toLowerCase();
        const kind = kindToken === 'image' || kindToken === 'text' || kindToken === 'file' ? kindToken : 'file';
        return {
          id: String(source.id || `attachment-${index}`).trim().slice(0, 120),
          name,
          mimeType,
          kind,
          sizeBytes: Math.max(0, Number(source.sizeBytes) || 0),
          textExcerpt: sanitizeAttachmentText(source.textExcerpt || '', 1400),
          imageWidth: Math.max(0, Number(source.imageWidth) || 0),
          imageHeight: Math.max(0, Number(source.imageHeight) || 0),
          fingerprint: String(source.fingerprint || '').trim().slice(0, 240)
        };
      })
      .filter(Boolean)
      .slice(0, MAX_CHAT_ATTACHMENTS_PER_TURN);

    if (!text && !attachments.length) {
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
      content: text || '[Adjuntos]',
      tool: selectedChatTool,
      context_used: contextUsed,
      extracted_facts: extractedFacts,
      attachments,
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
    clearPendingConversationAttachments();
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

  function buildLocationToolsSystemContext() {
    const integrations = getIntegrationsConfig();
    const permissions = integrations.permissions || {};
    const maps = integrations.maps || {};
    const locationMeta = buildLocationMetaText(maps.lastKnownLocation, maps.nearbyPlaces || []);
    const micState = normalizeIntegrationPermissionState(permissions.microphone);
    const locState = normalizeIntegrationPermissionState(permissions.location);

    return [
      `Permisos locales: microfono=${micState}, ubicacion=${locState}.`,
      locationMeta
    ].join('\n');
  }

  function buildCustomIntegrationsToolsContext() {
    const customTools = normalizeCustomIntegrationTools(getIntegrationsConfig().customTools);
    if (!customTools.length) {
      return 'Custom integrations: sin tools registradas.';
    }

    const lines = customTools.slice(0, 20).map((tool, index) => {
      const name = String(tool?.name || '').trim();
      const method = String(tool?.method || 'POST').trim().toUpperCase();
      const endpoint = String(tool?.endpoint || '').trim().slice(0, 120);
      const description = String(tool?.description || '').trim().slice(0, 120);
      return `${index + 1}. ${name} (${method}) ${endpoint}${description ? ` | ${description}` : ''}`;
    });
    return ['Custom integrations registradas:', ...lines].join('\n');
  }

  function buildLocalToolSystemPrompt() {
    const hasWhatsappTab = Boolean(getPreferredWhatsappTab());
    const hasCrmErpDbConnection = Boolean(getCrmErpDatabaseConnectionUrl());
    const integrations = getIntegrationsConfig();
    const hasSmtpRelay = Boolean(String(integrations.smtp?.relayUrl || '').trim());
    const hasMapsApiKey = Boolean(String(integrations.maps?.apiKey || '').trim());
    const hasCustomTools = normalizeCustomIntegrationTools(integrations.customTools).length > 0;
    return [
      'Eres un agente de productividad que opera en el navegador del usuario.',
      'Responde SIEMPRE en Markdown claro.',
      'Si necesitas ejecutar acciones locales del navegador, responde SOLO con un bloque ```tool JSON``` sin texto adicional.',
      'Formato exacto del bloque tool:',
      '```tool',
      '{"tool":"browser.<accion>|whatsapp.<accion>|db.<accion>|smtp.<accion>|maps.<accion>|integration.<accion>","args":{...}}',
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
      ...(hasSmtpRelay
        ? ['- smtp.sendMail (args: to, subject, text|html, from opcional; usa relay SMTP configurado)']
        : ['- smtp.sendMail requiere configurar Relay URL en Settings > Apps & Integrations.']),
      ...(hasMapsApiKey
        ? [
            '- maps.getCurrentLocation (sin args; devuelve coordenadas guardadas)',
            '- maps.getNearbyPlaces (args: type opcional, radiusMeters opcional, maxResults opcional)',
            '- maps.getDirectionsTime (args: destination requerido, origin opcional, travelMode opcional)'
          ]
        : ['- maps.* requiere configurar Maps API Key en Settings > Apps & Integrations.']),
      ...(hasCustomTools
        ? ['- integration.call (args: name requerido, input objeto opcional)']
        : ['- integration.call requiere registrar Custom Tools Schema en Settings > Apps & Integrations.']),
      'Para preguntas de tiempo (hoy, ayer, semana pasada, viernes por la tarde, visita mas antigua), usa primero tools de historial.',
      'Si el usuario pide acciones en WhatsApp, usa whatsapp.* y prioriza dryRun cuando la accion sea masiva.',
      'Para preguntas de CRM/ERP, usa db.refreshSchema si falta contexto y luego db.queryRead/db.queryWrite segun corresponda.',
      'Para consultas cercanas (restaurantes/cafes/lugares), usa maps.getNearbyPlaces con la ubicacion guardada.',
      'En db.queryRead agrega LIMIT razonable (<= 100) para evitar respuestas gigantes.',
      'No inventes tools fuera de esta lista.',
      buildActiveTabsSystemContext(),
      buildRecentHistorySystemContext(),
      buildWhatsappToolsSystemContext(),
      buildCrmErpDatabaseToolsContext(),
      buildLocationToolsSystemContext(),
      buildCustomIntegrationsToolsContext()
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
      'db.queryWrite': 'db.queryWrite',
      'smtp.send_mail': 'smtp.sendMail',
      'smtp.sendEmail': 'smtp.sendMail',
      'smtp.sendMail': 'smtp.sendMail',
      'maps.get_current_location': 'maps.getCurrentLocation',
      'maps.getCurrentLocation': 'maps.getCurrentLocation',
      'maps.get_nearby_places': 'maps.getNearbyPlaces',
      'maps.getNearbyPlaces': 'maps.getNearbyPlaces',
      'maps.get_locations_places': 'maps.getNearbyPlaces',
      'maps.getLocationsPlaces': 'maps.getNearbyPlaces',
      'maps.get_places': 'maps.getNearbyPlaces',
      'maps.get_directions_time': 'maps.getDirectionsTime',
      'maps.getDirectionsTime': 'maps.getDirectionsTime',
      'maps.get_directions_duration': 'maps.getDirectionsTime',
      'integration.call': 'integration.call',
      'integration.invoke': 'integration.call',
      'integration.run': 'integration.call'
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

  function getCustomIntegrationToolByName(name) {
    const token = String(name || '')
      .trim()
      .toLowerCase();
    if (!token) {
      return null;
    }

    return normalizeCustomIntegrationTools(getIntegrationsConfig().customTools).find(
      (item) => String(item?.name || '').trim().toLowerCase() === token
    ) || null;
  }

  async function callCustomIntegrationTool(name, input = {}) {
    const tool = getCustomIntegrationToolByName(name);
    if (!tool) {
      throw new Error('Custom tool no encontrada.');
    }

    const method = String(tool.method || 'POST').trim().toUpperCase();
    const endpoint = String(tool.endpoint || '').trim();
    const headers = {
      'Content-Type': 'application/json',
      ...(tool.headers && typeof tool.headers === 'object' ? tool.headers : {})
    };

    const requestInit = {
      method,
      headers
    };
    if (method !== 'GET' && method !== 'HEAD') {
      requestInit.body = JSON.stringify(input && typeof input === 'object' ? input : {});
    }

    const response = await fetch(endpoint, requestInit);
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const errorText = String(payload?.error || payload?.message || `HTTP ${response.status}`).trim();
      throw new Error(`Custom tool error: ${errorText}`);
    }

    return payload || {
      ok: true
    };
  }

  async function sendMailViaConfiguredSmtp(args = {}) {
    const integrations = getIntegrationsConfig();
    const smtp = integrations.smtp || {};
    const relayUrl = String(smtp.relayUrl || '').trim();
    if (!relayUrl) {
      throw new Error('Configura SMTP Relay URL en Settings > Apps & Integrations.');
    }

    const toRaw = Array.isArray(args.to) ? args.to : [args.to];
    const to = toRaw
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 20);
    const subject = String(args.subject || '').trim().slice(0, 220);
    const text = String(args.text || '').trim().slice(0, 12000);
    const html = String(args.html || '').trim().slice(0, 18000);
    const from = String(args.from || smtp.from || '').trim().slice(0, 220);

    if (!to.length) {
      throw new Error('smtp.sendMail requiere args.to.');
    }
    if (!subject) {
      throw new Error('smtp.sendMail requiere args.subject.');
    }
    if (!text && !html) {
      throw new Error('smtp.sendMail requiere args.text o args.html.');
    }

    const response = await fetch(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        smtp: {
          host: String(smtp.host || '').trim(),
          port: Math.max(1, Math.min(65535, Number(smtp.port) || 587)),
          secure: String(smtp.secure || 'auto'),
          username: String(smtp.username || '').trim(),
          password: String(smtp.password || '').trim(),
          from
        },
        mail: {
          to,
          subject,
          text,
          html
        }
      })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const errorText = String(payload?.error || payload?.message || `HTTP ${response.status}`).trim();
      throw new Error(`SMTP relay error: ${errorText}`);
    }

    return payload || {
      ok: true,
      queued: true
    };
  }

  function resolveLocationFromArgs(rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const lat = Number(args.latitude ?? args.lat);
    const lng = Number(args.longitude ?? args.lng ?? args.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        latitude: lat,
        longitude: lng
      };
    }

    const stored = getIntegrationsConfig().maps?.lastKnownLocation;
    if (stored && Number.isFinite(Number(stored.latitude)) && Number.isFinite(Number(stored.longitude))) {
      return {
        latitude: Number(stored.latitude),
        longitude: Number(stored.longitude)
      };
    }

    return null;
  }

  async function getDirectionsTimeFromMaps(rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const integrations = getIntegrationsConfig();
    const mapsApiKey = String(integrations.maps?.apiKey || '').trim();
    if (!mapsApiKey) {
      throw new Error('Configura Maps API Key en Settings > Apps & Integrations.');
    }

    const destination = String(args.destination || '').trim();
    if (!destination) {
      throw new Error('maps.getDirectionsTime requiere args.destination.');
    }

    const originInput = String(args.origin || '').trim();
    const travelModeToken = String(args.travelMode || args.mode || 'DRIVE')
      .trim()
      .toUpperCase();
    const travelMode =
      travelModeToken === 'WALK' || travelModeToken === 'BICYCLE' || travelModeToken === 'TRANSIT' ? travelModeToken : 'DRIVE';
    const location = resolveLocationFromArgs(args);
    if (!originInput && !location) {
      throw new Error('No hay origen disponible. Pide ubicacion o pasa args.origin.');
    }

    const originWaypoint = originInput
      ? {
          address: originInput
        }
      : {
          location: {
            latLng: {
              latitude: Number(location.latitude),
              longitude: Number(location.longitude)
            }
          }
        };

    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsApiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'
      },
      body: JSON.stringify({
        origin: originWaypoint,
        destination: {
          address: destination
        },
        travelMode
      })
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const errorText = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`).trim();
      throw new Error(`Maps routes error: ${errorText}`);
    }

    const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
    if (!route) {
      throw new Error('No se encontro ruta para el destino solicitado.');
    }

    return {
      duration: String(route.duration || '').trim(),
      distanceMeters: Math.max(0, Number(route.distanceMeters) || 0),
      polyline: String(route?.polyline?.encodedPolyline || '').trim()
    };
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
      const isSmtpTool = tool.startsWith('smtp.');
      const isMapsTool = tool.startsWith('maps.');
      const isIntegrationTool = tool.startsWith('integration.');

      if (!isBrowserTool && !isWhatsappTool && !isDbTool && !isSmtpTool && !isMapsTool && !isIntegrationTool) {
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

        if (isSmtpTool) {
          const smtpAction = tool.replace(/^smtp\./, '');
          if (smtpAction !== 'sendMail') {
            results.push({
              tool,
              ok: false,
              error: 'Accion smtp.* no soportada.'
            });
            continue;
          }

          const smtpResult = await sendMailViaConfiguredSmtp(args);
          results.push({
            tool,
            ok: true,
            result: smtpResult
          });
          continue;
        }

        if (isMapsTool) {
          const mapsAction = tool.replace(/^maps\./, '');
          if (mapsAction === 'getCurrentLocation') {
            const location = resolveLocationFromArgs(args);
            if (!location) {
              results.push({
                tool,
                ok: false,
                error: 'No hay ubicacion guardada.'
              });
            } else {
              results.push({
                tool,
                ok: true,
                result: location
              });
            }
            continue;
          }

          if (mapsAction === 'getNearbyPlaces') {
            const location = resolveLocationFromArgs(args);
            if (!location) {
              results.push({
                tool,
                ok: false,
                error: 'No hay ubicacion disponible para nearby places.'
              });
              continue;
            }

            const places = await fetchNearbyPlacesForLocation(location, {
              nearbyType: args.type || args.nearbyType,
              radiusMeters: args.radiusMeters,
              maxResultCount: args.maxResults || args.limit
            });

            const integrations = getIntegrationsConfig();
            const nextIntegrations = normalizeIntegrationsConfig({
              ...integrations,
              maps: {
                ...integrations.maps,
                lastKnownLocation: {
                  ...integrations.maps?.lastKnownLocation,
                  latitude: Number(location.latitude),
                  longitude: Number(location.longitude),
                  capturedAt: Date.now()
                },
                nearbyPlaces: places
              }
            });
            await savePanelSettings({ integrations: nextIntegrations });
            renderAppsIntegrationsSettings({ syncInput: false });

            results.push({
              tool,
              ok: true,
              result: {
                location,
                places
              }
            });
            continue;
          }

          if (mapsAction === 'getDirectionsTime') {
            const route = await getDirectionsTimeFromMaps(args);
            results.push({
              tool,
              ok: true,
              result: route
            });
            continue;
          }

          results.push({
            tool,
            ok: false,
            error: 'Accion maps.* no soportada.'
          });
          continue;
        }

        if (isIntegrationTool) {
          const integrationAction = tool.replace(/^integration\./, '');
          if (integrationAction !== 'call') {
            results.push({
              tool,
              ok: false,
              error: 'Accion integration.* no soportada.'
            });
            continue;
          }

          const integrationName = String(args.name || '').trim();
          if (!integrationName) {
            results.push({
              tool,
              ok: false,
              error: 'integration.call requiere args.name.'
            });
            continue;
          }

          const payload = args.input && typeof args.input === 'object' ? args.input : {};
          const integrationResult = await callCustomIntegrationTool(integrationName, payload);
          results.push({
            tool,
            ok: true,
            result: integrationResult
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

  function buildActiveRelationsContextPrompt() {
    const activeTab = getActiveTabContext();
    const cards = Array.isArray(dynamicRelationsContextState?.cards)
      ? dynamicRelationsContextState.cards
      : [];
    if (!activeTab || !cards.length) {
      return '';
    }

    const lines = [];
    lines.push('Contexto relacional detectado para la pestana activa:');

    const meProfile = getCrmErpDatabaseMeProfile();
    if (isCrmErpMeProfileComplete(meProfile)) {
      lines.push(
        `Filtro de asignacion activo: ${meProfile.tableQualifiedName}.${meProfile.idColumn} = ${meProfile.userId}.`
      );
    }

    for (const card of cards.slice(0, 8)) {
      const tableName = String(card?.tableQualifiedName || card?.title || '').trim();
      if (!tableName) {
        continue;
      }
      const caption = String(card?.caption || '').trim();
      const detailFields = Array.isArray(card?.detailFields) ? card.detailFields : [];
      const rows = Array.isArray(card?.rows) ? card.rows : [];
      const rowTokens = detailFields.length
        ? detailFields
            .map((item) => {
              const label = String(item?.label || '').trim();
              const value = String(item?.value || '').trim();
              if (!label || !value) {
                return '';
              }
              return `${label}: ${value}`;
            })
            .filter(Boolean)
        : rows
            .map((row) => {
              const label = String(row?.label || '').trim();
              const value = String(row?.value || '').trim();
              const count = Math.max(0, Number(row?.count) || 0);
              if (!label) {
                return '';
              }
              return value ? `${label}: ${value}` : `${label}: ${count}`;
            })
            .filter(Boolean)
            .slice(0, 3);

      lines.push(`- ${tableName}${caption ? ` [${caption}]` : ''}: ${rowTokens.join(' | ') || 'sin detalle'}`);
    }

    if (lines.length <= 1) {
      return '';
    }
    return lines.join('\n');
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
    const relationContextPrompt = selectedChatTool === 'chat' ? buildActiveRelationsContextPrompt() : '';
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

      dynamicSystemPrompt = [contextHeader, relationContextPrompt, localToolPrompt, historyToolDirective, systemPrompt]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    } catch (_) {
      dynamicSystemPrompt = [relationContextPrompt, localToolPrompt, historyToolDirective, systemPrompt]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    }

    const context = chatHistory
      .slice(-getSystemVariableNumber('chat.maxContextMessages', MAX_CHAT_CONTEXT_MESSAGES))
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: buildChatMessageContentForModel(msg)
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
    const attachmentsForTurn = pendingConversationAttachments.slice(0, MAX_CHAT_ATTACHMENTS_PER_TURN);
    if (!content && !attachmentsForTurn.length) {
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
      const attachmentsPromptBlock = buildAttachmentsPromptBlock(attachmentsForTurn);
      const contentForModel = [content, attachmentsPromptBlock].filter(Boolean).join('\n\n').trim() || content;
      const userMessage = await pushChatMessage('user', content, {
        attachments: attachmentsForTurn
      });
      chatInput.value = '';
      updateChatInputSize();
      clearPendingConversationAttachments();
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
        generated_images: [],
        createdAt: Date.now()
      };
      chatHistory.push(assistantMessage);
      renderChatMessages();
      scrollChatToBottom();

      if (selectedChatTool === 'create_image') {
        setStatus(chatStatus, 'Generando imagen...', false, { loading: true });

        const imageResult = await generateImageWithActiveModel(contentForModel || content, {
          statusTarget: chatStatus,
          size: '1024x1024'
        });
        const imageUrl = String(imageResult?.imageUrl || '').trim();
        const imageDataUrl = String(imageResult?.imageDataUrl || '').trim();
        const revisedPrompt = String(imageResult?.revisedPrompt || '').trim();
        const previewSource = imageUrl || imageDataUrl;
        if (!previewSource) {
          throw new Error('No se pudo generar imagen.');
        }

        assistantMessage.pending = false;
        assistantMessage.generated_images = [
          {
            url: imageUrl,
            dataUrl: imageDataUrl,
            alt: content || 'Imagen generada'
          }
        ];
        assistantMessage.content = revisedPrompt
          ? `Imagen generada.\n\nPrompt aplicado: ${revisedPrompt}`
          : 'Imagen generada.';

        const contextUsed = [];
        const turnMemory = await contextMemoryService.rememberChatTurn({
          userMessage: contentForModel || content || '[Adjuntos]',
          assistantMessage: assistantMessage.content,
          contextUsed
        });
        assistantMessage.extracted_facts = Array.isArray(turnMemory?.extracted_facts) ? turnMemory.extracted_facts : [];
        if (userMessage && Array.isArray(userMessage.extracted_facts) && assistantMessage.extracted_facts.length) {
          userMessage.extracted_facts = assistantMessage.extracted_facts;
        }

        renderChatMessages();
        scrollChatToBottom();
        await saveChatHistory();
        const imageProfile = imageResult?.profile && typeof imageResult.profile === 'object' ? imageResult.profile : null;
        const imageModel = imageProfile ? `${imageProfile.name} · ${imageProfile.model}` : 'modelo de imagen';
        setStatus(chatStatus, `Imagen generada con ${imageModel}.`);
        setBrandEmotion('excited');
        return;
      }

      const streamPayload = await streamChatResponse(contentForModel || content, (chunk) => {
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
          contentForModel || content,
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
        userMessage: contentForModel || content || '[Adjuntos]',
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

  async function saveSystemVariablesFromScreen(options = {}) {
    const autosave = options.autosave === true;
    const parsed = collectSystemVariableFormValues();
    if (!parsed.ok) {
      setStatus(systemVariablesStatus, parsed.error || 'No se pudieron validar las variables.', true);
      if (!autosave) {
        parsed.field?.focus();
      }
      return false;
    }

    const nextSettings = parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
    const previousWhatsappBasePrompt = getWhatsappSuggestionBasePrompt();
    const ok = await savePanelSettings(nextSettings);
    if (!ok) {
      setStatus(systemVariablesStatus, 'No se pudieron guardar las system variables.', true);
      return false;
    }
    const nextWhatsappBasePrompt = getWhatsappSuggestionBasePrompt();
    if (nextWhatsappBasePrompt !== previousWhatsappBasePrompt) {
      refreshWhatsappSuggestionForActiveTab({ force: false });
    }

    if (autosave) {
      setStatus(systemVariablesStatus, 'System variables guardadas.');
      return true;
    }

    settingsScreenController?.applyPanelSettingsToUi();
    renderSystemVariables();
    setStatus(systemVariablesStatus, 'System variables guardadas.');
    setStatus(chatStatus, 'System variables actualizadas.');
    return true;
  }

  async function resetSystemVariablesToDefaults() {
    const defaultPrompt = buildDefaultChatSystemPrompt(panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE);
    const previousWhatsappBasePrompt = getWhatsappSuggestionBasePrompt();
    const ok = await savePanelSettings({
      systemPrompt: defaultPrompt,
      systemVariables: normalizeSystemVariables(SYSTEM_VARIABLE_DEFAULTS)
    });

    if (!ok) {
      setStatus(systemVariablesStatus, 'No se pudieron restaurar defaults.', true);
      return;
    }
    const nextWhatsappBasePrompt = getWhatsappSuggestionBasePrompt();
    if (nextWhatsappBasePrompt !== previousWhatsappBasePrompt) {
      refreshWhatsappSuggestionForActiveTab({ force: false });
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
      runtimeContext: tabContextSnapshot.runtimeContext && typeof tabContextSnapshot.runtimeContext === 'object'
        ? tabContextSnapshot.runtimeContext
        : {},
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

  function profileSupportsImageGeneration(profile) {
    const provider = String(profile?.provider || '').trim();
    return provider === AI_PROVIDER_IDS.OPENAI || provider === AI_PROVIDER_IDS.OPENAI_COMPATIBLE;
  }

  function resolveImageGenerationProfile() {
    const active = getActiveModelProfile();
    if (active && profileSupportsImageGeneration(active)) {
      return active;
    }

    const candidates = getModelProfiles();
    for (const item of candidates) {
      if (profileSupportsImageGeneration(item) && item.hasApiKey) {
        return item;
      }
    }

    for (const item of candidates) {
      if (profileSupportsImageGeneration(item)) {
        return item;
      }
    }

    return null;
  }

  async function generateImageWithActiveModel(prompt, options = {}) {
    const profile = resolveImageGenerationProfile();
    if (!profile) {
      throw new Error('No hay modelo OpenAI/OpenAI-compatible configurado para generar imagen.');
    }

    const apiKey = await getApiKeyForProfile(profile, {
      statusTarget: options.statusTarget || chatStatus
    });
    const imageResult = await aiProviderService.generateImageWithProfile({
      profile,
      prompt: String(prompt || '').trim(),
      apiKey,
      size: String(options.size || '1024x1024')
    });

    return {
      ...imageResult,
      profile
    };
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

  function refreshWhatsappSuggestionForActiveTab(options = {}) {
    const activeTab = getActiveTabContext();
    if (!activeTab || !isWhatsappContext(activeTab)) {
      return;
    }

    void generateWhatsappSuggestion(activeTab, {
      force: options.force === true
    });
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

  function buildWhatsappHistoryVectorFingerprint(historyPayload) {
    const payload = historyPayload && typeof historyPayload === 'object' ? historyPayload : {};
    const key = String(payload.key || payload.channelId || payload.chatKey || payload.phone || payload.title || '').trim();
    if (!key) {
      return '';
    }

    const updatedAt = Math.max(0, Number(payload.updatedAt) || 0);
    const lastMessageId = String(payload.lastMessageId || '').trim();
    const messageCount = Array.isArray(payload.messages) ? payload.messages.length : 0;
    return `${key}|${updatedAt}|${lastMessageId}|${messageCount}`;
  }

  async function ingestWhatsappHistoryIntoContextMemory(historyPayload, options = {}) {
    const payload = historyPayload && typeof historyPayload === 'object' ? historyPayload : null;
    const key = String(payload?.key || payload?.channelId || payload?.chatKey || payload?.phone || payload?.title || '').trim();
    const hasMessages = Array.isArray(payload?.messages) && payload.messages.length > 0;
    if (!key || !hasMessages) {
      return {
        ingestedChats: 0,
        ingestedMessages: 0,
        ids: []
      };
    }

    const fingerprint = buildWhatsappHistoryVectorFingerprint(payload);
    if (!options.force && fingerprint && whatsappHistoryVectorFingerprintByKey.get(key) === fingerprint) {
      return {
        ingestedChats: 0,
        ingestedMessages: 0,
        ids: []
      };
    }

    const result = await contextMemoryService.ingestWhatsappChatHistory(payload, {
      messageLimit: Math.max(
        1,
        Math.min(
          MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT,
          Number(options.messageLimit) ||
            Number(getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)) ||
            MAX_WHATSAPP_PERSISTED_MESSAGES
        )
      )
    });

    if (fingerprint) {
      whatsappHistoryVectorFingerprintByKey.set(key, fingerprint);
      if (whatsappHistoryVectorFingerprintByKey.size > 400) {
        const oldestKey = whatsappHistoryVectorFingerprintByKey.keys().next().value;
        if (oldestKey) {
          whatsappHistoryVectorFingerprintByKey.delete(oldestKey);
        }
      }
    }

    return result;
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
    void ingestWhatsappHistoryIntoContextMemory(historyPayload, {
      messageLimit: getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)
    }).catch(() => {});
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

  function toSafeDynamicUiText(value, limit = 220) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  function normalizePhoneSignal(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 7) {
      return '';
    }
    return digits.slice(0, 20);
  }

  function extractPhoneFromWhatsappChatId(value) {
    const source = String(value || '').trim();
    if (!source) {
      return '';
    }

    const directWid = source.match(/(?:whatsapp:)?([0-9]{7,})@c\.us/i);
    if (directWid && directWid[1]) {
      return normalizePhoneSignal(directWid[1]);
    }

    const fallbackWid = source.match(/([0-9]{7,})@/);
    if (fallbackWid && fallbackWid[1]) {
      return normalizePhoneSignal(fallbackWid[1]);
    }

    return '';
  }

  function normalizeEmailSignal(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(token)) {
      return '';
    }
    return token.slice(0, 220);
  }

  function collectUniqueSignals(values, normalizer, limit = 6) {
    const output = [];
    const seen = new Set();
    for (const item of Array.isArray(values) ? values : []) {
      const normalized = normalizer(item);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push({
        value: toSafeDynamicUiText(item || normalized, 120),
        normalized
      });
      if (output.length >= Math.max(1, Math.min(20, Number(limit) || 6))) {
        break;
      }
    }
    return output;
  }

  function extractPhoneSignalsFromText(text, limit = 8) {
    const source = String(text || '');
    if (!source) {
      return [];
    }
    const matches = source.match(/(?:\+?\d[\d\s().-]{6,}\d)/g) || [];
    return collectUniqueSignals(matches, normalizePhoneSignal, limit);
  }

  function extractEmailSignalsFromText(text, limit = 8) {
    const source = String(text || '');
    if (!source) {
      return [];
    }
    const matches = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    return collectUniqueSignals(matches, normalizeEmailSignal, limit);
  }

  function collectDynamicSignalsFromTab(tabContext) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const inbox = Array.isArray(details.inbox) ? details.inbox : [];
    const messages = Array.isArray(details.messages) ? details.messages : [];
    const entities = Array.isArray(details.entities) ? details.entities : [];

    const textSources = [
      String(context.title || ''),
      String(context.description || ''),
      String(context.textExcerpt || ''),
      String(currentChat.channelId || ''),
      String(currentChat.key || ''),
      String(currentChat.phone || ''),
      String(currentChat.title || ''),
      entities.join(' ')
    ];

    for (const item of inbox.slice(0, 24)) {
      textSources.push(String(item?.title || ''));
      textSources.push(String(item?.phone || ''));
      textSources.push(String(item?.preview || ''));
    }

    for (const item of messages.slice(-20)) {
      textSources.push(String(item?.text || ''));
      textSources.push(String(item?.transcript || item?.enriched?.transcript || ''));
      textSources.push(String(item?.ocrText || item?.enriched?.ocrText || ''));
    }

    const combined = textSources.filter(Boolean).join('\n');
    const phoneFromWhatsappChannelId = extractPhoneFromWhatsappChatId(currentChat.channelId || currentChat.key || '');
    const phones = collectUniqueSignals(
      [
        phoneFromWhatsappChannelId,
        String(currentChat.phone || ''),
        ...extractPhoneSignalsFromText(combined, 12).map((item) => item.normalized)
      ],
      normalizePhoneSignal,
      8
    );
    const emails = collectUniqueSignals(
      extractEmailSignalsFromText(combined, 12).map((item) => item.normalized),
      normalizeEmailSignal,
      8
    );

    if (isWhatsappContext(context)) {
      logDebug('dynamic_signals:whatsapp_detected', {
        tabId: Number(context.tabId) || -1,
        channelId: toSafeLogText(currentChat.channelId || '', 220),
        chatKey: toSafeLogText(currentChat.key || '', 180),
        chatPhone: toSafeLogText(currentChat.phone || '', 80),
        phoneSignals: phones.map((item) => item?.normalized || ''),
        emailSignals: emails.map((item) => item?.normalized || '')
      });
    }

    return {
      phones,
      emails
    };
  }

  function quoteSqlIdentifier(value) {
    const safe = String(value || '').trim();
    if (!safe) {
      return '""';
    }
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function tableTitleFromName(tableName) {
    const tokens = String(tableName || '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);
    if (!tokens.length) {
      return 'Tabla';
    }
    return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()).join(' ');
  }

  function isPhoneColumnName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(phone|telefono|cel|mobile|movil|whatsapp|telefono|tel_?)/.test(token);
  }

  function isEmailColumnName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(email|correo|mail)/.test(token);
  }

  function isLabelColumnName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(name|nombre|title|subject|contact|cliente|company|empresa|lead|deal|task|item)/.test(token);
  }

  function isLikelyIdColumnName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return token === 'id' || token.endsWith('_id') || /(uuid|guid)$/.test(token);
  }

  function isContactReferenceColumnName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(contact_?id|cliente_?id|customer_?id|client_?id|lead_?id|persona_?id|person_?id)/.test(token);
  }

  function isContactTableName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(contact|cliente|customer|client|persona|person|lead|prospect)/.test(token);
  }

  function isSecondLevelRelationTableName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(task|activity|ticket|deal|opportunit|message|note|order|invoice|event|call|meeting)/.test(token);
  }

  function isOwnerAssignmentColumnName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(owner_?id|assigned_?(to|user)?_?id|assignee_?id|user_?id|employee_?id|agent_?id|sales_?rep_?id|created_?by)/.test(
      token
    );
  }

  function isSupportControlTableName(value) {
    const token = String(value || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    return /(audit|log|history|meta|metadata|config|setting|permission|role|lookup|catalog|dictionary|enum|mapping|map|xref|bridge|pivot|join|migration|schema|token|session|cache|queue|job|tmp|temp|backup|archive|import|export)/.test(
      token
    );
  }

  function isLikelyBridgeTable(table) {
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    if (!columns.length || columns.length > 8) {
      return false;
    }
    const fkCount = columns.filter((column) => column?.foreignKey && typeof column.foreignKey === 'object').length;
    const labelCount = columns.filter((column) => isLabelColumnName(column?.name)).length;
    return fkCount >= 2 && labelCount <= 1;
  }

  function classifyTableRelevanceLevel(table, options = {}) {
    const name = String(table?.name || '').trim().toLowerCase();
    if (!name) {
      return 'low';
    }

    if (isSupportControlTableName(name) || isLikelyBridgeTable(table)) {
      return 'support';
    }
    if (isSecondLevelRelationTableName(name)) {
      return 'high';
    }
    if (isContactTableName(name)) {
      return options.allowContact === true ? 'medium' : 'low';
    }

    return 'medium';
  }

  function findOwnerAssignmentColumn(table, meProfile = null) {
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    if (!columns.length) {
      return {
        hasOwnerColumn: false,
        ownerColumn: null
      };
    }

    const ownerCandidates = columns.filter((column) => {
      const name = String(column?.name || '').trim();
      if (!name) {
        return false;
      }
      if (isOwnerAssignmentColumnName(name)) {
        return true;
      }
      const fk = column?.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
      if (!fk) {
        return false;
      }
      const targetTable = String(fk.targetTable || '').trim();
      if (!targetTable) {
        return false;
      }
      return isLikelyUserTableName(targetTable);
    });

    if (!ownerCandidates.length) {
      return {
        hasOwnerColumn: false,
        ownerColumn: null
      };
    }

    const profile = meProfile && typeof meProfile === 'object' ? meProfile : null;
    if (!isCrmErpMeProfileComplete(profile)) {
      return {
        hasOwnerColumn: true,
        ownerColumn: null
      };
    }

    const target = splitQualifiedTableName(profile.tableQualifiedName);
    const profileIdColumn = String(profile.idColumn || '').trim().toLowerCase();
    const fkMatch = ownerCandidates.find((column) => {
      const fk = column?.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
      if (!fk) {
        return false;
      }
      const targetTable = String(fk.targetTable || '').trim().toLowerCase();
      const targetSchema = String(fk.targetSchema || '').trim().toLowerCase();
      const targetColumn = String(fk.targetColumn || '').trim().toLowerCase();
      if (!targetTable) {
        return false;
      }

      const tableMatches = target.table && targetTable === target.table.toLowerCase();
      const schemaMatches = !target.schema || !targetSchema || targetSchema === target.schema.toLowerCase();
      const columnMatches = !profileIdColumn || !targetColumn || targetColumn === profileIdColumn;
      return tableMatches && schemaMatches && columnMatches;
    });
    if (fkMatch) {
      return {
        hasOwnerColumn: true,
        ownerColumn: fkMatch
      };
    }

    const byName = ownerCandidates.find((column) => isOwnerAssignmentColumnName(column?.name)) || ownerCandidates[0];
    return {
      hasOwnerColumn: true,
      ownerColumn: byName || null
    };
  }

  function normalizeIdSignal(value) {
    const token = String(value || '').trim();
    if (!token) {
      return '';
    }
    return token.slice(0, 220);
  }

  function sanitizeSqlParamsForLog(rawParams, maxItems = 12) {
    const params = Array.isArray(rawParams) ? rawParams : [];
    return params.map((value) => {
      if (Array.isArray(value)) {
        return value
          .slice(0, Math.max(1, Math.min(80, Number(maxItems) || 12)))
          .map((item) => toSafeLogText(item, 120));
      }
      return toSafeLogText(value, 220);
    });
  }

  function buildWhatsappDirectSignals(tabContext, fallbackSignals = {}) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const fallbackPhones = Array.isArray(fallbackSignals?.phones) ? fallbackSignals.phones : [];
    const fallbackEmails = Array.isArray(fallbackSignals?.emails) ? fallbackSignals.emails : [];
    const phoneFromChannel = extractPhoneFromWhatsappChatId(currentChat.channelId || currentChat.key || '');
    const primaryPhones = collectUniqueSignals(
      [phoneFromChannel, String(currentChat.phone || ''), String(currentChat.key || '')],
      normalizePhoneSignal,
      4
    );
    const phones = primaryPhones.length ? primaryPhones : fallbackPhones;
    const emails = fallbackEmails.slice(0, 4);

    logDebug('whatsapp_contact:signals', {
      tabId: Number(context.tabId) || -1,
      channelId: toSafeLogText(currentChat.channelId || '', 200),
      chatKey: toSafeLogText(currentChat.key || '', 180),
      chatPhone: toSafeLogText(currentChat.phone || '', 80),
      directPhones: primaryPhones.map((item) => item?.normalized || ''),
      effectivePhones: phones.map((item) => item?.normalized || ''),
      effectiveEmails: emails.map((item) => item?.normalized || '')
    });

    return {
      phones,
      emails
    };
  }

  function buildSignalMatchExpression(signalType, matchExpr) {
    const type = String(signalType || '').trim().toLowerCase();
    if (type === 'phone') {
      return `regexp_replace(${matchExpr}, '[^0-9]', '', 'g')`;
    }
    if (type === 'email') {
      return `LOWER(TRIM(${matchExpr}))`;
    }
    return `TRIM(${matchExpr})`;
  }

  function pickIdColumn(columns) {
    const source = Array.isArray(columns) ? columns : [];
    let best = null;
    let bestScore = -1;
    for (const column of source) {
      const name = String(column?.name || '').trim();
      if (!name) {
        continue;
      }

      let score = 0;
      const token = name.toLowerCase();
      if (column?.isPrimaryKey === true) {
        score += 50;
      }
      if (token === 'id') {
        score += 40;
      }
      if (isContactReferenceColumnName(token)) {
        score += 25;
      }
      if (token.endsWith('_id')) {
        score += 12;
      }
      if (/(uuid|guid)$/.test(token)) {
        score += 4;
      }

      if (score > bestScore) {
        bestScore = score;
        best = column;
      }
    }

    return best && bestScore > 0 ? best : null;
  }

  function pickLabelColumn(columns, excludedName = '') {
    const source = Array.isArray(columns) ? columns : [];
    const excludedToken = String(excludedName || '').trim();
    const preferred = source.find((column) => {
      const name = String(column?.name || '').trim();
      return name && name !== excludedToken && isLabelColumnName(name);
    });
    if (preferred) {
      return preferred;
    }

    const fallback = source.find((column) => {
      const name = String(column?.name || '').trim();
      return name && name !== excludedToken && !isLikelyIdColumnName(name);
    });
    return fallback || null;
  }

  function buildContactAnchorCandidates(snapshot, signals, meProfile = null, limit = 8) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
    const hasPhoneSignals = Array.isArray(signals?.phones) && signals.phones.length > 0;
    const hasEmailSignals = Array.isArray(signals?.emails) && signals.emails.length > 0;
    if (!hasPhoneSignals && !hasEmailSignals) {
      return [];
    }

    const output = [];
    for (const table of tables) {
      const columns = Array.isArray(table?.columns) ? table.columns : [];
      if (!columns.length) {
        continue;
      }

      const relevanceLevel = classifyTableRelevanceLevel(table, { allowContact: true });
      if (relevanceLevel === 'support') {
        continue;
      }

      const phoneColumns = columns.filter((column) => isPhoneColumnName(column?.name)).slice(0, 6);
      const emailColumns = columns.filter((column) => isEmailColumnName(column?.name)).slice(0, 6);
      if (!phoneColumns.length && !emailColumns.length) {
        continue;
      }

      const idColumn = pickIdColumn(columns);
      if (!idColumn?.name) {
        continue;
      }

      const ownerBinding = findOwnerAssignmentColumn(table, meProfile);

      const labelColumn = pickLabelColumn(columns, idColumn.name) || idColumn;
      const estimatedRows = Number(table?.estimatedRows) || 0;
      const rowScore = estimatedRows > 0 ? Math.max(0, Math.min(18, 18 - Math.log10(estimatedRows + 1) * 4)) : 4;
      const contactBoost = isContactTableName(table?.name) ? 16 : 0;
      const signalBoost = phoneColumns.length && emailColumns.length ? 8 : 4;
      const idBoost = idColumn?.isPrimaryKey === true ? 8 : 3;

      output.push({
        table,
        idColumn,
        labelColumn,
        phoneColumns,
        emailColumns,
        ownerColumn: ownerBinding.ownerColumn || null,
        relevanceLevel,
        priorityHint: Math.round(rowScore + contactBoost + signalBoost + idBoost)
      });
    }

    output.sort((left, right) => right.priorityHint - left.priorityHint);
    return output.slice(0, Math.max(1, Math.min(20, Number(limit) || 8)));
  }

  async function queryContactMatchesForCandidate(connectionUrl, candidate, signals) {
    const table = candidate?.table && typeof candidate.table === 'object' ? candidate.table : null;
    const idColumn = candidate?.idColumn && typeof candidate.idColumn === 'object' ? candidate.idColumn : null;
    const labelColumn =
      candidate?.labelColumn && typeof candidate.labelColumn === 'object' ? candidate.labelColumn : idColumn;
    const phoneColumns = Array.isArray(candidate?.phoneColumns) ? candidate.phoneColumns : [];
    const emailColumns = Array.isArray(candidate?.emailColumns) ? candidate.emailColumns : [];
    if (!table || !idColumn?.name || !labelColumn?.name) {
      return [];
    }

    const schemaName = String(table.schema || '').trim();
    const tableName = String(table.name || '').trim();
    if (!schemaName || !tableName) {
      return [];
    }

    const phoneValues = (Array.isArray(signals?.phones) ? signals.phones : [])
      .map((item) => item?.normalized || '')
      .map((item) => normalizePhoneSignal(item))
      .filter(Boolean)
      .slice(0, 12);
    const emailValues = (Array.isArray(signals?.emails) ? signals.emails : [])
      .map((item) => item?.normalized || '')
      .map((item) => normalizeEmailSignal(item))
      .filter(Boolean)
      .slice(0, 12);
    if (!phoneValues.length && !emailValues.length) {
      return [];
    }

    const meProfile = getCrmErpDatabaseMeProfile();
    const ownerColumnName = String(candidate?.ownerColumn?.name || '').trim();
    const ownerUserId = isCrmErpMeProfileComplete(meProfile) ? String(meProfile.userId || '').trim() : '';

    const whereTokens = [];
    if (phoneValues.length) {
      for (const column of phoneColumns) {
        const matchExpr = `CAST(${quoteSqlIdentifier(column.name)} AS text)`;
        whereTokens.push(`${buildSignalMatchExpression('phone', matchExpr)} = ANY($1::text[])`);
      }
    }
    if (emailValues.length) {
      for (const column of emailColumns) {
        const matchExpr = `CAST(${quoteSqlIdentifier(column.name)} AS text)`;
        whereTokens.push(`${buildSignalMatchExpression('email', matchExpr)} = ANY($2::text[])`);
      }
    }
    if (!whereTokens.length) {
      return [];
    }

    const qualifiedTable = `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
    const idExpr = `TRIM(CAST(${quoteSqlIdentifier(idColumn.name)} AS text))`;
    const labelExpr = `COALESCE(NULLIF(TRIM(CAST(${quoteSqlIdentifier(
      labelColumn.name
    )} AS text)), ''), NULLIF(${idExpr}, ''), '(sin etiqueta)')`;
    const ownerFilterSql =
      ownerColumnName && ownerUserId
        ? `AND TRIM(CAST(${quoteSqlIdentifier(ownerColumnName)} AS text)) = $3`
        : '';
    const sql = [
      'SELECT item_id, item_label, item_count',
      'FROM (',
      `  SELECT ${idExpr} AS item_id, ${labelExpr} AS item_label, COUNT(*)::int AS item_count`,
      `  FROM ${qualifiedTable}`,
      `  WHERE (${whereTokens.join(' OR ')})`,
      `  ${ownerFilterSql}`,
      '  GROUP BY 1, 2',
      ') grouped',
      "WHERE item_id <> ''",
      'ORDER BY item_count DESC, item_label ASC',
      'LIMIT 12;'
    ].join('\n');

    const params = [phoneValues, emailValues];
    if (ownerFilterSql) {
      params.push(ownerUserId);
    }
    logDebug('whatsapp_contact:lookup_sql', {
      table: `${schemaName}.${tableName}`,
      ownerColumn: ownerColumnName || '',
      ownerFilterActive: Boolean(ownerFilterSql),
      sql,
      params: sanitizeSqlParamsForLog(params)
    });
    const response = await postgresService.queryRead(connectionUrl, sql, params, {
      maxRows: 20
    });
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    logDebug('whatsapp_contact:lookup_result', {
      table: `${schemaName}.${tableName}`,
      rowCount: rows.length,
      preview: rows.slice(0, 5).map((row) => ({
        item_id: toSafeLogText(row?.item_id || '', 80),
        item_label: toSafeLogText(row?.item_label || '', 140),
        item_count: Math.max(0, Number(row?.item_count) || 0)
      }))
    });
    return rows
      .map((row) => {
        const id = normalizeIdSignal(row?.item_id || '');
        if (!id) {
          return null;
        }
        const label = toSafeDynamicUiText(row?.item_label || id, 140) || id;
        const count = Math.max(0, Number(row?.item_count) || 0) || 1;
        return { id, label, count };
      })
      .filter(Boolean);
  }

  function buildContactSignalEntries(contactRows, limit = 12) {
    const entries = [];
    const seen = new Set();
    for (const row of Array.isArray(contactRows) ? contactRows : []) {
      const id = normalizeIdSignal(row?.id || '');
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const label = toSafeDynamicUiText(row?.label || '', 140);
      const value = label ? `${label} (${id})` : id;
      entries.push({
        normalized: id,
        value: toSafeDynamicUiText(value, 180) || id
      });
      if (entries.length >= Math.max(1, Math.min(20, Number(limit) || 12))) {
        break;
      }
    }
    return entries;
  }

  function buildRelatedTableCandidatesFromContactAnchor(
    snapshot,
    anchorCandidate,
    meProfile = null,
    limit = 12
  ) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
    const anchorTable = anchorCandidate?.table && typeof anchorCandidate.table === 'object' ? anchorCandidate.table : null;
    const anchorIdColumn =
      anchorCandidate?.idColumn && typeof anchorCandidate.idColumn === 'object' ? anchorCandidate.idColumn : null;
    if (!anchorTable || !anchorIdColumn?.name) {
      return [];
    }

    const anchorSchema = String(anchorTable.schema || '').trim().toLowerCase();
    const anchorName = String(anchorTable.name || '').trim().toLowerCase();
    const anchorQualified = `${anchorSchema}.${anchorName}`;
    const anchorIdName = String(anchorIdColumn.name || '').trim().toLowerCase();
    const anchorSingular = anchorName.endsWith('s') ? anchorName.slice(0, -1) : anchorName;
    const anchorIdTokens = new Set([
      `${anchorName}_id`,
      `${anchorSingular}_id`,
      `${anchorName}id`,
      `${anchorSingular}id`
    ]);
    if (anchorIdName && anchorIdName !== 'id') {
      anchorIdTokens.add(anchorIdName);
    }

    const output = [];
    for (const table of tables) {
      const schemaName = String(table?.schema || '').trim();
      const tableName = String(table?.name || '').trim();
      if (!schemaName || !tableName) {
        continue;
      }
      if (`${schemaName.toLowerCase()}.${tableName.toLowerCase()}` === anchorQualified) {
        continue;
      }
      if (isContactTableName(tableName)) {
        continue;
      }

      const columns = Array.isArray(table?.columns) ? table.columns : [];
      if (!columns.length) {
        continue;
      }

      const relevanceLevel = classifyTableRelevanceLevel(table);
      if (relevanceLevel === 'support') {
        continue;
      }

      let matchColumn = columns.find((column) => {
        const foreignKey = column?.foreignKey && typeof column.foreignKey === 'object' ? column.foreignKey : null;
        if (!foreignKey) {
          return false;
        }
        const targetTable = String(foreignKey.targetTable || '').trim().toLowerCase();
        const targetSchema = String(foreignKey.targetSchema || '').trim().toLowerCase();
        const targetColumn = String(foreignKey.targetColumn || '').trim().toLowerCase();
        if (!targetTable) {
          return false;
        }
        const schemaMatches = !targetSchema || targetSchema === anchorSchema;
        const tableMatches = targetTable === anchorName;
        const columnMatches = !targetColumn || targetColumn === anchorIdName;
        return schemaMatches && tableMatches && columnMatches;
      });

      if (!matchColumn) {
        matchColumn = columns.find((column) => {
          const name = String(column?.name || '').trim().toLowerCase();
          if (!name) {
            return false;
          }
          if (isContactReferenceColumnName(name)) {
            return true;
          }
          return anchorIdTokens.has(name);
        });
      }

      if (!matchColumn?.name) {
        continue;
      }

      const ownerBinding = findOwnerAssignmentColumn(table, meProfile);

      const labelColumn = pickLabelColumn(columns, matchColumn.name) || matchColumn;
      const estimatedRows = Number(table?.estimatedRows) || 0;
      const rowScore = estimatedRows > 0 ? Math.max(0, Math.min(16, 16 - Math.log10(estimatedRows + 1) * 4)) : 4;
      const fkBoost = matchColumn?.foreignKey ? 12 : 5;
      const nameBoost = isSecondLevelRelationTableName(tableName) ? 10 : 0;
      const relevanceBoost = relevanceLevel === 'high' ? 10 : relevanceLevel === 'medium' ? 4 : 0;

      output.push({
        table,
        matchColumn,
        labelColumn,
        ownerColumn: ownerBinding.ownerColumn || null,
        relevanceLevel,
        priorityHint: Math.round(rowScore + fkBoost + nameBoost + relevanceBoost)
      });
    }

    output.sort((left, right) => right.priorityHint - left.priorityHint);
    return output.slice(0, Math.max(1, Math.min(24, Number(limit) || 12)));
  }

  async function fetchWhatsappContactFirstRelationCards(connectionUrl, snapshot, tabContext, signals) {
    if (!isWhatsappContext(tabContext)) {
      return [];
    }

    const directSignals = buildWhatsappDirectSignals(tabContext, signals);
    const meProfile = getCrmErpDatabaseMeProfile();
    const anchors = buildContactAnchorCandidates(snapshot, directSignals, meProfile, 10);
    logDebug('whatsapp_contact:anchor_candidates', {
      candidateCount: anchors.length,
      candidates: anchors.slice(0, 8).map((candidate) => ({
        table: toSafeLogText(candidate?.table?.qualifiedName || '', 200),
        idColumn: toSafeLogText(candidate?.idColumn?.name || '', 80),
        ownerColumn: toSafeLogText(candidate?.ownerColumn?.name || '', 80),
        priorityHint: Math.max(0, Number(candidate?.priorityHint) || 0)
      }))
    });
    if (!anchors.length) {
      return [];
    }

    let selectedAnchor = null;
    let matchedContacts = [];
    for (const candidate of anchors) {
      let rows = [];
      try {
        rows = await queryContactMatchesForCandidate(connectionUrl, candidate, directSignals);
        if (!rows.length) {
          rows = await queryContactMatchesForCandidate(connectionUrl, candidate, signals);
        }
      } catch (_) {
        rows = [];
      }
      if (!rows.length) {
        continue;
      }
      selectedAnchor = candidate;
      matchedContacts = rows;
      break;
    }

    if (!selectedAnchor || !matchedContacts.length) {
      return [];
    }

    const contactSignals = buildContactSignalEntries(matchedContacts, 12);
    const contactIds = contactSignals.map((item) => item.normalized).filter(Boolean);
    logDebug('whatsapp_contact:resolved_contact_ids', {
      table: toSafeLogText(selectedAnchor?.table?.qualifiedName || '', 200),
      contactIds: contactIds.slice(0, 12),
      contactSignals: contactSignals.slice(0, 12)
    });
    if (!contactIds.length) {
      return [];
    }

    const cards = [];
    const relatedCandidates = buildRelatedTableCandidatesFromContactAnchor(
      snapshot,
      selectedAnchor,
      meProfile,
      14
    );
    const secondLevelTasks = relatedCandidates.map((candidate) =>
      queryRelationCardForCandidate(connectionUrl, candidate, 'contact_id', contactIds, contactSignals)
    );
    const settled = await Promise.all(secondLevelTasks.map((task) => task.catch(() => null)));
    for (const result of settled) {
      if (!result) {
        continue;
      }
      cards.push(result);
    }

    logDebug('whatsapp_contact:second_level_relations', {
      tableCount: cards.length,
      tables: cards.map((card) => ({
        table: toSafeLogText(card?.tableQualifiedName || '', 200),
        count: Math.max(0, Number(card?.totalCount) || 0),
        caption: toSafeLogText(card?.caption || '', 160)
      }))
    });

    return collapseRelationCardsByTable(cards);
  }

  function buildRelationTableCandidates(snapshot, signalType, options = {}) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    const tables = Array.isArray(safeSnapshot?.tables) ? safeSnapshot.tables : [];
    const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
    const excludeContactTables = options.excludeContactTables === true;
    const meProfile = options.meProfile && typeof options.meProfile === 'object' ? options.meProfile : null;
    const output = [];

    for (const table of tables) {
      const tableName = String(table?.name || '').trim();
      if (!tableName) {
        continue;
      }
      if (excludeContactTables && isContactTableName(tableName)) {
        continue;
      }

      const relevanceLevel = classifyTableRelevanceLevel(table, { allowContact: !excludeContactTables });
      if (relevanceLevel === 'support') {
        continue;
      }

      const columns = Array.isArray(table?.columns) ? table.columns : [];
      if (!columns.length) {
        continue;
      }

      const matchColumn =
        signalType === 'phone'
          ? columns.find((column) => isPhoneColumnName(column?.name))
          : columns.find((column) => isEmailColumnName(column?.name));
      if (!matchColumn || !matchColumn.name) {
        continue;
      }

      const ownerBinding = findOwnerAssignmentColumn(table, meProfile);

      let labelColumn = columns.find((column) => {
        const name = String(column?.name || '');
        return name && name !== matchColumn.name && isLabelColumnName(name);
      });
      if (!labelColumn) {
        labelColumn = matchColumn;
      }

      const estimatedRows = Number(table?.estimatedRows) || 0;
      const rowScore = estimatedRows > 0 ? Math.max(0, Math.min(18, 18 - Math.log10(estimatedRows + 1) * 4)) : 4;
      const nameBoost = /(task|deal|lead|contact|customer|client|message|ticket|opportunity|activity)/.test(
        tableName.toLowerCase()
      )
        ? 8
        : 0;
      const relevanceBoost = relevanceLevel === 'high' ? 10 : relevanceLevel === 'medium' ? 4 : 0;

      output.push({
        table,
        matchColumn,
        labelColumn,
        ownerColumn: ownerBinding.ownerColumn || null,
        relevanceLevel,
        priorityHint: Math.round(rowScore + nameBoost + relevanceBoost)
      });
    }

    output.sort((left, right) => right.priorityHint - left.priorityHint);
    return output.slice(0, limit);
  }

  function fieldLabelFromColumnName(value) {
    const token = String(value || '')
      .replace(/[_-]+/g, ' ')
      .trim();
    if (!token) {
      return 'Field';
    }
    return token
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .map((item) => item.charAt(0).toUpperCase() + item.slice(1).toLowerCase())
      .join(' ');
  }

  function pickRelationDetailColumns(table, options = {}) {
    const columns = Array.isArray(table?.columns) ? table.columns : [];
    const excluded = new Set(
      [
        String(options.matchColumnName || '').trim().toLowerCase(),
        String(options.labelColumnName || '').trim().toLowerCase(),
        String(options.ownerColumnName || '').trim().toLowerCase()
      ].filter(Boolean)
    );

    const preferredPatterns = [
      /^(status|stage|priority|state)$/,
      /(due|deadline|start|end|date|time)/,
      /(amount|value|total|budget|price)/,
      /(title|name|subject)/,
      /(source|channel|type|category)/
    ];

    const candidates = [];
    for (const column of columns) {
      const rawName = String(column?.name || '').trim();
      const name = rawName.toLowerCase();
      if (!rawName || excluded.has(name)) {
        continue;
      }
      if (isLikelyIdColumnName(name) || isContactReferenceColumnName(name) || isOwnerAssignmentColumnName(name)) {
        continue;
      }

      let score = 0;
      preferredPatterns.forEach((pattern, index) => {
        if (pattern.test(name)) {
          score += Math.max(1, 12 - index * 2);
        }
      });
      if (isLabelColumnName(name)) {
        score += 2;
      }
      if (column?.nullable !== true) {
        score += 1;
      }

      candidates.push({
        name: rawName,
        score
      });
    }

    candidates.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    return candidates.slice(0, 3);
  }

  async function queryRelationCardForCandidate(connectionUrl, candidate, signalType, normalizedValues, sourceSignals) {
    const table = candidate?.table && typeof candidate.table === 'object' ? candidate.table : null;
    const matchColumn = candidate?.matchColumn && typeof candidate.matchColumn === 'object' ? candidate.matchColumn : null;
    const labelColumn = candidate?.labelColumn && typeof candidate.labelColumn === 'object' ? candidate.labelColumn : null;
    if (!table || !matchColumn?.name || !labelColumn?.name) {
      return null;
    }

    const schemaName = String(table.schema || '').trim();
    const tableName = String(table.name || '').trim();
    if (!schemaName || !tableName) {
      return null;
    }

    const normalizedSignals = (Array.isArray(normalizedValues) ? normalizedValues : [])
      .map((item) =>
        signalType === 'phone'
          ? normalizePhoneSignal(item)
          : signalType === 'email'
            ? normalizeEmailSignal(item)
            : normalizeIdSignal(item)
      )
      .filter(Boolean)
      .slice(0, 12);
    if (!normalizedSignals.length) {
      return null;
    }

    const ownerColumnName = String(candidate?.ownerColumn?.name || '').trim();
    const meProfile = getCrmErpDatabaseMeProfile();
    const ownerUserId = isCrmErpMeProfileComplete(meProfile) ? String(meProfile.userId || '').trim() : '';

    const qualifiedTable = `${quoteSqlIdentifier(schemaName)}.${quoteSqlIdentifier(tableName)}`;
    const matchExpr = `CAST(${quoteSqlIdentifier(matchColumn.name)} AS text)`;
    const normalizedExpr = buildSignalMatchExpression(signalType, matchExpr);
    const labelExprRaw = `CAST(${quoteSqlIdentifier(labelColumn.name)} AS text)`;
    const labelExpr = `COALESCE(NULLIF(TRIM(${labelExprRaw}), ''), NULLIF(TRIM(${matchExpr}), ''), '(sin etiqueta)')`;
    const whereClauses = [`${normalizedExpr} = ANY($1::text[])`];
    const params = [normalizedSignals];
    if (ownerColumnName && ownerUserId) {
      params.push(ownerUserId);
      whereClauses.push(`TRIM(CAST(${quoteSqlIdentifier(ownerColumnName)} AS text)) = $${params.length}`);
    }
    const whereSql = whereClauses.join(' AND ');
    const sql = [
      'SELECT item_label, item_count, SUM(item_count) OVER()::int AS total_count',
      'FROM (',
      `  SELECT ${labelExpr} AS item_label, COUNT(*)::int AS item_count`,
      `  FROM ${qualifiedTable}`,
      `  WHERE ${whereSql}`,
      '  GROUP BY 1',
      ') grouped',
      'ORDER BY item_count DESC, item_label ASC',
      'LIMIT 4;'
    ].join('\n');

    logDebug('dynamic_relations:query_sql', {
      table: `${schemaName}.${tableName}`,
      signalType,
      ownerColumn: ownerColumnName || '',
      ownerFilterActive: Boolean(ownerColumnName && ownerUserId),
      sql,
      params: sanitizeSqlParamsForLog(params)
    });
    const response = await postgresService.queryRead(connectionUrl, sql, params, {
      maxRows: 4
    });
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    logDebug('dynamic_relations:query_result', {
      table: `${schemaName}.${tableName}`,
      signalType,
      rowCount: rows.length,
      preview: rows.slice(0, 4).map((row) => ({
        label: toSafeLogText(row?.item_label || '', 120),
        count: Math.max(0, Number(row?.item_count) || 0),
        total: Math.max(0, Number(row?.total_count) || 0)
      }))
    });
    if (!rows.length) {
      return null;
    }

    const relationRows = rows
      .map((row) => {
        const label = toSafeDynamicUiText(row?.item_label || '', 120) || '(sin etiqueta)';
        const count = Math.max(0, Number(row?.item_count) || 0);
        if (!count) {
          return null;
        }
        return { label, count };
      })
      .filter(Boolean)
      .slice(0, 3);

    if (!relationRows.length) {
      return null;
    }

    const totalCount =
      Math.max(0, Number(rows[0]?.total_count) || 0) || relationRows.reduce((sum, row) => sum + row.count, 0);
    const isSingleResult = totalCount === 1;
    const detailColumns = isSingleResult
      ? pickRelationDetailColumns(table, {
          matchColumnName: matchColumn.name,
          labelColumnName: labelColumn.name,
          ownerColumnName
        })
      : [];
    let detailFields = [];
    if (isSingleResult && detailColumns.length) {
      const detailSelect = detailColumns
        .map(
          (column) =>
            `NULLIF(TRIM(CAST(${quoteSqlIdentifier(column.name)} AS text)), '') AS ${quoteSqlIdentifier(
              column.name
            )}`
        )
        .join(', ');
      const detailSql = [
        `SELECT ${detailSelect}`,
        `FROM ${qualifiedTable}`,
        `WHERE ${whereSql}`,
        'LIMIT 1;'
      ].join('\n');
      logDebug('dynamic_relations:detail_sql', {
        table: `${schemaName}.${tableName}`,
        signalType,
        sql: detailSql,
        params: sanitizeSqlParamsForLog(params)
      });
      try {
        const detailResponse = await postgresService.queryRead(connectionUrl, detailSql, params, { maxRows: 1 });
        const detailRow = Array.isArray(detailResponse?.rows) ? detailResponse.rows[0] || null : null;
        if (detailRow && typeof detailRow === 'object') {
          detailFields = detailColumns
            .map((column) => {
              const rawValue = toSafeDynamicUiText(detailRow[column.name] || '', 120);
              if (!rawValue) {
                return null;
              }
              return {
                label: fieldLabelFromColumnName(column.name),
                value: rawValue
              };
            })
            .filter(Boolean)
            .slice(0, 3);
        }
      } catch (_) {
        detailFields = [];
      }
    }

    const cardRows =
      isSingleResult && detailFields.length
        ? detailFields.map((item) => ({
            label: item.label,
            value: item.value
          }))
        : relationRows;

    const normalizedToRaw = {};
    for (const signal of Array.isArray(sourceSignals) ? sourceSignals : []) {
      if (!signal?.normalized || normalizedToRaw[signal.normalized]) {
        continue;
      }
      normalizedToRaw[signal.normalized] = signal.value || signal.normalized;
    }
    for (const value of normalizedSignals) {
      if (!normalizedToRaw[value]) {
        normalizedToRaw[value] = value;
      }
    }

    const relevanceLevel = String(candidate?.relevanceLevel || '').trim().toLowerCase();
    const relevanceLabel =
      relevanceLevel === 'high'
        ? 'Relevancia alta'
        : relevanceLevel === 'medium'
          ? 'Relevancia media'
          : relevanceLevel === 'low'
            ? 'Relevancia baja'
            : '';
    const captionTokens = [`${totalCount} resultado${totalCount === 1 ? '' : 's'}`];
    if (ownerColumnName) {
      captionTokens.push('Asignado a mi');
    }
    if (relevanceLabel) {
      captionTokens.push(relevanceLabel);
    }
    const detailDescription =
      isSingleResult && detailFields.length
        ? detailFields.map((item) => `${item.label}: ${item.value}`).join(' | ')
        : '';

    return {
      id: `${table.qualifiedName || `${schemaName}.${tableName}`}::${signalType}`,
      title: tableTitleFromName(tableName),
      caption: captionTokens.join(' · '),
      description: detailDescription,
      tableName,
      tableQualifiedName: String(table.qualifiedName || `${schemaName}.${tableName}`),
      signalType,
      totalCount,
      priorityHint: Math.max(0, Number(candidate?.priorityHint) || 0),
      rows: cardRows,
      detailFields,
      meta: {
        schema: schemaName,
        table: tableName,
        matchColumn: String(matchColumn.name || ''),
        labelColumn: String(labelColumn.name || ''),
        ownerColumn: ownerColumnName,
        signalType,
        normalizedSignals: normalizedSignals.slice(0, 12),
        normalizedToRaw,
        singleResult: isSingleResult,
        relevanceLevel
      }
    };
  }

  function collapseRelationCardsByTable(cards) {
    const byTable = new Map();
    for (const card of Array.isArray(cards) ? cards : []) {
      const tableKey = String(card?.tableQualifiedName || '').trim();
      if (!tableKey) {
        continue;
      }
      const known = byTable.get(tableKey);
      const nextTotal = Number(card?.totalCount) || 0;
      const knownTotal = Number(known?.totalCount) || 0;
      const nextPriority = Number(card?.priorityHint) || 0;
      const knownPriority = Number(known?.priorityHint) || 0;
      if (!known || nextTotal > knownTotal || (nextTotal === knownTotal && nextPriority > knownPriority)) {
        byTable.set(tableKey, card);
      }
    }
    return Array.from(byTable.values());
  }

  function buildDynamicRelationsSignalKey(tabContext, signals) {
    const tabId = Number(tabContext?.tabId) || -1;
    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    const schemaStamp = Number(snapshot?.analyzedAt) || 0;
    const meProfile = getCrmErpDatabaseMeProfile();
    const meKey = isCrmErpMeProfileComplete(meProfile)
      ? `${meProfile.tableQualifiedName}|${meProfile.idColumn}|${meProfile.userId}`
      : 'me:none';
    const phones = (Array.isArray(signals?.phones) ? signals.phones : []).map((item) => item?.normalized || '').filter(Boolean);
    const emails = (Array.isArray(signals?.emails) ? signals.emails : []).map((item) => item?.normalized || '').filter(Boolean);
    return `${tabId}|${schemaStamp}|${meKey}|p:${phones.join(',')}|e:${emails.join(',')}`;
  }

  async function fetchDynamicRelationCards(tabContext, signals) {
    const connectionUrl = getCrmErpDatabaseConnectionUrl();
    const snapshot = getCrmErpDatabaseSchemaSnapshot();
    if (!connectionUrl || !snapshot) {
      return [];
    }
    const meProfile = getCrmErpDatabaseMeProfile();
    const isWhatsappTab = isWhatsappContext(tabContext);
    if (isWhatsappTab) {
      logDebug('whatsapp_contact:fetch_relations_start', {
        tabId: Number(tabContext?.tabId) || -1,
        signalPhones: (Array.isArray(signals?.phones) ? signals.phones : []).map(
          (item) => item?.normalized || ''
        ),
        signalEmails: (Array.isArray(signals?.emails) ? signals.emails : []).map(
          (item) => item?.normalized || ''
        ),
        meProfile: isCrmErpMeProfileComplete(meProfile)
          ? {
              table: toSafeLogText(meProfile.tableQualifiedName || '', 180),
              idColumn: toSafeLogText(meProfile.idColumn || '', 80),
              userId: toSafeLogText(meProfile.userId || '', 80)
            }
          : null
      });
    }

    const whatsappContactFirstCards = await fetchWhatsappContactFirstRelationCards(
      connectionUrl,
      snapshot,
      tabContext,
      signals
    );
    if (whatsappContactFirstCards.length) {
      if (isWhatsappTab) {
        logDebug('whatsapp_contact:fetch_relations_contact_id_success', {
          relationTables: whatsappContactFirstCards.map((card) =>
            toSafeLogText(card?.tableQualifiedName || card?.title || '', 200)
          )
        });
      }
      return whatsappContactFirstCards;
    }
    if (isWhatsappTab) {
      logDebug('whatsapp_contact:fetch_relations_fallback_signal_scan');
    }

    const phoneSignals = Array.isArray(signals?.phones) ? signals.phones : [];
    const emailSignals = Array.isArray(signals?.emails) ? signals.emails : [];
    const tasks = [];

    if (phoneSignals.length) {
      const phoneCandidates = buildRelationTableCandidates(snapshot, 'phone', {
        limit: 8,
        excludeContactTables: isWhatsappTab,
        meProfile
      });
      const phoneValues = phoneSignals.map((item) => item.normalized).filter(Boolean).slice(0, 8);
      for (const candidate of phoneCandidates) {
        tasks.push(queryRelationCardForCandidate(connectionUrl, candidate, 'phone', phoneValues, phoneSignals));
      }
    }

    if (emailSignals.length) {
      const emailCandidates = buildRelationTableCandidates(snapshot, 'email', {
        limit: 8,
        excludeContactTables: isWhatsappTab,
        meProfile
      });
      const emailValues = emailSignals.map((item) => item.normalized).filter(Boolean).slice(0, 8);
      for (const candidate of emailCandidates) {
        tasks.push(queryRelationCardForCandidate(connectionUrl, candidate, 'email', emailValues, emailSignals));
      }
    }

    if (!tasks.length) {
      return [];
    }

    const settled = await Promise.all(tasks.map((task) => task.catch(() => null)));
    const found = settled.filter(Boolean);
    return collapseRelationCardsByTable(found);
  }

  async function refreshDynamicRelationsContext(tabContext, signals, options = {}) {
    const activeTab = tabContext && typeof tabContext === 'object' ? tabContext : null;
    const safeSignals = signals && typeof signals === 'object' ? signals : { phones: [], emails: [] };
    const phoneCount = Array.isArray(safeSignals.phones) ? safeSignals.phones.length : 0;
    const emailCount = Array.isArray(safeSignals.emails) ? safeSignals.emails.length : 0;
    const hasAnySignal = phoneCount > 0 || emailCount > 0;
    const hasDbUrl = Boolean(getCrmErpDatabaseConnectionUrl());
    const hasSchema = Boolean(getCrmErpDatabaseSchemaSnapshot());
    const force = options.force === true;
    const signalKey = buildDynamicRelationsSignalKey(activeTab, safeSignals);

    if (!activeTab || activeTab.tabId < 0) {
      dynamicRelationsContextState = {
        signalKey: '',
        loading: false,
        cards: [],
        message: '',
        isError: false
      };
      renderAiDynamicContext();
      return;
    }

    if (!hasAnySignal) {
      dynamicRelationsContextState = {
        signalKey,
        loading: false,
        cards: [],
        message: 'Sin phone/email detectados en la pestana activa.',
        isError: false
      };
      renderAiDynamicContext();
      return;
    }

    if (!hasDbUrl) {
      dynamicRelationsContextState = {
        signalKey,
        loading: false,
        cards: [],
        message: 'Configura PostgreSQL en Settings para habilitar relaciones.',
        isError: false
      };
      renderAiDynamicContext();
      return;
    }

    if (!hasSchema) {
      dynamicRelationsContextState = {
        signalKey,
        loading: false,
        cards: [],
        message: 'Analiza el schema de PostgreSQL para mapear tablas relacionadas.',
        isError: false
      };
      renderAiDynamicContext();
      return;
    }

    if (!force && dynamicRelationsContextState.signalKey === signalKey && !dynamicRelationsContextState.loading) {
      return;
    }

    const token = ++dynamicRelationsFetchToken;
    dynamicRelationsContextState = {
      signalKey,
      loading: true,
      cards: dynamicRelationsContextState.cards,
      message: 'Buscando relaciones en PostgreSQL...',
      isError: false
    };
    renderAiDynamicContext();

    try {
      const cards = await fetchDynamicRelationCards(activeTab, safeSignals);
      if (token !== dynamicRelationsFetchToken) {
        return;
      }
      dynamicRelationsContextState = {
        signalKey,
        loading: false,
        cards,
        message: cards.length
          ? `${cards.length} tabla${cards.length === 1 ? '' : 's'} con relaciones detectadas.`
          : 'No se encontraron relaciones para los signals detectados.',
        isError: false
      };
      renderAiDynamicContext();
    } catch (error) {
      if (token !== dynamicRelationsFetchToken) {
        return;
      }
      dynamicRelationsContextState = {
        signalKey,
        loading: false,
        cards: [],
        message: error instanceof Error ? error.message : 'No se pudo consultar relaciones en PostgreSQL.',
        isError: true
      };
      renderAiDynamicContext();
    }
  }

  function setWhatsappSuggestionUiStatus(message = '', isError = false, options = {}) {
    whatsappSuggestionUiStatus = {
      message: String(message || ''),
      isError: isError === true,
      loading: options.loading === true
    };
  }

  function hideWhatsappSuggestion() {
    whatsappSuggestionToken += 1;
    whatsappSuggestionState = {
      tabId: -1,
      chatKey: '',
      signalKey: '',
      promptSignature: '',
      text: '',
      loading: false
    };
    setWhatsappSuggestionUiStatus('', false);
    setStatus(whatsappSuggestionStatus, '');
    renderAiDynamicContext();
  }

  function dismissWhatsappSuggestion() {
    whatsappSuggestionDismissedSignalKey = whatsappSuggestionState.signalKey || '';
    hideWhatsappSuggestion();
  }

  function setWhatsappSuggestionLoading(tabContext) {
    setWhatsappSuggestionUiStatus('Generando sugerencia...', false, { loading: true });
    setStatus(whatsappSuggestionStatus, 'Generando sugerencia...', false, { loading: true });
    renderAiDynamicContext(tabContext);
  }

  function setWhatsappSuggestionResult(tabContext, suggestion) {
    const text = String(suggestion || '').trim();

    if (!text) {
      hideWhatsappSuggestion();
      return;
    }

    setWhatsappSuggestionUiStatus('Sugerencia lista.', false);
    setStatus(whatsappSuggestionStatus, 'Sugerencia lista.');
    renderAiDynamicContext(tabContext);
  }

  function buildWhatsappDynamicSuggestion(activeTab) {
    if (!activeTab || !isWhatsappContext(activeTab)) {
      return null;
    }

    const hasText = Boolean(whatsappSuggestionState.text);
    const hasStatus = Boolean(whatsappSuggestionUiStatus.message);
    if (!hasText && !whatsappSuggestionState.loading && !hasStatus) {
      return null;
    }

    const fallbackDescription = whatsappSuggestionState.loading
      ? 'Generando sugerencia contextual...'
      : whatsappSuggestionUiStatus.isError
        ? 'No se pudo generar la sugerencia para este chat.'
        : 'Sugerencia lista para ejecutar.';

    return {
      id: 'ai-whatsapp-reply',
      source: 'ai_generated',
      site: 'whatsapp',
      title: 'Next message',
      caption: buildWhatsappMetaLabel(activeTab),
      description: whatsappSuggestionState.text || fallbackDescription,
      statusText: whatsappSuggestionUiStatus.message,
      statusError: whatsappSuggestionUiStatus.isError,
      loading: whatsappSuggestionState.loading || whatsappSuggestionExecutionInFlight,
      canExecute: Boolean(whatsappSuggestionState.text) && !whatsappSuggestionExecutionInFlight && !whatsappSuggestionState.loading,
      canRegenerate: !whatsappSuggestionState.loading && !whatsappSuggestionExecutionInFlight,
      priorityHint: 100,
      actionType: 'whatsapp_send_suggestion',
      actionPayload: {
        tabId: Number(activeTab.tabId) || -1
      }
    };
  }

  function buildPredefinedDynamicSuggestions(activeTab, signals) {
    const tab = activeTab && typeof activeTab === 'object' ? activeTab : null;
    if (!tab) {
      return [];
    }

    const site = String(tab.site || 'generic').toLowerCase();
    const phoneCount = Array.isArray(signals?.phones) ? signals.phones.length : 0;
    const emailCount = Array.isArray(signals?.emails) ? signals.emails.length : 0;
    const output = [];

    output.push({
      id: 'predef-chat-context',
      source: 'predefined',
      site,
      title: 'Context to chat',
      caption: site,
      description: 'Prepara un prompt con el contexto actual para continuar en el chat.',
      canExecute: true,
      canRegenerate: false,
      priorityHint: 25,
      actionType: 'prefill_chat_context',
      actionPayload: {
        tabId: Number(tab.tabId) || -1
      }
    });

    if (isWhatsappContext(tab)) {
      output.push({
        id: 'predef-whatsapp-archive-groups',
        source: 'predefined',
        site: 'whatsapp',
        title: 'Archive groups',
        caption: 'WhatsApp',
        description: 'Archiva grupos de la inbox (workflow rapido).',
        canExecute: true,
        canRegenerate: false,
        priorityHint: 48,
        actionType: 'whatsapp_archive_groups',
        actionPayload: {
          tabId: Number(tab.tabId) || -1
        }
      });
    }

    if (phoneCount + emailCount > 0) {
      output.push({
        id: 'predef-refresh-relations',
        source: 'predefined',
        site,
        title: 'Refresh relations',
        caption: `${phoneCount} phone / ${emailCount} email`,
        description: 'Regenera relaciones detectadas por sensors de navegacion.',
        canExecute: true,
        canRegenerate: false,
        priorityHint: 36,
        actionType: 'refresh_relations',
        actionPayload: {
          force: true
        }
      });
    }

    return output;
  }

  function buildDynamicSuggestions(activeTab, signals) {
    const suggestions = [...buildPredefinedDynamicSuggestions(activeTab, signals)];
    const whatsappSuggestion = buildWhatsappDynamicSuggestion(activeTab);
    if (whatsappSuggestion) {
      suggestions.push(whatsappSuggestion);
    }
    return suggestions;
  }

  function createDynamicActionButton(options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = String(options.className || 'icon-btn icon-btn--ghost');
    button.dataset.suggestionAction = String(options.action || '');
    button.dataset.suggestionId = String(options.suggestionId || '');
    button.setAttribute('aria-label', String(options.ariaLabel || 'Accion'));
    button.title = String(options.title || options.ariaLabel || 'Accion');
    button.disabled = options.disabled === true;
    button.innerHTML = String(options.svg || '');
    return button;
  }

  function createDynamicEmptyCard(text) {
    const empty = document.createElement('div');
    empty.className = 'ai-dynamic-empty';
    empty.textContent = String(text || 'Sin datos.');
    return empty;
  }

  function appendRelationListItem(list, row) {
    if (!list) {
      return;
    }

    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = String(row?.label || '(sin etiqueta)');
    const value = document.createElement('strong');
    const hasValue = String(row?.value || '').trim();
    if (hasValue) {
      value.textContent = hasValue;
    } else {
      value.textContent = String(Math.max(0, Number(row?.count) || 0));
    }
    item.append(label, value);
    list.appendChild(item);
  }

  function summarizeRelationRow(row) {
    const label = toSafeDynamicUiText(row?.label || '', 84) || '(sin etiqueta)';
    const value = toSafeDynamicUiText(row?.value || '', 84);
    const count = Math.max(0, Number(row?.count) || 0);

    if (value) {
      return `${label}: ${value}`;
    }

    return `${label}: ${count}`;
  }

  function buildRelationSimpleColumns(cardModel) {
    const card = cardModel && typeof cardModel === 'object' ? cardModel : {};
    const title = toSafeDynamicUiText(card.title || 'Relacion', 92) || 'Relacion';
    const caption = toSafeDynamicUiText(
      card.caption || `${Math.max(0, Number(card.totalCount) || 0)} resultado${Math.max(0, Number(card.totalCount) || 0) === 1 ? '' : 's'}`,
      96
    );
    const rows = Array.isArray(card.rows) ? card.rows : [];
    const rowSummary = rows.map((row) => summarizeRelationRow(row)).filter(Boolean).slice(0, 2).join(' · ');
    const description = toSafeDynamicUiText(card.description || '', 120);
    const detail = rowSummary || description || 'Sin detalle';

    return [title, caption || '-', detail];
  }

  function showDynamicUiToast(message, isError = false, options = {}) {
    if (!dynamicUiToast) {
      return;
    }

    const text = String(message || '').trim();
    if (!text) {
      dynamicUiToast.hidden = true;
      dynamicUiToast.classList.remove('is-visible', 'is-error');
      dynamicUiToast.textContent = '';
      return;
    }

    window.clearTimeout(dynamicUiToastHideTimer);
    dynamicUiToast.textContent = text;
    dynamicUiToast.hidden = false;
    dynamicUiToast.classList.toggle('is-error', isError === true);
    dynamicUiToast.classList.add('is-visible');

    if (options.sticky === true) {
      return;
    }

    const durationMs = Math.max(1200, Math.min(7000, Number(options.durationMs) || 2400));
    dynamicUiToastHideTimer = window.setTimeout(() => {
      dynamicUiToast.classList.remove('is-visible');
      dynamicUiToast.hidden = true;
    }, durationMs);
  }

  function renderAiDynamicContext(activeTabOverride = null) {
    const activeTab = activeTabOverride && typeof activeTabOverride === 'object' ? activeTabOverride : getActiveTabContext();
    const safeSignals = dynamicContextSignals && typeof dynamicContextSignals === 'object' ? dynamicContextSignals : { phones: [], emails: [] };
    const phoneCount = Array.isArray(safeSignals.phones) ? safeSignals.phones.length : 0;
    const emailCount = Array.isArray(safeSignals.emails) ? safeSignals.emails.length : 0;
    const activeSite = String(activeTab?.site || 'generic').toLowerCase();
    const rawSuggestions = buildDynamicSuggestions(activeTab, safeSignals);
    const rawRelations = Array.isArray(dynamicRelationsContextState.cards) ? dynamicRelationsContextState.cards : [];
    const sorted = dynamicUiSortShowController.dynamicUiSortAndShow({
      suggestions: rawSuggestions,
      relations: rawRelations,
      activeTab,
      signals: safeSignals
    });
    const suggestions = Array.isArray(sorted?.suggestions) ? sorted.suggestions : [];
    const relations = Array.isArray(sorted?.relations) ? sorted.relations : [];
    const hasSignals = phoneCount > 0 || emailCount > 0;
    const showSuggestionsArea = suggestions.length > 0;
    const showRelationsArea = hasSignals && relations.length > 0;
    const nextSuggestionIds = new Set(suggestions.map((item) => String(item.id || '').trim()).filter(Boolean));
    const nextRelationIds = new Set(relations.map((item) => String(item.id || '').trim()).filter(Boolean));

    dynamicSuggestionIndex = new Map(suggestions.map((item) => [item.id, item]));
    dynamicRelationCardIndex = new Map(relations.map((item) => [item.id, item]));
    if (dynamicSuggestionsArea) {
      dynamicSuggestionsArea.hidden = !showSuggestionsArea;
    }
    if (dynamicRelationsArea) {
      dynamicRelationsArea.hidden = !showRelationsArea;
    }

    const metaLogKey = `${activeSite}|p:${phoneCount}|e:${emailCount}|s:${suggestions.length}|r:${relations.length}`;
    if (metaLogKey !== dynamicContextMetaLogKey) {
      dynamicContextMetaLogKey = metaLogKey;
      console.log(`${LOG_PREFIX} dynamic_context:meta`, {
        site: activeSite,
        phoneCount,
        emailCount,
        suggestionCount: suggestions.length,
        relationCount: relations.length,
        phones: Array.isArray(safeSignals.phones) ? safeSignals.phones : [],
        emails: Array.isArray(safeSignals.emails) ? safeSignals.emails : []
      });
    }

    if (dynamicSuggestionsList) {
      dynamicSuggestionsList.textContent = '';
      if (showSuggestionsArea) {
        for (const suggestion of suggestions) {
          const card = document.createElement('article');
          card.className = 'ai-dynamic-card ai-dynamic-card--suggestion';
          card.dataset.suggestionId = String(suggestion.id || '');
          const descriptionText = String(suggestion.description || '');
          card.title = descriptionText;
          if (!dynamicSuggestionRenderIds.has(card.dataset.suggestionId)) {
            card.classList.add('is-entering');
          }

          const head = document.createElement('div');
          head.className = 'ai-dynamic-card__head';

          const title = document.createElement('p');
          title.className = 'ai-dynamic-card__title';
          title.textContent = String(suggestion.title || 'Suggestion');
          title.title = title.textContent;

          const caption = document.createElement('p');
          caption.className = 'ai-dynamic-card__caption';
          caption.textContent = String(suggestion.caption || '');
          caption.title = caption.textContent;

          head.append(title, caption);

          const description = document.createElement('p');
          description.className = 'ai-dynamic-card__description ai-dynamic-card__description--suggestion-full';
          description.textContent = descriptionText;
          description.title = descriptionText;

          const actions = document.createElement('div');
          actions.className = 'ai-dynamic-card__actions ai-dynamic-card__actions--suggestion-row';

          const runButton = createDynamicActionButton({
            className: 'icon-btn icon-btn--send',
            action: 'run',
            suggestionId: suggestion.id,
            ariaLabel: 'Ejecutar sugerencia',
            title: 'Ejecutar sugerencia',
            disabled: suggestion.canExecute !== true,
            svg:
              '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path><path d="M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
          });
          actions.appendChild(runButton);

          if (suggestion.canRegenerate) {
            const regenButton = createDynamicActionButton({
              className: 'icon-btn icon-btn--ghost',
              action: 'regen',
              suggestionId: suggestion.id,
              ariaLabel: 'Regenerar sugerencia',
              title: 'Regenerar sugerencia',
              disabled: suggestion.loading === true,
              svg:
                '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4a8 8 0 0 1 5.66 2.34L20 8.68V5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 20a8 8 0 0 1-5.66-2.34L4 15.32V19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M4.34 12a8 8 0 0 1 2.05-4.83M17.61 16.83A8 8 0 0 1 12 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>'
            });
            actions.appendChild(regenButton);
          }

          card.append(head, description, actions);
          dynamicSuggestionsList.appendChild(card);
        }
      }
    }

    if (dynamicRelationsList) {
      dynamicRelationsList.textContent = '';
      if (showRelationsArea) {
        for (const cardModel of relations) {
          const card = document.createElement('article');
          card.className = 'ai-dynamic-card ai-dynamic-card--relation';
          card.dataset.relationCardId = String(cardModel.id || '');
          if (!dynamicRelationRenderIds.has(card.dataset.relationCardId)) {
            card.classList.add('is-entering');
          }
          card.tabIndex = 0;
          card.setAttribute('role', 'button');
          card.setAttribute('aria-label', `Abrir detalle de ${cardModel.title}`);
          const columns = buildRelationSimpleColumns(cardModel);
          const simpleRow = document.createElement('div');
          simpleRow.className = 'ai-dynamic-relation-simple-row';
          const columnKinds = ['title', 'meta', 'detail'];

          for (let index = 0; index < 3; index += 1) {
            const column = document.createElement('p');
            column.className = `ai-dynamic-relation-simple-col ai-dynamic-relation-simple-col--${columnKinds[index]}`;
            column.textContent = String(columns[index] || '');
            column.title = column.textContent;
            simpleRow.appendChild(column);
          }

          card.append(simpleRow);
          dynamicRelationsList.appendChild(card);
        }
      }
    }
    dynamicSuggestionRenderIds = nextSuggestionIds;
    dynamicRelationRenderIds = nextRelationIds;

    const relationToastMessage = String(dynamicRelationsContextState.message || '').trim();
    const shouldShowRelationToast = Boolean(relationToastMessage) && hasSignals;
    const relationToastKey = `${dynamicRelationsContextState.loading ? 'loading' : 'ready'}|${
      dynamicRelationsContextState.isError === true ? 'error' : 'ok'
    }|${relationToastMessage}|${showRelationsArea ? 'shown' : 'hidden'}`;
    if (shouldShowRelationToast && relationToastKey !== dynamicUiToastKey) {
      dynamicUiToastKey = relationToastKey;
      showDynamicUiToast(relationToastMessage, dynamicRelationsContextState.isError === true, {
        durationMs: dynamicRelationsContextState.loading ? 1600 : 2600
      });
    } else if (!shouldShowRelationToast) {
      dynamicUiToastKey = '';
      showDynamicUiToast('');
    }

    renderDynamicRelationDetailScreen();
  }

  function closeDynamicRelationDetailScreen() {
    dynamicRelationsDetailState = {
      open: false,
      loading: false,
      cardId: '',
      groups: [],
      message: '',
      isError: false
    };
    renderDynamicRelationDetailScreen();
  }

  function renderDynamicRelationDetailScreen() {
    if (!dynamicRelationsDetailScreen) {
      return;
    }

    dynamicRelationsDetailScreen.hidden = dynamicRelationsDetailState.open !== true;

    if (!dynamicRelationsDetailState.open) {
      return;
    }

    const card = dynamicRelationCardIndex.get(dynamicRelationsDetailState.cardId) || null;
    if (!card) {
      closeDynamicRelationDetailScreen();
      return;
    }
    if (dynamicRelationsDetailTitle) {
      dynamicRelationsDetailTitle.textContent = String(card?.title || 'Relation detail');
    }
    if (dynamicRelationsDetailMeta) {
      const tableMeta = String(card?.tableQualifiedName || '').trim();
      const captionMeta = String(card?.caption || '').trim();
      dynamicRelationsDetailMeta.textContent = [tableMeta, captionMeta].filter(Boolean).join(' · ');
    }
    if (dynamicRelationsDetailBody) {
      dynamicRelationsDetailBody.textContent = '';
      const isSingleResult = card?.meta?.singleResult === true;
      const descriptionText = String(card?.description || '').trim();
      if (isSingleResult && descriptionText) {
        const description = document.createElement('p');
        description.className = 'ai-dynamic-card__description';
        description.textContent = descriptionText;
        dynamicRelationsDetailBody.appendChild(description);
      }
      const groups = Array.isArray(dynamicRelationsDetailState.groups) ? dynamicRelationsDetailState.groups : [];
      if (!groups.length && !dynamicRelationsDetailState.loading) {
        dynamicRelationsDetailBody.appendChild(createDynamicEmptyCard('Sin grupos detectados para esta tabla.'));
      } else {
        for (const group of groups) {
          const section = document.createElement('article');
          section.className = 'dynamic-relations-group';
          const title = document.createElement('p');
          title.className = 'dynamic-relations-group__title';
          title.textContent = String(group.label || group.key || 'Signal');

          const list = document.createElement('ul');
          list.className = 'ai-dynamic-relation-list';
          for (const row of Array.isArray(group.items) ? group.items : []) {
            appendRelationListItem(list, row);
          }
          section.append(title, list);
          dynamicRelationsDetailBody.appendChild(section);
        }
      }
    }

    setStatus(
      dynamicRelationsDetailStatus,
      dynamicRelationsDetailState.message,
      dynamicRelationsDetailState.isError === true,
      { loading: dynamicRelationsDetailState.loading === true }
    );
  }

  async function fetchDynamicRelationGroups(cardModel) {
    const card = cardModel && typeof cardModel === 'object' ? cardModel : null;
    const meta = card?.meta && typeof card.meta === 'object' ? card.meta : {};
    const schema = String(meta.schema || '').trim();
    const table = String(meta.table || '').trim();
    const matchColumn = String(meta.matchColumn || '').trim();
    const labelColumn = String(meta.labelColumn || '').trim();
    const ownerColumn = String(meta.ownerColumn || '').trim();
    const signalType = String(meta.signalType || '').trim().toLowerCase();
    const normalizedSignals = Array.isArray(meta.normalizedSignals) ? meta.normalizedSignals.filter(Boolean).slice(0, 12) : [];
    if (!schema || !table || !matchColumn || !labelColumn || !normalizedSignals.length) {
      return [];
    }

    const connectionUrl = getCrmErpDatabaseConnectionUrl();
    if (!connectionUrl) {
      return [];
    }

    const qualifiedTable = `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
    const matchExpr = `CAST(${quoteSqlIdentifier(matchColumn)} AS text)`;
    const normalizedExpr = buildSignalMatchExpression(signalType, matchExpr);
    const labelExprRaw = `CAST(${quoteSqlIdentifier(labelColumn)} AS text)`;
    const labelExpr = `COALESCE(NULLIF(TRIM(${labelExprRaw}), ''), NULLIF(TRIM(${matchExpr}), ''), '(sin etiqueta)')`;
    const whereClauses = [`${normalizedExpr} = ANY($1::text[])`];
    const params = [normalizedSignals];
    if (ownerColumn) {
      const meProfile = getCrmErpDatabaseMeProfile();
      const ownerUserId = isCrmErpMeProfileComplete(meProfile) ? String(meProfile.userId || '').trim() : '';
      if (ownerUserId) {
        params.push(ownerUserId);
        whereClauses.push(`TRIM(CAST(${quoteSqlIdentifier(ownerColumn)} AS text)) = $${params.length}`);
      }
    }
    const whereSql = whereClauses.join(' AND ');
    const sql = [
      `SELECT ${normalizedExpr} AS detected_value, ${labelExpr} AS item_label, COUNT(*)::int AS item_count`,
      `FROM ${qualifiedTable}`,
      `WHERE ${whereSql}`,
      'GROUP BY 1, 2',
      'ORDER BY detected_value ASC, item_count DESC, item_label ASC',
      'LIMIT 240;'
    ].join('\n');

    logDebug('dynamic_relations:detail_groups_sql', {
      table: `${schema}.${table}`,
      signalType,
      ownerColumn: ownerColumn || '',
      sql,
      params: sanitizeSqlParamsForLog(params)
    });
    const response = await postgresService.queryRead(connectionUrl, sql, params, { maxRows: 240 });
    const rows = Array.isArray(response?.rows) ? response.rows : [];
    logDebug('dynamic_relations:detail_groups_result', {
      table: `${schema}.${table}`,
      rowCount: rows.length,
      preview: rows.slice(0, 6).map((row) => ({
        detected_value: toSafeLogText(row?.detected_value || '', 120),
        item_label: toSafeLogText(row?.item_label || '', 140),
        item_count: Math.max(0, Number(row?.item_count) || 0)
      }))
    });
    if (!rows.length) {
      return [];
    }

    const lookup = meta.normalizedToRaw && typeof meta.normalizedToRaw === 'object' ? meta.normalizedToRaw : {};
    const byGroup = new Map();
    for (const row of rows) {
      const rawKey = toSafeDynamicUiText(row?.detected_value || '', 160);
      if (!rawKey) {
        continue;
      }
      const displayKey = toSafeDynamicUiText(lookup[rawKey] || rawKey, 160) || rawKey;
      const label = toSafeDynamicUiText(row?.item_label || '(sin etiqueta)', 120) || '(sin etiqueta)';
      const count = Math.max(0, Number(row?.item_count) || 0);
      if (!byGroup.has(rawKey)) {
        byGroup.set(rawKey, {
          key: rawKey,
          label: displayKey,
          items: []
        });
      }
      byGroup.get(rawKey).items.push({ label, count });
    }

    return Array.from(byGroup.values());
  }

  async function openDynamicRelationDetailScreen(cardId) {
    const card = dynamicRelationCardIndex.get(cardId);
    if (!card) {
      return;
    }

    const singleDetailItems = Array.isArray(card?.detailFields)
      ? card.detailFields
          .map((item) => {
            const label = String(item?.label || '').trim();
            const value = String(item?.value || '').trim();
            if (!label || !value) {
              return null;
            }
            return { label, value };
          })
          .filter(Boolean)
          .slice(0, 3)
      : [];
    if (card?.meta?.singleResult === true && singleDetailItems.length) {
      dynamicRelationsDetailState = {
        open: true,
        loading: false,
        cardId,
        groups: [
          {
            key: 'single',
            label: 'Detalle',
            items: singleDetailItems
          }
        ],
        message: 'Detalle de registro unico.',
        isError: false
      };
      renderDynamicRelationDetailScreen();
      return;
    }

    dynamicRelationsDetailState = {
      open: true,
      loading: true,
      cardId,
      groups: [],
      message: 'Cargando detalles...',
      isError: false
    };
    renderDynamicRelationDetailScreen();

    try {
      const groups = await fetchDynamicRelationGroups(card);
      dynamicRelationsDetailState = {
        open: true,
        loading: false,
        cardId,
        groups,
        message: groups.length ? `${groups.length} grupo${groups.length === 1 ? '' : 's'} detectados.` : 'Sin resultados.',
        isError: false
      };
      renderDynamicRelationDetailScreen();
    } catch (error) {
      dynamicRelationsDetailState = {
        open: true,
        loading: false,
        cardId,
        groups: [],
        message: error instanceof Error ? error.message : 'No se pudo cargar el detalle.',
        isError: true
      };
      renderDynamicRelationDetailScreen();
    }
  }

  async function executeDynamicSuggestionById(suggestionId) {
    const suggestion = dynamicSuggestionIndex.get(String(suggestionId || '').trim());
    if (!suggestion) {
      return;
    }

    const activeTab = getActiveTabContext();
    switch (suggestion.actionType) {
      case 'whatsapp_send_suggestion':
        await executeWhatsappSuggestion();
        break;
      case 'prefill_chat_context': {
        const title = String(activeTab?.title || activeTab?.url || '').trim();
        const summary = String(getTabSummary(activeTab) || '').trim();
        const relationContext = String(buildActiveRelationsContextPrompt() || '').trim();
        const prompt = summary
          ? `Con este contexto de navegacion, ayudame con los siguientes pasos.\n\nTab: ${title}\nResumen: ${summary}${
              relationContext ? `\n\n${relationContext}` : ''
            }`
          : `Usa el contexto de la pestana actual (${title || 'sin titulo'}) y ayudame con los siguientes pasos.${
              relationContext ? `\n\n${relationContext}` : ''
            }`;
        if (chatInput) {
          chatInput.value = prompt;
          updateChatInputSize();
          requestChatAutofocus(6, 20);
        }
        logDebug('dynamic_suggestion:prefill_chat_context', {
          tabId: Number(activeTab?.tabId) || -1,
          title: toSafeLogText(title, 120)
        });
        break;
      }
      case 'whatsapp_archive_groups': {
        const tabId = Number(suggestion?.actionPayload?.tabId) || Number(activeTab?.tabId) || -1;
        if (tabId < 0) {
          logWarn('dynamic_suggestion:archive_groups:no_tab', {
            suggestionId: suggestion.id
          });
          return;
        }
        logDebug('dynamic_suggestion:archive_groups:start', {
          tabId
        });
        const response = await tabContextService.runSiteActionInTab(tabId, 'whatsapp', 'archiveGroups', {
          scope: 'groups',
          limit: 20,
          dryRun: false
        });
        if (!response || response.ok !== true) {
          logWarn('dynamic_suggestion:archive_groups:error', {
            tabId,
            error: response?.error || 'No se pudo archivar grupos.'
          });
          return;
        }
        logDebug('dynamic_suggestion:archive_groups:done', {
          tabId,
          response: response?.result || {}
        });
        window.setTimeout(() => {
          tabContextService.requestSnapshot();
        }, 260);
        break;
      }
      case 'refresh_relations':
        await refreshDynamicRelationsContext(activeTab, dynamicContextSignals, { force: true });
        break;
      default:
        break;
    }
  }

  async function regenerateDynamicSuggestionById(suggestionId) {
    const suggestion = dynamicSuggestionIndex.get(String(suggestionId || '').trim());
    if (!suggestion) {
      return;
    }
    if (suggestion.id === 'ai-whatsapp-reply') {
      const activeTab = getActiveTabContext();
      if (!activeTab || !isWhatsappContext(activeTab)) {
        return;
      }
      await generateWhatsappSuggestion(activeTab, { force: true });
    }
  }

  async function handleDynamicSuggestionsListClick(event) {
    const button = event.target.closest('[data-suggestion-action]');
    if (!button) {
      return;
    }
    const action = String(button.dataset.suggestionAction || '').trim();
    const suggestionId = String(button.dataset.suggestionId || '').trim();
    if (!action || !suggestionId) {
      return;
    }
    try {
      if (action === 'run') {
        await executeDynamicSuggestionById(suggestionId);
        return;
      }
      if (action === 'regen') {
        await regenerateDynamicSuggestionById(suggestionId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo ejecutar la sugerencia.';
      logWarn('dynamic_suggestion:click_error', {
        action,
        suggestionId,
        error: message
      });
    }
  }

  function handleDynamicRelationsListClick(event) {
    const card = event.target.closest('[data-relation-card-id]');
    if (!card) {
      return;
    }
    openDynamicRelationDetailScreen(String(card.dataset.relationCardId || '').trim());
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
    const basePrompt = getWhatsappSuggestionBasePrompt();
    const chatPrompt = resolveWhatsappConversationPromptForSuggestion(suggestionContext);
    const promptSignature = buildWhatsappSuggestionPromptSignature(basePrompt, chatPrompt);

    logDebug('whatsapp_suggestion:start', {
      ...contextSummary,
      force,
      signalKey: toSafeLogText(signalKey, 220),
      dismissedSignalKey: toSafeLogText(whatsappSuggestionDismissedSignalKey, 220),
      hasChatPrompt: Boolean(chatPrompt)
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

    if (
      !force &&
      whatsappSuggestionState.signalKey === signalKey &&
      whatsappSuggestionState.promptSignature === promptSignature &&
      whatsappSuggestionState.text
    ) {
      logDebug('whatsapp_suggestion:reuse_cached', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220),
        promptSignatureChars: promptSignature.length,
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
      promptSignature,
      text: whatsappSuggestionState.text,
      loading: true
    };

    setWhatsappSuggestionLoading(suggestionContext);
    const startedAt = Date.now();

    try {
      const prompt = buildWhatsappReplyPrompt(suggestionContext, {
        basePrompt,
        chatPrompt
      });
      const profileForSuggestion = resolveModelProfileForInference();
      if (!profileForSuggestion) {
        throw new Error('No hay modelo disponible para sugerencias.');
      }

      logDebug('whatsapp_suggestion:model_start', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220),
        promptSignatureChars: promptSignature.length,
        basePromptChars: basePrompt.length,
        promptChars: prompt.length,
        hasChatPrompt: Boolean(chatPrompt),
        chatPromptChars: chatPrompt.length,
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
        promptSignature,
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
        promptSignature,
        text: '',
        loading: false
      };
      const message = error instanceof Error ? error.message : 'No se pudo generar sugerencia.';
      setWhatsappSuggestionUiStatus(message, true);
      setStatus(whatsappSuggestionStatus, message, true);
      renderAiDynamicContext(suggestionContext);
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
    setWhatsappSuggestionUiStatus('Enviando mensaje...', false, { loading: true });
    setStatus(whatsappSuggestionStatus, 'Enviando mensaje...', false, { loading: true });
    renderAiDynamicContext();

    try {
      const response = await tabContextService.runSiteActionInTab(
        whatsappSuggestionState.tabId,
        'whatsapp',
        'sendMessage',
        { text: whatsappSuggestionState.text }
      );

      if (!response || response.ok !== true) {
        const message = response?.error || 'No se pudo enviar mensaje en WhatsApp.';
        setWhatsappSuggestionUiStatus(message, true);
        setStatus(whatsappSuggestionStatus, message, true);
        renderAiDynamicContext();
        return;
      }

      const confirmed = response?.result?.confirmed !== false;
      const dispatchMethod = String(response?.result?.dispatchMethod || '').trim();
      if (confirmed) {
        setWhatsappSuggestionUiStatus('Mensaje enviado.', false);
        setStatus(whatsappSuggestionStatus, 'Mensaje enviado.');
      } else {
        const message = `Mensaje despachado (${dispatchMethod || 'sin confirmacion de metodo'}), esperando confirmacion en chat.`;
        setWhatsappSuggestionUiStatus(message, false);
        setStatus(
          whatsappSuggestionStatus,
          message
        );
      }
      renderAiDynamicContext();

      window.setTimeout(() => {
        tabContextService.requestSnapshot();
      }, 350);
    } finally {
      whatsappSuggestionExecutionInFlight = false;
      renderAiDynamicContext();
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
            const historyPayload = await readWhatsappChatHistory(tab, {
              limit: messageLimit
            });
            await ingestWhatsappHistoryIntoContextMemory(historyPayload, {
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
          whatsappChats: 0,
          whatsappMessages: 0,
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
        const whatsappVectorMessageLimit = Math.max(
          80,
          Math.min(
            MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT,
            Number(getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)) ||
              MAX_WHATSAPP_PERSISTED_MESSAGES
          )
        );
        const whatsappSeedChatLimit = Math.max(
          8,
          Math.min(
            240,
            Number(getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY)) * 8 || 160
          )
        );
        const whatsappHistorySeed = await readAllWhatsappChatHistories({
          chatLimit: whatsappSeedChatLimit,
          messageLimit: whatsappVectorMessageLimit
        });
        const whatsappIngestion = await contextMemoryService.ingestWhatsappChatHistory(whatsappHistorySeed, {
          chatLimit: whatsappSeedChatLimit,
          messageLimit: whatsappVectorMessageLimit
        });
        for (const historyPayload of whatsappHistorySeed) {
          const key = String(
            historyPayload?.key ||
              historyPayload?.channelId ||
              historyPayload?.chatKey ||
              historyPayload?.phone ||
              historyPayload?.title ||
              ''
          ).trim();
          const fingerprint = buildWhatsappHistoryVectorFingerprint(historyPayload);
          if (!key || !fingerprint) {
            continue;
          }
          whatsappHistoryVectorFingerprintByKey.set(key, fingerprint);
        }
        if (whatsappHistoryVectorFingerprintByKey.size > 400) {
          const overflow = whatsappHistoryVectorFingerprintByKey.size - 400;
          for (let index = 0; index < overflow; index += 1) {
            const oldestKey = whatsappHistoryVectorFingerprintByKey.keys().next().value;
            if (!oldestKey) {
              break;
            }
            whatsappHistoryVectorFingerprintByKey.delete(oldestKey);
          }
        }
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
          whatsappChats: Math.max(0, Number(whatsappIngestion?.ingestedChats) || 0),
          whatsappMessages: Math.max(0, Number(whatsappIngestion?.ingestedMessages) || 0),
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
    const runtimeContext = snapshot.runtimeContext && typeof snapshot.runtimeContext === 'object' ? snapshot.runtimeContext : {};
    tabContextSnapshot = {
      activeTabId: typeof snapshot.activeTabId === 'number' ? snapshot.activeTabId : -1,
      reason: String(snapshot.reason || 'snapshot'),
      updatedAt: Number(snapshot.updatedAt) || Date.now(),
      history,
      runtimeContext,
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
    dynamicContextSignals = collectDynamicSignalsFromTab(activeTab);
    void refreshDynamicRelationsContext(activeTab, dynamicContextSignals, { force: false });

    if (isAssistantSettingsPageVisible()) {
      hydrateWhatsappPromptEditorFromActiveChat({
        keepCurrentTarget: true,
        clearStatus: false,
        silentNoTarget: true,
        announceChange: true
      });
    }

    if (!activeTab || !isWhatsappContext(activeTab)) {
      hideWhatsappSuggestion();
      return;
    }

    generateWhatsappSuggestion(activeTab, { force: false });
    renderAiDynamicContext(activeTab);
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
    renderAppsIntegrationsSettings({ syncInput: true });
    renderAssistantBranding();
    syncLocationContextToBackground(panelSettings.integrations, {
      reason: 'panel_hydrate'
    });
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
    renderAssistantBranding();
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

  function clearUserSettingsAutosaveTimer() {
    if (userSettingsAutosaveTimer) {
      window.clearTimeout(userSettingsAutosaveTimer);
      userSettingsAutosaveTimer = 0;
    }
  }

  function clearAssistantSettingsAutosaveTimer() {
    if (assistantSettingsAutosaveTimer) {
      window.clearTimeout(assistantSettingsAutosaveTimer);
      assistantSettingsAutosaveTimer = 0;
    }
  }

  function clearCrmDbSettingsAutosaveTimer() {
    if (crmDbSettingsAutosaveTimer) {
      window.clearTimeout(crmDbSettingsAutosaveTimer);
      crmDbSettingsAutosaveTimer = 0;
    }
  }

  function clearCrmMeSettingsAutosaveTimer() {
    if (crmMeSettingsAutosaveTimer) {
      window.clearTimeout(crmMeSettingsAutosaveTimer);
      crmMeSettingsAutosaveTimer = 0;
    }
  }

  function clearSystemVariablesAutosaveTimer() {
    if (systemVariablesAutosaveTimer) {
      window.clearTimeout(systemVariablesAutosaveTimer);
      systemVariablesAutosaveTimer = 0;
    }
  }

  function clearIntegrationsAutosaveTimer() {
    if (integrationsAutosaveTimer) {
      window.clearTimeout(integrationsAutosaveTimer);
      integrationsAutosaveTimer = 0;
    }
  }

  function clearAllSettingsAutosaveTimers() {
    clearUserSettingsAutosaveTimer();
    clearAssistantSettingsAutosaveTimer();
    clearCrmDbSettingsAutosaveTimer();
    clearCrmMeSettingsAutosaveTimer();
    clearSystemVariablesAutosaveTimer();
    clearIntegrationsAutosaveTimer();
  }

  function scheduleUserSettingsAutosave(options = {}) {
    if (!settingsScreenController) {
      return;
    }

    clearUserSettingsAutosaveTimer();
    const token = ++userSettingsAutosaveToken;
    setStatus(settingsUserStatus, 'Guardado en vivo pendiente...');

    userSettingsAutosaveTimer = window.setTimeout(async () => {
      userSettingsAutosaveTimer = 0;

      if (token !== userSettingsAutosaveToken) {
        return;
      }

      const nextName = String(settingsNameInput?.value || '').trim();
      const nextBirthday = String(settingsBirthdayInput?.value || '').trim();
      const current = settingsScreenController.getPanelSettings() || {};
      const currentName = String(current.displayName || '').trim();
      const currentBirthday = String(current.birthday || '').trim();

      if (!nextName) {
        setStatus(settingsUserStatus, 'El nombre no puede estar vacio.', true);
        return;
      }

      if (nextName === currentName && nextBirthday === currentBirthday) {
        setStatus(settingsUserStatus, 'Sin cambios pendientes.');
        return;
      }

      setStatus(settingsUserStatus, 'Guardando datos...', false, { loading: true });
      await saveUserSettingsScreen();
    }, Math.max(120, Number(options.delayMs) || 420));
  }

  function scheduleAssistantSettingsAutosave(options = {}) {
    if (!settingsScreenController) {
      return;
    }

    clearAssistantSettingsAutosaveTimer();
    const token = ++assistantSettingsAutosaveToken;
    setStatus(settingsAssistantStatus, 'Guardado en vivo pendiente...');

    assistantSettingsAutosaveTimer = window.setTimeout(async () => {
      assistantSettingsAutosaveTimer = 0;

      if (token !== assistantSettingsAutosaveToken) {
        return;
      }

      const nextLanguage = normalizeAssistantLanguage(settingsLanguageSelect?.value || DEFAULT_ASSISTANT_LANGUAGE);
      const nextPrompt = String(settingsSystemPrompt?.value || '').trim();
      const current = settingsScreenController.getPanelSettings() || {};
      const currentLanguage = normalizeAssistantLanguage(current.language || DEFAULT_ASSISTANT_LANGUAGE);
      const currentPrompt = String(current.systemPrompt || '').trim();

      if (!nextPrompt) {
        setStatus(settingsAssistantStatus, 'El system prompt no puede estar vacio.', true);
        return;
      }

      if (nextLanguage === currentLanguage && nextPrompt === currentPrompt) {
        setStatus(settingsAssistantStatus, 'Sin cambios pendientes.');
        return;
      }

      setStatus(settingsAssistantStatus, 'Guardando assistant...', false, { loading: true });
      await saveAssistantSettingsScreen();
    }, Math.max(120, Number(options.delayMs) || 420));
  }

  function scheduleCrmDbSettingsAutosave(options = {}) {
    clearCrmDbSettingsAutosaveTimer();
    const token = ++crmDbSettingsAutosaveToken;
    setStatus(settingsCrmErpDbStatus, 'Guardado en vivo pendiente...');

    crmDbSettingsAutosaveTimer = window.setTimeout(async () => {
      crmDbSettingsAutosaveTimer = 0;

      if (token !== crmDbSettingsAutosaveToken) {
        return;
      }

      const inputValue = String(settingsCrmErpDbUrlInput?.value || '').trim();
      const currentUrl = getCrmErpDatabaseConnectionUrl();

      if (!inputValue && !currentUrl) {
        setStatus(settingsCrmErpDbStatus, 'Sin cambios pendientes.');
        return;
      }

      if (inputValue) {
        const normalized = postgresService.normalizeConnectionUrl(inputValue);
        if (!normalized) {
          setStatus(
            settingsCrmErpDbStatus,
            'URL PostgreSQL pendiente o invalida. Se guarda automaticamente cuando sea valida.',
            true
          );
          return;
        }

        if (normalized === currentUrl) {
          setStatus(settingsCrmErpDbStatus, 'Sin cambios pendientes.');
          return;
        }
      }

      setStatus(settingsCrmErpDbStatus, 'Guardando URL...', false, { loading: true });
      await saveCrmErpDatabaseSettingsFromScreen({ analyzeAfterSave: false });
    }, Math.max(180, Number(options.delayMs) || 700));
  }

  function scheduleCrmMeProfileAutosave(options = {}) {
    clearCrmMeSettingsAutosaveTimer();
    const token = ++crmMeSettingsAutosaveToken;
    setStatus(settingsCrmErpMeStatus, 'Guardado en vivo pendiente...');

    crmMeSettingsAutosaveTimer = window.setTimeout(async () => {
      crmMeSettingsAutosaveTimer = 0;

      if (token !== crmMeSettingsAutosaveToken) {
        return;
      }

      const connectionUrl = getCrmErpDatabaseConnectionUrl();
      const snapshot = getCrmErpDatabaseSchemaSnapshot();
      if (!connectionUrl || !snapshot) {
        setStatus(settingsCrmErpMeStatus, 'Configura URL y analiza esquema para guardar perfil DB.', true);
        return;
      }

      const tableQualifiedName = String(settingsCrmErpMeTableSelect?.value || '').trim();
      const idColumn = String(settingsCrmErpMeIdColumnSelect?.value || '').trim();
      const userId = String(settingsCrmErpMeUserIdInput?.value || '').trim();
      if (!tableQualifiedName || !idColumn || !userId) {
        setStatus(settingsCrmErpMeStatus, 'Completa tabla, columna ID y user ID para guardar en vivo.');
        return;
      }

      const current = getCrmErpDatabaseMeProfile();
      const currentTable = String(current?.tableQualifiedName || '').trim();
      const currentIdColumn = String(current?.idColumn || '').trim();
      const currentUserId = String(current?.userId || '').trim();
      if (tableQualifiedName === currentTable && idColumn === currentIdColumn && userId === currentUserId) {
        setStatus(settingsCrmErpMeStatus, 'Sin cambios pendientes.');
        return;
      }

      setStatus(settingsCrmErpMeStatus, 'Guardando perfil DB...', false, { loading: true });
      await saveCrmErpMeProfileFromScreen();
    }, Math.max(180, Number(options.delayMs) || 620));
  }

  function scheduleSystemVariablesAutosave(options = {}) {
    clearSystemVariablesAutosaveTimer();
    const token = ++systemVariablesAutosaveToken;
    setStatus(systemVariablesStatus, 'Guardado en vivo pendiente...');

    systemVariablesAutosaveTimer = window.setTimeout(async () => {
      systemVariablesAutosaveTimer = 0;

      if (token !== systemVariablesAutosaveToken) {
        return;
      }

      const parsed = collectSystemVariableFormValues();
      if (!parsed.ok) {
        const isActiveField = Boolean(parsed.field && document.activeElement === parsed.field);
        if (isActiveField) {
          setStatus(systemVariablesStatus, 'Pendiente: completa/formatea el valor para guardar.');
        } else {
          setStatus(systemVariablesStatus, parsed.error || 'No se pudieron validar las variables.', true);
        }
        return;
      }

      const nextSettings = parsed.value && typeof parsed.value === 'object' ? parsed.value : {};
      const currentPrompt = String(panelSettings.systemPrompt || '').trim();
      const nextPrompt = String(nextSettings.systemPrompt || '').trim();
      const currentVars = JSON.stringify(normalizeSystemVariables(panelSettings.systemVariables));
      const nextVars = JSON.stringify(normalizeSystemVariables(nextSettings.systemVariables));
      if (currentPrompt === nextPrompt && currentVars === nextVars) {
        setStatus(systemVariablesStatus, 'Sin cambios pendientes.');
        return;
      }

      setStatus(systemVariablesStatus, 'Guardando system variables...', false, { loading: true });
      await saveSystemVariablesFromScreen({ autosave: true });
    }, Math.max(180, Number(options.delayMs) || 620));
  }

  function scheduleIntegrationsAutosave(options = {}) {
    clearIntegrationsAutosaveTimer();
    const token = ++integrationsAutosaveToken;
    setStatus(settingsIntegrationsStatus, 'Guardado en vivo pendiente...');

    integrationsAutosaveTimer = window.setTimeout(async () => {
      integrationsAutosaveTimer = 0;
      if (token !== integrationsAutosaveToken) {
        return;
      }

      const parsed = collectAppsIntegrationsSettingsFromScreen();
      if (!parsed.ok) {
        setStatus(settingsIntegrationsStatus, parsed.error || 'No se pudieron validar integraciones.', true);
        return;
      }

      const current = JSON.stringify(getIntegrationsConfig());
      const next = JSON.stringify(parsed.integrations);
      if (current === next) {
        setStatus(settingsIntegrationsStatus, 'Sin cambios pendientes.');
        return;
      }

      setStatus(settingsIntegrationsStatus, 'Guardando integraciones...', false, { loading: true });
      await saveAppsIntegrationsFromScreen({ autosave: true });
    }, Math.max(240, Number(options.delayMs) || 780));
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
    const handleAppMouseMove = (event) => {
      if (!app) {
        return;
      }

      const rect = app.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const normalizedX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const normalizedY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      setBrandEmotionLookVector(normalizedX, normalizedY);
    };

    wirePinDigitGroup(pinDigitInputs);
    wirePinDigitGroup(pinConfirmDigitInputs);
    syncPinHiddenInputs();

    brandHomeBtn?.addEventListener('click', () => {
      blinkBrandEmotion({ force: true, preserveRandom: true });
      goToPrimaryScreen();
    });

    openToolsBtn?.addEventListener('click', () => {
      openTools('image');
    });

    openSettingsBtn?.addEventListener('click', () => {
      openSettings();
    });

    goHomeBtn?.addEventListener('click', () => {
      blinkBrandEmotion({ force: true, preserveRandom: true });
      goToPrimaryScreen();
    });

    closeSettingsBtn?.addEventListener('click', () => {
      blinkBrandEmotion({ force: true, preserveRandom: true });
      if (getCurrentSettingsPage() !== SETTINGS_PAGES.HOME) {
        setSettingsPage(SETTINGS_PAGES.HOME);
        return;
      }
      goToPrimaryScreen();
    });

    app?.addEventListener('mousemove', handleAppMouseMove);
    app?.addEventListener('mouseleave', () => {
      resetBrandEmotionLookVector();
    });

    onboardingContinueBtn?.addEventListener('click', () => {
      handleOnboardingContinue();
    });

    for (const input of [onboardingAssistantNameInput, onboardingNameInput]) {
      input?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }

        event.preventDefault();
        handleOnboardingContinue();
      });
    }

    for (const item of settingsNavItems) {
      item.addEventListener('click', () => {
        setSettingsPage(item.dataset.settingsTarget || SETTINGS_PAGES.HOME);
      });
    }

    settingsNameInput?.addEventListener('input', () => {
      scheduleUserSettingsAutosave({
        delayMs: 420
      });
    });

    settingsBirthdayInput?.addEventListener('change', () => {
      scheduleUserSettingsAutosave({
        delayMs: 320
      });
    });

    settingsBirthdayInput?.addEventListener('input', () => {
      scheduleUserSettingsAutosave({
        delayMs: 420
      });
    });

    settingsNameInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      scheduleUserSettingsAutosave({
        delayMs: 120
      });
    });

    settingsWhatsappPromptClearBtn?.addEventListener('click', () => {
      void clearWhatsappPromptForSelectedChat();
    });

    settingsWhatsappPromptInput?.addEventListener('input', () => {
      scheduleWhatsappPromptAutosave({
        delayMs: 420
      });
    });

    settingsCrmErpDbAnalyzeBtn?.addEventListener('click', () => {
      clearCrmDbSettingsAutosaveTimer();
      crmDbSettingsAutosaveToken += 1;
      void saveCrmErpDatabaseSettingsFromScreen({ analyzeAfterSave: true });
    });

    settingsCrmErpDbUrlInput?.addEventListener('input', () => {
      scheduleCrmDbSettingsAutosave({
        delayMs: 760
      });
    });

    settingsCrmErpDbUrlInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      clearCrmDbSettingsAutosaveTimer();
      crmDbSettingsAutosaveToken += 1;
      void saveCrmErpDatabaseSettingsFromScreen({ analyzeAfterSave: false });
    });

    settingsCrmErpMeTableSelect?.addEventListener('change', () => {
      syncCrmErpMeIdColumnOptions({
        tableQualifiedName: settingsCrmErpMeTableSelect.value,
        selectedIdColumn: ''
      });
      scheduleCrmMeProfileAutosave({
        delayMs: 420
      });
    });

    settingsCrmErpMeIdColumnSelect?.addEventListener('change', () => {
      scheduleCrmMeProfileAutosave({
        delayMs: 420
      });
    });

    settingsCrmErpMeUserIdInput?.addEventListener('input', () => {
      scheduleCrmMeProfileAutosave({
        delayMs: 520
      });
    });

    settingsCrmErpMeUserIdInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      event.preventDefault();
      clearCrmMeSettingsAutosaveTimer();
      crmMeSettingsAutosaveToken += 1;
      void saveCrmErpMeProfileFromScreen();
    });

    settingsCrmErpMeClearBtn?.addEventListener('click', () => {
      clearCrmMeSettingsAutosaveTimer();
      crmMeSettingsAutosaveToken += 1;
      void clearCrmErpMeProfileFromScreen();
    });

    systemVariablesResetBtn?.addEventListener('click', () => {
      clearSystemVariablesAutosaveTimer();
      systemVariablesAutosaveToken += 1;
      resetSystemVariablesToDefaults();
    });

    systemVariablesList?.addEventListener('input', () => {
      scheduleSystemVariablesAutosave({
        delayMs: 680
      });
    });

    systemVariablesList?.addEventListener('change', () => {
      scheduleSystemVariablesAutosave({
        delayMs: 280
      });
    });

    settingsIntegrationsSaveBtn?.addEventListener('click', () => {
      clearIntegrationsAutosaveTimer();
      integrationsAutosaveToken += 1;
      void saveAppsIntegrationsFromScreen({ autosave: false });
    });

    const integrationInputs = [
      settingsSmtpRelayUrlInput,
      settingsSmtpHostInput,
      settingsSmtpPortInput,
      settingsSmtpSecureSelect,
      settingsSmtpUsernameInput,
      settingsSmtpPasswordInput,
      settingsSmtpFromInput,
      settingsMapsApiKeyInput,
      settingsMapsNearbyTypeSelect
    ];
    for (const input of integrationInputs) {
      input?.addEventListener('input', () => {
        scheduleIntegrationsAutosave({
          delayMs: 760
        });
      });
      input?.addEventListener('change', () => {
        scheduleIntegrationsAutosave({
          delayMs: 320
        });
      });
    }

    settingsCustomToolsSchemaInput?.addEventListener('input', () => {
      scheduleIntegrationsAutosave({
        delayMs: 900
      });
    });

    settingsPermissionLocationBtn?.addEventListener('click', () => {
      setStatus(settingsIntegrationsStatus, 'Solicitando acceso a ubicacion...', false, { loading: true });
      void requestLocationPermissionAndSync({ refreshNearby: true }).catch((error) => {
        const message = error instanceof Error ? error.message : 'No se pudo obtener ubicacion.';
        setStatus(settingsIntegrationsStatus, message, true);
      });
    });

    settingsMapsNearbyRefreshBtn?.addEventListener('click', () => {
      setStatus(settingsIntegrationsStatus, 'Actualizando lugares cercanos...', false, { loading: true });
      void refreshNearbyPlacesFromStoredLocation()
        .then(() => {
          setStatus(settingsIntegrationsStatus, 'Lugares cercanos actualizados.');
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'No se pudieron actualizar lugares cercanos.';
          setStatus(settingsIntegrationsStatus, message, true);
        });
    });

    settingsPermissionMicBtn?.addEventListener('click', () => {
      setStatus(settingsIntegrationsStatus, 'Solicitando acceso a microfono...', false, { loading: true });
      void requestMicrophonePermissionAndSync().catch((error) => {
        const message = error instanceof Error ? error.message : 'No se pudo obtener permiso de microfono.';
        setStatus(settingsIntegrationsStatus, message, true);
      });
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
      scheduleAssistantSettingsAutosave({
        delayMs: 200
      });
    });

    settingsSystemPrompt?.addEventListener('input', () => {
      scheduleAssistantSettingsAutosave({
        delayMs: 460
      });
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
      const actionItem = event.target.closest('[data-chat-action]');
      if (actionItem) {
        const action = String(actionItem.dataset.chatAction || '').trim();
        if (action === 'attach_files') {
          closeToolMenu();
          chatAttachmentInput?.click();
        }
        return;
      }

      const option = event.target.closest('[data-chat-tool]');
      if (!option) {
        return;
      }

      setChatTool(option.dataset.chatTool || DEFAULT_CHAT_TOOL);
      closeToolMenu();
      requestChatAutofocus(6, 60);
    });

    chatAttachmentInput?.addEventListener('change', (event) => {
      const files = event?.target?.files || [];
      void queueChatAttachmentsFromFiles(files);
      if (chatAttachmentInput) {
        chatAttachmentInput.value = '';
      }
    });

    chatAttachmentsBar?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-attachment-remove]');
      if (!button) {
        return;
      }
      removePendingConversationAttachment(button.dataset.attachmentRemove || '');
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
        closeDynamicRelationDetailScreen();
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

    dynamicSuggestionsList?.addEventListener('click', (event) => {
      void handleDynamicSuggestionsListClick(event);
    });

    dynamicRelationsList?.addEventListener('click', (event) => {
      handleDynamicRelationsListClick(event);
    });

    dynamicRelationsList?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const card = event.target.closest('[data-relation-card-id]');
      if (!card) {
        return;
      }
      event.preventDefault();
      openDynamicRelationDetailScreen(String(card.dataset.relationCardId || '').trim());
    });

    dynamicRelationsDetailBackBtn?.addEventListener('click', () => {
      closeDynamicRelationDetailScreen();
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
      clearWhatsappPromptAutosaveTimer();
      clearAllSettingsAutosaveTimers();
      tabContextService.stop();
      void contextMemoryService.shutdown();
      brandEmotionController.destroy();
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
      scheduleStageStabilization(app?.dataset?.screen || '');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestChatAutofocus(8, 70);
        scheduleStageStabilization(app?.dataset?.screen || '');
      }
    });
  }

  async function init() {
    settingsScreenState = {
      panelSettings: { ...panelSettings }
    };
    settingsScreenController = createSettingsScreenController({
      elements: {
        onboardingAssistantNameInput,
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
    renderAssistantBranding();
    wireEvents();
    observeStageSizeChanges();
    setChatTool(DEFAULT_CHAT_TOOL);
    renderPendingConversationAttachments();
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
    scheduleStageStabilization(initialScreen);

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
      onboardingAssistantNameInput?.focus();
    }

    scheduleStageStabilization(initialScreen);
  }

  init();
}
