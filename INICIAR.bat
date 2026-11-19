@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INICIAR.ps1"
echo.
echo Si ha salido algun error, leelo antes de cerrar esta ventana.
pause
