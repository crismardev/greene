(() => {
  'use strict';

  const LOG_PREFIX = '[greenstudio-ext/retool-bridge]';
  const BRIDGE_MESSAGE_TYPE = 'RETOOL_TO_EXTENSION';
  const BRIDGE_RESPONSE_TYPE = 'EXTENSION_TO_RETOOL';

  function toSafeText(value, limit = 240) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return '';
    }

    return text.slice(0, limit);
  }

  function parseSafeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }

    try {
      return new URL(raw);
    } catch (_) {
      return null;
    }
  }

  function isRetoolHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'retool.com' || host.endsWith('.retool.com');
  }

  function isCurrentPageRetool() {
    return isRetoolHost(location.hostname);
  }

  function isRetoolOrigin(origin) {
    const parsed = parseSafeUrl(origin);
    if (!parsed) {
      return false;
    }

    return parsed.protocol === 'https:' && isRetoolHost(parsed.hostname);
  }

  function isTrustedBridgeOrigin(origin) {
    const token = String(origin || '').trim();
    if (!token || token === 'null') {
      // Retool sandboxed frames can emit "null" origin.
      return true;
    }

    return isRetoolOrigin(token);
  }

  function logWarn(message, payload) {
    if (payload === undefined) {
      console.warn(`${LOG_PREFIX} ${message}`);
      return;
    }

    console.warn(`${LOG_PREFIX} ${message}`, payload);
  }

  function emitBridgeResponse(event, payload) {
    const target = event?.source && typeof event.source.postMessage === 'function' ? event.source : window;
    const targetOrigin = isRetoolOrigin(event?.origin) ? String(event.origin) : '*';

    try {
      target.postMessage(payload, targetOrigin);
    } catch (_) {
      if (target !== window) {
        try {
          window.postMessage(payload, '*');
        } catch (_) {
          // Ignore response bridge failures.
        }
      }
    }
  }

  window.addEventListener(
    'message',
    (event) => {
      if (!isCurrentPageRetool()) {
        return;
      }

      const data = event?.data;
      if (!data || typeof data !== 'object') {
        return;
      }

      if (String(data.type || '').trim() !== BRIDGE_MESSAGE_TYPE) {
        return;
      }

      if (!isTrustedBridgeOrigin(event.origin)) {
        logWarn('bridge_origin_rejected', {
          origin: toSafeText(event.origin || '', 180)
        });
        return;
      }

      const requestId = toSafeText(data.requestId || data.id || '', 120);
      const payload = data.payload && typeof data.payload === 'object' ? data.payload : null;

      if (!payload || !toSafeText(payload.type || '', 120)) {
        emitBridgeResponse(event, {
          type: BRIDGE_RESPONSE_TYPE,
          requestId,
          ok: false,
          error: 'Payload invalido para extension.'
        });
        return;
      }

      chrome.runtime.sendMessage(payload, (response) => {
        const runtimeError = chrome.runtime.lastError?.message || '';
        const safeResponse = response && typeof response === 'object' ? response : { ok: false, error: '' };
        const error = runtimeError || toSafeText(safeResponse.error || '', 280);
        const ok = !runtimeError && safeResponse.ok === true;

        emitBridgeResponse(event, {
          type: BRIDGE_RESPONSE_TYPE,
          requestId,
          ok,
          response: safeResponse,
          error
        });
      });
    },
    false
  );
})();
