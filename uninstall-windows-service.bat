@echo off
cd /d "%~dp0"
title Uninstall Windows Background Service
color 0c
cls

echo ================================================================
echo    Uninstalling Windows Background Service
echo ================================================================
echo.

node windows-service-uninstall.js

echo.
pause
