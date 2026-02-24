(() => {
  'use strict';

  const cfg = window.GreeneToolsConfig || {};
  const TOOL_KEY = (cfg.TOOL_KEYS && cfg.TOOL_KEYS.NUWWE_AUTO_LOGIN) || 'tool_nuwwe_auto_login';
  const APPLY_MESSAGE_TYPE = cfg.APPLY_MESSAGE_TYPE || 'GREENE_TOOLS_APPLY';
  const GET_CREDENTIALS_MESSAGE_TYPE = 'GREENE_NUWWE_GET_LOGIN_CREDENTIALS';
  const DEFAULT_SETTINGS = cfg.DEFAULT_SETTINGS || { [TOOL_KEY]: true };

  const TARGET_HOSTS = new Set(['nuwwe.com', 'www.nuwwe.com']);
  const TARGET_PATH = '/login';

  let settings = { ...DEFAULT_SETTINGS };
  let syncTimer = 0;
  let observer = null;
  let autoLoginPerformed = false;
  let credentialsRequestInFlight = false;
  let syncIntervalId = 0;

  function isToolEnabled() {
    return Boolean(settings[TOOL_KEY]);
  }

  function isTargetPage() {
    const hostname = String(location.hostname || '').toLowerCase();
    const pathname = String(location.pathname || '');
    return TARGET_HOSTS.has(hostname) && pathname.startsWith(TARGET_PATH);
  }

  function setValue(element, value) {
    if (!element) {
      return;
    }

    element.value = String(value || '');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeCredentials(rawValue) {
    const source = rawValue && typeof rawValue === 'object' ? rawValue : {};
    const username = String(source.username || '').trim();
    const password = String(source.password || '').trim();
    const companyCode = String(source.companyCode || '').trim();
    if (!username || !password || !companyCode) {
      return null;
    }

    return {
      username,
      password,
      companyCode
    };
  }

  function getLoginFormElements() {
    return {
      userInput: document.getElementById('username'),
      passInput: document.getElementById('passwordfield'),
      companyInput: document.getElementById('cod_nuwwe_empresa'),
      policyCheckbox: document.getElementById('politicas'),
      loginButton: document.getElementById('loginUser')
    };
  }

  function hasReadyForm(elements) {
    if (!elements || typeof elements !== 'object') {
      return false;
    }

    return Boolean(elements.userInput && elements.passInput && elements.companyInput && elements.loginButton);
  }

  function autoLoginNuwwe(user, pass, companyCode) {
    const form = getLoginFormElements();
    if (!hasReadyForm(form)) {
      return Promise.resolve({
        ok: false,
        message: 'Formulario de Nuwwe aun no disponible.'
      });
    }

    setValue(form.userInput, user);
    setValue(form.passInput, pass);
    setValue(form.companyInput, companyCode);

    if (form.policyCheckbox && !form.policyCheckbox.checked) {
      form.policyCheckbox.click();
      form.policyCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return new Promise((resolve) => {
      const maxAttempts = 8;
      let attempts = 0;

      const trySubmit = () => {
        if (!form.loginButton || !form.loginButton.isConnected) {
          resolve({
            ok: false,
            message: 'Boton de ingreso no disponible.'
          });
          return;
        }

        if (!form.loginButton.disabled) {
          form.loginButton.click();
          resolve({
            ok: true,
            message: 'Credenciales insertadas. Ingresando...'
          });
          return;
        }

        attempts += 1;
        if (attempts >= maxAttempts) {
          resolve({
            ok: false,
            message: 'El boton sigue deshabilitado. Revisa reglas de validacion.'
          });
          return;
        }

        window.setTimeout(trySubmit, 250);
      };

      window.setTimeout(trySubmit, 500);
    });
  }

  function requestCredentialsFromBackground() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve({ ok: false, error: 'API runtime no disponible.' });
        return;
      }

      chrome.runtime.sendMessage(
        {
          type: GET_CREDENTIALS_MESSAGE_TYPE
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: String(chrome.runtime.lastError.message || 'No se pudo obtener credenciales desde background.')
            });
            return;
          }

          resolve(response && typeof response === 'object' ? response : { ok: false, error: 'Respuesta invalida.' });
        }
      );
    });
  }

  async function runNuwweAutoLogin(options = {}) {
    if (!isTargetPage()) {
      return {
        ok: false,
        message: 'Pagina no compatible para Nuwwe Auto Login.'
      };
    }

    if (!isToolEnabled()) {
      return {
        ok: false,
        message: 'La tool Nuwwe Auto Login esta desactivada.'
      };
    }

    const force = options.force === true;
    if (autoLoginPerformed && !force) {
      return {
        ok: true,
        message: 'Autologin ya ejecutado en esta carga.'
      };
    }

    const form = getLoginFormElements();
    if (!hasReadyForm(form)) {
      return {
        ok: false,
        message: 'Formulario de Nuwwe aun no disponible.'
      };
    }

    if (credentialsRequestInFlight) {
      return {
        ok: false,
        message: 'Consulta de credenciales en progreso.'
      };
    }

    credentialsRequestInFlight = true;
    try {
      const response = await requestCredentialsFromBackground();
      const credentials = normalizeCredentials(response?.credentials);
      if (!response?.ok || !credentials) {
        return {
          ok: false,
          message: String(response?.error || response?.message || 'No hay credenciales disponibles.')
        };
      }

      const result = await autoLoginNuwwe(credentials.username, credentials.password, credentials.companyCode);
      if (result.ok) {
        autoLoginPerformed = true;
      }
      return result;
    } finally {
      credentialsRequestInFlight = false;
    }
  }

  function scheduleAutoLogin(options = {}) {
    if (syncTimer) {
      return;
    }

    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      void runNuwweAutoLogin(options);
    }, 180);
  }

  function installObserver() {
    if (observer || !document.documentElement) {
      return;
    }

    observer = new MutationObserver(() => {
      if (!autoLoginPerformed) {
        scheduleAutoLogin();
      }
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
        if (!settings[TOOL_KEY]) {
          autoLoginPerformed = false;
          return;
        }
        scheduleAutoLogin();
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== APPLY_MESSAGE_TYPE) {
          return;
        }

        void runNuwweAutoLogin({ force: true })
          .then((result) => {
            if (typeof sendResponse === 'function') {
              sendResponse(result);
            }
          })
          .catch((error) => {
            if (typeof sendResponse === 'function') {
              sendResponse({
                ok: false,
                message: error instanceof Error ? error.message : 'No se pudo ejecutar Nuwwe Auto Login.'
              });
            }
          });

        return true;
      });
    }
  }

  function startPeriodicSync() {
    if (syncIntervalId) {
      return;
    }

    syncIntervalId = window.setInterval(() => {
      if (!autoLoginPerformed) {
        scheduleAutoLogin();
      }
    }, 1500);
  }

  function main() {
    if (!isTargetPage()) {
      return;
    }

    installObserver();
    installRuntimeHooks();
    startPeriodicSync();

    loadSettings(() => {
      scheduleAutoLogin();
      window.addEventListener('DOMContentLoaded', () => scheduleAutoLogin(), { once: true });
      window.addEventListener('load', () => scheduleAutoLogin(), { once: true });
    });
  }

  main();
})();
