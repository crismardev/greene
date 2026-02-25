import { toSafeText } from './generic-site-context.js';

export const DEFAULT_WHATSAPP_REPLY_PROMPT_BASE = Object.freeze(
  [
    'Eres asistente para responder WhatsApp.',
    'Devuelve un unico mensaje corto listo para enviar (maximo 180 caracteres).',
    'Adapta tono e iniciativa al historial real del chat.',
    'No conviertas todas las respuestas en preguntas; usa afirmaciones naturales cuando sea mejor.',
    'Evita compromisos fuertes o promesas si no fueron solicitados.',
    'No expliques ni uses encabezados.',
    'Si el contexto no alcanza, devuelve una frase neutra y breve sin inventar datos.'
  ].join('\n')
);

const WHATSAPP_REPLY_HARD_RULES = Object.freeze(
  [
    'Reglas obligatorias de salida:',
    '- Tu salida es SIEMPRE un mensaje que YO envio ahora.',
    '- Escribe siempre desde la perspectiva de "Yo" (el usuario), nunca como si fueras el contacto.',
    '- Si el ultimo mensaje es mio, evita sonar insistente o abrir otra pregunta innecesaria.',
    '- Si el ultimo mensaje es mio y contiene una pregunta, no la contestes como si fueras el contacto.',
    '- Si el ultimo mensaje es del contacto, responde a ese turno sin cambiar de hablante.',
    '- No uses preguntas salvo que sean necesarias para destrabar la conversacion.'
  ].join('\n')
);

export function isWhatsappContext(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const site = String(context.site || '').toLowerCase();
  const url = String(context.url || '').toLowerCase();

  return site === 'whatsapp' || url.includes('web.whatsapp.com');
}

function normalizeWhatsappMessageEntry(item, index = 0) {
  const source = item && typeof item === 'object' ? item : {};
  const enriched = source.enriched && typeof source.enriched === 'object' ? source.enriched : {};
  const id = toSafeText(source.id || `row-${index}`, 220);
  if (!id) {
    return null;
  }

  const role = source.role === 'me' ? 'me' : 'contact';
  const author = toSafeText(source.author || '', 120);
  const kind = toSafeText(source.kind || '', 24).toLowerCase() || 'text';
  const transcript = toSafeText(source.transcript || enriched.transcript || '', 420);
  const ocrText = toSafeText(source.ocrText || enriched.ocrText || '', 420);
  const mediaCaption = toSafeText(source.mediaCaption || enriched.mediaCaption || '', 260);
  let text = toSafeText(source.text || '', 360);

  if (!text) {
    text = transcript || mediaCaption || ocrText || (kind === 'audio' ? 'Mensaje de voz' : '');
  }

  if (!text) {
    return null;
  }

  return {
    id,
    role,
    author,
    kind,
    text,
    timestamp: toSafeText(source.timestamp || '', 60),
    transcript,
    ocrText,
    mediaCaption
  };
}

export function getWhatsappMessages(tabContext, limit = 24) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const raw = Array.isArray(details.messages) ? details.messages : [];
  const safeLimit = Math.max(1, Number(limit) || 24);
  const normalized = raw.map((item, index) => normalizeWhatsappMessageEntry(item, index)).filter(Boolean);

  if (normalized.length <= safeLimit) {
    return normalized;
  }

  return normalized.slice(normalized.length - safeLimit);
}

export function hasWhatsappConversationHistory(tabContext, minMessages = 1) {
  const safeMin = Math.max(1, Number(minMessages) || 1);
  const messages = getWhatsappMessages(tabContext, 120);
  const usable = messages.filter((item) => toSafeText(item?.text || '', 320).length > 0);
  return usable.length >= safeMin;
}

export function getWhatsappChatKey(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const details = context.details && typeof context.details === 'object' ? context.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};

  const keyCandidate = String(currentChat.key || '').trim();
  if (keyCandidate) {
    return keyCandidate;
  }

  const phone = String(currentChat.phone || '').trim();
  if (phone) {
    return phone;
  }

  const title = String(currentChat.title || '').trim();
  if (title) {
    return title;
  }

  const tabTitle = String(context.title || '').trim();
  if (tabTitle) {
    return tabTitle;
  }

  const url = String(context.url || '').trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const keyFromHash = String(parsed.hash || '').replace(/^#/, '').trim();
      if (keyFromHash) {
        return keyFromHash;
      }

      const path = String(parsed.pathname || '').trim();
      if (path && path !== '/') {
        return `${parsed.hostname}${path}`;
      }

      return parsed.hostname || url;
    } catch (_) {
      return url;
    }
  }

  return '';
}

