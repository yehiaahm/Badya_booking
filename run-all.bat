@echo off
setlocal
rem Badya Spaces - try it out on this computer: installs what's missing, starts the
rem server and the app together, and opens the browser.
rem
rem   run-all.bat             start (opens the browser)
rem   run-all.bat --demo      load sample students and bookings first (never over real data)
rem   run-all.bat --no-open   don't open the browser
rem
rem For the real university server use start-production.bat instead.
cd /d "%~dp0"
title Badya Spaces

call :check_node || exit /b 1

if not exist "node_modules\vite" (
  echo.
  echo  Installing dependencies - first run only, this can take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed. Check your internet connection and free disk space, then try again.
    echo.
    pause
    exit /b 1
  )
)

set "OPEN=--open"
set "DEMO="
for %%A in (%*) do (
  if /i "%%~A"=="--no-open" set "OPEN="
  if /i "%%~A"=="--demo" set "DEMO=1"
)

rem Without a .env file, make a local administrator so you can look around.
if not exist ".env" (
  if not defined BOOTSTRAP_ADMIN_EMAIL set "BOOTSTRAP_ADMIN_EMAIL=admin@badya.edu.eg"
  if not defined BOOTSTRAP_ADMIN_NAME set "BOOTSTRAP_ADMIN_NAME=Facilities Admin"
  if not defined BOOTSTRAP_ADMIN_PASSWORD set "BOOTSTRAP_ADMIN_PASSWORD=badya-admin-2026"
)

if defined DEMO (
  echo.
  echo  Loading sample data...
  call npm run --silent data:demo
  if errorlevel 1 (
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  Starting Badya Spaces... keep this window open. Press Ctrl+C to stop.
echo.
echo  Students create their own account on the sign-in page.
if not exist ".env" echo  Administrator: %BOOTSTRAP_ADMIN_EMAIL%  /  password: %BOOTSTRAP_ADMIN_PASSWORD%
echo.
call npm run dev -- %OPEN%

echo.
echo  The app has stopped.
pause
exit /b 0

:check_node
where node >nul 2>nul
if errorlevel 1 goto :no_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 goto :old_node
exit /b 0
:no_node
echo.
echo  Node.js is not installed. Install the LTS version (22 or newer) from https://nodejs.org and try again.
echo.
pause
exit /b 1
:old_node
echo.
echo  This app needs Node.js 22.13 or newer. Install the current LTS from https://nodejs.org and try again.
echo.
pause
exit /b 1
