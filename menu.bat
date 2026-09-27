@echo off
cd /d "%~dp0"
title Telegram Inventory Bot - Interactive PC Management Console
color 0b
cls

:: 1. Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0c
    echo ================================================================
    echo [ERROR] Node.js is not found on your system!
    echo Node.js is required to run the bot and interactive management console.
    echo.
    echo Please download and install Node.js v18 or later from:
    echo https://nodejs.org
    echo ================================================================
    pause
    exit /b 1
)

:: 2. Launch Interactive PC Management Menu
node menu.js

if %errorlevel% neq 0 (
    pause
)
