@echo off
setlocal
cd /d "%~dp0.."
node tools\verify.mjs
exit /b %ERRORLEVEL%
