#!/bin/bash
cd "$(dirname "$0")" || exit 1
PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3"; elif command -v python >/dev/null 2>&1; then PY="python"; fi
if [ -z "$PY" ]; then
  osascript -e 'display alert "PEP Enterprise" message "Python 3 no está instalado. Instale Python 3 y vuelva a abrir Iniciar ERP.command." as critical' 2>/dev/null || true
  echo "Python 3 no está instalado."
  read -r -p "Presione Enter para cerrar..."
  exit 1
fi
exec "$PY" "pep_portable.py"
