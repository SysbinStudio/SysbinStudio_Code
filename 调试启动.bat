@echo off
chcp 65001 >nul
title Sysbin Studio Code - Debug

set ELECTRON_RUN_AS_NODE=
set SYSBIN_DEBUG=1

cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] Electron runtime not found. Please run: npm install
    pause
    exit /b 1
)

echo Starting in debug mode. Renderer errors will print here.
echo.

"node_modules\electron\dist\electron.exe" .

echo.
echo App exited. Press any key to close.
pause >nul
