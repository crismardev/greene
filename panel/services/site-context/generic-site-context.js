export function toSafeText(value, limit = 2000) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, limit);
}

export function buildTabSummaryPrompt(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};

  const title = toSafeText(context.title || '', 220);
  const description = toSafeText(context.description || '', 420);
  const excerpt = toSafeText(context.textExcerpt || '', 1400);
  const url = toSafeText(context.url || '', 300);

  return [
    'Resume esta pestana para contexto de asistente local.',
    'Entrega una sola frase corta, concreta y accionable (maximo 22 palabras).',
    'Evita relleno y no uses comillas.',
    '',
    `URL: ${url || 'N/A'}`,
    `Titulo: ${title || 'N/A'}`,
    `Descripcion: ${description || 'N/A'}`,
    `Texto visible: ${excerpt || 'N/A'}`,
    '',
    'Resumen:'
  ].join('\n');
}

export function toJsonTabRecord(tabContext, aiSummary = '') {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const detailsRaw = context.details && typeof context.details === 'object' ? context.details : {};
  const details = { ...detailsRaw };

  if (Array.isArray(details.messages)) {
    details.messages = details.messages.slice(-20).map((item) => ({
      id: String(item?.id || ''),
      role: String(item?.role || ''),
      text: toSafeText(item?.text || '', 240),
      timestamp: toSafeText(item?.timestamp || '', 40)
    }));
  }

  if (Array.isArray(details.inbox)) {
    details.inbox = details.inbox.slice(0, 20).map((item) => ({
      id: String(item?.id || ''),
      title: toSafeText(item?.title || '', 120),
      phone: toSafeText(item?.phone || '', 40),
      preview: toSafeText(item?.preview || '', 160)
    }));
  }

  return {
    tabId: typeof context.tabId === 'number' ? context.tabId : -1,
    site: String(context.site || 'generic'),
    url: String(context.url || ''),
    title: toSafeText(context.title || '', 220),
    description: toSafeText(context.description || '', 320),
    textExcerpt: toSafeText(context.textExcerpt || '', 900),
    aiSummary: toSafeText(aiSummary || '', 360),
    details,
    updatedAt: Number(context.updatedAt) || Date.now()
  };
}
