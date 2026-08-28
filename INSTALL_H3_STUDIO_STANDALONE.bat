@echo off
setlocal
cd /d "%~dp0"

echo.
echo H3 Studio Standalone - bootstrap motore pubblico
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\BOOTSTRAP_STANDALONE_ENGINE.ps1" %*
set "H3_EXIT=%ERRORLEVEL%"
if not "%H3_EXIT%"=="0" (
  echo.
  echo Installazione non completata. Consulta il report indicato sopra.
  pause
  exit /b %H3_EXIT%
)
echo.
echo Operazione completata.
pause
exit /b 0
