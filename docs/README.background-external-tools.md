# Background + External Tools

Este documento cubre la capa de orquestacion en `src/background.js`.

## Responsabilidades del background

- Mantener snapshot de contexto por tab (`tabContextState`).
- Calcular telemetria temporal por tab (dwell/active time).
- Mantener cache reciente de historial (`chrome.history`).
- Enrutar acciones internas:
  - `GREENSTUDIO_BROWSER_ACTION`
  - `GREENSTUDIO_SITE_ACTION_IN_TAB`
- Publicar snapshots a listeners (`GREENSTUDIO_TAB_CONTEXT_UPDATED`).
- Enrutar tools externas via `chrome.runtime.onMessageExternal`.

## Bus interno (panel/content <-> background)

Mensajes principales:

- `GREENSTUDIO_GET_TAB_CONTEXT`
- `GREENSTUDIO_TAB_CONTEXT_PUSH`
- `GREENSTUDIO_GET_TAB_CONTEXT_SNAPSHOT`
- `GREENSTUDIO_TAB_CONTEXT_UPDATED`
- `GREENSTUDIO_SITE_ACTION_IN_TAB`
- `GREENSTUDIO_SITE_ACTION`
- `GREENSTUDIO_BROWSER_ACTION`

## Browser actions disponibles

Implementadas en `src/background/background-browser-actions-controller.js`:

- `listTabs`
- `getRecentHistory`
- `queryHistoryRange`
- `getOldestHistoryVisit`
- `openNewTab`
- `focusTab`
- `closeTab`
- `closeNonProductivityTabs`

## API externa (`onMessageExternal`)

El contrato externo usa `message.type` y opcionalmente `message.args`.
Tambien se aceptan args directos en raiz del mensaje.

Adicionalmente, para Retool sandbox, el mismo catalogo se puede invocar por `chrome.runtime.onMessage` cuando el sender es un content script de `*.retool.com` (bridge interno).

### Catalogo

- `OPEN_WHATSAPP`
- `OPEN_URL`
- `LIST_TABS`
- `FOCUS_TAB`
- `CLOSE_TAB`
- `GET_RECENT_HISTORY`
- `CLOSE_NON_PRODUCTIVITY_TABS`
- `WHATSAPP_GET_INBOX`
- `WHATSAPP_OPEN_CHAT`
- `WHATSAPP_SEND_MESSAGE`
- `WHATSAPP_OPEN_CHAT_AND_SEND_MESSAGE`
- `HELP`

### OPEN_WHATSAPP

Comportamiento:

- Construye URL `https://web.whatsapp.com/send?...`.
- Por default intenta reutilizar una tab existente de WhatsApp (`reuseExistingTab: true`).
- Si no hay tab, crea una nueva.
- Refresca snapshot de contexto despues de abrir/actualizar.

Payload ejemplo:

```json
{
  "type": "OPEN_WHATSAPP",
  "phone": "+5215512345678",
  "text": "Hola",
  "reuseExistingTab": true,
  "active": true
}
```

Respuesta ejemplo:

```json
{
  "ok": true,
  "success": true,
  "type": "OPEN_WHATSAPP",
  "result": {
    "reused": true,
    "url": "https://web.whatsapp.com/send?phone=...&text=...",
    "tab": {
      "id": 123,
      "windowId": 1,
      "index": 5,
      "active": true,
      "pinned": false,
      "title": "WhatsApp",
      "url": "https://web.whatsapp.com/send?...",
      "site": "whatsapp"
    }
  }
}
```

### HELP

Devuelve el listado de tools y args esperados.

Ejemplo:

```json
{
  "type": "HELP"
}
```

## Ejemplos de uso

### 1) Listar tabs

```js
chrome.runtime.sendMessage('<EXTENSION_ID>', {
  type: 'LIST_TABS'
}, console.log);
```

### 2) Enfocar tab por url parcial

```js
chrome.runtime.sendMessage('<EXTENSION_ID>', {
  type: 'FOCUS_TAB',
  args: { urlContains: 'github.com' }
}, console.log);
```

### 3) Enviar mensaje por WhatsApp (chat abierto o destino buscado)

```js
chrome.runtime.sendMessage('<EXTENSION_ID>', {
  type: 'WHATSAPP_SEND_MESSAGE',
  args: { text: 'Te escribo en 10 min' }
}, console.log);
```

Si agregas `phone/query/name/chat`, el background enruta a `openChatAndSendMessage` y el handler valida que el numero del chat coincida antes de enviar.

## Seguridad de origen externo

En `manifest.json`:

- `externally_connectable.matches`:
  - `http://localhost/*`
  - `http://127.0.0.1/*`
  - `https://*.retool.com/*`

Si necesitas mas dominios, agregalos explicitamente y recarga la extension.

## Archivos clave

- `src/background.js`
- `src/background/background-browser-actions-controller.js`
- `manifest.json`
