# Greene

## Mensaje del desarrollador

**Esta extension no esta preparada para Chrome Web Store.**
Esta disenada para operar con privilegios elevados y fue generada con AI con el objetivo de implementar AI en una capa normalmente inaccesible.

> Polyform Noncommercial Source Available
>
> Copyright (c) 2026 Cristhian.
>
> Se permite la inspección del código fuente para auditoría de seguridad. Queda estrictamente prohibida la ejecución, copia, modificación o distribución de este software para cualquier propósito sin una clave de licencia válida adquirida en [Tu Sitio Web]. Este software no es "Open Source" bajo la definición de la OSI, es Source-Available de pago.

## Que es

Extension de Chrome (Manifest V3) con side panel para productividad asistida por AI, con automatizacion de WhatsApp Web, herramientas de navegador, integracion DB y utilidades de imagen.

## Capacidades principales

- Side panel con chat AI y contexto vivo de tabs/historial.
- Orquestacion local de tools: `browser.*`, `whatsapp.*`, `db.*`, `smtp.*`, `maps.*`.
- Integracion WhatsApp Web: leer inbox, abrir chat, enviar mensajes, archivar.
- Integracion PostgreSQL con guard rails de lectura/escritura.
- Conversor de imagenes a WebP.
- API externa via `chrome.runtime.onMessageExternal` para flujos integrados.

## Requisitos

- macOS o Linux (script `.sh` disponible para macOS por ahora).
- Node.js + npm.
- Google Chrome (Developer Mode habilitado para carga unpacked).
- Ollama local opcional para modelo base (`http://localhost:11434`).

## Instalacion (tutorial)

### Opcion A: Manual

1. Clona el repositorio.
2. Instala dependencias:

```bash
npm install
```

3. Compila CSS del panel:

```bash
npm run build:css
```

4. Abre `chrome://extensions`.
5. Activa `Developer mode`.
6. Click en `Load unpacked`.
7. Selecciona la carpeta raiz del proyecto.

### Opcion B: Script `.sh` (macOS por ahora)

Ejecuta:

```bash
./scripts/install-mac.sh
```

El script instala dependencias y compila CSS. Luego debes completar manualmente la carga en `chrome://extensions` (por restricciones del navegador).

## Flujo minimo recomendado de primer arranque

1. Abrir Settings > AI Models.
2. Definir modelo principal:
- local (Ollama), o
- remoto (con API key).
3. Si usaras providers remotos, configurar PIN para proteger secretos locales.
4. Validar tools en entorno controlado.

## Estructura tecnica (resumen)

- `manifest.json`: permisos, side panel, content scripts, externos.
- `src/background.js`: estado global y enrutamiento de acciones.
- `src/background/background-browser-actions-controller.js`: `browser.*`.
- `src/tab-context/site-handlers/whatsapp-handler.js`: automation WhatsApp.
- `panel/panel-app.js`: UI principal del side panel.
- `panel/services/*`: providers AI, storage, memoria, DB, seguridad.

## Seguridad y cumplimiento operativo

- Proyecto pensado para entorno controlado, no para distribucion publica masiva en Web Store.
- Revisar politicas en `SECURITY.md`.
- Ver modelo de contribucion y restricciones en `CONTRIBUTING.md`.
- Revisar almacenamiento y cifrado en `docs/README.storage-security.md`.

## Documentacion

- `docs/README.background-external-tools.md`
- `docs/README.panel-ai.md`
- `docs/README.whatsapp-automation.md`
- `docs/README.smtp-local-bridge.md`
- `docs/README.smtp-native-host-packaging.md`
- `docs/README.storage-security.md`
- `docs/README.docs-index.md`

## Estado de calidad

- No hay suite de tests automatizados end-to-end en este repo.
- Se requiere validacion manual de:
  - tools `whatsapp.*`
  - tools `db.*`
  - flujo de modelos AI (local/remoto)
  - mensajes externos (`onMessageExternal`)

## Licencia

Este proyecto usa una modalidad **Source-Available de pago**.
Ver `LICENSE.md`.
