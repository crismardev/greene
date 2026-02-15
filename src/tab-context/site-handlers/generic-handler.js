(() => {
  'use strict';

  const REGISTRY_KEY = 'GreenStudioSiteHandlers';

  function getRegistry() {
    if (!window[REGISTRY_KEY]) {
      window[REGISTRY_KEY] = [];
    }

    return window[REGISTRY_KEY];
  }

  function toSafeText(value, limit = 1200) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return '';
    }

    return text.slice(0, limit);
  }

  function getDescriptionFromDom() {
    const candidates = [
      document.querySelector('meta[name="description"]'),
      document.querySelector('meta[property="og:description"]'),
      document.querySelector('meta[name="twitter:description"]')
    ];

    for (const node of candidates) {
      const content = node && typeof node.getAttribute === 'function' ? node.getAttribute('content') : '';
      const safe = toSafeText(content || '', 360);
      if (safe) {
        return safe;
      }
    }

    return '';
  }

  function getBodyTextExcerpt(limit = 2000) {
    const body = document.body;
    if (!body) {
      return '';
    }

    const text = body.innerText || body.textContent || '';
    return toSafeText(text, limit);
  }

  function collectContext(options = {}) {
    const textLimit = Number(options.textLimit) || 2000;

    return {
      site: 'generic',
      url: location.href,
      title: toSafeText(document.title || '', 280),
      description: getDescriptionFromDom(),
      textExcerpt: getBodyTextExcerpt(textLimit),
      details: {
        language: document.documentElement?.lang || '',
        pathname: location.pathname || ''
      }
    };
  }

  function observeContextChanges(onChange) {
    if (typeof onChange !== 'function' || !document.documentElement) {
      return () => {};
    }

    let timer = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        onChange('dom_mutation');
      }, 260);
    };

    const observer = new MutationObserver(() => {
      schedule();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('hashchange', schedule);

    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('hashchange', schedule);
    };
  }

  async function runAction(action) {
    if (action === 'getPageContext') {
      return {
        ok: true,
        result: collectContext({ textLimit: 2400 })
      };
    }

    return {
      ok: false,
      error: 'Accion no soportada en sitio generico.'
    };
  }

  const handler = {
    site: 'generic',
    priority: 1,
    matches() {
      return true;
    },
    collectContext,
    observeContextChanges,
    runAction
  };

  const registry = getRegistry();
  if (!registry.some((item) => item && item.site === handler.site)) {
    registry.push(handler);
  }
})();
