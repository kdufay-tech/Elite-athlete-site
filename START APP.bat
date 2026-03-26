@echo off
title Elite Athlete App v3
color 0A
cd /d "%~dp0"

echo.
echo  ============================================
echo   ELITE ATHLETE APP v3 — Full Integration
echo  ============================================
echo.

node --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    color 0C
    echo  [ERROR] Node.js not found.
    echo  Install from: https://nodejs.org  (click LTS)
    pause & exit /b 1
)

IF NOT EXIST ".env.local" (
    color 0E
    echo  [NOTICE] .env.local not found — API keys not configured.
    echo  The app will run but Supabase, Stripe, and EmailJS
    echo  features will be disabled until you add your keys.
    echo  See SETUP_GUIDE.txt for instructions.
    echo.
    timeout /t 4 >nul
)

IF NOT EXIST "node_modules\" (
    echo  Installing packages... (first time, ~2 minutes)
    call npm install
    IF %ERRORLEVEL% NEQ 0 (
        color 0C
        echo  [ERROR] npm install failed. Check internet connection.
        pause & exit /b 1
    )
    echo  [OK] Packages installed!
)

echo  Launching at http://localhost:3000
echo  Close this window to stop the app.
echo.
call npm run dev
pause
