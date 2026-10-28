@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0app.ps1" %*
exit /b %ERRORLEVEL%
