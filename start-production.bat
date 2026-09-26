@echo off
setlocal
rem Badya Spaces - run the real server for the university.
rem
rem   start-production.bat           build if needed, then start
rem   start-production.bat --build   rebuild the app first (after updating the code)
rem
rem Settings live in .env (copy .env.example). Data, backups and secrets are kept
rem in the "data" folder unless DATA_DIR says otherwise. See README.md.
cd /d "%~dp0"
title Badya Spaces - server

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Install the LTS version 22 or 24 from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  This server needs Node.js 22.13 or newer. Install the current LTS from https://nodejs.org.
  echo.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo  Created .env from .env.example.
  echo  Open .env, fill in PUBLIC_URL and BOOTSTRAP_ADMIN_EMAIL,
  echo  then run this file again.
  echo.
  notepad ".env"
  pause
  exit /b 1
)

if not exist "node_modules\hono" (
  echo.
  echo  Installing dependencies...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  npm install failed. Check the internet connection and free disk space.
    echo.
    pause
    exit /b 1
  )
)

set "BUILD="
if not exist "dist\index.html" set "BUILD=1"
if /i "%~1"=="--build" set "BUILD=1"
if defined BUILD (
  echo.
  echo  Building the app...
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo  The build failed - the server was not started.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  Starting the Badya Spaces server. Keep this window open, or run it as a
echo  Windows service (see README.md). Press Ctrl+C to stop.
echo.
call npm start
echo.
echo  The server has stopped.
pause
