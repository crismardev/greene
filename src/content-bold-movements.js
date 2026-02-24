(() => {
  'use strict';

  const cfg = window.GreeneToolsConfig || {};
  const TOOL_KEY = (cfg.TOOL_KEYS && cfg.TOOL_KEYS.BOLD_EXPORT_MOVEMENTS_CSV) || 'tool_bold_export_movements_csv';
  const APPLY_MESSAGE_TYPE = cfg.APPLY_MESSAGE_TYPE || 'GREENE_TOOLS_APPLY';
  const DEFAULT_SETTINGS = cfg.DEFAULT_SETTINGS || { [TOOL_KEY]: true };

  const TARGET_HOSTNAME = 'cuenta.bold.co';
  const TARGET_PATH_PREFIX = '/midinero/deposito/movimientos/unicos';
  const TOOL_BUTTON_ID = 'greeneBoldCsvExportBtn';
  const TOOL_STYLE_ID = 'greeneBoldCsvExportStyle';

  let settings = { ...DEFAULT_SETTINGS };
  let syncTimer = 0;
  let observer = null;

  function isToolEnabled() {
    return Boolean(settings[TOOL_KEY]);
  }

  function isTargetPage() {
    return (
      String(location.hostname || '').toLowerCase() === TARGET_HOSTNAME &&
      String(location.pathname || '').startsWith(TARGET_PATH_PREFIX)
    );
  }

  function collectBoldMovements() {
    const container = document.querySelector('[class*="movementTable_movementTable__table"]');
    if (!container) {
      return [];
    }

    const movements = [];
    const dateGroups = container.querySelectorAll(':scope > div');

    dateGroups.forEach((group) => {
      const dateTitle = group.querySelector('[class*="dateTitle"]')?.innerText.trim();
      if (!dateTitle) {
        return;
      }

      const rows = group.querySelectorAll('div[role="button"]');

      rows.forEach((row) => {
        const pTags = row.querySelectorAll('p');
        if (pTags.length < 3) {
          return;
        }

        const description = pTags[0]?.innerText.trim() || '';
        const detail = pTags[1]?.innerText.trim() || '';
        const method = pTags[2]?.innerText.trim() || '';
        const amountElement = row.querySelector('[class*="color_red"], [class*="color_gray"], [class*="alignEnd"]');
        const amount = amountElement?.innerText.trim() || '';
        const timestamp = pTags[pTags.length - 1]?.innerText.trim() || '';

        if (!amount || description === dateTitle) {
          return;
        }

        movements.push({
          fecha_grupo: dateTitle,
          descripcion: description,
          detalle: detail,
          metodo: method,
          monto: amount,
          hora_exacta: timestamp
        });
      });
    });

    return movements;
  }

  function cleanAndEscapeCsv(text) {
    if (!text) {
      return '""';
    }

    let cleaned = text
      .toString()
      .replace(/\n|\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = cleaned.replace(/"/g, '""');
    return `"${cleaned}"`;
  }

  function buildCsvContent(movements) {
    const headers = ['Fecha Grupo', 'Descripcion', 'Detalle', 'Metodo', 'Monto', 'Fecha/Hora'];
    const csvRows = [headers.join(',')];

    movements.forEach((movement) => {
      csvRows.push(
        [
          cleanAndEscapeCsv(movement.fecha_grupo),
          cleanAndEscapeCsv(movement.descripcion),
          cleanAndEscapeCsv(movement.detalle),
          cleanAndEscapeCsv(movement.metodo),
          cleanAndEscapeCsv(movement.monto),
          cleanAndEscapeCsv(movement.hora_exacta)
        ].join(',')
      );
    });

    return csvRows.join('\n');
  }

  function triggerCsvDownload(csvContent) {
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = `bold_limpio_${new Date().toISOString().slice(0, 10)}.csv`;
    link.style.display = 'none';

    const parent = document.body || document.documentElement;
    if (!parent) {
      URL.revokeObjectURL(objectUrl);
      return false;
    }

    parent.appendChild(link);
    link.click();
    parent.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 900);
    return true;
  }

  function exportBoldMovementsToCSV() {
    if (!isToolEnabled()) {
      return {
        ok: false,
        count: 0,
        message: 'La tool Export moveemtns to csv esta desactivada.'
      };
    }

    if (!isTargetPage()) {
      return {
        ok: false,
        count: 0,
        message: 'Pagina no compatible para exportacion de movimientos Bold.'
      };
    }

    const movements = collectBoldMovements();
    if (!movements.length) {
      return {
        ok: false,
        count: 0,
        message: 'No se encontraron movimientos para exportar.'
      };
    }

    const csvContent = buildCsvContent(movements);
    const downloaded = triggerCsvDownload(csvContent);
    if (!downloaded) {
      return {
        ok: false,
        count: movements.length,
        message: 'No se pudo iniciar la descarga del CSV.'
      };
    }

    return {
      ok: true,
      count: movements.length,
      message: `Proceso finalizado. ${movements.length} movimientos reales exportados.`
    };
  }

  window.exportBoldMovementsToCSV = exportBoldMovementsToCSV;

  function ensureToolStyles() {
    if (document.getElementById(TOOL_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = TOOL_STYLE_ID;
    style.textContent = `
      #${TOOL_BUTTON_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        background: #121f18;
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.01em;
        box-shadow: 0 12px 26px rgba(0, 0, 0, 0.28);
        cursor: pointer;
      }

      #${TOOL_BUTTON_ID}:hover {
        filter: brightness(1.08);
      }
    `;
    document.documentElement.appendChild(style);
  }

  function getOrCreateToolButton() {
    let button = document.getElementById(TOOL_BUTTON_ID);
    if (button) {
      return button;
    }

    ensureToolStyles();
    button = document.createElement('button');
    button.id = TOOL_BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Descargar CSV';
    button.addEventListener('click', () => {
      exportBoldMovementsToCSV();
      scheduleSync();
    });

    (document.body || document.documentElement)?.appendChild(button);
    return button;
  }

  function removeToolButton() {
    const button = document.getElementById(TOOL_BUTTON_ID);
    if (button?.parentNode) {
      button.parentNode.removeChild(button);
    }
  }

  function syncToolButton() {
    if (!isTargetPage() || !isToolEnabled()) {
      removeToolButton();
      return;
    }

    const movements = collectBoldMovements();
    if (!movements.length) {
      removeToolButton();
      return;
    }

    const button = getOrCreateToolButton();
    button.textContent = `Descargar CSV (${movements.length})`;
  }

  function scheduleSync() {
    if (syncTimer) {
      return;
    }

    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      syncToolButton();
    }, 180);
  }

  function installObserver() {
    if (observer || !document.documentElement) {
      return;
    }

    observer = new MutationObserver(() => {
      scheduleSync();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
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

  function installRuntimeHooks() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') {
          return;
        }
        if (!changes[TOOL_KEY]) {
          return;
        }

        settings[TOOL_KEY] = Boolean(changes[TOOL_KEY].newValue);
        scheduleSync();
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== APPLY_MESSAGE_TYPE) {
          return;
        }

        const result = exportBoldMovementsToCSV();
        if (typeof sendResponse === 'function') {
          sendResponse(result);
        }
      });
    }
  }

  function main() {
    if (!isTargetPage()) {
      return;
    }

    installObserver();
    installRuntimeHooks();

    loadSettings(() => {
      scheduleSync();
      window.addEventListener('DOMContentLoaded', scheduleSync, { once: true });
      window.addEventListener('load', scheduleSync, { once: true });
    });

    window.setInterval(scheduleSync, 1500);
  }

  main();
})();
