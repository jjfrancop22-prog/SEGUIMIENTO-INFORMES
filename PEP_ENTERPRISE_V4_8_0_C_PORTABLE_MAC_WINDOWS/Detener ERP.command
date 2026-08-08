#!/bin/bash
cd "$(dirname "$0")" || exit 1
PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3"; elif command -v python >/dev/null 2>&1; then PY="python"; fi
if [ -z "$PY" ]; then exit 1; fi
"$PY" "pep_portable.py" --stop
