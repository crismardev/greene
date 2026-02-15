(() => {
  'use strict';

  async function enablePanelOnActionClick() {
    if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) {
      return;
    }

    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn('[greenstudio-ext/background] No se pudo activar side panel al hacer click.', error);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    enablePanelOnActionClick();
  });

  chrome.runtime.onStartup.addListener(() => {
    enablePanelOnActionClick();
  });

  enablePanelOnActionClick();
})();
