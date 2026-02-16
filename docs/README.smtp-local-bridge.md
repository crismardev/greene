# SMTP local bridge (Chrome extension)

Esta extension envia `smtp.sendMail` mediante el `background` (`GREENSTUDIO_SMTP_SEND`).

## Modos soportados

1. `http_agent`
- La extension llama por `fetch()` a un endpoint local (ej. `http://127.0.0.1:4395/smtp/send`).
- Debes tener un servicio HTTP escuchando en esa URL.
- Si no existe servicio, veras errores tipo `No hay servicio escuchando...`.

2. `native_host`
- La extension usa `chrome.runtime.sendNativeMessage()` hacia un host nativo.
- Debes instalar un proceso local y registrar su manifest de Native Messaging.
- Si no esta instalado, veras `Native host '<name>' no encontrado...`.
- Soporte inicial del instalador integrado: solo macOS.

## Donde configurar en la extension

En `Settings > Apps & Integrations > SMTP`:
- `SMTP Transport`: `http_agent` o `native_host`.
- `Native Host Name`: nombre registrado del host nativo (si usas `native_host`).
- `SMTP Agent URL`: URL del servicio HTTP (si usas `http_agent`).
- `SMTP Host`, `Port`, `Secure`, `Username`, `Password`, `Default From`.
- `Descargar complemento (macOS)`: descarga instalador local generado por la extension.
- `Ping complemento`: valida conexion con Native Host y habilita/deshabilita tools dependientes.

## Notas para Gmail SMTP

- Servidor: `smtp.gmail.com`
- Puerto `587`: usar `secure=auto` o `secure=false` (STARTTLS)
- Puerto `465`: usar `secure=true` (TLS)
- Usa App Password (no password normal si tu cuenta tiene 2FA)

## Debug rapido

1. Consola del panel
- Busca logs con prefijo `smtp_bridge:*`.
- Ejemplos:
  - `smtp_bridge:send`
  - `smtp_bridge:response_error`
  - `smtp_bridge:config_warning`

2. Consola del Service Worker (background)
- Busca logs con prefijo:
  - `onMessage:SMTP_SEND:*`
  - `smtp_http_agent:*`
  - `smtp_native_host:*`
  - `smtp_bridge:dispatch`

## Requisitos Native Host (resumen)

- Permiso `nativeMessaging` en `manifest.json`.
- Archivo manifest del host con:
  - `name`
  - `path` (absoluto en macOS/Linux)
  - `type: "stdio"`
  - `allowed_origins` con el `chrome-extension://<ID>/` de esta extension.
- El host debe hablar protocolo Native Messaging por `stdin/stdout`.

## Limite operativo importante

- La extension no puede ejecutar/instalar binarios por si sola.
- Puede descargar instaladores y abrir guias, pero la instalacion del host local siempre ocurre en el sistema operativo.
- Para plan de empaquetado/distribucion revisa: `docs/README.smtp-native-host-packaging.md`.

Referencia oficial:
- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
