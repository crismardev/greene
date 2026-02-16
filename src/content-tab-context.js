(() => {
  'use strict';

  const MESSAGE_TYPES = Object.freeze({
    GET_TAB_CONTEXT: 'GREENE_GET_TAB_CONTEXT',
    TAB_CONTEXT_PUSH: 'GREENE_TAB_CONTEXT_PUSH',
    SITE_ACTION: 'GREENE_SITE_ACTION'
  });

  const REGISTRY_KEY = 'GreeneSiteHandlers';

  function getHandlers() {
    const handlers = Array.isArray(window[REGISTRY_KEY]) ? window[REGISTRY_KEY].slice() : [];
    handlers.sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0));
    return handlers;
  }

  function getActiveHandler() {
    const handlers = getHandlers();

    for (const handler of handlers) {
      if (!handler || typeof handler.matches !== 'function') {
        continue;
      }

      try {
        if (handler.matches(location)) {
          return handler;
        }
      } catch (_) {
        // Ignore broken handlers.
      }
    }

    return {
      site: 'generic',
      collectContext: () => ({
        site: 'generic',
        url: location.href,
        title: String(document.title || '').trim(),
        description: '',
        textExcerpt: '',
        details: {}
      }),
      observeContextChanges: () => () => {},
      runAction: async () => ({ ok: false, error: 'No hay handler activo.' })
    };
  }

  let handler = getActiveHandler();
  let cleanupObserver = () => {};
  let pushTimer = 0;

  function collectContext(reason = 'collect') {
    const activeHandler = handler || getActiveHandler();

    let context;

    try {
      context = activeHandler.collectContext({ textLimit: 2000, reason }) || {};
    } catch (error) {
      context = {
        site: activeHandler.site || 'generic',
        url: location.href,
        title: String(document.title || '').trim(),
        description: '',
        textExcerpt: '',
        details: {
          error: error instanceof Error ? error.message : 'collect_failed'
        }
      };
    }

    return {
      ...context,
      site: String(context.site || activeHandler.site || 'generic').toLowerCase(),
      url: String(context.url || location.href),
      title: String(context.title || document.title || '').trim(),
      description: String(context.description || '').trim(),
      textExcerpt: String(context.textExcerpt || '').trim(),
      details: context.details && typeof context.details === 'object' ? context.details : {},
      capturedAt: Date.now()
    };
  }

  function pushContext(reason = 'push') {
    const context = collectContext(reason);

    try {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.TAB_CONTEXT_PUSH,
        reason,
        context
      });
    } catch (_) {
      // Ignore when extension context is unavailable.
    }
  }

  function schedulePush(reason = 'schedule') {
    window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => {
      pushContext(reason);
    }, 180);
  }

  function installHandlerObserver() {
    cleanupObserver();
    cleanupObserver = () => {};

    if (!handler || typeof handler.observeContextChanges !== 'function') {
      return;
    }

    const stop = handler.observeContextChanges((reason) => {
      schedulePush(reason || 'observer_change');
    });

    if (typeof stop === 'function') {
      cleanupObserver = stop;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      return false;
    }

    if (message.type === MESSAGE_TYPES.GET_TAB_CONTEXT) {
      sendResponse({
        ok: true,
        context: collectContext(message.reason || 'request')
      });
      return false;
    }

    if (message.type === MESSAGE_TYPES.SITE_ACTION) {
      const action = String(message.action || '').trim();
      const site = String(message.site || '').trim().toLowerCase();
      const args = message.args && typeof message.args === 'object' ? message.args : {};

      if (!action) {
        sendResponse({ ok: false, error: 'Accion requerida.' });
        return false;
      }

      if (site && site !== String(handler?.site || '').toLowerCase()) {
        sendResponse({
          ok: false,
          error: `Handler activo: ${handler?.site || 'none'} no coincide con site=${site}.`
        });
        return false;
      }

      Promise.resolve(handler.runAction(action, args))
        .then((result) => {
          sendResponse(result || { ok: false, error: 'Sin respuesta de accion.' });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : 'Error ejecutando accion.'
          });
        });

      return true;
    }

    return false;
  });

  function init() {
    handler = getActiveHandler();
    installHandlerObserver();
    pushContext('init');

    document.addEventListener('visibilitychange', () => {
      schedulePush('visibility_change');
    });

    window.addEventListener('focus', () => {
      schedulePush('window_focus');
    });

    window.addEventListener('beforeunload', () => {
      cleanupObserver();
      window.clearTimeout(pushTimer);
    });

    window.setInterval(() => {
      schedulePush('heartbeat');
    }, 2500);
  }

  init();
})();
