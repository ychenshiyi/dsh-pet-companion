@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
exit /b %ERRORLEVEL%
