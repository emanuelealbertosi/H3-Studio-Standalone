@echo off
setlocal
cd /d "%~dp0"

set "H3_NODE_EXE="
if exist "engine\tools\node\node.exe" set "H3_NODE_EXE=%CD%\engine\tools\node\node.exe"

if not defined H3_NODE_EXE where node.exe >nul 2>nul
if not defined H3_NODE_EXE if not errorlevel 1 set "H3_NODE_EXE=node.exe"

if not defined H3_NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  set "H3_NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  echo [H3 Studio] Uso temporaneamente il runtime Node incluso in Codex.
)

if not defined H3_NODE_EXE (
  echo [ERRORE] Runtime Node standalone non installato.
  echo Esegui prima INSTALL_H3_STUDIO_STANDALONE.bat.
  pause
  exit /b 1
)

"%H3_NODE_EXE%" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=16)?0:1)"
if errorlevel 1 (
  echo [ERRORE] H3 Studio richiede Node 22.16 o superiore.
  pause
  exit /b 1
)

"%H3_NODE_EXE%" scripts\standalone-launcher.mjs
set "H3_EXIT=%ERRORLEVEL%"
if not "%H3_EXIT%"=="0" pause
exit /b %H3_EXIT%
