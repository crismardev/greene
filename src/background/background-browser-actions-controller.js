(() => {
  'use strict';

  function queryTabs(queryInfo = {}) {
    return new Promise((resolve) => {
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError || !Array.isArray(tabs)) {
          resolve([]);
          return;
        }

        resolve(tabs);
      });
    });
  }

  function createTab(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          reject(new Error(chrome.runtime.lastError?.message || 'No se pudo abrir la pestana.'));
          return;
        }

        resolve(tab);
      });
    });
  }

  function removeTabs(tabIds) {
    const ids = (Array.isArray(tabIds) ? tabIds : [tabIds]).map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.remove(ids, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'No se pudo cerrar la pestana.'));
          return;
        }

        resolve(true);
      });
    });
  }

  function updateTab(tabId, updateProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, updateProperties, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          reject(new Error(chrome.runtime.lastError?.message || 'No se pudo actualizar la pestana.'));
          return;
        }

        resolve(tab);
      });
    });
  }

  function createBackgroundBrowserActionsController(options = {}) {
    const cfg = options && typeof options === 'object' ? options : {};

    const logDebug = typeof cfg.logDebug === 'function' ? cfg.logDebug : () => {};
    const logWarn = typeof cfg.logWarn === 'function' ? cfg.logWarn : () => {};
    const clamp = typeof cfg.clamp === 'function' ? cfg.clamp : (value, min, max) => Math.max(min, Math.min(max, value));
    const toSafeText = typeof cfg.toSafeText === 'function' ? cfg.toSafeText : (value) => String(value || '');
    const toSafeUrl = typeof cfg.toSafeUrl === 'function' ? cfg.toSafeUrl : (value) => String(value || '');
    const detectSiteByUrl = typeof cfg.detectSiteByUrl === 'function' ? cfg.detectSiteByUrl : () => 'generic';
    const parseTimestamp = typeof cfg.parseTimestamp === 'function' ? cfg.parseTimestamp : () => 0;
    const normalizeHistoryRecord =
      typeof cfg.normalizeHistoryRecord === 'function' ? cfg.normalizeHistoryRecord : (entry) => entry || null;
    const upsertHistoryRecord = typeof cfg.upsertHistoryRecord === 'function' ? cfg.upsertHistoryRecord : () => {};
    const queryHistory = typeof cfg.queryHistory === 'function' ? cfg.queryHistory : async () => [];
    const buildHistoryRangeArgs =
      typeof cfg.buildHistoryRangeArgs === 'function' ? cfg.buildHistoryRangeArgs : (rawArgs) => rawArgs || {};
    const summarizeHistoryRecords =
      typeof cfg.summarizeHistoryRecords === 'function' ? cfg.summarizeHistoryRecords : () => ({});
    const toIsoTimestamp = typeof cfg.toIsoTimestamp === 'function' ? cfg.toIsoTimestamp : () => '';
    const getTabById = typeof cfg.getTabById === 'function' ? cfg.getTabById : async () => null;
    const cleanupTabState = typeof cfg.cleanupTabState === 'function' ? cfg.cleanupTabState : () => {};
    const setActiveTab = typeof cfg.setActiveTab === 'function' ? cfg.setActiveTab : () => {};
    const syncActiveTabFromWindow = typeof cfg.syncActiveTabFromWindow === 'function' ? cfg.syncActiveTabFromWindow : () => {};
    const getActiveTabId = typeof cfg.getActiveTabId === 'function' ? cfg.getActiveTabId : () => -1;
    const limits = cfg.limits && typeof cfg.limits === 'object' ? cfg.limits : {};

    const EXTENDED_HISTORY_MIN_RESULTS = Number(limits.extendedHistoryMinResults) || 20;
    const EXTENDED_HISTORY_MAX_RESULTS = Number(limits.extendedHistoryMaxResults) || 600;
    const EXTENDED_HISTORY_MIN_DAYS = Number(limits.extendedHistoryMinDays) || 1;
    const EXTENDED_HISTORY_MAX_DAYS = Number(limits.extendedHistoryMaxDays) || 365;
    const OLDEST_HISTORY_DEFAULT_CHUNK = Number(limits.oldestHistoryDefaultChunk) || 320;
    const OLDEST_HISTORY_MAX_CHUNK = Number(limits.oldestHistoryMaxChunk) || 800;
    const OLDEST_HISTORY_DEFAULT_CHUNKS = Number(limits.oldestHistoryDefaultChunks) || 10;
    const OLDEST_HISTORY_MAX_CHUNKS = Number(limits.oldestHistoryMaxChunks) || 30;

    function normalizeTabForTool(tab) {
      return {
        id: Number(tab?.id) || -1,
        index: Number(tab?.index) || 0,
        windowId: Number(tab?.windowId) || -1,
        active: Boolean(tab?.active),
        pinned: Boolean(tab?.pinned),
        title: toSafeText(tab?.title || '', 220),
        url: toSafeUrl(tab?.url || ''),
        site: detectSiteByUrl(tab?.url || ''),
        lastAccessed: Number(tab?.lastAccessed) || 0
      };
    }

    function summarizeTabsForLogs(tabs, limit = 20) {
      return (Array.isArray(tabs) ? tabs : []).slice(0, limit).map((tab) => ({
        id: Number(tab?.id) || -1,
        active: Boolean(tab?.active),
        pinned: Boolean(tab?.pinned),
        title: toSafeText(tab?.title || '', 120),
        url: toSafeText(tab?.url || '', 160)
      }));
    }

    function isProductivityTab(tab) {
      if (!tab) {
        return false;
      }

      if (tab.pinned) {
        return true;
      }

      const url = String(tab.url || '').toLowerCase();
      const title = String(tab.title || '').toLowerCase();
      const productivityHostHints = [
        'notion.so',
        'calendar.google.com',
        'docs.google.com',
        'sheets.google.com',
        'slides.google.com',
        'drive.google.com',
        'github.com',
        'gitlab.com',
        'linear.app',
        'jira',
        'retool.com',
        'figma.com',
        'slack.com',
        'clickup.com',
        'asana.com',
        'trello.com'
      ];
      const productivityTitleHints = [
        'dashboard',
        'admin',
        'project',
        'workspace',
        'kanban',
        'sprint',
        'issue',
        'task',
        'documentacion',
        'docs'
      ];

      if (productivityHostHints.some((hint) => url.includes(hint))) {
        return true;
      }

      if (productivityTitleHints.some((hint) => title.includes(hint))) {
        return true;
      }

      return false;
    }

    const CLOSE_QUERY_STOPWORDS = new Set([
      'a',
      'al',
      'all',
      'close',
      'closeme',
      'cierra',
      'cierre',
      'cierrame',
      'con',
      'de',
      'del',
      'el',
      'en',
      'la',
      'las',
      'los',
      'me',
      'mi',
      'mis',
      'please',
      'por',
      'pestana',
      'pestanas',
      'pestania',
      'pestanias',
      'tab',
      'tabs',
      'the',
      'todas',
      'todos',
      'una',
      'uno',
      'y'
    ]);

    function normalizeLooseSearchText(value) {
      return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    }

    function compactSearchText(value) {
      return normalizeLooseSearchText(value).replace(/\s+/g, '');
    }

    function extractSearchTokens(value, maxTokens = 8) {
      const source = normalizeLooseSearchText(value);
      if (!source) {
        return [];
      }

      const tokens = [];
      const seen = new Set();
      for (const token of source.split(/\s+/)) {
        if (!token || token.length < 2 || CLOSE_QUERY_STOPWORDS.has(token) || seen.has(token)) {
          continue;
        }

        seen.add(token);
        tokens.push(token);
        if (tokens.length >= Math.max(1, Number(maxTokens) || 8)) {
          break;
        }
      }

      return tokens;
    }

    function parseTabUrlDetails(tab) {
      const rawUrl = String(tab?.url || '').trim();
      if (!rawUrl) {
        return {
          host: '',
          path: ''
        };
      }

      try {
        const parsed = new URL(rawUrl);
        return {
          host: normalizeLooseSearchText(parsed.hostname || ''),
          path: normalizeLooseSearchText(`${parsed.pathname || ''} ${parsed.search || ''} ${parsed.hash || ''}`)
        };
      } catch (_) {
        return {
          host: '',
          path: normalizeLooseSearchText(rawUrl)
        };
      }
    }

    function shouldCloseAllMatches(closeQuery, safeArgs = {}) {
      if (
        safeArgs.closeAll === true ||
        safeArgs.allMatches === true ||
        safeArgs.closeAllMatches === true ||
        safeArgs.multiple === true
      ) {
        return true;
      }

      const numericMaxMatches = Number(safeArgs.maxMatches);
      if (Number.isFinite(numericMaxMatches) && numericMaxMatches > 1) {
        return true;
      }

      const query = normalizeLooseSearchText(closeQuery);
      if (!query) {
        return false;
      }

      const hasPluralHint = /\b(todas?|todos|all|varias?|many|multiple|multiples)\b/.test(query);
      const hasTabsHint = /\b(tab|tabs|pestana|pestanas)\b/.test(query);
      const hasGroupPattern = /\b(todas?\s+las\s+de|todos?\s+los\s+de|all\s+the)\b/.test(query);
      return (hasPluralHint && hasTabsHint) || hasGroupPattern;
    }

    function scoreTabAgainstCloseQuery(tab, closeQuery) {
      const rawQuery = String(closeQuery || '').trim();
      if (!rawQuery) {
        return 0;
      }

      const normalizedQuery = normalizeLooseSearchText(rawQuery);
      if (!normalizedQuery) {
        return 0;
      }
      const compactQuery = compactSearchText(rawQuery);

      const title = normalizeLooseSearchText(tab?.title || '');
      const site = normalizeLooseSearchText(detectSiteByUrl(tab?.url || '') || '');
      const rawUrl = normalizeLooseSearchText(tab?.url || '');
      const { host, path } = parseTabUrlDetails(tab);
      const titleCompact = compactSearchText(title);
      const siteCompact = compactSearchText(site);
      const rawUrlCompact = compactSearchText(rawUrl);
      const hostCompact = compactSearchText(host);
      const pathCompact = compactSearchText(path);
      const tokens = extractSearchTokens(rawQuery, 10);

      let score = 0;
      if (title && title.includes(normalizedQuery)) {
        score += 85;
      }
      if (host && host.includes(normalizedQuery)) {
        score += 75;
      }
      if (rawUrl && rawUrl.includes(normalizedQuery)) {
        score += 55;
      }
      if (site && site.includes(normalizedQuery)) {
        score += 35;
      }
      if (path && path.includes(normalizedQuery)) {
        score += 25;
      }
      if (compactQuery) {
        if (titleCompact.includes(compactQuery)) {
          score += 36;
        }
        if (hostCompact.includes(compactQuery)) {
          score += 32;
        }
        if (rawUrlCompact.includes(compactQuery)) {
          score += 24;
        }
        if (siteCompact.includes(compactQuery)) {
          score += 16;
        }
        if (pathCompact.includes(compactQuery)) {
          score += 10;
        }
      }

      if (!tokens.length) {
        return score;
      }

      let tokenMatches = 0;
      for (const token of tokens) {
        let tokenScore = 0;
        if (title.includes(token)) {
          tokenScore = Math.max(tokenScore, 26);
        }
        if (host.includes(token)) {
          tokenScore = Math.max(tokenScore, 24);
        }
        if (rawUrl.includes(token)) {
          tokenScore = Math.max(tokenScore, 16);
        }
        if (path.includes(token)) {
          tokenScore = Math.max(tokenScore, 12);
        }
        if (site.includes(token)) {
          tokenScore = Math.max(tokenScore, 10);
        }
        if (tokenScore > 0) {
          tokenMatches += 1;
          score += tokenScore;
        }
      }

      if (tokenMatches === tokens.length && tokenMatches > 1) {
        score += 20;
      }

      return score;
    }

    function sortTabsByRecency(tabs) {
      const source = Array.isArray(tabs) ? tabs.slice() : [];
      source.sort((left, right) => {
        const byAccess = (Number(right?.lastAccessed) || 0) - (Number(left?.lastAccessed) || 0);
        if (byAccess) {
          return byAccess;
        }
        return (Number(left?.id) || 0) - (Number(right?.id) || 0);
      });
      return source;
    }

    async function run(action, args = {}) {
      const safeAction = String(action || '').trim();
      const safeArgs = args && typeof args === 'object' ? args : {};
      const requestId = `browser-action-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;

      logDebug(`runBrowserAction:start:${safeAction}`, {
        requestId,
        action: safeAction,
        args: safeArgs
      });

      if (safeAction === 'listTabs') {
        const tabs = await queryTabs({});
        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          tabCount: tabs.length
        });
        return {
          ok: true,
          result: tabs.map(normalizeTabForTool)
        };
      }

      if (safeAction === 'getRecentHistory') {
        const limit = Math.round(
          clamp(Number(safeArgs.limit) || 260, EXTENDED_HISTORY_MIN_RESULTS, EXTENDED_HISTORY_MAX_RESULTS)
        );
        const days = Math.round(clamp(Number(safeArgs.days) || 45, EXTENDED_HISTORY_MIN_DAYS, EXTENDED_HISTORY_MAX_DAYS));
        const text = toSafeText(safeArgs.text || '', 120);
        const startTime = Date.now() - days * 24 * 60 * 60 * 1000;
        const historyItems = await queryHistory({
          text,
          maxResults: limit,
          startTime
        });
        const records = [];

        for (const entry of historyItems) {
          const normalized = normalizeHistoryRecord(entry);
          if (!normalized) {
            continue;
          }

          records.push(normalized);
          upsertHistoryRecord(normalized);
        }

        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          count: records.length,
          days,
          limit
        });

        return {
          ok: true,
          result: {
            items: records,
            days,
            limit,
            text
          }
        };
      }

      if (safeAction === 'queryHistoryRange') {
        const range = buildHistoryRangeArgs(safeArgs);
        const historyItems = await queryHistory({
          text: range.text,
          maxResults: range.limit,
          startTime: range.startTime,
          endTime: range.endTime
        });
        const records = [];

        for (const entry of historyItems) {
          const normalized = normalizeHistoryRecord(entry);
          if (!normalized) {
            continue;
          }

          records.push(normalized);
          upsertHistoryRecord(normalized);
        }

        records.sort((a, b) =>
          range.sort === 'asc' ? (a.lastVisitTime || 0) - (b.lastVisitTime || 0) : (b.lastVisitTime || 0) - (a.lastVisitTime || 0)
        );

        const summary = summarizeHistoryRecords(records);

        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          count: records.length,
          range
        });

        return {
          ok: true,
          result: {
            items: records,
            range: {
              ...range,
              startIso: toIsoTimestamp(range.startTime),
              endIso: toIsoTimestamp(range.endTime)
            },
            summary
          }
        };
      }

      if (safeAction === 'getOldestHistoryVisit') {
        const text = toSafeText(safeArgs.text || '', 120);
        const chunkSize = Math.round(clamp(Number(safeArgs.chunkSize) || OLDEST_HISTORY_DEFAULT_CHUNK, 40, OLDEST_HISTORY_MAX_CHUNK));
        const maxChunks = Math.round(clamp(Number(safeArgs.maxChunks) || OLDEST_HISTORY_DEFAULT_CHUNKS, 1, OLDEST_HISTORY_MAX_CHUNKS));
        const rangeStart = Math.max(0, parseTimestamp(safeArgs.startTime || safeArgs.start || safeArgs.startISO || 0));
        let endTime = Math.max(0, parseTimestamp(safeArgs.endTime || safeArgs.end || safeArgs.endISO || Date.now()));
        if (!endTime) {
          endTime = Date.now();
        }

        let oldest = null;
        let scannedItems = 0;
        let chunksUsed = 0;

        for (let chunkIndex = 0; chunkIndex < maxChunks; chunkIndex += 1) {
          const items = await queryHistory({
            text,
            maxResults: chunkSize,
            startTime: rangeStart,
            endTime
          });

          if (!Array.isArray(items) || !items.length) {
            break;
          }

          chunksUsed += 1;
          const normalizedChunk = [];

          for (const entry of items) {
            const normalized = normalizeHistoryRecord(entry);
            if (!normalized) {
              continue;
            }

            normalizedChunk.push(normalized);
            upsertHistoryRecord(normalized);

            if (!oldest || normalized.lastVisitTime < oldest.lastVisitTime) {
              oldest = normalized;
            }
          }

          scannedItems += normalizedChunk.length;
          if (!normalizedChunk.length) {
            break;
          }

          const minTimestamp = normalizedChunk.reduce((lowest, item) => {
            const ts = Number(item.lastVisitTime) || 0;
            if (!lowest || (ts > 0 && ts < lowest)) {
              return ts;
            }
            return lowest;
          }, 0);

          if (!minTimestamp || minTimestamp <= rangeStart || normalizedChunk.length < chunkSize) {
            break;
          }

          endTime = minTimestamp - 1;
        }

        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          found: Boolean(oldest),
          scannedItems,
          chunksUsed
        });

        return {
          ok: true,
          result: {
            oldest,
            scannedItems,
            chunksUsed,
            approximate: chunksUsed >= maxChunks,
            rangeStart,
            rangeStartIso: toIsoTimestamp(rangeStart),
            endTime,
            endIso: toIsoTimestamp(endTime)
          }
        };
      }

      if (safeAction === 'openNewTab') {
        const targetUrl = toSafeUrl(safeArgs.url);
        const createOptions = {
          active: safeArgs.active !== false
        };

        if (targetUrl) {
          createOptions.url = targetUrl;
        }

        const tab = await createTab(createOptions);
        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          openedTab: normalizeTabForTool(tab)
        });
        return {
          ok: true,
          result: normalizeTabForTool(tab)
        };
      }

      if (safeAction === 'navigateTab') {
        const targetUrl = toSafeUrl(safeArgs.url);
        if (!targetUrl) {
          return { ok: false, error: 'URL invalida para navigateTab.' };
        }

        const tabId = Number(safeArgs.tabId);
        let selected = null;
        if (Number.isFinite(tabId) && tabId >= 0) {
          selected = await getTabById(tabId);
        }

        if (!selected) {
          const tabs = await queryTabs({});
          const urlContains = String(safeArgs.urlContains || '').toLowerCase().trim();
          const titleContains = String(safeArgs.titleContains || '').toLowerCase().trim();
          const query = String(safeArgs.query || '').toLowerCase().trim();
          selected =
            tabs.find((tab) => {
              const title = String(tab?.title || '').toLowerCase();
              const url = String(tab?.url || '').toLowerCase();
              const byUrl = urlContains ? url.includes(urlContains) : true;
              const byTitle = titleContains ? title.includes(titleContains) : true;
              const byQuery = query ? title.includes(query) || url.includes(query) : true;
              return byUrl && byTitle && byQuery;
            }) || null;
        }

        if (!selected || typeof selected.id !== 'number') {
          return { ok: false, error: 'No se encontro pestana para navegar.' };
        }

        const updated = await updateTab(selected.id, {
          url: targetUrl,
          active: safeArgs.active !== false
        });
        setActiveTab(updated.id);
        return {
          ok: true,
          result: normalizeTabForTool(updated)
        };
      }

      if (safeAction === 'focusTab') {
        const tabId = Number(safeArgs.tabId);
        let selected = null;

        if (Number.isFinite(tabId) && tabId >= 0) {
          selected = await getTabById(tabId);
        }

        if (!selected) {
          const tabs = await queryTabs({});
          const urlContains = String(safeArgs.urlContains || '').toLowerCase();
          const titleContains = String(safeArgs.titleContains || '').toLowerCase();

          selected =
            tabs.find((tab) => {
              const title = String(tab.title || '').toLowerCase();
              const url = String(tab.url || '').toLowerCase();
              const byUrl = urlContains ? url.includes(urlContains) : true;
              const byTitle = titleContains ? title.includes(titleContains) : true;
              return byUrl && byTitle;
            }) || null;
        }

        if (!selected || typeof selected.id !== 'number') {
          logWarn(`runBrowserAction:fail:${safeAction}`, {
            requestId,
            reason: 'No tab matched for focus.',
            args: safeArgs,
            tabs: summarizeTabsForLogs(await queryTabs({}), 30)
          });
          return { ok: false, error: 'No se encontro pestana para enfocar.' };
        }

        const updated = await updateTab(selected.id, { active: true });
        setActiveTab(updated.id);
        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          focusedTab: normalizeTabForTool(updated)
        });
        return {
          ok: true,
          result: normalizeTabForTool(updated)
        };
      }

      if (safeAction === 'closeTab') {
        const tabId = Number(safeArgs.tabId);
        const tabs = await queryTabs({});
        const urlContains = String(safeArgs.urlContains || '').toLowerCase().trim();
        const titleContains = String(safeArgs.titleContains || '').toLowerCase().trim();
        const exactUrl = toSafeUrl(safeArgs.url);
        const closeQuery = String(safeArgs.query || '').trim();
        const preventActive = safeArgs.preventActive === true;
        const hasValidTabId = Number.isFinite(tabId) && tabId >= 0;
        const selectorProvided = hasValidTabId || Boolean(exactUrl || urlContains || titleContains || closeQuery);
        if (!selectorProvided) {
          return { ok: false, error: 'browser.closeTab requiere tabId o un selector (url/urlContains/titleContains/query).' };
        }

        let matchedTabs = [];
        if (hasValidTabId) {
          const byId = tabs.find((tab) => tab.id === tabId);
          matchedTabs = byId ? [byId] : [];
        } else {
          matchedTabs = tabs.filter((tab) => {
            const title = String(tab.title || '').toLowerCase();
            const url = String(tab.url || '').toLowerCase();
            const byExactUrl = exactUrl ? url === exactUrl.toLowerCase() : true;
            const byUrl = urlContains ? url.includes(urlContains) : true;
            const byTitle = titleContains ? title.includes(titleContains) : true;
            return byExactUrl && byUrl && byTitle;
          });
        }

        if (closeQuery) {
          const scoredMatches = matchedTabs
            .map((tab) => ({
              tab,
              score: scoreTabAgainstCloseQuery(tab, closeQuery)
            }))
            .filter((item) => item.score > 0)
            .sort((left, right) => {
              if (right.score !== left.score) {
                return right.score - left.score;
              }
              return (Number(right.tab?.lastAccessed) || 0) - (Number(left.tab?.lastAccessed) || 0);
            });

          if (scoredMatches.length) {
            matchedTabs = scoredMatches.map((item) => item.tab);
          } else if (!exactUrl && !urlContains && !titleContains && !(Number.isFinite(tabId) && tabId >= 0)) {
            matchedTabs = [];
          }
        }

        logDebug('runBrowserAction:closeTab:search', {
          requestId,
          criteria: {
            tabId: hasValidTabId ? tabId : null,
            exactUrl: exactUrl || '',
            urlContains,
            titleContains,
            query: closeQuery,
            preventActive
          },
          tabCount: tabs.length,
          matchedCount: matchedTabs.length,
          matches: summarizeTabsForLogs(matchedTabs, 40),
          tabs: summarizeTabsForLogs(tabs, 30)
        });

        if (!matchedTabs.length) {
          logWarn(`runBrowserAction:fail:${safeAction}`, {
            requestId,
            reason: 'No tab matched for close.',
            args: safeArgs,
            tabs: summarizeTabsForLogs(tabs, 30)
          });
          return { ok: false, error: 'No se encontro pestana para cerrar.' };
        }

        const closeMany = shouldCloseAllMatches(closeQuery, safeArgs);
        const safeMaxMatches = Math.round(clamp(Number(safeArgs.maxMatches) || (closeMany ? 24 : 1), 1, 120));
        let candidates = closeMany ? matchedTabs.slice(0, safeMaxMatches) : [matchedTabs[0]];
        candidates = sortTabsByRecency(candidates);

        if (preventActive) {
          candidates = candidates.filter((tab) => !tab?.active);
        }

        if (!candidates.length) {
          logWarn(`runBrowserAction:fail:${safeAction}`, {
            requestId,
            reason: 'All matched tabs filtered by preventActive=true.',
            args: safeArgs,
            matchedTabs: summarizeTabsForLogs(matchedTabs, 30)
          });
          return { ok: false, error: 'No hay pestanas para cerrar despues de aplicar preventActive=true.' };
        }

        const targetTab = candidates[0];
        const closeIds = candidates.map((tab) => tab.id).filter((id) => Number.isFinite(Number(id)));
        await removeTabs(closeIds);
        for (const tab of candidates) {
          cleanupTabState(tab.id);
        }
        if (closeIds.includes(getActiveTabId())) {
          setActiveTab(-1);
          syncActiveTabFromWindow();
        }

        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          closeMany,
          closedCount: candidates.length,
          closedTabs: candidates.map((tab) => normalizeTabForTool(tab))
        });

        if (closeMany) {
          return {
            ok: true,
            result: {
              closed: candidates.length,
              mode: 'multiple',
              query: closeQuery,
              tabs: candidates.map((tab) => normalizeTabForTool(tab))
            }
          };
        }

        return {
          ok: true,
          result: normalizeTabForTool(targetTab)
        };
      }

      if (safeAction === 'closeNonProductivityTabs') {
        const keepActive = safeArgs.keepActive !== false;
        const keepPinned = safeArgs.keepPinned !== false;
        const dryRun = safeArgs.dryRun === true;
        const onlyCurrentWindow = safeArgs.onlyCurrentWindow !== false;

        const tabs = await queryTabs(onlyCurrentWindow ? { currentWindow: true } : {});
        const candidates = tabs.filter((tab) => {
          if (keepActive && tab.active) {
            return false;
          }
          if (keepPinned && tab.pinned) {
            return false;
          }
          return !isProductivityTab(tab);
        });

        if (!candidates.length) {
          logDebug(`runBrowserAction:done:${safeAction}`, {
            requestId,
            closed: 0,
            reason: 'No candidate tabs for closure.'
          });
          return {
            ok: true,
            result: {
              closed: 0,
              tabs: []
            }
          };
        }

        if (!dryRun) {
          await removeTabs(candidates.map((tab) => tab.id));
          for (const tab of candidates) {
            cleanupTabState(tab.id);
          }
        }

        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          closed: dryRun ? 0 : candidates.length,
          dryRun,
          tabs: candidates.map(normalizeTabForTool)
        });
        return {
          ok: true,
          result: {
            closed: dryRun ? 0 : candidates.length,
            dryRun,
            tabs: candidates.map(normalizeTabForTool)
          }
        };
      }

      logWarn(`runBrowserAction:fail:${safeAction}`, {
        requestId,
        reason: 'Unsupported browser action.'
      });
      return {
        ok: false,
        error: `Accion de browser no soportada: ${safeAction || 'unknown'}`
      };
    }

    return {
      run
    };
  }

  self.GreeneBackgroundBrowserActions = Object.freeze({
    createBackgroundBrowserActionsController
  });
})();
