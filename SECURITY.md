# Security Policy

## Declaracion del proyecto

Este proyecto **no** esta preparado para Chrome Web Store. Esta extension fue disenada para operar con privilegios elevados en entornos controlados y fue desarrollada con apoyo de AI para habilitar capacidades en una capa normalmente inaccesible desde apps web convencionales.

## Canales de reporte

Para reportar vulnerabilidades de seguridad, contacta al mantenedor de forma privada y **no** abras un issue publico con detalles explotables.

- Contacto: `security@[tu-dominio].com`
- Asunto recomendado: `[greene][SECURITY] <resumen>`
- Incluye:
  - version/commit afectado
  - pasos de reproduccion
  - impacto esperado
  - evidencia (logs, screenshots, PoC minima)

## Alcance de seguridad

Zonas criticas:

- `src/background.js` (router de acciones, mensajes externos, privilegios del extension context)
- `src/background/background-browser-actions-controller.js` (acciones de tabs/historial/navegacion)
- `src/tab-context/site-handlers/whatsapp-handler.js` (automatizacion UI WhatsApp Web)
- `panel/services/postgres-service.js` (guard rails de SQL)
- `manifest.json` (permissions, host permissions, externally_connectable)

## Modelo de riesgo operativo

Riesgos asumidos por diseno:

- permisos amplios de navegador y acceso a contexto multi-tab
- integraciones con automatizacion de UI en sitios de terceros
- ejecucion de tools internas invocadas por el flujo AI

Por estas razones, se recomienda:

- ejecutar en perfiles de Chrome dedicados
- limitar los dominios permitidos en `externally_connectable` segun despliegue
- usar credenciales de minimo privilegio para DB/SMTP/API keys
- mantener PIN habilitado para secretos locales

## SLA de respuesta

Objetivo operativo (best effort):

- confirmacion de recepcion: 2-5 dias habiles
- triage inicial: 7-10 dias habiles
- correccion/mitigacion: segun severidad e impacto

## Safe harbor

Investigacion de buena fe, sin exfiltracion de datos reales ni degradacion de terceros, sera tratada como reporte legitimo de seguridad.
