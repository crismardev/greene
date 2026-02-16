(() => {
  'use strict';

  const TOOL_KEYS = Object.freeze({
    RETOOL_LAYOUT_CLEANUP: 'tool_retool_layout_cleanup'
  });

  const PREFERENCE_KEYS = Object.freeze({
    AI_PROVIDER: 'pref_ai_provider',
    AI_MODEL_OLLAMA: 'pref_ai_model_ollama',
    AI_MODEL_HF: 'pref_ai_model_hf',
    AI_HF_TOKEN: 'pref_ai_hf_token',
    AI_TEMPERATURE: 'pref_ai_temperature',
    IMAGE_QUALITY: 'pref_image_quality',
    UI_THEME_MODE: 'pref_ui_theme_mode'
  });

  const TOOL_DEFINITIONS = Object.freeze([
    {
      key: 'tool_ai_mail_writer',
      title: 'AI Mail Writer',
      description: 'Genera correos con modelos open source (Ollama/Hugging Face).',
      status: 'active'
    },
    {
      key: 'tool_image_to_webp',
      title: 'Image to WebP',
      description: 'Convierte PNG, JPG, JPEG, GIF o BMP a WebP desde el panel.',
      status: 'active'
    },
    {
      key: TOOL_KEYS.RETOOL_LAYOUT_CLEANUP,
      title: 'Retool Layout Cleanup',
      description: 'Oculta el header de Retool y reajusta el canvas.',
      status: 'active'
    }
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    [TOOL_KEYS.RETOOL_LAYOUT_CLEANUP]: true,
    [PREFERENCE_KEYS.AI_PROVIDER]: 'ollama',
    [PREFERENCE_KEYS.AI_MODEL_OLLAMA]: 'gpt-oss:20b',
    [PREFERENCE_KEYS.AI_MODEL_HF]: 'Qwen/Qwen2.5-7B-Instruct',
    [PREFERENCE_KEYS.AI_HF_TOKEN]: '',
    [PREFERENCE_KEYS.AI_TEMPERATURE]: 0.7,
    [PREFERENCE_KEYS.IMAGE_QUALITY]: 0.9,
    [PREFERENCE_KEYS.UI_THEME_MODE]: 'system'
  });

  window.GreeneToolsConfig = Object.freeze({
    TOOL_KEYS,
    PREFERENCE_KEYS,
    TOOL_DEFINITIONS,
    DEFAULT_SETTINGS,
    APPLY_MESSAGE_TYPE: 'GREENE_TOOLS_APPLY'
  });
})();
