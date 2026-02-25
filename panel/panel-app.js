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
import { createToolsScreenController } from './screens/tools-screen.js';
import { createTabContextService } from './services/tab-context-service.js';
import { createContextMemoryService } from './services/context-memory-service.js';
import { createPostgresService } from './services/postgres-service.js';
import { createBrandEmotionController } from './controllers/brand-emotion-controller.js';
import { createSystemVariablesController } from './controllers/system-variables-controller.js';
import { createDynamicUiSortShowController } from './controllers/dynamic-ui-sort-show-controller.js';
import { buildTabSummaryPrompt, toJsonTabRecord } from './services/site-context/generic-site-context.js';
import { createDynamicRelationsService } from './services/dynamic-relations-service.js';
import { extractToolCallsFromText } from './services/local-tool-call-parser-service.js';
import { isGmailContext, isGmailMessageOpenContext } from './services/site-context/gmail-site-context.js';
import {
  buildMacNativeHostInstallerScript,
  buildWindowsNativeHostInstallerScript,
  htmlToPlainText,
  normalizeEmailList,
  sanitizeNativeHostNameToken,
  triggerTextFileDownload
} from './services/smtp-native-host-utils.js';
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

  const cfg = window.GreeneToolsConfig;
  if (!cfg) {
    return;
  }

  const LOG_PREFIX = '[greene/panel]';

  const { TOOL_KEYS, PREFERENCE_KEYS, DEFAULT_SETTINGS, APPLY_MESSAGE_TYPE } = cfg;

  const TOOL_IDS = Object.freeze({
    IMAGE: 'image',
    RETOOL: 'retool',
    BOLD_EXPORT_CSV: 'bold_export_csv',
    NUWWE_AUTO_LOGIN: 'nuwwe_auto_login'
  });
  const TOOLS_CATALOG = Object.freeze([
    {
      id: TOOL_IDS.IMAGE,
      title: 'Image to WebP',
      description: 'Convierte imagenes a WebP y las deja listas para descargar.',
      url: ''
    },
    {
      id: TOOL_IDS.RETOOL,
      title: 'Retool Layout Cleanup',
      description: 'Oculta el header de Retool y ajusta el canvas automaticamente.',
      url: 'https://retool.com/apps/'
    },
    {
      id: TOOL_IDS.BOLD_EXPORT_CSV,
      title: 'Export moveemtns to csv',
      description: 'Detecta movimientos unicos de Bold y habilita descarga CSV limpia.',
      url: 'https://cuenta.bold.co/midinero/deposito/movimientos/unicos'
    },
    {
      id: TOOL_IDS.NUWWE_AUTO_LOGIN,
      title: 'Nuwwe Auto Login',
      description: 'Autocompleta credenciales en Nuwwe y envia el formulario automaticamente.',
      url: 'https://nuwwe.com/login'
    }
  ]);
  const BOLD_MOVEMENTS_HOSTNAME = 'cuenta.bold.co';
  const BOLD_MOVEMENTS_PATH_PREFIX = '/midinero/deposito/movimientos/unicos';
  const NUWWE_CREDENTIALS_STORAGE_VERSION = 1;
  const NUWWE_CREDENTIALS_STORAGE_KEY = 'greene_tool_nuwwe_login_secure_v1';
  const NUWWE_GET_LOGIN_CREDENTIALS_MESSAGE_TYPE = 'GREENE_NUWWE_GET_LOGIN_CREDENTIALS';
  const SETTINGS_PAGES = Object.freeze({
    HOME: 'home',
    USER: 'user',
    ASSISTANT: 'assistant',
    AI_MODELS: 'ai_models',
    CRM_ERP_DATABASE: 'crm_erp_database',
    TABS: 'tabs',
    SYSTEM_VARIABLES: 'system_variables',
    APPS_INTEGRATIONS: 'apps_integrations',
    LOCAL_CONNECTOR: 'local_connector'
  });
  const SETTINGS_PAGE_TITLES = Object.freeze({
    [SETTINGS_PAGES.HOME]: 'Settings',
    [SETTINGS_PAGES.USER]: 'User',
    [SETTINGS_PAGES.ASSISTANT]: 'Assistant',
    [SETTINGS_PAGES.AI_MODELS]: 'AI Models',
    [SETTINGS_PAGES.CRM_ERP_DATABASE]: 'CRM/ERP Database',
    [SETTINGS_PAGES.TABS]: 'Tabs',
    [SETTINGS_PAGES.SYSTEM_VARIABLES]: 'System Variables',
    [SETTINGS_PAGES.APPS_INTEGRATIONS]: 'Apps & Integrations',
    [SETTINGS_PAGES.LOCAL_CONNECTOR]: 'Local Connector'
  });
  const PIN_MODAL_MODES = Object.freeze({
    SETUP: 'setup',
    UNLOCK: 'unlock'
  });
  const SECRET_KEY_PREFIX = 'ai-key::';
  const PIN_UNLOCK_SESSION_STORAGE_KEY = 'greene_pin_unlock_session_v1';
  const PIN_UNLOCK_SESSION_TTL_MS = 1000 * 60 * 60 * 8;
  const SCREEN_INDEX = Object.freeze({
    onboarding: 0,
    home: 1,
    tools: 2,
    settings: 3
  });
  const BACKGROUND_RUNTIME_CONTEXT_UPDATE_TYPE = 'GREENE_LOCATION_CONTEXT_UPDATE';
  const BACKGROUND_SMTP_SEND_TYPE = 'GREENE_SMTP_SEND';
  const BACKGROUND_NATIVE_HOST_PING_TYPE = 'GREENE_NATIVE_HOST_PING';
  const MICROPHONE_PERMISSION_RESULT_MESSAGE_TYPE = 'GREENE_MIC_PERMISSION_RESULT';
  const MICROPHONE_PERMISSION_HELPER_PAGE_PATH = 'panel/mic-permission.html';
  const MICROPHONE_PERMISSION_HELPER_COOLDOWN_MS = 4500;
  const NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL = 'macOS y Windows';
  const DEFAULT_CHAT_SYSTEM_PROMPT = buildDefaultChatSystemPrompt(DEFAULT_ASSISTANT_LANGUAGE);
  const DEFAULT_ASSISTANT_DISPLAY_NAME = 'Greene';
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
  const CHAT_STREAM_BOTTOM_RESERVE_PX = 300;
  const CHAT_IDLE_BOTTOM_RESERVE_PX = CHAT_STREAM_BOTTOM_RESERVE_PX;
  const WHATSAPP_WEB_BASE_URL = 'https://web.whatsapp.com/';
  const WHATSAPP_WEB_URL_HINT = 'web.whatsapp.com';
  const NUWWE_LOGIN_URL = 'https://nuwwe.com/login';
  const NUWWE_HOST_HINT = 'nuwwe.com';
  const NUWWE_DIRECT_INTENT_TOKENS = Object.freeze(['nuwwe', 'nuwe', 'nue']);
  const MAX_CHAT_CONTEXT_MESSAGES = 20;
  const MAX_CHAT_HISTORY_MESSAGES = 160;
  const MAX_CHAT_HISTORY_STORAGE_LIMIT = 600;
  const CHAT_STARTUP_RENDER_MAX_MESSAGES = 28;
  const CHAT_HISTORY_READ_PADDING = 24;
  const MAX_LOCAL_TOOL_CALLS = 3;
  const MAX_TOOL_ERROR_LOG_ITEMS = 12;
  const TOOL_ERROR_LOG_MAX_AGE_MS = 1000 * 60 * 60 * 24;
  const NATIVE_HOST_PING_STALE_MS = 1000 * 60 * 10;
  const MAX_CHAT_ATTACHMENTS_PER_TURN = 8;
  const MAX_CHAT_ATTACHMENT_TEXT_CHARS = 3200;
  const MAX_CHAT_IMAGE_DATA_URL_CHARS = 8 * 1024 * 1024;
  const MAX_IMAGE_FILES = 10;
  const MAX_TABS_FOR_AI_SUMMARY = 20;
  const TAB_SUMMARY_MAX_CHARS = 160;
  const INCREMENTAL_HISTORY_INGEST_LIMIT = 80;
  const MAX_WHATSAPP_PERSISTED_MESSAGES = 640;
  const MAX_WHATSAPP_PERSISTED_MESSAGES_STORAGE_LIMIT = 2000;
  const WHATSAPP_SUGGESTION_HISTORY_LIMIT = 120;
  const WHATSAPP_ALIAS_STORAGE_KEY = 'greene_whatsapp_alias_book_v1';
  const WHATSAPP_ALIAS_STORAGE_VERSION = 1;
  const WHATSAPP_ALIAS_MAX_ITEMS = 240;
  const WHATSAPP_ALIAS_DB_INDEX_SYNC_COOLDOWN_MS = 1000 * 45;
  const WHATSAPP_HISTORY_SYNC_MIN_INTERVAL_MS = 1000 * 8;
  const WHATSAPP_LIVE_CONTEXT_RETRY_COOLDOWN_MS = 1000 * 12;
  const WHATSAPP_LIVE_CONTEXT_NO_RECEIVER_COOLDOWN_MS = 1000 * 25;
  const WHATSAPP_SUGGESTION_AUTO_DEBOUNCE_MS = 420;
  const WHATSAPP_SUGGESTION_MODEL_COOLDOWN_MS = 1000 * 45;
  const ENABLE_AUTO_WHATSAPP_SUGGESTION_WITH_OLLAMA = false;
  const ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS = false;
  const ENABLE_PANEL_DEBUG_LOGS = false;
  const ENABLE_PANEL_INFO_LOGS = false;
  const NOISY_CONTEXT_LOG_PREFIXES = Object.freeze([
    'dynamic_context:',
    'dynamic_relations:',
    'whatsapp_contact:',
    'whatsapp_history:',
    'whatsapp_suggestion:',
    'initial_context_sync:'
  ]);
  const RUNTIME_GC_INTERVAL_MS = 1000 * 45;
  const TAB_SUMMARY_CACHE_MAX_ITEMS = 180;
  const WHATSAPP_HISTORY_FINGERPRINT_CACHE_MAX_ITEMS = 320;
  const TAB_SUMMARY_QUEUE_MAX_ITEMS = 72;
  const RUNTIME_LISTENER_WARN_THRESHOLD = 260;
  const RUNTIME_LISTENER_WARN_COOLDOWN_MS = 1000 * 90;
  const MEMORY_USER_PROFILE_MAX_ITEMS = 480;
  const MEMORY_USER_PROFILE_MAX_ITEMS_STORAGE_LIMIT = 3000;
  const MAX_WHATSAPP_PROMPT_ENTRIES = 320;
  const MAX_WHATSAPP_PROMPT_CHARS = 1800;
  const ENABLE_AUTO_TAB_SUMMARY_WITH_MODEL = false;
  const VOICE_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';
  const VOICE_TRANSCRIPTION_LANGUAGE = 'es';
  const VOICE_CHAT_RESPONSE_MODEL = 'gpt-4o-mini';
  const VOICE_TTS_MODEL = 'gpt-4o-mini-tts';
  const VOICE_TTS_VOICE = 'alloy';
  const OPENAI_TTS_VOICE_OPTIONS = Object.freeze(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);
  const OPENAI_TTS_VOICE_SET = new Set(OPENAI_TTS_VOICE_OPTIONS);
  const VOICE_TTS_SPEED_DEFAULT = 1;
  const VOICE_TTS_SPEED_MIN = 0.25;
  const VOICE_TTS_SPEED_MAX = 2;
  const VOICE_PAUSE_MS_DEFAULT = 650;
  const VOICE_PAUSE_MS_MIN = 300;
  const VOICE_PAUSE_MS_MAX = 5000;
  const VOICE_TTS_FORMAT = 'mp3';
  const VOICE_AUTO_STOP_MAX_MS = 1000 * 60 * 2;
  const VOICE_MIN_ACTIVE_RECORDING_MS = 650;
  const VOICE_SILENCE_RMS_THRESHOLD = 0.026;
  const VOICE_VAD_MODEL = 'v5';
  const VOICE_VAD_ASSET_BASE_PATH = new URL('../node_modules/@ricky0123/vad-web/dist/', import.meta.url).href;
  const VOICE_VAD_WASM_BASE_PATH = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
  const VOICE_ORT_SCRIPT_PATH = '../node_modules/onnxruntime-web/dist/ort.min.js';
  const VOICE_VAD_SCRIPT_PATH = '../node_modules/@ricky0123/vad-web/dist/bundle.min.js';
  const VOICE_VAD_POSITIVE_THRESHOLD = 0.28;
  const VOICE_VAD_NEGATIVE_THRESHOLD = 0.22;
  const VOICE_VAD_MIN_SPEECH_MS = 220;
  const VOICE_VAD_PRESPEECH_PAD_MS = 260;
  const VOICE_MEDIA_RECORDER_TIMESLICE_MS = 0;
  const VOICE_MIN_VAD_SEGMENT_SAMPLES = 2800;
  const VOICE_MIN_TRANSCRIBE_BLOB_BYTES = 640;
  const VOICE_SESSION_RESTART_DELAY_MS = 240;
  const VOICE_SESSION_RESTART_AFTER_ERROR_MS = 780;
  const VOICE_REPLY_SYNC_FALLBACK_MS_PER_CHAR = 34;
  const CHAT_INTERRUPT_WAIT_MAX_MS = 2200;

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
  const ENABLE_OLLAMA_REFRESH_ON_BOOT = false;
  const ENABLE_OLLAMA_WARMUP_ON_BOOT = false;

  const CHAT_DB = Object.freeze({
    NAME: 'greene-chat-db',
    VERSION: 6,
    CHAT_STORE: 'chat_state',
    CHAT_KEY: 'home_history',
    SETTINGS_STORE: 'panel_settings',
    SETTINGS_KEY: 'panel',
    WHATSAPP_STORE: 'whatsapp_chat_state',
    SECRET_STORE: 'panel_secrets'
  });
  const INITIAL_CONTEXT_SYNC_STORAGE_KEY = 'greene_initial_context_sync_v1';
  const INITIAL_CONTEXT_SYNC_VERSION = 1;
  const INITIAL_CONTEXT_SYNC_STALE_MS = 1000 * 60 * 12;
  const INITIAL_CONTEXT_SYNC_HISTORY_LIMIT = 320;
  const INITIAL_CONTEXT_SYNC_HISTORY_DAYS = 45;
  const INITIAL_CONTEXT_SYNC_CHAT_LIMIT = 140;
  const INITIAL_CONTEXT_BOOTSTRAP_DELAY_MS = 12000;
  const INITIAL_CONTEXT_BOOTSTRAP_IDLE_TIMEOUT_MS = 8000;
  const RUNTIME_SCRIPT_LOAD_TIMEOUT_MS = 6000;
  const ENABLE_REALTIME_CONTEXT_INGESTION = false;
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
    whatsappSuggestionHistoryLimit: WHATSAPP_SUGGESTION_HISTORY_LIMIT,
    memoryUserProfileMaxItems: MEMORY_USER_PROFILE_MAX_ITEMS,
    memoryUserProfileMaxItemsStorageLimit: MEMORY_USER_PROFILE_MAX_ITEMS_STORAGE_LIMIT
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
        transport: 'http_agent',
        nativeHostName: 'com.greene.smtp_bridge',
        agentUrl: 'http://127.0.0.1:4395/smtp/send',
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

  function resolveBrowserPreferredAssistantLanguage() {
    const nav = globalThis.navigator || null;
    const candidates = [];
    if (Array.isArray(nav?.languages)) {
      candidates.push(...nav.languages);
    }
    candidates.push(nav?.language);

    for (const candidate of candidates) {
      const raw = String(candidate || '')
        .trim()
        .toLowerCase();
      if (!raw) {
        continue;
      }

      const base = raw.split(/[-_]/)[0];
      if (base === 'en' || base === 'pt' || base === 'fr' || base === 'es') {
        return base;
      }
    }

    return DEFAULT_ASSISTANT_LANGUAGE;
  }

  const BROWSER_DEFAULT_ASSISTANT_LANGUAGE = resolveBrowserPreferredAssistantLanguage();

  const PANEL_SETTINGS_DEFAULTS = Object.freeze({
    assistantName: DEFAULT_ASSISTANT_DISPLAY_NAME,
    displayName: '',
    birthday: '',
    voiceActiveListening: true,
    language: BROWSER_DEFAULT_ASSISTANT_LANGUAGE,
    voiceTtsVoice: VOICE_TTS_VOICE,
    voiceTtsSpeed: VOICE_TTS_SPEED_DEFAULT,
    voicePauseMs: VOICE_PAUSE_MS_DEFAULT,
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
  const appBootstrapMask = document.getElementById('appBootstrapMask');
  const stageTrack = document.getElementById('stageTrack');
  const stageScreens = Array.from(document.querySelectorAll('.screen[data-screen-name]'));
  const brandHomeBtn = document.getElementById('brandHomeBtn');
  const brandRoleLabel = document.getElementById('brandRoleLabel');
  const brandNameText = document.getElementById('brandNameText');
  const nativeConnectorStatusBtn = document.getElementById('nativeConnectorStatusBtn');
  const nativeConnectorStatusDot = document.getElementById('nativeConnectorStatusDot');
  const toolsShell = document.getElementById('toolsShell');
  const toolsTitle = document.getElementById('toolsTitle');
  const toolsHomeScreen = document.getElementById('toolsHomeScreen');
  const toolsDetailScreen = document.getElementById('toolsDetailScreen');
  const toolsHomeList = document.getElementById('toolsHomeList');
  const toolsDetailPages = Array.from(document.querySelectorAll('.tools-detail-page'));
  const openToolsBtn = document.getElementById('openToolsBtn');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const goHomeBtn = document.getElementById('goHomeBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const settingsTitle = document.getElementById('settingsTitle');
  const settingsShell = document.getElementById('settingsShell');
  const settingsBody = settingsShell?.querySelector('.settings-body');
  const settingsPages = Array.from(document.querySelectorAll('.settings-page'));
  const settingsNavItems = Array.from(document.querySelectorAll('[data-settings-target]'));

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
  const chatSendVoiceBars = chatSendBtn ? Array.from(chatSendBtn.querySelectorAll('[data-voice-bar]')) : [];
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
  const applyBoldExportBtn = document.getElementById('applyBoldExportBtn');
  const boldExportStatus = document.getElementById('boldExportStatus');
  const nuwweAutoLoginToggle = document.getElementById('nuwweAutoLoginToggle');
  const nuwweUsernameInput = document.getElementById('nuwweUsernameInput');
  const nuwwePasswordInput = document.getElementById('nuwwePasswordInput');
  const nuwweCompanyCodeInput = document.getElementById('nuwweCompanyCodeInput');
  const nuwweSaveCredentialsBtn = document.getElementById('nuwweSaveCredentialsBtn');
  const nuwweClearCredentialsBtn = document.getElementById('nuwweClearCredentialsBtn');
  const nuwweAutoLoginStatus = document.getElementById('nuwweAutoLoginStatus');
  const onboardingAssistantNameInput = document.getElementById('onboardingAssistantNameInput');
  const onboardingNameInput = document.getElementById('onboardingNameInput');
  const onboardingContinueBtn = document.getElementById('onboardingContinueBtn');
  const onboardingStatus = document.getElementById('onboardingStatus');
  const settingsNameInput = document.getElementById('settingsNameInput');
  const settingsBirthdayInput = document.getElementById('settingsBirthdayInput');
  const settingsThemeModeSelect = document.getElementById('settingsThemeModeSelect');
  const settingsVoiceModeMeta = document.getElementById('settingsVoiceModeMeta');
  const settingsVoiceTtsVoiceSelect = document.getElementById('settingsVoiceTtsVoiceSelect');
  const settingsVoiceTtsSpeedInput = document.getElementById('settingsVoiceTtsSpeedInput');
  const settingsVoiceTtsSpeedValue = document.getElementById('settingsVoiceTtsSpeedValue');
  const settingsVoicePauseMsInput = document.getElementById('settingsVoicePauseMsInput');
  const settingsVoicePauseMsValue = document.getElementById('settingsVoicePauseMsValue');
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
  const settingsSmtpTransportSelect = document.getElementById('settingsSmtpTransportSelect');
  const settingsSmtpNativeHostInput = document.getElementById('settingsSmtpNativeHostInput');
  const settingsSmtpAgentUrlInput = document.getElementById('settingsSmtpAgentUrlInput');
  const settingsSmtpHostInput = document.getElementById('settingsSmtpHostInput');
  const settingsSmtpPortInput = document.getElementById('settingsSmtpPortInput');
  const settingsSmtpSecureSelect = document.getElementById('settingsSmtpSecureSelect');
  const settingsSmtpUsernameInput = document.getElementById('settingsSmtpUsernameInput');
  const settingsSmtpPasswordInput = document.getElementById('settingsSmtpPasswordInput');
  const settingsSmtpFromInput = document.getElementById('settingsSmtpFromInput');
  const settingsSmtpBridgeGuideBtn = document.getElementById('settingsSmtpBridgeGuideBtn');
  const settingsSmtpBridgePackagingBtn = document.getElementById('settingsSmtpBridgePackagingBtn');
  const settingsOpenConnectorDetailBtn = document.getElementById('settingsOpenConnectorDetailBtn');
  const settingsNativeHostPlatformMeta = document.getElementById('settingsNativeHostPlatformMeta');
  const settingsNativeHostInstallMd = document.getElementById('settingsNativeHostInstallMd');
  const settingsNativeHostDownloadBtn = document.getElementById('settingsNativeHostDownloadBtn');
  const settingsNativeHostPingBtn = document.getElementById('settingsNativeHostPingBtn');
  const settingsNativeHostHeaderMeta = document.getElementById('settingsNativeHostHeaderMeta');
  const settingsNativeHostStatus = document.getElementById('settingsNativeHostStatus');
  const settingsNativeHostToolsDependencyMeta = document.getElementById('settingsNativeHostToolsDependencyMeta');
  const settingsNativeConnectorNavDot = document.getElementById('settingsNativeConnectorNavDot');
  const settingsMapsApiKeyInput = document.getElementById('settingsMapsApiKeyInput');
  const settingsMapsNearbyTypeSelect = document.getElementById('settingsMapsNearbyTypeSelect');
  const settingsPermissionMicBtn = document.getElementById('settingsPermissionMicBtn');
  const settingsPermissionLocationBtn = document.getElementById('settingsPermissionLocationBtn');
  const settingsMapsNearbyRefreshBtn = document.getElementById('settingsMapsNearbyRefreshBtn');
  const settingsLocationMeta = document.getElementById('settingsLocationMeta');
  const settingsToolErrorsLog = document.getElementById('settingsToolErrorsLog');
  const settingsToolErrorsClearBtn = document.getElementById('settingsToolErrorsClearBtn');
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
  let pendingChatRenderAllowAutoScroll = true;
  let chatBottomAlignToken = 0;
  let chatStreamBottomReservePx = 0;
  let chatHistoryRenderLimit = CHAT_STARTUP_RENDER_MAX_MESSAGES;
  let chatHistoryHydrationPromise = null;
  let chatHistoryHydrated = false;
  let modelWarmupPromise = null;
  let localToolErrorLog = [];
  let nativeHostDiagnostics = {
    ok: false,
    hostName: '',
    checkedAt: 0,
    message: '',
    version: '',
    capabilities: []
  };
  let nativeHostPingInFlight = false;
  let toolsScreenController = null;
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
  let whatsappSuggestionActiveChatKey = '';
  let whatsappSuggestionToken = 0;
  let whatsappSuggestionRefreshTimer = 0;
  let queuedWhatsappSuggestionTab = null;
  let whatsappSuggestionDismissedSignalKey = '';
  let whatsappSuggestionModelCooldownUntil = 0;
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
  let dynamicContextRenderKey = '';
  let dynamicRelationDetailRenderKey = '';
  let tabsContextJsonRenderKey = '';
  let dynamicSuggestionRenderIds = new Set();
  let dynamicRelationRenderIds = new Set();
  let dynamicUiToastHideTimer = 0;
  let dynamicUiToastKey = '';
  let realtimeContextIngestionEnabled = ENABLE_REALTIME_CONTEXT_INGESTION;
  let contextIngestionPromise = Promise.resolve();
  let whatsappHistorySyncPromise = Promise.resolve();
  let whatsappHistorySyncNextAllowedByTab = new Map();
  let whatsappLiveContextBlockedUntilByTab = new Map();
  let whatsappHistoryVectorFingerprintByKey = new Map();
  let whatsappAliasBook = {
    version: WHATSAPP_ALIAS_STORAGE_VERSION,
    updatedAt: 0,
    aliases: {}
  };
  let whatsappAliasWritePromise = Promise.resolve();
  let whatsappAliasDbIndexSyncPromise = Promise.resolve({
    changed: false,
    added: 0,
    updated: 0,
    scannedChats: 0,
    assignments: 0
  });
  let whatsappAliasDbIndexSyncedAt = 0;
  let initialContextSyncPromise = null;
  const runtimeScriptPromiseByPath = new Map();
  const runtimeListenerMonitor = createRuntimeListenerMonitor();
  let runtimeGcTimerId = 0;
  let runtimeListenerWarnedAt = 0;
  let voiceRuntimeDependenciesPromise = null;
  let initialContextBootstrapTimerId = 0;
  let initialContextBootstrapIdleId = 0;
  let initialContextBootstrapStarted = false;
  let chatInputResizeRafId = 0;
  let chatInputSizeMetrics = {
    width: -1,
    maxHeight: 0,
    minimum: 0
  };
  function createInitialVoiceCaptureState() {
    return {
      mode: 'idle',
      mediaStream: null,
      mediaRecorder: null,
      vad: null,
      vadRedemptionMs: 0,
      usingVad: false,
      chunks: [],
      audioContext: null,
      analyser: null,
      sourceNode: null,
      sampleBuffer: null,
      graphStreamId: '',
      rafId: 0,
      silenceSince: 0,
      startedAt: 0,
      maxStopTimer: 0
    };
  }

  let voiceCaptureState = createInitialVoiceCaptureState();
  let activeTtsAudio = null;
  let activeTtsObjectUrl = '';
  let voiceSessionActive = false;
  let voiceSessionResumeTimer = 0;
  let activeVoiceTranscriptionAbortController = null;
  let activeChatAbortController = null;
  let voiceReplySyncState = {
    messageId: '',
    rafId: 0,
    startedAt: 0,
    fullText: '',
    audio: null
  };
  let voiceButtonMeterState = {
    audioContext: null,
    sourceNode: null,
    analyser: null,
    sampleBuffer: null,
    rafId: 0,
    level: 0
  };
  let runtimeMessageListenerAttached = false;
  let microphonePermissionHelperFlow = {
    inFlight: false,
    requestId: '',
    openedAt: 0,
    source: ''
  };

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

  function createRuntimeListenerMonitor() {
    const targetIndex = new WeakMap();
    const listenerIds = new WeakMap();
    let listenerIdSeq = 0;
    let activeCount = 0;
    let peakCount = 0;
    let installed = false;
    let originalAdd = null;
    let originalRemove = null;

    function normalizeType(type) {
      return String(type || '').trim();
    }

    function isSupportedListener(listener) {
      return typeof listener === 'function' || (listener && typeof listener === 'object');
    }

    function isOnce(options) {
      return Boolean(options && typeof options === 'object' && options.once === true);
    }

    function resolveCapture(options) {
      if (typeof options === 'boolean') {
        return options === true;
      }
      return Boolean(options && typeof options === 'object' && options.capture === true);
    }

    function resolveListenerToken(listener) {
      if (!isSupportedListener(listener)) {
        return '';
      }

      let token = listenerIds.get(listener);
      if (token) {
        return token;
      }

      listenerIdSeq += 1;
      token = `l${listenerIdSeq}`;
      listenerIds.set(listener, token);
      return token;
    }

    function getTargetTypes(target, create = false) {
      if (!target) {
        return null;
      }
      let typeMap = targetIndex.get(target) || null;
      if (!typeMap && create) {
        typeMap = new Map();
        targetIndex.set(target, typeMap);
      }
      return typeMap;
    }

    function trackAdd(target, type, listener, options) {
      const safeType = normalizeType(type);
      if (!safeType || !isSupportedListener(listener) || isOnce(options)) {
        return;
      }

      const token = resolveListenerToken(listener);
      if (!token) {
        return;
      }

      const typeMap = getTargetTypes(target, true);
      if (!typeMap) {
        return;
      }

      let listeners = typeMap.get(safeType) || null;
      if (!listeners) {
        listeners = new Set();
        typeMap.set(safeType, listeners);
      }

      const key = `${resolveCapture(options) ? '1' : '0'}:${token}`;
      if (listeners.has(key)) {
        return;
      }

      listeners.add(key);
      activeCount += 1;
      if (activeCount > peakCount) {
        peakCount = activeCount;
      }
    }

    function trackRemove(target, type, listener, options) {
      const safeType = normalizeType(type);
      if (!safeType || !isSupportedListener(listener)) {
        return;
      }

      const token = resolveListenerToken(listener);
      if (!token) {
        return;
      }

      const typeMap = getTargetTypes(target, false);
      if (!typeMap) {
        return;
      }

      const listeners = typeMap.get(safeType);
      if (!listeners || !listeners.size) {
        return;
      }

      const key = `${resolveCapture(options) ? '1' : '0'}:${token}`;
      if (!listeners.delete(key)) {
        return;
      }

      activeCount = Math.max(0, activeCount - 1);
      if (!listeners.size) {
        typeMap.delete(safeType);
      }
    }

    function install() {
      if (installed || !window?.EventTarget?.prototype) {
        return false;
      }

      originalAdd = EventTarget.prototype.addEventListener;
      originalRemove = EventTarget.prototype.removeEventListener;
      if (typeof originalAdd !== 'function' || typeof originalRemove !== 'function') {
        return false;
      }

      EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
        trackAdd(this, type, listener, options);
        return originalAdd.call(this, type, listener, options);
      };

      EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
        trackRemove(this, type, listener, options);
        return originalRemove.call(this, type, listener, options);
      };

      installed = true;
      return true;
    }

    function uninstall() {
      if (!installed || !window?.EventTarget?.prototype) {
        return false;
      }
      if (typeof originalAdd === 'function') {
        EventTarget.prototype.addEventListener = originalAdd;
      }
      if (typeof originalRemove === 'function') {
        EventTarget.prototype.removeEventListener = originalRemove;
      }
      installed = false;
      return true;
    }

    function snapshot() {
      return {
        installed,
        activeCount: Math.max(0, Number(activeCount) || 0),
        peakCount: Math.max(0, Number(peakCount) || 0)
      };
    }

    return {
      install,
      uninstall,
      snapshot
    };
  }

  function isNoisyContextLogMessage(message) {
    const token = String(message || '')
      .trim()
      .toLowerCase();
    if (!token) {
      return false;
    }
    return NOISY_CONTEXT_LOG_PREFIXES.some((prefix) => token.startsWith(prefix));
  }

  function logDebug(message, payload) {
    if (!ENABLE_PANEL_DEBUG_LOGS) {
      return;
    }
    if (isNoisyContextLogMessage(message)) {
      return;
    }
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

  function logInfo(message, payload) {
    if (!ENABLE_PANEL_INFO_LOGS) {
      return;
    }
    if (isNoisyContextLogMessage(message)) {
      return;
    }
    if (payload === undefined) {
      console.info(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.info(`${LOG_PREFIX} ${message}`, payload);
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

  function summarizeWhatsappTraceContext(tabContext) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const messages = Array.isArray(details.messages) ? details.messages : [];
    const tail = messages.slice(-3).map((item) => ({
      id: toSafeLogText(item?.id || '', 80),
      role: item?.role === 'me' ? 'me' : 'contact',
      kind: toSafeLogText(item?.kind || '', 24),
      text: toSafeLogText(item?.text || '', 120)
    }));

    return {
      tabId: Number(context.tabId) || -1,
      site: toSafeLogText(context.site || '', 24),
      url: toSafeLogText(context.url || '', 120),
      chatKey: toSafeLogText(getWhatsappChatKey(context), 120),
      chatTitle: toSafeLogText(currentChat.title || '', 120),
      chatPhone: toSafeLogText(currentChat.phone || '', 42),
      channelId: toSafeLogText(currentChat.channelId || '', 120),
      messageCount: messages.length,
      lastMessageId: toSafeLogText(messages.length ? messages[messages.length - 1]?.id || '' : '', 80),
      tail
    };
  }

  function logWhatsappSuggestionTrace(stage, payload) {
    if (!ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
      return;
    }

    const tag = `${LOG_PREFIX} [wa-suggestion] ${stage}`;
    if (payload === undefined) {
      console.log(tag);
      return;
    }

    console.log(tag, payload);
  }

  const dynamicRelationsService = createDynamicRelationsService({
    isWhatsappContext,
    isLikelyUserTableName,
    isCrmErpMeProfileComplete,
    splitQualifiedTableName,
    getCrmErpDatabaseConnectionUrl,
    getCrmErpDatabaseSchemaSnapshot,
    getCrmErpDatabaseMeProfile,
    postgresService,
    logDebug,
    toSafeLogText
  });
  const {
    buildDynamicRelationsSignalKey,
    buildRelationSimpleColumns,
    collectDynamicSignalsFromTab,
    fetchDynamicRelationCards,
    fetchDynamicRelationGroups,
    isEmailColumnName,
    isLabelColumnName,
    isLikelyIdColumnName
  } = dynamicRelationsService;

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
        transport: ['http_agent', 'native_host'].includes(String(rawSmtp.transport || '').trim())
          ? String(rawSmtp.transport || '').trim()
          : String(defaults.smtp.transport || 'http_agent'),
        nativeHostName: String(rawSmtp.nativeHostName || defaults.smtp.nativeHostName || '').trim().slice(0, 180),
        agentUrl: String(rawSmtp.agentUrl || rawSmtp.endpoint || defaults.smtp.agentUrl || '').trim().slice(0, 500),
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

  function isSettingsScreenActive() {
    return String(app?.dataset?.screen || '').trim() === 'settings';
  }

  function isToolsScreenActive() {
    return String(app?.dataset?.screen || '').trim() === 'tools';
  }

  function shouldPreserveIntegrationsScroll() {
    if (!settingsBody || !isSettingsScreenActive()) {
      return false;
    }

    const currentPage = getCurrentSettingsPage();
    return currentPage === SETTINGS_PAGES.APPS_INTEGRATIONS || currentPage === SETTINGS_PAGES.LOCAL_CONNECTOR;
  }

  function runWithSettingsScrollPreserved(task, options = {}) {
    const callback = typeof task === 'function' ? task : null;
    if (!callback) {
      return;
    }

    const enabled = options.enabled !== false && shouldPreserveIntegrationsScroll();
    if (!enabled) {
      callback();
      return;
    }

    const previousScrollTop = settingsBody.scrollTop;
    callback();
    settingsBody.scrollTop = previousScrollTop;
  }

  function renderAppsIntegrationsSettings(options = {}) {
    const syncInput = options.syncInput !== false;
    const integrations = getIntegrationsConfig();
    const smtp = integrations.smtp || {};
    const maps = integrations.maps || {};
    const permissions = integrations.permissions || {};
    runWithSettingsScrollPreserved(
      () => {
        if (syncInput) {
          if (settingsSmtpTransportSelect) {
            settingsSmtpTransportSelect.value = ['http_agent', 'native_host'].includes(String(smtp.transport || ''))
              ? String(smtp.transport || 'http_agent')
              : 'http_agent';
          }
          if (settingsSmtpNativeHostInput) {
            settingsSmtpNativeHostInput.value = String(smtp.nativeHostName || '');
          }
          if (settingsSmtpAgentUrlInput) {
            settingsSmtpAgentUrlInput.value = String(smtp.agentUrl || '');
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
        if (settingsPermissionMicBtn) {
          const micState = normalizeIntegrationPermissionState(permissions.microphone);
          settingsPermissionMicBtn.textContent =
            micState === 'granted' ? 'Microfono concedido' : micState === 'denied' ? 'Reintentar microfono' : 'Pedir microfono';
        }
        renderToolErrorsLog();
      },
      {
        enabled: options.preserveScroll !== false
      }
    );

    renderNativeHostBridgeSection({
      preserveScroll: options.preserveScroll !== false
    });

    const platform = detectHostPlatform();
    const shouldTryAutoPing = smtp.transport === 'native_host' && platform.supported && !nativeHostPingInFlight;
    const expectedHost = String(smtp.nativeHostName || '').trim();
    const sameHost = expectedHost && expectedHost === nativeHostDiagnostics.hostName;
    const stalePing = Date.now() - Math.max(0, Number(nativeHostDiagnostics.checkedAt) || 0) > NATIVE_HOST_PING_STALE_MS;
    if (shouldTryAutoPing && expectedHost && (!sameHost || stalePing || !nativeHostDiagnostics.ok)) {
      void pingNativeHostBridge({ silent: true, hostName: expectedHost });
    }

    renderChatSendButtonState();
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
        ...getIntegrationsConfig().smtp,
        transport: String(settingsSmtpTransportSelect?.value || 'http_agent'),
        nativeHostName: String(settingsSmtpNativeHostInput?.value || ''),
        agentUrl: String(settingsSmtpAgentUrlInput?.value || ''),
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

  function normalizeMapsToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function normalizeNearbyPlaceType(rawType, fallbackType = 'restaurant') {
    const aliases = {
      restaurant: 'restaurant',
      restaurantes: 'restaurant',
      restaurante: 'restaurant',
      cafe: 'cafe',
      cafeteria: 'cafe',
      cafeterias: 'cafe',
      bar: 'bar',
      hotel: 'hotel',
      pharmacy: 'pharmacy',
      farmacia: 'pharmacy',
      farmacias: 'pharmacy',
      real_estate_agency: 'real_estate_agency',
      real_estate: 'real_estate_agency',
      realestate: 'real_estate_agency',
      inmobiliaria: 'real_estate_agency',
      inmobiliarias: 'real_estate_agency',
      bienes_raices: 'real_estate_agency',
      bank: 'bank',
      banco: 'bank',
      bancos: 'bank',
      supermarket: 'supermarket',
      supermercado: 'supermarket',
      supermercados: 'supermarket',
      hospital: 'hospital',
      hospitals: 'hospital',
      gas_station: 'gas_station',
      gasolinera: 'gas_station',
      gasolineras: 'gas_station',
      gym: 'gym',
      gimnasio: 'gym',
      gimnasios: 'gym'
    };
    const token = normalizeMapsToken(rawType);
    const fallbackToken = normalizeMapsToken(fallbackType || 'restaurant');
    const safeFallback = aliases[fallbackToken] || (/^[a-z_]{3,60}$/.test(fallbackToken) ? fallbackToken : 'restaurant');

    if (!token) {
      return safeFallback;
    }

    if (aliases[token]) {
      return aliases[token];
    }

    if (/^[a-z_]{3,60}$/.test(token)) {
      return token;
    }

    return safeFallback;
  }

  function buildMapsUrlForCoordinates(location) {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return '';
    }

    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }

  function normalizeGooglePlaceRecord(rawPlace) {
    const place = rawPlace && typeof rawPlace === 'object' ? rawPlace : {};
    const name = String(place?.displayName?.text || place?.name || '').trim().slice(0, 140);
    if (!name) {
      return null;
    }

    const latitude = Number(place?.location?.latitude);
    const longitude = Number(place?.location?.longitude);
    const mapsUrl = String(place?.googleMapsUri || '').trim().slice(0, 320);

    return {
      name,
      address: String(place?.formattedAddress || '').trim().slice(0, 220),
      rating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : 0,
      userRatingCount: Math.max(0, Number(place?.userRatingCount) || 0),
      primaryType: String(place?.primaryType || '').trim().slice(0, 80),
      placeId: String(place?.id || '').trim().slice(0, 120),
      mapsUrl: mapsUrl || buildMapsUrlForCoordinates({ latitude, longitude }),
      latitude: Number.isFinite(latitude) ? latitude : 0,
      longitude: Number.isFinite(longitude) ? longitude : 0
    };
  }

  async function reverseGeocodeLocation(rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const integrations = getIntegrationsConfig();
    const mapsApiKey = String(integrations.maps?.apiKey || '').trim();
    if (!mapsApiKey) {
      throw new Error('Configura Maps API Key para geocoding.');
    }

    const location = resolveLocationFromArgs(args);
    if (!location) {
      throw new Error('No hay ubicacion disponible para geocoding.');
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('No hay coordenadas validas para geocoding.');
    }

    const languageCode = String(args.languageCode || args.language || 'es').trim().slice(0, 12) || 'es';
    const endpoint = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    endpoint.searchParams.set('latlng', `${latitude},${longitude}`);
    endpoint.searchParams.set('language', languageCode);
    endpoint.searchParams.set('key', mapsApiKey);

    const response = await fetch(endpoint.toString());
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const errorText = String(payload?.error_message || payload?.status || `HTTP ${response.status}`).trim();
      throw new Error(`Maps geocode error: ${errorText}`);
    }

    const status = String(payload?.status || '').trim();
    if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
      const errorText = String(payload?.error_message || status || 'geocode_failed').trim();
      throw new Error(`Maps geocode error: ${errorText}`);
    }

    const firstResult = Array.isArray(payload?.results) ? payload.results[0] : null;
    return {
      location: {
        latitude,
        longitude
      },
      address: String(firstResult?.formatted_address || '').trim().slice(0, 260),
      placeId: String(firstResult?.place_id || '').trim().slice(0, 120),
      types: Array.isArray(firstResult?.types) ? firstResult.types.slice(0, 10) : [],
      mapsUrl: buildMapsUrlForCoordinates({ latitude, longitude })
    };
  }

  async function searchPlacesByTextForLocation(location, options = {}) {
    const safeLocation = location && typeof location === 'object' ? location : null;
    const latitude = Number(safeLocation?.latitude);
    const longitude = Number(safeLocation?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('No hay coordenadas validas para buscar lugares.');
    }

    const integrations = getIntegrationsConfig();
    const mapsApiKey = String(integrations.maps?.apiKey || '').trim();
    if (!mapsApiKey) {
      throw new Error('Configura Maps API Key para buscar lugares.');
    }

    const query = String(options.query || options.text || '').trim().slice(0, 180);
    if (!query) {
      throw new Error('maps.searchPlaces requiere args.query.');
    }

    const radiusMeters = Math.max(100, Math.min(50000, Number(options.radiusMeters) || 2500));
    const maxResultCount = Math.max(1, Math.min(20, Number(options.maxResultCount) || 8));
    const languageCode = String(options.languageCode || options.language || 'es').trim().slice(0, 12) || 'es';

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsApiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryType,places.googleMapsUri,places.location'
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: maxResultCount,
        languageCode,
        locationBias: {
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
      throw new Error(`Maps search error: ${errorText}`);
    }

    return (Array.isArray(payload?.places) ? payload.places : [])
      .map((item) => normalizeGooglePlaceRecord(item))
      .filter(Boolean)
      .slice(0, maxResultCount);
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

    const fallbackType = integrations.maps?.nearbyType || 'restaurant';
    const nearbyType = normalizeNearbyPlaceType(options.nearbyType || options.type || fallbackType, fallbackType);
    const radiusMeters = Math.max(100, Math.min(50000, Number(options.radiusMeters) || 1500));
    const maxResultCount = Math.max(1, Math.min(20, Number(options.maxResultCount) || 6));

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsApiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryType,places.googleMapsUri,places.location'
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

    return (Array.isArray(payload?.places) ? payload.places : [])
      .map((item) => normalizeGooglePlaceRecord(item))
      .filter(Boolean)
      .slice(0, maxResultCount);
  }

  async function persistMapsLocationSnapshot(location, places = []) {
    const safeLocation = location && typeof location === 'object' ? location : null;
    const latitude = Number(safeLocation?.latitude);
    const longitude = Number(safeLocation?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return false;
    }

    const integrations = getIntegrationsConfig();
    const nextIntegrations = normalizeIntegrationsConfig({
      ...integrations,
      maps: {
        ...integrations.maps,
        lastKnownLocation: {
          ...(integrations.maps?.lastKnownLocation || {}),
          latitude,
          longitude,
          capturedAt: Date.now()
        },
        nearbyPlaces: Array.isArray(places) ? places : []
      }
    });

    const ok = await savePanelSettings({ integrations: nextIntegrations });
    if (ok) {
      renderAppsIntegrationsSettings({ syncInput: false });
    }
    return ok;
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
        setStatus(settingsIntegrationsStatus, error instanceof Error ? error.message : 'No se pudieron actualizar lugares cercanos.', true);
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

  async function readBrowserMicrophonePermissionState() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
      return 'unsupported';
    }

    try {
      const status = await navigator.permissions.query({ name: 'microphone' });
      const state = normalizeIntegrationPermissionState(status?.state);
      return state || 'prompt';
    } catch (_) {
      return 'unsupported';
    }
  }

  function classifyMicrophoneAccessError(error) {
    const name = String(error?.name || '').trim();
    const code = name.toLowerCase();
    const rawMessage = String(error?.message || '').trim();
    const messageToken = rawMessage.toLowerCase();
    const dismissed = code === 'notallowederror' && /(dismiss|closed|ignore|cancel)/i.test(messageToken);
    if (dismissed) {
      return {
        code,
        name,
        rawMessage,
        permissionState: 'prompt',
        userMessage: 'Permission dismissed: se cerro el popup del microfono sin elegir.',
        hint: 'Haz click de nuevo y pulsa "Permitir".'
      };
    }

    if (code === 'notallowederror') {
      return {
        code,
        name,
        rawMessage,
        permissionState: 'denied',
        userMessage: 'Microfono bloqueado por Chrome.',
        hint: 'Abre el icono del candado/sitio y permite Microfono para esta extension.'
      };
    }

    if (code === 'notfounderror' || code === 'devicesnotfounderror') {
      return {
        code,
        name,
        rawMessage,
        permissionState: 'prompt',
        userMessage: 'No se detecto ningun microfono disponible.',
        hint: 'Conecta/activa un microfono y vuelve a intentar.'
      };
    }

    if (code === 'notreadableerror' || code === 'trackstarterror') {
      return {
        code,
        name,
        rawMessage,
        permissionState: 'prompt',
        userMessage: 'No se pudo abrir el microfono (puede estar ocupado por otra app).',
        hint: 'Cierra apps que esten usando el microfono y reintenta.'
      };
    }

    if (code === 'securityerror') {
      return {
        code,
        name,
        rawMessage,
        permissionState: 'prompt',
        userMessage: 'Chrome bloqueo acceso al microfono por seguridad.',
        hint: 'Recarga la extension y vuelve a probar.'
      };
    }

    return {
      code,
      name,
      rawMessage,
      permissionState: 'prompt',
      userMessage: 'No se pudo obtener permiso de microfono.',
      hint: rawMessage ? `Detalle: ${rawMessage}` : ''
    };
  }

  function createMicrophonePermissionHelperRequestId() {
    const nowToken = Date.now().toString(36);
    const randomToken = Math.random()
      .toString(36)
      .slice(2, 10);
    return `mic_${nowToken}_${randomToken}`;
  }

  function buildMicrophonePermissionHelperUrl(options = {}) {
    const requestId = String(options?.requestId || '').trim();
    const source = String(options?.source || '').trim();
    const returnTabId = Number(options?.returnTabId);
    const baseUrl =
      chrome?.runtime && typeof chrome.runtime.getURL === 'function'
        ? chrome.runtime.getURL(MICROPHONE_PERMISSION_HELPER_PAGE_PATH)
        : MICROPHONE_PERMISSION_HELPER_PAGE_PATH;

    const url = new URL(baseUrl);
    if (requestId) {
      url.searchParams.set('requestId', requestId);
    }
    if (source) {
      url.searchParams.set('source', source);
    }
    if (Number.isFinite(returnTabId) && returnTabId > 0) {
      url.searchParams.set('returnTabId', String(returnTabId));
    }
    return url.toString();
  }

  async function queryActiveTabInCurrentWindow() {
    if (!chrome?.tabs || typeof chrome.tabs.query !== 'function') {
      return null;
    }

    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (chrome.runtime?.lastError) {
            resolve(null);
            return;
          }

          const firstTab = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
          resolve(firstTab && typeof firstTab === 'object' ? firstTab : null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function createBrowserTab(createProperties = {}) {
    if (!chrome?.tabs || typeof chrome.tabs.create !== 'function') {
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.create(createProperties, (tab) => {
          if (chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'No se pudo abrir pestana de permiso.'));
            return;
          }
          resolve(tab && typeof tab === 'object' ? tab : null);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('No se pudo abrir pestana de permiso.'));
      }
    });
  }

  function shouldUseMicrophonePermissionTabFallback(detail, browserPermissionBefore, browserPermissionAfter) {
    const safeDetail = detail && typeof detail === 'object' ? detail : {};
    const code = String(safeDetail.code || '').trim().toLowerCase();
    if (code !== 'notallowederror') {
      return false;
    }

    const beforeState = normalizeIntegrationPermissionState(browserPermissionBefore);
    const afterState = normalizeIntegrationPermissionState(browserPermissionAfter);
    if (beforeState === 'denied' || afterState === 'denied') {
      return false;
    }

    const token = `${safeDetail.rawMessage || ''} ${safeDetail.userMessage || ''}`.toLowerCase();
    const hasDismissToken = /(dismiss|closed|cancel|ignore|permission dismissed)/i.test(token);
    return hasDismissToken || (beforeState === 'prompt' && afterState === 'prompt');
  }

  async function openMicrophonePermissionHelperTab(options = {}) {
    const source = String(options?.source || 'unknown').trim() || 'unknown';
    const now = Date.now();
    if (
      microphonePermissionHelperFlow.inFlight &&
      now - Math.max(0, Number(microphonePermissionHelperFlow.openedAt) || 0) < MICROPHONE_PERMISSION_HELPER_COOLDOWN_MS
    ) {
      logInfo('microphone:helper_tab:skip_recent', {
        source,
        requestId: microphonePermissionHelperFlow.requestId
      });
      return true;
    }

    const requestId = createMicrophonePermissionHelperRequestId();
    const activeTab = await queryActiveTabInCurrentWindow();
    const returnTabId = Number(activeTab?.id);
    const targetUrl = buildMicrophonePermissionHelperUrl({
      requestId,
      source,
      returnTabId
    });

    logInfo('microphone:helper_tab:open', {
      source,
      requestId,
      returnTabId: Number.isFinite(returnTabId) ? returnTabId : 0
    });

    try {
      await createBrowserTab({
        url: targetUrl,
        active: true
      });
      microphonePermissionHelperFlow = {
        inFlight: true,
        requestId,
        openedAt: now,
        source
      };
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'No se pudo abrir pestana de permiso.';
      logWarn('microphone:helper_tab:open_failed', {
        source,
        requestId,
        error: errorMessage
      });
      microphonePermissionHelperFlow = {
        inFlight: false,
        requestId: '',
        openedAt: 0,
        source: ''
      };
      return false;
    }
  }

  async function handleMicrophonePermissionResultMessage(payload = {}, sender = null) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const status = String(safePayload.status || '').trim().toLowerCase();
    const permissionStateRaw = String(safePayload.permissionState || '').trim().toLowerCase();
    const message = String(safePayload.message || '').trim();
    const requestId = String(safePayload.requestId || '').trim();
    const source = String(safePayload.source || '').trim() || 'unknown';
    const helperTabId = Number(sender?.tab?.id);
    const helperUrl = String(sender?.tab?.url || sender?.url || '').trim();

    const permissionState =
      permissionStateRaw === 'granted' || permissionStateRaw === 'denied' || permissionStateRaw === 'prompt'
        ? permissionStateRaw
        : status === 'granted'
          ? 'granted'
          : status === 'denied'
            ? 'denied'
            : 'prompt';

    logInfo('microphone:helper_tab:result', {
      source,
      status,
      permissionState,
      requestId,
      helperTabId: Number.isFinite(helperTabId) ? helperTabId : 0,
      helperUrl,
      flowRequestId: microphonePermissionHelperFlow.requestId
    });

    microphonePermissionHelperFlow = {
      inFlight: false,
      requestId: '',
      openedAt: 0,
      source: ''
    };

    await setMicrophonePermissionState(permissionState);

    if (status === 'granted') {
      setStatus(settingsIntegrationsStatus, 'Permiso de microfono concedido desde pestana auxiliar.');
      setStatus(chatStatus, 'Microfono listo. Regresa al panel y toca waves para grabar.');
      return;
    }

    if (status === 'denied') {
      setStatus(
        settingsIntegrationsStatus,
        'Microfono bloqueado por Chrome. Habilitalo en permisos del sitio de extension.',
        true
      );
      setStatus(chatStatus, 'Microfono bloqueado por Chrome.', true);
      return;
    }

    const dismissedMessage = message || 'Permiso de microfono no confirmado.';
    setStatus(settingsIntegrationsStatus, dismissedMessage, true);
    setStatus(chatStatus, dismissedMessage, true);
  }

  function handlePanelRuntimeMessage(message, sender) {
    const type = String(message?.type || '').trim();
    if (type !== MICROPHONE_PERMISSION_RESULT_MESSAGE_TYPE) {
      return;
    }

    void handleMicrophonePermissionResultMessage(message?.payload || {}, sender);
  }

  function attachRuntimeMessageListener() {
    if (runtimeMessageListenerAttached) {
      return;
    }

    if (!chrome?.runtime?.onMessage || typeof chrome.runtime.onMessage.addListener !== 'function') {
      return;
    }

    chrome.runtime.onMessage.addListener(handlePanelRuntimeMessage);
    runtimeMessageListenerAttached = true;
  }

  function detachRuntimeMessageListener() {
    if (!runtimeMessageListenerAttached) {
      return;
    }

    if (!chrome?.runtime?.onMessage || typeof chrome.runtime.onMessage.removeListener !== 'function') {
      return;
    }

    chrome.runtime.onMessage.removeListener(handlePanelRuntimeMessage);
    runtimeMessageListenerAttached = false;
  }

  async function requestMicrophonePermissionAndSync(options = {}) {
    const source = String(options?.source || 'settings').trim() || 'settings';
    const allowTabFallback = options?.allowTabFallback !== false;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStatus(settingsIntegrationsStatus, 'Microfono no soportado en este navegador.', true);
      logWarn('microphone:unsupported', {
        source,
        hasMediaDevices: Boolean(navigator.mediaDevices),
        hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia)
      });
      return false;
    }

    const browserPermissionBefore = await readBrowserMicrophonePermissionState();
    logInfo('microphone:request:start', {
      source,
      browserPermissionBefore,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      isSecureContext: window.isSecureContext,
      url: window.location.href
    });

    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const detail = classifyMicrophoneAccessError(error);
      if (detail.permissionState) {
        await setMicrophonePermissionState(detail.permissionState);
      }
      const browserPermissionAfter = await readBrowserMicrophonePermissionState();
      logWarn('microphone:request:failed', {
        source,
        code: detail.code,
        name: detail.name,
        rawMessage: detail.rawMessage,
        browserPermissionBefore,
        browserPermissionAfter
      });
      const shouldFallback =
        allowTabFallback && shouldUseMicrophonePermissionTabFallback(detail, browserPermissionBefore, browserPermissionAfter);
      if (shouldFallback) {
        const opened = await openMicrophonePermissionHelperTab({
          source
        });
        if (opened) {
          setStatus(
            settingsIntegrationsStatus,
            'Chrome no pudo mostrar el permiso desde side panel. Se abrio una pestana para autorizar microfono.'
          );
          return false;
        }
      }
      throw new Error([detail.userMessage, detail.hint].filter(Boolean).join(' '));
    }

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

    const browserPermissionAfter = await readBrowserMicrophonePermissionState();
    logInfo('microphone:request:granted', {
      source,
      browserPermissionBefore,
      browserPermissionAfter
    });
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
      throw new Error('No se pudieron guardar lugares cercanos.');
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
    if (!first) {
      return false;
    }

    try {
      first.focus({ preventScroll: true });
    } catch (_) {
      first.focus();
    }
    first.select?.();
    return document.activeElement === first;
  }

  function requestPinFirstDigitFocus(attempts = 8, delayMs = 70) {
    let attempt = 0;
    const maxAttempts = Math.max(1, Number(attempts) || 8);
    const safeDelayMs = Math.max(20, Number(delayMs) || 70);

    const run = () => {
      if (!pinModal || pinModal.hidden) {
        return;
      }

      const focused = focusPinFirstDigit();
      if (focused) {
        return;
      }

      attempt += 1;
      if (attempt < maxAttempts) {
        window.setTimeout(run, safeDelayMs);
      }
    };

    run();
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

  function isBlockingModalOpen() {
    const isPinModalOpen = Boolean(pinModal && pinModal.hidden !== true);
    const isModelConfigOpen = Boolean(modelConfigModal && modelConfigModal.hidden !== true);
    return isPinModalOpen || isModelConfigOpen;
  }

  function focusChatInput() {
    if (isBlockingModalOpen()) {
      return;
    }

    try {
      chatInput.focus({ preventScroll: true });
    } catch (_) {
      chatInput.focus();
    }
  }

  function shouldAutofocusChatInput() {
    return app && app.dataset.screen === 'home' && !isGeneratingChat && !isBlockingModalOpen();
  }

  function focusOnboardingAssistantInput() {
    const target = onboardingAssistantNameInput;
    if (!target || !app || app.dataset.screen !== 'onboarding' || isBlockingModalOpen()) {
      return false;
    }

    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
    return document.activeElement === target;
  }

  function setAppBootstrapState(isReady) {
    if (!app) {
      return;
    }

    app.dataset.bootstrap = isReady ? 'ready' : 'loading';
    if (isReady && appBootstrapMask) {
      appBootstrapMask.setAttribute('aria-hidden', 'true');
    }
  }

  function waitForMs(durationMs = 0) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(durationMs) || 0));
    });
  }

  function clearInitialContextBootstrapSchedule() {
    if (initialContextBootstrapTimerId) {
      window.clearTimeout(initialContextBootstrapTimerId);
      initialContextBootstrapTimerId = 0;
    }

    if (initialContextBootstrapIdleId && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(initialContextBootstrapIdleId);
      initialContextBootstrapIdleId = 0;
    }
  }

  function scheduleInitialContextBootstrap(options = {}) {
    if (initialContextBootstrapStarted || initialContextSyncPromise) {
      return;
    }

    const delayMs = Math.max(250, Number(options.delayMs) || INITIAL_CONTEXT_BOOTSTRAP_DELAY_MS);
    const idleTimeoutMs = Math.max(1000, Number(options.idleTimeoutMs) || INITIAL_CONTEXT_BOOTSTRAP_IDLE_TIMEOUT_MS);

    const startBootstrap = () => {
      if (initialContextBootstrapStarted) {
        return;
      }
      initialContextBootstrapStarted = true;
      clearInitialContextBootstrapSchedule();
      void runInitialContextBootstrap().catch((error) => {
        logWarn('initial_context_sync:schedule_failed', {
          error: error instanceof Error ? error.message : String(error || '')
        });
      });
    };

    clearInitialContextBootstrapSchedule();
    initialContextBootstrapTimerId = window.setTimeout(startBootstrap, delayMs);
    if (typeof window.requestIdleCallback === 'function') {
      initialContextBootstrapIdleId = window.requestIdleCallback(startBootstrap, {
        timeout: idleTimeoutMs
      });
    }
  }

  function ensureRuntimeScriptLoaded(scriptPath, readyCheck) {
    const safePath = String(scriptPath || '').trim();
    if (!safePath) {
      return Promise.resolve(false);
    }

    if (typeof readyCheck === 'function' && readyCheck()) {
      return Promise.resolve(true);
    }

    const inFlight = runtimeScriptPromiseByPath.get(safePath);
    if (inFlight) {
      return inFlight;
    }

    const scriptUrl = new URL(safePath, import.meta.url).href;
    const loaderPromise = new Promise((resolve, reject) => {
      const allScripts = Array.from(document.getElementsByTagName('script'));
      let scriptNode = allScripts.find((item) => item?.src === scriptUrl) || null;

      const verifyReady = () => {
        if (typeof readyCheck === 'function' && !readyCheck()) {
          throw new Error(`Dependencia runtime cargada sin exponer API esperada: ${safePath}`);
        }
        return true;
      };

      const finalize = () => {
        try {
          verifyReady();
          resolve(true);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error || 'No se pudo validar dependencia runtime.')));
        }
      };

      if (!scriptNode) {
        scriptNode = document.createElement('script');
        scriptNode.src = scriptUrl;
        scriptNode.async = true;
        scriptNode.dataset.greeneLazyRuntime = safePath;
        const mount = document.head || document.body || document.documentElement;
        if (!mount) {
          reject(new Error(`No se pudo montar dependencia runtime: ${safePath}`));
          return;
        }
        mount.appendChild(scriptNode);
      } else if (typeof readyCheck !== 'function') {
        resolve(true);
        return;
      } else if (readyCheck()) {
        resolve(true);
        return;
      } else if (scriptNode.dataset.greeneLazyRuntimeLoaded === 'true') {
        reject(new Error(`Dependencia runtime no disponible tras carga previa: ${safePath}`));
        return;
      }

      let timeoutId = 0;
      const handleLoad = () => {
        scriptNode.dataset.greeneLazyRuntimeLoaded = 'true';
        cleanup();
        finalize();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`No se pudo cargar dependencia runtime: ${safePath}`));
      };
      const cleanup = () => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutId = 0;
        }
        scriptNode.removeEventListener('load', handleLoad);
        scriptNode.removeEventListener('error', handleError);
      };

      scriptNode.addEventListener('load', handleLoad, { once: true });
      scriptNode.addEventListener('error', handleError, { once: true });
      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout cargando dependencia runtime: ${safePath}`));
      }, RUNTIME_SCRIPT_LOAD_TIMEOUT_MS);
    });

    const guardedPromise = loaderPromise.catch((error) => {
      runtimeScriptPromiseByPath.delete(safePath);
      throw error;
    });
    runtimeScriptPromiseByPath.set(safePath, guardedPromise);
    return guardedPromise;
  }

  async function ensureVoiceRuntimeDependenciesLoaded() {
    if (getVoiceVadLibrary()) {
      return true;
    }

    if (voiceRuntimeDependenciesPromise) {
      return voiceRuntimeDependenciesPromise;
    }

    voiceRuntimeDependenciesPromise = (async () => {
      await ensureRuntimeScriptLoaded(VOICE_ORT_SCRIPT_PATH, () => typeof window?.ort !== 'undefined');
      await ensureRuntimeScriptLoaded(VOICE_VAD_SCRIPT_PATH, () => Boolean(getVoiceVadLibrary()));
      return Boolean(getVoiceVadLibrary());
    })()
      .catch((error) => {
        logWarn('voice:runtime_dependencies_failed', {
          error: error instanceof Error ? error.message : String(error || '')
        });
        return false;
      })
      .finally(() => {
        voiceRuntimeDependenciesPromise = null;
      });

    return voiceRuntimeDependenciesPromise;
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

  function requestOnboardingAutofocus(attempts = 8, delayMs = 80) {
    let attempt = 0;
    const maxAttempts = Math.max(1, Number(attempts) || 8);
    const safeDelay = Math.max(20, Number(delayMs) || 80);

    const run = () => {
      if (!app || app.dataset.screen !== 'onboarding' || isBlockingModalOpen()) {
        return;
      }

      if (!document.hasFocus()) {
        attempt += 1;
        if (attempt < maxAttempts) {
          window.setTimeout(run, safeDelay);
        }
        return;
      }

      const focused = focusOnboardingAssistantInput();
      if (focused) {
        return;
      }

      attempt += 1;
      if (attempt < maxAttempts) {
        window.setTimeout(run, safeDelay);
      }
    };

    run();
  }

  function requestPrimaryScreenAutofocus(screenName = '', attempts = 8, delayMs = 80) {
    const screen = String(screenName || app?.dataset?.screen || '').trim();
    if (screen === 'home') {
      requestChatAutofocus(attempts, delayMs);
      return;
    }

    if (screen === 'onboarding') {
      requestOnboardingAutofocus(attempts, delayMs);
    }
  }

  function cancelChatBottomAlign() {
    chatBottomAlignToken += 1;
  }

  function requestChatBottomAlign(attempts = 10, delayMs = 70) {
    const maxAttempts = Math.max(1, Number(attempts) || 10);
    const token = ++chatBottomAlignToken;
    let attempt = 0;

    const run = () => {
      if (token !== chatBottomAlignToken) {
        return;
      }

      if (!app || app.dataset.screen !== 'home' || !chatBody) {
        return;
      }

      scrollChatToBottom();
      const remaining = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
      if (remaining <= 2) {
        return;
      }

      attempt += 1;
      if (attempt >= maxAttempts) {
        return;
      }

      window.setTimeout(() => {
        if (token !== chatBottomAlignToken) {
          return;
        }

        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(run);
          return;
        }

        run();
      }, Math.max(30, Number(delayMs) || 70));
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

  function syncActiveScreenState(activeScreen) {
    if (!stageScreens.length) {
      return;
    }

    for (const screenElement of stageScreens) {
      const screenName = String(screenElement.dataset.screenName || '').trim();
      const isActive = screenName === activeScreen;
      screenElement.classList.toggle('is-active', isActive);
      screenElement.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if ('inert' in screenElement) {
        screenElement.inert = !isActive;
      }
    }
  }

  function setScreen(screen) {
    const safeScreen = Object.prototype.hasOwnProperty.call(SCREEN_INDEX, screen) ? screen : 'home';

    if (app) {
      app.dataset.screen = safeScreen;
    }

    syncActiveScreenState(safeScreen);

    if (safeScreen === 'home') {
      scrollChatToBottom();
      requestChatBottomAlign(16, 70);
    }

    if (safeScreen !== 'tools') {
      setDropUi(false);
    }
  }

  function setStageTransitionEnabled(enabled) {
    if (!stageTrack) {
      return;
    }

    stageTrack.classList.toggle('is-transitions-enabled', enabled === true);
  }

  function realignStageToScreen(screenName = '') {
    const fromDom = app && app.dataset ? app.dataset.screen : '';
    const candidate = Object.prototype.hasOwnProperty.call(SCREEN_INDEX, screenName)
      ? screenName
      : Object.prototype.hasOwnProperty.call(SCREEN_INDEX, fromDom)
        ? fromDom
        : 'onboarding';

    setScreen(candidate);
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
      });
    }
  }

  function openTools(toolId = '') {
    const requestedToolId = String(toolId || '').trim();

    if (toolsScreenController) {
      if (requestedToolId) {
        toolsScreenController.openTool(requestedToolId);
      } else {
        toolsScreenController.openHome();
      }
    }

    setScreen('tools');
    setDropUi(dragDepth > 0);
  }

  function openSettings(nextPage = SETTINGS_PAGES.HOME) {
    const safePage = normalizeSettingsPage(nextPage);
    populateSettingsForm();
    setSettingsPage(safePage);
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
    next.voiceActiveListening = true;
    next.voiceTtsVoice = normalizeVoiceTtsVoice(next.voiceTtsVoice || VOICE_TTS_VOICE);
    next.voiceTtsSpeed = normalizeVoiceTtsSpeed(next.voiceTtsSpeed);
    next.voicePauseMs = normalizeVoicePauseMs(next.voicePauseMs);
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

    if (safePage === SETTINGS_PAGES.LOCAL_CONNECTOR) {
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

  function buildChatModelReadinessWarnings() {
    const profile = getActiveModelProfile();
    if (!profile) {
      return ['No hay modelo activo. Configuralo en Settings > AI Models.'];
    }

    const warnings = [];
    if (profile.provider === AI_PROVIDER_IDS.OLLAMA) {
      if (!Array.isArray(localOllamaModels) || !localOllamaModels.length) {
        warnings.push('No se detectaron modelos locales en Ollama. Inicia `ollama serve` o abre la app Ollama.');
      } else {
        const activeModel = String(profile.model || '').trim().toLowerCase();
        const knownModels = localOllamaModels.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
        if (activeModel && !knownModels.includes(activeModel)) {
          warnings.push(`El modelo local activo (${profile.model}) no aparece en Ollama local.`);
        }
      }
    }

    if (aiProviderService.requiresApiKey(profile.provider) && !profile.hasApiKey) {
      warnings.push(`El modelo activo (${profile.name}) requiere API key. Configurala en Settings > AI Models.`);
    }

    return warnings;
  }

  function applyChatModelReadinessStatus(options = {}) {
    const force = Boolean(options.force);
    const warnings = buildChatModelReadinessWarnings();
    if (!warnings.length) {
      return false;
    }

    if (chatHistory.length > 0 && !force) {
      return true;
    }

    setStatus(chatStatus, `Checklist AI: ${warnings.join(' ')}`, true);
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

  function resolveVoiceOptimizedChatProfile() {
    const speechProfile = getOpenAiSpeechProfile();
    if (!speechProfile) {
      return null;
    }

    return aiProviderService.normalizeProfile({
      ...speechProfile,
      model: VOICE_CHAT_RESPONSE_MODEL
    });
  }

  function resolveChatProfileForSource(source = 'text') {
    if (String(source || '').trim().toLowerCase() === 'voice') {
      const voiceProfile = resolveVoiceOptimizedChatProfile();
      if (voiceProfile) {
        return voiceProfile;
      }
    }

    return resolveModelProfileForInference();
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
      renderChatSendButtonState();
      return;
    }

    if (isAiModelsAccessLocked()) {
      aiModelsList.textContent = '';
      renderChatSendButtonState();
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
      renderChatSendButtonState();
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

    renderChatSendButtonState();
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

    requestPinFirstDigitFocus(10, 80);
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
      await hydrateNuwweCredentialsToolUi();
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
      await hydrateNuwweCredentialsToolUi();
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
    updateVoiceModeMetaLabel();
    renderChatSendButtonState();
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
    updateVoiceModeMetaLabel();
    renderChatSendButtonState();
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
    closeDynamicRelationDetailScreen();
    const nextScreen = resolveHomeOrOnboardingScreen();
    setScreen(nextScreen);
    if (nextScreen === 'home') {
      requestChatBottomAlign(12, 70);
    }
    requestPrimaryScreenAutofocus(nextScreen, 8, 80);
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
    applyChatModelReadinessStatus({ force: true });
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

  function normalizeGeneratedImageDataUrl(value, maxLength = MAX_CHAT_IMAGE_DATA_URL_CHARS) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
      return '';
    }

    const compact = raw.replace(/\s+/g, '');
    if (!compact.toLowerCase().startsWith('data:image/')) {
      return '';
    }

    if (compact.length > Math.max(1024, Number(maxLength) || MAX_CHAT_IMAGE_DATA_URL_CHARS)) {
      return '';
    }

    return compact;
  }

  async function readChatHistory(options = {}) {
    return storageService.readChatHistory(options);
  }

  async function saveChatHistory() {
    const payload = chatHistory.map((item) => {
      const source = item && typeof item === 'object' ? item : {};
      const {
        voiceRevealState: _voiceRevealState,
        audioSyncVisibleChars: _audioSyncVisibleChars,
        ...persistedSource
      } = source;
      const generatedImages = Array.isArray(source.generated_images)
        ? source.generated_images
            .map((image) => {
              const imageUrl = String(image?.url || '').trim();
              const imageDataUrl = normalizeGeneratedImageDataUrl(image?.dataUrl || image?.data_url || '');
              if (!imageUrl && !imageDataUrl) {
                return null;
              }
              const width = Math.max(0, Number(image?.width || image?.imageWidth) || 0);
              const height = Math.max(0, Number(image?.height || image?.imageHeight) || 0);
              return {
                url: imageUrl,
                dataUrl: imageDataUrl,
                alt: String(image?.alt || '').trim().slice(0, 220),
                width,
                height
              };
            })
            .filter(Boolean)
            .slice(0, 4)
        : [];

      return {
        ...persistedSource,
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
    panelSettings.voiceActiveListening = true;
    panelSettings.voiceTtsVoice = normalizeVoiceTtsVoice(panelSettings.voiceTtsVoice || VOICE_TTS_VOICE);
    panelSettings.voiceTtsSpeed = normalizeVoiceTtsSpeed(panelSettings.voiceTtsSpeed);
    panelSettings.voicePauseMs = normalizeVoicePauseMs(panelSettings.voicePauseMs);
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
        voiceActiveListening: true,
        voiceTtsVoice: panelSettings.voiceTtsVoice,
        voiceTtsSpeed: panelSettings.voiceTtsSpeed,
        voicePauseMs: panelSettings.voicePauseMs,
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

  function normalizeNuwweCredentials(rawValue) {
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const username = String(source.username || '').trim();
    const password = String(source.password || '').trim();
    const companyCode = String(source.companyCode || '').trim();

    if (!username || !password || !companyCode) {
      return null;
    }

    return {
      username,
      password,
      companyCode
    };
  }

  function sanitizeNuwweSecurityConfigForStorage(rawConfig) {
    const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const saltB64 = String(source.saltB64 || '').trim();
    const verifierIvB64 = String(source.verifierIvB64 || '').trim();
    const verifierCipherB64 = String(source.verifierCipherB64 || '').trim();
    const iterations = Math.max(10000, Number(source.iterations) || 210000);

    if (!saltB64 || !verifierIvB64 || !verifierCipherB64) {
      return null;
    }

    return {
      version: 1,
      iterations,
      saltB64,
      verifierIvB64,
      verifierCipherB64,
      createdAt: Math.max(0, Number(source.createdAt) || 0)
    };
  }

  function normalizeNuwweCredentialStorageRecord(rawValue) {
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const encryptedPayload = source.encryptedPayload && typeof source.encryptedPayload === 'object' ? source.encryptedPayload : null;
    const securityConfig = sanitizeNuwweSecurityConfigForStorage(source.securityConfig);

    if (!encryptedPayload || !securityConfig) {
      return null;
    }

    const ivB64 = String(encryptedPayload.ivB64 || '').trim();
    const cipherB64 = String(encryptedPayload.cipherB64 || '').trim();
    if (!ivB64 || !cipherB64) {
      return null;
    }

    return {
      version: Math.max(1, Number(source.version) || NUWWE_CREDENTIALS_STORAGE_VERSION),
      encryptedPayload: {
        version: 1,
        ivB64,
        cipherB64
      },
      securityConfig,
      updatedAt: Math.max(0, Number(source.updatedAt) || 0)
    };
  }

  async function readNuwweCredentialStorageRecord() {
    const payload = await readChromeLocal({
      [NUWWE_CREDENTIALS_STORAGE_KEY]: null
    });
    return normalizeNuwweCredentialStorageRecord(payload?.[NUWWE_CREDENTIALS_STORAGE_KEY]);
  }

  async function writeNuwweCredentialStorageRecord(record) {
    const normalized = normalizeNuwweCredentialStorageRecord(record);
    if (!normalized) {
      return false;
    }

    return writeChromeLocal({
      [NUWWE_CREDENTIALS_STORAGE_KEY]: normalized
    });
  }

  async function clearNuwweCredentialStorageRecord() {
    return writeChromeLocal({
      [NUWWE_CREDENTIALS_STORAGE_KEY]: null
    });
  }

  async function hydrateNuwweCredentialsToolUi() {
    const record = await readNuwweCredentialStorageRecord();
    if (!record) {
      if (nuwweUsernameInput) {
        nuwweUsernameInput.value = '';
      }
      if (nuwwePasswordInput) {
        nuwwePasswordInput.value = '';
      }
      if (nuwweCompanyCodeInput) {
        nuwweCompanyCodeInput.value = '';
      }
      setStatus(nuwweAutoLoginStatus, 'Sin credenciales guardadas.');
      return;
    }

    const updatedLabel = record.updatedAt > 0 ? new Date(record.updatedAt).toLocaleString() : '';
    const fallbackStatus = updatedLabel
      ? `Credenciales cifradas guardadas (${updatedLabel}).`
      : 'Credenciales cifradas guardadas.';

    if (!isPinUnlocked()) {
      if (nuwwePasswordInput) {
        nuwwePasswordInput.value = '';
      }
      setStatus(nuwweAutoLoginStatus, `${fallbackStatus} Desbloquea PIN para editarlas.`);
      return;
    }

    try {
      const plain = await pinCryptoService.decryptSecret(unlockedPin, record.securityConfig, record.encryptedPayload);
      const parsed = JSON.parse(String(plain || '{}'));
      const credentials = normalizeNuwweCredentials(parsed);
      if (!credentials) {
        setStatus(nuwweAutoLoginStatus, fallbackStatus);
        return;
      }

      if (nuwweUsernameInput) {
        nuwweUsernameInput.value = credentials.username;
      }
      if (nuwwePasswordInput) {
        nuwwePasswordInput.value = '';
      }
      if (nuwweCompanyCodeInput) {
        nuwweCompanyCodeInput.value = credentials.companyCode;
      }
      setStatus(nuwweAutoLoginStatus, fallbackStatus);
    } catch (_) {
      setStatus(nuwweAutoLoginStatus, `${fallbackStatus} No se pudieron descifrar (guarda de nuevo).`);
    }
  }

  async function saveNuwweCredentialsFromToolScreen() {
    const credentials = normalizeNuwweCredentials({
      username: nuwweUsernameInput?.value || '',
      password: nuwwePasswordInput?.value || '',
      companyCode: nuwweCompanyCodeInput?.value || ''
    });

    if (!credentials) {
      setStatus(nuwweAutoLoginStatus, 'Completa usuario, password y codigo de empresa.', true);
      if (!String(nuwweUsernameInput?.value || '').trim()) {
        nuwweUsernameInput?.focus();
      } else if (!String(nuwwePasswordInput?.value || '').trim()) {
        nuwwePasswordInput?.focus();
      } else {
        nuwweCompanyCodeInput?.focus();
      }
      return;
    }

    const pinReady = await ensurePinAccess({
      allowSetup: true,
      statusTarget: nuwweAutoLoginStatus
    });
    if (!pinReady) {
      return;
    }

    const securityConfig = getSecurityConfig();
    if (!pinCryptoService.isConfigured(securityConfig)) {
      setStatus(nuwweAutoLoginStatus, 'Configura PIN para cifrar credenciales.', true);
      return;
    }

    setStatus(nuwweAutoLoginStatus, 'Guardando credenciales cifradas...', false, { loading: true });
    try {
      const plain = JSON.stringify(credentials);
      const encryptedPayload = await pinCryptoService.encryptSecret(unlockedPin, securityConfig, plain);
      const saved = await writeNuwweCredentialStorageRecord({
        version: NUWWE_CREDENTIALS_STORAGE_VERSION,
        encryptedPayload,
        securityConfig: sanitizeNuwweSecurityConfigForStorage(securityConfig),
        updatedAt: Date.now()
      });

      if (!saved) {
        setStatus(nuwweAutoLoginStatus, 'No se pudo guardar credenciales en storage local.', true);
        return;
      }

      if (nuwwePasswordInput) {
        nuwwePasswordInput.value = '';
      }
      await hydrateNuwweCredentialsToolUi();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cifrar credenciales.';
      setStatus(nuwweAutoLoginStatus, message, true);
    }
  }

  async function clearNuwweCredentialsFromToolScreen() {
    setStatus(nuwweAutoLoginStatus, 'Eliminando credenciales...', false, { loading: true });
    const deleted = await clearNuwweCredentialStorageRecord();
    if (!deleted) {
      setStatus(nuwweAutoLoginStatus, 'No se pudieron eliminar credenciales.', true);
      return;
    }

    if (nuwweUsernameInput) {
      nuwweUsernameInput.value = '';
    }
    if (nuwwePasswordInput) {
      nuwwePasswordInput.value = '';
    }
    if (nuwweCompanyCodeInput) {
      nuwweCompanyCodeInput.value = '';
    }
    setStatus(nuwweAutoLoginStatus, 'Credenciales eliminadas.');
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
      renderChatSendButtonState();
      return;
    }

    if (!pendingConversationAttachments.length) {
      chatAttachmentsBar.hidden = true;
      chatAttachmentsBar.textContent = '';
      renderChatSendButtonState();
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

    renderChatSendButtonState();
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

    if (voiceSessionActive) {
      setVoiceSessionActive(false, {
        reason: 'attachments_added'
      });
      if (voiceCaptureState.mode === 'recording') {
        void stopVoiceCapture({
          transcribe: false,
          preserveStatus: true
        });
      } else {
        releaseVoiceSessionResources({
          preserveMode: voiceCaptureState.mode === 'transcribing'
        });
      }
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

  function normalizeVoiceInputLanguage() {
    const normalized = normalizeAssistantLanguage(settingsLanguageSelect?.value || panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE);
    if (normalized === 'en' || normalized === 'pt' || normalized === 'fr') {
      return normalized;
    }
    return normalized || VOICE_TRANSCRIPTION_LANGUAGE;
  }

  function normalizeVoiceTtsVoice(value) {
    const token = String(value || '')
      .trim()
      .toLowerCase();
    if (OPENAI_TTS_VOICE_SET.has(token)) {
      return token;
    }
    return VOICE_TTS_VOICE;
  }

  function normalizeVoiceTtsSpeed(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return VOICE_TTS_SPEED_DEFAULT;
    }

    const clamped = Math.max(VOICE_TTS_SPEED_MIN, Math.min(VOICE_TTS_SPEED_MAX, numeric));
    return Number(clamped.toFixed(2));
  }

  function normalizeVoicePauseMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return VOICE_PAUSE_MS_DEFAULT;
    }

    const clamped = Math.max(VOICE_PAUSE_MS_MIN, Math.min(VOICE_PAUSE_MS_MAX, numeric));
    return Math.round(clamped);
  }

  function getConfiguredVoiceTtsVoice() {
    return normalizeVoiceTtsVoice(settingsVoiceTtsVoiceSelect?.value || panelSettings.voiceTtsVoice || VOICE_TTS_VOICE);
  }

  function getConfiguredVoiceTtsSpeed() {
    return normalizeVoiceTtsSpeed(settingsVoiceTtsSpeedInput?.value ?? panelSettings.voiceTtsSpeed);
  }

  function getConfiguredVoicePauseMs() {
    return normalizeVoicePauseMs(settingsVoicePauseMsInput?.value ?? panelSettings.voicePauseMs);
  }

  function getConfiguredVoiceVadRedemptionMs() {
    return Math.max(220, getConfiguredVoicePauseMs());
  }

  function isVoiceActiveListeningEnabled() {
    return true;
  }

  function updateVoiceModeMetaLabel() {
    const inputLanguage = normalizeAssistantLanguage(
      settingsLanguageSelect?.value || panelSettings.language || DEFAULT_ASSISTANT_LANGUAGE
    );
    const ttsVoice = normalizeVoiceTtsVoice(settingsVoiceTtsVoiceSelect?.value || panelSettings.voiceTtsVoice || VOICE_TTS_VOICE);
    const ttsSpeed = normalizeVoiceTtsSpeed(settingsVoiceTtsSpeedInput?.value ?? panelSettings.voiceTtsSpeed);
    const pauseMs = getConfiguredVoicePauseMs();

    if (settingsVoiceTtsSpeedValue) {
      settingsVoiceTtsSpeedValue.textContent = `${ttsSpeed.toFixed(2)}x`;
    }
    if (settingsVoicePauseMsValue) {
      settingsVoicePauseMsValue.textContent = `${pauseMs} ms`;
    }

    if (!settingsVoiceModeMeta) {
      return;
    }

    settingsVoiceModeMeta.textContent = `Idioma voz: ${inputLanguage.toUpperCase()} · TTS: ${ttsVoice} · Velocidad: ${ttsSpeed.toFixed(2)}x · Pausa: ${pauseMs} ms`;
  }

  function getOpenAiSpeechProfile() {
    const profiles = getModelProfiles();
    return profiles.find((item) => item.provider === AI_PROVIDER_IDS.OPENAI && item.hasApiKey === true) || null;
  }

  function hasOpenAiSpeechCredentialConfigured() {
    return Boolean(getOpenAiSpeechProfile());
  }

  function resolveChatSendMode() {
    const hasText = Boolean(String(chatInput?.value || '').trim());
    const hasAttachments = pendingConversationAttachments.length > 0;
    if (hasText || hasAttachments) {
      return 'text';
    }

    if (voiceCaptureState.mode === 'recording' || voiceCaptureState.mode === 'transcribing') {
      return 'voice';
    }

    return hasOpenAiSpeechCredentialConfigured() ? 'voice' : 'text';
  }

  function renderChatSendButtonState() {
    if (!chatSendBtn) {
      return;
    }

    const sendMode = resolveChatSendMode();
    const recording = voiceCaptureState.mode === 'recording';
    const voiceActionActive = sendMode === 'voice' && voiceSessionActive;
    chatSendBtn.dataset.sendMode = sendMode;
    chatSendBtn.dataset.recording = recording ? 'true' : 'false';
    chatSendBtn.dataset.voiceSession = voiceSessionActive ? 'true' : 'false';

    if (sendMode === 'voice') {
      const title = voiceActionActive
        ? 'End Voice'
        : recording
          ? 'Escuchando... Pulsa waves para detener'
          : 'Iniciar escucha por voz';
      chatSendBtn.setAttribute('aria-label', title);
      chatSendBtn.setAttribute('title', title);
    } else {
      chatSendBtn.setAttribute('aria-label', 'Enviar mensaje');
      chatSendBtn.setAttribute('title', 'Enviar mensaje');
    }

    chatSendBtn.disabled = voiceCaptureState.mode === 'transcribing' && sendMode !== 'voice';
  }

  function applyVoiceButtonBars(level = 0) {
    if (!chatSendVoiceBars.length) {
      return;
    }

    const safeLevel = Math.max(0, Math.min(1, Number(level) || 0));
    const now = Date.now();
    for (let index = 0; index < chatSendVoiceBars.length; index += 1) {
      const bar = chatSendVoiceBars[index];
      if (!(bar instanceof HTMLElement)) {
        continue;
      }

      const phase = now / 150 + index * 0.95;
      const wobble = 0.42 + (Math.sin(phase) + 1) * 0.29;
      const base = 4 + index;
      const amplitude = safeLevel * 12 * wobble;
      const height = Math.max(4, Math.min(16, Math.round(base + amplitude)));
      bar.style.height = `${height}px`;
    }
  }

  function resetVoiceButtonBars() {
    applyVoiceButtonBars(0);
  }

  function stopVoiceButtonMeter(options = {}) {
    if (voiceButtonMeterState.rafId) {
      cancelAnimationFrame(voiceButtonMeterState.rafId);
    }

    if (voiceButtonMeterState.sourceNode) {
      try {
        voiceButtonMeterState.sourceNode.disconnect();
      } catch (_) {
        // Ignore source node disconnect issues.
      }
    }

    if (voiceButtonMeterState.audioContext) {
      void voiceButtonMeterState.audioContext.close().catch(() => {});
    }

    voiceButtonMeterState = {
      audioContext: null,
      sourceNode: null,
      analyser: null,
      sampleBuffer: null,
      rafId: 0,
      level: 0
    };

    if (options.resetBars !== false) {
      resetVoiceButtonBars();
    }
  }

  async function startVoiceButtonMeter(stream) {
    if (!chatSendVoiceBars.length || !(stream instanceof MediaStream) || !hasLiveVoiceMediaStream(stream)) {
      return;
    }

    stopVoiceButtonMeter({
      resetBars: false
    });

    if (typeof AudioContext !== 'function') {
      return;
    }

    try {
      const meterContext = new AudioContext();
      const analyser = meterContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.52;
      const sourceNode = meterContext.createMediaStreamSource(stream);
      sourceNode.connect(analyser);
      const sampleBuffer = new Float32Array(analyser.fftSize);

      voiceButtonMeterState = {
        audioContext: meterContext,
        sourceNode,
        analyser,
        sampleBuffer,
        rafId: 0,
        level: 0
      };

      const tick = () => {
        if (voiceCaptureState.mode !== 'recording' || voiceButtonMeterState.analyser !== analyser) {
          return;
        }

        analyser.getFloatTimeDomainData(sampleBuffer);
        let energy = 0;
        for (let index = 0; index < sampleBuffer.length; index += 1) {
          const sample = sampleBuffer[index];
          energy += sample * sample;
        }

        const rms = Math.sqrt(energy / sampleBuffer.length);
        const normalized = Math.max(0, Math.min(1, rms * 14.5));
        voiceButtonMeterState.level = voiceButtonMeterState.level * 0.62 + normalized * 0.38;
        applyVoiceButtonBars(voiceButtonMeterState.level);
        voiceButtonMeterState.rafId = requestAnimationFrame(tick);
      };

      voiceButtonMeterState.rafId = requestAnimationFrame(tick);
    } catch (_) {
      stopVoiceButtonMeter();
    }
  }

  function getChatMessageById(messageId) {
    const token = String(messageId || '').trim();
    if (!token) {
      return null;
    }
    return chatHistory.find((item) => String(item?.id || '').trim() === token) || null;
  }

  function stopVoiceReplyTextSync(options = {}) {
    if (voiceReplySyncState.rafId) {
      cancelAnimationFrame(voiceReplySyncState.rafId);
    }

    const message = getChatMessageById(voiceReplySyncState.messageId);
    if (message) {
      if (options.keepVisibleChars !== true) {
        delete message.audioSyncVisibleChars;
      }
      delete message.voiceRevealState;
      scheduleChatRender({
        allowAutoScroll: false
      });
    }

    voiceReplySyncState = {
      messageId: '',
      rafId: 0,
      startedAt: 0,
      fullText: '',
      audio: null
    };
  }

  function clearVoiceSessionRestartTimer() {
    if (!voiceSessionResumeTimer) {
      return;
    }

    window.clearTimeout(voiceSessionResumeTimer);
    voiceSessionResumeTimer = 0;
  }

  function setVoiceSessionActive(nextState, options = {}) {
    const next = nextState === true;
    const previous = voiceSessionActive;
    voiceSessionActive = next;

    if (!next) {
      clearVoiceSessionRestartTimer();
      if (options.stopPlayback !== false) {
        stopAssistantSpeechPlayback();
      }
    }

    if (previous !== next) {
      logInfo('voice:session:toggle', {
        active: next,
        reason: String(options.reason || '').trim() || 'manual'
      });
    }

    renderChatSendButtonState();
  }

  function scheduleVoiceSessionRestart(options = {}) {
    if (!voiceSessionActive) {
      return;
    }

    clearVoiceSessionRestartTimer();
    const delayMs = Math.max(0, Number(options.delayMs) || VOICE_SESSION_RESTART_DELAY_MS);
    const reason = String(options.reason || 'next_turn').trim() || 'next_turn';
    voiceSessionResumeTimer = window.setTimeout(() => {
      voiceSessionResumeTimer = 0;
      if (!voiceSessionActive) {
        return;
      }
      if (voiceCaptureState.mode !== 'idle') {
        return;
      }
      if (!hasOpenAiSpeechCredentialConfigured()) {
        setVoiceSessionActive(false, {
          reason: 'voice_session_missing_credentials',
          stopPlayback: false
        });
        releaseVoiceSessionResources();
        return;
      }
      if (String(chatInput?.value || '').trim()) {
        return;
      }

      void startVoiceCapture({
        source: `voice_session:${reason}`
      }).then((started) => {
        if (!started && voiceSessionActive) {
          setVoiceSessionActive(false, {
            reason: 'voice_session_restart_failed',
            stopPlayback: false
          });
          releaseVoiceSessionResources();
        }
      });
    }, delayMs);
  }

  function isAbortLikeError(error) {
    if (!error) {
      return false;
    }

    const name = String(error?.name || '').trim().toLowerCase();
    if (name === 'aborterror') {
      return true;
    }

    const message = String(error?.message || '').trim().toLowerCase();
    return /abort|interrumpid|canceled|cancelled/.test(message);
  }

  function abortActiveVoiceTranscription(reason = 'voice_cancelled') {
    if (!activeVoiceTranscriptionAbortController) {
      return false;
    }

    try {
      activeVoiceTranscriptionAbortController.abort(String(reason || 'voice_cancelled').trim() || 'voice_cancelled');
    } catch (_) {
      // Ignore abort issues.
    }
    activeVoiceTranscriptionAbortController = null;
    return true;
  }

  async function interruptActiveChatTurn(options = {}) {
    const reason = String(options.reason || 'interrupted').trim() || 'interrupted';
    if (activeChatAbortController) {
      try {
        activeChatAbortController.abort(reason);
      } catch (_) {
        // Ignore abort issues.
      }
    }

    stopAssistantSpeechPlayback();

    if (!isGeneratingChat) {
      return true;
    }

    const startedAt = Date.now();
    while (isGeneratingChat && Date.now() - startedAt < CHAT_INTERRUPT_WAIT_MAX_MS) {
      await waitForMs(48);
    }

    return !isGeneratingChat;
  }

  function isAssistantSpeechPlaybackActive() {
    return activeTtsAudio instanceof Audio && activeTtsAudio.paused === false && activeTtsAudio.ended === false;
  }

  function stopAssistantSpeechPlayback() {
    stopVoiceReplyTextSync();
    if (activeTtsAudio) {
      activeTtsAudio.pause();
      activeTtsAudio.src = '';
      activeTtsAudio = null;
    }

    if (activeTtsObjectUrl) {
      URL.revokeObjectURL(activeTtsObjectUrl);
      activeTtsObjectUrl = '';
    }
  }

  async function setMicrophonePermissionState(nextState) {
    const safeState = normalizeIntegrationPermissionState(nextState);
    const integrations = getIntegrationsConfig();
    const currentState = normalizeIntegrationPermissionState(integrations.permissions?.microphone);
    if (safeState === currentState) {
      return true;
    }

    const nextIntegrations = normalizeIntegrationsConfig({
      ...integrations,
      permissions: {
        ...integrations.permissions,
        microphone: safeState
      }
    });

    const ok = await savePanelSettings({
      integrations: nextIntegrations
    });
    if (ok) {
      renderAppsIntegrationsSettings({ syncInput: false });
    }
    return ok;
  }

  function getVoiceBlobFromChunks(chunks = []) {
    const safeChunks = Array.isArray(chunks) ? chunks.filter((item) => item instanceof Blob && item.size > 0) : [];
    if (!safeChunks.length) {
      return null;
    }

    if (safeChunks.length === 1) {
      return safeChunks[0];
    }

    const isContainerChunk = (chunk) => {
      const type = String(chunk?.type || '')
        .trim()
        .toLowerCase();
      return type.includes('webm') || type.includes('ogg') || type.includes('mp4');
    };

    const shouldPreferSingleChunk =
      VOICE_MEDIA_RECORDER_TIMESLICE_MS <= 0 || safeChunks.every((chunk) => isContainerChunk(chunk));
    if (shouldPreferSingleChunk) {
      const largestChunk = safeChunks.reduce((best, item) => (item.size > best.size ? item : best), safeChunks[0]);
      if (safeChunks.length > 1) {
        logInfo('voice:chunks:select_largest', {
          chunks: safeChunks.length,
          selectedSize: Number(largestChunk?.size) || 0,
          selectedType: String(largestChunk?.type || ''),
          sizes: safeChunks.map((chunk) => Number(chunk.size) || 0).slice(0, 8)
        });
      }
      return largestChunk;
    }

    const firstType = String(safeChunks[0]?.type || '').trim();
    const type = firstType || 'audio/webm';
    return new Blob(safeChunks, { type });
  }

  function downmixAudioBufferToMono(audioBuffer) {
    const buffer = audioBuffer && typeof audioBuffer === 'object' ? audioBuffer : null;
    const channels = Math.max(1, Number(buffer?.numberOfChannels) || 1);
    const sampleCount = Math.max(0, Number(buffer?.length) || 0);
    const mono = new Float32Array(sampleCount);
    if (!sampleCount) {
      return mono;
    }

    if (channels === 1) {
      const channel = buffer.getChannelData(0);
      mono.set(channel);
      return mono;
    }

    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const channelData = buffer.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        mono[sampleIndex] += channelData[sampleIndex];
      }
    }

    const scale = 1 / channels;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      mono[sampleIndex] *= scale;
    }
    return mono;
  }

  function resampleMonoAudio(samples, inputSampleRate, outputSampleRate) {
    const source = samples instanceof Float32Array ? samples : new Float32Array(0);
    const inRate = Math.max(1, Number(inputSampleRate) || 16000);
    const outRate = Math.max(1, Number(outputSampleRate) || 16000);
    if (!source.length || inRate === outRate) {
      return source;
    }

    const ratio = inRate / outRate;
    const outputLength = Math.max(1, Math.round(source.length / ratio));
    const output = new Float32Array(outputLength);

    for (let index = 0; index < outputLength; index += 1) {
      const position = index * ratio;
      const leftIndex = Math.floor(position);
      const rightIndex = Math.min(leftIndex + 1, source.length - 1);
      const mix = position - leftIndex;
      output[index] = source[leftIndex] + (source[rightIndex] - source[leftIndex]) * mix;
    }

    return output;
  }

  function encodeMonoPcm16Wav(samples, sampleRate = 16000) {
    const source = samples instanceof Float32Array ? samples : new Float32Array(0);
    const safeSampleRate = Math.max(8000, Math.min(96000, Number(sampleRate) || 16000));
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = safeSampleRate * blockAlign;
    const dataSize = source.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeAscii = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, safeSampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let index = 0; index < source.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, source[index]));
      view.setInt16(offset, sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff), true);
      offset += 2;
    }

    return buffer;
  }

  function decodeAudioDataSafe(audioContext, buffer) {
    if (!audioContext || typeof audioContext.decodeAudioData !== 'function') {
      return Promise.reject(new Error('decodeAudioData no disponible.'));
    }
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength <= 0) {
      return Promise.reject(new Error('Buffer de audio vacio.'));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error || 'No se pudo decodificar audio.')));
      };

      try {
        const promise = audioContext.decodeAudioData(buffer.slice(0), finishResolve, finishReject);
        if (promise && typeof promise.then === 'function') {
          promise.then(finishResolve).catch(finishReject);
        }
      } catch (error) {
        finishReject(error);
      }
    });
  }

  async function normalizeVoiceBlobForTranscription(blob, options = {}) {
    const sourceBlob = blob instanceof Blob ? blob : null;
    if (!sourceBlob || sourceBlob.size <= 0) {
      return sourceBlob;
    }

    const targetRate = Math.max(8000, Math.min(48000, Number(options.targetSampleRate) || 16000));
    const sourceType = String(sourceBlob.type || '')
      .trim()
      .toLowerCase();
    if (sourceType.includes('wav')) {
      return sourceBlob;
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (typeof AudioContextCtor !== 'function') {
      return sourceBlob;
    }

    let context = null;
    try {
      context = new AudioContextCtor();
      const rawBuffer = await sourceBlob.arrayBuffer();
      const audioBuffer = await decodeAudioDataSafe(context, rawBuffer);
      const mono = downmixAudioBufferToMono(audioBuffer);
      if (!mono.length) {
        return sourceBlob;
      }
      const normalized = resampleMonoAudio(mono, audioBuffer.sampleRate, targetRate);
      if (!normalized.length) {
        return sourceBlob;
      }
      const wavBuffer = encodeMonoPcm16Wav(normalized, targetRate);
      return new Blob([wavBuffer], {
        type: 'audio/wav'
      });
    } catch (error) {
      logWarn('voice:audio:normalize_failed', {
        inputType: sourceType,
        inputSize: Number(sourceBlob.size) || 0,
        error: error instanceof Error ? error.message : String(error || '')
      });
      return sourceBlob;
    } finally {
      if (context && typeof context.close === 'function') {
        try {
          await context.close();
        } catch (_) {
          // Ignore audio context close failures.
        }
      }
    }
  }

  function clearVoiceCaptureTimers() {
    if (voiceCaptureState.rafId) {
      cancelAnimationFrame(voiceCaptureState.rafId);
      voiceCaptureState.rafId = 0;
    }

    if (voiceCaptureState.maxStopTimer) {
      window.clearTimeout(voiceCaptureState.maxStopTimer);
      voiceCaptureState.maxStopTimer = 0;
    }
  }

  function cleanupVoiceCaptureGraph() {
    clearVoiceCaptureTimers();

    if (voiceCaptureState.sourceNode) {
      try {
        voiceCaptureState.sourceNode.disconnect();
      } catch (_) {
        // Ignore disconnect cleanup issues.
      }
    }

    voiceCaptureState.sourceNode = null;
    voiceCaptureState.analyser = null;
    voiceCaptureState.sampleBuffer = null;
    voiceCaptureState.graphStreamId = '';

    if (voiceCaptureState.audioContext) {
      void voiceCaptureState.audioContext.close().catch(() => {});
    }
    voiceCaptureState.audioContext = null;
  }

  function hasLiveVoiceMediaStream(stream) {
    const tracks = Array.isArray(stream?.getAudioTracks?.()) ? stream.getAudioTracks() : [];
    return tracks.some((track) => track && track.readyState === 'live');
  }

  function stopVoiceCaptureTracks(stream) {
    const tracks = Array.isArray(stream?.getTracks?.()) ? stream.getTracks() : [];
    for (const track of tracks) {
      try {
        track.stop();
      } catch (_) {
        // Ignore cleanup issues.
      }
    }
  }

  function releaseVoiceSessionResources(options = {}) {
    const preserveMode = options.preserveMode === true;
    stopVoiceButtonMeter();
    if (voiceCaptureState.vad) {
      const vadInstance = voiceCaptureState.vad;
      voiceCaptureState.vad = null;
      voiceCaptureState.vadRedemptionMs = 0;
      voiceCaptureState.usingVad = false;
      try {
        void vadInstance.pause().catch(() => {});
      } catch (_) {
        // Ignore pause cleanup issues.
      }
      try {
        void vadInstance.destroy().catch(() => {});
      } catch (_) {
        // Ignore destroy cleanup issues.
      }
    }
    cleanupVoiceCaptureGraph();
    stopVoiceCaptureTracks(voiceCaptureState.mediaStream);
    voiceCaptureState.mediaStream = null;
    voiceCaptureState.mediaRecorder = null;
    voiceCaptureState.chunks = [];
    voiceCaptureState.silenceSince = 0;
    voiceCaptureState.startedAt = 0;
    if (!preserveMode) {
      voiceCaptureState.mode = 'idle';
    }
    renderChatSendButtonState();
  }

  async function getSpeechAuthContext() {
    const profile = getOpenAiSpeechProfile();
    if (!profile) {
      throw new Error('Voice requiere un perfil OpenAI con API key activa.');
    }

    const apiKey = await getApiKeyForProfile(profile, { statusTarget: chatStatus });
    return {
      profile,
      apiKey
    };
  }

  async function transcribeVoiceBlob(blob, options = {}) {
    if (!(blob instanceof Blob) || blob.size <= 0) {
      throw new Error('No se detecto audio para transcribir.');
    }

    const normalizedBlob = await normalizeVoiceBlobForTranscription(blob, {
      targetSampleRate: 16000
    });
    logInfo('voice:transcribe:blob_ready', {
      inputType: String(blob.type || ''),
      inputSize: Number(blob.size) || 0,
      outputType: String(normalizedBlob?.type || ''),
      outputSize: Number(normalizedBlob?.size || 0),
      normalized: normalizedBlob !== blob
    });

    const { apiKey } = await getSpeechAuthContext();
    const rawSignal = options && typeof options === 'object' ? options.signal : null;
    const signal =
      rawSignal &&
      typeof rawSignal === 'object' &&
      typeof rawSignal.aborted === 'boolean' &&
      typeof rawSignal.addEventListener === 'function'
        ? rawSignal
        : null;
    const result = await aiProviderService.transcribeOpenAiAudio({
      apiKey,
      audioBlob: normalizedBlob instanceof Blob && normalizedBlob.size > 0 ? normalizedBlob : blob,
      model: VOICE_TRANSCRIPTION_MODEL,
      language: normalizeVoiceInputLanguage(),
      signal
    });
    return String(result || '').trim();
  }

  function getVoiceVadLibrary() {
    const vadApi = window?.vad;
    if (!vadApi || typeof vadApi !== 'object') {
      return null;
    }
    if (!vadApi.MicVAD || typeof vadApi.MicVAD.new !== 'function') {
      return null;
    }
    return vadApi;
  }

  function createVoiceBlobFromVadAudio(audioSamples) {
    const vadApi = getVoiceVadLibrary();
    const segment = audioSamples instanceof Float32Array ? audioSamples : null;
    if (
      !vadApi ||
      !vadApi.utils ||
      typeof vadApi.utils.encodeWAV !== 'function' ||
      !segment ||
      segment.length < VOICE_MIN_VAD_SEGMENT_SAMPLES
    ) {
      return null;
    }

    try {
      const normalized = new Float32Array(segment.length);
      let hasSignal = false;
      for (let index = 0; index < segment.length; index += 1) {
        const sample = Number(segment[index]);
        const clamped = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
        normalized[index] = clamped;
        if (!hasSignal && Math.abs(clamped) > 0.0001) {
          hasSignal = true;
        }
      }
      if (!hasSignal) {
        return null;
      }

      const wavBuffer = vadApi.utils.encodeWAV(normalized, 1, 16000, 1, 16);
      return new Blob([wavBuffer], {
        type: 'audio/wav'
      });
    } catch (_) {
      return null;
    }
  }

  function isCorruptedOrUnsupportedAudioError(error) {
    const message = String(error?.message || '')
      .trim()
      .toLowerCase();
    if (!message) {
      return false;
    }
    return /corrupt|unsupported|invalid[_\s-]?value.*file|audio file/i.test(message);
  }

  async function ensureVoiceVadEngine() {
    const dependenciesReady = await ensureVoiceRuntimeDependenciesLoaded();
    if (!dependenciesReady) {
      return null;
    }

    const vadApi = getVoiceVadLibrary();
    if (!vadApi) {
      return null;
    }

    const configuredRedemptionMs = getConfiguredVoiceVadRedemptionMs();
    if (voiceCaptureState.vad) {
      if (Number(voiceCaptureState.vadRedemptionMs) === configuredRedemptionMs) {
        return voiceCaptureState.vad;
      }

      const staleVad = voiceCaptureState.vad;
      voiceCaptureState.vad = null;
      voiceCaptureState.vadRedemptionMs = 0;
      voiceCaptureState.usingVad = false;
      try {
        if (typeof staleVad.pause === 'function') {
          await staleVad.pause();
        }
      } catch (_) {
        // Ignore VAD pause cleanup issues.
      }
      try {
        if (typeof staleVad.destroy === 'function') {
          await staleVad.destroy();
        }
      } catch (_) {
        // Ignore VAD destroy cleanup issues.
      }
    }

    const sharedGetStream = async () => {
      if (hasLiveVoiceMediaStream(voiceCaptureState.mediaStream)) {
        return voiceCaptureState.mediaStream;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      voiceCaptureState.mediaStream = stream;
      return stream;
    };

    const vadInstance = await vadApi.MicVAD.new({
      model: VOICE_VAD_MODEL,
      startOnLoad: false,
      baseAssetPath: VOICE_VAD_ASSET_BASE_PATH,
      onnxWASMBasePath: VOICE_VAD_WASM_BASE_PATH,
      positiveSpeechThreshold: VOICE_VAD_POSITIVE_THRESHOLD,
      negativeSpeechThreshold: VOICE_VAD_NEGATIVE_THRESHOLD,
      redemptionMs: configuredRedemptionMs,
      minSpeechMs: VOICE_VAD_MIN_SPEECH_MS,
      preSpeechPadMs: VOICE_VAD_PRESPEECH_PAD_MS,
      getStream: sharedGetStream,
      pauseStream: async () => {},
      resumeStream: async () => sharedGetStream(),
      onSpeechStart: () => {
        voiceCaptureState.silenceSince = 0;
      },
      onSpeechRealStart: () => {
        voiceCaptureState.silenceSince = 0;
      },
      onVADMisfire: () => {
        logDebug('voice:vad:misfire');
      },
      onSpeechEnd: (audio) => {
        if (!voiceSessionActive || voiceCaptureState.mode !== 'recording') {
          return;
        }

        const segment = audio instanceof Float32Array ? audio : null;
        if (!segment || segment.length <= 0) {
          return;
        }

        void stopVoiceCapture({
          transcribe: true,
          reason: 'vad_speech_end',
          keepSession: true,
          vadAudioSegment: segment
        });
      }
    });

    voiceCaptureState.vad = vadInstance;
    voiceCaptureState.vadRedemptionMs = configuredRedemptionMs;
    return vadInstance;
  }

  function updateVoiceReplyTextSyncFrame() {
    const messageId = String(voiceReplySyncState.messageId || '').trim();
    const audio = voiceReplySyncState.audio;
    const fullText = String(voiceReplySyncState.fullText || '');
    if (!messageId || !(audio instanceof Audio) || !fullText) {
      stopVoiceReplyTextSync();
      return;
    }

    const message = getChatMessageById(messageId);
    if (!message) {
      stopVoiceReplyTextSync();
      return;
    }

    let progress = 0;
    const duration = Number(audio.duration);
    if (Number.isFinite(duration) && duration > 0) {
      progress = Math.min(1, Math.max(0, audio.currentTime / duration));
    } else if (voiceReplySyncState.startedAt > 0) {
      const fallbackDurationMs = Math.max(1200, fullText.length * VOICE_REPLY_SYNC_FALLBACK_MS_PER_CHAR);
      progress = Math.min(1, (Date.now() - voiceReplySyncState.startedAt) / fallbackDurationMs);
    }

    const nextVisibleChars = Math.max(0, Math.min(fullText.length, Math.round(fullText.length * progress)));
    if (Number(message.audioSyncVisibleChars) !== nextVisibleChars) {
      message.audioSyncVisibleChars = nextVisibleChars;
      scheduleChatRender({
        allowAutoScroll: false
      });
    }

    if (audio.ended) {
      delete message.audioSyncVisibleChars;
      delete message.voiceRevealState;
      stopVoiceReplyTextSync();
      scheduleChatRender({
        allowAutoScroll: false
      });
      return;
    }

    if (!audio.paused) {
      voiceReplySyncState.rafId = requestAnimationFrame(updateVoiceReplyTextSyncFrame);
    }
  }

  function beginVoiceReplyTextSync(messageRecord, audio) {
    const record = messageRecord && typeof messageRecord === 'object' ? messageRecord : null;
    if (!record || !(audio instanceof Audio)) {
      return;
    }

    const fullText = String(stripEmotionTag(String(record.content || '')) || record.content || '')
      .trim()
      .slice(0, 4000);
    if (!fullText) {
      return;
    }

    stopVoiceReplyTextSync();
    record.voiceRevealState = 'playing';
    record.audioSyncVisibleChars = 0;
    voiceReplySyncState = {
      messageId: String(record.id || '').trim(),
      rafId: 0,
      startedAt: Date.now(),
      fullText,
      audio
    };
    scheduleChatRender({
      allowAutoScroll: false
    });
    voiceReplySyncState.rafId = requestAnimationFrame(updateVoiceReplyTextSyncFrame);
  }

  function releaseActiveSpeechResourcesFor(audio) {
    if (voiceReplySyncState.audio === audio) {
      stopVoiceReplyTextSync();
    }

    if (activeTtsAudio === audio) {
      activeTtsAudio.src = '';
      activeTtsAudio = null;
    }

    if (activeTtsObjectUrl) {
      URL.revokeObjectURL(activeTtsObjectUrl);
      activeTtsObjectUrl = '';
    }
  }

  async function speakAssistantReply(options = {}) {
    const messageRecord =
      options?.message && typeof options.message === 'object'
        ? options.message
        : null;
    const rawText =
      messageRecord && typeof messageRecord.content === 'string'
        ? messageRecord.content
        : typeof options?.text === 'string'
          ? options.text
          : typeof options === 'string'
            ? options
            : '';
    const content = String(stripEmotionTag(String(rawText || '')) || rawText || '')
      .trim()
      .slice(0, 4000);
    if (!content || !hasOpenAiSpeechCredentialConfigured()) {
      return false;
    }

    const { apiKey } = await getSpeechAuthContext();
    const ttsVoice = getConfiguredVoiceTtsVoice();
    const ttsSpeed = getConfiguredVoiceTtsSpeed();
    const audioBlob = await aiProviderService.synthesizeOpenAiSpeech({
      apiKey,
      model: VOICE_TTS_MODEL,
      voice: ttsVoice,
      speed: ttsSpeed,
      format: VOICE_TTS_FORMAT,
      input: content
    });

    if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
      throw new Error('No se pudo sintetizar audio de respuesta.');
    }

    stopAssistantSpeechPlayback();
    if (messageRecord) {
      messageRecord.voiceRevealState = 'waiting';
      messageRecord.audioSyncVisibleChars = 0;
      scheduleChatRender({
        allowAutoScroll: false
      });
    }

    activeTtsObjectUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(activeTtsObjectUrl);
    activeTtsAudio = audio;

    const playbackPromise = new Promise((resolve, reject) => {
      audio.addEventListener(
        'play',
        () => {
          if (messageRecord) {
            beginVoiceReplyTextSync(messageRecord, audio);
          }
        },
        { once: true }
      );

      audio.addEventListener(
        'ended',
        () => {
          if (messageRecord) {
            delete messageRecord.audioSyncVisibleChars;
            delete messageRecord.voiceRevealState;
            scheduleChatRender({
              allowAutoScroll: false
            });
          }
          releaseActiveSpeechResourcesFor(audio);
          resolve(true);
        },
        { once: true }
      );

      audio.addEventListener(
        'error',
        () => {
          if (messageRecord) {
            delete messageRecord.audioSyncVisibleChars;
            delete messageRecord.voiceRevealState;
            scheduleChatRender({
              allowAutoScroll: false
            });
          }
          releaseActiveSpeechResourcesFor(audio);
          reject(new Error('No se pudo reproducir respuesta en voz.'));
        },
        { once: true }
      );
    });

    try {
      await audio.play();
    } catch (error) {
      releaseActiveSpeechResourcesFor(audio);
      throw error instanceof Error ? error : new Error('No se pudo reproducir respuesta en voz.');
    }
    if (options?.awaitEnd === true) {
      return playbackPromise;
    }

    void playbackPromise.catch(() => {});
    return true;
  }

  async function startVoiceCapture(options = {}) {
    if (voiceCaptureState.mode !== 'idle') {
      return false;
    }

    if (isGeneratingChat) {
      const interrupted = await interruptActiveChatTurn({
        reason: String(options?.source || 'voice_input').trim() || 'voice_input'
      });
      if (!interrupted) {
        setStatus(chatStatus, 'No se pudo interrumpir la respuesta actual para escuchar nueva voz.', true);
        return false;
      }
    }

    if (isAssistantSpeechPlaybackActive()) {
      stopAssistantSpeechPlayback();
    }

    if (!hasOpenAiSpeechCredentialConfigured()) {
      setStatus(chatStatus, 'Voice no disponible: configura API key de OpenAI en AI Models.', true);
      return false;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStatus(chatStatus, 'Microfono no soportado en este navegador.', true);
      return false;
    }

    if (typeof MediaRecorder !== 'function') {
      setStatus(chatStatus, 'Grabacion de voz no soportada en este navegador.', true);
      return false;
    }

    const browserPermissionBefore = await readBrowserMicrophonePermissionState();
    const reusingOpenStream = hasLiveVoiceMediaStream(voiceCaptureState.mediaStream);
    logInfo('voice:capture:start', {
      browserPermissionBefore,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      isSecureContext: window.isSecureContext,
      sendMode: resolveChatSendMode(),
      source: String(options?.source || '').trim() || 'unknown',
      voiceSessionActive,
      reusedStream: reusingOpenStream
    });
    setStatus(
      chatStatus,
      reusingOpenStream ? 'Microfono activo. Iniciando escucha...' : 'Activando microfono...',
      false,
      { loading: true }
    );

    let stream = reusingOpenStream ? voiceCaptureState.mediaStream : null;
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (error) {
        const detail = classifyMicrophoneAccessError(error);
        if (detail.permissionState) {
          await setMicrophonePermissionState(detail.permissionState);
        }
        const browserPermissionAfter = await readBrowserMicrophonePermissionState();
        logWarn('voice:capture:failed', {
          code: detail.code,
          name: detail.name,
          rawMessage: detail.rawMessage,
          browserPermissionBefore,
          browserPermissionAfter
        });
        const shouldFallback = shouldUseMicrophonePermissionTabFallback(
          detail,
          browserPermissionBefore,
          browserPermissionAfter
        );
        if (shouldFallback) {
          const opened = await openMicrophonePermissionHelperTab({
            source: 'voice_capture'
          });
          if (opened) {
            setStatus(
              chatStatus,
              'Chrome no mostro el popup de microfono en side panel. Se abrio una pestana auxiliar para autorizar.',
              true
            );
            return false;
          }
        }
        setStatus(chatStatus, [detail.userMessage, detail.hint].filter(Boolean).join(' '), true);
        return false;
      }

      await setMicrophonePermissionState('granted');
      voiceCaptureState.mediaStream = stream;
    }

    const mimeTypeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    const mimeType = mimeTypeCandidates.find((item) => {
      try {
        return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
          ? MediaRecorder.isTypeSupported(item)
          : false;
      } catch (_) {
        return false;
      }
    });

    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      releaseVoiceSessionResources();
      setStatus(chatStatus, 'No se pudo iniciar grabacion de audio.', true);
      return false;
    }

    let vadEngine = null;
    let usingVad = false;
    try {
      vadEngine = await ensureVoiceVadEngine();
      if (vadEngine && typeof vadEngine.start === 'function') {
        await vadEngine.start();
        usingVad = true;
      }
    } catch (error) {
      logWarn('voice:vad:init_failed', {
        message: error instanceof Error ? error.message : String(error || '')
      });
      usingVad = false;
    }

    const streamId = String(stream?.id || '').trim();
    let audioContext = null;
    let analyser = null;
    let sourceNode = null;
    let sampleBuffer = null;

    if (!usingVad && typeof AudioContext === 'function') {
      const hasReusableGraph =
        Boolean(voiceCaptureState.audioContext) &&
        Boolean(voiceCaptureState.analyser) &&
        Boolean(voiceCaptureState.sourceNode) &&
        voiceCaptureState.sampleBuffer instanceof Float32Array &&
        voiceCaptureState.graphStreamId === streamId;

      audioContext = voiceCaptureState.audioContext;
      analyser = voiceCaptureState.analyser;
      sourceNode = voiceCaptureState.sourceNode;
      sampleBuffer = voiceCaptureState.sampleBuffer;

      if (!hasReusableGraph) {
        cleanupVoiceCaptureGraph();
        try {
          audioContext = new AudioContext();
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.1;
          sourceNode = audioContext.createMediaStreamSource(stream);
          sourceNode.connect(analyser);
          sampleBuffer = new Float32Array(analyser.fftSize);
        } catch (_) {
          audioContext = null;
          analyser = null;
          sourceNode = null;
          sampleBuffer = null;
        }
      } else if (audioContext && audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (_) {
          // Ignore audio context resume failures.
        }
      }
    } else {
      cleanupVoiceCaptureGraph();
    }

    clearVoiceCaptureTimers();
    voiceCaptureState.mode = 'recording';
    voiceCaptureState.mediaStream = stream;
    voiceCaptureState.mediaRecorder = recorder;
    voiceCaptureState.vad = vadEngine || voiceCaptureState.vad;
    voiceCaptureState.usingVad = usingVad;
    voiceCaptureState.chunks = [];
    voiceCaptureState.audioContext = audioContext;
    voiceCaptureState.analyser = analyser;
    voiceCaptureState.sourceNode = sourceNode;
    voiceCaptureState.sampleBuffer = sampleBuffer;
    voiceCaptureState.graphStreamId = streamId;
    voiceCaptureState.silenceSince = 0;
    voiceCaptureState.startedAt = Date.now();

    recorder.addEventListener('dataavailable', (event) => {
      if (voiceCaptureState.mediaRecorder !== recorder) {
        return;
      }
      const chunk = event?.data;
      if (chunk instanceof Blob && chunk.size > 0) {
        voiceCaptureState.chunks.push(chunk);
      }
    });

    try {
      if (VOICE_MEDIA_RECORDER_TIMESLICE_MS > 0) {
        recorder.start(VOICE_MEDIA_RECORDER_TIMESLICE_MS);
      } else {
        recorder.start();
      }
    } catch (_) {
      releaseVoiceSessionResources();
      setStatus(chatStatus, 'No se pudo iniciar la grabacion.', true);
      return false;
    }
    void startVoiceButtonMeter(stream);

    if (!usingVad) {
      const canAutoStopBySilence = Boolean(voiceCaptureState.analyser && voiceCaptureState.sampleBuffer);
      const configuredPauseMs = getConfiguredVoicePauseMs();
      const monitorSilence = () => {
        if (voiceCaptureState.mode !== 'recording') {
          return;
        }
        const analyserNode = voiceCaptureState.analyser;
        const buffer = voiceCaptureState.sampleBuffer;
        if (!analyserNode || !buffer) {
          return;
        }

        analyserNode.getFloatTimeDomainData(buffer);
        let energy = 0;
        for (let index = 0; index < buffer.length; index += 1) {
          const sample = buffer[index];
          energy += sample * sample;
        }
        const rms = Math.sqrt(energy / buffer.length);
        const now = Date.now();

        if (rms < VOICE_SILENCE_RMS_THRESHOLD) {
          if (!voiceCaptureState.silenceSince) {
            voiceCaptureState.silenceSince = now;
          }

          if (
            canAutoStopBySilence &&
            now - voiceCaptureState.startedAt >= VOICE_MIN_ACTIVE_RECORDING_MS &&
            now - voiceCaptureState.silenceSince >= configuredPauseMs
          ) {
            void stopVoiceCapture({
              transcribe: true,
              reason: 'silence',
              keepSession: true
            });
            return;
          }
        } else {
          voiceCaptureState.silenceSince = 0;
        }

        voiceCaptureState.rafId = requestAnimationFrame(monitorSilence);
      };

      voiceCaptureState.rafId = requestAnimationFrame(monitorSilence);
    }

    voiceCaptureState.maxStopTimer = window.setTimeout(() => {
      void stopVoiceCapture({
        transcribe: true,
        reason: 'timeout',
        keepSession: true
      });
    }, VOICE_AUTO_STOP_MAX_MS);

    renderChatSendButtonState();
    setStatus(
      chatStatus,
      usingVad
        ? `Escucha por voz activa (VAD). Pausa configurada: ${getConfiguredVoicePauseMs()} ms.`
        : `Escucha por silencio iniciada. Se enviara al detectar ${getConfiguredVoicePauseMs()} ms de pausa.`,
      false,
      { loading: true }
    );
    return true;
  }

  async function stopVoiceCapture(options = {}) {
    const transcribe = options.transcribe !== false;
    const preserveStatus = options.preserveStatus === true;
    const keepSession = options.keepSession === true || voiceSessionActive;
    const shouldResumeVoiceSession = () => keepSession && voiceSessionActive;
    const stopReason = String(options?.reason || '').trim().toLowerCase();
    const vadAudioSegment = options?.vadAudioSegment instanceof Float32Array ? options.vadAudioSegment : null;
    if (voiceCaptureState.mode !== 'recording') {
      return false;
    }

    const recorder = voiceCaptureState.mediaRecorder;
    const stream = voiceCaptureState.mediaStream;
    const vadEngine = voiceCaptureState.vad;

    clearVoiceCaptureTimers();
    stopVoiceButtonMeter();
    voiceCaptureState.mode = transcribe ? 'transcribing' : 'idle';
    renderChatSendButtonState();

    if (vadEngine && typeof vadEngine.pause === 'function') {
      try {
        await vadEngine.pause();
      } catch (_) {
        // Ignore VAD pause failures.
      }
    }

    if (recorder && recorder.state !== 'inactive') {
      await new Promise((resolve) => {
        const finish = () => resolve(true);
        recorder.addEventListener('stop', finish, { once: true });
        if (VOICE_MEDIA_RECORDER_TIMESLICE_MS > 0) {
          try {
            recorder.requestData();
          } catch (_) {
            // Ignore requestData failures before stop.
          }
        }
        try {
          recorder.stop();
        } catch (_) {
          resolve(true);
        }
      });
    }

    if (voiceCaptureState.mediaRecorder === recorder) {
      voiceCaptureState.mediaRecorder = null;
    }
    if (!keepSession) {
      if (vadEngine && typeof vadEngine.destroy === 'function') {
        try {
          await vadEngine.destroy();
        } catch (_) {
          // Ignore VAD destroy failures.
        }
      }
      voiceCaptureState.vad = null;
      voiceCaptureState.vadRedemptionMs = 0;
      voiceCaptureState.usingVad = false;
      cleanupVoiceCaptureGraph();
      stopVoiceCaptureTracks(stream);
      voiceCaptureState.mediaStream = null;
    }

    if (!transcribe) {
      voiceCaptureState.mode = 'idle';
      voiceCaptureState.chunks = [];
      voiceCaptureState.silenceSince = 0;
      voiceCaptureState.startedAt = 0;
      renderChatSendButtonState();
      if (!preserveStatus) {
        setStatus(chatStatus, keepSession ? 'Escucha por voz pausada.' : 'Grabacion cancelada.');
      }
      if (shouldResumeVoiceSession()) {
        scheduleVoiceSessionRestart({
          reason: 'manual_resume'
        });
      }
      return true;
    }

    const finalChunks = Array.isArray(voiceCaptureState.chunks) ? [...voiceCaptureState.chunks] : [];
    const recorderBlob = getVoiceBlobFromChunks(finalChunks);
    const vadBlob = createVoiceBlobFromVadAudio(vadAudioSegment);
    const preferVadBlob = Boolean(vadBlob) && stopReason.includes('vad');

    let primaryBlob = preferVadBlob ? vadBlob : recorderBlob;
    let fallbackBlob = preferVadBlob ? recorderBlob : vadBlob;

    const primaryTooSmall = !(primaryBlob instanceof Blob) || primaryBlob.size < VOICE_MIN_TRANSCRIBE_BLOB_BYTES;
    if (primaryTooSmall && fallbackBlob instanceof Blob && fallbackBlob.size >= VOICE_MIN_TRANSCRIBE_BLOB_BYTES) {
      primaryBlob = fallbackBlob;
      fallbackBlob = null;
    }

    voiceCaptureState.chunks = [];
    if (!(primaryBlob instanceof Blob) || primaryBlob.size <= 0) {
      voiceCaptureState.mode = 'idle';
      voiceCaptureState.silenceSince = 0;
      voiceCaptureState.startedAt = 0;
      renderChatSendButtonState();
      setStatus(chatStatus, 'No se detecto audio valido.', true);
      if (shouldResumeVoiceSession()) {
        scheduleVoiceSessionRestart({
          reason: 'empty_audio',
          delayMs: VOICE_SESSION_RESTART_AFTER_ERROR_MS
        });
      }
      return false;
    }

    logInfo('voice:transcribe:blob_selected', {
      reason: stopReason || 'manual',
      primaryType: String(primaryBlob.type || ''),
      primarySize: Number(primaryBlob.size) || 0,
      fallbackType: fallbackBlob instanceof Blob ? String(fallbackBlob.type || '') : '',
      fallbackSize: fallbackBlob instanceof Blob ? Number(fallbackBlob.size) || 0 : 0,
      usingVad: voiceCaptureState.usingVad
    });

    setStatus(chatStatus, 'Transcribiendo audio...', false, { loading: true });
    const transcriptionAbortController = new AbortController();
    activeVoiceTranscriptionAbortController = transcriptionAbortController;
    try {
      let transcript = await transcribeVoiceBlob(primaryBlob, {
        signal: transcriptionAbortController.signal
      });
      if (!transcript && fallbackBlob instanceof Blob && fallbackBlob.size > 0) {
        transcript = await transcribeVoiceBlob(fallbackBlob, {
          signal: transcriptionAbortController.signal
        });
      }
      voiceCaptureState.mode = 'idle';
      voiceCaptureState.silenceSince = 0;
      voiceCaptureState.startedAt = 0;
      renderChatSendButtonState();

      if (!transcript) {
        setStatus(chatStatus, 'No se pudo transcribir el audio.', true);
        if (shouldResumeVoiceSession()) {
          scheduleVoiceSessionRestart({
            reason: 'empty_transcript',
            delayMs: VOICE_SESSION_RESTART_AFTER_ERROR_MS
          });
        }
        return false;
      }

      if (keepSession && !voiceSessionActive) {
        setStatus(chatStatus, 'Procesamiento de voz cancelado.');
        return false;
      }

      chatInput.value = transcript;
      updateChatInputSize();
      setStatus(chatStatus, 'Mensaje de voz transcrito. Enviando...');
      await sendChatMessage({
        source: 'voice',
        allowInterrupt: true,
        awaitVoicePlayback: keepSession
      });
      if (shouldResumeVoiceSession()) {
        scheduleVoiceSessionRestart({
          reason: 'next_turn'
        });
      }
      return true;
    } catch (error) {
      const aborted = isAbortLikeError(error);
      const canRetryWithFallback =
        !aborted &&
        fallbackBlob instanceof Blob &&
        fallbackBlob.size > 0 &&
        isCorruptedOrUnsupportedAudioError(error);
      if (canRetryWithFallback) {
        try {
          const retryTranscript = await transcribeVoiceBlob(fallbackBlob, {
            signal: transcriptionAbortController.signal
          });
          voiceCaptureState.mode = 'idle';
          voiceCaptureState.silenceSince = 0;
          voiceCaptureState.startedAt = 0;
          renderChatSendButtonState();
          if (!retryTranscript) {
            throw new Error('No se pudo transcribir el audio.');
          }
          if (keepSession && !voiceSessionActive) {
            setStatus(chatStatus, 'Procesamiento de voz cancelado.');
            return false;
          }
          chatInput.value = retryTranscript;
          updateChatInputSize();
          setStatus(chatStatus, 'Mensaje de voz transcrito. Enviando...');
          await sendChatMessage({
            source: 'voice',
            allowInterrupt: true,
            awaitVoicePlayback: keepSession
          });
          if (shouldResumeVoiceSession()) {
            scheduleVoiceSessionRestart({
              reason: 'next_turn'
            });
          }
          return true;
        } catch (retryError) {
          error = retryError;
        }
      }

      voiceCaptureState.mode = 'idle';
      voiceCaptureState.silenceSince = 0;
      voiceCaptureState.startedAt = 0;
      renderChatSendButtonState();
      if (isAbortLikeError(error)) {
        setStatus(chatStatus, 'Procesamiento de voz cancelado.');
        return false;
      }
      const message = error instanceof Error ? error.message : 'No se pudo transcribir el audio.';
      setStatus(chatStatus, message, true);
      if (shouldResumeVoiceSession()) {
        scheduleVoiceSessionRestart({
          reason: 'transcribe_error',
          delayMs: VOICE_SESSION_RESTART_AFTER_ERROR_MS
        });
      }
      return false;
    } finally {
      if (activeVoiceTranscriptionAbortController === transcriptionAbortController) {
        activeVoiceTranscriptionAbortController = null;
      }
    }
  }

  async function handleVoiceSendButtonClick() {
    if (voiceCaptureState.mode === 'transcribing') {
      setVoiceSessionActive(false, {
        reason: 'tap_cancel_transcribing'
      });
      abortActiveVoiceTranscription('tap_cancel_transcribing');
      releaseVoiceSessionResources();
      setStatus(chatStatus, 'Procesamiento de voz cancelado.');
      return;
    }

    if (voiceCaptureState.mode === 'recording') {
      setVoiceSessionActive(false, {
        reason: 'tap_stop_recording'
      });
      await stopVoiceCapture({
        transcribe: false,
        reason: 'tap_stop'
      });
      return;
    }

    if (voiceSessionActive) {
      if (isGeneratingChat || isAssistantSpeechPlaybackActive()) {
        setVoiceSessionActive(false, {
          reason: 'tap_cancel_processing'
        });
        abortActiveVoiceTranscription('tap_cancel_processing');
        releaseVoiceSessionResources();
        const interrupted = await interruptActiveChatTurn({
          reason: 'voice_session_cancel_processing'
        });
        if (!interrupted && isGeneratingChat) {
          setStatus(chatStatus, 'No se pudo cancelar la respuesta activa.', true);
          return;
        }
        setStatus(chatStatus, 'Escucha por voz desactivada.');
        return;
      }

      setVoiceSessionActive(false, {
        reason: 'tap_stop_idle'
      });
      releaseVoiceSessionResources();
      if (isGeneratingChat) {
        void interruptActiveChatTurn({
          reason: 'voice_session_stop'
        });
      }
      setStatus(chatStatus, 'Escucha por voz desactivada.');
      return;
    }

    setVoiceSessionActive(true, {
      reason: 'tap_start',
      stopPlayback: false
    });
    const started = await startVoiceCapture({
      source: 'voice_button'
    });
    if (!started) {
      setVoiceSessionActive(false, {
        reason: 'voice_start_failed'
      });
      releaseVoiceSessionResources();
    }
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

  function refreshChatInputSizeMetrics(force = false) {
    if (!chatInput) {
      return chatInputSizeMetrics;
    }

    const width = Math.max(0, Number(chatInput.clientWidth) || 0);
    if (!force && width === chatInputSizeMetrics.width && chatInputSizeMetrics.maxHeight > 0) {
      return chatInputSizeMetrics;
    }

    const computed = window.getComputedStyle(chatInput);
    const lineHeight = parseFloat(computed.lineHeight) || 20;
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;
    const maxHeight = lineHeight * MAX_CHAT_INPUT_ROWS + paddingTop + paddingBottom;
    const minimum = lineHeight + paddingTop + paddingBottom;
    chatInputSizeMetrics = {
      width,
      maxHeight,
      minimum
    };

    return chatInputSizeMetrics;
  }

  function cancelScheduledChatInputResize() {
    if (!chatInputResizeRafId) {
      return;
    }
    cancelAnimationFrame(chatInputResizeRafId);
    chatInputResizeRafId = 0;
  }

  function requestChatInputResize(options = {}) {
    const immediate = options?.immediate === true || typeof requestAnimationFrame !== 'function';
    const forceMeasure = options?.forceMeasure === true;
    if (immediate) {
      cancelScheduledChatInputResize();
      updateChatInputSize({
        forceMeasure
      });
      return;
    }

    if (chatInputResizeRafId) {
      return;
    }

    chatInputResizeRafId = requestAnimationFrame(() => {
      chatInputResizeRafId = 0;
      updateChatInputSize({
        forceMeasure
      });
    });
  }

  function updateChatInputSize(options = {}) {
    if (!chatInput) {
      return;
    }

    chatInput.style.height = 'auto';
    const metrics = refreshChatInputSizeMetrics(options?.forceMeasure === true);
    const maxHeight = Math.max(0, Number(metrics?.maxHeight) || 0);
    const minimum = Math.max(0, Number(metrics?.minimum) || 0);
    const next = Math.min(chatInput.scrollHeight, maxHeight || chatInput.scrollHeight);
    const safeHeight = Math.max(next, minimum || 0);

    chatInput.style.height = `${safeHeight}px`;
    chatInput.style.overflowY = chatInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
    renderChatSendButtonState();
  }

  function createChatMessageNode(message) {
    const article = document.createElement('article');
    article.className = `chat-message chat-message--${message.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    const baseText = message.role === 'assistant' ? stripEmotionTag(message.content) : message.content;
    const isVoiceRevealWaiting = message.role === 'assistant' && String(message?.voiceRevealState || '') === 'waiting';
    const isVoiceRevealPlaying = message.role === 'assistant' && String(message?.voiceRevealState || '') === 'playing';
    const visibleChars = Math.max(0, Number(message?.audioSyncVisibleChars) || 0);
    const hasVoiceRevealChars = isVoiceRevealPlaying && Number.isFinite(Number(message?.audioSyncVisibleChars));
    const visibleText = isVoiceRevealWaiting
      ? ''
      : hasVoiceRevealChars
        ? String(baseText || '').slice(0, visibleChars)
        : baseText;

    if (message.role === 'assistant' && ((message.pending && !visibleText) || isVoiceRevealWaiting)) {
      const loader = document.createElement('span');
      loader.className = 'chat-inline-loader chat-inline-loader--solo';
      loader.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'sr-only';
      label.textContent = 'Generando respuesta';

      bubble.append(loader, label);
    } else {
      if (message.role === 'assistant') {
        if (hasVoiceRevealChars) {
          bubble.textContent = visibleText || '';
        } else {
          renderMarkdownInto(bubble, visibleText || message.content);
        }
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

      for (const [imageIndex, image] of generatedImages.slice(0, 4).entries()) {
        const src = String(image?.dataUrl || image?.url || '').trim();
        if (!src) {
          continue;
        }

        const card = document.createElement('div');
        card.className = 'chat-generated-image';

        const frame = document.createElement('div');
        frame.className = 'chat-generated-image__frame is-loading';
        const widthHint = Math.max(0, Number(image?.width || image?.imageWidth) || 0);
        const heightHint = Math.max(0, Number(image?.height || image?.imageHeight) || 0);
        if (widthHint > 0 && heightHint > 0) {
          frame.style.setProperty('--chat-generated-image-aspect-ratio', `${widthHint} / ${heightHint}`);
        }

        const img = document.createElement('img');
        img.className = 'chat-generated-image__preview';
        img.alt = String(image?.alt || 'Generated image').trim() || 'Generated image';
        img.loading = 'lazy';
        img.decoding = 'async';

        const finalizeImageFrame = () => {
          const naturalWidth = Math.max(0, Number(img.naturalWidth) || 0);
          const naturalHeight = Math.max(0, Number(img.naturalHeight) || 0);
          if (naturalWidth > 0 && naturalHeight > 0) {
            frame.style.setProperty('--chat-generated-image-aspect-ratio', `${naturalWidth} / ${naturalHeight}`);
          }
          frame.classList.remove('is-loading');
        };
        img.addEventListener('load', finalizeImageFrame);
        img.addEventListener('error', () => {
          frame.classList.remove('is-loading');
        });
        img.src = src;
        if (img.complete) {
          finalizeImageFrame();
        }

        const actions = document.createElement('div');
        actions.className = 'chat-generated-image__actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'icon-btn icon-btn--mini chat-generated-image__action';
        copyBtn.dataset.chatImageAction = 'copy';
        copyBtn.dataset.chatMessageId = String(message?.id || '').trim();
        copyBtn.dataset.chatImageIndex = String(imageIndex);
        copyBtn.title = 'Copiar imagen';
        copyBtn.setAttribute('aria-label', 'Copiar imagen generada');
        copyBtn.appendChild(createCopyIcon());

        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'icon-btn icon-btn--mini chat-generated-image__action';
        downloadBtn.dataset.chatImageAction = 'download';
        downloadBtn.dataset.chatMessageId = String(message?.id || '').trim();
        downloadBtn.dataset.chatImageIndex = String(imageIndex);
        downloadBtn.title = 'Descargar imagen';
        downloadBtn.setAttribute('aria-label', 'Descargar imagen generada');
        downloadBtn.appendChild(createDownloadIcon());

        actions.append(copyBtn, downloadBtn);
        frame.appendChild(img);
        card.append(frame, actions);
        imageWrap.appendChild(card);
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

  function resolveChatRenderLimit(totalMessages = 0) {
    const total = Math.max(0, Number(totalMessages) || 0);
    if (total <= 0) {
      return 0;
    }

    const requested = Math.max(1, Number(chatHistoryRenderLimit) || CHAT_STARTUP_RENDER_MAX_MESSAGES);
    return Math.min(total, requested);
  }

  function createChatHistoryCollapsedNode(hiddenCount) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-history-collapsed';

    const copy = document.createElement('span');
    copy.className = 'chat-history-collapsed__label';
    copy.textContent = `Se ocultaron ${hiddenCount} mensajes anteriores para acelerar la carga inicial.`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost chat-history-collapsed__btn';
    button.dataset.chatHistoryAction = 'expand';
    button.textContent = 'Cargar historial completo';

    wrapper.append(copy, button);
    return wrapper;
  }

  function normalizeChatStreamBottomReserve(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(720, Math.round(numeric)));
  }

  function syncChatBottomReserve({ streaming = false } = {}) {
    if (!chatHistory.length) {
      chatStreamBottomReservePx = 0;
      return;
    }

    chatStreamBottomReservePx = streaming ? CHAT_STREAM_BOTTOM_RESERVE_PX : CHAT_IDLE_BOTTOM_RESERVE_PX;
  }

  function renderChatMessages(options = {}) {
    const allowAutoScroll = options.allowAutoScroll !== false;
    const nearBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 70;
    chatMessagesEl.textContent = '';

    if (!chatHistory.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty';
      empty.textContent = 'Escribe un mensaje para chatear. Enter envia, Shift+Enter agrega salto de linea.';
      chatMessagesEl.appendChild(empty);
      return;
    }

    const renderLimit = resolveChatRenderLimit(chatHistory.length);
    const hiddenCount = Math.max(0, chatHistory.length - renderLimit);
    const visibleMessages = hiddenCount > 0 ? chatHistory.slice(-renderLimit) : chatHistory;
    if (hiddenCount > 0) {
      chatMessagesEl.appendChild(createChatHistoryCollapsedNode(hiddenCount));
    }

    for (const message of visibleMessages) {
      chatMessagesEl.appendChild(createChatMessageNode(message));
    }

    const reservePx = normalizeChatStreamBottomReserve(chatStreamBottomReservePx);
    if (reservePx > 0) {
      const reserve = document.createElement('div');
      reserve.className = 'chat-stream-reserve';
      reserve.style.height = `${reservePx}px`;
      reserve.setAttribute('aria-hidden', 'true');
      chatMessagesEl.appendChild(reserve);
    }

    if (allowAutoScroll && nearBottom) {
      scrollChatToBottom();
    }
  }

  function expandChatHistoryRenderLimit() {
    const totalMessages = Array.isArray(chatHistory) ? chatHistory.length : 0;
    if (totalMessages <= 0) {
      return;
    }

    chatHistoryRenderLimit = totalMessages;
    renderChatMessages({
      allowAutoScroll: false
    });
  }

  function scheduleChatRender(options = {}) {
    const allowAutoScroll = options.allowAutoScroll !== false;

    if (pendingChatRenderRaf) {
      pendingChatRenderAllowAutoScroll = pendingChatRenderAllowAutoScroll && allowAutoScroll;
      return;
    }

    pendingChatRenderAllowAutoScroll = allowAutoScroll;

    pendingChatRenderRaf = requestAnimationFrame(() => {
      const shouldAutoScroll = pendingChatRenderAllowAutoScroll;
      pendingChatRenderRaf = 0;
      pendingChatRenderAllowAutoScroll = true;
      renderChatMessages({
        allowAutoScroll: shouldAutoScroll
      });
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

    const keepFullHistoryVisible = chatHistoryRenderLimit >= chatHistory.length;
    chatHistory.push(messageRecord);

    const maxHistoryMessages = getSystemVariableNumber('chat.maxHistoryMessages', MAX_CHAT_HISTORY_MESSAGES);
    if (chatHistory.length > maxHistoryMessages) {
      chatHistory = chatHistory.slice(-maxHistoryMessages);
    }
    if (keepFullHistoryVisible) {
      chatHistoryRenderLimit = chatHistory.length;
    } else {
      const fallbackLimit = Math.max(1, Number(chatHistoryRenderLimit) || CHAT_STARTUP_RENDER_MAX_MESSAGES);
      chatHistoryRenderLimit = Math.min(chatHistory.length, Math.max(CHAT_STARTUP_RENDER_MAX_MESSAGES, fallbackLimit));
    }

    syncChatBottomReserve({
      streaming: false
    });
    renderChatMessages();
    requestChatBottomAlign(20, 80);
    await saveChatHistory();
    return messageRecord;
  }

  async function resetChatHistory() {
    chatHistory = [];
    chatHistoryRenderLimit = CHAT_STARTUP_RENDER_MAX_MESSAGES;
    syncChatBottomReserve({
      streaming: false
    });
    clearPendingConversationAttachments();
    renderChatMessages();
    await saveChatHistory();
    setStatus(chatStatus, 'Historial limpiado.');
    startRandomEmotionCycle({ immediate: true });
  }

  function buildActiveTabsSystemContext(limit = 20) {
    const tabs = Array.isArray(tabContextSnapshot?.tabs) ? tabContextSnapshot.tabs : [];
    const ordered = tabs
      .slice()
      .sort((left, right) => {
        const leftId = Number(left?.tabId) || -1;
        const rightId = Number(right?.tabId) || -1;
        const leftActive = leftId === tabContextSnapshot.activeTabId ? 1 : 0;
        const rightActive = rightId === tabContextSnapshot.activeTabId ? 1 : 0;
        if (leftActive !== rightActive) {
          return rightActive - leftActive;
        }

        const leftAccess = Number(left?.details?.temporal?.lastAccessedAt) || Number(left?.updatedAt) || 0;
        const rightAccess = Number(right?.details?.temporal?.lastAccessedAt) || Number(right?.updatedAt) || 0;
        if (leftAccess !== rightAccess) {
          return rightAccess - leftAccess;
        }

        return leftId - rightId;
      });
    const trimmed = ordered.slice(0, limit);

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

    const omitted = Math.max(0, tabs.length - trimmed.length);
    const footer = omitted > 0 ? `\n... ${omitted} tabs mas no listadas.` : '';
    return `Navegacion activa (tabs abiertas):\n${lines.join('\n')}${footer}`;
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

  const WHATSAPP_ALIAS_STOPWORDS = new Set([
    'a',
    'al',
    'la',
    'el',
    'de',
    'del',
    'para',
    'to',
    'send',
    'mensaje',
    'message',
    'envia',
    'enviar',
    'manda',
    'mandar',
    'escribe',
    'escribir',
    'whatsapp',
    'chat',
    'numero',
    'numero',
    'telefono',
    'phone'
  ]);

  function normalizeWhatsappAliasToken(value, limit = 64) {
    const token = String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._\-\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Math.max(8, Number(limit) || 64));

    if (!token || token.length < 2) {
      return '';
    }

    if (/^\d+$/.test(token)) {
      return '';
    }

    return token;
  }

  function normalizeWhatsappAliasLabel(value, fallbackToken = '', limit = 72) {
    const safe = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, Math.max(24, Number(limit) || 72));
    if (safe) {
      return safe;
    }

    return String(fallbackToken || '').slice(0, Math.max(24, Number(limit) || 72));
  }

  function normalizeWhatsappAliasRecord(rawRecord, fallbackAlias = '') {
    const record = rawRecord && typeof rawRecord === 'object' ? rawRecord : {};
    const alias = normalizeWhatsappAliasToken(record.alias || fallbackAlias || '');
    const phone = normalizeWhatsappPhoneForUrl(record.phone || record.number || '');
    if (!alias || !phone) {
      return null;
    }

    const createdAt = Math.max(0, Number(record.createdAt) || 0) || Date.now();
    const updatedAt = Math.max(createdAt, Number(record.updatedAt) || createdAt);
    const lastUsedAt = Math.max(0, Number(record.lastUsedAt) || 0);
    const useCount = Math.max(0, Number(record.useCount) || 0);
    const source = String(record.source || 'manual').trim().slice(0, 40) || 'manual';

    return {
      alias,
      label: normalizeWhatsappAliasLabel(record.label || record.name || alias, alias),
      phone,
      createdAt,
      updatedAt,
      lastUsedAt,
      useCount,
      source
    };
  }

  function normalizeWhatsappAliasBook(rawBook) {
    const raw = rawBook && typeof rawBook === 'object' ? rawBook : {};
    const aliasSource = raw.aliases && typeof raw.aliases === 'object' ? raw.aliases : raw;
    const normalizedByAlias = new Map();
    const entries = Object.entries(aliasSource || {});

    for (const [aliasKey, value] of entries) {
      const record = normalizeWhatsappAliasRecord(
        typeof value === 'string'
          ? {
              alias: aliasKey,
              label: aliasKey,
              phone: value
            }
          : {
              ...(value && typeof value === 'object' ? value : {}),
              alias: aliasKey
            },
        aliasKey
      );
      if (!record) {
        continue;
      }

      const known = normalizedByAlias.get(record.alias);
      if (!known) {
        normalizedByAlias.set(record.alias, record);
        continue;
      }

      normalizedByAlias.set(record.alias, {
        ...known,
        phone: record.phone || known.phone,
        label: record.label.length > known.label.length ? record.label : known.label,
        updatedAt: Math.max(known.updatedAt || 0, record.updatedAt || 0),
        lastUsedAt: Math.max(known.lastUsedAt || 0, record.lastUsedAt || 0),
        useCount: Math.max(known.useCount || 0, record.useCount || 0),
        source: record.source || known.source || 'manual'
      });
    }

    const sorted = Array.from(normalizedByAlias.values()).sort((left, right) => {
      const leftUsed = Math.max(0, Number(left.lastUsedAt) || 0);
      const rightUsed = Math.max(0, Number(right.lastUsedAt) || 0);
      if (leftUsed !== rightUsed) {
        return rightUsed - leftUsed;
      }

      const leftCount = Math.max(0, Number(left.useCount) || 0);
      const rightCount = Math.max(0, Number(right.useCount) || 0);
      if (leftCount !== rightCount) {
        return rightCount - leftCount;
      }

      return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
    });
    const trimmed = sorted.slice(0, WHATSAPP_ALIAS_MAX_ITEMS);
    const aliases = {};
    let updatedAt = 0;

    for (const item of trimmed) {
      aliases[item.alias] = item;
      updatedAt = Math.max(updatedAt, Number(item.updatedAt) || 0);
    }

    return {
      version: WHATSAPP_ALIAS_STORAGE_VERSION,
      updatedAt: Math.max(0, Number(raw.updatedAt) || 0, updatedAt),
      aliases
    };
  }

  function getWhatsappAliasEntries(limit = 40) {
    const safeLimit = Math.max(1, Math.min(WHATSAPP_ALIAS_MAX_ITEMS, Number(limit) || 40));
    const entries = Object.values(
      whatsappAliasBook?.aliases && typeof whatsappAliasBook.aliases === 'object' ? whatsappAliasBook.aliases : {}
    );

    return entries
      .map((item) => normalizeWhatsappAliasRecord(item, item?.alias || ''))
      .filter(Boolean)
      .sort((left, right) => {
        const leftCount = Math.max(0, Number(left.useCount) || 0);
        const rightCount = Math.max(0, Number(right.useCount) || 0);
        if (leftCount !== rightCount) {
          return rightCount - leftCount;
        }

        const leftUsed = Math.max(0, Number(left.lastUsedAt || left.updatedAt) || 0);
        const rightUsed = Math.max(0, Number(right.lastUsedAt || right.updatedAt) || 0);
        return rightUsed - leftUsed;
      })
      .slice(0, safeLimit);
  }

  async function persistWhatsappAliasBook() {
    whatsappAliasBook = normalizeWhatsappAliasBook(whatsappAliasBook);
    const payload = {
      [WHATSAPP_ALIAS_STORAGE_KEY]: whatsappAliasBook
    };

    whatsappAliasWritePromise = whatsappAliasWritePromise
      .catch(() => {})
      .then(() => writeChromeLocal(payload));
    await whatsappAliasWritePromise;
    return true;
  }

  async function hydrateWhatsappAliasBook() {
    const payload = await readChromeLocal({
      [WHATSAPP_ALIAS_STORAGE_KEY]: null
    });
    whatsappAliasBook = normalizeWhatsappAliasBook(payload?.[WHATSAPP_ALIAS_STORAGE_KEY]);
    return whatsappAliasBook;
  }

  function buildWhatsappAliasCandidatesFromText(value = '') {
    const source = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!source) {
      return [];
    }

    const normalized = normalizeWhatsappAliasToken(source, 120);
    const candidates = [];
    const pushCandidate = (item) => {
      const token = normalizeWhatsappAliasToken(item, 64);
      if (!token || WHATSAPP_ALIAS_STOPWORDS.has(token) || candidates.includes(token)) {
        return;
      }
      candidates.push(token);
    };

    if (normalized) {
      pushCandidate(normalized);
    }

    const tail = normalized.match(/\b(?:a|to|para)\s+([a-z0-9._-]{2,40})$/i);
    if (tail && tail[1]) {
      pushCandidate(tail[1]);
    }

    const words = normalized.split(' ');
    for (const token of words) {
      if (token.length < 2 || token.length > 40) {
        continue;
      }
      pushCandidate(token);
      if (candidates.length >= 8) {
        break;
      }
    }

    return candidates.slice(0, 8);
  }

  function resolveWhatsappAliasEntryFromText(value = '') {
    const candidates = buildWhatsappAliasCandidatesFromText(value);
    if (!candidates.length) {
      return null;
    }

    const aliases = whatsappAliasBook?.aliases && typeof whatsappAliasBook.aliases === 'object' ? whatsappAliasBook.aliases : {};
    for (const token of candidates) {
      const record = normalizeWhatsappAliasRecord(aliases[token], token);
      if (record) {
        return record;
      }
    }

    return null;
  }

  function getWhatsappAliasEntryFromArgs(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const candidateFields = [
      safeArgs.query,
      safeArgs.name,
      safeArgs.chat,
      safeArgs.title,
      safeArgs.search,
      safeArgs.contact,
      safeArgs.recipient,
      safeArgs.destinatario,
      safeArgs.person,
      safeArgs.persona,
      safeArgs.client,
      safeArgs.cliente,
      safeArgs.to
    ];

    for (const field of candidateFields) {
      const resolved = resolveWhatsappAliasEntryFromText(field);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  function getPrimaryWhatsappAliasCandidateFromArgs(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const candidateFields = [
      safeArgs.query,
      safeArgs.name,
      safeArgs.chat,
      safeArgs.title,
      safeArgs.search,
      safeArgs.contact,
      safeArgs.recipient,
      safeArgs.destinatario,
      safeArgs.person,
      safeArgs.persona,
      safeArgs.client,
      safeArgs.cliente,
      safeArgs.to
    ];

    for (const field of candidateFields) {
      const text = String(field || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        continue;
      }
      const tokens = buildWhatsappAliasCandidatesFromText(text);
      if (!tokens.length) {
        continue;
      }
      const preferred = tokens.find((item) => !String(item || '').includes(' ')) || tokens[0];
      const alias = normalizeWhatsappAliasToken(preferred, 64);
      if (!alias) {
        continue;
      }
      return {
        alias,
        label: normalizeWhatsappAliasLabel(text, alias)
      };
    }

    return null;
  }

  function getWhatsappPhoneFromToolResult(result = {}, fallbackPhone = '') {
    const safeResult = result && typeof result === 'object' ? result : {};
    const openChat = safeResult.openChat && typeof safeResult.openChat === 'object' ? safeResult.openChat : {};
    const selected = safeResult.selected && typeof safeResult.selected === 'object' ? safeResult.selected : {};
    const openChatSelected =
      openChat.selected && typeof openChat.selected === 'object' ? openChat.selected : {};
    const candidates = [
      safeResult.phone,
      safeResult.chatPhone,
      safeResult.currentPhone,
      selected.phone,
      openChat.phone,
      openChatSelected.phone,
      fallbackPhone
    ];

    for (const value of candidates) {
      const normalized = normalizeWhatsappPhoneForUrl(value || '');
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  function extractWhatsappAliasAssignmentsFromText(text = '') {
    const source = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!source) {
      return [];
    }

    const aliasChunk = '([A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ._\\-\\s]{2,48})';
    const phoneChunk = '(\\+?[\\d][\\d\\s().-]{6,22})';
    const patterns = [
      new RegExp(`(?:guarda(?:r)?|save|recuerda(?:r)?|recorda(?:r)?)(?:\\s+que)?\\s+${aliasChunk}\\s*(?:es|is|=|:)\\s*${phoneChunk}`, 'giu'),
      new RegExp(`${aliasChunk}\\s*(?:es|is|=|:)\\s*(?:mi\\s+|my\\s+)?(?:numero\\s+de\\s+|number\\s+for\\s+)?(?:whatsapp\\s+)?${phoneChunk}`, 'giu'),
      new RegExp(`${phoneChunk}\\s*(?:es|is|=|:)\\s*(?:de\\s+|for\\s+)?${aliasChunk}`, 'giu')
    ];

    const assignments = [];
    const seen = new Set();

    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const left = String(match[1] || '').trim();
        const right = String(match[2] || '').trim();
        const leftPhone = normalizeWhatsappPhoneForUrl(left);
        const rightPhone = normalizeWhatsappPhoneForUrl(right);
        const aliasRaw = leftPhone ? right : left;
        const phoneRaw = leftPhone ? left : rightPhone ? right : '';
        const alias = normalizeWhatsappAliasToken(aliasRaw, 64);
        const phone = normalizeWhatsappPhoneForUrl(phoneRaw);
        if (!alias || !phone) {
          continue;
        }

        const dedupeKey = `${alias}|${phone}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        assignments.push({
          alias,
          label: normalizeWhatsappAliasLabel(aliasRaw, alias),
          phone,
          source: 'user_text'
        });
        if (assignments.length >= 10) {
          return assignments;
        }
      }
    }

    return assignments;
  }

  async function upsertWhatsappAliasEntries(assignments = [], options = {}) {
    const source = Array.isArray(assignments) ? assignments : [];
    if (!source.length) {
      return {
        changed: false,
        added: 0,
        updated: 0
      };
    }

    let added = 0;
    let updated = 0;
    let changed = false;
    const now = Date.now();
    const aliases = whatsappAliasBook?.aliases && typeof whatsappAliasBook.aliases === 'object' ? { ...whatsappAliasBook.aliases } : {};

    for (const item of source) {
      const record = normalizeWhatsappAliasRecord(item, item?.alias || item?.label || '');
      if (!record) {
        continue;
      }

      const known = normalizeWhatsappAliasRecord(aliases[record.alias], record.alias);
      if (!known) {
        aliases[record.alias] = {
          ...record,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: Math.max(0, Number(record.lastUsedAt) || 0),
          useCount: Math.max(0, Number(record.useCount) || 0)
        };
        added += 1;
        changed = true;
        continue;
      }

      const nextPhone = record.phone || known.phone;
      const nextLabel = record.label && record.label.length > known.label.length ? record.label : known.label;
      const nextSource = record.source || known.source || 'manual';
      const changedPhone = nextPhone && nextPhone !== known.phone;
      const changedLabel = nextLabel !== known.label;
      const changedSource = nextSource !== known.source;
      if (!changedPhone && !changedLabel && !changedSource) {
        continue;
      }

      aliases[record.alias] = {
        ...known,
        phone: nextPhone,
        label: nextLabel,
        source: nextSource,
        updatedAt: now
      };
      updated += 1;
      changed = true;
    }

    if (!changed) {
      return {
        changed: false,
        added: 0,
        updated: 0
      };
    }

    whatsappAliasBook = normalizeWhatsappAliasBook({
      ...whatsappAliasBook,
      aliases,
      updatedAt: now
    });

    if (options.persist !== false) {
      await persistWhatsappAliasBook();
    }

    return {
      changed: true,
      added,
      updated
    };
  }

  async function ingestWhatsappAliasesFromUserText(text = '') {
    const assignments = extractWhatsappAliasAssignmentsFromText(text);
    if (!assignments.length) {
      return {
        changed: false,
        added: 0,
        updated: 0
      };
    }

    const result = await upsertWhatsappAliasEntries(assignments, { persist: true });
    if (result.changed) {
      logDebug('whatsapp_alias:user_text_updated', {
        added: result.added,
        updated: result.updated,
        aliases: assignments.map((item) => item.alias)
      });
    }
    return result;
  }

  function buildWhatsappAliasAssignmentsFromTab(tab) {
    const context = tab && typeof tab === 'object' ? tab : {};
    if (!isWhatsappContext(context)) {
      return [];
    }

    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const inbox = Array.isArray(details.inbox) ? details.inbox : [];
    const assignments = [];
    const pushPair = (aliasValue, phoneValue) => {
      const alias = normalizeWhatsappAliasToken(aliasValue, 64);
      const phone = normalizeWhatsappPhoneForUrl(phoneValue);
      if (!alias || !phone) {
        return;
      }
      assignments.push({
        alias,
        label: normalizeWhatsappAliasLabel(aliasValue, alias),
        phone,
        source: 'whatsapp_snapshot'
      });
    };

    pushPair(currentChat.title || currentChat.key || '', currentChat.phone || '');
    for (const entry of inbox.slice(0, 80)) {
      pushPair(entry?.title || '', entry?.phone || '');
    }

    return assignments;
  }

  async function syncWhatsappAliasesFromSnapshot(snapshot) {
    const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
    const assignments = [];
    for (const tab of tabs) {
      if (!isWhatsappContext(tab)) {
        continue;
      }
      assignments.push(...buildWhatsappAliasAssignmentsFromTab(tab));
    }

    if (!assignments.length) {
      return {
        changed: false,
        added: 0,
        updated: 0
      };
    }

    return upsertWhatsappAliasEntries(assignments, {
      persist: true
    });
  }

  function buildWhatsappAliasAssignmentsFromIndexedHistories(histories = []) {
    const rows = Array.isArray(histories) ? histories : [];
    const assignments = [];
    const dedupe = new Set();
    const pushPair = (aliasValue, phoneValue) => {
      const alias = normalizeWhatsappAliasToken(aliasValue, 64);
      const phone = normalizeWhatsappPhoneForUrl(phoneValue);
      if (!alias || !phone) {
        return;
      }

      const dedupeKey = `${alias}|${phone}`;
      if (dedupe.has(dedupeKey)) {
        return;
      }

      dedupe.add(dedupeKey);
      assignments.push({
        alias,
        label: normalizeWhatsappAliasLabel(aliasValue, alias),
        phone,
        source: 'whatsapp_indexdb'
      });
    };

    for (const item of rows) {
      const history = item && typeof item === 'object' ? item : {};
      pushPair(history.title || history.chatKey || history.channelId || '', history.phone || '');
    }

    return assignments;
  }

  async function syncWhatsappAliasesFromIndexedDb(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const force = safeOptions.force === true;
    const now = Date.now();
    if (!force && now - whatsappAliasDbIndexSyncedAt < WHATSAPP_ALIAS_DB_INDEX_SYNC_COOLDOWN_MS) {
      return {
        changed: false,
        added: 0,
        updated: 0,
        scannedChats: 0,
        assignments: 0,
        skipped: 'cooldown'
      };
    }

    const desiredChatLimit = Math.max(
      40,
      Math.min(WHATSAPP_ALIAS_MAX_ITEMS * 2, Number(safeOptions.chatLimit) || 180)
    );

    whatsappAliasDbIndexSyncPromise = whatsappAliasDbIndexSyncPromise
      .catch(() => {})
      .then(async () => {
        whatsappAliasDbIndexSyncedAt = Date.now();
        let histories = [];
        try {
          histories = await readAllWhatsappChatHistories({
            chatLimit: desiredChatLimit,
            messageLimit: 1
          });
        } catch (error) {
          logWarn('whatsapp_alias:indexdb_read_failed', {
            error: error instanceof Error ? error.message : String(error || '')
          });
          return {
            changed: false,
            added: 0,
            updated: 0,
            scannedChats: 0,
            assignments: 0,
            error: 'indexdb_read_failed'
          };
        }

        const assignments = buildWhatsappAliasAssignmentsFromIndexedHistories(histories);
        if (!assignments.length) {
          return {
            changed: false,
            added: 0,
            updated: 0,
            scannedChats: histories.length,
            assignments: 0
          };
        }

        const result = await upsertWhatsappAliasEntries(assignments, {
          persist: true
        });
        if (result.changed) {
          logDebug('whatsapp_alias:indexdb_updated', {
            scannedChats: histories.length,
            assignments: assignments.length,
            added: result.added,
            updated: result.updated
          });
        }
        return {
          ...result,
          scannedChats: histories.length,
          assignments: assignments.length
        };
      });

    return whatsappAliasDbIndexSyncPromise;
  }

  async function markWhatsappAliasUsageByEntry(aliasEntry = null, options = {}) {
    const entry = aliasEntry && typeof aliasEntry === 'object' ? aliasEntry : null;
    if (!entry?.alias) {
      return false;
    }

    const aliases = whatsappAliasBook?.aliases && typeof whatsappAliasBook.aliases === 'object' ? { ...whatsappAliasBook.aliases } : {};
    const known = normalizeWhatsappAliasRecord(aliases[entry.alias], entry.alias);
    if (!known) {
      return false;
    }

    const now = Date.now();
    aliases[entry.alias] = {
      ...known,
      phone: entry.phone || known.phone,
      lastUsedAt: now,
      updatedAt: now,
      useCount: Math.max(0, Number(known.useCount) || 0) + 1,
      source: String(options.source || known.source || 'tool').trim().slice(0, 40) || 'tool'
    };
    whatsappAliasBook = normalizeWhatsappAliasBook({
      ...whatsappAliasBook,
      aliases,
      updatedAt: now
    });
    await persistWhatsappAliasBook();
    return true;
  }

  function buildWhatsappAliasSystemContext(limit = 12) {
    const aliases = getWhatsappAliasEntries(limit);
    if (!aliases.length) {
      return 'Alias WhatsApp guardados: ninguno.';
    }

    const lines = aliases.map((item, index) => {
      const label = String(item.label || item.alias || '').trim();
      const phone = String(item.phone || '').trim();
      return `${index + 1}. ${label} -> +${phone}`;
    });

    return ['Alias WhatsApp guardados (memoria local):', ...lines].join('\n');
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

  function normalizeWhatsappPhoneForUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    const digits = raw.replace(/[^\d+]/g, '');
    if (!digits) {
      return '';
    }

    const withoutPlus = digits.startsWith('+') ? digits.slice(1).replace(/[^\d]/g, '') : digits.replace(/[^\d]/g, '');
    if (!withoutPlus || withoutPlus.length < 7) {
      return '';
    }

    return withoutPlus.slice(0, 24);
  }

  function getWhatsappToolTargetExplicitPhone(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const phoneFields = [
      safeArgs.phone,
      safeArgs.to,
      safeArgs.number,
      safeArgs.chatPhone,
      safeArgs.telefono,
      safeArgs.tel,
      safeArgs.mobile,
      safeArgs.movil,
      safeArgs.cel,
      safeArgs.whatsapp,
      safeArgs.whatsappNumber,
      safeArgs.contactPhone,
      safeArgs.contact_phone
    ];

    for (const value of phoneFields) {
      const normalized = normalizeWhatsappPhoneForUrl(value || '');
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  function getWhatsappToolTargetPhone(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const explicitPhone = getWhatsappToolTargetExplicitPhone(safeArgs);
    if (explicitPhone) {
      return explicitPhone;
    }

    const aliasEntry = getWhatsappAliasEntryFromArgs(safeArgs);
    if (aliasEntry?.phone) {
      return aliasEntry.phone;
    }

    return '';
  }

  function hasWhatsappChatLookupArgs(args = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    if (getWhatsappToolTargetPhone(safeArgs)) {
      return true;
    }

    const chatIndex = Number(safeArgs.chatIndex);
    if (Number.isInteger(chatIndex) && chatIndex >= 1) {
      return true;
    }

    const scalarFields = [
      safeArgs.query,
      safeArgs.name,
      safeArgs.chat,
      safeArgs.title,
      safeArgs.search,
      safeArgs.contact,
      safeArgs.recipient,
      safeArgs.destinatario,
      safeArgs.person,
      safeArgs.persona,
      safeArgs.client,
      safeArgs.cliente
    ];
    if (scalarFields.some((item) => String(item || '').trim())) {
      return true;
    }

    return Array.isArray(safeArgs.queries) && safeArgs.queries.some((item) => String(item || '').trim());
  }

  function buildWhatsappSendUrlForTool(phone) {
    const params = new URLSearchParams();
    const safePhone = normalizeWhatsappPhoneForUrl(phone).replace(/^\+/, '');
    if (safePhone) {
      params.set('phone', safePhone);
    }
    const query = params.toString();
    return query ? `${WHATSAPP_WEB_BASE_URL}send?${query}` : WHATSAPP_WEB_BASE_URL;
  }

  async function waitForWhatsappTabContext(preferredTabId = -1, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 18);
    const delayMs = Math.max(80, Number(options.delayMs) || 160);
    const requestedTabId = Number(preferredTabId);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await tabContextService.requestSnapshot();
      const target = getPreferredWhatsappTab({
        tabId: Number.isFinite(requestedTabId) ? requestedTabId : -1
      });
      if (target && isWhatsappContext(target)) {
        return target;
      }
      if (attempt < attempts - 1) {
        await waitForMs(delayMs);
      }
    }

    return getPreferredWhatsappTab({
      tabId: Number.isFinite(requestedTabId) ? requestedTabId : -1
    });
  }

  function buildWhatsappToolErrorText(fallbackMessage, response = null) {
    const base = String(fallbackMessage || '').trim() || 'Error ejecutando WhatsApp.';
    const safeResponse = response && typeof response === 'object' ? response : null;
    const error = safeResponse ? String(safeResponse.error || '').trim() : '';
    const diagnostic = safeResponse && safeResponse.result && typeof safeResponse.result === 'object' ? safeResponse.result : null;
    const diagnosticsJson = diagnostic ? JSON.stringify(diagnostic).slice(0, 460) : '';

    if (error && diagnosticsJson) {
      return `${base} ${error}. Diagnostico: ${diagnosticsJson}`;
    }

    if (error) {
      return `${base} ${error}`;
    }

    if (diagnosticsJson) {
      return `${base} Diagnostico: ${diagnosticsJson}`;
    }

    return base;
  }

  function isWhatsappContentScriptReconnectError(errorText = '') {
    const token = String(errorText || '')
      .trim()
      .toLowerCase();
    if (!token) {
      return false;
    }

    return (
      token.includes('could not establish connection') ||
      token.includes('receiving end does not exist') ||
      token.includes('message port closed') ||
      token.includes('sin respuesta del content script') ||
      token.includes('no frame with id')
    );
  }

  function matchesWhatsappToolPhone(leftPhone, rightPhone) {
    const left = normalizeWhatsappPhoneForUrl(leftPhone || '');
    const right = normalizeWhatsappPhoneForUrl(rightPhone || '');
    if (!left || !right) {
      return false;
    }
    return left === right || left.endsWith(right) || right.endsWith(left);
  }

  async function waitForWhatsappChatReadyForAction(tabId, args = {}, options = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const safeOptions = options && typeof options === 'object' ? options : {};
    const attempts = Math.max(1, Math.min(42, Number(safeOptions.attempts) || 24));
    const delayMs = Math.max(80, Number(safeOptions.delayMs) || 180);
    const expectedPhone = normalizeWhatsappPhoneForUrl(
      safeOptions.expectedPhone || getWhatsappToolTargetPhone(safeArgs) || safeArgs.phone || ''
    );
    const tabIdNumber = Number(tabId);
    let lastPing = null;

    logDebug('whatsapp_tool:ready_wait_start', {
      tabId: Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
      expectedPhone: toSafeLogText(expectedPhone, 40),
      attempts,
      delayMs,
      reason: toSafeLogText(safeOptions.reason || '', 120)
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const ping = await tabContextService.runSiteActionInTab(
        Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
        'whatsapp',
        'getCurrentChat',
        {}
      );
      lastPing = ping;

      const current = ping?.result && typeof ping.result === 'object' ? ping.result : {};
      const currentPhone = normalizeWhatsappPhoneForUrl(current.phone || '');
      const currentTitle = String(current.title || '').trim();
      const phoneMatches = expectedPhone ? matchesWhatsappToolPhone(expectedPhone, currentPhone) : false;
      const ready = ping?.ok === true && (expectedPhone ? phoneMatches : Boolean(currentPhone || currentTitle));
      if (ready) {
        logDebug('whatsapp_tool:ready_wait_done', {
          tabId: Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
          expectedPhone: toSafeLogText(expectedPhone, 40),
          currentPhone: toSafeLogText(currentPhone, 40),
          currentTitle: toSafeLogText(currentTitle, 120),
          attempt
        });
        return {
          ready: true,
          attempt,
          expectedPhone,
          currentPhone,
          currentTitle,
          ping
        };
      }

      if (attempt < attempts) {
        if (attempt % 4 === 0) {
          await tabContextService.requestSnapshot();
        }
        await waitForMs(delayMs);
      }
    }

    const finalCurrent = lastPing?.result && typeof lastPing.result === 'object' ? lastPing.result : {};
    const finalCurrentPhone = normalizeWhatsappPhoneForUrl(finalCurrent.phone || '');
    const finalCurrentTitle = String(finalCurrent.title || '').trim();
    logWarn('whatsapp_tool:ready_wait_timeout', {
      tabId: Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
      expectedPhone: toSafeLogText(expectedPhone, 40),
      currentPhone: toSafeLogText(finalCurrentPhone, 40),
      currentTitle: toSafeLogText(finalCurrentTitle, 120),
      lastError: toSafeLogText(lastPing?.error || '', 220),
      attempts
    });
    return {
      ready: false,
      attempt: attempts,
      expectedPhone,
      currentPhone: finalCurrentPhone,
      currentTitle: finalCurrentTitle,
      ping: lastPing
    };
  }

  async function runWhatsappSiteActionWithRetries(tabId, action, args = {}, options = {}) {
    const safeAction = String(action || '').trim();
    const safeArgs = args && typeof args === 'object' ? args : {};
    const safeOptions = options && typeof options === 'object' ? options : {};
    const tabIdNumber = Number(tabId);
    const maxAttempts = Math.max(1, Math.min(5, Number(safeOptions.maxAttempts) || (safeOptions.openedViaUrl ? 4 : 3)));
    const retryDelayMs = Math.max(100, Number(safeOptions.retryDelayMs) || 220);
    let lastResponse = { ok: false, error: 'Sin respuesta del content script.' };

    if (safeOptions.openedViaUrl) {
      await waitForWhatsappChatReadyForAction(tabIdNumber, safeArgs, {
        expectedPhone: safeOptions.expectedPhone || '',
        attempts: Math.max(6, Number(safeOptions.warmupAttempts) || 14),
        delayMs: Math.max(90, Number(safeOptions.warmupDelayMs) || 180),
        reason: `warmup:${safeAction}`
      });
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await tabContextService.runSiteActionInTab(
        Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
        'whatsapp',
        safeAction,
        safeArgs
      );

      if (response?.ok === true) {
        if (attempt > 1) {
          logDebug('whatsapp_tool:site_action_recovered', {
            action: safeAction,
            tabId: Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
            attempt
          });
        }
        return response;
      }

      lastResponse = response || { ok: false, error: 'Sin respuesta del content script.' };
      const errorText = String(lastResponse?.error || '').trim();
      const recoverable = isWhatsappContentScriptReconnectError(errorText);
      if (!recoverable || attempt >= maxAttempts) {
        break;
      }

      const readyState = await waitForWhatsappChatReadyForAction(tabIdNumber, safeArgs, {
        expectedPhone: safeOptions.expectedPhone || '',
        attempts: Math.max(4, Number(safeOptions.retryReadyAttempts) || 10),
        delayMs: Math.max(90, Number(safeOptions.retryReadyDelayMs) || 170),
        reason: `retry:${safeAction}:${attempt}`
      });

      logWarn('whatsapp_tool:site_action_retry', {
        action: safeAction,
        tabId: Number.isFinite(tabIdNumber) ? tabIdNumber : -1,
        attempt,
        error: toSafeLogText(errorText, 220),
        ready: readyState.ready,
        expectedPhone: toSafeLogText(readyState.expectedPhone || '', 40),
        currentPhone: toSafeLogText(readyState.currentPhone || '', 40),
        currentTitle: toSafeLogText(readyState.currentTitle || '', 120)
      });

      await waitForMs(retryDelayMs + attempt * 110);
    }

    return lastResponse;
  }

  async function ensureWhatsappTabForTool(args = {}, options = {}) {
    const safeArgs = args && typeof args === 'object' ? args : {};
    const safeOptions = options && typeof options === 'object' ? options : {};
    const requestedTabId = Number(safeArgs.tabId);
    const phone = getWhatsappToolTargetPhone(safeArgs);
    const preferPhoneRoute = safeOptions.preferPhoneRoute === true && Boolean(phone);
    const phoneUrl = preferPhoneRoute ? buildWhatsappSendUrlForTool(phone) : '';
    let targetTab = getPreferredWhatsappTab(safeArgs);
    let openedTab = null;
    let reusedExistingTabByUrl = false;
    let focusError = '';
    let navigationError = '';

    if (targetTab && Number.isFinite(Number(targetTab.tabId)) && Number(targetTab.tabId) >= 0) {
      const focusResult = await tabContextService.runBrowserAction('focusTab', {
        tabId: Number(targetTab.tabId)
      });
      if (focusResult?.ok !== true) {
        focusError = String(focusResult?.error || '').trim();
      }
    } else {
      const focusResult = await tabContextService.runBrowserAction('focusTab', {
        tabId: Number.isFinite(requestedTabId) ? requestedTabId : -1,
        urlContains: WHATSAPP_WEB_URL_HINT
      });
      if (focusResult?.ok === true) {
        await tabContextService.requestSnapshot();
        targetTab = getPreferredWhatsappTab({
          tabId: Number.isFinite(requestedTabId) ? requestedTabId : -1
        });
      } else {
        focusError = String(focusResult?.error || '').trim();
      }
    }

    if (preferPhoneRoute && targetTab && isWhatsappContext(targetTab)) {
      const navigateResult = await tabContextService.runBrowserAction('navigateTab', {
        tabId: Number(targetTab.tabId) || -1,
        url: phoneUrl || WHATSAPP_WEB_BASE_URL,
        active: true
      });
      if (navigateResult?.ok === true) {
        openedTab = navigateResult?.result && typeof navigateResult.result === 'object' ? navigateResult.result : null;
        reusedExistingTabByUrl = true;
      } else {
        navigationError = String(navigateResult?.error || '').trim() || 'No se pudo navegar la tab activa de WhatsApp.';
        return {
          ok: false,
          error: `No se pudo abrir el chat en la tab existente de WhatsApp. ${navigationError}`.trim(),
          diagnostics: {
            requestedTabId: Number.isFinite(requestedTabId) ? requestedTabId : -1,
            targetTabId: Number(targetTab?.tabId) || -1,
            focusError,
            navigationError,
            phone,
            preferPhoneRoute
          }
        };
      }
    }

    if (!targetTab || !isWhatsappContext(targetTab)) {
      const openResult = await tabContextService.runBrowserAction('openNewTab', {
        url: phoneUrl || WHATSAPP_WEB_BASE_URL,
        active: true
      });
      if (openResult?.ok !== true) {
        return {
          ok: false,
          error: buildWhatsappToolErrorText('No se pudo abrir WhatsApp Web.', openResult),
          diagnostics: {
            requestedTabId: Number.isFinite(requestedTabId) ? requestedTabId : -1,
            focusError,
            phone,
            preferPhoneRoute
          }
        };
      }
      openedTab = openResult?.result && typeof openResult.result === 'object' ? openResult.result : null;
    }

    const preferredTab = openedTab && Number.isFinite(Number(openedTab.id))
      ? Number(openedTab.id)
      : Number.isFinite(requestedTabId)
        ? requestedTabId
        : Number(targetTab?.tabId) || -1;
    const resolved = await waitForWhatsappTabContext(preferredTab, {
      attempts: openedTab ? 32 : 18,
      delayMs: openedTab ? 220 : 140
    });
    if (!resolved || !isWhatsappContext(resolved)) {
      return {
        ok: false,
        error: 'No se pudo confirmar una tab de WhatsApp lista para ejecutar tools.',
        diagnostics: {
          requestedTabId: Number.isFinite(requestedTabId) ? requestedTabId : -1,
          openedTabId: Number(openedTab?.id) || -1,
          openedUrl: String(openedTab?.url || phoneUrl || WHATSAPP_WEB_BASE_URL),
          focusError,
          navigationError,
          reusedExistingTabByUrl,
          phone,
          preferPhoneRoute
        }
      };
    }

    return {
      ok: true,
      tab: resolved,
      openedViaUrl: Boolean(openedTab),
      openedUrl: String(openedTab?.url || phoneUrl || ''),
      reusedExistingTabByUrl,
      phone,
      focusError
    };
  }

  function buildWhatsappToolsSystemContext(limit = 24) {
    const whatsappTab = getPreferredWhatsappTab();
    if (!whatsappTab) {
      return [
        'Contexto WhatsApp: no hay tab activa detectada; las tools whatsapp.* intentaran abrir/enfocar WhatsApp Web automaticamente.',
        buildWhatsappAliasSystemContext(10)
      ].join('\n');
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
      buildWhatsappAliasSystemContext(12),
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
    const hasMapsApiKey = Boolean(String(maps.apiKey || '').trim());
    const nearbyType = normalizeNearbyPlaceType(maps.nearbyType || 'restaurant', 'restaurant');
    const micState = normalizeIntegrationPermissionState(permissions.microphone);
    const locState = normalizeIntegrationPermissionState(permissions.location);

    return [
      `Permisos locales: microfono=${micState}, ubicacion=${locState}.`,
      `Maps: apiKey=${hasMapsApiKey ? 'configurada' : 'no_configurada'}, nearbyTypeDefault=${nearbyType}.`,
      locationMeta
    ].join('\n');
  }

  function detectHostPlatform() {
    const rawPlatform = String(
      navigator?.userAgentData?.platform || navigator?.platform || navigator?.userAgent || ''
    )
      .trim()
      .toLowerCase();

    if (/(mac|darwin)/.test(rawPlatform)) {
      return {
        id: 'macos',
        label: 'macOS',
        supported: true
      };
    }

    if (/win/.test(rawPlatform)) {
      return {
        id: 'windows',
        label: 'Windows',
        supported: true
      };
    }

    if (/linux/.test(rawPlatform)) {
      return {
        id: 'linux',
        label: 'Linux',
        supported: false
      };
    }

    return {
      id: 'unknown',
      label: 'Desconocido',
      supported: false
    };
  }

  function normalizeSmtpTransport(value) {
    const token = String(value || '')
      .trim()
      .toLowerCase();
    return token === 'native_host' ? 'native_host' : 'http_agent';
  }

  function getSmtpDraftConfigFromScreen() {
    const savedSmtp = getIntegrationsConfig().smtp || {};
    return {
      transport: normalizeSmtpTransport(settingsSmtpTransportSelect?.value || savedSmtp.transport || 'http_agent'),
      nativeHostName: String(settingsSmtpNativeHostInput?.value || savedSmtp.nativeHostName || '').trim(),
      agentUrl: String(settingsSmtpAgentUrlInput?.value || savedSmtp.agentUrl || '').trim(),
      host: String(settingsSmtpHostInput?.value || savedSmtp.host || '').trim(),
      port: Math.max(1, Math.min(65535, Number(settingsSmtpPortInput?.value || savedSmtp.port || 587))),
      secure: ['auto', 'true', 'false'].includes(String(settingsSmtpSecureSelect?.value || savedSmtp.secure || '').trim())
        ? String(settingsSmtpSecureSelect?.value || savedSmtp.secure || 'auto').trim()
        : 'auto',
      username: String(settingsSmtpUsernameInput?.value || savedSmtp.username || '').trim(),
      password: String(settingsSmtpPasswordInput?.value || savedSmtp.password || '').trim(),
      from: String(settingsSmtpFromInput?.value || savedSmtp.from || '').trim()
    };
  }

  function getSmtpToolAvailability() {
    const smtp = getSmtpDraftConfigFromScreen();
    const platform = detectHostPlatform();
    const hasConfig = Boolean(smtp.host && smtp.username && smtp.password);
    if (!hasConfig) {
      return {
        enabled: false,
        reason: 'Faltan SMTP host/username/password.',
        transport: smtp.transport
      };
    }

    if (smtp.transport === 'native_host') {
      if (!platform.supported) {
        return {
          enabled: false,
          reason: `native_host solo soportado en ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL} (actual: ${platform.label}).`,
          transport: smtp.transport
        };
      }

      const expectedHostName = String(smtp.nativeHostName || '').trim();
      const checkedSameHost = expectedHostName && nativeHostDiagnostics.hostName === expectedHostName;
      const hasRecentPing = Date.now() - Math.max(0, Number(nativeHostDiagnostics.checkedAt) || 0) <= NATIVE_HOST_PING_STALE_MS;
      if (!(nativeHostDiagnostics.ok && checkedSameHost && hasRecentPing)) {
        return {
          enabled: false,
          reason: 'Complemento local no conectado. Ejecuta Ping complemento.',
          transport: smtp.transport
        };
      }
    }

    return {
      enabled: true,
      reason: '',
      transport: smtp.transport
    };
  }

  function buildNativeHostInstallMarkdown() {
    const platform = detectHostPlatform();
    const smtp = getSmtpDraftConfigFromScreen();
    const extensionId = String(chrome?.runtime?.id || '').trim() || '[extension_id]';
    const hostName = String(smtp.nativeHostName || 'com.greene.smtp_bridge').trim();
    const supportLabel = platform.supported ? 'soportado' : 'no_soportado';

    if (platform.id === 'windows') {
      return [
        `SO detectado: ${platform.label} (${supportLabel})`,
        'Instalacion corta:',
        '1) Descargar complemento Windows (.ps1).',
        '2) Ejecutar script en PowerShell.',
        '3) Regresar y usar Ping complemento.',
        `Host: ${hostName}`,
        `Ext: ${extensionId}`
      ].join('\n');
    }

    if (platform.id === 'macos') {
      return [
        `SO detectado: ${platform.label} (${supportLabel})`,
        'Instalacion corta:',
        '1) Descargar complemento macOS (.sh).',
        '2) Ejecutar script en Terminal.',
        '3) Regresar y usar Ping complemento.',
        `Host: ${hostName}`,
        `Ext: ${extensionId}`
      ].join('\n');
    }

    return [
      `SO detectado: ${platform.label} (${supportLabel})`,
      'Instalacion corta:',
      `1) Usa un equipo ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL}.`,
      '2) Descarga el instalador correspondiente (.sh o .ps1).',
      '3) Ejecuta el script y luego usa Ping complemento.',
      `Host: ${hostName}`,
      `Ext: ${extensionId}`
    ].join('\n');
  }

  function buildNativeHostDependencyLabel() {
    const availability = getSmtpToolAvailability();
    if (availability.enabled) {
      return 'Dependencias locales: smtp.sendMail habilitada.';
    }

    return `Dependencias locales: smtp.sendMail deshabilitada (${availability.reason})`;
  }

  function getNativeHostIndicatorState() {
    const platform = detectHostPlatform();
    const smtp = getSmtpDraftConfigFromScreen();
    const expectedHost = sanitizeNativeHostNameToken(smtp.nativeHostName || '', '');
    const checkedAt = Math.max(0, Number(nativeHostDiagnostics.checkedAt) || 0);
    const hasRecentPing = checkedAt > 0 && Date.now() - checkedAt <= NATIVE_HOST_PING_STALE_MS;
    const hasExpectedHost = Boolean(expectedHost);
    const hostMatches = hasExpectedHost
      ? nativeHostDiagnostics.hostName === expectedHost
      : Boolean(String(nativeHostDiagnostics.hostName || '').trim());
    const online = platform.supported && nativeHostDiagnostics.ok && hasRecentPing && hostMatches;

    let reason = '';
    if (!platform.supported) {
      reason = `No soportado en ${platform.label}.`;
    } else if (nativeHostPingInFlight) {
      reason = 'Verificando complemento local...';
    } else if (!hasExpectedHost) {
      reason = 'Configura Native Host Name.';
    } else if (!checkedAt) {
      reason = 'Sin ping reciente.';
    } else if (!nativeHostDiagnostics.ok) {
      reason = String(nativeHostDiagnostics.message || 'Sin conexion al complemento local.').trim();
    } else if (!hostMatches) {
      reason = `Ping registrado en otro host (${nativeHostDiagnostics.hostName || 'desconocido'}).`;
    } else if (!hasRecentPing) {
      reason = 'Ultimo ping vencido.';
    } else {
      reason = `Conectado a ${nativeHostDiagnostics.hostName || expectedHost}.`;
    }

    return {
      online,
      reason,
      checkedAt
    };
  }

  function applyNativeHostDotState(dotElement, online) {
    if (!dotElement) {
      return;
    }

    dotElement.classList.toggle('is-online', online);
    dotElement.classList.toggle('is-offline', !online);
  }

  function renderNativeHostStatusIndicators() {
    const indicator = getNativeHostIndicatorState();
    const stateLabel = indicator.online ? 'conectado' : 'desconectado';
    const stamp = indicator.checkedAt
      ? formatDateTime(indicator.checkedAt) || new Date(indicator.checkedAt).toISOString()
      : '';
    const detail = stamp ? `${indicator.reason} Ultimo ping: ${stamp}.` : indicator.reason;

    applyNativeHostDotState(nativeConnectorStatusDot, indicator.online);
    applyNativeHostDotState(settingsNativeConnectorNavDot, indicator.online);

    if (nativeConnectorStatusBtn) {
      const title = `Estado complemento local: ${stateLabel}. ${detail}`.trim();
      nativeConnectorStatusBtn.setAttribute('title', title);
      nativeConnectorStatusBtn.setAttribute('aria-label', title);
    }

    if (settingsNativeHostHeaderMeta) {
      settingsNativeHostHeaderMeta.textContent = `Estado header: ${stateLabel}. ${detail}`;
    }
  }

  function renderNativeHostBridgeSection(options = {}) {
    runWithSettingsScrollPreserved(
      () => {
        const platform = detectHostPlatform();
        const smtp = getSmtpDraftConfigFromScreen();

        if (settingsNativeHostPlatformMeta) {
          const supportText = platform.supported ? 'soportado' : 'no soportado';
          settingsNativeHostPlatformMeta.textContent = `SO detectado: ${platform.label} (${supportText}).`;
        }

        if (settingsNativeHostInstallMd) {
          settingsNativeHostInstallMd.textContent = buildNativeHostInstallMarkdown();
        }

        if (settingsNativeHostDownloadBtn) {
          settingsNativeHostDownloadBtn.disabled = !platform.supported;
          settingsNativeHostDownloadBtn.textContent =
            platform.id === 'windows'
              ? 'Descargar complemento (Windows .ps1)'
              : platform.id === 'macos'
                ? 'Descargar complemento (macOS .sh)'
                : 'Descargar complemento';
          settingsNativeHostDownloadBtn.title = platform.supported
            ? ''
            : `Complemento local descargable solo para ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL} por ahora.`;
        }

        if (settingsNativeHostPingBtn) {
          settingsNativeHostPingBtn.disabled = !platform.supported || nativeHostPingInFlight;
        }

        if (settingsNativeHostToolsDependencyMeta) {
          settingsNativeHostToolsDependencyMeta.textContent = buildNativeHostDependencyLabel();
        }

        if (!settingsNativeHostStatus) {
          return;
        }

        if (!platform.supported) {
          setStatus(
            settingsNativeHostStatus,
            `Este sistema operativo no esta soportado para Local Connector. Soporte actual: ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL}.`,
            true
          );
          return;
        }

        if (nativeHostPingInFlight) {
          setStatus(settingsNativeHostStatus, 'Verificando complemento local...', false, { loading: true });
          return;
        }

        if (!nativeHostDiagnostics.checkedAt) {
          setStatus(settingsNativeHostStatus, 'Sin ping reciente. Ejecuta Ping complemento.');
          return;
        }

        const stamp = formatDateTime(nativeHostDiagnostics.checkedAt) || new Date(nativeHostDiagnostics.checkedAt).toISOString();
        if (nativeHostDiagnostics.ok) {
          const versionPart = nativeHostDiagnostics.version ? ` v${nativeHostDiagnostics.version}` : '';
          setStatus(
            settingsNativeHostStatus,
            `Conectado con ${nativeHostDiagnostics.hostName || smtp.nativeHostName}${versionPart}. Ultimo ping: ${stamp}.`
          );
          return;
        }

        const message = String(nativeHostDiagnostics.message || 'Sin conexion al complemento local.').trim();
        setStatus(settingsNativeHostStatus, `${message} Ultimo ping: ${stamp}.`, true);
      },
      {
        enabled: options.preserveScroll !== false
      }
    );

    renderNativeHostStatusIndicators();
  }

  function openExtensionDocInNewTab(relativePath = '') {
    const safePath = String(relativePath || '').trim().replace(/^\/+/, '');
    if (!safePath) {
      return false;
    }

    const targetUrl =
      chrome?.runtime && typeof chrome.runtime.getURL === 'function' ? chrome.runtime.getURL(safePath) : safePath;
    if (!targetUrl) {
      return false;
    }

    if (chrome?.tabs && typeof chrome.tabs.create === 'function') {
      try {
        chrome.tabs.create({
          url: targetUrl,
          active: true
        });
        return true;
      } catch (_) {
        // Fallback to window.open below.
      }
    }

    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      try {
        const opened = window.open(targetUrl, '_blank', 'noopener');
        return Boolean(opened);
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  function sanitizeToolErrorArgs(value, depth = 0) {
    if (depth > 3) {
      return '[max_depth]';
    }

    if (Array.isArray(value)) {
      return value.slice(0, 24).map((item) => sanitizeToolErrorArgs(item, depth + 1));
    }

    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') {
        return value.slice(0, 220);
      }
      return value;
    }

    const redactedKeyPattern = /(password|token|secret|api[_-]?key|authorization|pin|credential)/i;
    const entries = Object.entries(value);
    const output = {};

    for (const [rawKey, rawValue] of entries.slice(0, 32)) {
      const key = String(rawKey || '').slice(0, 80);
      if (!key) {
        continue;
      }
      output[key] = redactedKeyPattern.test(key) ? '***' : sanitizeToolErrorArgs(rawValue, depth + 1);
    }

    return output;
  }

  function pruneToolErrorsLog() {
    const now = Date.now();
    const items = Array.isArray(localToolErrorLog) ? localToolErrorLog : [];
    localToolErrorLog = items
      .map((item) => {
        const entry = item && typeof item === 'object' ? item : null;
        if (!entry) {
          return null;
        }
        const createdAt = Math.max(0, Number(entry.createdAt) || 0);
        const tool = String(entry.tool || '').trim().slice(0, 120);
        const error = sanitizeSensitiveMessage(String(entry.error || '').trim()).slice(0, 260);
        const argsSummary = String(entry.argsSummary || '').trim().slice(0, 320);
        const count = Math.max(1, Number(entry.count) || 1);
        if (!tool || !error || !createdAt) {
          return null;
        }
        if (now - createdAt > TOOL_ERROR_LOG_MAX_AGE_MS) {
          return null;
        }
        return {
          createdAt,
          tool,
          error,
          argsSummary,
          count
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-MAX_TOOL_ERROR_LOG_ITEMS);
  }

  function renderToolErrorsLog() {
    if (!settingsToolErrorsLog) {
      return;
    }

    pruneToolErrorsLog();
    if (!localToolErrorLog.length) {
      settingsToolErrorsLog.textContent = 'Sin errores recientes.';
      return;
    }

    const lines = localToolErrorLog
      .slice(-MAX_TOOL_ERROR_LOG_ITEMS)
      .reverse()
      .map((entry, index) => {
        const stamp = formatDateTime(entry.createdAt) || new Date(entry.createdAt).toISOString();
        const countLabel = entry.count > 1 ? ` x${entry.count}` : '';
        const argsPart = entry.argsSummary ? ` | args: ${entry.argsSummary}` : '';
        return `${index + 1}. [${stamp}] ${entry.tool}${countLabel} -> ${entry.error}${argsPart}`;
      });
    settingsToolErrorsLog.textContent = lines.join('\n');
  }

  function appendToolExecutionErrorLog({ tool = '', args = {}, error = '' } = {}) {
    const safeTool = String(tool || '').trim().slice(0, 120);
    const safeError = sanitizeSensitiveMessage(String(error || '').trim()).slice(0, 260);
    if (!safeTool || !safeError) {
      return;
    }

    const safeArgs = sanitizeToolErrorArgs(args && typeof args === 'object' ? args : {});
    let argsSummary = '';
    try {
      argsSummary = JSON.stringify(safeArgs).slice(0, 320);
    } catch (_) {
      argsSummary = '';
    }

    pruneToolErrorsLog();
    const now = Date.now();
    const last = localToolErrorLog.length ? localToolErrorLog[localToolErrorLog.length - 1] : null;
    if (last && last.tool === safeTool && last.error === safeError && now - last.createdAt <= 15000) {
      last.count = Math.max(1, Number(last.count) || 1) + 1;
      last.createdAt = now;
      if (argsSummary) {
        last.argsSummary = argsSummary;
      }
    } else {
      localToolErrorLog.push({
        createdAt: now,
        tool: safeTool,
        error: safeError,
        argsSummary,
        count: 1
      });
    }

    pruneToolErrorsLog();
    renderToolErrorsLog();
  }

  function clearToolErrorsLog() {
    localToolErrorLog = [];
    renderToolErrorsLog();
  }

  function buildToolErrorsSystemContext(limit = 6) {
    pruneToolErrorsLog();
    const recent = localToolErrorLog.slice(-Math.max(1, Math.min(12, Number(limit) || 6)));
    if (!recent.length) {
      return 'Errores recientes de tools: sin errores.';
    }

    const lines = recent
      .slice()
      .reverse()
      .map((entry, index) => {
        const ageSec = Math.max(0, Math.round((Date.now() - entry.createdAt) / 1000));
        const ageLabel = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`;
        const countLabel = entry.count > 1 ? ` x${entry.count}` : '';
        const argsPart = entry.argsSummary ? ` | args:${entry.argsSummary.slice(0, 160)}` : '';
        return `${index + 1}. ${entry.tool}${countLabel} [${ageLabel}] -> ${entry.error}${argsPart}`;
      });
    return ['Errores recientes de tools (usa esto para evitar repetir fallos):', ...lines].join('\n');
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

  function normalizeVoiceIntentText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s./:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractHostnameToken(rawUrl = '') {
    const source = String(rawUrl || '').trim();
    if (!source) {
      return '';
    }

    try {
      return String(new URL(source).hostname || '')
        .toLowerCase()
        .replace(/^www\./, '')
        .trim();
    } catch (_) {
      const withoutScheme = source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
      const firstChunk = withoutScheme.split('/')[0] || '';
      return String(firstChunk || '')
        .toLowerCase()
        .replace(/^www\./, '')
        .trim();
    }
  }

  function isNuwweHostname(hostname = '') {
    const token = String(hostname || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .trim();
    return token === NUWWE_HOST_HINT || token.endsWith(`.${NUWWE_HOST_HINT}`);
  }

  function findPreferredNuwweTabInSnapshot() {
    const tabs = Array.isArray(tabContextSnapshot?.tabs) ? tabContextSnapshot.tabs : [];
    const activeTabId = Number(tabContextSnapshot?.activeTabId);
    const candidates = tabs.filter((tab) => {
      const hostname = extractHostnameToken(tab?.url || '');
      return Boolean(hostname) && isNuwweHostname(hostname);
    });

    if (!candidates.length) {
      return null;
    }

    const loginTab = candidates.find((tab) => /\/login(?:[/?#]|$)/i.test(String(tab?.url || '')));
    if (loginTab) {
      return loginTab;
    }

    const activeTab = candidates.find((tab) => Number(tab?.tabId) === activeTabId);
    if (activeTab) {
      return activeTab;
    }

    return candidates[0] || null;
  }

  function isLikelyOpenNuwweIntent(userQuery = '') {
    const source = String(userQuery || '').trim();
    if (!source) {
      return false;
    }

    const normalized = normalizeVoiceIntentText(source);
    if (!normalized) {
      return false;
    }

    if (/\b(no|cancela|cancelar|deten|detener)\b/.test(normalized)) {
      return false;
    }

    const tokens = normalized.split(' ').filter(Boolean);
    if (!tokens.length) {
      return false;
    }

    const hasNuwweToken = tokens.some((token) => NUWWE_DIRECT_INTENT_TOKENS.includes(token));
    if (!hasNuwweToken) {
      return false;
    }

    const asksToOpen =
      /\b(abre|abrir|open|abreme|abrime|abrelo|inicia|iniciar|lanza|lanzar|pon|poner|entra|entrar)\b/.test(normalized) ||
      /\b(ve a|ir a)\b/.test(normalized);
    if ((/[?]/.test(source) || /^(como|how|que|what|cuando|where|donde)\b/.test(normalized)) && !asksToOpen) {
      return false;
    }

    return asksToOpen || tokens.length <= 3;
  }

  function buildDirectNuwweToolCall() {
    const existingTab = findPreferredNuwweTabInSnapshot();
    const existingTabId = Number(existingTab?.tabId);

    if (Number.isFinite(existingTabId) && existingTabId >= 0) {
      return {
        tool: 'browser.navigateTab',
        args: {
          tabId: existingTabId,
          url: NUWWE_LOGIN_URL,
          active: true
        }
      };
    }

    return {
      tool: 'browser.openNewTab',
      args: {
        url: NUWWE_LOGIN_URL,
        active: true
      }
    };
  }

  function buildVoiceActionDirective(userQuery = '') {
    const normalizedQuery = normalizeVoiceIntentText(userQuery);
    const spotifyHint = /\bspotify\b/.test(normalizedQuery)
      ? 'Si el usuario menciona spotify, usa browser.openNewTab con url https://open.spotify.com/.'
      : '';
    const nuwweHint = NUWWE_DIRECT_INTENT_TOKENS.some((token) => normalizedQuery.includes(token))
      ? 'Si el usuario pide Nuwwe (nuwwe/nuwe/nue), abre https://nuwwe.com/login y reutiliza tab existente si la hay.'
      : '';
    return [
      'Modo voice activo: si el usuario pide una accion del navegador, debes ejecutar la accion en tu primer mensaje.',
      'No respondas con conversacion tipo "ya lo abri" sin ejecutar realmente una tool.',
      'Para solicitudes operativas (abrir/cerrar/enfocar/enviar), responde primero con bloque ```tool``` sin texto adicional.',
      'Cuando respondas en voice sin usar tools, se ultra directo: maximo 2 frases cortas, sin introducciones, sin relleno.',
      spotifyHint,
      nuwweHint
    ]
      .filter(Boolean)
      .join('\n');
  }

  function detectVoiceDirectToolCalls(userQuery = '') {
    const text = normalizeVoiceIntentText(userQuery);
    if (!text) {
      return [];
    }

    if (/\b(no|cancela|cancelar|deten)\b/.test(text)) {
      return [];
    }

    const tokenCount = text.split(' ').filter(Boolean).length;
    const shortCommand = tokenCount <= 3;
    const asksToOpen =
      /\b(abre|abrir|open|abreme|abrime|abrelo|inicia|iniciar|lanza|lanzar|pon|poner)\b/.test(text) ||
      /\b(ve a|ir a)\b/.test(text);

    if ((asksToOpen || shortCommand) && /\bspotify\b/.test(text)) {
      return [
        {
          tool: 'browser.openNewTab',
          args: {
            url: 'https://open.spotify.com/',
            active: true
          }
        }
      ];
    }

    if (isLikelyOpenNuwweIntent(userQuery)) {
      return [buildDirectNuwweToolCall()];
    }

    return [];
  }

  function normalizeIntentWordToken(value = '') {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^[^a-z0-9+]+|[^a-z0-9+]+$/g, '')
      .trim();
  }

  function splitIntentWords(value = '') {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  function isLikelyDirectWhatsappMessageIntent(userQuery = '') {
    const source = String(userQuery || '').trim();
    if (!source) {
      return false;
    }

    const normalized = normalizeVoiceIntentText(source);
    if (!normalized) {
      return false;
    }

    if (/[?]/.test(source) || /^(como|how|que|what|cuando|where|donde)\b/.test(normalized)) {
      return false;
    }
    if (/\b(no|cancela|cancelar|deten|detener)\b/.test(normalized)) {
      return false;
    }

    const hasSendVerb = /\b(envia|enviar|manda|mandar|escribe|escribir|send|text)\b/.test(normalized);
    const hasMessageToken = /\b(mensaje|message|whatsapp|wsp|wa)\b/.test(normalized);
    const hasRecipientToken = /\b(a|para|to)\b/.test(normalized);
    return hasRecipientToken && (hasSendVerb || hasMessageToken);
  }

  function extractWhatsappIntentRecipientSegment(userQuery = '') {
    const sourceWords = splitIntentWords(userQuery);
    if (!sourceWords.length) {
      return '';
    }

    const normalizedWords = sourceWords.map((item) => normalizeIntentWordToken(item));
    const sendOrMessageTokens = new Set([
      'envia',
      'enviar',
      'manda',
      'mandar',
      'escribe',
      'escribir',
      'send',
      'text',
      'mensaje',
      'message',
      'whatsapp',
      'wsp',
      'wa'
    ]);
    const recipientTokens = new Set(['a', 'para', 'to']);

    const firstCommandIndex = normalizedWords.findIndex((token) => sendOrMessageTokens.has(token));
    const startIndex = firstCommandIndex >= 0 ? firstCommandIndex : 0;
    let recipientIndex = -1;

    for (let index = startIndex; index < normalizedWords.length; index += 1) {
      if (!recipientTokens.has(normalizedWords[index])) {
        continue;
      }
      if (index >= normalizedWords.length - 1) {
        continue;
      }
      recipientIndex = index;
      break;
    }

    if (recipientIndex < 0) {
      return '';
    }

    return sourceWords.slice(recipientIndex + 1).join(' ').trim();
  }

  function sanitizeDirectWhatsappMessageText(value = '') {
    let text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      return '';
    }

    text = text.replace(/^[,:;\-.!?]+/g, '').trim();
    text = text.replace(/^(que|diciendo|decirle|say|that)\s+/i, '').trim();
    return text.slice(0, 1200);
  }

  function matchWhatsappAliasPrefixFromSegment(segmentText = '') {
    const sourceWords = splitIntentWords(segmentText);
    if (!sourceWords.length) {
      return null;
    }

    const normalizedSegment = normalizeWhatsappAliasToken(sourceWords.join(' '), 120);
    if (!normalizedSegment) {
      return null;
    }

    const aliasEntries = getWhatsappAliasEntries(WHATSAPP_ALIAS_MAX_ITEMS);
    let best = null;

    for (const entry of aliasEntries) {
      const variants = Array.from(
        new Set(
          [entry?.alias, entry?.label]
            .map((item) => normalizeWhatsappAliasToken(item, 64))
            .filter(Boolean)
        )
      );

      for (const variant of variants) {
        const matches = normalizedSegment === variant || normalizedSegment.startsWith(`${variant} `);
        if (!matches) {
          continue;
        }

        const variantWordCount = Math.max(1, variant.split(' ').filter(Boolean).length);
        const score = variant.length * 100 + Math.max(0, Number(entry?.useCount) || 0);
        if (!best || score > best.score) {
          best = {
            entry,
            variant,
            score,
            variantWordCount
          };
        }
      }
    }

    if (!best) {
      return null;
    }

    const remainderWords = sourceWords.slice(best.variantWordCount);
    return {
      entry: best.entry,
      remainderText: remainderWords.join(' ').trim()
    };
  }

  function splitDirectRecipientAndMessageFallback(segmentText = '') {
    const source = String(segmentText || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!source) {
      return {
        recipientQuery: '',
        messageText: ''
      };
    }

    const quotedMatch = source.match(/^["'“”]([^"'“”]{2,80})["'“”]\s*[:,]?\s*(.*)$/u);
    if (quotedMatch) {
      return {
        recipientQuery: String(quotedMatch[1] || '').trim(),
        messageText: sanitizeDirectWhatsappMessageText(quotedMatch[2] || '')
      };
    }

    const separatorIndex = source.search(/\s*[:,]\s*/);
    if (separatorIndex > 1) {
      const recipient = source.slice(0, separatorIndex).trim();
      const message = source.slice(separatorIndex).replace(/^\s*[:,]\s*/, '').trim();
      if (recipient) {
        return {
          recipientQuery: recipient,
          messageText: sanitizeDirectWhatsappMessageText(message)
        };
      }
    }

    const words = splitIntentWords(source);
    if (words.length <= 2) {
      return {
        recipientQuery: source,
        messageText: ''
      };
    }

    const messageStarterTokens = new Set([
      'que',
      'q',
      'hola',
      'hi',
      'hello',
      'buenos',
      'buenas',
      'voy',
      'te',
      'le',
      'por',
      'please',
      'pls'
    ]);
    const secondToken = normalizeIntentWordToken(words[1] || '');
    const recipientWordCount = messageStarterTokens.has(secondToken) ? 1 : 2;
    const recipientWords = words.slice(0, recipientWordCount);
    const messageWords = words.slice(recipientWordCount);
    return {
      recipientQuery: recipientWords.join(' ').trim(),
      messageText: sanitizeDirectWhatsappMessageText(messageWords.join(' '))
    };
  }

  function parseDirectWhatsappMessageIntent(userQuery = '') {
    if (!isLikelyDirectWhatsappMessageIntent(userQuery)) {
      return null;
    }

    const recipientSegment = extractWhatsappIntentRecipientSegment(userQuery);
    if (!recipientSegment) {
      return null;
    }

    const aliasMatch = matchWhatsappAliasPrefixFromSegment(recipientSegment);
    if (aliasMatch?.entry) {
      const recipientQuery = String(aliasMatch.entry.label || aliasMatch.entry.alias || '').trim();
      return {
        aliasEntry: aliasMatch.entry,
        recipientQuery,
        messageText: sanitizeDirectWhatsappMessageText(aliasMatch.remainderText || '')
      };
    }

    const fallback = splitDirectRecipientAndMessageFallback(recipientSegment);
    const recipientQuery = String(fallback.recipientQuery || '').trim().slice(0, 120);
    if (!recipientQuery) {
      return null;
    }

    const aliasEntry = resolveWhatsappAliasEntryFromText(recipientQuery);
    return {
      aliasEntry,
      recipientQuery,
      messageText: sanitizeDirectWhatsappMessageText(fallback.messageText || '')
    };
  }

  function buildDirectWhatsappMessageToolCall(intentPayload = null) {
    const intent = intentPayload && typeof intentPayload === 'object' ? intentPayload : null;
    if (!intent) {
      return null;
    }

    const aliasEntry = intent.aliasEntry && typeof intent.aliasEntry === 'object' ? intent.aliasEntry : null;
    const resolvedPhone = normalizeWhatsappPhoneForUrl(aliasEntry?.phone || '');
    const recipientQuery = String(intent.recipientQuery || aliasEntry?.label || aliasEntry?.alias || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    if (!resolvedPhone && !recipientQuery) {
      return null;
    }

    const messageText = sanitizeDirectWhatsappMessageText(intent.messageText || '');
    const baseArgs = resolvedPhone
      ? { phone: resolvedPhone }
      : {
          query: recipientQuery,
          name: recipientQuery
        };
    if (aliasEntry?.alias) {
      baseArgs.alias = aliasEntry.alias;
    }
    if (aliasEntry?.label && !baseArgs.name) {
      baseArgs.name = aliasEntry.label;
    }

    if (messageText) {
      return {
        tool: 'whatsapp.openChatAndSendMessage',
        args: {
          ...baseArgs,
          text: messageText
        }
      };
    }

    return {
      tool: 'whatsapp.openChat',
      args: baseArgs
    };
  }

  async function detectDirectToolCalls(userQuery = '', options = {}) {
    const source = options?.source === 'voice' ? 'voice' : 'text';
    if (source === 'voice') {
      const voiceCalls = detectVoiceDirectToolCalls(userQuery);
      if (voiceCalls.length) {
        return voiceCalls;
      }
    }

    if (isLikelyOpenNuwweIntent(userQuery)) {
      const nuwweCall = buildDirectNuwweToolCall();
      const existingTab = findPreferredNuwweTabInSnapshot();
      logDebug('detectDirectToolCalls:nuwwe_login', {
        source,
        tool: nuwweCall.tool,
        existingTabId: Number(existingTab?.tabId) || -1,
        targetUrl: String(nuwweCall?.args?.url || '').trim()
      });
      return [nuwweCall];
    }

    if (!isLikelyDirectWhatsappMessageIntent(userQuery)) {
      return [];
    }

    await syncWhatsappAliasesFromIndexedDb().catch(() => {});
    const intent = parseDirectWhatsappMessageIntent(userQuery);
    const toolCall = buildDirectWhatsappMessageToolCall(intent);
    if (!toolCall) {
      return [];
    }

    logDebug('detectDirectToolCalls:whatsapp_message', {
      source,
      tool: toolCall.tool,
      hasMessageText: Boolean(String(toolCall.args?.text || '').trim()),
      recipientQuery: String(toolCall.args?.query || toolCall.args?.name || '').trim(),
      hasPhone: Boolean(String(toolCall.args?.phone || '').trim())
    });
    return [toolCall];
  }

  function buildLocalToolSystemPrompt() {
    const hasCrmErpDbConnection = Boolean(getCrmErpDatabaseConnectionUrl());
    const integrations = getIntegrationsConfig();
    const smtpAvailability = getSmtpToolAvailability();
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
      '- browser.navigateTab (args: tabId opcional o urlContains/titleContains/query, url requerida, active)',
      '- browser.focusTab (args: tabId o urlContains/titleContains)',
      '- browser.closeTab (args: tabId o url/urlContains/titleContains/query, preventActive; soporta closeAll/allMatches/maxMatches para cerrar multiples por lenguaje natural, ej: "todas las de google" o "todas las de retool")',
      '- browser.closeNonProductivityTabs (args: dryRun, keepPinned, keepActive, onlyCurrentWindow)',
      '- whatsapp.getInbox (args: limit)',
      '- whatsapp.openChat (args: query|name|chat|phone|chatIndex, tabId opcional)',
      '- whatsapp.sendMessage (args: text, tabId opcional; envia al chat abierto o abre chat objetivo si incluyes query/name/chat/phone; si envias phone valida que el chat activo coincida antes de enviar)',
      '- whatsapp.openChatAndSendMessage (args: query|name|chat|phone + text)',
      '- whatsapp.archiveChats (args: scope=groups|contacts|all, queries, limit, dryRun)',
      '- whatsapp.archiveGroups (alias rapido para scope=groups)',
      '- Si no hay tab activa de WhatsApp, el sistema intentara abrir/enfocar WhatsApp Web automaticamente.',
      ...(hasCrmErpDbConnection
        ? [
            '- db.refreshSchema (sin args; inspecciona esquemas/tablas/columnas disponibles)',
            '- db.queryRead (args: sql, params opcional array, maxRows opcional; solo SELECT/CTE/SHOW/EXPLAIN)',
            '- db.queryWrite (args: sql, params opcional array, maxRows opcional; solo INSERT/UPDATE/DELETE y UPDATE/DELETE requieren WHERE)'
          ]
        : ['- db.* requiere configurar la URL de PostgreSQL en Settings > CRM/ERP Database.']),
      ...(smtpAvailability.enabled
        ? [
            '- smtp.sendMail (args: to, subject, text|html, cc opcional, bcc opcional, from opcional; envia por SMTP configurado)'
          ]
        : [`- smtp.sendMail deshabilitada temporalmente: ${smtpAvailability.reason}`]),
      ...(hasMapsApiKey
        ? [
            '- maps.getCurrentLocation (sin args; devuelve coordenadas guardadas)',
            '- maps.reverseGeocode (args: lat/lng opcional; devuelve direccion de coordenadas)',
            '- maps.getNearbyPlaces (args: type opcional, query opcional, radiusMeters opcional, maxResults opcional)',
            '- maps.searchPlaces (args: query requerido, radiusMeters opcional, maxResults opcional)',
            '- maps.getDirectionsTime (args: destination requerido, origin opcional, travelMode opcional)'
          ]
        : [
            '- maps.getCurrentLocation (sin args; devuelve coordenadas guardadas)',
            '- maps.reverseGeocode/maps.getNearbyPlaces/maps.searchPlaces/maps.getDirectionsTime requieren Maps API Key en Settings.'
          ]),
      ...(hasCustomTools
        ? ['- integration.call (args: name requerido, input objeto opcional)']
        : ['- integration.call requiere registrar Custom Tools Schema en Settings > Apps & Integrations.']),
      'Para preguntas de tiempo (hoy, ayer, semana pasada, viernes por la tarde, visita mas antigua), usa primero tools de historial.',
      'Si el usuario pide cerrar/focar una tab y hay duda de coincidencia, usa browser.listTabs y luego ejecuta browser.closeTab/browser.focusTab con criterios precisos.',
      'Si el usuario pide acciones en WhatsApp, usa whatsapp.* y prioriza dryRun cuando la accion sea masiva.',
      'Si el usuario pide abrir Nuwwe (nuwwe/nuwe/nue), abre https://nuwwe.com/login y reutiliza una tab existente de nuwwe cuando sea posible.',
      'Si el usuario pide "enviar/mandar mensaje a <persona>", interpreta "mensaje" como WhatsApp por defecto.',
      'Si el usuario usa alias de contacto en WhatsApp, usa query/name/chat normalmente; el sistema puede resolver alias guardados a phone.',
      'Tambien puedes resolver contactos por nombres almacenados en el indice local de chats WhatsApp (IndexedDB) para obtener su phone.',
      'Para preguntas de CRM/ERP, usa db.refreshSchema si falta contexto y luego db.queryRead/db.queryWrite segun corresponda.',
      'smtp.sendMail usa bridge interno en background y transporte SMTP configurable (http_agent o native_host).',
      `Estado actual smtp.sendMail: ${smtpAvailability.enabled ? 'habilitada' : `deshabilitada (${smtpAvailability.reason})`}.`,
      'Para "donde estamos", usa maps.getCurrentLocation y maps.reverseGeocode cuando haya API key.',
      'Para consultas cercanas por rubro o texto (ej. "inmobiliarias cerca"), usa maps.searchPlaces con args.query.',
      'Antes de repetir una tool que ya fallo, revisa el bloque de errores recientes y corrige args/configuracion.',
      'En db.queryRead agrega LIMIT razonable (<= 100) para evitar respuestas gigantes.',
      'No inventes tools fuera de esta lista.',
      buildActiveTabsSystemContext(),
      buildRecentHistorySystemContext(),
      buildWhatsappToolsSystemContext(),
      buildCrmErpDatabaseToolsContext(),
      buildLocationToolsSystemContext(),
      buildToolErrorsSystemContext(),
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

  function downloadNativeHostInstaller() {
    const platform = detectHostPlatform();
    if (!platform.supported) {
      throw new Error(`Complemento local descargable solo para ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL} por ahora.`);
    }

    const draftSmtp = getSmtpDraftConfigFromScreen();
    const hostName = sanitizeNativeHostNameToken(draftSmtp.nativeHostName || 'com.greene.smtp_bridge');
    const extensionId = String(chrome?.runtime?.id || '').trim();

    if (platform.id === 'windows') {
      const script = buildWindowsNativeHostInstallerScript({
        extensionId,
        hostName
      });
      const filename = 'greene-native-host-windows.ps1';
      triggerTextFileDownload(filename, script, 'text/x-powershell');
      return {
        filename,
        platformLabel: platform.label
      };
    }

    const script = buildMacNativeHostInstallerScript({
      extensionId,
      hostName
    });
    const filename = 'greene-native-host-macos.sh';
    triggerTextFileDownload(filename, script, 'application/x-sh');
    return {
      filename,
      platformLabel: platform.label
    };
  }

  async function sendNativeHostPingWithBackground(hostName = '') {
    if (!chrome?.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      throw new Error('Bridge native host no disponible: runtime de extension no accesible.');
    }

    const safeHostName = sanitizeNativeHostNameToken(hostName, '');
    if (!safeHostName) {
      throw new Error('Native Host Name invalido.');
    }

    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: BACKGROUND_NATIVE_HOST_PING_TYPE,
            payload: {
              nativeHostName: safeHostName
            }
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || 'Error comunicando ping de Native Host.'));
              return;
            }

            const safeResponse = response && typeof response === 'object' ? response : null;
            if (!safeResponse || safeResponse.ok !== true) {
              const errorMessage = String(safeResponse?.error || 'Ping de Native Host sin respuesta valida.').trim();
              reject(new Error(errorMessage));
              return;
            }

            resolve(safeResponse.result && typeof safeResponse.result === 'object' ? safeResponse.result : {});
          }
        );
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Error ejecutando ping de Native Host.'));
      }
    });
  }

  async function pingNativeHostBridge(options = {}) {
    const silent = options.silent === true;
    const platform = detectHostPlatform();
    if (!platform.supported) {
      nativeHostDiagnostics = {
        ok: false,
        hostName: '',
        checkedAt: Date.now(),
        message: `native_host no soportado en este sistema operativo. Soporte actual: ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL}.`,
        version: '',
        capabilities: []
      };
      renderNativeHostBridgeSection();
      if (!silent) {
        setStatus(settingsIntegrationsStatus, nativeHostDiagnostics.message, true);
      }
      return false;
    }

    const draftSmtp = getSmtpDraftConfigFromScreen();
    const hostName = sanitizeNativeHostNameToken(options.hostName || draftSmtp.nativeHostName || '', '');
    if (!hostName) {
      const message = 'Configura Native Host Name antes de ejecutar Ping complemento.';
      nativeHostDiagnostics = {
        ok: false,
        hostName: '',
        checkedAt: Date.now(),
        message,
        version: '',
        capabilities: []
      };
      renderNativeHostBridgeSection();
      if (!silent) {
        setStatus(settingsIntegrationsStatus, message, true);
      }
      return false;
    }

    if (nativeHostPingInFlight) {
      return nativeHostDiagnostics.ok;
    }

    nativeHostPingInFlight = true;
    renderNativeHostBridgeSection();
    try {
      const result = await sendNativeHostPingWithBackground(hostName);
      nativeHostDiagnostics = {
        ok: true,
        hostName,
        checkedAt: Date.now(),
        message: '',
        version: String(result.version || '').trim().slice(0, 60),
        capabilities: Array.isArray(result.capabilities)
          ? result.capabilities.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
          : []
      };
      renderNativeHostBridgeSection();
      if (!silent) {
        const versionLabel = nativeHostDiagnostics.version ? ` v${nativeHostDiagnostics.version}` : '';
        setStatus(settingsIntegrationsStatus, `Complemento local conectado (${hostName}${versionLabel}).`);
      }
      return true;
    } catch (error) {
      const message = sanitizeSensitiveMessage(error instanceof Error ? error.message : 'Ping de Native Host fallo.');
      nativeHostDiagnostics = {
        ok: false,
        hostName,
        checkedAt: Date.now(),
        message,
        version: '',
        capabilities: []
      };
      renderNativeHostBridgeSection();
      if (!silent) {
        setStatus(settingsIntegrationsStatus, `Ping complemento fallo: ${message}`, true);
      }
      return false;
    } finally {
      nativeHostPingInFlight = false;
      renderNativeHostBridgeSection();
    }
  }

  function buildSmtpBridgeRequestSummary(payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const smtp = safePayload.smtp && typeof safePayload.smtp === 'object' ? safePayload.smtp : {};
    const mail = safePayload.mail && typeof safePayload.mail === 'object' ? safePayload.mail : {};

    return {
      transport: ['http_agent', 'native_host'].includes(String(smtp.transport || '').trim())
        ? String(smtp.transport || '').trim()
        : 'http_agent',
      nativeHostName: String(smtp.nativeHostName || '').trim().slice(0, 160),
      agentUrl: String(smtp.agentUrl || '').trim().slice(0, 220),
      host: String(smtp.host || '').trim().slice(0, 120),
      port: Math.max(1, Number(smtp.port) || 0),
      secure: String(smtp.secure || '').trim().slice(0, 12),
      from: String(smtp.from || '').trim().slice(0, 120),
      toCount: Array.isArray(mail.to) ? mail.to.length : 0,
      ccCount: Array.isArray(mail.cc) ? mail.cc.length : 0,
      bccCount: Array.isArray(mail.bcc) ? mail.bcc.length : 0,
      subject: String(mail.subject || '').trim().slice(0, 140),
      hasText: Boolean(String(mail.text || '').trim()),
      hasHtml: Boolean(String(mail.html || '').trim())
    };
  }

  async function sendSmtpWithBackgroundBridge(payload = {}) {
    if (!chrome?.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      throw new Error('Bridge SMTP no disponible: runtime de extension no accesible.');
    }

    const requestSummary = buildSmtpBridgeRequestSummary(payload);
    logDebug('smtp_bridge:send', {
      request: requestSummary
    });

    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: BACKGROUND_SMTP_SEND_TYPE,
            payload: payload && typeof payload === 'object' ? payload : {}
          },
          (response) => {
            if (chrome.runtime.lastError) {
              const runtimeMessage = String(chrome.runtime.lastError.message || 'Error comunicando con background SMTP bridge.').trim();
              logWarn('smtp_bridge:runtime_error', {
                request: requestSummary,
                error: runtimeMessage
              });
              reject(new Error(runtimeMessage));
              return;
            }

            const safeResponse = response && typeof response === 'object' ? response : null;
            if (!safeResponse || safeResponse.ok !== true) {
              const errorMessage = String(safeResponse?.error || 'Error ejecutando SMTP bridge en background.').trim();
              logWarn('smtp_bridge:response_error', {
                request: requestSummary,
                error: errorMessage
              });
              reject(new Error(errorMessage));
              return;
            }

            logDebug('smtp_bridge:response_ok', {
              request: requestSummary
            });
            resolve(safeResponse.result || { ok: true });
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error ejecutando SMTP bridge en background.';
        logWarn('smtp_bridge:send_exception', {
          request: requestSummary,
          error: message
        });
        reject(error instanceof Error ? error : new Error('Error ejecutando SMTP bridge en background.'));
      }
    });
  }

  async function sendMailViaConfiguredSmtp(args = {}) {
    const integrations = getIntegrationsConfig();
    const smtp = integrations.smtp || {};
    const to = normalizeEmailList(args.to, 20);
    const cc = normalizeEmailList(args.cc, 10);
    const bcc = normalizeEmailList(args.bcc, 10);
    const subject = String(args.subject || '').trim().slice(0, 220);
    const text = String(args.text || '').trim().slice(0, 4000);
    const html = String(args.html || '').trim().slice(0, 12000);
    const body = (text || htmlToPlainText(html)).slice(0, 2500);
    const from = String(args.from || smtp.from || '').trim().slice(0, 220);
    const transport = ['http_agent', 'native_host'].includes(String(smtp.transport || '').trim())
      ? String(smtp.transport || '').trim()
      : 'http_agent';
    const nativeHostName = String(smtp.nativeHostName || '').trim().slice(0, 180);
    const agentUrl = String(smtp.agentUrl || '').trim().slice(0, 500);
    const host = String(smtp.host || '').trim();
    const username = String(smtp.username || '').trim();
    const password = String(smtp.password || '').trim();
    const port = Math.max(1, Math.min(65535, Number(smtp.port) || 587));
    const configuredSecure = ['auto', 'true', 'false'].includes(String(smtp.secure || ''))
      ? String(smtp.secure || 'auto')
      : 'auto';
    const shouldForceStartTlsForGmail = /gmail\.com/i.test(host) && port === 587 && configuredSecure === 'true';
    const secure = shouldForceStartTlsForGmail ? 'auto' : configuredSecure;

    if (!to.length) {
      throw new Error('smtp.sendMail requiere args.to.');
    }
    if (!subject) {
      throw new Error('smtp.sendMail requiere args.subject.');
    }
    if (!body) {
      throw new Error('smtp.sendMail requiere args.text o args.html.');
    }
    if (!host || !username || !password) {
      throw new Error('Configura SMTP host, username y password en Settings > Apps & Integrations.');
    }

    if (transport === 'http_agent' && !agentUrl) {
      throw new Error('Configura SMTP Agent URL en Settings > Apps & Integrations.');
    }

    if (transport === 'native_host' && !nativeHostName) {
      throw new Error('Configura Native Host Name en Settings > Apps & Integrations.');
    }
    if (transport === 'native_host') {
      const platform = detectHostPlatform();
      if (!platform.supported) {
        throw new Error(`native_host no soportado en ${platform.label}. Soporte actual: ${NATIVE_HOST_SUPPORTED_PLATFORMS_LABEL}.`);
      }
    }

    if (shouldForceStartTlsForGmail) {
      logWarn('smtp_bridge:config_warning', {
        warning: 'Ajuste automatico aplicado: Gmail puerto 587 usa STARTTLS (secure=auto) en lugar de SSL implicito.',
        host,
        port,
        configuredSecure,
        appliedSecure: secure
      });
    }

    try {
      return await sendSmtpWithBackgroundBridge({
        smtp: {
          transport,
          nativeHostName,
          agentUrl,
          host,
          port,
          secure,
          username,
          password,
          from
        },
        mail: {
          to,
          cc,
          bcc,
          subject,
          text: text || body,
          html
        }
      });
    } catch (error) {
      const safeMessage = sanitizeSensitiveMessage(error instanceof Error ? error.message : 'Error de envio SMTP.');
      const routeMeta =
        transport === 'native_host'
          ? `transport=native_host, nativeHostName=${nativeHostName || '[vacio]'}`
          : `transport=http_agent, agentUrl=${agentUrl || '[vacio]'}`;
      throw new Error(`${safeMessage} (${routeMeta})`);
    }
  }

  function resolveLocationFromArgs(rawArgs = {}) {
    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const lat = Number(args.latitude ?? args.lat);
    const lng = Number(args.longitude ?? args.lng ?? args.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const accuracy = Math.max(0, Number(args.accuracy) || 0);
      const capturedAt = Math.max(0, Number(args.capturedAt) || 0);
      return {
        latitude: lat,
        longitude: lng,
        accuracy,
        capturedAt
      };
    }

    const stored = getIntegrationsConfig().maps?.lastKnownLocation;
    if (stored && Number.isFinite(Number(stored.latitude)) && Number.isFinite(Number(stored.longitude))) {
      return {
        latitude: Number(stored.latitude),
        longitude: Number(stored.longitude),
        accuracy: Math.max(0, Number(stored.accuracy) || 0),
        capturedAt: Math.max(0, Number(stored.capturedAt) || 0)
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
    const browserActionsThatMutateTabs = new Set([
      'openNewTab',
      'navigateTab',
      'focusTab',
      'closeTab',
      'closeNonProductivityTabs'
    ]);
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
          if (response?.ok === true && browserActionsThatMutateTabs.has(browserAction)) {
            await tabContextService.requestSnapshot();
          }
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

          const smtpAvailability = getSmtpToolAvailability();
          if (!smtpAvailability.enabled) {
            results.push({
              tool,
              ok: false,
              error: `smtp.sendMail deshabilitada: ${smtpAvailability.reason}`
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
              const locationResult = {
                ...location,
                mapsUrl: buildMapsUrlForCoordinates(location)
              };
              const hasMapsApiKey = Boolean(String(getIntegrationsConfig().maps?.apiKey || '').trim());
              if (hasMapsApiKey) {
                try {
                  const geocode = await reverseGeocodeLocation(location);
                  if (geocode?.address) {
                    locationResult.address = geocode.address;
                  }
                  if (geocode?.placeId) {
                    locationResult.placeId = geocode.placeId;
                  }
                } catch (_) {
                  // Keep location tool resilient even if geocoding fails.
                }
              }

              await persistMapsLocationSnapshot(location, getIntegrationsConfig().maps?.nearbyPlaces || []);
              results.push({
                tool,
                ok: true,
                result: locationResult
              });
            }
            continue;
          }

          if (mapsAction === 'reverseGeocode') {
            const geocode = await reverseGeocodeLocation(args);
            await persistMapsLocationSnapshot(geocode.location, getIntegrationsConfig().maps?.nearbyPlaces || []);
            results.push({
              tool,
              ok: true,
              result: geocode
            });
            continue;
          }

          if (mapsAction === 'getNearbyPlaces' || mapsAction === 'searchPlaces') {
            const location = resolveLocationFromArgs(args);
            if (!location) {
              results.push({
                tool,
                ok: false,
                error: 'No hay ubicacion disponible para buscar lugares.'
              });
              continue;
            }

            const query = String(args.query || args.text || '').trim().slice(0, 180);
            if (mapsAction === 'searchPlaces' && !query) {
              results.push({
                tool,
                ok: false,
                error: 'maps.searchPlaces requiere args.query.'
              });
              continue;
            }

            const places = query
              ? await searchPlacesByTextForLocation(location, {
                  query,
                  radiusMeters: args.radiusMeters,
                  maxResultCount: args.maxResults || args.limit,
                  languageCode: args.languageCode || args.language
                })
              : await fetchNearbyPlacesForLocation(location, {
                  nearbyType: args.type || args.nearbyType,
                  radiusMeters: args.radiusMeters,
                  maxResultCount: args.maxResults || args.limit
                });
            await persistMapsLocationSnapshot(location, places);
            const defaultNearbyType = getIntegrationsConfig().maps?.nearbyType || 'restaurant';
            const requestedType = String(args.type || args.nearbyType || defaultNearbyType).trim();
            const normalizedType = normalizeNearbyPlaceType(requestedType, defaultNearbyType);

            results.push({
              tool,
              ok: true,
              result: {
                location,
                mode: query ? 'text_search' : 'nearby_type',
                query,
                requestedType,
                normalizedType,
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
        const aliasEntry = getWhatsappAliasEntryFromArgs(args);
        const explicitPhoneTarget = getWhatsappToolTargetExplicitPhone(args);
        const phoneTarget = explicitPhoneTarget || aliasEntry?.phone || getWhatsappToolTargetPhone(args);
        const hasLookupArgs = hasWhatsappChatLookupArgs(args);
        const routeSendThroughOpen = whatsappAction === 'sendMessage' && hasLookupArgs;
        const requestedWhatsappAction = routeSendThroughOpen ? 'openChatAndSendMessage' : whatsappAction;
        const needsPhoneRoute = Boolean(phoneTarget) && (
          whatsappAction === 'openChat' ||
          requestedWhatsappAction === 'openChatAndSendMessage'
        );
        const ensuredWhatsapp = await ensureWhatsappTabForTool(args, {
          preferPhoneRoute: needsPhoneRoute
        });
        if (!ensuredWhatsapp?.ok || !ensuredWhatsapp.tab || !isWhatsappContext(ensuredWhatsapp.tab)) {
          results.push({
            tool,
            ok: false,
            error: String(ensuredWhatsapp?.error || 'No hay tab de WhatsApp disponible para ejecutar la tool.').trim(),
            result: ensuredWhatsapp?.diagnostics && typeof ensuredWhatsapp.diagnostics === 'object' ? ensuredWhatsapp.diagnostics : {}
          });
          continue;
        }
        const targetTab = ensuredWhatsapp.tab;

        const siteArgs = {
          ...args
        };
        delete siteArgs.tabId;
        if (!explicitPhoneTarget && phoneTarget) {
          siteArgs.phone = phoneTarget;
        }
        if (!siteArgs.alias && aliasEntry?.alias) {
          siteArgs.alias = aliasEntry.alias;
        }
        if (!siteArgs.text && typeof siteArgs.message === 'string') {
          siteArgs.text = siteArgs.message;
        }

        if (whatsappAction === 'openChat' && ensuredWhatsapp.openedViaUrl && ensuredWhatsapp.phone) {
          results.push({
            tool,
            ok: true,
            result: {
              opened: true,
              confirmed: false,
              via: 'url',
              phone: ensuredWhatsapp.phone,
              url: ensuredWhatsapp.openedUrl,
              tabId: Number(targetTab.tabId) || -1,
              requestedAction: whatsappAction,
              executedAction: 'urlOpen'
            }
          });
          await tabContextService.requestSnapshot();
          continue;
        }

        let executedWhatsappAction = requestedWhatsappAction;
        if (executedWhatsappAction === 'openChatAndSendMessage' && ensuredWhatsapp.openedViaUrl && ensuredWhatsapp.phone) {
          executedWhatsappAction = 'sendMessage';
        }

        logDebug('executeLocalToolCalls:invoke', {
          tool,
          whatsappAction,
          requestedWhatsappAction,
          executedWhatsappAction,
          tabId: Number(targetTab.tabId) || -1,
          args: siteArgs,
          openedViaUrl: ensuredWhatsapp.openedViaUrl === true,
          openedUrl: ensuredWhatsapp.openedUrl || ''
        });

        const response = await runWhatsappSiteActionWithRetries(
          Number(targetTab.tabId) || -1,
          executedWhatsappAction,
          siteArgs,
          {
            openedViaUrl: ensuredWhatsapp.openedViaUrl === true,
            expectedPhone: phoneTarget || ensuredWhatsapp.phone || '',
            maxAttempts: ensuredWhatsapp.openedViaUrl === true ? 4 : 3
          }
        );

        const responseResult = response?.result && typeof response.result === 'object' ? response.result : {};
        const failureMessage = buildWhatsappToolErrorText(
          `No se pudo ejecutar whatsapp.${executedWhatsappAction}.`,
          response
        );
        results.push({
          tool,
          ok: response?.ok === true,
          result: {
            ...responseResult,
            tabId: Number(targetTab.tabId) || -1,
            requestedAction: whatsappAction,
            executedAction: executedWhatsappAction,
            openedViaUrl: ensuredWhatsapp.openedViaUrl === true,
            openedUrl: ensuredWhatsapp.openedUrl || '',
            resolvedAlias: aliasEntry?.alias || '',
            resolvedPhone: phoneTarget || ''
          },
          error: response?.ok === true ? '' : failureMessage
        });
        logDebug('executeLocalToolCalls:result', {
          tool,
          response
        });

        if (response?.ok === true) {
          const resolvedPhoneFromResult = getWhatsappPhoneFromToolResult(
            responseResult,
            phoneTarget || ensuredWhatsapp.phone || ''
          );
          const aliasCandidate = aliasEntry || getPrimaryWhatsappAliasCandidateFromArgs(args);
          if (aliasCandidate?.alias && resolvedPhoneFromResult) {
            await upsertWhatsappAliasEntries(
              [
                {
                  alias: aliasCandidate.alias,
                  label: aliasCandidate.label || aliasCandidate.alias,
                  phone: resolvedPhoneFromResult,
                  source: 'tool_success'
                }
              ],
              { persist: false }
            );
            await markWhatsappAliasUsageByEntry(
              {
                alias: aliasCandidate.alias,
                label: aliasCandidate.label || aliasCandidate.alias,
                phone: resolvedPhoneFromResult
              },
              { source: 'tool_success' }
            );
          }
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

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index] && typeof results[index] === 'object' ? results[index] : null;
      if (!result || result.ok === true) {
        continue;
      }

      const sourceCall = calls[index] && typeof calls[index] === 'object' ? calls[index] : {};
      appendToolExecutionErrorLog({
        tool: String(result.tool || sourceCall.tool || '').trim(),
        args: sourceCall.args && typeof sourceCall.args === 'object' ? sourceCall.args : {},
        error: String(result.error || 'Error ejecutando tool local.').trim()
      });
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

  async function buildChatConversation(userQuery, options = {}) {
    const systemPrompt =
      selectedChatTool === 'chat'
        ? getActiveChatSystemPrompt()
        : selectedChatTool === 'write_email'
          ? getWriteEmailSystemPrompt()
          : CHAT_TOOLS[selectedChatTool].systemPrompt;
    const source = options?.source === 'voice' ? 'voice' : 'text';
    let dynamicSystemPrompt = systemPrompt;
    let contextUsed = [];
    const localToolPrompt = selectedChatTool === 'chat' ? buildLocalToolSystemPrompt() : '';
    const voiceActionDirective =
      selectedChatTool === 'chat' && source === 'voice' ? buildVoiceActionDirective(userQuery) : '';
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

      dynamicSystemPrompt = [contextHeader, relationContextPrompt, localToolPrompt, voiceActionDirective, historyToolDirective, systemPrompt]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    } catch (_) {
      dynamicSystemPrompt = [relationContextPrompt, localToolPrompt, voiceActionDirective, historyToolDirective, systemPrompt]
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
    if (selectedChatTool === 'chat' && options.refreshTabSnapshot !== false) {
      try {
        await tabContextService.requestSnapshot();
      } catch (_) {
        // Keep chat flow resilient if snapshot refresh fails.
      }
    }

    const temperature = Number(settings[PREFERENCE_KEYS.AI_TEMPERATURE] ?? DEFAULT_SETTINGS[PREFERENCE_KEYS.AI_TEMPERATURE]);
    const safeTemp = Number.isFinite(temperature) ? temperature : DEFAULT_SETTINGS[PREFERENCE_KEYS.AI_TEMPERATURE];
    const source = options?.source === 'voice' ? 'voice' : 'text';
    const conversation = await buildChatConversation(userQuery, { source });
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
    const activeProfile = resolveChatProfileForSource(source);

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
      onChunk: handleChunk,
      signal: options.signal || null
    });

    return {
      output,
      contextUsed
    };
  }

  async function sendChatMessage(options = {}) {
    const allowInterrupt = options?.allowInterrupt === true;
    const awaitVoicePlayback = options?.awaitVoicePlayback === true;
    const source = options?.source === 'voice' ? 'voice' : 'text';
    const content = chatInput.value.trim();
    const attachmentsForTurn = pendingConversationAttachments.slice(0, MAX_CHAT_ATTACHMENTS_PER_TURN);
    if (!content && !attachmentsForTurn.length) {
      return;
    }

    if (isGeneratingChat) {
      if (!allowInterrupt) {
        return;
      }

      const interrupted = await interruptActiveChatTurn({
        reason: `${source}_new_message`
      });
      if (!interrupted) {
        setStatus(chatStatus, 'No se pudo interrumpir la respuesta activa.', true);
        return;
      }
    }

    if (source === 'text' && voiceSessionActive) {
      setVoiceSessionActive(false, {
        reason: 'text_message'
      });
      releaseVoiceSessionResources({
        preserveMode: voiceCaptureState.mode === 'transcribing'
      });
    }

    closeToolMenu();
    stopAssistantSpeechPlayback();
    isGeneratingChat = true;
    renderChatSendButtonState();
    chatResetBtn.disabled = true;
    const generationAbortController = new AbortController();
    activeChatAbortController = generationAbortController;
    let assistantMessage = null;

    try {
      const activeProfile = resolveChatProfileForSource(source);
      const activeModel = activeProfile ? `${activeProfile.name} · ${activeProfile.model}` : getActiveModel();
      const attachmentsPromptBlock = buildAttachmentsPromptBlock(attachmentsForTurn);
      const contentForModel = [content, attachmentsPromptBlock].filter(Boolean).join('\n\n').trim() || content;
      const memoryProfileMaxItems = Math.max(
        120,
        Math.min(
          MEMORY_USER_PROFILE_MAX_ITEMS_STORAGE_LIMIT,
          Number(
            getSystemVariableNumber('memory.userProfileMaxItems', MEMORY_USER_PROFILE_MAX_ITEMS)
          ) || MEMORY_USER_PROFILE_MAX_ITEMS
        )
      );
      const memoryProfileContext = {
        activeTab: getActiveTabContext(),
        historyEntries: Array.isArray(tabContextSnapshot?.history) ? tabContextSnapshot.history.slice(0, 80) : []
      };
      if (content) {
        try {
          await ingestWhatsappAliasesFromUserText(content);
        } catch (_) {
          // Keep chat flow resilient if alias extraction fails.
        }
      }
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
      syncChatBottomReserve({
        streaming: true
      });
      renderChatMessages({
        allowAutoScroll: false
      });
      scrollChatToBottom();
      cancelChatBottomAlign();

      if (selectedChatTool === 'create_image') {
        setStatus(chatStatus, 'Generando imagen...', false, { loading: true });

        const imageResult = await generateImageWithActiveModel(contentForModel || content, {
          statusTarget: chatStatus,
          size: '1024x1024'
        });
        const imageUrl = String(imageResult?.imageUrl || '').trim();
        const imageDataUrl = normalizeGeneratedImageDataUrl(imageResult?.imageDataUrl || '');
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
            alt: content || 'Imagen generada',
            width: 1024,
            height: 1024
          }
        ];
        assistantMessage.content = revisedPrompt
          ? `Imagen generada.\n\nPrompt aplicado: ${revisedPrompt}`
          : 'Imagen generada.';

        const contextUsed = [];
        const turnMemory = await contextMemoryService.rememberChatTurn({
          userMessage: contentForModel || content || '[Adjuntos]',
          assistantMessage: assistantMessage.content,
          contextUsed,
          profileContext: memoryProfileContext,
          memoryLimits: {
            maxProfileItems: memoryProfileMaxItems
          }
        });
        assistantMessage.extracted_facts = Array.isArray(turnMemory?.extracted_facts) ? turnMemory.extracted_facts : [];
        if (userMessage && Array.isArray(userMessage.extracted_facts) && assistantMessage.extracted_facts.length) {
          userMessage.extracted_facts = assistantMessage.extracted_facts;
        }

        syncChatBottomReserve({
          streaming: false
        });
        renderChatMessages();
        scrollChatToBottom();
        await saveChatHistory();
        const imageProfile = imageResult?.profile && typeof imageResult.profile === 'object' ? imageResult.profile : null;
        const imageModel = imageProfile ? `${imageProfile.name} · ${imageProfile.model}` : 'modelo de imagen';
        setStatus(chatStatus, `Imagen generada con ${imageModel}.`);
        if (source === 'voice') {
          const playbackTask = speakAssistantReply({
            message: assistantMessage,
            awaitEnd: awaitVoicePlayback
          }).catch((error) => {
            const message = error instanceof Error ? error.message : 'No se pudo reproducir respuesta en voz.';
            setStatus(chatStatus, message, true);
            return false;
          });
          if (awaitVoicePlayback) {
            await playbackTask;
          }
        }
        setBrandEmotion('excited');
        return;
      }

      const shouldSyncVoiceText = source === 'voice';
      let streamedAssistantText = '';
      const streamPayload = await streamChatResponse(
        contentForModel || content,
        (chunk) => {
          if (!assistantMessage || !chunk) {
            return;
          }

          streamedAssistantText += chunk;
          if (shouldSyncVoiceText) {
            assistantMessage.pending = true;
            setStatus(chatStatus, 'Preparando respuesta de voz...', false, { loading: true });
            return;
          }

          assistantMessage.pending = false;
          assistantMessage.content += chunk;
          setStatus(chatStatus, 'Escribiendo respuesta...', false, { loading: true });
          scheduleChatRender({
            allowAutoScroll: false
          });
        },
        {
          source,
          signal: generationAbortController.signal
        }
      );

      const output = String(streamPayload?.output || '').trim();
      const contextUsed = Array.isArray(streamPayload?.contextUsed)
        ? streamPayload.contextUsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
        : [];
      const detectedToolCalls =
        selectedChatTool === 'chat'
          ? extractToolCallsFromText(output, {
              maxCalls: getSystemVariableNumber('chat.maxLocalToolCalls', MAX_LOCAL_TOOL_CALLS),
              onDebug: logDebug,
              onWarn: logWarn
            })
          : [];
      const fallbackDirectToolCalls =
        selectedChatTool === 'chat' && detectedToolCalls.length === 0
          ? await detectDirectToolCalls(contentForModel || content, { source })
          : [];
      const toolCallsToExecute = detectedToolCalls.length ? detectedToolCalls : fallbackDirectToolCalls;
      let finalAssistantOutput = shouldSyncVoiceText ? streamedAssistantText.trim() || output : output;

      logDebug('sendChatMessage:model_output', {
        tool: selectedChatTool,
        outputPreview: output.slice(0, 600),
        outputLength: output.length,
        detectedToolCalls,
        fallbackDirectToolCalls,
        toolCallsToExecute
      });

      assistantMessage.context_used = contextUsed;
      if (userMessage && Array.isArray(userMessage.context_used)) {
        userMessage.context_used = contextUsed;
      }

      if (toolCallsToExecute.length) {
        const usedDirectFallback = detectedToolCalls.length === 0 && fallbackDirectToolCalls.length > 0;
        setStatus(
          chatStatus,
          usedDirectFallback ? 'Ejecutando accion directa...' : 'Ejecutando acciones locales del navegador...',
          false,
          { loading: true }
        );
        assistantMessage.pending = true;
        assistantMessage.content = usedDirectFallback ? 'Ejecutando accion directa...' : 'Ejecutando tools locales...';
        scheduleChatRender({
          allowAutoScroll: false
        });

        const toolResults = await executeLocalToolCalls(toolCallsToExecute);
        const followupPrompt = buildToolResultsFollowupPrompt(toolResults);

        logDebug('sendChatMessage:tool_results', {
          toolResults
        });

        assistantMessage.content = '';
        assistantMessage.pending = true;
        scheduleChatRender({
          allowAutoScroll: false
        });

        streamedAssistantText = '';
        const finalStream = await streamChatResponse(
          contentForModel || content,
          (chunk) => {
            if (!assistantMessage || !chunk) {
              return;
            }

            streamedAssistantText += chunk;
            if (shouldSyncVoiceText) {
              assistantMessage.pending = true;
              setStatus(chatStatus, 'Preparando respuesta final de voz...', false, { loading: true });
              return;
            }

            assistantMessage.pending = false;
            assistantMessage.content += chunk;
            setStatus(chatStatus, 'Generando respuesta final...', false, { loading: true });
            scheduleChatRender({
              allowAutoScroll: false
            });
          },
          {
            additionalMessages: [
              { role: 'assistant', content: output },
              { role: 'user', content: followupPrompt }
            ],
            refreshTabSnapshot: false,
            source,
            signal: generationAbortController.signal
          }
        );

        const fallbackFromTools = [
          '### Resultado de acciones locales',
          '',
          '```json',
          JSON.stringify(toolResults, null, 2),
          '```'
        ].join('\n');

        const finalStreamOutput = String(finalStream?.output || '').trim();
        finalAssistantOutput =
          (shouldSyncVoiceText ? streamedAssistantText.trim() : '') || finalStreamOutput || fallbackFromTools;
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

      if (source === 'voice') {
        assistantMessage.voiceRevealState = 'waiting';
        assistantMessage.audioSyncVisibleChars = 0;
      } else {
        delete assistantMessage.voiceRevealState;
        delete assistantMessage.audioSyncVisibleChars;
      }

      const turnMemory = await contextMemoryService.rememberChatTurn({
        userMessage: contentForModel || content || '[Adjuntos]',
        assistantMessage: assistantMessage.content,
        contextUsed,
        profileContext: memoryProfileContext,
        memoryLimits: {
          maxProfileItems: memoryProfileMaxItems
        }
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

      syncChatBottomReserve({
        streaming: false
      });
      renderChatMessages({
        allowAutoScroll: false
      });
      await saveChatHistory();
      setStatus(chatStatus, `Respuesta generada con ${activeModel}.`);
      if (source === 'voice') {
        const playbackTask = speakAssistantReply({
          message: assistantMessage,
          awaitEnd: awaitVoicePlayback
        }).catch((error) => {
          const message = error instanceof Error ? error.message : 'No se pudo reproducir respuesta en voz.';
          setStatus(chatStatus, message, true);
          if (assistantMessage) {
            delete assistantMessage.voiceRevealState;
            delete assistantMessage.audioSyncVisibleChars;
            scheduleChatRender({
              allowAutoScroll: false
            });
          }
          return false;
        });
        if (awaitVoicePlayback) {
          await playbackTask;
        }
      }
    } catch (error) {
      const aborted = isAbortLikeError(error);
      syncChatBottomReserve({
        streaming: false
      });

      if (aborted && assistantMessage) {
        chatHistory = chatHistory.filter((msg) => msg.id !== assistantMessage.id);
        renderChatMessages({
          allowAutoScroll: false
        });
      } else if (assistantMessage && !assistantMessage.content.trim()) {
        chatHistory = chatHistory.filter((msg) => msg.id !== assistantMessage.id);
        syncChatBottomReserve({
          streaming: false
        });
        renderChatMessages({
          allowAutoScroll: false
        });
      } else if (assistantMessage && assistantMessage.content.trim()) {
        renderChatMessages({
          allowAutoScroll: false
        });
        await saveChatHistory();
      }

      if (aborted) {
        setStatus(chatStatus, 'Respuesta interrumpida.');
      } else {
        const message = error instanceof Error ? error.message : 'Error inesperado al generar la respuesta.';
        setStatus(chatStatus, message, true);
        setBrandEmotion('disappointed');
        window.setTimeout(() => {
          if (!isGeneratingChat) {
            startRandomEmotionCycle({ immediate: false });
          }
        }, 1200);
      }
    } finally {
      if (activeChatAbortController === generationAbortController) {
        activeChatAbortController = null;
      }
      isGeneratingChat = false;
      renderChatSendButtonState();
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

  function buildHeuristicTabSummary(tabContext) {
    const source = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const title = String(source.title || '').replace(/\s+/g, ' ').trim();
    const description = String(source.description || '').replace(/\s+/g, ' ').trim();
    const excerpt = String(source.textExcerpt || '').replace(/\s+/g, ' ').trim();
    const base = [title, description || excerpt].filter(Boolean).join(' - ').trim();
    if (!base) {
      return '';
    }
    return base.slice(0, getSystemVariableNumber('context.tabSummaryMaxChars', TAB_SUMMARY_MAX_CHARS));
  }

  function isLikelyModelOfflineError(errorText = '') {
    const token = String(errorText || '').trim().toLowerCase();
    if (!token) {
      return false;
    }

    return (
      token.includes('err_connection_refused') ||
      token.includes('failed to fetch') ||
      token.includes('networkerror') ||
      token.includes('no se pudo conectar con ollama') ||
      token.includes('ollama error') ||
      token.includes('ollama rechazo el origen')
    );
  }

  function trimTabSummaryCache() {
    const keepKeys = new Set(tabContextSnapshot.tabs.map((item) => getTabSummaryKey(item)));
    for (const key of tabSummaryByKey.keys()) {
      if (!keepKeys.has(key)) {
        tabSummaryByKey.delete(key);
      }
    }
  }

  function trimMapToMaxItems(map, maxItems) {
    if (!map || typeof map.size !== 'number') {
      return 0;
    }
    const limit = Math.max(0, Number(maxItems) || 0);
    if (map.size <= limit) {
      return 0;
    }
    let removed = 0;
    const overflow = map.size - limit;
    for (let index = 0; index < overflow; index += 1) {
      const firstKey = map.keys().next().value;
      if (firstKey === undefined) {
        break;
      }
      map.delete(firstKey);
      removed += 1;
    }
    return removed;
  }

  function pruneTabSummaryQueue(knownTabIds = null) {
    if (!Array.isArray(tabSummaryQueue) || !tabSummaryQueue.length) {
      return;
    }

    const safeKnownTabIds = knownTabIds instanceof Set ? knownTabIds : null;
    const seen = new Set();
    const nextQueue = [];
    for (const entry of tabSummaryQueue) {
      const key = String(entry?.key || '').trim();
      const tabContext = entry?.tabContext && typeof entry.tabContext === 'object' ? entry.tabContext : null;
      const tabId = Number(tabContext?.tabId);
      if (!key || !tabContext || seen.has(key) || tabSummaryByKey.has(key)) {
        continue;
      }
      if (safeKnownTabIds && Number.isFinite(tabId) && tabId >= 0 && !safeKnownTabIds.has(tabId)) {
        continue;
      }
      seen.add(key);
      nextQueue.push({ key, tabContext });
    }

    tabSummaryQueue = nextQueue.slice(-TAB_SUMMARY_QUEUE_MAX_ITEMS);
  }

  function runRuntimeGarbageCollector(options = {}) {
    const now = Date.now();
    const safeOptions = options && typeof options === 'object' ? options : {};
    const knownTabIds =
      safeOptions.knownTabIds instanceof Set
        ? safeOptions.knownTabIds
        : new Set(
            (Array.isArray(tabContextSnapshot?.tabs) ? tabContextSnapshot.tabs : [])
              .map((item) => Number(item?.tabId))
              .filter((item) => Number.isFinite(item) && item >= 0)
          );

    trimTabSummaryCache();
    pruneTabSummaryQueue(knownTabIds);
    trimMapToMaxItems(tabSummaryByKey, TAB_SUMMARY_CACHE_MAX_ITEMS);
    trimMapToMaxItems(whatsappHistoryVectorFingerprintByKey, WHATSAPP_HISTORY_FINGERPRINT_CACHE_MAX_ITEMS);

    const syncCutoff = now - WHATSAPP_HISTORY_SYNC_MIN_INTERVAL_MS * 6;
    for (const [tabId, nextAllowed] of whatsappHistorySyncNextAllowedByTab.entries()) {
      if (!knownTabIds.has(Number(tabId)) || Number(nextAllowed) < syncCutoff) {
        whatsappHistorySyncNextAllowedByTab.delete(tabId);
      }
    }

    const blockedCutoff =
      now - Math.max(WHATSAPP_LIVE_CONTEXT_RETRY_COOLDOWN_MS, WHATSAPP_LIVE_CONTEXT_NO_RECEIVER_COOLDOWN_MS) * 6;
    for (const [tabId, blockedUntil] of whatsappLiveContextBlockedUntilByTab.entries()) {
      if (!knownTabIds.has(Number(tabId)) || Number(blockedUntil) < blockedCutoff) {
        whatsappLiveContextBlockedUntilByTab.delete(tabId);
      }
    }

    const listenerSnapshot = runtimeListenerMonitor.snapshot();
    if (
      listenerSnapshot.installed &&
      listenerSnapshot.activeCount > RUNTIME_LISTENER_WARN_THRESHOLD &&
      now - runtimeListenerWarnedAt >= RUNTIME_LISTENER_WARN_COOLDOWN_MS
    ) {
      runtimeListenerWarnedAt = now;
      logWarn('runtime_gc:listener_pressure', {
        activeListeners: listenerSnapshot.activeCount,
        peakListeners: listenerSnapshot.peakCount,
        threshold: RUNTIME_LISTENER_WARN_THRESHOLD,
        reason: String(safeOptions.reason || 'runtime_gc')
      });
    }
  }

  function startRuntimeGarbageCollector() {
    if (runtimeGcTimerId) {
      return;
    }
    runRuntimeGarbageCollector({
      reason: 'boot'
    });
    runtimeGcTimerId = window.setInterval(() => {
      runRuntimeGarbageCollector({
        reason: 'interval'
      });
    }, RUNTIME_GC_INTERVAL_MS);
  }

  function stopRuntimeGarbageCollector() {
    if (!runtimeGcTimerId) {
      return;
    }
    window.clearInterval(runtimeGcTimerId);
    runtimeGcTimerId = 0;
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

  function buildTabsContextJsonRenderKey() {
    const tabs = Array.isArray(tabContextSnapshot?.tabs) ? tabContextSnapshot.tabs : [];
    const history = Array.isArray(tabContextSnapshot?.history) ? tabContextSnapshot.history : [];
    const runtimeContext =
      tabContextSnapshot?.runtimeContext && typeof tabContextSnapshot.runtimeContext === 'object'
        ? tabContextSnapshot.runtimeContext
        : {};
    const runtimeKeys = Object.keys(runtimeContext).sort().slice(0, 36);
    const tabsToken = tabs
      .slice(0, 36)
      .map((tab) =>
        [
          Number(tab?.tabId) || -1,
          toSafeLogText(tab?.site || '', 20),
          toSafeLogText(tab?.url || '', 120),
          toSafeLogText(tab?.title || '', 84),
          toSafeLogText(tab?.description || '', 84),
          toSafeLogText(getTabSummary(tab), 84)
        ].join('~')
      )
      .join('||');
    const historyToken = history
      .slice(0, 30)
      .map((item) =>
        [toSafeLogText(item?.url || '', 120), toSafeLogText(item?.title || '', 84), Number(item?.lastVisitTime) || 0].join(
          '~'
        )
      )
      .join('||');

    return [
      Number(tabContextSnapshot?.activeTabId) || -1,
      toSafeLogText(tabContextSnapshot?.reason || '', 80),
      tabs.length,
      history.length,
      runtimeKeys.join(','),
      tabsToken,
      historyToken
    ].join('|');
  }

  function buildDynamicContextRenderKey(options = {}) {
    const activeSite = String(options.activeSite || 'generic').toLowerCase();
    const phoneCount = Math.max(0, Number(options.phoneCount) || 0);
    const emailCount = Math.max(0, Number(options.emailCount) || 0);
    const suggestions = Array.isArray(options.suggestions) ? options.suggestions : [];
    const relations = Array.isArray(options.relations) ? options.relations : [];

    const suggestionToken = suggestions
      .map((item) =>
        [
          String(item?.id || ''),
          String(item?.loading === true ? '1' : '0'),
          String(item?.canExecute === true ? '1' : '0'),
          String(item?.canRegenerate === true ? '1' : '0'),
          toSafeLogText(item?.title || '', 80),
          toSafeLogText(item?.caption || '', 80),
          toSafeLogText(item?.description || '', 160),
          toSafeLogText(item?.statusText || '', 120),
          String(item?.statusError === true ? '1' : '0')
        ].join('~')
      )
      .join('||');

    const relationToken = relations
      .map((item) => {
        const rows = Array.isArray(item?.rows) ? item.rows : [];
        const detailFields = Array.isArray(item?.detailFields) ? item.detailFields : [];
        const rowsToken = rows
          .slice(0, 4)
          .map((row) =>
            [
              toSafeLogText(row?.label || '', 64),
              toSafeLogText(row?.value || '', 96),
              Math.max(0, Number(row?.count) || 0)
            ].join(':')
          )
          .join(',');
        const detailToken = detailFields
          .slice(0, 4)
          .map((field) => [toSafeLogText(field?.label || '', 64), toSafeLogText(field?.value || '', 96)].join(':'))
          .join(',');

        return [
          String(item?.id || ''),
          toSafeLogText(item?.title || '', 80),
          toSafeLogText(item?.caption || '', 80),
          toSafeLogText(item?.tableQualifiedName || '', 84),
          Math.max(0, Number(item?.totalCount) || 0),
          rowsToken,
          detailToken
        ].join('~');
      })
      .join('||');

    return [
      activeSite,
      phoneCount,
      emailCount,
      suggestionToken,
      relationToken,
      String(dynamicRelationsContextState.loading === true ? '1' : '0'),
      toSafeLogText(dynamicRelationsContextState.signalKey || '', 220),
      String(dynamicRelationsContextState.isError === true ? '1' : '0')
    ].join('|');
  }

  function buildDynamicRelationDetailRenderKey(cardModel = null) {
    const state = dynamicRelationsDetailState && typeof dynamicRelationsDetailState === 'object' ? dynamicRelationsDetailState : {};
    const groups = Array.isArray(state.groups) ? state.groups : [];
    const card = cardModel && typeof cardModel === 'object' ? cardModel : null;
    const cardToken = card
      ? [
          String(card.id || ''),
          toSafeLogText(card.title || '', 84),
          toSafeLogText(card.caption || '', 84),
          toSafeLogText(card.tableQualifiedName || '', 96),
          String(card?.meta?.singleResult === true ? '1' : '0')
        ].join('~')
      : 'none';

    const groupsToken = groups
      .map((group) => {
        const items = Array.isArray(group?.items) ? group.items : [];
        const itemsToken = items
          .slice(0, 12)
          .map((item) =>
            [
              toSafeLogText(item?.label || '', 64),
              toSafeLogText(item?.value || '', 96),
              Math.max(0, Number(item?.count) || 0)
            ].join(':')
          )
          .join(',');
        return [toSafeLogText(group?.key || '', 64), toSafeLogText(group?.label || '', 84), items.length, itemsToken].join('~');
      })
      .join('||');

    return [
      String(state.open === true ? '1' : '0'),
      String(state.loading === true ? '1' : '0'),
      String(state.cardId || ''),
      String(state.isError === true ? '1' : '0'),
      toSafeLogText(state.message || '', 180),
      cardToken,
      groupsToken
    ].join('|');
  }

  function renderTabsContextJson() {
    if (!tabsContextJson) {
      return;
    }

    const nextRenderKey = buildTabsContextJsonRenderKey();
    if (nextRenderKey === tabsContextJsonRenderKey) {
      return;
    }
    tabsContextJsonRenderKey = nextRenderKey;

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

    if (!ENABLE_AUTO_TAB_SUMMARY_WITH_MODEL) {
      tabSummaryByKey.set(key, buildHeuristicTabSummary(tabContext));
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

    scheduleWhatsappSuggestionForTab(activeTab, {
      force: options.force === true
    });
  }

  function clearWhatsappSuggestionRefreshTimer() {
    if (!whatsappSuggestionRefreshTimer) {
      return;
    }
    window.clearTimeout(whatsappSuggestionRefreshTimer);
    whatsappSuggestionRefreshTimer = 0;
    queuedWhatsappSuggestionTab = null;
  }

  function scheduleWhatsappSuggestionForTab(tabContext, options = {}) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : null;
    if (!context || !isWhatsappContext(context)) {
      return;
    }

    const force = options.force === true;
    if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
      logWhatsappSuggestionTrace('schedule:received', {
        force,
        hasTimer: Boolean(whatsappSuggestionRefreshTimer),
        activeChatKeyCache: toSafeLogText(whatsappSuggestionActiveChatKey, 120),
        state: {
          loading: whatsappSuggestionState.loading,
          signalKey: toSafeLogText(whatsappSuggestionState.signalKey, 160),
          hasText: Boolean(whatsappSuggestionState.text)
        },
        context: summarizeWhatsappTraceContext(context)
      });
    }

    if (force) {
      clearWhatsappSuggestionRefreshTimer();
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('schedule:force_dispatch', {
          context: summarizeWhatsappTraceContext(context)
        });
      }
      void generateWhatsappSuggestion(context, { force: true });
      return;
    }

    queuedWhatsappSuggestionTab = context;
    if (whatsappSuggestionRefreshTimer) {
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('schedule:debounce_pending', {
          context: summarizeWhatsappTraceContext(context)
        });
      }
      return;
    }

    whatsappSuggestionRefreshTimer = window.setTimeout(() => {
      whatsappSuggestionRefreshTimer = 0;
      const queued = queuedWhatsappSuggestionTab;
      queuedWhatsappSuggestionTab = null;
      if (!queued) {
        return;
      }
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('schedule:debounce_dispatch', {
          context: summarizeWhatsappTraceContext(queued)
        });
      }
      void generateWhatsappSuggestion(queued, { force: false });
    }, WHATSAPP_SUGGESTION_AUTO_DEBOUNCE_MS);
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

  async function hydrateWhatsappContextFromLiveTab(tabContext, options = {}) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return tabContext;
    }

    const tabId = Number(tabContext.tabId);
    if (!Number.isFinite(tabId) || tabId < 0) {
      return tabContext;
    }

    const details = tabContext.details && typeof tabContext.details === 'object' ? tabContext.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const knownMessages = Array.isArray(details.messages) ? details.messages : [];
    const safeOptions = options && typeof options === 'object' ? options : {};
    const minMessages = Math.max(1, Number(safeOptions.minMessages) || 1);
    const hasChatIdentity = Boolean(
      String(currentChat.key || currentChat.channelId || currentChat.phone || currentChat.title || '').trim()
    );
    const shouldHydrate = safeOptions.force === true || knownMessages.length < minMessages || !hasChatIdentity;
    if (!shouldHydrate) {
      return tabContext;
    }

    const now = Date.now();
    const blockedUntil = whatsappLiveContextBlockedUntilByTab.get(tabId) || 0;
    if (!safeOptions.force && now < blockedUntil) {
      return tabContext;
    }

    const readLimit = Math.max(20, Math.min(140, Number(safeOptions.messageLimit) || 80));
    const [automationPackResponse, chatResponse, messagesResponse] = await Promise.all([
      tabContextService.runSiteActionInTab(tabId, 'whatsapp', 'getAutomationPack', {
        messageLimit: readLimit,
        inboxLimit: 40
      }),
      tabContextService.runSiteActionInTab(tabId, 'whatsapp', 'getCurrentChat', {}),
      tabContextService.runSiteActionInTab(tabId, 'whatsapp', 'readMessages', { limit: readLimit })
    ]);

    const automationPack =
      automationPackResponse?.result && typeof automationPackResponse.result === 'object' ? automationPackResponse.result : {};
    const automationChat =
      automationPack.currentChat && typeof automationPack.currentChat === 'object' ? automationPack.currentChat : {};
    const automationMessages = Array.isArray(automationPack.messages) ? automationPack.messages : [];
    const directChat = chatResponse?.result && typeof chatResponse.result === 'object' ? chatResponse.result : {};
    const directMessages = Array.isArray(messagesResponse?.result) ? messagesResponse.result : [];
    const liveChat = Object.keys(automationChat).length ? automationChat : directChat;
    const liveMessages = automationMessages.length ? automationMessages : directMessages;
    const packError = String(automationPackResponse?.error || '').trim();
    const chatError = String(chatResponse?.error || '').trim();
    const messagesError = String(messagesResponse?.error || '').trim();
    const firstError = packError || chatError || messagesError;
    if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
      logWhatsappSuggestionTrace('context:live_sources', {
        tabId,
        readLimit,
        packOk: automationPackResponse?.ok === true,
        packError: toSafeLogText(packError, 220),
        packChatKeys: Object.keys(automationChat).length,
        packMessages: automationMessages.length,
        directChatOk: chatResponse?.ok === true,
        directChatError: toSafeLogText(chatError, 220),
        directChatKeys: Object.keys(directChat).length,
        directMessagesOk: messagesResponse?.ok === true,
        directMessagesError: toSafeLogText(messagesError, 220),
        directMessages: directMessages.length,
        chosenMessages: liveMessages.length,
        chosenChatKeys: Object.keys(liveChat).length
      });
    }
    const noReceiver = isNoReceiverRuntimeError(firstError);
    if (!liveMessages.length && !Object.keys(liveChat).length) {
      if (firstError) {
        const cooldownMs = noReceiver
          ? WHATSAPP_LIVE_CONTEXT_NO_RECEIVER_COOLDOWN_MS
          : WHATSAPP_LIVE_CONTEXT_RETRY_COOLDOWN_MS;
        whatsappLiveContextBlockedUntilByTab.set(tabId, Date.now() + cooldownMs);
      } else {
        whatsappLiveContextBlockedUntilByTab.set(tabId, Date.now() + WHATSAPP_LIVE_CONTEXT_RETRY_COOLDOWN_MS);
      }
      return tabContext;
    }

    whatsappLiveContextBlockedUntilByTab.set(tabId, Date.now() + 1200);

    const mergedCurrentChat = {
      ...currentChat,
      title: String(liveChat.title || currentChat.title || '').trim(),
      phone: String(liveChat.phone || currentChat.phone || '').trim(),
      channelId: String(liveChat.channelId || currentChat.channelId || '').trim(),
      key: String(liveChat.key || currentChat.key || currentChat.phone || currentChat.title || '').trim()
    };
    if (!mergedCurrentChat.key) {
      mergedCurrentChat.key = String(mergedCurrentChat.phone || mergedCurrentChat.title || mergedCurrentChat.channelId || '').trim();
    }

    logDebug('whatsapp_history:live_context_hydrated', {
      tabId,
      readMessages: liveMessages.length,
      hadMessages: knownMessages.length,
      chatKey: toSafeLogText(mergedCurrentChat.key || mergedCurrentChat.channelId || '', 160),
      chatTitle: toSafeLogText(mergedCurrentChat.title || '', 120),
      chatPhone: toSafeLogText(mergedCurrentChat.phone || '', 40)
    });

    return {
      ...tabContext,
      details: {
        ...details,
        currentChat: mergedCurrentChat,
        messages: liveMessages.length ? liveMessages : knownMessages
      }
    };
  }

  async function buildWhatsappSuggestionContext(tabContext, options = {}) {
    if (!tabContext || !isWhatsappContext(tabContext)) {
      return tabContext;
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
      logWhatsappSuggestionTrace('context:build_start', {
        forceLiveHydration: safeOptions.forceLiveHydration === true,
        input: summarizeWhatsappTraceContext(tabContext)
      });
    }
    const hydratedContext = await hydrateWhatsappContextFromLiveTab(tabContext, {
      force: safeOptions.forceLiveHydration === true,
      minMessages: 1,
      messageLimit: getSystemVariableNumber('whatsapp.suggestionHistoryLimit', WHATSAPP_SUGGESTION_HISTORY_LIMIT)
    });
    const syncResult = await syncWhatsappChatContext(hydratedContext, {
      messageLimit: getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)
    });
    const historyPayload = await readWhatsappChatHistory(hydratedContext, {
      limit: getSystemVariableNumber('whatsapp.suggestionHistoryLimit', WHATSAPP_SUGGESTION_HISTORY_LIMIT)
    });
    void ingestWhatsappHistoryIntoContextMemory(historyPayload, {
      messageLimit: getSystemVariableNumber('whatsapp.maxPersistedMessages', MAX_WHATSAPP_PERSISTED_MESSAGES)
    }).catch(() => {});
    const mergedContext = mergeWhatsappContextWithHistory(hydratedContext, historyPayload);

    logDebug('whatsapp_history:sync', {
      tabId: Number(hydratedContext.tabId) || -1,
      chatKey: toSafeLogText(getWhatsappChatKey(hydratedContext), 160),
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

    if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
      logWhatsappSuggestionTrace('context:build_done', {
        forceLiveHydration: safeOptions.forceLiveHydration === true,
        hydrated: summarizeWhatsappTraceContext(hydratedContext),
        merged: summarizeWhatsappTraceContext(mergedContext),
        sync: {
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
    }

    return mergedContext;
  }

  function summarizeWhatsappSuggestionContext(tabContext, tailLimit = 6) {
    const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
    const details = context.details && typeof context.details === 'object' ? context.details : {};
    const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
    const messages = Array.isArray(details.messages) ? details.messages : [];

    const includeTail = ENABLE_PANEL_DEBUG_LOGS || ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS;
    return {
      tabId: Number(context.tabId) || -1,
      chatKey: toSafeLogText(currentChat.key || getWhatsappChatKey(context), 160),
      chatTitle: toSafeLogText(currentChat.title || '', 120),
      chatPhone: toSafeLogText(currentChat.phone || '', 42),
      messageCount: messages.length,
      messageTail: includeTail
        ? messages.slice(-tailLimit).map((item) => ({
            id: toSafeLogText(item?.id || '', 120),
            role: item?.role === 'me' ? 'me' : 'contact',
            kind: toSafeLogText(item?.kind || '', 24),
            timestamp: toSafeLogText(item?.timestamp || '', 80),
            text: toSafeLogText(item?.text || '', 160),
            transcript: toSafeLogText(item?.transcript || item?.enriched?.transcript || '', 120),
            ocrText: toSafeLogText(item?.ocrText || item?.enriched?.ocrText || '', 120)
          }))
        : []
    };
  }

  function canRunDynamicRelationsForTab(tabContext) {
    if (!isGmailContext(tabContext)) {
      return true;
    }

    return isGmailMessageOpenContext(tabContext);
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

    if (!canRunDynamicRelationsForTab(activeTab)) {
      dynamicRelationsContextState = {
        signalKey,
        loading: false,
        cards: [],
        message: 'En Gmail abre un correo para ejecutar relaciones.',
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
        : hasText
          ? 'Sugerencia lista para ejecutar.'
          : 'Aun sin sugerencia generada para este chat.';

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
    label.className = 'ai-dynamic-relation-list__label';
    label.textContent = String(row?.label || '(sin etiqueta)');
    const value = document.createElement('strong');
    value.className = 'ai-dynamic-relation-list__value';
    const hasValue = String(row?.value || '').trim();
    if (hasValue) {
      value.textContent = hasValue;
    } else {
      value.textContent = String(Math.max(0, Number(row?.count) || 0));
    }
    item.append(label, value);
    list.appendChild(item);
  }

  function buildRelationDetailItems(items, limit = 10) {
    const safeItems = Array.isArray(items) ? items : [];
    const maxItems = Math.max(1, Math.min(16, Number(limit) || 10));
    return safeItems
      .map((item) => {
        const label = String(item?.label || '').trim();
        if (!label) {
          return null;
        }
        const directValue = String(item?.value || '').trim();
        if (directValue) {
          return { label, value: directValue, mode: 'value' };
        }
        const count = Math.max(0, Number(item?.count) || 0);
        return { label, value: String(count), mode: 'count' };
      })
      .filter(Boolean)
      .slice(0, maxItems);
  }

  function buildRelationDetailGroupViewModel(group, cardModel) {
    const safeGroup = group && typeof group === 'object' ? group : {};
    const card = cardModel && typeof cardModel === 'object' ? cardModel : {};
    const groupLabel = String(safeGroup.label || safeGroup.key || '').trim();
    const fallbackCardTitle = String(card.title || '').trim() || 'Detalle';
    const normalizedGroupLabel = groupLabel.toLowerCase();
    const hasSpecificGroupLabel = Boolean(
      groupLabel &&
        normalizedGroupLabel !== 'detalle' &&
        normalizedGroupLabel !== 'single' &&
        normalizedGroupLabel !== 'signal' &&
        normalizedGroupLabel !== 'grupo'
    );
    const items = buildRelationDetailItems(safeGroup.items, 10);
    const hasCountOnlyRows = items.some((item) => item.mode === 'count');

    let title = hasSpecificGroupLabel ? groupLabel : fallbackCardTitle;
    let titleFieldIndex = -1;
    if (!hasCountOnlyRows && items.length) {
      const preferredTitleIndex = items.findIndex((item) =>
        /(^|[\s_-])(title|name|subject|nombre|contact|cliente|company|account)([\s_-]|$)/i.test(item.label)
      );
      if (preferredTitleIndex >= 0) {
        titleFieldIndex = preferredTitleIndex;
        title = String(items[preferredTitleIndex].value || '').trim() || title;
      } else if (!hasSpecificGroupLabel) {
        title = fallbackCardTitle;
      }
    }

    const subtitle = hasSpecificGroupLabel && groupLabel !== title ? groupLabel : '';
    const kvItems = items.filter((_, index) => index !== titleFieldIndex).map((item) => ({
      label: item.label,
      value: item.value
    }));

    return {
      title: title || fallbackCardTitle,
      subtitle,
      kvItems
    };
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
      logDebug('dynamic_context:meta', {
        site: activeSite,
        phoneCount,
        emailCount,
        suggestionCount: suggestions.length,
        relationCount: relations.length
      });
    }

    const nextDynamicContextRenderKey = buildDynamicContextRenderKey({
      activeSite,
      phoneCount,
      emailCount,
      suggestions,
      relations
    });
    if (nextDynamicContextRenderKey === dynamicContextRenderKey) {
      renderDynamicRelationDetailScreen();
      return;
    }
    dynamicContextRenderKey = nextDynamicContextRenderKey;

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
          const titleText = String(cardModel?.title || 'Relacion').trim() || 'Relacion';
          card.setAttribute('aria-label', `Abrir detalle de ${titleText}`);
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

    // Toast flotante de relaciones deshabilitado temporalmente.
    // const relationToastMessage = String(dynamicRelationsContextState.message || '').trim();
    // const shouldShowRelationToast = Boolean(relationToastMessage) && hasSignals;
    // const relationToastKey = `${dynamicRelationsContextState.loading ? 'loading' : 'ready'}|${
    //   dynamicRelationsContextState.isError === true ? 'error' : 'ok'
    // }|${relationToastMessage}|${showRelationsArea ? 'shown' : 'hidden'}`;
    // if (shouldShowRelationToast && relationToastKey !== dynamicUiToastKey) {
    //   dynamicUiToastKey = relationToastKey;
    //   showDynamicUiToast(relationToastMessage, dynamicRelationsContextState.isError === true, {
    //     durationMs: dynamicRelationsContextState.loading ? 1600 : 2600
    //   });
    // } else if (!shouldShowRelationToast) {
    //   dynamicUiToastKey = '';
    //   showDynamicUiToast('');
    // }
    dynamicUiToastKey = '';
    showDynamicUiToast('');

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

    const isOpen = dynamicRelationsDetailState.open === true;
    dynamicRelationsDetailScreen.hidden = !isOpen;

    const card = isOpen ? dynamicRelationCardIndex.get(dynamicRelationsDetailState.cardId) || null : null;
    const nextRenderKey = buildDynamicRelationDetailRenderKey(card);
    if (nextRenderKey === dynamicRelationDetailRenderKey) {
      return;
    }
    dynamicRelationDetailRenderKey = nextRenderKey;

    if (!isOpen) {
      return;
    }

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
          const detailModel = buildRelationDetailGroupViewModel(group, card);
          const section = document.createElement('article');
          section.className = 'dynamic-relations-group';

          const head = document.createElement('div');
          head.className = 'dynamic-relations-group__head';
          const title = document.createElement('p');
          title.className = 'dynamic-relations-group__title dynamic-relations-group__title--main';
          title.textContent = String(detailModel.title || 'Detalle');
          head.appendChild(title);

          if (detailModel.subtitle) {
            const subtitle = document.createElement('p');
            subtitle.className = 'dynamic-relations-group__meta';
            subtitle.textContent = String(detailModel.subtitle || '');
            subtitle.title = subtitle.textContent;
            head.appendChild(subtitle);
          }

          const list = document.createElement('ul');
          list.className = 'ai-dynamic-relation-list';
          if (detailModel.kvItems.length) {
            for (const row of detailModel.kvItems) {
              appendRelationListItem(list, row);
            }
          } else {
            appendRelationListItem(list, {
              label: 'Detalle',
              value: 'Sin campos disponibles'
            });
          }
          section.append(head, list);
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
          .slice(0, 8)
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
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('generate:skip_not_whatsapp', {
          context: summarizeWhatsappTraceContext(tabContext)
        });
      }
      hideWhatsappSuggestion();
      return;
    }

    const force = Boolean(options.force);
    const forceLiveHydration = force || options.forceLiveHydration === true;
    const traceEnabled = ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS;
    if (traceEnabled) {
      logWhatsappSuggestionTrace('generate:start', {
        force,
        forceLiveHydration,
        cooldownUntil: Math.max(0, Number(whatsappSuggestionModelCooldownUntil) || 0),
        cooldownRemainingMs: Math.max(0, (Number(whatsappSuggestionModelCooldownUntil) || 0) - Date.now()),
        input: summarizeWhatsappTraceContext(tabContext),
        state: {
          loading: whatsappSuggestionState.loading,
          signalKey: toSafeLogText(whatsappSuggestionState.signalKey, 180),
          hasText: Boolean(whatsappSuggestionState.text),
          dismissedSignalKey: toSafeLogText(whatsappSuggestionDismissedSignalKey, 180)
        }
      });
    }
    if (!force && Date.now() < whatsappSuggestionModelCooldownUntil) {
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_model_cooldown', {
          cooldownRemainingMs: Math.max(0, whatsappSuggestionModelCooldownUntil - Date.now()),
          input: summarizeWhatsappTraceContext(tabContext)
        });
      }
      return;
    }

    let suggestionContext = tabContext;

    try {
      suggestionContext = await buildWhatsappSuggestionContext(tabContext, {
        forceLiveHydration
      });
    } catch (error) {
      logWarn('whatsapp_history:context_build_error', {
        tabId: Number(tabContext.tabId) || -1,
        chatKey: toSafeLogText(getWhatsappChatKey(tabContext), 160),
        error: error instanceof Error ? error.message : String(error || '')
      });
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:context_build_error', {
          error: error instanceof Error ? error.message : String(error || ''),
          input: summarizeWhatsappTraceContext(tabContext)
        });
      }
      suggestionContext = tabContext;
    }

    const chatKey = getWhatsappChatKey(suggestionContext);
    const signalKey = buildWhatsappSignalKey(suggestionContext);
    const contextSummary = summarizeWhatsappSuggestionContext(suggestionContext);
    const basePrompt = getWhatsappSuggestionBasePrompt();
    const chatPrompt = resolveWhatsappConversationPromptForSuggestion(suggestionContext);
    const promptSignature = buildWhatsappSuggestionPromptSignature(basePrompt, chatPrompt);
    const profileForSuggestion = resolveModelProfileForInference();

    logDebug('whatsapp_suggestion:start', {
      ...contextSummary,
      force,
      signalKey: toSafeLogText(signalKey, 220),
      dismissedSignalKey: toSafeLogText(whatsappSuggestionDismissedSignalKey, 220),
      hasChatPrompt: Boolean(chatPrompt)
    });
    if (traceEnabled) {
      logWhatsappSuggestionTrace('generate:context_ready', {
        force,
        forceLiveHydration,
        chatKey: toSafeLogText(chatKey, 160),
        signalKey: toSafeLogText(signalKey, 220),
        promptSignatureChars: promptSignature.length,
        hasChatPrompt: Boolean(chatPrompt),
        chatPromptChars: chatPrompt.length,
        summary: contextSummary
      });
    }

    if (!signalKey || signalKey === '::') {
      logWarn('whatsapp_suggestion:skip_no_signal', {
        ...contextSummary,
        signalKey: toSafeLogText(signalKey, 120)
      });
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_no_signal', {
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 120)
        });
      }
      hideWhatsappSuggestion();
      return;
    }

    if (!hasWhatsappConversationHistory(suggestionContext, 1)) {
      logDebug('whatsapp_suggestion:skip_no_messages', {
        ...contextSummary,
        signalKey: toSafeLogText(signalKey, 220)
      });
      const waitingMessage = 'Aun no hay historial suficiente para sugerir next message en este chat.';
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_no_messages', {
          waitingMessage,
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220)
        });
      }
      whatsappSuggestionState = {
        tabId: Number(suggestionContext.tabId) || -1,
        chatKey,
        signalKey,
        promptSignature,
        text: '',
        loading: false
      };
      setWhatsappSuggestionUiStatus(waitingMessage, false);
      setStatus(whatsappSuggestionStatus, waitingMessage);
      renderAiDynamicContext(suggestionContext);
      return;
    }

    if (!force && whatsappSuggestionDismissedSignalKey && whatsappSuggestionDismissedSignalKey === signalKey) {
      logDebug('whatsapp_suggestion:skip_dismissed', {
        tabId: contextSummary.tabId,
        chatKey: contextSummary.chatKey,
        signalKey: toSafeLogText(signalKey, 220)
      });
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_dismissed', {
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220)
        });
      }
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
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:reuse_cached', {
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220),
          promptSignatureChars: promptSignature.length,
          suggestionChars: whatsappSuggestionState.text.length
        });
      }
      setWhatsappSuggestionResult(suggestionContext, whatsappSuggestionState.text);
      return;
    }

    if (!force && whatsappSuggestionState.loading && whatsappSuggestionState.signalKey === signalKey) {
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_already_loading', {
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220)
        });
      }
      return;
    }

    if (!profileForSuggestion) {
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_no_profile', {
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220)
        });
      }
      setWhatsappSuggestionUiStatus('No hay modelo disponible para sugerencias.', true);
      setStatus(whatsappSuggestionStatus, 'No hay modelo disponible para sugerencias.', true);
      renderAiDynamicContext(suggestionContext);
      return;
    }

    if (
      !force &&
      profileForSuggestion.provider === AI_PROVIDER_IDS.OLLAMA &&
      !ENABLE_AUTO_WHATSAPP_SUGGESTION_WITH_OLLAMA
    ) {
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:skip_ollama_auto_disabled', {
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220),
          provider: toSafeLogText(profileForSuggestion.provider || '', 40),
          model: toSafeLogText(profileForSuggestion.model || '', 80)
        });
      }
      hideWhatsappSuggestion();
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
    if (traceEnabled) {
      logWhatsappSuggestionTrace('generate:state_loading', {
        token,
        summary: contextSummary,
        signalKey: toSafeLogText(signalKey, 220),
        promptSignatureChars: promptSignature.length
      });
    }

    setWhatsappSuggestionLoading(suggestionContext);
    const startedAt = Date.now();

    try {
      const prompt = buildWhatsappReplyPrompt(suggestionContext, {
        basePrompt,
        chatPrompt
      });

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
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:model_start', {
          token,
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220),
          promptSignatureChars: promptSignature.length,
          basePromptChars: basePrompt.length,
          chatPromptChars: chatPrompt.length,
          promptChars: prompt.length,
          promptPreview: toSafeLogText(prompt, 640),
          profile: {
            id: toSafeLogText(profileForSuggestion.id || '', 80),
            provider: toSafeLogText(profileForSuggestion.provider || '', 40),
            model: toSafeLogText(profileForSuggestion.model || '', 80)
          }
        });
      }

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
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:model_done', {
          token,
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220),
          elapsedMs: Date.now() - startedAt,
          rawChars: suggestionRaw.length,
          suggestionChars: suggestion.length,
          suggestionPreview: toSafeLogText(suggestion, 200)
        });
      }

      if (token !== whatsappSuggestionToken) {
        logDebug('whatsapp_suggestion:ignored_outdated_token', {
          token,
          currentToken: whatsappSuggestionToken,
          tabId: contextSummary.tabId,
          chatKey: contextSummary.chatKey
        });
        if (traceEnabled) {
          logWhatsappSuggestionTrace('generate:skip_outdated_token', {
            token,
            currentToken: whatsappSuggestionToken,
            summary: contextSummary
          });
        }
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

      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:success', {
          token,
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220),
          suggestionChars: suggestion.length,
          suggestionPreview: toSafeLogText(suggestion, 200)
        });
      }
      setWhatsappSuggestionResult(suggestionContext, suggestion);
    } catch (error) {
      if (token !== whatsappSuggestionToken) {
        if (traceEnabled) {
          logWhatsappSuggestionTrace('generate:skip_error_outdated_token', {
            token,
            currentToken: whatsappSuggestionToken
          });
        }
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
      if (!force && isLikelyModelOfflineError(message)) {
        whatsappSuggestionModelCooldownUntil = Date.now() + WHATSAPP_SUGGESTION_MODEL_COOLDOWN_MS;
      }
      if (traceEnabled) {
        logWhatsappSuggestionTrace('generate:error', {
          token,
          summary: contextSummary,
          signalKey: toSafeLogText(signalKey, 220),
          elapsedMs: Date.now() - startedAt,
          error: message,
          cooldownUntil: Math.max(0, Number(whatsappSuggestionModelCooldownUntil) || 0)
        });
      }
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
    const force = options.force === true;
    if (!force && !realtimeContextIngestionEnabled) {
      return;
    }

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
    const now = Date.now();
    const force = options.force === true;
    const whatsappTabs = tabs.filter((tab) => {
      if (!isWhatsappContext(tab)) {
        return false;
      }

      if (force) {
        return true;
      }

      const tabId = Number(tab?.tabId);
      if (!Number.isFinite(tabId) || tabId < 0) {
        return false;
      }

      return now >= (whatsappHistorySyncNextAllowedByTab.get(tabId) || 0);
    });
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
          const tabId = Number(tab?.tabId);
          if (Number.isFinite(tabId) && tabId >= 0) {
            whatsappHistorySyncNextAllowedByTab.set(tabId, Date.now() + WHATSAPP_HISTORY_SYNC_MIN_INTERVAL_MS);
          }
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
        realtimeContextIngestionEnabled = currentState.status === 'done';
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
            force: true,
            tabsLimit: getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY),
            historyLimit: getSystemVariableNumber('bootstrap.initialContextSyncHistoryLimit', INITIAL_CONTEXT_SYNC_HISTORY_LIMIT)
          }
        );
        await contextIngestionPromise;

        const bootstrapChatLimit = getSystemVariableNumber('bootstrap.initialContextSyncChatLimit', INITIAL_CONTEXT_SYNC_CHAT_LIMIT);
        const chatSeed = chatHistory.length
          ? chatHistory.slice(-bootstrapChatLimit)
          : await readChatHistory({
              limit: bootstrapChatLimit
            });
        const chatIngestion = await contextMemoryService.ingestChatHistory(chatSeed, {
          limit: bootstrapChatLimit
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
        realtimeContextIngestionEnabled = true;

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
        realtimeContextIngestionEnabled = false;

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
    const knownTabIds = new Set(tabs.map((item) => Number(item?.tabId)).filter((item) => Number.isFinite(item) && item >= 0));
    runRuntimeGarbageCollector({
      reason: 'snapshot',
      knownTabIds
    });

    const tabsForSummary = tabs.slice(0, getSystemVariableNumber('context.maxTabsForAiSummary', MAX_TABS_FOR_AI_SUMMARY));
    for (const tab of tabsForSummary) {
      enqueueTabSummary(tab);
    }

    queueContextIngestion(tabContextSnapshot);
    queueWhatsappHistorySync(tabContextSnapshot);
    void syncWhatsappAliasesFromSnapshot(tabContextSnapshot).catch(() => {});

    renderTabsContextJson();

    const activeTab = getActiveTabContext();
    if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
      logWhatsappSuggestionTrace('snapshot:received', {
        snapshotReason: toSafeLogText(snapshot.reason || '', 80),
        snapshotUpdatedAt: Number(snapshot.updatedAt) || 0,
        activeTabId: Number(tabContextSnapshot.activeTabId) || -1,
        activeIsWhatsapp: Boolean(activeTab && isWhatsappContext(activeTab)),
        active: summarizeWhatsappTraceContext(activeTab),
        state: {
          activeChatKeyCache: toSafeLogText(whatsappSuggestionActiveChatKey, 120),
          loading: whatsappSuggestionState.loading,
          signalKey: toSafeLogText(whatsappSuggestionState.signalKey, 180),
          hasText: Boolean(whatsappSuggestionState.text),
          dismissedSignalKey: toSafeLogText(whatsappSuggestionDismissedSignalKey, 180),
          hasTimer: Boolean(whatsappSuggestionRefreshTimer)
        }
      });
    }
    const canRunDynamicRelations = canRunDynamicRelationsForTab(activeTab);
    dynamicContextSignals = canRunDynamicRelations ? collectDynamicSignalsFromTab(activeTab) : { phones: [], emails: [] };
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
      clearWhatsappSuggestionRefreshTimer();
      whatsappSuggestionActiveChatKey = '';
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('snapshot:hide_non_whatsapp', {
          activeTabId: Number(tabContextSnapshot.activeTabId) || -1
        });
      }
      hideWhatsappSuggestion();
      return;
    }

    const activeChatKey = String(getWhatsappChatKey(activeTab) || '').trim();
    const previousActiveChatKey = String(whatsappSuggestionActiveChatKey || '').trim();
    const shouldForceSuggestionRefresh = Boolean(
      activeChatKey && activeChatKey !== whatsappSuggestionActiveChatKey
    );
    whatsappSuggestionActiveChatKey = activeChatKey;
    if (shouldForceSuggestionRefresh) {
      clearWhatsappSuggestionRefreshTimer();
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('snapshot:force_refresh_chat_changed', {
          activeChatKey: toSafeLogText(activeChatKey, 120),
          previousChatKey: toSafeLogText(previousActiveChatKey, 120),
          active: summarizeWhatsappTraceContext(activeTab)
        });
      }
      void generateWhatsappSuggestion(activeTab, {
        force: true,
        forceLiveHydration: true
      });
    } else {
      if (ENABLE_WHATSAPP_SUGGESTION_TRACE_LOGS) {
        logWhatsappSuggestionTrace('snapshot:schedule_refresh', {
          activeChatKey: toSafeLogText(activeChatKey, 120),
          active: summarizeWhatsappTraceContext(activeTab)
        });
      }
      scheduleWhatsappSuggestionForTab(activeTab, { force: false });
    }
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

  function resolveGeneratedChatImage(messageId, imageIndexRaw) {
    const safeMessageId = String(messageId || '').trim();
    const imageIndex = Number(imageIndexRaw);
    if (!safeMessageId || !Number.isInteger(imageIndex) || imageIndex < 0) {
      return null;
    }

    const message = chatHistory.find((entry) => String(entry?.id || '') === safeMessageId);
    if (!message) {
      return null;
    }

    const generatedImages = Array.isArray(message.generated_images) ? message.generated_images : [];
    const image = generatedImages[imageIndex] && typeof generatedImages[imageIndex] === 'object' ? generatedImages[imageIndex] : null;
    if (!image) {
      return null;
    }

    const dataUrl = normalizeGeneratedImageDataUrl(image.dataUrl || image.data_url || '');
    const url = String(image.url || '').trim();
    if (!dataUrl && !url) {
      return null;
    }

    return {
      message,
      imageIndex,
      image,
      dataUrl,
      url
    };
  }

  async function readImageBlobFromSource(source) {
    const src = String(source || '').trim();
    if (!src) {
      throw new Error('Fuente de imagen vacia.');
    }

    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`No se pudo cargar la imagen (HTTP ${response.status}).`);
    }

    const blob = await response.blob();
    if (!(blob instanceof Blob) || blob.size <= 0) {
      throw new Error('La imagen cargada esta vacia.');
    }

    return blob;
  }

  async function readGeneratedChatImageBlob(target) {
    const record = target && typeof target === 'object' ? target : {};
    const sources = [record.dataUrl, record.url].map((value) => String(value || '').trim()).filter(Boolean);
    if (!sources.length) {
      throw new Error('No hay fuente de imagen disponible.');
    }

    let lastError = null;
    for (const source of sources) {
      try {
        return await readImageBlobFromSource(source);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error('No se pudo cargar la imagen generada.');
  }

  function getImageExtensionByMimeType(mimeType) {
    const type = String(mimeType || '').trim().toLowerCase();
    if (type === 'image/jpeg' || type === 'image/jpg') {
      return 'jpg';
    }
    if (type === 'image/webp') {
      return 'webp';
    }
    if (type === 'image/gif') {
      return 'gif';
    }
    if (type === 'image/bmp') {
      return 'bmp';
    }
    return 'png';
  }

  function buildGeneratedChatImageFilename(target, mimeType = 'image/png') {
    const record = target && typeof target === 'object' ? target : {};
    const image = record.image && typeof record.image === 'object' ? record.image : {};
    const baseLabel = String(image.alt || 'generated-image')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36);
    const safeBase = baseLabel || 'generated-image';
    const idToken = String(record?.message?.id || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(-8);
    const ordinal = Number.isInteger(record.imageIndex) ? record.imageIndex + 1 : 1;
    const extension = getImageExtensionByMimeType(mimeType);
    return `${safeBase}-${idToken || Date.now()}-${ordinal}.${extension}`;
  }

  async function downloadGeneratedChatImage(messageId, imageIndexRaw, triggerButton) {
    const target = resolveGeneratedChatImage(messageId, imageIndexRaw);
    if (!target) {
      setStatus(chatStatus, 'No se encontro la imagen generada.', true);
      return;
    }

    if (triggerButton) {
      triggerButton.disabled = true;
    }

    try {
      const blob = await readGeneratedChatImageBlob(target);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = buildGeneratedChatImageFilename(target, blob.type || 'image/png');
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo descargar la imagen.';
      setStatus(chatStatus, message, true);
    } finally {
      if (triggerButton) {
        triggerButton.disabled = false;
      }
    }
  }

  async function copyGeneratedChatImage(messageId, imageIndexRaw, triggerButton) {
    const target = resolveGeneratedChatImage(messageId, imageIndexRaw);
    if (!target) {
      setStatus(chatStatus, 'No se encontro la imagen generada.', true);
      return;
    }

    if (triggerButton) {
      triggerButton.disabled = true;
    }

    try {
      const blob = await readGeneratedChatImageBlob(target);
      await writeBlobToImageClipboard(blob);
      setStatus(chatStatus, 'Imagen copiada al portapapeles.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo copiar la imagen.';
      setStatus(chatStatus, message, true);
    } finally {
      if (triggerButton) {
        triggerButton.disabled = false;
      }
    }
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
    const isToolsVisible = app && app.dataset.screen === 'tools';
    if (!isToolsVisible || !toolsScreenController) {
      return false;
    }

    return toolsScreenController.isToolDetailActive(TOOL_IDS.IMAGE);
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

  function isNoReceiverRuntimeError(errorText = '') {
    const token = String(errorText || '')
      .trim()
      .toLowerCase();
    if (!token) {
      return false;
    }

    return (
      token.includes('receiving end does not exist') ||
      token.includes('could not establish connection') ||
      token.includes('message port closed')
    );
  }

  function isBoldMovementsTabUrl(rawUrl = '') {
    const source = String(rawUrl || '').trim();
    if (!source) {
      return false;
    }

    try {
      const parsed = new URL(source);
      return (
        String(parsed.hostname || '').toLowerCase() === BOLD_MOVEMENTS_HOSTNAME &&
        String(parsed.pathname || '').startsWith(BOLD_MOVEMENTS_PATH_PREFIX)
      );
    } catch (_) {
      return false;
    }
  }

  function queryActiveTabInLastFocusedWindow() {
    return new Promise((resolve, reject) => {
      if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
        reject(new Error('API de tabs no disponible en este contexto.'));
        return;
      }

      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'No se pudo consultar la pestana activa.'));
          return;
        }

        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function sendMessageToTab(tabId, payload) {
    return new Promise((resolve) => {
      if (!chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
        resolve({
          ok: false,
          response: null,
          error: 'API de tabs no disponible en este contexto.'
        });
        return;
      }

      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            response: null,
            error: String(chrome.runtime.lastError.message || 'No se pudo enviar mensaje a la pestana.')
          });
          return;
        }

        resolve({
          ok: true,
          response,
          error: ''
        });
      });
    });
  }

  function injectBoldCsvScriptsInTab(tabId) {
    return new Promise((resolve, reject) => {
      if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
        reject(new Error('API de scripting no disponible para inyectar la tool de Bold.'));
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId },
          files: ['src/tool-config.js', 'src/content-bold-movements.js']
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'No se pudo inyectar la tool de Bold.'));
            return;
          }
          resolve(true);
        }
      );
    });
  }

  function parseBoldExportResponse(response) {
    if (!response || typeof response !== 'object') {
      return {
        message: 'Solicitud enviada. Si estas en Bold, usa el boton flotante "Descargar CSV".',
        isError: false
      };
    }

    if (response.ok === true) {
      const count = Number(response.count);
      if (Number.isFinite(count) && count > 0) {
        return {
          message: `CSV descargado con ${count} movimientos.`,
          isError: false
        };
      }

      return {
        message: String(response.message || 'CSV descargado.').trim() || 'CSV descargado.',
        isError: false
      };
    }

    const message = String(response.message || 'No se encontraron movimientos para exportar.').trim();
    return {
      message: message || 'No se encontraron movimientos para exportar.',
      isError: false
    };
  }

  async function applyBoldExportInActiveTab() {
    setStatus(boldExportStatus, 'Ejecutando exportacion...', false, { loading: true });

    let tab = null;
    try {
      tab = await queryActiveTabInLastFocusedWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo consultar la pestana activa.';
      setStatus(boldExportStatus, message, true);
      return;
    }

    if (!tab || typeof tab.id !== 'number') {
      setStatus(boldExportStatus, 'No se encontro pestana activa.', true);
      return;
    }

    if (!isBoldMovementsTabUrl(tab.url || '')) {
      setStatus(
        boldExportStatus,
        'La pestana activa no es compatible (abre la pagina de movimientos unicos en Bold).',
        true
      );
      return;
    }

    const payload = { type: APPLY_MESSAGE_TYPE };
    let attempt = await sendMessageToTab(tab.id, payload);
    if (attempt.ok) {
      const parsed = parseBoldExportResponse(attempt.response);
      setStatus(boldExportStatus, parsed.message, parsed.isError === true);
      return;
    }

    if (!isNoReceiverRuntimeError(attempt.error)) {
      setStatus(
        boldExportStatus,
        String(attempt.error || 'No se pudo ejecutar la exportacion en la pestana activa.').trim(),
        true
      );
      return;
    }

    try {
      await injectBoldCsvScriptsInTab(tab.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo inyectar la tool de Bold.';
      setStatus(
        boldExportStatus,
        `${message} Recarga la pestana de Bold y vuelve a intentar.`,
        true
      );
      return;
    }

    attempt = await sendMessageToTab(tab.id, payload);
    if (!attempt.ok) {
      setStatus(
        boldExportStatus,
        'No se pudo conectar con la herramienta de Bold en esta pestana. Recarga y vuelve a intentar.',
        true
      );
      return;
    }

    const parsed = parseBoldExportResponse(attempt.response);
    setStatus(boldExportStatus, parsed.message, parsed.isError === true);
  }

  function applyInActiveTab(options = {}) {
    const statusElement = options.statusElement || retoolStatus;
    const tabsApiUnavailableMessage = String(options.tabsApiUnavailableMessage || 'API de tabs no disponible en este contexto.').trim();
    const activeTabNotFoundMessage = String(options.activeTabNotFoundMessage || 'No se encontro pestana activa.').trim();
    const incompatibleMessage = String(
      options.incompatibleMessage || 'La pestana activa no es compatible (abre una app de Retool).'
    ).trim();
    const successMessage = String(options.successMessage || 'Tool aplicada en la pestana activa.').trim();
    const requestPayload =
      options.requestPayload && typeof options.requestPayload === 'object'
        ? { ...options.requestPayload }
        : { type: APPLY_MESSAGE_TYPE };
    const onResponse = typeof options.onResponse === 'function' ? options.onResponse : null;

    if (!chrome.tabs || !chrome.tabs.query) {
      setStatus(statusElement, tabsApiUnavailableMessage, true);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        setStatus(statusElement, activeTabNotFoundMessage, true);
        return;
      }

      chrome.tabs.sendMessage(tab.id, requestPayload, (response) => {
        if (chrome.runtime.lastError) {
          setStatus(statusElement, incompatibleMessage, true);
          return;
        }

        if (onResponse) {
          const handled = onResponse(response);
          if (typeof handled === 'string' && handled.trim()) {
            setStatus(statusElement, handled.trim(), false);
            return;
          }

          if (handled && typeof handled === 'object') {
            const message = String(handled.message || '').trim();
            if (message) {
              setStatus(statusElement, message, handled.isError === true);
              return;
            }
          }
        }

        setStatus(statusElement, successMessage);
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
    if (nuwweAutoLoginToggle) {
      nuwweAutoLoginToggle.checked = Boolean(settings[TOOL_KEYS.NUWWE_AUTO_LOGIN]);
    }
    void hydrateNuwweCredentialsToolUi().catch((error) => {
      logWarn('hydrateSettings:nuwwe_credentials_hydrate_failed', {
        error: error instanceof Error ? error.message : String(error || '')
      });
    });

    const storedTheme =
      typeof settings[PREFERENCE_KEYS.UI_THEME_MODE] === 'string'
        ? settings[PREFERENCE_KEYS.UI_THEME_MODE]
        : DEFAULT_SETTINGS[PREFERENCE_KEYS.UI_THEME_MODE];
    applyTheme(storedTheme);
  }

  async function hydratePanelSettings(options = {}) {
    if (!settingsScreenController) {
      return;
    }

    const safeOptions = options && typeof options === 'object' ? options : {};
    const syncIdentity = safeOptions.syncIdentity !== false;

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
    updateVoiceModeMetaLabel();
    renderChatSendButtonState();
    syncLocationContextToBackground(panelSettings.integrations, {
      reason: 'panel_hydrate'
    });

    const syncIdentityTask = contextMemoryService.syncIdentityProfile({
      user_name: panelSettings.displayName || ''
    });
    if (syncIdentity) {
      await syncIdentityTask;
    } else {
      void syncIdentityTask.catch((error) => {
        logWarn('hydratePanelSettings:identity_sync_failed', {
          error: error instanceof Error ? error.message : String(error || '')
        });
      });
    }
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
    scheduleInitialContextBootstrap({
      delayMs: 900
    });
  }

  async function saveUserSettingsScreen() {
    if (!settingsScreenController) {
      return;
    }

    await settingsScreenController.saveUserSettings();
    panelSettings = { ...settingsScreenController.getPanelSettings() };
    updateVoiceModeMetaLabel();
    renderChatSendButtonState();
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
    updateVoiceModeMetaLabel();
    renderChatSendButtonState();
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
      const nextVoiceTtsVoice = normalizeVoiceTtsVoice(settingsVoiceTtsVoiceSelect?.value || VOICE_TTS_VOICE);
      const nextVoiceTtsSpeed = normalizeVoiceTtsSpeed(settingsVoiceTtsSpeedInput?.value);
      const nextVoicePauseMs = normalizeVoicePauseMs(settingsVoicePauseMsInput?.value);
      const nextPrompt = String(settingsSystemPrompt?.value || '').trim();
      const current = settingsScreenController.getPanelSettings() || {};
      const currentLanguage = normalizeAssistantLanguage(current.language || DEFAULT_ASSISTANT_LANGUAGE);
      const currentVoiceTtsVoice = normalizeVoiceTtsVoice(current.voiceTtsVoice || VOICE_TTS_VOICE);
      const currentVoiceTtsSpeed = normalizeVoiceTtsSpeed(current.voiceTtsSpeed);
      const currentVoicePauseMs = normalizeVoicePauseMs(current.voicePauseMs);
      const currentPrompt = String(current.systemPrompt || '').trim();

      if (!nextPrompt) {
        setStatus(settingsAssistantStatus, 'El system prompt no puede estar vacio.', true);
        return;
      }

      if (
        nextLanguage === currentLanguage &&
        nextVoiceTtsVoice === currentVoiceTtsVoice &&
        nextVoiceTtsSpeed === currentVoiceTtsSpeed &&
        nextVoicePauseMs === currentVoicePauseMs &&
        nextPrompt === currentPrompt
      ) {
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

  async function hydrateChatHistory(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const startedAt = Date.now();
    const maxHistoryMessages = getSystemVariableNumber('chat.maxHistoryMessages', MAX_CHAT_HISTORY_MESSAGES);
    const readLimit = Math.max(
      CHAT_STARTUP_RENDER_MAX_MESSAGES + CHAT_HISTORY_READ_PADDING,
      Math.min(
        MAX_CHAT_HISTORY_STORAGE_LIMIT,
        Number(safeOptions.readLimit) || maxHistoryMessages + CHAT_HISTORY_READ_PADDING
      )
    );
    chatHistory = await readChatHistory({
      limit: readLimit
    });
    if (chatHistory.length > maxHistoryMessages) {
      chatHistory = chatHistory.slice(-maxHistoryMessages);
      await saveChatHistory();
    }
    chatHistoryRenderLimit = chatHistory.length > CHAT_STARTUP_RENDER_MAX_MESSAGES ? CHAT_STARTUP_RENDER_MAX_MESSAGES : chatHistory.length;
    syncChatBottomReserve({
      streaming: false
    });
    renderChatMessages();
    requestChatBottomAlign(20, 80);

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

    logDebug('chat_history:hydrated', {
      messages: chatHistory.length,
      readLimit,
      elapsedMs: Date.now() - startedAt
    });
  }

  function ensureChatHistoryHydrated(options = {}) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const force = safeOptions.force === true;

    if (!force && chatHistoryHydrated) {
      return Promise.resolve(chatHistory);
    }

    if (!force && chatHistoryHydrationPromise) {
      return chatHistoryHydrationPromise;
    }

    chatHistoryHydrationPromise = hydrateChatHistory(safeOptions)
      .then(() => {
        chatHistoryHydrated = true;
        return chatHistory;
      })
      .catch((error) => {
        chatHistoryHydrated = false;
        throw error;
      })
      .finally(() => {
        chatHistoryHydrationPromise = null;
      });

    return chatHistoryHydrationPromise;
  }

  function shouldRefreshLocalModelsOnBoot() {
    const activeProfile = getActiveModelProfile();
    return Boolean(ENABLE_OLLAMA_REFRESH_ON_BOOT && activeProfile && activeProfile.provider === AI_PROVIDER_IDS.OLLAMA);
  }

  async function runPostCriticalHydration(initialScreen = '') {
    const safeScreen = String(initialScreen || '').trim();
    const shouldRefreshLocalModels = shouldRefreshLocalModelsOnBoot();
    const tasks = [hydrateBrandEmotions(), ensureChatHistoryHydrated()];
    if (shouldRefreshLocalModels) {
      tasks.push(refreshLocalModels({ silent: true }));
    }
    const results = await Promise.allSettled(tasks);
    const brandResult = results[0];
    const historyResult = results[1];
    const modelsResult = shouldRefreshLocalModels ? results[2] : null;

    if (brandResult.status === 'rejected') {
      logWarn('init:hydrateBrandEmotions_failed', {
        error: brandResult.reason instanceof Error ? brandResult.reason.message : String(brandResult.reason || '')
      });
    }

    if (historyResult.status === 'rejected') {
      logWarn('init:hydrateChatHistory_failed', {
        error: historyResult.reason instanceof Error ? historyResult.reason.message : String(historyResult.reason || '')
      });
    }

    if (modelsResult && modelsResult.status === 'rejected') {
      logWarn('init:refreshLocalModels_failed', {
        error: modelsResult.reason instanceof Error ? modelsResult.reason.message : String(modelsResult.reason || '')
      });
    }

    syncModelSelectors();
    renderAiModelsSettings();

    const activeProfile = getActiveModelProfile();
    const hasReadinessWarning = applyChatModelReadinessStatus();
    if (
      ENABLE_OLLAMA_WARMUP_ON_BOOT &&
      !chatHistory.length &&
      !hasReadinessWarning &&
      activeProfile &&
      activeProfile.provider === AI_PROVIDER_IDS.OLLAMA
    ) {
      setStatus(chatStatus, `Precargando ${activeProfile.model}...`, false, { loading: true });
      warmupPrimaryModel();
    } else if (!chatHistory.length && !hasReadinessWarning && activeProfile) {
      setStatus(chatStatus, `Modelo principal: ${activeProfile.name} (${activeProfile.model}).`);
    }

    if (safeScreen === 'home') {
      requestChatBottomAlign(16, 90);
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
      openTools();
    });

    openSettingsBtn?.addEventListener('click', () => {
      openSettings();
    });

    nativeConnectorStatusBtn?.addEventListener('click', () => {
      if (isSettingsScreenActive()) {
        setSettingsPage(SETTINGS_PAGES.LOCAL_CONNECTOR);
        return;
      }

      openSettings(SETTINGS_PAGES.LOCAL_CONNECTOR);
    });

    goHomeBtn?.addEventListener('click', () => {
      if (isToolsScreenActive() && toolsScreenController?.getCurrentPage() === 'detail') {
        toolsScreenController.openHome();
        setDropUi(false);
        return;
      }

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

    settingsOpenConnectorDetailBtn?.addEventListener('click', () => {
      setSettingsPage(SETTINGS_PAGES.LOCAL_CONNECTOR);
    });

    settingsSmtpPortInput?.addEventListener('input', () => {
      const digits = String(settingsSmtpPortInput.value || '')
        .replace(/[^0-9]/g, '')
        .slice(0, 5);
      if (settingsSmtpPortInput.value !== digits) {
        settingsSmtpPortInput.value = digits;
      }
    });

    const integrationInputs = [
      settingsSmtpTransportSelect,
      settingsSmtpNativeHostInput,
      settingsSmtpAgentUrlInput,
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
        renderNativeHostBridgeSection();
      });
      input?.addEventListener('change', () => {
        scheduleIntegrationsAutosave({
          delayMs: 320
        });
        renderNativeHostBridgeSection();
      });
    }

    settingsSmtpNativeHostInput?.addEventListener('change', () => {
      const expectedHost = sanitizeNativeHostNameToken(settingsSmtpNativeHostInput.value || '', '');
      if (!expectedHost || expectedHost !== nativeHostDiagnostics.hostName) {
        nativeHostDiagnostics = {
          ok: false,
          hostName: expectedHost,
          checkedAt: 0,
          message: '',
          version: '',
          capabilities: []
        };
        renderNativeHostBridgeSection();
      }
    });

    settingsSmtpTransportSelect?.addEventListener('change', () => {
      if (normalizeSmtpTransport(settingsSmtpTransportSelect.value) === 'native_host') {
        void pingNativeHostBridge({ silent: true });
      }
    });

    settingsCustomToolsSchemaInput?.addEventListener('input', () => {
      scheduleIntegrationsAutosave({
        delayMs: 900
      });
    });

    settingsToolErrorsClearBtn?.addEventListener('click', () => {
      clearToolErrorsLog();
      setStatus(settingsIntegrationsStatus, 'Log de errores limpiado.');
    });

    settingsSmtpBridgeGuideBtn?.addEventListener('click', () => {
      const opened = openExtensionDocInNewTab('docs/README.smtp-local-bridge.md');
      if (!opened) {
        setStatus(settingsIntegrationsStatus, 'No se pudo abrir la guia local bridge.', true);
        return;
      }

      setStatus(settingsIntegrationsStatus, 'Guia local bridge abierta en una nueva pestana.');
    });

    settingsSmtpBridgePackagingBtn?.addEventListener('click', () => {
      const opened = openExtensionDocInNewTab('docs/README.smtp-native-host-packaging.md');
      if (!opened) {
        setStatus(settingsIntegrationsStatus, 'No se pudo abrir la guia de empaquetado.', true);
        return;
      }

      setStatus(settingsIntegrationsStatus, 'Guia de empaquetado abierta en una nueva pestana.');
    });

    settingsNativeHostDownloadBtn?.addEventListener('click', () => {
      try {
        const download = downloadNativeHostInstaller();
        setStatus(settingsIntegrationsStatus, `Descarga iniciada (${download.platformLabel}): ${download.filename}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo descargar complemento local.';
        setStatus(settingsIntegrationsStatus, message, true);
      }
    });

    settingsNativeHostPingBtn?.addEventListener('click', () => {
      void pingNativeHostBridge({ silent: false });
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
      logInfo('microphone:button_click', {
        visibility: document.visibilityState,
        hasFocus: document.hasFocus()
      });
      setStatus(settingsIntegrationsStatus, 'Solicitando acceso a microfono...', false, { loading: true });
      void requestMicrophonePermissionAndSync({ source: 'settings_button' }).catch((error) => {
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
      void hydrateNuwweCredentialsToolUi();
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
      updateVoiceModeMetaLabel();
      scheduleAssistantSettingsAutosave({
        delayMs: 200
      });
    });

    settingsVoiceTtsVoiceSelect?.addEventListener('change', () => {
      updateVoiceModeMetaLabel();
      scheduleAssistantSettingsAutosave({
        delayMs: 220
      });
    });

    settingsVoiceTtsSpeedInput?.addEventListener('input', () => {
      updateVoiceModeMetaLabel();
      scheduleAssistantSettingsAutosave({
        delayMs: 320
      });
    });

    settingsVoiceTtsSpeedInput?.addEventListener('change', () => {
      updateVoiceModeMetaLabel();
      scheduleAssistantSettingsAutosave({
        delayMs: 180
      });
    });

    settingsVoicePauseMsInput?.addEventListener('input', () => {
      updateVoiceModeMetaLabel();
      scheduleAssistantSettingsAutosave({
        delayMs: 280
      });
    });

    settingsVoicePauseMsInput?.addEventListener('change', () => {
      updateVoiceModeMetaLabel();
      scheduleAssistantSettingsAutosave({
        delayMs: 160
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

    chatMessagesEl?.addEventListener('click', (event) => {
      const historyActionButton = event.target.closest('[data-chat-history-action]');
      if (historyActionButton) {
        const historyAction = String(historyActionButton.dataset.chatHistoryAction || '').trim();
        if (historyAction === 'expand') {
          expandChatHistoryRenderLimit();
        }
        return;
      }

      const actionButton = event.target.closest('[data-chat-image-action]');
      if (!actionButton) {
        return;
      }

      const action = String(actionButton.dataset.chatImageAction || '').trim();
      const messageId = String(actionButton.dataset.chatMessageId || '').trim();
      const imageIndex = actionButton.dataset.chatImageIndex || '';
      if (!messageId) {
        return;
      }

      if (action === 'copy') {
        void copyGeneratedChatImage(messageId, imageIndex, actionButton);
        return;
      }

      if (action === 'download') {
        void downloadGeneratedChatImage(messageId, imageIndex, actionButton);
      }
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
      if (voiceSessionActive && String(chatInput.value || '').trim()) {
        setVoiceSessionActive(false, {
          reason: 'text_input'
        });
        if (voiceCaptureState.mode !== 'recording') {
          releaseVoiceSessionResources({
            preserveMode: voiceCaptureState.mode === 'transcribing'
          });
        }
      }
      if (voiceCaptureState.mode === 'recording' && String(chatInput.value || '').trim()) {
        void stopVoiceCapture({
          transcribe: false,
          preserveStatus: true
        });
      }
      requestChatInputResize();
    });

    chatInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
        return;
      }

      event.preventDefault();
      sendChatMessage({
        source: 'text',
        allowInterrupt: true
      });
    });

    chatSendBtn?.addEventListener('click', () => {
      if (resolveChatSendMode() === 'voice') {
        void handleVoiceSendButtonClick();
        return;
      }
      sendChatMessage({
        source: 'text',
        allowInterrupt: true
      });
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
      openTools(TOOL_IDS.IMAGE);
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

    nuwweAutoLoginToggle?.addEventListener('change', async () => {
      const ok = await saveSettings({ [TOOL_KEYS.NUWWE_AUTO_LOGIN]: nuwweAutoLoginToggle.checked });
      if (!ok) {
        setStatus(nuwweAutoLoginStatus, 'No se pudo guardar la configuracion de Nuwwe Auto Login.', true);
        return;
      }

      setStatus(nuwweAutoLoginStatus, `Nuwwe Auto Login ${nuwweAutoLoginToggle.checked ? 'activada' : 'desactivada'}.`);
    });

    nuwweSaveCredentialsBtn?.addEventListener('click', () => {
      void saveNuwweCredentialsFromToolScreen();
    });

    nuwweClearCredentialsBtn?.addEventListener('click', () => {
      void clearNuwweCredentialsFromToolScreen();
    });

    applyRetoolBtn?.addEventListener('click', () => {
      applyInActiveTab();
    });

    applyBoldExportBtn?.addEventListener('click', () => {
      void applyBoldExportInActiveTab();
    });

    window.addEventListener('beforeunload', () => {
      detachRuntimeMessageListener();
      stopRuntimeGarbageCollector();
      runtimeListenerMonitor.uninstall();
      cancelScheduledChatInputResize();
      setVoiceSessionActive(false, {
        reason: 'beforeunload',
        stopPlayback: false
      });
      if (voiceCaptureState.mode === 'recording') {
        void stopVoiceCapture({
          transcribe: false,
          preserveStatus: true,
          keepSession: false
        });
      } else {
        releaseVoiceSessionResources({
          preserveMode: voiceCaptureState.mode === 'transcribing'
        });
      }
      stopAssistantSpeechPlayback();
      clearWhatsappPromptAutosaveTimer();
      clearWhatsappSuggestionRefreshTimer();
      clearAllSettingsAutosaveTimers();
      clearInitialContextBootstrapSchedule();
      tabContextService.stop();
      void contextMemoryService.shutdown();
      brandEmotionController.destroy();
      for (const item of imageQueue) {
        releaseQueueItem(item);
      }
    });

    window.addEventListener('focus', () => {
      requestPrimaryScreenAutofocus(app?.dataset?.screen || '', 8, 70);
      scheduleStageStabilization(app?.dataset?.screen || '');
    });

    window.addEventListener('resize', () => {
      requestChatInputResize({
        immediate: true,
        forceMeasure: true
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestPrimaryScreenAutofocus(app?.dataset?.screen || '', 8, 70);
        scheduleStageStabilization(app?.dataset?.screen || '');
      }
    });
  }

  async function init() {
    const initStartedAt = Date.now();
    setAppBootstrapState(false);
    try {
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
          settingsVoiceModeMeta,
          settingsVoiceTtsVoiceSelect,
          settingsVoiceTtsSpeedInput,
          settingsVoiceTtsSpeedValue,
          settingsVoicePauseMsInput,
          settingsVoicePauseMsValue,
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
      toolsScreenController = createToolsScreenController({
        elements: {
          toolsShell,
          toolsTitle,
          goHomeBtn,
          toolsHomeScreen,
          toolsDetailScreen,
          toolsHomeList,
          toolsDetailPages
        },
        tools: TOOLS_CATALOG,
        defaultToolId: TOOL_IDS.IMAGE,
        onChange: () => {
          setDropUi(dragDepth > 0);
        }
      });
      toolsScreenController.init();

      setStageTransitionEnabled(false);
      realignStageToScreen(app?.dataset?.screen || 'onboarding');
      renderAssistantBranding();
      runtimeListenerMonitor.install();
      startRuntimeGarbageCollector();
      attachRuntimeMessageListener();
      wireEvents();
      setChatTool(DEFAULT_CHAT_TOOL);
      renderPendingConversationAttachments();
      closeToolMenu();
      updateChatInputSize({
        forceMeasure: true
      });
      renderImageQueue();
      hideWhatsappSuggestion();
      renderTabsContextJson();
      const provisionalScreen = resolveHomeOrOnboardingScreen();
      setScreen(provisionalScreen);
      requestPrimaryScreenAutofocus(provisionalScreen, 8, 70);
      setAppBootstrapState(true);
      if (provisionalScreen === 'home') {
        void ensureChatHistoryHydrated().catch((error) => {
          logWarn('init:hydrateChatHistory_early_failed', {
            error: error instanceof Error ? error.message : String(error || '')
          });
        });
      }

      const aliasHydrationPromise = hydrateWhatsappAliasBook().catch((error) => {
        logWarn('init:whatsapp_alias_hydrate_failed', {
          error: error instanceof Error ? error.message : String(error || '')
        });
      });
      const tabContextStartPromise = tabContextService.start().catch((error) => {
        logWarn('init:tab_context_start_failed', {
          error: error instanceof Error ? error.message : String(error || '')
        });
      });
      void syncWhatsappAliasesFromIndexedDb({ force: true }).catch(() => {});

      await Promise.all([
        hydrateSettings(),
        hydratePanelSettings({
          syncIdentity: false
        })
      ]);
      const initialScreen = resolveHomeOrOnboardingScreen();
      setScreen(initialScreen);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          setStageTransitionEnabled(true);
        });
      } else {
        setStageTransitionEnabled(true);
      }
      scheduleStageStabilization(initialScreen);

      if (initialScreen === 'home') {
        requestChatBottomAlign(20, 80);
      }
      requestPrimaryScreenAutofocus(initialScreen, 12, 90);

      scheduleStageStabilization(initialScreen);
      if (initialScreen === 'home') {
        scheduleInitialContextBootstrap();
      }

      void Promise.allSettled([aliasHydrationPromise, tabContextStartPromise]).then(() => {
        logDebug('init:background_core_ready', {
          elapsedMs: Date.now() - initStartedAt
        });
      });

      void runPostCriticalHydration(initialScreen).then(() => {
        logDebug('init:post_critical_ready', {
          elapsedMs: Date.now() - initStartedAt
        });
      });
    } catch (error) {
      stopRuntimeGarbageCollector();
      runtimeListenerMonitor.uninstall();
      cancelScheduledChatInputResize();
      const message = error instanceof Error ? error.message : 'No se pudo inicializar el panel.';
      setStatus(chatStatus, message, true);
      logWarn('init:error', { error: message });
    } finally {
      setAppBootstrapState(true);
    }
  }

  init();
}
