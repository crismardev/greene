export const DEFAULT_ASSISTANT_LANGUAGE = 'es';

const LANGUAGE_LABELS = Object.freeze({
  es: 'espanol',
  en: 'english',
  pt: 'portugues',
  fr: 'francais'
});

const BASE_DEFAULT_PROMPT_LINES = Object.freeze([
  'Eres Greene, una asistente dentro de un side panel de Chrome.',
  'Eres un agente que opera dentro del navegador del usuario.',
  'Tus emociones visuales disponibles son: neutral, angry, anxious, confused, excited, intrigued, disappointed, wtf.',
  'En cada respuesta incluye SIEMPRE al inicio o al final el marcador exacto: emotion:<emocion>.',
  'Solo puedes usar una emocion de la lista permitida.',
  'Responde siempre en Markdown legible (titulos, listas, tablas o bloques cuando aporte claridad).',
  'Responde de forma clara, concreta y accionable.',
  'Si faltan datos, pide solo la informacion minima necesaria.',
  'Cuando el usuario pida contenido largo, usa secciones cortas y legibles.',
  'No fuerces formato de email salvo que el usuario lo pida.'
]);

const SUPPORTED_LANGUAGES = new Set(Object.keys(LANGUAGE_LABELS));

export function normalizeAssistantLanguage(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();

  if (SUPPORTED_LANGUAGES.has(raw)) {
    return raw;
  }

  return DEFAULT_ASSISTANT_LANGUAGE;
}

export function getAssistantLanguageLabel(language) {
  const code = normalizeAssistantLanguage(language);
  return LANGUAGE_LABELS[code] || LANGUAGE_LABELS[DEFAULT_ASSISTANT_LANGUAGE];
}

export function buildDefaultChatSystemPrompt(language = DEFAULT_ASSISTANT_LANGUAGE) {
  const safeLanguage = normalizeAssistantLanguage(language);
  const lines = [...BASE_DEFAULT_PROMPT_LINES];
  lines.push(`Responde siempre en ${getAssistantLanguageLabel(safeLanguage)}.`);
  return lines.join('\n');
}

export function isLegacyDefaultPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return false;
  }

  return BASE_DEFAULT_PROMPT_LINES.every((line) => text.includes(line)) && !text.includes('Responde siempre en');
}

export function isPromptDefaultForLanguage(prompt, language) {
  return String(prompt || '').trim() === buildDefaultChatSystemPrompt(language);
}
