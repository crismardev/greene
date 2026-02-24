const TOOLS_PAGES = Object.freeze({
  HOME: 'home',
  DETAIL: 'detail'
});

const DEFAULT_TOOL_ICON_URL = '../assets/icon-32.png';

function normalizeToken(value) {
  return String(value || '').trim();
}

function normalizeHostnameToken(value) {
  return normalizeToken(value)
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^\.+|\.+$/g, '');
}

function parseHostnameFromUrl(rawUrl) {
  const source = normalizeToken(rawUrl);
  if (!source) {
    return '';
  }

  try {
    const parsed = new URL(source);
    return normalizeHostnameToken(parsed.hostname);
  } catch (_) {
    const withoutScheme = source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const firstChunk = withoutScheme.split('/')[0] || '';
    return normalizeHostnameToken(firstChunk);
  }
}

const SECOND_LEVEL_CCTLD_HINTS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'net',
  'org'
]);

function resolveRootDomainToken(hostname) {
  const token = normalizeHostnameToken(hostname);
  if (!token) {
    return '';
  }

  if (token === 'localhost' || /^[\d.]+$/.test(token) || token.includes(':')) {
    return token;
  }

  const parts = token.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return token;
  }

  const tld = parts[parts.length - 1] || '';
  const secondLevel = parts[parts.length - 2] || '';
  const useThreeParts = tld.length === 2 && SECOND_LEVEL_CCTLD_HINTS.has(secondLevel) && parts.length >= 3;
  return useThreeParts ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

function normalizeToolsPage(value) {
  const token = normalizeToken(value);
  return token === TOOLS_PAGES.DETAIL ? TOOLS_PAGES.DETAIL : TOOLS_PAGES.HOME;
}

function buildDomainToken(rawUrl) {
  const hostname = parseHostnameFromUrl(rawUrl);
  return resolveRootDomainToken(hostname);
}

