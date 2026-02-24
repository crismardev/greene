const LOG_PREFIX = '[greene/mic-permission]';
const MICROPHONE_PERMISSION_RESULT_MESSAGE_TYPE = 'GREENE_MIC_PERMISSION_RESULT';

const statusEl = document.getElementById('micPermissionStatus');
const metaEl = document.getElementById('micPermissionMeta');
const debugEl = document.getElementById('micPermissionDebug');
const requestBtn = document.getElementById('micPermissionRequestBtn');
const closeBtn = document.getElementById('micPermissionCloseBtn');

const query = new URL(window.location.href).searchParams;
const context = {
  requestId: String(query.get('requestId') || '').trim(),
  source: String(query.get('source') || 'unknown').trim(),
  returnTabId: Math.max(0, Number(query.get('returnTabId')) || 0)
};

let requestInFlight = false;

function logInfo(message, payload) {
  if (payload === undefined) {
    console.info(`${LOG_PREFIX} ${message}`);
    appendDebugLine(`${message}`);
    return;
  }

  console.info(`${LOG_PREFIX} ${message}`, payload);
  appendDebugLine(`${message} ${JSON.stringify(payload)}`);
}

function logWarn(message, payload) {
  if (payload === undefined) {
    console.warn(`${LOG_PREFIX} ${message}`);
    appendDebugLine(`WARN ${message}`);
    return;
  }

  console.warn(`${LOG_PREFIX} ${message}`, payload);
  appendDebugLine(`WARN ${message} ${JSON.stringify(payload)}`);
}

function appendDebugLine(text) {
  if (!debugEl) {
    return;
  }
  const line = String(text || '').trim();
  if (!line) {
    return;
  }
  const timestamp = new Date().toLocaleTimeString();
  const previous = String(debugEl.textContent || '').trim();
  const lines = previous ? previous.split('\n') : [];
  lines.push(`[${timestamp}] ${line}`);
  debugEl.textContent = lines.slice(-14).join('\n');
  debugEl.scrollTop = debugEl.scrollHeight;
}

function normalizePermissionState(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase();
  if (token === 'granted' || token === 'denied' || token === 'prompt') {
    return token;
  }
  return 'prompt';
}

async function readBrowserMicrophonePermissionState() {
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return 'unsupported';
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return normalizePermissionState(status?.state);
  } catch (_) {
    return 'unsupported';
  }
}

function classifyMicrophoneError(error) {
  const name = String(error?.name || '').trim();
  const code = name.toLowerCase();
  const rawMessage = String(error?.message || '').trim();
  const messageToken = rawMessage.toLowerCase();

  if (code === 'notallowederror' && /(dismiss|closed|ignore|cancel)/i.test(messageToken)) {
    return {
      status: 'dismissed',
      code,
      name,
      rawMessage,
      permissionState: 'prompt',
      userMessage: 'Permission dismissed: se cerro el popup sin elegir.',
      hint: 'Pulsa "Solicitar microfono" y luego "Permitir".'
    };
  }

  if (code === 'notallowederror') {
    return {
      status: 'denied',
      code,
      name,
      rawMessage,
      permissionState: 'denied',
      userMessage: 'Microfono bloqueado por Chrome.',
      hint: 'Habilitalo en permisos del sitio de la extension.'
    };
  }

  if (code === 'notfounderror' || code === 'devicesnotfounderror') {
    return {
      status: 'not_found',
      code,
      name,
      rawMessage,
      permissionState: 'prompt',
      userMessage: 'No se detecto microfono disponible.',
      hint: 'Conecta uno y vuelve a intentar.'
    };
  }

  return {
    status: 'error',
    code,
    name,
    rawMessage,
    permissionState: 'prompt',
    userMessage: 'No se pudo abrir el microfono.',
    hint: rawMessage ? `Detalle: ${rawMessage}` : ''
  };
}

function setStatus(message, options = {}) {
  if (!statusEl) {
    return;
  }
  const text = String(message || '').trim();
  statusEl.textContent = text || '';
  statusEl.classList.toggle('is-loading', options.loading === true);
  statusEl.classList.toggle('is-error', options.error === true);
  statusEl.classList.toggle('is-success', options.success === true);
}

function syncButtons() {
  if (requestBtn) {
    requestBtn.disabled = requestInFlight;
    requestBtn.textContent = requestInFlight ? 'Solicitando...' : 'Solicitar microfono';
  }
}

