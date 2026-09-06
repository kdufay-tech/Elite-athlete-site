# ============================================================
# ELITE ATHLETE - PRODUCTION DEPLOY
# ============================================================
# Auth: this script carries NO token. The Netlify CLI stores your
# credentials in %USERPROFILE%\.netlify\config.json, outside the repo.
# One-time setup:   npx netlify login
# CI/alternative:   set NETLIFY_AUTH_TOKEN in your shell before running.
#
# A token was previously hardcoded here and committed. Never put one back
# in a tracked file - the repo is the one place a secret must never live.
# ============================================================

Set-Location "C:\Users\kdufa\App Development\Elite Athlete\elite-athlete-v3"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  ELITE ATHLETE - Production Deploy" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Building..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED. Fix errors above." -ForegroundColor Red
    pause; exit 1
}
Write-Host "Build complete." -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] Checking Netlify auth..." -ForegroundColor Yellow
if ($env:NETLIFY_AUTH_TOKEN) {
    Write-Host "Using NETLIFY_AUTH_TOKEN from environment." -ForegroundColor Green
} else {
    npx netlify status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Not logged in. Run this once, then re-run this script:" -ForegroundColor Red
        Write-Host "    npx netlify login" -ForegroundColor Yellow
        pause; exit 1
    }
    Write-Host "Using stored Netlify CLI login." -ForegroundColor Green
}

Write-Host "[3/3] Deploying static files + Netlify functions..." -ForegroundColor Yellow
npx netlify deploy --prod --dir=dist --functions=netlify/functions --site=379f18e6-ffe0-4b1a-bd0f-2d58ee827d6a

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  LIVE: https://elite-athlete.app" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
} else {
    Write-Host "DEPLOY FAILED. Check errors above." -ForegroundColor Red
}
Write-Host ""
pause
