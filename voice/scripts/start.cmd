@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
exit /b %ERRORLEVEL%
