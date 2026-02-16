# Contributing Guide

## Antes de contribuir

Este repositorio es **source-available** y no open source bajo la definicion OSI. Antes de contribuir:

- revisa `README.md`
- revisa `LICENSE.md`
- revisa `SECURITY.md`

## Principios de contribucion

- no introducir cambios que reduzcan controles de seguridad
- no ampliar permisos del manifest sin justificacion fuerte
- no exponer secretos, tokens o credenciales en codigo o docs
- mantener compatibilidad con el flujo de side panel y background actual

## Setup local

1. Instala dependencias:

```bash
npm install
```

2. Compila CSS:

```bash
npm run build:css
```

3. Carga extension unpacked:

- abre `chrome://extensions`
- activa `Developer mode`
- `Load unpacked`
- selecciona la carpeta raiz del repo

## Estructura esperada de PR

- objetivo claro en titulo/descripcion
- motivacion tecnica
- archivos tocados y razon
- riesgos y mitigaciones
- pasos de validacion manual

## Checklist minimo para PR

- [ ] no rompe flujo de chat base
- [ ] no rompe herramientas `browser.*`, `whatsapp.*`, `db.*` afectadas
- [ ] sin errores de sintaxis
- [ ] docs actualizadas si cambia comportamiento
- [ ] no se agregaron secretos ni datos sensibles

## Convenciones

- mantener cambios pequenos y focalizados
- preferir mensajes de error accionables para usuario
- documentar efectos en seguridad cuando aplique

## Reporte de bugs

Para bugs funcionales, abre issue con:

- contexto
- pasos de reproduccion
- resultado esperado
- resultado actual
- version/commit

Para vulnerabilidades, usa el flujo privado de `SECURITY.md`.

