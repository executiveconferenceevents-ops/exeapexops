@echo off
cd /d "%~dp0"
echo Building APEXOPS, please wait...
call npm run build
if errorlevel 1 (echo Build failed. & pause & exit /b 1)
call npm run desktop
