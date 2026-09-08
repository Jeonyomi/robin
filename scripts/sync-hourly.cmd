@echo off
setlocal
set "PROJECT_DIR=%~dp0.."
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
cd /d "%PROJECT_DIR%"
if not exist "data" mkdir "data"
echo ===== %date% %time% activity pulse started ===== >> "data\sync.log"
"%NODE_EXE%" --import tsx "scripts/activity-pulse.ts" >> "data\sync.log" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
echo ===== %date% %time% activity pulse exit code: %EXIT_CODE% ===== >> "data\sync.log"
exit /b %EXIT_CODE%
