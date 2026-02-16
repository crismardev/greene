import {
  buildDefaultChatSystemPrompt,
  DEFAULT_ASSISTANT_LANGUAGE,
  isLegacyDefaultPrompt,
  isPromptDefaultForLanguage,
  normalizeAssistantLanguage
} from '../services/prompt-service.js';

export function createSettingsScreenController({
  elements,
  state,
  defaults,
  storage,
  setStatus,
  getThemeMode,
  setThemeMode,
  onAfterHydrate
}) {
  const {
    onboardingAssistantNameInput,
    onboardingNameInput,
    onboardingStatus,
    settingsNameInput,
    settingsBirthdayInput,
    settingsThemeModeSelect,
    settingsLanguageSelect,
    settingsSystemPrompt,
    settingsUserStatus,
    settingsAssistantStatus,
    chatStatus
  } = elements;

  function getPanelSettings() {
    return state.panelSettings;
  }

  function setPanelSettings(nextValue) {
    state.panelSettings = { ...nextValue };
  }

  function sanitizePromptByLanguage(storedPrompt, language) {
    const raw = String(storedPrompt || '').trim();
    if (!raw || isLegacyDefaultPrompt(raw)) {
      return buildDefaultChatSystemPrompt(language);
    }

    return raw;
  }

  function normalizeThemeMode(mode) {
    const raw = String(mode || '')
      .trim()
      .toLowerCase();

    if (raw === 'dark' || raw === 'light' || raw === 'system') {
      return raw;
    }

    return 'system';
  }

  function applyPanelSettingsToUi() {
    const panelSettings = getPanelSettings();

    if (onboardingAssistantNameInput) {
      onboardingAssistantNameInput.value = panelSettings.assistantName || defaults.panelSettingsDefaults.assistantName || '';
    }

    if (onboardingNameInput) {
      onboardingNameInput.value = panelSettings.displayName || '';
    }

    if (settingsNameInput) {
      settingsNameInput.value = panelSettings.displayName || '';
    }

    if (settingsBirthdayInput) {
      settingsBirthdayInput.value = panelSettings.birthday || '';
    }

    if (settingsLanguageSelect) {
      settingsLanguageSelect.value = normalizeAssistantLanguage(panelSettings.language);
    }

    if (settingsSystemPrompt) {
      settingsSystemPrompt.value = panelSettings.systemPrompt || buildDefaultChatSystemPrompt(panelSettings.language);
    }

    if (settingsThemeModeSelect && typeof getThemeMode === 'function') {
      settingsThemeModeSelect.value = normalizeThemeMode(getThemeMode());
    }
  }

  function populateSettingsForm() {
    applyPanelSettingsToUi();
    setStatus(settingsUserStatus, '');
    setStatus(settingsAssistantStatus, '');
  }

  function isOnboardingComplete() {
    return getPanelSettings().onboardingDone === true;
  }

  function resolveHomeOrOnboardingScreen() {
    return isOnboardingComplete() ? 'home' : 'onboarding';
  }

  function maybeApplyDefaultPromptByLanguage(nextLanguage) {
    if (!settingsSystemPrompt) {
      return;
    }

    const currentPrompt = String(settingsSystemPrompt.value || '').trim();
    const panelSettings = getPanelSettings();
    const previousLanguage = normalizeAssistantLanguage(panelSettings.language);

    if (!currentPrompt || isPromptDefaultForLanguage(currentPrompt, previousLanguage) || isLegacyDefaultPrompt(currentPrompt)) {
      settingsSystemPrompt.value = buildDefaultChatSystemPrompt(nextLanguage);
    }
  }

  async function hydratePanelSettings() {
    const stored = await storage.readPanelSettings();

    const merged = { ...defaults.panelSettingsDefaults, ...stored };
    const language = normalizeAssistantLanguage(merged.language);

    merged.assistantName = String(merged.assistantName || defaults.panelSettingsDefaults.assistantName || '').trim();
    if (!merged.assistantName) {
      merged.assistantName = String(defaults.panelSettingsDefaults.assistantName || 'Assistant').trim();
    }
    merged.displayName = String(merged.displayName || '').trim();
    merged.birthday = String(merged.birthday || '').trim();
    merged.language = language;
    merged.onboardingDone = merged.onboardingDone === true || String(merged.onboardingDone).toLowerCase() === 'true';
    merged.systemPrompt = sanitizePromptByLanguage(merged.systemPrompt, language);

    if (typeof onAfterHydrate === 'function') {
      const normalized = onAfterHydrate({ ...merged });
      if (normalized && typeof normalized === 'object') {
        Object.assign(merged, normalized);
      }
    }

    setPanelSettings(merged);
    applyPanelSettingsToUi();
  }

  async function handleOnboardingContinue({ setScreen, requestChatAutofocus }) {
    const panelSettings = getPanelSettings();
    const assistantName = String(onboardingAssistantNameInput?.value || '').trim();
    const name = String(onboardingNameInput?.value || '').trim();

    if (!assistantName) {
      setStatus(onboardingStatus, 'Escribe el nombre de tu asistente para continuar.', true);
      onboardingAssistantNameInput?.focus();
      return;
    }

    if (!name) {
      setStatus(onboardingStatus, 'Escribe tu nombre para continuar.', true);
      onboardingNameInput?.focus();
      return;
    }

    const nextSettings = {
      ...panelSettings,
      assistantName,
      displayName: name,
      onboardingDone: true
    };

    const ok = await storage.savePanelSettings(nextSettings);

    if (!ok) {
      setStatus(onboardingStatus, 'No se pudo guardar onboarding.', true);
      return;
    }

    setPanelSettings(nextSettings);
    setStatus(onboardingStatus, 'Listo.');
    applyPanelSettingsToUi();
    setScreen('home');
    requestChatAutofocus(8, 70);
  }

  async function saveUserSettings() {
    const panelSettings = getPanelSettings();
    const nextName = String(settingsNameInput?.value || '').trim();
    const nextBirthday = String(settingsBirthdayInput?.value || '').trim();

    if (!nextName) {
      setStatus(settingsUserStatus, 'El nombre no puede estar vacio.', true);
      settingsNameInput?.focus();
      return;
    }

    const nextSettings = {
      ...panelSettings,
      displayName: nextName,
      birthday: nextBirthday,
      onboardingDone: true
    };

    const ok = await storage.savePanelSettings(nextSettings);

    if (!ok) {
      setStatus(settingsUserStatus, 'No se pudieron guardar los datos de usuario.', true);
      return;
    }

    if (settingsThemeModeSelect && typeof setThemeMode === 'function') {
      const themeOk = await setThemeMode(normalizeThemeMode(settingsThemeModeSelect.value), { silent: true });
      if (!themeOk) {
        setStatus(settingsUserStatus, 'No se pudo guardar apariencia.', true);
        return;
      }
    }

    setPanelSettings(nextSettings);
    applyPanelSettingsToUi();
    setStatus(settingsUserStatus, 'Datos de usuario guardados.');
  }

  async function saveAssistantSettings() {
    const panelSettings = getPanelSettings();
    const nextLanguage = normalizeAssistantLanguage(settingsLanguageSelect?.value || DEFAULT_ASSISTANT_LANGUAGE);
    const nextPrompt = String(settingsSystemPrompt?.value || '').trim();

    if (!nextPrompt) {
      setStatus(settingsAssistantStatus, 'El system prompt no puede estar vacio.', true);
      settingsSystemPrompt?.focus();
      return;
    }

    const nextSettings = {
      ...panelSettings,
      language: nextLanguage,
      onboardingDone: true,
      systemPrompt: nextPrompt
    };

    const ok = await storage.savePanelSettings(nextSettings);

    if (!ok) {
      setStatus(settingsAssistantStatus, 'No se pudieron guardar los datos del assistant.', true);
      return;
    }

    setPanelSettings(nextSettings);
    applyPanelSettingsToUi();
    setStatus(settingsAssistantStatus, 'Assistant guardado.');
    setStatus(chatStatus, 'Assistant actualizado.');
  }

  function handleLanguageChange() {
    const nextLanguage = normalizeAssistantLanguage(settingsLanguageSelect?.value || DEFAULT_ASSISTANT_LANGUAGE);
    maybeApplyDefaultPromptByLanguage(nextLanguage);
  }

  return {
    applyPanelSettingsToUi,
    populateSettingsForm,
    isOnboardingComplete,
    resolveHomeOrOnboardingScreen,
    hydratePanelSettings,
    handleOnboardingContinue,
    saveUserSettings,
    saveAssistantSettings,
    handleLanguageChange,
    getPanelSettings
  };
}
