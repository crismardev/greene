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
  normalizeModelName,
  syncModelSelectors,
  getActiveModel
}) {
  const {
    onboardingNameInput,
    onboardingStatus,
    settingsNameInput,
    settingsBirthdayInput,
    settingsLanguageSelect,
    settingsSystemPrompt,
    settingsModelSelect,
    settingsStatus,
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

  function applyPanelSettingsToUi() {
    const panelSettings = getPanelSettings();

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

    state.currentChatModel = normalizeModelName(panelSettings.defaultModel) || defaults.defaultModel;
    syncModelSelectors();
  }

  function populateSettingsForm() {
    applyPanelSettingsToUi();
    setStatus(settingsStatus, '');
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

    merged.displayName = String(merged.displayName || '').trim();
    merged.birthday = String(merged.birthday || '').trim();
    merged.language = language;
    merged.onboardingDone = merged.onboardingDone === true || String(merged.onboardingDone).toLowerCase() === 'true';
    merged.systemPrompt = sanitizePromptByLanguage(merged.systemPrompt, language);
    merged.defaultModel = normalizeModelName(merged.defaultModel) || defaults.defaultModel;

    setPanelSettings(merged);
    applyPanelSettingsToUi();
  }

  async function handleOnboardingContinue({ setScreen, requestChatAutofocus }) {
    const panelSettings = getPanelSettings();
    const name = String(onboardingNameInput?.value || '').trim();

    if (!name) {
      setStatus(onboardingStatus, 'Escribe tu nombre para continuar.', true);
      onboardingNameInput?.focus();
      return;
    }

    const nextSettings = {
      ...panelSettings,
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

  async function saveSettingsScreen() {
    const panelSettings = getPanelSettings();
    const nextName = String(settingsNameInput?.value || '').trim();
    const nextBirthday = String(settingsBirthdayInput?.value || '').trim();
    const nextLanguage = normalizeAssistantLanguage(settingsLanguageSelect?.value || DEFAULT_ASSISTANT_LANGUAGE);
    const nextPrompt = String(settingsSystemPrompt?.value || '').trim();
    const nextModel = normalizeModelName(settingsModelSelect?.value || '') || defaults.defaultModel;

    if (!nextName) {
      setStatus(settingsStatus, 'El nombre no puede estar vacio.', true);
      settingsNameInput?.focus();
      return;
    }

    if (!nextPrompt) {
      setStatus(settingsStatus, 'El system prompt no puede estar vacio.', true);
      settingsSystemPrompt?.focus();
      return;
    }

    const nextSettings = {
      ...panelSettings,
      displayName: nextName,
      birthday: nextBirthday,
      language: nextLanguage,
      onboardingDone: true,
      systemPrompt: nextPrompt,
      defaultModel: nextModel
    };

    const ok = await storage.savePanelSettings(nextSettings);

    if (!ok) {
      setStatus(settingsStatus, 'No se pudieron guardar settings.', true);
      return;
    }

    setPanelSettings(nextSettings);
    applyPanelSettingsToUi();
    setStatus(settingsStatus, 'Settings guardados.');
    setStatus(chatStatus, `Modelo activo: ${getActiveModel()}.`);
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
    saveSettingsScreen,
    handleLanguageChange,
    getPanelSettings
  };
}
