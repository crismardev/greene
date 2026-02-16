(() => {
  'use strict';

  const REGISTRY_KEY = 'GreeneSiteHandlers';

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

  function extractEntities(text, limit = 8) {
    const source = String(text || '');
    if (!source) {
      return [];
    }

    const matches = source.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
    const unique = [];

    for (const item of matches) {
      const token = toSafeText(item, 80);
      if (!token || token.length < 3) {
        continue;
      }

      if (!unique.includes(token)) {
        unique.push(token);
      }

      if (unique.length >= limit) {
        break;
      }
    }

    return unique;
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

  function parseWithReadability() {
    const Reader = window.Readability || globalThis.Readability;
    if (typeof Reader !== 'function') {
      return null;
    }

    let docClone = null;

    try {
      docClone = document.cloneNode(true);
    } catch (_) {
      return null;
    }

    if (!docClone) {
      return null;
    }

    try {
      const parser = new Reader(docClone, {
        charThreshold: 120,
        keepClasses: false
      });
      const article = parser.parse();
      return article && typeof article === 'object' ? article : null;
    } catch (_) {
      return null;
    }
  }

  function collectContext(options = {}) {
    const textLimit = Number(options.textLimit) || 2000;
    const article = parseWithReadability();
    const readabilityText = toSafeText(article?.textContent || '', textLimit);
    const fallbackText = getBodyTextExcerpt(textLimit);
    const mergedText = readabilityText || fallbackText;
    const titleFromReadability = toSafeText(article?.title || '', 280);
    const descriptionFromReadability = toSafeText(article?.excerpt || '', 360);
    const author = toSafeText(article?.byline || '', 160);

    return {
      site: 'generic',
      url: location.href,
      title: titleFromReadability || toSafeText(document.title || '', 280),
      description: descriptionFromReadability || getDescriptionFromDom(),
      textExcerpt: mergedText,
      details: {
        language: document.documentElement?.lang || '',
        pathname: location.pathname || '',
        author,
        articleLength: Number(article?.length) || mergedText.length || 0,
        siteName: toSafeText(article?.siteName || '', 140),
        entities: extractEntities(mergedText, 10),
        semanticSource: article ? 'readability' : 'fallback_dom'
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
