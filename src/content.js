(() => {
  'use strict';

  const cfg = window.GreeneToolsConfig || {};
  const TOOL_KEY = (cfg.TOOL_KEYS && cfg.TOOL_KEYS.RETOOL_LAYOUT_CLEANUP) || 'tool_retool_layout_cleanup';
  const APPLY_MESSAGE_TYPE = cfg.APPLY_MESSAGE_TYPE || 'GREENE_TOOLS_APPLY';
  const DEFAULT_SETTINGS = cfg.DEFAULT_SETTINGS || { [TOOL_KEY]: true };

  const LOG_PREFIX = '[greene]';

  const HEADER_SELECTORS = [
    'div[role="banner"][aria-label="Retool Header"]',
    'button[data-testid="RetoolLogoMenu::Trigger"]',
    '[aria-label="Retool Header"]'
  ];

  const CANVAS_SELECTORS = [
    '.retool-canvas-container.retool-canvas-container--with-navigation.retool-canvas-container--is-split-frame-enabled',
    '#root > div > div.no-expiry-header > div > div > div > div > div.core-layout__viewport > div > div > div > div.presentation-container > div.presentation-canvas-padding.presentation-canvas-padding--with-pill > div.retool-canvas-container.retool-canvas-container--with-navigation.retool-canvas-container--is-split-frame-enabled'
  ];

  let scheduled = false;
  let settings = { ...DEFAULT_SETTINGS };

  function debug(message) {
    // Keep logs minimal and only for troubleshooting in DevTools.
    console.debug(`${LOG_PREFIX} ${message}`);
  }

  function isToolEnabled() {
    return Boolean(settings[TOOL_KEY]);
  }

  function loadSettings(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      callback();
      return;
    }

    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (!chrome.runtime.lastError) {
        settings = { ...DEFAULT_SETTINGS, ...items };
      }
      callback();
    });
  }

  function removeHeaderByAttributes() {
    let removed = 0;

    for (const selector of HEADER_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const banner =
          node.matches('div[role="banner"][aria-label="Retool Header"]')
            ? node
            : node.closest('div[role="banner"][aria-label="Retool Header"], [aria-label="Retool Header"]');

        if (!banner || !banner.isConnected) continue;
        banner.remove();
        removed += 1;
      }
    }

    return removed;
  }

  function patchCanvasContainer() {
    let patched = 0;

    const containers = new Set();
    for (const selector of CANVAS_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) {
        containers.add(el);
      }
    }

    for (const el of containers) {
      if (!el || !el.isConnected) continue;

      if (el.classList.contains('retool-canvas-container--with-navigation')) {
        el.classList.remove('retool-canvas-container--with-navigation');
      }

      // Defensive style override in case Retool recalculates spacing from JS.
      el.style.setProperty('padding-top', '0', 'important');
      el.style.setProperty('margin-top', '0', 'important');
      patched += 1;
    }

    return patched;
  }

  function sanitizeDom() {
    scheduled = false;

    if (!isToolEnabled()) return;

    const removedHeaders = removeHeaderByAttributes();
    const patchedCanvas = patchCanvasContainer();

    if (removedHeaders || patchedCanvas) {
      debug(`removed headers=${removedHeaders}, patched canvas=${patchedCanvas}`);
    }
  }

  function scheduleSanitize() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(sanitizeDom);
  }

  function installMutationObserver() {
    const observer = new MutationObserver(() => {
      scheduleSanitize();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'role', 'aria-label', 'data-testid']
    });
  }

  function patchDomInsertionMethods() {
    const methods = [
      [Node.prototype, 'appendChild'],
      [Node.prototype, 'insertBefore'],
      [Node.prototype, 'replaceChild'],
      [Element.prototype, 'insertAdjacentElement']
    ];

    for (const [proto, methodName] of methods) {
      const original = proto[methodName];
      if (typeof original !== 'function') continue;
      if (original.__greenePatched) continue;

      const wrapped = function (...args) {
        const result = original.apply(this, args);
        scheduleSanitize();
        return result;
      };

      Object.defineProperty(wrapped, '__greenePatched', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });

      proto[methodName] = wrapped;
    }
  }

  function installRuntimeHooks() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        if (!changes[TOOL_KEY]) return;

        settings[TOOL_KEY] = Boolean(changes[TOOL_KEY].newValue);
        scheduleSanitize();
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message) => {
        if (!message || message.type !== APPLY_MESSAGE_TYPE) return;
        scheduleSanitize();
      });
    }
  }

  function main() {
    patchDomInsertionMethods();
    installMutationObserver();
    installRuntimeHooks();

    loadSettings(() => {
      // First pass ASAP + follow-up pass after initial app mount.
      scheduleSanitize();
      window.addEventListener('DOMContentLoaded', scheduleSanitize, { once: true });
      window.addEventListener('load', scheduleSanitize, { once: true });
    });

    setInterval(scheduleSanitize, 1500);
  }

  main();
})();
