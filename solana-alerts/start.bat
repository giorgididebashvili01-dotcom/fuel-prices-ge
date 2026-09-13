@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SOL price alerts

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js ar aris dayenebuli.
  echo   gadmoicere: https://nodejs.org  ^(LTS^) da xelaxla gaushvi es faili.
  echo.
  pause
  exit /b 1
)

if not exist .env (
  echo.
  echo   pirveli gaSveba - saWiroa Telegram botis token.
  echo   @BotFather -^> /newbot -^> token  ^(magalitad 8123456789:AAH...^)
  echo.
  set /p TOKEN=  chasvi token da daaWire Enter:
  if "%TOKEN%"=="" (
    echo   token ar chaierta - vwyvet.
    pause
    exit /b 1
  )
  >  .env echo TELEGRAM_TOKEN=%TOKEN%
  >> .env echo PORT=8787
  >> .env echo HOST=0.0.0.0
  >> .env echo POLL_MS=5000
  >> .env echo ASSETS=SOL
  >> .env echo FIAT=GEL
  >> .env echo ACCESS_KEY=
  >> .env echo COOLDOWN_MIN=15
  echo   .env sheiqmna.
  echo.
)

start "" http://localhost:8787
node server.js
pause