async function sendPermissionResult(payload = {}) {
  if (!chrome?.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    return false;
  }

  const message = {
    type: MICROPHONE_PERMISSION_RESULT_MESSAGE_TYPE,
    payload: {
      requestId: context.requestId,
      source: context.source,
      timestamp: Date.now(),
      ...(payload && typeof payload === 'object' ? payload : {})
    }
  };

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime?.lastError) {
          logWarn('runtime:sendMessage:lastError', {
            error: chrome.runtime.lastError.message || ''
          });
          resolve(false);
          return;
        }

        resolve(true);
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Error enviando resultado.';
      logWarn('runtime:sendMessage:exception', { error: messageText });
      resolve(false);
    }
  });
}

function stopStreamTracks(stream) {
  const tracks = Array.isArray(stream?.getTracks?.()) ? stream.getTracks() : [];
  for (const track of tracks) {
    try {
      track.stop();
    } catch (_) {
      // Ignore cleanup issues.
    }
  }
}

async function activateReturnTab() {
  if (!Number.isFinite(context.returnTabId) || context.returnTabId <= 0) {
    return false;
  }
  if (!chrome?.tabs || typeof chrome.tabs.update !== 'function') {
    return false;
  }

  return new Promise((resolve) => {
    try {
      chrome.tabs.update(context.returnTabId, { active: true }, () => {
        if (chrome.runtime?.lastError) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function closeCurrentTab() {
  if (!chrome?.tabs || typeof chrome.tabs.getCurrent !== 'function' || typeof chrome.tabs.remove !== 'function') {
    window.close();
    return;
  }

  try {
    chrome.tabs.getCurrent((tab) => {
      if (chrome.runtime?.lastError || !tab?.id) {
        window.close();
        return;
      }

      chrome.tabs.remove(tab.id, () => {
        window.close();
      });
    });
  } catch (_) {
    window.close();
  }
}

async function requestMicrophonePermission(trigger = 'manual') {
  if (requestInFlight) {
    return false;
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setStatus('Microfono no soportado en este navegador.', { error: true });
    return false;
  }

  requestInFlight = true;
  syncButtons();

  const permissionBefore = await readBrowserMicrophonePermissionState();
  logInfo('permission:request:start', {
    trigger,
    requestId: context.requestId,
    source: context.source,
    permissionBefore,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
    isSecureContext: window.isSecureContext
  });
  setStatus('Solicitando acceso al microfono...', { loading: true });

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stopStreamTracks(stream);

    const permissionAfter = await readBrowserMicrophonePermissionState();
    logInfo('permission:request:granted', {
      trigger,
      permissionBefore,
      permissionAfter
    });
    setStatus('Permiso concedido. Regresando al panel...', {
      success: true
    });

    await sendPermissionResult({
      status: 'granted',
      permissionState: 'granted',
      permissionBefore,
      permissionAfter,
      message: 'Permiso de microfono concedido.'
    });

    await activateReturnTab();
    window.setTimeout(() => {
      closeCurrentTab();
    }, 900);
    return true;
  } catch (error) {
    stopStreamTracks(stream);

    const detail = classifyMicrophoneError(error);
    const permissionAfter = await readBrowserMicrophonePermissionState();
    logWarn('permission:request:failed', {
      trigger,
      code: detail.code,
      name: detail.name,
      rawMessage: detail.rawMessage,
      permissionBefore,
      permissionAfter
    });

    const composedMessage = [detail.userMessage, detail.hint].filter(Boolean).join(' ');
    setStatus(composedMessage, {
      error: detail.status !== 'dismissed'
    });

    await sendPermissionResult({
      status: detail.status,
      permissionState: detail.permissionState,
      permissionBefore,
      permissionAfter,
      message: composedMessage,
      errorName: detail.name,
      errorCode: detail.code
    });
    return false;
  } finally {
    requestInFlight = false;
    syncButtons();
  }
}

function init() {
  if (metaEl) {
    const sourceLabel = context.source || 'unknown';
    const requestIdLabel = context.requestId || 'n/a';
    metaEl.textContent = `Origen: ${sourceLabel} | Request: ${requestIdLabel}`;
  }

  requestBtn?.addEventListener('click', () => {
    void requestMicrophonePermission('manual_button');
  });
  closeBtn?.addEventListener('click', () => {
    closeCurrentTab();
  });

  syncButtons();
  setStatus('Preparado. Pulsa "Solicitar microfono".');

  window.setTimeout(() => {
    void requestMicrophonePermission('auto_open');
  }, 220);
}

init();
