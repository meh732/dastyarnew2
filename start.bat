@echo off
cd /d "%~dp0"
title Inventory Telegram Bot Service
color 0a
cls

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0c
    echo [ERROR] Node.js is not found on your system!
    echo Please download and install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Read port from .env if present
set PORT=3000
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="PORT" set PORT=%%b
    )
)

echo ================================================================
echo    Telegram Inventory Bot Server Running
echo ================================================================
echo [*] Active Port: %PORT%
echo [*] Web Management URL: http://localhost:%PORT%
echo [*] To stop the server: Press Ctrl+C or close this window.
echo ================================================================
echo.

:: Open default browser
start "" "http://localhost:%PORT%"

:: Run pre-compiled server or fallback
if exist dist\server.cjs (
    node dist\server.cjs
) else (
    npm start
)

pause
