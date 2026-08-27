@echo off
setlocal
cd /d "%~dp0"
echo.
echo H3 Studio - importazione motore standalone
echo.
set "SOURCE_ROOT=%~1"
if not defined SOURCE_ROOT set /p "SOURCE_ROOT=Cartella ComfyUI portable sorgente (es. D:\ComfyUI_NVMe): "
if not defined SOURCE_ROOT (
  echo Percorso non indicato.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\INSTALL_STANDALONE_ENGINE.ps1" -SourcePortableRoot "%SOURCE_ROOT%"
if errorlevel 1 (
  echo.
  echo Installazione non completata.
  pause
  exit /b 1
)
echo.
echo Installazione completata. Ora usa START_H3_STUDIO_STANDALONE.bat
pause
