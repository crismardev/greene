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
        let targetTab = null;

        if (Number.isFinite(tabId) && tabId >= 0) {
          targetTab = tabs.find((tab) => tab.id === tabId) || null;
        }

        if (!targetTab) {
          const urlContains = String(safeArgs.urlContains || '').toLowerCase();
          const titleContains = String(safeArgs.titleContains || '').toLowerCase();
          const exactUrl = toSafeUrl(safeArgs.url);
          const closeQuery = String(safeArgs.query || '').toLowerCase().trim();

          targetTab =
            tabs.find((tab) => {
              const title = String(tab.title || '').toLowerCase();
              const url = String(tab.url || '').toLowerCase();
              const byExactUrl = exactUrl ? url === exactUrl.toLowerCase() : true;
              const byUrl = urlContains ? url.includes(urlContains) : true;
              const byTitle = titleContains ? title.includes(titleContains) : true;
              const byQuery = closeQuery ? title.includes(closeQuery) || url.includes(closeQuery) : true;
              return byExactUrl && byUrl && byTitle && byQuery;
            }) || null;

          logDebug('runBrowserAction:closeTab:search', {
            requestId,
            criteria: {
              tabId: Number.isFinite(tabId) ? tabId : null,
              exactUrl: exactUrl || '',
              urlContains,
              titleContains,
              query: closeQuery
            },
            tabCount: tabs.length,
            tabs: summarizeTabsForLogs(tabs, 30)
          });
        }

        if (!targetTab || typeof targetTab.id !== 'number') {
          logWarn(`runBrowserAction:fail:${safeAction}`, {
            requestId,
            reason: 'No tab matched for close.',
            args: safeArgs,
            tabs: summarizeTabsForLogs(tabs, 30)
          });
          return { ok: false, error: 'No se encontro pestana para cerrar.' };
        }

        if (safeArgs.preventActive === true && targetTab.active) {
          logWarn(`runBrowserAction:fail:${safeAction}`, {
            requestId,
            reason: 'Target tab active and preventActive=true.',
            targetTab: normalizeTabForTool(targetTab)
          });
          return { ok: false, error: 'La pestana objetivo esta activa y preventActive=true.' };
        }

        await removeTabs(targetTab.id);
        cleanupTabState(targetTab.id);
        if (getActiveTabId() === targetTab.id) {
          setActiveTab(-1);
          syncActiveTabFromWindow();
        }

        logDebug(`runBrowserAction:done:${safeAction}`, {
          requestId,
          closedTab: normalizeTabForTool(targetTab)
        });

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

  self.GreenStudioBackgroundBrowserActions = Object.freeze({
    createBackgroundBrowserActionsController
  });
})();
