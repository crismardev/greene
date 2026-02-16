# SMTP Native Host Packaging

Este documento define como distribuir el bridge local para SMTP y otras funciones locales.

## Limite importante de Chrome Extension

La extension NO puede:
- ejecutar un binario descargado automaticamente
- instalar software del sistema por su cuenta
- registrar por si sola un Native Messaging host en macOS/Windows/Linux

La extension SI puede:
- descargar instaladores/zip
- abrir guias y pasos de instalacion
- detectar si el host local existe y reportar errores claros
- enviar comandos al host una vez instalado (`nativeMessaging`)

## Arquitectura recomendada

1. Extension (panel/background)
- UI de configuracion y diagnostico.
- `runtime.sendMessage` -> `background` -> `sendNativeMessage`.

2. Native Host (proceso local)
- Binario local (Node empaquetado, Go, Rust, etc.).
- Recibe JSON por stdin/stdout (protocolo Native Messaging).
- Ejecuta SMTP y otras funciones locales (filesystem, procesos, red local, etc.).

3. Instalador por sistema operativo
- macOS: `.pkg` o script firmado.
- Windows: `.msi` o instalador EXE.
- Linux: `.deb`/`.rpm` o script.

## Estructura sugerida en este repo

- `docs/README.smtp-local-bridge.md`
- `docs/README.smtp-native-host-packaging.md`
- `native-host/` (codigo fuente del host)
- `native-host/packaging/` (scripts de build + instalacion)
- `releases/` (artefactos empaquetados por version)

## Flujo de distribucion recomendado

1. CI/CD compila host para cada OS.
2. CI/CD genera checksums + firmas.
3. Publicas artefactos en Releases (GitHub o storage propio HTTPS).
4. Extension muestra:
- version instalada detectada
- ultima version publicada
- boton para descargar instalador
- link a guia de instalacion

## Integracion en Settings (extension)

- Seccion `SMTP / Local Bridge` con:
  - `Transport`: `http_agent` o `native_host`
  - `Native Host Name`
  - `Version esperada`
  - botones:
    - `Guia local bridge`
    - `Guia empaquetado`
    - `Descargar instalador` (URL externa HTTPS)

## Seguridad minima

- No guardar credenciales SMTP en logs.
- Validar `origin` y formato de comandos en el host.
- Firmar binarios e instaladores.
- Mantener lista de comandos permitidos en el host.
- Usar minimo privilegio por OS.

## Siguiente paso practico

Crear `native-host/` con un host minimo:
- comando `PING`
- comando `GREENE_SMTP_SEND`
- respuesta estandar `{ ok, result|error }`

Con eso puedes probar instalacion real y luego extender a otras funciones locales.
