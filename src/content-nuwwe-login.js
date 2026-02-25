(() => {
  'use strict';

  const cfg = window.GreeneToolsConfig || {};
  const TOOL_KEY = (cfg.TOOL_KEYS && cfg.TOOL_KEYS.NUWWE_AUTO_LOGIN) || 'tool_nuwwe_auto_login';
  const APPLY_MESSAGE_TYPE = cfg.APPLY_MESSAGE_TYPE || 'GREENE_TOOLS_APPLY';
  const GET_CREDENTIALS_MESSAGE_TYPE = 'GREENE_NUWWE_GET_LOGIN_CREDENTIALS';
  const DEFAULT_SETTINGS = cfg.DEFAULT_SETTINGS || { [TOOL_KEY]: true };
  const LOG_PREFIX = '[greene/nuwwe-login]';

  const TARGET_BASE_HOST = 'nuwwe.com';
  const TARGET_PATH = '/login';
  const HOME_PATH_PREFIX = '/home';
  const SESSION_MODAL_TITLE_TOKEN = 'desea continuar';
  const SESSION_MODAL_CONFIRM_CLASS_TOKEN = 'initSettingAlertConfirmCustom';
  const POST_SUBMIT_WATCH_TIMEOUT_MS = 26000;
  const POST_SUBMIT_WATCH_POLL_MS = 320;
  const POST_SUBMIT_MUTATION_THROTTLE_MS = 140;
  const AUTO_LOGIN_INITIAL_DELAY_MS = 160;
  const AUTO_LOGIN_OBSERVER_THROTTLE_MS = 220;
  const AUTO_LOGIN_RETRY_BASE_MS = 420;
  const AUTO_LOGIN_RETRY_STEP_MS = 220;
  const AUTO_LOGIN_RETRY_MAX_MS = 2600;
  const AUTO_LOGIN_MAX_ATTEMPTS = 18;

  let settings = { ...DEFAULT_SETTINGS };
  let syncTimer = 0;
  let retryTimer = 0;
  let observerThrottleTimer = 0;
  let observer = null;
  let autoLoginPerformed = false;
  let autoLoginAttempts = 0;
  let credentialsRequestInFlight = false;
  let cachedCredentials = null;
  let postSubmitWatchActive = false;
  let postSubmitWatchTimer = 0;
  let postSubmitTimeoutTimer = 0;
  let postSubmitMutationThrottleTimer = 0;
  let postSubmitObserver = null;
  let postSubmitModalClickCount = 0;

  function logDebug(message, payload) {
    if (payload === undefined) {
      console.debug(`${LOG_PREFIX} ${message}`);
      return;
    }
    console.debug(`${LOG_PREFIX} ${message}`, payload);
  }

  function logWarn(message, payload) {
    if (payload === undefined) {
      console.warn(`${LOG_PREFIX} ${message}`);
      return;
    }
    console.warn(`${LOG_PREFIX} ${message}`, payload);
  }

  function isTargetHost(hostname) {
    const host = String(hostname || '').toLowerCase().trim();
    return host === TARGET_BASE_HOST || host.endsWith(`.${TARGET_BASE_HOST}`);
  }

  function buildPageSnapshot() {
    const origin = String(location.origin || '').trim();
    const pathname = String(location.pathname || '').trim();
    return {
      origin,
      pathname,
      hostname: String(location.hostname || '').toLowerCase(),
      href: `${origin}${pathname}`,
      hasQuery: Boolean(String(location.search || '').trim()),
      readyState: String(document.readyState || '').toLowerCase() || 'unknown'
    };
  }

  function evaluateTargetPage() {
    const page = buildPageSnapshot();
    const matchesHost = isTargetHost(page.hostname);
    const matchesPath = page.pathname.startsWith(TARGET_PATH);
    return {
      ...page,
      matchesHost,
      matchesPath,
      isTarget: matchesHost && matchesPath
    };
  }

  function summarizeFormAvailability(elements) {
    const source = elements && typeof elements === 'object' ? elements : {};
    return {
      userInput: Boolean(source.userInput),
      passInput: Boolean(source.passInput),
      companyInput: Boolean(source.companyInput),
      policyCheckbox: Boolean(source.policyCheckbox),
      loginButton: Boolean(source.loginButton)
    };
  }

  function summarizeCredentials(credentials) {
    const source = credentials && typeof credentials === 'object' ? credentials : {};
    const username = String(source.username || '');
    const password = String(source.password || '');
    const companyCode = String(source.companyCode || '');
    return {
      hasUsername: Boolean(username.trim()),
      hasPassword: Boolean(password.trim()),
      hasCompanyCode: Boolean(companyCode.trim()),
      usernameLength: username.length,
      passwordLength: password.length,
      companyCodeLength: companyCode.length
    };
  }

  function isToolEnabled() {
    return Boolean(settings[TOOL_KEY]);
  }

  function isTargetPage() {
    return evaluateTargetPage().isTarget;
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

  function normalizeLooseText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isLoginPath(pathname = location.pathname) {
    return String(pathname || '').startsWith(TARGET_PATH);
  }

  function isHomePath(pathname = location.pathname) {
    return String(pathname || '').startsWith(HOME_PATH_PREFIX);
  }

  function findContinueSessionModal() {
    if (!isLoginPath()) {
      return null;
    }

    const titleNodes = Array.from(document.querySelectorAll('.swal-title'));
    const titleNode = titleNodes.find((node) =>
      normalizeLooseText(node && node.textContent ? node.textContent : '').includes(SESSION_MODAL_TITLE_TOKEN)
    );
    if (!titleNode) {
      return null;
    }

    const modalRoot = titleNode.closest('.swal-modal') || document.querySelector('.swal-modal') || document;
    const queryRoot = modalRoot && typeof modalRoot.querySelectorAll === 'function' ? modalRoot : document;
    const buttonCandidates = Array.from(queryRoot.querySelectorAll('button'));
    const classMatchedButton = buttonCandidates.find((button) =>
      String(button.className || '').includes(SESSION_MODAL_CONFIRM_CLASS_TOKEN)
    );
    const fallbackButton = queryRoot.querySelector('.swal-footer div:nth-child(2) > button');
    const confirmButton = classMatchedButton || fallbackButton;
    if (!confirmButton) {
      return null;
    }

    return {
      titleText: String(titleNode.textContent || '').trim(),
      confirmButton
    };
  }

  function maybeHandleContinueSessionModal(source = 'unknown') {
    if (!postSubmitWatchActive || !isLoginPath()) {
      return false;
    }

    const modal = findContinueSessionModal();
    if (!modal || !modal.confirmButton) {
      return false;
    }

    const confirmButton = modal.confirmButton;
    if (!confirmButton.isConnected || confirmButton.disabled) {
      return false;
    }

    if (confirmButton.dataset.greeneNuwweConfirmClicked === '1') {
      return false;
    }

    confirmButton.dataset.greeneNuwweConfirmClicked = '1';
    postSubmitModalClickCount += 1;
    logWarn('post_submit:continue_modal_detected_click', {
      source,
      titleText: modal.titleText,
      clickCount: postSubmitModalClickCount,
      buttonClass: String(confirmButton.className || '')
    });
    confirmButton.click();
    return true;
  }

  function clearPostSubmitWatchTimers() {
    if (postSubmitWatchTimer) {
      window.clearTimeout(postSubmitWatchTimer);
      postSubmitWatchTimer = 0;
    }

    if (postSubmitTimeoutTimer) {
      window.clearTimeout(postSubmitTimeoutTimer);
      postSubmitTimeoutTimer = 0;
    }

    if (postSubmitMutationThrottleTimer) {
      window.clearTimeout(postSubmitMutationThrottleTimer);
      postSubmitMutationThrottleTimer = 0;
    }
  }

  function stopPostSubmitWatch(reason = 'manual', payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const hasPendingWatch =
      postSubmitWatchActive ||
      Boolean(postSubmitObserver) ||
      Boolean(postSubmitWatchTimer) ||
      Boolean(postSubmitTimeoutTimer) ||
      Boolean(postSubmitMutationThrottleTimer);
    if (!hasPendingWatch) {
      return;
    }

    postSubmitWatchActive = false;
    clearPostSubmitWatchTimers();

    if (postSubmitObserver) {
      postSubmitObserver.disconnect();
      postSubmitObserver = null;
    }

    const eventPayload = {
      reason,
      modalClicks: postSubmitModalClickCount,
      pathname: String(location.pathname || ''),
      ...safePayload
    };
    if (reason === 'timeout') {
      logWarn('post_submit:watch_stop', eventPayload);
      return;
    }

    logDebug('post_submit:watch_stop', eventPayload);
  }

  function schedulePostSubmitWatchTick() {
    if (!postSubmitWatchActive || postSubmitWatchTimer) {
      return;
    }

    postSubmitWatchTimer = window.setTimeout(() => {
      postSubmitWatchTimer = 0;
      runPostSubmitWatchTick('poll');
    }, POST_SUBMIT_WATCH_POLL_MS);
  }

  function runPostSubmitWatchTick(source = 'poll') {
    if (!postSubmitWatchActive) {
      return;
    }

    const pathname = String(location.pathname || '');
    if (isHomePath(pathname)) {
      stopPostSubmitWatch('home_detected', { source, pathname });
      return;
    }

    if (!isLoginPath(pathname)) {
      stopPostSubmitWatch('path_changed', { source, pathname });
      return;
    }

    maybeHandleContinueSessionModal(source);
    schedulePostSubmitWatchTick();
  }

  function startPostSubmitWatch() {
    stopPostSubmitWatch('restart');
    if (!isLoginPath()) {
      logDebug('post_submit:watch_skip_not_login', {
        pathname: String(location.pathname || '')
      });
      return;
    }

    postSubmitWatchActive = true;
    postSubmitModalClickCount = 0;

    if (document.documentElement) {
      postSubmitObserver = new MutationObserver(() => {
        if (!postSubmitWatchActive || postSubmitMutationThrottleTimer) {
          return;
        }

        postSubmitMutationThrottleTimer = window.setTimeout(() => {
          postSubmitMutationThrottleTimer = 0;
          runPostSubmitWatchTick('mutation');
        }, POST_SUBMIT_MUTATION_THROTTLE_MS);
      });

      postSubmitObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }

    postSubmitTimeoutTimer = window.setTimeout(() => {
      stopPostSubmitWatch('timeout', {
        pathname: String(location.pathname || ''),
        modalClicks: postSubmitModalClickCount
      });
    }, POST_SUBMIT_WATCH_TIMEOUT_MS);

    logDebug('post_submit:watch_start', {
      timeoutMs: POST_SUBMIT_WATCH_TIMEOUT_MS,
      pathname: String(location.pathname || ''),
      hasObserver: Boolean(postSubmitObserver)
    });

    runPostSubmitWatchTick('start');
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

  function clearScheduledAutoLoginTimers() {
    if (syncTimer) {
      window.clearTimeout(syncTimer);
      syncTimer = 0;
    }

    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }

    if (observerThrottleTimer) {
      window.clearTimeout(observerThrottleTimer);
      observerThrottleTimer = 0;
    }
  }

  function stopObserver() {
    if (!observer) {
      return;
    }
    logDebug('observer:stop');
    observer.disconnect();
    observer = null;
  }

  function stopAutoLoginFlow() {
    logDebug('auto_login:stop_flow', {
      autoLoginPerformed,
      autoLoginAttempts,
      hasSyncTimer: Boolean(syncTimer),
      hasRetryTimer: Boolean(retryTimer),
      hasObserverThrottleTimer: Boolean(observerThrottleTimer)
    });
    clearScheduledAutoLoginTimers();
    stopObserver();
  }

  function resetAutoLoginFlow() {
    clearScheduledAutoLoginTimers();
    stopPostSubmitWatch('reset_flow');
    autoLoginPerformed = false;
    autoLoginAttempts = 0;
    logDebug('auto_login:reset_flow');
  }

  function autoLoginNuwwe(user, pass, companyCode) {
    const form = getLoginFormElements();
    if (!hasReadyForm(form)) {
      logWarn('auto_login:form_not_ready', {
        form: summarizeFormAvailability(form),
        page: buildPageSnapshot()
      });
      return Promise.resolve({
        ok: false,
        message: 'Formulario de Nuwwe aun no disponible.'
      });
    }

    logDebug('auto_login:injecting_credentials', {
      form: summarizeFormAvailability(form)
    });
    setValue(form.userInput, user);
    setValue(form.passInput, pass);
    setValue(form.companyInput, companyCode);

    if (form.policyCheckbox && !form.policyCheckbox.checked) {
      logDebug('auto_login:checking_policy_checkbox');
      form.policyCheckbox.click();
      form.policyCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return new Promise((resolve) => {
      const maxAttempts = 8;
      let attempts = 0;

      const trySubmit = () => {
        if (!form.loginButton || !form.loginButton.isConnected) {
          logWarn('auto_login:submit_button_missing', {
            attempts
          });
          resolve({
            ok: false,
            message: 'Boton de ingreso no disponible.'
          });
          return;
        }

        if (!form.loginButton.disabled) {
          logDebug('auto_login:submit_click', {
            attempts
          });
          form.loginButton.click();
          startPostSubmitWatch();
          resolve({
            ok: true,
            message: 'Credenciales insertadas. Esperando validacion de sesion...'
          });
          return;
        }

        attempts += 1;
        logDebug('auto_login:submit_waiting_button_enabled', {
          attempts,
          maxAttempts
        });
        if (attempts >= maxAttempts) {
          logWarn('auto_login:submit_button_still_disabled', {
            attempts,
            maxAttempts
          });
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
        logWarn('credentials:request_background_runtime_unavailable');
        resolve({ ok: false, error: 'API runtime no disponible.' });
        return;
      }

      logDebug('credentials:request_background:start', {
        page: buildPageSnapshot()
      });
      chrome.runtime.sendMessage(
        {
          type: GET_CREDENTIALS_MESSAGE_TYPE
        },
        (response) => {
          if (chrome.runtime.lastError) {
            const errorMessage = String(chrome.runtime.lastError.message || 'No se pudo obtener credenciales desde background.');
            logWarn('credentials:request_background_last_error', {
              error: errorMessage
            });
            resolve({
              ok: false,
              error: errorMessage
            });
            return;
          }

          const safeResponse = response && typeof response === 'object' ? response : { ok: false, error: 'Respuesta invalida.' };
          logDebug('credentials:request_background:resolved', {
            ok: Boolean(safeResponse.ok),
            hasCredentials: Boolean(normalizeCredentials(safeResponse.credentials)),
            error: safeResponse.error ? String(safeResponse.error) : ''
          });
          resolve(safeResponse);
        }
      );
    });
  }

  async function runNuwweAutoLogin(options = {}) {
    const target = evaluateTargetPage();
    const force = options.force === true;
    logDebug('auto_login:run_start', {
      force,
      autoLoginPerformed,
      autoLoginAttempts,
      credentialsRequestInFlight,
      isToolEnabled: isToolEnabled(),
      target
    });

    if (!target.isTarget) {
      logWarn('auto_login:run_skip_not_target', {
        target
      });
      return {
        ok: false,
        message: 'Pagina no compatible para Nuwwe Auto Login.'
      };
    }

    if (!isToolEnabled()) {
      logWarn('auto_login:run_skip_tool_disabled');
      return {
        ok: false,
        message: 'La tool Nuwwe Auto Login esta desactivada.'
      };
    }

    if (autoLoginPerformed && !force) {
      logDebug('auto_login:run_skip_already_performed');
      return {
        ok: true,
        message: 'Autologin ya ejecutado en esta carga.'
      };
    }

    const form = getLoginFormElements();
    if (!hasReadyForm(form)) {
      logWarn('auto_login:run_form_not_ready', {
        form: summarizeFormAvailability(form)
      });
      return {
        ok: false,
        message: 'Formulario de Nuwwe aun no disponible.'
      };
    }

    if (credentialsRequestInFlight) {
      logWarn('auto_login:run_credentials_request_in_flight');
      return {
        ok: false,
        message: 'Consulta de credenciales en progreso.'
      };
    }

    credentialsRequestInFlight = true;
    try {
      let credentials = normalizeCredentials(cachedCredentials);
      logDebug('credentials:cache_state', {
        force,
        hasCachedCredentials: Boolean(credentials)
      });
      if (!credentials || force) {
        logDebug('credentials:fetch_required', {
          reason: force ? 'forced' : 'cache_missing'
        });
        const response = await requestCredentialsFromBackground();
        credentials = normalizeCredentials(response?.credentials);
        if (!response?.ok || !credentials) {
          logWarn('credentials:fetch_failed', {
            responseOk: Boolean(response?.ok),
            hasCredentials: Boolean(credentials),
            error: response?.error ? String(response.error) : ''
          });
          return {
            ok: false,
            message: String(response?.error || response?.message || 'No hay credenciales disponibles.')
          };
        }
        cachedCredentials = credentials;
        logDebug('credentials:cache_updated', {
          credentials: summarizeCredentials(credentials)
        });
      }

      const result = await autoLoginNuwwe(credentials.username, credentials.password, credentials.companyCode);
      if (result.ok) {
        autoLoginPerformed = true;
      }
      logDebug('auto_login:run_result', {
        ok: Boolean(result?.ok),
        message: String(result?.message || ''),
        autoLoginPerformed
      });
      return result;
    } finally {
      credentialsRequestInFlight = false;
      logDebug('credentials:request_in_flight_cleared');
    }
  }

  function scheduleRetry() {
    if (retryTimer || autoLoginPerformed || !isToolEnabled()) {
      logDebug('auto_login:retry_skip', {
        hasRetryTimer: Boolean(retryTimer),
        autoLoginPerformed,
        isToolEnabled: isToolEnabled()
      });
      return;
    }

    const delayMs = Math.min(
      AUTO_LOGIN_RETRY_MAX_MS,
      AUTO_LOGIN_RETRY_BASE_MS + Math.max(0, autoLoginAttempts - 1) * AUTO_LOGIN_RETRY_STEP_MS
    );
    logDebug('auto_login:retry_scheduled', {
      delayMs,
      autoLoginAttempts
    });
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      logDebug('auto_login:retry_triggered');
      scheduleAutoLogin({ delayMs: 0 });
    }, delayMs);
  }

  async function executeScheduledAutoLogin(options = {}) {
    const force = options.force === true;
    if (!force && autoLoginAttempts >= AUTO_LOGIN_MAX_ATTEMPTS) {
      logWarn('auto_login:max_attempts_reached', {
        autoLoginAttempts,
        maxAttempts: AUTO_LOGIN_MAX_ATTEMPTS
      });
      stopAutoLoginFlow();
      return;
    }

    if (!force) {
      autoLoginAttempts += 1;
    }
    logDebug('auto_login:execute_scheduled', {
      force,
      autoLoginAttempts,
      maxAttempts: AUTO_LOGIN_MAX_ATTEMPTS
    });

    const result = await runNuwweAutoLogin(options);
    if (result?.ok) {
      logDebug('auto_login:execute_success', {
        autoLoginAttempts
      });
      stopAutoLoginFlow();
      return;
    }

    if (!force) {
      logWarn('auto_login:execute_failed_retrying', {
        autoLoginAttempts,
        message: String(result?.message || '')
      });
      scheduleRetry();
    }
  }

  function scheduleAutoLogin(options = {}) {
    const target = evaluateTargetPage();
    if (!target.isTarget || !isToolEnabled()) {
      logDebug('auto_login:schedule_skip', {
        target,
        isToolEnabled: isToolEnabled()
      });
      return;
    }

    if (autoLoginPerformed && options.force !== true) {
      logDebug('auto_login:schedule_skip_already_performed');
      stopAutoLoginFlow();
      return;
    }

    if (syncTimer) {
      logDebug('auto_login:schedule_skip_timer_exists');
      return;
    }

    const delayMs = Math.max(0, Number(options.delayMs) || AUTO_LOGIN_INITIAL_DELAY_MS);
    logDebug('auto_login:schedule_set', {
      delayMs,
      force: options.force === true
    });
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      logDebug('auto_login:schedule_fired', {
        delayMs,
        force: options.force === true
      });
      void executeScheduledAutoLogin(options);
    }, delayMs);
  }

  function installObserver() {
    if (observer || !document.documentElement) {
      logDebug('observer:install_skip', {
        hasObserver: Boolean(observer),
        hasDocumentElement: Boolean(document.documentElement)
      });
      return;
    }

    logDebug('observer:install');
    observer = new MutationObserver(() => {
      if (autoLoginPerformed || !isToolEnabled()) {
        return;
      }

      if (observerThrottleTimer) {
        return;
      }

      logDebug('observer:mutation_triggered_schedule');
      observerThrottleTimer = window.setTimeout(() => {
        observerThrottleTimer = 0;
        scheduleAutoLogin({ delayMs: 60 });
      }, AUTO_LOGIN_OBSERVER_THROTTLE_MS);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function loadSettings(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      logWarn('settings:load_storage_unavailable');
      callback();
      return;
    }

    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (!chrome.runtime.lastError) {
        settings = { ...DEFAULT_SETTINGS, ...items };
        logDebug('settings:loaded', {
          isToolEnabled: isToolEnabled()
        });
      } else {
        logWarn('settings:load_error', {
          error: String(chrome.runtime.lastError.message || '')
        });
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
        logDebug('settings:tool_changed', {
          enabled: settings[TOOL_KEY]
        });
        if (!settings[TOOL_KEY]) {
          cachedCredentials = null;
          resetAutoLoginFlow();
          stopAutoLoginFlow();
          return;
        }

        resetAutoLoginFlow();
        installObserver();
        scheduleAutoLogin({ delayMs: 40 });
      });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.type !== APPLY_MESSAGE_TYPE) {
          return;
        }

        logDebug('runtime_message:apply_received', {
          force: true
        });
        void runNuwweAutoLogin({ force: true })
          .then((result) => {
            logDebug('runtime_message:apply_resolved', {
              ok: Boolean(result?.ok),
              message: String(result?.message || '')
            });
            if (typeof sendResponse === 'function') {
              sendResponse(result);
            }
          })
          .catch((error) => {
            logWarn('runtime_message:apply_error', {
              error: error instanceof Error ? error.message : String(error || '')
            });
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

  function main() {
    const target = evaluateTargetPage();
    logDebug('main:start', {
      target
    });
    if (!target.isTarget) {
      logWarn('main:skip_not_target', {
        target
      });
      return;
    }

    installObserver();
    installRuntimeHooks();

    loadSettings(() => {
      if (!isToolEnabled()) {
        stopAutoLoginFlow();
        return;
      }

      scheduleAutoLogin({ delayMs: 40 });
      window.addEventListener('DOMContentLoaded', () => scheduleAutoLogin({ delayMs: 20 }), { once: true });
      window.addEventListener('load', () => scheduleAutoLogin({ delayMs: 20 }), { once: true });
    });
  }

  main();
})();
