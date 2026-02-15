# greenstudio-ext

Extension de Chrome (Manifest V3) para productividad con side panel, AI multi-provider, automatizacion de WhatsApp Web, tools de navegador y utilidades de imagen.

## Lo principal

- Side panel con chat AI y contexto vivo de tabs/historial.
- Orquestacion local de tools: `browser.*`, `whatsapp.*`, `db.*`.
- Integracion con WhatsApp Web (leer inbox, abrir chat, enviar mensaje, archivado).
- Integracion con PostgreSQL (lectura/escritura segura para CRM/ERP).
- Conversor de imagenes a WebP.
- Retool Layout Cleanup para `https://*.retool.com/apps/*`.
- API externa via `chrome.runtime.onMessageExternal` (incluye `OPEN_WHATSAPP`).

## Arquitectura rapida

- `manifest.json`: permisos, side panel, content scripts y `externally_connectable`.
- `src/background.js`: estado global de tabs/contexto/historial + router de acciones internas y externas.
- `src/background/background-browser-actions-controller.js`: implementacion de `browser.*`.
- `src/content-tab-context.js`: colecta contexto por tab y ejecuta `SITE_ACTION`.
- `src/tab-context/site-handlers/whatsapp-handler.js`: automation pack de WhatsApp.
- `panel/panel-app.js`: app principal del side panel.
- `panel/services/*`: AI providers, storage, memoria vectorial, db postgres, estado UI.
- `src/content.js`: tool de limpieza para Retool.

## Tools externas (`onMessageExternal`)

El service worker escucha payloads externos con `type` y `args`.

Tipos soportados:

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

Ejemplo minimo (`OPEN_WHATSAPP`):

```js
chrome.runtime.sendMessage('<EXTENSION_ID>', {
  type: 'OPEN_WHATSAPP',
  phone: '+5215512345678',
  text: 'Hola desde GreenStudio',
  reuseExistingTab: true,
  active: true
}, (response) => {
  console.log(response);
});
```

Respuesta esperada (shape):

```json
{
  "ok": true,
  "success": true,
  "type": "OPEN_WHATSAPP",
  "result": {
    "reused": true,
    "url": "https://web.whatsapp.com/send?phone=...&text=...",
    "tab": { "id": 123, "active": true, "url": "..." }
  }
}
```

Nota: para invocaciones desde paginas web, el `manifest` ya incluye `externally_connectable.matches` para `localhost`, `127.0.0.1` y `*.retool.com`.

## Retool sandbox bridge (recomendado en Retool)

Para apps de Retool en sandbox, usa `postMessage` hacia el content script puente:

```js
const payload = {
  type: 'OPEN_WHATSAPP',
  phone: table1.selectedRow.phone,
  text: 'Hola desde Retool'
};

window.parent.postMessage(
  {
    type: 'RETOOL_TO_EXTENSION',
    payload
  },
  '*'
);
```

El puente vive en `src/retool-bridge-content.js` y reenvia el payload al background con `chrome.runtime.sendMessage(...)`.

## Instalacion

1. Abre `chrome://extensions`.
2. Activa `Developer mode`.
3. Click en `Load unpacked`.
4. Selecciona esta carpeta (`greenstudio-ext`).

## Desarrollo

Instalar deps:

```bash
npm install
```

Compilar CSS de panel:

```bash
npm run build:css
```

Watch CSS:

```bash
npm run watch:css
```

## Documentacion por area

- `docs/README.background-external-tools.md`
- `docs/README.panel-ai.md`
- `docs/README.whatsapp-automation.md`
- `docs/README.retool-content.md`
- `docs/README.storage-security.md`
- `docs/README.docs-index.md`

## Estado de calidad

- No hay suite de tests automatizados en este repo.
- Se recomienda validar manualmente en Chrome:
  - mensajes externos (`OPEN_WHATSAPP` y `HELP`),
  - tools de WhatsApp con sesion activa,
  - flujo de AI local/remoto,
  - consultas DB en modo lectura y escritura controlada.
