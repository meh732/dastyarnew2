@echo off
cd /d "%~dp0"
title Stop Inventory Telegram Bot
cls

set PORT=3000
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="PORT" set PORT=%%b
    )
)

echo [*] Stopping bot service on port %PORT%...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT%') do (
    taskkill /f /pid %%a >nul 2>nul
)

echo.
echo [OK] Port %PORT% has been freed and service stopped.
pause
