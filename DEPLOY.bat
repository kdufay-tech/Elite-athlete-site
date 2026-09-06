:: ============================================================
:: ELITE ATHLETE - PRODUCTION DEPLOY
:: Double-click this file from File Explorer to deploy.
:: DO NOT drag-and-drop to the Netlify UI - functions won't deploy.
::
:: Auth: carries NO token. Run "npx netlify login" once; the CLI stores
:: credentials outside the repo. A token was previously hardcoded here
:: and committed - never put one back in a tracked file.
:: ============================================================
@echo off
cd /d "C:\Users\kdufa\App Development\Elite Athlete\elite-athlete-v3"
powershell -ExecutionPolicy Bypass -File "%~dp0DEPLOY.ps1"
