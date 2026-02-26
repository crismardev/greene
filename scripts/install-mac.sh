#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[greene] Preparando entorno local (macOS)..."
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm no esta disponible. Instala Node.js primero." >&2
  exit 1
fi

echo "1) Instalando dependencias..."
npm install

echo "2) Compilando CSS del panel..."
npm run build:css

cat <<'EOF'

Listo.

Pasos manuales requeridos por Chrome:
1. Abre chrome://extensions
2. Activa Developer mode
3. Click en Load unpacked
4. Selecciona la carpeta del proyecto

Nota:
- Este script no puede instalar la extension automaticamente por restricciones del navegador.
- Extension orientada a entorno de desarrollo/controlado.
- Este script NO instala el Native Host local.
- Para Native Host (SMTP/DB bridge), usa "Settings > Local Connector > Descargar complemento (macOS .sh)".
- Si usaras DB con `native_host`, instala driver Python: `pip3 install "psycopg[binary]"` o `psycopg2`.

EOF
