@echo off
setlocal
cd /d "%~dp0"
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY where python3 >nul 2>nul && set "PY=python3"
if not defined PY (
  echo.
  echo PEP Enterprise necesita Python 3 para iniciar el servidor local.
  echo Instale Python 3 y marque la opcion "Add Python to PATH".
  echo.
  pause
  exit /b 1
)
%PY% "pep_portable.py"
endlocal