export function buildWhatsappMetaLabel(tabContext) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};

  const title = toSafeText(currentChat.title || '', 120);
  const phone = toSafeText(currentChat.phone || '', 80);

  if (title && phone) {
    return `${title} (${phone})`;
  }

  return title || phone || 'Chat activo';
}

export function buildWhatsappSignalKey(tabContext) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
  const sync = details.sync && typeof details.sync === 'object' ? details.sync : {};
  const channelId = String(currentChat.channelId || '').trim();
  const chatKey = channelId || getWhatsappChatKey(tabContext);
  const messages = getWhatsappMessages(tabContext, 40);
  const firstMessageId = toSafeText(messages[0]?.id || '', 220);
  const lastMessageId = toSafeText(messages.length ? messages[messages.length - 1]?.id || '' : '', 220);
  const tail = messages
    .slice(-6)
    .map((item) =>
      [item?.id || '', item?.role || '', item?.kind || '', item?.text || '', item?.transcript || '', item?.ocrText || '']
        .filter(Boolean)
        .join(':')
    )
    .join('|');
  const knownMessageCount = Math.max(0, Number(sync.knownMessageCount) || 0);
  const missingMessageCount = Math.max(0, Number(sync.missingMessageCount) || 0);
  const lastVisibleMessageId = toSafeText(sync.lastVisibleMessageId || '', 220);

  return [
    chatKey,
    `count:${messages.length}`,
    `known:${knownMessageCount}`,
    `missing:${missingMessageCount}`,
    `first:${firstMessageId}`,
    `last:${lastMessageId}`,
    `visible:${lastVisibleMessageId}`,
    `tail:${tail}`
  ].join('::');
}

function toPromptKeyToken(value, limit = 220) {
  const token = toSafeText(value || '', limit)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return token;
}

function buildPromptScopedKey(scope, value, limit = 220) {
  const token = toPromptKeyToken(value, limit);
  if (!token) {
    return '';
  }

  return `${scope}:${token}`;
}

export function getWhatsappConversationType(tabContext) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
  const channelId = toSafeText(currentChat.channelId || '', 220).toLowerCase();
  const phone = toSafeText(currentChat.phone || '', 80);
  const title = toSafeText(currentChat.title || '', 140).toLowerCase();

  if (channelId.includes('@g.us') || channelId.includes('group')) {
    return 'group';
  }

  if (channelId.includes('@c.us') || phone) {
    return 'direct';
  }

  if (/\bgrupo\b|\bgroup\b/.test(title)) {
    return 'group';
  }

  return 'unknown';
}

export function resolveWhatsappPromptTarget(tabContext) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const currentChat = details.currentChat && typeof details.currentChat === 'object' ? details.currentChat : {};
  const channelId = toSafeText(currentChat.channelId || '', 220);
  const chatKey = toSafeText(getWhatsappChatKey(tabContext), 220);
  const phone = toSafeText(currentChat.phone || '', 80);
  const title = toSafeText(currentChat.title || '', 160);
  const type = getWhatsappConversationType(tabContext);
  const candidates = [
    buildPromptScopedKey('channel', channelId, 220),
    buildPromptScopedKey('phone', phone, 80),
    buildPromptScopedKey('chat', chatKey, 220),
    buildPromptScopedKey('title', title, 160)
  ];
  const promptKeys = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    promptKeys.push(candidate);
  }

  return {
    promptKey: promptKeys[0] || '',
    promptKeys,
    label: buildWhatsappMetaLabel(tabContext),
    type,
    isGroup: type === 'group',
    channelId,
    chatKey,
    title,
    phone
  };
}

function describeMyResponseStyle(messages) {
  const mine = (Array.isArray(messages) ? messages : []).filter((item) => item?.role === 'me').slice(-6);
  if (!mine.length) {
    return 'Sin suficientes mensajes mios para inferir estilo.';
  }

  const avgLength = Math.round(mine.reduce((acc, item) => acc + String(item.text || '').length, 0) / mine.length);
  const questionCount = mine.filter((item) => String(item.text || '').includes('?')).length;
  const commitmentCount = mine.filter((item) =>
    /\b(voy|te confirmo|confirmo|agendo|agendamos|mañana|hoy te|quedo atento|quedamos)\b/i.test(String(item.text || ''))
  ).length;
  const directness = avgLength <= 75 ? 'directo y corto' : avgLength <= 140 ? 'equilibrado' : 'detallado';
  const asksQuestions = questionCount >= Math.ceil(mine.length / 2) ? 'hace preguntas frecuente' : 'hace pocas preguntas';
  const commitmentStyle =
    commitmentCount >= Math.ceil(mine.length / 2) ? 'tiende a comprometerse' : 'evita compromisos innecesarios';

  return `Estilo detectado de "Yo": ${directness}; ${asksQuestions}; ${commitmentStyle}; largo promedio ${avgLength} chars.`;
}