function resolveToolIconUrl(tool, fallbackIconUrl) {
  const customIcon = normalizeToken(tool?.iconUrl);
  if (customIcon) {
    return customIcon;
  }

  const domainToken = buildDomainToken(tool?.url);
  if (domainToken) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domainToken)}&sz=64`;
  }

  return fallbackIconUrl;
}

function normalizeToolsCatalog(rawTools) {
  const sourceList = Array.isArray(rawTools) ? rawTools : [];
  return sourceList
    .map((item) => {
      const id = normalizeToken(item?.id);
      if (!id) {
        return null;
      }

      return {
        id,
        title: normalizeToken(item?.title) || id,
        description: normalizeToken(item?.description),
        url: normalizeToken(item?.url),
        iconUrl: normalizeToken(item?.iconUrl)
      };
    })
    .filter(Boolean);
}

function normalizeToolId(value, fallbackId, toolsById) {
  const token = normalizeToken(value);
  if (token && toolsById.has(token)) {
    return token;
  }
  return fallbackId;
}

function createArrowIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M9 6l6 6-6 6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.9');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export function createToolsScreenController({
  elements,
  tools,
  defaultToolId,
  onChange
}) {
  const {
    toolsShell,
    toolsTitle,
    goHomeBtn,
    toolsHomeList,
    toolsHomeScreen,
    toolsDetailScreen,
    toolsDetailPages
  } = elements || {};

  const normalizedTools = normalizeToolsCatalog(tools);
  const fallbackToolId = normalizedTools[0]?.id || '';
  const toolsById = new Map(normalizedTools.map((item) => [item.id, item]));

  let currentPage = TOOLS_PAGES.HOME;
  let currentToolId = normalizeToolId(defaultToolId, fallbackToolId, toolsById);
  let homeEventsWired = false;

  function getCurrentTool() {
    return toolsById.get(currentToolId) || null;
  }

  function syncHeaderState() {
    const currentTool = getCurrentTool();
    const isHomePage = currentPage === TOOLS_PAGES.HOME;
    const title = isHomePage ? 'Tools' : `Tools / ${currentTool?.title || 'Tool'}`;

    if (toolsTitle) {
      toolsTitle.textContent = title;
    }

    if (goHomeBtn) {
      goHomeBtn.setAttribute('aria-label', isHomePage ? 'Volver al chat' : 'Volver a Tools');
      goHomeBtn.setAttribute('title', isHomePage ? 'Volver al chat' : 'Volver a Tools');
    }
  }

  function syncHomeAndDetailVisibility() {
    if (!toolsShell) {
      return;
    }

    const isHomePage = currentPage === TOOLS_PAGES.HOME;
    const isDetailPage = currentPage === TOOLS_PAGES.DETAIL;

    toolsShell.dataset.toolsPage = currentPage;
    toolsShell.dataset.tool = currentToolId;

    if (toolsHomeScreen) {
      toolsHomeScreen.hidden = !isHomePage;
      toolsHomeScreen.setAttribute('aria-hidden', isHomePage ? 'false' : 'true');
      if ('inert' in toolsHomeScreen) {
        toolsHomeScreen.inert = !isHomePage;
      }
    }

    if (toolsDetailScreen) {
      toolsDetailScreen.hidden = !isDetailPage;
      toolsDetailScreen.setAttribute('aria-hidden', isDetailPage ? 'false' : 'true');
      if ('inert' in toolsDetailScreen) {
        toolsDetailScreen.inert = !isDetailPage;
      }
    }

    for (const pageNode of toolsDetailPages) {
      const isCurrentDetail = isDetailPage && pageNode.dataset.toolPage === currentToolId;
      pageNode.classList.toggle('is-active', isCurrentDetail);
      pageNode.hidden = !isCurrentDetail;
      pageNode.setAttribute('aria-hidden', isCurrentDetail ? 'false' : 'true');
      if ('inert' in pageNode) {
        pageNode.inert = !isCurrentDetail;
      }
    }
  }

  function emitChange() {
    if (typeof onChange === 'function') {
      onChange({
        page: currentPage,
        toolId: currentToolId,
        tool: getCurrentTool()
      });
    }
  }

  function setPage(page, toolId = currentToolId) {
    const safePage = normalizeToolsPage(page);
    const safeToolId = normalizeToolId(toolId, fallbackToolId, toolsById);

    currentPage = safePage;
    currentToolId = safeToolId;

    syncHeaderState();
    syncHomeAndDetailVisibility();
    emitChange();
  }

  function openHome() {
    setPage(TOOLS_PAGES.HOME);
  }

  function openTool(toolId) {
    setPage(TOOLS_PAGES.DETAIL, toolId);
  }

  function getCurrentPage() {
    return currentPage;
  }

  function getCurrentToolId() {
    return currentToolId;
  }

  function isToolDetailActive(toolId) {
    const safeToolId = normalizeToolId(toolId, fallbackToolId, toolsById);
    return currentPage === TOOLS_PAGES.DETAIL && currentToolId === safeToolId;
  }

  function renderToolsHomeList() {
    if (!toolsHomeList) {
      return;
    }

    toolsHomeList.textContent = '';

    for (const tool of normalizedTools) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tools-home-card';
      card.dataset.toolOpen = tool.id;

      const iconWrap = document.createElement('span');
      iconWrap.className = 'tools-home-card__media';

      const icon = document.createElement('img');
      icon.className = 'tools-home-card__icon';
      icon.alt = '';
      icon.decoding = 'async';
      icon.loading = 'lazy';
      icon.src = resolveToolIconUrl(tool, DEFAULT_TOOL_ICON_URL);
      icon.addEventListener('error', () => {
        icon.src = DEFAULT_TOOL_ICON_URL;
      });
      iconWrap.appendChild(icon);

      const copy = document.createElement('span');
      copy.className = 'tools-home-card__copy';

      const title = document.createElement('strong');
      title.className = 'tools-home-card__title';
      title.textContent = tool.title;

      const description = document.createElement('span');
      description.className = 'tools-home-card__description';
      description.textContent = tool.description;

      copy.appendChild(title);
      copy.appendChild(description);

      const arrow = document.createElement('span');
      arrow.className = 'tools-home-card__arrow';
      arrow.appendChild(createArrowIcon());

      card.appendChild(iconWrap);
      card.appendChild(copy);
      card.appendChild(arrow);

      toolsHomeList.appendChild(card);
    }
  }

  function wireHomeEvents() {
    if (homeEventsWired || !toolsHomeList) {
      return;
    }
    homeEventsWired = true;

    toolsHomeList.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-tool-open]');
      if (!trigger) {
        return;
      }

      const requestedToolId = normalizeToken(trigger.dataset.toolOpen);
      openTool(requestedToolId);
    });
  }

  function init() {
    renderToolsHomeList();
    wireHomeEvents();
    setPage(TOOLS_PAGES.HOME, currentToolId);
  }

  return {
    init,
    setPage,
    openHome,
    openTool,
    getCurrentPage,
    getCurrentToolId,
    isToolDetailActive
  };
}
