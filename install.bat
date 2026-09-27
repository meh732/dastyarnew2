@echo off
cd /d "%~dp0"
title Telegram Inventory Bot - Zero-to-Hero Installer & PC Manager
color 0b
cls

echo ================================================================
echo    Telegram Inventory Bot - Zero-to-Hero Installer & PC Manager
echo ================================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0c
    echo [ERROR] Node.js is not found on your system!
    echo Node.js is required to run the bot and web panel.
    echo.
    echo Please download and install Node.js v18 or later from:
    echo https://nodejs.org
    echo.
    echo After installing Node.js, run this install.bat or menu.bat again.
    echo.
    pause
    exit /b 1
)

:: 2. Check npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    color 0c
    echo [ERROR] npm command not found. Please ensure Node.js is properly installed.
    pause
    exit /b 1
)

:: 3. Launch interactive PC menu manager
echo [*] Launching Interactive PC Installer & Management Menu...
echo.
node menu.js

if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Setup encountered an issue or was closed.
    pause
    exit /b %errorlevel%
)
