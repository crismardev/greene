(() => {
  'use strict';

  const cfg = window.GreenStudioToolsConfig;
  if (!cfg) {
    return;
  }

  const { TOOL_KEYS, PREFERENCE_KEYS, DEFAULT_SETTINGS, APPLY_MESSAGE_TYPE } = cfg;

  const TOOL_SEQUENCE = Object.freeze(['image', 'retool']);
  const SCREEN_INDEX = Object.freeze({
    onboarding: 0,
    home: 1,
    tools: 2,
    settings: 3
  });
  const DEFAULT_CHAT_SYSTEM_PROMPT = [
    'Eres Greene, una asistente dentro de un side panel de Chrome.',
    'Tus emociones visuales disponibles son: neutral, angry, anxious, confused, excited, intrigued, disappointed, wtf.',
    'En cada respuesta incluye SIEMPRE al inicio o al final el marcador exacto: emotion:<emocion>.',
    'Solo puedes usar una emocion de la lista permitida.',
    'Responde de forma clara, concreta y accionable.',
    'Si faltan datos, pide solo la informacion minima necesaria.',
    'Cuando el usuario pida contenido largo, usa secciones cortas y legibles.',
    'No fuerces formato de email salvo que el usuario lo pida.'
  ].join('\n');
  const CHAT_TOOLS = Object.freeze({
    chat: {
      label: 'Chat',
      systemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT
    },
    write_email: {
      label: 'Write an email',
      systemPrompt: [
        'Eres un asistente para redactar emails claros y accionables.',
        'Siempre responde con un correo listo para enviar en formato:',
        'Asunto: ...',
        '',
        'Cuerpo:',
        '...',
        'Si faltan datos, usa placeholders cortos entre corchetes.'
      ].join('\n')
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
  const MAX_IMAGE_FILES = 10;
  const THEME_SEQUENCE = Object.freeze(['system', 'dark', 'light']);

  const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';
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
    VERSION: 3,
    CHAT_STORE: 'chat_state',
    CHAT_KEY: 'home_history',
    SETTINGS_STORE: 'panel_settings',
    SETTINGS_KEY: 'panel'
  });

  const PANEL_SETTINGS_DEFAULTS = Object.freeze({
    displayName: '',
    onboardingDone: false,
    systemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT,
    defaultModel: DEFAULT_OLLAMA_MODEL
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
  const toolTabs = Array.from(document.querySelectorAll('.tool-tab'));

  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const themeToggleIcon = document.getElementById('themeToggleIcon');
  const themeToggleLabel = document.getElementById('themeToggleLabel');
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
  const refreshModelsBtn = document.getElementById('refreshModelsBtn');

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
  const settingsSystemPrompt = document.getElementById('settingsSystemPrompt');
  const settingsModelSelect = document.getElementById('settingsModelSelect');
  const settingsSaveBtn = document.getElementById('settingsSaveBtn');
  const settingsStatus = document.getElementById('settingsStatus');
  const settingsRefreshModelsBtn = document.getElementById('settingsRefreshModelsBtn');

  let settings = { ...DEFAULT_SETTINGS };
  let imageQueue = [];
  let isConvertingImages = false;
  let pendingAutoProcess = false;
  let dragDepth = 0;
  let themeMode = DEFAULT_SETTINGS[PREFERENCE_KEYS.UI_THEME_MODE] || 'system';

  let chatDbPromise = null;
  let chatHistory = [];
  let selectedChatTool = DEFAULT_CHAT_TOOL;
  let panelSettings = { ...PANEL_SETTINGS_DEFAULTS };
  let currentChatModel = PANEL_SETTINGS_DEFAULTS.defaultModel;
  let availableChatModels = [];
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

  const prefersDarkMedia =
    typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function setStatus(el, message, isError = false) {
    if (!el) {
      return;
    }
    el.textContent = message;
    el.classList.toggle('is-error', isError);
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
    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        if (chrome.runtime.lastError) {
          resolve({ ...DEFAULT_SETTINGS });
          return;
        }

        resolve({ ...DEFAULT_SETTINGS, ...items });
      });
    });
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };

    return new Promise((resolve) => {
      if (!chrome.storage || !chrome.storage.sync) {
        resolve(true);
        return;
      }

      chrome.storage.sync.set(patch, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
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
    setScreen('settings');
  }

  function getActiveModel() {
    return currentChatModel || panelSettings.defaultModel || DEFAULT_OLLAMA_MODEL;
  }

  function normalizeModelName(value) {
    const modelName = String(value || '').trim();
    return modelName;
  }

  function getUniqueModelList(additional = '') {
    const list = [...availableChatModels];
    const forced = normalizeModelName(additional);
    if (forced) {
      list.push(forced);
    }

    if (panelSettings.defaultModel) {
      list.push(panelSettings.defaultModel);
    }

    list.push(DEFAULT_OLLAMA_MODEL);
    return Array.from(new Set(list.filter(Boolean)));
  }

  function fillModelSelect(selectEl, selectedValue) {
    if (!selectEl) {
      return;
    }

    const safeSelected = normalizeModelName(selectedValue);
    const models = getUniqueModelList(safeSelected);
    const previous = safeSelected || normalizeModelName(selectEl.value);

    selectEl.textContent = '';

    for (const modelName of models) {
      const option = document.createElement('option');
      option.value = modelName;
      option.textContent = modelName;
      selectEl.appendChild(option);
    }

    const resolved = previous && models.includes(previous) ? previous : models[0] || DEFAULT_OLLAMA_MODEL;
    selectEl.value = resolved;
  }

  function syncModelSelectors() {
    fillModelSelect(chatModelSelect, getActiveModel());
    fillModelSelect(settingsModelSelect, panelSettings.defaultModel || getActiveModel());
  }

  function applyPanelSettingsToUi() {
    if (onboardingNameInput) {
      onboardingNameInput.value = panelSettings.displayName || '';
    }
    if (settingsNameInput) {
      settingsNameInput.value = panelSettings.displayName || '';
    }
    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = panelSettings.systemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT;
    }

    currentChatModel = normalizeModelName(panelSettings.defaultModel) || DEFAULT_OLLAMA_MODEL;
    syncModelSelectors();
  }

  function populateSettingsForm() {
    applyPanelSettingsToUi();
    if (settingsStatus) {
      settingsStatus.textContent = '';
      settingsStatus.classList.remove('is-error');
    }
  }

  function isOnboardingComplete() {
    return panelSettings.onboardingDone === true;
  }

  function resolveHomeOrOnboardingScreen() {
    return isOnboardingComplete() ? 'home' : 'onboarding';
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

  async function fetchAvailableModelsFromOllama() {
    let lastDetail = '';

    for (const endpoint of OLLAMA_TAGS_ENDPOINTS) {
      let response;

      try {
        response = await fetch(endpoint);
      } catch (_) {
        continue;
      }

      const payload = await parseJsonSafe(response);

      if (!response.ok) {
        lastDetail = extractOllamaDetail(payload, response.status, getActiveModel());
        continue;
      }

      const modelsRaw = Array.isArray(payload?.models) ? payload.models : [];
      const names = modelsRaw
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return '';
          }

          return normalizeModelName(item.name || item.model || '');
        })
        .filter(Boolean);

      if (names.length) {
        return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
      }

      lastDetail = 'Ollama no devolvio modelos en /api/tags.';
    }

    throw new Error(lastDetail || 'No se pudo cargar /api/tags desde Ollama.');
  }

  async function refreshAvailableModels(options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) {
      setStatus(chatStatus, 'Cargando modelos...');
    }

    try {
      availableChatModels = await fetchAvailableModelsFromOllama();
      syncModelSelectors();
      if (!silent) {
        setStatus(chatStatus, `Modelos cargados: ${availableChatModels.length}.`);
        setStatus(settingsStatus, `Modelos cargados: ${availableChatModels.length}.`);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar modelos.';
      if (!silent) {
        setStatus(chatStatus, message, true);
        setStatus(settingsStatus, message, true);
      }
      syncModelSelectors();
      return false;
    }
  }

  async function updateDefaultModel(modelName) {
    const safeModel = normalizeModelName(modelName) || DEFAULT_OLLAMA_MODEL;
    currentChatModel = safeModel;
    const ok = await savePanelSettings({ defaultModel: safeModel });
    if (!ok) {
      setStatus(settingsStatus, 'No se pudo guardar el modelo default.', true);
    }
    syncModelSelectors();
    warmupLocalModel();
  }

  function canShowImageDropOverlay() {
    return app && app.dataset.screen === 'tools' && toolsScreen.dataset.tool === 'image';
  }

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
        message.role === 'system'
          ? 'System'
          : message.role === 'assistant'
            ? 'Assistant'
            : 'User';

      lines.push(`${roleLabel}: ${message.content}`);
    }

    lines.push('Assistant:');
    return lines.join('\n\n');
  }

  function extractOllamaDetail(payload, statusCode, modelName = getActiveModel()) {
    const rawDetail =
      (payload && (payload.error || payload.message || payload.detail)) || `HTTP ${statusCode}`;
    const detail = String(rawDetail);
    const safeModel = modelName || DEFAULT_OLLAMA_MODEL;

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

  async function streamWithOllamaChat(model, messages, temperature, onChunk) {
    let lastDetail = '';

    for (const endpoint of OLLAMA_CHAT_ENDPOINTS) {
      let response;

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            stream: true,
            options: {
              temperature
            },
            messages
          })
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

          const chunk = typeof payload?.message?.content === 'string' ? payload.message.content : '';
          if (!chunk) {
            return;
          }

          text += chunk;
          onChunk(chunk);
        });
      } else {
        const payload = await parseJsonSafe(response);
        const chunk = typeof payload?.message?.content === 'string' ? payload.message.content : '';
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

  async function streamWithOllamaPrompt(model, prompt, temperature, onChunk) {
    let lastDetail = '';

    for (const endpoint of OLLAMA_GENERATE_ENDPOINTS) {
      let response;

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            prompt,
            stream: true,
            options: {
              temperature
            }
          })
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

          const chunk = typeof payload?.response === 'string' ? payload.response : '';
          if (!chunk) {
            return;
          }

          text += chunk;
          onChunk(chunk);
        });
      } else {
        const payload = await parseJsonSafe(response);
        const chunk = typeof payload?.response === 'string' ? payload.response : '';
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

  async function warmupLocalModelRequest(model) {
    let lastDetail = '';

    for (const endpoint of OLLAMA_GENERATE_ENDPOINTS) {
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
            keep_alive: LOCAL_MODEL_KEEP_ALIVE,
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

  function warmupLocalModel() {
    if (modelWarmupPromise) {
      return modelWarmupPromise;
    }

    modelWarmupPromise = (async () => {
      const model = getActiveModel();

      try {
        await warmupLocalModelRequest(model);

        if (!isGeneratingChat && !chatHistory.length) {
          setStatus(chatStatus, `Modelo local listo: ${model}.`);
        }

        return true;
      } catch (error) {
        if (isGeneratingChat) {
          return false;
        }

        const message = error instanceof Error ? error.message : 'No se pudo precargar el modelo local.';
        if (message.includes('no encontrado')) {
          setStatus(chatStatus, message, true);
        } else if (!chatHistory.length) {
          setStatus(chatStatus, `Precarga no disponible. Se cargara al primer mensaje (${model}).`);
        }

        return false;
      } finally {
        modelWarmupPromise = null;
      }
    })();

    return modelWarmupPromise;
  }

  function normalizeMessage(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }

    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : '';
    if (!role) {
      return null;
    }

    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) {
      return null;
    }

    const id =
      typeof record.id === 'string' && record.id
        ? record.id
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const createdAt = Number(record.createdAt);

    return {
      id,
      role,
      content,
      tool: typeof record.tool === 'string' ? record.tool : DEFAULT_CHAT_TOOL,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
    };
  }

  function getChatDatabase() {
    if (!('indexedDB' in window)) {
      return Promise.resolve(null);
    }

    if (!chatDbPromise) {
      chatDbPromise = new Promise((resolve) => {
        const request = indexedDB.open(CHAT_DB.NAME, CHAT_DB.VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(CHAT_DB.CHAT_STORE)) {
            db.createObjectStore(CHAT_DB.CHAT_STORE, { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains(CHAT_DB.SETTINGS_STORE)) {
            db.createObjectStore(CHAT_DB.SETTINGS_STORE, { keyPath: 'key' });
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

    return chatDbPromise;
  }

  function hasDbStore(db, storeName) {
    return Boolean(db && db.objectStoreNames && db.objectStoreNames.contains(storeName));
  }

  async function readChatHistory() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, CHAT_DB.CHAT_STORE)) {
      return [];
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(CHAT_DB.CHAT_STORE, 'readonly');
      } catch {
        resolve([]);
        return;
      }
      const store = tx.objectStore(CHAT_DB.CHAT_STORE);
      const req = store.get(CHAT_DB.CHAT_KEY);

      req.onsuccess = () => {
        const raw = req.result && Array.isArray(req.result.messages) ? req.result.messages : [];
        const normalized = raw.map(normalizeMessage).filter(Boolean).slice(-MAX_CHAT_HISTORY_MESSAGES);
        resolve(normalized);
      };

      req.onerror = () => {
        resolve([]);
      };
    });
  }

  async function saveChatHistory() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, CHAT_DB.CHAT_STORE)) {
      return false;
    }

    const payload = {
      key: CHAT_DB.CHAT_KEY,
      messages: chatHistory.slice(-MAX_CHAT_HISTORY_MESSAGES),
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(CHAT_DB.CHAT_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(CHAT_DB.CHAT_STORE).put(payload);
    });
  }

  async function readPanelSettings() {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, CHAT_DB.SETTINGS_STORE)) {
      return { ...PANEL_SETTINGS_DEFAULTS };
    }

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(CHAT_DB.SETTINGS_STORE, 'readonly');
      } catch {
        resolve({ ...PANEL_SETTINGS_DEFAULTS });
        return;
      }
      const store = tx.objectStore(CHAT_DB.SETTINGS_STORE);
      const req = store.get(CHAT_DB.SETTINGS_KEY);

      req.onsuccess = () => {
        const value = req.result && typeof req.result.value === 'object' ? req.result.value : {};
        resolve({ ...PANEL_SETTINGS_DEFAULTS, ...value });
      };

      req.onerror = () => {
        resolve({ ...PANEL_SETTINGS_DEFAULTS });
      };
    });
  }

  async function savePanelSettings(nextSettings) {
    const db = await getChatDatabase();
    if (!db || !hasDbStore(db, CHAT_DB.SETTINGS_STORE)) {
      panelSettings = { ...panelSettings, ...nextSettings };
      return true;
    }

    panelSettings = { ...panelSettings, ...nextSettings };
    const payload = {
      key: CHAT_DB.SETTINGS_KEY,
      value: panelSettings,
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(CHAT_DB.SETTINGS_STORE, 'readwrite');
      } catch {
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.objectStore(CHAT_DB.SETTINGS_STORE).put(payload);
    });
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

  function getThemeIconSvg(mode) {
    if (mode === 'dark') {
      return [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<path d="M15.5 3.4a8.7 8.7 0 1 0 5.1 15.9 7.6 7.6 0 1 1-5.1-15.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>',
        '</svg>'
      ].join('');
    }

    if (mode === 'light') {
      return [
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
        '<circle cx="12" cy="12" r="4.3" fill="none" stroke="currentColor" stroke-width="1.8"></circle>',
        '<path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7M18.8 18.8l-1.7-1.7M6.9 6.9 5.2 5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
        '</svg>'
      ].join('');
    }

    return [
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
      '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.9" fill="none" stroke="currentColor" stroke-width="1.7"></rect>',
      '<path d="M8.5 19.5h7M10.2 16v3.5M13.8 16v3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>',
      '</svg>'
    ].join('');
  }

  function applyTheme(mode) {
    const safeMode = THEME_SEQUENCE.includes(mode) ? mode : 'system';
    const resolvedMode = getResolvedTheme(safeMode);

    themeMode = safeMode;
    document.documentElement.dataset.theme = resolvedMode;

    if (themeToggleLabel) {
      themeToggleLabel.textContent = getThemeLabel(safeMode);
    }

    if (themeToggleIcon) {
      themeToggleIcon.innerHTML = getThemeIconSvg(safeMode);
    }

    if (themeToggleBtn) {
      themeToggleBtn.title = `Tema: ${getThemeLabel(safeMode).toLowerCase()}`;
      themeToggleBtn.setAttribute('aria-label', `Cambiar tema. Actual: ${getThemeLabel(safeMode)}`);
    }
  }

  async function cycleTheme() {
    const currentIndex = THEME_SEQUENCE.indexOf(themeMode);
    const nextMode = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length];

    applyTheme(nextMode);
    const ok = await saveSettings({ [PREFERENCE_KEYS.UI_THEME_MODE]: nextMode });
    if (!ok) {
      setStatus(chatStatus, 'No se pudo guardar el tema.', true);
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
    bubble.textContent = visibleText || message.content;

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
      empty.textContent =
        'Escribe un mensaje para chatear con el modelo local. Enter envia, Shift+Enter agrega salto de linea.';
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

  async function pushChatMessage(role, content) {
    const text = content.trim();
    if (!text) {
      return;
    }

    chatHistory.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      role,
      content: text,
      tool: selectedChatTool,
      createdAt: Date.now()
    });

    if (chatHistory.length > MAX_CHAT_HISTORY_MESSAGES) {
      chatHistory = chatHistory.slice(-MAX_CHAT_HISTORY_MESSAGES);
    }

    renderChatMessages();
    scrollChatToBottom();
    await saveChatHistory();
  }

  async function resetChatHistory() {
    chatHistory = [];
    renderChatMessages();
    await saveChatHistory();
    setStatus(chatStatus, 'Historial limpiado.');
    startRandomEmotionCycle({ immediate: true });
  }

  function buildChatConversation() {
    const systemPrompt =
      selectedChatTool === 'chat'
        ? panelSettings.systemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT
        : CHAT_TOOLS[selectedChatTool].systemPrompt;
    const context = chatHistory
      .slice(-MAX_CHAT_CONTEXT_MESSAGES)
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

    return [{ role: 'system', content: systemPrompt }, ...context];
  }

  async function streamChatResponse(onChunk) {
    const model = getActiveModel();
    const temperature = Number(settings[PREFERENCE_KEYS.AI_TEMPERATURE] ?? DEFAULT_SETTINGS[PREFERENCE_KEYS.AI_TEMPERATURE]);
    const safeTemp = Number.isFinite(temperature) ? temperature : DEFAULT_SETTINGS[PREFERENCE_KEYS.AI_TEMPERATURE];
    const messages = buildChatConversation();
    let streamedAnyChunk = false;

    const handleChunk = (chunk) => {
      if (!chunk) {
        return;
      }

      streamedAnyChunk = true;
      onChunk(chunk);
    };

    try {
      return await streamWithOllamaChat(model, messages, safeTemp, handleChunk);
    } catch (error) {
      if (streamedAnyChunk) {
        throw error;
      }

      const prompt = buildFallbackPrompt(messages);
      return streamWithOllamaPrompt(model, prompt, safeTemp, handleChunk);
    }
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
      const activeModel = getActiveModel();
      await pushChatMessage('user', content);
      chatInput.value = '';
      updateChatInputSize();
      setStatus(chatStatus, `Conectando con ${activeModel}...`);
      stopRandomEmotionCycle();
      setBrandEmotion('intrigued');

      assistantMessage = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role: 'assistant',
        content: '',
        tool: selectedChatTool,
        createdAt: Date.now()
      };
      chatHistory.push(assistantMessage);
      renderChatMessages();
      scrollChatToBottom();

      const output = await streamChatResponse((chunk) => {
        if (!assistantMessage || !chunk) {
          return;
        }

        assistantMessage.content += chunk;
        setStatus(chatStatus, 'Escribiendo respuesta...');
        scheduleChatRender();
      });

      assistantMessage.content = assistantMessage.content.trim() || output.trim();
      if (!assistantMessage.content) {
        throw new Error('Ollama no devolvio contenido.');
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
    const stored = await readPanelSettings();
    panelSettings = { ...PANEL_SETTINGS_DEFAULTS, ...stored };
    panelSettings.displayName = String(panelSettings.displayName || '').trim();
    panelSettings.onboardingDone =
      panelSettings.onboardingDone === true || String(panelSettings.onboardingDone).toLowerCase() === 'true';
    panelSettings.systemPrompt = panelSettings.systemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT;
    panelSettings.defaultModel = normalizeModelName(panelSettings.defaultModel) || DEFAULT_OLLAMA_MODEL;
    applyPanelSettingsToUi();
  }

  async function handleOnboardingContinue() {
    const name = String(onboardingNameInput?.value || '').trim();
    if (!name) {
      setStatus(onboardingStatus, 'Escribe tu nombre para continuar.', true);
      onboardingNameInput?.focus();
      return;
    }

    const ok = await savePanelSettings({
      displayName: name,
      onboardingDone: true
    });

    if (!ok) {
      setStatus(onboardingStatus, 'No se pudo guardar onboarding.', true);
      return;
    }

    setStatus(onboardingStatus, 'Listo.');
    applyPanelSettingsToUi();
    setScreen('home');
    requestChatAutofocus(8, 70);
  }

  async function saveSettingsScreen() {
    const nextName = String(settingsNameInput?.value || '').trim();
    const nextPrompt = String(settingsSystemPrompt?.value || '').trim();
    const nextModel = normalizeModelName(settingsModelSelect?.value || '') || DEFAULT_OLLAMA_MODEL;

    if (!nextName) {
      setStatus(settingsStatus, 'El nombre no puede estar vacio.', true);
      settingsNameInput?.focus();
      return;
    }

    if (!nextPrompt) {
      setStatus(settingsStatus, 'El system prompt no puede estar vacio.', true);
      settingsSystemPrompt?.focus();
      return;
    }

    const ok = await savePanelSettings({
      displayName: nextName,
      onboardingDone: true,
      systemPrompt: nextPrompt,
      defaultModel: nextModel
    });

    if (!ok) {
      setStatus(settingsStatus, 'No se pudieron guardar settings.', true);
      return;
    }

    applyPanelSettingsToUi();
    setStatus(settingsStatus, 'Settings guardados.');
    setStatus(chatStatus, `Modelo activo: ${getActiveModel()}.`);
  }

  async function hydrateChatHistory() {
    chatHistory = await readChatHistory();
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

    settingsSaveBtn?.addEventListener('click', () => {
      saveSettingsScreen();
    });

    refreshModelsBtn?.addEventListener('click', () => {
      refreshAvailableModels({ silent: false });
    });

    settingsRefreshModelsBtn?.addEventListener('click', () => {
      refreshAvailableModels({ silent: false });
    });

    chatModelSelect?.addEventListener('change', () => {
      updateDefaultModel(chatModelSelect.value);
      setStatus(chatStatus, `Modelo activo: ${getActiveModel()}.`);
    });

    settingsModelSelect?.addEventListener('change', () => {
      fillModelSelect(settingsModelSelect, settingsModelSelect.value);
    });

    for (const tab of toolTabs) {
      tab.addEventListener('click', () => {
        setActiveTool(tab.dataset.toolTarget || 'image');
      });
    }

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        cycleTheme();
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
    setStageTransitionEnabled(false);
    wireEvents();
    observeStageSizeChanges();
    setChatTool(DEFAULT_CHAT_TOOL);
    closeToolMenu();
    updateChatInputSize();
    renderImageQueue();

    await hydrateSettings();
    await hydratePanelSettings();
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
    await refreshAvailableModels({ silent: true });
    syncModelSelectors();

    if (!chatHistory.length) {
      setStatus(chatStatus, `Precargando ${getActiveModel()}...`);
    }
    warmupLocalModel();

    if (initialScreen === 'home') {
      requestChatAutofocus(10, 80);
    } else {
      onboardingNameInput?.focus();
    }
  }

  init();
})();