function buildLastTurnGuidance(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list.length ? list[list.length - 1] : null;
  if (!last) {
    return 'Ultimo turno: sin mensajes visibles.';
  }

  const lastRole = last.role === 'me' ? 'me' : 'contact';
  const lastText = toSafeText(last.text || '', 220);
  const lastAuthor = toSafeText(last.author || '', 120);
  const authorSuffix = lastAuthor ? ` · autor detectado: ${lastAuthor}` : '';
  const askedQuestion = /\?/.test(lastText);

  if (lastRole === 'me') {
    return [
      `Ultimo turno: Yo (${lastText || 'sin texto'})${authorSuffix}.`,
      'No respondas como si fueras el contacto.',
      askedQuestion ? 'No contestes esa pregunta como el contacto; sugiere seguimiento breve o espera respuesta.' : '',
      'Sugiere un seguimiento breve y natural solo si aporta valor.'
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    `Ultimo turno: Contacto (${lastText || 'sin texto'})${authorSuffix}.`,
    askedQuestion
      ? 'El contacto hizo una pregunta; respondela directo y claro.'
      : 'Responde desde mi voz con tono natural y sin comprometer de mas.'
  ].join(' ');
}

function formatMessageForPrompt(item) {
  const message = item && typeof item === 'object' ? item : {};
  const role = message.role === 'me' ? 'Yo' : 'Contacto';
  const author = toSafeText(message.author || '', 120);
  const timestamp = toSafeText(message.timestamp || '', 40);
  const kind = toSafeText(message.kind || '', 24);
  const text = toSafeText(message.text || '', 320);
  const transcript = toSafeText(message.transcript || '', 260);
  const ocrText = toSafeText(message.ocrText || '', 260);
  const mediaCaption = toSafeText(message.mediaCaption || '', 200);
  const extras = [];

  if (kind && kind !== 'text') {
    extras.push(`tipo:${kind}`);
  }
  if (transcript) {
    extras.push(`transcripcion:${transcript}`);
  }
  if (ocrText) {
    extras.push(`ocr:${ocrText}`);
  }
  if (mediaCaption && mediaCaption !== text) {
    extras.push(`caption:${mediaCaption}`);
  }

  const roleLabel = author ? `${role}(${author})` : role;
  const prefix = `${timestamp ? `[${timestamp}] ` : ''}${roleLabel}: ${text}`;
  if (!extras.length) {
    return prefix;
  }

  return `${prefix} (${extras.join(' | ')})`;
}

export function buildWhatsappReplyPrompt(tabContext, options = {}) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const myNumber = toSafeText(details.myNumber || '', 64);
  const chatLabel = buildWhatsappMetaLabel(tabContext);
  const messagesList = getWhatsappMessages(tabContext, 28);
  const lastMessage = messagesList.length ? messagesList[messagesList.length - 1] : null;
  const lastSender = lastMessage ? (lastMessage.role === 'me' ? 'yo' : 'contacto') : 'desconocido';
  const messages = messagesList.map((item) => formatMessageForPrompt(item)).join('\n');
  const styleHint = describeMyResponseStyle(messagesList);
  const lastTurnHint = buildLastTurnGuidance(messagesList);
  const basePrompt = String(options.basePrompt || DEFAULT_WHATSAPP_REPLY_PROMPT_BASE).trim() || DEFAULT_WHATSAPP_REPLY_PROMPT_BASE;
  const chatPrompt = toSafeText(options.chatPrompt || '', 1800);
  const lines = [basePrompt, '', WHATSAPP_REPLY_HARD_RULES];

  if (chatPrompt) {
    lines.push('', 'Personalizacion especifica para este chat:', chatPrompt);
  }

  lines.push(
    '',
    `Mi numero: ${myNumber || 'N/A'}`,
    `Chat: ${chatLabel}`,
    `Emisor del ultimo mensaje detectado: ${lastSender}.`,
    'La respuesta sugerida debe ser exactamente el texto que YO enviaria ahora.',
    styleHint,
    lastTurnHint,
    'Conversacion reciente:',
    messages || 'Sin mensajes recientes.',
    '',
    'Respuesta sugerida:'
  );

  return lines.join('\n');
}
