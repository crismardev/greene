# WhatsApp Automation Pack (Web)

Este pack en la extension usa una capa de automatizacion web inspirada en las operaciones base que exponen:

- `whatsapp-web.js` (Client API): `sendMessage`, `getNumberId`, `getChats`.
- `Baileys` (event-driven API): `messages.upsert`, `chats.upsert`, `messages.update`.

Referencias:

- https://docs.wwebjs.dev/Client.html
- https://baileys.wiki/docs/socket/receiving-updates/
- https://baileys.wiki/docs/socket/sending-messages/

## Operaciones estandarizadas en la extension

- `getMyNumber`
- `getCurrentChat`
- `readMessages`
- `getListMessages`
- `getInbox` / `getListInbox`
- `sendMessage`
- `getAutomationPack`

## Ubicacion de implementacion

- `src/tab-context/site-handlers/whatsapp-handler.js`
- `src/content-tab-context.js`
- `src/background.js`

## Notas

- En WhatsApp Web estas funciones se ejecutan sobre DOM de la pestana activa.
- El enrutado de acciones por tab se hace desde `background` para habilitar herramientas por sitio.
- El panel genera sugerencia de respuesta con modelo local y puede ejecutar `sendMessage` en el chat activo.
