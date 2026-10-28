@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1" %*
exit /b %ERRORLEVEL%
