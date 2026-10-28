@echo off
cd /d "%~dp0"
echo Creating the APEXOPS Windows installer, please wait...
call npm run desktop:dist
if errorlevel 1 (echo Installer failed. & pause & exit /b 1)
echo Done. The installer is in the dist-desktop folder.
explorer dist-desktop
pause
