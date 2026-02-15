import { toSafeText } from './generic-site-context.js';

export function isWhatsappContext(tabContext) {
  const context = tabContext && typeof tabContext === 'object' ? tabContext : {};
  const site = String(context.site || '').toLowerCase();
  const url = String(context.url || '').toLowerCase();

  return site === 'whatsapp' || url.includes('web.whatsapp.com');
}

export function getWhatsappMessages(tabContext, limit = 24) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const raw = Array.isArray(details.messages) ? details.messages : [];
  const safeLimit = Math.max(1, Number(limit) || 24);

  if (raw.length <= safeLimit) {
    return raw;
  }

  return raw.slice(raw.length - safeLimit);
}

export function getWhatsappChatKey(tabContext) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
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
  const chatKey = getWhatsappChatKey(tabContext);
  const messages = getWhatsappMessages(tabContext, 3);
  const tail = messages
    .map((item) => `${item?.id || ''}:${item?.text || ''}`)
    .join('|');

  return `${chatKey}::${tail}`;
}

export function buildWhatsappReplyPrompt(tabContext) {
  const details = tabContext && typeof tabContext.details === 'object' ? tabContext.details : {};
  const myNumber = toSafeText(details.myNumber || '', 64);
  const chatLabel = buildWhatsappMetaLabel(tabContext);
  const messages = getWhatsappMessages(tabContext, 20)
    .map((item) => {
      const role = item?.role === 'me' ? 'Yo' : 'Contacto';
      const timestamp = toSafeText(item?.timestamp || '', 40);
      const text = toSafeText(item?.text || '', 320);
      return `${timestamp ? `[${timestamp}] ` : ''}${role}: ${text}`;
    })
    .join('\n');

  return [
    'Eres asistente para responder WhatsApp.',
    'Devuelve un unico mensaje corto listo para enviar (maximo 180 caracteres).',
    'No expliques ni uses encabezados.',
    'Si el contexto no alcanza, devuelve una pregunta corta para pedir claridad.',
    '',
    `Mi numero: ${myNumber || 'N/A'}`,
    `Chat: ${chatLabel}`,
    'Conversacion reciente:',
    messages || 'Sin mensajes recientes.',
    '',
    'Respuesta sugerida:'
  ].join('\n');
}
