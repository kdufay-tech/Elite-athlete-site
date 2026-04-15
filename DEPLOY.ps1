# ============================================================
# ELITE ATHLETE — PRODUCTION DEPLOY
# ============================================================
# Two ways to run this:
#   Option A (File Explorer): Double-click DEPLOY.bat
#   Option B (PowerShell):    .\DEPLOY.ps1
#   Option C (PowerShell):    Run the command block below
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

Write-Host "[2/3] Authenticating..." -ForegroundColor Yellow
$env:NETLIFY_AUTH_TOKEN = "nfp_2k2p1jsGvdPZ52ts9udpCv4Kew9d234m8831"

Write-Host "[3/3] Deploying static files + Netlify functions..." -ForegroundColor Yellow
npx netlify deploy --prod --dir=dist --functions=netlify/functions --site=379f18e6-ffe0-4b1a-bd0f-2d58ee827d6a

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  LIVE: https://the-elite-athlete.netlify.app" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
} else {
    Write-Host "DEPLOY FAILED. Check errors above." -ForegroundColor Red
}
Write-Host ""
pause
