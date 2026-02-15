# greenstudio-ext

Extension de Chrome (Manifest V3) para abrir **GreenStudio Tools** en un **side panel**.

## Features

1. `Home` screen como pantalla principal.
2. `Tools` screen con transicion izquierda-derecha de entrada/salida.
3. **AI Mail Writer**:
- Provider `Ollama` (local, open source) via `http://localhost:11434/api/generate`.
- Provider `Hugging Face Router` (modelos open source) via `https://router.huggingface.co/v1/chat/completions`.
4. **Image to WebP**:
- Carga `PNG/JPG/JPEG/GIF/BMP`.
- Convierte a `WebP` y permite descarga.
- Nota: para `GIF`, se convierte solo el primer frame.
5. **Retool Layout Cleanup**:
- Oculta header de Retool.
- Ajusta canvas y reaplica con observer/hook.
- Se puede activar/desactivar desde el side panel.

## Arquitectura

- `manifest.json`: configuracion MV3, side panel, permisos y content scripts.
- `src/background.js`: configura `openPanelOnActionClick` para abrir side panel al click del icono.
- `panel/panel.html`: estructura de UI (Home + Tools).
- `panel/tailwind.input.css`: entrada de Tailwind (`@tailwind base/components/utilities`).
- `panel/tailwind.generated.css`: salida compilada de utilidades Tailwind para el panel.
- `panel/panel.css`: System UI y animaciones de transicion.
- `panel/panel.js`: logica de navegacion, AI mail, image converter y settings.
- `src/tool-config.js`: llaves de tools/preferencias y defaults.
- `src/content.js`: ejecucion de Retool Layout Cleanup.
- `tailwind.config.js`: paths de contenido para generar solo las utilidades usadas.

## Instalar en Chrome

1. Abre `chrome://extensions`.
2. Activa `Developer mode`.
3. Click en `Load unpacked`.
4. Selecciona esta carpeta (`greenstudio-ext`).

## Tailwind utilities (panel)

1. Instala dependencias: `npm install`
2. Genera utilidades una vez: `npm run build:css`
3. En desarrollo, deja watcher: `npm run watch:css`

Las clases utilitarias en `panel/panel.html` (por ejemplo `flex justify-between items-center gap-12`) se compilan a `panel/tailwind.generated.css`.

## Uso rapido

1. Click en el icono de la extension para abrir el side panel.
2. Desde `Home`, entra a `Tools`.
3. Usa:
- `AI Mail` para generar correos.
- `Image WebP` para convertir imagenes.
- `Retool` para activar/aplicar limpieza en la pestana de Retool.

## Permisos de red

La extension declara:

- `https://router.huggingface.co/*`
- `http://localhost:11434/*`

Si usas Hugging Face, agrega tu token API en la tool `AI Mail`.
