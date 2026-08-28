@echo off
setlocal
cd /d "%~dp0"

set "H3_ENGINE_PYTHON=%CD%\engine\runtime\python_embeded\python.exe"
if not exist "%H3_ENGINE_PYTHON%" (
  echo [ERRORE] Python embedded non trovato: %H3_ENGINE_PYTHON%
  exit /b 1
)

"%H3_ENGINE_PYTHON%" scripts\build-standalone-engine-artifact.py %*
set "H3_EXIT=%ERRORLEVEL%"
if not "%H3_EXIT%"=="0" (
  echo [ERRORE] Artefatto non creato.
)
exit /b %H3_EXIT%
