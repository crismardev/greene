# Retool Content Tool

Retool en este proyecto tiene dos capas de content script:

- bridge de sandbox (`postMessage` -> extension)
- tool de limpieza visual (Retool Layout Cleanup)

## Archivos

- `src/content.js`
- `src/retool-bridge-content.js`
- `src/tool-config.js`
- `popup/popup.js`
- `panel/panel-app.js`

## Bridge para sandbox

`src/retool-bridge-content.js` escucha:

- `window.postMessage({ type: 'RETOOL_TO_EXTENSION', payload })`

Y reenvia `payload` al background por `chrome.runtime.sendMessage`.

### Ejemplo desde Retool

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

Opcionalmente, el bridge responde con evento:

- `EXTENSION_TO_RETOOL`

## Objetivo

- Ocultar header de Retool.
- Ajustar canvas para recuperar espacio vertical.
- Reaplicar automaticamente cuando Retool vuelve a inyectar nodos.

## Como opera

- Lee setting `tool_retool_layout_cleanup` desde `chrome.storage.sync`.
- Aplica sanitizacion en:
  - inicio,
  - cambios de DOM (MutationObserver),
  - hooks de insercion (`appendChild`, `insertBefore`, etc.),
  - intervalos periodicos.
- Escucha mensaje `GREENSTUDIO_TOOLS_APPLY` para aplicar manualmente.

## Activacion

Se puede activar/desactivar desde:

- popup clasico
- side panel > Tools > Retool

## Alcance de inyeccion

`manifest.json`:

- `src/retool-bridge-content.js` en `https://*.retool.com/*` (`all_frames: true`)
- `src/content.js` solo se inyecta en `https://*.retool.com/apps/*`.

## Nota

Es una solucion DOM-driven. Si Retool cambia estructura o atributos, hay que ajustar selectores.
