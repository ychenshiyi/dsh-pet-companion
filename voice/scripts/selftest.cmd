@echo off
setlocal
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0selftest.ps1" %*
exit /b %ERRORLEVEL%
