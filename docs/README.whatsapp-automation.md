# WhatsApp Automation

Automation de WhatsApp Web implementada por content script.

## Donde vive

- `src/tab-context/site-handlers/whatsapp-handler.js`
- `src/content-tab-context.js`
- `src/background.js`

## Que hace el handler

- Detecta chat actual (title, phone, channelId).
- Lee mensajes de conversacion activa.
- Lee inbox/listado de chats.
- Ejecuta acciones sobre la UI de WhatsApp Web.
- Observa cambios DOM para mantener contexto sincronizado.

## Acciones soportadas (`runAction`)

- `getMyNumber`
- `getCurrentChat`
- `readMessages` (alias: `getListMessages`)
- `getInbox` (alias: `getListInbox`)
- `sendMessage`
- `openChat` (alias: `openChatByQuery`)
- `openChatAndSendMessage` (alias: `openAndSendMessage`)
- `archiveChats` (alias: `archiveListChats`)
- `archiveGroups`
- `getAutomationPack`

## Ejecucion desde panel

El panel dispara estas acciones via:

1. `tabContextService.runSiteActionInTab(...)`
2. background (`GREENSTUDIO_SITE_ACTION_IN_TAB`)
3. `content-tab-context` -> handler activo (`whatsapp`)

## Ejecucion desde tools externas

Tipos externos mapeados:

- `WHATSAPP_GET_INBOX` -> `getInbox`
- `WHATSAPP_OPEN_CHAT` -> `openChat`
- `WHATSAPP_SEND_MESSAGE` -> `sendMessage`
- `WHATSAPP_OPEN_CHAT_AND_SEND_MESSAGE` -> `openChatAndSendMessage`

Si no hay tab de WhatsApp abierta, devuelve error y recomienda usar `OPEN_WHATSAPP`.

## Limitaciones practicas

- Requiere sesion activa en WhatsApp Web.
- Cambios fuertes de DOM en WhatsApp pueden romper selectores.
- Algunas acciones dependen de que la UI este cargada y estable.

## Sincronizacion historica

El panel persiste historial de chats y mensajes para contexto AI:

- storage en IndexedDB via `panel/services/panel-storage-service.js`
- ingesta vectorial via `panel/services/context-memory-service.js`

## Referencias adicionales

- `docs/whatsapp-automation-pack.md` (contexto base del automation pack)
