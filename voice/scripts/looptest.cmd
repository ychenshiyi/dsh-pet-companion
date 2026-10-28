@echo off
setlocal
cd /d "%~dp0.."
node dev\test\loop-check.mjs
exit /b %ERRORLEVEL%
