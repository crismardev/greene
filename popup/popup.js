(() => {
  'use strict';

  const cfg = window.GreeneToolsConfig;
  if (!cfg) return;
  const container = document.getElementById('toolsContainer');
  const statusText = document.getElementById('statusText');
  const applyNowBtn = document.getElementById('applyNowBtn');

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(cfg.DEFAULT_SETTINGS, (items) => {
        if (chrome.runtime.lastError) {
          resolve({ ...cfg.DEFAULT_SETTINGS });
          return;
        }
        resolve({ ...cfg.DEFAULT_SETTINGS, ...items });
      });
    });
  }

  function setSetting(key, value) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [key]: value }, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  }

  function setStatus(message) {
    statusText.textContent = message;
  }

  function buildToolRow(tool, settings) {
    const row = document.createElement('article');
    row.className = 'tool';

    const info = document.createElement('div');

    const title = document.createElement('h2');
    title.className = 'tool__title';
    title.textContent = tool.title;

    const desc = document.createElement('p');
    desc.className = 'tool__desc';
    desc.textContent = tool.description;

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = tool.status === 'active' ? 'Activa' : 'Proximamente';

    if (tool.status !== 'active') {
      badge.classList.add('badge--coming');
    }

    info.appendChild(title);
    info.appendChild(desc);
    info.appendChild(badge);

    const label = document.createElement('label');
    label.className = 'switch';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(settings[tool.key]);
    input.disabled = tool.status !== 'active';
    input.setAttribute('aria-label', `Activar ${tool.title}`);

    input.addEventListener('change', async () => {
      const ok = await setSetting(tool.key, input.checked);
      setStatus(ok ? `${tool.title}: ${input.checked ? 'activada' : 'desactivada'}.` : 'No se pudo guardar la configuracion.');
    });

    const slider = document.createElement('span');
    slider.className = 'slider';

    label.appendChild(input);
    label.appendChild(slider);

    row.appendChild(info);
    row.appendChild(label);

    return row;
  }

  async function render() {
    const settings = await getSettings();
    container.innerHTML = '';

    for (const tool of cfg.TOOL_DEFINITIONS) {
      container.appendChild(buildToolRow(tool, settings));
    }
  }

  function applyInActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== 'number') {
        setStatus('No se encontro pestana activa.');
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: cfg.APPLY_MESSAGE_TYPE }, () => {
        if (chrome.runtime.lastError) {
          setStatus('Esta pestana no soporta Greene.');
          return;
        }
        setStatus('Herramientas aplicadas en la pestana activa.');
      });
    });
  }

  applyNowBtn.addEventListener('click', applyInActiveTab);
  render();
})();
