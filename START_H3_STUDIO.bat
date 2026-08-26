@echo off
setlocal
cd /d "%~dp0"

set "H3_CODEX_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "H3_NODE_OK=0"

where node.exe >nul 2>nul
if not errorlevel 1 (
  node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=22?0:1)" >nul 2>nul
  if not errorlevel 1 set "H3_NODE_OK=1"
)

if "%H3_NODE_OK%"=="0" if exist "%H3_CODEX_NODE_DIR%\node.exe" (
  set "PATH=%H3_CODEX_NODE_DIR%;%PATH%"
  set "H3_NODE_OK=1"
  echo [H3 Studio] Uso il runtime Node incluso in Codex.
)

if "%H3_NODE_OK%"=="0" (
  echo [ERRORE] Serve Node.js 22 o superiore. Installalo da https://nodejs.org/
  pause
  exit /b 1
)

node -e "console.log('[H3 Studio] Node '+process.versions.node)"

if not exist "node_modules" (
  echo [H3 Studio] Prima installazione delle dipendenze...
  call npm install
  if errorlevel 1 (
    echo [ERRORE] Installazione dipendenze fallita.
    pause
    exit /b 1
  )
)

echo [H3 Studio] Avvio bridge su http://127.0.0.1:8787
start "H3 Studio - Bridge" cmd /k "cd /d ""%~dp0"" && node --env-file-if-exists=.env node_modules\tsx\dist\cli.mjs bridge\server.ts"

echo [H3 Studio] Avvio interfaccia su http://localhost:3000
start "H3 Studio - Web" cmd /k "cd /d ""%~dp0"" && node_modules\.bin\vinext.cmd dev"

if /i "%H3_ENABLE_TAILSCALE%"=="1" (
  where tailscale.exe >nul 2>nul
  if errorlevel 1 (
    echo [AVVISO] Tailscale richiesto ma tailscale.exe non e nel PATH.
  ) else (
  tailscale.exe serve --bg --yes --https=443 http://[::1]:3000
  tailscale.exe serve --bg --yes --https=8787 http://127.0.0.1:8787
  )
)

timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo H3 Studio avviato. Lascia aperte le due console.
echo Locale:    http://localhost:3000
echo Al primo avvio configura password Admin e collegamento ComfyUI nel browser.
timeout /t 3 /nobreak >nul
endlocal
