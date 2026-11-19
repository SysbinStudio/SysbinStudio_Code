@echo off
chcp 65001 >nul
title Sysbin Studio Code

rem IMPORTANT: if ELECTRON_RUN_AS_NODE is left in the environment, Electron
rem degrades to plain Node, `app` becomes undefined and the main process
rem crashes immediately. Clear it before launching.
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ATTACH_CONSOLE=1

cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] Electron runtime not found. Please run: npm install
    pause
    exit /b 1
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
