@echo off
cd /d "%~dp0"
title Install Windows Background Service
color 0b
cls

echo ================================================================
echo    Installing Permanent Windows Background Service
echo ================================================================
echo.
echo The bot will run permanently in Windows background:
echo   1. No CMD window needs to stay open.
echo   2. Automatically restarts with Windows on startup.
echo.

:: Check Admin Rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [NOTE] To install a Windows service, please Run as Administrator.
    echo.
)

echo Registering and starting background service...
node windows-service-install.js

echo.
pause
