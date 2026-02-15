# Storage y Seguridad

Resumen de donde y como se guarda estado en la extension.

## chrome.storage.sync

Usado para settings livianos compartidos entre contextos:

- toggles de tools (ej. Retool cleanup)
- preferencias simples definidas en `src/tool-config.js`

## chrome.storage.local

Usado por background y memoria para estado local de ejecucion:

- estado de bootstrap inicial de contexto
- perfil de identidad en memoria local

## IndexedDB

Principal almacenamiento de panel/chat/contexto:

- chat history
- panel settings
- secrets cifrados
- historial persistido de WhatsApp
- vector store para contexto semantico

Servicios clave:

- `panel/services/panel-storage-service.js`
- `panel/services/context-memory-service.js`

## Cifrado de secrets

Servicio: `panel/services/pin-crypto-service.js`

- PIN de 4 digitos.
- Derivacion de llave con PBKDF2.
- Cifrado AES-GCM.
- Uso principal: API keys de providers AI.

## Datos sensibles

- URL de PostgreSQL puede incluir credenciales.
- API keys se guardan cifradas cuando hay PIN configurado.
- Logs intentan sanitizar secretos (ej. password en connection strings).

## Recomendaciones

- Configurar PIN antes de usar providers remotos.
- No compartir exports de IndexedDB sin sanitizar.
- Limitar dominios en `externally_connectable` segun necesidad real.
