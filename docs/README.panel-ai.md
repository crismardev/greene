# Panel + AI

Este documento resume la app del side panel (`panel/`).

## Pantallas

Definidas principalmente en `panel/panel.html`:

- `onboarding`
- `home` (chat principal)
- `tools`
- `settings`

## Home (chat)

Implementado en `panel/panel-app.js`.

Capacidades:

- Chat con historial local.
- Seleccion de chat tool:
  - `chat`
  - `write_email`
- Seleccion de modelo activo.
- Render markdown (`marked`).
- Ejecucion de local tools cuando el modelo devuelve bloque `tool`.

## Local tools que el chat puede ejecutar

Desde `panel/panel-app.js`:

- `browser.*` (tabs/historial)
- `whatsapp.*` (automation en tab WhatsApp)
- `db.*` (PostgreSQL)

El flujo usa `tab-context-service` para llamar background.

## Proveedores AI

Servicio: `panel/services/ai-provider-service.js`

Providers soportados:

- `ollama` (local)
- `openai`
- `anthropic`
- `gemini`
- `openai_compatible`

Servicio local Ollama:

- `panel/services/ollama-service.js`
- Endpoints locales por default:
  - `http://localhost:11434/*`
  - `http://127.0.0.1:11434/*`

## Memoria de contexto

Servicio: `panel/services/context-memory-service.js`

- Vector memory local (Orama + embeddings en worker).
- Ingesta incremental de:
  - tabs
  - historial de navegacion
  - chat interno
  - historial de WhatsApp
- Perfil de identidad local para personalizar contexto.

## Settings

Areas disponibles:

- User
- Assistant
- AI Models
- CRM/ERP Database
- Tabs
- System Variables

Archivos clave:

- `panel/screens/settings-screen.js`
- `panel/controllers/system-variables-controller.js`
- `panel/controllers/dynamic-ui-sort-show-controller.js`

## Seguridad de API keys

- PIN local de 4 digitos.
- Cifrado AES-GCM con key derivada via PBKDF2.
- Servicio: `panel/services/pin-crypto-service.js`.

## Herramienta de imagen

Tool `Image to WebP`:

- Multi archivo (limite UI de 10).
- Ajuste de calidad.
- Descarga y copia al portapapeles (cuando el navegador lo permite).

## Archivos clave

- `panel/panel.html`
- `panel/panel-app.js`
- `panel/services/ai-provider-service.js`
- `panel/services/ollama-service.js`
- `panel/services/context-memory-service.js`
- `panel/services/pin-crypto-service.js`
- `panel/services/tab-context-service.js`
