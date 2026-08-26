@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\INSTALL_COMFY_DEPENDENCIES.ps1"
if errorlevel 1 (
  echo.
  echo Installazione interrotta. Leggi l'errore sopra.
  pause
  exit /b 1
)
echo.
pause
