@echo off
cd /d "%~dp0"

:: Clear signal file and logs
del .splash-kill 2>nul
echo Starting application... > dev-log.txt

:: 1. START SPLASH IMMEDIATELY (Instant feedback)
start /b "" "node_modules\.bin\electron.cmd" resources/pre-splash.cjs

:: 2. QUICK CLEANUP (Ports only)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8888') do (taskkill /F /PID %%a >nul 2>&1)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5858') do (taskkill /F /PID %%a >nul 2>&1)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :9292') do (taskkill /F /PID %%a >nul 2>&1)

:: 3. START HIDER
start /b powershell -WindowStyle Hidden -File hide-terminal.ps1

:: 4. START APP
echo Launching npm run dev >> dev-log.txt
call npm run dev >> dev-log.txt 2>&1
